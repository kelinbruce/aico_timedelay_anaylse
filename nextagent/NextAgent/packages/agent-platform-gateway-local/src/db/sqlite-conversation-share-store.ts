import type {
  ConversationShareRecord,
  ConversationShareStoreGateway,
  DeleteSharesBySessionRequest,
  IdempotentWriteOptions,
  LoadShareRequest,
} from '@nextagent/agent-contracts/gateway';
import type { SafeError } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteConversationShareStore implements ConversationShareStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async createShare(record: ConversationShareRecord, options: IdempotentWriteOptions): Promise<ConversationShareRecord | SafeError> {
    return this.core.createShare(record, options);
  }

  async loadShare(request: LoadShareRequest): Promise<ConversationShareRecord | undefined | SafeError> {
    return this.core.loadShare(request);
  }

  async deleteSharesBySession(request: DeleteSharesBySessionRequest): Promise<void | SafeError> {
    return this.core.deleteSharesBySession(request);
  }
}
