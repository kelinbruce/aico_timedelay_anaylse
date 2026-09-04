import {
  AgentError,
  brand,
  getLogger,
  type AgentId,
  type AgentVersion,
  type IdentityContext,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type { TodoStateItemRecord, TodoStateStoreGateway } from '@nextagent/agent-contracts/gateway';

export interface GatewayTodoStateOptions {
  readonly store: TodoStateStoreGateway;
}

const logger = getLogger({ component: 'agent-runtime', source: 'todo-state' });

export interface RuntimeTodoItem {
  readonly content: string;
  readonly activeForm: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface RuntimeTodoExecutionContext {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly toolCallId?: string;
}

export interface RuntimeTodoStatePort {
  replaceTodos: (
    input: { readonly todos: readonly RuntimeTodoItem[] },
    context: RuntimeTodoExecutionContext,
    signal?: AbortSignal,
  ) => Promise<{ readonly oldTodos: readonly RuntimeTodoItem[]; readonly newTodos: readonly RuntimeTodoItem[] }>;
}

export function createGatewayTodoState(options: GatewayTodoStateOptions): RuntimeTodoStatePort {
  return {
    async replaceTodos(input, context, signal) {
      const startedAt = Date.now();
      logStart(context, input.todos.length);
      throwIfAborted(signal);
      const result = await options.store.replaceTodoState({
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentId: context.agentId,
        sessionId: context.sessionId,
        requestId: context.requestId,
        requestRunId: context.runId,
        requestContextId: context.requestContextId,
        ...(context.toolCallId === undefined ? {} : { toolCallId: brand<string, 'ToolCallId'>(context.toolCallId) }),
        todos: input.todos.map(copyTodo),
      });
      logCompleted(context, startedAt, result.oldTodos.length, result.newTodos, result.revision.revisionSeq);
      return {
        oldTodos: result.oldTodos.map(copyTodo),
        newTodos: result.newTodos.map(copyTodo),
      };
    },
  };

  function logStart(context: ToolExecutionContext, itemCount: number): void {
    logger.info({
      event: 'todo.runtime.replace.start',
      capabilityId: 'TodoWrite',
      toolCallId: context.toolCallId,
      itemCount,
    });
  }

  function logCompleted(
    context: ToolExecutionContext,
    startedAt: number,
    oldCount: number,
    newTodos: readonly TodoStateItem[],
    revisionSeq: number,
  ): void {
    logger.info({
      event: 'todo.runtime.replace.completed',
      capabilityId: 'TodoWrite',
      toolCallId: context.toolCallId,
      oldItemCount: oldCount,
      newItemCount: newTodos.length,
      revisionSeq,
      statusSummary: statusSummary(newTodos),
      durationBucket: durationBucket(Date.now() - startedAt),
    });
  }
}

type TodoStateItem = RuntimeTodoItem;
type ToolExecutionContext = RuntimeTodoExecutionContext;

function copyTodo(todo: TodoStateItemRecord): RuntimeTodoItem {
  return {
    content: todo.content,
    activeForm: todo.activeForm,
    status: todo.status,
  };
}

function statusSummary(todos: readonly TodoStateItem[]): string {
  const counts = new Map<TodoStateItem['status'], number>([
    ['pending', 0],
    ['in_progress', 0],
    ['completed', 0],
  ]);
  for (const todo of todos) {
    counts.set(todo.status, (counts.get(todo.status) ?? 0) + 1);
  }
  return `pending:${counts.get('pending') ?? 0},in_progress:${counts.get('in_progress') ?? 0},completed:${counts.get('completed') ?? 0}`;
}

function durationBucket(durationMs: number): string {
  if (durationMs < 10) {
    return 'lt_10ms';
  }
  if (durationMs < 100) {
    return 'lt_100ms';
  }
  if (durationMs < 1000) {
    return 'lt_1s';
  }
  return 'gte_1s';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new AgentError({
      code: 'TODO_STATE_OPERATION_CANCELED',
      message: 'Todo state operation was canceled.',
      category: 'CANCELED',
      retryable: false,
    });
  }
}
