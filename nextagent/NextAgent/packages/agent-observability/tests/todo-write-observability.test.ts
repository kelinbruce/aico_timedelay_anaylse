import { createGatewayTodoState } from '@nextagent/agent-runtime';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { TodoStateStoreGateway } from '@nextagent/agent-contracts/gateway';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('TodoWrite observability', () => {
  it('logs low-cardinality state diagnostics without todo content or active forms', async () => {
    const entries: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(entries) });
    const state = createGatewayTodoState({ store: fakeStore() });

    await state.replaceTodos(
      {
        todos: [
          { content: 'SECRET_AMF_ALARM', activeForm: 'SECRET_ACTIVE_AMF', status: 'in_progress' },
          { content: 'SECRET_UPF_ROUTE', activeForm: 'SECRET_ACTIVE_UPF', status: 'pending' },
        ],
      },
      context(),
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'todo.runtime.replace.start',
          capabilityId: 'TodoWrite',
          itemCount: 2,
        }),
        expect.objectContaining({
          event: 'todo.runtime.replace.completed',
          capabilityId: 'TodoWrite',
          oldItemCount: 0,
          newItemCount: 2,
          statusSummary: 'pending:1,in_progress:1,completed:0',
          durationBucket: expect.any(String),
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain('SECRET_AMF_ALARM');
    expect(JSON.stringify(entries)).not.toContain('SECRET_ACTIVE_AMF');
    expect(JSON.stringify(entries)).not.toContain('SECRET_UPF_ROUTE');
    expect(JSON.stringify(entries)).not.toContain('SECRET_ACTIVE_UPF');
    expect(JSON.stringify(entries)).not.toContain('durationMs');
  });
});

function context() {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-todo-observe'),
      subjectId: brand<string, 'SubjectId'>('subject-todo-observe'),
      displayName: 'Todo observer',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-todo-observe'),
    requestId: brand<string, 'MessageId'>('request-todo-observe'),
    runId: brand<string, 'RequestRunId'>('run-todo-observe'),
    requestContextId: brand<string, 'RequestContextId'>('context-todo-observe'),
    toolCallId: 'tool-todo-observe',
  };
}

function fakeStore(): TodoStateStoreGateway {
  return {
    async replaceTodoState(request) {
      return {
        oldTodos: [],
        newTodos: request.todos,
        revision: {
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          sessionId: request.sessionId,
          requestId: request.requestId,
          requestRunId: request.requestRunId,
          requestContextId: request.requestContextId,
          revisionSeq: 1,
          todos: request.todos,
          createdAt: brand<number, 'EpochMillis'>(1),
        },
      };
    },
    async loadCurrentTodoState() {
      return undefined;
    },
    async listTodoStateRevisions() {
      return [];
    },
  };
}

function testLogger(entries: unknown[]) {
  return {
    debug() {},
    info(entry: unknown) {
      entries.push(entry);
    },
    warn(entry: unknown) {
      entries.push(entry);
    },
    error(entry: unknown) {
      entries.push(entry);
    },
  };
}
