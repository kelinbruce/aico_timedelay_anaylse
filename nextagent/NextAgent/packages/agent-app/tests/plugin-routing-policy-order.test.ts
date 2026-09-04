import { brand, type AgentId, type AgentVersion, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { AgentPolicyResolverPort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { createAgentPolicyResolver } from '@nextagent/agent-runtime';
import type { AgentRoutingPolicy } from '@nextagent/agent-plugin-sdk';
import { describe, expect, it } from 'vitest';
import type { PluginRegistrySnapshot } from '../src/plugin/plugin-loader.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const agentAssemblyRef = 'assembly:default-agent:v1';

describe('plugin-aware routing policy order', () => {
  it('materializes an activated plugin routing policy for the accepted Agent scope', async () => {
    const policyResolver = createTestAgentPolicyResolver({
      assemblyRegistry: assemblyRegistry(assemblyWithPluginPolicy()),
      pluginRegistrySnapshot: {
        plugins: Object.freeze([{ pluginId: 'telecom-routing', version: '1.0.0' }]),
        providers: Object.freeze([]),
        policies: Object.freeze([{ pluginId: 'telecom-routing', policy: allowingPolicy() }]),
        hooks: Object.freeze([]),
        diagnostics: Object.freeze([]),
      },
    });

    const resolution = await policyResolver.resolve({
      agentId,
      agentVersion,
      agentAssemblyRef,
      policyPointId: 'agentRoutingPolicy',
    });
    const decision = await resolution!.executable.decide(requestRun(), requestContext(), new AbortController().signal);

    expect(resolution).toMatchObject({
      activation: { policyId: 'allow' },
      assembly: { agentId, agentVersion, agentAssemblyRef },
    });
    expect(decision).toMatchObject({
      kind: 'MODEL_DRIVEN_LOOP',
      safeReason: 'PLUGIN_ROUTING_ALLOWED',
    });
  });

  it('resolves plugin policies by accepted Agent scope and policy point', async () => {
    const firstAgentId = brand<string, 'AgentId'>('first-agent');
    const secondAgentId = brand<string, 'AgentId'>('second-agent');
    const registry = createAgentPolicyResolver({
      assemblyRegistry: assemblyRegistry(
        assemblyWithPluginPolicy({ agentId: firstAgentId, agentAssemblyRef: 'assembly:first-agent:v1', policyId: 'allow-first' }),
        assemblyWithPluginPolicy({ agentId: secondAgentId, agentAssemblyRef: 'assembly:second-agent:v1', policyId: 'allow-second' }),
      ),
      policyContributions: Object.freeze([
        { pluginId: 'telecom-routing', policy: allowingPolicy('allow-first') },
        { pluginId: 'telecom-routing', policy: allowingPolicy('allow-second') },
      ]),
    });

    await expect(
      registry.resolve({
        agentId: firstAgentId,
        agentVersion,
        agentAssemblyRef: 'assembly:first-agent:v1',
        policyPointId: 'agentRoutingPolicy',
      }),
    ).resolves.toMatchObject({
      activation: { policyId: 'allow-first' },
      assembly: { agentId: firstAgentId, agentAssemblyRef: 'assembly:first-agent:v1' },
    });
    await expect(
      registry.resolve({
        agentId: secondAgentId,
        agentVersion,
        agentAssemblyRef: 'assembly:second-agent:v1',
        policyPointId: 'agentRoutingPolicy',
      }),
    ).resolves.toMatchObject({
      activation: { policyId: 'allow-second' },
      assembly: { agentId: secondAgentId, agentAssemblyRef: 'assembly:second-agent:v1' },
    });
  });

  it('rejects invalid assembly-specific policy config during startup materialization', () => {
    const configuredAssembly = assemblyWithPluginPolicy({ config: { safeReason: 42 } });

    expect(() =>
      createTestAgentPolicyResolver({
        assemblyRegistry: assemblyRegistry(configuredAssembly),
        agentAssemblies: [configuredAssembly],
        pluginRegistrySnapshot: {
          plugins: Object.freeze([{ pluginId: 'telecom-routing', version: '1.0.0' }]),
          providers: Object.freeze([]),
          policies: Object.freeze([{ pluginId: 'telecom-routing', policy: configuredPolicy() }]),
          hooks: Object.freeze([]),
          diagnostics: Object.freeze([]),
        },
      }),
    ).toThrow('Plugin policy config is invalid');
  });

  it('uses assembly-specific configured policy executables', async () => {
    const configuredAssembly = assemblyWithPluginPolicy({ config: { safeReason: 'PLUGIN_ROUTING_CONFIGURED' } });
    const policyResolver = createTestAgentPolicyResolver({
      assemblyRegistry: assemblyRegistry(configuredAssembly),
      agentAssemblies: [configuredAssembly],
      pluginRegistrySnapshot: {
        plugins: Object.freeze([{ pluginId: 'telecom-routing', version: '1.0.0' }]),
        providers: Object.freeze([]),
        policies: Object.freeze([{ pluginId: 'telecom-routing', policy: configuredPolicy() }]),
        hooks: Object.freeze([]),
        diagnostics: Object.freeze([]),
      },
    });

    const resolution = await policyResolver.resolve({
      agentId,
      agentVersion,
      agentAssemblyRef,
      policyPointId: 'agentRoutingPolicy',
    });

    const decision = await Promise.resolve(resolution!.executable.decide(requestRun(), requestContext(), new AbortController().signal));

    expect(decision).toMatchObject({
      kind: 'MODEL_DRIVEN_LOOP',
      safeReason: 'PLUGIN_ROUTING_CONFIGURED',
    });
  });
});

function createTestAgentPolicyResolver(input: {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly agentAssemblies?: readonly AgentAssembly[];
  readonly pluginRegistrySnapshot: PluginRegistrySnapshot;
}): AgentPolicyResolverPort {
  return createAgentPolicyResolver({
    assemblyRegistry: input.assemblyRegistry,
    ...(input.agentAssemblies === undefined ? {} : { assemblies: input.agentAssemblies }),
    policyContributions: input.pluginRegistrySnapshot.policies,
  });
}

function allowingPolicy(policyId = 'allow'): AgentRoutingPolicy {
  return {
    policyPointId: 'agentRoutingPolicy',
    policyId,
    decide(_run, context) {
      expect(context.acceptedInputText).toBe('plugin policy should run first');
      return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'PLUGIN_ROUTING_ALLOWED' };
    },
  };
}

function configuredPolicy(): AgentRoutingPolicy {
  return {
    policyPointId: 'agentRoutingPolicy',
    policyId: 'allow',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['safeReason'],
      properties: {
        safeReason: { type: 'string' },
      },
    },
    configure(config) {
      const safeReason = String(config['safeReason']);
      return {
        decide() {
          return { kind: 'MODEL_DRIVEN_LOOP', safeReason };
        },
      };
    },
    decide() {
      return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'PLUGIN_ROUTING_UNCONFIGURED' };
    },
  };
}

