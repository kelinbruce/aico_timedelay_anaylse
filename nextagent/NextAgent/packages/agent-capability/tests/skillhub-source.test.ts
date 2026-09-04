import { StaticCapabilityCatalog } from '../src/catalog/catalog.js';
import { createCapabilitySubsystem } from '../src/subsystem.js';
import { createSkillHubDiscoveryForTesting, type SkillHubRemoteAccessPort } from '../src/skillhub/skillhub-source.js';
import { SkillHubInstalledIndex } from '../src/skillhub/skillhub-installed-index.js';
import { createSystemLocalSkillDiscoveryForTesting, localSkillsSystemProvider } from '../src/local/skill-discovery.js';
import { safeInstallId } from '../src/skillhub/skillhub-remote-candidate.js';
import { brand, type CapabilityId } from '@nextagent/agent-common';
import type { CapabilityCurrentDiscoveryCriteria, CapabilityDiscovery, CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

const skillHubProvider = { providerId: 'hub-a', providerKind: 'SKILL_HUB' as const };

describe('SkillHubDiscovery', () => {
  it('reads only installed current descriptors and performs no remote discovery, fetch, or install work', async () => {
    const root = await makeRoot();
    try {
      const installingRemote = fakeRemote([remoteCandidate('installed-current-skill')], {
        'pkg:installed-current-skill': packageEntries('installed-current-skill'),
      });
      const installer = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: installingRemote,
      });
      await expect(installer.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });

      const presentationRemote = fakeRemote([remoteCandidate('must-not-be-discovered')], {
        'pkg:must-not-be-discovered': packageEntries('must-not-be-discovered'),
      });
      const coldDiscovery = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: presentationRemote,
      });

      await expect(requireCurrentReader(coldDiscovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
        expect.objectContaining({ capabilityId: 'installed-current-skill', displayName: 'installed-current-skill' }),
      ]);
      expect(presentationRemote.searches).toEqual([]);
      expect(presentationRemote.downloads).toEqual([]);
      expect(await readIndex(root)).toEqual([expect.objectContaining({ skillId: 'installed-current-skill' })]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats a missing installed index as a complete empty current view', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([], {});
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([]);
      expect(remote.searches).toEqual([]);
      expect(remote.downloads).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a corrupt installed index instead of treating it as an empty current view', async () => {
    const root = await makeRoot();
    try {
      await writeFile(join(root, 'remote-skill-content-index.json'), '{not-json', 'utf8');
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: fakeRemote([], {}) });

      await expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).rejects.toThrow(
        'SkillHub current view is unavailable.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects cancellation while the installed index read is pending without replacing completed evidence', async () => {
    const root = await makeRoot();
    try {
      const installer = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: fakeRemote([remoteCandidate('broken-installed-skill')], {
          'pkg:broken-installed-skill': packageEntries('broken-installed-skill'),
        }),
      });
      await installer.synchronizeRemoteContent(searchCriteria(), new AbortController().signal);
      await writeFile(await indexedManifestFile(root, 'broken-installed-skill'), invalidSkillWithDiagnosticCanary('broken-installed-skill'), 'utf8');
      const discovery = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: fakeRemote([], {}),
      });
      await requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal);
      const completedEvidence = [...discovery.getReadinessEvidence()];
      let markIndexStarted: (() => void) | undefined;
      let releaseIndex: (() => void) | undefined;
      const indexStarted = new Promise<void>((resolve) => {
        markIndexStarted = resolve;
      });
      const readStrict = vi.spyOn(SkillHubInstalledIndex.prototype, 'readStrict').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseIndex = () => resolve([]);
            markIndexStarted?.();
          }),
      );
      const controller = new AbortController();

      const pendingRead = requireCurrentReader(discovery)(currentCriteria(), controller.signal);
      await indexStarted;
      controller.abort();
      releaseIndex?.();

      await expect(pendingRead).rejects.toThrow('SkillHub current view was cancelled.');
      expect(discovery.getReadinessEvidence()).toEqual(completedEvidence);
      readStrict.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      failure: 'missing',
      outcomeCode: 'SKILLHUB_MANIFEST_MISSING',
      mutate: async (manifestFile: string) => rm(manifestFile),
    },
    {
      failure: 'schema-invalid',
      outcomeCode: 'SKILLHUB_MANIFEST_INVALID',
      mutate: async (manifestFile: string) => writeFile(manifestFile, invalidSkillWithDiagnosticCanary('broken-installed-skill'), 'utf8'),
    },
    {
      failure: 'hash-mismatched',
      outcomeCode: 'SKILLHUB_MANIFEST_INVALID',
      mutate: async (manifestFile: string) =>
        writeFile(manifestFile, validSkill('broken-installed-skill').replace('Test telecom Skill.', 'Changed telecom Skill.'), 'utf8'),
    },
  ])('skips one $failure installed manifest and returns valid installed siblings', async ({ outcomeCode, mutate }) => {
    const root = await makeRoot();
    try {
      const installer = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: fakeRemote([remoteCandidate('healthy-installed-skill'), remoteCandidate('broken-installed-skill')], {
          'pkg:healthy-installed-skill': packageEntries('healthy-installed-skill'),
          'pkg:broken-installed-skill': packageEntries('broken-installed-skill'),
        }),
      });
      await expect(installer.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({
        outcome: 'SUCCEEDED',
      });
      await mutate(await indexedManifestFile(root, 'broken-installed-skill'));

      const presentationRemote = fakeRemote([], {});
      const discovery = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: presentationRemote,
      });

      await Promise.all([
        expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
          expect.objectContaining({ capabilityId: 'healthy-installed-skill' }),
        ]),
        expect(requireCurrentReader(discovery)(currentCriteria(), new AbortController().signal)).resolves.toEqual([
          expect.objectContaining({ capabilityId: 'healthy-installed-skill' }),
        ]),
      ]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode, skillId: 'broken-installed-skill' })]),
      );
      expect(
        discovery.getReadinessEvidence().filter((evidence) => evidence.outcomeCode === outcomeCode && evidence.skillId === 'broken-installed-skill'),
      ).toHaveLength(1);
      expect(presentationRemote.searches).toEqual([]);
      expect(presentationRemote.downloads).toEqual([]);
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain(root);
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain('credential-sk-leak-canary');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('synchronously refreshes through catalog load without callers handling the discovery instance', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('remote-skill')], {
        'pkg:remote-skill': packageEntries('remote-skill'),
      });
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: skillHubProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: authorizeSkillHubProvider,
      });

      await expect(
        subsystem.catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'remote-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'remote-skill', provider: skillHubProvider })]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when catalog load lacks local Agent source authorization', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('remote-skill')], {
        'pkg:remote-skill': packageEntries('remote-skill'),
      });
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: skillHubProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: () => false,
      });

      await expect(
        subsystem.catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'remote-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'remote-skill', provider: skillHubProvider })]));
      expect(remote.searches).toEqual([]);
      expect(remote.downloads).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps remote candidates invisible until catalog load installs and validates the package', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('remote-skill')], {
        'pkg:remote-skill': packageEntries('remote-skill'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      const catalog = new StaticCapabilityCatalog([], {
        searchDiscoveries: [discovery],
        skillSourceDiscoveries: [discovery],
        skillHubSourceAuthorization: authorizeSkillHubProvider,
      });

      await expect(
        catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
      ).resolves.toEqual([]);

      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'remote-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'remote-skill', kind: 'SKILL', provider: skillHubProvider })]);
      const descriptor = (await catalog.resolve({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly([{ capabilityId: 'remote-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
        capabilityId: brand<string, 'CapabilityId'>('remote-skill'),
      }))!;
      expect(JSON.stringify(descriptor)).not.toContain(root);
      expect(JSON.stringify(descriptor)).not.toContain('pkg:remote-skill');
      expect(JSON.stringify(descriptor)).not.toContain('SKILL.md');
      expect(JSON.stringify(descriptor)).not.toContain('tenant-skillhub');
      expect(JSON.stringify(descriptor)).not.toContain('subject-skillhub');
      expect(JSON.stringify(descriptor)).not.toContain('default-agent:v1');
      expect(remote.downloads).toEqual(expect.arrayContaining(['pkg:remote-skill']));
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'SKILLHUB_CANDIDATE_INSTALLED', skillId: 'remote-skill' })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('installs a single SKILL.md content artifact without ZIP extraction', async () => {
    const root = await makeRoot();
    try {
      const remote: SkillHubRemoteAccessPort & { searches: unknown[]; fetches: string[] } = {
        searches: [],
        fetches: [],
        async listCandidates(input) {
          this.searches.push(input);
          return { status: 'ok', candidates: [remoteCandidate('single-skill', { contentRef: 'skill-md:single-skill', contentHash: 'single-hash' })] };
        },
        async fetchContent(input) {
          this.fetches.push(input.contentRef);
          const stagedFolder = await writeStagedFolder(input.stagingRoot, 'single-skill', [
            { path: 'SKILL.md', content: validSkill('single-skill', true, 'Single file body.') },
          ]);
          return { status: 'ok', stagingRoot: input.stagingRoot, stagedFolder, contentHash: 'single-hash' };
        },
      };
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });
      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);
      expect(descriptors).toEqual([expect.objectContaining({ capabilityId: 'single-skill', provider: skillHubProvider })]);
      expect(remote.fetches).toEqual(expect.arrayContaining(['skill-md:single-skill']));
      expect(await readIndex(root)).toEqual([expect.objectContaining({ skillId: 'single-skill', contentHash: 'single-hash' })]);
      const metadata = descriptors[0]!.metadata as { sourceMetadata: { sourceIdentity: string; frontmatterHash: string } };
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('single-skill'),
            sourceIdentity: metadata.sourceMetadata.sourceIdentity,
            frontmatterHash: metadata.sourceMetadata.frontmatterHash,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual(expect.objectContaining({ body: 'Single file body.' }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects staged folders outside the controlled staging root without publishing descriptors or active facts', async () => {
    const root = await makeRoot();
    try {
      const remote: SkillHubRemoteAccessPort = {
        async listCandidates() {
          return { status: 'ok', candidates: [remoteCandidate('tree-skill', { contentRef: 'tree:tree-skill', contentHash: 'tree-hash' })] };
        },
        async fetchContent(input) {
          const outside = await makeRoot();
          await writeFile(join(outside, 'SKILL.md'), validSkill('tree-skill'), 'utf8');
          return { status: 'ok', stagingRoot: input.stagingRoot, stagedFolder: outside, contentHash: 'tree-hash' };
        },
      };
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      expect(await readIndex(root)).toEqual([]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'SKILLHUB_ARTIFACT_REJECTED', skillId: 'tree-skill' })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes trusted scope and requested narrowing to remote access and rejects remote scope overrides', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote(
        [{ ...remoteCandidate('other-agent-skill'), agentId: brand<string, 'AgentId'>('other-agent') }, remoteCandidate('narrow-skill')],
        {
          'pkg:narrow-skill': packageEntries('narrow-skill'),
        },
      );
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await discovery.synchronizeRemoteContent(
        { ...searchCriteria(), requestedCapabilityId: brand<string, 'CapabilityId'>('narrow-skill') },
        new AbortController().signal,
      );

      expect(remote.searches[0]).toMatchObject({
        tenantId: 'tenant-skillhub',
        subjectId: 'subject-skillhub',
        agentId: 'default-agent',
        agentVersion: 'v1',
        agentAssemblyRef: 'default-agent:v1',
        requestedCapabilityId: 'narrow-skill',
      });
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([
        expect.objectContaining({ capabilityId: 'narrow-skill' }),
      ]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'SKILLHUB_REMOTE_SCOPE_MISMATCH', skillId: 'other-agent-skill' })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('degrades catalog-triggered synchronization safely for remote unavailable, invalid metadata, credential failure and download failure', async () => {
    const root = await makeRoot();
    try {
      const unavailable = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: failingRemote('unavailable'),
      });
      await expect(unavailable.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      expect(unavailable.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'SKILLHUB_REFRESH_UNAVAILABLE' })]);

      const unauthorized = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: failingRemote('unauthorized'),
      });
      await expect(unauthorized.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      const credentialDiagnostics = JSON.stringify(unauthorized.getReadinessEvidence());
      expect(credentialDiagnostics).toContain('SKILLHUB_REFRESH_UNAVAILABLE');
      expect(credentialDiagnostics).not.toContain('token');
      expect(credentialDiagnostics).not.toContain('raw');

      const invalidRemote = fakeRemote(
        [
          { ...remoteCandidate('Bad Skill'), contentRef: 'pkg:bad' },
          { ...remoteCandidate('empty-ref'), contentRef: '' },
          remoteCandidate('download-fails'),
        ],
        {},
      );
      const invalid = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: invalidRemote });
      await expect(invalid.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      expect(invalidRemote.downloads).toEqual(['pkg:download-fails']);
      expect(invalid.getReadinessEvidence()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ outcomeCode: 'SKILLHUB_REMOTE_METADATA_INVALID' }),
          expect.objectContaining({ outcomeCode: 'SKILLHUB_CONTENT_FETCH_FAILED', skillId: 'download-fails' }),
        ]),
      );
      await expect(invalid.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe packages and never leaks raw managed paths or package layout in diagnostics', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('bad-skill')], {
        'pkg:bad-skill': zipPackage([{ path: '../escape/SKILL.md', content: validSkill('bad-skill') }]),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toMatchObject({
        outcome: 'DEGRADED',
      });
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      const diagnostics = JSON.stringify(discovery.getReadinessEvidence());
      expect(diagnostics).toContain('SKILLHUB_ARTIFACT_REJECTED');
      expect(diagnostics).not.toContain(root);
      expect(diagnostics).not.toContain('../escape');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('covers installer failure boundaries without publishing partial, stale or cross-scope facts', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote(
        [remoteCandidate('missing-manifest'), remoteCandidate('bad-name'), remoteCandidate('oversized-skill'), remoteCandidate('too-many-files')],
        {
          'pkg:missing-manifest': zipPackage([{ path: 'README.md', content: 'not a manifest' }]),
          'pkg:bad-name': packageEntries('different-name'),
          'pkg:oversized-skill': zipPackage([{ path: 'SKILL.md', content: validSkill('oversized-skill', true, 'x'.repeat(3_000)) }]),
          'pkg:too-many-files': zipPackage([
            { path: 'SKILL.md', content: validSkill('too-many-files') },
            { path: 'extra.txt', content: 'extra' },
          ]),
        },
      );
      const discovery = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: remote,
        maxContentBytes: 2_048,
        maxContentFiles: 1,
      });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      const serializedDiagnostics = JSON.stringify(discovery.getReadinessEvidence());
      expect(serializedDiagnostics).toContain('SKILLHUB_ARTIFACT_REJECTED');
      expect(serializedDiagnostics).toContain('SKILLHUB_MANIFEST_INVALID');
      expect(serializedDiagnostics).not.toContain(root);
      expect(serializedDiagnostics).not.toContain('README.md');
      await expect(
        discovery.search({ ...searchCriteria(), agentId: brand<string, 'AgentId'>('other-agent') }, new AbortController().signal),
      ).resolves.toEqual([]);
      const indexContent = await readFile(join(root, 'remote-skill-content-index.json'), 'utf8').catch(() => '');
      expect(indexContent).not.toContain('missing-manifest');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('safe-rejects malformed compressed zip packages without aborting synchronization', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('corrupt-skill')], {
        'pkg:corrupt-skill': corruptDeflateZipPackage('SKILL.md'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'SKILLHUB_ARTIFACT_REJECTED', skillId: 'corrupt-skill' })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores stale loading facts and rejects changed manifests without leaking paths', async () => {
    const root = await makeRoot();
    try {
      const remote = mutableRemote([remoteCandidate('stale-skill')], {
        'pkg:stale-skill': packageEntries('stale-skill'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      await discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal);
      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([
        expect.objectContaining({ capabilityId: 'stale-skill' }),
      ]);

      await writeFile(await indexedManifestFile(root, 'stale-skill'), validSkill('changed-skill'), 'utf8');
      remote.packages = {};
      remote.candidates = [];

      await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
      const serializedDiagnostics = JSON.stringify(discovery.getReadinessEvidence());
      expect(serializedDiagnostics).toContain('SKILLHUB_MANIFEST_INVALID');
      expect(serializedDiagnostics).not.toContain(root);
      expect(serializedDiagnostics).not.toContain('changed-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the previous committed package visible when a replacement package fails before index publish', async () => {
    const root = await makeRoot();
    try {
      const remote = mutableRemote([remoteCandidate('replace-skill', { contentHash: 'replace-skill-v1' })], {
        'pkg:replace-skill': packageEntries('replace-skill', 'Original body.'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toMatchObject({
        outcome: 'SUCCEEDED',
      });

      remote.candidates = [remoteCandidate('replace-skill', { contentHash: 'replace-skill-v2' })];
      remote.packages = {
        'pkg:replace-skill': zipPackage([{ path: 'SKILL.md', content: validSkill('different-name') }]),
      };

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);
      expect(descriptors).toEqual([expect.objectContaining({ capabilityId: 'replace-skill' })]);
      const metadata = descriptors[0]!.metadata as { sourceMetadata: { sourceIdentity: string; frontmatterHash: string } };
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('replace-skill'),
            sourceIdentity: metadata.sourceMetadata.sourceIdentity,
            frontmatterHash: metadata.sourceMetadata.frontmatterHash,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual(expect.objectContaining({ body: 'Original body.' }));
      const index = JSON.parse(await readFile(join(root, 'remote-skill-content-index.json'), 'utf8')) as Array<{
        readonly contentHash?: string;
        readonly packageHash?: string;
        readonly packageVersion?: string;
      }>;
      expect(index).toHaveLength(1);
      expect(index[0]?.contentHash).toBe('replace-skill-v1');
      expect(index[0]).not.toHaveProperty('packageHash');
      expect(index[0]).not.toHaveProperty('packageVersion');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps both installed facts when concurrent synchronizations publish different skills', async () => {
    const root = await makeRoot();
    try {
      const alpha = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: delayedRemote([remoteCandidate('alpha-skill')], {
          'pkg:alpha-skill': packageEntries('alpha-skill'),
        }),
      });
      const beta = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: delayedRemote([remoteCandidate('beta-skill')], {
          'pkg:beta-skill': packageEntries('beta-skill'),
        }),
      });

      await Promise.all([
        alpha.synchronizeRemoteContent(searchCriteria(), new AbortController().signal),
        beta.synchronizeRemoteContent(searchCriteria(), new AbortController().signal),
      ]);

      const index = JSON.parse(await readFile(join(root, 'remote-skill-content-index.json'), 'utf8')) as Array<{ readonly skillId: string }>;
      expect(index.map((item) => item.skillId).sort()).toEqual(['alpha-skill', 'beta-skill']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads canonical body only through source-owned loading facts after catalog resolution', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('body-skill')], {
        'pkg:body-skill': packageEntries('body-skill', 'Use telecom diagnostics carefully.'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      await discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal);
      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);
      const metadata = descriptors[0]!.metadata as { sourceMetadata: { sourceIdentity: string; frontmatterHash: string } };

      const body = await discovery.loadCanonicalBodyView(
        {
          capabilityId: brand<string, 'CapabilityId'>('body-skill'),
          sourceIdentity: metadata.sourceMetadata.sourceIdentity,
          frontmatterHash: metadata.sourceMetadata.frontmatterHash,
        },
        new AbortController().signal,
      );

      expect(body).toEqual(expect.objectContaining({ capabilityId: 'body-skill', providerId: 'hub-a', body: 'Use telecom diagnostics carefully.' }));
      const descriptorText = JSON.stringify(descriptors[0]);
      expect(descriptorText).not.toContain('Use telecom diagnostics carefully.');
      expect(descriptorText).not.toContain(root);
      expect(descriptorText).not.toContain('SKILL.md');
      expect(descriptorText).not.toContain('pkg:body-skill');
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('body-skill'),
            sourceIdentity: 'forged',
            frontmatterHash: metadata.sourceMetadata.frontmatterHash,
          },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();

      await discovery.search({ ...searchCriteria(), agentId: brand<string, 'AgentId'>('other-agent') }, new AbortController().signal);
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('body-skill'),
            sourceIdentity: metadata.sourceMetadata.sourceIdentity,
            frontmatterHash: 'forged-frontmatter',
          },
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts directory entries and custom subdirectory files while deriving descriptors from root SKILL.md', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('resource-skill')], {
        'pkg:resource-skill': zipPackage([
          { path: 'SKILL.md', content: validSkill('resource-skill', true, 'Root body.') },
          { path: 'api/', content: '' },
          { path: 'api/query.yaml', content: 'query: upf\n' },
          { path: 'references/runbook.md', content: 'Check UPF alarms.\n' },
        ]),
      });
      const discovery = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: remote,
        maxContentFiles: 3,
      });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });
      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);
      expect(descriptors).toEqual([expect.objectContaining({ capabilityId: 'resource-skill' })]);
      expect(JSON.stringify(descriptors[0])).not.toContain('api/query.yaml');
      const manifestFile = await indexedManifestFile(root, 'resource-skill');
      await expect(readFile(join(dirname(manifestFile), 'api', 'query.yaml'), 'utf8')).resolves.toBe('query: upf\n');
      await expect(readFile(join(dirname(manifestFile), 'references', 'runbook.md'), 'utf8')).resolves.toBe('Check UPF alarms.\n');
      const metadata = descriptors[0]!.metadata as { sourceMetadata: { sourceIdentity: string; frontmatterHash: string } };
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('resource-skill'),
            sourceIdentity: metadata.sourceMetadata.sourceIdentity,
            frontmatterHash: metadata.sourceMetadata.frontmatterHash,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual(expect.objectContaining({ body: 'Root body.' }));
      const resources = await discovery.listSkillResources(
        {
          skillName: brand<string, 'CapabilityId'>('resource-skill'),
          skillVersion: 'unversioned',
        },
        new AbortController().signal,
      );
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ relativePath: 'api/query.yaml', kind: 'asset' }),
          expect.objectContaining({ relativePath: 'references/runbook.md', kind: 'reference' }),
        ]),
      );
      const runbook = resources.find((resource) => resource.relativePath === 'references/runbook.md')!;
      const loaded = await discovery.readSkillResource(
        {
          skillName: brand<string, 'CapabilityId'>('resource-skill'),
          skillVersion: 'unversioned',
          resource: runbook,
        },
        new AbortController().signal,
      );
      expect(loaded).toEqual(expect.objectContaining({ relativePath: 'references/runbook.md', kind: 'reference' }));
      expect(await projectionEntryText(loaded!)).toBe('Check UPF alarms.\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe zip entries without updating the installed index', async () => {
    const unsafePackages: Array<readonly [string, Uint8Array]> = [
      ['absolute-skill', zipPackage([{ path: '/SKILL.md', content: validSkill('absolute-skill') }])],
      ['drive-skill', zipPackage([{ path: 'C:/tmp/SKILL.md', content: validSkill('drive-skill') }])],
      ['traversal-skill', zipPackage([{ path: '../escape/SKILL.md', content: validSkill('traversal-skill') }])],
      [
        'duplicate-skill',
        zipPackage([
          { path: 'SKILL.md', content: validSkill('duplicate-skill') },
          { path: './SKILL.md', content: validSkill('duplicate-skill') },
        ]),
      ],
      ['control-skill', zipPackage([{ path: 'bad\u0001/SKILL.md', content: validSkill('control-skill') }])],
      ['encrypted-skill', zipPackage([{ path: 'SKILL.md', content: validSkill('encrypted-skill'), flags: 0x1 }])],
      ['unsupported-skill', zipPackage([{ path: 'SKILL.md', content: validSkill('unsupported-skill'), method: 99 }])],
      ['symlink-skill', zipPackage([{ path: 'SKILL.md', content: validSkill('symlink-skill'), externalAttributes: (0o120000 << 16) >>> 0 }])],
    ];

    for (const [skillId, packageBytes] of unsafePackages) {
      const root = await makeRoot();
      try {
        const remote = fakeRemote([remoteCandidate(skillId)], { [`pkg:${skillId}`]: packageBytes });
        const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

        await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
        await expect(discovery.search(searchCriteria(), new AbortController().signal)).resolves.toEqual([]);
        expect(await readIndex(root)).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it('reinstalling the same package reuses one committed directory and one index fact', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('stable-skill')], {
        'pkg:stable-skill': packageEntries('stable-skill'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });
      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });

      expect(await installedDirectoryNames(root)).toHaveLength(1);
      const index = await readIndex(root);
      expect(index).toHaveLength(1);
      expect(index[0]).toMatchObject({ skillId: 'stable-skill', contentHash: 'stable-skill-hash' });
      expect(index[0]).not.toHaveProperty('packageHash');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps committed install ids isolated by provider and assembly scope', async () => {
    const root = await makeRoot();
    try {
      const candidate = remoteCandidate('scoped-install-skill');
      const first = createSkillHubDiscoveryForTesting({
        provider: skillHubProvider,
        managedInstallRoot: root,
        remoteAccess: fakeRemote([candidate], { [candidate.contentRef]: packageEntries('scoped-install-skill') }),
      });
      const secondProvider = { providerId: 'hub-b', providerKind: 'SKILL_HUB' as const };
      const second = createSkillHubDiscoveryForTesting({
        provider: secondProvider,
        managedInstallRoot: root,
        remoteAccess: fakeRemote([candidate], { [candidate.contentRef]: packageEntries('scoped-install-skill') }),
      });

      await expect(first.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });
      await expect(second.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });

      expect(await installedDirectoryNames(root)).toHaveLength(2);
      expect(safeInstallId('hub-a', searchCriteria(), candidate)).not.toBe(
        safeInstallId('hub-a', { ...searchCriteria(), agentAssemblyRef: 'default-agent:v2' }, { ...candidate, agentAssemblyRef: 'default-agent:v2' }),
      );
      const longCriteria = {
        ...searchCriteria(),
        tenantId: brand<string, 'TenantId'>(`tenant-${'a'.repeat(220)}`),
        subjectId: brand<string, 'SubjectId'>(`subject-${'b'.repeat(220)}`),
      };
      expect(safeInstallId('hub-a', longCriteria, { ...candidate, contentHash: `hash-${'x'.repeat(220)}-one` })).not.toBe(
        safeInstallId('hub-a', longCriteria, { ...candidate, contentHash: `hash-${'x'.repeat(220)}-two` }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the previous indexed package visible when publishing a replacement cannot rename staging to committed', async () => {
    const root = await makeRoot();
    try {
      const remote = mutableRemote([remoteCandidate('publish-skill', { contentHash: 'publish-v1' })], {
        'pkg:publish-skill': packageEntries('publish-skill', 'Original body.'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });

      const replacementCandidate = remoteCandidate('publish-skill', { contentHash: 'publish-v2' });
      await mkdir(join(root, 'installed'), { recursive: true });
      await writeFile(
        join(root, 'installed', safeInstallId(skillHubProvider.providerId, searchCriteria(), replacementCandidate)),
        'blocks replacement',
        'utf8',
      );
      remote.candidates = [replacementCandidate];
      remote.packages = { 'pkg:publish-skill': packageEntries('publish-skill', 'Replacement body.') };

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'DEGRADED' });
      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);
      expect(descriptors).toEqual([expect.objectContaining({ capabilityId: 'publish-skill' })]);
      const metadata = descriptors[0]!.metadata as { sourceMetadata: { sourceIdentity: string; frontmatterHash: string } };
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('publish-skill'),
            sourceIdentity: metadata.sourceMetadata.sourceIdentity,
            frontmatterHash: metadata.sourceMetadata.frontmatterHash,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual(expect.objectContaining({ body: 'Original body.' }));
      expect(await readIndex(root)).toEqual([expect.objectContaining({ skillId: 'publish-skill', contentHash: 'publish-v1' })]);
      expect((await readIndex(root))[0]).not.toHaveProperty('packageHash');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('upgrading a skill replaces the index fact and cleans the older committed directory', async () => {
    const root = await makeRoot();
    try {
      const remote = mutableRemote([remoteCandidate('upgrade-skill', { contentHash: 'upgrade-v1' })], {
        'pkg:upgrade-skill': packageEntries('upgrade-skill', 'Version one.'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });
      const oldPackageDir = dirname(await indexedManifestFile(root, 'upgrade-skill'));

      remote.candidates = [remoteCandidate('upgrade-skill', { contentHash: 'upgrade-v2' })];
      remote.packages = { 'pkg:upgrade-skill': packageEntries('upgrade-skill', 'Version two.') };

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });
      const index = await readIndex(root);
      expect(index).toHaveLength(1);
      expect(index[0]).toMatchObject({ skillId: 'upgrade-skill', contentHash: 'upgrade-v2' });
      expect(index[0]).not.toHaveProperty('packageHash');
      await expect(stat(oldPackageDir)).rejects.toMatchObject({ code: 'ENOENT' });
      const descriptors = await discovery.search(searchCriteria(), new AbortController().signal);
      const metadata = descriptors[0]!.metadata as { sourceMetadata: { sourceIdentity: string; frontmatterHash: string } };
      await expect(
        discovery.loadCanonicalBodyView(
          {
            capabilityId: brand<string, 'CapabilityId'>('upgrade-skill'),
            sourceIdentity: metadata.sourceMetadata.sourceIdentity,
            frontmatterHash: metadata.sourceMetadata.frontmatterHash,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual(expect.objectContaining({ body: 'Version two.' }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not clean the managed install root when an old index fact points at the root', async () => {
    const root = await makeRoot();
    try {
      const installedRoot = join(root, 'installed');
      await mkdir(installedRoot, { recursive: true });
      await writeFile(
        join(root, 'skillhub-index.json'),
        JSON.stringify([
          {
            tenantId: tenantId(),
            subjectId: subjectId(),
            agentId: 'default-agent',
            agentVersion: 'v1',
            agentAssemblyRef: 'default-agent:v1',
            providerId: 'hub-a',
            skillId: 'root-cleanup-skill',
            packageVersion: 'v1',
            packageHash: 'old-hash',
            manifestFile: join(installedRoot, 'SKILL.md'),
            sourceIdentity: 'old-source',
            frontmatterHash: 'old-frontmatter',
          },
        ]),
        'utf8',
      );
      const remote = fakeRemote([remoteCandidate('root-cleanup-skill', { contentHash: 'new-hash' })], {
        'pkg:root-cleanup-skill': packageEntries('root-cleanup-skill', 'New body.'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });

      await expect(discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal)).resolves.toEqual({ outcome: 'SUCCEEDED' });

      await expect(stat(installedRoot)).resolves.toEqual(expect.objectContaining({}));
      expect(await installedDirectoryNames(root)).toHaveLength(1);
      expect(await readIndex(root)).toEqual([expect.objectContaining({ skillId: 'root-cleanup-skill', contentHash: 'new-hash' })]);
      expect((await readIndex(root))[0]).not.toHaveProperty('packageHash');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('SkillHub catalog governance', () => {
  it('applies disabled bindings, modelInvocable filtering, cross-Agent isolation and lower priority than local sources', async () => {
    const root = await makeRoot();
    const localRoot = await makeRoot();
    try {
      await writeSkill(localRoot, 'same-skill');
      const remote = fakeRemote([remoteCandidate('same-skill'), remoteCandidate('hidden-skill')], {
        'pkg:same-skill': packageEntries('same-skill'),
        'pkg:hidden-skill': packageEntries('hidden-skill', '', false),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      const local = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: localRoot });
      const catalog = new StaticCapabilityCatalog([], {
        eagerDiscoveries: [local],
        searchDiscoveries: [discovery],
        skillSourceDiscoveries: [local, discovery],
        skillHubSourceAuthorization: authorizeSkillHubProvider,
      });

      await discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal);

      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'same-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
          modelInvocable: true,
        }),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'same-skill', provider: localSkillsSystemProvider })]);
      expect(catalog.getSkillHubGovernanceEvidence()).toEqual(
        expect.arrayContaining([expect.objectContaining({ outcomeCode: 'SKILLHUB_SKILL_SHADOWED', skillId: 'same-skill' })]),
      );
      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'same-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }], 'other-agent'),
          includeUnavailable: false,
        }),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'same-skill', provider: localSkillsSystemProvider })]);
      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'hidden-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: false }]),
          includeUnavailable: false,
          modelInvocable: false,
        }),
      ).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(localRoot, { recursive: true, force: true });
    }
  });

  it('covers catalog visibility matrix for uninstalled, installed, disabled, conflicts and cross-Agent isolation', async () => {
    const root = await makeRoot();
    const localRoot = await makeRoot();
    try {
      await writeSkill(localRoot, 'shared-skill');
      const remote = fakeRemote([remoteCandidate('shared-skill'), remoteCandidate('remote-only'), remoteCandidate('hidden-skill')], {
        'pkg:shared-skill': packageEntries('shared-skill'),
        'pkg:remote-only': packageEntries('remote-only'),
        'pkg:hidden-skill': packageEntries('hidden-skill', '', false),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      const disabledDiscovery = createSkillHubDiscoveryForTesting({
        provider: { providerId: 'disabled-hub', providerKind: 'SKILL_HUB' },
        managedInstallRoot: root,
        remoteAccess: remote,
        enabled: false,
      });
      const local = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: localRoot });
      const catalog = new StaticCapabilityCatalog([], {
        eagerDiscoveries: [local],
        searchDiscoveries: [discovery, disabledDiscovery],
        skillSourceDiscoveries: [local, discovery, disabledDiscovery],
        skillHubSourceAuthorization: authorizeSkillHubProvider,
      });

      await expect(
        catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'shared-skill', provider: localSkillsSystemProvider })]);

      await discovery.synchronizeRemoteContent(searchCriteria(), new AbortController().signal);

      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([]),
          includeUnavailable: false,
          modelInvocable: true,
        }),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'shared-skill', provider: localSkillsSystemProvider })]);
      await expect(
        catalog.resolve({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([]),
          capabilityId: brand<string, 'CapabilityId'>('remote-only'),
        }),
      ).resolves.toBeUndefined();

      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'remote-only', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
          modelInvocable: true,
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ capabilityId: 'shared-skill', provider: localSkillsSystemProvider }),
          expect.objectContaining({ capabilityId: 'remote-only', provider: skillHubProvider }),
        ]),
      );
      await expect(
        catalog.resolve({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'remote-only', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          capabilityId: brand<string, 'CapabilityId'>('remote-only'),
        }),
      ).resolves.toEqual(expect.objectContaining({ capabilityId: 'remote-only', provider: skillHubProvider }));
      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'remote-only', capabilityType: 'SKILL', providerId: 'hub-a', enabled: false }]),
          includeUnavailable: false,
        }),
      ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'remote-only', provider: skillHubProvider })]));
      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([], 'other-agent'),
          includeUnavailable: false,
        }),
      ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'remote-only', provider: skillHubProvider })]));
      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'disabled-skill', capabilityType: 'SKILL', providerId: 'disabled-hub', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ provider: expect.objectContaining({ providerId: 'disabled-hub' }) })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(localRoot, { recursive: true, force: true });
    }
  });

  it('rechecks local source authorization before catalog SkillHub search exposes installed facts', async () => {
    const root = await makeRoot();
    try {
      let authorized = true;
      const remote = fakeRemote([remoteCandidate('revoked-skill')], {
        'pkg:revoked-skill': packageEntries('revoked-skill'),
      });
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: skillHubProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: () => authorized,
      });

      await expect(
        subsystem.catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'revoked-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'revoked-skill', provider: skillHubProvider })]));
      authorized = false;

      await expect(
        subsystem.catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'revoked-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'revoked-skill', provider: skillHubProvider })]));
      await expect(
        subsystem.catalog.resolve({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'revoked-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          capabilityId: brand<string, 'CapabilityId'>('revoked-skill'),
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when catalog has no SkillHub source authorization policy', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('unpolicy-skill')], {
        'pkg:unpolicy-skill': packageEntries('unpolicy-skill'),
      });
      const discovery = createSkillHubDiscoveryForTesting({ provider: skillHubProvider, managedInstallRoot: root, remoteAccess: remote });
      const catalog = new StaticCapabilityCatalog([], {
        searchDiscoveries: [discovery],
        skillSourceDiscoveries: [discovery],
      });

      await expect(
        catalog.listAvailable({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'unpolicy-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          includeUnavailable: false,
        }),
      ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'unpolicy-skill', provider: skillHubProvider })]));
      await expect(
        catalog.resolve({
          tenantId: tenantId(),
          subjectId: subjectId(),
          agentAssembly: assembly([{ capabilityId: 'unpolicy-skill', capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
          capabilityId: brand<string, 'CapabilityId'>('unpolicy-skill'),
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes a governed SkillHub Skill through the normal Skill Tool invocation path', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('invoke-skill')], {
        'pkg:invoke-skill': packageEntries('invoke-skill', 'Use OSS alarm correlation.'),
      });
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: skillHubProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: authorizeSkillHubProvider,
      });
      const result = await subsystem.invocationPort.invoke(skillInvocation('invoke-skill'), new AbortController().signal, {
        capabilityResolver: scopedResolver((request) =>
          subsystem.catalog.resolve({
            tenantId: tenantId(),
            subjectId: subjectId(),
            agentAssembly: assembly([{ capabilityId: request.capabilityId, capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
            capabilityId: request.capabilityId,
          }),
        ),
      });

      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        structuredPayload: { name: 'invoke-skill', status: 'loaded' },
      });
      expect(result.metadata).toMatchObject({ agenticSkillLoaded: true, skillName: 'invoke-skill', providerId: 'hub-a' });
      expect(result.generatedMessages).toEqual([
        expect.objectContaining({ role: 'USER', meta: true, content: expect.stringContaining('Use OSS alarm correlation.') }),
      ]);
      expect(JSON.stringify(result.structuredPayload)).not.toContain('Use OSS alarm correlation.');
      const serializedSafeSurface = JSON.stringify({
        structuredPayload: result.structuredPayload,
        metadata: result.metadata,
        safeError: result.safeError,
        artifactRefs: result.artifactRefs,
      });
      expect(serializedSafeSurface).not.toContain(root);
      expect(serializedSafeSurface).not.toContain('skillhub.example');
      expect(serializedSafeSurface).not.toContain('pkg:invoke-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('safe-fails unsafe SkillHub bodies without exposing the raw body or loading facts in the tool result', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote([remoteCandidate('leaky-skill')], {
        'pkg:leaky-skill': packageEntries('leaky-skill', 'token=very-secret\nC:/private/install/SKILL.md'),
      });
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: skillHubProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: authorizeSkillHubProvider,
      });
      const result = await subsystem.invocationPort.invoke(skillInvocation('leaky-skill'), new AbortController().signal, {
        capabilityResolver: scopedResolver((request) =>
          subsystem.catalog.resolve({
            tenantId: tenantId(),
            subjectId: subjectId(),
            agentAssembly: assembly([{ capabilityId: request.capabilityId, capabilityType: 'SKILL', providerId: 'hub-a', enabled: true }]),
            capabilityId: request.capabilityId,
          }),
        ),
      });

      expect(result).toMatchObject({
        status: 'FAILED',
        safeError: { code: 'EXECUTION_FAILED', category: 'VALIDATION' },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('very-secret');
      expect(serialized).not.toContain('C:/private');
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain('pkg:leaky-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function scopedResolver(resolveCapability: (request: { readonly capabilityId: CapabilityId }) => Promise<CapabilityDescriptor | undefined>) {
  return { resolveCapability };
}

function authorizeSkillHubProvider(request: { readonly providerId: string; readonly agentId: string }): boolean {
  return request.providerId === 'hub-a' && request.agentId === 'default-agent';
}

function fakeRemote(
  candidates: ReadonlyArray<ReturnType<typeof remoteCandidate>>,
  packages: Record<string, Uint8Array>,
): SkillHubRemoteAccessPort & { searches: unknown[]; downloads: string[] } {
  const searches: unknown[] = [];
  const downloads: string[] = [];
  const factsByRef = new Map(candidates.map((candidate) => [candidate.contentRef, candidate]));
  return {
    searches,
    downloads,
    async listCandidates(input) {
      searches.push(input);
      return { status: 'ok', candidates };
    },
    async fetchContent(input) {
      downloads.push(input.contentRef);
      const contentBytes = packages[input.contentRef];
      if (contentBytes === undefined) {
        return { status: 'failed', reasonCode: 'download-failed' };
      }
      const stagedFolder = await materializeZipToStagedFolder(input.stagingRoot, input.contentRef, contentBytes);
      const facts = factsByRef.get(input.contentRef);
      return {
        status: 'ok',
        stagingRoot: input.stagingRoot,
        stagedFolder,
        ...(facts?.contentVersion === undefined ? {} : { contentVersion: facts.contentVersion }),
        ...(facts?.contentHash === undefined ? {} : { contentHash: facts.contentHash }),
      };
    },
  };
}

function failingRemote(reasonCode: 'unavailable' | 'unauthorized'): SkillHubRemoteAccessPort {
  return {
    async listCandidates() {
      return { status: 'failed', reasonCode, message: 'raw token failure should stay hidden' };
    },
    async fetchContent() {
      throw new Error('fetch should not be called');
    },
  };
}

function remoteCandidate(skillId: string, overrides: Partial<ReturnType<typeof remoteCandidateShape>> = {}) {
  return {
    ...remoteCandidateShape(skillId),
    ...overrides,
  };
}

function remoteCandidateShape(skillId: string) {
  return {
    skillId,
    contentRef: `pkg:${skillId}`,
    contentVersion: '1.0.0',
    contentHash: `${skillId}-hash`,
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
  };
}

function packageEntries(name: string, body = '', modelInvocable = true) {
  return zipPackage([{ path: 'SKILL.md', content: validSkill(name, modelInvocable, body) }]);
}

interface TestExtractedZipFile {
  readonly path: string;
  readonly content: string;
}

type TestZipExtractionResult = { readonly status: 'ok'; readonly files: readonly TestExtractedZipFile[] } | { readonly status: 'rejected' };

async function materializeZipToStagedFolder(stagingRoot: string, contentRef: string, contentBytes: Uint8Array): Promise<string> {
  const extracted = extractZipPackageForFakeGateway(contentBytes, 128, 256 * 1024);
  const stagedFolder = join(stagingRoot, contentRef.replace(/[^A-Za-z0-9._-]/gu, '_'));
  await rm(stagedFolder, { recursive: true, force: true });
  await mkdir(stagedFolder, { recursive: true });
  if (extracted.status === 'rejected') {
    await writeFile(join(stagedFolder, 'INVALID'), 'rejected', 'utf8');
    return stagedFolder;
  }
  for (const entry of extracted.files) {
    const target = resolve(stagedFolder, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.content, 'utf8');
  }
  return stagedFolder;
}

function extractZipPackageForFakeGateway(packageBytes: Uint8Array, maxFiles: number, maxBytes: number): TestZipExtractionResult {
  try {
    return extractZipPackageForFakeGatewayUnsafe(packageBytes, maxFiles, maxBytes);
  } catch {
    return { status: 'rejected' };
  }
}

function extractZipPackageForFakeGatewayUnsafe(packageBytes: Uint8Array, maxFiles: number, maxBytes: number): TestZipExtractionResult {
  const archive = Buffer.from(packageBytes);
  const eocdOffset = findEndOfCentralDirectory(archive);
  if (eocdOffset === undefined) {
    return { status: 'rejected' };
  }
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0 || centralOffset + centralSize > archive.length) {
    return { status: 'rejected' };
  }
  const files: TestExtractedZipFile[] = [];
  const seen = new Set<string>();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      return { status: 'rejected' };
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
    if (nextCursor > archive.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      return { status: 'rejected' };
    }
    const rawPath = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor = nextCursor;
    if ((flags & 0x1) !== 0 || !isSupportedCompressionMethod(method) || isUnsafeZipFileType(rawPath, externalAttributes)) {
      return { status: 'rejected' };
    }
    const isDirectory = rawPath.endsWith('/');
    const safePath = normalizePackagePath(rawPath);
    if (safePath === undefined) {
      return { status: 'rejected' };
    }
    if (isDirectory) {
      continue;
    }
    if (seen.has(safePath)) {
      return { status: 'rejected' };
    }
    seen.add(safePath);
    const compressed = readLocalFileData(archive, localOffset, compressedSize);
    if (compressed === undefined) {
      return { status: 'rejected' };
    }
    const content = method === 0 ? compressed : inflateRawSync(compressed);
    if (content.length !== uncompressedSize) {
      return { status: 'rejected' };
    }
    totalBytes += content.length;
    if (files.length + 1 > maxFiles || totalBytes > maxBytes) {
      return { status: 'rejected' };
    }
    files.push({ path: safePath, content: content.toString('utf8') });
  }
  return files.some((file) => file.path === 'SKILL.md') ? { status: 'ok', files } : { status: 'rejected' };
}

