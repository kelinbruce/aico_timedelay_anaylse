import {
  AgentError,
  brand,
  getLogger,
  type AgentId,
  type BlobRef,
  type EpochMillis,
  type IdempotencyKey,
  type JsonObject,
  type KnowledgeSourceType,
  type LongTermMemoryId,
  type LongTermMemoryState,
  type MemoryType,
  type MessageId,
  type RunStatus,
  type SafeError,
  type SessionId,
  type SharingState,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type { RequestRunId } from '@nextagent/agent-common';
import type {
  BatchCreateLongTermMemoryRequest,
  BatchCreateLongTermMemoryResult,
  ActiveContextMetadataUpdateRequest,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  AppendActiveContextItemRequest,
  AttachmentIntakeReservationGateway,
  AttachmentIntakeReservationRecord,
  AttachmentIntakeReservationResult,
  AttachmentStoreGateway,
  BlobStoreGateway,
  BlobRecordPurpose,
  BlobMetadata,
  BlobMetadataRequest,
  CopyBlobRequest,
  CopyBlobResult,
  ListBlobsRequest,
  ListBlobsResult,
  CheckpointRecord,
  CheckpointStoreGateway,
  ClaimRunRequest,
  CompleteAttachmentIntakeReservationRequest,
  ContextCompactionCommitRequest,
  ConversationAnnotationRecord,
  ConversationAnnotationSentiment,
  ConversationAnnotationStoreGateway,
  ConversationFavoriteTurnSummary,
  ConversationPreviewRecordPage,
  ConversationPreviewRecordQuery,
  ConversationShareRecord,
  ConversationShareStoreGateway,
  UserQuestionActivityStoreGateway,
  UserQuestionActivityRecord,
  UserQuestionActivityHighFrequencyQuery,
  CopiedPublishedMemoryResult,
  CopyLongTermMemoryRequest,
  CopyPublishedMemoryResponse,
  CreatePendingInputRecordRequest,
  DeleteAnnotationsByRunRequest,
  DeleteBlobRequest,
  DeleteLongTermMemoryRequest,
  DeleteLongTermMemoryResult,
  DeleteSessionCascadeRequest,
  DeleteSessionCascadeResult,
  DeleteSharesBySessionRequest,
  ForkPromotionAbortRequest,
  ForkPromotionCleanupRequest,
  ForkPromotionCleanupResult,
  ForkPromotionContent,
  ForkPromotionRefType,
  ForkProcessSnapshotStatusRecord,
  ForkSnapshotRunTimelineEventRecord,
  GetLongTermMemoryDetailRequest,
  GetLongTermMemoryRequest,
  HasUserMessageAfterForkAnchorRequest,
  HideMessageRequest,
  HideRequestMessagesRequest,
  IdempotentWriteOptions,
  ListAttachmentsByRequestIdRequest,
  ListAttachmentsByRunIdRequest,
  ListAttachmentsBySessionRequest,
  ListCurrentRequestMessagesRecordQuery,
  AgentListUnresolvedPendingInputTimeoutFactsRequest,
  ListFavoriteTurnsQuery,
  ListLongTermMemoryQuery,
  ListPublishedLongTermMemoryQuery,
  ListQuestionFavoriteTurnsQuery,
  ListSessionAnnotationsQuery,
  ListSessionMessagesRecordQuery,
  ListTaskTrajectoriesQuery,
  ListTaskTrajectoryBuildCandidatesQuery,
  LoadActivePendingInputRecordRequest,
  LoadAttachmentRequest,
  LoadBlobRequest,
  LoadCheckpointRequest,
  LoadCommittedForkPromotionContentRequest,
  LoadForkProcessSnapshotStatusRequest,
  LoadPendingInputRecordRequest,
  LoadShareRequest,
  LoadSessionForkSourceRequest,
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemorySummary,
  LongTermMemorySummaryPage,
  LongTermMemoryVersionedUpdateResult,
  LongTermMemoryStoreGateway,
  ManualSaveLongTermMemoryRequest,
  MutateLongTermMemoryRequest,
  PendingInputRecord,
  PendingInputResolveResult,
  PendingInputStoreGateway,
  OwnerScoped,
  PublishLongTermMemoryResult,
  ReplaceTodoStateRequest,
  ReplaceTodoStateResult,
  RequestAttachmentRecord,
  ReserveAttachmentIntakeRequest,
  RequestRunIdempotencyLookupRequest,
  RequestRunIdempotencyLookupResult,
  RequestRunListQuery,
  RequestRunLookupRequest,
  RequestRunMemoryRecallAttemptClaimResult,
  RequestRunMemoryRecallAttemptLookupRequest,
  RequestRunMemoryRecallAttemptRecord,
  RequestRunRecord,
  RequestRunRecordPage,
  RequestRunStoreGateway,
  ResolvePendingInputRecordOptions,
  ResolvePendingInputRecordRequest,
  RunTimelineEventRecord,
  RunTimelineEventRecordQuery,
  RunTimelineEventStoreGateway,
  SaveLongTermMemoryRequest,
  SaveTaskTrajectoryRequest,
  SearchLongTermMemoryQuery,
  SearchItemPage,
  SessionForkSourceRecord,
  SessionHistoryPage,
  SessionHistoryRecordQuery,
  SessionLaneSnapshot,
  SessionLaneSnapshotQuery,
  SessionLookupRequest,
  SessionMessageLookupRequest,
  SessionMessageRecord,
  SessionMessageRecordPage,
  SessionMessageStoreGateway,
  SessionRecord,
  SessionStoreGateway,
  StageForkPromotionResult,
  StageForkPromotionRequest,
  StoreBlobRequest,
  AgentListRecoverableRunsRequest,
  TaskTrajectoryBuildCandidate,
  TaskTrajectoryBuildCandidateResult,
  TaskTrajectoryListResult,
  TaskTrajectoryQueryGateway,
  TaskTrajectoryRecord,
  TaskTrajectoryStoreGateway,
  TodoStateCurrentRecord,
  TodoStateItemRecord,
  TodoStateLookupRequest,
  TodoStateRevisionListRequest,
  TodoStateRevisionRecord,
  TerminalCommitRecordResult,
  TerminalCommitRequest,
  SharedMemorySummaryPage,
  SharingLongTermMemoryRequest,
  UnpublishLongTermMemoryResult,
  UpdateAttachmentStatusRequest,
  VersionedUpdateResult,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface SqliteGatewayStoresOptions {
  readonly sqliteFile: string;
  readonly schemaOwner?: 'all' | 'working-memory' | 'long-term-memory' | 'sqlite';
}

export type SqliteOwnedGatewayStoresOptions = Omit<SqliteGatewayStoresOptions, 'schemaOwner'>;

export interface LocalListSessionMessagePrefixThroughAnchorQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly anchorMessageId: MessageId;
}

export interface LocalLoadForkedSessionByIdempotencyRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface LocalListForkProcessSnapshotStatusesRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export type LocalForkRunTimelineEventSnapshotDraft = Omit<ForkSnapshotRunTimelineEventRecord, 'sequence'>;

export interface LocalForkSessionMaterializationRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: string;
  readonly childSession: SessionRecord;
  readonly copiedMessages: readonly SessionMessageRecord[];
  readonly activeContextMessageIds: readonly MessageId[];
  readonly copiedTimelineEvents: readonly LocalForkRunTimelineEventSnapshotDraft[];
  readonly copiedRunProcessStatuses: readonly ForkProcessSnapshotStatusRecord[];
  readonly promotionBindings: readonly LocalForkPromotionBinding[];
  readonly forkSource: SessionForkSourceRecord;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface LocalForkPromotionBinding {
  readonly sourceMessageId: MessageId;
  readonly sourceRefId: string;
  readonly childMessageId: MessageId;
  readonly promotedContentId: string;
}

export interface LocalForkSessionMaterializationResult {
  readonly childSession: SessionRecord;
  readonly replayed: boolean;
}

export interface LocalForkPromotedContentRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: string;
  readonly promotedContentId: string;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId: MessageId;
  readonly sourceRefId: string;
  readonly childSessionId?: SessionId;
  readonly childMessageId?: MessageId;
  readonly refType: ForkPromotionRefType;
  readonly blobRef: BlobRef;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: 'STAGED' | 'COMMITTED' | 'ABORTED';
  readonly createdAt: EpochMillis;
  readonly committedAt?: EpochMillis;
  readonly abortedAt?: EpochMillis;
}

const CONVERSATION_PREVIEW_MAX_PAGE_LIMIT = 100;
const CONVERSATION_PREVIEW_MAX_OFFSET = 10000;
const CONVERSATION_PREVIEW_TEXT_LIMIT = 300;
const MAX_FAVORITES_PER_USER_SCOPE = 100;
const REQUEST_RUN_MAX_PAGE_LIMIT = 100;
const logger = getLogger({ component: 'agent-platform-gateway-local', source: 'sqlite-gateway' });

interface JsonRow {
  readonly json: string;
}

interface RunJsonRow extends JsonRow {
  readonly idempotency_key: string | null;
  readonly idempotency_semantic?: string | null;
}

interface ConversationAnnotationRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly annotation_id: string;
  readonly session_id: string;
  readonly request_run_id: string;
  readonly sentiment: string | null;
  readonly is_favorited: number;
  readonly question_favorite: number;
  readonly comment: string | null;
  readonly idempotency_key: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface ConversationShareRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly share_id: string;
  readonly session_id: string;
  readonly run_ids: string;
  readonly origin_url: string;
  readonly allowed_ops: string | null;
  readonly expires_at: number | null;
  readonly idempotency_key: string | null;
  readonly created_at: number;
}
interface ActiveContextStateRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly active_context_version: number;
  readonly updated_at: number;
  readonly metadata: string | null;
}

interface CheckpointRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly checkpoint_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly run_id: string;
  readonly request_context_id: string;
  readonly run_version: number;
  readonly agent_turn_index: number;
  readonly trigger_reason: string;
  readonly last_sequence: number;
  readonly active_context_version: number;
  readonly flow_variables: string;
  readonly saved_at: number;
  readonly idempotency_key: string;
}

interface SessionRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly parent_session_id: string | null;
  readonly parent_run_id: string | null;
  readonly parent_request_id: string | null;
  readonly title: string | null;
  readonly title_source: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly idempotency_key: string | null;
}

interface MessageRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly message_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly run_id: string | null;
  readonly role: string;
  readonly content: string;
  readonly content_type: string;
  readonly metadata: string;
  readonly visible: number;
  readonly created_at: number;
  readonly idempotency_key: string | null;
}

interface SessionForkRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly child_session_id: string;
  readonly source_session_id: string;
  readonly source_anchor_message_id: string;
  readonly child_anchor_message_id: string;
  readonly source_session_title_snapshot: string;
  readonly created_at: number;
}

interface SessionForkIdempotencyRow {
  readonly child_session_id: string;
}

interface ForkProcessSnapshotStatusRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly run_id: string;
  readonly status: 'AVAILABLE' | 'LEGACY_UNAVAILABLE';
}

interface ForkPromotedContentRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly fork_attempt_id: string;
  readonly promoted_content_id: string;
  readonly source_session_id: string;
  readonly source_message_id: string;
  readonly source_ref_id: string;
  readonly child_session_id: string;
  readonly child_message_id: string;
  readonly ref_type: string;
  readonly blob_ref: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly content_digest: string;
  readonly status: string;
  readonly created_at: number;
  readonly committed_at: number | null;
  readonly aborted_at: number | null;
}

interface AttachmentRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly attachment_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly run_id: string | null;
  readonly file_name: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly storage_ref: string;
  readonly validation_status: string;
  readonly availability_status: string;
  readonly created_at: number;
}

interface BlobRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly blob_ref: string;
  readonly purpose: string;
  readonly bytes: Uint8Array;
  readonly idempotency_key: string;
  readonly created_at: number;
}

interface AttachmentIntakeReservationRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly reservation_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly run_id: string;
  readonly request_context_id: string;
  readonly idempotency_key: string;
  readonly action: string;
  readonly command_semantic_hash: string;
  readonly status: string;
  readonly attachment_ids: string;
  readonly rejection_reason_code: string | null;
  readonly safe_error: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface PendingInputRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly pending_input_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly request_run_id: string;
  readonly request_context_id: string;
  readonly checkpoint_id: string;
  readonly kind: string;
  readonly request: string;
  readonly producer_ref: string;
  readonly timeout_at: number | null;
  readonly status: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly authorization_scope: string | null;
  readonly response_answers: string | null;
  readonly resolve_idempotency_key: string | null;
  readonly resolve_idempotency_semantic: string | null;
}

interface LongTermMemoryRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly memory_instance: string;
  readonly long_term_memory_id: string;
  readonly version: number;
  readonly category: string;
  readonly knowledge_source_type: string;
  readonly sharing_state: string;
  readonly source_memory_id: string | null;
  readonly confidence: number;
  readonly state: string;
  readonly brief_index: string;
  readonly tags_json: string;
  readonly access_count: number;
  readonly recall_count: number;
  readonly extraction_count: number;
  readonly last_accessed_at: number | null;
  readonly archived_at: number | null;
  readonly archive_reason: string | null;
  readonly is_pinned: number;
  readonly source_trace_session_id: string;
  readonly source_trace_request_id: string | null;
  readonly source_trace_extraction_cycle_id: string | null;
  readonly source_trace_json: string;
  readonly content_json: string;
  readonly idempotency_key: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface CanonicalSaveLongTermMemoryRequest extends SaveLongTermMemoryRequest {
  readonly memoryInstance: string;
  readonly state?: LongTermMemoryState;
  readonly archiveReason?: string;
}

interface TaskTrajectoryRow extends JsonRow {
  readonly agent_id: string;
  readonly task_trajectory_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly request_run_id: string;
  readonly task_kind: string;
  readonly trajectory_build_status: string;
  readonly task_outcome_status: string;
  readonly outcome_evidence_level: string;
  readonly started_at: number;
  readonly completed_at: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly idempotency_key: string | null;
}

interface TodoStateRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly revision_seq: number;
  readonly todos_json: string;
  readonly updated_at: number;
}

interface TodoStateRevisionRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly revision_seq: number;
  readonly request_id: string;
  readonly request_run_id: string;
  readonly request_context_id: string;
  readonly tool_call_id: string | null;
  readonly todos_json: string;
  readonly created_at: number;
}

function nowEpoch(): EpochMillis {
  return brand<number, 'EpochMillis'>(Date.now());
}

interface UserQuestionActivityRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly question_hash: string;
  readonly question_text: string;
  readonly locale: string;
  readonly is_pinned: number;
  readonly pinned_at: number | null;
  readonly ask_frequency: number;
  readonly last_asked_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

function parseJsonRow<TRecord>(row?: JsonRow): TRecord | undefined {
  return row === undefined ? undefined : (JSON.parse(row.json) as TRecord);
}

function toCheckpointRecord(row: CheckpointRow): CheckpointRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    checkpointId: brand<string, 'CheckpointId'>(row.checkpoint_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestId: brand<string, 'MessageId'>(row.request_id),
    runId: brand<string, 'RequestRunId'>(row.run_id),
    requestContextId: brand<string, 'RequestContextId'>(row.request_context_id),
    runVersion: row.run_version,
    agentTurnIndex: row.agent_turn_index,
    triggerReason: row.trigger_reason as CheckpointRecord['triggerReason'],
    lastSequence: brand<number, 'TimelineSequence'>(row.last_sequence),
    activeContextVersion: row.active_context_version,
    flowVariables: JSON.parse(row.flow_variables) as JsonObject,
    savedAt: brand<number, 'EpochMillis'>(row.saved_at),
  };
}

function toConversationAnnotationRecord(row: ConversationAnnotationRow): ConversationAnnotationRecord {
  const sentiment = row.sentiment === 'UP' || row.sentiment === 'DOWN' ? row.sentiment : null;
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    annotationId: row.annotation_id,
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestRunId: brand<string, 'RequestRunId'>(row.request_run_id),
    sentiment: sentiment as ConversationAnnotationSentiment | null,
    isFavorited: row.is_favorited === 1,
    isQuestionFavorited: row.question_favorite === 1,
    comment: row.comment,
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
  };
}

function annotationSafeError(code: string, category: SafeError['category'], message: string, retryable = false): SafeError {
  return { code, message, category, retryable };
}

function toConversationShareRecord(row: ConversationShareRow): ConversationShareRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    shareId: row.share_id,
    sessionId: brand<string, 'SessionId'>(row.session_id),
    runIds: JSON.parse(row.run_ids) as readonly RequestRunId[],
    originUrl: row.origin_url,
    allowedOps: row.allowed_ops === null ? null : (JSON.parse(row.allowed_ops) as readonly string[]),
    expiresAt: row.expires_at === null ? null : brand<number, 'EpochMillis'>(row.expires_at),
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
  };
}

function shareSafeError(code: string, category: SafeError['category'], message: string, retryable = false): SafeError {
  return { code, message, category, retryable };
}

function toTodoStateCurrentRecord(row: TodoStateRow): TodoStateCurrentRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    revisionSeq: row.revision_seq,
    todos: JSON.parse(row.todos_json) as readonly TodoStateItemRecord[],
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
  };
}

function toTodoStateRevisionRecord(row: TodoStateRevisionRow): TodoStateRevisionRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    revisionSeq: row.revision_seq,
    requestId: brand<string, 'MessageId'>(row.request_id),
    requestRunId: brand<string, 'RequestRunId'>(row.request_run_id),
    requestContextId: brand<string, 'RequestContextId'>(row.request_context_id),
    ...(row.tool_call_id === null ? {} : { toolCallId: brand<string, 'ToolCallId'>(row.tool_call_id) }),
    todos: JSON.parse(row.todos_json) as readonly TodoStateItemRecord[],
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
  };
}

function copyTodoStateItem(item: TodoStateItemRecord): TodoStateItemRecord {
  return {
    content: item.content,
    activeForm: item.activeForm,
    status: item.status,
  };
}

function todoStateDurationBucket(durationMs: number): string {
  if (durationMs < 10) {
    return 'lt_10ms';
  }
  if (durationMs < 100) {
    return 'lt_100ms';
  }
  if (durationMs < 1000) {
    return 'lt_1s';
  }
  return 'gte_1s';
}

function toSessionRecord(row: SessionRow): SessionRecord {
  const result: Record<string, unknown> = {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    ...(row.parent_session_id === null ? {} : { parentSessionId: brand<string, 'SessionId'>(row.parent_session_id) }),
    ...(row.parent_run_id === null ? {} : { parentRunId: brand<string, 'RequestRunId'>(row.parent_run_id) }),
    ...(row.parent_request_id === null ? {} : { parentRequestId: brand<string, 'MessageId'>(row.parent_request_id) }),
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
  };
  if (row.title !== null) {
    result.title = row.title;
  }
  if (row.title_source === 'automatic' || row.title_source === 'manual') {
    result.titleSource = row.title_source;
  } else if (row.title_source !== null) {
    // Unknown title_source value from DB — silently ignore but preserve other data
  }
  return result as unknown as SessionRecord;
}

function toSessionMessageRecord(row: MessageRow): SessionMessageRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    messageId: brand<string, 'MessageId'>(row.message_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestId: brand<string, 'MessageId'>(row.request_id),
    ...(row.run_id === null ? {} : { runId: brand<string, 'RequestRunId'>(row.run_id) }),
    role: row.role as SessionMessageRecord['role'],
    content: row.content,
    contentType: row.content_type as SessionMessageRecord['contentType'],
    metadata: JSON.parse(row.metadata) as JsonObject,
    visible: row.visible === 1,
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
  };
}

function toSessionForkSourceRecord(row: SessionForkRow): SessionForkSourceRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    childSessionId: brand<string, 'SessionId'>(row.child_session_id),
    sourceSessionId: brand<string, 'SessionId'>(row.source_session_id),
    sourceAnchorMessageId: brand<string, 'MessageId'>(row.source_anchor_message_id),
    childAnchorMessageId: brand<string, 'MessageId'>(row.child_anchor_message_id),
    sourceSessionTitleSnapshot: row.source_session_title_snapshot,
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
  };
}

function toForkProcessSnapshotStatusRecord(row: ForkProcessSnapshotStatusRow): ForkProcessSnapshotStatusRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestId: brand<string, 'MessageId'>(row.request_id),
    runId: brand<string, 'RequestRunId'>(row.run_id),
    status: row.status,
  };
}

function toForkPromotedContentRecord(row: ForkPromotedContentRow): LocalForkPromotedContentRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    forkAttemptId: row.fork_attempt_id,
    promotedContentId: row.promoted_content_id,
    sourceSessionId: brand<string, 'SessionId'>(row.source_session_id),
    sourceMessageId: brand<string, 'MessageId'>(row.source_message_id),
    sourceRefId: row.source_ref_id,
    ...(row.child_session_id === '' ? {} : { childSessionId: brand<string, 'SessionId'>(row.child_session_id) }),
    ...(row.child_message_id === '' ? {} : { childMessageId: brand<string, 'MessageId'>(row.child_message_id) }),
    refType: row.ref_type as LocalForkPromotedContentRecord['refType'],
    blobRef: brand<string, 'BlobRef'>(row.blob_ref),
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status as LocalForkPromotedContentRecord['status'],
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    ...(row.committed_at === null ? {} : { committedAt: brand<number, 'EpochMillis'>(row.committed_at) }),
    ...(row.aborted_at === null ? {} : { abortedAt: brand<number, 'EpochMillis'>(row.aborted_at) }),
  };
}

function truncateCodePoints(value: string, limit: number): { readonly text: string; readonly truncated: boolean } {
  const codePoints = Array.from(value);
  if (codePoints.length <= limit) {
    return { text: value, truncated: false };
  }
  return { text: codePoints.slice(0, limit).join(''), truncated: true };
}

function toAttachmentRecord(row: AttachmentRow): RequestAttachmentRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    attachmentId: brand<string, 'AttachmentId'>(row.attachment_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestId: brand<string, 'MessageId'>(row.request_id),
    ...(row.run_id === null ? {} : { runId: brand<string, 'RequestRunId'>(row.run_id) }),
    fileName: row.file_name,
    mediaType: row.media_type as RequestAttachmentRecord['mediaType'],
    sizeBytes: row.size_bytes,
    storageRef: brand<string, 'BlobRef'>(row.storage_ref),
    validationStatus: row.validation_status as RequestAttachmentRecord['validationStatus'],
    availabilityStatus: row.availability_status as RequestAttachmentRecord['availabilityStatus'],
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
  };
}

function toAttachmentIntakeReservationRecord(row: AttachmentIntakeReservationRow): AttachmentIntakeReservationRecord {
  return {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    reservationId: brand<string, 'AttachmentIntakeReservationId'>(row.reservation_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestId: brand<string, 'MessageId'>(row.request_id),
    runId: brand<string, 'RequestRunId'>(row.run_id),
    requestContextId: brand<string, 'RequestContextId'>(row.request_context_id),
    action: row.action as AttachmentIntakeReservationRecord['action'],
    commandSemanticHash: row.command_semantic_hash,
    status: row.status as AttachmentIntakeReservationRecord['status'],
    attachmentIds: (JSON.parse(row.attachment_ids) as string[]).map((item) => brand<string, 'AttachmentId'>(item)),
    ...(row.rejection_reason_code === null ? {} : { rejectionReasonCode: row.rejection_reason_code }),
    ...(row.safe_error === null ? {} : { safeError: JSON.parse(row.safe_error) as SafeError }),
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
  };
}

function toPendingInputRecord(row: PendingInputRow): PendingInputRecord {
  const authorizationScope =
    row.authorization_scope === null ? undefined : (JSON.parse(row.authorization_scope) as PendingInputRecord['authorizationScope']);
  const persistedResponse = row.response_answers === null ? undefined : (JSON.parse(row.response_answers) as unknown);
  const responseAnswers =
    persistedResponse === undefined
      ? undefined
      : Array.isArray(persistedResponse)
        ? (persistedResponse as PendingInputRecord['responseAnswers'])
        : ((persistedResponse as { readonly answers?: PendingInputRecord['responseAnswers'] }).answers ?? undefined);
  const responseAnswerKinds =
    persistedResponse !== null && typeof persistedResponse === 'object' && !Array.isArray(persistedResponse)
      ? ((persistedResponse as { readonly answerKinds?: PendingInputRecord['responseAnswerKinds'] }).answerKinds ?? undefined)
      : undefined;
  const base: Omit<PendingInputRecord, 'authorizationScope' | 'responseAnswers' | 'responseAnswerKinds'> = {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    pendingInputId: brand<string, 'PendingInputId'>(row.pending_input_id),
    sessionId: brand<string, 'SessionId'>(row.session_id),
    requestId: brand<string, 'MessageId'>(row.request_id),
    requestRunId: brand<string, 'RequestRunId'>(row.request_run_id),
    requestContextId: brand<string, 'RequestContextId'>(row.request_context_id),
    checkpointId: brand<string, 'CheckpointId'>(row.checkpoint_id),
    kind: row.kind as PendingInputRecord['kind'],
    request: JSON.parse(row.request) as PendingInputRecord['request'],
    producerRef: JSON.parse(row.producer_ref) as PendingInputRecord['producerRef'],
    status: row.status as PendingInputRecord['status'],
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
  };
  return {
    ...base,
    ...(authorizationScope === undefined ? {} : { authorizationScope }),
    ...(responseAnswers === undefined ? {} : { responseAnswers }),
    ...(responseAnswerKinds === undefined ? {} : { responseAnswerKinds }),
  };
}

const ltmMemoryTypes: readonly MemoryType[] = ['FACTUAL', 'CONCEPTUAL', 'PROCEDURAL', 'USER_CHARACTERISTICS'];
const ltmKnowledgeSourceTypes: readonly KnowledgeSourceType[] = ['LEARNED', 'CONFIGURED', 'SYSTEM_DEFAULT'];
const ltmStates: readonly LongTermMemoryState[] = ['ACTIVE', 'ARCHIVED'];
const maxConfiguredPersonalMemories = 50;
const ltmAgentIdPattern = /^[a-zA-Z0-9_-]{1,64}$/u;

function userQuestionSafeError(code: string, message: string): SafeError {
  return { code, message, category: 'UNAVAILABLE', retryable: true };
}
function ltmSafeError(
  code: string,
  category: SafeError['category'],
  message: string,
  retryable = false,
  safeDetails?: SafeError['safeDetails'],
): SafeError {
  return {
    code,
    message,
    category,
    retryable,
    ...(safeDetails === undefined ? {} : { safeDetails }),
  };
}

function trajectorySafeError(
  code: string,
  category: SafeError['category'],
  message: string,
  retryable = false,
  safeDetails?: SafeError['safeDetails'],
): SafeError {
  return {
    code,
    message,
    category,
    retryable,
    ...(safeDetails === undefined ? {} : { safeDetails }),
  };
}

function toLongTermMemoryRecord(row: LongTermMemoryRow): LongTermMemoryRecord {
  const record: LongTermMemoryRecord = {
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    memoryId: brand<string, 'LongTermMemoryId'>(row.long_term_memory_id),
    memoryInstance: row.memory_instance,
    memoryType: row.category as MemoryType,
    knowledgeSourceType: row.knowledge_source_type as KnowledgeSourceType,
    sharingState: row.sharing_state as SharingState,
    ...(row.source_memory_id === null ? {} : { sourceMemoryId: brand<string, 'LongTermMemoryId'>(row.source_memory_id) }),
    state: row.state as LongTermMemoryState,
    briefIndex: row.brief_index,
    content: row.content_json,
    labels: JSON.parse(row.tags_json) as readonly string[],
    confidence: row.confidence,
    version: row.version,
    accessCount: row.access_count,
    recallCount: row.recall_count,
    extractionCount: row.extraction_count,
    ...(row.last_accessed_at === null ? {} : { lastAccessedAt: brand<number, 'EpochMillis'>(row.last_accessed_at) }),
    archivedAt: brand<number, 'EpochMillis'>(row.archived_at ?? 0),
    archiveReason: row.archive_reason ?? '',
    isPinned: row.is_pinned === 1,
    source: row.source_trace_json,
    createTime: brand<number, 'EpochMillis'>(row.created_at),
    updateTime: brand<number, 'EpochMillis'>(row.updated_at),
  };
  return record;
}

function toLongTermMemorySummary(record: LongTermMemoryRecord): LongTermMemorySummary {
  return {
    memoryId: record.memoryId,
    memoryType: record.memoryType,
    knowledgeSourceType: record.knowledgeSourceType,
    state: record.state,
    briefIndex: record.briefIndex,
    content: record.content,
    labels: record.labels,
    confidence: record.confidence,
    isPinned: record.isPinned,
    accessCount: record.accessCount,
    createTime: record.createTime,
    updateTime: record.updateTime,
    version: record.version,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTaskTrajectoryRecord(record: SaveTaskTrajectoryRequest): SafeError | undefined {
  if (!isPlainRecord(record)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory record is invalid.');
  }
  const unknownTopLevel = validateAllowedKeys(record, taskTrajectoryRecordKeys, 'record');
  if (unknownTopLevel !== undefined) {
    return unknownTopLevel;
  }
  if (record.tenantId === undefined || record.subjectId === undefined || record.agentId === undefined) {
    return trajectorySafeError('TASK_TRAJECTORY_SCOPE_REQUIRED', 'AUTHORIZATION', 'Task trajectory requires tenant, subject, and agent scope.');
  }
  const requiredStrings: ReadonlyArray<[unknown, string]> = [
    [record.taskTrajectoryId, 'taskTrajectoryId'],
    [record.sessionId, 'sessionId'],
    [record.requestId, 'requestId'],
    [record.requestRunId, 'requestRunId'],
    [record.goalSummary, 'goalSummary'],
  ];
  if (requiredStrings.some(([value]) => typeof value !== 'string' || value.trim().length === 0)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory required field is invalid.');
  }
  const goalValidation = validateTrajectoryRequiredString(record.goalSummary, 'goalSummary');
  if (goalValidation !== undefined) {
    return goalValidation;
  }
  if (!taskTrajectoryKinds.includes(record.taskKind)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory kind is invalid.', false, { field: 'taskKind' });
  }
  if (!taskTrajectoryBuildStatuses.includes(record.trajectoryBuildStatus)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory build status is invalid.', false, {
      field: 'trajectoryBuildStatus',
    });
  }
  if (!taskOutcomeStatuses.includes(record.taskOutcomeStatus)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task outcome status is invalid.', false, {
      field: 'taskOutcomeStatus',
    });
  }
  if (!outcomeEvidenceLevels.includes(record.outcomeEvidenceLevel)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task outcome evidence level is invalid.', false, {
      field: 'outcomeEvidenceLevel',
    });
  }
  return (
    validateTrajectoryEpoch(record.startedAt, 'startedAt') ??
    validateTrajectoryEpoch(record.completedAt, 'completedAt') ??
    validateTrajectoryEpoch(record.createdAt, 'createdAt') ??
    validateTrajectoryEpoch(record.updatedAt, 'updatedAt') ??
    validateTrajectoryOptionalString(record.outcomeSummary, 'outcomeSummary') ??
    validateTrajectoryOptionalString(record.failureSummary, 'failureSummary') ??
    validateTrajectoryStringArray(record.constraintSummaries, 'constraintSummaries', maxTrajectoryConstraints) ??
    validateTrajectoryObservations(record.observations) ??
    validateTrajectoryActions(record.actions) ??
    validateTrajectorySourceRefs(record.outcomeEvidenceRefs, 'outcomeEvidenceRefs', maxTrajectoryEvidenceRefs) ??
    validateTrajectorySourceRefs(record.sourceRefs, 'sourceRefs', maxTrajectorySourceRefs)
  );
}

function validateTaskTrajectoryQuery(query: ListTaskTrajectoriesQuery): SafeError | undefined {
  return (
    validateTaskTrajectoryScopeAndLimit(query) ??
    validateTrajectoryEpoch(query.startedAfter, 'startedAfter') ??
    validateTrajectoryEpoch(query.startedBefore, 'startedBefore') ??
    validateTrajectoryEpoch(query.completedAfter, 'completedAfter') ??
    validateTrajectoryEpoch(query.completedBefore, 'completedBefore')
  );
}

