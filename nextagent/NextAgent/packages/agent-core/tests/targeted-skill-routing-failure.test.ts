import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('targeted skill routing failure', () => {
  it('fails safely when the governed Skill loader capability is unavailable', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'alarm-diagnosis' ? preferredSkillDescriptor() : undefined)),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_TOOL_UNAVAILABLE',
      category: 'UNAVAILABLE',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('surfaces safe timeout when the preferred Skill invocation times out', async () => {
    const harness = makeHarness({
      capabilityInvocation: {
        invoke: vi.fn(async () => ({
          status: 'TIMED_OUT' as const,
          structuredPayload: {},
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'DIRECTED_SKILL_TIMEOUT',
            message: 'Preferred Skill timed out.',
            category: 'TIMEOUT' as const,
            retryable: true,
          },
        })),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'DIRECTED_SKILL_TIMEOUT',
      category: 'TIMEOUT',
    });
    expectDirectedSkillLifecycle(harness.runState.events, 'TIMED_OUT', 'DIRECTED_SKILL_TIMEOUT');
  });

  it('preserves the final Capability safeError for a non-timeout final failure without a second invocation', async () => {
    const harness = makeHarness({
      capabilityInvocation: {
        invoke: vi.fn(async () => ({
          status: 'FAILED' as const,
          structuredPayload: {},
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'CAPABILITY_OUTPUT_INVALID',
            message: 'Capability output did not satisfy its declared contract.',
            category: 'VALIDATION' as const,
            retryable: false,
          },
        })),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'CAPABILITY_OUTPUT_INVALID',
      category: 'VALIDATION',
      retryable: false,
    });
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expectDirectedSkillLifecycle(harness.runState.events, 'FAILED', 'CAPABILITY_OUTPUT_INVALID');
  });

  it('keeps a legal degraded Skill result on the directed path without a model fallback or retry', async () => {
    const harness = makeHarness({
      capabilityInvocation: {
        invoke: vi.fn(async () => ({
          status: 'DEGRADED' as const,
          structuredPayload: { partial: true },
          generatedMessages: [],
          artifactRefs: [],
          safeError: { code: 'DIRECTED_SKILL_DEGRADED', message: 'Partial Skill result.', category: 'UNAVAILABLE' as const, retryable: false },
        })),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(harness.runState.emitEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'DIRECTED_SKILL_DEGRADED' } }),
    );
    expectDirectedSkillLifecycle(harness.runState.events, 'DEGRADED', 'DIRECTED_SKILL_DEGRADED');
  });

  it('does not invoke the Skill again or fall back to the model when the resolver rejects', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor()]),
        resolve: vi.fn(async () => {
          throw new Error('RAW_RESOLVER_SECRET');
        }),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE',
      category: 'UNAVAILABLE',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('fails safely when the request deadline is already exceeded before preferred Skill execution', async () => {
    const run = makeRun();
    const harness = makeHarness({
      run: {
        ...run,
        deadlineAt: brand<number, 'EpochMillis'>(Date.now() - 1),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_DEADLINE_EXCEEDED',
      category: 'TIMEOUT',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('does not continue with partially resolved Skill facts after cancellation', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            controller.abort();
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, controller.signal)).rejects.toMatchObject({
      code: 'ROUTING_ABORTED',
      category: 'CANCELED',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('times out safely when preferred Skill resolution exceeds the remaining request deadline', async () => {
    const run = makeRun();
    const harness = makeHarness({
      run: {
        ...run,
        deadlineAt: brand<number, 'EpochMillis'>(Date.now() + 250),
      },
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return await new Promise<CapabilityDescriptor>(() => undefined);
          }
          return skillToolDescriptor();
        }),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_RESOLVE_TIMEOUT',
      category: 'TIMEOUT',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });
});

function makeHarness(overrides: { capabilityCatalog?: CapabilityCatalog; capabilityInvocation?: CapabilityInvocationPort; run?: RequestRun } = {}) {
  const run = overrides.run ?? makeRun();
  const context = makeContext(run);
  const assembly = makeAssembly(run);
  const capabilityCatalog =
    overrides.capabilityCatalog ??
    ({
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
    } satisfies CapabilityCatalog);
  const capabilityInvocation =
    overrides.capabilityInvocation ??
    ({
      invoke: vi.fn(async () => ({
        status: 'SUCCEEDED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
      })),
    } satisfies CapabilityInvocationPort);
  const runState = makeRunState();

  return {
    run,
    context,
    capabilityInvocation,
    runState,
    agent: new DefaultAgent({
      contextEngine: makeContextEngine(),
      model: makeModel(),
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState,
    }),
  };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-targeted-skill-routing-failure'),
    sessionId: brand<string, 'SessionId'>('session-targeted-skill-routing-failure'),
    requestId: brand<string, 'MessageId'>('request-targeted-skill-routing-failure'),
    agentId: brand<string, 'AgentId'>('agent-targeted-skill-routing-failure'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-targeted-skill-routing-failure:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('context-targeted-skill-routing-failure'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-targeted-skill-routing-failure'),
      subjectId: brand<string, 'SubjectId'>('subject-targeted-skill-routing-failure'),
      displayName: 'Targeted Skill Routing Failure',
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
}

function makeAssembly(run: RequestRun): AgentAssembly {
  return {
    agentId: run.agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    displayName: 'Targeted Skill Routing Failure Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
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

function makeContextEngine(): ContextEnginePort {
  return {
    assemble: vi.fn(
      async (request) =>
        ({
          request,
          systemPrompt: { sections: [] },
          selectedMessageRefs: [],
          visibleCapabilities: [],
          modelConfiguration: {
            modelId: 'test-model',
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
        }) satisfies ContextAssembly,
    ),
    render: vi.fn(async (assembly) => ({
      requestContextId: assembly.request.requestContextId,
      messages: [],
      tools: [],
      modelConfiguration: {
        modelId: 'test-model',
        contextWindowTokens: 128_000,
        temperature: 0.55,
        maxOutputTokens: 512,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
      modelOptions: { maxOutputTokens: 512 },
      providerOptions: {},
    })),
  };
}

function makeModel(): ModelInvocationService {
  return {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
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
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-targeted-skill-routing-failure')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}

function expectDirectedSkillLifecycle(events: readonly RunTimelineEvent[], status: 'DEGRADED' | 'FAILED' | 'TIMED_OUT', safeErrorCode: string): void {
  const lifecycleEvents = events.filter((event) => event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED');
  expect(lifecycleEvents.map((event) => event.type)).toEqual(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED']);
  expect(lifecycleEvents[1]?.inlinePayload).toMatchObject({
    capabilityKind: 'TOOL',
    capabilityId: 'Skill',
    targetCapabilityId: 'alarm-diagnosis',
    toolCallId: 'directed-skill:alarm-diagnosis',
    status,
    safeErrorCode,
  });
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
