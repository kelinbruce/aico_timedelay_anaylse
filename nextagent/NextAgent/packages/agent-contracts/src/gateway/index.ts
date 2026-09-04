import type {
  Brand,
  AgentId,
  AgentVersion,
  ArtifactId,
  AttachmentAvailabilityStatus,
  AttachmentId,
  AttachmentIntakeReservationId,
  AttachmentMediaType,
  AttachmentValidationStatus,
  BlobRef,
  CapabilityId,
  CapabilityInvocationId,
  CheckpointId,
  CheckpointTriggerReason,
  EpochMillis,
  IdempotencyKey,
  JsonObject,
  LifecycleStage,
  KnowledgeSourceType,
  LongTermMemoryId,
  LongTermMemoryState,
  MemoryType,
  MessageContentType,
  MessageId,
  OutcomeEvidenceLevel,
  PendingInputKind,
  PendingInputId,
  PendingInputQuestionAnswerKind,
  PendingInputStatus,
  RequestContextId,
  RequestPriority,
  RequestRunId,
  RestrictedOperationKind,
  RiskLevel,
  RunStatus,
  SafeError,
  SessionMessageRole,
  SessionId,
  SharingState,
  SubjectId,
  TaskOutcomeStatus,
  TaskTrajectoryBuildStatus,
  TaskTrajectoryId,
  TaskTrajectoryKind,
  TenantId,
  TerminalCommitState,
  ToolCallId,
  TimelineEventType,
  TimelineSequence,
  VisibilityReason,
  IdentityContext,
  RequestLocale,
} from '@nextagent/agent-common';
import { Type } from '@sinclair/typebox';
import type { ExecutionCorrelationPort } from '../observability/index.js';

export interface OwnerScoped {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
}

export type GatewayDeploymentMode = 'LOCAL' | 'REMOTE';

export type GatewayAdapterKind =
  | 'working-memory'
  | 'long-term-memory'
  | 'sqlite'
  | 'sandbox'
  | 'scheduled-maintenance'
  | 'cron-tasks'
  | 'rag-knowledge'
  | 'skillhub'
  | 'workflow-execution'
  | 'api-call'
  | 'user-query'
  | 'guardrail'
  | 'watermark';

export type GatewayBindingReadinessState = 'READY' | 'BLOCKED';

export interface GatewayProviderCreateInput {
  readonly selectedEntries: readonly GatewayProviderSelectionEntry[];
  readonly runtime: GatewayProviderRuntimeContext;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly signal?: AbortSignal;
}

export interface GatewayProviderRuntimeContext {
  readonly paths: GatewayProviderRuntimePaths;
  readonly sandbox: GatewayProviderSandboxConfig;
}

export interface GatewayProviderRuntimePaths {
  readonly workingMemorySqliteFile: string;
  readonly longTermMemorySqliteFile: string;
  readonly sqliteFile: string;
  readonly workspaceRoot: string;
  readonly logDirectory: string;
  readonly runtimeWorkspaceRoot: string;
  readonly sharedDataRoot?: string;
}

export interface GatewayProviderSandboxConfig {
  readonly allowedExecutables?: readonly string[];
  readonly enabled: boolean;
  readonly deniedExecutables: readonly string[];
  readonly clipcExecutableDirectory?: string;
}

export interface GatewayProviderSelectionEntry {
  readonly gatewayId: string;
  readonly adapterKind: GatewayAdapterKind;
  readonly deploymentMode: GatewayDeploymentMode;
  readonly endpoint?: string;
}

export interface GatewayProvider {
  readonly providerId: string;
  readonly deploymentMode: GatewayDeploymentMode;
  readonly supportedAdapterKinds: readonly GatewayAdapterKind[];
  create: (input: GatewayProviderCreateInput) => GatewayBindings;
}

export interface FetchGateway {
  fetch: (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>;
}

export interface GatewayBindings {
  readonly providerId: string;
  readonly deploymentMode: GatewayDeploymentMode;
  readonly readiness: GatewayBindingReadiness;
  readonly workingMemory?: WorkingMemoryGatewayBindings;
  readonly longTermMemory?: LongTermMemoryGatewayBindings;
  readonly audit?: AuditEventStoreGateway;
  readonly sqliteStores?: SqliteGatewayStoreBindings;
  readonly sandbox?: SandboxGatewayPort;
  readonly ragRetrieval?: RagRetrievalGateway;
  readonly workflowRagRetrieval?: WorkflowRagRetrievalGateway;
  readonly scheduledMaintenance?: ScheduledMaintenanceGatewayPort;
  readonly cronTasks?: CronTaskGatewayPort;
  readonly guardrail?: GuardrailGatewayPort;
  readonly fetch?: FetchGateway;
  readonly watermark?: WatermarkGatewayPort;
  readonly userQuery?: UserQueryGateway;
  close?: () => Promise<void> | void;
}

/**
 * Content guardrail gateway port. The sole governed egress to an external
 * content-guard service (RobotRouter IR). Invoked only by the NextAgent
 * backend; the frontend never calls the guard service directly. Effective only
 * in REMOTE deployment; LOCAL never creates this binding.
 *
 * checkQuestion checks user input questions and returns isLegal + refusalMessage.
 * checkAnswer checks buffered AI output content and returns isLegal + refusalMessage;
 * deliverWebStream calls this after buffering 256 chars of streaming output.
 */
export interface GuardrailGatewayPort {
  /**
   * Input guard: checks user input questions against the guard service's
   * question-check endpoint. isLegal=false means the input is refused;
   * refusalMessage is the guard service's refusal text, relayed verbatim.
   */
  checkQuestion: (input: GuardrailCheckQuestionInput, signal?: AbortSignal) => Promise<GuardrailCheckQuestionResult>;
  /**
   * nl2py code check invoked by the BEFORE_CAPABILITY_INVOKE hook for the
   * python capability. status=false means blocked; the errorMsg entries are
   * fed back to the agent loop as a structured tool failure for self-correction.
   */
  checkNl2Python: (input: GuardrailCheckNl2PythonInput, signal?: AbortSignal) => Promise<GuardrailCheckNl2PythonResult>;
  /**
   * Output guard: checks buffered AI answer content against the guard service's
   * answer-check endpoint. Called by deliverWebStream after buffering 256 chars
   * of streaming output. isLegal=false triggers OUTPUT_GUARD_BLOCKED injection
   * + hideRunMessages.
   */
  checkAnswer: (input: GuardrailCheckAnswerInput, signal?: AbortSignal) => Promise<GuardrailCheckAnswerResult>;
  /**
   * Knowledge-content guard used before governed long-term-memory writes.
   * Provider rejection is represented by isLegal=false; transport, validation,
   * timeout and cancellation failures remain typed SafeErrors.
   */
  checkKnowledge: (input: GuardrailCheckKnowledgeInput, signal?: AbortSignal) => Promise<GuardrailCheckKnowledgeResult | SafeError>;
}

/**
 * Watermark gateway port. The sole governed egress to an external watermark
 * service. Invoked by the channel layer to apply traceability watermarks to
 * content before it is delivered to the client. Effective only in REMOTE
 * deployment; LOCAL never creates this binding.
 *
 * embedWatermark sends text to the watermark service and returns the result.
 * When success is true, watermarkedText carries the watermarked text. When
 * success is false, errorCode and errorDesc describe the rejection. Transport
 * failures (timeout, network error, non-2xx status) are thrown and caught by
 * the caller, which degrades to returning the original content.
 */
export interface WatermarkGatewayPort {
  embedWatermark: (input: WatermarkEmbedInput, signal?: AbortSignal) => Promise<WatermarkEmbedResult>;
}

export interface WatermarkEmbedInput {
  readonly text: string;
}

export interface WatermarkEmbedResult {
  readonly success: boolean;
  readonly watermarkedText: string;
  readonly errorCode: string;
  readonly errorDesc: string;
}

/**
 * AI log reporting egress to the CloudSop compliance audit system.
 * Invoked only by `agent-app` composition in REMOTE deployment after a run
 * reaches terminal state. LOCAL deployment never creates this binding.
 * HTTP implementation is provided by an external repo that directly
 * implements the interface; this repo only defines the contract.
 */
export interface OperationLogGatewayPort {
  writeAiLog: (entry: OperationLogEntry, signal?: AbortSignal) => Promise<void>;
}

export interface OperationLogEntry {
  readonly operation: string;
  readonly source: string;
  readonly target: string;
  readonly detail: string;
  readonly level: 'MINOR' | 'RISK';
  readonly result: 'SUCCESSFUL' | 'FAILURE';
  readonly tenantId: string;
  readonly userName: string;
  readonly terminalIP: string;
  readonly logType: string;
  readonly systemLang: string;
  readonly show: boolean;
}

export interface GuardrailCheckAnswerInput {
  /** Answer content to check (1-10 items, total ≤ 2000 chars). */
  readonly answers: readonly string[];
  /**
   * Optional BCP-47 locale (e.g. "zh-CN", "en-US") used to localize the
   * fail-closed refusal message when the guard service itself is unavailable
   * (non-2xx / timeout / transport error). Sourced from the deployment
   * `defaultLanguage`. Ignored for normal policy refusals, which are relayed
   * verbatim from the guard service's `response` field.
   */
  readonly locale?: string;
}

export interface GuardrailCheckAnswerResult {
  /** true = content is legal; false = content is refused. */
  readonly isLegal: boolean;
  /** Refusal message from the guard service (empty when isLegal=true). */
  readonly refusalMessage: string;
}

export interface GuardrailCheckQuestionInput {
  /** Questions to check (1-10 items, total ≤ 2000 chars). */
  readonly questions: readonly string[];
  /** Optional: items to skip (e.g. "topic_limit"). Omitted = check all. */
  readonly ignoreItems?: readonly string[];
  /**
   * Optional BCP-47 locale (e.g. "zh-CN", "en-US") used to localize the
   * fail-closed refusal message when the guard service itself is unavailable
   * (non-2xx / timeout / transport error). Sourced from the deployment
   * `defaultLanguage`. Ignored for normal policy refusals, which are relayed
   * verbatim from the guard service's `response` field.
   */
  readonly locale?: string;
}

export interface GuardrailCheckQuestionResult {
  /** true = input is legal; false = input is refused. */
  readonly isLegal: boolean;
  /** Refusal message from the guard service (empty when isLegal=true). */
  readonly refusalMessage: string;
}

export interface GuardrailCheckNl2PythonInput {
  readonly content: string;
}

export interface GuardrailCheckNl2PythonResult {
  readonly status: boolean;
  readonly errorMsg: readonly string[];
}

export interface GuardrailCheckKnowledgeInput {
  /** Knowledge fragments to check (1-5 items, each 1-2000 Unicode code points). */
  readonly texts: readonly string[];
  /** Optional provider privacy check switch. */
  readonly isPrivacy?: boolean;
}

export interface GuardrailCheckKnowledgeResult {
  /** true only when the provider accepts every supplied fragment. */
  readonly isLegal: boolean;
}

export interface GuardrailProxyStreamInput {
  readonly sessionId: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  /**
   * The client's last-observed timeline sequence. The guard service should only
   * relay/inject events after this sequence so the proxied stream resumes
   * correctly on reconnect (avoids sequence regression on sessions with history).
   */
  readonly lastSeenSequence?: TimelineSequence;
}

export type CronTaskStatus = 'ACTIVE' | 'COMPLETED' | 'DELETED';
export type CronTriggerStatus = 'CLAIMED' | 'ACCEPTED';
export type CronTaskRecordTargetKind = 'SKILL' | 'WORKFLOW';

export interface CronTaskRecord extends OwnerScoped {
  readonly taskId: string;
  readonly agentId: AgentId;
  readonly cron: string;
  readonly prompt: string;
  readonly targetKind?: CronTaskRecordTargetKind;
  readonly targetName?: string;
  readonly recurring: boolean;
  readonly status: CronTaskStatus;
  readonly createdByName?: string;
  readonly nextRunAt: EpochMillis;
  readonly version: number;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface CronTriggerRecord extends OwnerScoped {
  readonly triggerId: string;
  readonly taskId: string;
  readonly agentId: AgentId;
  readonly sessionId?: SessionId;
  readonly scheduledAt: EpochMillis;
  readonly status: CronTriggerStatus;
  readonly requestRunId?: RequestRunId;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface CronTaskWriteOptions extends IdempotentWriteOptions {
  readonly expectedVersion?: number;
}

export interface CronTaskScopeQuery extends OwnerScoped {
  readonly agentId: AgentId;
}

export interface CronTaskLookupRequest extends CronTaskScopeQuery {
  readonly taskId: string;
}

export interface CronTaskListRequest extends CronTaskScopeQuery {
  readonly includeDeleted?: boolean;
  readonly offset?: number;
  readonly limit?: number;
}

export interface CronTaskAgentScopeQuery extends OwnerScoped {
  readonly agentId: AgentId;
}

export interface CronTaskAgentListRequest extends CronTaskAgentScopeQuery {
  readonly includeDeleted?: boolean;
  readonly offset?: number;
  readonly limit?: number;
}

export interface CronTaskAgentLookupRequest extends CronTaskAgentScopeQuery {
  readonly taskId: string;
}

export interface CronDueTaskListRequest {
  readonly dueAtOrBefore: EpochMillis;
  readonly limit: number;
}

export interface CronClaimedTriggerListRequest {
  readonly limit: number;
}

export interface CronTriggerDeliveryLookupRequest {
  readonly taskId: string;
  readonly triggerId: string;
}

export interface CronTriggerLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly taskId: string;
  readonly triggerId: string;
}

export interface CronTaskTriggerListRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly taskId: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ClaimCronTriggerRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly taskId: string;
  readonly scheduledAt: EpochMillis;
  readonly triggerId: string;
  readonly nextRunAt?: EpochMillis;
  readonly claimedAt: EpochMillis;
}

export type ClaimCronTriggerStatus = 'CLAIMED' | 'ALREADY_CLAIMED' | 'TASK_NOT_FOUND' | 'TASK_NOT_ACTIVE' | 'VERSION_CONFLICT';

export interface ClaimCronTriggerResult {
  readonly status: ClaimCronTriggerStatus;
  readonly trigger?: CronTriggerRecord;
  readonly task?: CronTaskRecord;
}

export interface BindCronTriggerRunRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly taskId: string;
  readonly triggerId: string;
  readonly requestRunId: RequestRunId;
  readonly acceptedAt: EpochMillis;
}

