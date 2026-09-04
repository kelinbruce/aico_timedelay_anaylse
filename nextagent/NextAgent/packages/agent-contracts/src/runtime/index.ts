import type {
  AgentId,
  AgentType,
  AgentVersion,
  AttachmentId,
  AttachmentIntakeReservationId,
  CapabilityId,
  CapabilityInvocationStatus,
  CapabilityKind,
  CapabilityProviderKind,
  CheckpointId,
  CheckpointTriggerReason,
  EpochMillis,
  IdempotencyKey,
  IdentityContext,
  JsonObject,
  LifecycleStage,
  MessageId,
  MessageContentType,
  PendingInputKind,
  PendingInputId,
  PendingInputQuestionAnswerKind,
  PendingInputStatus,
  RequestContextId,
  RequestLocale,
  RequestPriority,
  RequestRunId,
  RestrictedOperationKind,
  RiskLevel,
  RiskPolicyOutcome,
  RunStatus,
  SafeError,
  SessionId,
  SessionMessageRole,
  SubjectId,
  TaskEventId,
  TerminalCommitState,
  TenantId,
  TimelineEventType,
  TimelineSequence,
  VisibilityReason,
} from '@nextagent/agent-common';
import {
  ToolChoiceSchema,
  type ModelInferenceOptions,
  type ModelMessage,
  type ModelToolCall,
  type ModelToolDescriptor,
  type ModelUsage,
} from '../model/index.js';
import { Type, type Static } from '@sinclair/typebox';
import type {
  AgentWorkspacePolicy,
  AgentAssembly,
  AgentPolicyActivation,
  ExecutionWorkspaceRootAccess,
  ExecutionWorkspaceRootKind,
} from '../agent-assembly/index.js';
import type { CapabilityLocales } from '../capability/index.js';
import type { ExecutionCorrelationPort } from '../observability/index.js';
import type { AgentRoutingPolicyExecutable } from '../core/index.js';
import type { OwnerScoped, PendingInputProducerRef } from '../gateway/index.js';
import type {
  ConversationPreviewPage,
  GeneratedUserMessageDraft,
  SessionActivityMessage,
  SessionMessage,
  SessionMessageDraft,
  SessionMessagePage,
  UserSession,
  UserSessionPage,
} from '../session/index.js';
export type { LifecycleStage } from '@nextagent/agent-common';

const RoutingConstraintSafeIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' });

export const RoutingConstraintsSchema = Type.Object(
  {
    targetSkill: Type.Optional(RoutingConstraintSafeIdSchema),
    targetRecipe: Type.Optional(RoutingConstraintSafeIdSchema),
    forbiddenCapabilityIds: Type.Optional(Type.Array(RoutingConstraintSafeIdSchema, { maxItems: 64 })),
    executionMode: Type.Optional(Type.Union([Type.Literal('default'), Type.Literal('model-only')])),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: 35, pattern: '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$' })),
    allowHumanInput: Type.Optional(Type.Boolean()),
    allowSubagents: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type RoutingConstraints = Static<typeof RoutingConstraintsSchema>;

export const RequestModelThinkingSchema = Type.Object(
  {
    depth: Type.Literal('OFF'),
  },
  { additionalProperties: false },
);

export const RequestModelOptionsSchema = Type.Object(
  {
    thinking: Type.Optional(RequestModelThinkingSchema),
    toolChoice: Type.Optional(ToolChoiceSchema),
  },
  { additionalProperties: false },
);

export type RequestModelThinking = Static<typeof RequestModelThinkingSchema>;
export type RequestModelOptions = Static<typeof RequestModelOptionsSchema>;

export interface PropagationAttributes {
  readonly taskEventId?: TaskEventId;
}

export interface SubmitRequestCommand {
  readonly sessionId?: SessionId;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly identityContext: IdentityContext;
  readonly inputText: string;
  readonly attachmentIds: readonly AttachmentId[];
  readonly locale: RequestLocale;
  readonly routingConstraints?: RoutingConstraints;
  readonly requestModelOptions?: RequestModelOptions;
  readonly idempotencyKey: IdempotencyKey;
  readonly parentSessionId?: SessionId;
  readonly parentRunId?: RequestRunId;
  readonly parentRequestId?: MessageId;
  readonly priority?: RequestPriority;
  readonly reservedRequest?: ReservedRequestCoordinates;
  readonly inputVariables?: JsonObject;
  readonly propagationAttributes?: PropagationAttributes;
  /**
   * When set, this submit is an input-guard-blocked round: the guard service
   * refused the input and `guardBlockRefusal` is the refusal message
   * (RobotRouter's `refusalMessage`, passed through unchanged). The runtime
   * MUST create the run, persist the user input, then immediately commit a
   * `COMPLETED` terminal whose assistant content is `guardBlockRefusal`
   * (`visible=true` + `metadata.modelVisibility.excluded=true`), WITHOUT
   * enqueueing model work �� the model loop MUST NOT run. Absent on normal
   * submits.
   */
  readonly guardBlockRefusal?: string;
}

export interface SessionTimelineEventInput {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
  readonly requestId: MessageId;
  readonly requestContextId: RequestContextId;
  readonly type: TimelineEventType;
  readonly inlinePayload: JsonObject;
}

export interface RequestControlCommand {
  readonly sessionId: SessionId;
  readonly identityContext: IdentityContext;
  readonly expectedLatestRequestId: MessageId;
  readonly action: 'CANCEL' | 'RETRY_LATEST';
  readonly idempotencyKey: IdempotencyKey;
  readonly inputVariables?: JsonObject;
}

export interface EditLatestRequestCommand {
  readonly sessionId: SessionId;
  readonly identityContext: IdentityContext;
  readonly expectedLatestRequestId: MessageId;
  readonly editedInputText: string;
  readonly attachmentIds: readonly AttachmentId[];
  readonly idempotencyKey: IdempotencyKey;
  readonly locale?: RequestLocale;
  readonly reservedRequest?: ReservedRequestCoordinates;
  readonly inputVariables?: JsonObject;
  /**
   * When set, this edit is an input-guard-blocked round: the guard service
   * refused the edited input and `guardBlockRefusal` is the refusal message.
   * The runtime MUST create the run, persist the user input, then immediately
   * commit a `COMPLETED` terminal whose assistant content is `guardBlockRefusal`
   * (`visible=true` + `metadata.modelVisibility.excluded=true`), WITHOUT
   * enqueueing model work �� the model loop MUST NOT run. Absent on normal edits.
   */
  readonly guardBlockRefusal?: string;
}

