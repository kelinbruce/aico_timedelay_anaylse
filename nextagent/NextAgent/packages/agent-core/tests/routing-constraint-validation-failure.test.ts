import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('routing constraint validation failure', () => {
  it('fails closed when a constraint governance dependency is unavailable instead of silently dropping the constraint', async () => {
    const harness = makeHarness();

    await expect(harness.agent.execute(harness.run, harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE',
      category: 'UNAVAILABLE',
    });
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
  });
});

function makeHarness() {
  const run = makeRun();
  const context = makeContext(run);
  const assembly = makeAssembly(run);
  const capabilityCatalog: CapabilityCatalog = {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(async ({ capabilityId }) => {
      if (capabilityId === 'alarm-diagnosis') {
        throw new Error('capability governance unavailable');
      }
      return undefined;
    }),
  };
  const model = makeModel();
  const capabilityInvocation = makeCapabilityInvocation();
  return {
    run,
    context,
    model,
    capabilityInvocation,
    agent: new DefaultAgent({
      contextEngine: makeContextEngine(),
      model,
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState: makeRunState(),
    }),
  };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-constraint-validation-failure'),
    sessionId: brand<string, 'SessionId'>('session-routing-constraint-validation-failure'),
    requestId: brand<string, 'MessageId'>('request-routing-constraint-validation-failure'),
    agentId: brand<string, 'AgentId'>('agent-routing-constraint-validation-failure'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-constraint-validation-failure:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('context-routing-constraint-validation-failure'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-routing-constraint-validation-failure'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-constraint-validation-failure'),
      displayName: 'Routing Constraint Validation Failure',
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
    displayName: 'Routing Constraint Validation Failure Agent',
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

function makeModel(): ModelInvocationService & { readonly stream: ReturnType<typeof vi.fn> } {
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

function makeCapabilityInvocation(): CapabilityInvocationPort & { readonly invoke: ReturnType<typeof vi.fn> } {
  return {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  };
}

function makeRunState(): AgentRunStatePort {
  return {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async () => undefined),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-routing-constraint-validation-failure')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}
