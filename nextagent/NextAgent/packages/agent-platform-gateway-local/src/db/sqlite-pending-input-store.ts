import type {
  AgentListUnresolvedPendingInputTimeoutFactsRequest,
  CreatePendingInputRecordRequest,
  LoadActivePendingInputRecordRequest,
  LoadPendingInputRecordRequest,
  PendingInputRecord,
  PendingInputResolveResult,
  PendingInputStoreGateway,
  ResolvePendingInputRecordOptions,
  ResolvePendingInputRecordRequest,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqlitePendingInputStore implements PendingInputStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async createPendingInput(request: CreatePendingInputRecordRequest): Promise<PendingInputRecord> {
    return this.core.createPendingInput(request);
  }

  async loadPendingInput(request: LoadPendingInputRecordRequest): Promise<PendingInputRecord | undefined> {
    return this.core.loadPendingInput(request);
  }

  async loadActivePendingInput(request: LoadActivePendingInputRecordRequest): Promise<PendingInputRecord | undefined> {
    return this.core.loadActivePendingInput(request);
  }

  async listUnresolvedPendingInputTimeoutFacts(request: AgentListUnresolvedPendingInputTimeoutFactsRequest): Promise<readonly PendingInputRecord[]> {
    return this.core.listUnresolvedPendingInputTimeoutFacts(request);
  }

  async resolvePendingInput(
    request: ResolvePendingInputRecordRequest,
    options?: ResolvePendingInputRecordOptions,
  ): Promise<PendingInputResolveResult> {
    return this.core.resolvePendingInput(request, options);
  }
}