export type ReserveSubmitAction = 'SUBMIT_REQUEST' | 'EDIT_LATEST_REQUEST';

export interface ReservedRequestCoordinates {
  readonly reservationId: AttachmentIntakeReservationId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
}

export interface ReserveSubmitCommand {
  readonly sessionId: SessionId;
  readonly identityContext: IdentityContext;
  readonly action: ReserveSubmitAction;
  readonly inputText: string;
  readonly locale?: RequestLocale;
  readonly idempotencyKey: IdempotencyKey;
  readonly attachmentIntakePresent: boolean;
}

export interface ReserveSubmitAccepted extends ReservedRequestCoordinates {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly replay: boolean;
  readonly intakeOutcome?: {
    readonly status: 'INTAKE_ACCEPTED' | 'INTAKE_REJECTED';
    readonly attachmentIds: readonly AttachmentId[];
    readonly rejectionReasonCode?: string;
    readonly safeError?: SafeError;
  };
}

export interface RequestAccepted {
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly attempt: number;
}

export type ExecutionDeploymentMode = 'LOCAL' | 'REMOTE';

export interface ResolveExecutionWorkspaceInput {
  readonly runtimeWorkspaceRoot: string;
  readonly sharedDataRoot?: string;
  readonly workspacePolicy: AgentWorkspacePolicy;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId?: SessionId;
  readonly runId: RequestRunId;
  readonly deploymentMode: ExecutionDeploymentMode;
}

export interface ExecutionWorkspaceRootView {
  readonly kind: ExecutionWorkspaceRootKind;
  readonly logicalPath: 'workspace' | '.nextagent' | 'temp' | 'generated-skills' | 'shared-data';
  readonly physicalPath: string;
  readonly access: ExecutionWorkspaceRootAccess;
}

export interface ExecutionWorkspaceView {
  readonly workspaceDir: 'workspace/';
  readonly defaultCwd: string;
  readonly roots: readonly ExecutionWorkspaceRootView[];
}

export interface ExecutionWorkspaceResolver {
  resolve: (input: ResolveExecutionWorkspaceInput) => ExecutionWorkspaceView;
}

export interface LargeContentExternalizationContext {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly messageId: MessageId;
}

export interface LargeContentExternalizerPort {
  externalize: (draft: SessionMessageDraft, executionContext: LargeContentExternalizationContext) => Promise<SessionMessageDraft>;
}

export interface ForkPromotionContentResolutionRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId: MessageId;
  readonly sourceRequestId: MessageId;
  readonly sourceRunId: RequestRunId;
  readonly refId: string;
  readonly maxBytes: number;
}

export interface ForkPromotionContentResolutionResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ForkPromotionContentResolverPort {
  resolveForkPromotionContent: (
    request: ForkPromotionContentResolutionRequest,
    signal?: AbortSignal,
  ) => Promise<ForkPromotionContentResolutionResult | undefined>;
}

export interface RequestControlAccepted {
  readonly sessionId: SessionId;
  readonly targetRequestId: MessageId;
  readonly action: 'CANCEL' | 'RETRY_LATEST';
  readonly idempotencyKey: IdempotencyKey;
}

export interface ToolCallState {
  readonly toolCallId: string;
  readonly capabilityId: CapabilityId;
  readonly arguments: JsonObject;
  readonly status: CapabilityInvocationStatus;
}

export interface RequestContext {
  readonly requestContextId: RequestContextId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly identityContext: IdentityContext;
  readonly locale: RequestLocale;
  readonly acceptedInputText?: string;
  readonly routingConstraints?: RoutingConstraints;
  readonly requestModelOptions?: RequestModelOptions;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly agentTurnIndex: number;
  readonly activeStepId?: string;
  readonly nextLifecycleStage: LifecycleStage;
  readonly currentToolBatchMessageId?: MessageId;
  readonly toolCallStates: readonly ToolCallState[];
  readonly flowVariables: JsonObject;
  readonly propagationAttributes?: PropagationAttributes;
}

export interface RequestRun {
  readonly runId: RequestRunId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly attempt: number;
  readonly retryOfRunId?: RequestRunId;
  readonly parentRunId?: RequestRunId;
  readonly parentRequestId?: MessageId;
  readonly priority?: RequestPriority;
  readonly status: RunStatus;
  readonly version: number;
  readonly terminalCommitState: TerminalCommitState;
  readonly lockedBy?: string;
  readonly lockExpiresAt?: EpochMillis;
  readonly deadlineAt?: EpochMillis;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

const ThinkingReasoningSchema = Type.String({ minLength: 1, pattern: '\\S' });
const ThinkingStepIdSchema = Type.String({ minLength: 1, pattern: '\\S' });

export const PartialThinkingTimelinePayloadSchema = Type.Object(
  {
    reasoning: ThinkingReasoningSchema,
    stepId: ThinkingStepIdSchema,
    completed: Type.Optional(Type.Never()),
    segmentId: Type.Optional(Type.Never()),
    segmentOrdinal: Type.Optional(Type.Never()),
    content: Type.Optional(Type.Never()),
    text: Type.Optional(Type.Never()),
  },
  { additionalProperties: true },
);

export const FinalThinkingTimelinePayloadSchema = Type.Object(
  {
    reasoning: ThinkingReasoningSchema,
    stepId: ThinkingStepIdSchema,
    completed: Type.Literal(true),
    segmentId: Type.Optional(Type.Never()),
    segmentOrdinal: Type.Optional(Type.Never()),
    content: Type.Optional(Type.Never()),
    text: Type.Optional(Type.Never()),
  },
  { additionalProperties: true },
);

export const ThinkingTimelineEventLifecycleSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('LLM_THINKING_DELTA'),
      persistence: Type.Literal('LIVE_ONLY'),
      inlinePayload: PartialThinkingTimelinePayloadSchema,
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      type: Type.Literal('LLM_THINKING_DELTA'),
      persistence: Type.Literal('PERSISTED'),
      inlinePayload: FinalThinkingTimelinePayloadSchema,
    },
    { additionalProperties: true },
  ),
]);

