import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type {
  AgentPolicyResolution,
  AgentPolicyResolverPort,
  AgentRunStatePort,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('routing constraint budget enforcement', () => {
  it('uses toolChoice NONE for model-only while retaining descriptors and discarding returned tool calls', async () => {
    const harness = makeHarness({
      context: {
        routingConstraints: {
          executionMode: 'model-only',
        },
      },
      modelEvents: [
        {
          content: 'model-only answer',
          finishReason: 'stop',
          toolCalls: [{ toolCallId: 'tool-1', toolName: 'read', arguments: {} }],
        } as ModelStreamDelta,
      ],
    });

    await expect(harness.agent.execute(makeRun(), harness.context, new AbortController().signal)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalled();
    const calls = harness.model.stream.mock.calls as unknown[];
    const firstCall = calls[0] as [unknown, ...unknown[]] | undefined;
    const streamedRequest = firstCall?.[0] as { tools?: unknown; toolChoice?: unknown } | undefined;
    expect(streamedRequest?.tools).toHaveLength(1);
    expect(streamedRequest?.toolChoice).toBe('NONE');
  });

  it('feeds forbiddenCapabilityIds rejection to the model before capability resolution/invocation', async () => {
    const harness = makeHarness({
      context: {
        routingConstraints: {
          forbiddenCapabilityIds: ['read'],
        },
      },
      modelEvents: [
        { content: '', finishReason: 'tool-calls', toolCalls: [{ toolCallId: 'tool-1', toolName: 'read', arguments: {} }] } as ModelStreamDelta,
      ],
      assembly: makeAssembly(brand<string, 'AgentId'>('agent-routing-constraint-budget'), brand<string, 'AgentVersion'>('v1'), {
        runtimeSettings: { maxTurns: 2, maxToolCallsPerTurn: 30 },
      }),
    });

    await expect(harness.agent.execute(makeRun(), harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOOL_ROUND_LIMIT_EXCEEDED',
    });
    expect(harness.capabilityCatalog.resolve).not.toHaveBeenCalled();
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(
      harness.runState.events.filter(
        (event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_FORBIDDEN_BY_ROUTING_CONSTRAINT',
      ),
    ).toHaveLength(2);
  });

  it('feeds subagent forbidden rejection to the model when allowSubagents=false', async () => {
    const harness = makeHarness({
      context: {
        routingConstraints: {
          allowSubagents: false,
        },
      },
      capabilityDescriptor: {
        capabilityId: brand<string, 'CapabilityId'>('agent-helper'),
        kind: 'AGENT' as const,
        provider: { providerId: 'builtin', providerKind: 'BUNDLED' as const },
        displayName: 'agent-helper',
        description: 'agent-helper',
        modelInvocable: true,
        availabilityStatus: 'AVAILABLE' as const,
      },
      modelEvents: [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-1', toolName: 'agent-helper', arguments: {} }],
        } as ModelStreamDelta,
      ],
      assembly: makeAssembly(brand<string, 'AgentId'>('agent-routing-constraint-budget'), brand<string, 'AgentVersion'>('v1'), {
        runtimeSettings: { maxTurns: 2, maxToolCallsPerTurn: 30 },
      }),
    });

    await expect(harness.agent.execute(makeRun(), harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOOL_ROUND_LIMIT_EXCEEDED',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(
      harness.runState.events.filter(
        (event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'SUBAGENT_FORBIDDEN_BY_ROUTING_CONSTRAINT',
      ),
    ).toHaveLength(2);
  });

  it('rejects human-input routing decisions when allowHumanInput=false', async () => {
    const pluginPolicy = makePluginRoutingPolicy(async () => ({ kind: 'CLARIFY', safeReason: 'REQUIRES_APPROVAL' }));
    const harness = makeHarness({
      context: {
        routingConstraints: {
          allowHumanInput: false,
        },
      },
      ...pluginPolicy,
    });

    await expect(harness.agent.execute(makeRun(), harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_HUMAN_INPUT_DISALLOWED',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });
});

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-constraint-budget'),
    sessionId: brand<string, 'SessionId'>('session-routing-constraint-budget'),
    requestId: brand<string, 'MessageId'>('request-routing-constraint-budget'),
    agentId: brand<string, 'AgentId'>('agent-routing-constraint-budget'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-constraint-budget:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeHarness(
  overrides: {
    context?: Partial<RequestContext>;
    modelEvents?: ModelStreamDelta[];
    capabilityDescriptor?: Awaited<ReturnType<CapabilityCatalog['resolve']>>;
    assembly?: AgentAssembly;
    policyResolver?: AgentPolicyResolverPort;
  } = {},
) {
  const run = makeRun();
  const assembly = overrides.assembly ?? makeAssembly(run.agentId, run.agentVersion);
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-routing-constraint-budget'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-routing-constraint-budget'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-constraint-budget'),
      displayName: 'Routing Constraint Budget',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
    ...overrides.context,
  };
  const assemblyRegistry: AgentAssemblyRegistry = {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
  const capabilityCatalog = {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(
      async () =>
        overrides.capabilityDescriptor ?? {
          capabilityId: brand<string, 'CapabilityId'>('read'),
          kind: 'TOOL' as const,
          provider: { providerId: 'builtin', providerKind: 'BUNDLED' as const },
          displayName: 'read',
          description: 'read',
          modelInvocable: true,
          availabilityStatus: 'AVAILABLE' as const,
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
          replayPolicy: 'IDEMPOTENT' as const,
        },
    ),
  } satisfies CapabilityCatalog;
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async () => makeContextAssembly(context)),
    render: vi.fn(async () => ({
      requestContextId: context.requestContextId,
      messages: [],
      tools: [{ capabilityId: 'read', name: 'read', inputSchema: { type: 'object' } }],
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
  const modelEvents = overrides.modelEvents ?? [{ content: 'ok', finishReason: 'stop' } as ModelStreamDelta];
  const model = {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* () {
        for (const event of modelEvents) {
          yield event;
        }
      }),
    ),
  } satisfies ModelInvocationService;
  const capabilityInvocation = {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  } satisfies CapabilityInvocationPort;
  const runState = makeRunState();

  return {
    context,
    capabilityCatalog,
    capabilityInvocation,
    runState,
    model,
    agent: new DefaultAgent({
      contextEngine,
      model,
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry,
      runState,
      ...(overrides.policyResolver === undefined ? {} : { policyResolver: overrides.policyResolver }),
    }),
  };
}

function makeAssembly(
  agentId: RequestRun['agentId'],
  agentVersion: RequestRun['agentVersion'],
  overrides: Partial<AgentAssembly> = {},
): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: `${agentId}:${agentVersion}`,
    displayName: 'Routing Constraint Budget Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
    ...overrides,
  };
}

function makePluginRoutingPolicy(decide: AgentPolicyResolution<'agentRoutingPolicy'>['executable']['decide']): {
  readonly assembly: AgentAssembly;
  readonly policyResolver: AgentPolicyResolverPort;
} {
  const run = makeRun();
  const assembly = makeAssembly(run.agentId, run.agentVersion, {
    policies: [
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId: 'telecom-routing',
        policyId: 'test-routing',
        enabled: true,
      },
    ],
  });
  const activation = assembly.policies![0]!;
  return {
    assembly,
    policyResolver: {
      resolve: vi.fn(async (request) => ({
        assembly,
        activation,
        policy: {
          policyPointId: request.policyPointId,
          policyId: activation.policyId,
          decide,
        },
        executable: { decide },
      })),
    },
  };
}

function makeContextAssembly(context: RequestContext): ContextAssembly {
  return {
    request: {
      sessionId: context.sessionId,
      requestId: context.requestId,
      requestContextId: context.requestContextId,
      identityContext: context.identityContext,
      agentId: context.agentId,
      agentVersion: context.agentVersion,
      runId: context.runId,
      stepId: 'turn-1',
      locale: context.locale,
      purpose: 'minimal-question-answer',
    },
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

function makeRunState(): AgentRunStatePort & { readonly events: RunTimelineEvent[] } {
  const events: RunTimelineEvent[] = [];
  return {
    events,
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-routing-constraint-budget')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}
