import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('targeted skill routing observability', () => {
  it('records accepted and selected targeted Skill outcomes as safe routing evidence', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const targetedSkillEvents = harness.runState.events.filter(
      (event) => event.type === 'POLICY_APPLIED' && (event.inlinePayload as Record<string, unknown>).policyDomain === 'TARGETED_SKILL',
    );

    expect(targetedSkillEvents.map((event) => event.inlinePayload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: 'constraint-accepted',
          reasonCode: 'PREFERRED_SKILL_REQUESTED',
          selectedCapabilityId: 'alarm-diagnosis',
        }),
        expect.objectContaining({
          outcome: 'selected',
          reasonCode: 'PREFERRED_SKILL_LOADED',
          selectedCapabilityId: 'alarm-diagnosis',
        }),
      ]),
    );
  });
});

function makeHarness() {
  const run = makeRun();
  const context = makeContext(run);
  const assembly = makeAssembly(run);
  const runState = makeRunState();
  return {
    run,
    context,
    runState,
    agent: new DefaultAgent({
      contextEngine: makeContextEngine(),
      model: makeModel(),
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation: makeCapabilityInvocation(),
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState,
    }),
  };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-targeted-skill-routing-observability'),
    sessionId: brand<string, 'SessionId'>('session-targeted-skill-routing-observability'),
    requestId: brand<string, 'MessageId'>('request-targeted-skill-routing-observability'),
    agentId: brand<string, 'AgentId'>('agent-targeted-skill-routing-observability'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-targeted-skill-routing-observability:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('context-targeted-skill-routing-observability'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-targeted-skill-routing-observability'),
      subjectId: brand<string, 'SubjectId'>('subject-targeted-skill-routing-observability'),
      displayName: 'Targeted Skill Routing Observability',
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
    displayName: 'Targeted Skill Routing Observability Agent',
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

function makeCapabilityCatalog(): CapabilityCatalog {
  return {
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
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-targeted-skill-routing-observability')),
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
