import {
  AgentError,
  brand,
  type EpochMillis,
  type JsonObject,
  type MessageId,
  type RequestRunId,
  type SessionId,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type {
  ForkProcessSnapshotStatusRecord,
  ForkRequiredContentRef,
  ForkSessionRequest,
  ForkSessionResult,
  PrepareForkRequest,
  PrepareForkResult,
  RunTimelineEventRecord,
  SessionMessageRecord,
  SessionRecord,
  StageForkPromotionRequest,
  StageForkPromotionResult,
} from '@nextagent/agent-contracts/gateway';
import { randomUUID } from 'node:crypto';
import type {
  LocalForkPromotionBinding,
  LocalForkPromotedContentRecord,
  LocalForkRunTimelineEventSnapshotDraft,
  SqliteGatewayCore,
} from './sqlite-gateway-core.js';

const limits = {
  maxCopiedMessages: 500,
  maxCopiedContentBytes: 2_000_000,
  maxPromotionRefs: 8,
  maxPromotedBytes: 2_000_000,
  maxCopiedTimelineEvents: 10_000,
  maxCopiedTimelineEventBytes: 4_000_000,
} as const;
const forkTitlePrefix = 'Fork · ';
const sessionTitleMaxLength = 100;
const forkInheritedMetadataKey = 'forkInherited';

interface ResolvedForkSource {
  readonly sourceSession: SessionRecord;
  readonly sourceAnchorMessageId: MessageId;
  readonly prefix: readonly SessionMessageRecord[];
  readonly requiredContentRefs: readonly ForkRequiredContentRef[];
}

interface ResolvedForkAnchor {
  readonly sourceSession: SessionRecord;
  readonly sourceAnchorMessageId: MessageId;
  readonly anchor: SessionMessageRecord;
}

interface ForkIdMaps {
  readonly messageIds: ReadonlyMap<MessageId, MessageId>;
  readonly sourceMessages: ReadonlyMap<MessageId, SessionMessageRecord>;
  readonly requestIds: ReadonlyMap<MessageId, MessageId>;
  readonly runIds: ReadonlySet<RequestRunId>;
  readonly runIdMap: ReadonlyMap<RequestRunId, RequestRunId>;
  readonly runRequestIds: ReadonlyMap<RequestRunId, MessageId>;
}

export interface SqliteSessionForkApplicationOptions {
  readonly activeContextSelector?: LocalForkActiveContextSelector;
  readonly clock?: () => EpochMillis;
  readonly idFactory?: (prefix: string) => string;
}

export interface LocalForkActiveContextSelector {
  readonly select: (request: {
    readonly childSessionId: SessionId;
    readonly childAnchorMessageId: MessageId;
    readonly copiedMessages: readonly SessionMessageRecord[];
  }) => Promise<{ readonly messageIds: readonly MessageId[] }>;
}

export class SqliteSessionForkApplication {
  private lastEpochMillis = 0;

  constructor(
    private readonly core: SqliteGatewayCore,
    private readonly options: SqliteSessionForkApplicationOptions = {},
  ) {}

  async prepareFork(request: PrepareForkRequest, signal?: AbortSignal): Promise<PrepareForkResult> {
    assertForkRequest(request);
    assertNotCanceled(signal);
    const resolvedAnchor = await this.resolveAnchor(request);
    const replayed = await this.core.loadForkedSessionByIdempotency({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sourceSessionId: request.sourceSessionId,
      sourceAnchorMessageId: resolvedAnchor.sourceAnchorMessageId,
      idempotencyKey: request.idempotencyKey,
    });
    const requiredContentRefs = replayed === undefined ? (await this.resolveSourceFromAnchor(request, resolvedAnchor)).requiredContentRefs : [];
    return {
      forkAttemptId: brand<string, 'ForkAttemptId'>(this.id('fork-attempt')),
      requiredContentRefs,
      maxPromotedBytes: limits.maxPromotedBytes,
    };
  }

  async stageForkPromotion(request: StageForkPromotionRequest, signal?: AbortSignal): Promise<StageForkPromotionResult> {
    assertNotCanceled(signal);
    if (
      String(request.forkAttemptId).length < 1 ||
      String(request.forkAttemptId).length > 128 ||
      request.mimeType.trim().length < 1 ||
      request.mimeType.length > 256 ||
      !Number.isSafeInteger(request.sizeBytes) ||
      request.sizeBytes < 0 ||
      request.sizeBytes !== request.bytes.byteLength
    ) {
      throw forkError('SESSION_FORK_REQUEST_INVALID', 'Fork promotion request is invalid.');
    }
    if (!isNormalizedToolResultRef(request.sourceRefId)) {
      throw forkError('SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE', 'Fork promotion source ref is invalid.');
    }
    const source = await this.core.loadMessage({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      messageId: request.sourceMessageId,
    });
    if (source === undefined || source.sessionId !== request.sourceSessionId || !collectToolResultRefs(source).includes(request.sourceRefId)) {
      throw forkError('SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE', 'Fork promotion source ref is unavailable.');
    }
    return this.core.stageForkPromotion(request);
  }

  async forkSession(request: ForkSessionRequest, signal?: AbortSignal): Promise<ForkSessionResult> {
    assertForkRequest(request);
    assertNotCanceled(signal);
    const resolvedAnchor = await this.resolveAnchor(request);
    const replayed = await this.core.loadForkedSessionByIdempotency({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sourceSessionId: request.sourceSessionId,
      sourceAnchorMessageId: resolvedAnchor.sourceAnchorMessageId,
      idempotencyKey: request.idempotencyKey,
    });
    if (replayed !== undefined) {
      return { childSession: replayed, replayed: true };
    }
    const source = await this.resolveSourceFromAnchor(request, resolvedAnchor);

    const staged = await this.core.listStagedForkPromotions(request);
    const stagedBySource = validateStagedPromotions(request, source.requiredContentRefs, staged);
    const childSessionId = brand<string, 'SessionId'>(this.id('session'));
    const idMaps = this.createIdMaps(source.prefix);
    const copiedMessages: SessionMessageRecord[] = [];
    const promotionBindings: LocalForkPromotionBinding[] = [];
    for (const message of source.prefix) {
      const promotedRefs = new Map<string, string>();
      for (const ref of collectToolResultRefs(message)) {
        const promotion = stagedBySource.get(sourceRefKey(message.messageId, ref));
        if (promotion === undefined) {
          throw forkError('SESSION_FORK_PROMOTION_UNAVAILABLE', 'Fork promotion staging is incomplete.');
        }
        promotedRefs.set(ref, promotion.promotedContentId);
        promotionBindings.push({
          sourceMessageId: message.messageId,
          sourceRefId: ref,
          childMessageId: idMaps.messageIds.get(message.messageId)!,
          promotedContentId: promotion.promotedContentId,
        });
      }
      copiedMessages.push(this.copyMessage(message, childSessionId, idMaps, promotedRefs));
    }
    const childAnchorMessageId = idMaps.messageIds.get(source.sourceAnchorMessageId);
    if (childAnchorMessageId === undefined) {
      throw forkError('SESSION_FORK_ANCHOR_REMAP_FAILED', 'Fork anchor could not be remapped.', 'INTERNAL');
    }
    const selector = this.options.activeContextSelector;
    if (selector === undefined) {
      throw new AgentError({
        code: 'SESSION_FORK_UNAVAILABLE',
        message: 'Fork active context selector is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    assertNotCanceled(signal);
    const selection = await selector.select({ childSessionId, childAnchorMessageId, copiedMessages });
    assertSelection(selection.messageIds, copiedMessages);
    const snapshots = await this.collectProcessSnapshots(request, source.sourceSession, childSessionId, idMaps, signal);
    assertNotCanceled(signal);
    const now = this.now();
    const titleSnapshot = normalizeTitle(source.sourceSession.title);
    const childSession: SessionRecord = {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: childSessionId,
      title: `${forkTitlePrefix}${titleSnapshot.slice(0, sessionTitleMaxLength - forkTitlePrefix.length)}`,
      titleSource: 'automatic',
      createdAt: now,
      updatedAt: now,
    };
    return this.core.materializeForkSession({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      forkAttemptId: request.forkAttemptId,
      childSession,
      copiedMessages,
      activeContextMessageIds: selection.messageIds,
      copiedTimelineEvents: snapshots.events,
      copiedRunProcessStatuses: snapshots.statuses,
      promotionBindings,
      forkSource: {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        childSessionId,
        sourceSessionId: request.sourceSessionId,
        sourceAnchorMessageId: source.sourceAnchorMessageId,
        childAnchorMessageId,
        sourceSessionTitleSnapshot: titleSnapshot,
        createdAt: now,
      },
      sourceSessionId: request.sourceSessionId,
      sourceAnchorMessageId: source.sourceAnchorMessageId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  private async resolveAnchor(request: PrepareForkRequest | ForkSessionRequest): Promise<ResolvedForkAnchor> {
    const sourceSession = await this.core.loadSession({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: request.sourceSessionId,
    });
    if (sourceSession === undefined) {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Fork source session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    const sourceAnchorMessageId = request.sourceMessageId ?? (await this.resolveRequestAnchor(request));
    const persistedAnchor = await this.core.loadMessage({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      messageId: sourceAnchorMessageId,
    });
    if (persistedAnchor === undefined || persistedAnchor.sessionId !== request.sourceSessionId) {
      throw new AgentError({
        code: 'SESSION_FORK_ANCHOR_NOT_FOUND',
        message: 'Fork source anchor message was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    assertEligibleAnchor(persistedAnchor);
    return { sourceSession, sourceAnchorMessageId, anchor: persistedAnchor };
  }

  private async resolveSourceFromAnchor(
    request: PrepareForkRequest | ForkSessionRequest,
    resolvedAnchor: ResolvedForkAnchor,
  ): Promise<ResolvedForkSource> {
    const prefix = await this.core.listSessionMessagePrefixThroughAnchor({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: request.sourceSessionId,
      anchorMessageId: resolvedAnchor.sourceAnchorMessageId,
    });
    const anchor = prefix.at(-1);
    if (anchor?.messageId !== resolvedAnchor.sourceAnchorMessageId) {
      throw new AgentError({
        code: 'SESSION_FORK_ANCHOR_NOT_FOUND',
        message: 'Fork source anchor message was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    assertEligibleAnchor(anchor);
    await this.assertAnchorRunTerminal(request, anchor);
    assertPrefixBudgets(prefix);
    const requiredContentRefs = await this.discoverRequiredRefs(request, prefix);
    return {
      sourceSession: resolvedAnchor.sourceSession,
      sourceAnchorMessageId: resolvedAnchor.sourceAnchorMessageId,
      prefix,
      requiredContentRefs,
    };
  }

  private async resolveRequestAnchor(request: PrepareForkRequest | ForkSessionRequest): Promise<MessageId> {
    const sourceRequestId = request.sourceRequestId;
    if (sourceRequestId === undefined) {
      throw forkError('SESSION_FORK_REQUEST_INVALID', 'Fork source request anchor is required.');
    }
    const page = await this.core.listMessages({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: request.sourceSessionId,
      requestId: sourceRequestId,
      includeHidden: false,
      includeCapabilityResults: false,
      limit: 101,
    });
    if (page.hasMore) {
      throw requestAnchorAmbiguous();
    }
    const candidates = page.items.filter(isCompletedRequestAnchor);
    if (candidates.length === 0) {
      throw new AgentError({
        code: 'SESSION_FORK_REQUEST_ANCHOR_NOT_FOUND',
        message: 'Fork request anchor has no durable completed assistant message.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    if (candidates.length !== 1) {
      throw requestAnchorAmbiguous();
    }
    return candidates[0]!.messageId;
  }

  private async assertAnchorRunTerminal(request: PrepareForkRequest | ForkSessionRequest, anchor: SessionMessageRecord): Promise<void> {
    if (anchor.runId === undefined) {
      return;
    }
    const run = await this.core.loadRun({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      runId: anchor.runId,
    });
    if (run === undefined || run.sessionId !== request.sourceSessionId || run.requestId !== anchor.requestId) {
      throw forkError('SESSION_FORK_SOURCE_RUN_NOT_FOUND', 'Fork source run was not found.');
    }
    if (!isTerminalStatus(run.status)) {
      throw new AgentError({
        code: 'SESSION_FORK_SOURCE_RUN_NOT_TERMINAL',
        message: 'Fork source run is not terminal.',
        category: 'CONFLICT',
        retryable: true,
      });
    }
  }

  private async discoverRequiredRefs(
    request: PrepareForkRequest | ForkSessionRequest,
    prefix: readonly SessionMessageRecord[],
  ): Promise<readonly ForkRequiredContentRef[]> {
    const result: ForkRequiredContentRef[] = [];
    let occurrenceCount = 0;
    for (const message of prefix) {
      const refs = collectToolResultRefsWithOccurrences(message);
      occurrenceCount += refs.occurrences;
      if (occurrenceCount > limits.maxPromotionRefs) {
        throw forkError('SESSION_FORK_PROMOTION_LIMIT_EXCEEDED', 'Fork source prefix contains too many promotion refs.');
      }
      if (refs.refs.length === 0) {
        assertNoUnsupportedExecutionRefs(message.content, 'SESSION_FORK_EXECUTION_BOUND_CONTENT');
        assertNoUnsupportedExecutionRefs(JSON.stringify(message.metadata), 'SESSION_FORK_EXECUTION_BOUND_METADATA');
        continue;
      }
      if (message.runId === undefined) {
        throw forkError('SESSION_FORK_PROMOTION_UNAVAILABLE', 'Fork promotion source run is unavailable.');
      }
      const run = await this.core.loadRun({
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        runId: message.runId,
      });
      if (run === undefined || run.sessionId !== request.sourceSessionId || run.requestId !== message.requestId) {
        throw forkError('SESSION_FORK_SOURCE_RUN_NOT_FOUND', 'Fork promotion source run is unavailable.');
      }
      if (!isTerminalStatus(run.status)) {
        throw new AgentError({
          code: 'SESSION_FORK_SOURCE_RUN_NOT_TERMINAL',
          message: 'Fork promotion source run is not terminal.',
          category: 'CONFLICT',
          retryable: true,
        });
      }
      for (const refId of refs.refs) {
        result.push({
          sourceMessageId: message.messageId,
          sourceRequestId: message.requestId,
          sourceRunId: message.runId,
          agentVersion: run.agentVersion,
          refType: 'CAPABILITY_RESULT',
          refId,
        });
      }
    }
    return result;
  }

  private createIdMaps(prefix: readonly SessionMessageRecord[]): ForkIdMaps {
    const requestIds = new Map<MessageId, MessageId>();
    const messageIds = new Map<MessageId, MessageId>();
    const sourceMessages = new Map<MessageId, SessionMessageRecord>();
    const runIds = new Set<RequestRunId>();
    const runIdMap = new Map<RequestRunId, RequestRunId>();
    const runRequestIds = new Map<RequestRunId, MessageId>();
    for (const message of prefix) {
      requestIds.set(message.requestId, requestIds.get(message.requestId) ?? brand<string, 'MessageId'>(this.id('request')));
      if (message.runId !== undefined) {
        const existingRequest = runRequestIds.get(message.runId);
        if (existingRequest !== undefined && existingRequest !== message.requestId) {
          throw forkError('SESSION_FORK_EVENT_SCOPE_MISMATCH', 'Fork process run is bound to multiple requests.');
        }
        runIds.add(message.runId);
        runRequestIds.set(message.runId, message.requestId);
        runIdMap.set(message.runId, runIdMap.get(message.runId) ?? brand<string, 'RequestRunId'>(this.id('run')));
      }
    }
    for (const message of prefix) {
      const requestId = requestIds.get(message.requestId)!;
      messageIds.set(message.messageId, message.messageId === message.requestId ? requestId : brand<string, 'MessageId'>(this.id('message')));
      sourceMessages.set(message.messageId, message);
    }
    return { requestIds, messageIds, sourceMessages, runIds, runIdMap, runRequestIds };
  }

  private copyMessage(
    source: SessionMessageRecord,
    childSessionId: SessionId,
    idMaps: ForkIdMaps,
    promotedRefs: ReadonlyMap<string, string>,
  ): SessionMessageRecord {
    return {
      tenantId: source.tenantId,
      subjectId: source.subjectId,
      agentId: source.agentId,
      messageId: idMaps.messageIds.get(source.messageId)!,
      sessionId: childSessionId,
      requestId: idMaps.requestIds.get(source.requestId)!,
      ...(source.runId === undefined ? {} : { runId: idMaps.runIdMap.get(source.runId)! }),
      role: source.role,
      content: projectContent(source.content, idMaps.runIds, promotedRefs),
      contentType: source.contentType,
      metadata: {
        ...remapMetadata(source.metadata, idMaps.messageIds, idMaps.requestIds, idMaps.runIds, promotedRefs),
        [forkInheritedMetadataKey]: true,
      },
      visible: source.visible,
      createdAt: this.now(),
    };
  }

  private async collectProcessSnapshots(
    request: ForkSessionRequest,
    sourceSession: SessionRecord,
    childSessionId: SessionId,
    idMaps: ForkIdMaps,
    signal?: AbortSignal,
  ): Promise<{ readonly events: readonly LocalForkRunTimelineEventSnapshotDraft[]; readonly statuses: readonly ForkProcessSnapshotStatusRecord[] }> {
    const sourceStatuses = await this.core.listForkProcessSnapshotStatuses({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: sourceSession.sessionId,
    });
    const statusByRun = new Map(sourceStatuses.map((status) => [status.runId, status]));
    const sourceFork = await this.core.loadSessionForkSource({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      childSessionId: sourceSession.sessionId,
    });
    const collected: Array<{ readonly sequence: number; readonly draft: LocalForkRunTimelineEventSnapshotDraft }> = [];
    const statuses: ForkProcessSnapshotStatusRecord[] = [];
    let eventBytes = 0;
    for (const sourceRunId of idMaps.runIds) {
      assertNotCanceled(signal);
      const childRunId = idMaps.runIdMap.get(sourceRunId)!;
      const sourceStatus = statusByRun.get(sourceRunId);
      let sourceRequestId = sourceStatus?.requestId;
      let legacy = sourceStatus?.status === 'LEGACY_UNAVAILABLE';
      if (sourceRequestId === undefined) {
        const run = await this.core.loadRun({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          runId: sourceRunId,
        });
        if (run === undefined) {
          if (sourceFork === undefined) {
            throw forkError('SESSION_FORK_SOURCE_RUN_NOT_FOUND', 'Fork process source run was not found.');
          }
          sourceRequestId = idMaps.runRequestIds.get(sourceRunId);
          legacy = true;
        } else {
          if (run.sessionId !== sourceSession.sessionId || run.agentId !== request.agentId) {
            throw forkError('SESSION_FORK_EVENT_SCOPE_MISMATCH', 'Fork process source scope is invalid.');
          }
          sourceRequestId = run.requestId;
        }
      }
      if (sourceRequestId === undefined) {
        throw forkError('SESSION_FORK_EVENT_REMAP_FAILED', 'Fork process request could not be resolved.');
      }
      const childRequestId = idMaps.requestIds.get(sourceRequestId);
      if (childRequestId === undefined) {
        throw forkError('SESSION_FORK_EVENT_REMAP_FAILED', 'Fork process request could not be remapped.');
      }
      const resolvedSourceRequestId = sourceRequestId;
      if (legacy) {
        statuses.push({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          sessionId: childSessionId,
          requestId: childRequestId,
          runId: childRunId,
          status: 'LEGACY_UNAVAILABLE',
        });
        continue;
      }
      let afterSequence = brand<number, 'TimelineSequence'>(0);
      let previousSequence = afterSequence;
      const origin = sourceStatus?.status === 'AVAILABLE' ? 'FORK_SNAPSHOT' : undefined;
      while (true) {
        const page = await this.core.listEvents({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          sessionId: sourceSession.sessionId,
          requestId: resolvedSourceRequestId,
          runId: sourceRunId,
          ...(origin === undefined ? {} : { recordOrigin: origin }),
          afterSequence,
          limit: 1000,
        });
        for (const event of page) {
          assertHistoryEvent(
            event,
            {
              tenantId: request.tenantId,
              subjectId: request.subjectId,
              agentId: request.agentId,
              sessionId: sourceSession.sessionId,
              requestId: resolvedSourceRequestId,
              runId: sourceRunId,
              ...(origin === undefined ? {} : { recordOrigin: origin }),
            },
            previousSequence,
          );
          previousSequence = event.sequence;
          assertProcessMessageReference(event, idMaps);
          if (collected.length >= limits.maxCopiedTimelineEvents) {
            throw forkError('SESSION_FORK_EVENT_LIMIT_EXCEEDED', 'Fork process history exceeds the event limit.');
          }
          const draft: LocalForkRunTimelineEventSnapshotDraft = {
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            agentId: request.agentId,
            agentVersion: event.agentVersion,
            eventId: this.id('timeline-event'),
            sessionId: childSessionId,
            requestId: childRequestId,
            runId: childRunId,
            recordOrigin: 'FORK_SNAPSHOT',
            type: event.type,
            inlinePayload: remapEventPayload(event, idMaps),
            createdAt: event.createdAt,
          };
          eventBytes += Buffer.byteLength(JSON.stringify(draft), 'utf8');
          if (eventBytes > limits.maxCopiedTimelineEventBytes) {
            throw forkError('SESSION_FORK_EVENT_BYTES_EXCEEDED', 'Fork process history exceeds the event byte limit.');
          }
          collected.push({ sequence: Number(event.sequence), draft });
        }
        const last = page.at(-1);
        if (page.length < 1000 || last === undefined) {
          break;
        }
        if (Number(last.sequence) <= Number(afterSequence)) {
          throw forkError('SESSION_EVENT_HISTORY_RECORD_INVALID', 'Fork process event cursor did not advance.');
        }
        afterSequence = last.sequence;
      }
      statuses.push({
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: childSessionId,
        requestId: childRequestId,
        runId: childRunId,
        status: 'AVAILABLE',
      });
    }
    collected.sort((left, right) => left.sequence - right.sequence);
    return { events: collected.map((item) => item.draft), statuses };
  }

  private now(): EpochMillis {
    const candidate = this.options.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
    const next = Math.max(Number(candidate), this.lastEpochMillis + 1);
    this.lastEpochMillis = next;
    return brand<number, 'EpochMillis'>(next);
  }

  private id(prefix: string): string {
    return this.options.idFactory?.(prefix) ?? `${prefix}-${randomUUID()}`;
  }
}

function assertForkRequest(request: PrepareForkRequest | ForkSessionRequest): void {
  const hasMessage = request.sourceMessageId !== undefined && request.sourceMessageId !== null;
  const hasRequest = request.sourceRequestId !== undefined && request.sourceRequestId !== null;
  if (hasMessage === hasRequest) {
    throw forkError('SESSION_FORK_REQUEST_INVALID', 'Exactly one fork source anchor is required.');
  }
  const key = String(request.idempotencyKey);
  if (key.trim().length === 0) {
    throw forkError('SESSION_FORK_IDEMPOTENCY_REQUIRED', 'Fork idempotency key is required.');
  }
  if (key !== key.trim() || key.length > 128) {
    throw forkError('SESSION_FORK_REQUEST_INVALID', 'Fork idempotency key is invalid.');
  }
  if ('forkAttemptId' in request) {
    const attempt = String(request.forkAttemptId);
    if (attempt.length < 1 || attempt.length > 128) {
      throw forkError('SESSION_FORK_REQUEST_INVALID', 'Fork attempt id is invalid.');
    }
  }
}

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AgentError({ code: 'SESSION_FORK_CANCELED', message: 'Session fork was canceled.', category: 'CANCELED', retryable: false });
  }
}

function assertEligibleAnchor(anchor: SessionMessageRecord): void {
  if (anchor.role !== 'ASSISTANT' || !anchor.visible || anchor.content.trim().length === 0) {
    throw forkError('SESSION_FORK_ANCHOR_NOT_ELIGIBLE', 'Fork source anchor is not eligible.');
  }
}

function isCompletedRequestAnchor(message: SessionMessageRecord): boolean {
  return (
    message.role === 'ASSISTANT' &&
    message.visible &&
    message.content.trim().length > 0 &&
    message.metadata['eventType'] === 'REQUEST_COMPLETED' &&
    message.metadata['status'] === 'COMPLETED'
  );
}

function requestAnchorAmbiguous(): AgentError {
  return new AgentError({
    code: 'SESSION_FORK_REQUEST_ANCHOR_AMBIGUOUS',
    message: 'Fork request anchor is ambiguous.',
    category: 'CONFLICT',
    retryable: false,
  });
}

function assertPrefixBudgets(prefix: readonly SessionMessageRecord[]): void {
  if (prefix.length > limits.maxCopiedMessages) {
    throw forkError('SESSION_FORK_PREFIX_TOO_LARGE', 'Fork source prefix is too large.');
  }
  const bytes = prefix.reduce(
    (total, message) => total + Buffer.byteLength(message.content, 'utf8') + Buffer.byteLength(JSON.stringify(message.metadata), 'utf8'),
    0,
  );
  if (bytes > limits.maxCopiedContentBytes) {
    throw forkError('SESSION_FORK_PREFIX_CONTENT_TOO_LARGE', 'Fork source prefix content is too large.');
  }
}

function collectToolResultRefs(message: Pick<SessionMessageRecord, 'content' | 'metadata'>): readonly string[] {
  return collectToolResultRefsWithOccurrences(message).refs;
}

function collectToolResultRefsWithOccurrences(message: Pick<SessionMessageRecord, 'content' | 'metadata'>): {
  readonly refs: readonly string[];
  readonly occurrences: number;
} {
  const occurrences = [...extractToolResultRefs(message.content), ...extractToolResultRefs(JSON.stringify(message.metadata))];
  return { refs: [...new Set(occurrences)].sort(), occurrences: occurrences.length };
}

function extractToolResultRefs(value: string): readonly string[] {
  return [
    ...value.matchAll(
      /(?<![A-Za-z0-9._/-])(?:workspace\/)?tool-results\/[A-Za-z0-9_-](?:[A-Za-z0-9_-]|[./](?=[A-Za-z0-9_-]))*(?=$|[\s"`',.;:>)\]}])/gu,
    ),
  ]
    .map((match) => normalizeToolResultRef(match[0]))
    .filter((ref): ref is string => ref !== undefined);
}

function normalizeToolResultRef(value: string): string | undefined {
  const ref = value.startsWith('workspace/') ? value.slice('workspace/'.length) : value;
  return isNormalizedToolResultRef(ref) ? ref : undefined;
}

function isNormalizedToolResultRef(ref: string): boolean {
  return (
    ref.length >= 1 &&
    ref.length <= 512 &&
    ref.startsWith('tool-results/') &&
    !ref.includes('\\') &&
    !ref.includes('\0') &&
    ref.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

function validateStagedPromotions(
  request: ForkSessionRequest,
  required: readonly ForkRequiredContentRef[],
  staged: readonly LocalForkPromotedContentRecord[],
): ReadonlyMap<string, LocalForkPromotedContentRecord> {
  const requiredKeys = new Set(required.map((item) => sourceRefKey(item.sourceMessageId, item.refId)));
  const result = new Map<string, LocalForkPromotedContentRecord>();
  for (const item of staged) {
    const key = sourceRefKey(item.sourceMessageId, item.sourceRefId);
    if (
      item.forkAttemptId !== request.forkAttemptId ||
      item.sourceSessionId !== request.sourceSessionId ||
      !requiredKeys.has(key) ||
      result.has(key)
    ) {
      throw forkError('SESSION_FORK_PROMOTION_UNAVAILABLE', 'Fork promotion staging does not match the required refs.');
    }
    result.set(key, item);
  }
  if (result.size !== requiredKeys.size) {
    throw forkError('SESSION_FORK_PROMOTION_UNAVAILABLE', 'Fork promotion staging is incomplete.');
  }
  return result;
}

function sourceRefKey(messageId: MessageId, refId: string): string {
  return `${messageId}\0${refId}`;
}

function projectContent(content: string, sourceRunIds: ReadonlySet<RequestRunId>, promotedRefs: ReadonlyMap<string, string>): string {
  let projected = rewritePromotedRefs(content, promotedRefs);
  for (const runId of sourceRunIds) {
    if (projected.includes(runId)) {
      throw forkError('SESSION_FORK_SOURCE_RUN_REF', 'Fork content contains source runtime references.');
    }
  }
  assertNoUnsupportedExecutionRefs(projected, 'SESSION_FORK_EXECUTION_BOUND_CONTENT');
  return projected;
}

function remapMetadata(
  metadata: JsonObject,
  messageIds: ReadonlyMap<MessageId, MessageId>,
  requestIds: ReadonlyMap<MessageId, MessageId>,
  runIds: ReadonlySet<RequestRunId>,
  promotedRefs: ReadonlyMap<string, string>,
): JsonObject {
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      const messageId = messageIds.get(brand<string, 'MessageId'>(value));
      if (messageId !== undefined) {
        return messageId;
      }
      const requestId = requestIds.get(brand<string, 'MessageId'>(value));
      if (requestId !== undefined) {
        return requestId;
      }
      for (const runId of runIds) {
        if (value === runId || value.includes(runId)) {
          throw forkError('SESSION_FORK_SOURCE_RUN_REF', 'Fork metadata contains source runtime refs.');
        }
      }
      const rewritten = rewritePromotedRefs(value, promotedRefs);
      assertNoUnsupportedExecutionRefs(rewritten, 'SESSION_FORK_EXECUTION_BOUND_METADATA');
      if (isUnsafeMetadataKey(key)) {
        throw forkError('SESSION_FORK_RUNTIME_METADATA', 'Fork metadata contains runtime-only fields.');
      }
      return rewritten;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item, key));
    }
    if (!isObject(value)) {
      return value;
    }
    const output: Record<string, unknown> = {};
    for (const [entryKey, entry] of Object.entries(value)) {
      if (key === 'lineage' && entryKey === 'sourceMessageId') {
        output[entryKey] = typeof entry === 'string' ? (messageIds.get(brand<string, 'MessageId'>(entry)) ?? null) : null;
      } else if (key === 'lineage' && (entryKey === 'sourceRunId' || entryKey === 'sourceInvocationId' || entryKey === 'stepId')) {
        output[entryKey] = null;
      } else {
        if (entry !== null && entry !== undefined && isUnsafeMetadataKey(entryKey)) {
          throw forkError('SESSION_FORK_RUNTIME_METADATA', 'Fork metadata contains runtime-only fields.');
        }
        output[entryKey] = visit(entry, entryKey);
      }
    }
    return output;
  };
  const result = visit(metadata);
  if (!isObject(result)) {
    throw forkError('SESSION_FORK_METADATA_INVALID', 'Fork metadata projection is invalid.');
  }
  return result as JsonObject;
}

function rewritePromotedRefs(value: string, promotedRefs: ReadonlyMap<string, string>): string {
  let output = value;
  for (const [sourceRef, promotedRef] of promotedRefs) {
    output = output.split(`workspace/${sourceRef}`).join(promotedRef);
    output = output.split(sourceRef).join(promotedRef);
  }
  output = output.replace(/^File path: fork-promoted:[^\r\n]*(?:\r?\n)?/gmu, '');
  return output.replace(
    /^Access: Invoke the Read tool with file_path="fork-promoted:[^"]+"[^\r\n]*/gmu,
    'Access: Use the contentRef to request or read the full content when needed.',
  );
}

function assertNoUnsupportedExecutionRefs(value: string, code: string): void {
  const scrubbed = value.replace(/(?<![A-Za-z0-9._/-])(?:workspace\/)?tool-results\/[A-Za-z0-9_-](?:[A-Za-z0-9_-]|[./](?=[A-Za-z0-9_-]))*/gu, '');
  if (
    /(?:workspace[\\/])?(?:run-workspace|temp|tmp|test-output|generated-skills)[\\/]/iu.test(scrubbed) ||
    /(?:[A-Za-z]:[\\/]|\/(?:tmp|private\/tmp|var\/tmp|var\/log)\/)/u.test(scrubbed)
  ) {
    throw forkError(code, 'Fork source contains unsupported execution-bound references.');
  }
}

function isUnsafeMetadataKey(key: string): boolean {
  return /^(?:sourceRunId|runId|requestRunId|sourceInvocationId|invocationId|stepId|checkpointId|sourceCheckpointId|checkpointRef|sourceCheckpointRef|timelineId|sourceTimelineId|timelineSequence|timelineRef|sourceTimelineRef|timelineEventRef|timelineEventId|eventId|blobRef|storageRef|rawProviderError|rawProviderBody|rawProviderPayload|rawProviderResponse|providerPayload|providerRawBody|providerResponse|hostPath|workspacePath|sourceWorkspacePath|filePath|sourcePath|sourceExecutionPath|executionPath|runtimePath|path)$/iu.test(
    key,
  );
}

function assertSelection(messageIds: readonly MessageId[], copiedMessages: readonly SessionMessageRecord[]): void {
  const copied = new Set(copiedMessages.map((item) => item.messageId));
  const seen = new Set<string>();
  for (const messageId of messageIds) {
    if (!copied.has(messageId) || seen.has(messageId)) {
      throw forkError('SESSION_FORK_ACTIVE_CONTEXT_INVALID', 'Fork active context selection is invalid.', 'INTERNAL');
    }
    seen.add(messageId);
  }
}

function remapEventPayload(event: RunTimelineEventRecord, maps: ForkIdMaps): JsonObject {
  const messageKeys = new Set(['messageId', 'rootMessageId', 'parentMessageId', 'terminalMessageId']);
  const requestKeys = new Set(['requestId', 'editedFromRequestId']);
  const runKeys = new Set(['runId', 'requestRunId', 'retryOfRunId']);
  const sourceIdentitySafeKeys = new Set([
    'reasoning',
    'content',
    'text',
    'stepId',
    'toolCallId',
    'parentToolCallId',
    'capabilityId',
    'executionId',
    'workflowExecutionId',
    'nodeId',
    'nodeDesc',
  ]);
  const allSourceIds = new Set<string>([...maps.messageIds.keys(), ...maps.requestIds.keys(), ...maps.runIds]);
  const visit = (value: unknown, key = ''): unknown => {
    if (key === 'selectedMessageRefs' && Array.isArray(value)) {
      return value.map((item) => {
        const mapped = typeof item === 'string' ? maps.messageIds.get(brand<string, 'MessageId'>(item)) : undefined;
        if (mapped === undefined) {
          throw forkError('SESSION_FORK_EVENT_REMAP_FAILED', 'Fork event message ref could not be remapped.');
        }
        return mapped;
      });
    }
    if (typeof value === 'string') {
      const mapped = messageKeys.has(key)
        ? maps.messageIds.get(brand<string, 'MessageId'>(value))
        : requestKeys.has(key)
          ? maps.requestIds.get(brand<string, 'MessageId'>(value))
          : runKeys.has(key)
            ? maps.runIdMap.get(brand<string, 'RequestRunId'>(value))
            : undefined;
      if ((messageKeys.has(key) || requestKeys.has(key) || runKeys.has(key)) && mapped === undefined) {
        throw forkError('SESSION_FORK_EVENT_REMAP_FAILED', 'Fork event ref could not be remapped.');
      }
      if (mapped === undefined && !sourceIdentitySafeKeys.has(key) && [...allSourceIds].some((sourceId) => value.includes(sourceId))) {
        throw forkError('SESSION_FORK_EVENT_PAYLOAD_UNSAFE', 'Fork event payload contains an unknown source ref.');
      }
      return mapped ?? value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item, key));
    }
    if (!isObject(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !/^(?:source|requestContext|contentRef|checkpoint|timelineEvent|path|rawProvider|idempotencyKey)/iu.test(entryKey))
        .map(([entryKey, entry]) => [entryKey, visit(entry, entryKey)]),
    );
  };
  const result = visit(event.inlinePayload);
  if (!isObject(result)) {
    throw forkError('SESSION_FORK_EVENT_PAYLOAD_UNSAFE', 'Fork event payload is invalid.');
  }
  return result as JsonObject;
}

function assertHistoryEvent(
  event: RunTimelineEventRecord,
  expected: {
    readonly tenantId: RunTimelineEventRecord['tenantId'];
    readonly subjectId: RunTimelineEventRecord['subjectId'];
    readonly agentId: RunTimelineEventRecord['agentId'];
    readonly sessionId: RunTimelineEventRecord['sessionId'];
    readonly requestId: RunTimelineEventRecord['requestId'];
    readonly runId: RunTimelineEventRecord['runId'];
    readonly recordOrigin?: 'FORK_SNAPSHOT';
  },
  previousSequence: TimelineSequence,
): void {
  const originValid =
    expected.recordOrigin === 'FORK_SNAPSHOT'
      ? event.recordOrigin === 'FORK_SNAPSHOT' && event.requestContextId === undefined && event.contentRef === undefined
      : event.recordOrigin === undefined && typeof event.requestContextId === 'string' && event.requestContextId.length > 0;
  if (
    event.tenantId !== expected.tenantId ||
    event.subjectId !== expected.subjectId ||
    event.agentId !== expected.agentId ||
    event.sessionId !== expected.sessionId ||
    event.requestId !== expected.requestId ||
    event.runId !== expected.runId ||
    !originValid ||
    typeof event.eventId !== 'string' ||
    event.eventId.length < 1 ||
    typeof event.agentVersion !== 'string' ||
    event.agentVersion.length < 1 ||
    !Number.isSafeInteger(Number(event.sequence)) ||
    Number(event.sequence) <= Number(previousSequence) ||
    !Number.isFinite(Number(event.createdAt)) ||
    Number(event.createdAt) < 0 ||
    !isObject(event.inlinePayload)
  ) {
    throw forkError('SESSION_FORK_TIMELINE_SNAPSHOT_INVALID', 'Fork process event history is invalid.');
  }
}

function assertProcessMessageReference(event: RunTimelineEventRecord, maps: ForkIdMaps): void {
  const reference = event.inlinePayload['messageId'];
  if (reference === undefined) {
    return;
  }
  if (typeof reference !== 'string') {
    throw invalidProcessMessageRef();
  }
  const message = maps.sourceMessages.get(brand<string, 'MessageId'>(reference));
  if (
    message === undefined ||
    message.tenantId !== event.tenantId ||
    message.subjectId !== event.subjectId ||
    message.agentId !== event.agentId ||
    message.sessionId !== event.sessionId ||
    message.requestId !== event.requestId ||
    message.runId !== event.runId
  ) {
    throw invalidProcessMessageRef();
  }
  if (event.type === 'LLM_CONTENT_DELTA') {
    if (event.inlinePayload['completed'] !== true || message.role !== 'ASSISTANT' || message.metadata['kind'] !== 'ASSISTANT_TOOL_USE') {
      throw invalidProcessMessageRef();
    }
    return;
  }
  const toolCallId = event.inlinePayload['toolCallId'];
  if (typeof toolCallId !== 'string') {
    throw invalidProcessMessageRef();
  }
  if (event.type === 'CAPABILITY_STARTED') {
    const toolCallIds = message.metadata['toolCallIds'];
    if (
      message.role !== 'ASSISTANT' ||
      message.metadata['kind'] !== 'ASSISTANT_TOOL_USE' ||
      !Array.isArray(toolCallIds) ||
      !toolCallIds.includes(toolCallId)
    ) {
      throw invalidProcessMessageRef();
    }
    return;
  }
  if (
    event.type !== 'CAPABILITY_COMPLETED' ||
    message.role !== 'CAPABILITY_RESULT' ||
    message.metadata['kind'] !== 'CAPABILITY_RESULT' ||
    message.metadata['toolCallId'] !== toolCallId
  ) {
    throw invalidProcessMessageRef();
  }
}

function invalidProcessMessageRef(): AgentError {
  return forkError('SESSION_FORK_PROCESS_MESSAGE_REFERENCE_INVALID', 'Fork process message reference is invalid.');
}

function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'SUPERSEDED';
}

function normalizeTitle(title?: string): string {
  const trimmed = title?.trim();
  return trimmed === undefined || trimmed.length === 0 ? 'Untitled session' : trimmed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function forkError(code: string, message: string, category: 'VALIDATION' | 'INTERNAL' = 'VALIDATION'): AgentError {
  return new AgentError({ code, message, category, retryable: false });
}
