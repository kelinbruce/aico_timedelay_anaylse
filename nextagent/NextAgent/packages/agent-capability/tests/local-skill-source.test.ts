import {
  StaticCapabilityCatalog,
  createAgentOwnedLocalSkillDiscoveryForTesting,
  createRuntimeGeneratedLocalSkillDiscoveryForTesting,
  createSystemLocalSkillDiscoveryForTesting,
  localSkillsAgentOwnedProvider,
  localSkillsRuntimeGeneratedProvider,
  localSkillsSystemProvider,
} from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCurrentDiscoveryCriteria, CapabilityDescriptor, CapabilityDiscovery } from '@nextagent/agent-contracts/capability';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('LocalSkillDiscovery', () => {
  it('reads current Agent-owned Skill metadata from the trusted Agent package without loading Skill content', async () => {
    const root = await makeRoot();
    try {
      const agentPackageRoot = join(root, 'agents', 'default-agent');
      await writeSkill(join(agentPackageRoot, 'skills'), 'agent-current-skill');
      await writeFile(join(agentPackageRoot, 'skills', 'agent-current-skill', 'scripts.sh'), 'must-not-be-read', 'utf8');
      const locateCalls: CapabilityCurrentDiscoveryCriteria[] = [];
      const discovery = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate(input) {
            locateCalls.push(input as CapabilityCurrentDiscoveryCriteria);
            return { status: 'found', agentPackageRoot };
          },
        },
      });

      const descriptors = await requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal);

      expect(locateCalls).toEqual([currentCriteria()]);
      expect(descriptors).toEqual([
        expect.objectContaining({
          capabilityId: 'agent-current-skill',
          displayName: 'agent-current-skill',
          provider: localSkillsAgentOwnedProvider,
        }),
      ]);
      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('agent-current-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();
      await expect(
        discovery.listSkillResources(
          { skillName: brand<string, 'CapabilityId'>('agent-current-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the pure current root locator for runtime-generated Skills and discovers a new identity without materializing workspace state', async () => {
    const root = await makeRoot();
    try {
      const generatedSkillsRoot = join(root, 'existing-scope', 'generated-skills');
      await writeSkill(generatedSkillsRoot, 'generated-current-skill');
      const calls: string[] = [];
      const discovery = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate() {
            calls.push('search-locator');
            throw new Error('mutating search locator must not be used');
          },
          async locateCurrent(input) {
            calls.push(`current:${input.tenantId}:${input.subjectId}:${input.agentId}:${input.sessionId}`);
            return generatedSkillsRoot;
          },
        },
      });

      await expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
        expect.objectContaining({ capabilityId: 'generated-current-skill', displayName: 'generated-current-skill' }),
      ]);
      expect(calls).toEqual(['current:tenant-local-skill:subject-local-skill:default-agent:session-local-skill']);
      expect(await import('node:fs/promises').then(({ readdir }) => readdir(root))).toEqual(['existing-scope']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats a definitively missing current Skill root as empty and rejects other read failures', async () => {
    const root = await makeRoot();
    try {
      const missing = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate() {
            return undefined;
          },
          async locateCurrent() {
            return undefined;
          },
        },
      });
      await expect(requireCurrentReader(missing)(currentCriteria(), new AbortController().signal)).resolves.toEqual([]);

      const absentRoot = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate() {
            return join(root, 'not-materialized');
          },
          async locateCurrent() {
            return join(root, 'not-materialized');
          },
        },
      });
      await expect(requireCurrentReader(absentRoot)(currentCriteria(), new AbortController().signal)).resolves.toEqual([]);

      const notDirectory = join(root, 'not-a-directory');
      await writeFile(notDirectory, 'not a Skill root', 'utf8');
      const unreadable = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate() {
            return notDirectory;
          },
          async locateCurrent() {
            return notDirectory;
          },
        },
      });
      await expect(requireCurrentReader(unreadable)(currentCriteria(), new AbortController().signal)).rejects.toThrow(
        'Local Skill current view is unavailable.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps configured current Skill locator failures explicit', async () => {
    const invalid = createAgentOwnedLocalSkillDiscoveryForTesting({
      agentPackageSourceLocator: {
        async locate() {
          return { status: 'invalid', safeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' };
        },
      },
    });
    await expect(requireCurrentReader(invalid)(currentCriteria(), new AbortController().signal)).rejects.toThrow(
      'Local Skill current view is unavailable.',
    );

    const failed = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
      runtimeGeneratedSkillRootLocator: {
        async locate() {
          return undefined;
        },
        async locateCurrent() {
          throw new Error('private locator failure');
        },
      },
    });
    await expect(requireCurrentReader(failed)(currentCriteria(), new AbortController().signal)).rejects.toThrow('private locator failure');
  });

  it('rejects cancellation while the current Skill locator is pending without replacing completed evidence', async () => {
    const root = await makeRoot();
    try {
      const skillsRoot = join(root, 'skills');
      await mkdir(join(skillsRoot, 'missing-manifest'), { recursive: true });
      let locateCallCount = 0;
      let markLocatorStarted: (() => void) | undefined;
      let releaseLocator: (() => void) | undefined;
      const locatorStarted = new Promise<void>((resolve) => {
        markLocatorStarted = resolve;
      });
      const discovery = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate() {
            locateCallCount += 1;
            if (locateCallCount === 1) {
              return { status: 'found', agentPackageRoot: root };
            }
            return new Promise((resolve) => {
              releaseLocator = () => resolve({ status: 'not-found', safeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' });
              markLocatorStarted?.();
            });
          },
        },
      });
      await requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal);
      const completedEvidence = [...discovery.getReadinessEvidence()];
      const controller = new AbortController();

      const pendingRead = requireCurrentReader(discovery)(currentCriteria(), controller.signal);
      await locatorStarted;
      controller.abort();
      releaseLocator?.();

      await expect(pendingRead).rejects.toThrow('Local Skill current view was cancelled.');
      expect(discovery.getReadinessEvidence()).toEqual(completedEvidence);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips one missing current Skill manifest and returns valid siblings', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'healthy-skill');
      await mkdir(join(root, 'missing-manifest'), { recursive: true });
      const discovery = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate() {
            return root;
          },
          async locateCurrent() {
            return root;
          },
        },
      });

      await expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
        expect.objectContaining({ capabilityId: 'healthy-skill' }),
      ]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_MANIFEST_MISSING', skillId: 'missing-manifest' })]),
      );
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips one schema-rejected current Skill manifest and returns valid siblings without leaking diagnostics', async () => {
    const root = await makeRoot();
    try {
      const skillsRoot = join(root, 'skills');
      await writeSkill(skillsRoot, 'healthy-skill');
      await mkdir(join(skillsRoot, 'invalid-skill'), { recursive: true });
      await writeFile(join(skillsRoot, 'invalid-skill', 'SKILL.md'), invalidSkillWithDiagnosticCanary('invalid-skill'), 'utf8');
      const logs = captureLogs();
      const discovery = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate() {
            return { status: 'found', agentPackageRoot: root };
          },
        },
      });

      await Promise.all([
        expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
          expect.objectContaining({ capabilityId: 'healthy-skill' }),
        ]),
        expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
          expect.objectContaining({ capabilityId: 'healthy-skill' }),
        ]),
      ]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_MANIFEST_INVALID', skillId: 'invalid-skill' })]),
      );
      expect(
        discovery
          .getReadinessEvidence()
          .filter((evidence) => evidence.outcomeCode === 'LOCAL_SKILL_MANIFEST_INVALID' && evidence.skillId === 'invalid-skill'),
      ).toHaveLength(1);
      expect(JSON.stringify({ evidence: discovery.getReadinessEvidence(), logs: logs.entries })).not.toContain(root);
      expect(JSON.stringify({ evidence: discovery.getReadinessEvidence(), logs: logs.entries })).not.toContain('credential-sk-leak-canary');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not replace EAGER startup evidence when current-read is not applicable', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'startup-skill');
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      await discovery.listAll(new AbortController().signal);
      const startupEvidence = [...discovery.getReadinessEvidence()];

      await expect(discovery.listCurrent(currentCriteria(), new AbortController().signal)).resolves.toEqual([]);

      expect(discovery.getReadinessEvidence()).toEqual(startupEvidence);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scans only first-level SKILL.md candidates and keeps local paths private', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'valid-skill');
      await mkdir(join(root, '.hidden'), { recursive: true });
      await writeFile(join(root, '.hidden', 'SKILL.md'), validSkill('hidden-skill'), 'utf8');
      await mkdir(join(root, 'missing-skill'), { recursive: true });
      await mkdir(join(root, 'nested', 'child'), { recursive: true });
      await writeFile(join(root, 'nested', 'child', 'SKILL.md'), validSkill('child'), 'utf8');

      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      const descriptors = await discovery.listAll(new AbortController().signal);

      expect(descriptors).toEqual([expect.objectContaining({ capabilityId: 'valid-skill', kind: 'SKILL', provider: localSkillsSystemProvider })]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_MANIFEST_MISSING', skillId: 'missing-skill' }),
          expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_MANIFEST_MISSING', skillId: 'nested' }),
          expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_REGISTERED', skillId: 'valid-skill' }),
        ]),
      );
      const loadingFact = discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('valid-skill'));
      expect(loadingFact).toMatchObject({
        providerId: 'local-skills-system',
        capabilityId: 'valid-skill',
        skillVersion: 'unversioned',
      });
      expect(loadingFact?.frontmatterHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(descriptors)).not.toContain(root);
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads Agent-owned skills through the trusted locator and never from workspaceDir', async () => {
    const root = await makeRoot();
    try {
      const agentsRoot = join(root, 'agents');
      const workspaceDir = join(root, 'workspaces', 'default-agent');
      await writeSkill(join(agentsRoot, 'default-agent', 'skills'), 'agent-skill');
      await writeSkill(join(workspaceDir, 'skills'), 'workspace-skill');
      const discovery = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate(input) {
            expect(input).not.toHaveProperty('agentAssembly');
            expect(input).not.toHaveProperty('boundCapabilityIds');
            return { status: 'found', agentPackageRoot: join(agentsRoot, input.agentId) };
          },
        },
      });

      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);

      expect(descriptors).toEqual([expect.objectContaining({ capabilityId: 'agent-skill', provider: localSkillsAgentOwnedProvider })]);
      const loadingFact = discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('agent-skill'));
      expect(loadingFact).toMatchObject({ capabilityId: 'agent-skill', skillVersion: 'unversioned' });
      expect(JSON.stringify(descriptors)).not.toContain('workspace-skill');
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain(workspaceDir);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads runtime-generated skills only from the current execution scope generated-skills root', async () => {
    const root = await makeRoot();
    try {
      const generatedSkillsRoot = join(root, 'generated-skills');
      await writeSkill(generatedSkillsRoot, 'generated-runtime-skill');
      await writeSkill(join(root, 'workspace', 'generated-skills'), 'workspace-shadow');
      const discovery = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate(input) {
            expect(input).toMatchObject({ agentId: 'default-agent', sessionId: 'session-local-skill' });
            return generatedSkillsRoot;
          },
        },
      });

      const descriptors = await discovery.search(
        { ...searchCriteria(), sessionId: brand<string, 'SessionId'>('session-local-skill') },
        new AbortController().signal,
      );

      expect(descriptors).toEqual([
        expect.objectContaining({ capabilityId: 'generated-runtime-skill', provider: localSkillsRuntimeGeneratedProvider }),
      ]);
      expect(JSON.stringify(descriptors)).not.toContain('workspace-shadow');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects runtime-generated skills when the manifest name differs from the generated-skills folder name', async () => {
    const root = await makeRoot();
    try {
      const generatedSkillsRoot = join(root, 'generated-skills');
      await mkdir(join(generatedSkillsRoot, 'generated-space-view'), { recursive: true });
      await writeFile(join(generatedSkillsRoot, 'generated-space-view', 'SKILL.md'), validSkill('space-view'), 'utf8');
      const discovery = createRuntimeGeneratedLocalSkillDiscoveryForTesting({
        runtimeGeneratedSkillRootLocator: {
          async locate() {
            return generatedSkillsRoot;
          },
        },
      });

      const descriptors = await discovery.search(
        { ...searchCriteria(), sessionId: brand<string, 'SessionId'>('session-local-skill') },
        new AbortController().signal,
      );

      expect(descriptors).toEqual([]);
      expect(discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('space-view'))).toBeUndefined();
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_MANIFEST_INVALID', skillId: 'generated-space-view' })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports safe source, package, and manifest diagnostics without raw local facts', async () => {
    const root = await makeRoot();
    try {
      const logs = captureLogs();
      const unavailable = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: join(root, 'missing') });
      await expect(unavailable.listAll(new AbortController().signal)).resolves.toEqual([]);
      expect(unavailable.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_SOURCE_UNAVAILABLE' })]);

      const disabled = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root, enabled: false });
      await expect(disabled.listAll(new AbortController().signal)).resolves.toEqual([]);
      expect(disabled.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_SOURCE_DISABLED' })]);

      await mkdir(join(root, 'bad-skill'), { recursive: true });
      await writeFile(join(root, 'bad-skill', 'SKILL.md'), invalidSkillWithDiagnosticCanary('bad-skill'), 'utf8');
      const invalid = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      await expect(invalid.listAll(new AbortController().signal)).resolves.toEqual([]);
      expect(invalid.getReadinessEvidence()).toEqual([
        expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_MANIFEST_INVALID', skillId: 'bad-skill', message: 'Local Skill manifest is invalid.' }),
      ]);
      expect(logs.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'warn',
            obj: expect.objectContaining({ diagnosticReasonCodes: ['INVALID_OFFICIAL_FIELD'], diagnosticCount: 1 }),
            msg: 'Skill bad-skill manifest validation failed with 1 diagnostic reason codes.',
          }),
        ]),
      );

      const packageUnavailable = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate() {
            return { status: 'not-found', safeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' };
          },
        },
      });
      await expect(packageUnavailable.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      expect(packageUnavailable.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' })]);
      expect(
        JSON.stringify([
          ...unavailable.getReadinessEvidence(),
          ...disabled.getReadinessEvidence(),
          ...invalid.getReadinessEvidence(),
          ...packageUnavailable.getReadinessEvidence(),
        ]),
      ).not.toContain(root);
      expect(JSON.stringify(logs.entries)).not.toContain(root);
      expect(JSON.stringify({ evidence: invalid.getReadinessEvidence(), logs: logs.entries })).not.toContain('credential-sk-leak-canary');
      expect(JSON.stringify(logs.entries)).not.toContain('detailMessages');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('logs one unavailable warning per continuous source state and allows a new warning after recovery', async () => {
    const root = await makeRoot();
    const agentPackageRoot = join(root, 'agent-package');
    try {
      const logs = captureLogs();
      const discovery = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate() {
            return { status: 'found', agentPackageRoot };
          },
        },
      });

      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      expect(discovery.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_SOURCE_UNAVAILABLE' })]);

      await writeSkill(join(agentPackageRoot, 'skills'), 'recovered-skill');
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([
        expect.objectContaining({ capabilityId: 'recovered-skill' }),
      ]);
      await rm(join(agentPackageRoot, 'skills'), { recursive: true, force: true });
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);

      expect(
        logs.entries.filter((entry) => (entry.obj as { event?: string }).event === 'skill.discovery.source_unavailable' && entry.level === 'warn'),
      ).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses the system-local manifest scan across repeated list calls', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'cached-skill');
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });

      const [first, second] = await Promise.all([discovery.listAll(new AbortController().signal), discovery.listAll(new AbortController().signal)]);
      expect(first).toEqual([expect.objectContaining({ capabilityId: 'cached-skill' })]);
      expect(second).toEqual(first);
      await writeSkill(root, 'late-skill');

      await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual([expect.objectContaining({ capabilityId: 'cached-skill' })]);
      expect(discovery.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_REGISTERED', skillId: 'cached-skill' })]);
      expect(discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('cached-skill'))).toBeDefined();
      expect(discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('late-skill'))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists safe resource metadata and streams content only through the governed resource API', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'resource-skill');
      await mkdir(join(root, 'resource-skill', 'assets', '.schemas'), { recursive: true });
      await mkdir(join(root, 'resource-skill', 'assets', '.pnpm-store'), { recursive: true });
      await mkdir(join(root, 'resource-skill', 'api'), { recursive: true });
      await mkdir(join(root, 'resource-skill', 'references'), { recursive: true });
      await writeFile(join(root, 'resource-skill', 'assets', 'schema.json'), '{"type":"object"}', 'utf8');
      await writeFile(join(root, 'resource-skill', 'assets', '.schemas', 'chatbi.yaml'), 'openapi: 3.1.0\n', 'utf8');
      await writeFile(join(root, 'resource-skill', 'assets', '.pnpm-store', 'skip.js'), 'module.exports = 1;\n', 'utf8');
      await writeFile(join(root, 'resource-skill', 'api', 'a.yaml'), 'openapi: 3.1.0\n', 'utf8');
      await writeFile(join(root, 'resource-skill', 'references', 'guide.md'), 'local guide', 'utf8');
      await writeFile(join(root, 'resource-skill', 'LICENSE'), 'not projected', 'utf8');
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      await expect(discovery.listAll(new AbortController().signal)).resolves.toHaveLength(1);
      const fact = { skillName: brand<string, 'CapabilityId'>('resource-skill'), skillVersion: 'unversioned' };

      const resources = await discovery.listSkillResources(fact, new AbortController().signal);
      expect(resources).toEqual([
        expect.objectContaining({ relativePath: 'api/a.yaml', kind: 'asset', sizeBytes: 15 }),
        expect.objectContaining({ relativePath: 'assets/.schemas/chatbi.yaml', kind: 'asset', sizeBytes: 15 }),
        expect.objectContaining({ relativePath: 'assets/schema.json', kind: 'asset', sizeBytes: 17 }),
        expect.objectContaining({ relativePath: 'references/guide.md', kind: 'reference', sizeBytes: 11 }),
      ]);
      expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ relativePath: 'assets/.pnpm-store/skip.js' })]));
      expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ contentStream: expect.anything() })]));
      expect(JSON.stringify(resources)).not.toContain(root);

      const guide = resources.find((resource) => resource.relativePath === 'references/guide.md')!;
      const loaded = await discovery.readSkillResource({ ...fact, resource: guide }, new AbortController().signal);
      await expect(readStreamText(loaded?.contentStream)).resolves.toBe('local guide');
      expect(loaded).toMatchObject(guide);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits low-cardinality body load failure diagnostics for missing facts and source drift', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'drift-skill');
      const logs = captureLogs();
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      await expect(discovery.listAll(new AbortController().signal)).resolves.toHaveLength(1);

      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('missing-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();

      const skillFile = join(root, 'drift-skill', 'SKILL.md');
      await writeFile(skillFile, validSkill('drift-skill').replace('Test telecom Skill.', 'Changed frontmatter.'), 'utf8');
      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('drift-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();

      await writeFile(skillFile, validVersionedSkill('drift-skill', 'v2'), 'utf8');
      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('drift-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();

      await rm(skillFile, { force: true });
      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('drift-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();

      expect(logs.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'warn',
            obj: expect.objectContaining({
              event: 'local.skill.body_load_failed',
              requestedSkillName: 'missing-skill',
              providerId: 'local-skills-system',
              sourceScope: 'system-local',
              skillVersion: 'unversioned',
              bodyLoadFailureReason: 'LOCAL_SKILL_LOADING_FACT_MISSING',
              manifestExists: false,
              trackedFactCount: 1,
              trackedSkillIdsSample: ['drift-skill'],
            }),
          }),
          expect.objectContaining({
            level: 'warn',
            obj: expect.objectContaining({
              event: 'local.skill.body_load_failed',
              requestedSkillName: 'drift-skill',
              providerId: 'local-skills-system',
              sourceScope: 'system-local',
              skillVersion: 'unversioned',
              bodyLoadFailureReason: 'LOCAL_SKILL_BODY_FRONTMATTER_MISMATCH',
              manifestExists: true,
            }),
          }),
          expect.objectContaining({
            level: 'warn',
            obj: expect.objectContaining({
              event: 'local.skill.body_load_failed',
              requestedSkillName: 'drift-skill',
              providerId: 'local-skills-system',
              sourceScope: 'system-local',
              skillVersion: 'unversioned',
              bodyLoadFailureReason: 'LOCAL_SKILL_BODY_FRONTMATTER_MISMATCH',
              manifestExists: true,
            }),
          }),
          expect.objectContaining({
            level: 'error',
            obj: expect.objectContaining({
              event: 'local.skill.body_load_failed',
              requestedSkillName: 'drift-skill',
              providerId: 'local-skills-system',
              sourceScope: 'system-local',
              skillVersion: 'unversioned',
              bodyLoadFailureReason: 'LOCAL_SKILL_BODY_LOAD_FAILED',
              manifestExists: false,
            }),
          }),
        ]),
      );
      expect(JSON.stringify(logs.entries)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on body-only tampering when a trusted Skill Hub cache baseline exists', async () => {
    const root = await makeRoot();
    const previousShareDir = process.env._APP_SHARE_DIR;
    process.env._APP_SHARE_DIR = join(root, 'share');
    try {
      const skillFile = join(root, 'tamper-skill', 'SKILL.md');
      const original = skillWithBody('tamper-skill', 'Original governed body.');
      await mkdir(join(root, 'tamper-skill'), { recursive: true });
      await writeFile(skillFile, original, 'utf8');
      const cacheFile = join(root, 'share', 'cache', 'skillhub', 'tamper-skill', 'SKILL.md');
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, original, 'utf8');
      const logs = captureLogs();
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      await expect(discovery.listAll(new AbortController().signal)).resolves.toHaveLength(1);
      const fact = { skillName: brand<string, 'CapabilityId'>('tamper-skill'), skillVersion: 'unversioned' };

      await expect(discovery.loadCanonicalBodyView(fact, new AbortController().signal)).resolves.toMatchObject({
        capabilityId: 'tamper-skill',
        body: expect.stringContaining('Original governed body.'),
      });

      await writeFile(skillFile, skillWithBody('tamper-skill', 'Tampered body keeping frontmatter identical.'), 'utf8');
      await expect(discovery.loadCanonicalBodyView(fact, new AbortController().signal)).resolves.toBeUndefined();
      expect(logs.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'warn',
            obj: expect.objectContaining({
              event: 'local.skill.body_load_failed',
              requestedSkillName: 'tamper-skill',
              providerId: 'local-skills-system',
              bodyLoadFailureReason: 'LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH',
              manifestExists: true,
            }),
          }),
        ]),
      );

      // No trusted baseline (e.g. runtime-generated, non-Skill-Hub skills):
      // the document hash gate is skipped rather than false-failing.
      await rm(join(root, 'share'), { recursive: true, force: true });
      await expect(discovery.loadCanonicalBodyView(fact, new AbortController().signal)).resolves.toMatchObject({
        capabilityId: 'tamper-skill',
        body: expect.stringContaining('Tampered body keeping frontmatter identical.'),
      });
      expect(JSON.stringify(logs.entries)).not.toContain(root);
    } finally {
      if (previousShareDir === undefined) {
        delete process.env._APP_SHARE_DIR;
      } else {
        process.env._APP_SHARE_DIR = previousShareDir;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serves cached descriptors and retains loading facts when the root is later unavailable', async () => {
    const root = await makeRoot();
    try {
      await writeSkill(root, 'stable-skill');
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      const first = await discovery.listAll(new AbortController().signal);
      expect(first).toHaveLength(1);

      const beforeFailure = discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('stable-skill'));
      expect(beforeFailure).toMatchObject({
        capabilityId: 'stable-skill',
        skillVersion: 'unversioned',
      });

      await rm(root, { recursive: true, force: true });
      await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual(first);

      const afterFailure = discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('stable-skill'));
      expect(afterFailure).toEqual(beforeFailure);
      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('stable-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function readStreamText(stream?: AsyncIterable<Uint8Array>): Promise<string> {
  if (stream === undefined) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

describe('local Skill Catalog governance', () => {
  it('injects system local and Agent-owned local Skills by default without synthetic bindings', async () => {
    const searchCalls: unknown[] = [];
    const catalog = new StaticCapabilityCatalog([localDescriptor('system-skill', 'system')], {
      searchDiscoveries: [agentOwnedDiscovery([localDescriptor('agent-skill', 'agent')], searchCalls)],
    });
    const agentAssembly = assembly([]);

    await expect(catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly, includeUnavailable: false })).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'system-skill', provider: localSkillsSystemProvider }),
      expect.objectContaining({ capabilityId: 'agent-skill', provider: localSkillsAgentOwnedProvider }),
    ]);
    expect(catalog.getLocalSkillGovernanceEvidence()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_REGISTERED', skillId: 'system-skill' }),
        expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_REGISTERED', skillId: 'agent-skill' }),
      ]),
    );
    expect(agentAssembly.capabilityBindings).toEqual([]);
    expect(searchCalls[0]).toMatchObject({ agentId: 'default-agent', agentVersion: 'v1', agentAssemblyRef: 'default-agent:v1' });
    expect(searchCalls[0]).not.toHaveProperty('agentAssembly');
    expect(searchCalls[0]).not.toHaveProperty('boundCapabilityIds');
  });

  it('keeps default-enabled local Skills governed by discovery instead of runtime disable facts', async () => {
    const catalog = new StaticCapabilityCatalog([localDescriptor('system-skill', 'system')], {
      searchDiscoveries: [agentOwnedDiscovery([localDescriptor('agent-skill', 'agent')], [])],
    });

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'system-skill' }), expect.objectContaining({ capabilityId: 'agent-skill' })]);
  });

  it('keeps non-reserved SEARCH providers binding-enabled and filters returned candidates by binding', async () => {
    const calls: unknown[] = [];
    const discovery: CapabilityDiscovery = {
      provider: { providerId: 'external-search', providerKind: 'MCP_SERVER' },
      discoveryMode: 'SEARCH',
      async search(criteria) {
        calls.push(criteria);
        return [descriptor('bound-skill', 'external-search'), descriptor('unbound-skill', 'external-search')];
      },
    };
    const catalog = new StaticCapabilityCatalog([], { searchDiscoveries: [discovery] });

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
    await expect(
      catalog.listAvailable({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly([{ capabilityId: 'bound-skill', capabilityType: 'SKILL', providerId: 'external-search' }]),
        includeUnavailable: false,
      }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'bound-skill' })]);
    expect(calls[0]).not.toHaveProperty('boundCapabilityIds');
  });

  it('passes modelInvocable criteria into SEARCH discovery and filters candidates in catalog', async () => {
    const calls: unknown[] = [];
    const discovery: CapabilityDiscovery = {
      provider: { providerId: 'external-search', providerKind: 'MCP_SERVER' },
      discoveryMode: 'SEARCH',
      async search(criteria) {
        calls.push(criteria);
        return [
          descriptor('visible-skill', 'external-search', 'MCP_SERVER', 'SKILL', true),
          descriptor('hidden-skill', 'external-search', 'MCP_SERVER', 'SKILL', false),
        ];
      },
    };
    const catalog = new StaticCapabilityCatalog([], { searchDiscoveries: [discovery] });
    const agentAssembly = assembly([
      { capabilityId: 'visible-skill', capabilityType: 'SKILL', providerId: 'external-search' },
      { capabilityId: 'hidden-skill', capabilityType: 'SKILL', providerId: 'external-search' },
    ]);

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly, includeUnavailable: false, modelInvocable: true }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'visible-skill' })]);
    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly, includeUnavailable: false, modelInvocable: false }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'hidden-skill' })]);
    expect(calls).toEqual([expect.objectContaining({ modelInvocable: true }), expect.objectContaining({ modelInvocable: false })]);
  });

  it('shadows system local with Agent-owned local for the same Agent and leaves other Agents with system local', async () => {
    const catalog = new StaticCapabilityCatalog([localDescriptor('same-skill', 'system')], {
      searchDiscoveries: [agentOwnedDiscovery([localDescriptor('same-skill', 'agent')], [])],
    });

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'same-skill', provider: localSkillsAgentOwnedProvider })]);
    expect(catalog.getLocalSkillGovernanceEvidence()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_SHADOWED_BY_AGENT', providerId: 'local-skills-system', skillId: 'same-skill' }),
      ]),
    );

    const otherCatalog = new StaticCapabilityCatalog([localDescriptor('same-skill', 'system')]);
    await expect(catalogForOtherAgent(otherCatalog)).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'same-skill', provider: localSkillsSystemProvider }),
    ]);
  });

  it('keeps current and model-visible winners aligned when a higher-priority same-name Skill is invalid', async () => {
    const root = await makeRoot();
    try {
      const skillsRoot = join(root, 'skills');
      await mkdir(join(skillsRoot, 'same-skill'), { recursive: true });
      await writeFile(join(skillsRoot, 'same-skill', 'SKILL.md'), invalidSkillWithDiagnosticCanary('same-skill'), 'utf8');
      const discovery = createAgentOwnedLocalSkillDiscoveryForTesting({
        agentPackageSourceLocator: {
          async locate() {
            return { status: 'found', agentPackageRoot: root };
          },
        },
      });
      const catalog = new StaticCapabilityCatalog([localDescriptor('same-skill', 'system')], {
        searchDiscoveries: [discovery],
      });
      const agentAssembly = assembly([]);

      await expect(
        catalog.listCurrent(
          {
            tenantId: tenantId(),
            subjectId: subjectId(),
            sessionId: brand<string, 'SessionId'>('session-local-skill-current'),
            agentAssembly,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'same-skill', provider: localSkillsSystemProvider })]);
      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly,
          includeUnavailable: false,
          modelInvocable: true,
        }),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'same-skill', provider: localSkillsSystemProvider })]);
      await expect(
        discovery.loadCanonicalBodyView(
          { skillName: brand<string, 'CapabilityId'>('same-skill'), skillVersion: 'unversioned' },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects same-scope local duplicates and keeps BUNDLED higher priority than local', async () => {
    const duplicateCatalog = new StaticCapabilityCatalog([localDescriptor('dup-skill', 'system'), localDescriptor('dup-skill', 'system')]);
    await expect(
      duplicateCatalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
    ).resolves.toEqual([]);
    expect(duplicateCatalog.getLocalSkillGovernanceEvidence()).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcomeCode: 'LOCAL_SKILL_DUPLICATE_REJECTED', skillId: 'dup-skill' })]),
    );

    const builtinCatalog = new StaticCapabilityCatalog([descriptor('Read', 'builtin-tools', 'BUNDLED', 'TOOL'), localDescriptor('Read', 'system')]);
    await expect(
      builtinCatalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'Read', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } })]);
  });
});