export type BindCronTriggerRunStatus = 'BOUND' | 'ALREADY_BOUND' | 'TRIGGER_NOT_FOUND' | 'RUN_CONFLICT';

export interface BindCronTriggerRunResult {
  readonly status: BindCronTriggerRunStatus;
  readonly trigger?: CronTriggerRecord;
}

export interface ClaimedCronTriggerDeliveryRecord {
  readonly trigger: CronTriggerRecord;
  readonly task: CronTaskRecord;
}

export interface CronTaskGatewayPort {
  createTask: (record: CronTaskRecord, options?: CronTaskWriteOptions, signal?: AbortSignal) => Promise<CronTaskRecord>;
  loadTask: (request: CronTaskLookupRequest, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  loadTaskForAgent: (request: CronTaskAgentLookupRequest, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  listTasks: (request: CronTaskListRequest, signal?: AbortSignal) => Promise<readonly CronTaskRecord[]>;
  listTasksForAgent: (request: CronTaskAgentListRequest, signal?: AbortSignal) => Promise<readonly CronTaskRecord[]>;
  countTasksForAgent: (request: CronTaskAgentListRequest, signal?: AbortSignal) => Promise<number>;
  countActiveTasksForAgent?: (request: CronTaskAgentScopeQuery, signal?: AbortSignal) => Promise<number>;
  updateTask: (record: CronTaskRecord, options?: CronTaskWriteOptions, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  deleteTask: (request: CronTaskLookupRequest, options?: CronTaskWriteOptions, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  listDueTasks: (request: CronDueTaskListRequest, signal?: AbortSignal) => Promise<readonly CronTaskRecord[]>;
  listClaimedTriggers: (request: CronClaimedTriggerListRequest, signal?: AbortSignal) => Promise<readonly ClaimedCronTriggerDeliveryRecord[]>;
  loadTriggerDelivery: (request: CronTriggerDeliveryLookupRequest, signal?: AbortSignal) => Promise<ClaimedCronTriggerDeliveryRecord | undefined>;
  loadTrigger: (request: CronTriggerLookupRequest, signal?: AbortSignal) => Promise<CronTriggerRecord | undefined>;
  listTriggersForTask: (request: CronTaskTriggerListRequest, signal?: AbortSignal) => Promise<readonly CronTriggerRecord[]>;
  countTriggersForTask: (request: CronTaskTriggerListRequest, signal?: AbortSignal) => Promise<number>;
  claimCronTrigger: (request: ClaimCronTriggerRequest, signal?: AbortSignal) => Promise<ClaimCronTriggerResult>;
  bindCronTriggerRun: (request: BindCronTriggerRunRequest, signal?: AbortSignal) => Promise<BindCronTriggerRunResult>;
}

export interface CronTriggerCallbackAuthentication {
  readonly algorithm: 'HMAC-SHA256';
  readonly signature: string;
}

export interface CronTriggerCallbackInput {
  readonly taskId: string;
  readonly triggerId: string;
  readonly issuedAt: EpochMillis;
  readonly nonce: string;
  readonly authentication: CronTriggerCallbackAuthentication;
}

const cronCallbackReferencePattern = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$';

export const cronTriggerCallbackInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'triggerId', 'issuedAt', 'nonce', 'authentication'],
  properties: {
    taskId: { type: 'string', pattern: cronCallbackReferencePattern },
    triggerId: { type: 'string', pattern: cronCallbackReferencePattern },
    issuedAt: { type: 'integer', minimum: 0 },
    nonce: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
    authentication: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'signature'],
      properties: {
        algorithm: { const: 'HMAC-SHA256' },
        signature: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
      },
    },
  },
};

export interface GatewayBindingReadiness {
  readonly state: GatewayBindingReadinessState;
  readonly evidenceRef: string;
  readonly safeMessage: string;
}

export interface ListFrequentHistoryQuestionsRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly limit: number;
  readonly locale?: RequestLocale;
}

export interface FrequentHistoryQuestion {
  readonly content: string;
  readonly frequency: number;
}

export interface ListFrequentHistoryQuestionsResult {
  readonly questions: readonly FrequentHistoryQuestion[];
}

export interface RecommendSimilarPresetQuestionsRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly query: string;
  readonly limit: number;
  readonly locale?: RequestLocale;
  readonly product?: string;
  readonly domain?: string;
  readonly scene?: string;
}

export interface PresetQuestionRecommendation {
  readonly questionId: string;
  readonly content: string;
}

export interface RecommendSimilarPresetQuestionsResult {
  readonly questions: readonly PresetQuestionRecommendation[];
}

export interface QuestionRecommendationGateway {
  listFrequentHistoryQuestions: (
    request: ListFrequentHistoryQuestionsRequest,
    signal?: AbortSignal,
  ) => Promise<ListFrequentHistoryQuestionsResult | SafeError>;
  recommendSimilarPresetQuestions: (
    request: RecommendSimilarPresetQuestionsRequest,
    signal?: AbortSignal,
  ) => Promise<RecommendSimilarPresetQuestionsResult | SafeError>;
}

export const listFrequentHistoryQuestionsRequestSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'subjectId', 'agentId', 'limit'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    subjectId: { type: 'string', minLength: 1 },
    agentId: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
    locale: { type: 'string', minLength: 1, maxLength: 10 },
  },
};

export const listFrequentHistoryQuestionsResultSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['content', 'frequency'],
        properties: {
          content: { type: 'string', minLength: 1 },
          frequency: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
        },
      },
    },
  },
};

export const recommendSimilarPresetQuestionsRequestSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'subjectId', 'agentId', 'query', 'limit'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    subjectId: { type: 'string', minLength: 1 },
    agentId: { type: 'string', minLength: 1 },
    query: { type: 'string', minLength: 1, maxLength: 512 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
    locale: { type: 'string', minLength: 1, maxLength: 10 },
    product: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,64}$' },
    domain: { type: 'string', minLength: 1, maxLength: 128 },
    scene: { type: 'string', minLength: 1, maxLength: 128 },
  },
};

export const recommendSimilarPresetQuestionsResultSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionId', 'content'],
        properties: {
          questionId: { type: 'string', minLength: 1 },
          content: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

export interface UserQueryRequest extends OwnerScoped {
  readonly targetSubjectIds: readonly SubjectId[];
}

export interface UserProfileRecord {
  readonly subjectId: SubjectId;
  readonly userName: string;
}

export interface UserQueryResult {
  readonly users: readonly UserProfileRecord[];
}

export interface UserQueryGateway {
  queryUsers: (request: UserQueryRequest, signal?: AbortSignal) => Promise<UserQueryResult | SafeError>;
}

export const userQueryRequestSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'subjectId', 'targetSubjectIds'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    subjectId: { type: 'string', minLength: 1 },
    targetSubjectIds: {
      type: 'array',
      minItems: 1,
      maxItems: 10_000,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
  },
};

export const userQueryResultSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['users'],
  properties: {
    users: {
      type: 'array',
      maxItems: 10_000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subjectId', 'userName'],
        properties: {
          subjectId: { type: 'string', minLength: 1 },
          userName: { type: 'string', minLength: 1, maxLength: 256 },
        },
      },
    },
  },
};

