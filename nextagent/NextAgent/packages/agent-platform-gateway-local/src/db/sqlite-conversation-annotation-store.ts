import type {
  ConversationAnnotationRecord,
  ConversationAnnotationStoreGateway,
  ConversationFavoriteTurnSummary,
  DeleteAnnotationsByRunRequest,
  IdempotentWriteOptions,
  ListFavoriteTurnsQuery,
  ListQuestionFavoriteTurnsQuery,
  ListSessionAnnotationsQuery,
} from '@nextagent/agent-contracts/gateway';
import type { SafeError } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteConversationAnnotationStore implements ConversationAnnotationStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async saveAnnotation(
    record: ConversationAnnotationRecord,
    options: IdempotentWriteOptions,
  ): Promise<ConversationAnnotationRecord | undefined | SafeError> {
    return this.core.saveAnnotation(record, options);
  }

  async deleteAnnotationsByRun(request: DeleteAnnotationsByRunRequest): Promise<void | SafeError> {
    return this.core.deleteAnnotationsByRun(request);
  }

  async listFavoriteTurns(query: ListFavoriteTurnsQuery): Promise<readonly ConversationFavoriteTurnSummary[] | SafeError> {
    return this.core.listFavoriteTurns(query);
  }

  async listQuestionFavoriteTurns(query: ListQuestionFavoriteTurnsQuery): Promise<readonly ConversationFavoriteTurnSummary[] | SafeError> {
    return this.core.listQuestionFavoriteTurns(query);
  }

  async listSessionAnnotations(query: ListSessionAnnotationsQuery): Promise<readonly ConversationAnnotationRecord[] | SafeError> {
    return this.core.listSessionAnnotations(query);
  }
}
