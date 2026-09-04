import type {
  AgentId,
  ArtifactId,
  AttachmentId,
  CapabilityInvocationId,
  EpochMillis,
  IdempotencyKey,
  IdentityContext,
  JsonObject,
  MessageContentType,
  MessageId,
  PendingInputKind,
  RequestContextId,
  RequestLocale,
  RequestRunId,
  RunStatus,
  SessionMessageRole,
  SessionId,
  SubjectId,
  TenantId,
  VisibilityReason,
} from '@nextagent/agent-common';

export type { MessageContentType, SessionMessageRole, VisibilityReason } from '@nextagent/agent-common';

export interface SessionMessage {
  readonly messageId: MessageId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly role: SessionMessageRole;
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly metadata: JsonObject;
  readonly sequence: number;
  readonly visible: boolean;
  readonly hiddenByContextId?: RequestContextId;
  readonly createdAt: EpochMillis;
}

export interface SessionMessageDraft {
  readonly role: Exclude<SessionMessageRole, 'USER'>;
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly visible: boolean;
  readonly metadata?: JsonObject;
  readonly idempotencyKey: IdempotencyKey;
}

/**
 * Draft for a capability-generated USER message persisted directly through the
 * run state port (bypassing the `Exclude<SessionMessageRole, 'USER'>` constraint
 * on {@link SessionMessageDraft}, which is reserved for the canonical user-input
 * path). The canonical use case is a directed-Skill body: the runtime loads the
 * Skill and persists its `<skill_content>` as a fixed, page-hidden
 * (`visible:false`) USER message carrying `metadata.modelVisibility.included=true`
 * so it stays in model context in place across rounds while staying off the
 * conversation route.
 */
export interface GeneratedUserMessageDraft {
  readonly role: 'USER';
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly visible: boolean;
  readonly metadata?: JsonObject;
  readonly idempotencyKey: IdempotencyKey;
}

export interface SummaryMessageMetadata {
  readonly kind: 'CONTEXT_COMPRESSION_SUMMARY';
  readonly sourceActiveContextVersion: number;
  readonly targetActiveContextVersion: number;
  readonly coveredMessageRefs: readonly MessageId[];
  readonly retainedTailMessageRefs: readonly MessageId[];
  readonly strategy: 'PREFIX_COMPACT_RECENT_TAIL';
  readonly tokenCount: number;
}

export type ReplacementKind = 'INLINE' | 'PERSISTED_PREVIEW' | 'SPECIALIZED_REF' | 'EMPTY_MARKER';

/**
 * Model-visibility metadata carried on `SessionMessage.metadata.modelVisibility`.
 *
 * Decouples "page visible" (the `visible` field, read by the conversation route)
 * from "model visible" (read by context assembly's `isHiddenReplacement` /
 * `isModelVisibleMessage`). A message MAY be `visible=true` so the conversation
 * route returns it for page rendering, while carrying `modelVisibility.excluded=true`
 * so context assembly excludes it from the model context. Owned by
 * `agent-contracts/session`; consumed by `agent-context-engine` assembly.
 *
 * The canonical use case is an input-guard-blocked round: the user input and
 * refusal must survive a page refresh (page visible) but MUST NOT enter the
 * next round's model context (model excluded).
 *
 * The symmetric inverse `included=true` admits a `visible:false` message into
 * the model context (page-hidden but model-visible). The canonical use case is
 * a directed-Skill body: persisted as a page-hidden USER message that the model
 * must see as instructions, but the user must not see on the conversation page.
 * `included` and `excluded` are mutually exclusive in practice (a message is
 * either force-included or force-excluded, never both).
 */
export interface ModelVisibilityMetadata {
  readonly excluded: boolean;
  readonly reason: VisibilityReason;
  /**
   * When true, context assembly MUST include this message in the model context
   * even if the `visible` field is false. Inverse of `excluded`. Mutually
   * exclusive with `excluded=true`.
   */
  readonly included?: boolean;
}

export interface ReplacementLineage {
  readonly sourceMessageId: MessageId | null;
  readonly sourceRunId: RequestRunId | null;
  readonly sourceInvocationId: CapabilityInvocationId | null;
  readonly stepId: string | null;
}

export interface ReplacementDegradation {
  readonly code: string;
  readonly message: string;
  readonly readableContentRef: ContentRef | null;
}

export interface ReplacementEvidence {
  readonly kind: ReplacementKind;
  readonly reason: string;
  readonly contentRef: ContentRef | null;
  readonly originalSize: number;
  readonly previewSize: number;
  readonly contentType?: string;
  readonly lineage: ReplacementLineage;
  readonly decisionState?: 'frozen';
  readonly degradation?: ReplacementDegradation | null;
}

export interface ActiveContextState {
  readonly sessionId: SessionId;
  readonly activeContextVersion: number;
  readonly updatedAt: EpochMillis;
}

export interface ActiveContextItem {
  readonly sessionId: SessionId;
  readonly ordinal: number;
  readonly messageId: MessageId;
}

export interface ActiveContextView {
  readonly state: ActiveContextState;
  readonly items: readonly ActiveContextItem[];
}

export interface UserSession {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly parentSessionId?: SessionId;
  readonly parentRunId?: RequestRunId;
  readonly parentRequestId?: MessageId;
  readonly title?: string;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
  readonly latestRunStatus?: RunStatus;
  readonly hasInFlightRequest: boolean;
}

export const SESSION_ACTIVITY_ID_MAX_LENGTH = 256;

