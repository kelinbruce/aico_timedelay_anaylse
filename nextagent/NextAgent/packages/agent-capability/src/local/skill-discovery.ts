import { getLogger, type AgentId, type AgentVersion, type CapabilityId } from '@nextagent/agent-common';
import type { CapabilityCurrentDiscoveryCriteria, CapabilityDescriptor, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import type { Dirent } from 'node:fs';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { decodeText } from '../builtins/workspace-files/text-encoding.js';
import type { CapabilityDiscovery, CapabilitySearchCriteria } from '../discovery/discovery.js';
import { defaultSkillDocumentService, type SkillDocumentLoadView } from '../skills/skill-manifest.js';
import {
  listSkillResourcesFromDirectory,
  readSkillResourceFromDirectory,
  type SkillResourceMetadata,
  type SkillSourceDiscovery,
  type SkillSourceRequest,
} from '../skills/skill-source-discovery.js';
import type { AgentPackageSourceLocator } from './agent-package-source-locator.js';

export const localSkillsSystemProvider: CapabilityProviderIdentity = { providerId: 'local-skills-system', providerKind: 'LOCAL_DIRECTORY' };
export const localSkillsAgentOwnedProvider: CapabilityProviderIdentity = { providerId: 'local-skills-agent-owned', providerKind: 'LOCAL_DIRECTORY' };
export const localSkillsRuntimeGeneratedProvider: CapabilityProviderIdentity = {
  providerId: 'local-skills-runtime-generated',
  providerKind: 'LOCAL_DIRECTORY',
};

export type LocalSkillSourceScope = 'system-local' | 'agent-owned-local' | 'runtime-generated-local';

export type LocalSkillReadinessOutcomeCode =
  | 'LOCAL_SKILL_SOURCE_DISABLED'
  | 'LOCAL_SKILL_SOURCE_UNAVAILABLE'
  | 'LOCAL_SKILL_AGENTS_ROOT_INVALID'
  | 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE'
  | 'LOCAL_SKILL_CANDIDATE_IGNORED'
  | 'LOCAL_SKILL_MANIFEST_MISSING'
  | 'LOCAL_SKILL_MANIFEST_INVALID'
  | 'LOCAL_SKILL_DUPLICATE_REJECTED'
  | 'LOCAL_SKILL_SHADOWED_BY_AGENT'
  | 'LOCAL_SKILL_GOVERNANCE_UNAVAILABLE'
  | 'LOCAL_SKILL_REGISTERED';

export interface LocalSkillReadinessEvidence {
  readonly providerId: 'local-skills-system' | 'local-skills-agent-owned' | 'local-skills-runtime-generated';
  readonly providerKind: 'LOCAL_DIRECTORY';
  readonly sourceScope: LocalSkillSourceScope;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly skillId?: string;
  readonly outcomeCode: LocalSkillReadinessOutcomeCode;
  readonly message: string;
}

export interface LocalSkillLoadingFact {
  readonly providerId: 'local-skills-system' | 'local-skills-agent-owned' | 'local-skills-runtime-generated';
  readonly capabilityId: CapabilityId;
  readonly skillVersion: string;
  readonly sourceScope: LocalSkillSourceScope;
  readonly manifestFile: string;
  readonly frontmatterHash: string;
}

interface LocalSkillScanCache {
  readonly descriptors: readonly CapabilityDescriptor[];
  readonly readinessEvidence: readonly LocalSkillReadinessEvidence[];
  readonly loadingFacts: readonly LocalSkillLoadingFact[];
}

export interface RuntimeGeneratedSkillRootLocator {
  locate: (criteria: CapabilitySearchCriteria) => Promise<string | undefined>;
  locateCurrent?: (criteria: CapabilityCurrentDiscoveryCriteria) => Promise<string | undefined>;
}

export interface LocalSkillDiscoveryOptions {
  readonly enabled?: boolean;
  readonly systemSkillsRoot?: string;
  readonly agentPackageSourceLocator?: AgentPackageSourceLocator;
  readonly runtimeGeneratedSkillRootLocator?: RuntimeGeneratedSkillRootLocator;
}

const safeCandidatePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const logger = getLogger({ component: 'agent-capability', source: 'local-skill-discovery' });

export class LocalSkillDiscovery implements CapabilityDiscovery, SkillSourceDiscovery {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: 'EAGER' | 'SEARCH';
  private readonly sourceScope: LocalSkillSourceScope;
  private readonly enabled: boolean;
  private readonly systemSkillsRoot?: string | undefined;
  private readonly agentPackageSourceLocator?: AgentPackageSourceLocator | undefined;
  private readonly runtimeGeneratedSkillRootLocator?: RuntimeGeneratedSkillRootLocator | undefined;
  private readonly readinessEvidence: LocalSkillReadinessEvidence[] = [];
  private loadingFacts = new Map<string, LocalSkillLoadingFact>();
  private systemLocalScanCache?: LocalSkillScanCache;
  private systemLocalScanPromise?: Promise<LocalSkillScanCache> | undefined;
  private sourceUnavailableLogged = false;

  constructor(
    input: { readonly provider: CapabilityProviderIdentity; readonly discoveryMode: 'EAGER' | 'SEARCH'; readonly sourceScope: LocalSkillSourceScope },
    options: LocalSkillDiscoveryOptions = {},
  ) {
    this.provider = input.provider;
    this.discoveryMode = input.discoveryMode;
    this.sourceScope = input.sourceScope;
    this.enabled = options.enabled ?? true;
    this.systemSkillsRoot = options.systemSkillsRoot;
    this.agentPackageSourceLocator = options.agentPackageSourceLocator;
    this.runtimeGeneratedSkillRootLocator = options.runtimeGeneratedSkillRootLocator;
  }

  async listAll(_signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    this.resetEvidence();
    if (!this.enabled) {
      this.replaceReadinessEvidence([this.evidence('LOCAL_SKILL_SOURCE_DISABLED', 'Local Skill source is disabled.')]);
      logger.warn({
        event: 'skill.discovery.source_disabled',
        providerId: this.provider.providerId,
        sourceScope: this.sourceScope,
        reason: 'LOCAL_SKILL_SOURCE_DISABLED',
      });
      return [];
    }
    if (this.discoveryMode !== 'EAGER' || this.sourceScope !== 'system-local' || this.systemSkillsRoot === undefined) {
      this.reset();
      const ev = this.evidence('LOCAL_SKILL_SOURCE_UNAVAILABLE', 'Local Skill source is unavailable.');
      this.replaceReadinessEvidence([ev]);
      this.logSourceUnavailable();
      return [];
    }
    const cache = await this.getSystemLocalScanCache(this.systemSkillsRoot);
    this.reset();
    this.restoreCachedScan(cache);
    return cache.descriptors;
  }

  async search(criteria: CapabilitySearchCriteria, _signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    this.resetEvidence();
    if (!this.enabled) {
      this.replaceReadinessEvidence([this.evidence('LOCAL_SKILL_SOURCE_DISABLED', 'Local Skill source is disabled.', criteria)]);
      logger.warn({
        event: 'skill.discovery.source_disabled',
        providerId: this.provider.providerId,
        sourceScope: this.sourceScope,
        reason: 'LOCAL_SKILL_SOURCE_DISABLED',
      });
      return [];
    }
    if (this.discoveryMode !== 'SEARCH') {
      this.replaceReadinessEvidence([this.evidence('LOCAL_SKILL_SOURCE_UNAVAILABLE', 'Local Skill source is unavailable.', criteria)]);
      this.logSourceUnavailable({
        agentId: criteria.agentId,
        agentVersion: criteria.agentVersion,
      });
      return [];
    }
    if (this.sourceScope === 'agent-owned-local') {
      if (this.agentPackageSourceLocator === undefined) {
        this.replaceReadinessEvidence([
          this.evidence('LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE', 'Agent package source locator is unavailable.', criteria),
        ]);
        logger.warn({
          event: 'skill.discovery.agent_package_unavailable',
          providerId: this.provider.providerId,
          sourceScope: this.sourceScope,
          agentId: criteria.agentId,
          agentVersion: criteria.agentVersion,
          reason: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE',
        });
        return [];
      }
      const located = await this.agentPackageSourceLocator.locate(criteria);
      if (located.status !== 'found') {
        const code = located.status === 'invalid' ? 'LOCAL_SKILL_AGENTS_ROOT_INVALID' : 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE';
        this.replaceReadinessEvidence([this.evidence(code, 'Agent package source is unavailable.', criteria)]);
        logger.warn({
          event: 'skill.discovery.agent_package_unavailable',
          providerId: this.provider.providerId,
          sourceScope: this.sourceScope,
          agentId: criteria.agentId,
          agentVersion: criteria.agentVersion,
          locateStatus: located.status,
          safeCode: located.safeCode,
          reason: code,
        });
        return [];
      }
      const descriptors = await this.scanRoot(join(located.agentPackageRoot, 'skills'), criteria);
      return descriptors.filter(
        (descriptor) =>
          (criteria.requestedCapabilityId === undefined || descriptor.capabilityId === criteria.requestedCapabilityId) &&
          (criteria.modelInvocable === undefined ||
            (criteria.modelInvocable ? descriptor.modelInvocable === true : descriptor.modelInvocable !== true)),
      );
    }
    if (this.sourceScope !== 'runtime-generated-local' || this.runtimeGeneratedSkillRootLocator === undefined) {
      this.replaceReadinessEvidence([
        this.evidence('LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE', 'Agent package source locator is unavailable.', criteria),
      ]);
      logger.warn({
        event: 'skill.discovery.agent_package_unavailable',
        providerId: this.provider.providerId,
        sourceScope: this.sourceScope,
        agentId: criteria.agentId,
        agentVersion: criteria.agentVersion,
        reason: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE',
      });
      return [];
    }
    const runtimeGeneratedSkillsRoot = await this.runtimeGeneratedSkillRootLocator.locate(criteria);
    if (runtimeGeneratedSkillsRoot === undefined) {
      this.replaceReadinessEvidence([this.evidence('LOCAL_SKILL_SOURCE_UNAVAILABLE', 'Runtime-generated Skill source is unavailable.', criteria)]);
      this.logSourceUnavailable({
        agentId: criteria.agentId,
        agentVersion: criteria.agentVersion,
      });
      return [];
    }
    const descriptors = await this.scanRoot(runtimeGeneratedSkillsRoot, criteria);
    return descriptors.filter(
      (descriptor) =>
        (criteria.requestedCapabilityId === undefined || descriptor.capabilityId === criteria.requestedCapabilityId) &&
        (criteria.modelInvocable === undefined ||
          (criteria.modelInvocable ? descriptor.modelInvocable === true : descriptor.modelInvocable !== true)),
    );
  }

  async listCurrent(criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (signal.aborted) {
      throw new Error('Local Skill current view was cancelled.');
    }
    if (this.discoveryMode !== 'SEARCH') {
      return [];
    }
    if (!this.enabled) {
      this.replaceReadinessEvidence([]);
      return [];
    }
    if (this.sourceScope === 'agent-owned-local') {
      if (this.agentPackageSourceLocator === undefined) {
        this.replaceReadinessEvidence([]);
        return [];
      }
      let located: Awaited<ReturnType<AgentPackageSourceLocator['locate']>>;
      try {
        located = await this.agentPackageSourceLocator.locate(criteria, { signal });
      } catch (error) {
        if (signal.aborted) {
          throw new Error('Local Skill current view was cancelled.');
        }
        throw error;
      }
      if (signal.aborted) {
        throw new Error('Local Skill current view was cancelled.');
      }
      if (located.status === 'not-found') {
        this.replaceReadinessEvidence([]);
        return [];
      }
      if (located.status !== 'found') {
        throw new Error('Local Skill current view is unavailable.');
      }
      return this.scanCurrentRootAndReplaceEvidence(join(located.agentPackageRoot, 'skills'), signal);
    }
    if (this.sourceScope !== 'runtime-generated-local' || this.runtimeGeneratedSkillRootLocator?.locateCurrent === undefined) {
      throw new Error('Local Skill current view is unavailable.');
    }
    let root: string | undefined;
    try {
      root = await this.runtimeGeneratedSkillRootLocator.locateCurrent(criteria);
    } catch (error) {
      if (signal.aborted) {
        throw new Error('Local Skill current view was cancelled.');
      }
      throw error;
    }
    if (signal.aborted) {
      throw new Error('Local Skill current view was cancelled.');
    }
    if (root === undefined) {
      this.replaceReadinessEvidence([]);
      return [];
    }
    return this.scanCurrentRootAndReplaceEvidence(root, signal);
  }

  getReadinessEvidence(): readonly LocalSkillReadinessEvidence[] {
    return this.readinessEvidence;
  }

  getSystemSkillsRoot(): string | undefined {
    return this.systemSkillsRoot;
  }

  getSkillScanEvidence(): ReadonlyArray<{ readonly skillId?: string; readonly outcomeCode: string; readonly message: string }> {
    return this.readinessEvidence.map((item) => ({
      ...(item.skillId === undefined ? {} : { skillId: item.skillId }),
      outcomeCode: item.outcomeCode,
      message: item.message,
    }));
  }

  getSkillScanRoot(): string | undefined {
    return this.systemSkillsRoot;
  }

  getInternalLoadingFact(capabilityId: CapabilityId): LocalSkillLoadingFact | undefined {
    return [...this.loadingFacts.values()].find((fact) => fact.capabilityId === capabilityId);
  }

  private async scanRoot(root: string, criteria?: CapabilitySearchCriteria): Promise<readonly CapabilityDescriptor[]> {
    let entries: Array<Dirent<string>>;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      const evidence = this.evidence('LOCAL_SKILL_SOURCE_UNAVAILABLE', 'Local Skill source is unavailable.', criteria);
      this.replaceReadinessEvidence([evidence]);
      this.logSourceUnavailable(criteria === undefined ? undefined : { agentId: criteria.agentId, agentVersion: criteria.agentVersion });
      return [];
    }
    this.sourceUnavailableLogged = false;

    const descriptors: CapabilityDescriptor[] = [];
    const nextReadinessEvidence: LocalSkillReadinessEvidence[] = [];
    const nextLoadingFacts = new Map<string, LocalSkillLoadingFact>();
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      if (!safeCandidatePattern.test(entry.name)) {
        const evidence = this.evidence('LOCAL_SKILL_CANDIDATE_IGNORED', 'Local Skill candidate was ignored.', criteria, entry.name);
        nextReadinessEvidence.push(evidence);
        logger.debug({
          event: 'skill.discovery.candidate_ignored',
          providerId: this.provider.providerId,
          sourceScope: this.sourceScope,
          skillId: entry.name,
          reason: 'LOCAL_SKILL_CANDIDATE_IGNORED',
        });
        continue;
      }
      const manifestFile = join(root, entry.name, 'SKILL.md');
      let parsed: ReturnType<typeof defaultSkillDocumentService.parseMetadataView>;
      try {
        parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
          manifestFile,
          provider: this.provider,
          safeCandidateName: entry.name,
        });
      } catch {
        const evidence = this.evidence('LOCAL_SKILL_MANIFEST_MISSING', 'Local Skill manifest is missing.', criteria, entry.name);
        nextReadinessEvidence.push(evidence);
        logger.warn({
          event: 'skill.discovery.manifest_missing',
          providerId: this.provider.providerId,
          sourceScope: this.sourceScope,
          skillId: entry.name,
          reason: 'LOCAL_SKILL_MANIFEST_MISSING',
        });
        continue;
      }
      if (parsed.outcome === 'rejected') {
        const diagnosticReasonCodes = parsed.diagnostics.map((d) => d.reasonCode);
        const evidence = this.evidence('LOCAL_SKILL_MANIFEST_INVALID', 'Local Skill manifest is invalid.', criteria, entry.name);
        nextReadinessEvidence.push(evidence);
        logger.warn(
          {
            event: 'skill.discovery.manifest_invalid',
            providerId: this.provider.providerId,
            sourceScope: this.sourceScope,
            skillId: entry.name,
            diagnosticReasonCodes,
            diagnosticCount: diagnosticReasonCodes.length,
            reason: 'LOCAL_SKILL_MANIFEST_INVALID',
          },
          `Skill ${entry.name} manifest validation failed with ${diagnosticReasonCodes.length} diagnostic reason codes.`,
        );
        continue;
      }
      descriptors.push(parsed.descriptor);
      const fact = {
        providerId: this.provider.providerId as 'local-skills-system' | 'local-skills-agent-owned' | 'local-skills-runtime-generated',
        capabilityId: parsed.descriptor.capabilityId,
        skillVersion: parsed.descriptor.version ?? 'unversioned',
        sourceScope: this.sourceScope,
        manifestFile,
        frontmatterHash: parsed.consistency?.frontmatterHash ?? '',
      };
      nextLoadingFacts.set(factKey(this.provider.providerId, parsed.descriptor.capabilityId, fact.skillVersion), fact);
      logger.info(
        {
          event: 'skill.discovery.registered',
          providerId: this.provider.providerId,
          sourceScope: this.sourceScope,
          skillId: parsed.descriptor.capabilityId,
          skillVersion: fact.skillVersion,
        },
        `Skill ${parsed.descriptor.capabilityId} version ${fact.skillVersion} registered from ${this.sourceScope}.`,
      );
      nextReadinessEvidence.push(this.evidence('LOCAL_SKILL_REGISTERED', 'Local Skill is registered.', criteria, entry.name));
    }
    this.loadingFacts = nextLoadingFacts;
    this.replaceReadinessEvidence(nextReadinessEvidence);
    return descriptors;
  }

  private async scanCurrentRootAndReplaceEvidence(root: string, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    const nextReadinessEvidence: LocalSkillReadinessEvidence[] = [];
    const descriptors = await this.scanCurrentRoot(root, signal, nextReadinessEvidence);
    if (signal.aborted) {
      throw new Error('Local Skill current view was cancelled.');
    }
    this.replaceReadinessEvidence(nextReadinessEvidence);
    return descriptors;
  }

  private async scanCurrentRoot(
    root: string,
    signal: AbortSignal,
    nextReadinessEvidence: LocalSkillReadinessEvidence[],
  ): Promise<readonly CapabilityDescriptor[]> {
    let entries: Array<Dirent<string>>;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (signal.aborted) {
        throw new Error('Local Skill current view was cancelled.');
      }
      if (isMissingPathError(error)) {
        return [];
      }
      throw new Error('Local Skill current view is unavailable.', { cause: error });
    }
    if (signal.aborted) {
      throw new Error('Local Skill current view was cancelled.');
    }
    const descriptors: CapabilityDescriptor[] = [];
    for (const entry of entries) {
      if (signal.aborted) {
        throw new Error('Local Skill current view was cancelled.');
      }
      if (!entry.isDirectory() || entry.name.startsWith('.') || !safeCandidatePattern.test(entry.name)) {
        continue;
      }
      let parsed: ReturnType<typeof defaultSkillDocumentService.parseMetadataView>;
      try {
        parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
          manifestFile: join(root, entry.name, 'SKILL.md'),
          provider: this.provider,
          safeCandidateName: entry.name,
        });
      } catch {
        if (signal.aborted) {
          throw new Error('Local Skill current view was cancelled.');
        }
        nextReadinessEvidence.push(this.evidence('LOCAL_SKILL_MANIFEST_MISSING', 'Local Skill manifest is missing.', undefined, entry.name));
        logger.warn({
          event: 'skill.discovery.manifest_missing',
          providerId: this.provider.providerId,
          sourceScope: this.sourceScope,
          skillId: entry.name,
          reason: 'LOCAL_SKILL_MANIFEST_MISSING',
        });
        continue;
      }
      if (signal.aborted) {
        throw new Error('Local Skill current view was cancelled.');
      }
      if (parsed.outcome === 'rejected') {
        const diagnosticReasonCodes = parsed.diagnostics.map((diagnostic) => diagnostic.reasonCode);
        nextReadinessEvidence.push(this.evidence('LOCAL_SKILL_MANIFEST_INVALID', 'Local Skill manifest is invalid.', undefined, entry.name));
        logger.warn(
          {
            event: 'skill.discovery.manifest_invalid',
            providerId: this.provider.providerId,
            sourceScope: this.sourceScope,
            skillId: entry.name,
            diagnosticReasonCodes,
            diagnosticCount: diagnosticReasonCodes.length,
            reason: 'LOCAL_SKILL_MANIFEST_INVALID',
          },
          `Skill ${entry.name} manifest validation failed with ${diagnosticReasonCodes.length} diagnostic reason codes.`,
        );
        continue;
      }
      descriptors.push(parsed.descriptor);
    }
    if (signal.aborted) {
      throw new Error('Local Skill current view was cancelled.');
    }
    return descriptors.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  }

  private logSourceUnavailable(correlation?: { readonly agentId: AgentId; readonly agentVersion: AgentVersion }): void {
    if (this.sourceUnavailableLogged) {
      return;
    }
    this.sourceUnavailableLogged = true;
    logger.warn({
      event: 'skill.discovery.source_unavailable',
      providerId: this.provider.providerId,
      sourceScope: this.sourceScope,
      ...(correlation ?? {}),
      reason: 'LOCAL_SKILL_SOURCE_UNAVAILABLE',
    });
  }

  async loadCanonicalBodyView(input: SkillSourceRequest, _signal: AbortSignal) {
    const fact = this.loadingFact(input);
    if (fact === undefined) {
      this.logBodyLoadFailure('warn', {
        requestedSkillName: input.skillName,
        providerId: this.provider.providerId,
        skillVersion: input.skillVersion,
        bodyLoadFailureReason: 'LOCAL_SKILL_LOADING_FACT_MISSING',
        manifestExists: false,
        trackedFactCount: this.loadingFacts.size,
        trackedSkillIdsSample: trackedSkillIdsSample(this.loadingFacts),
      });
      return undefined;
    }
    let loaded: unknown;
    try {
      loaded = await defaultSkillDocumentService.loadCanonicalBodyViewFromFile({
        manifestFile: fact.manifestFile,
        provider: this.provider,
        safeCandidateName: input.skillName,
      });
    } catch {
      this.logBodyLoadFailure('error', {
        requestedSkillName: input.skillName,
        providerId: this.provider.providerId,
        skillVersion: fact.skillVersion,
        bodyLoadFailureReason: 'LOCAL_SKILL_BODY_LOAD_FAILED',
        manifestExists: existsSync(fact.manifestFile),
      });
      return undefined;
    }
    if (!isCanonicalBodyView(loaded)) {
      this.logBodyLoadFailure('warn', {
        requestedSkillName: input.skillName,
        providerId: this.provider.providerId,
        skillVersion: fact.skillVersion,
        bodyLoadFailureReason: 'LOCAL_SKILL_BODY_INVALID',
        manifestExists: existsSync(fact.manifestFile),
      });
      return undefined;
    }
    if (loaded.frontmatterHash !== fact.frontmatterHash) {
      this.logBodyLoadFailure('warn', {
        requestedSkillName: input.skillName,
        providerId: this.provider.providerId,
        skillVersion: fact.skillVersion,
        bodyLoadFailureReason: 'LOCAL_SKILL_BODY_FRONTMATTER_MISMATCH',
        manifestExists: existsSync(fact.manifestFile),
      });
      return undefined;
    }
    if (loaded.skillVersion !== fact.skillVersion) {
      this.logBodyLoadFailure('warn', {
        requestedSkillName: input.skillName,
        providerId: this.provider.providerId,
        skillVersion: fact.skillVersion,
        bodyLoadFailureReason: 'LOCAL_SKILL_BODY_VERSION_MISMATCH',
        manifestExists: existsSync(fact.manifestFile),
        expectedVersion: fact.skillVersion,
        loadedVersion: loaded.skillVersion,
      });
      return undefined;
    }
    // Tamper check: compare the full-document hash of the agent-loaded file
    // against the trusted cache copy (sync'd from Skill Hub). A body-only
    // edit in the agent directory passes the frontmatterHash/skillVersion
    // gates above; this catches it and fails closed.
    const trustedHash = await this.readTrustedDocumentHash(fact);
    if (trustedHash !== undefined && loaded.documentHash !== trustedHash) {
      this.logBodyLoadFailure('warn', {
        requestedSkillName: input.skillName,
        providerId: this.provider.providerId,
        skillVersion: fact.skillVersion,
        bodyLoadFailureReason: 'LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH',
        manifestExists: existsSync(fact.manifestFile),
      });
      return undefined;
    }
    return {
      providerId: loaded.providerId,
      capabilityId: loaded.capabilityId,
      skillVersion: loaded.skillVersion,
      documentHash: loaded.documentHash,
      body: loaded.body,
      ...(loaded.documentSource === undefined ? {} : { documentSource: loaded.documentSource }),
      rootDir: dirname(fact.manifestFile),
    };
  }

  async listSkillResources(input: SkillSourceRequest, signal: AbortSignal) {
    const fact = this.loadingFact(input);
    if (fact === undefined) {
      return [];
    }
    try {
      return await listSkillResourcesFromDirectory(dirname(fact.manifestFile), signal);
    } catch (error) {
      logger.error({
        err: error,
        event: 'skill.discovery.failed',
        failureStage: 'LOCAL_SKILL_RESOURCE_LIST',
        skillId: input.skillName,
        skillVersion: fact.skillVersion,
      });
      return [];
    }
  }

  async readSkillResource(input: SkillSourceRequest & { readonly resource: SkillResourceMetadata }, signal: AbortSignal) {
    const fact = this.loadingFact(input);
    if (fact === undefined) {
      return undefined;
    }
    try {
      return await readSkillResourceFromDirectory(dirname(fact.manifestFile), input.resource, signal);
    } catch (error) {
      logger.error({
        err: error,
        event: 'skill.discovery.failed',
        failureStage: 'LOCAL_SKILL_RESOURCE_READ',
        skillId: input.skillName,
        skillVersion: fact.skillVersion,
      });
      return undefined;
    }
  }

  private resetEvidence(): void {
    this.readinessEvidence.length = 0;
  }

  private replaceReadinessEvidence(next: readonly LocalSkillReadinessEvidence[]): void {
    this.readinessEvidence.length = 0;
    this.readinessEvidence.push(...next);
  }

  private reset(): void {
    this.readinessEvidence.length = 0;
    this.loadingFacts.clear();
  }

  private snapshotScan(descriptors: readonly CapabilityDescriptor[]): LocalSkillScanCache {
    return {
      descriptors: [...descriptors],
      readinessEvidence: [...this.readinessEvidence],
      loadingFacts: [...this.loadingFacts.values()],
    };
  }

  private restoreCachedScan(cache: LocalSkillScanCache): void {
    this.readinessEvidence.push(...cache.readinessEvidence);
    for (const fact of cache.loadingFacts) {
      this.loadingFacts.set(factKey(fact.providerId, fact.capabilityId, fact.skillVersion), fact);
    }
  }

  private async getSystemLocalScanCache(root: string): Promise<LocalSkillScanCache> {
    if (this.systemLocalScanCache !== undefined) {
      return this.systemLocalScanCache;
    }
    if (this.systemLocalScanPromise === undefined) {
      this.systemLocalScanPromise = this.buildSystemLocalScanCache(root)
        .then((cache) => {
          this.systemLocalScanCache = cache;
          return cache;
        })
        .finally(() => {
          this.systemLocalScanPromise = undefined;
        });
    }
    return this.systemLocalScanPromise;
  }

  private async buildSystemLocalScanCache(root: string): Promise<LocalSkillScanCache> {
    this.reset();
    const descriptors = await this.scanRoot(root);
    return this.snapshotScan(descriptors);
  }

  private evidence(
    outcomeCode: LocalSkillReadinessOutcomeCode,
    message: string,
    criteria?: CapabilitySearchCriteria,
    skillId?: string,
  ): LocalSkillReadinessEvidence {
    return {
      providerId: this.provider.providerId as 'local-skills-system' | 'local-skills-agent-owned' | 'local-skills-runtime-generated',
      providerKind: 'LOCAL_DIRECTORY',
      sourceScope: this.sourceScope,
      ...(criteria === undefined ? {} : { agentId: criteria.agentId, agentVersion: criteria.agentVersion }),
      ...(skillId === undefined ? {} : { skillId }),
      outcomeCode,
      message,
    };
  }

  private logBodyLoadFailure(
    level: 'warn' | 'error',
    payload: {
      readonly requestedSkillName: string;
      readonly providerId: string;
      readonly skillVersion: string;
      readonly bodyLoadFailureReason:
        | 'LOCAL_SKILL_LOADING_FACT_MISSING'
        | 'LOCAL_SKILL_BODY_LOAD_FAILED'
        | 'LOCAL_SKILL_BODY_INVALID'
        | 'LOCAL_SKILL_BODY_FRONTMATTER_MISMATCH'
        | 'LOCAL_SKILL_BODY_VERSION_MISMATCH'
        | 'LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH';
      readonly manifestExists: boolean;
      readonly expectedVersion?: string;
      readonly loadedVersion?: string;
      readonly trackedFactCount?: number;
      readonly trackedSkillIdsSample?: readonly string[];
    },
  ): void {
    logger[level]({
      event: 'local.skill.body_load_failed',
      requestedSkillName: payload.requestedSkillName,
      providerId: payload.providerId,
      sourceScope: this.sourceScope,
      skillVersion: payload.skillVersion,
      bodyLoadFailureReason: payload.bodyLoadFailureReason,
      manifestExists: payload.manifestExists,
      ...(payload.expectedVersion === undefined ? {} : { expectedVersion: payload.expectedVersion }),
      ...(payload.loadedVersion === undefined ? {} : { loadedVersion: payload.loadedVersion }),
      ...(payload.trackedFactCount === undefined ? {} : { trackedFactCount: payload.trackedFactCount }),
      ...(payload.trackedSkillIdsSample === undefined ? {} : { trackedSkillIdsSample: payload.trackedSkillIdsSample }),
    });
  }

  private loadingFact(input: SkillSourceRequest): LocalSkillLoadingFact | undefined {
    return this.loadingFacts.get(factKey(this.provider.providerId, input.skillName, input.skillVersion));
  }

  // Reads the trusted cache copy of a Skill (sync'd from Skill Hub) and returns
  // the sha256 documentHash of its full text, or undefined when no trusted
  // baseline exists (so the check is skipped rather than false-failing).
  // agent file: /opt/share/agents/<agent>/skills/<skill>/SKILL.md
  // cache file: /opt/share/cache/skillhub/<skill>/SKILL.md
  private async readTrustedDocumentHash(fact: LocalSkillLoadingFact): Promise<string | undefined> {
    const skillName = fact.capabilityId;
    const appShareDir = process.env._APP_SHARE_DIR;
    if (!appShareDir) {
      return undefined;
    }
    const cacheFile = join(appShareDir, 'cache', 'skillhub', skillName, 'SKILL.md');
    if (!existsSync(cacheFile)) {
      return undefined;
    }
    try {
      const bytes = await readFile(cacheFile);
      const decoded = decodeText(bytes);
      return createHash('sha256').update(decoded.text, 'utf8').digest('hex');
    } catch {
      return undefined;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function factKey(providerId: string, skillName: CapabilityId, skillVersion: string): string {
  return `${providerId}\0${skillName}\0${skillVersion}`;
}

function trackedSkillIdsSample(loadingFacts: ReadonlyMap<string, LocalSkillLoadingFact>): readonly string[] {
  return [...new Set([...loadingFacts.values()].map((fact) => fact.capabilityId))].sort().slice(0, 5);
}

function isCanonicalBodyView(value: unknown): value is SkillDocumentLoadView {
  return (
    value !== null &&
    typeof value === 'object' &&
    'body' in value &&
    typeof value.body === 'string' &&
    'frontmatterHash' in value &&
    typeof value.frontmatterHash === 'string' &&
    'skillVersion' in value &&
    typeof value.skillVersion === 'string'
  );
}

export function createSystemLocalSkillDiscoveryForTesting(
  options: LocalSkillDiscoveryOptions & { readonly systemSkillsRoot: string },
): LocalSkillDiscovery {
  return new LocalSkillDiscovery({ provider: localSkillsSystemProvider, discoveryMode: 'EAGER', sourceScope: 'system-local' }, options);
}

export function createAgentOwnedLocalSkillDiscoveryForTesting(
  options: LocalSkillDiscoveryOptions & { readonly agentPackageSourceLocator: AgentPackageSourceLocator },
): LocalSkillDiscovery {
  return new LocalSkillDiscovery({ provider: localSkillsAgentOwnedProvider, discoveryMode: 'SEARCH', sourceScope: 'agent-owned-local' }, options);
}

export function createRuntimeGeneratedLocalSkillDiscoveryForTesting(
  options: LocalSkillDiscoveryOptions & { readonly runtimeGeneratedSkillRootLocator: RuntimeGeneratedSkillRootLocator },
): LocalSkillDiscovery {
  return new LocalSkillDiscovery(
    { provider: localSkillsRuntimeGeneratedProvider, discoveryMode: 'SEARCH', sourceScope: 'runtime-generated-local' },
    options,
  );
}
