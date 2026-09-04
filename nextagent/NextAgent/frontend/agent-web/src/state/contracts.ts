export const TRANSPORT_KINDS = ['SSE', 'WEBSOCKET'] as const;
export type TransportKind = (typeof TRANSPORT_KINDS)[number];

export const TRANSPORT_STATUSES = ['IDLE', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'FAILED'] as const;
export type TransportStatus = (typeof TRANSPORT_STATUSES)[number];

export const DEPLOYMENT_MODES = ['LOCAL', 'REMOTE'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const INTERACTION_CHANNELS = ['WEB', 'TUI', 'IM'] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

export const REQUEST_LANGUAGES = ['ZH', 'EN', 'MIXED'] as const;
export type RequestLanguage = (typeof REQUEST_LANGUAGES)[number];

export const REQUEST_STATUSES = ['ACCEPTED', 'PLANNING', 'EXECUTING', 'DEGRADED', 'COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Matches backend RunStatus vocabulary. */
export const RUN_STATUSES = ['ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const SESSION_STATUSES = ['CREATED', 'READY', 'STREAMING', 'WAITING_FOR_INPUT', 'DEGRADED', 'INTERRUPTED', 'RESUMING', 'FAILED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTACHMENT_MEDIA_TYPES = [
  'WORD',
  'EXCEL',
  'PDF',
  'MARKDOWN',
  'PCAP',
  'PCAPNG',
  'CAP',
  'TMF',
  'PTMF',
  'ZIP',
  'TAR',
  'RAR',
  'GZ',
] as const;
export type AttachmentMediaType = (typeof ATTACHMENT_MEDIA_TYPES)[number];

export const STREAM_CONTENT_TYPES = ['PLAIN_TEXT', 'MARKDOWN', 'MERMAID'] as const;
export type StreamContentType = (typeof STREAM_CONTENT_TYPES)[number];

export const STREAM_EVENT_TYPES = [
  'REQUEST_ACCEPTED',
  'LLM_THINKING_DELTA',
  'LLM_CONTENT_DELTA',
  'CAPABILITY_STARTED',
  'CAPABILITY_RESULT_DELTA',
  'CAPABILITY_COMPLETED',
  'TOOL_STRUCTURED_DELTA',
  'USER_INPUT_REQUIRED',
  'USER_INPUT_RECEIVED',
  'USER_INPUT_TIMEOUT',
  'USER_INPUT_CANCELED',
  'ATTACHMENT_ACCEPTED',
  'ATTACHMENT_REJECTED',
  'DEGRADATION_NOTICE',
  'CONTEXT_COMPACTED',
  'HOOK_DEGRADED',
  'REQUEST_CANCELED',
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_SUPERSEDED',
  'BACKGROUND_TASK_STARTED',
  'BACKGROUND_TASK_COMPLETED',
  'BACKGROUND_TASK_FAILED',
  'OUTPUT_GUARD_BLOCKED',
] as const;
export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number];

export const REQUEST_CONTROL_ACTIONS = ['CANCEL_LATEST', 'RETRY_LATEST', 'EDIT_LATEST'] as const;
export type RequestControlAction = (typeof REQUEST_CONTROL_ACTIONS)[number];

/** Accepts the current frontend vocabulary plus NextAgent PendingInputKind values. */
export const USER_INPUT_KINDS = ['CLARIFICATION', 'CONFIRMATION', 'APPROVAL', 'SELECTION', 'QUESTION', 'AUTHORIZATION', 'HUMAN_HANDOFF'] as const;
export type UserInputKind = (typeof USER_INPUT_KINDS)[number];
export type QuestionAnswerKind = 'TEXT' | 'OPTION_SELECTION' | 'OPTION_ATTACHED_TEXT' | 'CUSTOM_TEXT' | 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT';

export interface UserInputOption {
  readonly id: string;
  readonly label: string;
  readonly requiresTextInput?: boolean;
  readonly inputPlaceholder?: string;
}

export interface UserInputQuestion {
  readonly prompt: string;
  readonly options?: readonly UserInputOption[];
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

export interface UserInputState {
  readonly inputRequestId: string;
  readonly inputKind: UserInputKind;
  readonly prompt: string;
  readonly options?: readonly UserInputOption[];
  readonly questions?: readonly UserInputQuestion[];
  readonly origin?: string | null;
  readonly originId?: string | null;
  readonly riskLevel?: string | null;
  readonly expiresAt?: WireTimestamp | null;
  readonly requestId: string;
  readonly status: 'pending' | 'submitting' | 'submitted' | 'timed_out' | 'canceled';
}

export interface UserInputResponse {
  readonly value: string;
  readonly inputRequestId: string;
}

export const AUTH_MODES = ['LOCAL_CONFIG', 'IAM'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type WireTimestamp = string | number;
export type StreamPayload = Record<string, JsonValue>;
export const CAPABILITY_STREAM_EVENT_TYPES = ['CAPABILITY_STARTED', 'CAPABILITY_RESULT_DELTA', 'CAPABILITY_COMPLETED'] as const;
export type CapabilityStreamEventType = (typeof CAPABILITY_STREAM_EVENT_TYPES)[number];
export type CapabilityStreamPayload = StreamPayload & { readonly toolCallId: string };

export const SESSION_MESSAGE_ROLES = ['USER', 'ASSISTANT', 'CAPABILITY_RESULT', 'SUMMARY'] as const;
export type SessionMessageRole = (typeof SESSION_MESSAGE_ROLES)[number];

export interface IdentityContext {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly displayName: string;
}

export interface AttachmentRef {
  readonly attachmentId: string;
  readonly fileName: string;
  readonly mediaType: AttachmentMediaType;
  readonly sizeBytes: number;
}

export interface SessionOpenRequest {
  readonly locale?: string;
  readonly idempotencyKey?: string;
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly displayTitle: string;
  readonly lastActivityAt: WireTimestamp;
}

export interface SessionState {
  readonly sessionId: string;
  readonly deploymentMode: DeploymentMode;
  readonly channel: InteractionChannel;
  readonly locale: string;
  readonly status: SessionStatus;
  readonly activeRequestId: string | null;
  readonly lastCompletedRequestId: string | null;
  readonly createdAt: WireTimestamp;
  readonly updatedAt: WireTimestamp;
}

export interface SessionHistoryEntry {
  readonly sessionId: string;
  readonly displayTitle: string;
  readonly lastActivityAt: WireTimestamp;
}

export interface SessionHistoryPage {
  readonly entries: readonly SessionHistoryEntry[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface SessionHistoryQuery {
  readonly offset: number;
  readonly limit: number;
  readonly q?: string;
  readonly createdFrom?: number;
  readonly createdTo?: number;
}

export interface SessionConversationQuery {
  readonly sessionId: string;
  readonly cursor: string | null;
  readonly newerCursor?: string | null;
  readonly anchorMessageId?: string | null;
  readonly limit: number;
  readonly includeCapabilityResults: boolean;
}

export interface ConversationPreviewMarker {
  readonly messageId: string;
  readonly requestId?: string;
  readonly createdAt: WireTimestamp;
  readonly previewText: string;
  readonly previewTruncated: boolean;
  readonly answerPreviewText?: string;
  readonly answerPreviewTruncated?: boolean;
}

export interface ConversationPreviewPage {
  readonly sessionId: string;
  readonly totalMarkers: number;
  readonly offset: number;
  readonly limit: number;
  readonly markers: readonly ConversationPreviewMarker[];
}

export interface PendingInputAnswerSafeResult {
  readonly kind: 'pendingInputAnswer';
  readonly answers: ReadonlyArray<readonly string[]>;
  readonly truncated: boolean;
}

export interface PendingInputAnswerProjection {
  readonly capabilityId: 'AskUserQuestion';
  readonly toolCallId: string;
  readonly pendingInputId: string;
  readonly kind: 'QUESTION';
  readonly status: 'RECEIVED';
  readonly safeSummary: string;
  readonly safeResult: PendingInputAnswerSafeResult;
}

export interface SessionConversationMessage {
  readonly messageId: string;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly runId?: string | null;
  readonly requestContextId?: string | null;
  /** References the root USER message that caused this output. Optional for backward compat. */
  readonly rootMessageId?: string;
  readonly role: SessionMessageRole;
  readonly sequence: number;
  readonly content: string;
  readonly contentType: StreamContentType;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly pendingInputAnswer?: PendingInputAnswerProjection;
  readonly attachments?: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>;
  readonly createdAt: WireTimestamp;
  readonly visible: boolean;
}

export interface ForkNotice {
  readonly sourceSessionId: string;
  readonly sourceSessionTitle: string;
}

export interface RuntimeActiveRunSummary {
  readonly requestId: string;
  readonly runId: string;
  readonly status: RunStatus;
}

export interface SessionConversationPage {
  readonly sessionId: string;
  readonly items: readonly SessionConversationMessage[];
  readonly nextCursor: string | null;
  readonly newerCursor?: string | null;
  readonly activeRun?: RuntimeActiveRunSummary | null;
  readonly forkNotice?: ForkNotice;
}

export type SessionRunEventHistoryPage =
  | {
      readonly availability: 'AVAILABLE';
      readonly events: readonly StreamEnvelope[];
      readonly nextAfterSequence?: number;
    }
  | {
      readonly availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE';
      readonly events: readonly [];
    };

export type RunProcessHistoryState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'QUEUED' }
  | { readonly status: 'LOADING'; readonly startedAt?: number }
  | {
      readonly status: 'AVAILABLE';
      readonly envelopes: readonly StreamEnvelope[];
      readonly lastAccessedAt?: number;
      readonly lastAccessSequence?: number;
    }
  | { readonly status: 'LEGACY_UNAVAILABLE' }
  | { readonly status: 'FAILED'; readonly errorCode: 'PROCESS_HISTORY_LOAD_FAILED' };

export const STREAM_RESUME_GAP_REASONS = [
  'ANCHOR_BEFORE_RECOVERABLE_WINDOW',
  'DELTA_STATE_NOT_RECOVERABLE',
  'TIMELINE_CONTINUITY_LOST',
  'SEQUENCE_GAP',
] as const;
export type StreamResumeGapReason = (typeof STREAM_RESUME_GAP_REASONS)[number];

export const STREAM_RESUME_FAILURE_REASONS = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'TIMELINE_READ_FAILED',
  'TIMELINE_READ_TIMEOUT',
  'PROJECTION_FAILED',
  'BACKPRESSURE_TIMEOUT',
  'TRANSPORT_CLOSED',
] as const;
export type StreamResumeFailureReason = (typeof STREAM_RESUME_FAILURE_REASONS)[number];

export interface StreamResumeGapNotice {
  readonly kind: 'STREAM_RESUME_GAP';
  readonly reason: StreamResumeGapReason;
  readonly retryable: true;
  readonly refreshConversation: true;
  readonly resumeAfterSequence: number;
}

export interface StreamResumeFailureDetails {
  readonly kind: 'STREAM_RESUME_FAILURE';
  readonly reason: StreamResumeFailureReason;
  readonly retryable: boolean;
  readonly refreshConversation: boolean;
  readonly resumeAfterSequence: number | null;
}

export type StreamResumeRecoveryDetails = StreamResumeGapNotice | StreamResumeFailureDetails;

export interface RequestState {
  readonly requestId: string;
  readonly sessionId: string;
  readonly inputText: string;
  readonly language: RequestLanguage;
  readonly attachments: readonly AttachmentRef[];
  readonly requestedAt: string;
  readonly status: RequestStatus;
  readonly activeRequestContextId: string | null;
  readonly latestAgentResponseId: string | null;
  readonly supersededByRequestId: string | null;
  readonly isLatestVisibleVersion: boolean;
}

export interface UserRequestEnvelope {
  readonly requestId: string;
  readonly sessionId: string;
  readonly inputText: string;
  readonly language: RequestLanguage;
  readonly attachments: readonly AttachmentRef[];
  readonly submittedAt: string;
  readonly locale: string;
  readonly idempotencyKey: string;
}

export interface RequestAccepted {
  readonly sessionId: string;
  readonly requestId: string;
  readonly runId: string;
  readonly attempt: number;
}

export interface SkillCatalogSummaryEntry {
  readonly capabilityId: string;
  readonly displayName: string;
  readonly description: string;
  readonly providerKind: string;
  readonly version?: string;
  readonly sourceMetadata?: Readonly<Record<string, string | readonly string[]>>;
}

export interface SkillCatalogQueryResult {
  readonly total: number;
  readonly pageNum: number;
  readonly pageSize: number;
  readonly skills: readonly SkillCatalogSummaryEntry[];
}

export interface RequestControlCommand {
  readonly sessionId: string;
  readonly expectedLatestRequestId: string;
  readonly action: RequestControlAction;
  readonly idempotencyKey: string;
}

export interface RequestControlAccepted {
  readonly sessionId: string;
  readonly targetRequestId: string;
  readonly action: Extract<RequestControlAction, 'CANCEL_LATEST'>;
  readonly idempotencyKey: string;
}

export interface EditLatestRequestCommand {
  readonly sessionId: string;
  readonly expectedLatestRequestId: string;
  readonly editedInputText: string;
  readonly attachments: readonly AttachmentRef[];
  readonly idempotencyKey: string;
}

interface StreamEnvelopeBase {
  readonly eventId: string;
  readonly sessionId: string;
  /** Legacy stream identity kept for backward compatibility with older mocks. */
  readonly requestId: string;
  readonly runId?: string | null;
  readonly rootMessageId?: string | null;
  readonly requestContextId?: string | null;
  readonly sequence: number;
  readonly eventType: StreamEventType;
  readonly timelineEventRef: string | null;
  readonly transportHints: readonly string[];
  readonly payload: StreamPayload;
  readonly createdAt: WireTimestamp;
}
export type CapabilityStreamEnvelope = StreamEnvelopeBase & {
  readonly eventType: CapabilityStreamEventType;
  readonly payload: CapabilityStreamPayload;
};
export type NonCapabilityStreamEnvelope = StreamEnvelopeBase & {
  readonly eventType: Exclude<StreamEventType, CapabilityStreamEventType>;
  readonly payload: StreamPayload;
};
export type StreamEnvelope = CapabilityStreamEnvelope | NonCapabilityStreamEnvelope;

export interface ReplayCursor {
  readonly handle: SessionHandle;
  readonly lastSeenSequence: number;
  readonly envelopes: readonly StreamEnvelope[];
  readonly terminalIncluded: boolean;
}

export interface TransportState {
  readonly kind: TransportKind;
  readonly status: TransportStatus;
  readonly streamPath?: string;
  readonly websocketPath?: string;
  readonly lastSeenSequence: number;
  readonly lastError?: string;
  readonly connectedAt?: string;
  readonly disconnectedAt?: string;
}

export interface ChatStateSnapshot {
  readonly activeSessionId: string | null;
  readonly sessions: readonly SessionHistoryEntry[];
  readonly requestsById: Readonly<Record<string, RequestState>>;
  readonly streamByRequestId: Readonly<Record<string, readonly StreamEnvelope[]>>;
  readonly transport: TransportState;
}

const TERMINAL_STREAM_EVENTS = new Set<StreamEventType>([
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);

export function isTerminalStreamEvent(eventType: StreamEventType): boolean {
  return TERMINAL_STREAM_EVENTS.has(eventType);
}

export interface SyntheticUserMessage {
  readonly messageId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly createdAt: WireTimestamp;
  readonly visible: true;
  readonly targetSkill?: string;
  readonly attachments?: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>;
}

export interface TurnBlock {
  readonly rootMessageId: string;
  readonly displayRunId?: string;
  readonly userMessage: SessionConversationMessage | SyntheticUserMessage;
  readonly aiEvents: readonly StreamEnvelope[];
  readonly assistantAnchorMessageId?: string;
  readonly status: RunStatus;
  readonly isLatest: boolean;
  readonly forkInherited?: boolean;
}

export type SharedConversationErrorKind = 'EXPIRED' | 'FORBIDDEN' | 'CONTENT_DELETED' | 'NOT_FOUND' | 'ERROR';

export interface SharedConversationError {
  readonly kind: SharedConversationErrorKind;
}

export interface CategoryQuestionEntry {
  readonly text: string;
  readonly fixed: boolean;
}

export interface CategoryL2 {
  readonly name: string;
  readonly questions: readonly CategoryQuestionEntry[];
}

export interface CategoryL1 {
  readonly name: string;
  readonly hasSubCategories: boolean;
  readonly questions?: readonly CategoryQuestionEntry[];
  readonly subCategories?: readonly CategoryL2[];
}

export const TOOL_EVENT_TYPES: readonly string[] = [
  'TITLE',
  'DETAIL',
  'ANSWER',
  'SUB_TITLE',
  'SUB_DETAIL',
  'SUB_CONCLUSION',
  'EXPAND_PANEL',
] as const;
export const TOOL_MESSAGE_TYPES: readonly string[] = ['PIU', 'DSL', 'STREAM_DSL', 'ACTION', 'OPERATOR', 'FILE', 'TEXT'] as const;

export interface CategoryQuestionResult {
  readonly locale: string;
  readonly categories: readonly CategoryL1[];
}

export type BackgroundTaskStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'KILLED';

export interface BackgroundTaskView {
  readonly taskId: string;
  readonly commandName: string;
  readonly commandLine?: string;
  readonly status: BackgroundTaskStatus;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly exitCode?: number;
  readonly stdoutRef: string;
  readonly stderrRef: string;
}

export interface BackgroundTaskOutputResponse {
  readonly content: string;
  readonly truncated: boolean;
  readonly stream: 'stdout' | 'stderr';
}

export type BackgroundTaskKillStatus = 'KILLED' | 'NOT_FOUND' | 'ALREADY_TERMINAL';

export interface BackgroundTaskKillResponse {
  readonly status: BackgroundTaskKillStatus;
}

// ── Long-term memory V2 API types ──────────────────────────────

export const MEMORY_TYPES = ['FACTUAL', 'CONCEPTUAL', 'PROCEDURAL', 'USER_CHARACTERISTICS'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const KNOWLEDGE_SOURCE_TYPES = ['LEARNED', 'CONFIGURED', 'SYSTEM_DEFAULT'] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const SHARING_STATES = ['PRIVATE', 'SHARED', 'FORK'] as const;
export type SharingState = (typeof SHARING_STATES)[number];

export const MEMORY_STATES = ['ACTIVE', 'ARCHIVED'] as const;
export type MemoryState = (typeof MEMORY_STATES)[number];

export const LTM_ERROR_CODES = [
  'LTM_QUERY_INVALID',
  'LTM_WRITE_INVALID',
  'LTM_TRANSITION_INVALID',
  'LTM_CONFIDENCE_INVALID',
  'LTM_MEMORY_NOT_FOUND',
  'LTM_STORAGE_UNAVAILABLE',
] as const;
export type LtmErrorCode = (typeof LTM_ERROR_CODES)[number];

export interface MemoryOwnerScope {
  readonly memoryInstance: string;
}

export interface LongTermMemoryRecord {
  readonly memoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly memoryInstance: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly sharingState: SharingState;
  readonly sourceMemoryId?: string;
  readonly state: MemoryState;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels: readonly string[];
  readonly confidence: number;
  readonly version: number;
  readonly accessCount: number;
  readonly recallCount: number;
  readonly extractionCount: number;
  readonly lastAccessedAt?: number;
  readonly archivedAt: number;
  readonly archiveReason: string;
  readonly source: string;
  readonly createTime: number;
  readonly updateTime: number;
  readonly isPinned: boolean;
}

export interface LongTermMemorySummary {
  readonly memoryId: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly state: MemoryState;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels: readonly string[];
  readonly confidence: number;
  readonly isPinned: boolean;
  readonly accessCount: number;
  readonly createTime: number;
  readonly updateTime: number;
  readonly version: number;
}

export interface SharedMemorySummary extends LongTermMemorySummary {
  readonly sourceMemoryId: string;
  readonly ownerUserId: string;
  readonly ownerUserName?: string;
}

export interface LongTermMemorySummaryPage {
  readonly items: readonly LongTermMemorySummary[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface SharedMemorySummaryPage {
  readonly items: readonly SharedMemorySummary[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface VersionedUpdateResult {
  readonly memoryId: string;
  readonly currentVersion: number;
  readonly record: LongTermMemoryRecord;
}

export interface ManualSaveLongTermMemoryReq {
  readonly memoryId?: string;
  readonly memoryInstance?: string;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence: number;
}

export interface BatchCreateLongTermMemoryItem {
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels?: readonly string[];
  readonly confidence?: number;
  readonly idempotencyKey?: string;
  readonly state?: MemoryState;
  readonly archiveReason?: string;
}

export interface BatchCreateLongTermMemoryReq {
  readonly memoryInstance?: string;
  readonly items: readonly BatchCreateLongTermMemoryItem[];
}

export interface BatchCreateLongTermMemoryResult {
  readonly successCount: number;
  readonly failCount: number;
  readonly memoryIds: readonly string[];
}

export interface PatchLongTermMemoryReq {
  readonly memoryInstance?: string;
  readonly expectedVersion?: number;
  readonly targetState?: MemoryState;
  readonly archiveReason?: string;
  readonly delta?: number;
  readonly lastAccessTime?: number;
  readonly isPinned?: boolean;
}

export interface SharingLongTermMemoryReq {
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface CopyLongTermMemoryReq {
  readonly memoryIds: readonly string[];
  readonly memoryInstance?: string;
  readonly reasonCode?: string;
}

export interface CopyPublishedMemoryResult {
  readonly memoryId: string;
  readonly record: LongTermMemoryRecord;
  readonly sourceMemoryId: string;
  readonly copyStatus: 'COPIED' | 'EXISTING';
}

export type CopyPublishedMemoryResp = readonly CopyPublishedMemoryResult[];

export interface DeleteLongTermMemoryResp {
  readonly memoryId: string;
}

export interface PublishLongTermMemoryResp {
  readonly publishedMemory: LongTermMemoryRecord;
  readonly sourceMemoryId: string;
  readonly ownerUserId: string;
}

export interface UnpublishLongTermMemoryResp {
  readonly memoryId: string;
}

export interface ListLongTermMemoryParams extends MemoryOwnerScope {
  readonly queryText?: string;
  readonly memoryType?: MemoryType;
  readonly knowledgeSourceType?: KnowledgeSourceType;
  readonly state?: MemoryState;
  readonly isPinned?: boolean;
  readonly sinceTime?: number;
  readonly untilTime?: number;
  readonly maxLastAccessedAt?: number;
  readonly labels?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListSharedMemoryParams {
  readonly memoryInstance?: string;
  readonly queryText?: string;
  readonly memoryType?: MemoryType;
  readonly knowledgeSourceType?: KnowledgeSourceType;
  readonly labels?: string;
  readonly limit?: number;
  readonly offset?: number;
}
