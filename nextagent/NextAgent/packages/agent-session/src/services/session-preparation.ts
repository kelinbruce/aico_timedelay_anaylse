import { AgentError, brand, getLogger, type EpochMillis, type SessionId } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  SessionForkStoreGateway,
  SessionHistoryEntry,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  SessionRecord,
  SessionTitleSource,
  SessionStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  CreateUserSessionCommand,
  ConversationPreviewPage,
  ConversationPreviewQuery,
  DeleteUserSessionCommand,
  GenerateSessionTitleCommand,
  UpdateSessionTitleCommand,
  ListCurrentRequestMessagesQuery,
  ListSessionMessagesQuery,
  ListUserSessionsQuery,
  RequireUserSessionQuery,
  SessionMessage,
  SessionActivityPort,
  UserSession,
  SessionMessagePage,
  UserSessionPage,
  UserSessionPort,
} from '@nextagent/agent-contracts/session';
import { generateAutomaticTitle } from './title-extraction.js';

export interface SessionServiceDependencies {
  readonly sessionStore: SessionStoreGateway;
  readonly messageStore: SessionMessageStoreGateway;
  readonly sessionForkStore?: SessionForkStoreGateway;
  readonly activeContextStore: ActiveContextStoreGateway;
  readonly clock?: () => EpochMillis;
  readonly createSessionId?: () => SessionId;
  readonly invalidateDeletedSession?: SessionActivityPort['invalidateDeletedSession'];
}

const logger = getLogger({ component: 'agent-session', source: 'session-service' });

function defaultNow(): EpochMillis {
  return brand<number, 'EpochMillis'>(Date.now());
}

function defaultSessionId(): SessionId {
  return brand<string, 'SessionId'>(`session-${crypto.randomUUID()}`);
}

function toUserSession(record: SessionRecord | SessionHistoryEntry): UserSession {
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
    ...('latestRunStatus' in record && record.latestRunStatus !== undefined ? { latestRunStatus: record.latestRunStatus } : {}),
    hasInFlightRequest: 'hasInFlightRequest' in record ? record.hasInFlightRequest : false,
  };
}

function toSessionMessage(record: SessionMessageRecord): SessionMessage {
  return {
    messageId: record.messageId,
    sessionId: record.sessionId,
    requestId: record.requestId,
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    role: record.role,
    content: record.content,
    contentType: record.contentType,
    metadata: record.metadata,
    sequence: 0,
    visible: record.visible,
    createdAt: record.createdAt,
  };
}

export class UserSessionService implements UserSessionPort {
  constructor(private readonly deps: SessionServiceDependencies) {}