export type PartialThinkingTimelinePayload = Static<typeof PartialThinkingTimelinePayloadSchema>;
export type FinalThinkingTimelinePayload = Static<typeof FinalThinkingTimelinePayloadSchema>;
export type ThinkingTimelineEventLifecycle = Static<typeof ThinkingTimelineEventLifecycleSchema>;

export interface RunTimelineEvent {
  readonly eventId?: string;
  readonly tenantId?: TenantId;
  readonly subjectId?: SubjectId;
  readonly sessionId?: SessionId;
  readonly runId?: RequestRunId;
  readonly requestId?: MessageId;
  readonly requestContextId?: RequestContextId;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly persistence?: 'PERSISTED' | 'LIVE_ONLY';
  readonly sequence?: TimelineSequence;
  readonly type: TimelineEventType;
  readonly inlinePayload: JsonObject;
  readonly contentRef?: string;
  readonly createdAt?: Date;
}

export interface RuntimeEventStreamQuery {
  readonly sessionId: SessionId;
  readonly lastSeenSequence: TimelineSequence;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly signal?: AbortSignal;
}

export interface RuntimeEventStreamPort {
  stream: (request: RuntimeEventStreamQuery) => AsyncIterable<RunTimelineEvent>;
}

export interface RuntimeSessionStreamEventsQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly lastSeenSequence?: TimelineSequence;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly signal?: AbortSignal;
}

export const RuntimeListSessionEventsPaginationSchema = Type.Object(
  {
    afterSequence: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    limit: Type.Integer({ minimum: 1, maximum: 1000 }),
  },
  { additionalProperties: false },
);

export interface RuntimeListSessionEventsQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
  readonly afterSequence: TimelineSequence;
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export const RuntimeSafeRunTimelineEventSchema = Type.Object(
  {
    eventId: Type.Optional(Type.String({ minLength: 1 })),
    sessionId: Type.Optional(Type.String({ minLength: 1 })),
    runId: Type.Optional(Type.String({ minLength: 1 })),
    requestId: Type.Optional(Type.String({ minLength: 1 })),
    requestContextId: Type.Optional(Type.String({ minLength: 1 })),
    agentVersion: Type.Optional(Type.String({ minLength: 1 })),
    persistence: Type.Optional(Type.Union([Type.Literal('PERSISTED'), Type.Literal('LIVE_ONLY')])),
    sequence: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    type: Type.String({ minLength: 1 }),
    inlinePayload: Type.Object({}, { additionalProperties: true }),
    createdAt: Type.Optional(Type.Date()),
  },
  { additionalProperties: false },
);

export const RuntimeSessionEventHistoryPageSchema = Type.Union([
  Type.Object(
    {
      availability: Type.Literal('AVAILABLE'),
      events: Type.Array(RuntimeSafeRunTimelineEventSchema),
      nextAfterSequence: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      availability: Type.Literal('LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE'),
      events: Type.Array(Type.Never(), { maxItems: 0 }),
    },
    { additionalProperties: false },
  ),
]);

export type RuntimeSessionEventHistoryPage =
  | {
      readonly availability: 'AVAILABLE';
      readonly events: readonly RunTimelineEvent[];
      readonly nextAfterSequence?: TimelineSequence;
    }
  | {
      readonly availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE';
      readonly events: readonly [];
      readonly nextAfterSequence?: never;
    };

export interface RuntimeGetActiveRunQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly signal?: AbortSignal;
}

export interface RuntimeActiveRunSummary {
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly status: RunStatus;
}

export interface RuntimeGetRequestSummaryQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
}

export interface RuntimeRequestSummary {
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly status: RunStatus;
  readonly updatedAt: EpochMillis;
  readonly activePendingInput?: PendingInputRequest;
  readonly terminalResult?: RuntimeTerminalResult;
}

export interface RuntimeTerminalResult {
  readonly content: string;
  readonly contentType: string;
  readonly safeError?: {
    readonly code: string;
    readonly category: string;
    readonly retryable: boolean;
  };
}

export interface RuntimeCreateSessionCommand {
  readonly identityContext: IdentityContext;
  readonly locale?: RequestLocale;
  readonly idempotencyKey: IdempotencyKey;
  readonly agentId?: string;
}

export interface RuntimeListSessionsQuery {
  readonly identityContext: IdentityContext;
  readonly offset: number;
  readonly limit: number;
  readonly questionSearchText?: string;
  readonly createdAtFrom?: EpochMillis;
  readonly createdAtTo?: EpochMillis;
  readonly agentId?: AgentId;
}

export interface RuntimeRequireSessionQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
}

export interface RuntimeDeleteSessionCommand {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
}

export interface RuntimeForkSessionFromMessageCommand {
  readonly identityContext: IdentityContext;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface RuntimeForkSessionFromRequestCommand {
  readonly identityContext: IdentityContext;
  readonly sourceSessionId: SessionId;
  readonly sourceRequestId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface ForkSessionFromMessageResult {
  readonly childSession: UserSession;
}

export interface RuntimeListSessionMessagesQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly requestId?: MessageId;
  readonly locale?: RequestLocale;
  readonly includeCapabilityResults: boolean;
  readonly beforeCursor?: string;
  readonly afterCursor?: string;
  readonly anchorMessageId?: MessageId;
  readonly limit: number;
}

export interface RuntimeConversationPreviewQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly offset?: number;
  readonly limit: number;
}

export interface RuntimeResolveProcessMessagesQuery {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly messageIds: readonly MessageId[];
  readonly includeLegacyCandidates?: boolean;
  readonly signal?: AbortSignal;
}

export type RuntimeResolvedProcessMessage = SessionMessage;

