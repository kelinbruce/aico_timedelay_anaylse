import { brand, isPathInside } from '@nextagent/agent-common';
import type { CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';

import type { CapabilitySearchCriteria } from '../discovery/discovery.js';
import { defaultSkillDocumentService } from '../skills/skill-manifest.js';
import { safeInstallId, sourceIdentity, withArtifactFacts } from './skillhub-remote-candidate.js';
import type { SkillHubEvidenceSink, SkillHubLoadingFact, SkillHubRemoteCandidate, SkillHubRemoteContentResult } from './skillhub-types.js';
import type { SkillHubInstalledIndex } from './skillhub-installed-index.js';

export class RemoteSkillContentInstaller {
  private readonly provider: CapabilityProviderIdentity & { readonly providerKind: 'SKILL_HUB' };
  private readonly managedInstallRoot: string;
  private readonly maxContentBytes: number;
  private readonly maxContentFiles: number;
  private readonly index: SkillHubInstalledIndex;
  private readonly emitEvidence: SkillHubEvidenceSink;

  constructor(options: {
    readonly provider: CapabilityProviderIdentity & { readonly providerKind: 'SKILL_HUB' };
    readonly managedInstallRoot: string;
    readonly maxContentBytes: number;
    readonly maxContentFiles: number;
    readonly index: SkillHubInstalledIndex;
    readonly emitEvidence: SkillHubEvidenceSink;
  }) {
    this.provider = options.provider;
    this.managedInstallRoot = options.managedInstallRoot;
    this.maxContentBytes = options.maxContentBytes;
    this.maxContentFiles = options.maxContentFiles;
    this.index = options.index;
    this.emitEvidence = options.emitEvidence;
  }

  async installContent(
    candidate: SkillHubRemoteCandidate,
    artifact: Extract<SkillHubRemoteContentResult, { readonly status: 'ok' }>,
    criteria: CapabilitySearchCriteria,
  ): Promise<boolean> {
    const stagedFolder = resolve(artifact.stagedFolder);
    const stagingRoot = resolve(artifact.stagingRoot);
    if (!(await this.isValidStagedFolder(stagingRoot, stagedFolder))) {
      this.emitEvidence('SKILLHUB_ARTIFACT_REJECTED', 'Remote Skill content artifact was rejected.', criteria, candidate.skillId);
      return false;
    }
    const skillId = brand<string, 'CapabilityId'>(candidate.skillId);
    const contentVersion = artifact.contentVersion ?? candidate.contentVersion;
    const contentHash = artifact.contentHash ?? candidate.contentHash;
    const identityCandidate = withArtifactFacts(candidate, {
      ...(contentVersion === undefined ? {} : { contentVersion }),
      ...(contentHash === undefined ? {} : { contentHash }),
    });
    const installId = safeInstallId(this.provider.providerId, criteria, identityCandidate);
    const committed = join(this.managedInstallRoot, 'installed', installId);
    let backup: string | undefined;
    try {
      const manifestFile = join(stagedFolder, 'SKILL.md');
      let parsed: ReturnType<typeof defaultSkillDocumentService.parseMetadataView>;
      try {
        parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
          manifestFile,
          provider: this.provider,
          safeCandidateName: candidate.skillId,
        });
      } catch {
        this.emitEvidence('SKILLHUB_MANIFEST_MISSING', 'SkillHub manifest is missing.', criteria, candidate.skillId);
        return false;
      }
      if (parsed.outcome === 'rejected') {
        this.emitEvidence('SKILLHUB_MANIFEST_INVALID', 'SkillHub manifest is invalid.', criteria, candidate.skillId);
        return false;
      }
      await mkdir(join(this.managedInstallRoot, 'installed'), { recursive: true });
      const fact: SkillHubLoadingFact = {
        tenantId: criteria.tenantId,
        subjectId: criteria.subjectId,
        agentId: criteria.agentId,
        agentVersion: criteria.agentVersion,
        agentAssemblyRef: criteria.agentAssemblyRef,
        providerId: this.provider.providerId,
        skillId,
        ...(contentVersion === undefined ? {} : { contentVersion }),
        ...(contentHash === undefined ? {} : { contentHash }),
        manifestFile: join(committed, 'SKILL.md'),
        sourceIdentity: sourceIdentity(this.provider.providerId, criteria, identityCandidate),
        frontmatterHash: parsed.consistency?.frontmatterHash ?? '',
      };
      const cleanupTargets = await this.cleanupTargetsForReplacedFacts(fact, committed);
      const existing = await stat(committed).catch(() => undefined);
      if (existing !== undefined) {
        if (!existing.isDirectory()) {
          this.emitEvidence('SKILLHUB_INSTALL_INCOMPLETE', 'Remote Skill content install failed safely.', criteria, candidate.skillId);
          return false;
        }
        await mkdir(join(this.managedInstallRoot, 'quarantine'), { recursive: true });
        backup = join(this.managedInstallRoot, 'quarantine', `${installId}.bak-${randomUUID()}`);
        await rename(committed, backup);
      }
      try {
        await rename(stagedFolder, committed);
      } catch (error) {
        if (backup !== undefined) {
          await rename(backup, committed).catch(() => undefined);
        }
        throw error;
      }
      await this.index.merge([fact]);
      await this.cleanupCommittedContent([...(backup === undefined ? [] : [backup]), ...cleanupTargets], committed);
      this.emitEvidence('SKILLHUB_CANDIDATE_INSTALLED', 'SkillHub candidate was installed.', criteria, candidate.skillId);
      return true;
    } finally {
      await rm(stagedFolder, { recursive: true, force: true });
    }
  }

  private async isValidStagedFolder(stagingRoot: string, stagedFolder: string): Promise<boolean> {
    if (!isStrictPathInside(stagingRoot, stagedFolder) || isPathInside(join(this.managedInstallRoot, 'installed'), stagedFolder)) {
      return false;
    }
    const rootStats = await lstat(stagedFolder).catch(() => undefined);
    if (rootStats === undefined || !rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return false;
    }
    const manifest = resolve(stagedFolder, 'SKILL.md');
    const intake = await this.inspectStagedFolder(stagedFolder, stagedFolder);
    return (
      intake.ok &&
      intake.hasRootManifest &&
      (await lstat(manifest)
        .then((stats) => stats.isFile() && !stats.isSymbolicLink())
        .catch(() => false))
    );
  }

  private async inspectStagedFolder(
    root: string,
    current: string,
    state: { count: number; bytes: number; hasRootManifest: boolean } = { count: 0, bytes: 0, hasRootManifest: false },
  ): Promise<{ readonly ok: boolean; readonly hasRootManifest: boolean }> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => undefined);
    if (entries === undefined) {
      return { ok: false, hasRootManifest: state.hasRootManifest };
    }
    for (const entry of entries) {
      const target = resolve(current, entry.name);
      if (!isPathInside(root, target)) {
        return { ok: false, hasRootManifest: state.hasRootManifest };
      }
      const stats = await lstat(target).catch(() => undefined);
      if (stats === undefined || stats.isSymbolicLink()) {
        return { ok: false, hasRootManifest: state.hasRootManifest };
      }
      const isRootManifest = target === resolve(root, 'SKILL.md');
      if (!isRootManifest && basename(target) === 'SKILL.md') {
        return { ok: false, hasRootManifest: state.hasRootManifest };
      }
      if (stats.isDirectory()) {
        const nested = await this.inspectStagedFolder(root, target, state);
        if (!nested.ok) {
          return nested;
        }
        continue;
      }
      if (!stats.isFile() || stats.nlink > 1) {
        return { ok: false, hasRootManifest: state.hasRootManifest };
      }
      state.count += 1;
      state.bytes += stats.size;
      if (state.count > this.maxContentFiles || state.bytes > this.maxContentBytes || stats.size > this.maxContentBytes) {
        return { ok: false, hasRootManifest: state.hasRootManifest };
      }
      if (isRootManifest) {
        state.hasRootManifest = true;
      }
    }
    return { ok: true, hasRootManifest: state.hasRootManifest };
  }

  private async cleanupTargetsForReplacedFacts(newFact: SkillHubLoadingFact, committed: string): Promise<readonly string[]> {
    const facts = await this.index.read();
    const targets = new Set<string>();
    for (const fact of facts) {
      if (!sameSkillKey(fact, newFact) || sameContentConsistency(fact, newFact)) {
        continue;
      }
      const target = dirname(fact.manifestFile);
      if (target !== committed && this.isManagedInstallTarget(target)) {
        targets.add(target);
      }
    }
    return [...targets];
  }

  private async cleanupCommittedContent(targets: readonly string[], committed: string): Promise<void> {
    await Promise.all(
      targets.map(async (target) => {
        if (target !== committed && this.isManagedInstallTarget(target)) {
          await rm(target, { recursive: true, force: true }).catch(() => undefined);
        }
      }),
    );
  }

  private isManagedInstallTarget(target: string): boolean {
    const resolvedTarget = resolve(target);
    return (
      isStrictPathInside(join(this.managedInstallRoot, 'installed'), resolvedTarget) ||
      isStrictPathInside(join(this.managedInstallRoot, 'quarantine'), resolvedTarget)
    );
  }
}

function sameContentConsistency(left: SkillHubLoadingFact, right: SkillHubLoadingFact): boolean {
  return left.contentHash === right.contentHash && left.contentVersion === right.contentVersion;
}

function isStrictPathInside(parent: string, target: string): boolean {
  const resolvedParent = resolve(parent);
  return target !== resolvedParent && isPathInside(resolvedParent, target);
}

function sameSkillKey(left: SkillHubLoadingFact, right: SkillHubLoadingFact): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.subjectId === right.subjectId &&
    left.agentId === right.agentId &&
    left.agentVersion === right.agentVersion &&
    left.agentAssemblyRef === right.agentAssemblyRef &&
    left.providerId === right.providerId &&
    left.skillId === right.skillId
  );
}
