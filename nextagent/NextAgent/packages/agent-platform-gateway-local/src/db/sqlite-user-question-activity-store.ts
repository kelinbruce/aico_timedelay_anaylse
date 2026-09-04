import type {
  UserQuestionActivityHighFrequencyQuery,
  UserQuestionActivityRecord,
  UserQuestionActivityStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SafeError } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteUserQuestionActivityStore implements UserQuestionActivityStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async upsertActivity(record: UserQuestionActivityRecord): Promise<UserQuestionActivityRecord | SafeError> {
    return this.core.upsertActivity(record);
  }

  async listHighFrequency(query: UserQuestionActivityHighFrequencyQuery): Promise<readonly UserQuestionActivityRecord[] | SafeError> {
    return this.core.listHighFrequency(query);
  }
}
