import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { PluginRuntimeServices } from '@nextagent/agent-plugin-sdk';
import { createAgentPolicyResolver } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';
import { agentRouterPluginId, agentRouterPolicyId, createAgentRouterPlugin } from '../../packages/agent-plugin-sdk/src/agent-router-plugin.js';

describe('agent-router-plugin policy contract', () => {
  it('materializes configured selection through the existing policy registry', async () => {
    const assembly = makeAssembly({ selectionMode: 'WORKFLOW', ragPrefilter: { topK: 3 } });
    const resolver = createResolver(assembly);
    const resolution = await resolver.resolve({
      agentId: assembly.agentId,
      agentVersion: assembly.agentVersion,
      agentAssemblyRef: assembly.agentAssemblyRef,
      policyPointId: 'agentRoutingPolicy',
    });
    await expect(resolution?.executable.decide(makeRun(), makeContext(), AbortSignal.timeout(100))).resolves.toEqual({
      kind: 'MODEL_DRIVEN_LOOP',
      safeReason: 'AGENT_ROUTER_PLUGIN_NO_MATCH',
    });
    expect(resolution?.executable.decide.length).toBe(3);
  });

  it('defaults to SKILL_OR_WORKFLOW and rejects invalid configured bounds at startup', async () => {
    const assembly = makeAssembly({});
    const resolution = await createResolver(assembly).resolve({
      agentId: assembly.agentId,
      agentVersion: assembly.agentVersion,
      agentAssemblyRef: assembly.agentAssemblyRef,
      policyPointId: 'agentRoutingPolicy',
    });
    await expect(resolution?.executable.decide(makeRun(), makeContext(), AbortSignal.timeout(100))).resolves.toMatchObject({
      safeReason: 'AGENT_ROUTER_PLUGIN_NO_MATCH',
    });

    expect(() => createResolver(makeAssembly({ ragPrefilter: { topK: 11 } }))).toThrow('Plugin policy config is invalid');
  });
});

function createResolver(assembly: AgentAssembly) {
  const plugin = createAgentRouterPlugin(runtimeServices(assembly));
  const assemblyRegistry: AgentAssemblyRegistry = {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
  return createAgentPolicyResolver({
    assemblyRegistry,
    assemblies: [assembly],
    policyContributions: plugin.policies!.map((policy) => ({ pluginId: plugin.pluginId, policy })),
  });
}

function runtimeServices(assembly: AgentAssembly): PluginRuntimeServices {
  return {
    agentAssemblies: { active: vi.fn(async () => assembly), require: vi.fn(async () => assembly) },
    capabilityCatalog: { listAvailable: vi.fn(async () => []), resolve: vi.fn(async () => undefined) },
    capabilityInvocation: { invoke: vi.fn() as never },
    modelSelection: { select: vi.fn() as never },
    modelInvocation: { complete: vi.fn() as never, stream: vi.fn() as never },
    promptTemplates: { resolve: vi.fn() as never },
  };
}

function makeRun() {
  return {
    runId: brand<string, 'RequestRunId'>('run-router-plugin'),
    sessionId: brand<string, 'SessionId'>('session-router-plugin'),
    requestId: brand<string, 'MessageId'>('request-router-plugin'),
    agentId: brand<string, 'AgentId'>('agent-router-plugin'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-router-plugin:v1',
    attempt: 1,
    status: 'EXECUTING' as const,
    version: 1,
    terminalCommitState: 'NOT_STARTED' as const,
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext() {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-router-plugin'),
    sessionId: brand<string, 'SessionId'>('session-router-plugin'),
    requestId: brand<string, 'MessageId'>('request-router-plugin'),
    runId: brand<string, 'RequestRunId'>('run-router-plugin'),
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant'),
      subjectId: brand<string, 'SubjectId'>('subject'),
      displayName: 'Router Contract',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('agent-router-plugin'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-router-plugin:v1',
    acceptedInputText: 'route',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE' as const,
    toolCallStates: [],
    flowVariables: {},
    agentTurnIndex: 0,
  };
}

function makeAssembly(config: JsonObject): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent-router-plugin'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-router-plugin:v1',
    displayName: 'Router Agent',
    description: 'Router Agent',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['router-model'],
    capabilityBindings: [],
    policies: [
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId: agentRouterPluginId,
        policyId: agentRouterPolicyId,
        enabled: true,
        config,
      },
    ],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: {},
  };
}