function findEndOfCentralDirectory(archive: Buffer): number | undefined {
  const minOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return undefined;
}

function isSupportedCompressionMethod(method: number): boolean {
  return method === 0 || method === 8;
}

function isUnsafeZipFileType(path: string, externalAttributes: number): boolean {
  const unixMode = externalAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  return fileType !== 0 && fileType !== 0o100000 && !(path.endsWith('/') && fileType === 0o040000);
}

function normalizePackagePath(path: string): string | undefined {
  if (isUnsafePackagePath(path)) {
    return undefined;
  }
  const normalized = normalize(path).replace(/\\/gu, '/');
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function readLocalFileData(archive: Buffer, localOffset: number, compressedSize: number): Buffer | undefined {
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
    return undefined;
  }
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  return dataEnd > archive.length ? undefined : archive.subarray(dataStart, dataEnd);
}

function isUnsafePackagePath(path: string): boolean {
  const normalized = normalize(path).replace(/\\/gu, '/');
  const segmentPath = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = segmentPath.split('/');
  return (
    path.trim().length === 0 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path) ||
    segmentPath.length === 0 ||
    segmentPath === '..' ||
    segmentPath.startsWith('../') ||
    parts.some((part) => part === '' || part === '..' || part.startsWith('.') || /[\u0000-\u001f]/u.test(part) || /[<>:"|?*]/u.test(part))
  );
}

async function writeStagedFolder(
  stagingRoot: string,
  name: string,
  entries: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): Promise<string> {
  const stagedFolder = join(stagingRoot, name);
  await rm(stagedFolder, { recursive: true, force: true });
  await mkdir(stagedFolder, { recursive: true });
  for (const entry of entries) {
    const target = resolve(stagedFolder, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.content, 'utf8');
  }
  return stagedFolder;
}

function mutableRemote(
  candidates: ReadonlyArray<ReturnType<typeof remoteCandidate>>,
  packages: Record<string, Uint8Array>,
): SkillHubRemoteAccessPort & {
  searches: unknown[];
  downloads: string[];
  candidates: ReadonlyArray<ReturnType<typeof remoteCandidate>>;
  packages: Record<string, Uint8Array>;
} {
  const state = {
    searches: [] as unknown[],
    downloads: [] as string[],
    candidates,
    packages,
  };
  return {
    ...state,
    async listCandidates(input) {
      state.searches.push(input);
      return { status: 'ok', candidates: state.candidates };
    },
    async fetchContent(input) {
      state.downloads.push(input.contentRef);
      const contentBytes = state.packages[input.contentRef];
      if (contentBytes === undefined) {
        return { status: 'failed', reasonCode: 'download-failed' };
      }
      const stagedFolder = await materializeZipToStagedFolder(input.stagingRoot, input.contentRef, contentBytes);
      const facts = state.candidates.find((candidate) => candidate.contentRef === input.contentRef);
      return {
        status: 'ok',
        stagingRoot: input.stagingRoot,
        stagedFolder,
        ...(facts?.contentVersion === undefined ? {} : { contentVersion: facts.contentVersion }),
        ...(facts?.contentHash === undefined ? {} : { contentHash: facts.contentHash }),
      };
    },
    get searches() {
      return state.searches;
    },
    get downloads() {
      return state.downloads;
    },
    get candidates() {
      return state.candidates;
    },
    set candidates(value) {
      state.candidates = value;
    },
    get packages() {
      return state.packages;
    },
    set packages(value) {
      state.packages = value;
    },
  };
}

function delayedRemote(
  candidates: ReadonlyArray<ReturnType<typeof remoteCandidate>>,
  packages: Record<string, Uint8Array>,
  delayMs = 5,
): SkillHubRemoteAccessPort {
  return {
    async listCandidates(input, signal) {
      await delay(delayMs);
      return fakeRemote(candidates, packages).listCandidates(input, signal);
    },
    async fetchContent(input, signal) {
      await delay(delayMs);
      return fakeRemote(candidates, packages).fetchContent(input, signal);
    },
  };
}

function zipPackage(
  entries: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
    readonly externalAttributes?: number;
    readonly flags?: number;
    readonly method?: number;
  }>,
): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(entry.method ?? 0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, content);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags ?? 0, 8);
    header.writeUInt16LE(entry.method ?? 0, 10);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(content.length, 20);
    header.writeUInt32LE(content.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + content.length;
  }
  const centralOffset = offset;
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, centralBytes, end]);
}

