import type { CapabilityId } from '@nextagent/agent-common';
import type { CapabilityCurrentDiscoveryCriteria, CapabilityDescriptor, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';

import type { CapabilityDiscovery, CapabilitySearchCriteria } from '../discovery/discovery.js';
import { defaultSkillDocumentService, type SkillCanonicalBodyView } from '../skills/skill-manifest.js';
import {
  listSkillResourcesFromDirectory,
  readSkillResourceFromDirectory,
  type SkillResourceMetadata,
  type SkillSourceDiscovery,
  type SkillSourceRequest,
} from '../skills/skill-source-discovery.js';
import { dirname, join } from 'node:path';
import { SkillHubInstalledIndex } from './skillhub-installed-index.js';
import { RemoteSkillContentInstaller } from './remote-skill-content-installer.js';
import { matchesScope, remoteListInput, safeSkillId, validateRemoteCandidate } from './skillhub-remote-candidate.js';
import type { SkillHubReadinessEvidence, SkillHubReadinessOutcomeCode, SkillHubRemoteAccessPort } from './skillhub-types.js';

export type {
  SkillHubReadinessEvidence,
  SkillHubReadinessOutcomeCode,
  SkillHubRemoteAccessPort,
  SkillHubRemoteCandidate,
  SkillHubRemoteContentInput,
  SkillHubRemoteContentResult,
  SkillHubRemoteListInput,
  SkillHubRemoteListResult,
} from './skillhub-types.js';

export interface SkillHubDiscoveryOptions {
  readonly provider: CapabilityProviderIdentity & { readonly providerKind: 'SKILL_HUB' };
  readonly managedInstallRoot: string;
  readonly remoteAccess: SkillHubRemoteAccessPort;
  readonly enabled?: boolean;
  readonly maxContentBytes?: number;
  readonly maxContentFiles?: number;
}

const defaultMaxContentBytes = 256 * 1024;
const defaultMaxContentFiles = 128;

export class SkillHubDiscovery implements CapabilityDiscovery, SkillSourceDiscovery {
  readonly provider: CapabilityProviderIdentity & { readonly providerKind: 'SKILL_HUB' };
  readonly discoveryMode = 'SEARCH' as const;
  private readonly remoteAccess: SkillHubRemoteAccessPort;
  private readonly enabled: boolean;
  private readonly managedInstallRoot: string;
  private readonly index: SkillHubInstalledIndex;
  private readonly installer: RemoteSkillContentInstaller;
  private readonly readinessEvidence: SkillHubReadinessEvidence[] = [];

  constructor(options: SkillHubDiscoveryOptions) {
    this.provider = options.provider;
    this.remoteAccess = options.remoteAccess;
    this.enabled = options.enabled ?? true;
    this.managedInstallRoot = options.managedInstallRoot;
    const maxContentBytes = options.maxContentBytes ?? defaultMaxContentBytes;
    const maxContentFiles = options.maxContentFiles ?? defaultMaxContentFiles;
    this.index = new SkillHubInstalledIndex(options.managedInstallRoot);
    this.installer = new RemoteSkillContentInstaller({
      provider: this.provider,
      managedInstallRoot: options.managedInstallRoot,
      maxContentBytes,
      maxContentFiles,
      index: this.index,
      emitEvidence: (outcomeCode, message, criteria, skillId) => {
        this.readinessEvidence.push(this.evidence(outcomeCode, message, criteria, skillId));
      },
    });
  }

  async synchronizeRemoteContent(
    criteria: CapabilitySearchCriteria,
    signal: AbortSignal,
  ): Promise<{ readonly outcome: 'SUCCEEDED' | 'DEGRADED' | 'FAILED' }> {
    this.readinessEvidence.length = 0;
    if (!this.enabled) {
      this.readinessEvidence.push(this.evidence('SKILLHUB_PROVIDER_DISABLED', 'SkillHub provider is disabled.', criteria));
      return { outcome: 'DEGRADED' };
    }
    const listed = await this.remoteAccess.listCandidates(remoteListInput(criteria), signal).catch(() => undefined);
    if (listed === undefined || listed.status === 'failed') {
      this.readinessEvidence.push(this.evidence('SKILLHUB_REFRESH_UNAVAILABLE', 'SkillHub synchronization failed safely.', criteria));
      return { outcome: 'DEGRADED' };
    }
    let installed = 0;
    for (const candidate of listed.candidates) {
      const validation = validateRemoteCandidate(candidate, criteria);
      if (validation !== undefined) {
        this.readinessEvidence.push(
          this.evidence(
            validation,
            validation === 'SKILLHUB_REMOTE_SCOPE_MISMATCH' ? 'SkillHub candidate scope mismatched.' : 'SkillHub candidate metadata is invalid.',
            criteria,
            safeSkillId(candidate.skillId),
          ),
        );
        continue;
      }
      if (criteria.requestedCapabilityId !== undefined && candidate.skillId !== criteria.requestedCapabilityId) {
        continue;
      }
      const artifact = await this.remoteAccess
        .fetchContent(
          {
            ...remoteListInput(criteria),
            contentRef: candidate.contentRef,
            stagingRoot: join(this.managedInstallRoot, 'staging'),
          },
          signal,
        )
        .catch(() => undefined);
      if (artifact === undefined || artifact.status === 'failed') {
        this.readinessEvidence.push(
          this.evidence('SKILLHUB_CONTENT_FETCH_FAILED', 'Remote Skill content fetch failed safely.', criteria, candidate.skillId),
        );
        continue;
      }
      const accepted = await this.installer.installContent(candidate, artifact, criteria).catch(() => {
        this.readinessEvidence.push(
          this.evidence('SKILLHUB_INSTALL_INCOMPLETE', 'Remote Skill content install failed safely.', criteria, candidate.skillId),
        );
        return false;
      });
      if (accepted) {
        installed += 1;
      }
    }
    return { outcome: installed > 0 ? 'SUCCEEDED' : 'DEGRADED' };
  }

  async search(criteria: CapabilitySearchCriteria, _signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    await this.synchronizeRemoteContent(criteria, _signal);
    if (!this.enabled) {
      return [];
    }
    const facts = await this.index.read();
    const descriptors: CapabilityDescriptor[] = [];
    for (const fact of facts) {
      if (!matchesScope(fact, criteria)) {
        continue;
      }
      if (criteria.requestedCapabilityId !== undefined && fact.skillId !== criteria.requestedCapabilityId) {
        continue;
      }
      let parsed: ReturnType<typeof defaultSkillDocumentService.parseMetadataView>;
      try {
        parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
          manifestFile: fact.manifestFile,
          provider: this.provider,
          safeCandidateName: fact.skillId,
        });
      } catch {
        this.readinessEvidence.push(this.evidence('SKILLHUB_MANIFEST_MISSING', 'SkillHub manifest is missing.', criteria, fact.skillId));
        continue;
      }
      if (parsed.outcome === 'rejected') {
        this.readinessEvidence.push(this.evidence('SKILLHUB_MANIFEST_INVALID', 'SkillHub manifest is invalid.', criteria, fact.skillId));
        continue;
      }
      if (parsed.consistency?.frontmatterHash !== fact.frontmatterHash) {
        this.readinessEvidence.push(
          this.evidence('SKILLHUB_MANIFEST_INVALID', 'SkillHub manifest changed after installation.', criteria, fact.skillId),
        );
        continue;
      }
      if (
        criteria.modelInvocable !== undefined &&
        (criteria.modelInvocable ? parsed.descriptor.modelInvocable !== true : parsed.descriptor.modelInvocable === true)
      ) {
        continue;
      }
      descriptors.push({
        ...parsed.descriptor,
        metadata: {
          ...(parsed.descriptor.metadata ?? {}),
          sourceMetadata: {
            ...((parsed.descriptor.metadata?.sourceMetadata as Record<string, string | string[]> | undefined) ?? {}),
            sourceIdentity: fact.sourceIdentity,
            frontmatterHash: fact.frontmatterHash,
          },
        },
      });
    }
    return descriptors;
  }

  async listCurrent(criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (signal.aborted) {
      throw new Error('SkillHub current view was cancelled.');
    }
    if (!this.enabled) {
      this.replaceReadinessEvidence([]);
      return [];
    }
    let facts: Awaited<ReturnType<SkillHubInstalledIndex['readStrict']>>;
    try {
      facts = await this.index.readStrict();
    } catch (error) {
      if (signal.aborted) {
        throw new Error('SkillHub current view was cancelled.');
      }
      throw new Error('SkillHub current view is unavailable.', { cause: error });
    }
    if (signal.aborted) {
      throw new Error('SkillHub current view was cancelled.');
    }
    const descriptors: CapabilityDescriptor[] = [];
    const nextReadinessEvidence: SkillHubReadinessEvidence[] = [];
    for (const fact of facts) {
      if (signal.aborted) {
        throw new Error('SkillHub current view was cancelled.');
      }
      if (!matchesScope(fact, criteria)) {
        continue;
      }
      let parsed: ReturnType<typeof defaultSkillDocumentService.parseMetadataView>;
      try {
        parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
          manifestFile: fact.manifestFile,
          provider: this.provider,
          safeCandidateName: fact.skillId,
        });
      } catch {
        if (signal.aborted) {
          throw new Error('SkillHub current view was cancelled.');
        }
        nextReadinessEvidence.push(this.evidence('SKILLHUB_MANIFEST_MISSING', 'SkillHub manifest is missing.', criteria, fact.skillId));
        continue;
      }
      if (signal.aborted) {
        throw new Error('SkillHub current view was cancelled.');
      }
      if (parsed.outcome === 'rejected') {
        nextReadinessEvidence.push(this.evidence('SKILLHUB_MANIFEST_INVALID', 'SkillHub manifest is invalid.', criteria, fact.skillId));
        continue;
      }
      if (parsed.consistency?.frontmatterHash !== fact.frontmatterHash) {
        nextReadinessEvidence.push(
          this.evidence('SKILLHUB_MANIFEST_INVALID', 'SkillHub manifest changed after installation.', criteria, fact.skillId),
        );
        continue;
      }
      descriptors.push({
        ...parsed.descriptor,
        metadata: {
          ...(parsed.descriptor.metadata ?? {}),
          sourceMetadata: {
            ...((parsed.descriptor.metadata?.sourceMetadata as Record<string, string | string[]> | undefined) ?? {}),
            sourceIdentity: fact.sourceIdentity,
            frontmatterHash: fact.frontmatterHash,
          },
        },
      });
    }
    if (signal.aborted) {
      throw new Error('SkillHub current view was cancelled.');
    }
    this.replaceReadinessEvidence(nextReadinessEvidence);
    return descriptors.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  }

  async loadCanonicalBodyView(
    input: { readonly capabilityId: CapabilityId; readonly sourceIdentity: string; readonly frontmatterHash: string },
    _signal: AbortSignal,
  ): Promise<SkillCanonicalBodyView | undefined> {
    const fact = (await this.index.read()).find(
      (item) => item.skillId === input.capabilityId && item.sourceIdentity === input.sourceIdentity && item.frontmatterHash === input.frontmatterHash,
    );
    if (fact === undefined) {
      return undefined;
    }
    let loaded: Awaited<ReturnType<typeof defaultSkillDocumentService.loadCanonicalBodyViewFromFile>>;
    try {
      loaded = await defaultSkillDocumentService.loadCanonicalBodyViewFromFile({
        manifestFile: fact.manifestFile,
        provider: this.provider,
        safeCandidateName: fact.skillId,
      });
    } catch {
      // readFile / decode may throw on filesystem errors or unsupported
      // encodings. Match the local and builtin adapters, which return
      // undefined so the Skill tool surfaces a safe failure rather than
      // propagating an uncaught exception.
      return undefined;
    }
    return isCanonicalBodyView(loaded) && loaded.frontmatterHash === fact.frontmatterHash
      ? { ...loaded, sourceIdentity: fact.sourceIdentity }
      : undefined;
  }

  async listSkillResources(input: SkillSourceRequest, signal: AbortSignal): Promise<readonly SkillResourceMetadata[]> {
    const fact = (await this.index.read()).find((item) => item.skillId === input.skillName);
    if (fact === undefined) {
      return [];
    }
    return await listSkillResourcesFromDirectory(dirname(fact.manifestFile), signal);
  }

  async readSkillResource(input: SkillSourceRequest & { readonly resource: SkillResourceMetadata }, signal: AbortSignal) {
    const fact = (await this.index.read()).find((item) => item.skillId === input.skillName);
    if (fact === undefined) {
      return undefined;
    }
    return await readSkillResourceFromDirectory(dirname(fact.manifestFile), input.resource, signal);
  }

  getReadinessEvidence(): readonly SkillHubReadinessEvidence[] {
    return this.readinessEvidence;
  }

  private replaceReadinessEvidence(next: readonly SkillHubReadinessEvidence[]): void {
    this.readinessEvidence.length = 0;
    this.readinessEvidence.push(...next);
  }

  private evidence(
    outcomeCode: SkillHubReadinessOutcomeCode,
    message: string,
    criteria?: Pick<CapabilitySearchCriteria, 'agentId' | 'agentVersion'>,
    skillId?: string,
  ): SkillHubReadinessEvidence {
    return {
      providerId: this.provider.providerId,
      providerKind: 'SKILL_HUB',
      ...(criteria === undefined ? {} : { agentId: criteria.agentId, agentVersion: criteria.agentVersion }),
      ...(skillId === undefined ? {} : { skillId }),
      outcomeCode,
      message,
    };
  }
}

function isCanonicalBodyView(value: unknown): value is SkillCanonicalBodyView & { readonly frontmatterHash: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'body' in value &&
    typeof value.body === 'string' &&
    'frontmatterHash' in value &&
    typeof value.frontmatterHash === 'string'
  );
}

export function createSkillHubDiscoveryForTesting(options: SkillHubDiscoveryOptions): SkillHubDiscovery {
  return new SkillHubDiscovery(options);
}
