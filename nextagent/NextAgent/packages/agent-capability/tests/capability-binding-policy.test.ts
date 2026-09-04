import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityDescriptor, CapabilityDiscovery, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';
import { StaticCapabilityCatalog } from '../src/catalog/catalog.js';

const tenantId = brand<string, 'TenantId'>('tenant-binding-policy');
const subjectId = brand<string, 'SubjectId'>('subject-binding-policy');
const pluginProvider: CapabilityProviderIdentity = { providerId: 'telecom.ops.tools', providerKind: 'CUSTOM', providerType: 'nextagent-plugin-tool' };

describe('capability binding policy', () => {
  it('keeps plugin EAGER descriptors invisible until exact Agent binding allows them', async () => {
    const catalog = new StaticCapabilityCatalog([tool('lookup-alarm', pluginProvider)]);

    await expect(list(catalog, [])).resolves.toEqual([]);
    await expect(list(catalog, [{ capabilityId: 'lookup-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId }])).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'lookup-alarm', provider: pluginProvider }),
    ]);
    await expect(
      list(catalog, [{ capabilityId: 'lookup-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId, enabled: false }]),
    ).resolves.toEqual([]);
  });

  it('allows framework-owned builtin Tool descriptors by default and lets explicit disabled bindings narrow them', async () => {
    const catalog = new StaticCapabilityCatalog([tool('Read', { providerId: 'builtin-tools', providerKind: 'BUNDLED' })]);

    await expect(list(catalog, [])).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'Read', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
    ]);
    await expect(list(catalog, [{ capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false }])).resolves.toEqual([]);
  });

  it('requires explicit search authority and exact descriptor binding for non-SkillHub custom SEARCH providers', async () => {
    let searchCalls = 0;
    const discovery: CapabilityDiscovery = {
      provider: pluginProvider,
      discoveryMode: 'SEARCH',
      async search() {
        searchCalls += 1;
        return [tool('search-alarm', pluginProvider), tool('other-alarm', pluginProvider)];
      },
    };
    const catalog = new StaticCapabilityCatalog([], { searchDiscoveries: [discovery] });

    await expect(list(catalog, [])).resolves.toEqual([]);
    expect(searchCalls).toBe(0);
    await expect(list(catalog, [{ capabilityId: 'search-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId }])).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'search-alarm', provider: pluginProvider }),
    ]);
    expect(searchCalls).toBe(1);
    await expect(
      list(catalog, [
        { capabilityId: 'search-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId },
        { capabilityId: 'search-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId, enabled: false },
      ]),
    ).resolves.toEqual([]);
  });

  it('fails closed for unknown custom provider types without an OpenSpec-defined binding policy', async () => {
    const unknownProvider: CapabilityProviderIdentity = { providerId: 'unknown.custom', providerKind: 'CUSTOM', providerType: 'unknown' };
    const catalog = new StaticCapabilityCatalog([tool('unknown-tool', unknownProvider)]);

    await expect(list(catalog, [])).resolves.toEqual([]);
  });
});

function list(catalog: StaticCapabilityCatalog, capabilityBindings: AgentAssembly['capabilityBindings']) {
  return catalog.listAvailable({ tenantId, subjectId, agentAssembly: assembly(capabilityBindings), includeUnavailable: false });
}

function tool(capabilityId: string, provider: CapabilityProviderIdentity): CapabilityDescriptor {
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
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings']): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent-binding-policy'),
    agentType: brand<string, 'AgentType'>('telecom'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-binding-policy:v1',
    displayName: 'Binding policy test agent',
    description: 'Binding policy test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}
