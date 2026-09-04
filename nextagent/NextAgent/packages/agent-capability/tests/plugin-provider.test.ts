import { brand } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityProviderIdentity, CapabilitySearchCriteria } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';
import { assembleCapabilityProviders } from '../src/extension-registration.js';

describe('plugin provider', () => {
  it('keeps non-Tool descriptors from plugin providers unavailable through the unified provider wrapper', async () => {
    const provider: CapabilityProviderIdentity = {
      providerId: 'telecom.plugin',
      providerKind: 'CUSTOM',
      providerType: 'nextagent-plugin-tool',
    };
    const snapshot = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: {
          provider,
          discoveryMode: 'EAGER',
          async listAll() {
            return [agentDescriptor('plugin-agent', provider)];
          },
        },
      },
    ]);

    const diagnostics = await snapshot.validateStartupRegistration(new AbortController().signal);
    const descriptors = await snapshot.eagerDiscoveries[0]!.listAll!(new AbortController().signal);

    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'plugin-agent',
        availabilityStatus: 'UNAVAILABLE',
        availabilityReason: 'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED',
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED',
        providerId: 'telecom.plugin',
        capabilityId: 'plugin-agent',
        summary: 'Plugin provider descriptor kind is unsupported.',
      },
    ]);
  });

  it('maps plugin SEARCH discovery throw and timeout to safe diagnostics', async () => {
    const throwingProvider = pluginProvider('telecom.throwing');
    const timeoutProvider = pluginProvider('telecom.timeout');
    const snapshot = assembleCapabilityProviders([
      {
        identity: throwingProvider,
        discovery: {
          provider: throwingProvider,
          discoveryMode: 'SEARCH',
          async search() {
            throw new Error('raw provider token=secret');
          },
        },
      },
      {
        identity: timeoutProvider,
        discovery: {
          provider: timeoutProvider,
          discoveryMode: 'SEARCH',
          async search() {
            return await new Promise<readonly CapabilityDescriptor[]>(() => undefined);
          },
        },
      },
    ]);

    await expect(snapshot.searchDiscoveries[0]!.search!(criteria(), new AbortController().signal)).resolves.toEqual([]);
    await expect(snapshot.searchDiscoveries[1]!.search!(criteria(), new AbortController().signal)).resolves.toEqual([]);

    expect(snapshot.diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'DISCOVERY_FAILED',
        providerId: 'telecom.throwing',
        summary: 'Capability discovery failed.',
      },
      {
        severity: 'WARNING',
        reasonCode: 'DISCOVERY_TIMED_OUT',
        providerId: 'telecom.timeout',
        summary: 'Capability discovery timed out.',
      },
    ]);
    expect(JSON.stringify(snapshot.diagnostics)).not.toContain('token=secret');
  }, 7_000);

  it('applies unified dependency and config validation to plugin Tool descriptors', async () => {
    const provider = pluginProvider('telecom.governed');
    const snapshot = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: {
          provider,
          discoveryMode: 'EAGER',
          async listAll() {
            return [
              toolDescriptor('needs-sandbox', provider, { requiredDependencies: ['sandbox'] }),
              toolDescriptor('bad-config', provider, {
                configSchema: { type: 'object', additionalProperties: false, required: ['region'], properties: { region: { type: 'string' } } },
                config: {},
              }),
            ];
          },
        },
        executor: {
          capabilityKinds: ['TOOL'],
          async invoke() {
            throw new Error('not reached');
          },
        },
      },
    ]);

    const diagnostics = await snapshot.validateStartupRegistration(new AbortController().signal);
    const descriptors = await snapshot.eagerDiscoveries[0]!.listAll!(new AbortController().signal);

    expect(descriptors).toEqual([
      expect.objectContaining({ capabilityId: 'needs-sandbox', availabilityStatus: 'UNAVAILABLE', availabilityReason: 'TOOL_DEPENDENCY_MISSING' }),
      expect.objectContaining({ capabilityId: 'bad-config', availabilityStatus: 'UNAVAILABLE', availabilityReason: 'TOOL_CONFIG_INVALID' }),
    ]);
    expect(diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'TOOL_DEPENDENCY_MISSING',
        providerId: 'telecom.governed',
        capabilityId: 'needs-sandbox',
        summary: 'Tool dependency is unavailable.',
      },
      {
        severity: 'ERROR',
        reasonCode: 'TOOL_CONFIG_INVALID',
        providerId: 'telecom.governed',
        capabilityId: 'bad-config',
        summary: 'Tool configuration is invalid.',
      },
    ]);
  });
});

function pluginProvider(providerId: string): CapabilityProviderIdentity {
  return {
    providerId,
    providerKind: 'CUSTOM',
    providerType: 'nextagent-plugin-tool',
  };
}

function agentDescriptor(capabilityId: string, provider: CapabilityProviderIdentity): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'AGENT',
    provider,
    displayName: capabilityId,
    description: `${capabilityId} descriptor.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function toolDescriptor(capabilityId: string, provider: CapabilityProviderIdentity, metadata = {}): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider,
    displayName: capabilityId,
    description: `${capabilityId} descriptor.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    metadata,
  };
}

function criteria(): CapabilitySearchCriteria {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-plugin'),
    subjectId: brand<string, 'SubjectId'>('subject-plugin'),
    agentId: brand<string, 'AgentId'>('agent-plugin'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-plugin:v1',
  };
}
