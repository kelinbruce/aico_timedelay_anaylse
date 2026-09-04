import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { AgentError, bindRuntimeLoggerProvider, brand, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('model fallback orchestration', () => {
  it('keeps one canonical failure and leaves exception logging to the request termination owner', async () => {
    const failure = new TypeError('provider raw body token=secret');
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            throw failure;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toBe(failure);

    expect(modelInvocationEvents(harness.runState.events).filter((event) => event.type === 'MODEL_INVOCATION_FAILED')).toEqual([
      expect.objectContaining({ inlinePayload: expect.objectContaining({ safeErrorCode: 'UNEXPECTED_ERROR', safeErrorCategory: 'INTERNAL' }) }),
    ]);
    expect(harness.runtimeLogEntries.filter((entry) => entry.event === 'model.invocation.exception_captured')).toEqual([]);
  });

  it('emits safe model invocation timeline payloads on a successful model loop', async () => {
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield {
              content: 'fallback-safe answer',
              finishReason: 'stop',
              usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const modelEvents = modelInvocationEvents(harness.runState.events);
    expect(modelEvents.map((event) => event.type)).toEqual(['MODEL_INVOCATION_STARTED', 'MODEL_INVOCATION_COMPLETED']);
    expect(modelEvents[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        stepId: 'turn-1',
        modelId: 'primary-model',
        modelOptionSummary: expect.objectContaining({
          maxOutputTokens: 512,
          timeoutMs: 1000,
          toolCount: 1,
        }),
        providerOptionKeys: ['vendor'],
      }),
    );
    expect(modelEvents[1]?.inlinePayload).toEqual(
      expect.objectContaining({
        stepId: 'turn-1',
        finishReason: 'stop',
        toolCallCount: 0,
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      }),
    );
    expect(JSON.stringify(modelEvents)).not.toMatch(/fallback-safe answer|primary\.example|PRIMARY_KEY|messages|tools|baseUrl|credentialRef/u);
    expect(modelEvents[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        selectedMessageRefs: ['message-ref-1'],
        disclosedCapabilityIds: ['Read'],
        modelMessageCount: 0,
      }),
    );
  });

  it('records owner-defined context facts independently of workbench composition', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const started = modelInvocationEvents(harness.runState.events)[0];
    expect(started?.inlinePayload).toMatchObject({
      promptTemplateRef: 'prompt-template:test',
      selectedMessageRefs: ['message-ref-1'],
      disclosedCapabilityIds: ['Read'],
      modelMessageCount: 0,
    });
    expect(JSON.stringify(started)).not.toMatch(/message content|raw prompt|credential|token/u);
  });

  it('records actual disclosed capabilities from the final model request', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const modelEvents = modelInvocationEvents(harness.runState.events);
    expect(modelEvents.map((event) => event.type)).toEqual(['MODEL_INVOCATION_STARTED', 'MODEL_INVOCATION_COMPLETED']);
    expect(modelEvents[0]?.inlinePayload).toMatchObject({ disclosedCapabilityIds: ['Read'] });
    expect(modelEvents[0]?.inlinePayload).not.toHaveProperty('visibleCapabilityIds');
    expect(modelEvents[1]?.inlinePayload).toMatchObject({ toolCallCount: 0 });
  });

  it('retries the same model step with the first unattempted fallback route when the primary profile safe-fails before visible output', async () => {
    const requests: ModelInvocationRequest[] = [];
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* (request) {
            requests.push(request);
            if (request.modelId === 'primary-model') {
              yield {
                content: '',
                finishReason: 'error',
                safeError: { code: 'MODEL_PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
              } as ModelFinalResult;
              return;
            }
            yield { content: 'fallback answer', finishReason: 'stop' } as ModelStreamDelta;
          }),
        ),
      },
    });

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    expect(requests.map((request) => request.modelId)).toEqual(['primary-model', 'fallback-model']);
    const modelEvents = modelInvocationEvents(harness.runState.events);
    expect(modelEvents.map((event) => event.type)).toEqual([
      'MODEL_INVOCATION_STARTED',
      'MODEL_INVOCATION_FAILED',
      'MODEL_INVOCATION_STARTED',
      'MODEL_INVOCATION_COMPLETED',
    ]);
    expect(modelEvents.map((event) => (event.inlinePayload as Record<string, unknown>).modelId)).toEqual([
      'primary-model',
      'primary-model',
      'fallback-model',
      'fallback-model',
    ]);
    expect(modelEvents[1]?.inlinePayload).toEqual(
      expect.objectContaining({
        stepId: 'turn-1',
        safeErrorCode: 'MODEL_PRIMARY_FAILED',
        safeErrorCategory: 'UNAVAILABLE',
      }),
    );
    expect(
      harness.runState.events.some(
        (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).outcome === 'fallback-applied',
      ),
    ).toBe(true);
    expect(JSON.stringify(modelEvents)).not.toMatch(/primary failed|fallback answer|primary\.example|fallback\.example|PRIMARY_KEY|FALLBACK_KEY/u);
  });

  it('does not fallback for a non-retryable model failure', async () => {
    const requests: ModelInvocationRequest[] = [];
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* (request) {
            requests.push(request);
            yield {
              content: '',
              finishReason: 'error',
              safeError: {
                code: 'MODEL_NON_RETRYABLE',
                message: 'Model failed without recoverability evidence.',
                category: 'INTERNAL',
                retryable: false,
              },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_NON_RETRYABLE',
    });

    expect(requests.map((request) => request.modelId)).toEqual(['primary-model']);
    expect(harness.runState.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_APPLIED',
          inlinePayload: expect.objectContaining({
            outcome: 'fallback-denied',
            reasonCode: 'SAFE_FAILURE_NOT_FALLBACK_ELIGIBLE',
          }),
        }),
      ]),
    );
  });

  it('denies fallback after visible output has already been emitted', async () => {
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield { content: 'partial answer ' } as ModelStreamDelta;
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_AFTER_OUTPUT_FAILED', message: 'failed after output', category: 'UNAVAILABLE', retryable: true },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_AFTER_OUTPUT_FAILED',
    });
    expect(
      harness.runState.events.some(
        (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).outcome === 'fallback-denied',
      ),
    ).toBe(true);
  });

  it('records fallback-exhausted when no unattempted fallback profile remains', async () => {
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_PRIMARY_FAILED',
    });
    expect(
      harness.runState.events.some(
        (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).outcome === 'fallback-exhausted',
      ),
    ).toBe(true);
  });

  it('denies fallback when the request deadline has already expired', async () => {
    const run = makeRun();
    const harness = makeHarness({
      run: {
        ...run,
        deadlineAt: brand<number, 'EpochMillis'>(Date.now() - 1),
      },
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_PRIMARY_FAILED',
    });
    expect(
      harness.runState.events.some(
        (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).reasonCode === 'ROUTING_DEADLINE_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('records exhaustion when trusted context selection has no eligible fallback', async () => {
    const harness = makeHarness({
      contextSelectionExhausted: true,
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_PRIMARY_FAILED',
    });
    expect(
      harness.runState.events.some(
        (event) =>
          event.type === 'POLICY_APPLIED' &&
          (event.inlinePayload as Record<string, unknown>).outcome === 'fallback-exhausted' &&
          (event.inlinePayload as Record<string, unknown>).reasonCode === 'FALLBACK_EXHAUSTED',
      ),
    ).toBe(true);
  });

  it('denies fallback when the request is canceled before replay', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            controller.abort();
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, controller.signal)).rejects.toMatchObject({
      code: 'MODEL_PRIMARY_FAILED',
    });
    expect(
      harness.runState.events.some(
        (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).reasonCode === 'ROUTING_ABORTED',
      ),
    ).toBe(true);
  });

  it('emits failed model invocation timeline payloads for aborted provider results', async () => {
    const harness = makeHarness({
      contextSelectionExhausted: true,
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_ABORTED', message: 'Model invocation was canceled.', category: 'CANCELED', retryable: false },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_ABORTED',
    });

    const modelEvents = modelInvocationEvents(harness.runState.events);
    expect(modelEvents.map((event) => event.type)).toEqual(['MODEL_INVOCATION_STARTED', 'MODEL_INVOCATION_FAILED']);
    expect(modelEvents[1]?.inlinePayload).toEqual(
      expect.objectContaining({
        stepId: 'turn-1',
        safeErrorCode: 'MODEL_ABORTED',
        safeErrorCategory: 'CANCELED',
      }),
    );
    expect(JSON.stringify(modelEvents)).not.toMatch(/Model invocation was canceled|primary\.example|PRIMARY_KEY/u);
  });

  it('denies fallback when the remaining request budget is smaller than the model timeout budget', async () => {
    const run = makeRun();
    const harness = makeHarness({
      run: {
        ...run,
        deadlineAt: brand<number, 'EpochMillis'>(Date.now() + 500),
      },
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* () {
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'MODEL_PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
            } as ModelFinalResult;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_PRIMARY_FAILED',
    });
    expect(
      harness.runState.events.some(
        (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).reasonCode === 'FALLBACK_BUDGET_INSUFFICIENT',
      ),
    ).toBe(true);
  });
});

