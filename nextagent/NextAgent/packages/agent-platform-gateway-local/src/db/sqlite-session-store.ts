import type {
  DeleteSessionCascadeRequest,
  DeleteSessionCascadeResult,
  IdempotentWriteOptions,
  SessionHistoryPage,
  SessionHistoryRecordQuery,
  SessionLookupRequest,
  SessionRecord,
  SessionStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteSessionStore implements SessionStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async loadSession(request: SessionLookupRequest): Promise<SessionRecord | undefined> {
    return this.core.loadSession(request);
  }

  async saveSession(record: SessionRecord, options: IdempotentWriteOptions = {}): Promise<SessionRecord> {
    return this.core.saveSession(record, options);
  }

  async deleteSessionCascade(request: DeleteSessionCascadeRequest): Promise<DeleteSessionCascadeResult> {
    return this.core.deleteSessionCascade(request);
  }

  async listSessions(request: SessionHistoryRecordQuery): Promise<SessionHistoryPage> {
    return this.core.listSessions(request);
  }
}