export interface WorkingMemoryGatewayBindings {
  readonly requestRuns: RequestRunStoreGateway;
  readonly memoryRecallAttempts?: RequestRunMemoryRecallAttemptGateway;
  readonly sessions: SessionStoreGateway;
  readonly messages: SessionMessageStoreGateway;
  readonly sessionForks: SessionForkStoreGateway;
  readonly attachments: AttachmentStoreGateway;
  readonly activeContext: ActiveContextStoreGateway;
  readonly timeline: RunTimelineEventStoreGateway;
  readonly checkpoints: CheckpointStoreGateway;
  readonly pendingInputs: PendingInputStoreGateway;
  readonly conversationAnnotations: ConversationAnnotationStoreGateway;
  readonly conversationShares: ConversationShareStoreGateway;
  readonly questionRecommendations?: QuestionRecommendationGateway;
}

export interface LongTermMemoryGatewayBindings {
  readonly store: LongTermMemoryStoreGateway;
  readonly retriever: LongTermMemoryRetrieverGateway;
  readonly sharing: LongTermMemorySharingGateway;
}

export interface SqliteGatewayStoreBindings {
  readonly attachmentReservations: AttachmentIntakeReservationGateway;
  readonly blobs: BlobStoreGateway;
  readonly taskTrajectoryStore: TaskTrajectoryStoreGateway;
  readonly taskTrajectoryQuery: TaskTrajectoryQueryGateway;
  readonly todoStateStore: TodoStateStoreGateway;
  readonly userQuestionActivity: UserQuestionActivityStoreGateway;
}

export type AuditAttributeValue = string | number | boolean | readonly string[] | readonly number[] | readonly boolean[];

export interface AuditEventRecord extends OwnerScoped {
  readonly auditId: string;
  readonly eventName: string;
  readonly agentId: AgentId;
  readonly requestRunId?: RequestRunId;
  readonly capabilityInvocationId?: CapabilityInvocationId;
  readonly safeSummary: string;
  readonly attributes: Readonly<Record<string, AuditAttributeValue>>;
  readonly occurredAt: EpochMillis;
}

export interface AuditEventStoreGateway {
  appendAuditEvent: (record: AuditEventRecord) => Promise<void>;
}

export interface TodoStateItemRecord {
  readonly content: string;
  readonly activeForm: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoStateCurrentRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly revisionSeq: number;
  readonly todos: readonly TodoStateItemRecord[];
  readonly updatedAt: EpochMillis;
}

export interface TodoStateRevisionRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly revisionSeq: number;
  readonly requestId: MessageId;
  readonly requestRunId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly toolCallId?: ToolCallId;
  readonly todos: readonly TodoStateItemRecord[];
  readonly createdAt: EpochMillis;
}

export interface ReplaceTodoStateRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestRunId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly toolCallId?: ToolCallId;
  readonly todos: readonly TodoStateItemRecord[];
}

export interface ReplaceTodoStateResult {
  readonly oldTodos: readonly TodoStateItemRecord[];
  readonly newTodos: readonly TodoStateItemRecord[];
  readonly revision: TodoStateRevisionRecord;
  readonly current?: TodoStateCurrentRecord;
}

export interface TodoStateLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface TodoStateRevisionListRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly afterRevisionSeq?: number;
  readonly limit?: number;
}

export interface TodoStateStoreGateway {
  replaceTodoState: (request: ReplaceTodoStateRequest) => Promise<ReplaceTodoStateResult>;
  loadCurrentTodoState: (request: TodoStateLookupRequest) => Promise<TodoStateCurrentRecord | undefined>;
  listTodoStateRevisions: (request: TodoStateRevisionListRequest) => Promise<readonly TodoStateRevisionRecord[]>;
}

export type VersionedUpdateStatus = 'UPDATED' | 'VERSION_CONFLICT' | 'NOT_FOUND';
export interface VersionedUpdateResult<TRecord = JsonObject> {
  readonly status: VersionedUpdateStatus;
  readonly record?: TRecord;
}

export type TerminalCommitStatus = 'COMMITTED' | 'ALREADY_COMMITTED' | 'VERSION_CONFLICT' | 'NOT_FOUND';
export interface TerminalCommitRecordResult {
  readonly status: TerminalCommitStatus;
  readonly terminalEvent?: RunTimelineEventRecord;
}

export interface RequestRunStoreGateway {
  saveRun: (record: RequestRunRecord, options: VersionedWriteOptions) => Promise<VersionedUpdateResult<RequestRunRecord>>;
  loadRun: (request: RequestRunLookupRequest) => Promise<RequestRunRecord | undefined>;
  listRuns: (request: RequestRunListQuery) => Promise<RequestRunRecordPage>;
  loadSessionLaneSnapshot: (request: SessionLaneSnapshotQuery) => Promise<SessionLaneSnapshot>;
  loadRunByIdempotencyKey: (request: RequestRunIdempotencyLookupRequest) => Promise<RequestRunIdempotencyLookupResult>;
  claimRun: (request: ClaimRunRequest) => Promise<VersionedUpdateResult<RequestRunRecord>>;
  listRecoverableRuns: (request: AgentListRecoverableRunsRequest) => Promise<readonly RequestRunRecord[]>;
  commitTerminal: (request: TerminalCommitRequest) => Promise<TerminalCommitRecordResult>;
}

export type RequestRunMemoryRecallAttemptState = 'STARTED' | 'COMPLETED_CONTEXT' | 'COMPLETED_L1_CONTEXT' | 'COMPLETED_NO_CONTEXT';

export interface RequestRunMemoryRecallAttemptRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly requestRunId: RequestRunId;
  readonly hookId: string;
  readonly state: RequestRunMemoryRecallAttemptState;
  readonly version: number;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface RequestRunMemoryRecallAttemptLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly requestRunId: RequestRunId;
  readonly hookId: string;
}

export interface RequestRunMemoryRecallAttemptClaimResult {
  readonly status: 'CLAIMED' | 'ALREADY_CLAIMED';
  readonly record: RequestRunMemoryRecallAttemptRecord;
}

export interface RequestRunMemoryRecallAttemptGateway {
  claimAttempt: (record: RequestRunMemoryRecallAttemptRecord) => Promise<RequestRunMemoryRecallAttemptClaimResult>;
  completeAttempt: (
    record: RequestRunMemoryRecallAttemptRecord,
    options: Pick<VersionedWriteOptions, 'expectedVersion'>,
  ) => Promise<VersionedUpdateResult<RequestRunMemoryRecallAttemptRecord>>;
  loadAttempt: (request: RequestRunMemoryRecallAttemptLookupRequest) => Promise<RequestRunMemoryRecallAttemptRecord | undefined>;
}

export type BlobRecordPurpose = 'ATTACHMENT' | 'ARTIFACT' | 'CAPABILITY_RESULT' | 'MODEL_SUMMARY';

export interface RequestRunRecord extends OwnerScoped {
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
  readonly terminalCommitIdempotencyKey?: IdempotencyKey;
  readonly terminalCommitIdempotencySemantic?: string;
  readonly lockedBy?: string;
  readonly lockExpiresAt?: EpochMillis;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface IdempotentWriteOptions {
  readonly idempotencyKey?: IdempotencyKey;
}

export interface VersionedWriteOptions extends IdempotentWriteOptions {
  readonly expectedVersion?: number;
  readonly idempotencySemantic?: string;
}

export interface TerminalCommitRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly runId: RequestRunId;
  readonly expectedVersion: number;
  readonly terminalStatus: Extract<RunStatus, 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'>;
  readonly terminalMessage: SessionMessageRecord;
  readonly terminalEvent: RunTimelineEventRecord;
  readonly idempotencyKey: IdempotencyKey;
  readonly idempotencySemantic?: string;
}

export interface RequestRunLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly runId: RequestRunId;
}

export interface RequestRunListQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionIds?: readonly SessionId[];
  readonly runIds?: readonly RequestRunId[];
  readonly offset: number;
  readonly limit: number;
}

export interface RequestRunRecordPage {
  readonly items: readonly RequestRunRecord[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface ClaimRunRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly runId: RequestRunId;
  readonly expectedVersion: number;
  readonly lockedBy: string;
  readonly lockExpiresAt: EpochMillis;
}

export interface SessionLaneSnapshotQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface SessionLaneSnapshot extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly latestRequestId?: MessageId;
  readonly latestRun?: RequestRunRecord;
  readonly executingRun?: RequestRunRecord;
  readonly queuedRuns: readonly RequestRunRecord[];
  readonly terminalPendingRun?: RequestRunRecord;
}

export type RequestRunIdempotencyAnchor = 'ACCEPTANCE' | 'TERMINAL_COMMIT';
export type RequestRunIdempotencyLookupStatus = 'FOUND' | 'NOT_FOUND' | 'SEMANTIC_CONFLICT';

export interface RequestRunIdempotencyLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly anchor: RequestRunIdempotencyAnchor;
  readonly idempotencyKey: IdempotencyKey;
  readonly idempotencySemantic: string;
}

export interface RequestRunIdempotencyLookupResult {
  readonly status: RequestRunIdempotencyLookupStatus;
  readonly record?: RequestRunRecord;
}

export interface AgentListRecoverableRunsRequest {
  readonly agentId: AgentId;
  readonly now: EpochMillis;
  readonly limit: number;
}

export type SessionTitleSource = 'automatic' | 'manual';

export interface SessionRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly parentSessionId?: SessionId;
  readonly parentRunId?: RequestRunId;
  readonly parentRequestId?: MessageId;
  readonly title?: string;
  readonly titleSource?: SessionTitleSource;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface SessionLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface SessionHistoryRecordQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly offset: number;
  readonly limit: number;
  readonly questionSearchText?: string;
  readonly createdAtFrom?: EpochMillis;
  readonly createdAtTo?: EpochMillis;
}

export interface SessionHistoryEntry extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly parentSessionId?: SessionId;
  readonly parentRunId?: RequestRunId;
  readonly parentRequestId?: MessageId;
  readonly createdAt: EpochMillis;
  readonly title?: string;
  readonly updatedAt: EpochMillis;
  readonly latestRunStatus?: RunStatus;
  readonly hasInFlightRequest: boolean;
}

export interface SessionHistoryPage {
  readonly entries: readonly SessionHistoryEntry[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface SessionMessageRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly messageId: MessageId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly role: SessionMessageRole;
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly metadata: JsonObject;
  readonly visible: boolean;
  readonly createdAt: EpochMillis;
}

export interface SessionMessageLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly messageId: MessageId;
}

export interface ConversationPreviewRecordQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly offset?: number;
  readonly limit: number;
}

export interface ConversationPreviewMarkerRecord {
  readonly messageId: MessageId;
  readonly requestId?: MessageId;
  readonly createdAt: EpochMillis;
  readonly previewText: string;
  readonly previewTruncated: boolean;
  readonly answerPreviewText?: string;
  readonly answerPreviewTruncated?: boolean;
}

export interface ConversationPreviewRecordPage {
  readonly sessionId: SessionId;
  readonly totalMarkers: number;
  readonly offset: number;
  readonly limit: number;
  readonly markers: readonly ConversationPreviewMarkerRecord[];
}

