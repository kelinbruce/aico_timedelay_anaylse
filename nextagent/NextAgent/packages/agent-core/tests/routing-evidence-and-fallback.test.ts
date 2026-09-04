import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { AgentError, bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('routing evidence and fallback', () => {
  it('emits POLICY_APPLIED timeline diagnostics for routing, constraints, and targeted skill selection', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const policyEvents = harness.runState.events.filter((event) => event.type === 'POLICY_APPLIED');
    expect(policyEvents.map((event) => (event.inlinePayload as Record<string, unknown>).policyDomain)).toEqual(
      expect.arrayContaining(['ROUTING', 'CONSTRAINT', 'TARGETED_SKILL']),
    );
  });

  it('records fallback applied and exhausted evidence as timeline diagnostics', async () => {
    const runtimeLogEntries: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => runtimeLogger(runtimeLogEntries) });
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* (request) {
            if (request.modelId === 'test-model') {
              yield {
                content: '',
                finishReason: 'error',
                safeError: { code: 'PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
              } as never;
              return;
            }
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'FALLBACK_FAILED', message: 'fallback failed', category: 'UNAVAILABLE', retryable: true },
            } as never;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'FALLBACK_FAILED',
    });

    const payloads = harness.runState.events
      .filter((event) => event.type === 'POLICY_APPLIED')
      .map((event) => event.inlinePayload as Record<string, unknown>);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ policyDomain: 'MODEL_FALLBACK', outcome: 'fallback-applied', reasonCode: 'PRIMARY_FAILED' }),
        expect.objectContaining({ policyDomain: 'MODEL_FALLBACK', outcome: 'fallback-exhausted', reasonCode: 'FALLBACK_EXHAUSTED' }),
      ]),
    );
    expect(runtimeLogEntries.filter((entry) => (entry as Record<string, unknown>).event === 'model.call.fallback')).toEqual([
      expect.objectContaining({
        event: 'model.call.fallback',
        stepId: 'turn-1',
        safeErrorCode: 'PRIMARY_FAILED',
        safeErrorCategory: 'UNAVAILABLE',
        fallbackCount: 1,
      }),
    ]);
  });

  it('orchestrates fallback strictly from the frozen eligible profile list and records denied outcomes when budget is insufficient', async () => {
    const requests: string[] = [];
    const run = {
      ...makeRun(),
      deadlineAt: brand<number, 'EpochMillis'>(Date.now() + 50),
    };
    const harness = makeHarness({
      run,
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* (request) {
            requests.push(request.modelId);
            yield {
              content: '',
              finishReason: 'error',
              safeError: { code: 'PRIMARY_FAILED', message: 'primary failed', category: 'UNAVAILABLE', retryable: true },
            } as never;
          }),
        ),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'PRIMARY_FAILED',
    });

    expect(requests).toEqual(['test-model']);
    expect(
      harness.runState.events.some(
        (event) =>
          event.type === 'POLICY_APPLIED' &&
          (event.inlinePayload as Record<string, unknown>).policyDomain === 'MODEL_FALLBACK' &&
          (event.inlinePayload as Record<string, unknown>).reasonCode === 'FALLBACK_BUDGET_INSUFFICIENT',
      ),
    ).toBe(true);
  });
});

function makeHarness(
  overrides: {
    model?: ModelInvocationService;
    run?: RequestRun;
  } = {},
) {
  const run = overrides.run ?? makeRun();
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-routing-evidence'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-routing-evidence'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-evidence'),
      displayName: 'Routing Evidence',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    routingConstraints: {
      targetSkill: 'alarm-diagnosis',
    },
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
  const assembly = makeAssembly(run);
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async (request, options) => {
      if (options?.mode === 'FALLBACK' && options.attemptedModelIds?.includes('fallback-model') === true) {
        throw new AgentError({
          code: 'FALLBACK_EXHAUSTED',
          message: 'No eligible fallback model remains.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      return {
        request,
        systemPrompt: { sections: [] },
        selectedMessageRefs: [],
        visibleCapabilities: [],
        modelConfiguration: {
          modelId: options?.mode === 'FALLBACK' ? 'fallback-model' : 'test-model',
          contextWindowTokens: 128_000,
          temperature: 0.55,
          maxOutputTokens: 512,
          topP: 1,
          toolChoice: 'AUTO' as const,
          defaultTimeoutMs: 30_000,
          defaultMaxRetries: 2,
        },
        modelOptions: { maxOutputTokens: 512 },
        modelSelectionReason: 'test',
      };
    }),
    render: vi.fn(async (assembly) => ({
      requestContextId: assembly.request.requestContextId,
      messages: [],
      tools: [],
      modelConfiguration: assembly.modelConfiguration,
      modelOptions: { maxOutputTokens: 512 },
    })),
  };
  const capabilityCatalog = {
    listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
    resolve: vi.fn(async ({ capabilityId }) => {
      if (capabilityId === 'alarm-diagnosis') {
        return preferredSkillDescriptor();
      }
      if (capabilityId === 'Skill') {
        return skillToolDescriptor();
      }
      return undefined;
    }),
  } satisfies CapabilityCatalog;
  const capabilityInvocation = {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: { name: 'alarm-diagnosis', status: 'loaded' },
      generatedMessages: [],
      artifactRefs: [],
    })),
  } satisfies CapabilityInvocationPort;
  const runState = makeRunState();

  return {
    run,
    context,
    runState,
    agent: new DefaultAgent({
      contextEngine,
      model: overrides.model ?? makeModel(),
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState,
    }),
  };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-evidence'),
    sessionId: brand<string, 'SessionId'>('session-routing-evidence'),
    requestId: brand<string, 'MessageId'>('request-routing-evidence'),
    agentId: brand<string, 'AgentId'>('agent-routing-evidence'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-evidence:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeAssembly(run: RequestRun): AgentAssembly {
  return {
    agentId: run.agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    displayName: 'Routing Evidence Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['test-model', 'fallback-model'],
    defaultModelId: 'test-model',
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

function makeModel(): ModelInvocationService {
  return {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* () {
        yield { content: 'ok', finishReason: 'stop' } as ModelStreamDelta;
      }),
    ),
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
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-routing-evidence')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}

function runtimeLogger(entries: unknown[]) {
  return {
    error(obj: object) {
      entries.push(obj);
    },
    warn(obj: object) {
      entries.push(obj);
    },
    info(obj: object) {
      entries.push(obj);
    },
    debug(obj: object) {
      entries.push(obj);
    },
  };
}

function preferredSkillDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('alarm-diagnosis'),
    kind: 'SKILL' as const,
    provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' as const },
    displayName: 'alarm-diagnosis',
    description: 'Alarm diagnosis skill',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE' as const,
    metadata: {
      metadataKind: 'nextagent.skill',
      context: 'inline',
      userInvocable: true,
      modelInvocable: true,
    },
  };
}

function skillToolDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Skill'),
    kind: 'TOOL' as const,
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' as const },
    displayName: 'Skill',
    description: 'Load a governed Skill',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE' as const,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    compatibility: {
      supportedOsFamilies: [],
      supportedCpuArchitectures: [],
      requiredExecutables: [],
      requiredEnvironmentKeys: [],
      requiredConfigurationKeys: [],
      networkRequired: false,
      runtimeTags: [],
    },
    replayPolicy: 'NON_IDEMPOTENT',
  };
}
