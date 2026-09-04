import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('agent routing core security boundaries', () => {
  it('uses frozen run agentId/agentVersion for routing authority instead of untrusted request-local data', async () => {
    const run = makeRun();
    const context = makeContext();
    const require = vi.fn(async (agentId, agentVersion) => makeAssembly(agentId, agentVersion));
    const capabilityCatalog: CapabilityCatalog = {
      listAvailable: vi.fn(async () => []),
      resolve: vi.fn(async () => undefined),
    };
    const contextEngine = {
      assemble: vi.fn(async () => {
        throw new Error('stop after routing');
      }),
      render: vi.fn(async () => {
        throw new Error('not used');
      }),
    } satisfies ContextEnginePort;
    const agent = new DefaultAgent({
      contextEngine,
      model: makeModel(),
      capabilityCatalog,
      capabilityInvocation: makeCapabilityInvocation(),
      assemblyRegistry: {
        active: vi.fn(async () => makeAssembly(run.agentId, run.agentVersion)),
        require,
      },
      runState: makeRunState(),
    });

    await expect(agent.execute(run, context, new AbortController().signal)).rejects.toBeDefined();

    expect(require).toHaveBeenCalledWith(run.agentId, run.agentVersion);
    expect(require).not.toHaveBeenCalledWith(brand<string, 'AgentId'>('agent-override'), run.agentVersion);
    expect(capabilityCatalog.listAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentAssembly: expect.objectContaining({
          agentId: run.agentId,
          agentVersion: run.agentVersion,
        }),
      }),
    );
  });
});

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-core-security'),
    sessionId: brand<string, 'SessionId'>('session-routing-core-security'),
    requestId: brand<string, 'MessageId'>('request-routing-core-security'),
    agentId: brand<string, 'AgentId'>('agent-routing-core-security'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-core-security:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('context-routing-core-security'),
    sessionId: brand<string, 'SessionId'>('session-routing-core-security'),
    requestId: brand<string, 'MessageId'>('request-routing-core-security'),
    runId: brand<string, 'RequestRunId'>('run-routing-core-security'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-routing-core-security'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-core-security'),
      displayName: 'Routing Core Security',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    routingConstraints: {
      targetSkill: 'alarm-diagnosis',
    },
    agentId: brand<string, 'AgentId'>('agent-routing-core-security'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-core-security:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {
      agentId: 'agent-override',
      providerOverride: 'other-provider',
    },
  };
}

function makeAssembly(agentId: RequestRun['agentId'], agentVersion: RequestRun['agentVersion']): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: `${agentId}:${agentVersion}`,
    displayName: 'Routing Core Security Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
  };
}

function makeModel(): ModelInvocationService {
  return {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* () {
        yield { content: '', finishReason: 'stop' };
      }),
    ),
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

function makeRunState(): AgentRunStatePort {
  return {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async () => undefined),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-routing-core-security')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}
