import type {
  IdempotentWriteOptions,
  ListTaskTrajectoriesQuery,
  ListTaskTrajectoryBuildCandidatesQuery,
  SaveTaskTrajectoryRequest,
  TaskTrajectoryBuildCandidateResult,
  TaskTrajectoryListResult,
  TaskTrajectoryQueryGateway,
  TaskTrajectoryRecord,
  TaskTrajectoryStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SafeError } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteTaskTrajectoryStore implements TaskTrajectoryStoreGateway, TaskTrajectoryQueryGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async saveTaskTrajectory(record: SaveTaskTrajectoryRequest, options: IdempotentWriteOptions = {}): Promise<TaskTrajectoryRecord | SafeError> {
    return this.core.saveTaskTrajectory(record, options);
  }

  async listTaskTrajectories(query: ListTaskTrajectoriesQuery): Promise<TaskTrajectoryListResult | SafeError> {
    return this.core.listTaskTrajectories(query);
  }

  async listBuildCandidates(query: ListTaskTrajectoryBuildCandidatesQuery): Promise<TaskTrajectoryBuildCandidateResult | SafeError> {
    return this.core.listBuildCandidates(query);
  }
}
