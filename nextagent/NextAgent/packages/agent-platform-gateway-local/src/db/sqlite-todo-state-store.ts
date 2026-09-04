import type {
  ReplaceTodoStateRequest,
  ReplaceTodoStateResult,
  TodoStateCurrentRecord,
  TodoStateLookupRequest,
  TodoStateRevisionListRequest,
  TodoStateRevisionRecord,
  TodoStateStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteTodoStateStore implements TodoStateStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async replaceTodoState(request: ReplaceTodoStateRequest): Promise<ReplaceTodoStateResult> {
    return this.core.replaceTodoState(request);
  }

  async loadCurrentTodoState(request: TodoStateLookupRequest): Promise<TodoStateCurrentRecord | undefined> {
    return this.core.loadCurrentTodoState(request);
  }

  async listTodoStateRevisions(request: TodoStateRevisionListRequest): Promise<readonly TodoStateRevisionRecord[]> {
    return this.core.listTodoStateRevisions(request);
  }
}