/**
 * Batch lookup request. The gateway MUST return one record per
 * resolved `messageId` in the same tenant / subject / agent
 * scope; missing or no-longer-visible ids are simply absent from
 * the result. Used by the render stage to avoid N+1 fan-out when
 * resolving a set of `selectedMessageRefs` against the message
 * store. Callers that need to distinguish "missing" from
 * "not-yet-persisted" compare the input id set to the returned
 * record set.
 */
export interface SessionMessagesBatchLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly messageIds: readonly MessageId[];
}

export interface HideMessageRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly messageId: MessageId;
  readonly reason: VisibilityReason;
  readonly hiddenByContextId: RequestContextId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface HideRequestMessagesRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly reason: VisibilityReason;
  readonly hiddenByContextId: RequestContextId;
}

export interface ListSessionMessagesRecordQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly locale?: string;
  readonly includeHidden: boolean;
  readonly includeCapabilityResults: boolean;
  readonly beforeCursor?: string;
  readonly afterCursor?: string;
  readonly anchorMessageId?: MessageId;
  readonly limit: number;
}

export interface ListCurrentRequestMessagesRecordQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly includeHidden: boolean;
  readonly offset: number;
  readonly limit: number;
}

export interface SessionMessageRecordPage {
  readonly items: readonly SessionMessageRecord[];
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextBeforeCursor?: string;
  readonly newerCursor?: string;
}

export type ForkPromotionRefType = 'CAPABILITY_RESULT';
export type ForkAttemptId = Brand<string, 'ForkAttemptId'>;

export interface PrepareForkRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId?: MessageId;
  readonly sourceRequestId?: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface ForkRequiredContentRef {
  readonly sourceMessageId: MessageId;
  readonly sourceRequestId: MessageId;
  readonly sourceRunId: RequestRunId;
  readonly agentVersion: AgentVersion;
  readonly refType: ForkPromotionRefType;
  readonly refId: string;
}

export interface PrepareForkResult {
  readonly forkAttemptId: ForkAttemptId;
  readonly requiredContentRefs: readonly ForkRequiredContentRef[];
  readonly maxPromotedBytes: number;
}

export interface ForkSessionRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId?: MessageId;
  readonly sourceRequestId?: MessageId;
  readonly idempotencyKey: IdempotencyKey;
  readonly forkAttemptId: ForkAttemptId;
}

export interface ForkSessionResult {
  readonly childSession: SessionRecord;
  readonly replayed: boolean;
}

export interface SessionForkSourceRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly childSessionId: SessionId;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly childAnchorMessageId: MessageId;
  readonly sourceSessionTitleSnapshot: string;
  readonly createdAt: EpochMillis;
}

export interface StageForkPromotionRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: ForkAttemptId;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId: MessageId;
  readonly sourceRefId: string;
  readonly refType: ForkPromotionRefType;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface StageForkPromotionResult {
  readonly forkAttemptId: ForkAttemptId;
  readonly sourceMessageId: MessageId;
  readonly sourceRefId: string;
  readonly promotedContentId: string;
}

const ForkOwnerScopeSchema = {
  tenantId: Type.String({ minLength: 1 }),
  subjectId: Type.String({ minLength: 1 }),
  agentId: Type.String({ minLength: 1 }),
  sourceSessionId: Type.String({ minLength: 1 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 128 }),
} as const;

export const PrepareForkRequestSchema = Type.Union([
  Type.Object({ ...ForkOwnerScopeSchema, sourceMessageId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ ...ForkOwnerScopeSchema, sourceRequestId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
]);

export const ForkRequiredContentRefSchema = Type.Object(
  {
    sourceMessageId: Type.String({ minLength: 1 }),
    sourceRequestId: Type.String({ minLength: 1 }),
    sourceRunId: Type.String({ minLength: 1 }),
    agentVersion: Type.String({ minLength: 1 }),
    refType: Type.Literal('CAPABILITY_RESULT'),
    refId: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);

export const PrepareForkResultSchema = Type.Object(
  {
    forkAttemptId: Type.String({ minLength: 1, maxLength: 128 }),
    requiredContentRefs: Type.Array(ForkRequiredContentRefSchema, { maxItems: 8 }),
    maxPromotedBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const StageForkPromotionRequestSchema = Type.Object(
  {
    tenantId: Type.String({ minLength: 1 }),
    subjectId: Type.String({ minLength: 1 }),
    agentId: Type.String({ minLength: 1 }),
    forkAttemptId: Type.String({ minLength: 1, maxLength: 128 }),
    sourceSessionId: Type.String({ minLength: 1 }),
    sourceMessageId: Type.String({ minLength: 1 }),
    sourceRefId: Type.String({ minLength: 1, maxLength: 512 }),
    refType: Type.Literal('CAPABILITY_RESULT'),
    bytes: Type.Uint8Array(),
    mimeType: Type.String({ minLength: 1, maxLength: 256 }),
    sizeBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const StageForkPromotionResultSchema = Type.Object(
  {
    forkAttemptId: Type.String({ minLength: 1, maxLength: 128 }),
    sourceMessageId: Type.String({ minLength: 1 }),
    sourceRefId: Type.String({ minLength: 1, maxLength: 512 }),
    promotedContentId: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);

export const ForkSessionRequestSchema = Type.Union([
  Type.Object(
    { ...ForkOwnerScopeSchema, sourceMessageId: Type.String({ minLength: 1 }), forkAttemptId: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...ForkOwnerScopeSchema, sourceRequestId: Type.String({ minLength: 1 }), forkAttemptId: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false },
  ),
]);

const ForkSessionRecordSchema = Type.Object(
  {
    tenantId: Type.String({ minLength: 1 }),
    subjectId: Type.String({ minLength: 1 }),
    agentId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    parentSessionId: Type.Optional(Type.String({ minLength: 1 })),
    parentRunId: Type.Optional(Type.String({ minLength: 1 })),
    parentRequestId: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.Optional(Type.String()),
    titleSource: Type.Optional(Type.Union([Type.Literal('automatic'), Type.Literal('manual')])),
    createdAt: Type.Number({ minimum: 0 }),
    updatedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ForkSessionResultSchema = Type.Object(
  { childSession: ForkSessionRecordSchema, replayed: Type.Boolean() },
  { additionalProperties: false },
);

export interface LoadCommittedForkPromotionContentRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly childSessionId: SessionId;
  readonly childMessageId: MessageId;
  readonly promotedContentId: string;
}

export interface ForkPromotionContent {
  readonly refType: ForkPromotionRefType;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface ForkPromotionAbortRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: ForkAttemptId;
}

export interface ForkPromotionCleanupRequest {
  readonly now: EpochMillis;
  readonly retentionMs: number;
}

export interface ForkPromotionCleanupResult {
  readonly cleanedCount: number;
  readonly retryableCount: number;
}

export interface LoadSessionForkSourceRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly childSessionId: SessionId;
}

export interface HasUserMessageAfterForkAnchorRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly childSessionId: SessionId;
}

export interface ActiveContextStateRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly activeContextVersion: number;
  readonly updatedAt: EpochMillis;
}

export interface ActiveContextItemRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly ordinal: number;
  readonly messageId: MessageId;
}

export interface ActiveContextViewRecord {
  readonly state: ActiveContextStateRecord;
  readonly items: readonly ActiveContextItemRecord[];
  /**
   * Optional metadata bag for cross-cutting concerns (e.g. micro-compact
   * state). Backward-compatible: when absent, consumers treat it as empty.
   * Keys are owned by individual pipeline stages; the gateway does not
   * interpret the contents.
   */
  readonly metadata?: JsonObject;
}

export interface ActiveContextLookupRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface ActiveContextMetadataUpdateRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly expectedActiveContextVersion: number;
  readonly metadata: JsonObject;
}

export interface AppendActiveContextItemRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly messageId: MessageId;
  readonly expectedActiveContextVersion: number;
}

export interface ContextCompactionCommitRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly expectedActiveContextVersion: number;
  readonly summaryMessage: SessionMessageRecord;
  readonly retainedTailMessageIds: readonly MessageId[];
  /**
   * Idempotency key for the summary `SessionMessageRecord`
   * write. When two concurrent commits race on the same
   * tenant/session/summary-message-id scope, the gateway MUST
   * de-duplicate via this key (returning the first saved record)
   * rather than create a duplicate message row. The key is
   * carried in the gateway's internal write options, not on the
   * durable `SessionMessageRecord`.
   */
  readonly idempotencyKey?: IdempotencyKey;
}

interface RunTimelineEventRecordBase extends OwnerScoped {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly eventId: string;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
  readonly requestId: MessageId;
  readonly sequence: TimelineSequence;
  readonly type: TimelineEventType;
  readonly inlinePayload: JsonObject;
  readonly createdAt: EpochMillis;
}

export interface RuntimeRunTimelineEventRecord extends RunTimelineEventRecordBase {
  readonly recordOrigin?: never;
  readonly requestContextId: RequestContextId;
  readonly contentRef?: string;
}

export interface ForkSnapshotRunTimelineEventRecord extends RunTimelineEventRecordBase {
  readonly recordOrigin: 'FORK_SNAPSHOT';
  readonly requestContextId?: never;
  readonly contentRef?: never;
}

export type RunTimelineEventRecord = RuntimeRunTimelineEventRecord | ForkSnapshotRunTimelineEventRecord;

export type ForkProcessSnapshotStatus = 'AVAILABLE' | 'LEGACY_UNAVAILABLE';

export interface ForkProcessSnapshotStatusRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly status: ForkProcessSnapshotStatus;
}

export interface LoadForkProcessSnapshotStatusRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
}

export interface RunTimelineEventRecordQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly afterSequence: TimelineSequence;
  readonly limit: number;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly recordOrigin?: 'RUNTIME' | 'FORK_SNAPSHOT';
}

export type TaskTrajectorySourceRefKind =
  'SESSION' | 'REQUEST_RUN' | 'MESSAGE' | 'TIMELINE_EVENT' | 'CAPABILITY_INVOCATION' | 'ARTIFACT' | 'CONTENT_REF' | 'DIAGNOSTIC';

export interface TaskTrajectorySourceRef {
  readonly refKind: TaskTrajectorySourceRefKind;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly requestRunId?: RequestRunId;
  readonly messageId?: MessageId;
  readonly timelineEventId?: string;
  readonly timelineSequence?: TimelineSequence;
  readonly capabilityInvocationId?: string;
  readonly contentRef?: string;
  readonly safeReasonCode?: string;
}

export type TaskTrajectoryObservationKind = 'REQUEST_FACT' | 'TOOL_RESULT' | 'DIAGNOSTIC' | 'USER_CONFIRMATION' | 'VERIFICATION' | 'TERMINAL_STATUS';

export interface TaskTrajectoryObservation {
  readonly kind: TaskTrajectoryObservationKind;
  readonly summary: string;
  readonly sourceRefs: readonly TaskTrajectorySourceRef[];
  readonly observedAt: EpochMillis;
}

export type TaskTrajectoryActionKind = 'MODEL_RESPONSE' | 'TOOL_INVOCATION' | 'CONFIG_APPLY' | 'VERIFICATION' | 'USER_INPUT' | 'OTHER';

