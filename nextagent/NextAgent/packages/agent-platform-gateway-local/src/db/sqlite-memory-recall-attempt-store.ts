import type {
  RequestRunMemoryRecallAttemptClaimResult,
  RequestRunMemoryRecallAttemptGateway,
  RequestRunMemoryRecallAttemptLookupRequest,
  RequestRunMemoryRecallAttemptRecord,
  VersionedUpdateResult,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteMemoryRecallAttemptStore implements RequestRunMemoryRecallAttemptGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async claimAttempt(record: RequestRunMemoryRecallAttemptRecord): Promise<RequestRunMemoryRecallAttemptClaimResult> {
    return this.core.claimMemoryRecallAttempt(record);
  }

  async completeAttempt(
    record: RequestRunMemoryRecallAttemptRecord,
    options: Pick<VersionedWriteOptions, 'expectedVersion'>,
  ): Promise<VersionedUpdateResult<RequestRunMemoryRecallAttemptRecord>> {
    return this.core.completeMemoryRecallAttempt(record, options);
  }

  async loadAttempt(request: RequestRunMemoryRecallAttemptLookupRequest): Promise<RequestRunMemoryRecallAttemptRecord | undefined> {
    return this.core.loadMemoryRecallAttempt(request);
  }
}