function validateTaskTrajectoryBuildCandidateQuery(query: ListTaskTrajectoryBuildCandidatesQuery): SafeError | undefined {
  return (
    validateTaskTrajectoryScopeAndLimit(query) ??
    validateTrajectoryEpoch(query.sinceTime, 'sinceTime') ??
    validateTrajectoryEpoch(query.untilTime, 'untilTime')
  );
}

function validateTaskTrajectoryScopeAndLimit(query: {
  readonly tenantId?: unknown;
  readonly subjectId?: unknown;
  readonly agentId?: unknown;
  readonly limit: number;
}): SafeError | undefined {
  if (query.tenantId === undefined || query.subjectId === undefined || query.agentId === undefined) {
    return trajectorySafeError('TASK_TRAJECTORY_SCOPE_REQUIRED', 'AUTHORIZATION', 'Task trajectory query requires tenant, subject, and agent scope.');
  }
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    return trajectorySafeError('TASK_TRAJECTORY_QUERY_INVALID', 'VALIDATION', 'Task trajectory query limit is invalid.', false, {
      field: 'limit',
      min: 1,
      max: 100,
    });
  }
  return undefined;
}

function validateTrajectoryEpoch(value: number | undefined, field: string): SafeError | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    return trajectorySafeError('TASK_TRAJECTORY_QUERY_INVALID', 'VALIDATION', 'Task trajectory timestamp is invalid.', false, { field });
  }
  return undefined;
}

const taskTrajectoryKinds: ReadonlyArray<TaskTrajectoryRecord['taskKind']> = [
  'TROUBLESHOOTING',
  'CONFIG_CHANGE',
  'PLANNING',
  'EXPLANATION',
  'GENERAL_TASK',
];
const taskTrajectoryBuildStatuses: ReadonlyArray<TaskTrajectoryRecord['trajectoryBuildStatus']> = ['COMPLETED', 'FAILED', 'SKIPPED'];
const taskOutcomeStatuses: ReadonlyArray<TaskTrajectoryRecord['taskOutcomeStatus']> = ['SUCCEEDED', 'FAILED', 'PARTIAL', 'UNKNOWN', 'CANCELLED'];
const outcomeEvidenceLevels: ReadonlyArray<TaskTrajectoryRecord['outcomeEvidenceLevel']> = [
  'NONE',
  'MODEL_CLAIM',
  'TOOL_STATUS',
  'VERIFICATION',
  'USER_CONFIRMATION',
];
const taskTrajectorySourceRefKinds: ReadonlyArray<TaskTrajectoryRecord['sourceRefs'][number]['refKind']> = [
  'SESSION',
  'REQUEST_RUN',
  'MESSAGE',
  'TIMELINE_EVENT',
  'CAPABILITY_INVOCATION',
  'ARTIFACT',
  'CONTENT_REF',
  'DIAGNOSTIC',
];
const taskTrajectoryObservationKinds: ReadonlyArray<TaskTrajectoryRecord['observations'][number]['kind']> = [
  'REQUEST_FACT',
  'TOOL_RESULT',
  'DIAGNOSTIC',
  'USER_CONFIRMATION',
  'VERIFICATION',
  'TERMINAL_STATUS',
];
const taskTrajectoryActionKinds: ReadonlyArray<TaskTrajectoryRecord['actions'][number]['kind']> = [
  'MODEL_RESPONSE',
  'TOOL_INVOCATION',
  'CONFIG_APPLY',
  'VERIFICATION',
  'USER_INPUT',
  'OTHER',
];
const taskTrajectoryActionStatuses: ReadonlyArray<TaskTrajectoryRecord['actions'][number]['status']> = [
  'SUCCEEDED',
  'FAILED',
  'DEGRADED',
  'TIMED_OUT',
  'CANCELLED',
  'UNKNOWN',
];
const taskTrajectoryRecordKeys = new Set([
  'tenantId',
  'subjectId',
  'agentId',
  'taskTrajectoryId',
  'sessionId',
  'requestId',
  'requestRunId',
  'taskKind',
  'trajectoryBuildStatus',
  'taskOutcomeStatus',
  'outcomeEvidenceLevel',
  'goalSummary',
  'constraintSummaries',
  'observations',
  'actions',
  'outcomeSummary',
  'outcomeEvidenceRefs',
  'failureSummary',
  'sourceRefs',
  'startedAt',
  'completedAt',
  'createdAt',
  'updatedAt',
]);
const taskTrajectorySourceRefKeys = new Set([
  'refKind',
  'sessionId',
  'requestId',
  'requestRunId',
  'messageId',
  'timelineEventId',
  'timelineSequence',
  'capabilityInvocationId',
  'contentRef',
  'safeReasonCode',
]);
const taskTrajectoryObservationKeys = new Set(['kind', 'summary', 'sourceRefs', 'observedAt']);
const taskTrajectoryActionKeys = new Set(['kind', 'summary', 'status', 'sourceRefs', 'startedAt', 'completedAt']);
const maxTrajectorySummaryLength = 512;
const maxTrajectoryConstraints = 50;
const maxTrajectoryObservations = 100;
const maxTrajectoryActions = 100;
const maxTrajectorySourceRefs = 100;
const maxTrajectoryEvidenceRefs = 50;

function normalizeTrajectoryLimit(limit: number): number {
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function parseTrajectoryCursor(cursor?: string): number | undefined {
  if (cursor === undefined) {
    return 0;
  }
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : undefined;
}

function validateAllowedKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>, field: string): SafeError | undefined {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory field is invalid.', false, {
      field: `${field}.${unknownKey}`,
    });
  }
  return undefined;
}

function validateTrajectoryOptionalString(value: unknown, field: string): SafeError | undefined {
  if (value === undefined) {
    return undefined;
  }
  return validateTrajectoryRequiredString(value, field);
}

function validateTrajectoryRequiredString(value: unknown, field: string): SafeError | undefined {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxTrajectorySummaryLength) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory string field is invalid.', false, { field });
  }
  return undefined;
}

function validateTrajectoryStringArray(value: unknown, field: string, maxItems: number): SafeError | undefined {
  if (!Array.isArray(value) || value.length > maxItems) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory array field is invalid.', false, { field });
  }
  if (value.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > maxTrajectorySummaryLength)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory array item is invalid.', false, { field });
  }
  return undefined;
}

function validateTrajectoryObservations(value: unknown): SafeError | undefined {
  if (!Array.isArray(value) || value.length > maxTrajectoryObservations) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory observations are invalid.', false, {
      field: 'observations',
    });
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `observations.${index}`;
    if (!isPlainRecord(item)) {
      return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory observation is invalid.', false, { field });
    }
    const validation =
      validateAllowedKeys(item, taskTrajectoryObservationKeys, field) ??
      (!taskTrajectoryObservationKinds.includes(item.kind as TaskTrajectoryRecord['observations'][number]['kind'])
        ? trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory observation kind is invalid.', false, {
            field: `${field}.kind`,
          })
        : undefined) ??
      validateTrajectoryRequiredString(item.summary, `${field}.summary`) ??
      validateTrajectorySourceRefs(item.sourceRefs, `${field}.sourceRefs`, maxTrajectorySourceRefs) ??
      validateTrajectoryEpoch(item.observedAt as number | undefined, `${field}.observedAt`);
    if (validation !== undefined) {
      return validation;
    }
  }
  return undefined;
}

function validateTrajectoryActions(value: unknown): SafeError | undefined {
  if (!Array.isArray(value) || value.length > maxTrajectoryActions) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory actions are invalid.', false, { field: 'actions' });
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `actions.${index}`;
    if (!isPlainRecord(item)) {
      return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory action is invalid.', false, { field });
    }
    const validation =
      validateAllowedKeys(item, taskTrajectoryActionKeys, field) ??
      (!taskTrajectoryActionKinds.includes(item.kind as TaskTrajectoryRecord['actions'][number]['kind'])
        ? trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory action kind is invalid.', false, {
            field: `${field}.kind`,
          })
        : undefined) ??
      (!taskTrajectoryActionStatuses.includes(item.status as TaskTrajectoryRecord['actions'][number]['status'])
        ? trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory action status is invalid.', false, {
            field: `${field}.status`,
          })
        : undefined) ??
      validateTrajectoryRequiredString(item.summary, `${field}.summary`) ??
      validateTrajectorySourceRefs(item.sourceRefs, `${field}.sourceRefs`, maxTrajectorySourceRefs) ??
      validateTrajectoryEpoch(item.startedAt as number | undefined, `${field}.startedAt`) ??
      validateTrajectoryEpoch(item.completedAt as number | undefined, `${field}.completedAt`);
    if (validation !== undefined) {
      return validation;
    }
  }
  return undefined;
}

function validateTrajectorySourceRefs(value: unknown, field: string, maxItems: number): SafeError | undefined {
  if (!Array.isArray(value) || value.length > maxItems) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory source refs are invalid.', false, { field });
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemField = `${field}.${index}`;
    if (!isPlainRecord(item)) {
      return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory source ref is invalid.', false, {
        field: itemField,
      });
    }
    const validation = validateAllowedKeys(item, taskTrajectorySourceRefKeys, itemField) ?? validateTrajectorySourceRef(item, itemField);
    if (validation !== undefined) {
      return validation;
    }
  }
  return undefined;
}

function validateTrajectorySourceRef(value: Record<string, unknown>, field: string): SafeError | undefined {
  if (!taskTrajectorySourceRefKinds.includes(value.refKind as TaskTrajectoryRecord['sourceRefs'][number]['refKind'])) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory source ref kind is invalid.', false, {
      field: `${field}.refKind`,
    });
  }
  const stringFields = [
    'sessionId',
    'requestId',
    'requestRunId',
    'messageId',
    'timelineEventId',
    'capabilityInvocationId',
    'contentRef',
    'safeReasonCode',
  ] as const;
  for (const key of stringFields) {
    const item = value[key];
    if (item !== undefined && (typeof item !== 'string' || item.trim().length === 0 || item.length > 256)) {
      return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory source ref field is invalid.', false, {
        field: `${field}.${key}`,
      });
    }
  }
  if (value.timelineSequence !== undefined && (!Number.isSafeInteger(Number(value.timelineSequence)) || Number(value.timelineSequence) < 0)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory source ref sequence is invalid.', false, {
      field: `${field}.timelineSequence`,
    });
  }
  if (!hasTrajectoryRefCoordinate(value)) {
    return trajectorySafeError('TASK_TRAJECTORY_WRITE_INVALID', 'VALIDATION', 'Task trajectory source ref coordinate is missing.', false, { field });
  }
  return undefined;
}

function hasTrajectoryRefCoordinate(value: Record<string, unknown>): boolean {
  return ['sessionId', 'requestId', 'requestRunId', 'messageId', 'timelineEventId', 'capabilityInvocationId', 'contentRef', 'safeReasonCode'].some(
    (key) => typeof value[key] === 'string' && (value[key] as string).trim().length > 0,
  );
}

function appendOptionalTrajectoryFilter(conditions: string[], values: Array<string | number>, column: string, value?: string): void {
  if (value === undefined) {
    return;
  }
  conditions.push(`${column} = ?`);
  values.push(value);
}

function appendOptionalTimeFilter(conditions: string[], values: Array<string | number>, column: string, operator: '>=' | '<=', value?: number): void {
  if (value === undefined) {
    return;
  }
  conditions.push(`${column} ${operator} ?`);
  values.push(Number(value));
}

function terminalRunStatusFromEventType(
  type: RunTimelineEventRecord['type'],
): Extract<RunStatus, 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'> {
  if (type === 'REQUEST_COMPLETED') {
    return 'COMPLETED';
  }
  if (type === 'REQUEST_CANCELED') {
    return 'CANCELED';
  }
  if (type === 'REQUEST_SUPERSEDED') {
    return 'SUPERSEDED';
  }
  return 'FAILED';
}

function isTerminalTimelineEventType(type: RunTimelineEventRecord['type']): boolean {
  return type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function validateLtmScope(
  input: { readonly tenantId?: unknown; readonly subjectId?: unknown; readonly agentId?: unknown },
  code = 'LTM_QUERY_INVALID',
): SafeError | undefined {
  if (!isNonEmptyString(input.tenantId) || !isNonEmptyString(input.subjectId) || !isNonEmptyString(input.agentId)) {
    return ltmSafeError(code, 'AUTHORIZATION', 'Long-term memory request requires tenant, subject, and agent scope.');
  }
  if (unicodeCodePointLength(input.tenantId) > 64 || unicodeCodePointLength(input.subjectId) > 64 || !ltmAgentIdPattern.test(input.agentId)) {
    return ltmSafeError(code, 'VALIDATION', 'Long-term memory scope is invalid.');
  }
  return undefined;
}

function validateLtmLimit(limit?: number): SafeError | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory query limit.', false, {
      field: 'limit',
      value: limit,
      constraint: '1..100',
    });
  }
  return undefined;
}

function validateLtmMinConfidence(minConfidence?: number): SafeError | undefined {
  if (minConfidence === undefined) {
    return undefined;
  }
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory minConfidence.', false, {
      field: 'minConfidence',
      value: minConfidence,
      constraint: '[0, 1]',
    });
  }
  return undefined;
}

function validateLtmOffset(offset?: number): SafeError | undefined {
  if (offset === undefined) {
    return undefined;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory query offset.', false, {
      field: 'offset',
      value: offset,
      constraint: 'integer >= 0',
    });
  }
  return undefined;
}

function validateLtmEpochMillis(value: number | undefined, field: string, code: string): SafeError | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    return ltmSafeError(code, 'VALIDATION', 'Invalid long-term memory timestamp.', false, {
      field,
      value,
      constraint: 'EpochMillis integer >= 0',
    });
  }
  return undefined;
}

function validateLtmQueryTimestamps(query: {
  readonly sinceTime?: number;
  readonly untilTime?: number;
  readonly maxLastAccessedAt?: number;
}): SafeError | undefined {
  return (
    validateLtmEpochMillis(query.sinceTime, 'sinceTime', 'LTM_QUERY_INVALID') ??
    validateLtmEpochMillis(query.untilTime, 'untilTime', 'LTM_QUERY_INVALID') ??
    validateLtmEpochMillis(query.maxLastAccessedAt, 'maxLastAccessedAt', 'LTM_QUERY_INVALID')
  );
}

function validateLtmExpectedVersion(expectedVersion: number | undefined, code: string): SafeError | undefined {
  if (expectedVersion === undefined) {
    return undefined;
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return ltmSafeError(code, 'VALIDATION', 'Invalid long-term memory expectedVersion.', false, {
      field: 'expectedVersion',
      value: expectedVersion,
      constraint: 'integer >= 1',
    });
  }
  return undefined;
}

function validateLtmMemoryType(memoryType: unknown): memoryType is MemoryType {
  return ltmMemoryTypes.includes(memoryType as MemoryType);
}

function validateLtmKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return ltmKnowledgeSourceTypes.includes(value as KnowledgeSourceType);
}

function validateLtmState(state: unknown): state is LongTermMemoryState {
  return ltmStates.includes(state as LongTermMemoryState);
}

function validateLtmMemoryTypeFilter(memoryType?: MemoryType): SafeError | undefined {
  if (memoryType !== undefined && !validateLtmMemoryType(memoryType)) {
    return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory type filter.');
  }
  return undefined;
}

function validateLtmWriteOptions(options: unknown, code: string): SafeError | undefined {
  if (!isPlainRecord(options) || !hasExactFields(options, [], ['idempotencyKey', 'expectedVersion'])) {
    return ltmSafeError(code, 'VALIDATION', 'Long-term memory write options are invalid.');
  }
  const typed = options as unknown as VersionedWriteOptions;
  return validateLtmOptionalString(typed.idempotencyKey, 'idempotencyKey', 1, 128, code) ?? validateLtmExpectedVersion(typed.expectedVersion, code);
}

function validateLtmMutationWriteOptions(options: unknown): SafeError | undefined {
  if (!isPlainRecord(options) || !hasExactFields(options, [], ['expectedVersion'])) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory mutation options are invalid.');
  }
  return validateLtmExpectedVersion((options as { readonly expectedVersion?: number }).expectedVersion, 'LTM_WRITE_INVALID');
}

function validateLtmKnowledgeSourceTypeFilter(value?: KnowledgeSourceType): SafeError | undefined {
  if (value !== undefined && !validateLtmKnowledgeSourceType(value)) {
    return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory knowledge source filter.');
  }
  return undefined;
}

function validateLtmStateFilter(state?: LongTermMemoryState): SafeError | undefined {
  if (state !== undefined && !validateLtmState(state)) {
    return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory state filter.');
  }
  return undefined;
}

function validateLtmString(value: unknown, field: string, minLength: number, maxLength: number, code = 'LTM_WRITE_INVALID'): SafeError | undefined {
  if (typeof value !== 'string' || unicodeCodePointLength(value) < minLength || unicodeCodePointLength(value) > maxLength) {
    return ltmSafeError(code, 'VALIDATION', `Invalid long-term memory ${field}.`, false, {
      field,
      constraint: `${minLength}..${maxLength} Unicode code points`,
    });
  }
  return undefined;
}

function validateLtmOptionalString(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
  code = 'LTM_WRITE_INVALID',
): SafeError | undefined {
  return value === undefined ? undefined : validateLtmString(value, field, minLength, maxLength, code);
}

function validateLtmLabels(value: unknown, required: boolean, code = 'LTM_WRITE_INVALID'): SafeError | undefined {
  if (value === undefined && !required) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > 10 || value.some((label) => validateLtmString(label, 'labels', 1, 256, code) !== undefined)) {
    return ltmSafeError(code, 'VALIDATION', 'Invalid long-term memory labels.', false, {
      field: 'labels',
      constraint: 'at most 10 labels of 1..256 Unicode code points',
    });
  }
  return undefined;
}

function validateSaveLongTermMemoryRequest(input: unknown): SafeError | undefined {
  if (!isPlainRecord(input)) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory request is invalid.');
  }
  const request = input as unknown as SaveLongTermMemoryRequest;
  if (
    !hasExactFields(
      input,
      ['tenantId', 'subjectId', 'agentId', 'memoryType', 'knowledgeSourceType', 'briefIndex', 'content', 'confidence', 'source'],
      ['memoryId', 'memoryInstance', 'labels'],
    )
  ) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory request contains unsupported or missing fields.');
  }
  const scopeError = validateLtmScope(request, 'LTM_WRITE_INVALID');
  if (scopeError !== undefined) {
    return scopeError;
  }
  if (!validateLtmMemoryType(request.memoryType)) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory type.');
  }
  if (!validateLtmKnowledgeSourceType(request.knowledgeSourceType)) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory knowledge source type.');
  }
  if (!Number.isFinite(request.confidence) || request.confidence < 0 || request.confidence > 1) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory confidence is invalid.', false, {
      field: 'confidence',
      value: request.confidence,
      constraint: '[0, 1]',
    });
  }
  return (
    validateLtmOptionalString(request.memoryId, 'memoryId', 1, 64) ??
    validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64) ??
    validateLtmString(request.briefIndex, 'briefIndex', 1, 2048) ??
    validateLtmString(request.content, 'content', 0, 4000) ??
    validateLtmLabels(request.labels, false) ??
    validateLtmString(request.source, 'source', 1, 4096)
  );
}

function validateBatchCreateLongTermMemoryRequest(input: unknown): SafeError | undefined {
  if (!isPlainRecord(input) || !hasExactFields(input, ['tenantId', 'subjectId', 'agentId', 'items'], ['memoryInstance'])) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Batch create long-term memory request is invalid.');
  }
  const request = input as unknown as BatchCreateLongTermMemoryRequest;
  const scopeError = validateLtmScope(request, 'LTM_WRITE_INVALID') ?? validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64);
  if (scopeError !== undefined) {
    return scopeError;
  }
  if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > 100) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Batch create requires 1 to 100 items.');
  }
  for (const item of request.items) {
    if (
      !isPlainRecord(item) ||
      !hasExactFields(
        item,
        ['memoryType', 'knowledgeSourceType', 'briefIndex', 'content'],
        ['memoryId', 'labels', 'confidence', 'source', 'state', 'archiveReason', 'writeOptions'],
      )
    ) {
      return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Batch create item is invalid.');
    }
  }
  return undefined;
}

function validateBatchCreateLongTermMemoryItem(item: BatchCreateLongTermMemoryRequest['items'][number]): SafeError | undefined {
  return (
    (!validateLtmMemoryType(item.memoryType) ? ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory type.') : undefined) ??
    (!validateLtmKnowledgeSourceType(item.knowledgeSourceType)
      ? ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory knowledge source type.')
      : undefined) ??
    validateLtmOptionalString(item.memoryId, 'memoryId', 1, 64) ??
    validateLtmString(item.briefIndex, 'briefIndex', 1, 2048) ??
    validateLtmString(item.content, 'content', 1, 4000) ??
    validateLtmLabels(item.labels, false) ??
    (item.confidence !== undefined &&
    (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)
      ? ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory confidence is invalid.')
      : undefined) ??
    (item.source === undefined || item.source === '' ? undefined : validateLtmString(item.source, 'source', 1, 4096)) ??
    (item.state === undefined || validateLtmState(item.state)
      ? undefined
      : ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory state.')) ??
    validateLtmOptionalString(item.archiveReason, 'archiveReason', 0, 128) ??
    (item.archiveReason !== undefined && item.state !== 'ARCHIVED'
      ? ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Archive reason requires ARCHIVED state.')
      : undefined) ??
    validateLtmWriteOptions(item.writeOptions ?? {}, 'LTM_WRITE_INVALID')
  );
}

function validateManualSaveLongTermMemoryRequest(input: unknown): SafeError | undefined {
  if (!isPlainRecord(input)) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Manual long-term memory request is invalid.');
  }
  const request = input as unknown as ManualSaveLongTermMemoryRequest;
  if (
    !hasExactFields(
      input,
      ['tenantId', 'subjectId', 'agentId', 'memoryType', 'knowledgeSourceType', 'briefIndex', 'content', 'confidence'],
      ['memoryId', 'memoryInstance', 'labels'],
    )
  ) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Manual long-term memory request contains unsupported or missing fields.');
  }
  const scopeError = validateLtmScope(request, 'LTM_WRITE_INVALID');
  if (scopeError !== undefined) {
    return scopeError;
  }
  if (!validateLtmMemoryType(request.memoryType)) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory type.');
  }
  if (!validateLtmKnowledgeSourceType(request.knowledgeSourceType)) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Invalid long-term memory knowledge source type.');
  }
  if (!Number.isFinite(request.confidence) || request.confidence < 0 || request.confidence > 1) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Manual long-term memory confidence is invalid.', false, {
      field: 'confidence',
      value: request.confidence,
      constraint: '[0, 1]',
    });
  }
  return (
    validateLtmOptionalString(request.memoryId, 'memoryId', 1, 64) ??
    validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64) ??
    validateLtmString(request.briefIndex, 'briefIndex', 1, 2048) ??
    validateLtmString(request.content, 'content', 1, 4000) ??
    validateLtmLabels(request.labels, false)
  );
}

function validateMutateLongTermMemoryRequest(input: unknown): SafeError | undefined {
  if (!isPlainRecord(input)) {
    return invalidLongTermMemoryMutation('Long-term memory mutation request is invalid.');
  }
  const request = input as unknown as MutateLongTermMemoryRequest;
  const allowedRequestFields = new Set([
    'tenantId',
    'subjectId',
    'agentId',
    'memoryId',
    'memoryInstance',
    'targetState',
    'archiveReason',
    'delta',
    'lastAccessTime',
    'isPinned',
  ]);
  if (Object.keys(input).some((field) => !allowedRequestFields.has(field))) {
    return invalidLongTermMemoryMutation('Long-term memory mutation request contains unsupported fields.');
  }
  const scopeError = validateLtmScope(request, 'LTM_WRITE_INVALID');
  if (scopeError !== undefined) {
    return scopeError;
  }
  if (validateLtmString(request.memoryId, 'memoryId', 1, 64) !== undefined) {
    return invalidLongTermMemoryMutation('Long-term memory mutation id is invalid.');
  }
  const instanceError = validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64);
  if (instanceError !== undefined) {
    return instanceError;
  }
  const branches = [
    request.targetState !== undefined,
    request.delta !== undefined,
    request.lastAccessTime !== undefined,
    request.isPinned !== undefined,
  ].filter(Boolean).length;
  if (branches !== 1 || (request.archiveReason !== undefined && request.targetState === undefined)) {
    return invalidLongTermMemoryMutation('Long-term memory mutation must contain exactly one valid branch.');
  }
  if (
    request.targetState !== undefined &&
    (!validateLtmState(request.targetState) ||
      (request.archiveReason !== undefined &&
        (unicodeCodePointLength(request.archiveReason) > 128 || (request.targetState === 'ACTIVE' && request.archiveReason !== ''))))
  ) {
    return ltmSafeError('LTM_TRANSITION_INVALID', 'VALIDATION', 'Invalid long-term memory state mutation.');
  }
  if (request.delta !== undefined && (!Number.isFinite(request.delta) || request.delta < -1 || request.delta > 1)) {
    return ltmSafeError('LTM_CONFIDENCE_INVALID', 'VALIDATION', 'Invalid long-term memory confidence mutation.');
  }
  if (request.lastAccessTime !== undefined && (!Number.isInteger(request.lastAccessTime) || request.lastAccessTime < 0)) {
    return invalidLongTermMemoryMutation('Invalid long-term memory access mutation.');
  }
  if (request.isPinned !== undefined && typeof request.isPinned !== 'boolean') {
    return invalidLongTermMemoryMutation('Invalid long-term memory pin mutation.');
  }
  return undefined;
}

function validateSharingLongTermMemoryRequest(input: unknown): SafeError | undefined {
  if (!isPlainRecord(input) || !hasExactFields(input, ['tenantId', 'subjectId', 'agentId', 'memoryId'], ['memoryInstance', 'reasonCode'])) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory sharing request is invalid.');
  }
  const request = input as unknown as SharingLongTermMemoryRequest;
  return (
    validateLtmScope(request, 'LTM_WRITE_INVALID') ??
    validateLtmString(request.memoryId, 'memoryId', 1, 64) ??
    validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64) ??
    validateLtmOptionalString(request.reasonCode, 'reasonCode', 1, 128)
  );
}

function validateCopyLongTermMemoryRequest(input: unknown): SafeError | undefined {
  if (!isPlainRecord(input) || !hasExactFields(input, ['tenantId', 'subjectId', 'agentId', 'memoryIds'], ['memoryInstance', 'reasonCode'])) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Copy long-term memory request is invalid.');
  }
  const request = input as unknown as CopyLongTermMemoryRequest;
  const scopeError =
    validateLtmScope(request, 'LTM_WRITE_INVALID') ??
    validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64) ??
    validateLtmOptionalString(request.reasonCode, 'reasonCode', 1, 128);
  if (scopeError !== undefined) {
    return scopeError;
  }
  if (
    !Array.isArray(request.memoryIds) ||
    request.memoryIds.length < 1 ||
    request.memoryIds.length > 100 ||
    request.memoryIds.some((memoryId) => validateLtmString(memoryId, 'memoryIds', 1, 64) !== undefined)
  ) {
    return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Copy long-term memory ids are invalid.', false, {
      field: 'memoryIds',
      constraint: '1..100 memory ids of 1..64 Unicode code points',
    });
  }
  return undefined;
}

function hasExactFields(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((field) => Object.prototype.hasOwnProperty.call(record, field)) && Object.keys(record).every((field) => allowed.has(field));
}

function unicodeCodePointLength(value: string): number {
  return [...value].length;
}

function invalidLongTermMemoryMutation(message: string): SafeError {
  return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', message);
}

function normalizeLtmLimit(limit?: number): number {
  return limit ?? 10;
}

function normalizeLtmOffset(offset?: number): number {
  return offset === undefined ? 0 : Math.max(0, Math.trunc(offset));
}

function clearLongTermMemoryArchiveFields(record: LongTermMemoryRecord): LongTermMemoryRecord {
  return { ...record, archivedAt: brand<number, 'EpochMillis'>(0), archiveReason: '' };
}

function generateLongTermMemoryId(): LongTermMemoryId {
  const timePart = Date.now().toString(36).padStart(9, '0');
  const randomPart = randomBytes(10).toString('hex');
  return brand<string, 'LongTermMemoryId'>(`ltm_${timePart}_${randomPart}`);
}

function toFtsMatchQuery(queryText: string): string {
  return queryText
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' OR ');
}

