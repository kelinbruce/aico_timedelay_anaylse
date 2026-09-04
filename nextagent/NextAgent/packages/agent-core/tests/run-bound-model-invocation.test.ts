import { AgentError, bindRuntimeLoggerProvider, brand, noopRuntimeLogger, type JsonObject } from '@nextagent/agent-common';
import { RunBoundModelInvocation } from '@nextagent/agent-core';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('RunBoundModelInvocation terminal finalization', () => {
  it('calls beforeTerminal once before normal completion', async () => {
    const harness = createHarness(
      async () =>
        ({
          content: 'answer',
          finishReason: 'stop',
        }) satisfies ModelFinalResult,
    );

    await collect(harness.invocation, new AbortController().signal);

    expect(harness.order).toEqual(['MODEL_INVOCATION_STARTED', 'beforeTerminal', 'MODEL_INVOCATION_COMPLETED']);
    expect(harness.beforeTerminal).toHaveBeenCalledWith({
      content: 'answer',
      finishReason: 'stop',
    });
  });

  it('calls beforeTerminal once before a safe model failure', async () => {
    const harness = createHarness(
      async () =>
        ({
          content: '',
          finishReason: 'error',
          safeError: { code: 'MODEL_UNAVAILABLE', message: 'unavailable', category: 'UNAVAILABLE', retryable: true },
        }) satisfies ModelFinalResult,
    );

    await collect(harness.invocation, new AbortController().signal);

    expect(harness.order).toEqual(['MODEL_INVOCATION_STARTED', 'beforeTerminal', 'MODEL_INVOCATION_FAILED']);
    expect(harness.beforeTerminal).toHaveBeenCalledWith({
      content: '',
      finishReason: 'error',
      safeError: { code: 'MODEL_UNAVAILABLE', message: 'unavailable', category: 'UNAVAILABLE', retryable: true },
    });
  });

  it('calls beforeTerminal once before a thrown provider failure', async () => {
    const failure = new Error('provider failed');
    const harness = createHarness(async () => {
      throw failure;
    });

    await expect(collect(harness.invocation, new AbortController().signal)).rejects.toBe(failure);
    expect(harness.order).toEqual(['MODEL_INVOCATION_STARTED', 'beforeTerminal', 'MODEL_INVOCATION_FAILED']);
    expect(harness.beforeTerminal).toHaveBeenCalledWith(undefined);
  });

  it('forwards deltas separately from the service-owned terminal result', async () => {
    const harness = createHarness(async (_request, _signal, onDelta) => {
      await onDelta({ reasoning: 'incomplete reasoning' });
      return { content: 'answer' };
    });
    const events = await collect(harness.invocation, new AbortController().signal);

    expect(events).toEqual([{ reasoning: 'incomplete reasoning' }, { content: 'answer' }]);
    expect(harness.order).toEqual(['MODEL_INVOCATION_STARTED', 'beforeTerminal', 'MODEL_INVOCATION_COMPLETED']);
  });

  it('writes usage, total latency, and first feedback latency to the completed terminal payload', async () => {
    const harness = createHarness(async (_request, _signal, onDelta) => {
      await onDelta({ reasoning: 'feedback' });
      return { content: 'answer', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
    });

    await collect(harness.invocation, new AbortController().signal);

    const payload = terminalPayload(harness, 'MODEL_INVOCATION_COMPLETED');
    expect(payload).toMatchObject({ usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } });
    expect(payload.durationMs).toEqual(expect.any(Number));
    expect(payload.firstContentLatencyMs).toEqual(expect.any(Number));
    expect(payload.firstContentLatencyMs).toBeLessThanOrEqual(payload.durationMs as number);
  });

  it('uses final-only feedback for first latency and omits unavailable feedback and usage', async () => {
    const finalOnly = createHarness(async () => ({ content: 'answer' }));
    await collect(finalOnly.invocation, new AbortController().signal);
    const finalOnlyPayload = terminalPayload(finalOnly, 'MODEL_INVOCATION_COMPLETED');
    expect(finalOnlyPayload.firstContentLatencyMs).toBe(finalOnlyPayload.durationMs);

    const empty = createHarness(async () => ({ content: '' }));
    await collect(empty.invocation, new AbortController().signal);
    const emptyPayload = terminalPayload(empty, 'MODEL_INVOCATION_COMPLETED');
    expect(emptyPayload.durationMs).toEqual(expect.any(Number));
    expect(emptyPayload).not.toHaveProperty('firstContentLatencyMs');
    expect(emptyPayload).not.toHaveProperty('usage');
  });

  it('preserves final usage on safe failure and never fabricates it for a thrown failure', async () => {
    const safeFailure = createHarness(async () => ({
      content: '',
      safeError: { code: 'MODEL_UNAVAILABLE', message: 'unavailable', category: 'UNAVAILABLE', retryable: true },
      usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
    }));
    await collect(safeFailure.invocation, new AbortController().signal);
    expect(terminalPayload(safeFailure, 'MODEL_INVOCATION_FAILED')).toMatchObject({
      durationMs: expect.any(Number),
      usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
    });

    const thrown = createHarness(async (_request, _signal, onDelta) => {
      await onDelta({ toolCall: { toolCallId: 'call-1', toolName: 'Read', arguments: {} } });
      throw new Error('provider failed');
    });
    await expect(collect(thrown.invocation, new AbortController().signal)).rejects.toThrow('provider failed');
    const thrownPayload = terminalPayload(thrown, 'MODEL_INVOCATION_FAILED');
    expect(thrownPayload.durationMs).toEqual(expect.any(Number));
    expect(thrownPayload.firstContentLatencyMs).toEqual(expect.any(Number));
    expect(thrownPayload).not.toHaveProperty('usage');
  });

  it('calls beforeTerminal once before an aborted invocation failure', async () => {
    const canceled = new AgentError({
      code: 'MODEL_ABORTED',
      message: 'canceled',
      category: 'CANCELED',
      retryable: false,
    });
    const harness = createHarness(async (_request, signal) => {
      expect(signal.aborted).toBe(true);
      throw canceled;
    });
    const controller = new AbortController();
    controller.abort();

    await expect(collect(harness.invocation, controller.signal)).rejects.toBe(canceled);
    expect(harness.order).toEqual(['MODEL_INVOCATION_STARTED', 'beforeTerminal', 'MODEL_INVOCATION_FAILED']);
  });

  it('does not repeat finalization or the failed event for duplicate failed calls', async () => {
    const harness = createHarness(async () => {
      throw new Error('not used');
    });

    await harness.invocation.failed(new Error('first'));
    await harness.invocation.failed(new Error('second'));

    expect(harness.beforeTerminal).toHaveBeenCalledTimes(1);
    expect(harness.order).toEqual(['beforeTerminal', 'MODEL_INVOCATION_FAILED']);
  });

  it('logs Model input without SYSTEM messages and normalized visible output without reasoning', async () => {
    const logged: JsonObject[] = [];
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        ...noopRuntimeLogger,
        info: (fields) => logged.push(fields as JsonObject),
        error: (fields) => logged.push(fields as JsonObject),
      }),
    });
    try {
      const harness = createHarness(
        async () => ({
          content: 'transport link loss',
          reasoning: 'private chain of thought',
          finishReason: 'stop',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: { path: 'alarm.log' } }],
          usage: { inputTokens: 21, outputTokens: 7, totalTokens: 28 },
        }),
        [
          { role: 'SYSTEM', content: [{ type: 'text', text: 'system-one' }] },
          { role: 'USER', content: [{ type: 'text', text: 'diagnose outage' }] },
          { role: 'SYSTEM', content: [{ type: 'text', text: 'system-two' }] },
          { role: 'TOOL', content: [{ type: 'text', text: 'alarm details' }] },
        ],
      );

      await collect(harness.invocation, new AbortController().signal);

      const inputEntry = logged.find((entry) => entry.event === 'model.payload.input_captured');
      expect(inputEntry).toMatchObject({
        runId: 'run-1',
        requestId: 'request-1',
        sessionId: 'session-1',
        stepId: 'model:1',
        modelInput: {
          messages: [
            { role: 'USER', content: [{ type: 'text', text: 'diagnose outage' }] },
            { role: 'TOOL', content: [{ type: 'text', text: 'alarm details' }] },
          ],
        },
      });
      expect(Object.keys(inputEntry?.modelInput as JsonObject)).toEqual(['messages']);
      expect(logged.find((entry) => entry.event === 'model.payload.output_captured')).toMatchObject({
        stepId: 'model:1',
        modelOutput: {
          content: 'transport link loss',
          finishReason: 'stop',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: { path: 'alarm.log' } }],
          usage: { inputTokens: 21, outputTokens: 7, totalTokens: 28 },
        },
      });
      expect(logged.find((entry) => entry.event === 'model.payload.output_captured')).not.toHaveProperty('modelOutput.reasoning');
      expect(logged.find((entry) => entry.event === 'model.payload.output_captured')).not.toHaveProperty('durationMs');
      expect(logged.find((entry) => entry.event === 'model.payload.output_captured')).not.toHaveProperty('firstContentLatencyMs');
      expect(JSON.stringify(logged)).not.toMatch(/system-one|system-two|private chain of thought/u);
    } finally {
      binding.unbind();
    }
  });

  it('logs a thrown Model failure without changing the thrown value', async () => {
    const logged: JsonObject[] = [];
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({ ...noopRuntimeLogger, error: (fields) => logged.push(fields as JsonObject) }),
    });
    const failure = new Error('provider invocation failed');
    try {
      const harness = createHarness(async () => {
        throw failure;
      });
      await expect(collect(harness.invocation, new AbortController().signal)).rejects.toBe(failure);
      expect(logged).toContainEqual(expect.objectContaining({ event: 'model.payload.failed', err: failure, runId: 'run-1', stepId: 'model:1' }));
    } finally {
      binding.unbind();
    }
  });
});

