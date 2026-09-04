import type {
  ConversationPreviewRecordPage,
  ConversationPreviewRecordQuery,
  HideMessageRequest,
  HideRequestMessagesRequest,
  IdempotentWriteOptions,
  ListCurrentRequestMessagesRecordQuery,
  ListSessionMessagesRecordQuery,
  SessionMessageLookupRequest,
  SessionMessageRecord,
  SessionMessageRecordPage,
  SessionMessageStoreGateway,
  SessionMessagesBatchLookupRequest,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteMessageStore implements SessionMessageStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async appendSessionMessage(record: SessionMessageRecord, options: IdempotentWriteOptions = {}): Promise<SessionMessageRecord> {
    return this.core.appendSessionMessage(record, options);
  }

  async loadMessage(request: SessionMessageLookupRequest): Promise<SessionMessageRecord | undefined> {
    return this.core.loadMessage(request);
  }

  async loadMessages(request: SessionMessagesBatchLookupRequest): Promise<readonly SessionMessageRecord[]> {
    return this.core.loadMessages(request);
  }

  async listConversationPreview(request: ConversationPreviewRecordQuery): Promise<ConversationPreviewRecordPage> {
    return this.core.listConversationPreview(request);
  }

  async listMessages(request: ListSessionMessagesRecordQuery): Promise<SessionMessageRecordPage> {
    return this.core.listMessages(request);
  }

  async listCurrentRequestMessages(request: ListCurrentRequestMessagesRecordQuery): Promise<SessionMessageRecordPage> {
    return this.core.listCurrentRequestMessages(request);
  }

  async hideMessage(request: HideMessageRequest): Promise<SessionMessageRecord | undefined> {
    return this.core.hideMessage(request);
  }

  async hideRequestMessages(request: HideRequestMessagesRequest): Promise<number> {
    return this.core.hideRequestMessages(request);
  }
}