export type TaskTrajectoryActionStatus = 'SUCCEEDED' | 'FAILED' | 'DEGRADED' | 'TIMED_OUT' | 'CANCELLED' | 'UNKNOWN';

export interface TaskTrajectoryAction {
  readonly kind: TaskTrajectoryActionKind;
  readonly summary: string;
  readonly status: TaskTrajectoryActionStatus;
  readonly sourceRefs: readonly TaskTrajectorySourceRef[];
  readonly startedAt?: EpochMillis;
  readonly completedAt?: EpochMillis;
}

export interface TaskTrajectoryRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly taskTrajectoryId: TaskTrajectoryId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestRunId: RequestRunId;
  readonly taskKind: TaskTrajectoryKind;
  readonly trajectoryBuildStatus: TaskTrajectoryBuildStatus;
  readonly taskOutcomeStatus: TaskOutcomeStatus;
  readonly outcomeEvidenceLevel: OutcomeEvidenceLevel;
  readonly goalSummary: string;
  readonly constraintSummaries: readonly string[];
  readonly observations: readonly TaskTrajectoryObservation[];
  readonly actions: readonly TaskTrajectoryAction[];
  readonly outcomeSummary?: string;
  readonly outcomeEvidenceRefs: readonly TaskTrajectorySourceRef[];
  readonly failureSummary?: string;
  readonly sourceRefs: readonly TaskTrajectorySourceRef[];
  readonly startedAt: EpochMillis;
  readonly completedAt: EpochMillis;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export type SaveTaskTrajectoryRequest = TaskTrajectoryRecord;

export interface ListTaskTrajectoriesQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId?: SessionId;
  readonly requestRunId?: RequestRunId;
  readonly taskKind?: TaskTrajectoryKind;
  readonly trajectoryBuildStatus?: TaskTrajectoryBuildStatus;
  readonly taskOutcomeStatus?: TaskOutcomeStatus;
  readonly outcomeEvidenceLevel?: OutcomeEvidenceLevel;
  readonly startedAfter?: EpochMillis;
  readonly startedBefore?: EpochMillis;
  readonly completedAfter?: EpochMillis;
  readonly completedBefore?: EpochMillis;
  readonly limit: number;
  readonly cursor?: string;
}

export interface TaskTrajectoryListResult {
  readonly items: readonly TaskTrajectoryRecord[];
  readonly nextCursor?: string;
}

export interface TaskTrajectoryBuildCandidate extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestRunId: RequestRunId;
  readonly terminalTimelineEventId: string;
  readonly terminalTimelineSequence: TimelineSequence;
  readonly terminalStatus: Extract<RunStatus, 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'>;
  readonly terminalCommittedAt: EpochMillis;
}

export interface ListTaskTrajectoryBuildCandidatesQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId?: SessionId;
  readonly sinceTime?: EpochMillis;
  readonly untilTime?: EpochMillis;
  readonly limit: number;
  readonly cursor?: string;
}

export interface TaskTrajectoryBuildCandidateResult {
  readonly items: readonly TaskTrajectoryBuildCandidate[];
  readonly nextCursor?: string;
}

export interface RequestAttachmentRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly attachmentId: AttachmentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly fileName: string;
  readonly mediaType: AttachmentMediaType;
  readonly sizeBytes: number;
  readonly validationStatus: AttachmentValidationStatus;
  readonly availabilityStatus: AttachmentAvailabilityStatus;
  readonly storageRef: BlobRef;
  readonly createdAt: EpochMillis;
}

export interface LoadAttachmentRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly attachmentId: AttachmentId;
}

export interface ListAttachmentsByRequestIdRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly requestId: MessageId;
}

export interface ListAttachmentsByRunIdRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly runId: RequestRunId;
}

export interface ListAttachmentsBySessionRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface UpdateAttachmentStatusRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly attachmentId: AttachmentId;
  readonly validationStatus: AttachmentValidationStatus;
  readonly availabilityStatus: AttachmentAvailabilityStatus;
}

export interface StoreBlobRequest extends OwnerScoped {
  readonly purpose: BlobRecordPurpose;
  readonly blobRef: BlobRef;
  readonly localFilePath: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly diagnosticContext?: JsonObject;
}

export interface LoadBlobRequest extends OwnerScoped {
  readonly blobRef: BlobRef;
}

export interface MaterializeBlobRequest extends LoadBlobRequest {
  readonly localFilePath: string;
}

export interface DeleteBlobRequest extends OwnerScoped {
  readonly blobRef: BlobRef;
}

export interface ArtifactMetadataRecord extends OwnerScoped {
  readonly artifactId: ArtifactId;
  readonly safeName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: EpochMillis;
}

export interface LoadArtifactMetadataRequest extends OwnerScoped {
  readonly artifactId: ArtifactId;
}

export interface CheckpointRecord extends OwnerScoped {
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
}

export interface LoadCheckpointRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
}

export interface PendingInputOptionRecord {
  readonly label: string;
  readonly value: string;
  readonly requiresTextInput?: boolean;
  readonly inputPlaceholder?: string;
}

export interface PendingInputQuestionRecord {
  readonly prompt: string;
  readonly options: readonly PendingInputOptionRecord[];
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

export interface PendingInputRequestRecord {
  readonly id: PendingInputId;
  readonly sessionId: SessionId;
  readonly kind: PendingInputKind;
  readonly questions: readonly PendingInputQuestionRecord[];
  readonly timeoutAt?: EpochMillis;
}

export interface AuthorizationScopeRecord {
  readonly operationKind: RestrictedOperationKind;
  readonly operationId: string;
  readonly capabilityId?: string;
  readonly toolCallId?: string;
  readonly riskLevel: RiskLevel;
}

export interface PendingInputAnswerRecord {
  readonly answers: ReadonlyArray<readonly string[]>;
  readonly answerKinds?: readonly PendingInputQuestionAnswerKind[];
  readonly answeredAt: EpochMillis;
}

export type PendingInputProducerRef =
  | {
      readonly kind: 'LIFECYCLE_HOOK';
      readonly stage?: LifecycleStage;
      readonly toolCall?: {
        readonly capabilityId: CapabilityId;
        readonly toolCallId: ToolCallId;
        readonly arguments: JsonObject;
      };
    }
  | {
      readonly kind: 'WORKFLOW_NODE';
      readonly recipeName: string;
      readonly nodeId: string;
      readonly nodeType: string;
      readonly executionId: string;
    }
  | { readonly kind: 'CAPABILITY_INVOCATION'; readonly capabilityId: CapabilityId; readonly toolCallId: ToolCallId };

export interface PendingInputRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly pendingInputId: PendingInputId;
  readonly requestRunId: RequestRunId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestContextId: RequestContextId;
  readonly checkpointId: CheckpointId;
  readonly kind: PendingInputKind;
  readonly request: PendingInputRequestRecord;
  readonly producerRef: PendingInputProducerRef;
  readonly status: PendingInputStatus;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
  readonly authorizationScope?: AuthorizationScopeRecord;
  readonly responseAnswers?: ReadonlyArray<readonly string[]>;
  readonly responseAnswerKinds?: readonly PendingInputQuestionAnswerKind[];
}

export interface CreatePendingInputRecordRequest extends OwnerScoped {
  readonly record: PendingInputRecord;
}

export interface LoadPendingInputRecordRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly pendingInputId: PendingInputId;
}

export interface LoadActivePendingInputRecordRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface PendingInputTimeoutFactCursor {
  readonly timeoutAt: EpochMillis;
  readonly pendingInputId: PendingInputId;
}

export interface AgentListUnresolvedPendingInputTimeoutFactsRequest {
  readonly agentId: AgentId;
  readonly limit: number;
  readonly after?: PendingInputTimeoutFactCursor;
}

export interface ResolvePendingInputRecordRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly pendingInputId: PendingInputId;
  readonly expectedStatus: Extract<PendingInputStatus, 'PENDING'>;
  readonly status: Exclude<PendingInputStatus, 'PENDING'>;
  readonly answer?: PendingInputAnswerRecord;
}

export interface ResolvePendingInputRecordOptions {
  readonly idempotencyKey: IdempotencyKey;
  readonly idempotencySemantic: string;
}

export type PendingInputResolveStatus = VersionedUpdateStatus | 'IDEMPOTENCY_CONFLICT';

export interface PendingInputResolveResult {
  readonly status: PendingInputResolveStatus;
  readonly record?: PendingInputRecord;
}

export type ConversationAnnotationSentiment = 'UP' | 'DOWN';

export interface ConversationAnnotationRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly annotationId: string;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly sentiment?: ConversationAnnotationSentiment | null;
  readonly isFavorited?: boolean;
  readonly isQuestionFavorited?: boolean;
  readonly comment?: string | null;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface DeleteAnnotationsByRunRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly requestRunId: RequestRunId;
}

export interface ListFavoriteTurnsQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly limit: number;
  readonly offset: number;
}
export interface ListQuestionFavoriteTurnsQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly limit: number;
  readonly offset: number;
}

export interface ConversationFavoriteTurnSummary {
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly rootMessageId: MessageId;
  readonly questionPreview: string;
  readonly questionTruncated: boolean;
  readonly sessionTitle?: string;
  readonly sessionUpdatedAt: EpochMillis;
  readonly favoritedAt: EpochMillis;
}

export interface ListSessionAnnotationsQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface LongTermMemoryRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly sharingState: SharingState;
  readonly sourceMemoryId?: LongTermMemoryId;
  readonly state: LongTermMemoryState;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels: readonly string[];
  readonly confidence: number;
  readonly version: number;
  readonly accessCount: number;
  readonly recallCount: number;
  readonly extractionCount: number;
  readonly lastAccessedAt?: EpochMillis;
  readonly archivedAt: EpochMillis;
  readonly archiveReason: string;
  readonly isPinned: boolean;
  readonly source: string;
  readonly createTime: EpochMillis;
  readonly updateTime: EpochMillis;
}

export interface SaveLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId?: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence: number;
  readonly source: string;
}

export interface BatchCreateLongTermMemoryItem {
  readonly memoryId?: LongTermMemoryId;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence?: number;
  readonly source?: string;
  readonly state?: LongTermMemoryState;
  readonly archiveReason?: string;
  readonly writeOptions?: Pick<VersionedWriteOptions, 'idempotencyKey'>;
}

export interface BatchCreateLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryInstance?: string;
  readonly items: readonly BatchCreateLongTermMemoryItem[];
}

export interface BatchCreateLongTermMemoryResult {
  readonly successCount: number;
  readonly failCount: number;
  readonly memoryIds: readonly LongTermMemoryId[];
}

export interface ManualSaveLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId?: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence: number;
}

export interface GetLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
}