function createHarness(
  stream: ModelInvocationService['stream'],
  messages?: ModelInvocationRequest['messages'],
): {
  readonly invocation: RunBoundModelInvocation;
  readonly order: string[];
  readonly beforeTerminal: ReturnType<typeof vi.fn>;
  readonly timelineEvents: Array<{ readonly type: string; readonly inlinePayload?: JsonObject }>;
} {
  const run = makeRun();
  const context = makeContext(run);
  const order: string[] = [];
  const timelineEvents: Array<{ readonly type: string; readonly inlinePayload?: JsonObject }> = [];
  const beforeTerminal = vi.fn(async (_result?: ModelFinalResult) => {
    order.push('beforeTerminal');
  });
  const model: ModelInvocationService = {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream,
  };
  const runState: AgentRunStatePort = {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      order.push(event.type);
      timelineEvents.push(event);
    }),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-1')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };

  return {
    invocation: new RunBoundModelInvocation(model, runState, run, context, makeRequest(run, messages), { selectedMessageRefs: [] }, beforeTerminal),
    order,
    beforeTerminal,
    timelineEvents,
  };
}

function terminalPayload(harness: ReturnType<typeof createHarness>, type: 'MODEL_INVOCATION_COMPLETED' | 'MODEL_INVOCATION_FAILED'): JsonObject {
  const payload = harness.timelineEvents.find((event) => event.type === type)?.inlinePayload;
  expect(payload).toBeDefined();
  return payload!;
}

async function collect(invocation: RunBoundModelInvocation, signal: AbortSignal): Promise<unknown[]> {
  const events: unknown[] = [];
  const result = await invocation.stream(signal, async (delta) => {
    events.push(delta);
  });
  events.push(result);
  return events;
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-1:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(run: RequestRun): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'run-bound-model-test',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function makeRequest(run: RequestRun, messages?: ModelInvocationRequest['messages']): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      operationId: 'model:1',
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
    },
    modelId: 'test-model',
    messages: messages ?? [{ role: 'USER', content: [{ type: 'text', text: 'diagnose' }] }],
    tools: [],
    timeoutMs: 1000,
  };
}