export interface RuntimeSessionPort {
  createSession: (command: RuntimeCreateSessionCommand) => Promise<UserSession>;
  requireSession: (query: RuntimeRequireSessionQuery) => Promise<UserSession>;
  listSessions: (query: RuntimeListSessionsQuery) => Promise<UserSessionPage>;
  deleteSession: (command: RuntimeDeleteSessionCommand) => Promise<void>;
  forkFromMessage: (command: RuntimeForkSessionFromMessageCommand, signal?: AbortSignal) => Promise<ForkSessionFromMessageResult>;
  forkFromRequest: (command: RuntimeForkSessionFromRequestCommand, signal?: AbortSignal) => Promise<ForkSessionFromMessageResult>;
  listMessages: (query: RuntimeListSessionMessagesQuery) => Promise<SessionMessagePage>;
  resolveProcessMessages?: (query: RuntimeResolveProcessMessagesQuery) => Promise<readonly RuntimeResolvedProcessMessage[]>;
  listConversationPreview: (query: RuntimeConversationPreviewQuery) => Promise<ConversationPreviewPage>;
  updateTitle: (command: RuntimeUpdateSessionTitleCommand) => Promise<UserSession>;
  streamEvents: (query: RuntimeSessionStreamEventsQuery) => AsyncIterable<RunTimelineEvent>;
  listEvents: (query: RuntimeListSessionEventsQuery) => Promise<RuntimeSessionEventHistoryPage>;
  getActiveRun: (query: RuntimeGetActiveRunQuery) => Promise<RuntimeActiveRunSummary | undefined>;
  getRequestSummary: (query: RuntimeGetRequestSummaryQuery) => Promise<RuntimeRequestSummary | undefined>;
}

export interface RuntimeStreamSessionActivitiesQuery {
  readonly identityContext: IdentityContext;
  readonly signal?: AbortSignal;
}

export interface RuntimeConsumeSessionActivityCommand {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly activityId: string;
  readonly observedRunId: RequestRunId;
}

export interface RuntimeSessionActivityPort {
  streamSessionActivities: (query: RuntimeStreamSessionActivitiesQuery) => AsyncIterable<SessionActivityMessage>;
  consumeSessionActivity: (command: RuntimeConsumeSessionActivityCommand) => Promise<void>;
}

export interface RuntimeUpdateSessionTitleCommand {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly title: string;
  readonly idempotencyKey: IdempotencyKey;
}

export type AgentExecutionOutcome =
  { readonly status: 'COMPLETED' } | { readonly status: 'PENDING_INPUT'; readonly pendingInput: PendingInputRequest };

export interface Agent {
  execute: (run: RequestRun, context: RequestContext, signal: AbortSignal) => Promise<AgentExecutionOutcome>;
}

export interface AgentConstructor<TKit extends object = object> {
  new (kit: TKit): Agent;
  getType: () => AgentType;
}

export interface AgentRunStatePort {
  emitEvent: (run: RequestRun, context: RequestContext, event: RunTimelineEvent) => Promise<void>;
  appendMessage: (run: RequestRun, context: RequestContext, draft: SessionMessageDraft) => Promise<MessageId>;
  setCapabilityTerminalAnswer: (run: RequestRun, context: RequestContext, answer: { readonly content: string }) => Promise<void>;
  /**
   * Persist a capability-generated USER message (e.g. a directed-Skill body)
   * that must be page-hidden (`visible:false`) but model-visible
   * (`metadata.modelVisibility.included=true`). Optional on the port because
   * not every runtime adapter (or test stub) needs to emit generated user
   * messages; the production {@link RuntimeOwnedAgentRunStatePort} always
   * implements it. Callers MUST guard with `?.` and fall back to the volatile
   * `generatedMessages` path when absent.
   */
  appendGeneratedUserMessage?: (run: RequestRun, context: RequestContext, draft: GeneratedUserMessageDraft) => Promise<MessageId>;
  saveCheckpoint: (run: RequestRun, context: RequestContext, triggerReason: CheckpointTriggerReason) => Promise<void>;
  requestPendingInput: (
    run: RequestRun,
    context: RequestContext,
    intent: PendingInputIntent,
    options?: RequestPendingInputOptions,
  ) => Promise<PendingInputRequest>;
}

export interface RunMessagePort {
  appendMessage: (run: RequestRun, context: RequestContext, draft: SessionMessageDraft) => Promise<MessageId>;
  /**
   * Persist a capability-generated USER message. See
   * {@link AgentRunStatePort.appendGeneratedUserMessage}; optional because the
   * canonical USER-input path uses `SessionMessageDraft` (which excludes the
   * USER role), and only the directed-Skill body persistence path needs this.
   */
  appendGeneratedUserMessage?: (run: RequestRun, context: RequestContext, draft: GeneratedUserMessageDraft) => Promise<MessageId>;
}

export interface CheckpointPayload {
  readonly agentId: AgentId;
  readonly checkpointId: CheckpointId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly runVersion: number;
  readonly agentTurnIndex: number;
  readonly triggerReason: CheckpointTriggerReason;
  readonly lastSequence: TimelineSequence;
  readonly activeContextVersion: number;
  readonly flowVariables: JsonObject;
  readonly savedAt: EpochMillis;
  readonly idempotencyKey: IdempotencyKey;
}

export type { PendingInputKind, PendingInputQuestionAnswerKind, PendingInputStatus } from '@nextagent/agent-common';

