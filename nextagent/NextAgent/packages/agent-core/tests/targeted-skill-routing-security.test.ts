import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('targeted skill routing security', () => {
  it('rejects targetSkill when it conflicts with forbiddenCapabilityIds', async () => {
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

  it('does not substitute another Skill when the preferred Skill is not available to the accepted Agent', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'Skill' ? skillToolDescriptor() : undefined)),
      },
    });

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_UNAVAILABLE',
    });
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });
});

function makeHarness(overrides: { context?: Partial<RequestContext>; capabilityCatalog?: CapabilityCatalog } = {}) {
  const run = makeRun();
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-targeted-skill-routing-security'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-targeted-skill-routing-security'),
      subjectId: brand<string, 'SubjectId'>('subject-targeted-skill-routing-security'),
      displayName: 'Targeted Skill Routing Security',
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
    agentTurnIndex: overrides.context?.agentTurnIndex ?? 0,
  };
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
  const capabilityInvocation = {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  } satisfies CapabilityInvocationPort;

  return {
    run,
    context,
    capabilityInvocation,
    agent: new DefaultAgent({
      contextEngine: makeContextEngine(),
      model: makeModel(),
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState: makeRunState(),
    }),
  };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-targeted-skill-routing-security'),
    sessionId: brand<string, 'SessionId'>('session-targeted-skill-routing-security'),
    requestId: brand<string, 'MessageId'>('request-targeted-skill-routing-security'),
    agentId: brand<string, 'AgentId'>('agent-targeted-skill-routing-security'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-targeted-skill-routing-security:v1',
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
    displayName: 'Targeted Skill Routing Security Agent',
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
      modelEventStreamFixture(async function* () {
        yield { content: 'ok', finishReason: 'stop' } as never;
      }),
    ),
  };
}

function makeRunState(): AgentRunStatePort {
  return {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async () => undefined),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-targeted-skill-routing-security')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
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
