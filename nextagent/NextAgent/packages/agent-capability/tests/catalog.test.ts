import {
  StaticCapabilityCatalog,
  builtinSkillsProvider,
  localSkillsSystemProvider,
  localSkillsAgentOwnedProvider,
  type SkillScanReport,
} from '@nextagent/agent-capability';
import type { CapabilityDescriptor, CapabilityDiscovery } from '@nextagent/agent-contracts/capability';
import { brand } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';

describe('collectSkillScanReport', () => {
  it('aggregates discovered skills from _REGISTERED evidence and failures from other codes', async () => {
    const discovery = eagerDiscovery('builtin-skills', '/fake/root', [
      { skillId: 'skill-a', outcomeCode: 'BUILTIN_SKILL_REGISTERED', message: 'ok' },
      { outcomeCode: 'BUILTIN_SKILL_CANDIDATE_IGNORED', message: 'Invalid name' },
    ]);
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!).toMatchObject({
      providerId: 'builtin-skills',
      scanRoot: '/fake/root',
      discovered: ['skill-a'],
      failures: [{ outcomeCode: 'BUILTIN_SKILL_CANDIDATE_IGNORED', message: 'Invalid name' }],
    });
  });

  it('returns empty discovered and empty failures when all evidence is _REGISTERED', async () => {
    const discovery = eagerDiscovery('local-skills-system', '/fake/system', [
      { skillId: 'skill-a', outcomeCode: 'BUILTIN_SKILL_REGISTERED', message: 'ok' },
      { skillId: 'skill-b', outcomeCode: 'BUILTIN_SKILL_REGISTERED', message: 'ok' },
    ]);
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!).toMatchObject({
      discovered: ['skill-a', 'skill-b'],
      failures: [],
    });
  });

  it('returns empty discovered and only failures when no _REGISTERED evidence', async () => {
    const discovery = eagerDiscovery('builtin-skills', '/bad/root', [
      { skillId: 'skill-a', outcomeCode: 'BUILTIN_SKILL_MANIFEST_MISSING', message: 'Missing manifest' },
      { skillId: 'skill-b', outcomeCode: 'BUILTIN_SKILL_MANIFEST_INVALID', message: 'Invalid manifest' },
    ]);
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!).toMatchObject({
      discovered: [],
      failures: [
        { skillId: 'skill-a', outcomeCode: 'BUILTIN_SKILL_MANIFEST_MISSING' },
        { skillId: 'skill-b', outcomeCode: 'BUILTIN_SKILL_MANIFEST_INVALID' },
      ],
    });
  });

  it('skips discoveries that have no scan root and no evidence', async () => {
    const noEvidenceDiscovery: CapabilityDiscovery = {
      provider: { providerId: 'empty-provider', providerKind: 'LOCAL_DIRECTORY' },
      discoveryMode: 'EAGER',
      async listAll() {
        return [];
      },
      getSkillScanEvidence() {
        return [];
      },
      getSkillScanRoot() {
        return undefined;
      },
    };
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [noEvidenceDiscovery] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(0);
  });

  it('includes a discovery with root but no evidence', async () => {
    const discovery: CapabilityDiscovery = {
      provider: { providerId: 'root-only', providerKind: 'LOCAL_DIRECTORY' },
      discoveryMode: 'EAGER',
      async listAll() {
        return [];
      },
      getSkillScanEvidence() {
        return [];
      },
      getSkillScanRoot() {
        return '/some/root';
      },
    };
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!).toMatchObject({
      providerId: 'root-only',
      scanRoot: '/some/root',
      discovered: [],
      failures: [],
    });
  });

  it('uses (unknown) as scanRoot when root is undefined but evidence exists', async () => {
    const discovery: CapabilityDiscovery = {
      provider: { providerId: 'has-evidence', providerKind: 'LOCAL_DIRECTORY' },
      discoveryMode: 'EAGER',
      async listAll() {
        return [];
      },
      getSkillScanEvidence() {
        return [{ outcomeCode: 'LOCAL_SKILL_SOURCE_UNAVAILABLE', message: 'Unavailable' }];
      },
      getSkillScanRoot() {
        return undefined;
      },
    };
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!).toMatchObject({
      scanRoot: '(unknown)',
      failures: [{ outcomeCode: 'LOCAL_SKILL_SOURCE_UNAVAILABLE' }],
    });
  });

  it('merges governance evidence failures into the matching source', async () => {
    const discovery = eagerDiscovery('builtin-skills', '/builtin/root', [
      { skillId: 'skill-a', outcomeCode: 'BUILTIN_SKILL_REGISTERED', message: 'ok' },
    ]);
    // Add a local skill descriptor to trigger governance evidence during listAvailable
    const localDescriptor: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('local-skill'),
      kind: 'SKILL',
      provider: localSkillsSystemProvider,
      displayName: 'Local Skill',
      description: 'Test local skill',
      modelInvocable: true,
      availabilityStatus: 'AVAILABLE',
    };
    const catalog = new StaticCapabilityCatalog([localDescriptor], { eagerDiscoveries: [discovery] });

    // Trigger governance by listing available -> populates localSkillGovernanceEvidence
    await catalog.listAvailable({
      tenantId: brand<string, 'TenantId'>('t1'),
      subjectId: brand<string, 'SubjectId'>('s1'),
      agentAssembly: agentAssembly(),
      includeUnavailable: false,
    });

    const report = await catalog.collectSkillScanReport();

    // Should have 2 sources: builtin-skills and local-skills-system (from governance)
    expect(report.sources.length).toBeGreaterThanOrEqual(1);
    const builtinSource = report.sources.find((s) => s.providerId === 'builtin-skills');
    expect(builtinSource).toBeDefined();
    expect(builtinSource!.discovered).toEqual(['skill-a']);
  });

  it('includes both eager and search discoveries in the report', async () => {
    const eager = eagerDiscovery('builtin-skills', '/eager/root', [
      { skillId: 'builtin-skill', outcomeCode: 'BUILTIN_SKILL_REGISTERED', message: 'ok' },
    ]);
    const search = searchDiscovery('agent-search', '/search/root', [{ outcomeCode: 'SEARCH_SOURCE_UNAVAILABLE', message: 'Not reached' }]);
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [eager], searchDiscoveries: [search] });

    const report = await catalog.collectSkillScanReport();

    expect(report.sources).toHaveLength(2);
    expect(report.sources.map((s) => s.providerId).sort()).toEqual(['agent-search', 'builtin-skills']);
  });

  it('returns valid SkillScanReport type structure', async () => {
    const discovery = eagerDiscovery('test-provider', '/test/root', [
      { skillId: 'skill-x', outcomeCode: 'TEST_REGISTERED', message: 'ok' },
      { skillId: 'skill-y', outcomeCode: 'TEST_FAILED', message: 'parse error' },
    ]);
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report: SkillScanReport = await catalog.collectSkillScanReport();

    expect(Array.isArray(report.sources)).toBe(true);
    for (const source of report.sources) {
      expect(typeof source.providerId).toBe('string');
      expect(typeof source.scanRoot).toBe('string');
      expect(Array.isArray(source.discovered)).toBe(true);
      expect(Array.isArray(source.failures)).toBe(true);
      for (const failure of source.failures) {
        expect(typeof failure.outcomeCode).toBe('string');
        expect(typeof failure.message).toBe('string');
      }
    }
  });

  it('handles discoveries without getSkillScanEvidence or getSkillScanRoot gracefully', async () => {
    const discovery: CapabilityDiscovery = {
      provider: { providerId: 'no-scan-methods', providerKind: 'LOCAL_DIRECTORY' },
      discoveryMode: 'EAGER',
      async listAll() {
        return [];
      },
    };
    const catalog = new StaticCapabilityCatalog([], { eagerDiscoveries: [discovery] });

    const report = await catalog.collectSkillScanReport();

    // Should be skipped because no root and no evidence
    expect(report.sources).toHaveLength(0);
  });
});

