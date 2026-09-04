import { AgentError, brand, type EpochMillis, type SafeError } from '@nextagent/agent-common';
import type {
  ConversationAnnotationRecord,
  ConversationAnnotationStoreGateway,
  ConversationFavoriteTurnSummary,
  IdempotentWriteOptions,
  ListFavoriteTurnsQuery,
  ListQuestionFavoriteTurnsQuery,
  ListSessionAnnotationsQuery,
  RequestRunStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  ConversationAnnotationView,
  ConversationFavoriteTurnEntry,
  ConversationFavoriteTurnPage,
  RuntimeConversationAnnotationPort,
  RuntimeListFavoriteTurnsQuery,
  RuntimeListQuestionFavoriteTurnsQuery,
  RuntimeListSessionAnnotationsQuery,
  RuntimeUpsertAnnotationCommand,
} from '@nextagent/agent-contracts/runtime';

export interface ConversationAnnotationServiceDependencies {
  readonly annotationStore: ConversationAnnotationStoreGateway;
  readonly runStore: RequestRunStoreGateway;
  readonly messageStore: SessionMessageStoreGateway;
  readonly clock?: () => EpochMillis;
  readonly createAnnotationId?: () => string;
}

function isSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

function toAnnotationView(record: ConversationAnnotationRecord): ConversationAnnotationView {
  return {
    annotationId: record.annotationId,
    sessionId: record.sessionId,
    requestRunId: record.requestRunId,
    sentiment: record.sentiment ?? null,
    isFavorited: record.isFavorited ?? false,
    isQuestionFavorited: record.isQuestionFavorited ?? false,
    comment: record.comment ?? null,
    createdAt: record.createdAt,
  };
}

export class ConversationAnnotationService implements RuntimeConversationAnnotationPort {
  constructor(private readonly deps: ConversationAnnotationServiceDependencies) {}

  async upsertAnnotation(command: RuntimeUpsertAnnotationCommand): Promise<ConversationAnnotationView | undefined> {
    const { identityContext, agentId, sessionId, requestRunId } = command;
    // An annotation MUST anchor to a real request run — or a fork-inherited
    // child run anchor — belonging to this session. loadRun is scoped by
    // (tenantId, subjectId, agentId, runId); a run that exists under a different
    // session is rejected as NOT_FOUND too, so cross-session existence is not
    // leaked. Fork-copied child run anchors have no RequestRunRecord by design,
    // so we fall back to checking the messages table for (sessionId, runId).
    const run = await this.deps.runStore.loadRun({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      runId: requestRunId,
    });
    if (run === undefined || run.sessionId !== sessionId) {
      const messagePage = await this.deps.messageStore.listMessages({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        sessionId,
        runId: requestRunId,
        includeHidden: false,
        includeCapabilityResults: false,
        limit: 1,
      });
      if (messagePage.items.length === 0) {
        throw new AgentError({
          code: 'ANNOTATION_RUN_NOT_FOUND',
          message: 'The request run does not exist for this session.',
          category: 'NOT_FOUND',
          retryable: false,
        });
      }
    }
    const annotationId = this.deps.createAnnotationId?.() ?? `annotation-${crypto.randomUUID()}`;
    const record: ConversationAnnotationRecord = {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      annotationId,
      sessionId,
      requestRunId,
      ...(command.sentiment === undefined ? {} : { sentiment: command.sentiment }),
      ...(command.isFavorited === undefined ? {} : { isFavorited: command.isFavorited }),
      ...(command.isQuestionFavorited === undefined ? {} : { isQuestionFavorited: command.isQuestionFavorited }),
      ...(command.comment === undefined ? {} : { comment: command.comment }),
      createdAt: this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now()),
      updatedAt: this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now()),
    };
    const options: IdempotentWriteOptions = command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey };
    const result = await this.deps.annotationStore.saveAnnotation(record, options);
    if (isSafeError(result)) {
      throw new AgentError({
        code: result.code,
        message: result.message,
        category: result.category,
        retryable: result.retryable,
        ...(result.safeDetails === undefined ? {} : { safeDetails: result.safeDetails }),
      });
    }
    return result === undefined ? undefined : toAnnotationView(result);
  }

  async listFavoriteTurns(query: RuntimeListFavoriteTurnsQuery): Promise<ConversationFavoriteTurnPage> {
    const { identityContext, agentId, offset, limit } = query;
    const gatewayQuery: ListFavoriteTurnsQuery = {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      limit,
      offset,
    };
    const summaries = await this.deps.annotationStore.listFavoriteTurns(gatewayQuery);
    return this.collectFavoriteTurnPage(summaries, offset, limit);
  }

  async listQuestionFavoriteTurns(query: RuntimeListQuestionFavoriteTurnsQuery): Promise<ConversationFavoriteTurnPage> {
    const { identityContext, agentId, offset, limit } = query;
    const gatewayQuery: ListQuestionFavoriteTurnsQuery = {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      limit,
      offset,
    };
    const summaries = await this.deps.annotationStore.listQuestionFavoriteTurns(gatewayQuery);
    return this.collectFavoriteTurnPage(summaries, offset, limit);
  }

  private collectFavoriteTurnPage(
    summaries: readonly ConversationFavoriteTurnSummary[] | SafeError,
    offset: number,
    limit: number,
  ): ConversationFavoriteTurnPage {
    if (isSafeError(summaries)) {
      throw new AgentError({
        code: summaries.code,
        message: summaries.message,
        category: summaries.category,
        retryable: summaries.retryable,
        ...(summaries.safeDetails === undefined ? {} : { safeDetails: summaries.safeDetails }),
      });
    }
    const entries: ConversationFavoriteTurnEntry[] = summaries.map((summary) => {
      const trimmedTitle = summary.sessionTitle?.trim();
      return {
        sessionId: summary.sessionId,
        requestRunId: summary.requestRunId,
        rootMessageId: summary.rootMessageId,
        questionPreview: summary.questionPreview,
        questionTruncated: summary.questionTruncated,
        sessionTitle: trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : 'Untitled session',
        sessionUpdatedAt: summary.sessionUpdatedAt,
        favoritedAt: summary.favoritedAt,
      };
    });
    const hasMore = entries.length === limit;
    return { entries, offset, limit, hasMore };
  }

  async listSessionAnnotations(query: RuntimeListSessionAnnotationsQuery): Promise<readonly ConversationAnnotationView[]> {
    const { identityContext, agentId, sessionId } = query;
    const gatewayQuery: ListSessionAnnotationsQuery = {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    };
    const records = await this.deps.annotationStore.listSessionAnnotations(gatewayQuery);
    if (isSafeError(records)) {
      throw new AgentError({
        code: records.code,
        message: records.message,
        category: records.category,
        retryable: records.retryable,
        ...(records.safeDetails === undefined ? {} : { safeDetails: records.safeDetails }),
      });
    }
    return records.map(toAnnotationView);
  }
}

export function createConversationAnnotationService(deps: ConversationAnnotationServiceDependencies): ConversationAnnotationService {
  return new ConversationAnnotationService(deps);
}