export interface ListLongTermMemoryQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryInstance?: string;
  readonly queryText?: string;
  readonly memoryType?: MemoryType;
  readonly knowledgeSourceType?: KnowledgeSourceType;
  readonly state?: LongTermMemoryState;
  readonly isPinned?: boolean;
  readonly minConfidence?: number;
  readonly sinceTime?: EpochMillis;
  readonly untilTime?: EpochMillis;
  readonly maxLastAccessedAt?: EpochMillis;
  readonly labels?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface DeleteLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface DeleteLongTermMemoryResult {
  readonly memoryId: LongTermMemoryId;
}

export interface SearchLongTermMemoryQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryInstance?: string;
  readonly queryText: string;
  readonly memoryType?: MemoryType;
  readonly knowledgeSourceType?: KnowledgeSourceType;
  readonly minConfidence: number;
  readonly sinceTime?: EpochMillis;
  readonly untilTime?: EpochMillis;
  readonly labels?: readonly string[];
  readonly limit: number;
  readonly offset: number;
}

export interface GetLongTermMemoryDetailRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
}

export interface LongTermMemorySummary {
  readonly memoryId: LongTermMemoryId;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly state: LongTermMemoryState;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels: readonly string[];
  readonly confidence: number;
  readonly isPinned: boolean;
  readonly accessCount: number;
  readonly createTime: EpochMillis;
  readonly updateTime: EpochMillis;
  readonly version: number;
}

export interface LongTermMemorySummaryPage {
  readonly items: readonly LongTermMemorySummary[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface SearchItem {
  readonly summary: LongTermMemorySummary;
  readonly score: number;
  readonly relevanceScore: number;
}

export interface SearchItemPage {
  readonly items: readonly SearchItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface MutateLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly targetState?: LongTermMemoryState;
  readonly archiveReason?: string;
  readonly delta?: number;
  readonly lastAccessTime?: EpochMillis;
  readonly isPinned?: boolean;
}

export interface LongTermMemoryVersionedUpdateResult {
  readonly status: VersionedUpdateStatus;
  readonly memoryId?: LongTermMemoryId;
  readonly currentVersion?: number;
  readonly record?: LongTermMemoryRecord;
}

export interface SharingLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface PublishLongTermMemoryResult {
  readonly publishedMemory: LongTermMemoryRecord;
  readonly sourceMemoryId: LongTermMemoryId;
  readonly ownerSubjectId: SubjectId;
}

export interface UnpublishLongTermMemoryResult {
  readonly memoryId: LongTermMemoryId;
}

export interface SharedMemorySummary extends LongTermMemorySummary {
  readonly sourceMemoryId: LongTermMemoryId;
  readonly ownerSubjectId: SubjectId;
}

export interface ListPublishedLongTermMemoryQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryInstance?: string;
  readonly queryText?: string;
  readonly memoryType?: MemoryType;
  readonly knowledgeSourceType?: KnowledgeSourceType;
  readonly labels?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SharedMemorySummaryPage {
  readonly items: readonly SharedMemorySummary[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface CopyLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly memoryIds: readonly LongTermMemoryId[];
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface CopiedPublishedMemoryResult {
  readonly memoryId: LongTermMemoryId;
  readonly record: LongTermMemoryRecord;
  readonly sourceMemoryId: LongTermMemoryId;
  readonly copyStatus: 'COPIED' | 'EXISTING';
}

export interface CopyPublishedMemoryResponse {
  readonly results: readonly CopiedPublishedMemoryResult[];
}

export interface RunTimelineEventStoreGateway {
  appendEvent: (record: RunTimelineEventRecord, options?: IdempotentWriteOptions) => Promise<RunTimelineEventRecord>;
  listEvents: (request: RunTimelineEventRecordQuery) => Promise<readonly RunTimelineEventRecord[]>;
}

export interface TaskTrajectoryStoreGateway {
  saveTaskTrajectory: (record: SaveTaskTrajectoryRequest, options?: IdempotentWriteOptions) => Promise<TaskTrajectoryRecord | SafeError>;
}

export interface TaskTrajectoryQueryGateway {
  listTaskTrajectories: (query: ListTaskTrajectoriesQuery) => Promise<TaskTrajectoryListResult | SafeError>;
  listBuildCandidates: (query: ListTaskTrajectoryBuildCandidatesQuery) => Promise<TaskTrajectoryBuildCandidateResult | SafeError>;
}

export interface SessionStoreGateway {
  loadSession: (request: SessionLookupRequest) => Promise<SessionRecord | undefined>;
  listSessions: (request: SessionHistoryRecordQuery) => Promise<SessionHistoryPage>;
  saveSession: (record: SessionRecord, options?: IdempotentWriteOptions) => Promise<SessionRecord>;
  deleteSessionCascade: (request: DeleteSessionCascadeRequest) => Promise<DeleteSessionCascadeResult>;
}

export interface DeleteSessionCascadeRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export type DeleteSessionCascadeStatus = 'DELETED' | 'NOT_FOUND' | 'CONFLICT_ACTIVE_RUN';

export interface DeleteSessionCascadeResult {
  readonly status: DeleteSessionCascadeStatus;
}

export interface SessionMessageStoreGateway {
  appendSessionMessage: (record: SessionMessageRecord, options?: IdempotentWriteOptions) => Promise<SessionMessageRecord>;
  loadMessage: (request: SessionMessageLookupRequest) => Promise<SessionMessageRecord | undefined>;
  listConversationPreview: (request: ConversationPreviewRecordQuery) => Promise<ConversationPreviewRecordPage>;
  /**
   * Batch-load multiple session messages in a single gateway
   * call. Implementations MUST return at most one record per
   * distinct `messageId` in the request and SHOULD coalesce the
   * underlying query into a single round-trip (e.g. a single
   * SQL `IN (...)` statement). The render stage uses this to
   * resolve `ContextAssembly.selectedMessageRefs` without
   * performing one `loadMessage` per ref (the N+1 anti-pattern).
   */
  loadMessages: (request: SessionMessagesBatchLookupRequest) => Promise<readonly SessionMessageRecord[]>;
  listMessages: (request: ListSessionMessagesRecordQuery) => Promise<SessionMessageRecordPage>;
  listCurrentRequestMessages: (request: ListCurrentRequestMessagesRecordQuery) => Promise<SessionMessageRecordPage>;
  hideMessage: (request: HideMessageRequest) => Promise<SessionMessageRecord | undefined>;
  hideRequestMessages: (request: HideRequestMessagesRequest) => Promise<number>;
}

export interface SessionForkStoreGateway {
  prepareFork: (request: PrepareForkRequest, signal?: AbortSignal) => Promise<PrepareForkResult>;
  stageForkPromotion: (request: StageForkPromotionRequest, signal?: AbortSignal) => Promise<StageForkPromotionResult>;
  forkSession: (request: ForkSessionRequest, signal?: AbortSignal) => Promise<ForkSessionResult>;
  abortForkPromotions: (request: ForkPromotionAbortRequest, signal?: AbortSignal) => Promise<void>;
  loadSessionForkSource: (request: LoadSessionForkSourceRequest, signal?: AbortSignal) => Promise<SessionForkSourceRecord | undefined>;
  loadForkProcessSnapshotStatus: (
    request: LoadForkProcessSnapshotStatusRequest,
    signal?: AbortSignal,
  ) => Promise<ForkProcessSnapshotStatusRecord | undefined>;
  hasUserMessageAfterForkAnchor: (request: HasUserMessageAfterForkAnchorRequest, signal?: AbortSignal) => Promise<boolean>;
  loadCommittedForkPromotionContent: (
    request: LoadCommittedForkPromotionContentRequest,
    signal?: AbortSignal,
  ) => Promise<ForkPromotionContent | undefined>;
  cleanupExpiredForkPromotions: (request: ForkPromotionCleanupRequest, signal?: AbortSignal) => Promise<ForkPromotionCleanupResult>;
}

export interface ActiveContextStoreGateway {
  loadActiveContext: (request: ActiveContextLookupRequest) => Promise<ActiveContextViewRecord>;
  appendItem: (request: AppendActiveContextItemRequest) => Promise<VersionedUpdateResult<ActiveContextViewRecord>>;
  commitCompaction: (request: ContextCompactionCommitRequest) => Promise<VersionedUpdateResult<ActiveContextViewRecord>>;
  updateMetadata: (request: ActiveContextMetadataUpdateRequest) => Promise<VersionedUpdateResult<ActiveContextViewRecord>>;
}

export interface AttachmentStoreGateway {
  saveAttachment: (record: RequestAttachmentRecord) => Promise<RequestAttachmentRecord>;
  loadAttachment: (request: LoadAttachmentRequest) => Promise<RequestAttachmentRecord | undefined>;
  listAttachmentsByRequestId: (request: ListAttachmentsByRequestIdRequest) => Promise<readonly RequestAttachmentRecord[]>;
  listAttachmentsByRunId: (request: ListAttachmentsByRunIdRequest) => Promise<readonly RequestAttachmentRecord[]>;
  listAttachmentsBySession: (request: ListAttachmentsBySessionRequest) => Promise<readonly RequestAttachmentRecord[]>;
  updateAttachmentStatus: (request: UpdateAttachmentStatusRequest) => Promise<RequestAttachmentRecord | undefined>;
}

export type AttachmentIntakeReservationAction = 'SUBMIT_REQUEST' | 'EDIT_LATEST_REQUEST';
export type AttachmentIntakeReservationStatus = 'RESERVED' | 'INTAKE_ACCEPTED' | 'INTAKE_REJECTED';

export interface AttachmentIntakeReservationRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly reservationId: AttachmentIntakeReservationId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly action: AttachmentIntakeReservationAction;
  readonly commandSemanticHash: string;
  readonly status: AttachmentIntakeReservationStatus;
  readonly attachmentIds: readonly AttachmentId[];
  readonly rejectionReasonCode?: string;
  readonly safeError?: SafeError;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface ReserveAttachmentIntakeRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly idempotencyKey: IdempotencyKey;
  readonly action: AttachmentIntakeReservationAction;
  readonly commandSemanticHash: string;
  readonly create: {
    readonly reservationId: AttachmentIntakeReservationId;
    readonly requestId: MessageId;
    readonly runId: RequestRunId;
    readonly requestContextId: RequestContextId;
    readonly createdAt: EpochMillis;
  };
}

export type AttachmentIntakeReservationResultStatus = 'RESERVED' | 'REPLAY' | 'SEMANTIC_CONFLICT';

export interface AttachmentIntakeReservationResult {
  readonly status: AttachmentIntakeReservationResultStatus;
  readonly record?: AttachmentIntakeReservationRecord;
}

export interface CompleteAttachmentIntakeReservationRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly reservationId: AttachmentIntakeReservationId;
  readonly status: Extract<AttachmentIntakeReservationStatus, 'INTAKE_ACCEPTED' | 'INTAKE_REJECTED'>;
  readonly attachmentIds: readonly AttachmentId[];
  readonly rejectionReasonCode?: string;
  readonly safeError?: SafeError;
  readonly updatedAt: EpochMillis;
}

export interface AttachmentIntakeReservationGateway {
  reserveAttachmentIntake: (request: ReserveAttachmentIntakeRequest) => Promise<AttachmentIntakeReservationResult>;
  completeAttachmentIntakeReservation: (
    request: CompleteAttachmentIntakeReservationRequest,
  ) => Promise<AttachmentIntakeReservationRecord | undefined>;
}

export interface BlobStoreGateway {
  storeBlob: (request: StoreBlobRequest) => Promise<BlobRef>;
  loadBlob: (request: LoadBlobRequest) => Promise<Uint8Array | undefined>;
  materializeBlob: (request: MaterializeBlobRequest) => Promise<boolean>;
  blobExists: (request: LoadBlobRequest) => Promise<boolean>;
  deleteBlob: (request: DeleteBlobRequest) => Promise<boolean>;
  copyBlob: (request: CopyBlobRequest) => Promise<CopyBlobResult>;
  getBlobMetadata: (request: BlobMetadataRequest) => Promise<BlobMetadata | undefined>;
  listBlobs: (request: ListBlobsRequest) => Promise<ListBlobsResult>;
}

export interface CopyBlobRequest {
  readonly sourceBlob: string;
  readonly destinationBlob: string;
}

export interface CopyBlobResult {
  readonly blobRef: BlobRef;
  readonly etag: string;
  readonly lastModified: EpochMillis;
}

export interface BlobMetadataRequest {
  readonly blobRef: BlobRef;
}

export interface BlobMetadata {
  readonly blobRef: BlobRef;
  readonly contentLength: number;
  readonly lastModified: EpochMillis;
  readonly metadata?: Record<string, string>;
}

export interface ListBlobsRequest {
  readonly prefix: string;
  readonly maxKeys?: number;
}

export interface ListBlobsResult {
  readonly blobs: ReadonlyArray<{
    readonly blobRef: BlobRef;
    readonly size: number;
  }>;
  readonly truncated: boolean;
  readonly nextMarker?: string;
}

export interface ArtifactGatewayPort {
  saveArtifactMetadata: (record: ArtifactMetadataRecord) => Promise<ArtifactMetadataRecord>;
  loadArtifactMetadata: (request: LoadArtifactMetadataRequest) => Promise<ArtifactMetadataRecord | undefined>;
}

export interface CheckpointStoreGateway {
  saveCheckpoint: (record: CheckpointRecord, options: { readonly idempotencyKey: IdempotencyKey }) => Promise<CheckpointRecord>;
  loadCheckpoint: (request: LoadCheckpointRequest) => Promise<CheckpointRecord | undefined>;
}

export interface PendingInputStoreGateway {
  createPendingInput: (request: CreatePendingInputRecordRequest) => Promise<PendingInputRecord>;
  loadPendingInput: (request: LoadPendingInputRecordRequest) => Promise<PendingInputRecord | undefined>;
  loadActivePendingInput: (request: LoadActivePendingInputRecordRequest) => Promise<PendingInputRecord | undefined>;
  listUnresolvedPendingInputTimeoutFacts: (request: AgentListUnresolvedPendingInputTimeoutFactsRequest) => Promise<readonly PendingInputRecord[]>;
  resolvePendingInput: (request: ResolvePendingInputRecordRequest, options?: ResolvePendingInputRecordOptions) => Promise<PendingInputResolveResult>;
}

export interface ConversationAnnotationStoreGateway {
  saveAnnotation: (
    record: ConversationAnnotationRecord,
    options: IdempotentWriteOptions,
  ) => Promise<ConversationAnnotationRecord | undefined | SafeError>;
  deleteAnnotationsByRun: (request: DeleteAnnotationsByRunRequest) => Promise<void | SafeError>;
  listFavoriteTurns: (query: ListFavoriteTurnsQuery) => Promise<readonly ConversationFavoriteTurnSummary[] | SafeError>;
  listQuestionFavoriteTurns: (query: ListQuestionFavoriteTurnsQuery) => Promise<readonly ConversationFavoriteTurnSummary[] | SafeError>;
  listSessionAnnotations: (query: ListSessionAnnotationsQuery) => Promise<readonly ConversationAnnotationRecord[] | SafeError>;
}

export interface ConversationShareRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly shareId: string;
  readonly sessionId: SessionId;
  readonly runIds: readonly RequestRunId[];
  readonly originUrl: string;
  readonly allowedOps: readonly string[] | null;
  readonly expiresAt: EpochMillis | null;
  readonly createdAt: EpochMillis;
}

export interface LoadShareRequest {
  readonly shareId: string;
}

export interface DeleteSharesBySessionRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface ConversationShareStoreGateway {
  createShare: (record: ConversationShareRecord, options: IdempotentWriteOptions) => Promise<ConversationShareRecord | SafeError>;
  loadShare: (request: LoadShareRequest) => Promise<ConversationShareRecord | undefined | SafeError>;
  deleteSharesBySession: (request: DeleteSharesBySessionRequest) => Promise<void | SafeError>;
}

export interface UserQuestionActivityRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly questionHash: string;
  readonly questionText: string;
  readonly locale: string;
  readonly isPinned: boolean;
  readonly pinnedAt: EpochMillis | null;
  readonly askFrequency: number;
  readonly lastAskedAt: EpochMillis | null;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

export interface UserQuestionActivityScopeQuery extends OwnerScoped {
  readonly agentId: AgentId;
}

export interface UserQuestionActivityHighFrequencyQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly threshold: number;
}

