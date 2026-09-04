import { brand } from '@nextagent/agent-common';
import type { ModelProfile } from '@nextagent/agent-contracts/model';
import type { AgentDefinition } from '../src/assembly/agent-definition.js';
import { compileAgentAssembly, validateStartupAgentAssemblyGraph } from '../src/assembly/agent-assembly-compiler.js';
import type { DefaultSystemConfig } from '../src/config/component-config.js';

import { describe, expect, it } from 'vitest';

describe('plugin activation compiler', () => {
  it('compiles Agent policies into implementation-free AgentAssembly binding facts', () => {
    const assembly = compileAgentAssembly({
      systemConfig: systemConfig(),
      agentDefinition: definition(),
      resourceReferences: references(),
    });

    expect(assembly.policies).toEqual([
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId: 'telecom',
        policyId: 'route-alarms',
        enabled: true,
      },
    ]);
    expect(JSON.stringify(assembly.policies)).not.toMatch(/evaluate|function|module|path|registry|configRoot/u);
  });

  it('validates policy plugin, policy id, and policy point references against the frozen plugin registry snapshot', () => {
    const assembly = compileAgentAssembly({
      systemConfig: systemConfig(),
      agentDefinition: definition(),
      resourceReferences: references(),
    });

    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig: systemConfig(),
        assemblies: [assembly],
        resourceReferences: references(),
      }),
    ).not.toThrow();

    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig: systemConfig(),
        assemblies: [assembly],
        resourceReferences: references({ pluginPolicies: [] }),
      }),
    ).toThrow('Unregistered plugin policy');
  });

  it('fails closed for unavailable policy points and duplicate enabled policy implementations', () => {
    const unavailable = compileAgentAssembly({
      systemConfig: systemConfig(),
      agentDefinition: definition({ policies: [{ policyPointId: 'redactionPolicy', pluginId: 'telecom', policyId: 'route-alarms', enabled: true }] }),
      resourceReferences: references(),
    });
    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig: systemConfig(),
        assemblies: [unavailable],
        resourceReferences: references(),
      }),
    ).toThrow('Unavailable policy point');

    const duplicate = compileAgentAssembly({
      systemConfig: systemConfig(),
      agentDefinition: definition({
        policies: [
          { policyPointId: 'agentRoutingPolicy', pluginId: 'telecom', policyId: 'route-alarms', enabled: true },
          { policyPointId: 'agentRoutingPolicy', pluginId: 'telecom', policyId: 'route-backup', enabled: true },
        ],
      }),
      resourceReferences: references({ pluginPolicies: [pluginPolicy('route-alarms'), pluginPolicy('route-backup')] }),
    });
    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig: systemConfig(),
        assemblies: [duplicate],
        resourceReferences: references({ pluginPolicies: [pluginPolicy('route-alarms'), pluginPolicy('route-backup')] }),
      }),
    ).toThrow('Duplicate enabled policy point');
  });
});

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('telecom'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Default telecom agent',
    description: 'Default telecom agent.',
    modelIds: ['test-model'],
    capabilityBindings: [],
    policies: [{ policyPointId: 'agentRoutingPolicy', pluginId: 'telecom', policyId: 'route-alarms', enabled: true }],
    runtimeSettings: {},
    resources: [],
    ...overrides,
  };
}

function references(overrides: Partial<Parameters<typeof validateStartupAgentAssemblyGraph>[0]['resourceReferences']> = {}) {
  return {
    capabilityProviders: [],
    lifecycleHookDefinitions: [],
    pluginPolicies: [pluginPolicy('route-alarms')],
    ...overrides,
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
    modelId: 'test-model',
    contextWindowTokens: 128_000,
    fallbackEligible: false,
  };
}

function pluginPolicy(policyId: string) {
  return {
    pluginId: 'telecom',
    policy: {
      policyPointId: 'agentRoutingPolicy' as const,
      policyId,
      decide() {
        return { kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'test' };
      },
    },
  };
}