function corruptDeflateZipPackage(path: string): Uint8Array {
  const name = Buffer.from(path, 'utf8');
  const compressed = Buffer.from('not-deflate-data', 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(8, 10);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(64, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(64, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + compressed.length;
  const centralBytes = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, compressed, centralBytes, end]);
}

function validSkill(name: string, modelInvocable = true, body = ''): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: ${modelInvocable ? 'true' : 'false'}\n---\n${body}`;
}

function invalidSkillWithDiagnosticCanary(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncredential-sk-leak-canary: do-not-log\n---\n`;
}

function skillInvocation(name: string): CapabilityInvocationRequest {
  return {
    invocationId: `invoke-${name}`,
    capabilityId: brand<string, 'CapabilityId'>('Skill'),
    arguments: { name },
    sessionId: brand<string, 'SessionId'>('session-skillhub'),
    requestId: brand<string, 'MessageId'>('request-skillhub'),
    runId: brand<string, 'RequestRunId'>('run-skillhub'),
    requestContextId: brand<string, 'RequestContextId'>('context-skillhub'),
    stepId: 'step-skillhub',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'SkillHub test subject' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
  };
}

async function writeSkill(root: string, name: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), validSkill(name), 'utf8');
}

async function indexedManifestFile(root: string, skillId: string): Promise<string> {
  const index = JSON.parse(await readFile(join(root, 'remote-skill-content-index.json'), 'utf8')) as Array<{
    readonly skillId: string;
    readonly manifestFile: string;
  }>;
  const fact = index.find((item) => item.skillId === skillId);
  if (fact === undefined) {
    throw new Error(`Missing indexed SkillHub fact for ${skillId}`);
  }
  return fact.manifestFile;
}