function agentOwnedDiscovery(descriptors: readonly CapabilityDescriptor[], calls: unknown[]): CapabilityDiscovery {
  return {
    provider: localSkillsAgentOwnedProvider,
    discoveryMode: 'SEARCH',
    async search(criteria) {
      calls.push(criteria);
      return descriptors;
    },
  };
}

function localDescriptor(capabilityId: string, scope: 'system' | 'agent'): CapabilityDescriptor {
  return descriptor(capabilityId, scope === 'system' ? 'local-skills-system' : 'local-skills-agent-owned', 'LOCAL_DIRECTORY', 'SKILL');
}

function descriptor(
  capabilityId: string,
  providerId: string,
  providerKind: 'BUNDLED' | 'LOCAL_DIRECTORY' | 'MCP_SERVER' = 'BUNDLED',
  kind: 'TOOL' | 'SKILL' = 'SKILL',
  modelInvocable = true,
): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind,
    provider: { providerId, providerKind },
    displayName: capabilityId,
    description: `${capabilityId} test capability.`,
    modelInvocable,
    availabilityStatus: 'AVAILABLE',
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings'], agentId = 'default-agent'): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>(agentId),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: `${agentId}:v1`,
    displayName: 'Default',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        { kind: 'generatedSkills', logicalPath: 'generated-skills', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

async function catalogForOtherAgent(catalog: StaticCapabilityCatalog) {
  return catalog.listAvailable({
    tenantId: tenantId(),
    subjectId: subjectId(),
    agentAssembly: assembly([], 'other-agent'),
    includeUnavailable: false,
  });
}

function searchCriteria() {
  return {
    tenantId: tenantId(),
    subjectId: subjectId(),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    sessionId: brand<string, 'SessionId'>('session-local-skill'),
  };
}

function currentCriteria(): CapabilityCurrentDiscoveryCriteria {
  return {
    tenantId: tenantId(),
    subjectId: subjectId(),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    sessionId: brand<string, 'SessionId'>('session-local-skill'),
  };
}

function requireCurrentReader(discovery: CapabilityDiscovery) {
  if (discovery.listCurrent === undefined) {
    throw new Error('Expected local Skill discovery to expose listCurrent.');
  }
  return discovery.listCurrent.bind(discovery);
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nextagent-local-skills-'));
}

async function writeSkill(root: string, name: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), validSkill(name), 'utf8');
}