export type SessionActivityStatus = 'NONE' | 'WAITING_FOR_INPUT' | 'RUNNING' | 'UNREAD_FAILURE' | 'UNREAD_RESULT';

export type SessionActivityEntry =
  | {
      readonly sessionId: SessionId;
      readonly status: 'NONE';
    }
  | {
      readonly sessionId: SessionId;
      readonly status: 'WAITING_FOR_INPUT';
      readonly pendingInputKind: PendingInputKind;
    }
  | {
      readonly sessionId: SessionId;
      readonly status: 'RUNNING';
    }
  | {
      readonly sessionId: SessionId;
      readonly status: 'UNREAD_FAILURE';
      readonly activityId: string;
    }
  | {
      readonly sessionId: SessionId;
      readonly status: 'UNREAD_RESULT';
      readonly activityId: string;
    };

export type SessionActivityMessage =
  | {
      readonly type: 'SNAPSHOT';
      readonly entries: ReadonlyArray<Exclude<SessionActivityEntry, { readonly status: 'NONE' }>>;
    }
  | {
      readonly type: 'DELTA';
      readonly entry: SessionActivityEntry;
    };

export interface SessionActivitySessionCoordinates {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface StreamSessionActivitiesQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly signal?: AbortSignal;
}

export interface ConsumeTerminalActivityCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly activityId: string;
  readonly observedRunId: RequestRunId;
}

export interface SessionActivityPort {
  invalidateSessionActivity: (coordinates: SessionActivitySessionCoordinates) => void;
  invalidateDeletedSession: (coordinates: SessionActivitySessionCoordinates) => void;
  streamActivities: (query: StreamSessionActivitiesQuery) => AsyncIterable<SessionActivityMessage>;
  consumeTerminalActivity: (command: ConsumeTerminalActivityCommand) => Promise<void>;
}

export interface CreateUserSessionCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly parentSessionId?: SessionId;
  readonly parentRunId?: RequestRunId;
  readonly parentRequestId?: MessageId;
  readonly locale?: RequestLocale;
  readonly idempotencyKey: IdempotencyKey;
}

export interface RequireUserSessionQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface DeleteUserSessionCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface ListUserSessionsQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly offset: number;
  readonly limit: number;
  readonly questionSearchText?: string;
  readonly createdAtFrom?: EpochMillis;
  readonly createdAtTo?: EpochMillis;
}

export interface UserSessionPage {
  readonly entries: readonly UserSession[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface ListSessionMessagesQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId?: MessageId;
  readonly locale?: RequestLocale;
  readonly includeCapabilityResults: boolean;
  readonly beforeCursor?: string;
  readonly afterCursor?: string;
  readonly anchorMessageId?: MessageId;
  readonly limit: number;
}

export interface ConversationPreviewQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly offset?: number;
  readonly limit: number;
}

export interface ConversationPreviewMarker {
  readonly messageId: MessageId;
  readonly requestId?: MessageId;
  readonly createdAt: EpochMillis;
  readonly previewText: string;
  readonly previewTruncated: boolean;
  readonly answerPreviewText?: string;
  readonly answerPreviewTruncated?: boolean;
}

export interface ConversationPreviewPage {
  readonly sessionId: SessionId;
  readonly totalMarkers: number;
  readonly offset: number;
  readonly limit: number;
  readonly markers: readonly ConversationPreviewMarker[];
}

export interface ForkNotice {
  readonly sourceSessionId: SessionId;
  readonly sourceSessionTitle: string;
}

export interface SessionMessagePage {
  readonly items: readonly SessionMessage[];
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextBeforeCursor?: string;
  readonly newerCursor?: string;
  readonly forkNotice?: ForkNotice;
}

export interface ListCurrentRequestMessagesQuery {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly includeHidden: boolean;
  readonly offset: number;
  readonly limit: number;
}

export interface UserSessionPort {
  createSession: (command: CreateUserSessionCommand) => Promise<UserSession>;
  requireSession: (query: RequireUserSessionQuery) => Promise<UserSession>;
  listSessions: (query: ListUserSessionsQuery) => Promise<UserSessionPage>;
  deleteSession: (command: DeleteUserSessionCommand) => Promise<void>;
  listMessages: (query: ListSessionMessagesQuery) => Promise<SessionMessagePage>;
  listConversationPreview: (query: ConversationPreviewQuery) => Promise<ConversationPreviewPage>;
  listCurrentRequestMessages: (query: ListCurrentRequestMessagesQuery) => Promise<SessionMessagePage>;
  generateTitle: (command: GenerateSessionTitleCommand) => Promise<boolean>;
  updateTitle: (command: UpdateSessionTitleCommand) => Promise<UserSession>;
}

export interface GenerateSessionTitleCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly firstUserText: string;
  readonly isFirstRequest: boolean;
}

export interface UpdateSessionTitleCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly title: string;
  readonly idempotencyKey: IdempotencyKey;
}

export interface ContentRef {
  readonly refId: string;
  readonly refType: 'ATTACHMENT' | 'CAPABILITY_RESULT' | 'MODEL_SUMMARY' | 'ARTIFACT';
  readonly attachmentId?: AttachmentId;
  readonly artifactId?: ArtifactId;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly safeSummary?: string;
}

export interface ArtifactMetadata {
  readonly artifactId: ArtifactId;
  readonly contentRef: ContentRef;
  readonly safeName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