export interface UserQuestionActivityStoreGateway {
  upsertActivity: (record: UserQuestionActivityRecord, options?: IdempotentWriteOptions) => Promise<UserQuestionActivityRecord | SafeError>;
  listHighFrequency: (query: UserQuestionActivityHighFrequencyQuery) => Promise<readonly UserQuestionActivityRecord[] | SafeError>;
}

export interface LongTermMemoryStoreGateway {
  getLongTermMemory: (request: GetLongTermMemoryRequest) => Promise<LongTermMemoryRecord | SafeError>;
  saveLongTermMemory: (request: SaveLongTermMemoryRequest, options?: VersionedWriteOptions) => Promise<LongTermMemoryRecord | SafeError>;
  batchCreateLongTermMemory: (request: BatchCreateLongTermMemoryRequest) => Promise<BatchCreateLongTermMemoryResult | SafeError>;
  manualSaveLongTermMemory: (request: ManualSaveLongTermMemoryRequest) => Promise<LongTermMemoryRecord | SafeError>;
  deleteLongTermMemory: (request: DeleteLongTermMemoryRequest) => Promise<DeleteLongTermMemoryResult | SafeError>;
  listLongTermMemory: (query: ListLongTermMemoryQuery) => Promise<LongTermMemorySummaryPage | SafeError>;
  mutateLongTermMemory: (
    request: MutateLongTermMemoryRequest,
    options?: Pick<VersionedWriteOptions, 'expectedVersion'>,
  ) => Promise<LongTermMemoryVersionedUpdateResult | SafeError>;
}

export interface LongTermMemoryRetrieverGateway {
  searchLongTermMemory: (query: SearchLongTermMemoryQuery) => Promise<SearchItemPage | SafeError>;
  getLongTermMemoryDetail: (request: GetLongTermMemoryDetailRequest) => Promise<LongTermMemoryRecord | SafeError>;
}

export interface LongTermMemorySharingGateway {
  publishLongTermMemory: (request: SharingLongTermMemoryRequest) => Promise<PublishLongTermMemoryResult | SafeError>;
  unpublishLongTermMemory: (request: SharingLongTermMemoryRequest) => Promise<UnpublishLongTermMemoryResult | SafeError>;
  listPublishedLongTermMemory: (query: ListPublishedLongTermMemoryQuery) => Promise<SharedMemorySummaryPage | SafeError>;
  copyPublishedMemory: (request: CopyLongTermMemoryRequest) => Promise<CopyPublishedMemoryResponse | SafeError>;
}

export type SandboxFilesystemRootKind = 'workspace' | 'systemResources' | 'temp' | 'generatedSkills' | 'sharedData';
export type SandboxFilesystemRootAccess = 'read' | 'readWrite';

export interface SandboxFilesystemRoot {
  readonly kind: SandboxFilesystemRootKind;
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly access: SandboxFilesystemRootAccess;
}

export interface SandboxFilesystemLayout {
  readonly defaultCwd: string;
  readonly roots: readonly SandboxFilesystemRoot[];
}

export interface SandboxExecutionRequest extends OwnerScoped {
  readonly executionId: string;
  readonly requestRunId: RequestRunId;
  readonly executable: 'bash' | 'python';
  readonly command: string;
  readonly args: readonly string[];
  readonly filesystem: SandboxFilesystemLayout;
  readonly environment: JsonObject;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
}

export interface SandboxExecutionResult {
  readonly executionId: string;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly safeError?: SafeError;
}

export interface BackgroundStartResult {
  readonly handle: BackgroundExecutionHandle;
  readonly completion: Promise<BackgroundCompletionPayload>;
}

export interface SandboxGatewayPort {
  execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>;
  /**
   * Optional: only local sandboxes support background (detached) execution.
   * Remote/app-level sandboxes omit it. BackgroundCapableSandboxPort re-declares
   * this as required and adds killBackground.
   */
  startBackground?: (request: SandboxExecutionRequest) => Promise<BackgroundStartResult | SafeError>;
}

/**
 * A sandbox gateway that supports detached background execution AND kill.
 * The local restricted sandbox satisfies this; remote/app-level sandboxes do
 * not. Background-task control (start/kill) depends on this narrow interface
 * rather than the full RestrictedLocalSandboxGatewayPort, so the contract
 * expresses exactly the capability it needs.
 */
export interface BackgroundCapableSandboxPort extends SandboxGatewayPort {
  startBackground: (request: SandboxExecutionRequest) => Promise<BackgroundStartResult | SafeError>;
  killBackground: (taskId: string) => Promise<{ readonly killed: boolean }>;
}

export type BackgroundTaskStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'KILLED';

export interface BackgroundExecutionHandle {
  readonly taskId: string;
  readonly status: 'RUNNING';
  readonly stdoutRef: string;
  readonly stderrRef: string;
  readonly startedAt: EpochMillis;
}

export interface BackgroundCompletionPayload {
  readonly taskId: string;
  readonly exitCode: number;
  readonly status: 'COMPLETED' | 'FAILED';
  readonly finishedAt: EpochMillis;
}

export type BackgroundCompletionCallback = (payload: BackgroundCompletionPayload) => void;

/** Race outcome: `completed` (process exited before timeout) or `backgrounded` (timeout/abort fired first). */
export type BackgroundableRaceResult =
  | { readonly kind: 'completed'; readonly payload: BackgroundCompletionPayload }
  | { readonly kind: 'backgrounded'; readonly reason: 'TIMEOUT_AUTO_BACKGROUND' | 'ABORT_AUTO_BACKGROUND' };

