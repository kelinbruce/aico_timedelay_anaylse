import type {
  AgentId,
  EpochMillis,
  IdempotencyKey,
  IdentityContext,
  JsonObject,
  KnowledgeSourceType,
  LongTermMemoryId,
  LongTermMemoryState,
  MemoryType,
  MessageId,
  RequestContextId,
  RequestRunId,
  RunStatus,
  SafeError,
  SessionId,
  SharingState,
  SubjectId,
  TerminalCommitState,
  TimelineSequence,
} from '@nextagent/agent-common';

export type StreamEventType =
  | 'REQUEST_ACCEPTED'
  | 'LLM_THINKING_DELTA'
  | 'LLM_CONTENT_DELTA'
  | 'CAPABILITY_STARTED'
  | 'CAPABILITY_RESULT_DELTA'
  | 'CAPABILITY_COMPLETED'
  | 'TOOL_STRUCTURED_DELTA'
  | 'DEGRADATION_NOTICE'
  | 'REQUEST_COMPLETED'
  | 'REQUEST_FAILED'
  | 'REQUEST_CANCELED'
  | 'REQUEST_SUPERSEDED'
  | 'USER_INPUT_REQUIRED'
  | 'USER_INPUT_RECEIVED'
  | 'USER_INPUT_TIMEOUT'
  | 'USER_INPUT_CANCELED'
  | 'ATTACHMENT_ACCEPTED'
  | 'ATTACHMENT_REJECTED'
  | 'CONTEXT_COMPACTED'
  | 'BACKGROUND_TASK_STARTED'
  | 'BACKGROUND_TASK_COMPLETED'
  | 'BACKGROUND_TASK_FAILED'
  | 'OUTPUT_GUARD_BLOCKED';

export interface StreamEnvelope {
  readonly eventId: string;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly requestContextId?: RequestContextId;
  readonly sequence: TimelineSequence;
  readonly eventType: StreamEventType;
  readonly timelineEventRef?: string;
  readonly transportHints: readonly string[];
  readonly payload: JsonObject;
  readonly createdAt: EpochMillis;
}

export interface LongTermMemoryManagementScope {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
}

export interface LongTermMemoryManagementWriteOptions {
  readonly idempotencyKey?: IdempotencyKey;
  readonly expectedVersion?: number;
  readonly idempotencySemantic?: string;
}

export interface SaveLongTermMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryId?: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence: number;
  readonly source: string;
  readonly writeOptions?: LongTermMemoryManagementWriteOptions;
}

export interface BatchCreateLongTermMemoryManagementItem {
  readonly memoryId?: LongTermMemoryId;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence?: number;
  readonly source?: string;
  readonly idempotencyKey?: IdempotencyKey;
  readonly state?: LongTermMemoryState;
  readonly archiveReason?: string;
}

export interface BatchCreateLongTermMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryInstance?: string;
  readonly items: readonly BatchCreateLongTermMemoryManagementItem[];
}

export interface BatchCreateLongTermMemoryManagementResult {
  readonly successCount: number;
  readonly failCount: number;
  readonly memoryIds: readonly LongTermMemoryId[];
}

export interface ManualSaveLongTermMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryId?: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence: number;
}

export interface GetLongTermMemoryManagementQuery extends LongTermMemoryManagementScope {
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
}

export interface ListLongTermMemoryManagementQuery extends LongTermMemoryManagementScope {
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

export interface DeleteLongTermMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface MutateLongTermMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly targetState?: LongTermMemoryState;
  readonly archiveReason?: string;
  readonly delta?: number;
  readonly lastAccessTime?: EpochMillis;
  readonly isPinned?: boolean;
  readonly writeOptions?: Pick<LongTermMemoryManagementWriteOptions, 'expectedVersion'>;
}

