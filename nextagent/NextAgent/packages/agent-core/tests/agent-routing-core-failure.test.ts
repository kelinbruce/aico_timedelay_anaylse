import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-routing-core-failure');
const subjectId = brand<string, 'SubjectId'>('subject-routing-core-failure');
const agentId = brand<string, 'AgentId'>('agent-routing-core-failure');
const agentVersion = brand<string, 'AgentVersion'>('v1');

describe('agent routing core failure handling', () => {
  it('fails closed when frozen assembly lookup is unavailable and never falls back to active()', async () => {
    const active = vi.fn(async () => {
      throw new AgentError({
        code: 'ACTIVE_FALLBACK_FORBIDDEN',
        message: 'active() must not be used in routing.',
        category: 'INTERNAL',
        retryable: false,
      });
    });
    const require = vi.fn(async () => {
      throw new AgentError({ code: 'ASSEMBLY_MISSING', message: 'missing', category: 'UNAVAILABLE', retryable: true });
    });
    const harness = makeHarness({
      assemblyRegistry: { active, require },
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_ASSEMBLY_UNAVAILABLE',
    });
    expect(active).not.toHaveBeenCalled();
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
  });

  it('fails closed when the capability governance view is unavailable', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => {
          throw new AgentError({ code: 'CATALOG_UNAVAILABLE', message: 'catalog missing', category: 'UNAVAILABLE', retryable: true });
        }),
        resolve: vi.fn(async () => undefined),
      },
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_CAPABILITY_VIEW_UNAVAILABLE',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
  });
});

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-core-failure'),
    sessionId: brand<string, 'SessionId'>('session-routing-core-failure'),
    requestId: brand<string, 'MessageId'>('request-routing-core-failure'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-routing-core-failure:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-routing-core-failure'),
    sessionId: brand<string, 'SessionId'>('session-routing-core-failure'),
    requestId: brand<string, 'MessageId'>('request-routing-core-failure'),
    runId: brand<string, 'RequestRunId'>('run-routing-core-failure'),
    agentTurnIndex: 0,
    identityContext: { tenantId, subjectId, displayName: 'Routing Core Failure' },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-routing-core-failure:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function makeHarness(
  overrides: {
    assemblyRegistry?: AgentAssemblyRegistry;
    capabilityCatalog?: CapabilityCatalog;
  } = {},
) {
  const assembly = {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: 'agent-routing-core-failure:v1',
    displayName: 'Routing Core Failure Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject' as const, roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
  } satisfies AgentAssembly;
  const assemblyRegistry: AgentAssemblyRegistry = overrides.assemblyRegistry ?? {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
  const capabilityCatalog = overrides.capabilityCatalog ?? {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
  };
  const contextEngine = {
    assemble: vi.fn(async () => {
      throw new Error('should not assemble');
    }),
    render: vi.fn(async () => {
      throw new Error('should not render');
    }),
  } satisfies ContextEnginePort;
  const model = {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* () {
        yield { content: '', finishReason: 'stop' };
      }),
    ),
  } satisfies ModelInvocationService;
  const runState: AgentRunStatePort = {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async () => undefined),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-routing-core-failure')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
  const capabilityInvocation: CapabilityInvocationPort = {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  };

  return {
    agent: new DefaultAgent({
      contextEngine,
      model,
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry,
      runState,
    }),
    contextEngine,
  };
}