function validSkill(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n`;
}

function skillWithBody(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n\n${body}\n`;
}

function invalidSkillWithDiagnosticCanary(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\nlicense:\n  credential-sk-leak-canary: do-not-log\n---\n`;
}

function validVersionedSkill(name: string, version: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\nmetadata:\n  version: ${version}\n---\n`;
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-local-skill');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-local-skill');
}

function captureLogs() {
  const entries: Array<{ readonly level: string; readonly obj: object; readonly msg?: string }> = [];
  const logger = {
    error(caughtOrFields: unknown, fieldsOrMsg?: object | string, msg?: string) {
      const fields = typeof fieldsOrMsg === 'object' ? fieldsOrMsg : asObject(caughtOrFields);
      const message = typeof fieldsOrMsg === 'string' ? fieldsOrMsg : msg;
      entries.push({ level: 'error', obj: fields, ...(message === undefined ? {} : { msg: message }) });
    },
    warn(caughtOrFields: unknown, fieldsOrMsg?: object | string, msg?: string) {
      const fields = typeof fieldsOrMsg === 'object' ? fieldsOrMsg : asObject(caughtOrFields);
      const message = typeof fieldsOrMsg === 'string' ? fieldsOrMsg : msg;
      entries.push({ level: 'warn', obj: fields, ...(message === undefined ? {} : { msg: message }) });
    },
    info(obj: object, msg?: string) {
      entries.push({ level: 'info', obj, ...(msg === undefined ? {} : { msg }) });
    },
    debug(obj: object, msg?: string) {
      entries.push({ level: 'debug', obj, ...(msg === undefined ? {} : { msg }) });
    },
  };
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
  return { entries, logger };
}

function asObject(value: unknown): object {
  return value !== null && typeof value === 'object' ? value : {};
}