async function readIndex(root: string): Promise<
  Array<{
    readonly skillId: string;
    readonly contentHash?: string;
    readonly packageHash?: string;
    readonly packageVersion?: string;
    readonly manifestFile: string;
  }>
> {
  const content = await readFile(join(root, 'remote-skill-content-index.json'), 'utf8').catch(() => '[]');
  return JSON.parse(content) as Array<{
    readonly skillId: string;
    readonly contentHash?: string;
    readonly packageHash?: string;
    readonly packageVersion?: string;
    readonly manifestFile: string;
  }>;
}

async function installedDirectoryNames(root: string): Promise<readonly string[]> {
  return (await readdir(join(root, 'installed'), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function searchCriteria() {
  return {
    tenantId: tenantId(),
    subjectId: subjectId(),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
  };
}

function currentCriteria(): CapabilityCurrentDiscoveryCriteria {
  return {
    ...searchCriteria(),
    sessionId: brand<string, 'SessionId'>('session-skillhub-current'),
  };
}

function requireCurrentReader(discovery: CapabilityDiscovery) {
  if (discovery.listCurrent === undefined) {
    throw new Error('Expected SkillHub discovery to expose listCurrent.');
  }
  return discovery.listCurrent.bind(discovery);
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
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nextagent-skillhub-'));
}

async function projectionEntryText(entry: { readonly contentStream: AsyncIterable<Uint8Array> }): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  for await (const chunk of entry.contentStream) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-skillhub');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-skillhub');
}
