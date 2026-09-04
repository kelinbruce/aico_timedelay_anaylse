import {
  AgentError,
  brand,
  type AgentId,
  type EpochMillis,
  type RequestRunId,
  type SafeError,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  ConversationShareRecord,
  ConversationShareStoreGateway,
  IdempotentWriteOptions,
  RequestRunRecord,
  RequestRunStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  CreateShareCommand,
  LoadSharedConversationQuery,
  RuntimeConversationSharePort,
  ShareResult,
  SharedConversationMessage,
  SharedConversationPage,
} from '@nextagent/agent-contracts/runtime';

export interface ConversationShareServiceDependencies {
  readonly shareStore: ConversationShareStoreGateway;
  readonly messageStore: SessionMessageStoreGateway;
  readonly runStore: RequestRunStoreGateway;
  readonly clock?: () => EpochMillis;
}

function isSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

function computeExpiresAt(expiresIn: CreateShareCommand['expiresIn'], now: EpochMillis): EpochMillis | null {
  switch (expiresIn) {
    case '24h':
      return brand<number, 'EpochMillis'>(now + 24 * 60 * 60 * 1000);
    case '7d':
      return brand<number, 'EpochMillis'>(now + 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return brand<number, 'EpochMillis'>(now + 30 * 24 * 60 * 60 * 1000);
    case 'permanent':
      return null;
    default: {
      const exhaustive: never = expiresIn;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function toSharedMessage(record: SessionMessageRecord): SharedConversationMessage {
  const metadata = { ...record.metadata };
  delete metadata.visibility;
  return {
    messageId: record.messageId,
    sessionId: record.sessionId,
    requestId: record.requestId,
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    role: record.role,
    content: record.content,
    contentType: record.contentType,
    metadata,
    sequence: 0,
    visible: true,
    createdAt: record.createdAt,
  };
}

function isShareReadableMessage(record: SessionMessageRecord): boolean {
  if (record.visible) {
    return true;
  }
  const visibility = record.metadata.visibility;
  if (typeof visibility !== 'object' || visibility === null || Array.isArray(visibility)) {
    return false;
  }
  const reason = (visibility as Record<string, unknown>).reason;
  return reason === 'RETRY_REPLACED' || reason === 'EDIT_REPLACED';
}

function isFinalAssistantMessage(record: SessionMessageRecord): boolean {
  return record.role === 'ASSISTANT' && record.metadata.kind !== 'ASSISTANT_TOOL_USE';
}

function isSharedConversationMessage(record: SessionMessageRecord): boolean {
  return record.role === 'USER' || isFinalAssistantMessage(record);
}

function shareContentDeleted(): SafeError {
  return {
    code: 'SHARE_CONTENT_DELETED',
    message: 'Shared content has been deleted.',
    category: 'NOT_FOUND',
    retryable: false,
  };
}

function isOpsHashEqual(allowedOps: readonly string[], viewerOps: readonly string[] | null): boolean {
  if (viewerOps === null || viewerOps.length === 0) {
    return false;
  }
  return allowedOps[0] === viewerOps[0];
}

interface ShareScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

function shareRunNotResolvable(): AgentError {
  return new AgentError({
    code: 'SHARE_RUN_NOT_RESOLVABLE',
    message: 'One or more selected runs cannot be shared: the run does not exist or is not a complete question-answer pair.',
    category: 'NOT_FOUND',
    retryable: false,
  });
}

export class ConversationShareService implements RuntimeConversationSharePort {
  constructor(private readonly deps: ConversationShareServiceDependencies) {}

  async createShare(command: CreateShareCommand): Promise<ShareResult> {
    const { identityContext, agentId, sessionId, runIds, originUrl, expiresIn, allowedOps } = command;
    const now = this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
    const expiresAt = computeExpiresAt(expiresIn, now);

    // Validate every selected runId resolves to one complete, attempt-precise
    // share unit BEFORE persisting. A share whose runIds cannot be read would
    // otherwise be created successfully but resolve to SHARE_CONTENT_DELETED on
    // view — a dead link. The resolve logic is shared with loadSharedConversation
    // so "creatable" and "readable" stay consistent. Fork-generated copied run
    // anchors (no RequestRunRecord but readable messages) pass this check.
    const scope: ShareScope = {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    };
    const readableMessages = await this.loadReadableMessages(scope);
    const runById = await this.buildRunById(scope, runIds);
    for (const runId of runIds) {
      const unit = await this.resolveShareUnit(runId, readableMessages, scope, runById);
      if (unit === null) {
        throw shareRunNotResolvable();
      }
    }

    const record: ConversationShareRecord = {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      shareId: '',
      sessionId,
      runIds,
      originUrl,
      allowedOps,
      expiresAt,
      createdAt: now,
    };

    const options: IdempotentWriteOptions = command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey };

    const result = await this.deps.shareStore.createShare(record, options);
    if (isSafeError(result)) {
      throw new AgentError({
        code: result.code,
        message: result.message,
        category: result.category,
        retryable: result.retryable,
        ...(result.safeDetails === undefined ? {} : { safeDetails: result.safeDetails }),
      });
    }

    // originUrl is the creator's current page URL (window.location.href, e.g.
    // .../immersive.html#/session/{sessionId}). Take everything before the hash fragment
    // so the share link reuses the exact same origin + pathname as the session URL, then
    // append the share hash route. No regex, no trailing-slash guessing: the base is the
    // browser's own URL up to the fragment, so it can never diverge from the session URL.
    const base = originUrl.split('#')[0];
    const shareUrl = `${base}#/shared/${result.shareId}`;
    return { shareId: result.shareId, shareUrl };
  }

  async loadSharedConversation(query: LoadSharedConversationQuery): Promise<SharedConversationPage | SafeError> {
    const { shareId, viewerOps } = query;

    // 1. Load share record by shareId (global, no scope required)
    const shareRecord = await this.deps.shareStore.loadShare({ shareId });
    if (isSafeError(shareRecord)) {
      return shareRecord;
    }
    if (shareRecord === undefined) {
      return { code: 'SHARE_NOT_FOUND', message: 'Share not found.', category: 'NOT_FOUND', retryable: false };
    }

    // 2. Validate expiration
    if (shareRecord.expiresAt !== null) {
      const now = this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
      if (now > shareRecord.expiresAt) {
        return { code: 'SHARE_EXPIRED', message: 'Share has expired.', category: 'NOT_FOUND', retryable: false };
      }
    }

    // 3. Validate ops permission (allowedOps hash equality with viewerOps)
    if (shareRecord.allowedOps !== null) {
      if (!isOpsHashEqual(shareRecord.allowedOps, viewerOps)) {
        return { code: 'SHARE_FORBIDDEN', message: 'Insufficient permissions to view this share.', category: 'AUTHORIZATION', retryable: false };
      }
    }

    // 4. Query messages using frozen creator scope (owner scope controlled exception)
    const readableMessages = await this.loadReadableMessages(shareRecord);

    // 5. Resolve every selected run into one complete, attempt-precise share unit.
    const uniqueRunIds = [...new Set(shareRecord.runIds)];
    const runById = await this.buildRunById(shareRecord, uniqueRunIds);
    const resolvedMessages: SessionMessageRecord[] = [];
    for (const selectedRunId of uniqueRunIds) {
      const unit = await this.resolveShareUnit(selectedRunId, readableMessages, shareRecord, runById);
      if (unit === null) {
        return shareContentDeleted();
      }
      resolvedMessages.push(...unit);
    }

    // 6. Deduplicate shared canonical questions and project allowed replacement-hidden
    // messages as visible in this read-only view without mutating their durable records.
    const uniqueMessages = new Map<string, SessionMessageRecord>();
    for (const message of resolvedMessages) {
      uniqueMessages.set(message.messageId, message);
    }
    const sharedMessages = [...uniqueMessages.values()]
      .filter(isSharedConversationMessage)
      .sort((a, b) => a.createdAt - b.createdAt || a.messageId.localeCompare(b.messageId))
      .map(toSharedMessage);

    return {
      sessionId: shareRecord.sessionId,
      messages: sharedMessages,
      createdAt: shareRecord.createdAt,
    };
  }

  /**
   * Load every readable message for a session under the given scope. Readable
   * includes visible messages plus RETRY_REPLACED / EDIT_REPLACED hidden ones
   * (frozen shares keep replaced content readable). Shared by create-time
   * validation and load-time projection so the two see the same message set.
   */
  private async loadReadableMessages(scope: ShareScope): Promise<SessionMessageRecord[]> {
    const allMessages: SessionMessageRecord[] = [];
    let beforeCursor: string | undefined = undefined;
    const limit = 200;

    for (;;) {
      const page = await this.deps.messageStore.listMessages({
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        sessionId: scope.sessionId,
        includeHidden: true,
        includeCapabilityResults: true,
        ...(beforeCursor === undefined ? {} : { beforeCursor }),
        limit,
      });
      allMessages.push(...page.items);
      if (!page.hasMore || page.nextBeforeCursor === undefined) {
        break;
      }
      beforeCursor = page.nextBeforeCursor;
    }

    return allMessages.filter(isShareReadableMessage);
  }

  /**
   * Resolve a single selected runId into one complete, attempt-precise share
   * unit (canonical USER question + the selected run's messages). Returns null
   * when the run is not resolvable: missing, cross-scope, or lacking a unique
   * canonical USER / final assistant answer. Fork-generated copied run anchors
   * (no RequestRunRecord but readable messages with exactly one USER request
   * and an assistant answer) resolve successfully. The returned array is the
   * raw message set; dedup/projection is the caller's responsibility.
   */
  private async resolveShareUnit(
    selectedRunId: RequestRunId,
    readableMessages: readonly SessionMessageRecord[],
    scope: ShareScope,
    runById: ReadonlyMap<RequestRunId, RequestRunRecord>,
  ): Promise<SessionMessageRecord[] | null> {
    const selectedRunMessages = readableMessages.filter((message) => message.runId === selectedRunId);
    const run = runById.get(selectedRunId);

    if (run === undefined) {
      const requestIds = new Set(selectedRunMessages.map((message) => message.requestId));
      const hasAssistantAnswer = selectedRunMessages.some(isFinalAssistantMessage);
      const selectedRequestId = requestIds.size === 1 ? selectedRunMessages[0]?.requestId : undefined;
      const userMessages =
        selectedRequestId === undefined
          ? []
          : readableMessages.filter((message) => message.requestId === selectedRequestId && message.role === 'USER');
      if (selectedRequestId === undefined || userMessages.length !== 1 || !hasAssistantAnswer) {
        return null;
      }
      return [userMessages[0]!, ...selectedRunMessages];
    }

    if (run.tenantId !== scope.tenantId || run.subjectId !== scope.subjectId || run.agentId !== scope.agentId || run.sessionId !== scope.sessionId) {
      return null;
    }

    const attemptMessages = selectedRunMessages.filter((message) => message.requestId === run.requestId);
    const hasMismatchedRequest = selectedRunMessages.some((message) => message.requestId !== run.requestId);
    const userMessages = readableMessages.filter((message) => message.requestId === run.requestId && message.role === 'USER');
    const hasAssistantAnswer = attemptMessages.some(isFinalAssistantMessage);
    if (hasMismatchedRequest || userMessages.length !== 1 || !hasAssistantAnswer) {
      return null;
    }
    return [userMessages[0]!, ...attemptMessages];
  }

  /**
   * Batch-load all selected run records in a single listRuns call and build a
   * runId to RequestRunRecord map for resolveShareUnit. Replaces the former
   * per-runId loadRun loop. listRuns filters by trusted tenantId/subjectId/agentId,
   * so cross-scope runIds are absent from the map (equivalent to loadRun returning
   * undefined). No sessionIds filter is applied so cross-session runs within the
   * same scope still appear and are rejected by resolveShareUnit's session check.
   */
  private async buildRunById(scope: ShareScope, runIds: readonly RequestRunId[]): Promise<ReadonlyMap<RequestRunId, RequestRunRecord>> {
    const page = await this.deps.runStore.listRuns({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      runIds: [...runIds],
      offset: 0,
      limit: runIds.length,
    });
    return new Map(page.items.map((run) => [run.runId, run] as const));
  }
}

export function createConversationShareService(deps: ConversationShareServiceDependencies): ConversationShareService {
  return new ConversationShareService(deps);
}
