import { AgentError, brand, type EpochMillis, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CheckpointStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort, HookInput, HookResult, LifecycleHookDefinition, ModelInvokeBoundary } from '@nextagent/agent-contracts/runtime';
import {
  LifecycleHookStageExecutor,
  RegisteredTrustedTerminalLifecycleHookExecutor,
  type AgentHookSnapshot,
  type HookExecutionScope,
  type RuntimeLifecycleHookExecutor,
  type TrustedTerminalLifecycleHookResult,
} from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

describe('trusted terminal lifecycle hook execution', () => {
  it('runs after every ordinary hook without exposing trusted authority or mutation', async () => {
    const calls: string[] = [];
    const events: JsonObject[] = [];
    const ordinaryInputs: HookInput[] = [];
    const definitions = [
      hookDefinition('ordinary-impact', ['TRANSFORM']),
      hookDefinition('ordinary-observe', ['OBSERVE']),
      hookDefinition('trusted-recall', ['TRANSFORM']),
    ];
    const ordinary: RuntimeLifecycleHookExecutor = {
      async invoke(input): Promise<HookResult> {
        ordinaryInputs.push(input);
        calls.push(input.hookId);
        if (input.hookId === 'ordinary-impact') {
          return { outcome: 'PASS', mutation: { messages: [message('ordinary')] } };
        }
        return { outcome: 'PASS' };
      },
    };
    const trusted = new RegisteredTrustedTerminalLifecycleHookExecutor({
      'trusted-recall': async (input) => {
        calls.push(input.hookId);
        expect(input.ownerScope).toEqual({ tenantId: 'T1', subjectId: 'U1' });
        expect(input.boundary.messages).toEqual([message('ordinary')]);
        return {
          outcome: 'PASS',
          mutation: { messages: [message('private-memory')] },
          diagnostic: {
            diagnosticCode: 'MEMORY_RECALL_L2_CONTEXT_ADMITTED',
            candidateCount: 2,
            detailCount: 2,
            contextDisposition: 'L2_CONTEXT',
          },
        };
      },
    });
    const executor = stageExecutor(definitions, ordinary, trusted, events);

    const result = await executor.invokeStage(scope(), 'BEFORE_MODEL_INVOKE', boundary());

    expect(calls.at(-1)).toBe('trusted-recall');
    expect(ordinaryInputs).toHaveLength(2);
    expect(ordinaryInputs.every((input) => !('ownerScope' in input))).toBe(true);
    expect(ordinaryInputs.every((input) => JSON.stringify(input).includes('private-memory') === false)).toBe(true);
    expect(result.boundary.messages).toEqual([message('private-memory')]);
    const trustedEvent = events.find((event) => event['hookId'] === 'trusted-recall');
    expect(trustedEvent).toMatchObject({
      status: 'SUCCESS',
      outcome: 'PASS',
      failureMode: 'CONTINUE',
      diagnosticCode: 'MEMORY_RECALL_L2_CONTEXT_ADMITTED',
      candidateCount: 2,
      detailCount: 2,
      contextDisposition: 'L2_CONTEXT',
    });
    expect(trustedEvent).not.toHaveProperty('mutationSummary');
  });

  it('does not grant trusted input to an unregistered hook id', async () => {
    const genericCalls: string[] = [];
    const trusted = new RegisteredTrustedTerminalLifecycleHookExecutor({
      'trusted-recall': async () => ({ outcome: 'SKIP' }),
    });
    const ordinary: RuntimeLifecycleHookExecutor = {
      async invoke(input): Promise<HookResult> {
        genericCalls.push(input.hookId);
        return { outcome: 'PASS' };
      },
    };
    const executor = stageExecutor([hookDefinition('ordinary-only', ['TRANSFORM'])], ordinary, trusted, []);

    await executor.invokeStage(scope(), 'BEFORE_MODEL_INVOKE', boundary());

    expect(genericCalls).toEqual(['ordinary-only']);
  });

  it('continues without mutation and emits protected telemetry when the trusted hook fails', async () => {
    const events: JsonObject[] = [];
    const trusted = new RegisteredTrustedTerminalLifecycleHookExecutor({
      'trusted-recall': async () => {
        throw new AgentError({
          code: 'MEMORY_SECRET_QUERY_CODE',
          message: 'secret query and memory body',
          category: 'INTERNAL',
          retryable: false,
        });
      },
    });
    const executor = stageExecutor([hookDefinition('trusted-recall', ['TRANSFORM'])], undefined, trusted, events);

    const result = await executor.invokeStage(scope(), 'BEFORE_MODEL_INVOKE', boundary());

    expect(result.boundary).toEqual(boundary());
    expect(JSON.stringify(events)).not.toContain('secret query and memory body');
    expect(JSON.stringify(events)).not.toContain('MEMORY_SECRET_QUERY_CODE');
    expect(events).toContainEqual(
      expect.objectContaining({
        hookId: 'trusted-recall',
        status: 'FAILED',
        failureMode: 'CONTINUE',
        safeReason: 'LIFECYCLE_HOOK_FAILED',
      }),
    );
    expect(events[0]).not.toHaveProperty('outcome');
  });

  it('rejects non-message trusted mutations and continues with the original boundary', async () => {
    const events: JsonObject[] = [];
    const trusted = new RegisteredTrustedTerminalLifecycleHookExecutor({
      'trusted-recall': async () =>
        ({
          outcome: 'PASS',
          mutation: {
            messages: [{ source: 'private-memory' }],
            tools: [{ name: 'not-allowed' }],
          },
        }) as unknown as TrustedTerminalLifecycleHookResult,
    });
    const executor = stageExecutor([hookDefinition('trusted-recall', ['TRANSFORM'])], undefined, trusted, events);

    const result = await executor.invokeStage(scope(), 'BEFORE_MODEL_INVOKE', boundary());

    expect(result.boundary).toEqual(boundary());
    expect(events).toContainEqual(
      expect.objectContaining({
        hookId: 'trusted-recall',
        status: 'INVALID_RESULT',
        failureMode: 'CONTINUE',
        safeReason: 'LIFECYCLE_HOOK_RESULT_INVALID',
      }),
    );
    expect(events[0]).not.toHaveProperty('outcome');
  });

  it('records SKIP and timeout without exposing a mutation summary', async () => {
    const skipEvents: JsonObject[] = [];
    const skipExecutor = stageExecutor(
      [hookDefinition('trusted-recall', ['TRANSFORM'])],
      undefined,
      new RegisteredTrustedTerminalLifecycleHookExecutor({
        'trusted-recall': async () => ({ outcome: 'SKIP' }),
      }),
      skipEvents,
    );
    await skipExecutor.invokeStage(scope(), 'BEFORE_MODEL_INVOKE', boundary());
    expect(skipEvents).toContainEqual(expect.objectContaining({ status: 'SUCCESS', outcome: 'SKIP', failureMode: 'CONTINUE' }));
    expect(skipEvents[0]).not.toHaveProperty('mutationSummary');

    const timeoutEvents: JsonObject[] = [];
    const timedDefinition = { ...hookDefinition('trusted-recall', ['TRANSFORM']), timeoutMs: 5 };
    const timeoutExecutor = stageExecutor(
      [timedDefinition],
      undefined,
      new RegisteredTrustedTerminalLifecycleHookExecutor({
        'trusted-recall': async () => await new Promise(() => {}),
      }),
      timeoutEvents,
    );
    await timeoutExecutor.invokeStage(scope(), 'BEFORE_MODEL_INVOKE', boundary());
    expect(timeoutEvents).toContainEqual(
      expect.objectContaining({
        status: 'TIMEOUT',
        failureMode: 'CONTINUE',
        safeReason: 'LIFECYCLE_HOOK_TIMEOUT',
      }),
    );
    expect(timeoutEvents[0]).not.toHaveProperty('outcome');
    expect(timeoutEvents[0]).not.toHaveProperty('mutationSummary');
  });
});

