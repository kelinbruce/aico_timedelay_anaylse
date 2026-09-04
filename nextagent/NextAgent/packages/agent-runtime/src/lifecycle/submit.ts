import {
  AgentError,
  brand,
  deriveCapabilityInvocationIdempotencyKey,
  isTaskEventId,
  type AttachmentId,
  type AttachmentIntakeReservationId,
  type CapabilityId,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type IdempotencyKey,
  type JsonObject,
  type JsonValue,
  type MessageId,
  type PendingInputQuestionAnswerKind,
  type RequestPriority,
  type RequestContextId,
  type RequestRunId,
  getLogger,
  type RunStatus,
  type SafeError,
  type SessionId,
  type TimelineSequence,
  type ToolCallId,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry, AgentHookActivation, AgentSelectionPolicy } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type {
  ActiveContextStoreGateway,
  AttachmentIntakeReservationGateway,
  ConversationAnnotationStoreGateway,
  DeleteAnnotationsByRunRequest,
  AuthorizationScopeRecord,
  CheckpointRecord,
  CheckpointStoreGateway,
  AttachmentStoreGateway,
  PendingInputRecord,
  PendingInputStoreGateway,
  PrepareForkRequest,
  RequestRunStoreGateway,
  RequestRunRecord,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  SessionRecord,
  SessionForkStoreGateway,
  SessionLaneSnapshot,
} from '@nextagent/agent-contracts/gateway';
import {
  type AgentConstructor,
  type AgentRunStatePort,
  type AnswerPendingInputCommand,
  type ForkSessionFromMessageResult,
  type ForkPromotionContentResolverPort,
  type HookBoundary,
  type HookEffect,
  type HookInput,
  type HookInvocationStatus,
  type LifecycleHookInvocationPort,
  type LifecycleHookControlInterruption,
  LifecycleHookInterruptionError,
  runtimeLifecycleStages,
  type LifecycleHookInvocationCoordinates,
  type LifecycleHookInvocationRequest,
  type LifecycleHookInvocationResult,
  type HookOutcome,
  type HookResult,
  type LargeContentExternalizerPort,
  type LifecycleHookDefinition,
  type LifecycleStage,
  type EditLatestRequestCommand,
  type PendingInputAnswerAccepted,
  type PendingInputIntent,
  type ReserveSubmitAccepted,
  type ReserveSubmitCommand,
  type PendingInputRequest,
  type RequestAccepted,
  type RequestContext,
  RequestModelOptionsSchema,
  type RoutingConstraints,
  RoutingConstraintsSchema,
  type RequestControlAccepted,
  type RequestControlCommand,
  type RequestRun,
  type RuntimeActiveRunSummary,
  type RuntimeEventStreamPort,
  type RuntimeEventStreamQuery,
  type RuntimeCreateSessionCommand,
  type RuntimeConversationPreviewQuery,
  type RuntimeDeleteSessionCommand,
  type RuntimeForkSessionFromMessageCommand,
  type RuntimeForkSessionFromRequestCommand,
  type RuntimeGetActiveRunQuery,
  type RuntimeGetRequestSummaryQuery,
  type RuntimeCommandPort,
  type HideRunMessagesCommand,
  type RuntimeListSessionEventsQuery,
  type RuntimeListSessionMessagesQuery,
  type RuntimeListSessionsQuery,
  type RuntimeRequireSessionQuery,
  type RuntimeResolveProcessMessagesQuery,
  type RuntimeSessionEventHistoryPage,
  type RuntimeSessionPort,
  type RuntimeSessionStreamEventsQuery,
  type RuntimeUpdateSessionTitleCommand,
  type RunTimelineEvent,
  type SessionTimelineEventInput,
  type SubmitRequestCommand,
  type RuntimeRequestSummary,
} from '@nextagent/agent-contracts/runtime';
import type { RuntimeTerminalResult } from '@nextagent/agent-contracts/runtime';
import type {
  ConversationPreviewPage,
  GenerateSessionTitleCommand,
  SessionMessage,
  SessionMessagePage,
  UserSession,
  UserSessionPage,
  UserSessionPort,
} from '@nextagent/agent-contracts/session';
import { Value } from '@sinclair/typebox/value';

import { toRunRecord } from '../assembly/assembly-binding.js';
import { saveRuntimeCheckpoint } from '../checkpoints/checkpoint-calls.js';
import { NoopCheckpointStoreGateway } from '../checkpoints/noop-checkpoint-store.js';
import { evaluateRecoveryToolReplayGuard, type RecoveredToolReplayDecision } from '../recovery/tool-replay-guard.js';
import { safeErrorContent } from '../terminal/failure-normalizer.js';
import { commitTerminalOutcomeWithHookResultSnapshot, type TerminalCommitOptions, type TerminalFailureReason } from '../terminal/terminal-commit.js';
import { buildTerminalHookResultSnapshot } from '../terminal/hook-result-snapshot.js';
import { appendCanonicalEvent } from '../timeline/event-port.js';
import { runtimeTimelinePayload } from '../timeline/runtime-payload.js';
import { AgentInstanceManager, type AgentRuntimeKit } from './agent-instance-manager.js';
import { RuntimeOwnedAgentRunStatePort } from './agent-run-state-port.js';
import { startAcceptedRun } from './dispatcher.js';
import type { RuntimeLifecycleHookExecutor, TrustedTerminalLifecycleHookExecutor } from './lifecycle-hooks.js';
import {
  LifecycleHookStageExecutor,
  type HookExecutionScope,
  type AgentHookSnapshot,
  type LifecycleHookExecution,
  materializeAgentHookSnapshots,
} from './lifecycle-hook-stage-executor.js';
import { createHash } from 'node:crypto';

const logger = getLogger({ component: 'agent-runtime', source: 'lifecycle' });

type RuntimeTerminalCommitOptions = TerminalCommitOptions & { readonly capabilityTerminalAnswer?: true };

const defaultRequestTimeoutMs = 1_800_000;
const forkRequestAnchorResolutionLimit = 100;
const maxRetryAttemptsPerRequest = 5;
const pendingInputTimeoutBatchSize = 100;
const pendingInputTimeoutInitialRetryMs = 1_000;
const pendingInputTimeoutMaxRetryMs = 30_000;

interface PendingInputTimeoutPassResult {
  readonly nextTimeoutAt?: EpochMillis;
  readonly retryRequired: boolean;
}
const maxProcessMessageReferences = 1_000;

interface InheritedLatestSource {
  readonly requestId: MessageId;
  readonly copiedRunAnchor?: RequestRunId;
  readonly inputText: string;
  readonly attachmentIds: readonly AttachmentId[];
  readonly requestModelOptions?: SubmitRequestCommand['requestModelOptions'];
  readonly routingConstraints?: RoutingConstraints;
  readonly sourceMessageIds: readonly MessageId[];
}

class TerminalCommitBoundaryError extends Error {
  constructor(cause: unknown) {
    super('Terminal commit failed at its owning boundary.', { cause });
    this.name = 'TerminalCommitBoundaryError';
  }
}

export interface RunExecutionStateTransition {
  readonly tenantId: SubmitRequestCommand['identityContext']['tenantId'];
  readonly subjectId: SubmitRequestCommand['identityContext']['subjectId'];
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
  readonly requestId: MessageId;
  readonly transition: 'ENTERED' | 'LEFT';
  readonly occurredAt: EpochMillis;
  readonly activeCount: number;
  readonly queueDurationMs?: number;
}

type RunExecutionTransitionContext = Omit<RunExecutionStateTransition, 'transition' | 'occurredAt' | 'activeCount' | 'queueDurationMs'>;

export interface RequestLifecycleDependencies<TAgentRuntimeDependencies extends object = object> {
  readonly agentConstructors: ReadonlyArray<AgentConstructor<AgentRuntimeKit<TAgentRuntimeDependencies>>>;
  readonly agentRuntimeDependencies: TAgentRuntimeDependencies;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly agentSelectionPolicy?: AgentSelectionPolicy;
  readonly capabilityCatalog: CapabilityCatalog;
  readonly userSessions: UserSessionPort;
  readonly messageStore: SessionMessageStoreGateway;
  readonly sessionForkStore?: SessionForkStoreGateway;
  readonly forkPromotionContentResolver?: ForkPromotionContentResolverPort;
  readonly attachmentStore?: AttachmentStoreGateway;
  readonly activeContextStore: ActiveContextStoreGateway;
  readonly attachmentReservations?: AttachmentIntakeReservationGateway;
  readonly requestRunStore: RequestRunStoreGateway;
  readonly timelineStore: RunTimelineEventStoreGateway;
  readonly checkpointStore: CheckpointStoreGateway;
  readonly pendingInputStore?: PendingInputStoreGateway;
  readonly retryAttachmentValidator?: RetryAttachmentValidator;
  readonly conversationAnnotationStore?: ConversationAnnotationStoreGateway;
  readonly lifecycleHook?: RuntimeLifecycleHookExecutor;
  readonly trustedTerminalLifecycleHook?: TrustedTerminalLifecycleHookExecutor;
  readonly lifecycleHookDefinitions?: readonly LifecycleHookDefinition[];
  readonly lifecycleHookSnapshots?: ReadonlyMap<string, AgentHookSnapshot>;
  readonly runTimelineEventListeners?: ReadonlyArray<(event: RunTimelineEvent) => void>;
  readonly runExecutionStateListeners?: ReadonlyArray<(transition: RunExecutionStateTransition) => void>;
  readonly runTimelineEventPersistencePolicy?: (event: RunTimelineEvent) => 'PERSISTED' | 'LIVE_ONLY';
  readonly largeContentExternalizer?: LargeContentExternalizerPort;
  readonly acceptedInputProjector?: AcceptedInputProjector;
  readonly defaultRouteAgentId: AgentId;
  readonly recoveryAgentId?: AgentId;
  readonly recoveryLockedBy?: string;
  readonly clock?: () => EpochMillis;
  readonly idFactory?: (prefix: string) => string;
  readonly scheduler?: {
    readonly maxPendingQueueDepth?: number;
    readonly maxConcurrent?: number;
  };
  /**
   * Optional diagnostic logger for runtime-level diagnostic
   * projections (e.g. unexpected errors in fire-and-forget
   * operations). When omitted, no diagnostic log is emitted.
   */
  /**
   * Optional fire-and-forget callback invoked after a run reaches
   * terminal commit (COMPLETED status only). Used for background
   * pre-computation tasks such as suggested-question generation.
   * Errors inside the callback are logged but never fail the run.
   */
  readonly pendingInputMaxTimeoutMs?: number;
  readonly askUserQuestionDefaultTimeoutMs?: () => Promise<number>;
  readonly postTerminalCallback?: (command: SubmitRequestCommand, run: RequestRun, status: RunStatus) => void | Promise<void>;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly traceEnabled?: boolean;
}

export interface AcceptedInputProjection {
  readonly inputText: string;
  readonly routingConstraints?: RoutingConstraints;
}

export type AcceptedInputProjector = (inputText: string, routingConstraints?: RoutingConstraints) => AcceptedInputProjection;

export interface LocalRuntimeRecoveryOptions {
  readonly limit?: number;
  readonly lockedBy?: string;
  readonly lockTtlMs?: number;
}

export interface LocalRuntimeRecoveryReport {
  readonly scanned: number;
  readonly rebuiltQueued: number;
  readonly claimedExecuting: number;
  readonly failed: number;
  readonly skipped: number;
}

const maxReplayBatchEvents = 1000;
const timelineReadTimeoutMs = 5_000;
const maxSubscribersPerStream = 10;
const maxSubscriberQueueEvents = 1000;
const subscriberQueueHardLimit = 2000;
const subscriberIdleTimeoutMs = 300_000;
const crossPodPollIntervalMs = 2_000;
const crossPodMaxIdlePolls = 150;
const maxReplayTotalEvents = 10_000;
const maxReplayDurationMs = 30_000;
const skipTerminalLifecycleHookKey = 'skipTerminalLifecycleHook';
const terminalLifecycleHookAppliedKey = 'terminalLifecycleHookApplied';
const terminalHookResumeSnapshotKey = 'terminalHookResumeSnapshot';

interface SessionTimelineOwner {
  readonly tenantId: SubmitRequestCommand['identityContext']['tenantId'];
  readonly subjectId: SubmitRequestCommand['identityContext']['subjectId'];
  readonly agentId: AgentId;
}

interface SessionTimelineScope extends SessionTimelineOwner {
  readonly sessionId: RuntimeEventStreamQuery['sessionId'];
}

interface StreamFilterVisibilityQuery extends SessionTimelineScope {
  readonly requestId?: RuntimeEventStreamQuery['requestId'];
  readonly runId?: RuntimeEventStreamQuery['runId'];
}

interface TimelineAnchorVisibilityQuery extends SessionTimelineScope {
  readonly lastSeenSequence: RuntimeEventStreamQuery['lastSeenSequence'];
}

interface RuntimeLiveTailStreamQuery {
  readonly sessionId: RuntimeEventStreamQuery['sessionId'];
  readonly signal?: AbortSignal;
}

export interface RuntimeIdleWaitOptions {
  readonly timeoutMs?: number;
}

interface TimelineStreamSubscriber {
  readonly requestId?: RuntimeEventStreamQuery['requestId'];
  readonly runId?: RuntimeEventStreamQuery['runId'];
  lastSeenSequence: number;
  wake?: () => void;
  pendingInputActive: boolean;
  readonly queue: RunTimelineEvent[];
}

interface QueuedRunWork {
  readonly command: SubmitRequestCommand;
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly laneKey: string;
}

interface QueuedRunReservation {
  readonly laneKey: string;
  readonly work: QueuedRunWork;
}

interface ExecutingRunState {
  readonly controller: AbortController;
  superseded: boolean;
  canceling: boolean;
  canceled: boolean;
  pendingInput: boolean;
  terminalized: boolean;
  cancelIdempotencyKey?: IdempotencyKey;
  cancelIdempotencySemantic?: string;
  executionTransitionContext?: RunExecutionTransitionContext;
}

const riskPolicyAuthorizationKey = 'riskPolicyAuthorization';

interface RetryAttachmentValidator {
  validateRetrySourceAttachments: (request: {
    readonly tenantId: SubmitRequestCommand['identityContext']['tenantId'];
    readonly subjectId: SubmitRequestCommand['identityContext']['subjectId'];
    readonly agentId: AgentId;
    readonly source: {
      readonly sessionId: RequestRunRecord['sessionId'];
      readonly requestId: RequestRunRecord['requestId'];
      readonly runId: RequestRunRecord['runId'];
    };
    readonly attachmentIds: SubmitRequestCommand['attachmentIds'];
  }) => Promise<{ readonly status: 'VALID' | 'UNAVAILABLE' }>;
}