function scoreLongTermMemory(record: LongTermMemoryRecord, ftsRank: number, now: number): number {
  const ageMs = Math.max(0, now - Number(record.updateTime));
  const recencyScore = 1 / (1 + ageMs / 2_592_000_000);
  const accessScore = Math.min(1, Math.log1p(record.accessCount) / Math.log1p(10));
  return 0.4 * clamp01(ftsRank) + 0.3 * record.confidence + 0.2 * recencyScore + 0.1 * accessScore;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function toUserQuestionActivityRecord(row: UserQuestionActivityRow): UserQuestionActivityRecord {
  return {
    tenantId: row.tenant_id as TenantId,
    subjectId: row.subject_id as SubjectId,
    agentId: row.agent_id as AgentId,
    questionHash: row.question_hash,
    questionText: row.question_text,
    locale: row.locale,
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at === null ? null : brand(row.pinned_at),
    askFrequency: row.ask_frequency,
    lastAskedAt: row.last_asked_at === null ? null : brand(row.last_asked_at),
    createdAt: brand(row.created_at),
    updatedAt: row.updated_at as EpochMillis,
  };
}
export class SqliteGatewayCore {
  readonly gatewayKind = 'sqlite' as const;
  readonly sqliteFile: string;

  private readonly db: DatabaseSync;
  private longTermMemoryFtsAvailable = true;

  constructor(options: SqliteGatewayStoresOptions) {
    this.sqliteFile = resolve(options.sqliteFile);
    mkdirSync(dirname(this.sqliteFile), { recursive: true });
    this.db = new DatabaseSync(this.sqliteFile);
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.initialize();
      this.retainOwnedSchema(options.schemaOwner ?? 'all');
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      this.db.close();
      throw error;
    }
  }

  private retainOwnedSchema(owner: NonNullable<SqliteGatewayStoresOptions['schemaOwner']>): void {
    if (owner === 'all') {
      return;
    }
    const workingMemoryTables = [
      'request_runs',
      'request_run_memory_recall_attempts',
      'sessions',
      'messages',
      'session_forks',
      'session_fork_idempotency',
      'fork_process_snapshot_statuses',
      'fork_promoted_contents',
      'attachments',
      'active_context_states',
      'active_context_items',
      'timeline_events',
      'checkpoints',
      'pending_inputs',
      'conversation_annotations',
      'conversation_shares',
    ];
    const longTermMemoryTables = ['long_term_memory_fts', 'long_term_memory'];
    const sqliteTables = [
      'blobs',
      'attachment_intake_reservations',
      'task_trajectory',
      'todo_state_revisions',
      'todo_states_current',
      'user_question_activity',
    ];
    const owned = new Set(owner === 'working-memory' ? workingMemoryTables : owner === 'long-term-memory' ? longTermMemoryTables : sqliteTables);
    for (const table of [...workingMemoryTables, ...longTermMemoryTables, ...sqliteTables]) {
      if (!owned.has(table)) {
        this.db.exec(`DROP TABLE IF EXISTS ${table};`);
      }
    }
  }

  async saveRun(record: RequestRunRecord, options: VersionedWriteOptions): Promise<VersionedUpdateResult<RequestRunRecord>> {
    return this.transaction(() => {
      const current = this.getRunRow(record.tenantId, record.subjectId, record.agentId, record.runId);
      if (options.expectedVersion !== undefined) {
        const currentRecord = parseJsonRow<RequestRunRecord>(current);
        if (currentRecord?.version !== options.expectedVersion) {
          return { status: currentRecord === undefined ? 'NOT_FOUND' : 'VERSION_CONFLICT' };
        }
        this.putRun(record, current?.idempotency_key ?? options.idempotencyKey, current?.idempotency_semantic ?? options.idempotencySemantic);
        return { status: 'UPDATED', record };
      }
      if (current !== undefined) {
        this.putRun(record, current.idempotency_key ?? options.idempotencyKey, current.idempotency_semantic ?? options.idempotencySemantic);
        return { status: 'UPDATED', record };
      }
      if (options.idempotencyKey !== undefined) {
        const existingByKey = this.getRunByAcceptanceIdempotencyKey(
          record.tenantId,
          record.subjectId,
          record.agentId,
          record.sessionId,
          options.idempotencyKey,
        );
        if (existingByKey !== undefined) {
          if (
            existingByKey.idempotencySemantic !== null &&
            options.idempotencySemantic !== undefined &&
            existingByKey.idempotencySemantic !== options.idempotencySemantic
          ) {
            return { status: 'VERSION_CONFLICT' };
          }
          return { status: 'UPDATED', record: existingByKey.record };
        }
      }
      this.putRun(record, options.idempotencyKey, options.idempotencySemantic);
      return { status: 'UPDATED', record };
    });
  }

  async claimMemoryRecallAttempt(record: RequestRunMemoryRecallAttemptRecord): Promise<RequestRunMemoryRecallAttemptClaimResult> {
    if (record.state !== 'STARTED' || record.version !== 1) {
      throw new Error('A memory recall attempt claim must start at version 1 in STARTED state.');
    }
    return this.transaction(() => {
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO request_run_memory_recall_attempts(
          tenant_id, subject_id, agent_id, request_run_id, hook_id, state,
          version, created_at, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.tenantId,
          record.subjectId,
          record.agentId,
          record.requestRunId,
          record.hookId,
          record.state,
          record.version,
          Number(record.createdAt),
          Number(record.updatedAt),
          JSON.stringify(record),
        );
      if (inserted.changes === 0) {
        const existing = this.getMemoryRecallAttempt(record);
        if (existing === undefined) {
          throw new Error('Memory recall attempt claim was not persisted.');
        }
        return { status: 'ALREADY_CLAIMED', record: existing };
      }
      return { status: 'CLAIMED', record };
    });
  }

  async completeMemoryRecallAttempt(
    record: RequestRunMemoryRecallAttemptRecord,
    options: Pick<VersionedWriteOptions, 'expectedVersion'>,
  ): Promise<VersionedUpdateResult<RequestRunMemoryRecallAttemptRecord>> {
    const expectedVersion = options.expectedVersion;
    return this.transaction(() => {
      if (expectedVersion === undefined || record.state === 'STARTED' || record.version !== expectedVersion + 1) {
        return { status: 'VERSION_CONFLICT' };
      }
      const updated = this.db
        .prepare(
          `UPDATE request_run_memory_recall_attempts
         SET state = ?, version = ?, updated_at = ?, json = ?
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND request_run_id = ? AND hook_id = ?
           AND state = 'STARTED' AND version = ? AND created_at = ?`,
        )
        .run(
          record.state,
          record.version,
          Number(record.updatedAt),
          JSON.stringify(record),
          record.tenantId,
          record.subjectId,
          record.agentId,
          record.requestRunId,
          record.hookId,
          expectedVersion,
          Number(record.createdAt),
        );
      if (updated.changes === 0) {
        return this.getMemoryRecallAttempt(record) === undefined ? { status: 'NOT_FOUND' } : { status: 'VERSION_CONFLICT' };
      }
      return { status: 'UPDATED', record };
    });
  }

  async loadMemoryRecallAttempt(request: RequestRunMemoryRecallAttemptLookupRequest): Promise<RequestRunMemoryRecallAttemptRecord | undefined> {
    return this.getMemoryRecallAttempt(request);
  }

  async loadRun(request: RequestRunLookupRequest): Promise<RequestRunRecord | undefined> {
    return parseJsonRow<RequestRunRecord>(this.getRunRow(request.tenantId, request.subjectId, request.agentId, request.runId));
  }

  async listRuns(request: RequestRunListQuery): Promise<RequestRunRecordPage> {
    const hasValidSessionIds = request.sessionIds === undefined || (Array.isArray(request.sessionIds) && request.sessionIds.length > 0);
    const hasValidRunIds = request.runIds === undefined || (Array.isArray(request.runIds) && request.runIds.length > 0);
    if (
      (request.sessionIds === undefined && request.runIds === undefined) ||
      !hasValidSessionIds ||
      !hasValidRunIds ||
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > REQUEST_RUN_MAX_PAGE_LIMIT
    ) {
      throw new AgentError({
        code: 'REQUEST_RUN_QUERY_INVALID',
        message: 'Request run query is invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const sessionIds = request.sessionIds === undefined ? undefined : [...new Set(request.sessionIds)];
    const runIds = request.runIds === undefined ? undefined : [...new Set(request.runIds)];

    const predicates = ['tenant_id = ?', 'subject_id = ?', 'agent_id = ?'];
    const parameters: Array<string | number> = [request.tenantId, request.subjectId, request.agentId];
    if (sessionIds !== undefined) {
      predicates.push(`session_id IN (${sessionIds.map(() => '?').join(', ')})`);
      parameters.push(...sessionIds);
    }
    if (runIds !== undefined) {
      predicates.push(`run_id IN (${runIds.map(() => '?').join(', ')})`);
      parameters.push(...runIds);
    }

    const rows = this.db
      .prepare(
        `SELECT json FROM request_runs
         WHERE ${predicates.join(' AND ')}
         ORDER BY created_at DESC, run_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, request.limit + 1, request.offset) as unknown as JsonRow[];
    return {
      items: rows.slice(0, request.limit).map((row) => JSON.parse(row.json) as RequestRunRecord),
      offset: request.offset,
      limit: request.limit,
      hasMore: rows.length > request.limit,
    };
  }

  async loadRunByIdempotencyKey(request: RequestRunIdempotencyLookupRequest): Promise<RequestRunIdempotencyLookupResult> {
    const existing =
      request.anchor === 'ACCEPTANCE'
        ? this.getRunByAcceptanceIdempotencyKey(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.idempotencyKey)
        : this.getRunByTerminalCommitIdempotencyKey(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.idempotencyKey);
    if (existing === undefined) {
      return { status: 'NOT_FOUND' };
    }
    if (existing.idempotencySemantic !== request.idempotencySemantic) {
      return { status: 'SEMANTIC_CONFLICT', record: existing.record };
    }
    return { status: 'FOUND', record: existing.record };
  }

  async loadSessionLaneSnapshot(request: SessionLaneSnapshotQuery): Promise<SessionLaneSnapshot> {
    const runs = (
      this.db
        .prepare(
          `SELECT json FROM request_runs
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
         ORDER BY created_at DESC, request_id DESC, run_id DESC`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.sessionId) as unknown as JsonRow[]
    ).map((row) => JSON.parse(row.json) as RequestRunRecord);
    const latestRun = runs[0];
    const queuedRuns = runs
      .filter((run) => run.status === 'ACCEPTED' || run.status === 'QUEUED' || run.status === 'PLANNING')
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt) || left.runId.localeCompare(right.runId));
    const executingRuns = runs.filter((run) => run.status === 'EXECUTING');
    if (executingRuns.length > 1) {
      throw new AgentError({
        code: 'LANE_EXECUTION_BLOCKED',
        message: 'Session lane contains multiple executing runs.',
        category: 'CONFLICT',
        retryable: true,
        safeDetails: { reasonCode: 'LANE_EXECUTION_BLOCKED' },
      });
    }
    const executingRun = executingRuns[0];
    const terminalPendingRun = runs.find((run) => run.terminalCommitState === 'PENDING' || run.terminalCommitState === 'RETRYING');
    return {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      queuedRuns,
      ...(latestRun === undefined ? {} : { latestRun, latestRequestId: latestRun.requestId }),
      ...(executingRun === undefined ? {} : { executingRun }),
      ...(terminalPendingRun === undefined ? {} : { terminalPendingRun }),
    };
  }

  async claimRun(request: ClaimRunRequest): Promise<VersionedUpdateResult<RequestRunRecord>> {
    try {
      return this.transaction(() => {
        const current = this.getRunRow(request.tenantId, request.subjectId, request.agentId, request.runId);
        const currentRecord = parseJsonRow<RequestRunRecord>(current);
        if (currentRecord === undefined) {
          return { status: 'NOT_FOUND' };
        }
        if (currentRecord.version !== request.expectedVersion) {
          return { status: 'VERSION_CONFLICT', record: currentRecord };
        }
        const claimed: RequestRunRecord = {
          ...currentRecord,
          lockedBy: request.lockedBy,
          lockExpiresAt: request.lockExpiresAt,
          version: currentRecord.version + 1,
          updatedAt: nowEpoch(),
        };
        this.putRun(claimed, current?.idempotency_key, current?.idempotency_semantic);
        return { status: 'UPDATED', record: claimed };
      });
    } catch (error) {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'SQLite storage unavailable',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    }
  }

  async listRecoverableRuns(request: AgentListRecoverableRunsRequest): Promise<readonly RequestRunRecord[]> {
    try {
      const limit = Math.max(1, Math.min(1000, Math.trunc(request.limit)));
      return (
        this.db
          .prepare(
            `SELECT json FROM request_runs
           WHERE agent_id = ?
             AND (lock_expires_at IS NULL OR lock_expires_at <= ?)
             AND ((status IN ('ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING')
               AND terminal_commit_state IN ('NOT_STARTED', 'PENDING', 'RETRYING'))
              OR (status IN ('FAILED', 'COMPLETED', 'CANCELED', 'SUPERSEDED')
               AND terminal_commit_state IN ('PENDING', 'RETRYING')))
           ORDER BY updated_at ASC, created_at ASC, run_id ASC
           LIMIT ?`,
          )
          .all(request.agentId, Number(request.now), limit) as unknown as JsonRow[]
      )
        .map((row) => JSON.parse(row.json) as RequestRunRecord)
        .filter((run) => !(this.isTerminalStatus(run.status) && run.terminalCommitState === 'COMMITTED'));
    } catch (error) {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'SQLite storage unavailable',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    }
  }

  async commitTerminal(request: TerminalCommitRequest): Promise<TerminalCommitRecordResult> {
    return this.transaction(() => {
      const current = this.getRunRow(request.tenantId, request.subjectId, request.agentId, request.runId);
      const currentRecord = parseJsonRow<RequestRunRecord>(current);
      if (currentRecord === undefined) {
        return { status: 'NOT_FOUND' };
      }
      if (currentRecord.terminalCommitState === 'COMMITTED') {
        return { status: 'ALREADY_COMMITTED' };
      }
      if (currentRecord.version !== request.expectedVersion) {
        return { status: 'VERSION_CONFLICT' };
      }
      const terminalCommitSemantic = currentRecord.terminalCommitIdempotencySemantic ?? request.idempotencySemantic;
      this.putRun(
        {
          ...currentRecord,
          status: request.terminalStatus,
          terminalCommitState: 'COMMITTED',
          terminalCommitIdempotencyKey: currentRecord.terminalCommitIdempotencyKey ?? request.idempotencyKey,
          ...(terminalCommitSemantic === undefined ? {} : { terminalCommitIdempotencySemantic: terminalCommitSemantic }),
          version: currentRecord.version + 1,
          updatedAt: nowEpoch(),
        },
        current?.idempotency_key,
        current?.idempotency_semantic,
      );
      this.saveMessageSync(request.terminalMessage, { idempotencyKey: request.idempotencyKey });
      this.appendActiveContextItemSync({
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.terminalMessage.agentId,
        sessionId: request.terminalMessage.sessionId,
        messageId: request.terminalMessage.messageId,
      });
      const terminalEvent = this.appendTimelineEventSync(request.terminalEvent, { idempotencyKey: request.idempotencyKey });
      return { status: 'COMMITTED', terminalEvent };
    });
  }

  async replaceTodoState(request: ReplaceTodoStateRequest): Promise<ReplaceTodoStateResult> {
    const startedAt = Date.now();
    const result = this.transaction(() => {
      const existingRevision = this.loadTodoRevisionByInvocation(request);
      if (existingRevision !== undefined) {
        return this.todoResultFromRevision(request, existingRevision);
      }
      const current = this.loadCurrentTodoStateSync(request);
      const oldTodos = current?.todos ?? [];
      const revisionSeq = this.nextTodoRevisionSeq(request);
      const createdAt = nowEpoch();
      const revision: TodoStateRevisionRecord = {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        revisionSeq,
        requestId: request.requestId,
        requestRunId: request.requestRunId,
        requestContextId: request.requestContextId,
        ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
        todos: request.todos.map(copyTodoStateItem),
        createdAt,
      };
      this.insertTodoRevision(revision);
      if (revision.todos.length === 0) {
        this.deleteCurrentTodoState(request);
        return { oldTodos, newTodos: [], revision };
      }
      const nextCurrent: TodoStateCurrentRecord = {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        revisionSeq,
        todos: revision.todos,
        updatedAt: createdAt,
      };
      this.upsertCurrentTodoState(nextCurrent);
      return { oldTodos, newTodos: nextCurrent.todos, revision, current: nextCurrent };
    });
    this.logTodoStateReplaceCompleted(result, Date.now() - startedAt);
    return result;
  }

  async loadCurrentTodoState(request: TodoStateLookupRequest): Promise<TodoStateCurrentRecord | undefined> {
    return this.loadCurrentTodoStateSync(request);
  }

  async listTodoStateRevisions(request: TodoStateRevisionListRequest): Promise<readonly TodoStateRevisionRecord[]> {
    const limit = Math.max(1, Math.min(1000, Math.trunc(request.limit ?? 100)));
    const rows = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, session_id, revision_seq, request_id, request_run_id, request_context_id, tool_call_id, todos_json, created_at
       FROM todo_state_revisions
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND revision_seq > ?
       ORDER BY revision_seq ASC
       LIMIT ?`,
      )
      .all(
        request.tenantId,
        request.subjectId,
        request.agentId,
        request.sessionId,
        request.afterRevisionSeq ?? 0,
        limit,
      ) as unknown as TodoStateRevisionRow[];
    return rows.map(toTodoStateRevisionRecord);
  }

  async loadSession(request: SessionLookupRequest): Promise<SessionRecord | undefined> {
    const row = this.db
      .prepare(
        'SELECT tenant_id, subject_id, agent_id, session_id, parent_session_id, parent_run_id, parent_request_id, title, title_source, created_at, updated_at FROM sessions WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?',
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId) as SessionRow | undefined;
    return row === undefined ? undefined : toSessionRecord(row);
  }

  async saveSession(record: SessionRecord, options: IdempotentWriteOptions = {}): Promise<SessionRecord> {
    return this.transaction(() => {
      const current = this.getSessionRow(record.tenantId, record.subjectId, record.agentId, record.sessionId);
      if (current !== undefined) {
        this.putSession(record, current.idempotency_key ?? options.idempotencyKey);
        this.ensureActiveContextState(record.tenantId, record.subjectId, record.agentId, record.sessionId, record.updatedAt);
        return record;
      }
      if (options.idempotencyKey !== undefined) {
        const existing = this.getSessionByIdempotencyKey(record.tenantId, record.subjectId, record.agentId, options.idempotencyKey);
        if (existing !== undefined) {
          this.ensureActiveContextState(existing.tenantId, existing.subjectId, existing.agentId, existing.sessionId, existing.updatedAt);
          return existing;
        }
      }
      this.putSession(record, options.idempotencyKey);
      this.ensureActiveContextState(record.tenantId, record.subjectId, record.agentId, record.sessionId, record.updatedAt);
      return record;
    });
  }

  async deleteSessionCascade(request: DeleteSessionCascadeRequest): Promise<DeleteSessionCascadeResult> {
    try {
      return this.transaction(() => {
        const current = this.getSessionRow(request.tenantId, request.subjectId, request.agentId, request.sessionId);
        if (current === undefined) {
          return { status: 'NOT_FOUND' };
        }
        const activeRun = this.db
          .prepare(
            `SELECT 1 AS present FROM request_runs
             WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
               AND (status IN ('ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING')
                 OR terminal_commit_state IN ('PENDING', 'RETRYING'))
             LIMIT 1`,
          )
          .get(request.tenantId, request.subjectId, request.agentId, request.sessionId) as { readonly present: number } | undefined;
        if (activeRun !== undefined) {
          return { status: 'CONFLICT_ACTIVE_RUN' };
        }
        const params = [request.tenantId, request.subjectId, request.agentId, request.sessionId] as const;
        this.db
          .prepare('DELETE FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?')
          .run(...params);
        this.db.prepare('DELETE FROM conversation_shares WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.deleteForkPromotionsForChildSessionSync(...params);
        this.db.prepare('DELETE FROM session_forks WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND child_session_id = ?').run(...params);
        this.db
          .prepare('DELETE FROM session_fork_idempotency WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND child_session_id = ?')
          .run(...params);
        this.db
          .prepare('DELETE FROM fork_process_snapshot_statuses WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?')
          .run(...params);
        this.db.prepare('DELETE FROM active_context_items WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.db
          .prepare('DELETE FROM active_context_states WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?')
          .run(...params);
        this.db.prepare('DELETE FROM pending_inputs WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.db.prepare('DELETE FROM checkpoints WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.db.prepare('DELETE FROM timeline_events WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.db.prepare('DELETE FROM messages WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.db
          .prepare(
            `DELETE FROM request_run_memory_recall_attempts
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
             AND request_run_id IN (
               SELECT run_id FROM request_runs
               WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
             )`,
          )
          .run(request.tenantId, request.subjectId, request.agentId, request.tenantId, request.subjectId, request.agentId, request.sessionId);
        this.db.prepare('DELETE FROM request_runs WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        this.db.prepare('DELETE FROM sessions WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?').run(...params);
        return { status: 'DELETED' };
      });
    } catch (error) {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'SQLite storage unavailable',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    }
  }

  async listSessions(request: SessionHistoryRecordQuery): Promise<SessionHistoryPage> {
    const where = ['s.tenant_id = ?', 's.subject_id = ?', 's.agent_id = ?'];
    const params: Array<number | string> = [request.tenantId, request.subjectId, request.agentId];
    if (request.createdAtFrom !== undefined) {
      where.push('s.updated_at >= ?');
      params.push(Number(request.createdAtFrom));
    }
    if (request.createdAtTo !== undefined) {
      where.push('s.updated_at <= ?');
      params.push(Number(request.createdAtTo));
    }
    if (request.questionSearchText !== undefined) {
      where.push(
        `(instr(lower(COALESCE(s.title, '')), lower(?)) > 0
          OR EXISTS (
            SELECT 1 FROM messages m
            WHERE m.tenant_id = s.tenant_id
              AND m.subject_id = s.subject_id
              AND m.agent_id = s.agent_id
              AND m.session_id = s.session_id
              AND m.role = 'USER'
              AND m.visible = 1
              AND instr(lower(m.content), lower(?)) > 0
          ))`,
      );
      params.push(request.questionSearchText, request.questionSearchText);
    }
    const rows = this.db
      .prepare(
        `SELECT s.tenant_id, s.subject_id, s.agent_id, s.session_id, s.parent_session_id, s.parent_run_id, s.parent_request_id, s.title, s.title_source, s.created_at, s.updated_at
         FROM sessions s
         WHERE ${where.join(' AND ')}
         ORDER BY s.updated_at DESC, s.session_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, request.limit + 1, request.offset) as unknown as SessionRow[];
    const records = rows.slice(0, request.limit).map((row) => toSessionRecord(row));
    const page = records.map((record) => {
      const summary = this.loadSessionRunSummary(record);
      return {
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        sessionId: record.sessionId,
        ...(record.parentSessionId === undefined ? {} : { parentSessionId: record.parentSessionId }),
        ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }),
        ...(record.parentRequestId === undefined ? {} : { parentRequestId: record.parentRequestId }),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(summary.latestRunStatus === undefined ? {} : { latestRunStatus: summary.latestRunStatus }),
        hasInFlightRequest: summary.hasInFlightRequest,
        ...(record.title === undefined ? {} : { title: record.title }),
      };
    });
    return { entries: page, offset: request.offset, limit: request.limit, hasMore: rows.length > request.limit };
  }

  private loadSessionRunSummary(record: SessionRecord): { readonly latestRunStatus?: RunStatus; readonly hasInFlightRequest: boolean } {
    const latest = this.db
      .prepare(
        `SELECT status FROM request_runs
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
         ORDER BY updated_at DESC, created_at DESC, run_id DESC
         LIMIT 1`,
      )
      .get(record.tenantId, record.subjectId, record.agentId, record.sessionId) as { readonly status: RunStatus } | undefined;
    const inFlight = this.db
      .prepare(
        `SELECT 1 AS present FROM request_runs
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
           AND (status IN ('ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING')
             OR terminal_commit_state IN ('PENDING', 'RETRYING'))
         LIMIT 1`,
      )
      .get(record.tenantId, record.subjectId, record.agentId, record.sessionId) as { readonly present: number } | undefined;
    return {
      ...(latest === undefined ? {} : { latestRunStatus: latest.status }),
      hasInFlightRequest: inFlight !== undefined,
    };
  }

  async appendSessionMessage(record: SessionMessageRecord, options: IdempotentWriteOptions = {}): Promise<SessionMessageRecord> {
    return this.transaction(() => {
      const saved = this.saveMessageSync(record, options);
      this.appendActiveContextItemSync({
        tenantId: saved.tenantId,
        subjectId: saved.subjectId,
        agentId: saved.agentId,
        sessionId: saved.sessionId,
        messageId: saved.messageId,
      });
      return saved;
    });
  }

  async loadMessage(request: SessionMessageLookupRequest): Promise<SessionMessageRecord | undefined> {
    const row = this.db
      .prepare(
        'SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at FROM messages WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND message_id = ?',
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.messageId) as MessageRow | undefined;
    return row === undefined ? undefined : toSessionMessageRecord(row);
  }

  async loadMessages(
    request: import('@nextagent/agent-contracts/gateway').SessionMessagesBatchLookupRequest,
  ): Promise<ReadonlyArray<import('@nextagent/agent-contracts/gateway').SessionMessageRecord>> {
    const ids = request.messageIds;
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND message_id IN (${placeholders})`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, ...ids) as unknown as MessageRow[];
    return rows.map((row) => toSessionMessageRecord(row));
  }

  async listConversationPreview(request: ConversationPreviewRecordQuery): Promise<ConversationPreviewRecordPage> {
    if (
      (request.offset !== undefined && (request.offset < 0 || request.offset > CONVERSATION_PREVIEW_MAX_OFFSET)) ||
      request.limit < 1 ||
      request.limit > CONVERSATION_PREVIEW_MAX_PAGE_LIMIT
    ) {
      throw new AgentError({
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Conversation preview paging parameters are invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total_markers FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
           AND role = 'USER' AND visible = 1`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId) as { readonly total_markers: number } | undefined;
    const totalMarkers = totalRow?.total_markers ?? 0;
    const effectiveOffset = request.offset ?? Math.max(0, totalMarkers - request.limit);
    const rows = this.db
      .prepare(
        `SELECT message_id, request_id, content, created_at FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
           AND role = 'USER' AND visible = 1
         ORDER BY created_at ASC, message_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.limit, effectiveOffset) as unknown as Array<{
      readonly message_id: string;
      readonly request_id: string;
      readonly content: string;
      readonly created_at: number;
    }>;
    const answerPreviewByRequestId = new Map<string, { readonly text: string; readonly truncated: boolean }>();
    const requestIds = rows.map((row) => row.request_id);
    if (requestIds.length > 0) {
      const placeholders = requestIds.map(() => '?').join(', ');
      const answerRows = this.db
        .prepare(
          `SELECT request_id, content FROM messages
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
             AND role = 'ASSISTANT' AND visible = 1 AND request_id IN (${placeholders})
           ORDER BY request_id ASC, created_at DESC, message_id DESC`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.sessionId, ...requestIds) as unknown as Array<{
        readonly request_id: string;
        readonly content: string;
      }>;
      for (const answerRow of answerRows) {
        if (answerPreviewByRequestId.has(answerRow.request_id)) {
          continue;
        }
        answerPreviewByRequestId.set(answerRow.request_id, truncateCodePoints(answerRow.content, CONVERSATION_PREVIEW_TEXT_LIMIT));
      }
    }
    return {
      sessionId: request.sessionId,
      totalMarkers,
      offset: effectiveOffset,
      limit: request.limit,
      markers: rows.map((row) => {
        const preview = truncateCodePoints(row.content, CONVERSATION_PREVIEW_TEXT_LIMIT);
        const answerPreview = answerPreviewByRequestId.get(row.request_id);
        return {
          messageId: brand<string, 'MessageId'>(row.message_id),
          requestId: brand<string, 'MessageId'>(row.request_id),
          createdAt: brand<number, 'EpochMillis'>(row.created_at),
          previewText: preview.text,
          previewTruncated: preview.truncated,
          ...(answerPreview === undefined
            ? {}
            : {
                answerPreviewText: answerPreview.text,
                answerPreviewTruncated: answerPreview.truncated,
              }),
        };
      }),
    };
  }

  async listMessages(request: ListSessionMessagesRecordQuery): Promise<SessionMessageRecordPage> {
    const modeCount = [request.beforeCursor, request.afterCursor, request.anchorMessageId].filter((value) => value !== undefined).length;
    if (modeCount > 1) {
      throw new AgentError({
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Conversation cursors cannot be combined.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const selectMessages = (
      where: readonly string[],
      params: ReadonlyArray<number | string>,
      order: 'ASC' | 'DESC',
      limit: number,
    ): SessionMessageRecord[] =>
      (
        this.db
          .prepare(
            `SELECT m.tenant_id, m.subject_id, m.agent_id, m.message_id, m.session_id, m.request_id, m.run_id, m.role, m.content, m.content_type, m.metadata, m.visible, m.created_at
           FROM messages m
           WHERE ${where.join(' AND ')}
           ORDER BY m.created_at ${order}, m.message_id ${order}
           LIMIT ?`,
          )
          .all(...params, limit) as unknown as MessageRow[]
      ).map((row) => toSessionMessageRecord(row));
    const buildBase = (): { readonly where: string[]; readonly params: Array<number | string> } => {
      const where = ['m.tenant_id = ?', 'm.subject_id = ?', 'm.agent_id = ?', 'm.session_id = ?'];
      const params: Array<number | string> = [request.tenantId, request.subjectId, request.agentId, request.sessionId];
      if (request.requestId !== undefined) {
        where.push('m.request_id = ?');
        params.push(request.requestId);
      }
      if (request.runId !== undefined) {
        where.push('m.run_id = ?');
        params.push(request.runId);
      }
      if (!request.includeHidden) {
        where.push('m.visible = 1');
      }
      if (!request.includeCapabilityResults) {
        where.push("m.role <> 'CAPABILITY_RESULT'");
      }
      return { where, params };
    };
    const loadCursor = (messageId: string): { readonly createdAt: number; readonly messageId: string } | undefined => {
      const base = buildBase();
      const row = this.db
        .prepare(
          `SELECT m.created_at, m.message_id
           FROM messages m
           WHERE ${[...base.where, 'm.message_id = ?'].join(' AND ')}
           LIMIT 1`,
        )
        .get(...base.params, messageId) as { readonly created_at: number; readonly message_id: string } | undefined;
      return row === undefined ? undefined : { createdAt: row.created_at, messageId: row.message_id };
    };
    const beforeClause = (cursor: { readonly createdAt: number; readonly messageId: string }) =>
      ['(m.created_at < ? OR (m.created_at = ? AND m.message_id < ?))', cursor.createdAt, cursor.createdAt, cursor.messageId] as const;
    const afterClause = (cursor: { readonly createdAt: number; readonly messageId: string }) =>
      ['(m.created_at > ? OR (m.created_at = ? AND m.message_id > ?))', cursor.createdAt, cursor.createdAt, cursor.messageId] as const;
    const pageLimit = Math.max(0, request.limit);

    if (request.anchorMessageId !== undefined) {
      const anchorCursor = loadCursor(request.anchorMessageId);
      if (anchorCursor === undefined) {
        throw new AgentError({
          code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
          message: 'Conversation anchor message was not found.',
          category: 'NOT_FOUND',
          retryable: false,
        });
      }
      const anchor = selectMessages([...buildBase().where, 'm.message_id = ?'], [...buildBase().params, request.anchorMessageId], 'ASC', 1)[0];
      if (anchor === undefined) {
        throw new AgentError({
          code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
          message: 'Conversation anchor message was not found.',
          category: 'NOT_FOUND',
          retryable: false,
        });
      }
      const beforeTarget = Math.floor(Math.max(0, pageLimit - 1) / 2);
      const afterTarget = Math.max(0, pageLimit - 1 - beforeTarget);
      const beforeBase = buildBase();
      const before = beforeClause(anchorCursor);
      const beforeRows = selectMessages(
        [...beforeBase.where, before[0]],
        [...beforeBase.params, before[1], before[2], before[3]],
        'DESC',
        Math.max(0, pageLimit),
      );
      const afterBase = buildBase();
      const after = afterClause(anchorCursor);
      const afterRows = selectMessages(
        [...afterBase.where, after[0]],
        [...afterBase.params, after[1], after[2], after[3]],
        'ASC',
        Math.max(0, pageLimit),
      );
      let beforeTake = Math.min(beforeRows.length, beforeTarget);
      let afterTake = Math.min(afterRows.length, afterTarget);
      let remaining = Math.max(0, pageLimit - 1 - beforeTake - afterTake);
      const extraAfter = Math.min(afterRows.length - afterTake, remaining);
      afterTake += extraAfter;
      remaining -= extraAfter;
      beforeTake += Math.min(beforeRows.length - beforeTake, remaining);
      const items = [...beforeRows.slice(0, beforeTake).reverse(), anchor, ...afterRows.slice(0, afterTake)].slice(0, pageLimit);
      const hasOlder = beforeRows.length > beforeTake;
      const hasNewer = afterRows.length > afterTake;
      const newestItem = items[items.length - 1];
      return {
        items,
        limit: request.limit,
        hasMore: hasOlder,
        ...(hasOlder && items[0]?.messageId !== undefined ? { nextBeforeCursor: items[0].messageId } : {}),
        ...(hasNewer && newestItem !== undefined ? { newerCursor: newestItem.messageId } : {}),
      };
    }

    if (request.afterCursor !== undefined) {
      const cursor = loadCursor(request.afterCursor);
      if (cursor === undefined) {
        return { items: [], limit: request.limit, hasMore: false };
      }
      const base = buildBase();
      const after = afterClause(cursor);
      const rows = selectMessages([...base.where, after[0]], [...base.params, after[1], after[2], after[3]], 'ASC', pageLimit + 1);
      const items = rows.slice(0, pageLimit);
      const newestItem = items[items.length - 1];
      return {
        items,
        limit: request.limit,
        hasMore: false,
        ...(rows.length > pageLimit && newestItem !== undefined ? { newerCursor: newestItem.messageId } : {}),
      };
    }

    if (request.beforeCursor !== undefined) {
      const cursor = loadCursor(request.beforeCursor);
      if (cursor === undefined) {
        return { items: [], limit: request.limit, hasMore: false };
      }
      const base = buildBase();
      const before = beforeClause(cursor);
      const rows = selectMessages([...base.where, before[0]], [...base.params, before[1], before[2], before[3]], 'DESC', pageLimit + 1);
      const items = rows.slice(0, pageLimit).reverse();
      return {
        items,
        limit: request.limit,
        hasMore: rows.length > pageLimit,
        ...(rows.length > pageLimit && items[0]?.messageId !== undefined ? { nextBeforeCursor: items[0].messageId } : {}),
      };
    }

    const base = buildBase();
    const rows = selectMessages(base.where, base.params, 'DESC', pageLimit + 1);
    const items = rows.slice(0, pageLimit).reverse();
    return {
      items,
      limit: request.limit,
      hasMore: rows.length > pageLimit,
      ...(rows.length > pageLimit && items[0]?.messageId !== undefined ? { nextBeforeCursor: items[0].messageId } : {}),
    };
  }

  async listCurrentRequestMessages(request: ListCurrentRequestMessagesRecordQuery): Promise<SessionMessageRecordPage> {
    const items = (
      this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_id = ? AND run_id = ?
         ORDER BY created_at ASC, message_id ASC
         LIMIT ? OFFSET ?`,
        )
        .all(
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.sessionId,
          request.requestId,
          request.runId,
          request.limit,
          request.offset,
        ) as unknown as MessageRow[]
    )
      .map((row) => toSessionMessageRecord(row))
      .filter((message) => request.includeHidden || message.visible);
    return { items, limit: request.limit, hasMore: items.length === request.limit };
  }

  async hideMessage(request: HideMessageRequest): Promise<SessionMessageRecord | undefined> {
    try {
      return this.transaction(() => {
        const row = this.db
          .prepare(
            'SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at FROM messages WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND message_id = ?',
          )
          .get(request.tenantId, request.subjectId, request.agentId, request.messageId) as MessageRow | undefined;
        if (row === undefined) {
          return undefined;
        }
        const current = toSessionMessageRecord(row);
        if (!current.visible) {
          return current;
        }
        const hidden: SessionMessageRecord = {
          ...current,
          visible: false,
          metadata: {
            ...current.metadata,
            visibility: {
              reason: request.reason,
              hiddenByContextId: request.hiddenByContextId,
            },
          },
        };
        this.db
          .prepare('UPDATE messages SET visible = 0, metadata = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND message_id = ?')
          .run(JSON.stringify(hidden.metadata), request.tenantId, request.subjectId, request.agentId, request.messageId);
        return hidden;
      });
    } catch (error) {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'SQLite storage unavailable',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    }
  }

  async hideRequestMessages(request: HideRequestMessagesRequest): Promise<number> {
    try {
      return this.transaction(() => {
        const rows = this.db
          .prepare(
            `SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at FROM messages
             WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_id = ? AND visible = 1
             ORDER BY created_at ASC, message_id ASC`,
          )
          .all(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.requestId) as unknown as MessageRow[];
        const update = this.db.prepare(
          'UPDATE messages SET visible = 0, metadata = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_id = ? AND message_id = ? AND visible = 1',
        );
        let hiddenCount = 0;
        for (const row of rows) {
          const current = toSessionMessageRecord(row);
          const metadata = {
            ...current.metadata,
            visibility: {
              reason: request.reason,
              hiddenByContextId: request.hiddenByContextId,
            },
          };
          const result = update.run(
            JSON.stringify(metadata),
            request.tenantId,
            request.subjectId,
            request.agentId,
            request.sessionId,
            request.requestId,
            current.messageId,
          );
          hiddenCount += Number(result.changes);
        }
        return hiddenCount;
      });
    } catch (error) {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'SQLite storage unavailable',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    }
  }

  async listSessionMessagePrefixThroughAnchor(request: LocalListSessionMessagePrefixThroughAnchorQuery): Promise<readonly SessionMessageRecord[]> {
    const anchor = this.db
      .prepare(
        `SELECT created_at, message_id FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND message_id = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.anchorMessageId) as
      { readonly created_at: number; readonly message_id: string } | undefined;
    if (anchor === undefined) {
      throw new AgentError({
        code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
        message: 'Fork source anchor message was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    return (
      this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at
         FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
           AND (created_at < ? OR (created_at = ? AND message_id <= ?))
         ORDER BY created_at ASC, message_id ASC`,
        )
        .all(
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.sessionId,
          anchor.created_at,
          anchor.created_at,
          anchor.message_id,
        ) as unknown as MessageRow[]
    ).map((row) => toSessionMessageRecord(row));
  }

  async materializeForkSession(request: LocalForkSessionMaterializationRequest): Promise<LocalForkSessionMaterializationResult> {
    return this.transaction(() => {
      const existing = this.loadForkedSessionByIdempotencySync(request);
      if (existing !== undefined) {
        return { childSession: existing, replayed: true };
      }
      this.validateForkWrite(request);
      this.putSession(request.childSession, null);
      this.ensureActiveContextState(
        request.tenantId,
        request.subjectId,
        request.agentId,
        request.childSession.sessionId,
        request.childSession.updatedAt,
      );
      this.db
        .prepare(
          `UPDATE active_context_states
           SET active_context_version = 0, updated_at = ?, metadata = NULL
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
        )
        .run(Number(request.childSession.updatedAt), request.tenantId, request.subjectId, request.agentId, request.childSession.sessionId);
      for (const message of request.copiedMessages) {
        this.saveMessageSync(message, {});
      }
      this.replaceActiveContextItemsSync(
        request.tenantId,
        request.subjectId,
        request.agentId,
        request.childSession.sessionId,
        request.activeContextMessageIds,
      );
      for (const snapshot of request.copiedTimelineEvents ?? []) {
        this.appendTimelineEventSync(
          {
            ...snapshot,
            sequence: brand<number, 'TimelineSequence'>(0),
          },
          {},
          true,
        );
      }
      for (const status of request.copiedRunProcessStatuses ?? []) {
        this.db
          .prepare(
            `INSERT INTO fork_process_snapshot_statuses(
              tenant_id, subject_id, agent_id, session_id, request_id, run_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(status.tenantId, status.subjectId, status.agentId, status.sessionId, status.requestId, status.runId, status.status);
      }
      this.db
        .prepare(
          `INSERT INTO session_forks(
            tenant_id, subject_id, agent_id, child_session_id, source_session_id,
            source_anchor_message_id, child_anchor_message_id, source_session_title_snapshot, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.forkSource.childSessionId,
          request.forkSource.sourceSessionId,
          request.forkSource.sourceAnchorMessageId,
          request.forkSource.childAnchorMessageId,
          request.forkSource.sourceSessionTitleSnapshot,
          Number(request.forkSource.createdAt),
        );
      this.db
        .prepare(
          `INSERT INTO session_fork_idempotency(
            tenant_id, subject_id, agent_id, source_session_id, source_anchor_message_id,
            idempotency_key, child_session_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.sourceSessionId,
          request.sourceAnchorMessageId,
          request.idempotencyKey,
          request.childSession.sessionId,
          Number(request.forkSource.createdAt),
        );
      const stagedPromotions = this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                  source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                  ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
           FROM fork_promoted_contents
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
             AND fork_attempt_id = ? AND status = 'STAGED'`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.forkAttemptId) as unknown as ForkPromotedContentRow[];
      if (stagedPromotions.length !== request.promotionBindings.length) {
        throw new AgentError({
          code: 'SESSION_FORK_PROMOTION_UNAVAILABLE',
          message: 'Fork promotion staging does not match the required source refs.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const stagedBySource = new Map(stagedPromotions.map((item) => [`${item.source_message_id}\0${item.source_ref_id}`, item]));
      const seenPromotions = new Set<string>();
      for (const binding of request.promotionBindings) {
        const promotion = stagedBySource.get(`${binding.sourceMessageId}\0${binding.sourceRefId}`);
        if (
          promotion === undefined ||
          promotion.promoted_content_id !== binding.promotedContentId ||
          seenPromotions.has(promotion.promoted_content_id)
        ) {
          throw new AgentError({
            code: 'SESSION_FORK_PROMOTION_UNAVAILABLE',
            message: 'Fork promotion staging does not match the required source refs.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        seenPromotions.add(promotion.promoted_content_id);
        this.db
          .prepare(
            `UPDATE fork_promoted_contents
             SET child_session_id = ?, child_message_id = ?
             WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND promoted_content_id = ? AND status = 'STAGED'`,
          )
          .run(
            request.childSession.sessionId,
            binding.childMessageId,
            request.tenantId,
            request.subjectId,
            request.agentId,
            promotion.promoted_content_id,
          );
      }
      for (const promotion of stagedPromotions) {
        this.assertForkPromotionBlobExistsSync(promotion);
      }
      this.db
        .prepare(
          `UPDATE fork_promoted_contents
           SET status = 'COMMITTED', committed_at = ?
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
             AND fork_attempt_id = ? AND child_session_id = ? AND status = 'STAGED'`,
        )
        .run(
          Number(request.forkSource.createdAt),
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.forkAttemptId,
          request.childSession.sessionId,
        );
      const persistedChild = this.getSessionRow(request.tenantId, request.subjectId, request.agentId, request.childSession.sessionId);
      if (persistedChild === undefined) {
        throw new AgentError({
          code: 'SESSION_FORK_INTERNAL',
          message: 'Fork child session was not persisted.',
          category: 'INTERNAL',
          retryable: true,
        });
      }
      return { childSession: toSessionRecord(persistedChild), replayed: false };
    });
  }

  async listStagedForkPromotions(request: ForkPromotionAbortRequest): Promise<readonly LocalForkPromotedContentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
         FROM fork_promoted_contents
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND fork_attempt_id = ? AND status = 'STAGED'
         ORDER BY source_message_id ASC, source_ref_id ASC`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, request.forkAttemptId) as unknown as ForkPromotedContentRow[];
    return rows.map(toForkPromotedContentRecord);
  }

  async loadSessionForkSource(request: LoadSessionForkSourceRequest): Promise<SessionForkSourceRecord | undefined> {
    const row = this.getSessionForkRow(request.tenantId, request.subjectId, request.agentId, request.childSessionId);
    return row === undefined ? undefined : toSessionForkSourceRecord(row);
  }

  async loadForkProcessSnapshotStatus(request: LoadForkProcessSnapshotStatusRequest): Promise<ForkProcessSnapshotStatusRecord | undefined> {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, session_id, request_id, run_id, status
         FROM fork_process_snapshot_statuses
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND run_id = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.runId) as ForkProcessSnapshotStatusRow | undefined;
    return row === undefined ? undefined : toForkProcessSnapshotStatusRecord(row);
  }

  async listForkProcessSnapshotStatuses(request: LocalListForkProcessSnapshotStatusesRequest): Promise<readonly ForkProcessSnapshotStatusRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, session_id, request_id, run_id, status
         FROM fork_process_snapshot_statuses
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
         ORDER BY run_id ASC`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.sessionId) as unknown as ForkProcessSnapshotStatusRow[]
    ).map(toForkProcessSnapshotStatusRecord);
  }

  async loadForkedSessionByIdempotency(request: LocalLoadForkedSessionByIdempotencyRequest): Promise<SessionRecord | undefined> {
    return this.loadForkedSessionByIdempotencySync(request);
  }

  async hasUserMessageAfterForkAnchor(request: HasUserMessageAfterForkAnchorRequest): Promise<boolean> {
    const fork = this.getSessionForkRow(request.tenantId, request.subjectId, request.agentId, request.childSessionId);
    if (fork === undefined) {
      return false;
    }
    const anchor = this.db
      .prepare(
        `SELECT created_at, message_id FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND message_id = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.childSessionId, fork.child_anchor_message_id) as
      { readonly created_at: number; readonly message_id: string } | undefined;
    if (anchor === undefined) {
      return false;
    }
    const row = this.db
      .prepare(
        `SELECT 1 AS present FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
           AND role = 'USER' AND visible = 1
           AND (created_at > ? OR (created_at = ? AND message_id > ?))
         LIMIT 1`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.childSessionId, anchor.created_at, anchor.created_at, anchor.message_id) as
      { readonly present: number } | undefined;
    return row !== undefined;
  }

  async stageForkPromotion(request: StageForkPromotionRequest): Promise<StageForkPromotionResult> {
    if (request.sizeBytes !== request.bytes.byteLength) {
      throw new AgentError({
        code: 'SESSION_FORK_REQUEST_INVALID',
        message: 'Fork promotion sizeBytes must match bytes length.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    return this.transaction(() => {
      const digest = createHash('sha256').update(request.bytes).digest('hex');
      const existing = this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                  source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                  ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
           FROM fork_promoted_contents
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
             AND fork_attempt_id = ? AND source_message_id = ? AND source_ref_id = ?`,
        )
        .get(request.tenantId, request.subjectId, request.agentId, request.forkAttemptId, request.sourceMessageId, request.sourceRefId) as
        ForkPromotedContentRow | undefined;
      if (existing !== undefined) {
        const blob = this.db
          .prepare('SELECT bytes FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
          .get(existing.tenant_id, existing.subject_id, existing.blob_ref) as Pick<BlobRow, 'bytes'> | undefined;
        if (
          existing.status !== 'ABORTED' &&
          existing.source_session_id === request.sourceSessionId &&
          existing.ref_type === request.refType &&
          existing.mime_type === request.mimeType &&
          existing.size_bytes === request.sizeBytes &&
          existing.content_digest === digest &&
          blob !== undefined &&
          Buffer.from(blob.bytes).equals(Buffer.from(request.bytes))
        ) {
          return {
            forkAttemptId: request.forkAttemptId,
            sourceMessageId: request.sourceMessageId,
            sourceRefId: request.sourceRefId,
            promotedContentId: existing.promoted_content_id,
          };
        }
        throw new AgentError({
          code: 'SESSION_FORK_PROMOTION_CONFLICT',
          message: 'Fork promotion conflicts with previously staged content.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      const existingAttempt = this.db
        .prepare(
          `SELECT source_session_id
           FROM fork_promoted_contents
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND fork_attempt_id = ?
           LIMIT 1`,
        )
        .get(request.tenantId, request.subjectId, request.agentId, request.forkAttemptId) as { readonly source_session_id: string } | undefined;
      if (existingAttempt !== undefined && existingAttempt.source_session_id !== request.sourceSessionId) {
        throw new AgentError({
          code: 'SESSION_FORK_PROMOTION_UNAVAILABLE',
          message: 'Fork promotion attempt is already bound to another source session.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const stagedTotal = this.db
        .prepare(
          `SELECT COALESCE(SUM(size_bytes), 0) AS total
           FROM fork_promoted_contents
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND fork_attempt_id = ? AND status = 'STAGED'`,
        )
        .get(request.tenantId, request.subjectId, request.agentId, request.forkAttemptId) as { readonly total: number };
      if (Number(stagedTotal.total) + request.sizeBytes > 2_000_000) {
        throw new AgentError({
          code: 'SESSION_FORK_PROMOTED_CONTENT_TOO_LARGE',
          message: 'Fork promoted content exceeds the provider budget.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const promotedContentId = `fork-promoted:${randomUUID()}`;
      const createdAt = nowEpoch();
      const blobRef = this.storeBlobSync(
        request.tenantId,
        request.subjectId,
        request.refType,
        request.bytes,
        brand<string, 'IdempotencyKey'>(`fork-promotion:${request.forkAttemptId}:${promotedContentId}`),
      );
      this.db
        .prepare(
          `INSERT INTO fork_promoted_contents(
            tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
            source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
            ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, 'STAGED', ?, NULL, NULL)`,
        )
        .run(
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.forkAttemptId,
          promotedContentId,
          request.sourceSessionId,
          request.sourceMessageId,
          request.sourceRefId,
          request.refType,
          blobRef,
          request.mimeType,
          request.sizeBytes,
          digest,
          Number(createdAt),
        );
      const row = this.getForkPromotionRow(request.tenantId, request.subjectId, request.agentId, promotedContentId);
      if (row === undefined) {
        throw new AgentError({
          code: 'SESSION_FORK_INTERNAL',
          message: 'Fork promotion metadata was not persisted.',
          category: 'INTERNAL',
          retryable: true,
        });
      }
      return {
        forkAttemptId: request.forkAttemptId,
        sourceMessageId: request.sourceMessageId,
        sourceRefId: request.sourceRefId,
        promotedContentId: row.promoted_content_id,
      };
    });
  }

  async loadCommittedForkPromotionContent(request: LoadCommittedForkPromotionContentRequest): Promise<ForkPromotionContent | undefined> {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
         FROM fork_promoted_contents
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
           AND child_session_id = ? AND child_message_id = ? AND promoted_content_id = ? AND status = 'COMMITTED'`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.childSessionId, request.childMessageId, request.promotedContentId) as
      ForkPromotedContentRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const blob = this.db
      .prepare('SELECT bytes FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .get(row.tenant_id, row.subject_id, row.blob_ref) as Pick<BlobRow, 'bytes'> | undefined;
    if (blob === undefined) {
      return undefined;
    }
    return {
      refType: row.ref_type as ForkPromotionContent['refType'],
      bytes: blob.bytes,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
    };
  }

  async abortForkPromotions(request: ForkPromotionAbortRequest): Promise<void> {
    const candidates = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
         FROM fork_promoted_contents
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
           AND fork_attempt_id = ? AND status = 'STAGED'`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, request.forkAttemptId) as unknown as ForkPromotedContentRow[];
    const abortedAt = nowEpoch();
    for (const candidate of candidates) {
      const result = this.db
        .prepare(
          `UPDATE fork_promoted_contents
           SET status = 'ABORTED', aborted_at = COALESCE(aborted_at, ?)
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
             AND promoted_content_id = ? AND status = 'STAGED'`,
        )
        .run(Number(abortedAt), candidate.tenant_id, candidate.subject_id, candidate.agent_id, candidate.promoted_content_id);
      if (result.changes === 0) {
        continue;
      }
      try {
        this.deleteBlobSync({
          tenantId: brand<string, 'TenantId'>(candidate.tenant_id),
          subjectId: brand<string, 'SubjectId'>(candidate.subject_id),
          blobRef: brand<string, 'BlobRef'>(candidate.blob_ref),
        });
      } catch {
        // The ABORTED metadata remains non-resolvable and retryable by scheduled cleanup.
      }
    }
  }

  async cleanupExpiredForkPromotions(request: ForkPromotionCleanupRequest): Promise<ForkPromotionCleanupResult> {
    const cutoff = Number(request.now) - Math.max(0, Math.trunc(request.retentionMs));
    const candidates = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
         FROM fork_promoted_contents
         WHERE status IN ('STAGED', 'ABORTED') AND created_at < ?
         ORDER BY created_at ASC, promoted_content_id ASC
         LIMIT 1000`,
      )
      .all(cutoff) as unknown as ForkPromotedContentRow[];
    let cleanedCount = 0;
    let retryableCount = 0;
    for (const candidate of candidates) {
      try {
        if (candidate.status === 'STAGED') {
          const result = this.db
            .prepare(
              `UPDATE fork_promoted_contents
               SET status = 'ABORTED', aborted_at = COALESCE(aborted_at, ?)
               WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
                 AND promoted_content_id = ? AND status = 'STAGED'`,
            )
            .run(Number(request.now), candidate.tenant_id, candidate.subject_id, candidate.agent_id, candidate.promoted_content_id);
          if (result.changes === 0) {
            continue;
          }
        }
        const deleted = this.deleteBlobSync({
          tenantId: brand<string, 'TenantId'>(candidate.tenant_id),
          subjectId: brand<string, 'SubjectId'>(candidate.subject_id),
          blobRef: brand<string, 'BlobRef'>(candidate.blob_ref),
        });
        if (!deleted) {
          const exists = this.blobExistsSync(candidate.tenant_id, candidate.subject_id, candidate.blob_ref);
          if (exists) {
            retryableCount += 1;
            continue;
          }
        }
        this.db
          .prepare(
            `DELETE FROM fork_promoted_contents
             WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND promoted_content_id = ?
               AND status = 'ABORTED'`,
          )
          .run(candidate.tenant_id, candidate.subject_id, candidate.agent_id, candidate.promoted_content_id);
        cleanedCount += 1;
      } catch {
        retryableCount += 1;
      }
    }
    return { cleanedCount, retryableCount };
  }

  async saveAttachment(record: RequestAttachmentRecord): Promise<RequestAttachmentRecord> {
    return this.transaction(() => {
      this.putAttachment(record);
      return record;
    });
  }

  async loadAttachment(request: LoadAttachmentRequest): Promise<RequestAttachmentRecord | undefined> {
    const row = this.db
      .prepare(
        'SELECT tenant_id, subject_id, agent_id, attachment_id, session_id, request_id, run_id, file_name, media_type, size_bytes, storage_ref, validation_status, availability_status, created_at FROM attachments WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND attachment_id = ?',
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.attachmentId) as AttachmentRow | undefined;
    return row === undefined ? undefined : toAttachmentRecord(row);
  }

  async listAttachmentsByRequestId(request: ListAttachmentsByRequestIdRequest): Promise<readonly RequestAttachmentRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, attachment_id, session_id, request_id, run_id, file_name, media_type, size_bytes, storage_ref, validation_status, availability_status, created_at FROM attachments
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND request_id = ?
         ORDER BY created_at ASC, attachment_id ASC`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.requestId) as unknown as AttachmentRow[]
    ).map((row) => toAttachmentRecord(row));
  }

  async listAttachmentsByRunId(request: ListAttachmentsByRunIdRequest): Promise<readonly RequestAttachmentRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, attachment_id, session_id, request_id, run_id, file_name, media_type, size_bytes, storage_ref, validation_status, availability_status, created_at FROM attachments
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND run_id = ?
         ORDER BY created_at ASC, attachment_id ASC`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.runId) as unknown as AttachmentRow[]
    ).map((row) => toAttachmentRecord(row));
  }

  async listAttachmentsBySession(request: ListAttachmentsBySessionRequest): Promise<readonly RequestAttachmentRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, attachment_id, session_id, request_id, run_id, file_name, media_type, size_bytes, storage_ref, validation_status, availability_status, created_at FROM attachments
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
         ORDER BY created_at ASC, attachment_id ASC`,
        )
        .all(request.tenantId, request.subjectId, request.agentId, request.sessionId) as unknown as AttachmentRow[]
    ).map((row) => toAttachmentRecord(row));
  }

  async updateAttachmentStatus(request: UpdateAttachmentStatusRequest): Promise<RequestAttachmentRecord | undefined> {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT tenant_id, subject_id, agent_id, attachment_id, session_id, request_id, run_id, file_name, media_type, size_bytes, storage_ref, validation_status, availability_status, created_at FROM attachments WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND attachment_id = ?',
        )
        .get(request.tenantId, request.subjectId, request.agentId, request.attachmentId) as AttachmentRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      const current = toAttachmentRecord(row);
      const updated: RequestAttachmentRecord = {
        ...current,
        validationStatus: request.validationStatus,
        availabilityStatus: request.availabilityStatus,
      };
      this.putAttachment(updated);
      return updated;
    });
  }

  async reserveAttachmentIntake(request: ReserveAttachmentIntakeRequest): Promise<AttachmentIntakeReservationResult> {
    return this.transaction(() => {
      const existing = this.getAttachmentIntakeReservationByKey(request);
      if (existing !== undefined) {
        if (existing.commandSemanticHash !== request.commandSemanticHash) {
          return { status: 'SEMANTIC_CONFLICT' };
        }
        return { status: 'REPLAY', record: existing };
      }
      const record: AttachmentIntakeReservationRecord = {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        reservationId: request.create.reservationId,
        sessionId: request.sessionId,
        requestId: request.create.requestId,
        runId: request.create.runId,
        requestContextId: request.create.requestContextId,
        action: request.action,
        commandSemanticHash: request.commandSemanticHash,
        status: 'RESERVED',
        attachmentIds: [],
        createdAt: request.create.createdAt,
        updatedAt: request.create.createdAt,
      };
      this.putAttachmentIntakeReservation(record, request.idempotencyKey);
      return { status: 'RESERVED', record };
    });
  }

  async completeAttachmentIntakeReservation(
    request: CompleteAttachmentIntakeReservationRequest,
  ): Promise<AttachmentIntakeReservationRecord | undefined> {
    return this.transaction(() => {
      const current = this.getAttachmentIntakeReservationById(request.tenantId, request.subjectId, request.agentId, request.reservationId);
      if (current === undefined) {
        return undefined;
      }
      if (current.status !== 'RESERVED') {
        return current;
      }
      const updated: AttachmentIntakeReservationRecord = {
        ...current,
        status: request.status,
        attachmentIds: request.attachmentIds,
        ...(request.rejectionReasonCode === undefined ? {} : { rejectionReasonCode: request.rejectionReasonCode }),
        ...(request.safeError === undefined ? {} : { safeError: request.safeError }),
        updatedAt: request.updatedAt,
      };
      this.updateAttachmentIntakeReservationOutcome(updated);
      return updated;
    });
  }

  async storeBlob(request: StoreBlobRequest): Promise<BlobRef> {
    const bytes = await readFile(request.localFilePath);
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT blob_ref FROM blobs WHERE tenant_id = ? AND subject_id = ? AND idempotency_key = ?')
        .get(request.tenantId, request.subjectId, request.idempotencyKey) as Pick<BlobRow, 'blob_ref'> | undefined;
      if (existing !== undefined) {
        return brand<string, 'BlobRef'>(existing.blob_ref);
      }
      const blobRef = request.blobRef;
      this.db
        .prepare(
          `INSERT INTO blobs(tenant_id, subject_id, blob_ref, purpose, bytes, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(request.tenantId, request.subjectId, blobRef, request.purpose, bytes, request.idempotencyKey, Number(nowEpoch()));
      return blobRef;
    });
  }

  async loadBlob(request: LoadBlobRequest): Promise<Uint8Array | undefined> {
    const row = this.db
      .prepare('SELECT bytes FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .get(request.tenantId, request.subjectId, request.blobRef) as Pick<BlobRow, 'bytes'> | undefined;
    return row?.bytes;
  }

  async materializeBlob(request: import('@nextagent/agent-contracts/gateway').MaterializeBlobRequest): Promise<boolean> {
    const metadata = this.db
      .prepare('SELECT length(bytes) AS byte_length FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .get(request.tenantId, request.subjectId, request.blobRef) as { readonly byte_length: number } | undefined;
    if (metadata === undefined) {
      return false;
    }
    await mkdir(dirname(request.localFilePath), { recursive: true });
    const file = await open(request.localFilePath, 'w');
    try {
      const chunkSize = 64 * 1024;
      for (let offset = 1; offset <= metadata.byte_length; offset += chunkSize) {
        const chunk = this.db
          .prepare('SELECT substr(bytes, ?, ?) AS bytes FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
          .get(offset, chunkSize, request.tenantId, request.subjectId, request.blobRef) as { readonly bytes: Uint8Array } | undefined;
        if (chunk === undefined) {
          throw new Error('Attachment blob disappeared during materialization.');
        }
        await file.write(chunk.bytes);
      }
      return true;
    } catch (error) {
      await rm(request.localFilePath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await file.close();
    }
  }

  async blobExists(request: LoadBlobRequest): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 AS present FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .get(request.tenantId, request.subjectId, request.blobRef) as { readonly present: number } | undefined;
    return row !== undefined;
  }

  async deleteBlob(request: DeleteBlobRequest): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .run(request.tenantId, request.subjectId, request.blobRef);
    return result.changes > 0;
  }

  async copyBlob(request: CopyBlobRequest): Promise<CopyBlobResult> {
    return this.transaction(() => {
      const source = this.db.prepare('SELECT bytes, tenant_id, subject_id FROM blobs WHERE blob_ref = ?').get(request.sourceBlob) as
        { bytes: Uint8Array; tenant_id: string; subject_id: string } | undefined;
      if (source === undefined) {
        throw new Error('Source blob not found: ' + request.sourceBlob);
      }
      const newRef = brand<string, 'BlobRef'>(`blob-${randomUUID()}`);
      this.db
        .prepare('INSERT INTO blobs(tenant_id, subject_id, blob_ref, purpose, bytes, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(source.tenant_id, source.subject_id, newRef, 'ATTACHMENT', source.bytes, `copy-${randomUUID()}`, Number(nowEpoch()));
      return { blobRef: newRef, etag: newRef, lastModified: brand<number, 'EpochMillis'>(Number(nowEpoch())) };
    });
  }

  async getBlobMetadata(request: BlobMetadataRequest): Promise<BlobMetadata | undefined> {
    const row = this.db.prepare('SELECT blob_ref, length(bytes) as content_length, created_at FROM blobs WHERE blob_ref = ?').get(request.blobRef) as
      { blob_ref: string; content_length: number; created_at: number } | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      blobRef: brand<string, 'BlobRef'>(row.blob_ref),
      contentLength: row.content_length,
      lastModified: brand<number, 'EpochMillis'>(row.created_at),
    };
  }

  async listBlobs(request: ListBlobsRequest): Promise<ListBlobsResult> {
    const maxKeys = request.maxKeys ?? 100;
    const rows = this.db
      .prepare('SELECT blob_ref, length(bytes) as content_length FROM blobs WHERE blob_ref LIKE ? LIMIT ?')
      .all(request.prefix + '%', maxKeys + 1) as Array<{ blob_ref: string; content_length: number }>;
    const truncated = rows.length > maxKeys;
    const blobs = rows.slice(0, maxKeys).map((row) => ({
      blobRef: brand<string, 'BlobRef'>(row.blob_ref),
      size: row.content_length,
    }));
    return { blobs, truncated };
  }

  async loadActiveContext(request: SessionLookupRequest): Promise<ActiveContextViewRecord> {
    return this.transaction(() => this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId));
  }

  async appendItem(request: AppendActiveContextItemRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
    return this.transaction(() => {
      const current = this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId);
      if (current.items.some((item) => item.messageId === request.messageId)) {
        return { status: 'UPDATED', record: current };
      }
      if (current.state.activeContextVersion !== request.expectedActiveContextVersion) {
        return { status: 'VERSION_CONFLICT', record: current };
      }
      this.insertActiveContextItemSync(current, request.messageId);
      return { status: 'UPDATED', record: this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId) };
    });
  }

  async commitCompaction(request: ContextCompactionCommitRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
    // Per add-ts-context-compression §3 (gateway commit):
    //   1. Verify version → on mismatch, return VERSION_CONFLICT
    //      without writing summary or mutating active context.
    //   2. Persist the summary SessionMessage.
    //   3. Atomically replace active context items with
    //      [summaryMessageId, ...retainedTailMessageIds].
    //   4. Bump activeContextVersion.
    //   5. Touch the session updatedAt.
    //   All four mutations run inside a single transaction; on any
    //   failure the entire commit is rolled back and the active
    //   context remains at the pre-commit version.
    const current = await this.loadActiveContext(request);
    if (current.state.activeContextVersion !== request.expectedActiveContextVersion) {
      return { status: 'VERSION_CONFLICT', record: current };
    }
    const result = this.transaction(() => {
      this.saveMessageSync(request.summaryMessage, request.idempotencyKey !== undefined ? { idempotencyKey: request.idempotencyKey } : {});
      this.replaceActiveContextItemsSync(current.state.tenantId, current.state.subjectId, current.state.agentId, current.state.sessionId, [
        request.summaryMessage.messageId,
        ...request.retainedTailMessageIds,
      ]);
      this.bumpActiveContextVersionSync(current.state.tenantId, current.state.subjectId, current.state.agentId, current.state.sessionId);
      return this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId);
    });
    return { status: 'UPDATED', record: result };
  }

  async updateMetadata(request: ActiveContextMetadataUpdateRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
    return this.transaction(() => {
      const current = this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId);
      if (current.state.activeContextVersion !== request.expectedActiveContextVersion) {
        return { status: 'VERSION_CONFLICT', record: current };
      }
      this.db
        .prepare(`UPDATE active_context_states SET metadata = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`)
        .run(JSON.stringify(request.metadata), request.tenantId, request.subjectId, request.agentId, request.sessionId);
      return { status: 'UPDATED', record: this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId) };
    });
  }

  async appendEvent(record: RunTimelineEventRecord, options: IdempotentWriteOptions = {}): Promise<RunTimelineEventRecord> {
    return this.transaction(() => this.appendTimelineEventSync(record, options, false));
  }

  async listEvents(request: RunTimelineEventRecordQuery): Promise<readonly RunTimelineEventRecord[]> {
    const filters: string[] = [];
    const values: Array<string | number> = [request.tenantId, request.subjectId, request.agentId, request.sessionId, Number(request.afterSequence)];
    if (request.requestId !== undefined) {
      filters.push('AND request_id = ?');
      values.push(request.requestId);
    }
    if (request.runId !== undefined) {
      filters.push('AND run_id = ?');
      values.push(request.runId);
    }
    if (request.recordOrigin === 'FORK_SNAPSHOT') {
      filters.push("AND json_extract(json, '$.recordOrigin') = 'FORK_SNAPSHOT'");
    } else {
      filters.push("AND json_extract(json, '$.recordOrigin') IS NULL");
    }
    values.push(safeQueryLimit(request.limit));
    return (
      this.db
        .prepare(
          `SELECT json FROM timeline_events
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND sequence > ?
         ${filters.join('\n         ')}
         ORDER BY sequence ASC
         LIMIT ?`,
        )
        .all(...values) as unknown as JsonRow[]
    ).map((row) => JSON.parse(row.json) as RunTimelineEventRecord);
  }

  async saveTaskTrajectory(record: SaveTaskTrajectoryRequest, options: IdempotentWriteOptions = {}): Promise<TaskTrajectoryRecord | SafeError> {
    const validation = validateTaskTrajectoryRecord(record);
    if (validation !== undefined) {
      return validation;
    }
    try {
      return this.transaction(() => {
        const existingByRun = this.getTaskTrajectoryByRun(record.tenantId, record.subjectId, record.agentId, record.sessionId, record.requestRunId);
        if (existingByRun !== undefined) {
          return existingByRun;
        }
        if (options.idempotencyKey !== undefined) {
          const existingByKey = this.getTaskTrajectoryByIdempotencyKey(record.tenantId, record.subjectId, record.agentId, options.idempotencyKey);
          if (existingByKey !== undefined) {
            return existingByKey;
          }
        }
        this.putTaskTrajectory(record, options.idempotencyKey ?? null);
        return record;
      });
    } catch {
      return trajectorySafeError('TASK_TRAJECTORY_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Task trajectory storage is unavailable.', true);
    }
  }

  async listTaskTrajectories(query: ListTaskTrajectoriesQuery): Promise<TaskTrajectoryListResult | SafeError> {
    const validation = validateTaskTrajectoryQuery(query);
    if (validation !== undefined) {
      return validation;
    }
    try {
      const limit = normalizeTrajectoryLimit(query.limit);
      const offset = parseTrajectoryCursor(query.cursor);
      if (offset === undefined) {
        return trajectorySafeError('TASK_TRAJECTORY_QUERY_INVALID', 'VALIDATION', 'Task trajectory cursor is invalid.');
      }
      const conditions = ['tenant_id = ?', 'subject_id = ?', 'agent_id = ?'];
      const values: Array<string | number> = [query.tenantId, query.subjectId, query.agentId];
      appendOptionalTrajectoryFilter(conditions, values, 'session_id', query.sessionId);
      appendOptionalTrajectoryFilter(conditions, values, 'request_run_id', query.requestRunId);
      appendOptionalTrajectoryFilter(conditions, values, 'task_kind', query.taskKind);
      appendOptionalTrajectoryFilter(conditions, values, 'trajectory_build_status', query.trajectoryBuildStatus);
      appendOptionalTrajectoryFilter(conditions, values, 'task_outcome_status', query.taskOutcomeStatus);
      appendOptionalTrajectoryFilter(conditions, values, 'outcome_evidence_level', query.outcomeEvidenceLevel);
      appendOptionalTimeFilter(conditions, values, 'started_at', '>=', query.startedAfter);
      appendOptionalTimeFilter(conditions, values, 'started_at', '<=', query.startedBefore);
      appendOptionalTimeFilter(conditions, values, 'completed_at', '>=', query.completedAfter);
      appendOptionalTimeFilter(conditions, values, 'completed_at', '<=', query.completedBefore);
      const rows = this.db
        .prepare(
          `SELECT json FROM task_trajectory
         WHERE ${conditions.join(' AND ')}
         ORDER BY completed_at DESC, task_trajectory_id ASC
         LIMIT ? OFFSET ?`,
        )
        .all(...values, limit + 1, offset) as unknown as JsonRow[];
      const items = rows.slice(0, limit).map((row) => JSON.parse(row.json) as TaskTrajectoryRecord);
      return {
        items,
        ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {}),
      };
    } catch {
      return trajectorySafeError('TASK_TRAJECTORY_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Task trajectory storage is unavailable.', true);
    }
  }

  async listBuildCandidates(query: ListTaskTrajectoryBuildCandidatesQuery): Promise<TaskTrajectoryBuildCandidateResult | SafeError> {
    const validation = validateTaskTrajectoryBuildCandidateQuery(query);
    if (validation !== undefined) {
      return validation;
    }
    try {
      const limit = normalizeTrajectoryLimit(query.limit);
      const offset = parseTrajectoryCursor(query.cursor);
      if (offset === undefined) {
        return trajectorySafeError('TASK_TRAJECTORY_QUERY_INVALID', 'VALIDATION', 'Task trajectory cursor is invalid.');
      }
      const conditions = [
        'te.tenant_id = ?',
        'te.subject_id = ?',
        'te.agent_id = ?',
        "rr.terminal_commit_state = 'COMMITTED'",
        "rr.status IN ('COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED')",
        'tt.task_trajectory_id IS NULL',
      ];
      const values: Array<string | number> = [query.tenantId, query.subjectId, query.agentId];
      appendOptionalTrajectoryFilter(conditions, values, 'te.session_id', query.sessionId);
      appendOptionalTimeFilter(conditions, values, 'rr.updated_at', '>=', query.sinceTime);
      appendOptionalTimeFilter(conditions, values, 'rr.updated_at', '<=', query.untilTime);
      const collected: TaskTrajectoryBuildCandidate[] = [];
      let scanOffset = offset;
      let nextCursor: string | undefined;
      const chunkLimit = Math.max(limit + 1, 50);
      while (collected.length <= limit) {
        const rows = this.db
          .prepare(
            `SELECT te.json
           FROM timeline_events te
           JOIN request_runs rr
             ON rr.tenant_id = te.tenant_id
            AND rr.subject_id = te.subject_id
            AND rr.agent_id = te.agent_id
            AND rr.session_id = te.session_id
            AND rr.run_id = te.run_id
           LEFT JOIN task_trajectory tt
             ON tt.tenant_id = te.tenant_id
            AND tt.subject_id = te.subject_id
            AND tt.agent_id = te.agent_id
            AND tt.session_id = te.session_id
            AND tt.request_run_id = te.run_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY rr.updated_at ASC, te.sequence ASC
           LIMIT ? OFFSET ?`,
          )
          .all(...values, chunkLimit, scanOffset) as unknown as JsonRow[];
        if (rows.length === 0) {
          break;
        }
        for (const row of rows) {
          scanOffset += 1;
          const event = JSON.parse(row.json) as RunTimelineEventRecord;
          if (!isTerminalTimelineEventType(event.type)) {
            continue;
          }
          collected.push({
            tenantId: event.tenantId,
            subjectId: event.subjectId,
            agentId: event.agentId,
            sessionId: event.sessionId,
            requestId: event.requestId,
            requestRunId: event.runId,
            terminalTimelineEventId: event.eventId,
            terminalTimelineSequence: event.sequence,
            terminalStatus: terminalRunStatusFromEventType(event.type),
            terminalCommittedAt: event.createdAt,
          });
          if (collected.length > limit) {
            nextCursor = String(scanOffset);
            break;
          }
        }
        if (nextCursor !== undefined || rows.length < chunkLimit) {
          break;
        }
        if (collected.length === limit) {
          nextCursor = String(scanOffset);
          break;
        }
      }
      const items = collected.slice(0, limit);
      return {
        items,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      };
    } catch {
      return trajectorySafeError('TASK_TRAJECTORY_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Task trajectory storage is unavailable.', true);
    }
  }

  async saveCheckpoint(record: CheckpointRecord, options: { readonly idempotencyKey: IdempotencyKey }): Promise<CheckpointRecord> {
    try {
      return this.transaction(() => {
        const existing = this.getCheckpointByIdempotencyKey(record, options.idempotencyKey);
        if (existing !== undefined) {
          return existing;
        }
        this.db
          .prepare(
            `INSERT INTO checkpoints(
              tenant_id, subject_id, agent_id, checkpoint_id, session_id, request_id, run_id,
              request_context_id, run_version, agent_turn_index, trigger_reason, last_sequence,
              active_context_version, flow_variables, saved_at, idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.tenantId,
            record.subjectId,
            record.agentId,
            record.checkpointId,
            record.sessionId,
            record.requestId,
            record.runId,
            record.requestContextId,
            record.runVersion,
            record.agentTurnIndex,
            record.triggerReason,
            Number(record.lastSequence),
            record.activeContextVersion,
            JSON.stringify(record.flowVariables),
            Number(record.savedAt),
            options.idempotencyKey,
          );
        return record;
      });
    } catch (error) {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'SQLite storage unavailable',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    }
  }

  async loadCheckpoint(request: LoadCheckpointRequest): Promise<CheckpointRecord | undefined> {
    const row = this.db
      .prepare(
        `SELECT * FROM checkpoints
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_id = ? AND run_id = ?
         ORDER BY saved_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.requestId, request.runId) as unknown as
      CheckpointRow | undefined;
    return row === undefined ? undefined : toCheckpointRecord(row);
  }

  async getLongTermMemory(request: GetLongTermMemoryRequest): Promise<LongTermMemoryRecord | SafeError> {
    const scopeError =
      !isPlainRecord(request) || !hasExactFields(request, ['tenantId', 'subjectId', 'agentId', 'memoryId'], ['memoryInstance'])
        ? ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Long-term memory get request is invalid.')
        : (validateLtmScope(request, 'LTM_QUERY_INVALID') ??
          validateLtmString(request.memoryId, 'memoryId', 1, 64, 'LTM_QUERY_INVALID') ??
          validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64, 'LTM_QUERY_INVALID'));
    if (scopeError !== undefined) {
      return scopeError;
    }
    try {
      const row = this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, request.memoryInstance);
      return row === undefined
        ? ltmSafeError('LTM_MEMORY_NOT_FOUND', 'NOT_FOUND', 'Long-term memory entry was not found.')
        : toLongTermMemoryRecord(row);
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async saveLongTermMemory(request: SaveLongTermMemoryRequest, options: VersionedWriteOptions = {}): Promise<LongTermMemoryRecord | SafeError> {
    try {
      return this.transaction(() => this.saveLongTermMemorySync(request, options));
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async batchCreateLongTermMemory(request: BatchCreateLongTermMemoryRequest): Promise<BatchCreateLongTermMemoryResult | SafeError> {
    const validationError = validateBatchCreateLongTermMemoryRequest(request);
    if (validationError !== undefined) {
      return validationError;
    }

    const memoryIds: LongTermMemoryId[] = [];
    let failCount = 0;
    for (const item of request.items) {
      if (validateBatchCreateLongTermMemoryItem(item) !== undefined) {
        failCount += 1;
        continue;
      }
      try {
        const result = this.transaction(() => {
          const memoryInstance = request.memoryInstance ?? 'defaultInstance';
          const replay =
            item.writeOptions?.idempotencyKey === undefined
              ? undefined
              : this.getLongTermMemoryByIdempotencyKey(
                  request.tenantId,
                  request.subjectId,
                  request.agentId,
                  memoryInstance,
                  item.writeOptions.idempotencyKey,
                );
          if (replay !== undefined) {
            return toLongTermMemoryRecord(replay);
          }
          const existing =
            item.memoryId === undefined
              ? undefined
              : this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, item.memoryId, memoryInstance);
          const consumesConfiguredSlot =
            item.knowledgeSourceType === 'CONFIGURED' && (existing === undefined || existing.knowledge_source_type !== 'CONFIGURED');
          if (consumesConfiguredSlot && this.countConfiguredPersonalMemories({ ...request, memoryInstance }) >= maxConfiguredPersonalMemories) {
            return ltmSafeError(
              'LTM_WRITE_INVALID',
              'VALIDATION',
              `At most ${maxConfiguredPersonalMemories} configured long-term memories are allowed.`,
            );
          }
          return this.persistLongTermMemorySync(
            {
              tenantId: request.tenantId,
              subjectId: request.subjectId,
              agentId: request.agentId,
              memoryInstance,
              ...(item.memoryId === undefined ? {} : { memoryId: item.memoryId }),
              memoryType: item.memoryType,
              knowledgeSourceType: item.knowledgeSourceType,
              briefIndex: item.briefIndex,
              content: item.content,
              ...(item.labels === undefined ? {} : { labels: item.labels }),
              confidence: item.confidence ?? 1,
              source: item.source ?? '',
              ...(item.state === undefined ? {} : { state: item.state }),
              ...(item.archiveReason === undefined ? {} : { archiveReason: item.archiveReason }),
            },
            item.writeOptions ?? {},
          );
        });
        if ('code' in result) {
          failCount += 1;
        } else {
          memoryIds.push(result.memoryId);
        }
      } catch {
        return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
      }
    }
    return { successCount: memoryIds.length, failCount, memoryIds };
  }

  async manualSaveLongTermMemory(request: ManualSaveLongTermMemoryRequest): Promise<LongTermMemoryRecord | SafeError> {
    try {
      return this.transaction(() => this.manualSaveLongTermMemorySync(request));
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async deleteLongTermMemory(request: DeleteLongTermMemoryRequest): Promise<DeleteLongTermMemoryResult | SafeError> {
    try {
      return this.transaction(() => this.deleteLongTermMemorySync(request));
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async listLongTermMemory(query: ListLongTermMemoryQuery): Promise<LongTermMemorySummaryPage | SafeError> {
    const validationError =
      !isPlainRecord(query) ||
      !hasExactFields(
        query,
        ['tenantId', 'subjectId', 'agentId'],
        [
          'memoryInstance',
          'queryText',
          'memoryType',
          'knowledgeSourceType',
          'state',
          'isPinned',
          'minConfidence',
          'sinceTime',
          'untilTime',
          'maxLastAccessedAt',
          'labels',
          'limit',
          'offset',
        ],
      )
        ? ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Long-term memory list query is invalid.')
        : (validateLtmScope(query, 'LTM_QUERY_INVALID') ??
          validateLtmLimit(query.limit) ??
          validateLtmOffset(query.offset) ??
          validateLtmMinConfidence(query.minConfidence) ??
          validateLtmStateFilter(query.state) ??
          validateLtmMemoryTypeFilter(query.memoryType) ??
          validateLtmKnowledgeSourceTypeFilter(query.knowledgeSourceType) ??
          validateLtmOptionalString(query.memoryInstance, 'memoryInstance', 1, 64, 'LTM_QUERY_INVALID') ??
          validateLtmOptionalString(query.queryText, 'queryText', 1, 2048, 'LTM_QUERY_INVALID') ??
          validateLtmOptionalString(query.labels, 'labels', 1, 256, 'LTM_QUERY_INVALID') ??
          (query.isPinned !== undefined && typeof query.isPinned !== 'boolean'
            ? ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Invalid long-term memory isPinned filter.')
            : undefined) ??
          validateLtmQueryTimestamps(query));
    if (validationError !== undefined) {
      return validationError;
    }
    try {
      const limit = normalizeLtmLimit(query.limit);
      const offset = normalizeLtmOffset(query.offset);
      const { where, values } = this.buildLongTermMemoryListWhere(query, true);
      const totalRow = this.db.prepare(`SELECT COUNT(*) AS count FROM long_term_memory ${where}`).get(...values) as { count: number };
      const rows = this.db
        .prepare(`SELECT * FROM long_term_memory ${where} ORDER BY created_at DESC, long_term_memory_id ASC LIMIT ? OFFSET ?`)
        .all(...values, limit, offset) as unknown as LongTermMemoryRow[];
      return {
        items: rows.map((row) => toLongTermMemorySummary(toLongTermMemoryRecord(row))),
        total: totalRow.count,
        offset,
        limit,
      };
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async mutateLongTermMemory(
    request: MutateLongTermMemoryRequest,
    options: Pick<VersionedWriteOptions, 'expectedVersion'> = {},
  ): Promise<LongTermMemoryVersionedUpdateResult | SafeError> {
    const validationError = validateMutateLongTermMemoryRequest(request) ?? validateLtmMutationWriteOptions(options);
    if (validationError !== undefined) {
      return validationError;
    }
    try {
      return this.transaction(() => this.mutateLongTermMemorySync(request, options));
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async searchLongTermMemory(query: SearchLongTermMemoryQuery): Promise<SearchItemPage | SafeError> {
    const validationError =
      !isPlainRecord(query) ||
      !hasExactFields(
        query,
        ['tenantId', 'subjectId', 'agentId', 'queryText', 'minConfidence', 'limit', 'offset'],
        ['memoryInstance', 'memoryType', 'knowledgeSourceType', 'sinceTime', 'untilTime', 'labels'],
      )
        ? ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Long-term memory search query is invalid.')
        : (validateLtmScope(query, 'LTM_QUERY_INVALID') ??
          validateLtmLimit(query.limit) ??
          validateLtmOffset(query.offset) ??
          validateLtmMinConfidence(query.minConfidence) ??
          validateLtmMemoryTypeFilter(query.memoryType) ??
          validateLtmKnowledgeSourceTypeFilter(query.knowledgeSourceType) ??
          validateLtmOptionalString(query.memoryInstance, 'memoryInstance', 1, 64, 'LTM_QUERY_INVALID') ??
          validateLtmLabels(query.labels, false, 'LTM_QUERY_INVALID') ??
          validateLtmQueryTimestamps(query));
    if (validationError !== undefined) {
      return validationError;
    }
    if (validateLtmString(query.queryText, 'queryText', 1, 2048, 'LTM_QUERY_INVALID') !== undefined || query.offset !== 0) {
      return ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Long-term memory query text is required.');
    }
    try {
      const result = this.searchLongTermMemoryWithFts(query);
      this.incrementLongTermMemoryRecallCount(
        result.items.map((entry) => entry.summary.memoryId),
        query,
      );
      return result;
    } catch {
      this.longTermMemoryFtsAvailable = false;
      logger.warn({
        event: 'memory.fts.degraded',
        reasonCode: 'LTM_FTS_UNAVAILABLE',
        degradedMode: 'literal_match',
      });
      try {
        const result = this.searchLongTermMemoryWithLiteralMatch(query);
        this.incrementLongTermMemoryRecallCount(
          result.items.map((entry) => entry.summary.memoryId),
          query,
        );
        return result;
      } catch {
        return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
      }
    }
  }

  async getLongTermMemoryDetail(request: GetLongTermMemoryDetailRequest): Promise<LongTermMemoryRecord | SafeError> {
    const scopeError =
      !isPlainRecord(request) || !hasExactFields(request, ['tenantId', 'subjectId', 'agentId', 'memoryId'], ['memoryInstance'])
        ? ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Long-term memory detail request is invalid.')
        : (validateLtmScope(request, 'LTM_QUERY_INVALID') ??
          validateLtmString(request.memoryId, 'memoryId', 1, 64, 'LTM_QUERY_INVALID') ??
          validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64, 'LTM_QUERY_INVALID'));
    if (scopeError !== undefined) {
      return scopeError;
    }
    try {
      return this.transaction(() => {
        const current = this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, request.memoryInstance);
        if (current === undefined) {
          return ltmSafeError('LTM_MEMORY_NOT_FOUND', 'NOT_FOUND', 'Long-term memory entry was not found.');
        }
        const currentRecord = toLongTermMemoryRecord(current);
        const accessedAt = nowEpoch();
        const updated: LongTermMemoryRecord = {
          ...currentRecord,
          accessCount: currentRecord.accessCount + 1,
          lastAccessedAt: accessedAt,
          version: currentRecord.version + 1,
          updateTime: accessedAt,
        };
        this.putLongTermMemory(updated, current.idempotency_key);
        return updated;
      });
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async publishLongTermMemory(request: SharingLongTermMemoryRequest): Promise<PublishLongTermMemoryResult | SafeError> {
    const validationError = validateSharingLongTermMemoryRequest(request);
    if (validationError !== undefined) {
      return validationError;
    }
    try {
      return this.transaction(() => {
        const instance = request.memoryInstance ?? 'defaultInstance';
        const sourceRow = this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, instance);
        if (sourceRow === undefined || sourceRow.sharing_state === 'SHARED') {
          return ltmSafeError('LTM_MEMORY_NOT_FOUND', 'NOT_FOUND', 'Long-term memory entry was not found.');
        }
        const existing = this.db
          .prepare(
            `SELECT * FROM long_term_memory
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ?
             AND sharing_state = 'SHARED' AND source_memory_id = ?`,
          )
          .get(request.tenantId, request.subjectId, request.agentId, instance, request.memoryId) as LongTermMemoryRow | undefined;
        if (existing !== undefined) {
          return this.toPublishLongTermMemoryResult(toLongTermMemoryRecord(existing));
        }
        const source = toLongTermMemoryRecord(sourceRow);
        const now = nowEpoch();
        const published: LongTermMemoryRecord = {
          ...source,
          memoryId: generateLongTermMemoryId(),
          sharingState: 'SHARED',
          sourceMemoryId: source.memoryId,
          state: 'ACTIVE',
          version: 1,
          accessCount: 0,
          recallCount: 0,
          extractionCount: 0,
          archivedAt: brand<number, 'EpochMillis'>(0),
          archiveReason: '',
          isPinned: false,
          createTime: now,
          updateTime: now,
        };
        const { lastAccessedAt: _lastAccessedAt, ...withoutAccess } = published;
        this.putLongTermMemory(withoutAccess, null);
        return this.toPublishLongTermMemoryResult(withoutAccess);
      });
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async unpublishLongTermMemory(request: SharingLongTermMemoryRequest): Promise<UnpublishLongTermMemoryResult | SafeError> {
    const validationError = validateSharingLongTermMemoryRequest(request);
    if (validationError !== undefined) {
      return validationError;
    }
    try {
      return this.transaction(() => {
        const row = this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, request.memoryInstance);
        if (row === undefined || row.sharing_state !== 'SHARED') {
          return ltmSafeError('LTM_MEMORY_NOT_FOUND', 'NOT_FOUND', 'Long-term memory entry was not found.');
        }
        this.deleteLongTermMemoryRow(row);
        return { memoryId: request.memoryId };
      });
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async listPublishedLongTermMemory(query: ListPublishedLongTermMemoryQuery): Promise<SharedMemorySummaryPage | SafeError> {
    const validationError =
      !isPlainRecord(query) ||
      !hasExactFields(
        query,
        ['tenantId', 'subjectId', 'agentId'],
        ['memoryInstance', 'queryText', 'memoryType', 'knowledgeSourceType', 'labels', 'limit', 'offset'],
      )
        ? ltmSafeError('LTM_QUERY_INVALID', 'VALIDATION', 'Published long-term memory list query is invalid.')
        : (validateLtmScope(query, 'LTM_QUERY_INVALID') ??
          validateLtmLimit(query.limit) ??
          validateLtmOffset(query.offset) ??
          validateLtmMemoryTypeFilter(query.memoryType) ??
          validateLtmKnowledgeSourceTypeFilter(query.knowledgeSourceType) ??
          validateLtmOptionalString(query.memoryInstance, 'memoryInstance', 1, 64, 'LTM_QUERY_INVALID') ??
          validateLtmOptionalString(query.queryText, 'queryText', 1, 2048, 'LTM_QUERY_INVALID') ??
          validateLtmOptionalString(query.labels, 'labels', 1, 256, 'LTM_QUERY_INVALID'));
    if (validationError !== undefined) {
      return validationError;
    }
    try {
      const limit = normalizeLtmLimit(query.limit);
      const offset = normalizeLtmOffset(query.offset);
      const { where, values } = this.buildPublishedLongTermMemoryWhere(query);
      const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM long_term_memory ${where}`).get(...values) as { count: number }).count;
      const rows = this.db
        .prepare(`SELECT * FROM long_term_memory ${where} ORDER BY created_at DESC, long_term_memory_id ASC LIMIT ? OFFSET ?`)
        .all(...values, limit, offset) as unknown as LongTermMemoryRow[];
      return {
        items: rows.map((row) => {
          const record = toLongTermMemoryRecord(row);
          return {
            ...toLongTermMemorySummary(record),
            sourceMemoryId: record.sourceMemoryId!,
            ownerSubjectId: record.subjectId,
          };
        }),
        total,
        offset,
        limit,
      };
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async copyPublishedMemory(request: CopyLongTermMemoryRequest): Promise<CopyPublishedMemoryResponse | SafeError> {
    const validationError = validateCopyLongTermMemoryRequest(request);
    if (validationError !== undefined) {
      return validationError;
    }
    try {
      return this.transaction(() => {
        const sharedRows = request.memoryIds.map(
          (memoryId) =>
            this.db
              .prepare(
                `SELECT * FROM long_term_memory
           WHERE tenant_id = ? AND agent_id = ? AND long_term_memory_id = ? AND sharing_state = 'SHARED'`,
              )
              .get(request.tenantId, request.agentId, memoryId) as LongTermMemoryRow | undefined,
        );
        if (sharedRows.some((row) => row === undefined)) {
          return ltmSafeError('LTM_MEMORY_NOT_FOUND', 'NOT_FOUND', 'Published long-term memory was not found.');
        }
        const results: CopiedPublishedMemoryResult[] = [];
        for (const [index, row] of sharedRows.entries()) {
          const sourceMemoryId = request.memoryIds[index]!;
          const memoryInstance = request.memoryInstance ?? 'defaultInstance';
          const existingForkRow = this.db
            .prepare(
              `SELECT * FROM long_term_memory
             WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ?
               AND sharing_state = 'FORK' AND source_memory_id = ?
             ORDER BY created_at ASC, long_term_memory_id ASC
             LIMIT 1`,
            )
            .get(request.tenantId, request.subjectId, request.agentId, memoryInstance, sourceMemoryId) as LongTermMemoryRow | undefined;
          if (existingForkRow !== undefined) {
            const existingFork = toLongTermMemoryRecord(existingForkRow);
            results.push({
              memoryId: existingFork.memoryId,
              record: existingFork,
              sourceMemoryId,
              copyStatus: 'EXISTING',
            });
            continue;
          }
          const shared = toLongTermMemoryRecord(row!);
          const now = nowEpoch();
          const fork: LongTermMemoryRecord = {
            ...shared,
            subjectId: request.subjectId,
            memoryId: generateLongTermMemoryId(),
            memoryInstance,
            sharingState: 'FORK',
            sourceMemoryId,
            state: 'ACTIVE',
            version: 1,
            accessCount: 0,
            recallCount: 0,
            extractionCount: 0,
            archivedAt: brand<number, 'EpochMillis'>(0),
            archiveReason: '',
            isPinned: false,
            createTime: now,
            updateTime: now,
          };
          const { lastAccessedAt: _lastAccessedAt, ...withoutAccess } = fork;
          this.putLongTermMemory(withoutAccess, null);
          results.push({
            memoryId: withoutAccess.memoryId,
            record: withoutAccess,
            sourceMemoryId,
            copyStatus: 'COPIED',
          });
        }
        return { results };
      });
    } catch {
      return ltmSafeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Long-term memory storage is unavailable.', true);
    }
  }

  async createPendingInput(request: CreatePendingInputRecordRequest): Promise<PendingInputRecord> {
    try {
      return this.transaction(() => {
        this.putPendingInput(request.record);
        return request.record;
      });
    } catch (error) {
      if (this.isSqliteConstraintError(error)) {
        throw new AgentError({
          code: 'PENDING_INPUT_ACTIVE_CONFLICT',
          message: 'A pending input is already active for this session scope.',
          category: 'CONFLICT',
          retryable: false,
          cause: error,
        });
      }
      throw error;
    }
  }

  async loadPendingInput(request: LoadPendingInputRecordRequest): Promise<PendingInputRecord | undefined> {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, pending_input_id, session_id, request_id, request_run_id,
                request_context_id, checkpoint_id, kind, request, producer_ref, timeout_at, status, created_at,
                updated_at, authorization_scope, response_answers, resolve_idempotency_key, resolve_idempotency_semantic
         FROM pending_inputs
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND pending_input_id = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.pendingInputId) as PendingInputRow | undefined;
    return row === undefined ? undefined : toPendingInputRecord(row);
  }

  async loadActivePendingInput(request: LoadActivePendingInputRecordRequest): Promise<PendingInputRecord | undefined> {
    const rows = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, pending_input_id, session_id, request_id, request_run_id,
                request_context_id, checkpoint_id, kind, request, producer_ref, timeout_at, status, created_at,
                updated_at, authorization_scope, response_answers, resolve_idempotency_key, resolve_idempotency_semantic
         FROM pending_inputs
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND status = 'PENDING'`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, request.sessionId) as unknown as PendingInputRow[];
    if (rows.length > 1) {
      throw new AgentError({
        code: 'PENDING_INPUT_ACTIVE_INVARIANT_VIOLATION',
        message: 'Multiple active pending inputs exist for the same session scope.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    return rows[0] === undefined ? undefined : toPendingInputRecord(rows[0]);
  }

  async listUnresolvedPendingInputTimeoutFacts(request: AgentListUnresolvedPendingInputTimeoutFactsRequest): Promise<readonly PendingInputRecord[]> {
    if (typeof request.agentId !== 'string' || request.agentId.trim().length === 0) {
      throw new AgentError({
        code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_AGENT_REQUIRED',
        message: 'Pending input timeout candidate query requires an Agent Scope.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
      throw new AgentError({
        code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_LIMIT_INVALID',
        message: 'Pending input timeout candidate query limit must be a safe integer from 1 through 1000.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (
      request.after !== undefined &&
      (!Number.isSafeInteger(request.after.timeoutAt) ||
        Number(request.after.timeoutAt) < 0 ||
        typeof request.after.pendingInputId !== 'string' ||
        request.after.pendingInputId.trim().length === 0)
    ) {
      throw new AgentError({
        code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_CURSOR_INVALID',
        message: 'Pending input timeout candidate cursor requires timeoutAt and pendingInputId coordinates.',
        category: 'VALIDATION',
        retryable: false,
      });
    }

    const baseQuery = `SELECT p.tenant_id, p.subject_id, p.agent_id, p.pending_input_id, p.session_id, p.request_id, p.request_run_id,
                              p.request_context_id, p.checkpoint_id, p.kind, p.request, p.producer_ref, p.timeout_at, p.status, p.created_at,
                              p.updated_at, p.authorization_scope, p.response_answers, p.resolve_idempotency_key, p.resolve_idempotency_semantic
                       FROM pending_inputs p
                       WHERE p.agent_id = ?
                         AND p.timeout_at IS NOT NULL
                         AND (
                           p.status = 'PENDING'
                           OR (
                             p.status = 'TIMED_OUT'
                             AND NOT EXISTS (
                               SELECT 1
                               FROM request_runs r
                               WHERE r.tenant_id = p.tenant_id
                                 AND r.subject_id = p.subject_id
                                 AND r.agent_id = p.agent_id
                                 AND r.session_id = p.session_id
                                 AND r.request_id = p.request_id
                                 AND r.run_id = p.request_run_id
                                 AND r.terminal_commit_state = 'COMMITTED'
                             )
                           )
                         )`;
    const rows = (request.after === undefined
      ? this.db
          .prepare(
            `${baseQuery}
                  ORDER BY p.timeout_at ASC, p.pending_input_id ASC
                  LIMIT ?`,
          )
          .all(request.agentId, request.limit)
      : this.db
          .prepare(
            `${baseQuery}
                  AND (p.timeout_at > ? OR (p.timeout_at = ? AND p.pending_input_id > ?))
                  ORDER BY p.timeout_at ASC, p.pending_input_id ASC
                  LIMIT ?`,
          )
          .all(
            request.agentId,
            Number(request.after.timeoutAt),
            Number(request.after.timeoutAt),
            request.after.pendingInputId,
            request.limit,
          )) as unknown as PendingInputRow[];
    return rows.map(toPendingInputRecord);
  }

  async resolvePendingInput(
    request: ResolvePendingInputRecordRequest,
    options?: ResolvePendingInputRecordOptions,
  ): Promise<PendingInputResolveResult> {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT tenant_id, subject_id, agent_id, pending_input_id, session_id, request_id, request_run_id,
                  request_context_id, checkpoint_id, kind, request, producer_ref, timeout_at, status, created_at,
                  updated_at, authorization_scope, response_answers, resolve_idempotency_key, resolve_idempotency_semantic
           FROM pending_inputs
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND pending_input_id = ?`,
        )
        .get(request.tenantId, request.subjectId, request.agentId, request.pendingInputId) as PendingInputRow | undefined;
      if (row === undefined) {
        return { status: 'NOT_FOUND' };
      }
      const current = toPendingInputRecord(row);
      if (current.status !== request.expectedStatus) {
        if (options !== undefined && row.resolve_idempotency_key === options.idempotencyKey) {
          if (row.resolve_idempotency_semantic === options.idempotencySemantic) {
            return { status: 'UPDATED', record: current };
          }
          return { status: 'IDEMPOTENCY_CONFLICT', record: current };
        }
        return { status: 'VERSION_CONFLICT', record: current };
      }
      const updated: PendingInputRecord = {
        ...current,
        status: request.status,
        updatedAt: request.answer?.answeredAt ?? nowEpoch(),
        ...(request.answer === undefined
          ? {}
          : {
              responseAnswers: request.answer.answers,
              ...(request.answer.answerKinds === undefined ? {} : { responseAnswerKinds: request.answer.answerKinds }),
            }),
      };
      this.putPendingInput(updated, options);
      return { status: 'UPDATED', record: updated };
    });
  }

  async saveAnnotation(
    record: ConversationAnnotationRecord,
    options: IdempotentWriteOptions,
  ): Promise<ConversationAnnotationRecord | undefined | SafeError> {
    try {
      return this.transaction(() => {
        const existing = this.getAnnotationRowByRun(record.tenantId, record.subjectId, record.agentId, record.sessionId, record.requestRunId);
        const now = nowEpoch();

        if (options.idempotencyKey !== undefined && existing === undefined) {
          const byKey = this.getAnnotationRowByIdempotencyKey(record.tenantId, record.subjectId, record.agentId, options.idempotencyKey);
          if (byKey !== undefined) {
            return toConversationAnnotationRecord(byKey);
          }
        }

        if (existing === undefined) {
          const annotationId = record.annotationId;
          const insSentiment = record.sentiment ?? null;
          const insIsFavorited = record.isFavorited ?? false;
          const insIsQuestionFavorited = record.isQuestionFavorited ?? false;
          const insComment = record.comment ?? null;
          if (insSentiment === null && !insIsFavorited && !insIsQuestionFavorited) {
            return undefined;
          }
          if (insIsFavorited && this.countFavoritesInScope(record.tenantId, record.subjectId) >= MAX_FAVORITES_PER_USER_SCOPE) {
            return annotationSafeError('FAVORITE_LIMIT_EXCEEDED', 'VALIDATION', 'Favorite limit reached for this user scope.', false);
          }
          this.insertAnnotationRow(record, annotationId, now, options.idempotencyKey);
          return {
            tenantId: record.tenantId,
            subjectId: record.subjectId,
            agentId: record.agentId,
            annotationId,
            sessionId: record.sessionId,
            requestRunId: record.requestRunId,
            sentiment: insSentiment,
            isFavorited: insIsFavorited,
            isQuestionFavorited: insIsQuestionFavorited,
            comment: insComment,
            createdAt: now,
            updatedAt: now,
          };
        }

        const updatedSentiment =
          record.sentiment !== undefined
            ? record.sentiment
            : existing.sentiment === 'UP' || existing.sentiment === 'DOWN'
              ? existing.sentiment
              : null;
        const updatedIsFavorited = record.isFavorited !== undefined ? record.isFavorited : existing.is_favorited === 1;
        const updatedIsQuestionFavorited = record.isQuestionFavorited !== undefined ? record.isQuestionFavorited : existing.question_favorite === 1;
        const updatedComment = record.comment !== undefined ? record.comment : existing.comment;

        if (updatedSentiment === null && !updatedIsFavorited && !updatedIsQuestionFavorited) {
          this.deleteAnnotationRow(record.tenantId, record.subjectId, record.agentId, existing.annotation_id);
          return undefined;
        }

        if (
          existing.is_favorited !== 1 &&
          updatedIsFavorited &&
          this.countFavoritesInScope(record.tenantId, record.subjectId) >= MAX_FAVORITES_PER_USER_SCOPE
        ) {
          return annotationSafeError('FAVORITE_LIMIT_EXCEEDED', 'VALIDATION', 'Favorite limit reached for this user scope.', false);
        }

        this.updateAnnotationRow(
          record.tenantId,
          record.subjectId,
          record.agentId,
          existing.annotation_id,
          updatedSentiment,
          updatedIsFavorited,
          updatedIsQuestionFavorited,
          updatedComment,
          now,
        );
        return {
          tenantId: brand<string, 'TenantId'>(existing.tenant_id),
          subjectId: brand<string, 'SubjectId'>(existing.subject_id),
          agentId: brand<string, 'AgentId'>(existing.agent_id),
          annotationId: existing.annotation_id,
          sessionId: brand<string, 'SessionId'>(existing.session_id),
          requestRunId: brand<string, 'RequestRunId'>(existing.request_run_id),
          sentiment: updatedSentiment as ConversationAnnotationSentiment | null,
          isFavorited: updatedIsFavorited,
          isQuestionFavorited: updatedIsQuestionFavorited,
          comment: updatedComment,
          createdAt: brand<number, 'EpochMillis'>(existing.created_at),
          updatedAt: now,
        };
      });
    } catch {
      return annotationSafeError('ANNOTATION_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Annotation storage is unavailable.', true);
    }
  }

  async deleteAnnotationsByRun(request: DeleteAnnotationsByRunRequest): Promise<void | SafeError> {
    try {
      this.transaction(() => {
        this.db
          .prepare('DELETE FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND request_run_id = ?')
          .run(request.tenantId, request.subjectId, request.agentId, request.requestRunId);
      });
    } catch {
      return annotationSafeError('ANNOTATION_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Annotation storage is unavailable.', true);
    }
    return undefined;
  }

  async listFavoriteTurns(query: ListFavoriteTurnsQuery): Promise<readonly ConversationFavoriteTurnSummary[] | SafeError> {
    try {
      const rows = this.db
        .prepare(
          'SELECT ca.session_id, ca.request_run_id, ca.updated_at AS favorited_at, ' +
            'm.request_id AS root_message_id, m.content AS user_question, ' +
            's.title AS session_title, s.updated_at AS session_updated_at ' +
            'FROM conversation_annotations ca ' +
            'LEFT JOIN request_runs rr ON ca.tenant_id = rr.tenant_id AND ca.subject_id = rr.subject_id ' +
            'AND ca.agent_id = rr.agent_id AND ca.request_run_id = rr.run_id ' +
            'LEFT JOIN fork_process_snapshot_statuses fps ON ca.tenant_id = fps.tenant_id AND ca.subject_id = fps.subject_id ' +
            'AND ca.agent_id = fps.agent_id AND ca.session_id = fps.session_id AND ca.request_run_id = fps.run_id ' +
            'LEFT JOIN messages m ON ca.tenant_id = m.tenant_id AND ca.subject_id = m.subject_id ' +
            'AND ca.agent_id = m.agent_id AND ca.session_id = m.session_id ' +
            "AND m.role = 'USER' AND m.visible = 1 " +
            'AND ((rr.request_id IS NOT NULL AND m.message_id = rr.request_id) OR ' +
            '(fps.request_id IS NOT NULL AND m.message_id = fps.request_id) OR ' +
            '(rr.request_id IS NULL AND fps.request_id IS NULL AND ca.request_run_id = m.run_id AND m.message_id = m.request_id)) ' +
            'LEFT JOIN sessions s ON ca.tenant_id = s.tenant_id AND ca.subject_id = s.subject_id ' +
            'AND ca.agent_id = s.agent_id AND ca.session_id = s.session_id ' +
            'WHERE ca.tenant_id = ? AND ca.subject_id = ? AND ca.agent_id = ? AND ca.is_favorited = 1 ' +
            'ORDER BY ca.updated_at DESC LIMIT ? OFFSET ?',
        )
        .all(query.tenantId, query.subjectId, query.agentId, query.limit, query.offset) as unknown as ReadonlyArray<{
        readonly session_id: string;
        readonly request_run_id: string;
        readonly favorited_at: number;
        readonly root_message_id: string | null;
        readonly user_question: string | null;
        readonly session_title: string | null;
        readonly session_updated_at: number | null;
      }>;
      return rows.map((row) => {
        const preview = truncateCodePoints(row.user_question ?? '', CONVERSATION_PREVIEW_TEXT_LIMIT);
        return {
          sessionId: brand<string, 'SessionId'>(row.session_id),
          requestRunId: brand<string, 'RequestRunId'>(row.request_run_id),
          rootMessageId: brand<string, 'MessageId'>(row.root_message_id ?? row.request_run_id),
          questionPreview: preview.text,
          questionTruncated: preview.truncated,
          ...(row.session_title !== null ? { sessionTitle: row.session_title } : {}),
          sessionUpdatedAt: brand<number, 'EpochMillis'>(row.session_updated_at ?? 0),
          favoritedAt: brand<number, 'EpochMillis'>(row.favorited_at),
        };
      });
    } catch {
      return annotationSafeError('ANNOTATION_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Annotation storage is unavailable.', true);
    }
  }

  async listQuestionFavoriteTurns(query: ListQuestionFavoriteTurnsQuery): Promise<readonly ConversationFavoriteTurnSummary[] | SafeError> {
    try {
      const rows = this.db
        .prepare(
          'SELECT ca.session_id, ca.request_run_id, ca.updated_at AS favorited_at, ' +
            'm.request_id AS root_message_id, m.content AS user_question, ' +
            's.title AS session_title, s.updated_at AS session_updated_at ' +
            'FROM conversation_annotations ca ' +
            'LEFT JOIN request_runs rr ON ca.tenant_id = rr.tenant_id AND ca.subject_id = rr.subject_id ' +
            'AND ca.agent_id = rr.agent_id AND ca.request_run_id = rr.run_id ' +
            'LEFT JOIN fork_process_snapshot_statuses fps ON ca.tenant_id = fps.tenant_id AND ca.subject_id = fps.subject_id ' +
            'AND ca.agent_id = fps.agent_id AND ca.session_id = fps.session_id AND ca.request_run_id = fps.run_id ' +
            'LEFT JOIN messages m ON ca.tenant_id = m.tenant_id AND ca.subject_id = m.subject_id ' +
            'AND ca.agent_id = m.agent_id AND ca.session_id = m.session_id ' +
            "AND m.role = 'USER' AND m.visible = 1 " +
            'AND ((rr.request_id IS NOT NULL AND m.message_id = rr.request_id) OR ' +
            '(fps.request_id IS NOT NULL AND m.message_id = fps.request_id) OR ' +
            '(rr.request_id IS NULL AND fps.request_id IS NULL AND ca.request_run_id = m.run_id AND m.message_id = m.request_id)) ' +
            'LEFT JOIN sessions s ON ca.tenant_id = s.tenant_id AND ca.subject_id = s.subject_id ' +
            'AND ca.agent_id = s.agent_id AND ca.session_id = s.session_id ' +
            'WHERE ca.tenant_id = ? AND ca.subject_id = ? AND ca.agent_id = ? AND ca.question_favorite = 1 ' +
            'ORDER BY ca.updated_at DESC LIMIT ? OFFSET ?',
        )
        .all(query.tenantId, query.subjectId, query.agentId, query.limit, query.offset) as unknown as ReadonlyArray<{
        readonly session_id: string;
        readonly request_run_id: string;
        readonly favorited_at: number;
        readonly root_message_id: string | null;
        readonly user_question: string | null;
        readonly session_title: string | null;
        readonly session_updated_at: number | null;
      }>;
      return rows.map((row) => {
        const preview = truncateCodePoints(row.user_question ?? '', CONVERSATION_PREVIEW_TEXT_LIMIT);
        return {
          sessionId: brand<string, 'SessionId'>(row.session_id),
          requestRunId: brand<string, 'RequestRunId'>(row.request_run_id),
          rootMessageId: brand<string, 'MessageId'>(row.root_message_id ?? row.request_run_id),
          questionPreview: preview.text,
          questionTruncated: preview.truncated,
          ...(row.session_title !== null ? { sessionTitle: row.session_title } : {}),
          sessionUpdatedAt: brand<number, 'EpochMillis'>(row.session_updated_at ?? 0),
          favoritedAt: brand<number, 'EpochMillis'>(row.favorited_at),
        };
      });
    } catch {
      return annotationSafeError('ANNOTATION_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Annotation storage is unavailable.', true);
    }
  }

  async listSessionAnnotations(query: ListSessionAnnotationsQuery): Promise<readonly ConversationAnnotationRecord[] | SafeError> {
    try {
      const rows = this.db
        .prepare(
          'SELECT * FROM conversation_annotations ' +
            'WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? ' +
            'ORDER BY created_at ASC, annotation_id ASC',
        )
        .all(query.tenantId, query.subjectId, query.agentId, query.sessionId) as unknown as readonly ConversationAnnotationRow[];
      return rows.map(toConversationAnnotationRecord);
    } catch {
      return annotationSafeError('ANNOTATION_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Annotation storage is unavailable.', true);
    }
  }

  private getAnnotationRowByRun(
    tenantId: string,
    subjectId: string,
    agentId: string,
    sessionId: string,
    requestRunId: string,
  ): ConversationAnnotationRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_run_id = ?',
      )
      .get(tenantId, subjectId, agentId, sessionId, requestRunId) as ConversationAnnotationRow | undefined;
  }

  private getAnnotationRowByIdempotencyKey(
    tenantId: string,
    subjectId: string,
    agentId: string,
    idempotencyKey: string,
  ): ConversationAnnotationRow | undefined {
    return this.db
      .prepare('SELECT * FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND idempotency_key = ?')
      .get(tenantId, subjectId, agentId, idempotencyKey) as ConversationAnnotationRow | undefined;
  }

  private insertAnnotationRow(record: ConversationAnnotationRecord, annotationId: string, now: EpochMillis, idempotencyKey?: IdempotencyKey): void {
    this.db
      .prepare(
        'INSERT INTO conversation_annotations ' +
          '(tenant_id, subject_id, agent_id, annotation_id, session_id, request_run_id, sentiment, is_favorited, question_favorite, comment, idempotency_key, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        annotationId,
        record.sessionId,
        record.requestRunId,
        record.sentiment ?? null,
        record.isFavorited ? 1 : 0,
        record.isQuestionFavorited ? 1 : 0,
        record.comment ?? null,
        idempotencyKey ?? null,
        now,
        now,
      );
  }

  private updateAnnotationRow(
    tenantId: string,
    subjectId: string,
    agentId: string,
    annotationId: string,
    sentiment: ConversationAnnotationSentiment | null,
    isFavorited: boolean,
    isQuestionFavorited: boolean,
    comment: string | null,
    now: EpochMillis,
  ): void {
    this.db
      .prepare(
        'UPDATE conversation_annotations SET sentiment = ?, is_favorited = ?, question_favorite = ?, comment = ?, updated_at = ? ' +
          'WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND annotation_id = ?',
      )
      .run(sentiment, isFavorited ? 1 : 0, isQuestionFavorited ? 1 : 0, comment, now, tenantId, subjectId, agentId, annotationId);
  }

  private deleteAnnotationRow(tenantId: string, subjectId: string, agentId: string, annotationId: string): void {
    this.db
      .prepare('DELETE FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND annotation_id = ?')
      .run(tenantId, subjectId, agentId, annotationId);
  }

  private countFavoritesInScope(tenantId: string, subjectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND is_favorited = 1')
      .get(tenantId, subjectId) as { readonly n: number };
    return row.n;
  }

  async createShare(record: ConversationShareRecord, options: IdempotentWriteOptions): Promise<ConversationShareRecord | SafeError> {
    try {
      return this.transaction(() => {
        if (options.idempotencyKey !== undefined) {
          const byKey = this.getShareRowByIdempotencyKey(record.tenantId, record.subjectId, record.agentId, options.idempotencyKey);
          if (byKey !== undefined) {
            return toConversationShareRecord(byKey);
          }
        }

        const shareId = randomBytes(16).toString('base64url');
        const now = nowEpoch();
        this.db
          .prepare(
            'INSERT INTO conversation_shares ' +
              '(tenant_id, subject_id, agent_id, share_id, session_id, run_ids, origin_url, allowed_ops, expires_at, idempotency_key, created_at) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            record.tenantId,
            record.subjectId,
            record.agentId,
            shareId,
            record.sessionId,
            JSON.stringify(record.runIds),
            record.originUrl,
            record.allowedOps === null ? null : JSON.stringify(record.allowedOps),
            record.expiresAt === null ? null : record.expiresAt,
            options.idempotencyKey ?? null,
            now,
          );
        return {
          tenantId: record.tenantId,
          subjectId: record.subjectId,
          agentId: record.agentId,
          shareId,
          sessionId: record.sessionId,
          runIds: record.runIds,
          originUrl: record.originUrl,
          allowedOps: record.allowedOps,
          expiresAt: record.expiresAt,
          createdAt: now,
        };
      });
    } catch {
      return shareSafeError('SHARE_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Share storage is unavailable.', true);
    }
  }

  async loadShare(request: LoadShareRequest): Promise<ConversationShareRecord | undefined | SafeError> {
    try {
      const row = this.db.prepare('SELECT * FROM conversation_shares WHERE share_id = ?').get(request.shareId) as ConversationShareRow | undefined;
      return row === undefined ? undefined : toConversationShareRecord(row);
    } catch {
      return shareSafeError('SHARE_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Share storage is unavailable.', true);
    }
  }

  async deleteSharesBySession(request: DeleteSharesBySessionRequest): Promise<void | SafeError> {
    try {
      this.transaction(() => {
        this.db
          .prepare('DELETE FROM conversation_shares WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?')
          .run(request.tenantId, request.subjectId, request.agentId, request.sessionId);
      });
    } catch {
      return shareSafeError('SHARE_STORAGE_UNAVAILABLE', 'UNAVAILABLE', 'Share storage is unavailable.', true);
    }
    return undefined;
  }

  private getShareRowByIdempotencyKey(
    tenantId: string,
    subjectId: string,
    agentId: string,
    idempotencyKey: string,
  ): ConversationShareRow | undefined {
    return this.db
      .prepare('SELECT * FROM conversation_shares WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND idempotency_key = ?')
      .get(tenantId, subjectId, agentId, idempotencyKey) as ConversationShareRow | undefined;
  }

  close(): void {
    this.db.close();
  }

  private buildSavedLongTermMemoryRecord(
    request: CanonicalSaveLongTermMemoryRequest,
    current: LongTermMemoryRecord | undefined,
    updateTime: EpochMillis,
  ): LongTermMemoryRecord {
    if (current === undefined) {
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        memoryId: request.memoryId ?? generateLongTermMemoryId(),
        memoryInstance: request.memoryInstance,
        memoryType: request.memoryType,
        knowledgeSourceType: request.knowledgeSourceType,
        sharingState: 'PRIVATE',
        state: request.state ?? 'ACTIVE',
        briefIndex: request.briefIndex,
        content: request.content,
        labels: request.labels ?? [],
        confidence: request.confidence,
        version: 1,
        accessCount: 0,
        recallCount: 0,
        extractionCount: 0,
        archivedAt: request.state === 'ARCHIVED' ? updateTime : brand<number, 'EpochMillis'>(0),
        archiveReason: request.state === 'ARCHIVED' ? (request.archiveReason ?? '') : '',
        isPinned: false,
        source: request.source,
        createTime: updateTime,
        updateTime,
      };
    }
    return {
      ...current,
      memoryType: request.memoryType,
      knowledgeSourceType: request.knowledgeSourceType,
      briefIndex: request.briefIndex,
      content: request.content,
      labels: request.labels ?? [],
      confidence: request.confidence,
      source: request.source,
      extractionCount: current.extractionCount + (request.source === current.source ? 0 : 1),
      version: current.version + 1,
      updateTime,
    };
  }

  private getLongTermMemoryRow(
    tenantId: string,
    subjectId: string,
    agentId: string,
    memoryId: string,
    memoryInstance = 'defaultInstance',
  ): LongTermMemoryRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM long_term_memory WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ? AND long_term_memory_id = ?',
      )
      .get(tenantId, subjectId, agentId, memoryInstance, memoryId) as LongTermMemoryRow | undefined;
  }

  private getLongTermMemoryByIdempotencyKey(
    tenantId: string,
    subjectId: string,
    agentId: string,
    memoryInstance: string,
    idempotencyKey: string,
  ): LongTermMemoryRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM long_term_memory WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ? AND idempotency_key = ?',
      )
      .get(tenantId, subjectId, agentId, memoryInstance, idempotencyKey) as LongTermMemoryRow | undefined;
  }

  private putLongTermMemory(record: LongTermMemoryRecord, idempotencyKey?: string | null): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO long_term_memory(
          tenant_id, subject_id, agent_id, memory_instance, long_term_memory_id, version, category,
          knowledge_source_type, sharing_state, source_memory_id, confidence, state,
          brief_index, tags_json, access_count, recall_count, extraction_count,
          last_accessed_at, archived_at, archive_reason, is_pinned,
          source_trace_session_id, source_trace_request_id, source_trace_extraction_cycle_id, source_trace_json,
          content_json, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.memoryInstance,
        record.memoryId,
        record.version,
        record.memoryType,
        record.knowledgeSourceType,
        record.sharingState,
        record.sourceMemoryId ?? null,
        record.confidence,
        record.state,
        record.briefIndex,
        JSON.stringify(record.labels),
        record.accessCount,
        record.recallCount,
        record.extractionCount,
        record.lastAccessedAt === undefined ? null : Number(record.lastAccessedAt),
        Number(record.archivedAt) === 0 ? null : Number(record.archivedAt),
        record.archiveReason === '' ? null : record.archiveReason,
        record.isPinned ? 1 : 0,
        '',
        null,
        null,
        record.source,
        record.content,
        idempotencyKey ?? null,
        Number(record.createTime),
        Number(record.updateTime),
      );
    this.upsertLongTermMemoryFts(record);
  }

  private saveLongTermMemorySync(request: SaveLongTermMemoryRequest, options: VersionedWriteOptions = {}): LongTermMemoryRecord | SafeError {
    const validationError = validateSaveLongTermMemoryRequest(request) ?? validateLtmWriteOptions(options, 'LTM_WRITE_INVALID');
    if (validationError !== undefined) {
      return validationError;
    }
    return this.persistLongTermMemorySync({ ...request, memoryInstance: request.memoryInstance ?? 'defaultInstance' }, options);
  }

  private manualSaveLongTermMemorySync(request: ManualSaveLongTermMemoryRequest): LongTermMemoryRecord | SafeError {
    const validationError = validateManualSaveLongTermMemoryRequest(request);
    if (validationError !== undefined) {
      return validationError;
    }
    const normalizedRequest = {
      ...request,
      memoryInstance: request.memoryInstance ?? 'defaultInstance',
      source: 'MANUAL',
    } as const;
    if (
      normalizedRequest.memoryId === undefined &&
      normalizedRequest.knowledgeSourceType === 'CONFIGURED' &&
      this.countConfiguredPersonalMemories(normalizedRequest) >= maxConfiguredPersonalMemories
    ) {
      return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', `At most ${maxConfiguredPersonalMemories} configured long-term memories are allowed.`);
    }
    return this.persistLongTermMemorySync(normalizedRequest, {});
  }

  private countConfiguredPersonalMemories(
    scope: Pick<ManualSaveLongTermMemoryRequest, 'tenantId' | 'subjectId' | 'agentId'> & { readonly memoryInstance: string },
  ): number {
    const row = this.db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM long_term_memory
      WHERE tenant_id = ?
        AND subject_id = ?
        AND agent_id = ?
        AND memory_instance = ?
        AND knowledge_source_type = 'CONFIGURED'
        AND sharing_state != 'SHARED'
    `,
      )
      .get(scope.tenantId, scope.subjectId, scope.agentId, scope.memoryInstance) as { readonly count: number };
    return row.count;
  }

  private persistLongTermMemorySync(request: CanonicalSaveLongTermMemoryRequest, options: VersionedWriteOptions): LongTermMemoryRecord | SafeError {
    if (options.idempotencyKey !== undefined) {
      const existingByKey = this.getLongTermMemoryByIdempotencyKey(
        request.tenantId,
        request.subjectId,
        request.agentId,
        request.memoryInstance,
        options.idempotencyKey,
      );
      if (existingByKey !== undefined) {
        return toLongTermMemoryRecord(existingByKey);
      }
    }
    const current =
      request.memoryId === undefined
        ? undefined
        : this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, request.memoryInstance);
    const now = nowEpoch();
    const currentRecord = current === undefined ? undefined : toLongTermMemoryRecord(current);
    if (currentRecord?.sharingState === 'SHARED') {
      return ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Shared memory cannot be changed through the store gateway.');
    }
    if (options.expectedVersion !== undefined && currentRecord?.version !== options.expectedVersion) {
      return ltmSafeError('LTM_WRITE_INVALID', 'CONFLICT', 'Long-term memory version conflict.');
    }
    const nextRecord = this.buildSavedLongTermMemoryRecord(request, currentRecord, now);
    this.putLongTermMemory(nextRecord, current?.idempotency_key ?? options.idempotencyKey ?? null);
    return nextRecord;
  }

  private deleteLongTermMemorySync(request: DeleteLongTermMemoryRequest): DeleteLongTermMemoryResult | SafeError {
    const scopeError =
      !isPlainRecord(request) || !hasExactFields(request, ['tenantId', 'subjectId', 'agentId', 'memoryId'], ['memoryInstance', 'reasonCode'])
        ? ltmSafeError('LTM_WRITE_INVALID', 'VALIDATION', 'Long-term memory delete request is invalid.')
        : (validateLtmScope(request, 'LTM_WRITE_INVALID') ??
          validateLtmString(request.memoryId, 'memoryId', 1, 64) ??
          validateLtmOptionalString(request.memoryInstance, 'memoryInstance', 1, 64) ??
          validateLtmOptionalString(request.reasonCode, 'reasonCode', 1, 128));
    if (scopeError !== undefined) {
      return scopeError;
    }
    const row = this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, request.memoryInstance);
    if (row === undefined || row.sharing_state === 'SHARED') {
      return ltmSafeError('LTM_MEMORY_NOT_FOUND', 'NOT_FOUND', 'Long-term memory entry was not found.');
    }
    this.deleteLongTermMemoryRow(row);
    return { memoryId: request.memoryId };
  }

  private mutateLongTermMemorySync(
    request: MutateLongTermMemoryRequest,
    options: Pick<VersionedWriteOptions, 'expectedVersion'>,
  ): LongTermMemoryVersionedUpdateResult {
    const current = this.getLongTermMemoryRow(request.tenantId, request.subjectId, request.agentId, request.memoryId, request.memoryInstance);
    if (current === undefined || current.sharing_state === 'SHARED') {
      return { status: 'NOT_FOUND', memoryId: request.memoryId };
    }
    const currentRecord = toLongTermMemoryRecord(current);
    if (options.expectedVersion !== undefined && currentRecord.version !== options.expectedVersion) {
      return { status: 'VERSION_CONFLICT', memoryId: currentRecord.memoryId, currentVersion: currentRecord.version, record: currentRecord };
    }
    const now = nowEpoch();
    let updated: LongTermMemoryRecord;
    if (request.targetState !== undefined) {
      const base = request.targetState === 'ACTIVE' ? clearLongTermMemoryArchiveFields(currentRecord) : currentRecord;
      updated = {
        ...base,
        state: request.targetState,
        archivedAt: request.targetState === 'ARCHIVED' ? now : brand<number, 'EpochMillis'>(0),
        archiveReason: request.targetState === 'ARCHIVED' ? (request.archiveReason ?? '') : '',
        version: currentRecord.version + 1,
        updateTime: now,
      };
    } else if (request.delta !== undefined) {
      updated = {
        ...currentRecord,
        confidence: Math.max(0, Math.min(1, currentRecord.confidence + request.delta)),
        version: currentRecord.version + 1,
        updateTime: now,
      };
    } else if (request.lastAccessTime !== undefined) {
      updated = {
        ...currentRecord,
        lastAccessedAt: request.lastAccessTime,
        version: currentRecord.version + 1,
        updateTime: now,
      };
    } else {
      updated = {
        ...currentRecord,
        isPinned: request.isPinned!,
        version: currentRecord.version + 1,
        updateTime: now,
      };
    }
    this.putLongTermMemory(updated, current.idempotency_key);
    return { status: 'UPDATED', memoryId: updated.memoryId, currentVersion: updated.version, record: updated };
  }

  private buildLongTermMemoryListWhere(
    query: ListLongTermMemoryQuery,
    defaultActive: boolean,
  ): { readonly where: string; readonly values: ReadonlyArray<string | number> } {
    const conditions = ['tenant_id = ?', 'subject_id = ?', 'agent_id = ?', 'memory_instance = ?', "sharing_state != 'SHARED'"];
    const values: Array<string | number> = [query.tenantId, query.subjectId, query.agentId, query.memoryInstance ?? 'defaultInstance'];
    const state = query.state ?? (defaultActive ? 'ACTIVE' : undefined);
    if (state !== undefined) {
      conditions.push('state = ?');
      values.push(state);
    }
    this.appendLongTermMemorySharedFilters(conditions, values, query);
    if (query.sinceTime !== undefined) {
      conditions.push('created_at >= ?');
      values.push(Number(query.sinceTime));
    }
    if (query.untilTime !== undefined) {
      conditions.push('created_at <= ?');
      values.push(Number(query.untilTime));
    }
    if (query.maxLastAccessedAt !== undefined) {
      conditions.push('COALESCE(last_accessed_at, created_at) <= ?');
      values.push(Number(query.maxLastAccessedAt));
    }
    if (query.labels !== undefined) {
      conditions.push('tags_json LIKE ?');
      values.push(`%${query.labels}%`);
    }
    if (query.queryText !== undefined) {
      const needle = `%${query.queryText.replace(/[\\%_]/gu, '\\$&')}%`;
      conditions.push("(brief_index LIKE ? ESCAPE '\\' OR content_json LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')");
      values.push(needle, needle, needle);
    }
    return { where: `WHERE ${conditions.join(' AND ')}`, values };
  }

  private appendLongTermMemorySharedFilters(
    conditions: string[],
    values: Array<string | number>,
    query: {
      readonly memoryType?: MemoryType;
      readonly knowledgeSourceType?: KnowledgeSourceType;
      readonly isPinned?: boolean;
      readonly minConfidence?: number;
    },
  ): void {
    if (query.memoryType !== undefined) {
      conditions.push('category = ?');
      values.push(query.memoryType);
    }
    if (query.knowledgeSourceType !== undefined) {
      conditions.push('knowledge_source_type = ?');
      values.push(query.knowledgeSourceType);
    }
    if (query.isPinned !== undefined) {
      conditions.push('is_pinned = ?');
      values.push(query.isPinned ? 1 : 0);
    }
    conditions.push('confidence >= ?');
    values.push(query.minConfidence ?? 0.3);
  }

  private buildLongTermMemorySearchWhere(
    query: SearchLongTermMemoryQuery,
    prefix = '',
  ): { readonly where: string; readonly values: ReadonlyArray<string | number> } {
    const conditions = [
      `${prefix}tenant_id = ?`,
      `${prefix}subject_id = ?`,
      `${prefix}agent_id = ?`,
      `${prefix}memory_instance = ?`,
      `${prefix}sharing_state != 'SHARED'`,
    ];
    const values: Array<string | number> = [query.tenantId, query.subjectId, query.agentId, query.memoryInstance ?? 'defaultInstance'];
    if (query.sinceTime === undefined && query.untilTime === undefined) {
      conditions.push(`${prefix}state = ?`);
      values.push('ACTIVE');
    } else {
      conditions.push(`${prefix}state IN ('ACTIVE', 'ARCHIVED')`);
    }
    if (query.memoryType !== undefined) {
      conditions.push(`${prefix}category = ?`);
      values.push(query.memoryType);
    }
    if (query.knowledgeSourceType !== undefined) {
      conditions.push(`${prefix}knowledge_source_type = ?`);
      values.push(query.knowledgeSourceType);
    }
    conditions.push(`${prefix}confidence >= ?`);
    values.push(query.minConfidence ?? 0.3);
    if (query.sinceTime !== undefined) {
      conditions.push(`${prefix}created_at >= ?`);
      values.push(Number(query.sinceTime));
    }
    if (query.untilTime !== undefined) {
      conditions.push(`${prefix}created_at <= ?`);
      values.push(Number(query.untilTime));
    }
    for (const label of query.labels ?? []) {
      conditions.push(`${prefix}tags_json LIKE ?`);
      values.push(`%${label}%`);
    }
    return { where: `WHERE ${conditions.join(' AND ')}`, values };
  }

  private searchLongTermMemoryWithFts(query: SearchLongTermMemoryQuery): SearchItemPage {
    if (!this.longTermMemoryFtsAvailable && !this.recoverLongTermMemoryFts()) {
      throw new Error('Long-term memory FTS is unavailable.');
    }
    const { where, values } = this.buildLongTermMemorySearchWhere(query, 'm.');
    const rows = this.db
      .prepare(
        `SELECT m.*, bm25(long_term_memory_fts) AS fts_rank
         FROM long_term_memory_fts
         JOIN long_term_memory m
           ON m.tenant_id = long_term_memory_fts.tenant_id
          AND m.subject_id = long_term_memory_fts.subject_id
          AND m.agent_id = long_term_memory_fts.agent_id
          AND m.memory_instance = long_term_memory_fts.memory_instance
          AND m.long_term_memory_id = long_term_memory_fts.long_term_memory_id
         ${where} AND long_term_memory_fts MATCH ?`,
      )
      .all(...values, toFtsMatchQuery(query.queryText)) as unknown as Array<LongTermMemoryRow & { readonly fts_rank: number }>;
    return this.projectSearchRows(
      rows.map((row) => ({ record: toLongTermMemoryRecord(row), ftsRank: 1 / (1 + Math.abs(row.fts_rank)) })),
      query,
    );
  }

  private searchLongTermMemoryWithLiteralMatch(query: SearchLongTermMemoryQuery): SearchItemPage {
    const { where, values } = this.buildLongTermMemorySearchWhere(query);
    const needle = query.queryText.trim().toLocaleLowerCase();
    const rows = (this.db.prepare(`SELECT * FROM long_term_memory ${where}`).all(...values) as unknown as LongTermMemoryRow[])
      .map(toLongTermMemoryRecord)
      .filter((record) => {
        const haystack = `${record.briefIndex} ${record.labels.join(' ')} ${record.content}`.toLocaleLowerCase();
        return haystack.includes(needle);
      })
      .map((record) => ({ record, ftsRank: 1 }));
    return this.projectSearchRows(rows, query);
  }

  private projectSearchRows(
    rows: ReadonlyArray<{ readonly record: LongTermMemoryRecord; readonly ftsRank: number }>,
    query: SearchLongTermMemoryQuery,
  ): SearchItemPage {
    const limit = normalizeLtmLimit(query.limit);
    const offset = normalizeLtmOffset(query.offset);
    const now = Date.now();
    const scored = rows
      .map(({ record, ftsRank }) => ({
        summary: toLongTermMemorySummary(record),
        score: scoreLongTermMemory(record, ftsRank, now),
        relevanceScore: clamp01(ftsRank),
      }))
      .sort((left, right) => right.score - left.score || left.summary.memoryId.localeCompare(right.summary.memoryId));
    return {
      items: scored.slice(offset, offset + limit),
      total: scored.length,
      offset,
      limit,
    };
  }

  private incrementLongTermMemoryRecallCount(ids: readonly LongTermMemoryId[], query: SearchLongTermMemoryQuery): void {
    if (ids.length === 0) {
      return;
    }
    const update = this.db.prepare(
      `UPDATE long_term_memory
       SET recall_count = recall_count + 1
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ? AND long_term_memory_id = ?`,
    );
    for (const id of ids) {
      update.run(query.tenantId, query.subjectId, query.agentId, query.memoryInstance ?? 'defaultInstance', id);
    }
  }

  private upsertLongTermMemoryFts(record: LongTermMemoryRecord): void {
    if (!this.longTermMemoryFtsAvailable && !this.initializeLongTermMemoryFtsSchema()) {
      return;
    }
    try {
      this.deleteLongTermMemoryFtsRow(record.tenantId, record.subjectId, record.agentId, record.memoryInstance, record.memoryId);
      this.insertLongTermMemoryFtsRow(record);
      this.longTermMemoryFtsAvailable = true;
    } catch {
      this.longTermMemoryFtsAvailable = false;
    }
  }

  private deleteLongTermMemoryFts(tenantId: string, subjectId: string, agentId: string, memoryInstance: string, longTermMemoryId: string): void {
    if (!this.longTermMemoryFtsAvailable && !this.initializeLongTermMemoryFtsSchema()) {
      return;
    }
    try {
      this.deleteLongTermMemoryFtsRow(tenantId, subjectId, agentId, memoryInstance, longTermMemoryId);
      this.longTermMemoryFtsAvailable = true;
    } catch {
      this.longTermMemoryFtsAvailable = false;
    }
  }

  private insertLongTermMemoryFtsRow(record: LongTermMemoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO long_term_memory_fts(tenant_id, subject_id, agent_id, memory_instance, long_term_memory_id, brief_index, tags, content_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.memoryInstance,
        record.memoryId,
        record.briefIndex,
        record.labels.join(' '),
        record.content,
      );
  }

  private deleteLongTermMemoryFtsRow(tenantId: string, subjectId: string, agentId: string, memoryInstance: string, longTermMemoryId: string): void {
    this.db
      .prepare(
        `DELETE FROM long_term_memory_fts
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ? AND long_term_memory_id = ?`,
      )
      .run(tenantId, subjectId, agentId, memoryInstance, longTermMemoryId);
  }

  private deleteLongTermMemoryRow(row: LongTermMemoryRow): void {
    this.db
      .prepare(
        `DELETE FROM long_term_memory
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND memory_instance = ? AND long_term_memory_id = ?`,
      )
      .run(row.tenant_id, row.subject_id, row.agent_id, row.memory_instance, row.long_term_memory_id);
    this.deleteLongTermMemoryFts(row.tenant_id, row.subject_id, row.agent_id, row.memory_instance, row.long_term_memory_id);
  }

  private toPublishLongTermMemoryResult(record: LongTermMemoryRecord): PublishLongTermMemoryResult {
    return {
      publishedMemory: record,
      sourceMemoryId: record.sourceMemoryId!,
      ownerSubjectId: record.subjectId,
    };
  }

  private buildPublishedLongTermMemoryWhere(query: ListPublishedLongTermMemoryQuery): {
    readonly where: string;
    readonly values: ReadonlyArray<string | number>;
  } {
    const conditions = ['tenant_id = ?', 'agent_id = ?', 'memory_instance = ?', "sharing_state = 'SHARED'", "state = 'ACTIVE'"];
    const values: Array<string | number> = [query.tenantId, query.agentId, query.memoryInstance ?? 'defaultInstance'];
    if (query.memoryType !== undefined) {
      conditions.push('category = ?');
      values.push(query.memoryType);
    }
    if (query.knowledgeSourceType !== undefined) {
      conditions.push('knowledge_source_type = ?');
      values.push(query.knowledgeSourceType);
    }
    if (query.labels !== undefined) {
      conditions.push('tags_json LIKE ?');
      values.push(`%${query.labels}%`);
    }
    if (query.queryText !== undefined) {
      conditions.push('(brief_index LIKE ? OR content_json LIKE ? OR tags_json LIKE ?)');
      const needle = `%${query.queryText}%`;
      values.push(needle, needle, needle);
    }
    return { where: `WHERE ${conditions.join(' AND ')}`, values };
  }

  private initializeLongTermMemoryFtsSchema(): boolean {
    try {
      const existingColumns = this.db.prepare('PRAGMA table_info(long_term_memory_fts)').all() as Array<{ readonly name: string }>;
      const rebuild = existingColumns.length > 0 && !existingColumns.some((column) => column.name === 'memory_instance');
      if (rebuild) {
        this.db.exec('DROP TABLE long_term_memory_fts;');
      }
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS long_term_memory_fts USING fts5(
          tenant_id UNINDEXED,
          subject_id UNINDEXED,
          agent_id UNINDEXED,
          memory_instance UNINDEXED,
          long_term_memory_id UNINDEXED,
          brief_index,
          tags,
          content_body
        );
      `);
      if (rebuild) {
        const rows = this.db.prepare('SELECT * FROM long_term_memory').all() as unknown as LongTermMemoryRow[];
        for (const row of rows) {
          this.insertLongTermMemoryFtsRow(toLongTermMemoryRecord(row));
        }
      }
      this.longTermMemoryFtsAvailable = true;
      return true;
    } catch {
      this.longTermMemoryFtsAvailable = false;
      return false;
    }
  }

  private recoverLongTermMemoryFts(): boolean {
    if (!this.initializeLongTermMemoryFtsSchema()) {
      return false;
    }
    try {
      this.db.exec('DELETE FROM long_term_memory_fts;');
      const rows = this.db.prepare('SELECT * FROM long_term_memory').all() as unknown as LongTermMemoryRow[];
      for (const row of rows) {
        this.insertLongTermMemoryFtsRow(toLongTermMemoryRecord(row));
      }
      this.longTermMemoryFtsAvailable = true;
      return true;
    } catch {
      this.longTermMemoryFtsAvailable = false;
      return false;
    }
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_runs (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        terminal_commit_state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        idempotency_key TEXT,
        idempotency_semantic TEXT,
        terminal_commit_idempotency_key TEXT,
        terminal_commit_idempotency_semantic TEXT,
        locked_by TEXT,
        lock_expires_at INTEGER,
        json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS request_run_memory_recall_attempts (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        request_run_id TEXT NOT NULL,
        hook_id TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, request_run_id, hook_id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        parent_session_id TEXT,
        parent_run_id TEXT,
        parent_request_id TEXT,
        title TEXT,
        title_source TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        idempotency_key TEXT,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_history
        ON sessions(tenant_id, subject_id, agent_id, updated_at DESC, session_id ASC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_idempotency
        ON sessions(tenant_id, subject_id, agent_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS messages (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL,
        metadata TEXT NOT NULL,
        visible INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        idempotency_key TEXT,
        PRIMARY KEY (tenant_id, subject_id, agent_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session_history
        ON messages(tenant_id, subject_id, agent_id, session_id, created_at ASC, message_id ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_current_request
        ON messages(tenant_id, subject_id, agent_id, session_id, request_id, run_id, created_at ASC, message_id ASC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency
        ON messages(tenant_id, subject_id, agent_id, session_id, request_id, COALESCE(run_id, ''), idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS session_forks (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        source_anchor_message_id TEXT NOT NULL,
        child_anchor_message_id TEXT NOT NULL,
        source_session_title_snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, child_session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_forks_source
        ON session_forks(tenant_id, subject_id, agent_id, source_session_id, source_anchor_message_id);

      CREATE TABLE IF NOT EXISTS session_fork_idempotency (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        source_anchor_message_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, source_session_id, source_anchor_message_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_session_fork_idempotency_child
        ON session_fork_idempotency(tenant_id, subject_id, agent_id, child_session_id);

      CREATE TABLE IF NOT EXISTS fork_process_snapshot_statuses (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('AVAILABLE', 'LEGACY_UNAVAILABLE')),
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS fork_promoted_contents (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        fork_attempt_id TEXT NOT NULL,
        promoted_content_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        source_ref_id TEXT NOT NULL DEFAULT '',
        child_session_id TEXT NOT NULL,
        child_message_id TEXT NOT NULL,
        ref_type TEXT NOT NULL,
        blob_ref TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_digest TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('STAGED', 'COMMITTED', 'ABORTED')),
        created_at INTEGER NOT NULL,
        committed_at INTEGER,
        aborted_at INTEGER,
        PRIMARY KEY (tenant_id, subject_id, agent_id, promoted_content_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fork_promotions_attempt
        ON fork_promoted_contents(tenant_id, subject_id, agent_id, fork_attempt_id, child_session_id, status);
      CREATE INDEX IF NOT EXISTS idx_fork_promotions_cleanup
        ON fork_promoted_contents(status, created_at);

      CREATE TABLE IF NOT EXISTS attachments (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_ref TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        availability_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, attachment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_request
        ON attachments(tenant_id, subject_id, agent_id, request_id, created_at ASC, attachment_id ASC);

      CREATE INDEX IF NOT EXISTS idx_attachments_session
        ON attachments(tenant_id, subject_id, agent_id, session_id, created_at ASC, attachment_id ASC);

      CREATE TABLE IF NOT EXISTS blobs (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        blob_ref TEXT NOT NULL,
        purpose TEXT NOT NULL,
        bytes BLOB NOT NULL,
        idempotency_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, blob_ref)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blobs_idempotency
        ON blobs(tenant_id, subject_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS attachment_intake_reservations (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        request_context_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        action TEXT NOT NULL,
        command_semantic_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        attachment_ids TEXT NOT NULL,
        rejection_reason_code TEXT,
        safe_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, reservation_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_intake_reservation_key
        ON attachment_intake_reservations(tenant_id, subject_id, agent_id, session_id, idempotency_key, action);

      CREATE TABLE IF NOT EXISTS active_context_states (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        active_context_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS active_context_items (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id, ordinal)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_context_message
        ON active_context_items(tenant_id, subject_id, agent_id, session_id, message_id);

      CREATE TABLE IF NOT EXISTS timeline_events (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        idempotency_key TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id, sequence)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_events_idempotency
        ON timeline_events(tenant_id, subject_id, agent_id, session_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_timeline_events_run_sequence
        ON timeline_events(tenant_id, subject_id, agent_id, session_id, run_id, sequence);

      CREATE TABLE IF NOT EXISTS checkpoints (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        request_context_id TEXT NOT NULL,
        run_version INTEGER NOT NULL,
        agent_turn_index INTEGER NOT NULL DEFAULT 0,
        trigger_reason TEXT NOT NULL,
        last_sequence INTEGER NOT NULL,
        active_context_version INTEGER NOT NULL,
        flow_variables TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, checkpoint_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_idempotency
        ON checkpoints(tenant_id, subject_id, agent_id, session_id, request_id, run_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS long_term_memory (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        memory_instance TEXT NOT NULL DEFAULT 'defaultInstance',
        long_term_memory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        category TEXT NOT NULL,
        knowledge_source_type TEXT NOT NULL DEFAULT 'LEARNED',
        sharing_state TEXT NOT NULL DEFAULT 'PRIVATE',
        source_memory_id TEXT,
        confidence REAL NOT NULL,
        state TEXT NOT NULL,
        brief_index TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        access_count INTEGER NOT NULL,
        recall_count INTEGER NOT NULL,
        extraction_count INTEGER NOT NULL,
        last_accessed_at INTEGER,
        archived_at INTEGER,
        archive_reason TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        source_trace_session_id TEXT NOT NULL,
        source_trace_request_id TEXT,
        source_trace_extraction_cycle_id TEXT,
        source_trace_json TEXT NOT NULL,
        content_json TEXT NOT NULL,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, memory_instance, long_term_memory_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ltm_list
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, sharing_state, state, created_at DESC, long_term_memory_id ASC);
      CREATE INDEX IF NOT EXISTS idx_ltm_state
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, sharing_state, state, confidence DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ltm_idempotency
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS task_trajectory (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        task_trajectory_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        request_run_id TEXT NOT NULL,
        task_kind TEXT NOT NULL,
        trajectory_build_status TEXT NOT NULL,
        task_outcome_status TEXT NOT NULL,
        outcome_evidence_level TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        idempotency_key TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, task_trajectory_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_trajectory_run
        ON task_trajectory(tenant_id, subject_id, agent_id, session_id, request_run_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_trajectory_idempotency
        ON task_trajectory(tenant_id, subject_id, agent_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_task_trajectory_list
        ON task_trajectory(tenant_id, subject_id, agent_id, completed_at DESC, task_trajectory_id ASC);
      CREATE INDEX IF NOT EXISTS idx_task_trajectory_filters
        ON task_trajectory(tenant_id, subject_id, agent_id, task_kind, trajectory_build_status, task_outcome_status, outcome_evidence_level);

      CREATE TABLE IF NOT EXISTS todo_state_revisions (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision_seq INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        request_run_id TEXT NOT NULL,
        request_context_id TEXT NOT NULL,
        tool_call_id TEXT,
        todos_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id, revision_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_todo_state_revisions_session
        ON todo_state_revisions(tenant_id, subject_id, agent_id, session_id, revision_seq ASC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_state_revisions_invocation
        ON todo_state_revisions(tenant_id, subject_id, agent_id, session_id, request_id, request_run_id, request_context_id, COALESCE(tool_call_id, ''));

      CREATE TABLE IF NOT EXISTS todo_states_current (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision_seq INTEGER NOT NULL,
        todos_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS pending_inputs (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        pending_input_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        request_run_id TEXT NOT NULL,
        request_context_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        request TEXT NOT NULL,
        producer_ref TEXT NOT NULL,
        timeout_at INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        authorization_scope TEXT,
        response_answers TEXT,
        resolve_idempotency_key TEXT,
        resolve_idempotency_semantic TEXT,
        PRIMARY KEY (tenant_id, subject_id, agent_id, pending_input_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_inputs_run
        ON pending_inputs(tenant_id, subject_id, agent_id, request_run_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_inputs_active
        ON pending_inputs(tenant_id, subject_id, agent_id, session_id)
        WHERE status = 'PENDING';

      CREATE TABLE IF NOT EXISTS conversation_annotations (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        annotation_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_run_id TEXT NOT NULL,
        sentiment TEXT,
        is_favorited INTEGER NOT NULL DEFAULT 0,
        question_favorite INTEGER NOT NULL DEFAULT 0 CHECK (question_favorite IN (0, 1)),
        comment TEXT,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, annotation_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_annotations_run
        ON conversation_annotations(tenant_id, subject_id, agent_id, session_id, request_run_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_annotations_idempotency
        ON conversation_annotations(tenant_id, subject_id, agent_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_conversation_annotations_session
        ON conversation_annotations(tenant_id, subject_id, agent_id, session_id, created_at ASC, annotation_id ASC);
     CREATE INDEX IF NOT EXISTS idx_conversation_annotations_favorites
       ON conversation_annotations(tenant_id, subject_id, agent_id, is_favorited, updated_at DESC, session_id ASC);
      CREATE TABLE IF NOT EXISTS conversation_shares (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        share_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_ids TEXT NOT NULL,
        origin_url TEXT NOT NULL,
        allowed_ops TEXT,
        expires_at INTEGER,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, share_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_shares_share_id
        ON conversation_shares(share_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_shares_idempotency
        ON conversation_shares(tenant_id, subject_id, agent_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_conversation_shares_session
        ON conversation_shares(tenant_id, subject_id, agent_id, session_id);
      CREATE TABLE IF NOT EXISTS user_question_activity (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        question_hash TEXT NOT NULL,
        question_text TEXT NOT NULL,
        locale TEXT NOT NULL,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        pinned_at INTEGER,
        ask_frequency INTEGER NOT NULL DEFAULT 0,
        last_asked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, question_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_user_question_activity_pinned
        ON user_question_activity(tenant_id, subject_id, agent_id, is_pinned, pinned_at ASC);
      CREATE INDEX IF NOT EXISTS idx_user_question_activity_frequency
        ON user_question_activity(tenant_id, subject_id, agent_id, ask_frequency DESC, last_asked_at DESC);    `);
    this.ensureColumn('request_runs', 'idempotency_semantic', 'TEXT');
    this.ensureColumn('request_runs', 'terminal_commit_idempotency_key', 'TEXT');
    this.ensureColumn('request_runs', 'terminal_commit_idempotency_semantic', 'TEXT');
    this.ensureColumn('pending_inputs', 'producer_ref', 'TEXT NOT NULL DEFAULT \'{"kind":"LIFECYCLE_HOOK"}\'');
    this.ensureColumn('pending_inputs', 'timeout_at', 'INTEGER');
    this.ensureColumn('sessions', 'parent_session_id', 'TEXT');
    this.ensureColumn('sessions', 'parent_run_id', 'TEXT');
    this.ensureColumn('sessions', 'parent_request_id', 'TEXT');
    this.ensureColumn('pending_inputs', 'authorization_scope', 'TEXT');
    this.ensureColumn('attachments', 'size_bytes', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('attachments', 'size_bytes', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('pending_inputs', 'resolve_idempotency_key', 'TEXT');
    this.ensureColumn('pending_inputs', 'resolve_idempotency_semantic', 'TEXT');
    this.ensureColumn('active_context_states', 'metadata', 'TEXT');
    this.ensureColumn('checkpoints', 'agent_turn_index', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversation_annotations', 'question_favorite', 'INTEGER NOT NULL DEFAULT 0 CHECK (question_favorite IN (0, 1))');
    this.ensureColumn('long_term_memory', 'memory_instance', "TEXT NOT NULL DEFAULT 'defaultInstance'");
    this.ensureColumn('long_term_memory', 'knowledge_source_type', "TEXT NOT NULL DEFAULT 'LEARNED'");
    this.ensureColumn('long_term_memory', 'sharing_state', "TEXT NOT NULL DEFAULT 'PRIVATE'");
    this.ensureColumn('long_term_memory', 'source_memory_id', 'TEXT');
    this.ensureColumn('fork_promoted_contents', 'source_ref_id', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('fork_promoted_contents', 'content_digest', "TEXT NOT NULL DEFAULT ''");
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_fork_promotions_source_ref
       ON fork_promoted_contents(tenant_id, subject_id, agent_id, fork_attempt_id, source_message_id, source_ref_id)
       WHERE source_ref_id <> '';`,
    );
    this.ensureLongTermMemoryScopedPrimaryKey();
    this.initializeLongTermMemoryFtsSchema();
    this.db.exec(`
      DROP INDEX IF EXISTS idx_ltm_list;
      DROP INDEX IF EXISTS idx_ltm_state;
      DROP INDEX IF EXISTS idx_ltm_idempotency;
      CREATE INDEX idx_ltm_list
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, sharing_state, state, created_at DESC, long_term_memory_id ASC);
      CREATE INDEX idx_ltm_state
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, sharing_state, state, confidence DESC);
      CREATE UNIQUE INDEX idx_ltm_idempotency
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ltm_published_source
        ON long_term_memory(tenant_id, subject_id, agent_id, memory_instance, source_memory_id)
        WHERE sharing_state = 'SHARED' AND source_memory_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ltm_shared_pool
        ON long_term_memory(tenant_id, agent_id, memory_instance, sharing_state, created_at DESC, long_term_memory_id ASC);
    `);
    this.db.exec('DROP INDEX IF EXISTS idx_request_runs_idempotency;');
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_request_runs_idempotency
        ON request_runs(tenant_id, subject_id, agent_id, session_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_request_runs_terminal_idempotency
        ON request_runs(tenant_id, subject_id, agent_id, session_id, terminal_commit_idempotency_key)
        WHERE terminal_commit_idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_request_runs_lane
        ON request_runs(tenant_id, subject_id, agent_id, session_id, created_at DESC, run_id DESC);
      CREATE INDEX IF NOT EXISTS idx_request_runs_recovery
        ON request_runs(agent_id, status, terminal_commit_state, lock_expires_at, updated_at, created_at, run_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_inputs_active
        ON pending_inputs(tenant_id, subject_id, agent_id, session_id)
        WHERE status = 'PENDING';
      DROP INDEX IF EXISTS idx_pending_inputs_due;
      DROP INDEX IF EXISTS idx_pending_inputs_timeout_candidates;
      CREATE INDEX IF NOT EXISTS idx_pending_inputs_timeout_facts
        ON pending_inputs(agent_id, timeout_at, pending_input_id, status)
        WHERE timeout_at IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_inputs_resolve_idempotency
        ON pending_inputs(tenant_id, subject_id, agent_id, session_id, pending_input_id, resolve_idempotency_key)
        WHERE resolve_idempotency_key IS NOT NULL;
    `);
  }

  private transaction<TResult>(work: () => TResult): TResult {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private getRunRow(tenantId: string, subjectId: string, agentId: string, runId: string): RunJsonRow | undefined {
    return this.db
      .prepare(
        'SELECT json, idempotency_key, idempotency_semantic FROM request_runs WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND run_id = ?',
      )
      .get(tenantId, subjectId, agentId, runId) as RunJsonRow | undefined;
  }

  private getMemoryRecallAttempt(request: RequestRunMemoryRecallAttemptLookupRequest): RequestRunMemoryRecallAttemptRecord | undefined {
    return parseJsonRow<RequestRunMemoryRecallAttemptRecord>(
      this.db
        .prepare(
          `SELECT json FROM request_run_memory_recall_attempts
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND request_run_id = ? AND hook_id = ?`,
        )
        .get(request.tenantId, request.subjectId, request.agentId, request.requestRunId, request.hookId) as JsonRow | undefined,
    );
  }

  private getRunByAcceptanceIdempotencyKey(
    tenantId: string,
    subjectId: string,
    agentId: string,
    sessionId: string,
    idempotencyKey: string,
  ): { readonly record: RequestRunRecord; readonly idempotencySemantic: string | null } | undefined {
    const row = this.db
      .prepare(
        'SELECT json, idempotency_semantic FROM request_runs WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND idempotency_key = ?',
      )
      .get(tenantId, subjectId, agentId, sessionId, idempotencyKey) as RunJsonRow | undefined;
    const record = parseJsonRow<RequestRunRecord>(row);
    return record === undefined ? undefined : { record, idempotencySemantic: row?.idempotency_semantic ?? null };
  }

  private getRunByTerminalCommitIdempotencyKey(
    tenantId: string,
    subjectId: string,
    agentId: string,
    sessionId: string,
    idempotencyKey: string,
  ): { readonly record: RequestRunRecord; readonly idempotencySemantic: string | null } | undefined {
    const row = this.db
      .prepare(
        `SELECT json FROM request_runs
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND terminal_commit_idempotency_key = ?`,
      )
      .get(tenantId, subjectId, agentId, sessionId, idempotencyKey) as JsonRow | undefined;
    const record = parseJsonRow<RequestRunRecord>(row);
    return record === undefined ? undefined : { record, idempotencySemantic: record.terminalCommitIdempotencySemantic ?? null };
  }

  private putRun(record: RequestRunRecord, idempotencyKey?: string | null, idempotencySemantic?: string | null): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO request_runs(
          tenant_id, subject_id, run_id, session_id, request_id, agent_id, version, status,
          terminal_commit_state, created_at, updated_at, idempotency_key, idempotency_semantic,
          terminal_commit_idempotency_key, terminal_commit_idempotency_semantic, locked_by,
          lock_expires_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.runId,
        record.sessionId,
        record.requestId,
        record.agentId,
        record.version,
        record.status,
        record.terminalCommitState,
        Number(record.createdAt),
        Number(record.updatedAt),
        idempotencyKey ?? null,
        idempotencySemantic ?? null,
        record.terminalCommitIdempotencyKey ?? null,
        record.terminalCommitIdempotencySemantic ?? null,
        record.lockedBy ?? null,
        record.lockExpiresAt === undefined ? null : Number(record.lockExpiresAt),
        JSON.stringify(record),
      );
  }

  private getTaskTrajectoryByRun(
    tenantId: string,
    subjectId: string,
    agentId: string,
    sessionId: string,
    requestRunId: string,
  ): TaskTrajectoryRecord | undefined {
    return parseJsonRow<TaskTrajectoryRecord>(
      this.db
        .prepare(
          `SELECT json FROM task_trajectory
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_run_id = ?`,
        )
        .get(tenantId, subjectId, agentId, sessionId, requestRunId) as JsonRow | undefined,
    );
  }

  private getTaskTrajectoryByIdempotencyKey(
    tenantId: string,
    subjectId: string,
    agentId: string,
    idempotencyKey: string,
  ): TaskTrajectoryRecord | undefined {
    return parseJsonRow<TaskTrajectoryRecord>(
      this.db
        .prepare(
          `SELECT json FROM task_trajectory
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND idempotency_key = ?`,
        )
        .get(tenantId, subjectId, agentId, idempotencyKey) as JsonRow | undefined,
    );
  }

  private putTaskTrajectory(record: TaskTrajectoryRecord, idempotencyKey?: string | null): void {
    this.db
      .prepare(
        `INSERT INTO task_trajectory(
          tenant_id, subject_id, agent_id, task_trajectory_id, session_id, request_id, request_run_id,
          task_kind, trajectory_build_status, task_outcome_status, outcome_evidence_level,
          started_at, completed_at, created_at, updated_at, idempotency_key, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.taskTrajectoryId,
        record.sessionId,
        record.requestId,
        record.requestRunId,
        record.taskKind,
        record.trajectoryBuildStatus,
        record.taskOutcomeStatus,
        record.outcomeEvidenceLevel,
        Number(record.startedAt),
        Number(record.completedAt),
        Number(record.createdAt),
        Number(record.updatedAt),
        idempotencyKey ?? null,
        JSON.stringify(record),
      );
  }

  private loadCurrentTodoStateSync(request: TodoStateLookupRequest): TodoStateCurrentRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, session_id, revision_seq, todos_json, updated_at
       FROM todo_states_current
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId) as TodoStateRow | undefined;
    return row === undefined ? undefined : toTodoStateCurrentRecord(row);
  }

  private loadTodoRevisionByInvocation(request: ReplaceTodoStateRequest): TodoStateRevisionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, session_id, revision_seq, request_id, request_run_id, request_context_id, tool_call_id, todos_json, created_at
       FROM todo_state_revisions
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
         AND request_id = ? AND request_run_id = ? AND request_context_id = ?
         AND COALESCE(tool_call_id, '') = ?
       LIMIT 1`,
      )
      .get(
        request.tenantId,
        request.subjectId,
        request.agentId,
        request.sessionId,
        request.requestId,
        request.requestRunId,
        request.requestContextId,
        request.toolCallId ?? '',
      ) as TodoStateRevisionRow | undefined;
    return row === undefined ? undefined : toTodoStateRevisionRecord(row);
  }

  private todoResultFromRevision(request: TodoStateLookupRequest, revision: TodoStateRevisionRecord): ReplaceTodoStateResult {
    const previous = this.loadTodoRevisionBefore(request, revision.revisionSeq);
    const oldTodos = previous?.todos ?? [];
    const current =
      revision.todos.length === 0
        ? undefined
        : ({
            tenantId: revision.tenantId,
            subjectId: revision.subjectId,
            agentId: revision.agentId,
            sessionId: revision.sessionId,
            revisionSeq: revision.revisionSeq,
            todos: revision.todos,
            updatedAt: revision.createdAt,
          } satisfies TodoStateCurrentRecord);
    return {
      oldTodos,
      newTodos: revision.todos,
      revision,
      ...(current === undefined ? {} : { current }),
    };
  }

  private loadTodoRevisionBefore(request: TodoStateLookupRequest, revisionSeq: number): TodoStateRevisionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, session_id, revision_seq, request_id, request_run_id, request_context_id, tool_call_id, todos_json, created_at
       FROM todo_state_revisions
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND revision_seq < ?
       ORDER BY revision_seq DESC
       LIMIT 1`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId, revisionSeq) as TodoStateRevisionRow | undefined;
    return row === undefined ? undefined : toTodoStateRevisionRecord(row);
  }

  private nextTodoRevisionSeq(request: TodoStateLookupRequest): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(revision_seq), 0) + 1 AS revision_seq
       FROM todo_state_revisions
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId) as { readonly revision_seq: number };
    return row.revision_seq;
  }

  private insertTodoRevision(record: TodoStateRevisionRecord): void {
    this.db
      .prepare(
        `INSERT INTO todo_state_revisions(tenant_id, subject_id, agent_id, session_id, revision_seq, request_id, request_run_id, request_context_id, tool_call_id, todos_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.sessionId,
        record.revisionSeq,
        record.requestId,
        record.requestRunId,
        record.requestContextId,
        record.toolCallId ?? null,
        JSON.stringify(record.todos),
        Number(record.createdAt),
      );
  }

  private upsertCurrentTodoState(record: TodoStateCurrentRecord): void {
    this.db
      .prepare(
        `INSERT INTO todo_states_current(tenant_id, subject_id, agent_id, session_id, revision_seq, todos_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, subject_id, agent_id, session_id)
       DO UPDATE SET revision_seq = excluded.revision_seq, todos_json = excluded.todos_json, updated_at = excluded.updated_at`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.sessionId,
        record.revisionSeq,
        JSON.stringify(record.todos),
        Number(record.updatedAt),
      );
  }

  private deleteCurrentTodoState(request: TodoStateLookupRequest): void {
    this.db
      .prepare(
        `DELETE FROM todo_states_current
       WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .run(request.tenantId, request.subjectId, request.agentId, request.sessionId);
  }

  private logTodoStateReplaceCompleted(result: ReplaceTodoStateResult, durationMs: number): void {
    logger.info({
      event: 'todo.gateway.replace.completed',
      revisionSeq: result.revision.revisionSeq,
      oldItemCount: result.oldTodos.length,
      newItemCount: result.newTodos.length,
      currentProjectionAction: result.current === undefined ? 'deleted' : 'upserted',
      durationBucket: todoStateDurationBucket(durationMs),
    });
  }

  private isTerminalStatus(status: RequestRunRecord['status']): boolean {
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'SUPERSEDED';
  }

  private ensureLongTermMemoryScopedPrimaryKey(): void {
    const columns = this.db.prepare('PRAGMA table_info(long_term_memory)').all() as Array<{ readonly name: string; readonly pk: number }>;
    const primaryKey = columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    if (primaryKey.join(',') === 'tenant_id,subject_id,agent_id,memory_instance,long_term_memory_id') {
      return;
    }
    this.db.exec(`
      CREATE TABLE long_term_memory_scoped (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        memory_instance TEXT NOT NULL DEFAULT 'defaultInstance',
        long_term_memory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        category TEXT NOT NULL,
        knowledge_source_type TEXT NOT NULL DEFAULT 'LEARNED',
        sharing_state TEXT NOT NULL DEFAULT 'PRIVATE',
        source_memory_id TEXT,
        confidence REAL NOT NULL,
        state TEXT NOT NULL,
        brief_index TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        access_count INTEGER NOT NULL,
        recall_count INTEGER NOT NULL,
        extraction_count INTEGER NOT NULL,
        last_accessed_at INTEGER,
        archived_at INTEGER,
        archive_reason TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        source_trace_session_id TEXT NOT NULL,
        source_trace_request_id TEXT,
        source_trace_extraction_cycle_id TEXT,
        source_trace_json TEXT NOT NULL,
        content_json TEXT NOT NULL,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, memory_instance, long_term_memory_id)
      );
      INSERT INTO long_term_memory_scoped(
        tenant_id, subject_id, agent_id, memory_instance, long_term_memory_id, version, category,
        knowledge_source_type, sharing_state, source_memory_id, confidence, state, brief_index, tags_json,
        access_count, recall_count, extraction_count, last_accessed_at, archived_at, archive_reason, is_pinned,
        source_trace_session_id, source_trace_request_id, source_trace_extraction_cycle_id, source_trace_json,
        content_json, idempotency_key, created_at, updated_at
      )
      SELECT
        tenant_id, subject_id, agent_id, memory_instance, long_term_memory_id, version, category,
        knowledge_source_type, sharing_state, source_memory_id, confidence, state, brief_index, tags_json,
        access_count, recall_count, extraction_count, last_accessed_at, archived_at, archive_reason, is_pinned,
        source_trace_session_id, source_trace_request_id, source_trace_extraction_cycle_id, source_trace_json,
        content_json, idempotency_key, created_at, updated_at
      FROM long_term_memory;
      DROP TABLE long_term_memory;
      ALTER TABLE long_term_memory_scoped RENAME TO long_term_memory;
    `);
  }

  private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
  }

  private isSqliteConstraintError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = (error as Error & { readonly code?: unknown }).code;
    return code === 'SQLITE_CONSTRAINT' || error.message.includes('UNIQUE constraint failed');
  }

  private validateForkWrite(request: LocalForkSessionMaterializationRequest): void {
    const childSessionId = request.childSession.sessionId;
    if (
      request.childSession.tenantId !== request.tenantId ||
      request.childSession.subjectId !== request.subjectId ||
      request.childSession.agentId !== request.agentId ||
      request.forkSource.tenantId !== request.tenantId ||
      request.forkSource.subjectId !== request.subjectId ||
      request.forkSource.agentId !== request.agentId ||
      request.forkSource.childSessionId !== childSessionId ||
      request.forkSource.sourceSessionId !== request.sourceSessionId ||
      request.forkSource.sourceAnchorMessageId !== request.sourceAnchorMessageId
    ) {
      throw new AgentError({
        code: 'SESSION_FORK_SCOPE_MISMATCH',
        message: 'Fork write coordinates do not match the trusted owner and agent scope.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (request.copiedMessages.length === 0) {
      throw new AgentError({
        code: 'SESSION_FORK_EMPTY_PREFIX',
        message: 'Fork write requires copied messages.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const copiedIds = new Set<string>();
    const copiedRunRequestIds = new Map<string, string>();
    for (const message of request.copiedMessages) {
      if (
        message.tenantId !== request.tenantId ||
        message.subjectId !== request.subjectId ||
        message.agentId !== request.agentId ||
        message.sessionId !== childSessionId
      ) {
        throw new AgentError({
          code: 'SESSION_FORK_MESSAGE_SCOPE_MISMATCH',
          message: 'Copied fork message scope does not match the child session.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      if (copiedIds.has(message.messageId)) {
        throw new AgentError({
          code: 'SESSION_FORK_DUPLICATE_CHILD_MESSAGE',
          message: 'Copied fork messages contain duplicate message ids.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      copiedIds.add(message.messageId);
      if (message.runId !== undefined) {
        const existingRequestId = copiedRunRequestIds.get(message.runId);
        if (existingRequestId !== undefined && existingRequestId !== message.requestId) {
          throw new AgentError({
            code: 'SESSION_FORK_PROCESS_STATUS_INVALID',
            message: 'Fork process run is bound to multiple copied requests.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        copiedRunRequestIds.set(message.runId, message.requestId);
      }
    }
    if (!copiedIds.has(request.forkSource.childAnchorMessageId)) {
      throw new AgentError({
        code: 'SESSION_FORK_CHILD_ANCHOR_NOT_COPIED',
        message: 'Fork child anchor must be one of the copied child messages.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    for (const messageId of request.activeContextMessageIds) {
      if (!copiedIds.has(messageId)) {
        throw new AgentError({
          code: 'SESSION_FORK_ACTIVE_CONTEXT_REF_NOT_COPIED',
          message: 'Fork active context refs must point to copied child messages.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
    }
    const statusByRun = new Map<string, ForkProcessSnapshotStatusRecord>();
    for (const status of request.copiedRunProcessStatuses ?? []) {
      if (
        status.tenantId !== request.tenantId ||
        status.subjectId !== request.subjectId ||
        status.agentId !== request.agentId ||
        status.sessionId !== childSessionId ||
        copiedRunRequestIds.get(status.runId) !== status.requestId ||
        statusByRun.has(status.runId)
      ) {
        throw new AgentError({
          code: 'SESSION_FORK_PROCESS_STATUS_INVALID',
          message: 'Fork process snapshot status does not match the child scope.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      statusByRun.set(status.runId, status);
    }
    if (statusByRun.size !== copiedRunRequestIds.size) {
      throw new AgentError({
        code: 'SESSION_FORK_PROCESS_STATUS_INVALID',
        message: 'Every copied fork run requires exactly one process snapshot status.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const snapshotEventIds = new Set<string>();
    for (const snapshot of request.copiedTimelineEvents ?? []) {
      const status = statusByRun.get(snapshot.runId);
      if (
        snapshot.tenantId !== request.tenantId ||
        snapshot.subjectId !== request.subjectId ||
        snapshot.agentId !== request.agentId ||
        snapshot.sessionId !== childSessionId ||
        snapshot.recordOrigin !== 'FORK_SNAPSHOT' ||
        snapshot.requestContextId !== undefined ||
        snapshot.contentRef !== undefined ||
        status?.status !== 'AVAILABLE' ||
        status.requestId !== snapshot.requestId ||
        snapshotEventIds.has(snapshot.eventId)
      ) {
        throw new AgentError({
          code: 'SESSION_FORK_TIMELINE_SNAPSHOT_INVALID',
          message: 'Fork timeline snapshot does not match an available child run.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      snapshotEventIds.add(snapshot.eventId);
    }
  }

  private getSessionForkRow(tenantId: string, subjectId: string, agentId: string, childSessionId: string): SessionForkRow | undefined {
    return this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, child_session_id, source_session_id,
                source_anchor_message_id, child_anchor_message_id, source_session_title_snapshot, created_at
         FROM session_forks
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND child_session_id = ?`,
      )
      .get(tenantId, subjectId, agentId, childSessionId) as SessionForkRow | undefined;
  }

  private loadForkedSessionByIdempotencySync(
    request: LocalLoadForkedSessionByIdempotencyRequest | LocalForkSessionMaterializationRequest,
  ): SessionRecord | undefined {
    const existing = this.db
      .prepare(
        `SELECT child_session_id FROM session_fork_idempotency
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?
           AND source_session_id = ? AND source_anchor_message_id = ? AND idempotency_key = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sourceSessionId, request.sourceAnchorMessageId, request.idempotencyKey) as
      SessionForkIdempotencyRow | undefined;
    if (existing === undefined) {
      return undefined;
    }
    const childSession = this.getSessionRow(request.tenantId, request.subjectId, request.agentId, existing.child_session_id);
    if (childSession === undefined) {
      throw new AgentError({
        code: 'SESSION_FORK_IDEMPOTENCY_CORRUPT',
        message: 'Fork idempotency anchor points to a missing child session.',
        category: 'INTERNAL',
        retryable: true,
      });
    }
    return toSessionRecord(childSession);
  }

  private getForkPromotionRow(tenantId: string, subjectId: string, agentId: string, promotedContentId: string): ForkPromotedContentRow | undefined {
    return this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
         FROM fork_promoted_contents
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND promoted_content_id = ?`,
      )
      .get(tenantId, subjectId, agentId, promotedContentId) as ForkPromotedContentRow | undefined;
  }

  private assertForkPromotionBlobExistsSync(row: ForkPromotedContentRow): void {
    if (!this.blobExistsSync(row.tenant_id, row.subject_id, row.blob_ref)) {
      throw new AgentError({
        code: 'SESSION_FORK_PROMOTION_UNAVAILABLE',
        message: 'Fork promotion blob is missing before commit.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
  }

  private deleteForkPromotionsForChildSessionSync(tenantId: string, subjectId: string, agentId: string, childSessionId: string): void {
    const promotions = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, fork_attempt_id, promoted_content_id,
                source_session_id, source_message_id, source_ref_id, child_session_id, child_message_id,
                ref_type, blob_ref, mime_type, size_bytes, content_digest, status, created_at, committed_at, aborted_at
         FROM fork_promoted_contents
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND child_session_id = ?`,
      )
      .all(tenantId, subjectId, agentId, childSessionId) as unknown as ForkPromotedContentRow[];
    for (const promotion of promotions) {
      this.deleteBlobSync({
        tenantId: brand<string, 'TenantId'>(promotion.tenant_id),
        subjectId: brand<string, 'SubjectId'>(promotion.subject_id),
        blobRef: brand<string, 'BlobRef'>(promotion.blob_ref),
      });
    }
    this.db
      .prepare(
        `DELETE FROM fork_promoted_contents
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND child_session_id = ?`,
      )
      .run(tenantId, subjectId, agentId, childSessionId);
  }

  private storeBlobSync(
    tenantId: TenantId,
    subjectId: SubjectId,
    purpose: BlobRecordPurpose,
    bytes: Uint8Array,
    idempotencyKey: IdempotencyKey,
  ): BlobRef {
    const existing = this.db
      .prepare('SELECT blob_ref FROM blobs WHERE tenant_id = ? AND subject_id = ? AND idempotency_key = ?')
      .get(tenantId, subjectId, idempotencyKey) as Pick<BlobRow, 'blob_ref'> | undefined;
    if (existing !== undefined) {
      return brand<string, 'BlobRef'>(existing.blob_ref);
    }
    const blobRef = brand<string, 'BlobRef'>(`blob-${randomUUID()}`);
    this.db
      .prepare(
        `INSERT INTO blobs(tenant_id, subject_id, blob_ref, purpose, bytes, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(tenantId, subjectId, blobRef, purpose, bytes, idempotencyKey, Number(nowEpoch()));
    return blobRef;
  }

  private blobExistsSync(tenantId: string, subjectId: string, blobRef: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS present FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .get(tenantId, subjectId, blobRef) as { readonly present: number } | undefined;
    return row !== undefined;
  }

  private deleteBlobSync(request: DeleteBlobRequest): boolean {
    const result = this.db
      .prepare('DELETE FROM blobs WHERE tenant_id = ? AND subject_id = ? AND blob_ref = ?')
      .run(request.tenantId, request.subjectId, request.blobRef);
    return result.changes > 0;
  }

  private getSessionRow(tenantId: string, subjectId: string, agentId: string, sessionId: string): SessionRow | undefined {
    return this.db
      .prepare(
        'SELECT tenant_id, subject_id, agent_id, session_id, parent_session_id, parent_run_id, parent_request_id, title, title_source, created_at, updated_at, idempotency_key FROM sessions WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?',
      )
      .get(tenantId, subjectId, agentId, sessionId) as SessionRow | undefined;
  }

  private getSessionByIdempotencyKey(tenantId: string, subjectId: string, agentId: string, idempotencyKey: string): SessionRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT tenant_id, subject_id, agent_id, session_id, parent_session_id, parent_run_id, parent_request_id, title, title_source, created_at, updated_at, idempotency_key FROM sessions WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND idempotency_key = ?',
      )
      .get(tenantId, subjectId, agentId, idempotencyKey) as SessionRow | undefined;
    return row === undefined ? undefined : toSessionRecord(row);
  }

  private putSession(record: SessionRecord, idempotencyKey?: string | null): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions(tenant_id, subject_id, agent_id, session_id, parent_session_id, parent_run_id, parent_request_id, title, title_source, created_at, updated_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.sessionId,
        record.parentSessionId ?? null,
        record.parentRunId ?? null,
        record.parentRequestId ?? null,
        record.title ?? null,
        record.titleSource ?? null,
        Number(record.createdAt),
        Number(record.updatedAt),
        idempotencyKey ?? null,
      );
  }

  private touchSession(record: SessionMessageRecord, updatedAt: EpochMillis): void {
    this.db
      .prepare('UPDATE sessions SET updated_at = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?')
      .run(Number(updatedAt), record.tenantId, record.subjectId, record.agentId, record.sessionId);
  }

  private saveMessageSync(record: SessionMessageRecord, options: IdempotentWriteOptions): SessionMessageRecord {
    if (options.idempotencyKey !== undefined) {
      const existing = this.getMessageByIdempotencyKey(record, options.idempotencyKey);
      if (existing !== undefined) {
        this.touchSession(existing, existing.createdAt);
        return existing;
      }
    }
    this.db
      .prepare(
        `INSERT INTO messages(
          tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id,
          role, content, content_type, metadata, visible, created_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.messageId,
        record.sessionId,
        record.requestId,
        record.runId ?? null,
        record.role,
        record.content,
        record.contentType,
        JSON.stringify(record.metadata),
        record.visible ? 1 : 0,
        Number(record.createdAt),
        options.idempotencyKey ?? null,
      );
    this.touchSession(record, record.createdAt);
    return record;
  }

  private getMessageByIdempotencyKey(record: SessionMessageRecord, idempotencyKey: string): SessionMessageRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id,
                role, content, content_type, metadata, visible, created_at
         FROM messages
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_id = ?
           AND COALESCE(run_id, '') = ? AND idempotency_key = ?`,
      )
      .get(record.tenantId, record.subjectId, record.agentId, record.sessionId, record.requestId, record.runId ?? '', idempotencyKey) as
      MessageRow | undefined;
    return row === undefined ? undefined : toSessionMessageRecord(row);
  }

  private getAttachmentIntakeReservationByKey(request: ReserveAttachmentIntakeRequest): AttachmentIntakeReservationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, reservation_id, session_id, request_id, run_id, request_context_id,
                idempotency_key, action, command_semantic_hash, status, attachment_ids, rejection_reason_code,
                safe_error, created_at, updated_at
         FROM attachment_intake_reservations
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND idempotency_key = ? AND action = ?`,
      )
      .get(request.tenantId, request.subjectId, request.agentId, request.sessionId, request.idempotencyKey, request.action) as
      AttachmentIntakeReservationRow | undefined;
    return row === undefined ? undefined : toAttachmentIntakeReservationRecord(row);
  }

  private getAttachmentIntakeReservationById(
    tenantId: string,
    subjectId: string,
    agentId: string,
    reservationId: string,
  ): AttachmentIntakeReservationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, reservation_id, session_id, request_id, run_id, request_context_id,
                idempotency_key, action, command_semantic_hash, status, attachment_ids, rejection_reason_code,
                safe_error, created_at, updated_at
         FROM attachment_intake_reservations
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND reservation_id = ?`,
      )
      .get(tenantId, subjectId, agentId, reservationId) as AttachmentIntakeReservationRow | undefined;
    return row === undefined ? undefined : toAttachmentIntakeReservationRecord(row);
  }

  private putAttachmentIntakeReservation(record: AttachmentIntakeReservationRecord, idempotencyKey: IdempotencyKey): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO attachment_intake_reservations(
          tenant_id, subject_id, agent_id, reservation_id, session_id, request_id, run_id, request_context_id,
          idempotency_key, action, command_semantic_hash, status, attachment_ids, rejection_reason_code,
          safe_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.reservationId,
        record.sessionId,
        record.requestId,
        record.runId,
        record.requestContextId,
        idempotencyKey,
        record.action,
        record.commandSemanticHash,
        record.status,
        JSON.stringify(record.attachmentIds),
        record.rejectionReasonCode ?? null,
        record.safeError === undefined ? null : JSON.stringify(record.safeError),
        Number(record.createdAt),
        Number(record.updatedAt),
      );
  }

  private updateAttachmentIntakeReservationOutcome(record: AttachmentIntakeReservationRecord): void {
    this.db
      .prepare(
        `UPDATE attachment_intake_reservations
         SET status = ?, attachment_ids = ?, rejection_reason_code = ?, safe_error = ?, updated_at = ?
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND reservation_id = ?`,
      )
      .run(
        record.status,
        JSON.stringify(record.attachmentIds),
        record.rejectionReasonCode ?? null,
        record.safeError === undefined ? null : JSON.stringify(record.safeError),
        Number(record.updatedAt),
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.reservationId,
      );
  }

  private putAttachment(record: RequestAttachmentRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO attachments(
          tenant_id, subject_id, agent_id, attachment_id, session_id, request_id, run_id,
          file_name, media_type, size_bytes, storage_ref, validation_status, availability_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.attachmentId,
        record.sessionId,
        record.requestId,
        record.runId ?? null,
        record.fileName,
        record.mediaType,
        record.sizeBytes,
        record.storageRef,
        record.validationStatus,
        record.availabilityStatus,
        Number(record.createdAt),
      );
  }

  private putPendingInput(record: PendingInputRecord, resolveOptions?: ResolvePendingInputRecordOptions): void {
    this.db
      .prepare(
        `INSERT INTO pending_inputs(
          tenant_id, subject_id, agent_id, pending_input_id, session_id, request_id, request_run_id,
          request_context_id, checkpoint_id, kind, request, producer_ref, timeout_at, status, created_at, updated_at,
          authorization_scope, response_answers, resolve_idempotency_key, resolve_idempotency_semantic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, subject_id, agent_id, pending_input_id) DO UPDATE SET
          session_id = excluded.session_id,
          request_id = excluded.request_id,
          request_run_id = excluded.request_run_id,
          request_context_id = excluded.request_context_id,
          checkpoint_id = excluded.checkpoint_id,
          kind = excluded.kind,
          request = excluded.request,
          producer_ref = excluded.producer_ref,
          timeout_at = excluded.timeout_at,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          authorization_scope = excluded.authorization_scope,
          response_answers = excluded.response_answers,
          resolve_idempotency_key = excluded.resolve_idempotency_key,
          resolve_idempotency_semantic = excluded.resolve_idempotency_semantic`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.pendingInputId,
        record.sessionId,
        record.requestId,
        record.requestRunId,
        record.requestContextId,
        record.checkpointId,
        record.kind,
        JSON.stringify(record.request),
        JSON.stringify(record.producerRef),
        record.request.timeoutAt === undefined ? null : Number(record.request.timeoutAt),
        record.status,
        Number(record.createdAt),
        Number(record.updatedAt),
        record.authorizationScope === undefined ? null : JSON.stringify(record.authorizationScope),
        record.responseAnswers === undefined
          ? null
          : JSON.stringify(
              record.responseAnswerKinds === undefined
                ? record.responseAnswers
                : { answers: record.responseAnswers, answerKinds: record.responseAnswerKinds },
            ),
        resolveOptions?.idempotencyKey ?? null,
        resolveOptions?.idempotencySemantic ?? null,
      );
  }

  private appendActiveContextItemSync(request: Omit<AppendActiveContextItemRequest, 'expectedActiveContextVersion'>): ActiveContextViewRecord {
    const current = this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId);
    if (current.items.some((item) => item.messageId === request.messageId)) {
      return current;
    }
    this.insertActiveContextItemSync(current, request.messageId);
    return this.loadActiveContextSync(request.tenantId, request.subjectId, request.agentId, request.sessionId);
  }

  private insertActiveContextItemSync(current: ActiveContextViewRecord, messageId: AppendActiveContextItemRequest['messageId']): void {
    this.db
      .prepare(
        `INSERT INTO active_context_items(tenant_id, subject_id, agent_id, session_id, ordinal, message_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(current.state.tenantId, current.state.subjectId, current.state.agentId, current.state.sessionId, current.items.length, messageId);
    const nextVersion = current.state.activeContextVersion + 1;
    const updatedAt = nowEpoch();
    this.db
      .prepare(
        `UPDATE active_context_states SET active_context_version = ?, updated_at = ?
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .run(nextVersion, updatedAt, current.state.tenantId, current.state.subjectId, current.state.agentId, current.state.sessionId);
  }

  /**
   * Atomic active-context replacement: deletes all existing
   * items for the (tenant, subject, agent, session) scope and
   * inserts the new items in the order provided, starting at
   * ordinal 0. Used by `commitCompaction` to swap the prefix
   * for a summary pointer + retained tail.
   */
  private replaceActiveContextItemsSync(
    tenantId: TenantId,
    subjectId: SubjectId,
    agentId: AgentId,
    sessionId: SessionId,
    messageIds: readonly MessageId[],
  ): void {
    this.db
      .prepare(
        `DELETE FROM active_context_items
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .run(tenantId, subjectId, agentId, sessionId);
    if (messageIds.length === 0) {
      return;
    }
    const insert = this.db.prepare(
      `INSERT INTO active_context_items(tenant_id, subject_id, agent_id, session_id, ordinal, message_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    messageIds.forEach((messageId, ordinal) => {
      insert.run(tenantId, subjectId, agentId, sessionId, ordinal, messageId);
    });
  }

  private bumpActiveContextVersionSync(tenantId: TenantId, subjectId: SubjectId, agentId: AgentId, sessionId: SessionId): void {
    this.db
      .prepare(
        `UPDATE active_context_states
         SET active_context_version = active_context_version + 1, updated_at = ?
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .run(nowEpoch(), tenantId, subjectId, agentId, sessionId);
  }

  private ensureActiveContextState(tenantId: string, subjectId: string, agentId: string, sessionId: string, updatedAt: EpochMillis): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO active_context_states(tenant_id, subject_id, agent_id, session_id, active_context_version, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(tenantId, subjectId, agentId, sessionId, Number(updatedAt));
  }

  private loadActiveContextSync(tenantId: string, subjectId: string, agentId: string, sessionId: string): ActiveContextViewRecord {
    this.ensureActiveContextState(tenantId, subjectId, agentId, sessionId, nowEpoch());
    const stateRow = this.db
      .prepare(
        `SELECT tenant_id, subject_id, agent_id, session_id, active_context_version, updated_at, metadata
         FROM active_context_states
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .get(tenantId, subjectId, agentId, sessionId) as unknown as ActiveContextStateRow;
    const items = (
      this.db
        .prepare(
          `SELECT ordinal, message_id FROM active_context_items
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
         ORDER BY ordinal ASC`,
        )
        .all(tenantId, subjectId, agentId, sessionId) as unknown as Array<{ ordinal: number; message_id: string }>
    ).map((row) => ({
      tenantId: brand<string, 'TenantId'>(stateRow.tenant_id),
      subjectId: brand<string, 'SubjectId'>(stateRow.subject_id),
      agentId: brand<string, 'AgentId'>(stateRow.agent_id),
      sessionId: brand<string, 'SessionId'>(stateRow.session_id),
      ordinal: row.ordinal,
      messageId: brand<string, 'MessageId'>(row.message_id),
    }));
    return {
      state: {
        tenantId: brand<string, 'TenantId'>(stateRow.tenant_id),
        subjectId: brand<string, 'SubjectId'>(stateRow.subject_id),
        agentId: brand<string, 'AgentId'>(stateRow.agent_id),
        sessionId: brand<string, 'SessionId'>(stateRow.session_id),
        activeContextVersion: stateRow.active_context_version,
        updatedAt: brand<number, 'EpochMillis'>(stateRow.updated_at),
      },
      items,
      ...(stateRow.metadata !== null && stateRow.metadata !== undefined ? { metadata: JSON.parse(stateRow.metadata) as JsonObject } : {}),
    };
  }

  private nextTimelineSequence(record: RunTimelineEventRecord): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM timeline_events
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?`,
      )
      .get(record.tenantId, record.subjectId, record.agentId, record.sessionId) as { sequence: number };
    return Number(row.sequence);
  }

  private appendTimelineEventSync(input: RunTimelineEventRecord, options: IdempotentWriteOptions, allowForkSnapshot = false): RunTimelineEventRecord {
    this.validateTimelineEventRecordWrite(input, allowForkSnapshot);
    if (options.idempotencyKey !== undefined) {
      const existing = this.getTimelineByIdempotencyKey(input, options.idempotencyKey);
      if (existing !== undefined) {
        return existing;
      }
    }
    const sequence = brand<number, 'TimelineSequence'>(this.nextTimelineSequence(input));
    const record: RunTimelineEventRecord = { ...input, sequence };
    this.db
      .prepare(
        `INSERT INTO timeline_events(
          tenant_id, subject_id, agent_id, session_id, sequence, event_id, request_id, run_id, idempotency_key, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.sessionId,
        Number(record.sequence),
        record.eventId,
        record.requestId,
        record.runId,
        options.idempotencyKey ?? null,
        JSON.stringify(record),
      );
    return record;
  }

  private validateTimelineEventRecordWrite(record: RunTimelineEventRecord, allowForkSnapshot: boolean): void {
    const snapshot = record.recordOrigin === 'FORK_SNAPSHOT';
    const runtimeContextValid =
      record.recordOrigin === undefined && typeof record.requestContextId === 'string' && record.requestContextId.length > 0;
    const snapshotShapeValid = snapshot && allowForkSnapshot && record.requestContextId === undefined && record.contentRef === undefined;
    if (runtimeContextValid || snapshotShapeValid) {
      return;
    }
    throw new AgentError({
      code: 'TIMELINE_EVENT_RECORD_INVALID',
      message: 'Timeline event record origin and context shape are invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }

  private getTimelineByIdempotencyKey(record: RunTimelineEventRecord, idempotencyKey: string): RunTimelineEventRecord | undefined {
    return parseJsonRow<RunTimelineEventRecord>(
      this.db
        .prepare(
          `SELECT json FROM timeline_events
           WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND idempotency_key = ?`,
        )
        .get(record.tenantId, record.subjectId, record.agentId, record.sessionId, idempotencyKey) as JsonRow | undefined,
    );
  }

  private getCheckpointByIdempotencyKey(record: CheckpointRecord, idempotencyKey: string): CheckpointRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM checkpoints
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND request_id = ? AND run_id = ? AND idempotency_key = ?`,
      )
      .get(record.tenantId, record.subjectId, record.agentId, record.sessionId, record.requestId, record.runId, idempotencyKey) as unknown as
      CheckpointRow | undefined;
    return row === undefined ? undefined : toCheckpointRecord(row);
  }

  // --- UserQuestionActivityStoreGateway ---

  async upsertActivity(record: UserQuestionActivityRecord): Promise<UserQuestionActivityRecord | SafeError> {
    const now = Date.now() as EpochMillis;
    try {
      const existing = this.db
        .prepare(
          'SELECT ask_frequency, is_pinned, pinned_at FROM user_question_activity WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND question_hash = ?',
        )
        .get(record.tenantId, record.subjectId, record.agentId, record.questionHash) as
        { ask_frequency: number; is_pinned: number; pinned_at: number | null } | undefined;

      if (existing) {
        this.db
          .prepare(
            'UPDATE user_question_activity SET ask_frequency = ?, last_asked_at = ?, updated_at = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND question_hash = ?',
          )
          .run(existing.ask_frequency + 1, now, now, record.tenantId, record.subjectId, record.agentId, record.questionHash);

        return {
          ...record,
          askFrequency: existing.ask_frequency + 1,
          isPinned: existing.is_pinned === 1,
          pinnedAt: existing.pinned_at === null ? null : brand(existing.pinned_at),

          lastAskedAt: now,
          updatedAt: now,
        };
      }

      this.db
        .prepare(
          'INSERT INTO user_question_activity (tenant_id, subject_id, agent_id, question_hash, question_text, locale, is_pinned, pinned_at, ask_frequency, last_asked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, ?, ?)',
        )
        .run(record.tenantId, record.subjectId, record.agentId, record.questionHash, record.questionText, record.locale, now, now, now);

      return {
        ...record,
        isPinned: false,
        pinnedAt: null,
        askFrequency: 1,
        lastAskedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    } catch {
      return userQuestionSafeError('USER_QUESTION_ACTIVITY_UNAVAILABLE', 'User question activity storage is unavailable.');
    }
  }

  async listHighFrequency(query: UserQuestionActivityHighFrequencyQuery): Promise<readonly UserQuestionActivityRecord[] | SafeError> {
    try {
      const rows = this.db
        .prepare(
          'SELECT tenant_id, subject_id, agent_id, question_hash, question_text, locale, is_pinned, pinned_at, ask_frequency, last_asked_at, created_at, updated_at FROM user_question_activity WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND ask_frequency > ? ORDER BY ask_frequency DESC, last_asked_at DESC',
        )
        .all(query.tenantId, query.subjectId, query.agentId, query.threshold) as unknown as readonly UserQuestionActivityRow[];

      return rows.map(toUserQuestionActivityRecord);
    } catch {
      return userQuestionSafeError('USER_QUESTION_ACTIVITY_UNAVAILABLE', 'User question activity storage is unavailable.');
    }
  }
}

export class SqliteWorkingMemoryCore extends SqliteGatewayCore {
  constructor(options: SqliteOwnedGatewayStoresOptions) {
    super({ ...options, schemaOwner: 'working-memory' });
  }
}

export class SqliteLongTermMemoryCore extends SqliteGatewayCore {
  constructor(options: SqliteOwnedGatewayStoresOptions) {
    super({ ...options, schemaOwner: 'long-term-memory' });
  }
}

export class SqliteResidualGatewayCore extends SqliteGatewayCore {
  constructor(options: SqliteOwnedGatewayStoresOptions) {
    super({ ...options, schemaOwner: 'sqlite' });
  }
}

function safeQueryLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 1;
  }
  return Math.max(1, Math.min(1000, Math.trunc(limit)));
}