export interface PendingInputQuestion {
  readonly prompt: string;
  readonly options: readonly PendingInputOption[];
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

export interface PendingInputOption {
  readonly label: string;
  readonly value: string;
  readonly requiresTextInput?: boolean;
  readonly inputPlaceholder?: string;
}

export interface PendingInputRequest {
  readonly id: PendingInputId;
  readonly sessionId: SessionId;
  readonly kind: PendingInputKind;
  readonly questions: readonly PendingInputQuestion[];
  readonly timeoutAt?: EpochMillis;
}

export interface PendingInputAnswer {
  readonly sessionId: SessionId;
  readonly pendingInputId: PendingInputId;
  readonly answers: ReadonlyArray<readonly string[]>;
  readonly answerKinds?: readonly PendingInputQuestionAnswerKind[];
}

export interface AnswerPendingInputCommand {
  readonly identityContext: IdentityContext;
  readonly idempotencyKey: IdempotencyKey;
  readonly answer: PendingInputAnswer;
}

export interface PendingInputAnswerAccepted {
  readonly sessionId: SessionId;
  readonly pendingInputId: PendingInputId;
  readonly status: Extract<PendingInputStatus, 'RECEIVED'>;
}

export interface PendingInput {
  readonly pendingInputId: PendingInputId;
  readonly requestRunId: RequestRunId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestContextId: RequestContextId;
  readonly checkpointId: CheckpointId;
  readonly kind: PendingInputKind;
  readonly questions: readonly PendingInputQuestion[];
  readonly timeoutAt?: EpochMillis;
  readonly status: PendingInputStatus;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
  readonly responseAnswers?: ReadonlyArray<readonly string[]>;
}

export type HookFailureMode = 'CONTINUE' | 'FAIL';
export type HookKind = 'SYSTEM' | 'CUSTOM';
export type HookEffect = 'OBSERVE' | 'TRANSFORM' | 'CONTROL';
export type HookExecutionStrategy = 'OBSERVE_PARALLEL' | 'SERIAL_IMPACT';
export type HookOutcome = 'PASS' | 'SKIP' | 'DENY' | 'BLOCK' | 'PEND';
export type HookInvocationStatus = 'SUCCESS' | 'TIMEOUT' | 'FAILED' | 'INVALID_RESULT' | 'IGNORED';

export interface LifecycleHookExecutable<TStages extends readonly LifecycleStage[] = readonly LifecycleStage[]> {
  execute: <S extends TStages[number]>(input: HookInput<S>, signal?: AbortSignal) => HookResult<S> | Promise<HookResult<S>>;
}

export interface SystemHookOrder {
  readonly priority: number;
}

export interface LifecycleHook<TStages extends readonly LifecycleStage[] = readonly LifecycleStage[]> extends LifecycleHookExecutable<TStages> {
  readonly hookId: string;
  readonly kind: HookKind;
  readonly effects: readonly HookEffect[];
  readonly supportedStages: TStages;
  readonly failureMode: HookFailureMode;
  readonly order?: SystemHookOrder;
  readonly timeoutMs?: number;
  readonly configSchema?: JsonObject;
  readonly configure?: (config: JsonObject) => LifecycleHookExecutable<TStages>;
}

export interface LifecycleHookDefinition {
  readonly hookId: string;
  readonly kind: HookKind;
  readonly supportedStages: readonly LifecycleStage[];
  readonly effects: readonly HookEffect[];
  readonly executionStrategy: HookExecutionStrategy;
  readonly failureMode: HookFailureMode;
  readonly order?: number;
  readonly timeoutMs?: number;
}

export interface HookBoundary {}

export interface BoundaryMutation {}

export interface RequestAcceptBoundary extends HookBoundary {
  readonly locale: RequestLocale;
  readonly attachmentCount: number;
  readonly idempotencyKeyPresent: boolean;
  readonly safeRequestClass: 'EMPTY' | 'TEXT_ONLY' | 'TEXT_WITH_ATTACHMENTS';
}

export interface PlanningBoundary extends HookBoundary {
  readonly stepId?: string;
  readonly roundIndex?: number;
  readonly locale: RequestLocale;
  readonly acceptedInputSummary: string;
  readonly attachmentCount: number;
  readonly flowVariables?: JsonObject;
  readonly capabilityGeneratedMessages?: readonly JsonObject[];
  readonly capabilityContextPatch?: JsonObject;
}

export interface PlanningMutation extends BoundaryMutation {
  readonly flowVariables?: JsonObject;
  readonly capabilityGeneratedMessages?: readonly JsonObject[];
  readonly capabilityContextPatch?: JsonObject;
}

export interface ModelInvokeBoundary extends HookBoundary, ModelInferenceOptions {
  readonly stepId: string;
  readonly modelId: string;
  readonly contextWindowTokens?: number;
  readonly toolCount: number;
  readonly safeModelRequestSummary: string;
  readonly messages?: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDescriptor[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface ModelInvokeMutation extends BoundaryMutation, ModelInferenceOptions {
  readonly messages?: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDescriptor[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface ModelResultBoundary extends HookBoundary {
  readonly stepId: string;
  readonly modelId: string;
  readonly toolCallCount: number;
  readonly safeAssistantOutputSummary: string;
  readonly firstContentLatencyMs?: number;
  readonly modelE2ELatencyMs?: number;
  readonly usage?: ModelUsage;
  readonly content?: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly providerResponseId?: string;
}

export interface ModelResultMutation extends BoundaryMutation {
  readonly content?: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly providerResponseId?: string;
}

export interface CapabilityInvokeBoundary extends HookBoundary {
  readonly capabilityId: CapabilityId;
  readonly capabilityKind: CapabilityKind;
  readonly providerKind: CapabilityProviderKind;
  readonly toolCallId: string;
  readonly safeInputSummary: string;
  readonly arguments?: JsonObject;
  readonly timeoutMs?: number;
  readonly pendingInputId?: PendingInputId;
  readonly pendingAnswerSummary?: string;
}

export interface CapabilityInvokeMutation extends BoundaryMutation {
  readonly arguments?: JsonObject;
  readonly timeoutMs?: number;
}

export interface CapabilityResultBoundary extends HookBoundary {
  readonly capabilityId: CapabilityId;
  readonly capabilityInvocationId: string;
  readonly arguments: JsonObject;
  readonly status: CapabilityInvocationStatus;
  readonly safeResultSummary: string;
  readonly generatedMessageCount: number;
  readonly artifactCount: number;
  readonly structuredPayload?: JsonObject;
  readonly generatedMessages?: readonly JsonObject[];
  readonly contextPatch?: JsonObject;
}

export interface CapabilityResultMutation extends BoundaryMutation {
  readonly structuredPayload?: JsonObject;
  readonly generatedMessages?: readonly JsonObject[];
  readonly contextPatch?: JsonObject;
}

export interface ContextCompactBeforeBoundary extends HookBoundary {
  readonly stepId: string;
  readonly contextItemCount: number;
  readonly safeBudgetSummary: string;
  readonly targetBudgetUnits?: number;
}

export interface ContextCompactBeforeMutation extends BoundaryMutation {
  readonly targetBudgetUnits?: number;
}

export interface ContextCompactAfterBoundary extends HookBoundary {
  readonly stepId: string;
  readonly safeBudgetSummary: string;
  readonly content?: string;
}

export interface ContextCompactAfterMutation extends BoundaryMutation {
  readonly content?: string;
}

export interface AgentTerminalBoundary extends HookBoundary {
  readonly finalContent: string;
  readonly toolCalls: readonly JsonObject[];
  readonly safeTerminalSummary: string;
  readonly pendingInputId?: PendingInputId;
  readonly pendingAnswerSummary?: string;
}

export interface AgentTerminalMutation extends BoundaryMutation {
  readonly finalContent?: string;
  readonly toolCalls?: readonly JsonObject[];
}

export type RuntimeLifecycleBoundary =
  | RequestAcceptBoundary
  | PlanningBoundary
  | ModelInvokeBoundary
  | ModelResultBoundary
  | CapabilityInvokeBoundary
  | CapabilityResultBoundary
  | ContextCompactBeforeBoundary
  | ContextCompactAfterBoundary
  | AgentTerminalBoundary;

export type RuntimeLifecycleMutation =
  | PlanningMutation
  | ModelInvokeMutation
  | ModelResultMutation
  | CapabilityInvokeMutation
  | CapabilityResultMutation
  | ContextCompactBeforeMutation
  | ContextCompactAfterMutation
  | AgentTerminalMutation;

export interface HookBoundaryByStage {
  readonly BEFORE_REQUEST_ACCEPT: RequestAcceptBoundary;
  readonly BEFORE_PLANNING: PlanningBoundary;
  readonly BEFORE_MODEL_INVOKE: ModelInvokeBoundary;
  readonly AFTER_MODEL_RESULT: ModelResultBoundary;
  readonly BEFORE_CAPABILITY_INVOKE: CapabilityInvokeBoundary;
  readonly AFTER_CAPABILITY_RESULT: CapabilityResultBoundary;
  readonly BEFORE_CONTEXT_COMPACT: ContextCompactBeforeBoundary;
  readonly AFTER_CONTEXT_COMPACT: ContextCompactAfterBoundary;
  readonly BEFORE_AGENT_TERMINAL: AgentTerminalBoundary;
}

export interface HookMutationByStage {
  readonly BEFORE_REQUEST_ACCEPT: never;
  readonly BEFORE_PLANNING: PlanningMutation;
  readonly BEFORE_MODEL_INVOKE: ModelInvokeMutation;
  readonly AFTER_MODEL_RESULT: ModelResultMutation;
  readonly BEFORE_CAPABILITY_INVOKE: CapabilityInvokeMutation;
  readonly AFTER_CAPABILITY_RESULT: CapabilityResultMutation;
  readonly BEFORE_CONTEXT_COMPACT: ContextCompactBeforeMutation;
  readonly AFTER_CONTEXT_COMPACT: ContextCompactAfterMutation;
  readonly BEFORE_AGENT_TERMINAL: AgentTerminalMutation;
}

export interface PendingInputIntent {
  readonly kind: PendingInputKind;
  readonly questions: readonly PendingInputQuestion[];
  readonly timeoutAt?: EpochMillis;
}

export interface RequestPendingInputOptions {
  readonly producerRef?: PendingInputProducerRef;
  readonly checkpointTrigger?: CheckpointTriggerReason;
}

export interface RestrictedOperationSummary {
  readonly operationId: string;
  readonly operationKind: RestrictedOperationKind;
  readonly capabilityId?: CapabilityId;
  readonly capabilityKind?: CapabilityKind;
  readonly providerId?: string;
  readonly toolCallId?: string;
  readonly executable?: 'bash' | 'python';
  readonly replayPolicy?: 'NON_IDEMPOTENT' | 'IDEMPOTENT';
  readonly riskLevel: RiskLevel;
  readonly targetOwnerScopeMatched: boolean;
  readonly parametersSchemaValid: boolean;
  readonly requiresSandbox: boolean;
  readonly sandboxReady: boolean;
  readonly observabilityReady: boolean;
  readonly currentRunAuthorizationMatched?: boolean;
}

export interface RiskPolicyEvaluationInput {
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestRunId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly operation: RestrictedOperationSummary;
  readonly capabilityAvailable: boolean;
  readonly capabilityEnabled: boolean;
  readonly policyId?: string;
  readonly policyVersion?: string;
}

export interface RiskPolicyAuthorizationIntent {
  readonly operationId: string;
  readonly operationKind: RestrictedOperationKind;
  readonly capabilityId?: CapabilityId;
  readonly toolCallId?: string;
  readonly riskLevel: RiskLevel;
  readonly prompt: string;
  readonly approveLabel: string;
  readonly denyLabel: string;
}

export interface RiskPolicyDecision {
  readonly outcome: RiskPolicyOutcome;
  readonly reasonCode: string;
  readonly authorizationIntent?: RiskPolicyAuthorizationIntent;
  readonly safeError?: SafeError;
}

export interface RiskPolicyEvaluator {
  evaluate: (input: RiskPolicyEvaluationInput, signal?: AbortSignal) => Promise<RiskPolicyDecision>;
}

export interface AgentPolicyExecutableByPoint {
  readonly agentRoutingPolicy: AgentRoutingPolicyExecutable;
}

export type AgentPolicyPointId = keyof AgentPolicyExecutableByPoint;

export type AgentPolicyDefinition<TPolicyPointId extends AgentPolicyPointId = AgentPolicyPointId> = AgentPolicyExecutableByPoint[TPolicyPointId] & {
  readonly policyPointId: TPolicyPointId;
  readonly policyId: string;
  readonly configSchema?: JsonObject;
  readonly timeoutMs?: number;
  readonly configure?: (config: JsonObject) => AgentPolicyExecutableByPoint[TPolicyPointId];
};

export interface AgentPolicyContribution<TPolicyPointId extends AgentPolicyPointId = AgentPolicyPointId> {
  readonly pluginId: string;
  readonly policy: AgentPolicyDefinition<TPolicyPointId>;
}

export interface AgentPolicyResolutionRequest<TPolicyPointId extends AgentPolicyPointId = AgentPolicyPointId> {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly policyPointId: TPolicyPointId;
}

export interface AgentPolicyResolution<TPolicyPointId extends AgentPolicyPointId = AgentPolicyPointId> {
  readonly assembly: AgentAssembly;
  readonly activation: AgentPolicyActivation;
  readonly policy: AgentPolicyDefinition<TPolicyPointId>;
  readonly executable: AgentPolicyExecutableByPoint[TPolicyPointId];
}

export interface AgentPolicyResolverPort {
  resolve: <TPolicyPointId extends AgentPolicyPointId>(
    request: AgentPolicyResolutionRequest<TPolicyPointId>,
  ) => Promise<AgentPolicyResolution<TPolicyPointId> | undefined>;
}

export interface HookInput<S extends LifecycleStage = LifecycleStage> {
  readonly hookId: string;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly requestRunId?: RequestRunId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef?: string;
  readonly stage: S;
  readonly boundary: HookBoundaryByStage[S];
  readonly idempotencyKey?: string;
  readonly hookInvocationId?: string;
}

export type HookMutationForStage<S extends LifecycleStage> = HookMutationByStage[S];

export type HookResult<S extends LifecycleStage = LifecycleStage> =
  | {
      readonly outcome: Extract<HookOutcome, 'PASS' | 'SKIP'>;
      readonly mutation?: HookMutationForStage<S>;
      readonly safeReason?: string;
      readonly error?: SafeError;
      readonly resultSummary?: JsonObject;
    }
  | {
      readonly outcome: Extract<HookOutcome, 'DENY' | 'BLOCK' | 'PEND'>;
      readonly pendingInputIntent?: PendingInputIntent;
      readonly safeReason?: string;
      readonly error?: SafeError;
      readonly resultSummary?: JsonObject;
    };

export interface LifecycleHookInvocationCoordinates {
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly requestRunId?: RequestRunId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly stageOccurrenceKey: string;
}

export interface LifecycleHookInvocationRequest<S extends LifecycleStage = LifecycleStage> {
  readonly stage: S;
  readonly coordinates: LifecycleHookInvocationCoordinates;
  readonly ownerScope: {
    readonly tenantId: TenantId;
    readonly subjectId: SubjectId;
  };
  readonly boundary: HookBoundaryByStage[S];
}

export interface LifecycleHookControlInterruption {
  readonly stage: LifecycleStage;
  readonly hookInvocationId: string;
  readonly outcome: Extract<HookOutcome, 'DENY' | 'BLOCK' | 'PEND'>;
  readonly safeReason?: string;
  readonly pendingInput?: PendingInputRequest;
  readonly safeError?: SafeError;
}

export class LifecycleHookInterruptionError extends Error {
  readonly interruption: LifecycleHookControlInterruption;

  constructor(interruption: LifecycleHookControlInterruption) {
    super(interruption.safeReason ?? 'Lifecycle hook interrupted request execution.');
    this.name = 'LifecycleHookInterruptionError';
    this.interruption = interruption;
  }
}

export type LifecycleHookInvocationResult<S extends LifecycleStage = LifecycleStage> =
  | { readonly status: 'CONTINUE'; readonly boundary: HookBoundaryByStage[S] }
  | { readonly status: 'INTERRUPT'; readonly interruption: LifecycleHookControlInterruption };

export interface LifecycleHookInvocationPort {
  invoke: <S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>, signal?: AbortSignal) => Promise<LifecycleHookInvocationResult<S>>;
}

export interface RuntimeCommandPort {
  reserveSubmit?: (command: ReserveSubmitCommand) => Promise<ReserveSubmitAccepted>;
  submit: (command: SubmitRequestCommand) => Promise<RequestAccepted>;
  cancel: (command: RequestControlCommand) => Promise<RequestControlAccepted>;
  retryLatest: (command: RequestControlCommand) => Promise<RequestAccepted>;
  editLatest: (command: EditLatestRequestCommand) => Promise<RequestAccepted>;
  answerPendingInput: (command: AnswerPendingInputCommand) => Promise<PendingInputAnswerAccepted>;
  /**
   * Hides the run's assistant messages from model-visible history (sets
   * visible=false with a GUARD_BLOCKED reason). Invoked by the web channel
   * when an OUTPUT_GUARD_BLOCKED terminal event is observed on the
   * guard-proxied client stream, so the blocked round's assistant response
   * does not enter the next round's model context. Idempotent and
   * race-safe: sets an in-memory guard-blocked flag consumed by the
   * terminal commit, and also hides any already-committed assistant
   * message for the run.
   */
  hideRunMessages?: (command: HideRunMessagesCommand) => Promise<void>;
}

export interface HideRunMessagesCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly reason: Extract<VisibilityReason, 'GUARD_BLOCKED'>;
}

export type SkillCatalogProviderKind = Extract<CapabilityProviderKind, 'BUNDLED' | 'LOCAL_DIRECTORY' | 'SKILL_HUB'>;

export interface SkillCatalogSummaryEntry {
  readonly capabilityId: CapabilityId;
  readonly displayName: string;
  readonly description: string;
  readonly providerKind: SkillCatalogProviderKind;
  readonly version?: string;
  readonly sourceMetadata?: Readonly<Record<string, string | readonly string[]>>;
}

export interface SkillCatalogQueryRequest {
  readonly identityContext: IdentityContext;
  readonly pageNum: number;
  readonly pageSize: number;
  readonly keyword?: string;
}

export interface SkillCatalogQueryResult {
  readonly total: number;
  readonly pageNum: number;
  readonly pageSize: number;
  readonly skills: readonly SkillCatalogSummaryEntry[];
}

export interface SkillCatalogQueryPort {
  listSkills: (request: SkillCatalogQueryRequest, signal?: AbortSignal) => Promise<SkillCatalogQueryResult>;
}

export interface CapabilityPresentationResource {
  readonly capabilityKind: CapabilityKind;
  readonly capabilityId: CapabilityId;
  readonly displayName: string;
  readonly locales?: CapabilityLocales;
}

export interface CapabilityPresentationResourceQueryRequest {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
}

export interface CapabilityPresentationResourceQueryResult {
  readonly resources: readonly CapabilityPresentationResource[];
}

export interface CapabilityPresentationResourceQueryPort {
  listResources: (request: CapabilityPresentationResourceQueryRequest, signal: AbortSignal) => Promise<CapabilityPresentationResourceQueryResult>;
}

export interface SuggestedQuestionRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
}

export interface SuggestedQuestionResult {
  readonly questions: readonly string[];
}

export interface SuggestedQuestionPort {
  generate: (request: SuggestedQuestionRequest, signal?: AbortSignal) => Promise<SuggestedQuestionResult>;
}

export interface CategoryQuestionEntryDto {
  readonly text: string;
  readonly fixed: boolean;
}

export interface CategoryL2Dto {
  readonly name: string;
  readonly questions: readonly CategoryQuestionEntryDto[];
}

export interface CategoryL1Dto {
  readonly name: string;
  readonly hasSubCategories: boolean;
  readonly questions?: readonly CategoryQuestionEntryDto[];
  readonly subCategories?: readonly CategoryL2Dto[];
}

export interface CategoryQuestionRequest {
  readonly agentId: AgentId;
  readonly locale?: string;
}

export interface CategoryQuestionResult {
  readonly locale: string;
  readonly categories: readonly CategoryL1Dto[];
}

export interface CategoryQuestionPort {
  listCategoryQuestions: (request: CategoryQuestionRequest, signal?: AbortSignal) => Promise<CategoryQuestionResult>;
}
export interface FrequentQuestionEntryDto {
  readonly text: string;
}

export interface FrequentQuestionQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly locale?: string;
}

export interface FrequentQuestionResult {
  readonly locale: string;
  readonly questions: readonly FrequentQuestionEntryDto[];
}

export interface FrequentQuestionPort {
  listFrequentQuestions: (request: FrequentQuestionQuery, signal?: AbortSignal) => Promise<FrequentQuestionResult>;
  listQuestionAssociations: (request: QuestionAssociationQuery, signal?: AbortSignal) => Promise<QuestionAssociationResult>;
}

export type QuestionAssociationSource = 'pinned' | 'high-frequency' | 'recommended' | 'static';

export interface QuestionAssociationEntryDto {
  readonly text: string;
  readonly source: QuestionAssociationSource;
}

export interface QuestionAssociationQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly keyword: string;
  readonly locale?: string;
}

