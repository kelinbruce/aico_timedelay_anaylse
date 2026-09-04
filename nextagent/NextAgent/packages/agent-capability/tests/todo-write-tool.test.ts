import { createCapabilitySubsystem, todoWriteCapabilityId, type TodoStatePort, type ToolExecutionContext } from '@nextagent/agent-capability';
import { createGatewayTodoState } from '@nextagent/agent-runtime';
import { bindRuntimeLoggerProvider, brand, type AgentId, type JsonObject, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import type { TodoStateStoreGateway } from '@nextagent/agent-contracts/gateway';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const firstTodo = { content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'in_progress' };
const secondTodo = { content: 'Check UPF route', activeForm: 'Checking UPF route', status: 'pending' };

describe('TodoWrite tool', () => {
  it('replaces the scoped list atomically, preserves order, and returns old and new lists', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { todoState: createGatewayTodoState({ store: memoryTodoStore() }) } });

    await expect(invoke(subsystem, { todos: [firstTodo, secondTodo] })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { oldTodos: [], newTodos: [firstTodo, secondTodo] },
    });
    await expect(invoke(subsystem, { todos: [secondTodo] })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { oldTodos: [firstTodo, secondTodo], newTodos: [secondTodo] },
    });
  });

  it('clears the list for empty input and all-completed input', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { todoState: createGatewayTodoState({ store: memoryTodoStore() }) } });
    await invoke(subsystem, { todos: [firstTodo] });

    await expect(invoke(subsystem, { todos: [] })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { oldTodos: [firstTodo], newTodos: [] },
    });
    await invoke(subsystem, { todos: [firstTodo] });
    await expect(invoke(subsystem, { todos: [{ ...firstTodo, status: 'completed' }] })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { oldTodos: [firstTodo], newTodos: [] },
    });
  });

  it('isolates state by trusted session and agent scope while rejecting model-supplied scope fields', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { todoState: createGatewayTodoState({ store: memoryTodoStore() }) } });
    await invoke(subsystem, { todos: [firstTodo] });
    await invoke(subsystem, { todos: [secondTodo] }, { agentId: brand<string, 'AgentId'>('other-agent') });

    await expect(invoke(subsystem, { todos: [] })).resolves.toMatchObject({ structuredPayload: { oldTodos: [firstTodo], newTodos: [] } });
    await expect(invoke(subsystem, { todos: [] }, { agentId: brand<string, 'AgentId'>('other-agent') })).resolves.toMatchObject({
      structuredPayload: { oldTodos: [secondTodo], newTodos: [] },
    });
    await expect(invoke(subsystem, { todos: [firstTodo], agentId: 'attacker-agent' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
    await expect(invoke(subsystem, { todos: [{ ...firstTodo, scope: 'attacker-scope' }] })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
  });

  it('uses trusted context and maps missing dependency, missing context, aborted, and raw failures safely', async () => {
    const calls: ToolExecutionContext[] = [];
    const todoState: TodoStatePort = {
      async replaceTodos(_input, context) {
        calls.push(context);
        return { oldTodos: [], newTodos: [] };
      },
    };
    const subsystem = createCapabilitySubsystem({ toolDependencies: { todoState } });
    await invoke(subsystem, { todos: [] });
    expect(calls[0]).toMatchObject({ agentId: agentId(), sessionId: sessionId(), toolCallId: 'tool-todo' });

    await expect(createCapabilitySubsystem().invocationPort.invoke(request({ todos: [] }), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_UNAVAILABLE', category: 'UNAVAILABLE' },
    });

    const descriptor = (
      await subsystem.catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly(), includeUnavailable: false })
    ).find((entry) => entry.capabilityId === 'TodoWrite')!;

    const aborted = new AbortController();
    aborted.abort();
    await expect(subsystem.invocationPort.invoke(request({ todos: [] }), aborted.signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_ABORTED', category: 'CANCELED' },
    });
    expect(descriptor.displayName).toBe('TodoWrite');

    const rawFailureSubsystem = createCapabilitySubsystem({
      toolDependencies: {
        todoState: {
          async replaceTodos() {
            throw new Error('RAW_TODO_SECRET');
          },
        },
      },
    });
    const failure = await rawFailureSubsystem.invocationPort.invoke(request({ todos: [] }), new AbortController().signal);
    expect(failure).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL' } });
    expect(JSON.stringify(failure)).not.toContain('RAW_TODO_SECRET');
  });

  it('emits safe diagnostics without todo text leakage', async () => {
    const logs: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(logs) });
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { todoState: createGatewayTodoState({ store: memoryTodoStore() }) },
    });
    const result = await invoke(subsystem, { todos: [firstTodo, secondTodo] });

    expect(result).toMatchObject({ status: 'SUCCEEDED' });
    expect(result).not.toHaveProperty('metadata');
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'todo.runtime.replace.start', capabilityId: 'TodoWrite', itemCount: 2 }),
        expect.objectContaining({
          event: 'todo.runtime.replace.completed',
          capabilityId: 'TodoWrite',
          newItemCount: 2,
          statusSummary: 'pending:1,in_progress:1,completed:0',
        }),
      ]),
    );
    expect(JSON.stringify(logs)).not.toContain('Inspect AMF alarm');
    expect(JSON.stringify(logs)).not.toContain('Checking UPF route');
  });
});

