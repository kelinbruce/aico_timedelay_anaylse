import { createGatewayTodoState } from '@nextagent/agent-runtime';
import { bindRuntimeLoggerProvider, brand, type EpochMillis, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { ReplaceTodoStateRequest, TodoStateStoreGateway } from '@nextagent/agent-contracts/gateway';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('gateway Todo state port', () => {
  it('delegates scoped replacement to the gateway store', async () => {
    const calls: ReplaceTodoStateRequest[] = [];
    const state = createGatewayTodoState({
      store: {
        async replaceTodoState(request) {
          calls.push(request);
          return {
            oldTodos: [{ content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'pending' }],
            newTodos: request.todos,
            revision: {
              tenantId: request.tenantId,
              subjectId: request.subjectId,
              agentId: request.agentId,
              sessionId: request.sessionId,
              requestId: request.requestId,
              requestRunId: request.requestRunId,
              requestContextId: request.requestContextId,
              revisionSeq: 2,
              todos: request.todos,
              createdAt: brand<number, 'EpochMillis'>(2),
            },
          };
        },
        async loadCurrentTodoState() {
          return undefined;
        },
        async listTodoStateRevisions() {
          return [];
        },
      },
    });
    const next = { content: 'Check UPF route', activeForm: 'Checking UPF route', status: 'in_progress' as const };

    await expect(state.replaceTodos({ todos: [next] }, context())).resolves.toEqual({
      oldTodos: [{ content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'pending' }],
      newTodos: [next],
    });
    expect(calls[0]).toMatchObject({
      tenantId: 'tenant-todo',
      subjectId: 'subject-todo',
      agentId: 'default-agent',
      sessionId: 'session-todo',
      requestId: 'request-todo',
      requestRunId: 'run-todo',
      requestContextId: 'context-todo',
      toolCallId: 'tool-todo',
      todos: [next],
    });
  });

  it('fails safely on cancellation without logging a propagated exception', async () => {
    const logs: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(logs) });
    const state = createGatewayTodoState({ store: fakeStore() });
    const aborted = new AbortController();
    aborted.abort();

    await expect(state.replaceTodos({ todos: [] }, context(), aborted.signal)).rejects.toMatchObject({ code: 'TODO_STATE_OPERATION_CANCELED' });
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'todo.runtime.replace.start', itemCount: 0 })]));
    expect(logs).not.toEqual(expect.arrayContaining([expect.objectContaining({ event: 'todo.runtime.replace.failed' })]));
  });
});

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

function context() {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-todo'),
      subjectId: brand<string, 'SubjectId'>('subject-todo'),
      displayName: 'Todo tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-todo'),
    requestId: brand<string, 'MessageId'>('request-todo'),
    runId: brand<string, 'RequestRunId'>('run-todo'),
    requestContextId: brand<string, 'RequestContextId'>('context-todo'),
    toolCallId: 'tool-todo',
  };
}

function testLogger(logs: unknown[]) {
  const captureFailure = (fields: object): void => {
    const { err, ...safeFields } = fields as Record<string, unknown>;
    logs.push({ ...safeFields, ...(err === undefined ? {} : { caught: err }) });
  };
  return {
    debug() {},
    info(obj: unknown) {
      logs.push(obj);
    },
    warn: captureFailure,
    error: captureFailure,
  };
}
