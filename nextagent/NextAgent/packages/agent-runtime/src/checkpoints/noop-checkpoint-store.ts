import type { CheckpointRecord, CheckpointStoreGateway, LoadCheckpointRequest } from '@nextagent/agent-contracts/gateway';

export class NoopCheckpointStoreGateway implements CheckpointStoreGateway {
  async saveCheckpoint(record: CheckpointRecord): Promise<CheckpointRecord> {
    return record;
  }

  async loadCheckpoint(_request: LoadCheckpointRequest): Promise<CheckpointRecord | undefined> {
    return undefined;
  }
}
