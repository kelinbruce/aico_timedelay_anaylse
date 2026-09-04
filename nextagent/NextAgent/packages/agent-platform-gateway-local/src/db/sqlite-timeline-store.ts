import type {
  IdempotentWriteOptions,
  RunTimelineEventRecord,
  RunTimelineEventRecordQuery,
  RunTimelineEventStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteTimelineStore implements RunTimelineEventStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async appendEvent(record: RunTimelineEventRecord, options: IdempotentWriteOptions = {}): Promise<RunTimelineEventRecord> {
    return this.core.appendEvent(record, options);
  }

  async listEvents(request: RunTimelineEventRecordQuery): Promise<readonly RunTimelineEventRecord[]> {
    return this.core.listEvents(request);
  }
}