export interface QuestionAssociationResult {
  readonly locale: string;
  readonly questions: readonly QuestionAssociationEntryDto[];
}

export type RuntimeAnnotationSentiment = 'UP' | 'DOWN';

export interface RuntimeUpsertAnnotationCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly sentiment?: RuntimeAnnotationSentiment | null;
  readonly isFavorited?: boolean;
  readonly isQuestionFavorited?: boolean;
  readonly comment?: string | null;
  readonly idempotencyKey?: IdempotencyKey;
}

export interface RuntimeListFavoriteTurnsQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly offset: number;
  readonly limit: number;
}
export interface RuntimeListQuestionFavoriteTurnsQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly offset: number;
  readonly limit: number;
}

export interface RuntimeListSessionAnnotationsQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface ConversationAnnotationView {
  readonly annotationId: string;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly sentiment: RuntimeAnnotationSentiment | null;
  readonly isFavorited: boolean;
  readonly isQuestionFavorited: boolean;
  readonly comment: string | null;
  readonly createdAt: EpochMillis;
}

export interface ConversationFavoriteTurnEntry {
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly rootMessageId: MessageId;
  readonly questionPreview: string;
  readonly questionTruncated: boolean;
  readonly sessionTitle?: string;
  readonly sessionUpdatedAt: EpochMillis;
  readonly favoritedAt: EpochMillis;
}

