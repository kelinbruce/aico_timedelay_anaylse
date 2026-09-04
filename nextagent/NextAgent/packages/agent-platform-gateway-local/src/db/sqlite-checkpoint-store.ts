import type { CheckpointRecord, CheckpointStoreGateway, LoadCheckpointRequest } from '@nextagent/agent-contracts/gateway';
import type { IdempotencyKey } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteCheckpointStore implements CheckpointStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async saveCheckpoint(record: CheckpointRecord, options: { readonly idempotencyKey: IdempotencyKey }): Promise<CheckpointRecord> {
    return this.core.saveCheckpoint(record, options);
  }

  async loadCheckpoint(request: LoadCheckpointRequest): Promise<CheckpointRecord | undefined> {
    return this.core.loadCheckpoint(request);
  }
}