export interface SearchLongTermMemoryManagementQuery extends LongTermMemoryManagementScope {
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

export interface GetLongTermMemoryDetailManagementQuery extends LongTermMemoryManagementScope {
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
}

interface SharingLongTermMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryId: LongTermMemoryId;
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface PublishLongTermMemoryManagementCommand extends SharingLongTermMemoryManagementCommand {}

export interface UnpublishLongTermMemoryManagementCommand extends SharingLongTermMemoryManagementCommand {}

export interface ListPublishedLongTermMemoryManagementQuery extends LongTermMemoryManagementScope {
  readonly memoryInstance?: string;
  readonly queryText?: string;
  readonly memoryType?: MemoryType;
  readonly knowledgeSourceType?: KnowledgeSourceType;
  readonly labels?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CopyPublishedMemoryManagementCommand extends LongTermMemoryManagementScope {
  readonly memoryIds: readonly LongTermMemoryId[];
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface LongTermMemoryManagementView {
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

export interface LongTermMemorySummaryManagementView {
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

export interface LongTermMemoryManagementPage {
  readonly items: readonly LongTermMemorySummaryManagementView[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface DeleteLongTermMemoryManagementResult {
  readonly memoryId: LongTermMemoryId;
}

export type LongTermMemoryMutationManagementStatus = 'UPDATED' | 'VERSION_CONFLICT' | 'NOT_FOUND';

export interface LongTermMemoryMutationManagementResult {
  readonly status: LongTermMemoryMutationManagementStatus;
  readonly memoryId?: LongTermMemoryId;
  readonly currentVersion?: number;
  readonly record?: LongTermMemoryManagementView;
}

export interface LongTermMemorySearchManagementItem {
  readonly summary: LongTermMemorySummaryManagementView;
  readonly score: number;
  readonly relevanceScore: number;
}

export interface LongTermMemorySearchManagementPage {
  readonly items: readonly LongTermMemorySearchManagementItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface PublishLongTermMemoryManagementResult {
  readonly publishedMemory: LongTermMemoryManagementView;
  readonly sourceMemoryId: LongTermMemoryId;
  readonly ownerSubjectId: SubjectId;
}

export interface UnpublishLongTermMemoryManagementResult {
  readonly memoryId: LongTermMemoryId;
}

export interface PublishedLongTermMemoryManagementView extends LongTermMemorySummaryManagementView {
  readonly sourceMemoryId: LongTermMemoryId;
  readonly ownerSubjectId: SubjectId;
  readonly ownerUserName?: string;
}

export interface PublishedLongTermMemoryManagementPage {
  readonly items: readonly PublishedLongTermMemoryManagementView[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface CopiedPublishedMemoryManagementResult {
  readonly memoryId: LongTermMemoryId;
  readonly record: LongTermMemoryManagementView;
  readonly sourceMemoryId: LongTermMemoryId;
  readonly copyStatus: 'COPIED' | 'EXISTING';
}

export interface CopyPublishedMemoryManagementResult {
  readonly results: readonly CopiedPublishedMemoryManagementResult[];
}

export interface LongTermMemoryManagementPort {
  saveLongTermMemory: (command: SaveLongTermMemoryManagementCommand, signal?: AbortSignal) => Promise<LongTermMemoryManagementView | SafeError>;
  listLongTermMemory: (query: ListLongTermMemoryManagementQuery, signal?: AbortSignal) => Promise<LongTermMemoryManagementPage | SafeError>;
  batchCreateLongTermMemory: (
    command: BatchCreateLongTermMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<BatchCreateLongTermMemoryManagementResult | SafeError>;
  manualSaveLongTermMemory: (
    command: ManualSaveLongTermMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<LongTermMemoryManagementView | SafeError>;
  getLongTermMemory: (query: GetLongTermMemoryManagementQuery, signal?: AbortSignal) => Promise<LongTermMemoryManagementView | SafeError>;
  deleteLongTermMemory: (
    command: DeleteLongTermMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<DeleteLongTermMemoryManagementResult | SafeError>;
  mutateLongTermMemory: (
    command: MutateLongTermMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<LongTermMemoryMutationManagementResult | SafeError>;
  searchLongTermMemory: (query: SearchLongTermMemoryManagementQuery, signal?: AbortSignal) => Promise<LongTermMemorySearchManagementPage | SafeError>;
  getLongTermMemoryDetail: (query: GetLongTermMemoryDetailManagementQuery, signal?: AbortSignal) => Promise<LongTermMemoryManagementView | SafeError>;
  publishLongTermMemory: (
    command: PublishLongTermMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<PublishLongTermMemoryManagementResult | SafeError>;
  unpublishLongTermMemory: (
    command: UnpublishLongTermMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<UnpublishLongTermMemoryManagementResult | SafeError>;
  listPublishedLongTermMemory: (
    query: ListPublishedLongTermMemoryManagementQuery,
    signal?: AbortSignal,
  ) => Promise<PublishedLongTermMemoryManagementPage | SafeError>;
  copyPublishedMemory: (
    command: CopyPublishedMemoryManagementCommand,
    signal?: AbortSignal,
  ) => Promise<CopyPublishedMemoryManagementResult | SafeError>;
}

/**
 * Safe, channel-facing projection of a background task. Contains only fields
 * safe to expose over the web channel — no identity context, run/request ids,
 * or raw command line. The authoritative record lives in the gateway contract.
 */
export type BackgroundTaskViewStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'KILLED';

export interface BackgroundTaskView {
  readonly taskId: string;
  readonly commandName: string;
  readonly commandLine?: string;
  readonly status: BackgroundTaskViewStatus;
  readonly startedAt: EpochMillis;
  readonly finishedAt?: EpochMillis;
  readonly exitCode?: number;
  readonly stdoutRef: string;
  readonly stderrRef: string;
}

/**
 * Read-only port the web channel consumes to list background tasks for a
 * session, read their stdout/stderr output, and kill a running task.
 * Implementations live behind the sandbox boundary (e.g. local gateway
 * store + sandbox); the web channel must not depend on the gateway contract
 * directly.
 */
export interface BackgroundTaskViewPort {
  list: (sessionId: SessionId) => Promise<readonly BackgroundTaskView[]>;
  readOutput: (
    sessionId: SessionId,
    taskId: string,
    stream: 'stdout' | 'stderr',
    limitBytes: number,
  ) => Promise<{ readonly content: string; readonly truncated: boolean } | { readonly unavailable: true }>;
  kill: (sessionId: SessionId, taskId: string) => Promise<{ readonly status: 'KILLED' | 'NOT_FOUND' | 'ALREADY_TERMINAL' }>;
}

export type CronTaskManagementStatus = 'ACTIVE' | 'COMPLETED';
export type CronTaskTargetKind = 'SKILL' | 'WORKFLOW';

export interface CronTaskTargetView {
  readonly kind: CronTaskTargetKind;
  readonly name: string;
}

export interface CronTaskManagementScope {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
}

export interface CronTaskManagementView {
  readonly taskId: string;
  readonly cron: string;
  readonly humanSchedule: string;
  readonly prompt: string;
  readonly target?: CronTaskTargetView;
  readonly recurring: boolean;
  readonly status: CronTaskManagementStatus;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
  readonly nextRunAt: EpochMillis;
  readonly createdByName?: string;
}

export interface CronTaskManagementPage {
  readonly tasks: readonly CronTaskManagementView[];
  readonly total: number;
}

export interface CronTaskExecutionView {
  readonly triggerId: string;
  readonly taskId: string;
  readonly scheduledAt: EpochMillis;
  readonly triggerStatus: 'CLAIMED' | 'ACCEPTED';
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
  readonly sessionId?: SessionId;
  readonly requestRunId?: RequestRunId;
  readonly runStatus?: RunStatus;
  readonly terminalCommitState?: TerminalCommitState;
  readonly resultEventType?: 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED';
  readonly resultContent?: string;
  readonly resultAt?: EpochMillis;
}

export interface CronTaskExecutionPage {
  readonly executions: readonly CronTaskExecutionView[];
  readonly total: number;
}

export interface CreateCronTaskManagementCommand extends CronTaskManagementScope {
  readonly cron: string;
  readonly prompt: string;
  readonly target?: CronTaskTargetView;
  readonly recurring?: boolean;
}

export interface UpdateCronTaskManagementCommand extends CronTaskManagementScope {
  readonly taskId: string;
  readonly cron?: string;
  readonly prompt?: string;
  readonly target?: CronTaskTargetView | null;
  readonly recurring?: boolean;
}

export interface DeleteCronTaskManagementCommand extends CronTaskManagementScope {
  readonly taskId: string;
}

export interface ExecuteCronTaskManagementCommand extends CronTaskManagementScope {
  readonly taskId: string;
}

export interface ListCronTaskExecutionsQuery extends CronTaskManagementScope {
  readonly taskId: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ListCronTaskManagementQuery extends CronTaskManagementScope {
  readonly offset?: number;
  readonly limit?: number;
}

export interface CronTaskManagementPort {
  listCronTasks: (query: ListCronTaskManagementQuery, signal?: AbortSignal) => Promise<CronTaskManagementPage>;
  listCronTaskExecutions: (query: ListCronTaskExecutionsQuery, signal?: AbortSignal) => Promise<CronTaskExecutionPage>;
  createCronTask: (command: CreateCronTaskManagementCommand, signal?: AbortSignal) => Promise<CronTaskManagementView>;
  updateCronTask: (command: UpdateCronTaskManagementCommand, signal?: AbortSignal) => Promise<CronTaskManagementView>;
  deleteCronTask: (command: DeleteCronTaskManagementCommand, signal?: AbortSignal) => Promise<void>;
  executeCronTask: (command: ExecuteCronTaskManagementCommand, signal?: AbortSignal) => Promise<CronTaskExecutionView>;
}