function assemblyWithPluginPolicy(
  overrides: {
    readonly agentId?: AgentId;
    readonly agentVersion?: AgentVersion;
    readonly agentAssemblyRef?: string;
    readonly policyPointId?: string;
    readonly policyId?: string;
    readonly config?: JsonObject;
  } = {},
): AgentAssembly {
  const resolvedAgentId = overrides.agentId ?? agentId;
  const resolvedAgentVersion = overrides.agentVersion ?? agentVersion;
  return {
    agentId: resolvedAgentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: resolvedAgentVersion,
    agentAssemblyRef: overrides.agentAssemblyRef ?? agentAssemblyRef,
    displayName: 'Default Agent',
    description: 'Default test agent.',
    workspacePolicy: { schemaVersion: 'nextagent.agent-workspace-policy.v1', isolationMode: 'subject', roots: [] },
    modelIds: ['test-model'],
    capabilityBindings: [],
    policies: [
      {
        policyPointId: overrides.policyPointId ?? 'agentRoutingPolicy',
        pluginId: 'telecom-routing',
        policyId: overrides.policyId ?? 'allow',
        enabled: true,
        ...(overrides.config === undefined ? {} : { config: overrides.config }),
      },
    ],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
  };
}

function assemblyRegistry(...assemblies: readonly AgentAssembly[]): AgentAssemblyRegistry {
  return {
    async active(agentId) {
      return resolveAssembly(assemblies, agentId, undefined);
    },
    async require(agentId, agentVersion) {
      return resolveAssembly(assemblies, agentId, agentVersion);
    },
  };
}

function resolveAssembly(assemblies: readonly AgentAssembly[], requestedAgentId: AgentId, requestedVersion?: AgentVersion): AgentAssembly {
  const assembly = assemblies.find(
    (item) => item.agentId === requestedAgentId && (requestedVersion === undefined || item.agentVersion === requestedVersion),
  );
  if (assembly === undefined) {
    throw new Error('Test assembly is unavailable.');
  }
  return assembly;
}

function requestRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-plugin-order'),
    sessionId: brand<string, 'SessionId'>('session-plugin-order'),
    requestId: brand<string, 'MessageId'>('request-plugin-order'),
    agentId,
    agentVersion,
    agentAssemblyRef,
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function requestContext(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-plugin-order'),
    sessionId: brand<string, 'SessionId'>('session-plugin-order'),
    requestId: brand<string, 'MessageId'>('request-plugin-order'),
    runId: brand<string, 'RequestRunId'>('run-plugin-order'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-plugin-order'),
      subjectId: brand<string, 'SubjectId'>('subject-plugin-order'),
      displayName: 'Plugin order tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    acceptedInputText: 'plugin policy should run first',
    agentId,
    agentVersion,
    agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_AGENT_TERMINAL',
    toolCallStates: [],
    flowVariables: {},
  };
}