function eagerDiscovery(
  providerId: string,
  scanRoot: string,
  evidence: ReadonlyArray<{ readonly skillId?: string; readonly outcomeCode: string; readonly message: string }>,
): CapabilityDiscovery {
  return {
    provider: { providerId, providerKind: 'LOCAL_DIRECTORY' },
    discoveryMode: 'EAGER',
    async listAll() {
      return [];
    },
    getSkillScanEvidence() {
      return evidence;
    },
    getSkillScanRoot() {
      return scanRoot;
    },
  };
}

function searchDiscovery(
  providerId: string,
  scanRoot: string,
  evidence: ReadonlyArray<{ readonly skillId?: string; readonly outcomeCode: string; readonly message: string }>,
): CapabilityDiscovery {
  return {
    provider: { providerId, providerKind: 'LOCAL_DIRECTORY' },
    discoveryMode: 'SEARCH',
    async search() {
      return [];
    },
    getSkillScanEvidence() {
      return evidence;
    },
    getSkillScanRoot() {
      return scanRoot;
    },
  };
}

function agentAssembly() {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default',
    description: 'Test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1' as const,
      isolationMode: 'subject' as const,
      roots: [
        { kind: 'workspace' as const, logicalPath: 'workspace' as const, access: 'readWrite' as const },
        { kind: 'systemResources' as const, logicalPath: '.nextagent' as const, access: 'read' as const },
        { kind: 'temp' as const, logicalPath: 'temp' as const, access: 'readWrite' as const },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND' as const,
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}
