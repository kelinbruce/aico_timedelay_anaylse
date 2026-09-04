import { expect, it } from 'vitest';
import { brand } from '@nextagent/agent-common';
import type { ModelProfile } from '@nextagent/agent-contracts/app';
import type { AgentDefinition } from '../../packages/agent-app/src/assembly/agent-definition.js';
import { compileAgentAssembly, validateStartupAgentAssemblyGraph } from '../../packages/agent-app/src/assembly/agent-assembly-compiler.js';
import type { DefaultSystemConfig } from '../../packages/agent-app/src/config/component-config.js';
import { describeRealModelSmoke } from './system-smoke-helpers.js';

describeRealModelSmoke('plugin policy activation', () => {
  it('compiles implementation-free AgentAssembly policies and validates registry membership', () => {
    const agentDefinition = definition();
    const assembly = compileAgentAssembly({
      systemConfig: systemConfig(),
      agentDefinition,
      resourceReferences: {
        capabilityProviders: [],
        lifecycleHookDefinitions: [],
        pluginPolicies: [pluginPolicy()],
      },
    });

    expect(assembly.policies).toEqual([
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId: 'telecom',
        policyId: 'route-alarms',
        enabled: true,
      },
    ]);
    expect(JSON.stringify(assembly.policies)).not.toMatch(/evaluate|function|path|registry/u);
    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig: systemConfig(),
        assemblies: [assembly],
        resourceReferences: {
          capabilityProviders: [],
          lifecycleHookDefinitions: [],
          pluginPolicies: [pluginPolicy()],
        },
      }),
    ).not.toThrow();
  });

  it('fails closed when the policy implementation is unavailable', () => {
    const assembly = compileAgentAssembly({
      systemConfig: systemConfig(),
      agentDefinition: definition(),
      resourceReferences: {
        capabilityProviders: [],
        lifecycleHookDefinitions: [],
        pluginPolicies: [],
      },
    });

    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig: systemConfig(),
        assemblies: [assembly],
        resourceReferences: {
          capabilityProviders: [],
          lifecycleHookDefinitions: [],
          pluginPolicies: [],
        },
      }),
    ).toThrow('Unregistered plugin policy');
  });
});

function definition(): AgentDefinition {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('telecom'),
    agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
    displayName: 'Default',
    description: 'Default telecom agent.',
    modelIds: ['default'],
    capabilityBindings: [],
    policies: [{ policyPointId: 'agentRoutingPolicy', pluginId: 'telecom', policyId: 'route-alarms', enabled: true }],
    runtimeSettings: {},
    resources: [],
  };
}

function systemConfig(): DefaultSystemConfig {
  return {
    activeAgentId: brand<string, 'AgentId'>('default-agent'),
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        models: [modelProfile()],
      },
    ],
  } as unknown as DefaultSystemConfig;
}

function modelProfile(): ModelProfile {
  return {
    modelId: 'default',
    displayName: 'test',
    contextWindowTokens: 128_000,
    fallbackEligible: false,
  };
}

function pluginPolicy() {
  return {
    pluginId: 'telecom',
    policy: {
      policyPointId: 'agentRoutingPolicy' as const,
      policyId: 'route-alarms',
      decide() {
        return { kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'test' };
      },
    },
  };
}
