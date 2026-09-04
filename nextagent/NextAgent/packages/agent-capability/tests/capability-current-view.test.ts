import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCurrentDiscoveryCriteria, CapabilityDescriptor, CapabilityDiscovery } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

import { createStaticCapabilityCatalog } from '../src/catalog/catalog.js';

const tenantId = brand<string, 'TenantId'>('tenant-current-view');
const subjectId = brand<string, 'SubjectId'>('subject-current-view');
const sessionId = brand<string, 'SessionId'>('session-current-view');

describe('CapabilityCurrentViewPort', () => {
  it('combines EAGER and SEARCH current facts through existing binding, disabled, availability, and wrapper-target governance', async () => {
    const listCurrent = vi.fn(async () => [
      descriptor('workflow-z', 'WORKFLOW', 'local-recipes', 'LOCAL_DIRECTORY', { modelInvocable: false }),
      descriptor('disabled-skill', 'SKILL', 'local-skills-agent-owned', 'LOCAL_DIRECTORY'),
    ]);
    const catalog = createStaticCapabilityCatalog(
      [
        descriptor('Read', 'TOOL', 'builtin-tools', 'BUNDLED'),
        descriptor('offline-tool', 'TOOL', 'builtin-tools', 'BUNDLED', { availabilityStatus: 'UNAVAILABLE' }),
        descriptor('network-agent', 'AGENT', 'builtin-agents', 'BUNDLED', { modelInvocable: false }),
      ],
      { searchDiscoveries: [searchDiscovery('local-recipes', listCurrent)] },
    );

    const result = await readCatalogCurrent(
      catalog,
      assembly([
        binding('network-agent', 'AGENT', 'builtin-agents'),
        binding('workflow-z', 'WORKFLOW', 'local-recipes'),
        { ...binding('disabled-skill', 'SKILL', 'local-skills-agent-owned'), enabled: false },
      ]),
    );

    expect(result.map(key)).toEqual(['AGENT:network-agent', 'TOOL:Read', 'WORKFLOW:workflow-z']);
    expect(result).not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'offline-tool' })]));
    expect(result).not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'disabled-skill' })]));
    expect(listCurrent).toHaveBeenCalledTimes(1);
    expect(listCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, subjectId, sessionId, agentId: 'agent-current-view' }),
      expect.any(AbortSignal),
    );
  });

  it('reads EAGER current facts without invoking listAll', async () => {
    const listAll = vi.fn(async () => {
      throw new Error('presentation current view must not call listAll');
    });
    const listCurrent = vi.fn(async () => [descriptor('Read', 'TOOL', 'builtin-tools', 'BUNDLED')]);
    const eagerDiscovery: CapabilityDiscovery = {
      provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
      discoveryMode: 'EAGER',
      listAll,
      listCurrent,
    };
    const catalog = createStaticCapabilityCatalog([], { eagerDiscoveries: [eagerDiscovery] });

    await expect(readCatalogCurrent(catalog, assembly([]))).resolves.toEqual([expect.objectContaining({ capabilityId: 'Read' })]);
    expect(listCurrent).toHaveBeenCalledTimes(1);
    expect(listAll).not.toHaveBeenCalled();
  });

  it('returns only the existing governed priority winner and excludes losers', async () => {
    const catalog = createStaticCapabilityCatalog(
      [descriptor('shared-skill', 'SKILL', 'builtin-skills', 'BUNDLED', { displayName: 'Bundled skill' })],
      {
        searchDiscoveries: [
          searchDiscovery('local-skills-agent-owned', async () => [
            descriptor('shared-skill', 'SKILL', 'local-skills-agent-owned', 'LOCAL_DIRECTORY', { displayName: 'Agent-owned skill' }),
          ]),
        ],
      },
    );

    await expect(readCatalogCurrent(catalog, assembly([binding('shared-skill', 'SKILL', 'local-skills-agent-owned')]))).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'shared-skill', displayName: 'Agent-owned skill' }),
    ]);
  });

  it('sorts winners deterministically by kind and capabilityId', async () => {
    const catalog = createStaticCapabilityCatalog([
      descriptor('z-tool', 'TOOL', 'builtin-tools', 'BUNDLED'),
      descriptor('a-tool', 'TOOL', 'builtin-tools', 'BUNDLED'),
      descriptor('b-agent', 'AGENT', 'builtin-agents', 'BUNDLED'),
    ]);

    const result = await readCatalogCurrent(catalog, assembly([binding('b-agent', 'AGENT', 'builtin-agents')]));

    expect(result.map(key)).toEqual(['AGENT:b-agent', 'TOOL:a-tool', 'TOOL:z-tool']);
  });

  it('fails the complete view when an active SEARCH Provider has no current reader and never calls search', async () => {
    const search = vi.fn(async () => [descriptor('remote-skill', 'SKILL', 'remote-skills', 'SKILL_HUB')]);
    const discovery: CapabilityDiscovery = {
      provider: { providerId: 'remote-skills', providerKind: 'SKILL_HUB' },
      discoveryMode: 'SEARCH',
      search,
    };
    const catalog = createStaticCapabilityCatalog([], {
      searchDiscoveries: [discovery],
      skillHubSourceAuthorization: () => true,
    });

    await expect(readCatalogCurrent(catalog, assembly([binding('remote-skill', 'SKILL', 'remote-skills')]))).rejects.toThrow(
      'Capability current view is unavailable.',
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects the whole view when one current reader fails instead of returning partial EAGER winners', async () => {
    const providerFailure = new Error('provider-private failure');
    const catalog = createStaticCapabilityCatalog([descriptor('Read', 'TOOL', 'builtin-tools', 'BUNDLED')], {
      searchDiscoveries: [
        searchDiscovery('local-skills-agent-owned', async () => {
          throw providerFailure;
        }),
      ],
    });

    await expect(readCatalogCurrent(catalog, assembly([binding('skill-a', 'SKILL', 'local-skills-agent-owned')]))).rejects.toMatchObject({
      message: 'Capability current view is unavailable.',
      cause: providerFailure,
    });
  });
});