  async createSession(command: CreateUserSessionCommand): Promise<UserSession> {
    const now = this.deps.clock?.() ?? defaultNow();
    const sessionId = this.deps.createSessionId?.() ?? defaultSessionId();
    logger.info(
      {
        event: 'session.create',
        sessionId,
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: command.agentId,
      },
      'Creating session with identity',
    );
    const record: SessionRecord = {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: command.agentId,
      sessionId,
      ...(command.parentSessionId === undefined ? {} : { parentSessionId: command.parentSessionId }),
      ...(command.parentRunId === undefined ? {} : { parentRunId: command.parentRunId }),
      ...(command.parentRequestId === undefined ? {} : { parentRequestId: command.parentRequestId }),
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.deps.sessionStore.saveSession(record, { idempotencyKey: command.idempotencyKey });
    await this.deps.activeContextStore.loadActiveContext({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: command.agentId,
      sessionId: saved.sessionId,
    });
    return toUserSession(saved);
  }

  async requireSession(query: RequireUserSessionQuery): Promise<UserSession> {
    const record = await this.deps.sessionStore.loadSession({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      sessionId: query.sessionId,
    });
    if (record === undefined) {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    assertOwnerScope(record, query.identityContext.tenantId, query.identityContext.subjectId);
    return toUserSession(record);
  }

  async listSessions(query: ListUserSessionsQuery): Promise<UserSessionPage> {
    const page = await this.deps.sessionStore.listSessions({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      offset: query.offset,
      limit: query.limit,
      ...(query.questionSearchText === undefined ? {} : { questionSearchText: query.questionSearchText }),
      ...(query.createdAtFrom === undefined ? {} : { createdAtFrom: query.createdAtFrom }),
      ...(query.createdAtTo === undefined ? {} : { createdAtTo: query.createdAtTo }),
    });
    return {
      entries: page.entries
        .filter((r) => r.tenantId === query.identityContext.tenantId && r.subjectId === query.identityContext.subjectId)
        .map(toUserSession),
      offset: page.offset,
      limit: page.limit,
      hasMore: page.hasMore,
    };
  }

  async deleteSession(command: DeleteUserSessionCommand): Promise<void> {
    const record = await this.deps.sessionStore.loadSession({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: command.agentId,
      sessionId: command.sessionId,
    });
    if (record === undefined) {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    assertOwnerScope(record, command.identityContext.tenantId, command.identityContext.subjectId);
    const result = await this.deps.sessionStore.deleteSessionCascade({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: command.agentId,
      sessionId: command.sessionId,
    });
    if (result.status === 'DELETED') {
      try {
        this.deps.invalidateDeletedSession?.({
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          sessionId: command.sessionId,
        });
      } catch {
        logger.warn({
          event: 'session.activity.delete_invalidation_failed',
          failureStage: 'ACTIVITY_DELETE_INVALIDATION',
          safeReasonCode: 'INVALIDATION_CALLBACK_FAILED',
        });
      }
      logger.info({ event: 'session.deleted', sessionId: command.sessionId });
      return;
    }
    if (result.status === 'CONFLICT_ACTIVE_RUN') {
      throw new AgentError({
        code: 'SESSION_DELETE_CONFLICT',
        message: 'Session has an active request run and cannot be deleted.',
        category: 'CONFLICT',
        retryable: true,
      });
    }
    throw new AgentError({
      code: 'SESSION_NOT_FOUND',
      message: 'Session was not found.',
      category: 'NOT_FOUND',
      retryable: false,
    });
  }

  async listMessages(query: ListSessionMessagesQuery): Promise<SessionMessagePage> {
    await this.requireSession({
      identityContext: query.identityContext,
      agentId: query.agentId,
      sessionId: query.sessionId,
    });
    // Cursor existence precheck: a cursor/anchor that does not resolve to a visible-or-hidden
    // message within this session is treated as NOT_FOUND, rather than transparently returning an
    // empty page. This closes the SQLite/memory divergence: memory returns an empty set for a
    // non-existent anchorMessageId (200), while SQLite throws SESSION_MESSAGE_ANCHOR_NOT_FOUND (404).
    // `loadMessage` is not session-scoped and does not filter visibility, so we additionally verify
    // the resolved record belongs to this session. A hidden cursor (exists but filtered out by
    // listMessages) is intentionally treated as a paging boundary (empty page), not an error — only
    // anchorMessageId fails on an empty page, because a visible anchor must appear in its own page.
    await this.assertCursorResolves(query);
    const page = await this.deps.messageStore.listMessages({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      sessionId: query.sessionId,
      includeHidden: false,
      includeCapabilityResults: query.includeCapabilityResults,
      limit: query.limit,
      ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
      ...(query.locale === undefined ? {} : { locale: query.locale }),
      ...(query.beforeCursor === undefined ? {} : { beforeCursor: query.beforeCursor }),
      ...(query.afterCursor === undefined ? {} : { afterCursor: query.afterCursor }),
      ...(query.anchorMessageId === undefined ? {} : { anchorMessageId: query.anchorMessageId }),
    });
    if (query.anchorMessageId !== undefined && page.items.length === 0) {
      throw new AgentError({
        code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
        message: 'Conversation anchor message was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    const forkNotice = await this.loadForkNotice(query);
    return {
      items: page.items.map(toSessionMessage),
      limit: page.limit,
      hasMore: page.hasMore,
      ...(page.nextBeforeCursor === undefined ? {} : { nextBeforeCursor: page.nextBeforeCursor }),
      ...(page.newerCursor === undefined ? {} : { newerCursor: page.newerCursor }),
      ...(forkNotice === undefined ? {} : { forkNotice }),
    };
  }

  private async assertCursorResolves(query: ListSessionMessagesQuery): Promise<void> {
    const cursorMessageId = query.anchorMessageId ?? query.beforeCursor ?? query.afterCursor;
    if (cursorMessageId === undefined) {
      return;
    }
    const resolved = await this.deps.messageStore.loadMessage({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      messageId: brand<string, 'MessageId'>(cursorMessageId),
    });
    if (resolved === undefined || resolved.sessionId !== query.sessionId) {
      throw new AgentError({
        code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
        message: 'Conversation anchor message was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
  }

  private async loadForkNotice(query: ListSessionMessagesQuery): Promise<SessionMessagePage['forkNotice']> {
    if (
      this.deps.sessionForkStore === undefined ||
      query.requestId !== undefined ||
      query.beforeCursor !== undefined ||
      query.afterCursor !== undefined ||
      query.anchorMessageId !== undefined
    ) {
      return undefined;
    }
    const forkSource = await this.deps.sessionForkStore.loadSessionForkSource({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      childSessionId: query.sessionId,
    });
    if (forkSource === undefined) {
      return undefined;
    }
    const hasUserAfterAnchor = await this.deps.sessionForkStore.hasUserMessageAfterForkAnchor({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      childSessionId: query.sessionId,
    });
    return hasUserAfterAnchor
      ? undefined
      : {
          sourceSessionId: forkSource.sourceSessionId,
          sourceSessionTitle: forkSource.sourceSessionTitleSnapshot,
        };
  }

  async listConversationPreview(query: ConversationPreviewQuery): Promise<ConversationPreviewPage> {
    await this.requireSession({
      identityContext: query.identityContext,
      agentId: query.agentId,
      sessionId: query.sessionId,
    });
    const page = await this.deps.messageStore.listConversationPreview({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      sessionId: query.sessionId,
      ...(query.offset === undefined ? {} : { offset: query.offset }),
      limit: query.limit,
    });
    return {
      sessionId: page.sessionId,
      totalMarkers: page.totalMarkers,
      offset: page.offset,
      limit: page.limit,
      markers: page.markers.map((marker) => ({
        messageId: marker.messageId,
        ...(marker.requestId === undefined ? {} : { requestId: marker.requestId }),
        createdAt: marker.createdAt,
        previewText: marker.previewText,
        previewTruncated: marker.previewTruncated,
        ...(marker.answerPreviewText === undefined ? {} : { answerPreviewText: marker.answerPreviewText }),
        ...(marker.answerPreviewTruncated === undefined ? {} : { answerPreviewTruncated: marker.answerPreviewTruncated }),
      })),
    };
  }

  async listCurrentRequestMessages(query: ListCurrentRequestMessagesQuery): Promise<SessionMessagePage> {
    const page = await this.deps.messageStore.listCurrentRequestMessages({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      sessionId: query.sessionId,
      requestId: query.requestId,
      runId: query.runId,
      includeHidden: query.includeHidden,
      offset: query.offset,
      limit: query.limit,
    });
    return {
      items: page.items.map(toSessionMessage),
      limit: page.limit,
      hasMore: page.hasMore,
      ...(page.nextBeforeCursor === undefined ? {} : { nextBeforeCursor: page.nextBeforeCursor }),
    };
  }

  async generateTitle(command: GenerateSessionTitleCommand): Promise<boolean> {
    try {
      if (!command.isFirstRequest) {
        return true;
      }
      const trimmedInput = command.firstUserText.trim();
      if (trimmedInput.length === 0 || trimmedInput.startsWith('/')) {
        return false;
      }
      const current = await this.deps.sessionStore.loadSession({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: command.agentId,
        sessionId: command.sessionId,
      });
      if (current === undefined) {
        logger.warn({ event: 'session.title.skipped_not_found', sessionId: command.sessionId });
        return false;
      }
      assertOwnerScope(current, command.identityContext.tenantId, command.identityContext.subjectId);
      if (current.titleSource === 'manual' || (current.title !== undefined && current.title.length > 0)) {
        return true;
      }
      const title = generateAutomaticTitle(command.firstUserText);
      if (title.length === 0) {
        logger.warn({ event: 'session.title.empty', sessionId: command.sessionId });
        return false;
      }
      if (containsSecretPattern(title) || containsXssPattern(title)) {
        logger.warn({ event: 'session.title.redacted', sessionId: command.sessionId });
        return false;
      }
      await this.deps.sessionStore.saveSession(
        {
          ...current,
          title,
          titleSource: 'automatic' as SessionTitleSource,
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`title-gen-${command.sessionId}`) },
      );
      logger.info({
        event: 'session.title.generated',
        sessionId: command.sessionId,
        requestRunId: command.requestRunId,
        titleLength: title.length,
      });
      return true;
    } catch (error) {
      logger.warn({
        err: error,
        event: 'session.title.failed',
        sessionId: command.sessionId,
        requestRunId: command.requestRunId,
        failureStage: 'SESSION_TITLE_GENERATION',
      });
      return false;
    }
  }

  async updateTitle(command: UpdateSessionTitleCommand): Promise<UserSession> {
    const title = command.title.trim();
    validateTitle(title);
    const current = await this.deps.sessionStore.loadSession({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: command.agentId,
      sessionId: command.sessionId,
    });
    if (current === undefined) {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    assertOwnerScope(current, command.identityContext.tenantId, command.identityContext.subjectId);
    const { title: _discardTitle, ...rest } = current;
    const updated: SessionRecord = { ...rest, title, titleSource: 'manual' as SessionTitleSource };
    await this.deps.sessionStore.saveSession(updated, { idempotencyKey: command.idempotencyKey });
    logger.info({
      event: 'session.title.updated',
      sessionId: command.sessionId,
      oldTitleLength: current.title?.length ?? 0,
      newTitleLength: title.length,
    });
    return toUserSession(updated);
  }
}

function validateTitle(title: string): void {
  if (title.length > 100) {
    throw new AgentError({
      code: 'SESSION_TITLE_TOO_LONG',
      message: 'Session title exceeds the maximum length of 100 characters.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (title.length === 0) {
    throw new AgentError({
      code: 'SESSION_TITLE_TOO_SHORT',
      message: 'Session title must be 1-100 characters.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (containsXssPattern(title)) {
    throw new AgentError({
      code: 'SESSION_TITLE_UNSAFE_CONTENT',
      message: 'Session title must not contain HTML tags, javascript: URLs, or event handlers.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (containsSecretPattern(title)) {
    throw new AgentError({
      code: 'SESSION_TITLE_UNSAFE_CONTENT',
      message: 'Session title must not contain credentials, API keys, or secrets.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function assertOwnerScope(record: SessionRecord | SessionHistoryEntry, expectedTenantId: string, expectedSubjectId: string): void {
  const matches = record.tenantId === expectedTenantId && record.subjectId === expectedSubjectId;
  logger[matches ? 'debug' : 'warn'](
    {
      event: 'session.owner-scope-check',
      sessionId: record.sessionId,
      requestTenantId: expectedTenantId,
      requestSubjectId: expectedSubjectId,
      recordTenantId: record.tenantId,
      recordSubjectId: record.subjectId,
      ...(matches ? {} : { safeReasonCode: 'SESSION_OWNER_SCOPE_MISMATCH' }),
    },
    'Session owner scope check',
  );
  if (!matches) {
    throw new AgentError({
      code: 'SESSION_ACCESS_DENIED',
      message: 'Session does not belong to the current user.',
      category: 'AUTHORIZATION',
      retryable: false,
    });
  }
}

export function createUserSessionService(deps: SessionServiceDependencies): UserSessionService {
  return new UserSessionService(deps);
}

const secretPattern = /(?:sk-|key-|token-|api[-_]?key|secret|password|credential)[=:]\s*\S/iu;

function containsSecretPattern(text: string): boolean {
  return secretPattern.test(text);
}

const xssPattern = /<[a-zA-Z/!]|javascript:|on\w+\s*=/iu;

function containsXssPattern(text: string): boolean {
  return xssPattern.test(text);
}