/** Race a background completion against a timeout (and optional abort). */
export async function raceBackgroundableCompletion(
  completion: Promise<BackgroundCompletionPayload>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BackgroundableRaceResult> {
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    timer.unref?.();
  });
  const abortPromise =
    signal === undefined
      ? null
      : new Promise<{ kind: 'abort' }>((resolve) => {
          if (signal.aborted) {
            resolve({ kind: 'abort' });
            return;
          }
          signal.addEventListener('abort', () => resolve({ kind: 'abort' }), { once: true });
        });
  const raced = await Promise.race<{ kind: 'timeout' } | { kind: 'abort' } | { kind: 'completed'; payload: BackgroundCompletionPayload }>([
    timeoutPromise,
    ...(abortPromise === null ? [] : [abortPromise]),
    completion.then((payload) => ({ kind: 'completed' as const, payload })),
  ]);
  if (raced.kind === 'completed') {
    return { kind: 'completed', payload: raced.payload };
  }
  return { kind: 'backgrounded', reason: raced.kind === 'timeout' ? 'TIMEOUT_AUTO_BACKGROUND' : 'ABORT_AUTO_BACKGROUND' };
}

export interface BackgroundTaskRecord {
  readonly taskId: string;
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly runId: RequestRunId;
  readonly requestId: MessageId;
  readonly requestContextId: RequestContextId;
  readonly toolCallId: string;
  readonly commandName: string;
  readonly commandLine?: string;
  readonly workspaceRoot?: string;
  readonly identityContext: IdentityContext;
  readonly locale?: RequestLocale;
  readonly status: BackgroundTaskStatus;
  readonly stdoutRef: string;
  readonly stderrRef: string;
  readonly exitCode?: number;
  readonly startedAt: EpochMillis;
  readonly finishedAt?: EpochMillis;
  readonly notified: boolean;
}

export interface BackgroundTaskStoreGatewayPort {
  create: (record: BackgroundTaskRecord) => Promise<BackgroundTaskRecord>;
  get: (taskId: string) => Promise<BackgroundTaskRecord | undefined>;
  list: (sessionId: SessionId) => Promise<readonly BackgroundTaskRecord[]>;
  markCompleted: (
    taskId: string,
    result: { readonly exitCode: number; readonly finishedAt: EpochMillis },
  ) => Promise<BackgroundTaskRecord | undefined>;
  markKilled: (taskId: string, result: { readonly finishedAt: EpochMillis }) => Promise<BackgroundTaskRecord | undefined>;
  markNotified: (taskId: string) => Promise<boolean>;
  updateStatus: (taskId: string, status: BackgroundTaskStatus) => Promise<BackgroundTaskRecord | undefined>;
  remove: (taskId: string) => Promise<boolean>;
}

export type RagRetrievalStatus = 'OK' | 'NO_INDEX' | 'UNAVAILABLE' | 'DEGRADED' | 'FAILED' | 'TIMEOUT' | 'CANCELED';

export type RagRetrievalReason =
  | 'INVALID_INPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'FTS5_UNAVAILABLE'
  | 'INDEX_NOT_READY'
  | 'INDEX_NOT_FOUND'
  | 'NO_RESULTS_FOUND'
  | 'NO_INDEX'
  | 'SCOPE_MISMATCH'
  | 'WORKSPACE_READ_FAILED'
  | 'DECODE_FAILED'
  | 'CAPACITY_EXCEEDED'
  | 'BUILD_FAILED'
  | 'CLEANUP_FAILED'
  | 'TIMEOUT'
  | 'CANCELED'
  | 'INVALID_PROVIDER_RESULT'
  | 'EXECUTION_FAILED';

export interface RagKnowledgeScope {
  readonly scopeKind: 'AGENT_WORKSPACE';
  readonly logicalRoot: 'workspace';
}

export interface RagRetrievalOptions {
  readonly topK: number;
}

export interface RagRetrievalRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly knowledgeScope: RagKnowledgeScope;
  readonly query: string;
  readonly indexes: readonly string[];
  readonly options: RagRetrievalOptions;
}

export interface RagRetrievalDiagnostics {
  readonly reason: RagRetrievalReason;
}

export interface RagRetrievalChunk {
  readonly content: string;
  readonly source: string;
  readonly title?: string;
  readonly score?: number;
  readonly rankHint?: string;
}

export interface RagRetrievalResult {
  readonly status: RagRetrievalStatus;
  readonly results: readonly RagRetrievalChunk[];
  readonly diagnostics?: RagRetrievalDiagnostics;
}

export interface RagRetrievalGateway {
  retrieve: (request: RagRetrievalRequest, signal?: AbortSignal) => Promise<RagRetrievalResult>;
}

const ragSafeProviderReferencePattern = '^(?!/)(?!.*\\\\)(?![A-Za-z]:)(?!.*://)(?!.*(?:^|/)\\.\\.?(?:/|$)).+$';

export const ragRetrievalRequestSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'subjectId', 'agentId', 'agentVersion', 'knowledgeScope', 'query', 'indexes', 'options'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    subjectId: { type: 'string', minLength: 1 },
    agentId: { type: 'string', minLength: 1 },
    agentVersion: { type: 'string', minLength: 1 },
    knowledgeScope: {
      type: 'object',
      additionalProperties: false,
      required: ['scopeKind', 'logicalRoot'],
      properties: {
        scopeKind: { const: 'AGENT_WORKSPACE' },
        logicalRoot: { const: 'workspace' },
      },
    },
    query: { type: 'string', minLength: 1, maxLength: 256 },
    indexes: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      required: ['topK'],
      properties: {
        topK: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
};

export interface WorkflowRagRetrievalIndex {
  readonly indexName: string;
  readonly indexType: 'API' | 'RECIPE' | 'KNOWLEDGE';
  readonly domain?: string;
  readonly scene?: string;
  readonly priority?: number;
  readonly vsTopN?: number;
  readonly esTopN?: number;
  readonly filters?: JsonObject;
}

export interface WorkflowRagRetrievalRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly knowledgeScope: RagKnowledgeScope;
  readonly query: string;
  readonly indexes: readonly WorkflowRagRetrievalIndex[];
  readonly options: RagRetrievalOptions;
}

export interface WorkflowRagRetrievalGateway {
  retrieve: (request: WorkflowRagRetrievalRequest, signal?: AbortSignal) => Promise<WorkflowRagRetrievalResult>;
}

export interface WorkflowRagRetrievalResult {
  readonly status: RagRetrievalStatus;
  readonly query?: string;
  readonly additional?: readonly unknown[];
  readonly recommends: readonly JsonObject[];
  readonly textRecallResults?: unknown;
  readonly vectorRecallResults?: unknown;
  readonly diagnostics?: RagRetrievalDiagnostics;
}

export const workflowRagRetrievalRequestSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'subjectId', 'agentId', 'agentVersion', 'knowledgeScope', 'query', 'indexes', 'options'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    subjectId: { type: 'string', minLength: 1 },
    agentId: { type: 'string', minLength: 1 },
    agentVersion: { type: 'string', minLength: 1 },
    knowledgeScope: {
      type: 'object',
      additionalProperties: false,
      required: ['scopeKind', 'logicalRoot'],
      properties: {
        scopeKind: { const: 'AGENT_WORKSPACE' },
        logicalRoot: { const: 'workspace' },
      },
    },
    query: { type: 'string', minLength: 1, maxLength: 256 },
    indexes: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['indexName', 'indexType'],
        properties: {
          indexName: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
          indexType: { enum: ['API', 'RECIPE', 'KNOWLEDGE'] },
          domain: { type: 'string', minLength: 1, maxLength: 128 },
          scene: { type: 'string', minLength: 1, maxLength: 128 },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          vsTopN: { type: 'integer', minimum: 1, maximum: 20 },
          esTopN: { type: 'integer', minimum: 1, maximum: 20 },
          filters: { type: 'object' },
        },
      },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      required: ['topK'],
      properties: {
        topK: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
};

export const workflowRagRetrievalResultSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'recommends'],
  properties: {
    status: { enum: ['OK', 'NO_INDEX', 'UNAVAILABLE', 'DEGRADED', 'FAILED', 'TIMEOUT', 'CANCELED'] },
    query: { type: 'string', maxLength: 256 },
    additional: { type: 'array' },
    recommends: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
    textRecallResults: {},
    vectorRecallResults: {},
    diagnostics: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: {
        reason: {
          enum: [
            'INVALID_INPUT',
            'PROVIDER_UNAVAILABLE',
            'FTS5_UNAVAILABLE',
            'INDEX_NOT_READY',
            'INDEX_NOT_FOUND',
            'NO_RESULTS_FOUND',
            'NO_INDEX',
            'SCOPE_MISMATCH',
            'WORKSPACE_READ_FAILED',
            'DECODE_FAILED',
            'CAPACITY_EXCEEDED',
            'BUILD_FAILED',
            'CLEANUP_FAILED',
            'TIMEOUT',
            'CANCELED',
            'INVALID_PROVIDER_RESULT',
            'EXECUTION_FAILED',
          ],
        },
      },
    },
  },
};
export const ragRetrievalResultSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'results'],
  properties: {
    status: { enum: ['OK', 'NO_INDEX', 'UNAVAILABLE', 'DEGRADED', 'FAILED', 'TIMEOUT', 'CANCELED'] },
    results: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['content', 'source'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 12000 },
          source: { type: 'string', minLength: 1, maxLength: 512, pattern: ragSafeProviderReferencePattern },
          title: { type: 'string', minLength: 1, maxLength: 512 },
          score: { type: 'number', minimum: 0, maximum: 1 },
          rankHint: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
    diagnostics: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: {
        reason: {
          enum: [
            'INVALID_INPUT',
            'PROVIDER_UNAVAILABLE',
            'FTS5_UNAVAILABLE',
            'INDEX_NOT_READY',
            'INDEX_NOT_FOUND',
            'NO_RESULTS_FOUND',
            'NO_INDEX',
            'SCOPE_MISMATCH',
            'WORKSPACE_READ_FAILED',
            'DECODE_FAILED',
            'CAPACITY_EXCEEDED',
            'BUILD_FAILED',
            'CLEANUP_FAILED',
            'TIMEOUT',
            'CANCELED',
            'INVALID_PROVIDER_RESULT',
            'EXECUTION_FAILED',
          ],
        },
      },
    },
  },
};

export type ScheduledMaintenanceOverlapPolicy = 'SKIP';

export interface ScheduledMaintenanceJobResult {
  readonly status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  readonly safeReasonCode?: string;
  readonly cleanedCount?: number;
}

export interface ScheduledMaintenanceJob {
  readonly jobId: string;
  readonly cadenceMs: number;
  readonly retentionMs?: number;
  readonly overlapPolicy: ScheduledMaintenanceOverlapPolicy;
  run: (signal: AbortSignal, now: Date) => Promise<ScheduledMaintenanceJobResult>;
}

export interface ScheduledMaintenanceGatewayPort {
  register: (job: ScheduledMaintenanceJob) => void;
  start: () => void;
  stop: () => Promise<void>;
  runOnce: (jobId: string, signal?: AbortSignal, now?: Date) => Promise<ScheduledMaintenanceJobResult>;
}