function readCatalogCurrent(
  catalog: ReturnType<typeof createStaticCapabilityCatalog>,
  agentAssembly: AgentAssembly,
): Promise<readonly CapabilityDescriptor[]> {
  const operation = (
    catalog as typeof catalog & {
      listCurrent?: (
        request: { tenantId: typeof tenantId; subjectId: typeof subjectId; sessionId: typeof sessionId; agentAssembly: AgentAssembly },
        signal: AbortSignal,
      ) => Promise<readonly CapabilityDescriptor[]>;
    }
  ).listCurrent;
  if (operation === undefined) {
    return Promise.reject(new Error('Capability current view is unavailable.'));
  }
  return operation.call(catalog, { tenantId, subjectId, sessionId, agentAssembly }, new AbortController().signal);
}

function searchDiscovery(
  providerId: string,
  listCurrent: (criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>,
): CapabilityDiscovery {
  return {
    provider: {
      providerId,
      providerKind: providerId === 'remote-skills' ? 'SKILL_HUB' : 'LOCAL_DIRECTORY',
    },
    discoveryMode: 'SEARCH',
    async search() {
      throw new Error('presentation current view must not call search');
    },
    listCurrent,
  };
}

function descriptor(
  capabilityId: string,
  kind: CapabilityDescriptor['kind'],
  providerId: string,
  providerKind: CapabilityDescriptor['provider']['providerKind'],
  overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind,
    provider: { providerId, providerKind },
    displayName: capabilityId,
    description: `${capabilityId} test capability.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    ...overrides,
  };
}

function binding(capabilityId: string, capabilityType: CapabilityDescriptor['kind'], providerId: string) {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    capabilityType,
    providerId,
    enabled: true,
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings']): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent-current-view'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-current-view:v1',
    displayName: 'Current view agent',
    description: 'Current view test Agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' }],
    },
    modelIds: ['test-model'],
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1_000 },
  };
}

function key(value: CapabilityDescriptor): string {
  return `${value.kind}:${value.capabilityId}`;
}
