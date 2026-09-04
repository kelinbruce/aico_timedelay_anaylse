import type {
  BatchCreateLongTermMemoryRequest,
  BatchCreateLongTermMemoryResult,
  CopyLongTermMemoryRequest,
  CopyPublishedMemoryResponse,
  DeleteLongTermMemoryResult,
  DeleteLongTermMemoryRequest,
  GetLongTermMemoryDetailRequest,
  GetLongTermMemoryRequest,
  ListLongTermMemoryQuery,
  ListPublishedLongTermMemoryQuery,
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemorySharingGateway,
  LongTermMemoryStoreGateway,
  LongTermMemorySummaryPage,
  LongTermMemoryVersionedUpdateResult,
  ManualSaveLongTermMemoryRequest,
  MutateLongTermMemoryRequest,
  PublishLongTermMemoryResult,
  SaveLongTermMemoryRequest,
  SearchLongTermMemoryQuery,
  SearchItemPage,
  SharedMemorySummaryPage,
  SharingLongTermMemoryRequest,
  UnpublishLongTermMemoryResult,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import type { SafeError } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteLongTermMemoryStore implements LongTermMemoryStoreGateway, LongTermMemoryRetrieverGateway, LongTermMemorySharingGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async getLongTermMemory(request: GetLongTermMemoryRequest): Promise<LongTermMemoryRecord | SafeError> {
    return this.core.getLongTermMemory(request);
  }

  async saveLongTermMemory(request: SaveLongTermMemoryRequest, options: VersionedWriteOptions = {}): Promise<LongTermMemoryRecord | SafeError> {
    return this.core.saveLongTermMemory(request, options);
  }

  async batchCreateLongTermMemory(request: BatchCreateLongTermMemoryRequest): Promise<BatchCreateLongTermMemoryResult | SafeError> {
    return this.core.batchCreateLongTermMemory(request);
  }

  async manualSaveLongTermMemory(request: ManualSaveLongTermMemoryRequest): Promise<LongTermMemoryRecord | SafeError> {
    return this.core.manualSaveLongTermMemory(request);
  }

  async deleteLongTermMemory(request: DeleteLongTermMemoryRequest): Promise<DeleteLongTermMemoryResult | SafeError> {
    return this.core.deleteLongTermMemory(request);
  }

  async listLongTermMemory(query: ListLongTermMemoryQuery): Promise<LongTermMemorySummaryPage | SafeError> {
    return this.core.listLongTermMemory(query);
  }

  async mutateLongTermMemory(
    request: MutateLongTermMemoryRequest,
    options: VersionedWriteOptions = {},
  ): Promise<LongTermMemoryVersionedUpdateResult | SafeError> {
    return this.core.mutateLongTermMemory(request, options);
  }

  async searchLongTermMemory(query: SearchLongTermMemoryQuery): Promise<SearchItemPage | SafeError> {
    return this.core.searchLongTermMemory(query);
  }

  async getLongTermMemoryDetail(request: GetLongTermMemoryDetailRequest): Promise<LongTermMemoryRecord | SafeError> {
    return this.core.getLongTermMemoryDetail(request);
  }

  async publishLongTermMemory(request: SharingLongTermMemoryRequest): Promise<PublishLongTermMemoryResult | SafeError> {
    return this.core.publishLongTermMemory(request);
  }

  async unpublishLongTermMemory(request: SharingLongTermMemoryRequest): Promise<UnpublishLongTermMemoryResult | SafeError> {
    return this.core.unpublishLongTermMemory(request);
  }

  async listPublishedLongTermMemory(query: ListPublishedLongTermMemoryQuery): Promise<SharedMemorySummaryPage | SafeError> {
    return this.core.listPublishedLongTermMemory(query);
  }

  async copyPublishedMemory(request: CopyLongTermMemoryRequest): Promise<CopyPublishedMemoryResponse | SafeError> {
    return this.core.copyPublishedMemory(request);
  }
}
