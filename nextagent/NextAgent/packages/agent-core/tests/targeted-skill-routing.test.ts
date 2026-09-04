import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextAssemblyRequest, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('targeted skill routing', () => {
  it('loads the preferred Skill through the built-in Skill capability before the model loop', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.objectContaining({
        capabilityResolver: expect.any(Object),
      }),
    );
    expect(harness.contextRequests[0]).toMatchObject({
      capabilityContextPatch: {
        allowedTools: ['read'],
      },
    });
  });

  it('emits persisted lifecycle facts for a successfully loaded preferred Skill', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const lifecycleEvents = harness.runState.events.filter((event) => event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED');
    expect(lifecycleEvents.map((event) => event.type)).toEqual(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED']);
    expect(lifecycleEvents[0]?.inlinePayload).toMatchObject({
      messageId: 'message-1',
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'alarm-diagnosis',
      toolCallId: 'directed-skill:alarm-diagnosis',
      stepId: 'turn-1',
    });
    expect(lifecycleEvents[1]?.inlinePayload).toMatchObject({
      messageId: 'message-2',
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'alarm-diagnosis',
      toolCallId: 'directed-skill:alarm-diagnosis',
      status: 'SUCCEEDED',
    });
  });

  it('does not execute the preferred Skill when it conflicts with forbiddenCapabilityIds', async () => {
    const harness = makeHarness({
      context: {
        routingConstraints: {
          targetSkill: 'alarm-diagnosis',
          forbiddenCapabilityIds: ['alarm-diagnosis'],
        },
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_FORBIDDEN',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('does not synthesize Capability lifecycle facts when the preferred Skill is unavailable before invocation', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => []),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'Skill' ? skillToolDescriptor() : undefined)),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_UNAVAILABLE',
    });

    expect(harness.runState.events.map((event) => event.type)).not.toContain('CAPABILITY_STARTED');
    expect(harness.runState.events.map((event) => event.type)).not.toContain('CAPABILITY_COMPLETED');
    expect(harness.runState.appendMessage).not.toHaveBeenCalled();
  });

  it('rejects a preferred Skill that is not visible to the accepted Agent and does not substitute another Skill', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => []),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'Skill' ? skillToolDescriptor() : undefined)),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_UNAVAILABLE',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('keeps model-originated Skill tool use on the normal model tool path instead of treating it as trusted targetSkill', async () => {
    let toolRoundDone = false;
    const harness = makeHarness({
      model: {
        complete: vi.fn(async () => {
          throw new Error('not used');
        }),
        stream: vi.fn(
          modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
            if (!toolRoundDone) {
              toolRoundDone = true;
              yield {
                content: '',
                finishReason: 'tool-calls',
                toolCalls: [{ toolCallId: 'tool-1', toolName: 'Skill', arguments: { name: 'alarm-diagnosis' } }],
              } as ModelStreamDelta;
              return;
            }
            yield { content: 'skill tool answer', finishReason: 'stop' } as ModelStreamDelta;
          }),
        ),
      },
    });
    delete (harness.context as { routingConstraints?: unknown }).routingConstraints;

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        toolCallId: 'tool-1',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: expect.stringMatching(/^directed-skill:/),
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });
});

function makeHarness(overrides: { context?: Partial<RequestContext>; capabilityCatalog?: CapabilityCatalog; model?: ModelInvocationService } = {}) {
  const run = makeRun();
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-targeted-skill-routing'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-targeted-skill-routing'),
      subjectId: brand<string, 'SubjectId'>('subject-targeted-skill-routing'),
      displayName: 'Targeted Skill Routing',
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
    ...overrides.context,
  };
  const assembly = makeAssembly(run.agentId, run.agentVersion);
  const contextRequests: ContextAssemblyRequest[] = [];
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async (request) => {
      contextRequests.push(request);
      return makeContextAssembly(request);
    }),
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
  const capabilityInvocation = {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: { name: 'alarm-diagnosis', status: 'loaded' },
      generatedMessages: [] as const,
      contextPatch: {
        allowedTools: [brand<string, 'CapabilityId'>('read')],
      },
      artifactRefs: [],
    })),
  } satisfies CapabilityInvocationPort;
  const model =
    overrides.model ??
    ({
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          yield { content: 'skill answer', finishReason: 'stop' } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService);
  const assemblyRegistry: AgentAssemblyRegistry = {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
  const events: RunTimelineEvent[] = [];
  let messageSequence = 0;
  const runState: AgentRunStatePort = {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async () => {
      messageSequence += 1;
      return brand<string, 'MessageId'>(`message-${messageSequence}`);
    }),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };

  return {
    run,
    context,
    contextRequests,
    capabilityInvocation,
    runState: {
      ...runState,
      events,
      appendMessage: runState.appendMessage as AgentRunStatePort['appendMessage'] & ReturnType<typeof vi.fn>,
    },
    agent: new DefaultAgent({
      contextEngine,
      model,
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry,
      runState,
    }),
  };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-targeted-skill-routing'),
    sessionId: brand<string, 'SessionId'>('session-targeted-skill-routing'),
    requestId: brand<string, 'MessageId'>('request-targeted-skill-routing'),
    agentId: brand<string, 'AgentId'>('agent-targeted-skill-routing'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-targeted-skill-routing:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeAssembly(agentId: RequestRun['agentId'], agentVersion: RequestRun['agentVersion']): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: `${agentId}:${agentVersion}`,
    displayName: 'Targeted Skill Routing Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 2, maxToolCallsPerTurn: 30 },
  };
}

function makeContextAssembly(request: ContextAssemblyRequest): ContextAssembly {
  return {
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
