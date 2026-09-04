import type {
  ActiveContextMetadataUpdateRequest,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  AppendActiveContextItemRequest,
  ContextCompactionCommitRequest,
  SessionLookupRequest,
  VersionedUpdateResult,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteActiveContextStore implements ActiveContextStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async loadActiveContext(request: SessionLookupRequest): Promise<ActiveContextViewRecord> {
    return this.core.loadActiveContext(request);
  }

  async appendItem(request: AppendActiveContextItemRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
    return this.core.appendItem(request);
  }

  async commitCompaction(request: ContextCompactionCommitRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
    return this.core.commitCompaction(request);
  }

  async updateMetadata(request: ActiveContextMetadataUpdateRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
    return this.core.updateMetadata(request);
  }
}