function makeHarness(
  overrides: {
    model?: ModelInvocationService;
    run?: RequestRun;
    contextSelectionExhausted?: boolean;
  } = {},
) {
  const run = overrides.run ?? makeRun();
  const context = makeContext(run);
  const assembly = makeAssembly(run);
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async (request, options) => {
      if (
        options?.mode === 'FALLBACK' &&
        (overrides.contextSelectionExhausted === true || options.attemptedModelIds?.includes('fallback-model') === true)
      ) {
        throw new AgentError({
          code: 'FALLBACK_EXHAUSTED',
          message: 'No fallback model remains.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      return makeContextAssembly(request, options?.mode === 'FALLBACK' ? 'fallback-model' : 'primary-model');
    }),
    render: vi.fn(async (assembly) => {
      return {
        requestContextId: assembly.request.requestContextId,
        messages: [],
        tools: [{ capabilityId: 'Read', name: 'read_file', inputSchema: {} }],
        modelConfiguration: assembly.modelConfiguration,
        modelOptions: { maxOutputTokens: 512 },
        providerOptions: { vendor: { parallelToolCalls: false } },
      };
    }),
  };
  const model =
    overrides.model ??
    ({
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* () {
          yield { content: 'ok', finishReason: 'stop' } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService);
  const runState = makeRunState();
  const runtimeLogEntries: Array<Record<string, unknown>> = [];
  captureRuntimeLogger(runtimeLogEntries);

  return {
    run,
    context,
    runState,
    runtimeLogEntries,
    agent: new DefaultAgent({
      contextEngine,
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation: makeCapabilityInvocation(),
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState,
    }),
  };
}

function captureRuntimeLogger(entries: Array<Record<string, unknown>>): void {
  const captureFailure = (fields: object): void => {
    const { err, ...safeFields } = fields as Record<string, unknown>;
    entries.push({ ...safeFields, ...(err === undefined ? {} : { caught: err }) });
  };
  const capture = (fields: object): void => {
    entries.push(fields as Record<string, unknown>);
  };
  const logger: RuntimeLogger = { error: captureFailure, warn: captureFailure, info: capture, debug: capture };
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-model-fallback'),
    sessionId: brand<string, 'SessionId'>('session-model-fallback'),
    requestId: brand<string, 'MessageId'>('request-model-fallback'),
    agentId: brand<string, 'AgentId'>('agent-model-fallback'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-model-fallback:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('context-model-fallback'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-model-fallback'),
      subjectId: brand<string, 'SubjectId'>('subject-model-fallback'),
      displayName: 'Model Fallback',
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

function makeAssembly(run: RequestRun): AgentAssembly {
  return {
    agentId: run.agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    displayName: 'Model Fallback Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['primary-model', 'fallback-model'],
    defaultModelId: 'primary-model',
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
  };
}

function makeAssemblyRegistry(assembly: AgentAssembly): AgentAssemblyRegistry {
  return {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
}

function makeCapabilityCatalog(): CapabilityCatalog {
  return {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
  };
}

function makeCapabilityInvocation(): CapabilityInvocationPort {
  return {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  };
}

function makeRunState(): AgentRunStatePort & { readonly events: RunTimelineEvent[] } {
  const events: RunTimelineEvent[] = [];
  return {
    events,
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-model-fallback')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}

function makeContextAssembly(request: ContextAssembly['request'], modelId = 'primary-model'): ContextAssembly {
  return {
    request,
    systemPrompt: { sections: [] },
    promptTemplateRef: 'prompt-template:test',
    selectedMessageRefs: [brand<string, 'MessageId'>('message-ref-1')],
    visibleCapabilities: [],
    modelConfiguration: {
      modelId,
      contextWindowTokens: 128_000,
      temperature: 0.55,
      maxOutputTokens: 512,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 1000,
      defaultMaxRetries: 2,
    },
    modelOptions: { maxOutputTokens: 512 },
    modelSelectionReason: 'test',
  };
}

function modelInvocationEvents(events: readonly RunTimelineEvent[]): readonly RunTimelineEvent[] {
  return events.filter((event) => event.type.startsWith('MODEL_INVOCATION_'));
}