export class RequestLifecycleCoordinator<TAgentRuntimeDependencies extends object = object>
  implements RuntimeCommandPort, RuntimeEventStreamPort, RuntimeSessionPort
{
  private readonly runState: RuntimeOwnedAgentRunStatePort;
  private readonly agentManager: AgentInstanceManager<TAgentRuntimeDependencies>;
  private readonly lifecycleHookStageExecutor: LifecycleHookStageExecutor;
  private readonly pendingLaneWork = new Map<string, QueuedRunWork[]>();
  private readonly drainingLanes = new Set<string>();
  private readonly blockedLanes = new Set<string>();
  private readonly executingRuns = new Map<string, ExecutingRunState>();
  private schedulerRunning = false;
  private inflightCount = 0;
  // In-memory set of runs flagged guard-blocked at output-guard detection time
  // (before terminal commit), so the terminal assistant message is persisted
  // with visible=false. Not durable: a runtime restart between detection and
  // commit loses the flag 鈥?the post-commit hideMessage fallback in
  // hideRunMessages covers the committed case, but a restart-during-run edge
  // case is accepted for this iteration.
  private readonly guardBlockedRunIds = new Set<string>();
  private readonly latestTerminalFailureReasons = new Map<RequestRunId, TerminalFailureReason>();
  private recoveryDispatchGated = false;
  private readonly sessionRuntimeStates = new Map<
    string,
    {
      tenantId: SubmitRequestCommand['identityContext']['tenantId'];
      subjectId: SubmitRequestCommand['identityContext']['subjectId'];
      agentId: AgentId;
      titleGenerated: boolean;
    }
  >();
  private readonly streamSubscribers = new Map<string, Set<TimelineStreamSubscriber>>();
  private readonly streamSequences = new Map<string, number>();
  private pendingInputTimeoutProcessingPromise?: Promise<void> | undefined;
  private pendingInputTimeoutTimer?: ReturnType<typeof setTimeout> | undefined;
  private pendingInputTimeoutWakeAt?: EpochMillis | undefined;
  private pendingInputTimeoutInitialized = false;
  private pendingInputTimeoutReconcileRequested = false;
  private pendingInputTimeoutRetryAttempt = 0;
  private pendingInputTimeoutProcessingStarted = false;
  private pendingInputTimeoutProcessingClosing = false;
  private lastEpochMillis = 0;

  constructor(private readonly deps: RequestLifecycleDependencies<TAgentRuntimeDependencies>) {
    this.runState = new RuntimeOwnedAgentRunStatePort({
      messageStore: deps.messageStore,
      timelineStore: deps.timelineStore,
      checkpointStore: deps.checkpointStore,
      activeContextStore: deps.activeContextStore,
      ...(deps.pendingInputStore === undefined ? {} : { pendingInputStore: deps.pendingInputStore }),
      onPendingInputCreated: (timeoutAt) => this.notifyPendingInputCreated(timeoutAt),
      clock: () => this.now(),
      idFactory: (prefix) => this.id(prefix),
      onTimelineAppend: (record) => this.publishTimelineEvent(record),
      onLiveTimelineEvent: (event) => this.publishLiveTimelineEvent(event),
      ...(deps.largeContentExternalizer === undefined ? {} : { largeContentExternalizer: deps.largeContentExternalizer }),
      ...(deps.runTimelineEventPersistencePolicy === undefined ? {} : { timelinePersistencePolicy: deps.runTimelineEventPersistencePolicy }),
      ...(deps.pendingInputMaxTimeoutMs === undefined ? {} : { pendingInputMaxTimeoutMs: deps.pendingInputMaxTimeoutMs }),
      ...(deps.askUserQuestionDefaultTimeoutMs === undefined ? {} : { askUserQuestionDefaultTimeoutMs: deps.askUserQuestionDefaultTimeoutMs }),
      shouldSuppress: (run) => {
        const executing = this.executingRuns.get(run.runId);
        return executing?.canceling === true || executing?.canceled === true || executing?.terminalized === true;
      },
    });
    this.agentManager = new AgentInstanceManager({
      agentConstructors: deps.agentConstructors,
      agentRuntimeDependencies: deps.agentRuntimeDependencies,
      runState: this.runState,
    });
    this.lifecycleHookStageExecutor = new LifecycleHookStageExecutor({
      snapshots: deps.lifecycleHookSnapshots,
      hookExecutor: deps.lifecycleHook,
      ...(deps.trustedTerminalLifecycleHook === undefined ? {} : { trustedTerminalHookExecutor: deps.trustedTerminalLifecycleHook }),
      runState: this.runState,
      pendingInputStore: deps.pendingInputStore,
      onPendingInputCreated: (timeoutAt) => this.notifyPendingInputCreated(timeoutAt),
      checkpointStore: deps.checkpointStore,
      assemblyRegistry: deps.assemblyRegistry,
      lifecycleHookDefinitions: deps.lifecycleHookDefinitions ?? [],
      clock: () => this.now(),
      idFactory: (prefix) => this.id(prefix),
      isBackgroundModelInvocation: (coordinates) => {
        const runId = coordinates.requestRunId;
        const executing = runId === undefined ? undefined : this.executingRuns.get(runId);
        return runId === undefined || executing === undefined || executing.terminalized;
      },
    });
  }

  lifecycleHookInvocationPort(): LifecycleHookInvocationPort {
    return {
      invoke: <S extends LifecycleStage>(
        request: LifecycleHookInvocationRequest<S>,
        signal?: AbortSignal,
      ): Promise<LifecycleHookInvocationResult<S>> => this.lifecycleHookStageExecutor.invoke(request, signal),
    };
  }

  async createSession(command: RuntimeCreateSessionCommand): Promise<UserSession> {
    const agentId = await this.resolveCreateSessionAgentId(command);
    const session = await this.deps.userSessions.createSession({ ...command, agentId });
    this.rememberSessionRuntimeState(session);
    return session;
  }

  async requireSession(query: RuntimeRequireSessionQuery): Promise<UserSession> {
    const agentId = this.resolveSessionAgentId(query.sessionId);
    const session = await this.deps.userSessions.requireSession({ ...query, agentId });
    this.rememberSessionRuntimeState(session);
    return session;
  }

  async listSessions(query: RuntimeListSessionsQuery): Promise<UserSessionPage> {
    return this.deps.userSessions.listSessions({ ...query, agentId: query.agentId ?? this.resolveAgentId() });
  }

  async deleteSession(command: RuntimeDeleteSessionCommand): Promise<void> {
    const agentId = this.resolveSessionAgentId(command.sessionId);
    await this.deps.userSessions.deleteSession({ ...command, agentId });
    const streamKey = this.streamKey(command.identityContext.tenantId, command.identityContext.subjectId, agentId, command.sessionId);
    this.sessionRuntimeStates.delete(command.sessionId);
    this.streamSequences.delete(streamKey);
  }

  async forkFromMessage(command: RuntimeForkSessionFromMessageCommand, signal?: AbortSignal): Promise<ForkSessionFromMessageResult> {
    this.assertForkIdempotencyKey(command.idempotencyKey);
    this.assertForkNotCanceled(signal);
    const sourceSession = await this.requireSession({ identityContext: command.identityContext, sessionId: command.sourceSessionId });
    return this.forkPreparedSession(
      command,
      {
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: sourceSession.agentId,
        sourceSessionId: command.sourceSessionId,
        sourceMessageId: command.sourceAnchorMessageId,
        idempotencyKey: command.idempotencyKey,
      },
      signal,
    );
  }

  async forkFromRequest(command: RuntimeForkSessionFromRequestCommand, signal?: AbortSignal): Promise<ForkSessionFromMessageResult> {
    this.assertForkIdempotencyKey(command.idempotencyKey);
    this.assertForkNotCanceled(signal);
    const sourceSession = await this.requireSession({ identityContext: command.identityContext, sessionId: command.sourceSessionId });
    return this.forkPreparedSession(
      command,
      {
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: sourceSession.agentId,
        sourceSessionId: command.sourceSessionId,
        sourceRequestId: command.sourceRequestId,
        idempotencyKey: command.idempotencyKey,
      },
      signal,
    );
  }

  private async forkPreparedSession(
    command: Pick<RuntimeForkSessionFromMessageCommand, 'identityContext' | 'sourceSessionId' | 'idempotencyKey'>,
    coordinates: PrepareForkRequest,
    signal?: AbortSignal,
  ): Promise<ForkSessionFromMessageResult> {
    const forkStore = this.requireForkStore();
    const prepared = await forkStore.prepareFork(coordinates, signal);
    try {
      let promotedBytes = 0;
      for (const requiredRef of prepared.requiredContentRefs) {
        this.assertForkNotCanceled(signal);
        const resolver = this.deps.forkPromotionContentResolver;
        if (resolver === undefined) {
          throw new AgentError({
            code: 'SESSION_FORK_PROMOTION_UNAVAILABLE',
            message: 'Fork promotion content resolver is unavailable.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const resolved = await resolver.resolveForkPromotionContent(
          {
            identityContext: command.identityContext,
            agentId: coordinates.agentId,
            agentVersion: requiredRef.agentVersion,
            sourceSessionId: command.sourceSessionId,
            sourceMessageId: requiredRef.sourceMessageId,
            sourceRequestId: requiredRef.sourceRequestId,
            sourceRunId: requiredRef.sourceRunId,
            refId: requiredRef.refId,
            maxBytes: this.remainingForkPromotionBytes(prepared.maxPromotedBytes, promotedBytes),
          },
          signal,
        );
        if (resolved === undefined) {
          throw new AgentError({
            code: 'SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE',
            message: 'Fork promotion source content is unavailable.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        promotedBytes += resolved.bytes.byteLength;
        if (promotedBytes > prepared.maxPromotedBytes) {
          throw new AgentError({
            code: 'SESSION_FORK_PROMOTED_CONTENT_TOO_LARGE',
            message: 'Fork promoted content exceeds the provider budget.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        await forkStore.stageForkPromotion(
          {
            tenantId: coordinates.tenantId,
            subjectId: coordinates.subjectId,
            agentId: coordinates.agentId,
            forkAttemptId: prepared.forkAttemptId,
            sourceSessionId: coordinates.sourceSessionId,
            sourceMessageId: requiredRef.sourceMessageId,
            sourceRefId: requiredRef.refId,
            refType: requiredRef.refType,
            bytes: resolved.bytes,
            mimeType: resolved.mimeType,
            sizeBytes: resolved.bytes.byteLength,
          },
          signal,
        );
      }
      this.assertForkNotCanceled(signal);
      const write = await forkStore.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId }, signal);
      if (write.replayed) {
        await this.abortForkAttempt(forkStore, coordinates, prepared.forkAttemptId);
      }
      const child = this.toUserSessionFromRecord(write.childSession);
      this.rememberSessionRuntimeState(child);
      return { childSession: child };
    } catch (error) {
      await this.abortForkAttempt(forkStore, coordinates, prepared.forkAttemptId);
      throw error;
    }
  }

  private async abortForkAttempt(
    forkStore: SessionForkStoreGateway,
    coordinates: PrepareForkRequest,
    forkAttemptId: Parameters<SessionForkStoreGateway['abortForkPromotions']>[0]['forkAttemptId'],
  ): Promise<void> {
    await forkStore
      .abortForkPromotions({
        tenantId: coordinates.tenantId,
        subjectId: coordinates.subjectId,
        agentId: coordinates.agentId,
        forkAttemptId,
      })
      .catch(() => undefined);
  }

  async listMessages(query: RuntimeListSessionMessagesQuery): Promise<SessionMessagePage> {
    return this.deps.userSessions.listMessages({ ...query, agentId: this.resolveSessionAgentId(query.sessionId) });
  }

  async resolveProcessMessages(query: RuntimeResolveProcessMessagesQuery): Promise<readonly SessionMessage[]> {
    const uniqueMessageIds = [...new Set(query.messageIds)];
    if (
      (query.messageIds.length < 1 && query.includeLegacyCandidates !== true) ||
      query.messageIds.length > maxProcessMessageReferences ||
      uniqueMessageIds.some((messageId) => typeof messageId !== 'string' || messageId.trim().length === 0)
    ) {
      throw new AgentError({
        code: 'PROCESS_MESSAGE_REFERENCES_INVALID',
        message: 'Process message references must contain between one and one thousand non-empty message identifiers.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    query.signal?.throwIfAborted();
    const session = await this.requireSession({
      identityContext: query.identityContext,
      sessionId: query.sessionId,
    });
    query.signal?.throwIfAborted();
    const requested = new Set<MessageId>(uniqueMessageIds);
    const resolved = new Map<MessageId, SessionMessage>();
    const legacyCandidates: SessionMessage[] = [];
    let offset = 0;
    while (query.includeLegacyCandidates === true || resolved.size < requested.size) {
      query.signal?.throwIfAborted();
      const page = await this.deps.userSessions.listCurrentRequestMessages({
        identityContext: query.identityContext,
        agentId: session.agentId,
        sessionId: query.sessionId,
        requestId: query.requestId,
        runId: query.runId,
        includeHidden: true,
        offset,
        limit: maxProcessMessageReferences,
      });
      query.signal?.throwIfAborted();
      for (const message of page.items) {
        if (query.includeLegacyCandidates === true) {
          legacyCandidates.push(message);
        }
        if (
          requested.has(message.messageId) &&
          message.sessionId === query.sessionId &&
          message.requestId === query.requestId &&
          message.runId === query.runId
        ) {
          resolved.set(message.messageId, message);
        }
      }
      if (query.includeLegacyCandidates === true) {
        if (page.hasMore) {
          throw new AgentError({
            code: 'PROCESS_MESSAGE_LEGACY_CANDIDATES_EXCEEDED',
            message: 'Legacy process message candidates exceed the bounded association window.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        return legacyCandidates;
      }
      if (!page.hasMore || page.items.length === 0) {
        break;
      }
      offset += page.items.length;
    }
    return uniqueMessageIds.flatMap((messageId) => {
      const message = resolved.get(messageId);
      return message === undefined ? [] : [message];
    });
  }

  async listConversationPreview(query: RuntimeConversationPreviewQuery): Promise<ConversationPreviewPage> {
    return this.deps.userSessions.listConversationPreview({ ...query, agentId: this.resolveSessionAgentId(query.sessionId) });
  }

  async updateTitle(command: RuntimeUpdateSessionTitleCommand): Promise<UserSession> {
    return this.deps.userSessions.updateTitle({ ...command, agentId: this.resolveSessionAgentId(command.sessionId) });
  }

  async *streamEvents(query: RuntimeSessionStreamEventsQuery): AsyncIterable<RunTimelineEvent> {
    const session = await this.requireSession({ identityContext: query.identityContext, sessionId: query.sessionId });
    const owner = {
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: session.agentId,
    };
    if (query.lastSeenSequence === undefined) {
      this.assertUnfilteredLiveTailQuery(query);
      yield* this.streamLiveTailOwned(
        {
          sessionId: query.sessionId,
          ...(query.signal === undefined ? {} : { signal: query.signal }),
        },
        owner,
      );
      return;
    }
    this.assertValidTimelineAnchor(query.lastSeenSequence);
    await this.assertStreamFilterVisible({
      ...owner,
      sessionId: query.sessionId,
      ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
      ...(query.runId === undefined ? {} : { runId: query.runId }),
    });
    await this.assertAnchorBelongsToSessionTimeline({
      ...owner,
      sessionId: query.sessionId,
      lastSeenSequence: query.lastSeenSequence,
    });
    yield* this.streamOwned(
      {
        sessionId: query.sessionId,
        lastSeenSequence: query.lastSeenSequence,
        ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
        ...(query.runId === undefined ? {} : { runId: query.runId }),
        ...(query.signal === undefined ? {} : { signal: query.signal }),
      },
      owner,
    );
  }

  async listEvents(query: RuntimeListSessionEventsQuery): Promise<RuntimeSessionEventHistoryPage> {
    this.assertValidEventHistoryPagination(query.afterSequence, query.limit);
    query.signal?.throwIfAborted();
    const session = await this.requireSession({ identityContext: query.identityContext, sessionId: query.sessionId });
    const scope = {
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: session.agentId,
      sessionId: query.sessionId,
    };
    const run = await this.deps.requestRunStore.loadRun({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      runId: query.runId,
    });
    let requestId: MessageId;
    let recordOrigin: 'RUNTIME' | 'FORK_SNAPSHOT';
    if (run !== undefined && run.sessionId === query.sessionId) {
      requestId = run.requestId;
      recordOrigin = 'RUNTIME';
    } else {
      const snapshotStatus = await this.deps.sessionForkStore?.loadForkProcessSnapshotStatus({
        ...scope,
        runId: query.runId,
      });
      if (snapshotStatus?.status === 'LEGACY_UNAVAILABLE') {
        return { availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [] };
      }
      if (snapshotStatus?.status === 'AVAILABLE') {
        requestId = snapshotStatus.requestId;
        recordOrigin = 'FORK_SNAPSHOT';
      } else {
        const membership = await this.deps.messageStore.listMessages({
          ...scope,
          runId: query.runId,
          includeHidden: true,
          includeCapabilityResults: true,
          limit: 1,
        });
        if (membership.items.length > 0 && this.deps.sessionForkStore !== undefined) {
          const forkSource = await this.deps.sessionForkStore.loadSessionForkSource({
            tenantId: scope.tenantId,
            subjectId: scope.subjectId,
            agentId: scope.agentId,
            childSessionId: query.sessionId,
          });
          if (forkSource !== undefined) {
            return { availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [] };
          }
        }
        throw this.eventHistoryNotFoundError();
      }
    }
    query.signal?.throwIfAborted();
    const records = await this.deps.timelineStore.listEvents({
      ...scope,
      requestId,
      runId: query.runId,
      recordOrigin,
      afterSequence: query.afterSequence,
      limit: query.limit,
    });
    query.signal?.throwIfAborted();
    let previousSequence = query.afterSequence;
    const events = records.map((record) => {
      this.assertValidHistoryEventRecord(record, { ...scope, requestId, runId: query.runId, recordOrigin }, previousSequence);
      previousSequence = record.sequence;
      return this.toRuntimeSafeHistoryEvent(record);
    });
    const last = records.at(-1);
    let nextAfterSequence: TimelineSequence | undefined;
    if (records.length === query.limit && last !== undefined) {
      const next = await this.deps.timelineStore.listEvents({
        ...scope,
        requestId,
        runId: query.runId,
        recordOrigin,
        afterSequence: last.sequence,
        limit: 1,
      });
      const nextRecord = next[0];
      if (nextRecord !== undefined) {
        this.assertValidHistoryEventRecord(nextRecord, { ...scope, requestId, runId: query.runId, recordOrigin }, last.sequence);
        nextAfterSequence = last.sequence;
      }
    }
    return {
      availability: 'AVAILABLE',
      events,
      ...(nextAfterSequence === undefined ? {} : { nextAfterSequence }),
    };
  }

  async getActiveRun(query: RuntimeGetActiveRunQuery): Promise<RuntimeActiveRunSummary | undefined> {
    const session = await this.requireSession({ identityContext: query.identityContext, sessionId: query.sessionId });
    const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: session.agentId,
      sessionId: query.sessionId,
    });
    const latestRun = snapshot.latestRun;
    if (latestRun === undefined || this.isTerminalRunStatus(latestRun.status) || this.isTerminalCommitInProgress(latestRun)) {
      return undefined;
    }
    return { requestId: latestRun.requestId, runId: latestRun.runId, status: latestRun.status };
  }

  private isTerminalCommitInProgress(run: RequestRunRecord): boolean {
    return run.terminalCommitState === 'PENDING' || run.terminalCommitState === 'RETRYING';
  }

  async getRequestSummary(query: RuntimeGetRequestSummaryQuery): Promise<RuntimeRequestSummary | undefined> {
    const session = await this.requireSession({ identityContext: query.identityContext, sessionId: query.sessionId });
    const owner = {
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: session.agentId,
    };
    const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
      tenantId: owner.tenantId,
      subjectId: owner.subjectId,
      agentId: owner.agentId,
      sessionId: query.sessionId,
    });
    const run = this.findRunByRequestId(snapshot, query.requestId);
    if (run === undefined) {
      return undefined;
    }
    let activePendingInput: PendingInputRequest | undefined;
    if (!this.isTerminalRunStatus(run.status)) {
      const pending = await this.deps.pendingInputStore?.loadActivePendingInput({
        tenantId: owner.tenantId,
        subjectId: owner.subjectId,
        agentId: owner.agentId,
        sessionId: query.sessionId,
      });
      if (pending !== undefined && pending.requestRunId === run.runId && pending.status === 'PENDING') {
        activePendingInput = {
          id: pending.pendingInputId,
          sessionId: pending.sessionId,
          kind: pending.kind,
          questions: pending.request.questions,
          ...(pending.request.timeoutAt === undefined ? {} : { timeoutAt: pending.request.timeoutAt }),
        };
      }
    }
    const terminalResult = await this.extractTerminalResult(owner, run);
    return {
      sessionId: query.sessionId,
      requestId: run.requestId,
      status: run.status,
      updatedAt: run.updatedAt,
      ...(activePendingInput === undefined ? {} : { activePendingInput }),
      ...(terminalResult === undefined ? {} : { terminalResult }),
    };
  }

  private async extractTerminalResult(owner: SessionTimelineOwner, run: RequestRunRecord): Promise<RuntimeTerminalResult | undefined> {
    if (!this.isTerminalRunStatus(run.status)) {
      return undefined;
    }
    const events = await this.deps.timelineStore.listEvents({
      tenantId: owner.tenantId,
      subjectId: owner.subjectId,
      agentId: owner.agentId,
      sessionId: run.sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: maxReplayBatchEvents,
      runId: run.runId,
    });
    const terminalEvent = events
      .filter(
        (event) =>
          event.type === 'REQUEST_COMPLETED' ||
          event.type === 'REQUEST_FAILED' ||
          event.type === 'REQUEST_CANCELED' ||
          event.type === 'REQUEST_SUPERSEDED',
      )
      .sort((a, b) => Number(b.sequence) - Number(a.sequence))[0];
    if (terminalEvent === undefined) {
      return undefined;
    }
    const terminalMessageId = nonEmptyString(terminalEvent.inlinePayload.terminalMessageId);
    if (terminalMessageId === undefined) {
      return undefined;
    }
    const terminalMessage = await this.deps.messageStore.loadMessage({
      tenantId: owner.tenantId,
      subjectId: owner.subjectId,
      agentId: owner.agentId,
      messageId: brand<string, 'MessageId'>(terminalMessageId),
    });
    if (!isMatchingTerminalMessage(terminalMessage, owner, run, terminalEvent)) {
      return undefined;
    }
    return extractTerminalPayload(terminalEvent.inlinePayload, terminalMessage.content, terminalMessage.contentType);
  }

  private findRunByRequestId(snapshot: SessionLaneSnapshot, requestId: MessageId): RequestRunRecord | undefined {
    if (snapshot.latestRun?.requestId === requestId) {
      return snapshot.latestRun;
    }
    if (snapshot.executingRun?.requestId === requestId) {
      return snapshot.executingRun;
    }
    if (snapshot.terminalPendingRun?.requestId === requestId) {
      return snapshot.terminalPendingRun;
    }
    const queued = snapshot.queuedRuns.find((run) => run.requestId === requestId);
    if (queued !== undefined) {
      return queued;
    }
    return undefined;
  }

  async waitForIdle(options: RuntimeIdleWaitOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    while (!this.isIdle()) {
      if (Date.now() >= deadline) {
        throw new AgentError({
          code: 'RUNTIME_IDLE_TIMEOUT',
          message: 'Runtime did not become idle before shutdown.',
          category: 'TIMEOUT',
          retryable: true,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async reserveSubmit(command: ReserveSubmitCommand): Promise<ReserveSubmitAccepted> {
    if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'RESERVE_SUBMIT_IDEMPOTENCY_REQUIRED',
        message: 'Reserve submit requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'RESERVE_SUBMIT_IDEMPOTENCY_REQUIRED' },
      });
    }
    if (this.deps.attachmentReservations === undefined) {
      throw new AgentError({
        code: 'RESERVE_SUBMIT_UNAVAILABLE',
        message: 'Reserve submit persistence is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reasonCode: 'ATTACHMENT_DEPENDENCY_UNAVAILABLE' },
      });
    }
    const session = await this.requireSession({ identityContext: command.identityContext, sessionId: command.sessionId });
    const createdAt = this.now();
    const result = await this.deps.attachmentReservations.reserveAttachmentIntake({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: session.agentId,
      sessionId: command.sessionId,
      idempotencyKey: command.idempotencyKey,
      action: command.action,
      commandSemanticHash: this.reserveSubmitCommandSemanticHash(command, session.agentId),
      create: {
        reservationId: brand<string, 'AttachmentIntakeReservationId'>(this.id('attachment-reservation')),
        requestId: brand<string, 'MessageId'>(this.id('request')),
        runId: brand<string, 'RequestRunId'>(this.id('run')),
        requestContextId: brand<string, 'RequestContextId'>(this.id('context')),
        createdAt,
      },
    });
    if (result.status === 'SEMANTIC_CONFLICT' || result.record === undefined) {
      throw new AgentError({
        code: 'RESERVE_SUBMIT_IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key was reused with different request semantics.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'DUPLICATE_IDEMPOTENCY_KEY_CONFLICT' },
      });
    }
    return {
      sessionId: command.sessionId,
      agentId: session.agentId,
      reservationId: result.record.reservationId,
      requestId: result.record.requestId,
      runId: result.record.runId,
      requestContextId: result.record.requestContextId,
      replay: result.status === 'REPLAY',
      ...(result.record.status === 'RESERVED'
        ? {}
        : {
            intakeOutcome: {
              status: result.record.status,
              attachmentIds: result.record.attachmentIds,
              ...(result.record.rejectionReasonCode === undefined ? {} : { rejectionReasonCode: result.record.rejectionReasonCode }),
              ...(result.record.safeError === undefined ? {} : { safeError: result.record.safeError }),
            },
          }),
    };
  }

  getExecutionCorrelation(): ExecutionCorrelationPort | undefined {
    return this.deps.executionCorrelation;
  }

  async submit(command: SubmitRequestCommand): Promise<RequestAccepted> {
    if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'SUBMIT_IDEMPOTENCY_REQUIRED',
        message: 'Submit requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED' },
      });
    }
    const createdSessionInternally = command.sessionId === undefined;
    let orphanSession: UserSession | undefined;
    const session =
      command.sessionId === undefined
        ? await this.createSubmitSession(command)
        : await this.requireSession({ identityContext: command.identityContext, sessionId: command.sessionId });
    if (command.sessionId !== undefined && command.agentId !== undefined && command.agentId !== session.agentId) {
      throw new AgentError({
        code: 'SUBMIT_AGENT_SCOPE_MISMATCH',
        message: 'Submit command agentId must match the existing session agentId.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SESSION_BOUND_AGENT_SCOPE_VIOLATION' },
      });
    }
    if (createdSessionInternally) {
      orphanSession = session;
    }
    let orphanSessionLogged = false;
    const logOrphanSession = (error: unknown): void => {
      if (!createdSessionInternally || orphanSession === undefined || orphanSessionLogged) {
        return;
      }
      orphanSessionLogged = true;
      logger.warn({
        event: 'runtime.submit.orphan_session',
        agentId: orphanSession.agentId,
        sessionId: orphanSession.sessionId,
        ...(command.parentRunId === undefined ? {} : { parentRunId: command.parentRunId }),
        failureReason: this.toSubmitFailureReason(error),
      });
    };
    try {
      const priority = command.priority ?? 'NORMAL';
      const effectiveRoutingConstraints = this.effectiveRoutingConstraints(command.routingConstraints, command.parentRunId);
      const acceptedInput = this.projectAcceptedInput(command.inputText, effectiveRoutingConstraints);
      const acceptedCommand: SubmitRequestCommand = {
        ...command,
        inputText: acceptedInput.inputText,
        sessionId: session.sessionId,
        agentId: session.agentId,
        ...(command.agentVersion === undefined ? {} : { agentVersion: command.agentVersion }),
        priority,
        ...(acceptedInput.routingConstraints === undefined ? {} : { routingConstraints: acceptedInput.routingConstraints }),
      };
      const laneKey = this.laneKey(command.identityContext.tenantId, command.identityContext.subjectId, session.agentId, session.sessionId);
      await this.assertNoActivePendingInput(command.identityContext, session.agentId, session.sessionId);
      this.assertSchedulerCapacity(laneKey);
      const sessionId = session.sessionId;
      const now = this.now();
      const requestId = command.reservedRequest?.requestId ?? brand<string, 'MessageId'>(this.id('request'));
      const runId = command.reservedRequest?.runId ?? brand<string, 'RequestRunId'>(this.id('run'));
      const requestContextId = command.reservedRequest?.requestContextId ?? brand<string, 'RequestContextId'>(this.id('context'));
      const attachmentIds = await this.revalidateAttachmentAuthorities({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: session.agentId,
        source: { sessionId, requestId, runId },
        attachmentIds: command.attachmentIds,
        rejectionCode: 'REQUEST_SUBMIT_ATTACHMENT_UNAVAILABLE',
      });
      const finalCommand: SubmitRequestCommand = { ...acceptedCommand, attachmentIds };
      const existingSubmitRun = await this.loadRunByIdempotencyAnchor(
        {
          identityContext: acceptedCommand.identityContext,
          sessionId,
          idempotencyKey: acceptedCommand.idempotencyKey,
        },
        session.agentId,
        'ACCEPTANCE',
        this.submitIdempotencySemantic(acceptedCommand, session.agentId),
        'REQUEST_SUBMIT_IDEMPOTENCY_CONFLICT',
      );
      if (existingSubmitRun !== undefined) {
        return this.toRequestAccepted(existingSubmitRun);
      }
      const assembly =
        acceptedCommand.agentVersion === undefined
          ? await this.deps.assemblyRegistry.active(session.agentId)
          : await this.deps.assemblyRegistry.require(session.agentId, acceptedCommand.agentVersion);
      const run: RequestRun = {
        runId,
        sessionId,
        requestId,
        agentId: assembly.agentId,
        agentVersion: assembly.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        attempt: 1,
        ...(acceptedCommand.parentRunId === undefined ? {} : { parentRunId: acceptedCommand.parentRunId }),
        ...(acceptedCommand.parentRequestId === undefined ? {} : { parentRequestId: acceptedCommand.parentRequestId }),
        priority,
        status: 'QUEUED',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: now,
        updatedAt: now,
      };
      const context: RequestContext = {
        requestContextId,
        sessionId,
        requestId,
        runId,
        identityContext: acceptedCommand.identityContext,
        locale: acceptedCommand.locale,
        acceptedInputText: acceptedCommand.inputText,
        ...(acceptedCommand.routingConstraints === undefined ? {} : { routingConstraints: acceptedCommand.routingConstraints }),
        ...(acceptedCommand.requestModelOptions === undefined ? {} : { requestModelOptions: acceptedCommand.requestModelOptions }),
        ...(acceptedCommand.propagationAttributes === undefined ? {} : { propagationAttributes: acceptedCommand.propagationAttributes }),
        agentId: assembly.agentId,
        agentVersion: assembly.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        agentTurnIndex: 0,
        activeStepId: 'turn-1',
        nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
        toolCallStates: [],
        flowVariables: {
          input_question: acceptedCommand.inputText,
          ...(acceptedCommand.inputVariables === undefined ? {} : { input_variables: acceptedCommand.inputVariables }),
        },
      };
      await this.lifecycleHookStageExecutor.invokeStage(
        this.hookScope(run, context, 'BEFORE_REQUEST_ACCEPT', `accept:${command.idempotencyKey}`),
        'BEFORE_REQUEST_ACCEPT',
        {
          stage: 'BEFORE_REQUEST_ACCEPT',
          locale: command.locale,
          attachmentCount: command.attachmentIds.length,
          idempotencyKeyPresent: command.idempotencyKey.trim().length > 0,
          safeRequestClass:
            acceptedCommand.inputText.trim().length === 0 ? 'EMPTY' : command.attachmentIds.length === 0 ? 'TEXT_ONLY' : 'TEXT_WITH_ATTACHMENTS',
        },
      );
      await this.persistUserMessage(finalCommand, run);
      const savedRun = await this.deps.requestRunStore.saveRun(toRunRecord(run, finalCommand), {
        idempotencyKey: command.idempotencyKey,
        idempotencySemantic: this.submitIdempotencySemantic(finalCommand, assembly.agentId),
      });
      if (savedRun.status === 'VERSION_CONFLICT') {
        throw new AgentError({
          code: 'DUPLICATE_IDEMPOTENCY_KEY_CONFLICT',
          message: 'Idempotency key was reused with different submit semantics.',
          category: 'CONFLICT',
          retryable: false,
          safeDetails: { reasonCode: 'DUPLICATE_IDEMPOTENCY_KEY_CONFLICT' },
        });
      }
      if (savedRun.status !== 'UPDATED' || savedRun.record === undefined) {
        throw new AgentError({ code: 'RUN_ACCEPT_CONFLICT', message: 'Run acceptance conflict.', category: 'CONFLICT', retryable: true });
      }
      if (savedRun.record.runId !== run.runId) {
        return {
          sessionId: savedRun.record.sessionId,
          requestId: savedRun.record.requestId,
          runId: savedRun.record.runId,
          attempt: savedRun.record.attempt,
        };
      }
      orphanSession = undefined;
      await this.saveCheckpoint(finalCommand, run, context, 'RUN_ACCEPTED');
      await this.emitCanonical(
        finalCommand,
        context,
        { type: 'REQUEST_ACCEPTED', inlinePayload: { attempt: 1, agentId: assembly.agentId, agentVersion: assembly.agentVersion, status: 'QUEUED' } },
        command.idempotencyKey,
      );
      // Input-guard-blocked round: the guard service refused the input before
      // this submit. Create the run + persist the user input (done above), then
      // immediately commit a COMPLETED terminal whose assistant content is the
      // refusal message — visible=true (page renders it) but
      // metadata.modelVisibility.excluded=true (context assembly keeps it out
      // of model context). The model loop MUST NOT run: skip enqueueWork.
      // COMPLETED (not FAILED): to the frontend this is a normal turn (asked →
      // answered "refused"), so it renders the refusal as an assistant reply
      // and does not surface a failure. retry/edit/title all go through the
      // normal run lifecycle because the run is in requestRunStore with
      // status=COMPLETED, terminalCommitState=COMMITTED.
      if (command.guardBlockRefusal !== undefined) {
        await this.commitTerminal(finalCommand, run, context, command.guardBlockRefusal, 'COMPLETED', {
          guardBlockedVisible: { refusalMessage: command.guardBlockRefusal },
        });
        this.startSessionTitleGeneration(finalCommand, run);
        return { sessionId, requestId, runId, attempt: 1 };
      }
      this.startSessionTitleGeneration(finalCommand, run);
      await this.replaceOlderLaneWork(finalCommand, run, context);
      this.enqueueWork({ command: finalCommand, run, context, laneKey });
      return { sessionId, requestId, runId, attempt: 1 };
    } catch (error) {
      logOrphanSession(error);
      if (error instanceof LifecycleHookInterruptionError) {
        throw agentErrorFromLifecycleHookInterruption(error.interruption);
      }
      throw error;
    }
  }

  async *stream(request: RuntimeEventStreamQuery): AsyncIterable<RunTimelineEvent> {
    const owner = this.sessionRuntimeStates.get(request.sessionId);
    if (owner === undefined) {
      throw new AgentError({
        code: 'OWNER_SCOPE_UNAVAILABLE',
        message: 'Owner scope is unavailable for timeline stream.',
        category: 'AUTHORIZATION',
        retryable: false,
      });
    }
    const hasFilters = request.requestId !== undefined || request.runId !== undefined;
    if (Number(request.lastSeenSequence) === 0 && !hasFilters) {
      yield* this.streamLiveTailOwned(
        {
          sessionId: request.sessionId,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
        owner,
      );
      return;
    }
    this.assertValidTimelineAnchor(request.lastSeenSequence);
    await this.assertStreamFilterVisible({
      ...owner,
      sessionId: request.sessionId,
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.runId === undefined ? {} : { runId: request.runId }),
    });
    await this.assertAnchorBelongsToSessionTimeline({
      ...owner,
      sessionId: request.sessionId,
      lastSeenSequence: request.lastSeenSequence,
    });
    yield* this.streamOwned(request, owner);
  }

  private async createSubmitSession(command: SubmitRequestCommand): Promise<UserSession> {
    if (command.agentId === undefined) {
      throw new AgentError({
        code: 'SUBMIT_AGENT_ID_REQUIRED',
        message: 'Submit requires agentId when sessionId is absent.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SUBMIT_AGENT_ID_REQUIRED' },
      });
    }
    const session = await this.deps.userSessions.createSession({
      identityContext: command.identityContext,
      agentId: command.agentId,
      locale: command.locale,
      idempotencyKey: brand<string, 'IdempotencyKey'>(`${command.idempotencyKey}:session`),
      ...(command.parentSessionId === undefined ? {} : { parentSessionId: command.parentSessionId }),
      ...(command.parentRunId === undefined ? {} : { parentRunId: command.parentRunId }),
      ...(command.parentRequestId === undefined ? {} : { parentRequestId: command.parentRequestId }),
    });
    this.rememberSessionRuntimeState(session);
    return session;
  }

  private effectiveRoutingConstraints(
    constraints: SubmitRequestCommand['routingConstraints'],
    parentRunId: SubmitRequestCommand['parentRunId'],
  ): SubmitRequestCommand['routingConstraints'] {
    if (parentRunId === undefined) {
      return constraints;
    }
    const forbidden = new Set<string>(['Agent', 'AskUserQuestion', ...(constraints?.forbiddenCapabilityIds ?? [])]);
    return {
      ...(constraints ?? {}),
      forbiddenCapabilityIds: [...forbidden],
      allowSubagents: false,
    };
  }

  private async *streamOwned(request: RuntimeEventStreamQuery, owner: SessionTimelineOwner): AsyncIterable<RunTimelineEvent> {
    let lastSeenSequence = Number(request.lastSeenSequence);
    const streamKey = this.streamKey(owner.tenantId, owner.subjectId, owner.agentId, request.sessionId);
    const closeOnTerminal = request.requestId !== undefined || request.runId !== undefined;
    const requiresSessionContinuity = request.requestId === undefined && request.runId === undefined;
    let expectedSequence = lastSeenSequence + 1;
    let afterSequence = request.lastSeenSequence;
    let replayedCount = 0;
    const replayStartTime = Date.now();
    let replayPendingInputActive = false;
    while (true) {
      const records = await this.readTimelineEventsWithTimeout({
        tenantId: owner.tenantId,
        subjectId: owner.subjectId,
        agentId: owner.agentId,
        sessionId: request.sessionId,
        afterSequence,
        limit: maxReplayBatchEvents,
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        ...(request.runId === undefined ? {} : { runId: request.runId }),
      });
      if (request.signal?.aborted) {
        return;
      }
      for (const record of records) {
        const sequence = Number(record.sequence);
        if (requiresSessionContinuity && sequence !== expectedSequence) {
          const resumeAfterSequence = await this.readSessionHighWaterSequence({ ...owner, sessionId: request.sessionId });
          throw this.streamResumeGapError(resumeAfterSequence);
        }
        lastSeenSequence = Math.max(lastSeenSequence, sequence);
        if (requiresSessionContinuity) {
          expectedSequence = sequence + 1;
        }
        yield this.toRuntimeTimelineEvent(record);
        if (closeOnTerminal && this.isTerminalTimelineEvent(record)) {
          return;
        }
        if (record.type === 'USER_INPUT_REQUIRED') {
          replayPendingInputActive = true;
        } else if (record.type === 'USER_INPUT_RECEIVED' || record.type === 'USER_INPUT_TIMEOUT' || record.type === 'USER_INPUT_CANCELED') {
          replayPendingInputActive = false;
        }
      }
      replayedCount += records.length;
      if (replayedCount > maxReplayTotalEvents) {
        throw new AgentError({
          code: 'STREAM_REPLAY_LIMIT_EXCEEDED',
          message: 'Timeline replay exceeded the maximum allowed event count.',
          category: 'UNAVAILABLE',
          retryable: true,
          safeDetails: { reasonCode: 'REPLAY_TOTAL_EVENTS_EXCEEDED' },
        });
      }
      if (Date.now() - replayStartTime > maxReplayDurationMs) {
        throw new AgentError({
          code: 'STREAM_REPLAY_LIMIT_EXCEEDED',
          message: 'Timeline replay exceeded the maximum allowed duration.',
          category: 'UNAVAILABLE',
          retryable: true,
          safeDetails: { reasonCode: 'REPLAY_DURATION_EXCEEDED' },
        });
      }
      if (records.length < maxReplayBatchEvents) {
        break;
      }
      afterSequence = records[records.length - 1]!.sequence;
    }
    this.rememberStreamSequence(streamKey, lastSeenSequence);
    const subscriber: TimelineStreamSubscriber = {
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.runId === undefined ? {} : { runId: request.runId }),
      lastSeenSequence,
      pendingInputActive: replayPendingInputActive,
      queue: [],
    };
    this.addStreamSubscriber(streamKey, subscriber);
    let crossPodIdlePolls = 0;
    try {
      while (!request.signal?.aborted) {
        const event = await this.nextSubscriberEvent(subscriber, request.signal, crossPodPollIntervalMs);
        if (event !== undefined) {
          crossPodIdlePolls = 0;
          if (event.persistence !== 'LIVE_ONLY' && event.sequence !== undefined) {
            subscriber.lastSeenSequence = Math.max(subscriber.lastSeenSequence, Number(event.sequence));
          }
          yield event;
          if (closeOnTerminal && this.isTerminalTimelineEvent(event)) {
            return;
          }
          continue;
        }
        const crossPodResult = await this.pollCrossPodEvents(
          subscriber,
          owner,
          request.sessionId,
          streamKey,
          {
            ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
            ...(request.runId === undefined ? {} : { runId: request.runId }),
            closeOnTerminal,
          },
          request.signal,
        );
        for (const crossPodEvent of crossPodResult.events) {
          yield crossPodEvent;
        }
        if (crossPodResult.status === 'terminal') {
          return;
        }
        if (crossPodResult.status === 'events') {
          crossPodIdlePolls = 0;
        } else if (!subscriber.pendingInputActive) {
          crossPodIdlePolls += 1;
          if (crossPodIdlePolls >= crossPodMaxIdlePolls) {
            return;
          }
        }
      }
    } finally {
      this.removeStreamSubscriber(streamKey, subscriber);
    }
  }

  private async *streamLiveTailOwned(request: RuntimeLiveTailStreamQuery, owner: SessionTimelineOwner): AsyncIterable<RunTimelineEvent> {
    const streamKey = this.streamKey(owner.tenantId, owner.subjectId, owner.agentId, request.sessionId);
    const subscriber: TimelineStreamSubscriber = {
      lastSeenSequence: 0,
      pendingInputActive: false,
      queue: [],
    };
    this.addStreamSubscriber(streamKey, subscriber);
    let crossPodIdlePolls = 0;
    try {
      while (!request.signal?.aborted) {
        const event = await this.nextSubscriberEvent(subscriber, request.signal, crossPodPollIntervalMs);
        if (event !== undefined) {
          crossPodIdlePolls = 0;
          if (event.persistence !== 'LIVE_ONLY' && event.sequence !== undefined) {
            subscriber.lastSeenSequence = Math.max(subscriber.lastSeenSequence, Number(event.sequence));
          }
          yield event;
          continue;
        }
        const crossPodResult = await this.pollCrossPodEvents(subscriber, owner, request.sessionId, streamKey, {}, request.signal);
        for (const crossPodEvent of crossPodResult.events) {
          yield crossPodEvent;
        }
        if (crossPodResult.status === 'terminal') {
          return;
        }
        if (crossPodResult.status === 'events') {
          crossPodIdlePolls = 0;
        } else if (!subscriber.pendingInputActive) {
          crossPodIdlePolls += 1;
          if (crossPodIdlePolls >= crossPodMaxIdlePolls) {
            return;
          }
        }
      }
    } finally {
      this.removeStreamSubscriber(streamKey, subscriber);
    }
  }
  private async pollCrossPodEvents(
    subscriber: TimelineStreamSubscriber,
    owner: SessionTimelineOwner,
    sessionId: SessionId,
    streamKey: string,
    filters: { requestId?: MessageId; runId?: RequestRunId; closeOnTerminal?: boolean },
    signal?: AbortSignal,
  ): Promise<{ status: 'idle' | 'events' | 'terminal'; events: RunTimelineEvent[] }> {
    let dbEvents: readonly RunTimelineEventRecord[];
    try {
      dbEvents = await this.readTimelineEventsWithTimeout({
        tenantId: owner.tenantId,
        subjectId: owner.subjectId,
        agentId: owner.agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(subscriber.lastSeenSequence),
        limit: maxReplayBatchEvents,
        ...(filters.requestId === undefined ? {} : { requestId: filters.requestId }),
        ...(filters.runId === undefined ? {} : { runId: filters.runId }),
      });
    } catch {
      // DB poll timeout/failure degrades to idle; do not break the SSE stream.
      return { status: 'idle', events: [] };
    }
    if (signal?.aborted) {
      return { status: 'idle', events: [] };
    }
    if (dbEvents.length === 0) {
      return { status: 'idle', events: [] };
    }
    const events: RunTimelineEvent[] = [];
    for (const record of dbEvents) {
      const sequence = Number(record.sequence);
      if (sequence <= subscriber.lastSeenSequence) {
        continue;
      }
      subscriber.lastSeenSequence = sequence;
      if (record.type === 'USER_INPUT_REQUIRED') {
        subscriber.pendingInputActive = true;
      } else if (record.type === 'USER_INPUT_RECEIVED' || record.type === 'USER_INPUT_TIMEOUT' || record.type === 'USER_INPUT_CANCELED') {
        subscriber.pendingInputActive = false;
      }
      events.push(this.toRuntimeTimelineEvent(record));
      if (filters.closeOnTerminal && this.isTerminalTimelineEvent(record)) {
        this.rememberStreamSequence(streamKey, subscriber.lastSeenSequence);
        return { status: 'terminal', events };
      }
    }
    this.rememberStreamSequence(streamKey, subscriber.lastSeenSequence);
    return { status: 'events', events };
  }

  async cancel(command: RequestControlCommand): Promise<RequestControlAccepted> {
    if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'REQUEST_CANCEL_IDEMPOTENCY_REQUIRED',
        message: 'Cancel requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (command.action !== 'CANCEL') {
      throw new AgentError({ code: 'REQUEST_CANCEL_NOT_FOUND', message: 'Cancel target was not found.', category: 'NOT_FOUND', retryable: false });
    }
    const session = await this.requireSession({ identityContext: command.identityContext, sessionId: command.sessionId });
    const semantic = this.cancelCommandSemantic(command, session.agentId);
    const existingCancelRun = await this.loadRunByIdempotencyAnchor(
      command,
      session.agentId,
      'TERMINAL_COMMIT',
      semantic,
      'REQUEST_CANCEL_IDEMPOTENCY_CONFLICT',
    );
    if (existingCancelRun !== undefined) {
      return this.toCancelAccepted(command, existingCancelRun);
    }
    const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: session.agentId,
      sessionId: command.sessionId,
    });
    const target = snapshot.latestRun;
    if (target === undefined || snapshot.latestRequestId === undefined) {
      throw new AgentError({ code: 'REQUEST_CANCEL_NOT_FOUND', message: 'Cancel target was not found.', category: 'NOT_FOUND', retryable: false });
    }
    if (snapshot.latestRequestId !== command.expectedLatestRequestId) {
      throw new AgentError({
        code: 'REQUEST_CANCEL_NOT_LATEST',
        message: 'Cancel request is not the latest request.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'STALE_LATEST_REQUEST' },
      });
    }
    if (target.terminalCommitState === 'PENDING' || target.terminalCommitState === 'RETRYING') {
      throw new AgentError({
        code: 'REQUEST_CANCEL_TERMINAL_PENDING',
        message: 'Cancel target already has a pending terminal commit.',
        category: 'CONFLICT',
        retryable: true,
        safeDetails: { reasonCode: 'LANE_TERMINAL_COMMIT_PENDING' },
      });
    }
    if (this.isTerminalRunStatus(target.status)) {
      throw new AgentError({
        code: 'REQUEST_CANCEL_ALREADY_TERMINAL',
        message: 'Cancel target is already terminal.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'RUN_NOT_REPLACEABLE' },
      });
    }

    const run = this.toRuntimeRun(target);
    const laneKey = this.laneKey(command.identityContext.tenantId, command.identityContext.subjectId, run.agentId, run.sessionId);
    const executing = this.executingRuns.get(run.runId);
    let preloadedPending: PendingInputRecord | undefined;
    if (executing !== undefined) {
      executing.canceling = true;
      executing.cancelIdempotencyKey = command.idempotencyKey;
      executing.cancelIdempotencySemantic = semantic;
      executing.controller.abort();
    } else {
      const queuedWork = this.pendingLaneWork.get(laneKey)?.find((work) => work.run.runId === run.runId);
      this.removePendingWork(laneKey, run.runId);
      preloadedPending = await this.deps.pendingInputStore?.loadActivePendingInput({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: run.agentId,
        sessionId: run.sessionId,
      });
      const originalRequestContextId =
        queuedWork?.context.requestContextId ?? (preloadedPending?.requestRunId === run.runId ? preloadedPending.requestContextId : undefined);
      await this.commitCanceledRun(command, run, semantic, originalRequestContextId);
    }
    await this.cancelActivePendingForRun(command, run, preloadedPending);
    if (executing !== undefined) {
      executing.canceled = true;
    }
    const outcome: RequestControlAccepted = {
      sessionId: command.sessionId,
      targetRequestId: run.requestId,
      action: 'CANCEL',
      idempotencyKey: command.idempotencyKey,
    };
    this.wakeScheduler();
    return outcome;
  }

  async retryLatest(command: RequestControlCommand): Promise<RequestAccepted> {
    if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'REQUEST_RETRY_IDEMPOTENCY_REQUIRED',
        message: 'Retry requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (command.action !== 'RETRY_LATEST') {
      throw new AgentError({ code: 'REQUEST_RETRY_NOT_FOUND', message: 'Retry target was not found.', category: 'NOT_FOUND', retryable: false });
    }
    const session = await this.requireSession({ identityContext: command.identityContext, sessionId: command.sessionId });
    const semantic = this.retryCommandSemantic(command, session.agentId);
    const existingRetryRun = await this.loadRunByIdempotencyAnchor(
      command,
      session.agentId,
      'ACCEPTANCE',
      semantic,
      'REQUEST_RETRY_IDEMPOTENCY_CONFLICT',
    );
    if (existingRetryRun !== undefined) {
      const inheritedAttempt = existingRetryRun.attempt === 1 && existingRetryRun.retryOfRunId === undefined;
      const ordinaryRetry = existingRetryRun.attempt > 1 && existingRetryRun.retryOfRunId !== undefined;
      if ((!inheritedAttempt && !ordinaryRetry) || existingRetryRun.requestId !== command.expectedLatestRequestId) {
        throw new AgentError({
          code: 'REQUEST_RETRY_IDEMPOTENCY_CONFLICT',
          message: 'Retry idempotency key was reused with different semantics.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      if (await this.isRetryQueueUnavailableRun(command, existingRetryRun)) {
        throw new AgentError({
          code: 'REQUEST_RETRY_QUEUE_UNAVAILABLE',
          message: 'Retry run could not be scheduled.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      await this.completeRetryVisibilityForRetryRecord(existingRetryRun);
      return this.toRequestAccepted(existingRetryRun);
    }
    const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: session.agentId,
      sessionId: command.sessionId,
    });
    const source = snapshot.latestRun;
    let inheritedSource: InheritedLatestSource | undefined;
    if (source === undefined || snapshot.latestRequestId === undefined) {
      inheritedSource = await this.resolveInheritedLatestSource(command, session.agentId, snapshot);
      if (inheritedSource === undefined) {
        throw new AgentError({ code: 'REQUEST_RETRY_NOT_FOUND', message: 'Retry target was not found.', category: 'NOT_FOUND', retryable: false });
      }
    } else if (snapshot.latestRequestId !== command.expectedLatestRequestId) {
      throw new AgentError({
        code: 'REQUEST_RETRY_NOT_LATEST',
        message: 'Retry request is not the latest request.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'STALE_LATEST_REQUEST' },
      });
    }
    if (source !== undefined && (source.terminalCommitState === 'PENDING' || source.terminalCommitState === 'RETRYING')) {
      throw new AgentError({
        code: 'REQUEST_RETRY_TERMINAL_PENDING',
        message: 'Retry target has a pending terminal commit.',
        category: 'CONFLICT',
        retryable: true,
        safeDetails: { reasonCode: 'LANE_TERMINAL_COMMIT_PENDING' },
      });
    }
    if (source !== undefined && (!this.isTerminalRunStatus(source.status) || source.terminalCommitState !== 'COMMITTED')) {
      throw new AgentError({
        code: 'REQUEST_RETRY_NOT_TERMINAL',
        message: 'Retry target is not terminal.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'RUN_NOT_REPLACEABLE' },
      });
    }
    if (source !== undefined && source.attempt >= 1 + maxRetryAttemptsPerRequest) {
      throw new AgentError({
        code: 'REQUEST_RETRY_LIMIT_EXCEEDED',
        message: 'Retry attempt limit was reached for this request.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'REQUEST_RETRY_LIMIT_EXCEEDED' },
      });
    }

    const rootMessageFacts = inheritedSource ?? (await this.loadRetryRootMessageFacts(command, source!));
    const retryRequestId = inheritedSource?.requestId ?? source!.requestId;
    if (inheritedSource !== undefined && rootMessageFacts.attachmentIds.length > 0 && inheritedSource.copiedRunAnchor === undefined) {
      throw new AgentError({
        code: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE',
        message: 'Retry source attachments are unavailable.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    const attachmentIds =
      rootMessageFacts.attachmentIds.length === 0
        ? []
        : await this.revalidateAttachmentAuthorities({
            tenantId: command.identityContext.tenantId,
            subjectId: command.identityContext.subjectId,
            agentId: session.agentId,
            source: {
              sessionId: command.sessionId,
              requestId: retryRequestId,
              runId: inheritedSource?.copiedRunAnchor ?? source!.runId,
            },
            attachmentIds: rootMessageFacts.attachmentIds,
            rejectionCode: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE',
          });
    const now = this.now();
    const runId = brand<string, 'RequestRunId'>(this.id('run-retry'));
    const requestContextId = brand<string, 'RequestContextId'>(this.id('context-retry'));
    const assembly = inheritedSource === undefined ? undefined : await this.deps.assemblyRegistry.active(session.agentId);
    const run: RequestRun = {
      runId,
      sessionId: command.sessionId,
      requestId: retryRequestId,
      agentId: inheritedSource === undefined ? source!.agentId : assembly!.agentId,
      agentVersion: inheritedSource === undefined ? source!.agentVersion : assembly!.agentVersion,
      agentAssemblyRef: inheritedSource === undefined ? source!.agentAssemblyRef : assembly!.agentAssemblyRef,
      attempt: inheritedSource === undefined ? source!.attempt + 1 : 1,
      ...(source === undefined ? {} : { retryOfRunId: source.runId }),
      status: 'QUEUED',
      version: 1,
      terminalCommitState: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    };
    const inheritedTaskEventId = source === undefined ? undefined : await this.recoverTaskEventId(source);
    const retryCommand: SubmitRequestCommand = {
      ...this.toSubmitCommand(
        command,
        attachmentIds,
        rootMessageFacts.requestModelOptions,
        rootMessageFacts.inputText,
        rootMessageFacts.routingConstraints,
      ),
      ...(inheritedTaskEventId === undefined ? {} : { propagationAttributes: { taskEventId: inheritedTaskEventId } }),
    };
    const context: RequestContext = {
      requestContextId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId,
      identityContext: command.identityContext,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      acceptedInputText: retryCommand.inputText,
      ...(retryCommand.routingConstraints === undefined ? {} : { routingConstraints: retryCommand.routingConstraints }),
      ...(retryCommand.requestModelOptions === undefined ? {} : { requestModelOptions: retryCommand.requestModelOptions }),
      ...(retryCommand.propagationAttributes === undefined ? {} : { propagationAttributes: retryCommand.propagationAttributes }),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      agentTurnIndex: 0,
      activeStepId: 'turn-1',
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {
        input_question: retryCommand.inputText,
        ...(retryCommand.inputVariables === undefined ? {} : { input_variables: retryCommand.inputVariables }),
      },
    };
    const laneKey = this.laneKey(command.identityContext.tenantId, command.identityContext.subjectId, run.agentId, run.sessionId);
    this.assertSchedulerCapacity(laneKey, 'REQUEST_RETRY_QUEUE_UNAVAILABLE');
    const savedRun = await this.deps.requestRunStore.saveRun(toRunRecord(run, retryCommand), {
      idempotencyKey: command.idempotencyKey,
      idempotencySemantic: this.retryCommandSemantic(command, run.agentId),
    });
    if (savedRun.status === 'VERSION_CONFLICT') {
      throw new AgentError({
        code: 'REQUEST_RETRY_IDEMPOTENCY_CONFLICT',
        message: 'Retry idempotency key was reused with different semantics.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (savedRun.status !== 'UPDATED' || savedRun.record === undefined) {
      throw new AgentError({
        code: 'REQUEST_RETRY_QUEUE_UNAVAILABLE',
        message: 'Retry run could not be accepted.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    if (savedRun.record.runId !== run.runId) {
      if (await this.isRetryQueueUnavailableRun(command, savedRun.record)) {
        throw new AgentError({
          code: 'REQUEST_RETRY_QUEUE_UNAVAILABLE',
          message: 'Retry run could not be scheduled.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      await this.completeRetryVisibilityForRetryRecord(savedRun.record);
      return this.toRequestAccepted(savedRun.record);
    }
    await this.saveCheckpoint(retryCommand, run, context, 'RUN_ACCEPTED');
    try {
      this.enqueueWork(
        {
          command: retryCommand,
          run,
          context,
          laneKey,
        },
        { startDispatch: false },
      );
    } catch {
      await this.commitTerminal(retryCommand, run, context, 'Request failed safely: REQUEST_RETRY_QUEUE_UNAVAILABLE', 'FAILED');
      throw new AgentError({
        code: 'REQUEST_RETRY_QUEUE_UNAVAILABLE',
        message: 'Retry run could not be scheduled.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    await this.emitCanonical(
      retryCommand,
      context,
      {
        type: 'REQUEST_ACCEPTED',
        inlinePayload: {
          attempt: run.attempt,
          ...(source === undefined ? {} : { retryOfRunId: source.runId }),
          agentId: run.agentId,
          agentVersion: run.agentVersion,
          status: 'QUEUED',
        },
      },
      command.idempotencyKey,
    );
    if (inheritedSource === undefined) {
      await this.completeRetryVisibilityReplacement(command, retryCommand, source!, run, context);
    } else {
      await this.completeInheritedRetryVisibilityReplacement(command, retryCommand, inheritedSource.sourceMessageIds, run, context);
    }
    const outcome = { sessionId: run.sessionId, requestId: run.requestId, runId, attempt: run.attempt };
    this.wakeScheduler();
    return outcome;
  }

  async editLatest(command: EditLatestRequestCommand): Promise<RequestAccepted> {
    if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'EDIT_LATEST_IDEMPOTENCY_REQUIRED',
        message: 'Edit latest requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const session = await this.requireSession({ identityContext: command.identityContext, sessionId: command.sessionId });
    const semantic = this.editLatestCommandSemantic(command, session.agentId);
    const existingEditRun = await this.loadRunByIdempotencyAnchor(
      command,
      session.agentId,
      'ACCEPTANCE',
      semantic,
      'EDIT_LATEST_IDEMPOTENCY_CONFLICT',
    );
    if (existingEditRun !== undefined) {
      await this.completeEditVisibilityForRecord(command, existingEditRun);
      return this.toRequestAccepted(existingEditRun);
    }
    const laneKey = this.laneKey(command.identityContext.tenantId, command.identityContext.subjectId, session.agentId, command.sessionId);
    this.assertSchedulerCapacity(laneKey);
    const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: session.agentId,
      sessionId: command.sessionId,
    });
    if (snapshot.latestRun === undefined || snapshot.latestRequestId === undefined) {
      const inheritedSource = await this.resolveInheritedLatestSource(command, session.agentId, snapshot);
      if (inheritedSource === undefined) {
        throw new AgentError({ code: 'EDIT_LATEST_NOT_FOUND', message: 'Edit target was not found.', category: 'NOT_FOUND', retryable: false });
      }
    } else if (snapshot.latestRequestId !== command.expectedLatestRequestId) {
      throw new AgentError({
        code: 'EDIT_LATEST_NOT_LATEST',
        message: 'Edit target is not the latest request.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'STALE_LATEST_REQUEST' },
      });
    }

    const now = this.now();
    const assembly = await this.deps.assemblyRegistry.active(session.agentId);
    const requestId = command.reservedRequest?.requestId ?? brand<string, 'MessageId'>(this.id('request-edit'));
    const runId = command.reservedRequest?.runId ?? brand<string, 'RequestRunId'>(this.id('run-edit'));
    const requestContextId = command.reservedRequest?.requestContextId ?? brand<string, 'RequestContextId'>(this.id('context-edit'));
    const attachmentIds = await this.revalidateAttachmentAuthorities({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: session.agentId,
      source: { sessionId: command.sessionId, requestId, runId },
      attachmentIds: command.attachmentIds,
      rejectionCode: 'REQUEST_EDIT_ATTACHMENT_UNAVAILABLE',
    });
    const inheritedTaskEventId = snapshot.latestRun === undefined ? undefined : await this.recoverTaskEventId(snapshot.latestRun);
    const submitCommand: SubmitRequestCommand = {
      sessionId: command.sessionId,
      identityContext: command.identityContext,
      ...this.projectAcceptedInput(command.editedInputText),
      attachmentIds,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: command.idempotencyKey,
      ...(command.reservedRequest === undefined ? {} : { reservedRequest: command.reservedRequest }),
      ...(command.inputVariables === undefined ? {} : { inputVariables: command.inputVariables }),
      ...(inheritedTaskEventId === undefined ? {} : { propagationAttributes: { taskEventId: inheritedTaskEventId } }),
    };
    const run: RequestRun = {
      runId,
      sessionId: command.sessionId,
      requestId,
      agentId: assembly.agentId,
      agentVersion: assembly.agentVersion,
      agentAssemblyRef: assembly.agentAssemblyRef,
      attempt: 1,
      status: 'QUEUED',
      version: 1,
      terminalCommitState: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    };
    const context: RequestContext = {
      requestContextId,
      sessionId: command.sessionId,
      requestId,
      runId,
      identityContext: command.identityContext,
      locale: submitCommand.locale,
      acceptedInputText: submitCommand.inputText,
      ...(submitCommand.routingConstraints === undefined ? {} : { routingConstraints: submitCommand.routingConstraints }),
      ...(submitCommand.requestModelOptions === undefined ? {} : { requestModelOptions: submitCommand.requestModelOptions }),
      ...(submitCommand.propagationAttributes === undefined ? {} : { propagationAttributes: submitCommand.propagationAttributes }),
      agentId: assembly.agentId,
      agentVersion: assembly.agentVersion,
      agentAssemblyRef: assembly.agentAssemblyRef,
      agentTurnIndex: 0,
      activeStepId: 'turn-1',
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {
        input_question: submitCommand.inputText,
        ...(command.inputVariables === undefined ? {} : { input_variables: command.inputVariables }),
      },
    };
    try {
      await this.lifecycleHookStageExecutor.invokeStage(
        this.hookScope(run, context, 'BEFORE_REQUEST_ACCEPT', `edit:${command.idempotencyKey}`),
        'BEFORE_REQUEST_ACCEPT',
        {
          stage: 'BEFORE_REQUEST_ACCEPT',
          locale: submitCommand.locale,
          attachmentCount: command.attachmentIds.length,
          idempotencyKeyPresent: command.idempotencyKey.trim().length > 0,
          safeRequestClass:
            command.editedInputText.trim().length === 0 ? 'EMPTY' : command.attachmentIds.length === 0 ? 'TEXT_ONLY' : 'TEXT_WITH_ATTACHMENTS',
        },
      );
    } catch (error) {
      if (error instanceof LifecycleHookInterruptionError) {
        throw agentErrorFromLifecycleHookInterruption(error.interruption);
      }
      throw error;
    }
    await this.persistUserMessage(submitCommand, run);
    const savedRun = await this.deps.requestRunStore.saveRun(toRunRecord(run, submitCommand), {
      idempotencyKey: command.idempotencyKey,
      idempotencySemantic: semantic,
    });
    if (savedRun.status === 'VERSION_CONFLICT') {
      throw new AgentError({
        code: 'EDIT_LATEST_IDEMPOTENCY_CONFLICT',
        message: 'Edit idempotency key was reused with different semantics.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (savedRun.status !== 'UPDATED' || savedRun.record === undefined) {
      throw new AgentError({
        code: 'EDIT_LATEST_QUEUE_UNAVAILABLE',
        message: 'Edit run could not be accepted.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    if (savedRun.record.runId !== run.runId) {
      await this.completeEditVisibilityForRecord(command, savedRun.record);
      return this.toRequestAccepted(savedRun.record);
    }
    await this.saveCheckpoint(submitCommand, run, context, 'RUN_ACCEPTED');
    await this.emitCanonical(
      submitCommand,
      context,
      {
        type: 'REQUEST_ACCEPTED',
        inlinePayload: {
          attempt: 1,
          editedFromRequestId: command.expectedLatestRequestId,
          agentId: assembly.agentId,
          agentVersion: assembly.agentVersion,
          status: 'QUEUED',
        },
      },
      command.idempotencyKey,
    );
    if (command.guardBlockRefusal !== undefined) {
      await this.commitTerminal(submitCommand, run, context, command.guardBlockRefusal, 'COMPLETED', {
        guardBlockedVisible: { refusalMessage: command.guardBlockRefusal },
      });
      await this.hideEditedSourceRequestMessages(command, run.agentId, context.requestContextId);
      return { sessionId: command.sessionId, requestId, runId, attempt: 1 };
    }
    await this.replaceOlderLaneWork(submitCommand, run, context);
    this.enqueueWork({ command: submitCommand, run, context, laneKey });
    await this.hideEditedSourceRequestMessages(command, run.agentId, context.requestContextId);
    return { sessionId: command.sessionId, requestId, runId, attempt: 1 };
  }

  async answerPendingInput(command: AnswerPendingInputCommand): Promise<PendingInputAnswerAccepted> {
    if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'PENDING_INPUT_IDEMPOTENCY_REQUIRED',
        message: 'Pending input answer requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (this.deps.pendingInputStore === undefined) {
      throw new AgentError({ code: 'PENDING_INPUT_NOT_FOUND', message: 'Pending input was not found.', category: 'NOT_FOUND', retryable: false });
    }
    const session = await this.requireSession({ identityContext: command.identityContext, sessionId: command.answer.sessionId });
    const pending = await this.deps.pendingInputStore.loadPendingInput({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: session.agentId,
      pendingInputId: command.answer.pendingInputId,
    });
    if (pending === undefined || pending.sessionId !== command.answer.sessionId) {
      throw new AgentError({ code: 'PENDING_INPUT_NOT_FOUND', message: 'Pending input was not found.', category: 'NOT_FOUND', retryable: false });
    }
    if (pending.status === 'CANCELED') {
      throw new AgentError({
        code: 'PENDING_INPUT_CANCELED',
        message: 'Pending input belongs to a canceled request.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (pending.status === 'TIMED_OUT') {
      throw new AgentError({
        code: 'PENDING_INPUT_TIMED_OUT',
        message: 'Pending input has timed out.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'PENDING_INPUT_TIMED_OUT' },
      });
    }
    if (this.isPendingInputDue(pending)) {
      await this.timeoutPendingInput(pending).catch((error) => {
        logger.error({
          err: error,
          event: 'runtime.pending_input.timeout_failed',
          triggeredBy: 'answer',
          agentId: pending.agentId,
          sessionId: pending.sessionId,
          requestId: pending.requestId,
          runId: pending.requestRunId,
          pendingInputId: pending.pendingInputId,
          failureStage: 'PENDING_INPUT_TIMEOUT',
          recoveryCode: error instanceof AgentError ? error.code : this.toRecoveryCode(error),
        });
      });
      throw new AgentError({
        code: 'PENDING_INPUT_TIMED_OUT',
        message: 'Pending input has timed out.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'PENDING_INPUT_TIMED_OUT' },
      });
    }
    this.assertValidPendingInputAnswer(pending, command.answer.answers, command.answer.answerKinds);
    const owningRun = await this.deps.requestRunStore.loadRun({
      tenantId: pending.tenantId,
      subjectId: pending.subjectId,
      agentId: pending.agentId,
      runId: pending.requestRunId,
    });
    if (pending.status === 'PENDING') {
      if (owningRun === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input owning run is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      if (owningRun?.status === 'CANCELED') {
        await this.cancelPendingInput(pending);
        throw new AgentError({
          code: 'PENDING_INPUT_CANCELED',
          message: 'Pending input belongs to a canceled request.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      if (this.isTerminalRunStatus(owningRun.status)) {
        throw new AgentError({
          code: 'PENDING_INPUT_NOT_PENDING',
          message: 'Pending input owning run is already terminal.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
    }
    const answeredAt = this.now();
    const resolved = await this.deps.pendingInputStore.resolvePendingInput(
      {
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        pendingInputId: pending.pendingInputId,
        expectedStatus: 'PENDING',
        status: 'RECEIVED',
        answer: {
          answers: command.answer.answers,
          ...(command.answer.answerKinds === undefined ? {} : { answerKinds: command.answer.answerKinds }),
          answeredAt,
        },
      },
      {
        idempotencyKey: command.idempotencyKey,
        idempotencySemantic: this.pendingInputResolveSemantic(pending.pendingInputId, 'RECEIVED', command.answer.answers, command.answer.answerKinds),
      },
    );
    if (resolved.status === 'IDEMPOTENCY_CONFLICT') {
      throw new AgentError({
        code: 'PENDING_INPUT_IDEMPOTENCY_CONFLICT',
        message: 'Pending input answer idempotency semantic conflicts with a prior answer.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (resolved.status !== 'UPDATED') {
      if (resolved.record?.status === 'RECEIVED') {
        throw new AgentError({
          code: 'PENDING_INPUT_ALREADY_RESOLVED',
          message: 'Pending input has already been answered.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      if (resolved.record?.status === 'TIMED_OUT') {
        throw new AgentError({
          code: 'PENDING_INPUT_TIMED_OUT',
          message: 'Pending input has timed out.',
          category: 'CONFLICT',
          retryable: false,
          safeDetails: { reasonCode: 'PENDING_INPUT_TIMED_OUT' },
        });
      }
      throw new AgentError({
        code: 'PENDING_INPUT_NOT_PENDING',
        message: 'Pending input is not awaiting an answer.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (resolved.record?.updatedAt === answeredAt) {
      if (owningRun === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input owning run is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const resolvedRecord = resolved.record;
      await this.emitPendingInputEvent(command, owningRun, resolvedRecord, 'USER_INPUT_RECEIVED', {
        status: 'RECEIVED',
        safeSummary:
          resolvedRecord.kind === 'AUTHORIZATION'
            ? this.isApprovedAuthorizationAnswer(command.answer.answers)
              ? 'Authorization approved.'
              : 'Authorization denied.'
            : 'Pending input answer received.',
      });
      // Workflow-originated pending inputs always resume: the answer (approve/reject/deny)
      // is a data value bound to user_check_result, not a control signal to terminalize.
      const isWorkflowNode = resolvedRecord.producerRef.kind === 'WORKFLOW_NODE';
      if (this.isConfirmationReject(resolvedRecord) && !isWorkflowNode) {
        await this.terminalizePendingInputNonApproval(command, owningRun, resolvedRecord, 'PENDING_INPUT_REJECTED', 'reject');
      } else if (this.isAuthorizationDeny(resolvedRecord) && !isWorkflowNode) {
        await this.terminalizePendingInputNonApproval(command, owningRun, resolvedRecord, 'PENDING_INPUT_DENIED', 'deny');
      } else if (
        resolvedRecord.kind === 'AUTHORIZATION' &&
        resolvedRecord.authorizationScope !== undefined &&
        this.isApprovedAuthorizationAnswer(command.answer.answers) &&
        !isWorkflowNode
      ) {
        await this.resumeAuthorizedRun(command, resolvedRecord);
      } else if (this.isHumanHandoffFinalAnswer(resolvedRecord)) {
        await this.terminalizeHumanHandoffFinalAnswer(command, owningRun, resolvedRecord);
      } else {
        void this.resumePendingRun(command, resolvedRecord).catch((error) => {
          logger.error({
            err: error,
            event: 'runtime.pending_input.resume_failed',
            agentId: pending.agentId,
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            runId: pending.requestRunId,
            pendingInputId: pending.pendingInputId,
            failureStage: 'PENDING_INPUT_RESUME',
            recoveryCode: this.toRecoveryCode(error),
          });
        });
      }
    } else {
      const durableRun = await this.deps.requestRunStore.loadRun({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        runId: pending.requestRunId,
      });
      if (durableRun === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input resume target is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        runId: pending.requestRunId,
      });
      if (checkpoint === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input resume checkpoint is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const stage =
        pending.producerRef.kind === 'LIFECYCLE_HOOK' && pending.producerRef.stage !== undefined
          ? pending.producerRef.stage
          : this.stageFromCheckpoint(checkpoint);
      const workflowTargetRecipe = pending.producerRef.kind === 'WORKFLOW_NODE' ? pending.producerRef.recipeName : undefined;
      const baseResumeCommand = await this.toRecoverySubmitCommand(durableRun);
      const resumeCommand =
        workflowTargetRecipe === undefined
          ? baseResumeCommand
          : {
              ...baseResumeCommand,
              routingConstraints: {
                targetRecipe: workflowTargetRecipe,
              },
            };
      const messages =
        stage === 'BEFORE_CAPABILITY_INVOKE'
          ? await this.deps.messageStore.listCurrentRequestMessages({
              tenantId: pending.tenantId,
              subjectId: pending.subjectId,
              agentId: pending.agentId,
              sessionId: pending.sessionId,
              requestId: pending.requestId,
              runId: pending.requestRunId,
              includeHidden: true,
              offset: 0,
              limit: 100,
            })
          : undefined;
      const context = await this.reconstructRecoveryContext(durableRun, resumeCommand, stage, checkpoint, messages?.items ?? []);
      const pendingAnswerSummary = summarizePendingAnswers(command.answer.answers);
      const resumedContext: RequestContext = {
        ...context,
        flowVariables: {
          ...context.flowVariables,
          pendingHookResume: {
            stage,
            pendingInputId: pending.pendingInputId,
            answers: command.answer.answers,
            pendingAnswerSummary,
          },
        },
      };
      if (pending.producerRef.kind === 'WORKFLOW_NODE') {
        const workflowResumed = this.attachWorkflowPendingResume(resumedContext, resolved.record ?? pending);
        Object.assign(resumedContext.flowVariables, workflowResumed.flowVariables);
      }
      if (stage === 'BEFORE_AGENT_TERMINAL') {
        const terminalStatus = this.recoveredTerminalStatusFromContext(resumedContext, durableRun);
        const events = await this.deps.timelineStore.listEvents({
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          agentId: pending.agentId,
          sessionId: pending.sessionId,
          afterSequence: brand<number, 'TimelineSequence'>(0),
          limit: maxReplayBatchEvents,
          runId: pending.requestRunId,
        });
        const content = this.recoveredTerminalContent(terminalStatus, events, resumedContext);
        if (content === undefined) {
          throw new AgentError({
            code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
            message: 'Pending terminal resume content is unavailable.',
            category: 'UNAVAILABLE',
            retryable: true,
          });
        }
        await this.commitTerminal(resumeCommand, this.toRuntimeRun(durableRun), resumedContext, content, terminalStatus);
        return { sessionId: pending.sessionId, pendingInputId: pending.pendingInputId, status: 'RECEIVED' };
      }
      const queuedRecord = {
        ...durableRun,
        status: 'QUEUED' as const,
        version: durableRun.version + 1,
        updatedAt: this.now(),
      };
      const saved = await this.deps.requestRunStore.saveRun(queuedRecord, { expectedVersion: durableRun.version });
      if (saved.status !== 'UPDATED' || saved.record === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input resume target could not be re-queued.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      this.enqueueWork({
        command: resumeCommand,
        run: this.toRuntimeRun(saved.record),
        context: resumedContext,
        laneKey: this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId),
      });
    }
    return { sessionId: pending.sessionId, pendingInputId: pending.pendingInputId, status: 'RECEIVED' };
  }

  async recoverLocalRuntime(options: LocalRuntimeRecoveryOptions = {}): Promise<LocalRuntimeRecoveryReport> {
    const recoveryAgentId = this.deps.recoveryAgentId;
    if (recoveryAgentId === undefined) {
      throw new AgentError({
        code: 'RECOVERY_AGENT_SCOPE_UNAVAILABLE',
        message: 'Runtime recovery Agent Scope is unavailable.',
        category: 'UNAVAILABLE',
        retryable: false,
        safeDetails: { reasonCode: 'RECOVERY_AGENT_SCOPE_UNAVAILABLE' },
      });
    }
    const limit = Math.max(1, Math.min(1000, Math.trunc(options.limit ?? 100)));
    const lockedBy = options.lockedBy ?? this.deps.recoveryLockedBy ?? this.id('runtime-recovery');
    const lockTtlMs = options.lockTtlMs ?? 300_000;
    this.recoveryDispatchGated = true;
    logger.debug({ event: 'runtime.recovery.scan_started', limit });
    let rebuiltQueued = 0;
    let claimedExecuting = 0;
    let failed = 0;
    let skipped = 0;
    let scanned = 0;
    try {
      await this.processPendingInputTimeoutFacts();
      const records = await this.deps.requestRunStore.listRecoverableRuns({ agentId: recoveryAgentId, now: this.now(), limit });
      for (const record of records) {
        if (this.isTerminalRunStatus(record.status) && record.terminalCommitState === 'COMMITTED') {
          skipped += 1;
          continue;
        }
        try {
          if (record.terminalCommitState === 'PENDING' || record.terminalCommitState === 'RETRYING') {
            if (await this.takeOverTerminalRun(record)) {
              failed += 1;
            }
            continue;
          }
          if (record.status === 'QUEUED' || record.status === 'ACCEPTED' || record.status === 'PLANNING') {
            const claimed = await this.claimRecoverableRun(record, lockedBy, lockTtlMs);
            if (claimed === undefined) {
              skipped += 1;
              continue;
            }
            await this.rebuildQueuedRun(claimed);
            rebuiltQueued += 1;
            continue;
          }
          if (record.status === 'EXECUTING') {
            const pending = await this.deps.pendingInputStore?.loadActivePendingInput({
              tenantId: record.tenantId,
              subjectId: record.subjectId,
              agentId: record.agentId,
              sessionId: record.sessionId,
            });
            if (pending?.requestRunId === record.runId) {
              skipped += 1;
              continue;
            }
            const claimed = await this.claimRecoverableRun(record, lockedBy, lockTtlMs);
            if (claimed === undefined) {
              skipped += 1;
              continue;
            }
            claimedExecuting += 1;
            if (await this.recoverClaimedExecutingRun(claimed)) {
              failed += 1;
            }
            continue;
          }
          skipped += 1;
        } catch (error) {
          logger.error({
            err: error,
            event: 'runtime.recovery.record_failed',
            agentId: record.agentId,
            sessionId: record.sessionId,
            requestId: record.requestId,
            runId: record.runId,
            failureStage: 'RECOVERY_RECORD',
            recoveryCode: this.toRecoveryCode(error),
          });
          await this.failRecoveredRun(record, this.toRecoveryCode(error));
          failed += 1;
        }
      }
      scanned = records.length;
      return { scanned, rebuiltQueued, claimedExecuting, failed, skipped };
    } finally {
      this.recoveryDispatchGated = false;
      this.wakeScheduler();
      logger.debug({ event: 'runtime.recovery.scan_completed', scanned, rebuiltQueued, claimedExecuting, failed, skipped });
    }
  }

  private async claimRecoverableRun(record: RequestRunRecord, lockedBy: string, lockTtlMs: number): Promise<RequestRunRecord | undefined> {
    const claim = await this.deps.requestRunStore.claimRun({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      runId: record.runId,
      expectedVersion: record.version,
      lockedBy,
      lockExpiresAt: brand<number, 'EpochMillis'>(Number(this.now()) + lockTtlMs),
    });
    return claim.status === 'UPDATED' ? claim.record : undefined;
  }

  async close(options: { readonly timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, options.timeoutMs ?? 5_000);
    const deadline = Date.now() + timeoutMs;
    this.pendingInputTimeoutProcessingClosing = true;
    this.pendingInputTimeoutProcessingStarted = false;
    this.pendingInputTimeoutWakeAt = undefined;
    this.pendingInputTimeoutReconcileRequested = false;
    if (this.pendingInputTimeoutTimer !== undefined) {
      clearTimeout(this.pendingInputTimeoutTimer);
      this.pendingInputTimeoutTimer = undefined;
    }
    this.wakeScheduler();
    while (Date.now() <= deadline) {
      if (
        this.pendingWorkCount() === 0 &&
        this.drainingLanes.size === 0 &&
        this.executingRuns.size === 0 &&
        this.inflightCount === 0 &&
        this.schedulerRunning === false &&
        this.pendingInputTimeoutProcessingPromise === undefined
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.wakeScheduler();
    }
  }

  private enqueueWork(work: QueuedRunWork, options: { readonly startDispatch?: boolean } = {}): void {
    const queue = this.pendingLaneWork.get(work.laneKey) ?? [];
    queue.push(work);
    this.pendingLaneWork.set(work.laneKey, queue);
    logger.debug({
      event: 'runtime.queue.enqueued',
      agentId: work.run.agentId,
      sessionId: work.run.sessionId,
      requestId: work.run.requestId,
      runId: work.run.runId,
      laneKey: work.laneKey,
      pendingDepth: queue.length,
    });
    if (options.startDispatch !== false && !this.recoveryDispatchGated) {
      this.wakeScheduler();
    }
  }

  private assertSchedulerCapacity(
    _laneKey: string,
    code: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED' | 'REQUEST_RETRY_QUEUE_UNAVAILABLE' = 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED',
  ): void {
    const limit = this.deps.scheduler?.maxPendingQueueDepth;
    if (limit === undefined) {
      return;
    }
    const normalizedLimit = Math.max(0, Math.trunc(limit));
    const depth = [...this.pendingLaneWork.values()].reduce((sum, queue) => sum + queue.length, 0);
    if (depth >= normalizedLimit) {
      throw new AgentError({
        code,
        message: code === 'REQUEST_RETRY_QUEUE_UNAVAILABLE' ? 'Retry run could not be scheduled.' : 'Scheduler queue capacity is exhausted.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reasonCode: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED' },
      });
    }
  }

  private async assertNoActivePendingInput(
    identityContext: SubmitRequestCommand['identityContext'],
    agentId: AgentId,
    sessionId: SessionId,
  ): Promise<void> {
    const pending = await this.deps.pendingInputStore?.loadActivePendingInput({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    });
    if (pending === undefined) {
      return;
    }
    throw new AgentError({
      code: 'PENDING_INPUT_ACTIVE_CONFLICT',
      message: 'A pending input is already active for this session.',
      category: 'CONFLICT',
      retryable: false,
      safeDetails: {
        reasonCode: 'PENDING_INPUT_ACTIVE_CONFLICT',
        pendingInputId: pending.pendingInputId,
        kind: pending.kind,
        status: pending.status,
      },
    });
  }

  private async cancelActivePendingForRun(command: RequestControlCommand, run: RequestRun, preloadedPending?: PendingInputRecord): Promise<void> {
    const pending =
      preloadedPending ??
      (await this.deps.pendingInputStore?.loadActivePendingInput({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: run.agentId,
        sessionId: run.sessionId,
      }));
    if (pending === undefined || pending.requestRunId !== run.runId) {
      return;
    }
    const resolved = await this.deps.pendingInputStore?.resolvePendingInput(
      {
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        pendingInputId: pending.pendingInputId,
        expectedStatus: 'PENDING',
        status: 'CANCELED',
      },
      {
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${command.idempotencyKey}:pending-input-cancel:${pending.pendingInputId}`),
        idempotencySemantic: JSON.stringify(['pending-input-resolve-v1', pending.pendingInputId, 'CANCELED']),
      },
    );
    if (resolved?.status === 'UPDATED') {
      await this.emitPendingInputEvent(command, run, pending, 'USER_INPUT_CANCELED', {
        status: 'CANCELED',
        safeSummary: 'Pending input canceled with the owning request.',
      });
    }
  }

  private async cancelPendingInput(pending: PendingInputRecord): Promise<void> {
    await this.deps.pendingInputStore
      ?.resolvePendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        pendingInputId: pending.pendingInputId,
        expectedStatus: 'PENDING',
        status: 'CANCELED',
      })
      .catch(() => undefined);
  }

  private isAuthorizationPendingRequest(error: unknown): error is AgentError {
    return error instanceof AgentError && error.category === 'AUTHORIZATION' && error.code === 'RISK_POLICY_AUTHORIZATION_REQUIRED';
  }

  private async createAuthorizationPendingInput(
    command: SubmitRequestCommand,
    run: RequestRun,
    context: RequestContext,
    error: AgentError,
  ): Promise<void> {
    if (this.deps.pendingInputStore === undefined) {
      throw error;
    }
    const scope = this.authorizationScopeFromError(error.safeDetails);
    if (scope === undefined) {
      throw error;
    }
    const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: run.agentId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
    });
    if (checkpoint === undefined) {
      throw new AgentError({
        code: 'AUTHORIZATION_CHECKPOINT_UNAVAILABLE',
        message: 'Authorization pending input requires a checkpoint.',
        category: 'UNAVAILABLE',
        retryable: false,
      });
    }
    const pendingInputId = brand<string, 'PendingInputId'>(this.id('pending-input'));
    const prompt = typeof error.safeDetails?.['prompt'] === 'string' ? error.safeDetails['prompt'] : 'Approve the requested operation?';
    const approveLabel = typeof error.safeDetails?.['approveLabel'] === 'string' ? error.safeDetails['approveLabel'] : 'Approve';
    const denyLabel = typeof error.safeDetails?.['denyLabel'] === 'string' ? error.safeDetails['denyLabel'] : 'Deny';
    const record: PendingInputRecord = {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: run.agentId,
      pendingInputId,
      requestRunId: run.runId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      requestContextId: context.requestContextId,
      checkpointId: checkpoint.checkpointId,
      kind: 'AUTHORIZATION',
      request: {
        id: pendingInputId,
        sessionId: run.sessionId,
        kind: 'AUTHORIZATION',
        questions: [
          {
            prompt,
            options: [
              { label: approveLabel, value: 'approve' },
              { label: denyLabel, value: 'deny' },
            ],
          },
        ],
      },
      producerRef: { kind: 'LIFECYCLE_HOOK' },
      status: 'PENDING',
      createdAt: this.now(),
      updatedAt: this.now(),
      authorizationScope: scope,
    };
    await this.deps.pendingInputStore.createPendingInput({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      record,
    });
    try {
      await this.emitCanonical(
        command,
        context,
        {
          type: 'USER_INPUT_REQUIRED',
          inlinePayload: {
            pendingInputId: record.pendingInputId,
            kind: record.kind,
            questions: record.request.questions.map((question) => ({
              prompt: question.prompt,
              options: question.options.map((option) => ({
                label: option.label,
                value: option.value,
                ...(option.requiresTextInput === undefined ? {} : { requiresTextInput: option.requiresTextInput }),
                ...(option.inputPlaceholder === undefined ? {} : { inputPlaceholder: option.inputPlaceholder }),
              })),
            })),
            status: record.status,
          },
        },
        brand<string, 'IdempotencyKey'>(`${run.runId}:${record.pendingInputId}:user-input-required`),
      );
    } finally {
      if (record.request.timeoutAt !== undefined) {
        this.notifyPendingInputCreated(record.request.timeoutAt);
      }
    }
  }

  private authorizationScopeFromError(details?: JsonObject): AuthorizationScopeRecord | undefined {
    if (details === undefined) {
      return undefined;
    }
    const operationId = details['operationId'];
    const operationKind = details['operationKind'];
    const riskLevel = details['riskLevel'];
    if (typeof operationId !== 'string' || typeof operationKind !== 'string' || typeof riskLevel !== 'string') {
      return undefined;
    }
    return {
      operationId,
      operationKind: operationKind as AuthorizationScopeRecord['operationKind'],
      riskLevel: riskLevel as AuthorizationScopeRecord['riskLevel'],
      ...(typeof details['capabilityId'] === 'string' ? { capabilityId: details['capabilityId'] } : {}),
      ...(typeof details['toolCallId'] === 'string' ? { toolCallId: details['toolCallId'] } : {}),
    };
  }

  private isPendingInputDue(pending: PendingInputRecord): boolean {
    return pending.request.timeoutAt !== undefined && Number(pending.request.timeoutAt) <= Number(this.now());
  }

  startPendingInputTimeoutProcessing(): void {
    if (
      this.pendingInputTimeoutProcessingStarted ||
      this.pendingInputTimeoutProcessingClosing ||
      this.deps.pendingInputStore === undefined ||
      this.deps.recoveryAgentId === undefined
    ) {
      return;
    }
    this.pendingInputTimeoutProcessingStarted = true;
    if (this.pendingInputTimeoutInitialized) {
      this.armPendingInputTimeoutTimer();
      return;
    }
    this.considerPendingInputTimeoutWake(this.now());
    this.armPendingInputTimeoutTimer();
  }

  private notifyPendingInputCreated(timeoutAt: EpochMillis): void {
    if (this.pendingInputTimeoutProcessingClosing) {
      return;
    }
    this.considerPendingInputTimeoutWake(timeoutAt);
    this.armPendingInputTimeoutTimer();
  }

  private considerPendingInputTimeoutWake(wakeAt: EpochMillis): void {
    if (this.pendingInputTimeoutWakeAt === undefined || Number(wakeAt) < Number(this.pendingInputTimeoutWakeAt)) {
      this.pendingInputTimeoutWakeAt = wakeAt;
    }
  }

  private armPendingInputTimeoutTimer(): void {
    if (!this.pendingInputTimeoutProcessingStarted || this.pendingInputTimeoutProcessingClosing || this.pendingInputTimeoutWakeAt === undefined) {
      return;
    }
    if (this.pendingInputTimeoutTimer !== undefined) {
      clearTimeout(this.pendingInputTimeoutTimer);
      this.pendingInputTimeoutTimer = undefined;
    }
    const wakeAt = this.pendingInputTimeoutWakeAt;
    const delay = Math.max(0, Number(wakeAt) - Number(this.now()));
    const timer = setTimeout(() => {
      if (this.pendingInputTimeoutTimer !== timer) {
        return;
      }
      this.pendingInputTimeoutTimer = undefined;
      this.pendingInputTimeoutWakeAt = undefined;
      void this.processPendingInputTimeoutFacts();
    }, delay);
    this.pendingInputTimeoutTimer = timer;
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private processPendingInputTimeoutFacts(): Promise<void> {
    if (this.pendingInputTimeoutProcessingClosing || this.deps.pendingInputStore === undefined || this.deps.recoveryAgentId === undefined) {
      return Promise.resolve();
    }
    const active = this.pendingInputTimeoutProcessingPromise;
    if (active !== undefined) {
      this.pendingInputTimeoutReconcileRequested = true;
      return active;
    }
    const processing = this.runPendingInputTimeoutPass()
      .then((result) => {
        if (result.retryRequired) {
          this.considerPendingInputTimeoutWake(this.pendingInputTimeoutRetryWake());
        } else {
          this.pendingInputTimeoutRetryAttempt = 0;
        }
        if (result.nextTimeoutAt !== undefined) {
          this.considerPendingInputTimeoutWake(result.nextTimeoutAt);
        }
      })
      .catch((error) => {
        logger.error({
          err: error,
          event: 'runtime.pending_input.timeout_scan_failed',
          agentId: this.deps.recoveryAgentId,
          failureStage: 'PENDING_INPUT_TIMEOUT_SCAN',
          recoveryCode: error instanceof AgentError ? error.code : this.toRecoveryCode(error),
        });
        this.considerPendingInputTimeoutWake(this.pendingInputTimeoutRetryWake());
      })
      .finally(() => {
        this.pendingInputTimeoutInitialized = true;
        if (this.pendingInputTimeoutProcessingPromise === processing) {
          this.pendingInputTimeoutProcessingPromise = undefined;
        }
        if (this.pendingInputTimeoutProcessingClosing) {
          return;
        }
        if (this.pendingInputTimeoutReconcileRequested) {
          this.pendingInputTimeoutReconcileRequested = false;
          this.considerPendingInputTimeoutWake(this.now());
        }
        this.armPendingInputTimeoutTimer();
      });
    this.pendingInputTimeoutProcessingPromise = processing;
    return processing;
  }

  private pendingInputTimeoutRetryWake(): EpochMillis {
    const delay = Math.min(pendingInputTimeoutInitialRetryMs * 2 ** this.pendingInputTimeoutRetryAttempt, pendingInputTimeoutMaxRetryMs);
    this.pendingInputTimeoutRetryAttempt += 1;
    return brand<number, 'EpochMillis'>(Number(this.now()) + delay);
  }

  private async runPendingInputTimeoutPass(): Promise<PendingInputTimeoutPassResult> {
    const pendingInputStore = this.deps.pendingInputStore;
    const recoveryAgentId = this.deps.recoveryAgentId;
    if (pendingInputStore === undefined || recoveryAgentId === undefined) {
      return { retryRequired: false };
    }
    const cutoff = this.now();
    let nextTimeoutAt: EpochMillis | undefined;
    let retryRequired = false;
    let after: { readonly timeoutAt: EpochMillis; readonly pendingInputId: PendingInputRecord['pendingInputId'] } | undefined;
    while (!this.pendingInputTimeoutProcessingClosing) {
      const candidates = await pendingInputStore.listUnresolvedPendingInputTimeoutFacts({
        agentId: recoveryAgentId,
        limit: pendingInputTimeoutBatchSize,
        ...(after === undefined ? {} : { after }),
      });
      if (this.pendingInputTimeoutProcessingClosing) {
        return { retryRequired };
      }
      for (const pending of candidates) {
        if (this.pendingInputTimeoutProcessingClosing) {
          return { retryRequired };
        }
        const timeoutAt = pending.request.timeoutAt;
        if (timeoutAt === undefined) {
          throw new AgentError({
            code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_INVALID',
            message: 'Pending input timeout candidate is missing its accepted deadline.',
            category: 'INTERNAL',
            retryable: false,
          });
        }
        if (pending.status === 'PENDING' && Number(timeoutAt) > Number(cutoff)) {
          if (nextTimeoutAt === undefined || Number(timeoutAt) < Number(nextTimeoutAt)) {
            nextTimeoutAt = timeoutAt;
          }
        } else {
          await this.timeoutPendingInput(pending).catch((error) => {
            retryRequired = true;
            logger.error({
              event: 'runtime.pending_input.timeout_failed',
              triggeredBy: 'scheduler',
              agentId: pending.agentId,
              sessionId: pending.sessionId,
              requestId: pending.requestId,
              runId: pending.requestRunId,
              pendingInputId: pending.pendingInputId,
              failureStage: 'PENDING_INPUT_TIMEOUT',
              recoveryCode: error instanceof AgentError ? error.code : this.toRecoveryCode(error),
            });
          });
        }
        after = { timeoutAt, pendingInputId: pending.pendingInputId };
      }
      if (candidates.length < pendingInputTimeoutBatchSize || this.pendingInputTimeoutProcessingClosing) {
        return { ...(nextTimeoutAt === undefined ? {} : { nextTimeoutAt }), retryRequired };
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return { ...(nextTimeoutAt === undefined ? {} : { nextTimeoutAt }), retryRequired };
  }

  private async timeoutPendingInput(pending: PendingInputRecord): Promise<boolean> {
    if (
      (pending.status !== 'PENDING' && pending.status !== 'TIMED_OUT') ||
      this.deps.pendingInputStore === undefined ||
      this.pendingInputTimeoutProcessingClosing
    ) {
      return false;
    }
    let timeoutRecord = pending;
    if (pending.status === 'PENDING') {
      const owningRun = await this.loadPendingInputOwningRun(pending);
      if (this.pendingInputTimeoutProcessingClosing) {
        return false;
      }
      if (owningRun === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_TIMEOUT_RUN_UNAVAILABLE',
          message: 'Pending input owning run is unavailable during timeout processing.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const resolved = await this.deps.pendingInputStore.resolvePendingInput(
        {
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          agentId: pending.agentId,
          pendingInputId: pending.pendingInputId,
          expectedStatus: 'PENDING',
          status: 'TIMED_OUT',
        },
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>(`${pending.requestRunId}:pending-input-timeout:${pending.pendingInputId}`),
          idempotencySemantic: this.pendingInputTimeoutResolveSemantic(pending.pendingInputId),
        },
      );
      if (this.pendingInputTimeoutProcessingClosing || resolved.status !== 'UPDATED') {
        return false;
      }
      timeoutRecord = resolved.record ?? { ...pending, status: 'TIMED_OUT' as const };
    }

    let runRecord = await this.loadPendingInputOwningRun(timeoutRecord);
    if (this.pendingInputTimeoutProcessingClosing) {
      return false;
    }
    if (runRecord === undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_TIMEOUT_RUN_UNAVAILABLE',
        message: 'Pending input owning run is unavailable during timeout processing.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    if (runRecord.terminalCommitState === 'COMMITTED') {
      return true;
    }
    const command = await this.toRecoverySubmitCommand(runRecord);
    if (this.pendingInputTimeoutProcessingClosing) {
      return false;
    }
    await this.emitPendingInputEvent(command, runRecord, timeoutRecord, 'USER_INPUT_TIMEOUT', {
      status: 'TIMED_OUT',
      safeSummary: 'Pending input timed out.',
    });
    if (this.pendingInputTimeoutProcessingClosing) {
      return false;
    }
    const latestRunRecord = await this.loadPendingInputOwningRun(timeoutRecord);
    if (this.pendingInputTimeoutProcessingClosing) {
      return false;
    }
    if (latestRunRecord === undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_TIMEOUT_RUN_UNAVAILABLE',
        message: 'Pending input owning run is unavailable during timeout processing.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    if (latestRunRecord.terminalCommitState === 'COMMITTED') {
      return true;
    }
    runRecord = latestRunRecord;
    if (timeoutRecord.producerRef.kind === 'WORKFLOW_NODE') {
      return this.resumePendingInputTimeout(command, runRecord, timeoutRecord);
    }
    await this.commitTerminal(
      command,
      this.toRuntimeRun(runRecord),
      this.toPendingInputTerminalContext(command, runRecord, timeoutRecord, { skipTerminalLifecycleHook: true }),
      'Request failed safely: PENDING_INPUT_TIMEOUT',
      'FAILED',
      {
        idempotencyKey: brand<string, 'IdempotencyKey'>(
          `${timeoutRecord.requestRunId}:pending-input-timeout-terminal:${timeoutRecord.pendingInputId}`,
        ),
        idempotencySemantic: JSON.stringify(['pending-input-timeout-terminal-v1', timeoutRecord.pendingInputId]),
        failureReason: { code: 'PENDING_INPUT_TIMEOUT' },
      },
    );
    if (this.pendingInputTimeoutProcessingClosing) {
      return false;
    }
    this.leaveExecutingRun(runRecord.runId);
    this.wakeScheduler();
    return true;
  }

  private loadPendingInputOwningRun(pending: PendingInputRecord): Promise<RequestRunRecord | undefined> {
    return this.deps.requestRunStore.loadRun({
      tenantId: pending.tenantId,
      subjectId: pending.subjectId,
      agentId: pending.agentId,
      runId: pending.requestRunId,
    });
  }

  private async terminalizePendingInputNonApproval(
    command: AnswerPendingInputCommand,
    runRecord: RequestRunRecord,
    pending: PendingInputRecord,
    reasonCode: 'PENDING_INPUT_REJECTED' | 'PENDING_INPUT_DENIED',
    idempotencyScope: 'reject' | 'deny',
  ): Promise<void> {
    const submitCommand = this.toPendingInputSubmitCommand(command, pending);
    await this.commitTerminal(
      submitCommand,
      this.toRuntimeRun(runRecord),
      this.toPendingInputTerminalContext(submitCommand, runRecord, pending),
      `Request failed safely: ${reasonCode}`,
      'FAILED',
      {
        idempotencyKey: brand<string, 'IdempotencyKey'>(
          `${pending.requestRunId}:pending-input-${idempotencyScope}-terminal:${pending.pendingInputId}`,
        ),
        idempotencySemantic: JSON.stringify([`pending-input-${idempotencyScope}-terminal-v1`, pending.pendingInputId]),
      },
    );
    this.leaveExecutingRun(runRecord.runId);
    this.wakeScheduler();
  }

  private async terminalizeHumanHandoffFinalAnswer(
    command: AnswerPendingInputCommand,
    runRecord: RequestRunRecord,
    pending: PendingInputRecord,
  ): Promise<void> {
    const content = this.humanHandoffAnswerContent(pending);
    if (content === undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Human handoff final answer is unavailable.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const submitCommand = this.toPendingInputSubmitCommand(command, pending);
    await this.commitTerminal(
      submitCommand,
      this.toRuntimeRun(runRecord),
      this.toPendingInputTerminalContext(submitCommand, runRecord, pending),
      content,
      'COMPLETED',
      {
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${pending.requestRunId}:pending-input-handoff-final-terminal:${pending.pendingInputId}`),
        idempotencySemantic: JSON.stringify(['pending-input-handoff-final-terminal-v1', pending.pendingInputId, content]),
      },
    );
    this.leaveExecutingRun(runRecord.runId);
    this.wakeScheduler();
  }

  private async resumeAuthorizedRun(command: AnswerPendingInputCommand, pending: PendingInputRecord): Promise<void> {
    const authorizationScope = pending.authorizationScope;
    if (authorizationScope === undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_SCOPE_MISSING',
        message: 'Authorization scope is missing for the pending input.',
        category: 'INTERNAL',
        retryable: false,
      });
    }
    const runRecord = await this.deps.requestRunStore.loadRun({
      tenantId: pending.tenantId,
      subjectId: pending.subjectId,
      agentId: pending.agentId,
      runId: pending.requestRunId,
    });
    if (runRecord === undefined || this.isTerminalRunStatus(runRecord.status)) {
      throw new AgentError({
        code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
        message: 'Authorized run cannot be resumed.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
      tenantId: pending.tenantId,
      subjectId: pending.subjectId,
      agentId: pending.agentId,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      runId: pending.requestRunId,
    });
    const messages = await this.deps.messageStore.listCurrentRequestMessages({
      tenantId: pending.tenantId,
      subjectId: pending.subjectId,
      agentId: pending.agentId,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      runId: pending.requestRunId,
      includeHidden: true,
      offset: 0,
      limit: 100,
    });
    const resumeCommand = this.toPendingInputSubmitCommand(command, pending);
    const context = await this.reconstructRecoveryContext(runRecord, resumeCommand, 'BEFORE_CAPABILITY_INVOKE', checkpoint, messages.items);
    const queued = await this.deps.requestRunStore.saveRun(
      {
        ...runRecord,
        status: 'QUEUED',
        version: runRecord.version + 1,
        updatedAt: this.now(),
      },
      {
        expectedVersion: runRecord.version,
      },
    );
    if (queued.status !== 'UPDATED' || queued.record === undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_RESUME_CONFLICT',
        message: 'Authorized run could not be resumed.',
        category: 'CONFLICT',
        retryable: true,
      });
    }
    const laneKey = this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId);
    this.enqueueWork({
      command: resumeCommand,
      run: this.toRuntimeRun(queued.record),
      context: {
        ...context,
        flowVariables: {
          ...context.flowVariables,
          [riskPolicyAuthorizationKey]: {
            pendingInputId: pending.pendingInputId,
            operationId: authorizationScope.operationId,
          },
        },
      },
      laneKey,
    });
    this.wakeScheduler();
  }

  private async resumePendingRun(command: AnswerPendingInputCommand, pending: PendingInputRecord): Promise<void> {
    let record: RequestRunRecord | undefined;
    try {
      record = await this.deps.requestRunStore.loadRun({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        runId: pending.requestRunId,
      });
      if (record === undefined || this.isTerminalRunStatus(record.status)) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input owning run cannot be resumed.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        runId: pending.requestRunId,
      });
      if (checkpoint === undefined) {
        throw new AgentError({
          code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
          message: 'Pending input checkpoint is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const messages = await this.deps.messageStore.listCurrentRequestMessages({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        runId: pending.requestRunId,
        includeHidden: true,
        offset: 0,
        limit: 100,
      });
      const resumeCommand = this.toPendingInputSubmitCommand(command, pending);
      const stage =
        pending.producerRef.kind === 'LIFECYCLE_HOOK' && pending.producerRef.stage !== undefined
          ? pending.producerRef.stage
          : this.stageFromCheckpoint(checkpoint);
      let context = await this.reconstructRecoveryContext(record, resumeCommand, stage, checkpoint, messages.items);
      if (
        pending.producerRef.kind === 'LIFECYCLE_HOOK' &&
        stage === 'BEFORE_CAPABILITY_INVOKE' &&
        context.toolCallStates.length === 0 &&
        pending.producerRef.toolCall !== undefined
      ) {
        context = {
          ...context,
          toolCallStates: [
            {
              toolCallId: pending.producerRef.toolCall.toolCallId,
              capabilityId: pending.producerRef.toolCall.capabilityId,
              arguments: pending.producerRef.toolCall.arguments,
              status: 'PENDING',
            },
          ],
        };
      }
      if (pending.producerRef.kind === 'LIFECYCLE_HOOK') {
        const resumedContext: RequestContext = {
          ...context,
          flowVariables: {
            ...context.flowVariables,
            pendingHookResume: {
              stage,
              pendingInputId: pending.pendingInputId,
              answers: pending.responseAnswers ?? [],
              pendingAnswerSummary: summarizePendingAnswers(pending.responseAnswers ?? []),
            },
          },
        };
        if (stage === 'BEFORE_AGENT_TERMINAL') {
          const terminalStatus = this.recoveredTerminalStatusFromContext(resumedContext, record);
          const events = await this.deps.timelineStore.listEvents({
            tenantId: pending.tenantId,
            subjectId: pending.subjectId,
            agentId: pending.agentId,
            sessionId: pending.sessionId,
            afterSequence: brand<number, 'TimelineSequence'>(0),
            limit: maxReplayBatchEvents,
            runId: pending.requestRunId,
          });
          const content = this.recoveredTerminalContent(terminalStatus, events, resumedContext);
          if (content === undefined) {
            throw new AgentError({
              code: 'PENDING_INPUT_RESUME_UNAVAILABLE',
              message: 'Pending terminal resume content is unavailable.',
              category: 'UNAVAILABLE',
              retryable: true,
            });
          }
          const resumedRun = this.toRuntimeRun(record);
          const terminalResumeBoundary = {
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            requestRunId: pending.requestRunId,
            agentId: pending.agentId,
            agentVersion: record.agentVersion,
            safeTerminalSummary: content,
            finalContent: content,
            toolCalls: [],
            pendingInputId: pending.pendingInputId,
            pendingAnswerSummary: summarizePendingAnswers(pending.responseAnswers ?? []),
          } as HookBoundary & { readonly finalContent: string };
          const terminalBoundary = await this.lifecycleHookStageExecutor.invokeStage(
            this.hookScope(resumedRun, resumedContext, 'BEFORE_AGENT_TERMINAL', `resume:${pending.pendingInputId}`),
            'BEFORE_AGENT_TERMINAL',
            terminalResumeBoundary,
          );
          this.markTerminalLifecycleHookApplied(resumedContext);
          await this.commitTerminal(
            resumeCommand,
            resumedRun,
            resumedContext,
            terminalBoundary.boundary.finalContent,
            terminalStatus,
            this.terminalCommitOptionsFromRecord(record),
          );
          return;
        }
        const resumedRun = this.toRuntimeRun(record);
        const controller = new AbortController();
        const executionState: ExecutingRunState = {
          controller,
          superseded: false,
          canceling: false,
          canceled: false,
          pendingInput: false,
          terminalized: false,
        };
        this.drainingLanes.add(this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId));
        this.enterExecutingRun(resumeCommand, resumedRun, executionState);
        await this.executeQueuedWork(
          {
            command: resumeCommand,
            run: resumedRun,
            context: resumedContext,
            laneKey: this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId),
          },
          executionState,
          { resumeExecuting: true },
        );
        return;
      }
      if (pending.producerRef.kind === 'WORKFLOW_NODE') {
        context = this.attachWorkflowPendingResume(context, pending);
      }
      const resumedRun = this.toRuntimeRun(record);
      if (pending.producerRef.kind === 'CAPABILITY_INVOCATION') {
        context = this.markMaterializedCapabilityProducersSucceeded(context, messages.items);
        if (!this.hasMaterializedPendingCapabilityResult(messages.items, pending)) {
          await this.materializePendingCapabilityResult(record, pending, resumedRun, context);
        }
        context = this.markPendingCapabilityProducerSucceeded(context, pending);
      }
      const controller = new AbortController();
      const executionState: ExecutingRunState = {
        controller,
        superseded: false,
        canceling: false,
        canceled: false,
        pendingInput: false,
        terminalized: false,
      };
      this.drainingLanes.add(this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId));
      this.enterExecutingRun(resumeCommand, resumedRun, executionState);
      await this.executeQueuedWork(
        {
          command: resumeCommand,
          run: resumedRun,
          context,
          laneKey: this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId),
        },
        executionState,
        { resumeExecuting: true },
      );
    } catch (error) {
      await this.failPendingInputResume(command, pending, record).catch(() => undefined);
      throw error;
    }
  }

  private async materializePendingCapabilityResult(
    record: RequestRunRecord,
    pending: PendingInputRecord,
    run: RequestRun,
    context: RequestContext,
  ): Promise<void> {
    if (pending.producerRef.kind !== 'CAPABILITY_INVOCATION') {
      return;
    }
    const toolCallId = pending.producerRef.toolCallId;
    const toolName = String(pending.producerRef.capabilityId);
    const resolvedAnswers = pending.kind === 'QUESTION' && pending.responseAnswers !== undefined ? resolvePendingQuestionAnswers(pending) : undefined;
    const answerInstruction = pendingQuestionAnswerInstruction(resolvedAnswers, pending.responseAnswerKinds);
    const payload: JsonObject = {
      status: 'RECEIVED',
      pendingInputId: pending.pendingInputId,
      kind: pending.kind,
      safeSummary: 'Pending input answer received.',
      ...(pending.kind === 'QUESTION' && pending.responseAnswers !== undefined
        ? {
            answers: pending.responseAnswers,
            ...(pending.responseAnswerKinds === undefined ? {} : { answerKinds: pending.responseAnswerKinds }),
            resolvedAnswers: resolvedAnswers ?? [],
            ...(answerInstruction === undefined ? {} : { instruction: answerInstruction }),
          }
        : {}),
      ...(this.isHumanHandoffResumeInstruction(pending) ? { resumeInstruction: this.humanHandoffAnswerContent(pending) ?? '' } : {}),
    };
    const pendingResultContent = JSON.stringify({
      toolCallId,
      toolName,
      payload,
    });
    const pendingResultMetadata: JsonObject = { kind: 'CAPABILITY_RESULT', toolCallId, toolName };
    const resultMessage = await this.deps.messageStore.appendSessionMessage(
      {
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        messageId: brand<string, 'MessageId'>(this.id('message')),
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        runId: pending.requestRunId,
        role: 'CAPABILITY_RESULT',
        content: pendingResultContent,
        contentType: 'PLAIN_TEXT',
        metadata: pendingResultMetadata,
        visible: true,
        createdAt: this.now(),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>(`${record.runId}:pending-input-capability-result:${pending.pendingInputId}`) },
    );
    if (toolName === 'AskUserQuestion' && pending.kind === 'QUESTION' && pending.responseAnswers !== undefined) {
      await this.runState.emitEvent(run, context, {
        type: 'CAPABILITY_RESULT_DELTA',
        inlinePayload: {
          capabilityId: toolName,
          toolCallId,
          pendingInputId: pending.pendingInputId,
          kind: pending.kind,
          status: 'RECEIVED',
          safeSummary: 'Pending input answer received.',
          answers: pending.responseAnswers,
        },
      });
    }
    await this.runState.emitEvent(run, context, {
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: {
        messageId: resultMessage.messageId,
        capabilityId: toolName,
        toolCallId,
        status: 'SUCCEEDED',
      },
    });
  }

  private hasMaterializedPendingCapabilityResult(messages: readonly SessionMessageRecord[], pending: PendingInputRecord): boolean {
    if (pending.producerRef.kind !== 'CAPABILITY_INVOCATION') {
      return false;
    }
    const { capabilityId, toolCallId } = pending.producerRef;
    return messages.some(
      (message) =>
        message.role === 'CAPABILITY_RESULT' &&
        message.metadata['kind'] === 'CAPABILITY_RESULT' &&
        message.metadata['toolCallId'] === toolCallId &&
        message.metadata['toolName'] === capabilityId &&
        this.readMaterializedPendingInputId(message.content) === pending.pendingInputId,
    );
  }

  private readMaterializedPendingInputId(content: string): string | undefined {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!isJsonObjectValue(parsed) || !isJsonObjectValue(parsed['payload'])) {
        return undefined;
      }
      const pendingInputId = parsed['payload']['pendingInputId'];
      return typeof pendingInputId === 'string' && pendingInputId.length > 0 ? pendingInputId : undefined;
    } catch {
      return undefined;
    }
  }

  private markPendingCapabilityProducerSucceeded(context: RequestContext, pending: PendingInputRecord): RequestContext {
    if (pending.producerRef.kind !== 'CAPABILITY_INVOCATION') {
      return context;
    }
    const producerRef = pending.producerRef;
    return {
      ...context,
      toolCallStates: context.toolCallStates.map((toolCall) =>
        toolCall.toolCallId === producerRef.toolCallId ? { ...toolCall, status: 'SUCCEEDED' as const } : toolCall,
      ),
    };
  }

  private attachWorkflowPendingResume(context: RequestContext, pending: PendingInputRecord): RequestContext {
    if (pending.producerRef.kind !== 'WORKFLOW_NODE') {
      return context;
    }
    return {
      ...context,
      flowVariables: {
        ...context.flowVariables,
        workflowPendingResume: {
          recipeName: pending.producerRef.recipeName,
          nodeId: pending.producerRef.nodeId,
          nodeType: pending.producerRef.nodeType,
          pendingInputId: pending.pendingInputId,
          answers: pending.responseAnswers ?? [],
          pendingAnswerSummary: summarizePendingAnswers(pending.responseAnswers ?? []),
        },
      },
    };
  }

  private attachWorkflowPendingTimeoutResume(context: RequestContext, pending: PendingInputRecord): RequestContext {
    if (pending.producerRef.kind !== 'WORKFLOW_NODE') {
      return context;
    }
    return {
      ...context,
      flowVariables: {
        ...context.flowVariables,
        workflowPendingResume: {
          recipeName: pending.producerRef.recipeName,
          nodeId: pending.producerRef.nodeId,
          nodeType: pending.producerRef.nodeType,
          pendingInputId: pending.pendingInputId,
        },
      },
    };
  }

  private async resumePendingInputTimeout(command: SubmitRequestCommand, runRecord: RequestRunRecord, pending: PendingInputRecord): Promise<boolean> {
    const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
      tenantId: pending.tenantId,
      subjectId: pending.subjectId,
      agentId: pending.agentId,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      runId: pending.requestRunId,
    });
    if (checkpoint === undefined) {
      await this.commitTerminal(
        command,
        this.toRuntimeRun(runRecord),
        this.toPendingInputTerminalContext(command, runRecord, pending, { skipTerminalLifecycleHook: true }),
        'Request failed safely: PENDING_INPUT_TIMEOUT',
        'FAILED',
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>(`${pending.requestRunId}:pending-input-timeout-terminal:${pending.pendingInputId}`),
          idempotencySemantic: JSON.stringify(['pending-input-timeout-terminal-v1', pending.pendingInputId]),
          failureReason: { code: 'PENDING_INPUT_TIMEOUT' },
        },
      );
      this.leaveExecutingRun(runRecord.runId);
      this.wakeScheduler();
      return true;
    }
    const stage = this.stageFromCheckpoint(checkpoint);
    const messages =
      stage === 'BEFORE_CAPABILITY_INVOKE'
        ? await this.deps.messageStore.listCurrentRequestMessages({
            tenantId: pending.tenantId,
            subjectId: pending.subjectId,
            agentId: pending.agentId,
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            runId: pending.requestRunId,
            includeHidden: true,
            offset: 0,
            limit: 100,
          })
        : undefined;
    const workflowTargetRecipe = pending.producerRef.kind === 'WORKFLOW_NODE' ? pending.producerRef.recipeName : undefined;
    const resumeCommand: SubmitRequestCommand =
      workflowTargetRecipe === undefined ? { ...command } : { ...command, routingConstraints: { targetRecipe: workflowTargetRecipe } };
    let context = await this.reconstructRecoveryContext(runRecord, resumeCommand, stage, checkpoint, messages?.items ?? []);
    context = this.attachWorkflowPendingTimeoutResume(context, pending);
    const queuedRecord: RequestRunRecord = {
      ...runRecord,
      status: 'QUEUED' as const,
      version: runRecord.version + 1,
      updatedAt: this.now(),
    };
    const saved = await this.deps.requestRunStore.saveRun(queuedRecord, { expectedVersion: runRecord.version });
    if (saved.status !== 'UPDATED' || saved.record === undefined) {
      await this.commitTerminal(
        command,
        this.toRuntimeRun(runRecord),
        this.toPendingInputTerminalContext(command, runRecord, pending, { skipTerminalLifecycleHook: true }),
        'Request failed safely: PENDING_INPUT_TIMEOUT',
        'FAILED',
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>(`${pending.requestRunId}:pending-input-timeout-terminal:${pending.pendingInputId}`),
          idempotencySemantic: JSON.stringify(['pending-input-timeout-terminal-v1', pending.pendingInputId]),
          failureReason: { code: 'PENDING_INPUT_TIMEOUT' },
        },
      );
      this.leaveExecutingRun(runRecord.runId);
      this.wakeScheduler();
      return true;
    }
    this.enqueueWork({
      command: resumeCommand,
      run: this.toRuntimeRun(saved.record),
      context,
      laneKey: this.laneKey(pending.tenantId, pending.subjectId, pending.agentId, pending.sessionId),
    });
    return true;
  }

  private markMaterializedCapabilityProducersSucceeded(context: RequestContext, messages: readonly SessionMessageRecord[]): RequestContext {
    const succeededToolCallIds = new Set(
      messages.flatMap((message) =>
        message.role === 'CAPABILITY_RESULT' && message.metadata['kind'] === 'CAPABILITY_RESULT' && typeof message.metadata['toolCallId'] === 'string'
          ? [message.metadata['toolCallId']]
          : [],
      ),
    );
    if (succeededToolCallIds.size === 0) {
      return context;
    }
    return {
      ...context,
      toolCallStates: context.toolCallStates.map((toolCall) =>
        succeededToolCallIds.has(toolCall.toolCallId) ? { ...toolCall, status: 'SUCCEEDED' as const } : toolCall,
      ),
    };
  }

  private async failPendingInputResume(command: AnswerPendingInputCommand, pending: PendingInputRecord, record?: RequestRunRecord): Promise<void> {
    if (record === undefined || this.isTerminalRunStatus(record.status)) {
      return;
    }
    const run = this.toRuntimeRun(record);
    const submitCommand = this.toPendingInputSubmitCommand(command, pending);
    const context: RequestContext = {
      requestContextId: pending.requestContextId,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      runId: pending.requestRunId,
      identityContext: command.identityContext,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: pending.agentId,
      agentVersion: record.agentVersion,
      agentAssemblyRef: record.agentAssemblyRef,
      agentTurnIndex: 0,
      nextLifecycleStage: 'BEFORE_AGENT_TERMINAL',
      toolCallStates: [],
      flowVariables: {},
    };
    await this.commitTerminal(submitCommand, run, context, 'Request failed safely: PENDING_INPUT_RESUME_UNAVAILABLE', 'FAILED');
    this.leaveExecutingRun(run.runId);
    this.wakeScheduler();
  }

  private async emitPendingInputEvent(
    command: Pick<AnswerPendingInputCommand, 'identityContext' | 'idempotencyKey'> | RequestControlCommand,
    run: Pick<RequestRun, 'agentVersion' | 'agentAssemblyRef'> | RequestRunRecord,
    pending: PendingInputRecord,
    type: 'USER_INPUT_RECEIVED' | 'USER_INPUT_CANCELED' | 'USER_INPUT_TIMEOUT',
    payload: JsonObject,
  ): Promise<void> {
    const emitCommand = this.toPendingInputSubmitCommand(command, pending);
    const context: RequestContext = {
      requestContextId: pending.requestContextId,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      runId: pending.requestRunId,
      identityContext: command.identityContext,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: pending.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      agentTurnIndex: 0,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    await this.emitCanonical(
      emitCommand,
      context,
      {
        type,
        inlinePayload: {
          pendingInputId: pending.pendingInputId,
          id: pending.pendingInputId,
          kind: pending.kind,
          ...payload,
        },
      },
      brand<string, 'IdempotencyKey'>(`${pending.requestRunId}:pending-input-event:${type}:${pending.pendingInputId}`),
    );
  }

  private toPendingInputTerminalContext(
    command: SubmitRequestCommand,
    run: RequestRunRecord,
    pending: PendingInputRecord,
    options: { readonly skipTerminalLifecycleHook?: boolean } = {},
  ): RequestContext {
    return {
      requestContextId: pending.requestContextId,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      runId: pending.requestRunId,
      identityContext: command.identityContext,
      locale: command.locale,
      agentId: pending.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      agentTurnIndex: 0,
      nextLifecycleStage: 'BEFORE_AGENT_TERMINAL',
      toolCallStates: [],
      flowVariables: options.skipTerminalLifecycleHook === true ? { [skipTerminalLifecycleHookKey]: true } : {},
    };
  }

  private toPendingInputSubmitCommand(
    command: Pick<AnswerPendingInputCommand, 'identityContext' | 'idempotencyKey'> | RequestControlCommand,
    pending: PendingInputRecord,
  ): SubmitRequestCommand {
    return {
      sessionId: pending.sessionId,
      identityContext: command.identityContext,
      inputText: '',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: command.idempotencyKey,
      ...(pending.producerRef.kind !== 'WORKFLOW_NODE'
        ? {}
        : {
            routingConstraints: {
              targetRecipe: pending.producerRef.recipeName,
            },
          }),
    };
  }

  private assertValidPendingInputAnswer(
    pending: PendingInputRecord,
    answers: unknown,
    answerKinds?: readonly PendingInputQuestionAnswerKind[],
  ): asserts answers is ReadonlyArray<readonly string[]> {
    const expectedAnswerCount = isWorkflowInterruptPendingInput(pending)
      ? 1
      : pending.kind === 'HUMAN_HANDOFF'
        ? 2
        : pending.request.questions.length;
    if (!Array.isArray(answers) || answers.length !== expectedAnswerCount) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Pending input answer does not match the accepted question shape.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (answerKinds !== undefined && (pending.kind !== 'QUESTION' || answerKinds.length !== expectedAnswerCount)) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Pending input answer kinds do not match the accepted QUESTION shape.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    for (let index = 0; index < answers.length; index += 1) {
      const entry = answers[index];
      if (!Array.isArray(entry) || entry.some((value) => typeof value !== 'string')) {
        throw new AgentError({
          code: 'PENDING_INPUT_ANSWER_INVALID',
          message: 'Pending input answer entries must be ordered string arrays.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      if (isWorkflowInterruptPendingInput(pending)) {
        continue;
      }
      if (pending.kind === 'CONFIRMATION' || pending.kind === 'AUTHORIZATION' || pending.kind === 'HUMAN_HANDOFF') {
        continue;
      }
      this.assertValidPendingInputAnswerEntry(pending.request.questions[index]!, entry, answerKinds?.[index]);
    }
    if (pending.kind === 'CONFIRMATION') {
      this.assertValidBinaryPendingInputAnswer(answers, 'reject', 'Confirmation pending input answers must be exactly approve or reject.');
    }
    if (pending.kind === 'AUTHORIZATION') {
      this.assertValidBinaryPendingInputAnswer(answers, 'deny', 'Authorization pending input answers must be exactly approve or deny.');
    }
    if (pending.kind === 'HUMAN_HANDOFF') {
      this.assertValidHumanHandoffAnswer(answers);
    }
    if (isWorkflowInterruptPendingInput(pending)) {
      const resumeAnswer = answers[0];
      if (resumeAnswer?.length !== 1 || resumeAnswer[0] !== 'resume') {
        throw new AgentError({
          code: 'PENDING_INPUT_ANSWER_INVALID',
          message: 'Workflow interrupt answers must be exactly resume.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
    }
  }

  private assertValidPendingInputAnswerEntry(
    question: PendingInputRecord['request']['questions'][number],
    values: readonly string[],
    answerKind?: PendingInputQuestionAnswerKind,
  ): void {
    if (
      answerKind !== undefined &&
      answerKind !== 'TEXT' &&
      answerKind !== 'OPTION_SELECTION' &&
      answerKind !== 'OPTION_ATTACHED_TEXT' &&
      answerKind !== 'CUSTOM_TEXT' &&
      answerKind !== 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT'
    ) {
      this.throwInvalidQuestionAnswerKind();
    }
    const hasEmptyValue = values.some((value) => value.trim().length === 0);
    if (hasEmptyValue) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Pending input answer values must be non-empty.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (question.options.length === 0) {
      if (values.length !== 1 || (answerKind !== undefined && answerKind !== 'TEXT')) {
        throw new AgentError({
          code: 'PENDING_INPUT_ANSWER_INVALID',
          message: 'Text pending input answers must contain exactly one value.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      return;
    }
    if (answerKind === 'TEXT') {
      this.throwInvalidQuestionAnswerKind();
    }
    const optionsByValue = new Map(question.options.map((option) => [option.value, option]));
    if (answerKind === 'CUSTOM_TEXT') {
      if (values.length !== 1) {
        this.throwInvalidQuestionAnswerKind();
      }
      return;
    }
    if (answerKind === 'OPTION_ATTACHED_TEXT') {
      const selectedOption = optionsByValue.get(values[0] ?? '');
      if (question.multiple === true || selectedOption?.requiresTextInput !== true || values.length !== 2 || values[1]!.length > 500) {
        this.throwInvalidQuestionAnswerKind();
      }
      return;
    }
    if (answerKind === 'OPTION_SELECTION') {
      if (
        values.length === 0 ||
        (question.multiple !== true && values.length !== 1) ||
        new Set(values).size !== values.length ||
        values.some((value) => {
          const option = optionsByValue.get(value);
          return option === undefined || option.requiresTextInput === true;
        })
      ) {
        this.throwInvalidQuestionAnswerKind();
      }
      return;
    }
    if (answerKind === 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT') {
      const selectionValues = values.slice(0, -1);
      if (
        question.multiple !== true ||
        values.length < 2 ||
        selectionValues.length === 0 ||
        new Set(selectionValues).size !== selectionValues.length ||
        selectionValues.some((value) => !optionsByValue.has(value))
      ) {
        this.throwInvalidQuestionAnswerKind();
      }
      return;
    }
    if (question.multiple !== true) {
      const selectedOption = question.options.find((option) => option.value === values[0]);
      if (selectedOption?.requiresTextInput === true) {
        if (values.length !== 2 || values[1]!.trim().length === 0 || values[1]!.length > 500) {
          throw new AgentError({
            code: 'PENDING_INPUT_ANSWER_INVALID',
            message: 'Option-attached text answers must contain the selected option and one bounded text value.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        return;
      }
    }
    if (question.multiple !== true && values.length !== 1) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Single-select pending input answers must contain exactly one value.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (question.multiple === true && values.length === 0) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Multi-select pending input answers must contain at least one value.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (question.multiple === true && new Set(values).size !== values.length) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Multi-select pending input answers must contain unique values.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const allowed = new Set(question.options.map((option) => option.value));
    const customValues = values.filter((value) => !allowed.has(value));
    if (customValues.length > 1) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Pending input answer contains more than one custom value.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }

  private throwInvalidQuestionAnswerKind(): never {
    throw new AgentError({
      code: 'PENDING_INPUT_ANSWER_INVALID',
      message: 'Pending input answer kind does not match the accepted question and answer values.',
      category: 'VALIDATION',
      retryable: false,
    });
  }

  private assertValidBinaryPendingInputAnswer(answers: ReadonlyArray<readonly string[]>, negativeValue: 'reject' | 'deny', message: string): void {
    if (answers.length !== 1 || answers[0]?.length !== 1 || (answers[0][0] !== 'approve' && answers[0][0] !== negativeValue)) {
      throw new AgentError({ code: 'PENDING_INPUT_ANSWER_INVALID', message, category: 'VALIDATION', retryable: false });
    }
  }

  private assertValidHumanHandoffAnswer(answers: ReadonlyArray<readonly string[]>): void {
    const mode = answers[0]?.[0];
    const content = answers[1]?.[0];
    if (
      answers.length !== 2 ||
      answers[0]?.length !== 1 ||
      answers[1]?.length !== 1 ||
      (mode !== 'final_answer' && mode !== 'resume_instruction') ||
      typeof content !== 'string' ||
      content.trim().length === 0
    ) {
      throw new AgentError({
        code: 'PENDING_INPUT_ANSWER_INVALID',
        message: 'Human handoff answers must contain a mode and non-empty content.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }

  private isConfirmationReject(pending: PendingInputRecord): boolean {
    return (
      pending.kind === 'CONFIRMATION' &&
      pending.responseAnswers?.length === 1 &&
      pending.responseAnswers[0]?.length === 1 &&
      pending.responseAnswers[0][0] === 'reject'
    );
  }

  private isAuthorizationDeny(pending: PendingInputRecord): boolean {
    return (
      pending.kind === 'AUTHORIZATION' &&
      pending.responseAnswers?.length === 1 &&
      pending.responseAnswers[0]?.length === 1 &&
      pending.responseAnswers[0][0] === 'deny'
    );
  }

  private isHumanHandoffFinalAnswer(pending: PendingInputRecord): boolean {
    return pending.kind === 'HUMAN_HANDOFF' && pending.responseAnswers?.[0]?.[0] === 'final_answer';
  }

  private isHumanHandoffResumeInstruction(pending: PendingInputRecord): boolean {
    return pending.kind === 'HUMAN_HANDOFF' && pending.responseAnswers?.[0]?.[0] === 'resume_instruction';
  }

  private humanHandoffAnswerContent(pending: PendingInputRecord): string | undefined {
    const content = pending.responseAnswers?.[1]?.[0];
    return typeof content === 'string' ? content : undefined;
  }

  private pendingInputResolveSemantic(
    pendingInputId: PendingInputRecord['pendingInputId'],
    status: 'RECEIVED',
    answers: ReadonlyArray<readonly string[]>,
    answerKinds?: readonly PendingInputQuestionAnswerKind[],
  ): string {
    return answerKinds === undefined
      ? JSON.stringify(['pending-input-resolve-v1', pendingInputId, status, answers])
      : JSON.stringify(['pending-input-resolve-v2', pendingInputId, status, answers, answerKinds]);
  }

  private pendingInputTimeoutResolveSemantic(pendingInputId: PendingInputRecord['pendingInputId']): string {
    return JSON.stringify(['pending-input-resolve-v1', pendingInputId, 'TIMED_OUT']);
  }

  private isApprovedAuthorizationAnswer(answers: ReadonlyArray<readonly string[]>): boolean {
    return answers.some((group) => group.includes('approve'));
  }

  private wakeScheduler(options: { readonly releaseBlockedLanes?: boolean } = {}): void {
    if (options.releaseBlockedLanes !== false) {
      this.blockedLanes.clear();
    }
    if (this.recoveryDispatchGated || this.schedulerRunning) {
      return;
    }
    this.schedulerRunning = true;
    void this.runSchedulerLoop();
  }

  private async runSchedulerLoop(): Promise<void> {
    try {
      while (this.executingRuns.size + this.inflightCount < this.maxConcurrentRuns()) {
        const reservation = this.reserveNextWork();
        if (reservation === undefined) {
          break;
        }
        void this.dispatchReservedWork(reservation);
      }
    } finally {
      this.schedulerRunning = false;
      if (!this.recoveryDispatchGated && this.executingRuns.size + this.inflightCount < this.maxConcurrentRuns() && this.hasDispatchableWork()) {
        this.wakeScheduler();
      }
    }
  }

  private reserveNextWork(): QueuedRunReservation | undefined {
    let selected: { laneKey: string; work: QueuedRunWork; rank: number } | undefined;
    for (const [laneKey, queue] of this.pendingLaneWork) {
      if (this.drainingLanes.has(laneKey) || this.blockedLanes.has(laneKey)) {
        continue;
      }
      const work = queue[0];
      if (work === undefined) {
        this.pendingLaneWork.delete(laneKey);
        continue;
      }
      const rank = this.priorityRank(work.run.priority ?? 'NORMAL');
      if (selected === undefined || rank > selected.rank) {
        selected = { laneKey, work, rank };
      }
    }
    if (selected === undefined) {
      return undefined;
    }
    const queue = this.pendingLaneWork.get(selected.laneKey);
    queue?.shift();
    if (queue === undefined || queue.length === 0) {
      this.pendingLaneWork.delete(selected.laneKey);
    }
    this.drainingLanes.add(selected.laneKey);
    this.inflightCount += 1;
    return { laneKey: selected.laneKey, work: selected.work };
  }

  private async dispatchReservedWork(reservation: QueuedRunReservation): Promise<void> {
    const { laneKey, work } = reservation;
    const releaseBeforeExecution = (options: { readonly blockLane?: boolean } = {}) => {
      this.inflightCount = Math.max(0, this.inflightCount - 1);
      this.drainingLanes.delete(laneKey);
      if (options.blockLane === true) {
        this.blockedLanes.add(laneKey);
      }
      this.wakeScheduler({ releaseBlockedLanes: false });
    };
    let executionStarted = false;
    try {
      const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
        tenantId: work.command.identityContext.tenantId,
        subjectId: work.command.identityContext.subjectId,
        agentId: work.run.agentId,
        sessionId: work.run.sessionId,
      });
      if (snapshot.terminalPendingRun !== undefined || (snapshot.executingRun !== undefined && snapshot.executingRun.runId !== work.run.runId)) {
        const queue = this.pendingLaneWork.get(laneKey) ?? [];
        queue.unshift(work);
        this.pendingLaneWork.set(laneKey, queue);
        releaseBeforeExecution({ blockLane: true });
        return;
      }
      const durable = snapshot.queuedRuns.find((run) => run.runId === work.run.runId);
      if (durable === undefined) {
        releaseBeforeExecution();
        return;
      }
      const run = await this.startRun(work.command, this.toRuntimeRun(durable));
      const controller = new AbortController();
      const executionState: ExecutingRunState = {
        controller,
        superseded: false,
        canceling: false,
        canceled: false,
        pendingInput: false,
        terminalized: false,
      };
      this.inflightCount = Math.max(0, this.inflightCount - 1);
      this.enterExecutingRun(work.command, run, executionState, true);
      this.blockedLanes.delete(laneKey);
      executionStarted = true;
      await this.executeQueuedWork({ ...work, run }, executionState);
    } catch (error) {
      if (!executionStarted) {
        logger.error({
          err: error,
          event: 'runtime.scheduler.dispatch_failed',
          agentId: work.run.agentId,
          sessionId: work.run.sessionId,
          requestId: work.run.requestId,
          runId: work.run.runId,
          failureStage: 'SCHEDULER_DISPATCH',
          recoveryCode: this.toRecoveryCode(error),
        });
      }
      releaseBeforeExecution();
    }
  }

  private isIdle(): boolean {
    if (this.drainingLanes.size > 0 || this.executingRuns.size > 0 || this.inflightCount > 0 || this.schedulerRunning) {
      return false;
    }
    for (const queue of this.pendingLaneWork.values()) {
      if (queue.length > 0) {
        return false;
      }
    }
    return true;
  }

  private hasDispatchableWork(): boolean {
    for (const [laneKey, queue] of this.pendingLaneWork) {
      if (!this.drainingLanes.has(laneKey) && !this.blockedLanes.has(laneKey) && queue.length > 0) {
        return true;
      }
    }
    return false;
  }

  private maxConcurrentRuns(): number {
    const configured = this.deps.scheduler?.maxConcurrent;
    return configured === undefined ? Number.POSITIVE_INFINITY : Math.max(1, Math.trunc(configured));
  }

  private priorityRank(priority: RequestPriority): number {
    return priority === 'HIGH' ? 3 : priority === 'NORMAL' ? 2 : 1;
  }

  private async executeQueuedWork(
    work: QueuedRunWork,
    executionState: ExecutingRunState,
    options: { readonly resumeExecuting?: boolean } = {},
  ): Promise<void> {
    const execute = () => this.executeQueuedWorkCorrelated(work, executionState, options);
    return this.deps.executionCorrelation === undefined
      ? execute()
      : this.deps.executionCorrelation.withExecutionRef(
          {
            requestRunId: work.run.runId,
            kind: 'REQUEST',
            executionId: work.run.runId,
          },
          execute,
        );
  }

  private async executeQueuedWorkCorrelated(
    work: QueuedRunWork,
    executionState: ExecutingRunState,
    options: { readonly resumeExecuting?: boolean } = {},
  ): Promise<void> {
    const run = work.run;
    if (options.resumeExecuting !== true) {
      logger.info({
        event: 'runtime.run.dispatched',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        laneKey: work.laneKey,
        runCreatedAtMs: Number(run.createdAt),
      });
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let finishedTerminalStatus: RequestRun['status'] | undefined;
    let finishedSafeReasonCode: string | undefined;
    try {
      const assembly = await this.deps.assemblyRegistry.require(run.agentId, run.agentVersion);
      timeout = setTimeout(() => executionState.controller.abort(), assembly.runtimeSettings.requestTimeoutMs ?? defaultRequestTimeoutMs);
      if (options.resumeExecuting !== true) {
        await this.saveCheckpoint(work.command, run, work.context, 'STEP_STARTED');
      }
      this.runState.beginRun(run);
      const agent = this.agentManager.getOrCreate(assembly);
      const agentOutcome = await agent.execute(run, work.context, executionState.controller.signal);
      if (executionState.canceling || executionState.canceled) {
        const cancelOutput = await this.runState.finishRun(run);
        const cancelContent = hasVisibleTerminalContent(cancelOutput.finalContent) ? cancelOutput.finalContent : 'Request canceled by user.';
        await this.commitTerminal(
          work.command,
          run,
          work.context,
          cancelContent,
          'CANCELED',
          executionState.cancelIdempotencyKey === undefined
            ? {}
            : {
                idempotencyKey: executionState.cancelIdempotencyKey,
                ...(executionState.cancelIdempotencySemantic === undefined ? {} : { idempotencySemantic: executionState.cancelIdempotencySemantic }),
              },
        );
        finishedTerminalStatus = 'CANCELED';
        finishedSafeReasonCode = 'TERMINAL_CANCELED';
        return;
      }
      if (agentOutcome.status === 'PENDING_INPUT') {
        this.runState.discardRun(run);
        executionState.pendingInput = true;
        finishedSafeReasonCode = 'PENDING_INPUT';
        return;
      }
      const output = await this.runState.finishRun(run);
      const capabilityTerminalAnswer = executionState.superseded ? undefined : output.capabilityTerminalAnswer;
      const terminalStatus = executionState.superseded
        ? 'SUPERSEDED'
        : capabilityTerminalAnswer !== undefined
          ? 'COMPLETED'
          : output.outputExceeded
            ? 'FAILED'
            : 'COMPLETED';
      const terminalContent = executionState.superseded
        ? 'Request superseded by a newer request.'
        : (capabilityTerminalAnswer?.content ?? output.finalContent);
      finishedTerminalStatus = terminalStatus;
      finishedSafeReasonCode = terminalReasonCode(terminalStatus);
      logger.debug({
        event: 'runtime.run.terminal_commit_start',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        terminalStatus,
      });
      await this.commitExecutionTerminal(
        work.command,
        run,
        work.context,
        terminalContent,
        terminalStatus,
        capabilityTerminalAnswer === undefined ? {} : { capabilityTerminalAnswer: true },
      );
      logger.debug({
        event: 'runtime.run.terminal_commit_complete',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        terminalStatus,
      });
    } catch (error) {
      if (error instanceof TerminalCommitBoundaryError) {
        throw error;
      }
      const lifecycleInterruption = error instanceof LifecycleHookInterruptionError ? error.interruption : undefined;
      if (lifecycleInterruption?.outcome === 'PEND') {
        this.runState.discardRun(run);
        executionState.pendingInput = true;
        finishedSafeReasonCode = 'LIFECYCLE_HOOK_PENDING';
        return;
      }
      const terminalError = lifecycleInterruption === undefined ? error : agentErrorFromLifecycleHookInterruption(lifecycleInterruption);
      if (executionState.canceling || executionState.canceled) {
        const cancelOutput = await this.runState.finishRun(run);
        const cancelContent = hasVisibleTerminalContent(cancelOutput.finalContent) ? cancelOutput.finalContent : 'Request canceled by user.';
        await this.commitTerminal(
          work.command,
          { ...run, status: 'EXECUTING' },
          work.context,
          cancelContent,
          'CANCELED',
          executionState.cancelIdempotencyKey === undefined
            ? {}
            : {
                idempotencyKey: executionState.cancelIdempotencyKey,
                ...(executionState.cancelIdempotencySemantic === undefined ? {} : { idempotencySemantic: executionState.cancelIdempotencySemantic }),
              },
        );
        finishedTerminalStatus = 'CANCELED';
        finishedSafeReasonCode = 'TERMINAL_CANCELED';
        return;
      }
      if (this.isAuthorizationPendingRequest(terminalError)) {
        this.runState.discardRun(run);
        await this.createAuthorizationPendingInput(work.command, run, work.context, terminalError);
        executionState.pendingInput = true;
        finishedSafeReasonCode = 'AUTHORIZATION_PENDING';
        return;
      }
      if (!(terminalError instanceof AgentError) || terminalError.category === 'INTERNAL') {
        logger.error({
          err: terminalError,
          event: 'request.execution.exception_captured',
          failureStage: 'REQUEST_EXECUTION',
          agentId: run.agentId,
          agentVersion: run.agentVersion,
          sessionId: run.sessionId,
          requestId: run.requestId,
          runId: run.runId,
        });
      }
      const output = await this.runState.finishRun(run);
      const terminalStatus = executionState.superseded ? 'SUPERSEDED' : 'FAILED';
      finishedTerminalStatus = terminalStatus;
      finishedSafeReasonCode = terminalReasonCode(terminalStatus);
      const safeFailureContent = safeErrorContent(terminalError);
      const terminalContent = executionState.superseded ? 'Request superseded by a newer request.' : safeFailureContent;
      const flowVariables = work.context.flowVariables as Record<string, unknown>;
      flowVariables[skipTerminalLifecycleHookKey] = true;
      logger.debug({
        event: 'runtime.run.terminal_commit_start',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        terminalStatus,
      });
      await this.commitExecutionTerminal(
        work.command,
        { ...run, status: 'EXECUTING' },
        work.context,
        terminalContent,
        terminalStatus,
        terminalStatus === 'FAILED' && terminalError instanceof AgentError
          ? { failureReason: { code: terminalError.code, category: terminalError.category } }
          : {},
      );
      logger.debug({
        event: 'runtime.run.terminal_commit_complete',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        terminalStatus,
      });
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      this.leaveExecutingRun(run.runId);
      this.drainingLanes.delete(work.laneKey);
      logger.debug({
        event: 'runtime.run.execution_finished',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        ...(finishedTerminalStatus === undefined ? {} : { terminalStatus: finishedTerminalStatus }),
        ...(finishedSafeReasonCode === undefined ? {} : { safeReasonCode: finishedSafeReasonCode }),
      });
      this.wakeScheduler();
    }
  }

  private async commitExecutionTerminal(
    command: SubmitRequestCommand,
    run: RequestRun,
    context: RequestContext,
    content: string,
    status: Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'>,
    options: RuntimeTerminalCommitOptions = {},
  ): Promise<void> {
    try {
      await this.commitTerminal(command, run, context, content, status, options);
    } catch (error) {
      logger.error({
        err: error,
        event: 'request.terminal_commit.failed',
        failureStage: 'REQUEST_TERMINAL_COMMIT',
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        terminalStatus: status,
      });
      throw new TerminalCommitBoundaryError(error);
    }
  }

  private async rebuildQueuedRun(record: RequestRunRecord): Promise<void> {
    await this.deps.assemblyRegistry.require(record.agentId, record.agentVersion);
    const messages = await this.deps.messageStore.listCurrentRequestMessages({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      requestId: record.requestId,
      runId: record.runId,
      includeHidden: false,
      offset: 0,
      limit: 20,
    });
    const inheritedSource = messages.items.length === 0 ? await this.loadInheritedSourceForAcceptedRun(record) : undefined;
    if (messages.items.length === 0 && inheritedSource === undefined) {
      throw new AgentError({
        code: 'RECOVERY_MISSING_MESSAGES',
        message: 'Recovery cannot rebuild queued run without current request messages.',
        category: 'INTERNAL',
        retryable: false,
      });
    }
    const command = await this.toRecoverySubmitCommand(record);
    const run = this.toRuntimeRun(record);
    const context = await this.reconstructRecoveryContext(record, command, 'BEFORE_MODEL_INVOKE');
    await this.completeRetryVisibilityForRetryRecord(record);
    this.enqueueWork({ command, run, context, laneKey: this.laneKey(record.tenantId, record.subjectId, record.agentId, record.sessionId) });
  }

  private async recoverClaimedExecutingRun(record: RequestRunRecord): Promise<boolean> {
    const command = await this.toRecoverySubmitCommand(record);
    const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      requestId: record.requestId,
      runId: record.runId,
    });
    if (checkpoint === undefined) {
      await this.failRecoveredRun(record, 'RECOVERY_MISSING_CHECKPOINT');
      return true;
    }
    const assembly = await this.deps.assemblyRegistry.require(record.agentId, record.agentVersion).catch(() => {
      throw new AgentError({
        code: 'RECOVERY_MISSING_ASSEMBLY',
        message: 'Recovery cannot resolve the persisted agent assembly.',
        category: 'INTERNAL',
        retryable: false,
      });
    });
    const messages = await this.deps.messageStore.listCurrentRequestMessages({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      requestId: record.requestId,
      runId: record.runId,
      includeHidden: true,
      offset: 0,
      limit: 100,
    });
    const stage = this.stageFromCheckpoint(checkpoint);
    const inheritedSource =
      messages.items.length === 0 && stage === 'BEFORE_MODEL_INVOKE' ? await this.loadInheritedSourceForAcceptedRun(record) : undefined;
    if (messages.items.length === 0 && inheritedSource === undefined) {
      await this.failRecoveredRun(record, 'RECOVERY_MISSING_MESSAGES');
      return true;
    }
    const events = await this.deps.timelineStore.listEvents({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: maxReplayBatchEvents,
      runId: record.runId,
    });
    const activeContext = await this.deps.activeContextStore.loadActiveContext({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
    });
    const checkpointFailure = this.recoveryCheckpointFailureCode(
      record,
      checkpoint,
      stage,
      messages.items,
      events,
      activeContext.state.activeContextVersion,
    );
    if (checkpointFailure !== undefined) {
      await this.failRecoveredRun(record, checkpointFailure);
      return true;
    }
    let context = await this.reconstructRecoveryContext(record, command, stage, checkpoint, messages.items);
    if (stage === 'BEFORE_AGENT_TERMINAL') {
      return this.takeOverTerminalRun(record);
    }
    if (stage === 'BEFORE_CAPABILITY_INVOKE') {
      const assistantToolUse = messages.items.find((message) => message.messageId === context.currentToolBatchMessageId);
      const guard = await evaluateRecoveryToolReplayGuard({
        run: this.toRuntimeRun(record),
        context,
        checkpoint,
        currentRequestMessages: messages.items,
        ...(assistantToolUse === undefined ? {} : { assistantToolUseMessage: assistantToolUse }),
        resolveDescriptor: async (toolCall) =>
          this.deps.capabilityCatalog.resolve({
            tenantId: record.tenantId,
            subjectId: record.subjectId,
            agentAssembly: assembly,
            capabilityId: toolCall.capabilityId,
          }),
        resolveStableIdempotencyKey: (toolCall) => deriveCapabilityInvocationIdempotencyKey(record.runId, toolCall.toolCallId),
      });
      if (guard.status === 'RECOVERY_FAILED') {
        await this.failRecoveredRun(record, guard.safeError.code);
        return true;
      }
      context = this.applyRecoveredToolDecisions(context, guard.decisions);
    }
    const recoveredRun = this.toRuntimeRun(record);
    const controller = new AbortController();
    const executionState: ExecutingRunState = {
      controller,
      superseded: false,
      canceling: false,
      canceled: false,
      pendingInput: false,
      terminalized: false,
    };
    this.drainingLanes.add(this.laneKey(record.tenantId, record.subjectId, record.agentId, record.sessionId));
    this.enterExecutingRun(command, recoveredRun, executionState);
    await this.executeQueuedWork(
      {
        command,
        run: recoveredRun,
        context,
        laneKey: this.laneKey(record.tenantId, record.subjectId, record.agentId, record.sessionId),
      },
      executionState,
    );
    return false;
  }

  private async takeOverTerminalRun(record: RequestRunRecord): Promise<boolean> {
    await this.deps.assemblyRegistry.require(record.agentId, record.agentVersion).catch(() => {
      throw new AgentError({
        code: 'RECOVERY_MISSING_ASSEMBLY',
        message: 'Recovery cannot resolve the persisted agent assembly.',
        category: 'INTERNAL',
        retryable: false,
      });
    });
    const command = await this.toRecoverySubmitCommand(record);
    const events = await this.deps.timelineStore.listEvents({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: maxReplayBatchEvents,
      runId: record.runId,
    });
    const terminalEvent = [...events].reverse().find((event) => this.isTerminalTimelineEvent(event));
    if (terminalEvent !== undefined) {
      return this.reconcileTerminalRunToEvent(record, terminalEvent);
    }
    const status = this.recoveredTerminalStatus(record);
    const content = this.recoveredTerminalContent(status, events);
    if (content === undefined) {
      await this.failRecoveredRun(record, 'RECOVERY_TERMINAL_FACTS_INCONSISTENT');
      return true;
    }
    const context = await this.reconstructRecoveryContext(record, command, 'BEFORE_AGENT_TERMINAL');
    await this.commitTerminal(command, this.toRuntimeRun(record), context, content, status, this.terminalCommitOptionsFromRecord(record));
    return this.failIfTerminalStillUnstable(record);
  }

  private async reconcileTerminalRunToEvent(record: RequestRunRecord, event: RunTimelineEventRecord): Promise<boolean> {
    const status = this.terminalStatusFromEvent(event);
    if (status === undefined) {
      await this.failRecoveredRun(record, 'RECOVERY_TERMINAL_FACTS_INCONSISTENT');
      return true;
    }
    const result = await this.deps.requestRunStore.saveRun(
      {
        ...record,
        status,
        terminalCommitState: 'COMMITTED',
        version: record.version + 1,
        updatedAt: this.now(),
      },
      { expectedVersion: record.version },
    );
    if (result.status === 'UPDATED') {
      this.markRunTerminalized(record.runId);
      return false;
    }
    const durable = await this.deps.requestRunStore.loadRun({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      runId: record.runId,
    });
    if (durable !== undefined && this.isTerminalRunStatus(durable.status) && durable.terminalCommitState === 'COMMITTED') {
      this.markRunTerminalized(record.runId);
      return false;
    }
    return true;
  }

  private async failIfTerminalStillUnstable(record: RequestRunRecord): Promise<boolean> {
    const durable = await this.deps.requestRunStore.loadRun({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      runId: record.runId,
    });
    if (durable !== undefined && this.isTerminalRunStatus(durable.status) && durable.terminalCommitState === 'COMMITTED') {
      return false;
    }
    await this.failRecoveredRun(durable ?? record, 'RECOVERY_TERMINAL_FACTS_INCONSISTENT');
    return true;
  }

  private recoveredTerminalStatus(record: RequestRunRecord): Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'> {
    if (record.status === 'FAILED' || record.status === 'CANCELED' || record.status === 'SUPERSEDED') {
      return record.status;
    }
    return 'COMPLETED';
  }

  private recoveredTerminalStatusFromContext(
    recordContext: RequestContext,
    record: RequestRunRecord,
  ): Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'> {
    return this.terminalHookResumeSnapshot(recordContext)?.terminalStatus ?? this.recoveredTerminalStatus(record);
  }

  private recoveredTerminalContent(
    status: Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'>,
    events: readonly RunTimelineEventRecord[],
    recordContext?: RequestContext,
  ): string | undefined {
    const snapshotContent = recordContext === undefined ? undefined : this.terminalHookResumeSnapshot(recordContext)?.finalContent;
    if (snapshotContent !== undefined && hasVisibleTerminalContent(snapshotContent)) {
      return snapshotContent;
    }
    const finalContent = [...events].reverse().find((event) => event.type === 'LLM_CONTENT_DELTA' && typeof event.inlinePayload.content === 'string')
      ?.inlinePayload.content;
    if (typeof finalContent === 'string' && hasVisibleTerminalContent(finalContent)) {
      return finalContent;
    }
    if (status === 'FAILED') {
      return 'Request failed safely during local runtime recovery.';
    }
    if (status === 'CANCELED') {
      return 'Request canceled by user.';
    }
    if (status === 'SUPERSEDED') {
      return 'Request superseded by a newer request.';
    }
    return undefined;
  }

  private terminalStatusFromEvent(
    event: RunTimelineEventRecord,
  ): Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'> | undefined {
    if (event.type === 'REQUEST_COMPLETED') {
      return 'COMPLETED';
    }
    if (event.type === 'REQUEST_FAILED') {
      return 'FAILED';
    }
    if (event.type === 'REQUEST_CANCELED') {
      return 'CANCELED';
    }
    if (event.type === 'REQUEST_SUPERSEDED') {
      return 'SUPERSEDED';
    }
    return undefined;
  }

  private applyRecoveredToolDecisions(context: RequestContext, decisions: readonly RecoveredToolReplayDecision[]): RequestContext {
    const reused = new Set(decisions.filter((decision) => decision.kind === 'REUSE_RESULT').map((decision) => decision.toolCallId));
    return {
      ...context,
      toolCallStates: context.toolCallStates.map((toolCall) =>
        reused.has(toolCall.toolCallId) ? { ...toolCall, status: 'SUCCEEDED' as const } : toolCall,
      ),
    };
  }

  private async reconstructRecoveryContext(
    record: RequestRunRecord,
    command: SubmitRequestCommand,
    stage: LifecycleStage,
    checkpoint?: CheckpointRecord,
    messages: readonly SessionMessageRecord[] = [],
  ): Promise<RequestContext> {
    if (
      checkpoint !== undefined &&
      (checkpoint.sessionId !== record.sessionId || checkpoint.requestId !== record.requestId || checkpoint.runId !== record.runId)
    ) {
      throw new AgentError({
        code: 'RECOVERY_CHECKPOINT_MISMATCH',
        message: 'Recovery checkpoint does not match the run.',
        category: 'INTERNAL',
        retryable: false,
      });
    }
    const agentTurnIndex = checkpoint?.agentTurnIndex ?? 0;
    if (checkpoint !== undefined) {
      const assembly = await this.deps.assemblyRegistry.require(record.agentId, record.agentVersion);
      const maxTurns = assembly.runtimeSettings.maxTurns ?? 50;
      if (!Number.isSafeInteger(agentTurnIndex) || agentTurnIndex < 0 || agentTurnIndex > maxTurns) {
        throw new AgentError({
          code: 'RECOVERY_CHECKPOINT_MISMATCH',
          message: 'Recovery checkpoint contains an invalid Agent turn coordinate.',
          category: 'INTERNAL',
          retryable: false,
        });
      }
    }
    const assistantToolUse = [...messages]
      .reverse()
      .find((message) => message.role === 'ASSISTANT' && message.metadata['kind'] === 'ASSISTANT_TOOL_USE');
    return {
      requestContextId: checkpoint?.requestContextId ?? brand<string, 'RequestContextId'>(this.id('context-recovery')),
      sessionId: record.sessionId,
      requestId: record.requestId,
      runId: record.runId,
      identityContext: command.identityContext,
      locale: command.locale,
      acceptedInputText: command.inputText,
      ...(command.routingConstraints === undefined ? {} : { routingConstraints: command.routingConstraints }),
      ...(command.requestModelOptions === undefined ? {} : { requestModelOptions: command.requestModelOptions }),
      ...(command.propagationAttributes === undefined ? {} : { propagationAttributes: command.propagationAttributes }),
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      agentAssemblyRef: record.agentAssemblyRef,
      agentTurnIndex,
      activeStepId: `turn-${agentTurnIndex + 1}`,
      nextLifecycleStage: stage,
      ...(assistantToolUse === undefined ? {} : { currentToolBatchMessageId: assistantToolUse.messageId }),
      toolCallStates: assistantToolUse === undefined ? [] : this.toolCallStatesFromAssistantMessage(assistantToolUse),
      flowVariables: checkpoint?.flowVariables ?? {},
    };
  }

  private recoveryCheckpointFailureCode(
    record: RequestRunRecord,
    checkpoint: CheckpointRecord,
    stage: LifecycleStage,
    messages: readonly SessionMessageRecord[],
    events: readonly RunTimelineEventRecord[],
    activeContextVersion: number,
  ): string | undefined {
    const latestTimelineSequence = events.reduce((latest, event) => Math.max(latest, Number(event.sequence)), 0);
    if (
      checkpoint.sessionId !== record.sessionId ||
      checkpoint.requestId !== record.requestId ||
      checkpoint.runId !== record.runId ||
      this.stageFromCheckpoint(checkpoint) !== stage ||
      checkpoint.runVersion < record.version - 1 ||
      checkpoint.runVersion > record.version ||
      Number(checkpoint.lastSequence) > latestTimelineSequence ||
      checkpoint.activeContextVersion > activeContextVersion
    ) {
      return 'RECOVERY_CHECKPOINT_MISMATCH';
    }
    if (
      messages.some(
        (message) =>
          message.tenantId !== record.tenantId ||
          message.subjectId !== record.subjectId ||
          message.agentId !== record.agentId ||
          message.sessionId !== record.sessionId ||
          message.requestId !== record.requestId ||
          message.runId !== record.runId,
      ) ||
      events.some(
        (event) =>
          event.tenantId !== record.tenantId ||
          event.subjectId !== record.subjectId ||
          event.agentId !== record.agentId ||
          event.sessionId !== record.sessionId ||
          event.requestId !== record.requestId ||
          event.runId !== record.runId,
      )
    ) {
      return 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT';
    }
    if (stage === 'BEFORE_CAPABILITY_INVOKE') {
      const assistantToolUse = [...messages]
        .reverse()
        .find((message) => message.role === 'ASSISTANT' && message.metadata['kind'] === 'ASSISTANT_TOOL_USE');
      if (assistantToolUse === undefined || Number(assistantToolUse.createdAt) > Number(checkpoint.savedAt)) {
        return 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT';
      }
    }
    return undefined;
  }

  private async failRecoveredRun(record: RequestRunRecord, code: string): Promise<void> {
    const command = await this.toRecoverySubmitCommand(record).catch(() => this.recoverySubmitCommand(record));
    const context = await this.reconstructRecoveryContext(record, command, 'BEFORE_AGENT_TERMINAL').catch(() => ({
      requestContextId: brand<string, 'RequestContextId'>(this.id('context-recovery-failed')),
      sessionId: record.sessionId,
      requestId: record.requestId,
      runId: record.runId,
      identityContext: command.identityContext,
      locale: command.locale,
      ...(command.routingConstraints === undefined ? {} : { routingConstraints: command.routingConstraints }),
      ...(command.requestModelOptions === undefined ? {} : { requestModelOptions: command.requestModelOptions }),
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      agentAssemblyRef: record.agentAssemblyRef,
      agentTurnIndex: 0,
      nextLifecycleStage: 'BEFORE_AGENT_TERMINAL' as const,
      toolCallStates: [],
      flowVariables: {},
    }));
    const run = this.toRuntimeRun(record);
    await this.commitTerminal(
      command,
      run,
      context,
      `Request failed safely during local runtime recovery: ${code}`,
      'FAILED',
      this.terminalCommitOptionsFromRecord(record),
    );
  }

  private stageFromCheckpoint(checkpoint: CheckpointRecord): LifecycleStage {
    if (checkpoint.triggerReason === 'CAPABILITY_BEFORE_CALL' || checkpoint.triggerReason === 'CAPABILITY_AFTER_RETURN') {
      return 'BEFORE_CAPABILITY_INVOKE';
    }
    if (checkpoint.triggerReason === 'TERMINAL_COMMIT_PENDING') {
      return 'BEFORE_AGENT_TERMINAL';
    }
    return 'BEFORE_MODEL_INVOKE';
  }

  private toolCallStatesFromAssistantMessage(message: SessionMessageRecord): RequestContext['toolCallStates'] {
    try {
      const parsed = JSON.parse(message.content) as { toolCalls?: ReadonlyArray<{ toolCallId?: unknown; toolName?: unknown; arguments?: unknown }> };
      if (!Array.isArray(parsed.toolCalls)) {
        return [];
      }
      return parsed.toolCalls.flatMap((toolCall) => {
        if (
          typeof toolCall.toolCallId !== 'string' ||
          typeof toolCall.toolName !== 'string' ||
          typeof toolCall.arguments !== 'object' ||
          toolCall.arguments === null ||
          Array.isArray(toolCall.arguments)
        ) {
          return [];
        }
        return [
          {
            toolCallId: toolCall.toolCallId,
            capabilityId: brand<string, 'CapabilityId'>(toolCall.toolName),
            arguments: toolCall.arguments as JsonObject,
            status: 'PENDING' as const,
          },
        ];
      });
    } catch {
      return [];
    }
  }

  private pendingWorkCount(): number {
    return [...this.pendingLaneWork.values()].reduce((sum, queue) => sum + queue.length, 0);
  }

  private async replaceOlderLaneWork(command: SubmitRequestCommand, newestRun: RequestRun, newestContext: RequestContext): Promise<void> {
    const snapshot = await this.deps.requestRunStore.loadSessionLaneSnapshot({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: newestRun.agentId,
      sessionId: newestRun.sessionId,
    });
    const laneKey = this.laneKey(command.identityContext.tenantId, command.identityContext.subjectId, newestRun.agentId, newestRun.sessionId);
    for (const queued of snapshot.queuedRuns) {
      if (queued.runId === newestRun.runId) {
        continue;
      }
      this.removePendingWork(laneKey, queued.runId);
      await this.commitSupersededQueuedRun(command, this.toRuntimeRun(queued), newestContext);
    }
    if (snapshot.executingRun !== undefined && snapshot.executingRun.runId !== newestRun.runId) {
      const executing = this.executingRuns.get(snapshot.executingRun.runId);
      if (executing !== undefined) {
        executing.superseded = true;
        executing.controller.abort();
      }
    }
  }

  private removePendingWork(laneKey: string, runId: RequestRun['runId']): void {
    const queue = this.pendingLaneWork.get(laneKey);
    if (queue === undefined) {
      return;
    }
    const retained = queue.filter((work) => work.run.runId !== runId);
    if (retained.length === 0) {
      this.pendingLaneWork.delete(laneKey);
      return;
    }
    this.pendingLaneWork.set(laneKey, retained);
  }

  private async commitSupersededQueuedRun(command: SubmitRequestCommand, run: RequestRun, newestContext: RequestContext): Promise<void> {
    const context: RequestContext = {
      ...newestContext,
      requestContextId: brand<string, 'RequestContextId'>(this.id('context-superseded')),
      requestId: run.requestId,
      runId: run.runId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_AGENT_TERMINAL',
      toolCallStates: [],
    };
    await this.commitTerminal(command, run, context, 'Request superseded by a newer request.', 'SUPERSEDED');
    await this.cleanupSupersededRunAnnotations(command, run);
  }

  private async commitCanceledRun(
    command: RequestControlCommand,
    run: RequestRun,
    semantic: string,
    originalRequestContextId?: RequestContextId,
  ): Promise<void> {
    const terminalCommand = this.toSubmitCommand(command);
    const context = this.toControlContext(command, run, 'context-cancel');
    const terminalContext = originalRequestContextId !== undefined ? { ...context, requestContextId: originalRequestContextId } : context;
    await this.commitTerminal(terminalCommand, run, terminalContext, 'Request canceled by user.', 'CANCELED', {
      idempotencyKey: command.idempotencyKey,
      idempotencySemantic: semantic,
    });
    const durable = await this.deps.requestRunStore.loadRun({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: run.agentId,
      runId: run.runId,
    });
    if (durable?.status === 'CANCELED' && durable.terminalCommitState === 'COMMITTED') {
      this.markRunTerminalized(run.runId);
      return;
    }
    if (durable?.terminalCommitState === 'PENDING' || durable?.terminalCommitState === 'RETRYING') {
      return;
    }
    if (durable !== undefined && this.isTerminalRunStatus(durable.status)) {
      throw new AgentError({
        code: 'REQUEST_CANCEL_ALREADY_TERMINAL',
        message: 'Cancel target reached another terminal state.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    throw new AgentError({
      code: 'REQUEST_CANCEL_COMMIT_UNAVAILABLE',
      message: 'Cancel terminal commit did not complete.',
      category: 'UNAVAILABLE',
      retryable: true,
    });
  }

  private async hideReplacedAttemptMessages(
    command: RequestControlCommand,
    source: ReturnType<typeof toRunRecord>,
    context: RequestContext,
  ): Promise<void> {
    const messages = await this.deps.messageStore.listCurrentRequestMessages({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: source.agentId,
      sessionId: source.sessionId,
      requestId: source.requestId,
      runId: source.runId,
      includeHidden: false,
      offset: 0,
      limit: 100,
    });
    for (const message of messages.items) {
      if (message.role === 'USER') {
        continue;
      }
      await this.deps.messageStore.hideMessage({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: source.agentId,
        messageId: message.messageId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: context.requestContextId,
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${context.runId}:${message.messageId}:retry-hide`),
      });
    }
  }

  private async resolveInheritedLatestSource(
    command:
      | Pick<RequestControlCommand, 'identityContext' | 'sessionId' | 'expectedLatestRequestId'>
      | Pick<EditLatestRequestCommand, 'identityContext' | 'sessionId' | 'expectedLatestRequestId'>,
    agentId: AgentId,
    snapshot: SessionLaneSnapshot,
  ): Promise<InheritedLatestSource | undefined> {
    const forkStore = this.deps.sessionForkStore;
    if (forkStore === undefined || snapshot.latestRun !== undefined || snapshot.latestRequestId !== undefined) {
      return undefined;
    }
    const scope = {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
    };
    const forkSource = await forkStore.loadSessionForkSource({
      ...scope,
      childSessionId: command.sessionId,
    });
    if (forkSource === undefined || forkSource.childSessionId !== command.sessionId) {
      return undefined;
    }
    if (
      await forkStore.hasUserMessageAfterForkAnchor({
        ...scope,
        childSessionId: command.sessionId,
      })
    ) {
      return undefined;
    }
    const anchor = await this.deps.messageStore.loadMessage({
      ...scope,
      messageId: forkSource.childAnchorMessageId,
    });
    if (anchor === undefined || anchor.sessionId !== command.sessionId || anchor.role !== 'ASSISTANT' || !anchor.visible) {
      return undefined;
    }
    if (anchor.requestId !== command.expectedLatestRequestId) {
      const retryCommand = 'action' in command;
      throw new AgentError({
        code: retryCommand ? 'REQUEST_RETRY_NOT_LATEST' : 'EDIT_LATEST_NOT_LATEST',
        message: retryCommand ? 'Retry request is not the latest request.' : 'Edit target is not the latest request.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'STALE_LATEST_REQUEST' },
      });
    }
    const requestMessages = await this.deps.messageStore.listMessages({
      ...scope,
      sessionId: command.sessionId,
      requestId: anchor.requestId,
      includeHidden: false,
      includeCapabilityResults: true,
      anchorMessageId: forkSource.childAnchorMessageId,
      limit: forkRequestAnchorResolutionLimit,
    });
    if (requestMessages.hasMore || requestMessages.newerCursor !== undefined) {
      return undefined;
    }
    const canonicalUsers = requestMessages.items.filter(
      (message) => message.role === 'USER' && message.visible && message.messageId === anchor.requestId,
    );
    if (canonicalUsers.length !== 1 || requestMessages.items.filter((message) => message.role === 'USER' && message.visible).length !== 1) {
      return undefined;
    }
    const userMessage = canonicalUsers[0]!;
    const metadataFacts = this.inheritedMessageMetadataFacts(userMessage.metadata);
    if (metadataFacts === undefined) {
      return undefined;
    }
    return {
      requestId: anchor.requestId,
      ...(anchor.runId === undefined ? {} : { copiedRunAnchor: anchor.runId }),
      inputText: userMessage.content,
      attachmentIds: metadataFacts.attachmentIds,
      ...(metadataFacts.requestModelOptions === undefined ? {} : { requestModelOptions: metadataFacts.requestModelOptions }),
      ...(metadataFacts.routingConstraints === undefined ? {} : { routingConstraints: metadataFacts.routingConstraints }),
      sourceMessageIds: requestMessages.items.filter((message) => message.role !== 'USER').map((message) => message.messageId),
    };
  }

  private async hideInheritedRetrySourceMessages(
    command: Pick<RequestControlCommand, 'identityContext'>,
    sourceMessageIds: readonly MessageId[],
    context: RequestContext,
  ): Promise<void> {
    for (const messageId of sourceMessageIds) {
      await this.deps.messageStore.hideMessage({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: context.agentId,
        messageId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: context.requestContextId,
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${context.runId}:${messageId}:retry-hide`),
      });
    }
  }

  private async completeInheritedRetryVisibilityReplacement(
    command: RequestControlCommand,
    retryCommand: SubmitRequestCommand,
    sourceMessageIds: readonly MessageId[],
    run: RequestRun,
    context: RequestContext,
  ): Promise<void> {
    try {
      await this.hideInheritedRetrySourceMessages(command, sourceMessageIds, context);
    } catch {
      await this.emitCanonical(
        retryCommand,
        context,
        {
          type: 'DEGRADATION_NOTICE',
          inlinePayload: { code: 'REQUEST_RETRY_VISIBILITY_UNAVAILABLE' },
        },
        brand<string, 'IdempotencyKey'>(`${run.runId}:retry-visibility-unavailable`),
      );
    }
  }

  private async loadInheritedSourceForAcceptedRun(record: RequestRunRecord): Promise<InheritedLatestSource | undefined> {
    const forkStore = this.deps.sessionForkStore;
    if (forkStore === undefined || record.attempt !== 1 || record.retryOfRunId !== undefined) {
      return undefined;
    }
    const scope = {
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
    };
    const forkSource = await forkStore.loadSessionForkSource({
      ...scope,
      childSessionId: record.sessionId,
    });
    if (forkSource === undefined) {
      return undefined;
    }
    const anchor = await this.deps.messageStore.loadMessage({
      ...scope,
      messageId: forkSource.childAnchorMessageId,
    });
    if (anchor === undefined || anchor.sessionId !== record.sessionId || anchor.requestId !== record.requestId || anchor.role !== 'ASSISTANT') {
      return undefined;
    }
    const requestMessages = await this.deps.messageStore.listMessages({
      ...scope,
      sessionId: record.sessionId,
      requestId: record.requestId,
      includeHidden: true,
      includeCapabilityResults: true,
      anchorMessageId: forkSource.childAnchorMessageId,
      limit: forkRequestAnchorResolutionLimit,
    });
    if (requestMessages.hasMore || requestMessages.newerCursor !== undefined) {
      return undefined;
    }
    const canonicalUsers = requestMessages.items.filter((message) => message.role === 'USER' && message.messageId === record.requestId);
    if (canonicalUsers.length !== 1 || requestMessages.items.filter((message) => message.role === 'USER').length !== 1) {
      return undefined;
    }
    const userMessage = canonicalUsers[0]!;
    const metadataFacts = this.inheritedMessageMetadataFacts(userMessage.metadata);
    if (metadataFacts === undefined) {
      return undefined;
    }
    return {
      requestId: record.requestId,
      ...(anchor.runId === undefined ? {} : { copiedRunAnchor: anchor.runId }),
      inputText: userMessage.content,
      attachmentIds: metadataFacts.attachmentIds,
      ...(metadataFacts.requestModelOptions === undefined ? {} : { requestModelOptions: metadataFacts.requestModelOptions }),
      ...(metadataFacts.routingConstraints === undefined ? {} : { routingConstraints: metadataFacts.routingConstraints }),
      sourceMessageIds: requestMessages.items.filter((message) => message.role !== 'USER').map((message) => message.messageId),
    };
  }

  async hideRunMessages(command: HideRunMessagesCommand): Promise<void> {
    // Mark the run as guard-blocked so a not-yet-committed terminal assistant
    // message is persisted with visible=false (see commitTerminal). Idempotent.
    this.guardBlockedRunIds.add(command.runId);
    // Race-safe: if the terminal assistant message was already committed
    // before the guard block signal arrived, hide it now.
    try {
      const messages = await this.deps.messageStore.listCurrentRequestMessages({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: command.agentId,
        sessionId: command.sessionId,
        requestId: command.requestId,
        runId: command.runId,
        includeHidden: false,
        offset: 0,
        limit: 100,
      });
      for (const message of messages.items) {
        if (message.role === 'USER') {
          continue;
        }
        await this.deps.messageStore.hideMessage({
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          messageId: message.messageId,
          reason: command.reason,
          hiddenByContextId: brand<string, 'RequestContextId'>(`guard-block:${command.runId}`),
          idempotencyKey: brand<string, 'IdempotencyKey'>(`${command.runId}:${message.messageId}:guard-hide`),
        });
      }
    } catch {
      // Hiding already-committed messages is best-effort; the in-memory flag
      // above still ensures a pending terminal commit will be hidden.
    }
  }

  private async completeRetryVisibilityForRetryRecord(record: RequestRunRecord): Promise<void> {
    if (record.retryOfRunId === undefined) {
      if (record.attempt === 1) {
        const inheritedSource = await this.loadInheritedSourceForAcceptedRun(record);
        if (inheritedSource !== undefined) {
          await this.hideInheritedRetrySourceMessages(
            {
              identityContext: {
                tenantId: record.tenantId,
                subjectId: record.subjectId,
                displayName: 'Runtime recovery',
              },
            },
            inheritedSource.sourceMessageIds,
            {
              requestContextId: brand<string, 'RequestContextId'>(`${record.runId}:retry-visibility-context`),
              sessionId: record.sessionId,
              requestId: record.requestId,
              runId: record.runId,
              identityContext: {
                tenantId: record.tenantId,
                subjectId: record.subjectId,
                displayName: 'Runtime recovery',
              },
              locale: brand<string, 'RequestLocale'>('zh-CN'),
              agentId: record.agentId,
              agentVersion: record.agentVersion,
              agentAssemblyRef: record.agentAssemblyRef,
              agentTurnIndex: 0,
              nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
              toolCallStates: [],
              flowVariables: {},
            },
          );
        }
      }
      return;
    }
    const source = await this.deps.requestRunStore
      .loadRun({
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        runId: record.retryOfRunId,
      })
      .catch(() => undefined);
    if (source === undefined) {
      return;
    }
    const checkpoint = await this.deps.checkpointStore
      .loadCheckpoint({
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        sessionId: record.sessionId,
        requestId: record.requestId,
        runId: record.runId,
      })
      .catch(() => undefined);
    const command: RequestControlCommand = {
      sessionId: record.sessionId,
      identityContext: { tenantId: record.tenantId, subjectId: record.subjectId, displayName: 'Runtime recovery' },
      expectedLatestRequestId: record.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>(`${record.runId}:retry-visibility-recovery`),
    };
    const context: RequestContext = {
      requestContextId: checkpoint?.requestContextId ?? brand<string, 'RequestContextId'>(`${record.runId}:retry-visibility-context`),
      sessionId: record.sessionId,
      requestId: record.requestId,
      runId: record.runId,
      identityContext: command.identityContext,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      agentAssemblyRef: record.agentAssemblyRef,
      agentTurnIndex: checkpoint?.agentTurnIndex ?? 0,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: checkpoint?.flowVariables ?? {},
    };
    await this.completeRetryVisibilityReplacement(command, await this.toRecoverySubmitCommand(record), source, this.toRuntimeRun(record), context);
  }

  private async completeEditVisibilityForRecord(command: EditLatestRequestCommand, record: RequestRunRecord): Promise<void> {
    const checkpoint = await this.deps.checkpointStore
      .loadCheckpoint({
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        sessionId: record.sessionId,
        requestId: record.requestId,
        runId: record.runId,
      })
      .catch(() => undefined);
    await this.hideEditedSourceRequestMessages(
      command,
      record.agentId,
      checkpoint?.requestContextId ?? brand<string, 'RequestContextId'>(`${record.runId}:edit-visibility-context`),
    );
  }

  private async hideEditedSourceRequestMessages(
    command: EditLatestRequestCommand,
    agentId: AgentId,
    hiddenByContextId: RequestContextId,
  ): Promise<void> {
    await this.deps.messageStore.hideRequestMessages({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
      sessionId: command.sessionId,
      requestId: command.expectedLatestRequestId,
      reason: 'EDIT_REPLACED',
      hiddenByContextId,
    });
  }

  private async completeRetryVisibilityReplacement(
    command: RequestControlCommand,
    retryCommand: SubmitRequestCommand,
    source: ReturnType<typeof toRunRecord>,
    run: RequestRun,
    context: RequestContext,
  ): Promise<void> {
    await this.cleanupSupersededRunAnnotations(command, source);
    try {
      await this.hideReplacedAttemptMessages(command, source, context);
    } catch {
      await this.emitCanonical(
        retryCommand,
        context,
        { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'REQUEST_RETRY_VISIBILITY_UNAVAILABLE' } },
        brand<string, 'IdempotencyKey'>(`${run.runId}:retry-visibility-unavailable`),
      );
    }
  }

  private async cleanupSupersededRunAnnotations(
    command: SubmitRequestCommand | RequestControlCommand,
    source: { readonly agentId: AgentId; readonly runId: RequestRunId },
  ): Promise<void> {
    const store = this.deps.conversationAnnotationStore;
    if (store === undefined) {
      return;
    }
    const request: DeleteAnnotationsByRunRequest = {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: source.agentId,
      requestRunId: source.runId,
    };
    const result = await store.deleteAnnotationsByRun(request);
    if (result !== undefined) {
      throw new AgentError({
        code: result.code,
        message: result.message,
        category: result.category,
        retryable: result.retryable,
        ...(result.safeDetails === undefined ? {} : { safeDetails: result.safeDetails }),
      });
    }
  }

  private async loadRetryRootMessageFacts(
    command: RequestControlCommand,
    source: ReturnType<typeof toRunRecord>,
  ): Promise<{
    readonly attachmentIds: SubmitRequestCommand['attachmentIds'];
    readonly requestModelOptions?: SubmitRequestCommand['requestModelOptions'];
    readonly routingConstraints?: RoutingConstraints;
    readonly inputText: string;
  }> {
    const rootMessage = await this.deps.messageStore
      .loadMessage({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: source.agentId,
        messageId: source.requestId,
      })
      .catch(() => undefined);
    const isUserMessage = rootMessage?.role === 'USER';
    const attachmentIds = isUserMessage ? this.attachmentIdsFromMetadata(rootMessage.metadata) : [];
    const requestModelOptions = isUserMessage ? this.requestModelOptionsFromMetadata(rootMessage.metadata) : undefined;
    const routingConstraints = isUserMessage ? this.routingConstraintsFromMetadata(rootMessage.metadata) : undefined;
    const inputText = isUserMessage ? rootMessage.content : '';
    return {
      attachmentIds,
      inputText,
      ...(requestModelOptions === undefined ? {} : { requestModelOptions }),
      ...(routingConstraints === undefined ? {} : { routingConstraints }),
    };
  }

  private async revalidateAttachmentAuthorities(request: {
    readonly tenantId: SubmitRequestCommand['identityContext']['tenantId'];
    readonly subjectId: SubmitRequestCommand['identityContext']['subjectId'];
    readonly agentId: AgentId;
    readonly source: {
      readonly sessionId: RequestRunRecord['sessionId'];
      readonly requestId: RequestRunRecord['requestId'];
      readonly runId: RequestRunRecord['runId'];
    };
    readonly attachmentIds: readonly AttachmentId[];
    readonly rejectionCode: string;
  }): Promise<SubmitRequestCommand['attachmentIds']> {
    if (request.attachmentIds.length === 0) {
      return [];
    }
    const attachmentStore = this.deps.attachmentStore;
    if (attachmentStore !== undefined) {
      for (const attachmentId of request.attachmentIds) {
        const attachment = await attachmentStore
          .loadAttachment({
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            agentId: request.agentId,
            attachmentId,
          })
          .catch(() => undefined);
        if (
          attachment === undefined ||
          attachment.sessionId !== request.source.sessionId ||
          attachment.requestId !== request.source.requestId ||
          (attachment.runId !== undefined && attachment.runId !== request.source.runId) ||
          attachment.validationStatus !== 'ACCEPTED' ||
          attachment.availabilityStatus !== 'AVAILABLE'
        ) {
          throw new AgentError({
            code: request.rejectionCode,
            message: 'Attachment is unavailable.',
            category: 'UNAVAILABLE',
            retryable: true,
            safeDetails: { reasonCode: 'ATTACHMENT_DEPENDENCY_UNAVAILABLE' },
          });
        }
      }
      return request.attachmentIds;
    }
    if (this.deps.retryAttachmentValidator !== undefined) {
      const result = await this.deps.retryAttachmentValidator
        .validateRetrySourceAttachments({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          source: request.source,
          attachmentIds: request.attachmentIds,
        })
        .catch(() => ({ status: 'UNAVAILABLE' as const }));
      if (result.status !== 'VALID') {
        throw new AgentError({
          code: request.rejectionCode,
          message: 'Attachment is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
          safeDetails: { reasonCode: 'ATTACHMENT_DEPENDENCY_UNAVAILABLE' },
        });
      }
      return request.attachmentIds;
    }
    throw new AgentError({
      code: request.rejectionCode,
      message: 'Attachment is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
      safeDetails: { reasonCode: 'ATTACHMENT_DEPENDENCY_UNAVAILABLE' },
    });
  }

  private async isRetryQueueUnavailableRun(command: RequestControlCommand, record: RequestRunRecord): Promise<boolean> {
    if (record.status !== 'FAILED' || record.terminalCommitState !== 'COMMITTED') {
      return false;
    }
    const messages = await this.deps.messageStore
      .listCurrentRequestMessages({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: record.agentId,
        sessionId: record.sessionId,
        requestId: record.requestId,
        runId: record.runId,
        includeHidden: true,
        offset: 0,
        limit: 20,
      })
      .catch(() => undefined);
    return (
      messages?.items.some(
        (message) => message.role === 'ASSISTANT' && message.content === 'Request failed safely: REQUEST_RETRY_QUEUE_UNAVAILABLE',
      ) ?? false
    );
  }

  private attachmentIdsFromMetadata(metadata: JsonObject): SubmitRequestCommand['attachmentIds'] {
    const value = metadata['attachmentIds'];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
      return [];
    }
    return value.map((item) => brand<string, 'AttachmentId'>(item));
  }

  private inheritedMessageMetadataFacts(metadata: JsonObject):
    | {
        readonly attachmentIds: SubmitRequestCommand['attachmentIds'];
        readonly requestModelOptions?: SubmitRequestCommand['requestModelOptions'];
        readonly routingConstraints?: RoutingConstraints;
      }
    | undefined {
    const rawAttachmentIds = metadata['attachmentIds'];
    if (
      rawAttachmentIds !== undefined &&
      (!Array.isArray(rawAttachmentIds) || !rawAttachmentIds.every((item) => typeof item === 'string' && item.length > 0))
    ) {
      return undefined;
    }
    const attachmentIds = this.attachmentIdsFromMetadata(metadata);
    const rawRequestModelOptions = metadata['requestModelOptions'];
    const requestModelOptions = this.requestModelOptionsFromMetadata(metadata);
    if (rawRequestModelOptions !== undefined && requestModelOptions === undefined) {
      return undefined;
    }
    const routingConstraints = this.routingConstraintsFromMetadata(metadata);
    return {
      attachmentIds,
      ...(requestModelOptions === undefined ? {} : { requestModelOptions }),
      ...(routingConstraints === undefined ? {} : { routingConstraints }),
    };
  }

  private requestModelOptionsFromMetadata(metadata: JsonObject): SubmitRequestCommand['requestModelOptions'] | undefined {
    const value = metadata['requestModelOptions'];
    if (value === undefined || !Value.Check(RequestModelOptionsSchema, value)) {
      return undefined;
    }
    return value;
  }

  private routingConstraintsFromMetadata(metadata: JsonObject): RoutingConstraints | undefined {
    const value = metadata['routingConstraints'];
    if (value === undefined) {
      return undefined;
    }
    if (!Value.Check(RoutingConstraintsSchema, value)) {
      throw new AgentError({
        code: 'REQUEST_ROUTING_FACTS_INVALID',
        message: 'Persisted request routing facts are invalid.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'REQUEST_ROUTING_FACTS_INVALID' },
      });
    }
    return value;
  }

  private toControlContext(command: RequestControlCommand, run: RequestRun, prefix: string): RequestContext {
    return {
      requestContextId: brand<string, 'RequestContextId'>(this.id(prefix)),
      sessionId: command.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      identityContext: command.identityContext,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      agentTurnIndex: 0,
      nextLifecycleStage: 'BEFORE_AGENT_TERMINAL',
      toolCallStates: [],
      flowVariables: {},
    };
  }

  private toSubmitCommand(
    command: RequestControlCommand,
    attachmentIds: SubmitRequestCommand['attachmentIds'] = [],
    requestModelOptions?: SubmitRequestCommand['requestModelOptions'],
    inputText: string = '',
    routingConstraints?: RoutingConstraints,
  ): SubmitRequestCommand {
    return {
      sessionId: command.sessionId,
      identityContext: command.identityContext,
      inputText,
      attachmentIds,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      ...(requestModelOptions === undefined ? {} : { requestModelOptions }),
      ...(routingConstraints === undefined ? {} : { routingConstraints }),
      idempotencyKey: command.idempotencyKey,
      ...(command.inputVariables === undefined ? {} : { inputVariables: command.inputVariables }),
    };
  }

  private async toRecoverySubmitCommand(record: RequestRunRecord): Promise<SubmitRequestCommand> {
    const rootMessage = await this.deps.messageStore
      .loadMessage({
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        messageId: record.requestId,
      })
      .catch(() => undefined);
    const isUserMessage = rootMessage?.role === 'USER';
    const requestModelOptions = isUserMessage ? this.requestModelOptionsFromMetadata(rootMessage.metadata) : undefined;
    const routingConstraints = isUserMessage ? this.routingConstraintsFromMetadata(rootMessage.metadata) : undefined;
    const taskEventId = await this.recoverTaskEventId(record);
    return {
      ...this.recoverySubmitCommand(record),
      inputText: isUserMessage ? rootMessage.content : '',
      ...(requestModelOptions === undefined ? {} : { requestModelOptions }),
      ...(routingConstraints === undefined ? {} : { routingConstraints }),
      ...(taskEventId === undefined ? {} : { propagationAttributes: { taskEventId } }),
    };
  }

  private recoverySubmitCommand(record: RequestRunRecord): SubmitRequestCommand {
    return {
      sessionId: record.sessionId,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      identityContext: { tenantId: record.tenantId, subjectId: record.subjectId, displayName: 'Runtime recovery' },
      inputText: '',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }),
      ...(record.parentRequestId === undefined ? {} : { parentRequestId: record.parentRequestId }),
      ...(record.priority === undefined ? {} : { priority: record.priority }),
      idempotencyKey: brand<string, 'IdempotencyKey'>(`${record.runId}:local-recovery`),
    };
  }

  private async recoverTaskEventId(
    record: Pick<RequestRunRecord, 'tenantId' | 'subjectId' | 'agentId' | 'sessionId' | 'runId'>,
  ): Promise<NonNullable<SubmitRequestCommand['propagationAttributes']>['taskEventId'] | undefined> {
    if (this.deps.traceEnabled !== true) {
      return undefined;
    }
    const events = await this.deps.timelineStore
      .listEvents({
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        sessionId: record.sessionId,
        runId: record.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 9,
      })
      .catch(() => []);
    const acceptedIndex = events.findIndex((event) => event.type === 'REQUEST_ACCEPTED');
    if (acceptedIndex < 0 || events.slice(0, acceptedIndex).some((event) => event.type !== 'HOOK_INVOKED')) {
      return undefined;
    }
    const attributes = events[acceptedIndex]!.inlinePayload['attributes'];
    if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
      return undefined;
    }
    const eventId = (attributes as JsonObject)['eventId'];
    return isTaskEventId(eventId) ? eventId : undefined;
  }

  private toRecoveryCode(error: unknown): string {
    if (error instanceof AgentError && error.code.startsWith('RECOVERY_')) {
      return error.code;
    }
    if (error instanceof AgentError && error.code === 'CAPABILITY_UNAVAILABLE') {
      return 'RECOVERY_MISSING_ASSEMBLY';
    }
    return 'RECOVERY_TERMINAL_FACTS_INCONSISTENT';
  }

  private toSubmitFailureReason(error: unknown): string {
    if (error instanceof AgentError) {
      const reasonCode = error.safeDetails?.reasonCode;
      return typeof reasonCode === 'string' ? reasonCode : error.code;
    }
    return 'UNKNOWN_SUBMIT_FAILURE';
  }

  private projectAcceptedInput(inputText: string, routingConstraints?: RoutingConstraints): AcceptedInputProjection {
    return (
      this.deps.acceptedInputProjector?.(inputText, routingConstraints) ?? {
        inputText,
        ...(routingConstraints === undefined ? {} : { routingConstraints }),
      }
    );
  }

  private toRuntimeRun(record: ReturnType<typeof toRunRecord>): RequestRun {
    return {
      runId: record.runId,
      sessionId: record.sessionId,
      requestId: record.requestId,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      agentAssemblyRef: record.agentAssemblyRef,
      attempt: record.attempt,
      ...(record.retryOfRunId === undefined ? {} : { retryOfRunId: record.retryOfRunId }),
      ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }),
      ...(record.parentRequestId === undefined ? {} : { parentRequestId: record.parentRequestId }),
      ...(record.priority === undefined ? {} : { priority: record.priority }),
      status: record.status,
      version: record.version,
      terminalCommitState: record.terminalCommitState,
      ...(record.lockedBy === undefined ? {} : { lockedBy: record.lockedBy }),
      ...(record.lockExpiresAt === undefined ? {} : { lockExpiresAt: record.lockExpiresAt }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private resolveAgentId(): AgentId {
    return this.deps.defaultRouteAgentId;
  }

  private async resolveCreateSessionAgentId(command: RuntimeCreateSessionCommand): Promise<AgentId> {
    if (this.deps.agentSelectionPolicy === undefined) {
      return this.resolveAgentId();
    }
    const selection = await this.deps.agentSelectionPolicy.resolve(
      { ...(command.agentId === undefined ? {} : { headerAgentId: command.agentId }), defaultRouteAgentId: this.deps.defaultRouteAgentId },
      new AbortController().signal,
    );
    const assembly = await this.deps.assemblyRegistry.active(selection.agentId).catch((error) => {
      throw new AgentError({
        code: 'SESSION_CREATE_AGENT_UNAVAILABLE',
        message: 'Selected agent assembly is unavailable for session creation.',
        category: 'UNAVAILABLE',
        retryable: false,
        safeDetails: { reasonCode: 'SESSION_CREATE_AGENT_UNAVAILABLE' },
        ...(error instanceof Error ? { cause: error } : {}),
      });
    });
    if (assembly.userInvocable !== true) {
      throw new AgentError({
        code: 'SESSION_CREATE_AGENT_NOT_USER_INVOCABLE',
        message: 'Selected agent is not user-invocable.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SESSION_CREATE_AGENT_NOT_USER_INVOCABLE' },
      });
    }
    return selection.agentId;
  }

  private resolveSessionAgentId(sessionId: SessionId): AgentId {
    return this.sessionRuntimeStates.get(sessionId)?.agentId ?? this.resolveAgentId();
  }

  private rememberSessionRuntimeState(session: UserSession): void {
    const existing = this.sessionRuntimeStates.get(session.sessionId);
    this.sessionRuntimeStates.set(session.sessionId, {
      tenantId: session.tenantId,
      subjectId: session.subjectId,
      agentId: session.agentId,
      titleGenerated: existing?.titleGenerated === true,
    });
  }

  private markRunTerminalized(runId: string): void {
    const executing = this.executingRuns.get(runId);
    if (executing !== undefined) {
      executing.terminalized = true;
    }
  }

  private assertForkIdempotencyKey(idempotencyKey: IdempotencyKey): void {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new AgentError({
        code: 'SESSION_FORK_IDEMPOTENCY_REQUIRED',
        message: 'Fork requires a non-empty idempotency key.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SESSION_FORK_IDEMPOTENCY_REQUIRED' },
      });
    }
  }

  private requireForkStore(): SessionForkStoreGateway {
    if (this.deps.sessionForkStore === undefined) {
      throw new AgentError({
        code: 'SESSION_FORK_UNAVAILABLE',
        message: 'Session fork persistence is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    return this.deps.sessionForkStore;
  }

  private assertForkNotCanceled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new AgentError({
        code: 'SESSION_FORK_CANCELED',
        message: 'Session fork was canceled.',
        category: 'CANCELED',
        retryable: false,
      });
    }
  }

  private remainingForkPromotionBytes(maxPromotedBytes: number, promotedBytes: number): number {
    const remaining = maxPromotedBytes - promotedBytes;
    if (!Number.isSafeInteger(maxPromotedBytes) || maxPromotedBytes < 0 || remaining < 1) {
      throw new AgentError({
        code: 'SESSION_FORK_PROMOTED_CONTENT_TOO_LARGE',
        message: 'Fork promoted content exceeds the provider budget.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    return remaining;
  }

  private toUserSessionFromRecord(record: SessionRecord): UserSession {
    return {
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      ...(record.parentSessionId === undefined ? {} : { parentSessionId: record.parentSessionId }),
      ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }),
      ...(record.parentRequestId === undefined ? {} : { parentRequestId: record.parentRequestId }),
      ...(record.title === undefined ? {} : { title: record.title }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      hasInFlightRequest: false,
    };
  }

  private async startRun(command: SubmitRequestCommand, run: RequestRun): Promise<RequestRun> {
    return startAcceptedRun(this.deps.requestRunStore, command, run, () => this.now());
  }

  private enterExecutingRun(command: SubmitRequestCommand, run: RequestRun, state: ExecutingRunState, measureQueueDuration = false): void {
    if (this.executingRuns.has(run.runId)) {
      return;
    }
    const occurredAt = this.now();
    state.executionTransitionContext = {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      sessionId: run.sessionId,
      runId: run.runId,
      requestId: run.requestId,
    };
    this.executingRuns.set(run.runId, state);
    this.notifyRunExecutionStateListeners({
      ...state.executionTransitionContext,
      transition: 'ENTERED',
      occurredAt,
      activeCount: this.executingRuns.size,
      ...(measureQueueDuration ? { queueDurationMs: Math.max(0, Number(occurredAt) - Number(run.createdAt)) } : {}),
    });
  }

  private leaveExecutingRun(runId: RequestRunId): void {
    const state = this.executingRuns.get(runId);
    if (state === undefined || !this.executingRuns.delete(runId) || state.executionTransitionContext === undefined) {
      return;
    }
    this.notifyRunExecutionStateListeners({
      ...state.executionTransitionContext,
      transition: 'LEFT',
      occurredAt: this.now(),
      activeCount: this.executingRuns.size,
    });
  }

  private async persistUserMessage(command: SubmitRequestCommand, run: RequestRun): Promise<void> {
    const requestId = run.requestId;
    const runId = run.runId;
    const messageId = requestId;
    const userMetadata = rootUserMessageMetadata(command);
    await this.deps.messageStore.appendSessionMessage(
      {
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: run.agentId,
        messageId,
        sessionId: run.sessionId,
        requestId,
        runId,
        role: 'USER',
        content: command.inputText,
        contentType: 'PLAIN_TEXT',
        metadata: userMetadata,
        visible: true,
        createdAt: this.now(),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>(`${command.idempotencyKey}:root-message`) },
    );
  }

  private sessionIdFromLaneKey(laneKey: string): string {
    const parts = laneKey.split(':');
    return parts[parts.length - 1] ?? '';
  }

  private async commitTerminal(
    command: SubmitRequestCommand,
    run: RequestRun,
    context: RequestContext,
    content: string,
    status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED',
    options: RuntimeTerminalCommitOptions = {},
  ): Promise<void> {
    let terminalContent = content;
    let terminalContext = context;
    if (this.shouldApplyTerminalLifecycleHook(context)) {
      terminalContext = this.withTerminalHookResumeSnapshot(context, content, status);
      await this.saveCheckpoint(command, run, terminalContext, 'TERMINAL_COMMIT_PENDING');
      const terminalBoundary = await this.lifecycleHookStageExecutor.invokeStage(
        this.hookScope(run, terminalContext, 'BEFORE_AGENT_TERMINAL', `commit:${status}`),
        'BEFORE_AGENT_TERMINAL',
        {
          safeTerminalSummary: content,
          finalContent: content,
          toolCalls: [],
        },
      );
      this.markTerminalLifecycleHookApplied(terminalContext);
      terminalContent = terminalBoundary.boundary.finalContent;
    }
    const hookResultSnapshot = await buildTerminalHookResultSnapshot(this.deps.timelineStore, {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: run.agentId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
    });
    const terminalOptions = this.withTerminalFailureReason(run, status, options);
    const guardBlocked = this.guardBlockedRunIds.has(run.runId);
    const terminalOptionsWithGuard = guardBlocked ? { ...terminalOptions, guardBlocked: true } : terminalOptions;
    let terminalEvent: RunTimelineEventRecord | undefined;
    try {
      terminalEvent = await commitTerminalOutcomeWithHookResultSnapshot(
        {
          requestRunStore: this.deps.requestRunStore,
          ...(this.deps.largeContentExternalizer === undefined ? {} : { largeContentExternalizer: this.deps.largeContentExternalizer }),
        },
        {
          now: () => this.now(),
          id: (prefix) => this.id(prefix),
          emitCanonical: (emitCommand, emitContext, event, idempotencyKey) => this.emitCanonical(emitCommand, emitContext, event, idempotencyKey),
          saveCheckpoint: (checkpointCommand, checkpointRun, checkpointContext, triggerReason) =>
            this.saveCheckpoint(checkpointCommand, checkpointRun, checkpointContext, triggerReason),
        },
        command,
        run,
        terminalContext,
        terminalContent,
        status,
        { ...terminalOptionsWithGuard, hookResultSnapshot },
      );
    } finally {
      this.latestTerminalFailureReasons.delete(run.runId);
      this.guardBlockedRunIds.delete(run.runId);
    }
    if (terminalEvent !== undefined) {
      this.markRunTerminalized(run.runId);
      this.publishTimelineEvent(terminalEvent);
      // One round = from the user message being accepted (run.createdAt) to the
      // terminal result being published to the stream (terminalEvent.createdAt).
      logger.info({
        event: 'runtime.run.turn_completed',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        runStatus: status,
        durationMs: Math.max(0, terminalEvent.createdAt - run.createdAt),
      });
      if (this.deps.postTerminalCallback !== undefined) {
        void Promise.resolve()
          .then(() => this.deps.postTerminalCallback?.(command, run, status))
          .catch((error) => {
            logger.error({
              err: error,
              event: 'runtime.postTerminalCallback.error',
              agentId: run.agentId,
              sessionId: run.sessionId,
              requestId: run.requestId,
              runId: run.runId,
              failureStage: 'POST_TERMINAL_CALLBACK',
              recoveryCode: this.toRecoveryCode(error),
            });
          });
      }
    }
  }

  private startSessionTitleGeneration(command: SubmitRequestCommand, run: RequestRun): void {
    void this.generateSessionTitle(command, run).catch((error) => {
      // Unexpected error escaping generateSessionTitle's internal handler
      logger.error({
        err: error,
        event: 'runtime.titleGeneration.error',
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        failureStage: 'SESSION_TITLE_GENERATION',
        recoveryCode: this.toRecoveryCode(error),
      });
    });
  }

  private async generateSessionTitle(command: SubmitRequestCommand, run: RequestRun): Promise<void> {
    const sessionOwner = this.sessionRuntimeStates.get(run.sessionId);
    if (sessionOwner?.titleGenerated === true) {
      return;
    }
    const generated = await this.deps.userSessions.generateTitle({
      identityContext: command.identityContext,
      agentId: run.agentId,
      sessionId: run.sessionId,
      requestRunId: run.runId,
      firstUserText: command.inputText,
      isFirstRequest: true,
    });
    if (generated) {
      const currentOwner = this.sessionRuntimeStates.get(run.sessionId);
      if (currentOwner !== undefined) {
        this.sessionRuntimeStates.set(run.sessionId, { ...currentOwner, titleGenerated: true });
      }
    }
  }

  private shouldApplyTerminalLifecycleHook(context: RequestContext): boolean {
    const flowVariables = context.flowVariables as Record<string, unknown>;
    return (
      this.deps.lifecycleHook !== undefined &&
      (this.deps.lifecycleHookSnapshots !== undefined || (this.deps.lifecycleHookDefinitions?.length ?? 0) > 0) &&
      flowVariables[skipTerminalLifecycleHookKey] !== true &&
      flowVariables[terminalLifecycleHookAppliedKey] !== true
    );
  }

  private markTerminalLifecycleHookApplied(context: RequestContext): void {
    const flowVariables = context.flowVariables as Record<string, unknown>;
    Object.defineProperty(flowVariables, terminalLifecycleHookAppliedKey, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  }

  private withTerminalHookResumeSnapshot(
    context: RequestContext,
    finalContent: string,
    terminalStatus: Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'>,
  ): RequestContext {
    return {
      ...context,
      flowVariables: {
        ...context.flowVariables,
        [terminalHookResumeSnapshotKey]: {
          finalContent,
          terminalStatus,
        },
      },
    };
  }

  private terminalHookResumeSnapshot(
    context: RequestContext,
  ):
    | { readonly finalContent: string; readonly terminalStatus: Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'> }
    | undefined {
    const snapshot = (context.flowVariables as Record<string, unknown>)[terminalHookResumeSnapshotKey];
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return undefined;
    }
    const candidate = snapshot as Record<string, unknown>;
    const finalContent = candidate['finalContent'];
    const terminalStatus = candidate['terminalStatus'];
    if (typeof finalContent !== 'string' || !isRecoverableTerminalStatus(terminalStatus)) {
      return undefined;
    }
    return { finalContent, terminalStatus };
  }

  private async emitCanonical(
    command: SubmitRequestCommand,
    context: RequestContext,
    event: RunTimelineEvent,
    idempotencyKey: IdempotencyKey,
  ): Promise<void> {
    const persisted = await appendCanonicalEvent(this.deps.timelineStore, command, context, event, idempotencyKey, {
      now: () => this.now(),
      id: (prefix) => this.id(prefix),
    });
    this.publishTimelineEvent(persisted);
  }

  /**
   * Emit a session-scoped timeline event from outside an active run (e.g. an
   * async background task completing after the originating run terminated).
   * Persists the event under the originating run/request ids and publishes it
   * to the session-level stream subscribers so a connected frontend receives it.
   */
  async emitSessionTimelineEvent(input: SessionTimelineEventInput): Promise<void> {
    const taskEventId = await this.recoverTaskEventId({
      tenantId: input.identityContext.tenantId,
      subjectId: input.identityContext.subjectId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
    });
    const record: RunTimelineEventRecord = {
      tenantId: input.identityContext.tenantId,
      subjectId: input.identityContext.subjectId,
      agentId: input.agentId,
      agentVersion: input.agentVersion,
      eventId: this.id('event'),
      sessionId: input.sessionId,
      runId: input.runId,
      requestId: input.requestId,
      requestContextId: input.requestContextId,
      sequence: brand<number, 'TimelineSequence'>(0),
      type: input.type,
      inlinePayload: runtimeTimelinePayload(input.inlinePayload, {
        ...(taskEventId === undefined ? {} : { propagationAttributes: { taskEventId } }),
      }),
      createdAt: this.now(),
    };
    const persisted = await this.deps.timelineStore.appendEvent(record);
    this.publishTimelineEvent(persisted);
  }

  private terminalCommitOptionsFromRecord(record: RequestRunRecord): TerminalCommitOptions {
    return {
      ...(record.terminalCommitIdempotencyKey === undefined ? {} : { idempotencyKey: record.terminalCommitIdempotencyKey }),
      ...(record.terminalCommitIdempotencySemantic === undefined ? {} : { idempotencySemantic: record.terminalCommitIdempotencySemantic }),
    };
  }

  private publishTimelineEvent(record: RunTimelineEventRecord): RunTimelineEventRecord {
    const streamKey = this.streamKey(record.tenantId, record.subjectId, record.agentId, record.sessionId);
    const sequence = Number(record.sequence) > 0 ? Number(record.sequence) : (this.streamSequences.get(streamKey) ?? 0) + 1;
    const liveRecord = { ...record, sequence: brand<number, 'TimelineSequence'>(sequence) };
    this.rememberTerminalFailureReason(liveRecord);
    const liveEvent = this.toRuntimeTimelineEvent(liveRecord);
    this.notifyRunTimelineEventListeners(liveEvent);
    const subscribers = this.streamSubscribers.get(streamKey);
    if (subscribers === undefined) {
      return liveRecord;
    }
    this.rememberStreamSequence(streamKey, sequence);
    for (const subscriber of subscribers) {
      if (!this.matchesStreamSubscriber(liveEvent, subscriber)) {
        continue;
      }
      if (subscriber.queue.length >= subscriberQueueHardLimit) {
        this.removeStreamSubscriber(streamKey, subscriber);
        continue;
      }
      if (subscriber.queue.length >= maxSubscriberQueueEvents && liveEvent.persistence === 'LIVE_ONLY') {
        continue;
      }
      subscriber.queue.push(liveEvent);
      subscriber.wake?.();
      delete subscriber.wake;
      if (liveEvent.type === 'USER_INPUT_REQUIRED') {
        subscriber.pendingInputActive = true;
      } else if (liveEvent.type === 'USER_INPUT_RECEIVED' || liveEvent.type === 'USER_INPUT_TIMEOUT' || liveEvent.type === 'USER_INPUT_CANCELED') {
        subscriber.pendingInputActive = false;
      }
    }
    return liveRecord;
  }
  private publishLiveTimelineEvent(event: RunTimelineEvent): void {
    const liveEvent = { ...event, persistence: 'LIVE_ONLY' as const };
    this.notifyRunTimelineEventListeners(liveEvent);
    if (
      liveEvent.tenantId === undefined ||
      liveEvent.subjectId === undefined ||
      liveEvent.agentId === undefined ||
      liveEvent.sessionId === undefined
    ) {
      return;
    }
    const streamKey = this.streamKey(liveEvent.tenantId, liveEvent.subjectId, liveEvent.agentId, liveEvent.sessionId);
    const subscribers = this.streamSubscribers.get(streamKey);
    if (subscribers === undefined) {
      return;
    }
    for (const subscriber of subscribers) {
      if (!this.matchesStreamSubscriber(liveEvent, subscriber)) {
        continue;
      }
      if (subscriber.queue.length >= subscriberQueueHardLimit) {
        this.removeStreamSubscriber(streamKey, subscriber);
        continue;
      }
      if (subscriber.queue.length >= maxSubscriberQueueEvents) {
        continue;
      }
      subscriber.queue.push(liveEvent);
      subscriber.wake?.();
      delete subscriber.wake;
    }
  }

  private withTerminalFailureReason(
    run: RequestRun,
    status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED',
    options: RuntimeTerminalCommitOptions,
  ): RuntimeTerminalCommitOptions {
    if (status !== 'FAILED' || options.failureReason !== undefined) {
      return options;
    }
    const failureReason = this.latestTerminalFailureReasons.get(run.runId);
    return failureReason === undefined ? options : { ...options, failureReason };
  }

  private rememberTerminalFailureReason(record: RunTimelineEventRecord): void {
    if (record.type !== 'DEGRADATION_NOTICE') {
      return;
    }
    const failureReason = terminalFailureReasonFromPayload(record.inlinePayload);
    if (failureReason === undefined) {
      return;
    }
    this.latestTerminalFailureReasons.set(record.runId, failureReason);
  }

  private notifyRunTimelineEventListeners(event: RunTimelineEvent): void {
    for (const listener of this.deps.runTimelineEventListeners ?? []) {
      try {
        listener(event);
      } catch {
        // Runtime event listeners must not change request lifecycle or stream delivery.
      }
    }
  }

  private notifyRunExecutionStateListeners(transition: RunExecutionStateTransition): void {
    for (const listener of this.deps.runExecutionStateListeners ?? []) {
      try {
        listener(transition);
      } catch {
        // Runtime execution-state listeners must not change scheduling or request lifecycle.
      }
    }
  }

  private rememberStreamSequence(streamKey: string, sequence: number): void {
    this.streamSequences.set(streamKey, Math.max(this.streamSequences.get(streamKey) ?? 0, sequence));
  }

  private matchesStreamSubscriber(event: RunTimelineEvent, subscriber: TimelineStreamSubscriber): boolean {
    if (event.persistence !== 'LIVE_ONLY' && event.sequence !== undefined && Number(event.sequence) <= subscriber.lastSeenSequence) {
      return false;
    }
    if (subscriber.requestId !== undefined && event.requestId !== subscriber.requestId) {
      return false;
    }
    if (subscriber.runId !== undefined && event.runId !== subscriber.runId) {
      return false;
    }
    return true;
  }

  private async readTimelineEventsWithTimeout(
    request: Parameters<RunTimelineEventStoreGateway['listEvents']>[0],
  ): Promise<readonly RunTimelineEventRecord[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new AgentError({
              code: 'TIMELINE_READ_TIMEOUT',
              message: 'Timeline stream read timed out safely.',
              category: 'UNAVAILABLE',
              retryable: true,
              safeDetails: { reasonCode: 'TIMELINE_READ_TIMEOUT' },
            }),
          );
        }, timelineReadTimeoutMs);
      });
      return await Promise.race([this.deps.timelineStore.listEvents(request), timeoutPromise]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private async assertStreamFilterVisible(query: StreamFilterVisibilityQuery): Promise<void> {
    if (query.requestId === undefined && query.runId === undefined) {
      return;
    }
    if (query.runId !== undefined) {
      const run = await this.deps.requestRunStore.loadRun({
        tenantId: query.tenantId,
        subjectId: query.subjectId,
        agentId: query.agentId,
        runId: query.runId,
      });
      if (run === undefined || run.sessionId !== query.sessionId || (query.requestId !== undefined && run.requestId !== query.requestId)) {
        throw this.streamFilterNotFoundError();
      }
      return;
    }
    const records = await this.readTimelineEventsWithTimeout({
      tenantId: query.tenantId,
      subjectId: query.subjectId,
      agentId: query.agentId,
      sessionId: query.sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1,
      ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
    });
    if (records.length === 0) {
      throw this.streamFilterNotFoundError();
    }
  }

  private async assertAnchorBelongsToSessionTimeline(query: TimelineAnchorVisibilityQuery): Promise<void> {
    const anchor = Number(query.lastSeenSequence);
    if (anchor === 0) {
      return;
    }
    const records = await this.readTimelineEventsWithTimeout({
      tenantId: query.tenantId,
      subjectId: query.subjectId,
      agentId: query.agentId,
      sessionId: query.sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(anchor - 1),
      limit: 1,
    });
    if (records[0] === undefined || Number(records[0].sequence) !== anchor) {
      throw new AgentError({
        code: 'STREAM_REPLAY_ANCHOR_INVALID',
        message: 'Stream replay anchor is not visible for the session timeline.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'STREAM_REPLAY_ANCHOR_INVALID' },
      });
    }
  }

  private async readSessionHighWaterSequence(scope: SessionTimelineScope): Promise<number> {
    let highWater = 0;
    let afterSequence = brand<number, 'TimelineSequence'>(0);
    while (true) {
      const records = await this.readTimelineEventsWithTimeout({
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        sessionId: scope.sessionId,
        afterSequence,
        limit: maxReplayBatchEvents,
      });
      for (const record of records) {
        highWater = Math.max(highWater, Number(record.sequence));
      }
      if (records.length < maxReplayBatchEvents) {
        return highWater;
      }
      afterSequence = records[records.length - 1]!.sequence;
    }
  }

  private streamResumeGapError(resumeAfterSequence: number): AgentError {
    return new AgentError({
      code: 'STREAM_RESUME_GAP',
      message: 'Stream resume gap requires conversation refresh.',
      category: 'UNAVAILABLE',
      retryable: true,
      safeDetails: {
        kind: 'STREAM_RESUME_GAP',
        reason: 'SEQUENCE_GAP',
        retryable: true,
        refreshConversation: true,
        resumeAfterSequence,
      },
    });
  }

  private streamFilterNotFoundError(): AgentError {
    return new AgentError({
      code: 'STREAM_FILTER_NOT_FOUND',
      message: 'Stream could not be opened. The request may not have started yet.',
      category: 'NOT_FOUND',
      retryable: false,
      safeDetails: { reasonCode: 'STREAM_FILTER_NOT_FOUND' },
    });
  }

  private eventHistoryNotFoundError(): AgentError {
    return new AgentError({
      code: 'SESSION_EVENT_HISTORY_NOT_FOUND',
      message: 'Session event history is not visible.',
      category: 'NOT_FOUND',
      retryable: false,
      safeDetails: { reasonCode: 'SESSION_EVENT_HISTORY_NOT_FOUND' },
    });
  }

  private addStreamSubscriber(streamKey: string, subscriber: TimelineStreamSubscriber): void {
    const subscribers = this.streamSubscribers.get(streamKey) ?? new Set<TimelineStreamSubscriber>();
    if (subscribers.size >= maxSubscribersPerStream) {
      throw new AgentError({
        code: 'STREAM_SUBSCRIBER_LIMIT_EXCEEDED',
        message: 'Stream subscriber limit exceeded for this session.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reasonCode: 'STREAM_SUBSCRIBER_LIMIT_EXCEEDED' },
      });
    }
    subscribers.add(subscriber);
    this.streamSubscribers.set(streamKey, subscribers);
  }

  private removeStreamSubscriber(streamKey: string, subscriber: TimelineStreamSubscriber): void {
    const subscribers = this.streamSubscribers.get(streamKey);
    if (subscribers === undefined) {
      return;
    }
    subscribers.delete(subscriber);
    subscriber.wake?.();
    delete subscriber.wake;
    if (subscribers.size === 0) {
      this.streamSubscribers.delete(streamKey);
      this.streamSequences.delete(streamKey);
    }
  }

  private async nextSubscriberEvent(
    subscriber: TimelineStreamSubscriber,
    signal?: AbortSignal,
    idleTimeoutMs: number = subscriberIdleTimeoutMs,
  ): Promise<RunTimelineEvent | undefined> {
    const queued = subscriber.queue.shift();
    if (queued !== undefined) {
      return queued;
    }
    if (signal?.aborted) {
      return undefined;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const waitPromise = new Promise<RunTimelineEvent | undefined>((resolve) => {
        const resolveNext = () => {
          signal?.removeEventListener('abort', resolveAbort);
          resolve(subscriber.queue.shift());
        };
        const resolveAbort = () => {
          delete subscriber.wake;
          resolve(undefined);
        };
        subscriber.wake = resolveNext;
        signal?.addEventListener('abort', resolveAbort, { once: true });
      });
      const timeoutPromise = new Promise<RunTimelineEvent | undefined>((resolve) => {
        timeout = setTimeout(() => {
          delete subscriber.wake;
          resolve(undefined);
        }, idleTimeoutMs);
      });
      return await Promise.race([waitPromise, timeoutPromise]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private toRuntimeTimelineEvent(record: RunTimelineEventRecord): RunTimelineEvent {
    return {
      eventId: record.eventId,
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      sessionId: record.sessionId,
      runId: record.runId,
      requestId: record.requestId,
      ...(record.requestContextId === undefined ? {} : { requestContextId: record.requestContextId }),
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      persistence: 'PERSISTED',
      sequence: record.sequence,
      type: record.type,
      inlinePayload: record.inlinePayload,
      createdAt: new Date(record.createdAt),
      ...(record.contentRef === undefined ? {} : { contentRef: record.contentRef }),
    };
  }

  private toRuntimeSafeHistoryEvent(record: RunTimelineEventRecord): RunTimelineEvent {
    return {
      eventId: record.eventId,
      sessionId: record.sessionId,
      runId: record.runId,
      requestId: record.requestId,
      ...(record.requestContextId === undefined ? {} : { requestContextId: record.requestContextId }),
      agentVersion: record.agentVersion,
      persistence: 'PERSISTED',
      sequence: record.sequence,
      type: record.type,
      inlinePayload: record.inlinePayload,
      createdAt: new Date(record.createdAt),
    };
  }

  private assertValidHistoryEventRecord(
    record: RunTimelineEventRecord,
    expected: {
      readonly tenantId: RunTimelineEventRecord['tenantId'];
      readonly subjectId: RunTimelineEventRecord['subjectId'];
      readonly agentId: RunTimelineEventRecord['agentId'];
      readonly sessionId: RunTimelineEventRecord['sessionId'];
      readonly requestId: RunTimelineEventRecord['requestId'];
      readonly runId: RunTimelineEventRecord['runId'];
      readonly recordOrigin: 'RUNTIME' | 'FORK_SNAPSHOT';
    },
    previousSequence: TimelineSequence,
  ): void {
    const runtimeShapeValid =
      expected.recordOrigin === 'RUNTIME' &&
      record.recordOrigin === undefined &&
      typeof record.requestContextId === 'string' &&
      record.requestContextId.length > 0;
    const snapshotShapeValid =
      expected.recordOrigin === 'FORK_SNAPSHOT' &&
      record.recordOrigin === 'FORK_SNAPSHOT' &&
      record.requestContextId === undefined &&
      record.contentRef === undefined;
    if (
      record.tenantId !== expected.tenantId ||
      record.subjectId !== expected.subjectId ||
      record.agentId !== expected.agentId ||
      record.sessionId !== expected.sessionId ||
      record.requestId !== expected.requestId ||
      record.runId !== expected.runId ||
      (!runtimeShapeValid && !snapshotShapeValid) ||
      typeof record.eventId !== 'string' ||
      record.eventId.length === 0 ||
      typeof record.agentVersion !== 'string' ||
      record.agentVersion.length === 0 ||
      typeof record.type !== 'string' ||
      record.type.length === 0 ||
      !isJsonObjectValue(record.inlinePayload) ||
      !Number.isSafeInteger(Number(record.sequence)) ||
      Number(record.sequence) <= Number(previousSequence) ||
      !Number.isFinite(Number(record.createdAt)) ||
      Number(record.createdAt) < 0
    ) {
      throw new AgentError({
        code: 'SESSION_EVENT_HISTORY_RECORD_INVALID',
        message: 'Session event history contains an invalid record.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SESSION_EVENT_HISTORY_RECORD_INVALID' },
      });
    }
  }

  private isTerminalTimelineEvent(event: Pick<RunTimelineEvent, 'type'>): boolean {
    return (
      event.type === 'REQUEST_COMPLETED' ||
      event.type === 'REQUEST_FAILED' ||
      event.type === 'REQUEST_CANCELED' ||
      event.type === 'REQUEST_SUPERSEDED'
    );
  }

  private streamKey(
    tenantId: RunTimelineEventRecord['tenantId'],
    subjectId: RunTimelineEventRecord['subjectId'],
    agentId: RunTimelineEventRecord['agentId'],
    sessionId: RunTimelineEventRecord['sessionId'],
  ): string {
    return `${tenantId}:${subjectId}:${agentId}:${sessionId}`;
  }

  private laneKey(
    tenantId: RunTimelineEventRecord['tenantId'],
    subjectId: RunTimelineEventRecord['subjectId'],
    agentId: RunTimelineEventRecord['agentId'],
    sessionId: RunTimelineEventRecord['sessionId'],
  ): string {
    return this.streamKey(tenantId, subjectId, agentId, sessionId);
  }

  private async loadRunByIdempotencyAnchor(
    command:
      | {
          readonly identityContext: SubmitRequestCommand['identityContext'];
          readonly sessionId: SessionId;
          readonly idempotencyKey: SubmitRequestCommand['idempotencyKey'];
        }
      | RequestControlCommand
      | EditLatestRequestCommand,
    agentId: AgentId,
    anchor: 'ACCEPTANCE' | 'TERMINAL_COMMIT',
    semantic: string,
    conflictCode:
      | 'REQUEST_SUBMIT_IDEMPOTENCY_CONFLICT'
      | 'DUPLICATE_IDEMPOTENCY_KEY_CONFLICT'
      | 'REQUEST_CANCEL_IDEMPOTENCY_CONFLICT'
      | 'REQUEST_RETRY_IDEMPOTENCY_CONFLICT'
      | 'EDIT_LATEST_IDEMPOTENCY_CONFLICT',
  ): Promise<RequestRunRecord | undefined> {
    const result = await this.deps.requestRunStore.loadRunByIdempotencyKey({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
      sessionId: command.sessionId,
      anchor,
      idempotencyKey: command.idempotencyKey,
      idempotencySemantic: semantic,
    });
    if (result.status === 'NOT_FOUND') {
      return undefined;
    }
    if (result.status === 'SEMANTIC_CONFLICT' || result.record === undefined) {
      throw new AgentError({
        code: conflictCode,
        message: 'Idempotency key was reused with different semantics.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: conflictCode },
      });
    }
    return result.record;
  }

  private toRequestAccepted(record: RequestRunRecord): RequestAccepted {
    return { sessionId: record.sessionId, requestId: record.requestId, runId: record.runId, attempt: record.attempt };
  }

  private toCancelAccepted(command: RequestControlCommand, record: RequestRunRecord): RequestControlAccepted {
    return { sessionId: record.sessionId, targetRequestId: record.requestId, action: 'CANCEL', idempotencyKey: command.idempotencyKey };
  }

  private submitIdempotencySemantic(command: SubmitRequestCommand, agentId: AgentId): string {
    const semantic = JSON.stringify({
      action: 'SUBMIT',
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
      sessionId: command.sessionId,
      ...(command.agentVersion === undefined ? {} : { agentVersion: command.agentVersion }),
      ...(command.parentSessionId === undefined ? {} : { parentSessionId: command.parentSessionId }),
      ...(command.parentRunId === undefined ? {} : { parentRunId: command.parentRunId }),
      ...(command.parentRequestId === undefined ? {} : { parentRequestId: command.parentRequestId }),
      ...(command.priority === undefined ? {} : { priority: command.priority }),
      inputText: command.inputText,
      attachmentIds: command.attachmentIds,
      locale: command.locale,
      ...(command.routingConstraints === undefined ? {} : { routingConstraints: command.routingConstraints }),
      ...(command.requestModelOptions === undefined ? {} : { requestModelOptions: command.requestModelOptions }),
      ...(command.propagationAttributes?.taskEventId === undefined ? {} : { taskEventId: command.propagationAttributes.taskEventId }),
      idempotencyKey: command.idempotencyKey,
    });
    return command.propagationAttributes?.taskEventId === undefined
      ? semantic
      : `task-event-v1:sha256:${createHash('sha256').update(semantic).digest('hex')}`;
  }

  private reserveSubmitCommandSemanticHash(command: ReserveSubmitCommand, _agentId: AgentId): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          action: command.action,
          sessionId: command.sessionId,
          inputText: command.inputText,
          ...(command.locale === undefined ? {} : { locale: command.locale }),
          attachmentIntakePresent: command.attachmentIntakePresent,
        }),
      )
      .digest('hex');
  }

  private cancelCommandSemantic(command: RequestControlCommand, agentId: AgentId): string {
    return JSON.stringify({
      action: 'CANCEL',
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
      sessionId: command.sessionId,
      expectedLatestRequestId: command.expectedLatestRequestId,
      idempotencyKey: command.idempotencyKey,
    });
  }

  private retryCommandSemantic(command: RequestControlCommand, agentId: AgentId): string {
    return JSON.stringify({
      action: 'RETRY_LATEST',
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
      sessionId: command.sessionId,
      expectedLatestRequestId: command.expectedLatestRequestId,
      idempotencyKey: command.idempotencyKey,
    });
  }

  private editLatestCommandSemantic(command: EditLatestRequestCommand, agentId: AgentId): string {
    return JSON.stringify({
      action: 'EDIT_LATEST',
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId,
      sessionId: command.sessionId,
      expectedLatestRequestId: command.expectedLatestRequestId,
      editedInputText: command.editedInputText,
      attachmentIds: command.attachmentIds,
      idempotencyKey: command.idempotencyKey,
    });
  }

  private isTerminalRunStatus(status: RequestRun['status']): boolean {
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'SUPERSEDED';
  }

  private assertValidTimelineAnchor(sequence: RuntimeEventStreamQuery['lastSeenSequence']): void {
    const value = Number(sequence);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AgentError({
        code: 'STREAM_REPLAY_ANCHOR_INVALID',
        message: 'Stream replay anchor must be a non-negative safe integer.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'STREAM_REPLAY_ANCHOR_INVALID' },
      });
    }
  }

  private assertValidEventHistoryPagination(afterSequence: TimelineSequence, limit: number): void {
    if (!Number.isSafeInteger(Number(afterSequence)) || Number(afterSequence) < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new AgentError({
        code: 'SESSION_EVENT_HISTORY_PAGINATION_INVALID',
        message: 'Session event history pagination is invalid.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'SESSION_EVENT_HISTORY_PAGINATION_INVALID' },
      });
    }
  }

  private assertUnfilteredLiveTailQuery(query: RuntimeSessionStreamEventsQuery): void {
    if (query.requestId === undefined && query.runId === undefined) {
      return;
    }
    throw new AgentError({
      code: 'STREAM_REPLAY_ANCHOR_REQUIRED',
      message: 'Filtered stream replay requires an explicit lastSeenSequence anchor.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'STREAM_REPLAY_ANCHOR_REQUIRED' },
    });
  }

  private hookScope(run: RequestRun, context: RequestContext, stage: LifecycleStage, occurrence: string): HookExecutionScope {
    return {
      coordinates: lifecycleHookCoordinates(run, context, stage, occurrence),
      ownerScope: { tenantId: context.identityContext.tenantId, subjectId: context.identityContext.subjectId },
      requestContextId: context.requestContextId,
    };
  }

  private now(): EpochMillis {
    const candidate = this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
    const monotonic = Math.max(Number(candidate), this.lastEpochMillis + 1);
    this.lastEpochMillis = monotonic;
    return brand<number, 'EpochMillis'>(monotonic);
  }

  private id(prefix: string): string {
    return this.deps.idFactory?.(prefix) ?? `${prefix}-${crypto.randomUUID()}`;
  }

  private async saveCheckpoint(
    command: SubmitRequestCommand,
    run: RequestRun,
    context: RequestContext,
    triggerReason: CheckpointRecord['triggerReason'],
  ): Promise<void> {
    await saveRuntimeCheckpoint(
      { checkpointStore: this.deps.checkpointStore, activeContextStore: this.deps.activeContextStore },
      run,
      context,
      triggerReason,
      { now: () => this.now(), id: (prefix) => this.id(prefix) },
    );
  }
}

function hasVisibleTerminalContent(content: string): boolean {
  return content.trim().length > 0;
}

export function createRequestLifecycleCoordinator<TAgentRuntimeDependencies extends object>(
  deps: RequestLifecycleDependencies<TAgentRuntimeDependencies>,
): RequestLifecycleCoordinator<TAgentRuntimeDependencies> {
  return new RequestLifecycleCoordinator(deps);
}

export function createNoopCheckpointStoreGateway(): NoopCheckpointStoreGateway {
  return new NoopCheckpointStoreGateway();
}

function terminalFailureReasonFromPayload(payload: JsonObject): TerminalFailureReason | undefined {
  const code = nonEmptyString(payload.code);
  const category = nonEmptyString(payload.category);
  if (code === undefined && category === undefined) {
    return undefined;
  }
  return {
    ...(code === undefined ? {} : { code }),
    ...(category === undefined ? {} : { category }),
  };
}

interface TerminalEventPayload {
  readonly content?: string;
  readonly text?: string;
  readonly contentType?: string;
  readonly code?: string;
  readonly category?: string;
  readonly retryable?: boolean;
}

function extractTerminalPayload(payload: JsonObject, content: string, contentType: string): RuntimeTerminalResult {
  const p = payload as TerminalEventPayload;
  const code = nonEmptyString(p.code);
  const category = nonEmptyString(p.category);
  const retryable = typeof p.retryable === 'boolean' ? p.retryable : undefined;
  const safeError = code !== undefined && category !== undefined && retryable !== undefined ? { code, category, retryable } : undefined;
  return {
    content,
    contentType,
    ...(safeError === undefined ? {} : { safeError }),
  };
}

function isMatchingTerminalMessage(
  message: SessionMessageRecord | undefined,
  owner: SessionTimelineOwner,
  run: RequestRunRecord,
  event: RunTimelineEventRecord,
): message is SessionMessageRecord {
  const terminalStatus = terminalStatusForEvent(event.type);
  return (
    terminalStatus !== undefined &&
    run.status === terminalStatus &&
    message !== undefined &&
    message.tenantId === owner.tenantId &&
    message.subjectId === owner.subjectId &&
    message.agentId === owner.agentId &&
    message.sessionId === run.sessionId &&
    message.requestId === run.requestId &&
    message.runId === run.runId &&
    message.role === 'ASSISTANT' &&
    message.visible === true &&
    message.metadata['eventType'] === event.type &&
    message.metadata['status'] === terminalStatus
  );
}

function terminalStatusForEvent(type: RunTimelineEventRecord['type']): RequestRunRecord['status'] | undefined {
  if (type === 'REQUEST_COMPLETED') {
    return 'COMPLETED';
  }
  if (type === 'REQUEST_FAILED') {
    return 'FAILED';
  }
  if (type === 'REQUEST_CANCELED') {
    return 'CANCELED';
  }
  if (type === 'REQUEST_SUPERSEDED') {
    return 'SUPERSEDED';
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function terminalReasonCode(status: RequestRun['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'TERMINAL_COMPLETED';
    case 'FAILED':
      return 'TERMINAL_FAILED';
    case 'CANCELED':
      return 'TERMINAL_CANCELED';
    case 'SUPERSEDED':
      return 'TERMINAL_SUPERSEDED';
    case 'QUEUED':
    case 'EXECUTING':
      return 'RUN_NOT_TERMINAL';
    default:
      return 'RUN_NOT_TERMINAL';
  }
}

function isJsonObjectValue(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lifecycleHookCoordinates(
  run: RequestRun,
  context: RequestContext,
  stage: LifecycleStage,
  occurrence: string,
): LifecycleHookInvocationCoordinates {
  return {
    sessionId: run.sessionId,
    requestId: run.requestId,
    requestRunId: run.runId,
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    stageOccurrenceKey: `${stage}:${occurrence}`,
  };
}

function agentErrorFromLifecycleHookInterruption(interruption: LifecycleHookControlInterruption): AgentError {
  return new AgentError({
    code: lifecycleHookInterruptionErrorCode(interruption.outcome),
    message: interruption.safeReason ?? 'Lifecycle hook interrupted request execution.',
    category: interruption.outcome === 'DENY' ? 'POLICY_DENIED' : 'VALIDATION',
    retryable: false,
    safeDetails: {
      stage: interruption.stage,
      hookInvocationId: interruption.hookInvocationId,
      outcome: interruption.outcome,
      ...(interruption.safeReason === undefined ? {} : { safeReason: interruption.safeReason }),
      ...(interruption.pendingInput === undefined ? {} : { pendingInputId: interruption.pendingInput.id }),
      ...(interruption.safeError?.safeDetails === undefined ? {} : interruption.safeError.safeDetails),
    },
  });
}

function lifecycleHookInterruptionErrorCode(outcome: LifecycleHookControlInterruption['outcome']): string {
  switch (outcome) {
    case 'DENY':
      return 'LIFECYCLE_HOOK_DENIED';
    case 'BLOCK':
      return 'LIFECYCLE_HOOK_BLOCKED';
    case 'PEND':
      return 'LIFECYCLE_HOOK_PENDING';
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function rootUserMessageMetadata(command: SubmitRequestCommand): JsonObject {
  return {
    ...(command.attachmentIds.length === 0 ? {} : { attachmentIds: [...command.attachmentIds] }),
    ...(command.requestModelOptions === undefined ? {} : { requestModelOptions: command.requestModelOptions as unknown as JsonObject }),
    ...(command.routingConstraints === undefined ? {} : { routingConstraints: command.routingConstraints as JsonObject }),
  };
}

function resolvePendingQuestionAnswers(pending: PendingInputRecord): readonly JsonObject[] {
  const answers = pending.responseAnswers ?? [];
  return pending.request.questions.map((question, questionIndex) => {
    const values = answers[questionIndex] ?? [];
    const answerKind = pending.responseAnswerKinds?.[questionIndex];
    if (question.options.length === 0) {
      return {
        questionIndex,
        text: values[0] ?? '',
      };
    }

    const optionsByValue = new Map(question.options.map((option) => [option.value, option]));
    if (answerKind === 'CUSTOM_TEXT') {
      return {
        questionIndex,
        selections: [],
        customText: values[0] ?? '',
      };
    }
    if (answerKind === 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT') {
      const selectionValues = values.slice(0, -1);
      return {
        questionIndex,
        selections: selectionValues.flatMap((value) => {
          const option = optionsByValue.get(value);
          return option === undefined ? [] : [{ value: option.value, label: option.label }];
        }),
        customText: values.at(-1) ?? '',
      };
    }
    const selectedOption = optionsByValue.get(values[0] ?? '');
    if (question.multiple !== true && selectedOption?.requiresTextInput === true) {
      return {
        questionIndex,
        selections: [
          {
            value: selectedOption.value,
            label: selectedOption.label,
            textInput: values[1] ?? '',
          },
        ],
      };
    }

    const selections = values.flatMap((value) => {
      const option = optionsByValue.get(value);
      return option === undefined
        ? []
        : [
            {
              value: option.value,
              label: option.label,
            },
          ];
    });
    const customText = values.find((value) => !optionsByValue.has(value));
    return {
      questionIndex,
      selections,
      ...(customText === undefined ? {} : { customText }),
    };
  });
}

function pendingQuestionAnswerInstruction(
  resolvedAnswers?: readonly JsonObject[],
  answerKinds?: readonly PendingInputQuestionAnswerKind[],
): string | undefined {
  if (resolvedAnswers?.some((answer) => typeof answer['customText'] === 'string') !== true) {
    return undefined;
  }
  const hasPureCustomText =
    answerKinds?.includes('CUSTOM_TEXT') === true ||
    (answerKinds === undefined &&
      resolvedAnswers.some((answer) => {
        const selections = answer['selections'];
        return typeof answer['customText'] === 'string' && (!Array.isArray(selections) || selections.length === 0);
      }));
  const hasOptionSelectionsWithCustomText =
    answerKinds?.includes('OPTION_SELECTIONS_WITH_CUSTOM_TEXT') === true ||
    (answerKinds === undefined &&
      resolvedAnswers.some((answer) => {
        const selections = answer['selections'];
        return typeof answer['customText'] === 'string' && Array.isArray(selections) && selections.length > 0;
      }));
  return [
    'Use resolvedAnswers as the interpreted user response and answerKinds, when present, as its input-source classification.',
    ...(hasPureCustomText ? ['For CUSTOM_TEXT, customText is authoritative free text.'] : []),
    ...(hasOptionSelectionsWithCustomText
      ? [
          'For OPTION_SELECTIONS_WITH_CUSTOM_TEXT, selections and customText are intentional parts of one answer; use both without discarding or reinterpreting either.',
        ]
      : []),
    'A customText value matching a predefined option value or label remains custom text.',
    'Do not repeat the previous AskUserQuestion merely because customText is not a predefined selection.',
  ].join(' ');
}

function summarizePendingAnswers(answers: ReadonlyArray<readonly string[]>): string {
  const flattened = answers.flatMap((answer) => answer.filter((item) => typeof item === 'string' && item.length > 0));
  if (flattened.length === 0) {
    return 'answered';
  }
  return flattened.slice(0, 4).join(',').slice(0, 256);
}

function isWorkflowInterruptPendingInput(pending: PendingInputRecord): boolean {
  return pending.producerRef.kind === 'WORKFLOW_NODE' && pending.producerRef.nodeType === 'INTERRUPT';
}

function isRecoverableTerminalStatus(value: unknown): value is Extract<RequestRun['status'], 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'> {
  return value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELED' || value === 'SUPERSEDED';
}