async function invoke(
  subsystem: ReturnType<typeof createCapabilitySubsystem>,
  args: JsonObject,
  overrides: { readonly agentId?: AgentId; readonly sessionId?: ReturnType<typeof sessionId> } = {},
) {
  return subsystem.invocationPort.invoke(request(args, overrides), new AbortController().signal);
}

function request(
  args: JsonObject,
  overrides: { readonly agentId?: AgentId; readonly sessionId?: ReturnType<typeof sessionId> } = {},
): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-todo',
    capabilityId: todoWriteCapabilityId,
    arguments: args,
    sessionId: overrides.sessionId ?? sessionId(),
    requestId: brand<string, 'MessageId'>('request-todo'),
    runId: brand<string, 'RequestRunId'>('run-todo'),
    requestContextId: brand<string, 'RequestContextId'>('context-todo'),
    stepId: 'turn-1',
    toolCallId: 'tool-todo',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Todo tester' },
    agentId: overrides.agentId ?? agentId(),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-todo'),
  };
}

function assembly() {
  return {
    agentId: agentId(),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    userInvocable: true,
    agentInvocation: 'BOUND' as const,
    displayName: 'Default Agent',
    description: 'Telecom test agent.',
    workspacePolicy: { schemaVersion: 'nextagent.agent-workspace-policy.v1' as const, isolationMode: 'subject' as const, roots: [] },
    modelIds: ['test-model'],
    capabilityBindings: [],
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function testLogger(logs: unknown[]) {
  return {
    debug() {},
    info(obj: unknown) {
      logs.push(obj);
    },
    warn(obj: unknown) {
      logs.push(obj);
    },
    error(obj: unknown) {
      logs.push(obj);
    },
  };
}

function memoryTodoStore(): TodoStateStoreGateway {
  const current = new Map<string, ReadonlyArray<{ content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' }>>();
  const revisionSeq = new Map<string, number>();
  return {
    async replaceTodoState(request) {
      const key = [request.tenantId, request.subjectId, request.agentId, request.sessionId].join(':');
      const oldTodos = current.get(key) ?? [];
      const nextSeq = (revisionSeq.get(key) ?? 0) + 1;
      revisionSeq.set(key, nextSeq);
      if (request.todos.length === 0) {
        current.delete(key);
      } else {
        current.set(key, request.todos);
      }
      return {
        oldTodos,
        newTodos: request.todos,
        revision: {
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          sessionId: request.sessionId,
          requestId: request.requestId,
          requestRunId: request.requestRunId,
          requestContextId: request.requestContextId,
          ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
          revisionSeq: nextSeq,
          todos: request.todos,
          createdAt: brand<number, 'EpochMillis'>(nextSeq),
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

function tenantId() {
  return brand<string, 'TenantId'>('tenant-todo');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-todo');
}

function agentId() {
  return brand<string, 'AgentId'>('default-agent');
}

function sessionId() {
  return brand<string, 'SessionId'>('session-todo');
}