function stageExecutor(
  definitions: readonly LifecycleHookDefinition[],
  hookExecutor: RuntimeLifecycleHookExecutor | undefined,
  trustedTerminalHookExecutor: RegisteredTrustedTerminalLifecycleHookExecutor,
  events: JsonObject[],
): LifecycleHookStageExecutor {
  const snapshot: AgentHookSnapshot = {
    agentAssemblyRef: 'assembly-1',
    byStage: new Map([['BEFORE_MODEL_INVOKE', definitions.map((definition, declarationOrdinal) => ({ definition, declarationOrdinal }))]]),
  };
  let now = 0;
  return new LifecycleHookStageExecutor({
    snapshots: new Map([['assembly-1', snapshot]]),
    hookExecutor,
    trustedTerminalHookExecutor,
    pendingInputStore: undefined,
    runState: {
      async emitEvent(_run, _context, event) {
        events.push(event.inlinePayload ?? {});
      },
    } as AgentRunStatePort,
    checkpointStore: {} as CheckpointStoreGateway,
    assemblyRegistry: {} as AgentAssemblyRegistry,
    lifecycleHookDefinitions: definitions,
    clock: () => brand<number, 'EpochMillis'>(now++),
    idFactory: (prefix) => `${prefix}-${now}`,
    isBackgroundModelInvocation: () => false,
  });
}

function hookDefinition(hookId: string, effects: LifecycleHookDefinition['effects']): LifecycleHookDefinition {
  return {
    hookId,
    kind: 'CUSTOM',
    supportedStages: ['BEFORE_MODEL_INVOKE'],
    effects,
    executionStrategy: effects[0] === 'OBSERVE' ? 'OBSERVE_PARALLEL' : 'SERIAL_IMPACT',
    failureMode: 'CONTINUE',
  };
}

function scope(): HookExecutionScope {
  return {
    coordinates: {
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('M1'),
      requestRunId: brand<string, 'RequestRunId'>('R1'),
      agentId: brand<string, 'AgentId'>('A1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'assembly-1',
      stageOccurrenceKey: 'round:0:model:1',
    },
    ownerScope: {
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
    },
    requestContextId: brand<string, 'RequestContextId'>('C1'),
  };
}

function boundary(): ModelInvokeBoundary {
  return {
    stepId: 'turn-1',
    modelId: 'default-openai',
    contextWindowTokens: 1000,
    toolCount: 0,
    safeModelRequestSummary: 'messages=1,tools=0',
    messages: [message('original')],
    tools: [],
    providerOptions: {},
    timeoutMs: 1000,
  };
}

function message(text: string) {
  return { role: 'USER' as const, content: [{ type: 'text' as const, text }] };
}