export interface ConversationFavoriteTurnPage {
  readonly entries: readonly ConversationFavoriteTurnEntry[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface RuntimeConversationAnnotationPort {
  upsertAnnotation: (command: RuntimeUpsertAnnotationCommand) => Promise<ConversationAnnotationView | undefined>;
  listFavoriteTurns: (query: RuntimeListFavoriteTurnsQuery) => Promise<ConversationFavoriteTurnPage>;
  listQuestionFavoriteTurns: (query: RuntimeListQuestionFavoriteTurnsQuery) => Promise<ConversationFavoriteTurnPage>;
  listSessionAnnotations: (query: RuntimeListSessionAnnotationsQuery) => Promise<readonly ConversationAnnotationView[]>;
}

export interface CreateShareCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly runIds: readonly RequestRunId[];
  readonly originUrl: string;
  readonly expiresIn: '24h' | '7d' | '30d' | 'permanent';
  readonly allowedOps: readonly string[] | null;
  readonly idempotencyKey: IdempotencyKey;
}

export interface ShareResult {
  readonly shareId: string;
  readonly shareUrl: string;
}

export interface LoadSharedConversationQuery {
  readonly shareId: string;
  readonly viewerOps: readonly string[] | null;
}

export interface SharedConversationMessage {
  readonly messageId: MessageId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly role: SessionMessageRole;
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly metadata: JsonObject;
  readonly attachments?: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>;
  readonly sequence: number;
  readonly visible: boolean;
  readonly createdAt: EpochMillis;
}

export interface SharedConversationPage {
  readonly sessionId: SessionId;
  readonly messages: readonly SharedConversationMessage[];
  readonly createdAt: EpochMillis;
}

export interface RuntimeConversationSharePort {
  createShare: (command: CreateShareCommand) => Promise<ShareResult>;
  loadSharedConversation: (query: LoadSharedConversationQuery) => Promise<SharedConversationPage | SafeError>;
}

export const runtimeLifecycleStages: readonly LifecycleStage[] = [
  'BEFORE_REQUEST_ACCEPT',
  'BEFORE_PLANNING',
  'BEFORE_MODEL_INVOKE',
  'AFTER_MODEL_RESULT',
  'BEFORE_CAPABILITY_INVOKE',
  'AFTER_CAPABILITY_RESULT',
  'BEFORE_CONTEXT_COMPACT',
  'AFTER_CONTEXT_COMPACT',
  'BEFORE_AGENT_TERMINAL',
];
