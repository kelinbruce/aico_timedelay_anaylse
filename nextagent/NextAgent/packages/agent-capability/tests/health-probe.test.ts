import { brand, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import { createCapabilityCatalogHealthProbe } from '../src/health-probe.js';
import { describe, expect, it, vi } from 'vitest';

describe('createCapabilityCatalogHealthProbe', () => {
  it('performs a scoped catalog read and returns a safe UP result', async () => {
    const identity: IdentityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-health'),
      subjectId: brand<string, 'SubjectId'>('subject-health'),
      displayName: 'health tester',
    };
    const assembly = { agentId: brand<string, 'AgentId'>('agent-health') } as unknown as AgentAssembly;
    const listAvailable = vi.fn(async () => []);
    const probe = createCapabilityCatalogHealthProbe({
      identity,
      defaultRouteAgentId: assembly.agentId,
      assemblyRegistry: { active: vi.fn(async () => assembly) } as never,
      catalog: { listAvailable } as unknown as CapabilityCatalog,
    });

    await expect(probe.run(new AbortController().signal)).resolves.toEqual({
      status: 'UP',
      reasonCode: 'CAPABILITY_CATALOG_READ_OK',
      summary: 'Capability catalog read check completed.',
    });
    expect(listAvailable).toHaveBeenCalledWith({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentAssembly: assembly,
      includeUnavailable: false,
    });
  });

  it('returns a safe DOWN result when catalog read fails', async () => {
    const identity: IdentityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-health'),
      subjectId: brand<string, 'SubjectId'>('subject-health'),
      displayName: 'health tester',
    };
    const probe = createCapabilityCatalogHealthProbe({
      identity,
      defaultRouteAgentId: brand<string, 'AgentId'>('agent-health'),
      assemblyRegistry: {
        active: vi.fn(async () => {
          throw new Error('raw /tmp/catalog path');
        }),
      } as never,
      catalog: { listAvailable: vi.fn() } as unknown as CapabilityCatalog,
    });

    await expect(probe.run(new AbortController().signal)).resolves.toEqual({
      status: 'DOWN',
      reasonCode: 'CAPABILITY_CATALOG_READ_FAILED',
      summary: 'Capability catalog read check failed safely.',
    });
  });
});
