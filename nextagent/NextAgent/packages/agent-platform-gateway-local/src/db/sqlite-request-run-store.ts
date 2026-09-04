import type {
  ClaimRunRequest,
  RequestRunIdempotencyLookupRequest,
  RequestRunIdempotencyLookupResult,
  RequestRunListQuery,
  RequestRunLookupRequest,
  RequestRunRecord,
  RequestRunRecordPage,
  RequestRunStoreGateway,
  SessionLaneSnapshot,
  SessionLaneSnapshotQuery,
  AgentListRecoverableRunsRequest,
  TerminalCommitRecordResult,
  TerminalCommitRequest,
  VersionedUpdateResult,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteRequestRunStore implements RequestRunStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async saveRun(record: RequestRunRecord, options: VersionedWriteOptions): Promise<VersionedUpdateResult<RequestRunRecord>> {
    return this.core.saveRun(record, options);
  }

  async loadRun(request: RequestRunLookupRequest): Promise<RequestRunRecord | undefined> {
    return this.core.loadRun(request);
  }

  async listRuns(request: RequestRunListQuery): Promise<RequestRunRecordPage> {
    return this.core.listRuns(request);
  }

  async loadRunByIdempotencyKey(request: RequestRunIdempotencyLookupRequest): Promise<RequestRunIdempotencyLookupResult> {
    return this.core.loadRunByIdempotencyKey(request);
  }

  async loadSessionLaneSnapshot(request: SessionLaneSnapshotQuery): Promise<SessionLaneSnapshot> {
    return this.core.loadSessionLaneSnapshot(request);
  }

  async claimRun(request: ClaimRunRequest): Promise<VersionedUpdateResult<RequestRunRecord>> {
    return this.core.claimRun(request);
  }

  async listRecoverableRuns(request: AgentListRecoverableRunsRequest): Promise<readonly RequestRunRecord[]> {
    return this.core.listRecoverableRuns(request);
  }

  async commitTerminal(request: TerminalCommitRequest): Promise<TerminalCommitRecordResult> {
    return this.core.commitTerminal(request);
  }
}
