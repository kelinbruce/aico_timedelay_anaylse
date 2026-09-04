import { getLogger, type CapabilityId } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { builtinSkillResourceRoot, builtinSkillsProvider } from './index.js';
import type { CapabilityDiscovery } from '../discovery/discovery.js';
import { defaultSkillDocumentService, type SkillDocumentLoadView } from '../skills/skill-manifest.js';
import {
  listSkillResourcesFromDirectory,
  readSkillResourceFromDirectory,
  type SkillResourceMetadata,
  type SkillSourceDiscovery,
  type SkillSourceRequest,
} from '../skills/skill-source-discovery.js';

export type BuiltinSkillReadinessOutcomeCode =
  | 'BUILTIN_SKILL_SOURCE_DISABLED'
  | 'BUILTIN_SKILL_SOURCE_UNAVAILABLE'
  | 'BUILTIN_SKILL_CANDIDATE_IGNORED'
  | 'BUILTIN_SKILL_MANIFEST_MISSING'
  | 'BUILTIN_SKILL_MANIFEST_INVALID'
  | 'BUILTIN_SKILL_REGISTERED';

export interface BuiltinSkillReadinessEvidence {
  readonly providerId: 'builtin-skills';
  readonly skillId?: string;
  readonly outcomeCode: BuiltinSkillReadinessOutcomeCode;
  readonly message: string;
}

export interface BuiltinSkillLoadingFact {
  readonly providerId: 'builtin-skills';
  readonly capabilityId: CapabilityId;
  readonly skillVersion: string;
  readonly manifestFile: string;
  readonly sourceIdentity: string;
  readonly frontmatterHash: string;
}

export interface BuiltinSkillDiscoveryOptions {
  readonly enabled?: boolean;
}

const safeCandidatePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const logger = getLogger({ component: 'agent-capability', source: 'builtin-skill-discovery' });

export class BuiltinSkillDiscovery implements CapabilityDiscovery, SkillSourceDiscovery {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode = 'EAGER' as const;
  private readonly resourceRoot: string;
  private readonly enabled: boolean;
  private readonly readinessEvidence: BuiltinSkillReadinessEvidence[] = [];
  private readonly loadingFacts = new Map<string, BuiltinSkillLoadingFact>();

  constructor(options: BuiltinSkillDiscoveryOptions = {}, internalOptions: { readonly resourceRoot?: string } = {}) {
    this.provider = builtinSkillsProvider;
    this.resourceRoot = internalOptions.resourceRoot ?? builtinSkillResourceRoot;
    this.enabled = options.enabled ?? true;
  }

  async listAll(_signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (!this.enabled) {
      this.replaceDiscoveryState([], [evidence('BUILTIN_SKILL_SOURCE_DISABLED', 'Builtin Skill source is disabled.')]);
      logger.warn({ event: 'skill.discovery.source_disabled', reason: 'BUILTIN_SKILL_SOURCE_DISABLED' });
      return [];
    }
    let entries: Array<Dirent<string>>;
    try {
      entries = await readdir(this.resourceRoot, { withFileTypes: true });
    } catch {
      const ev = evidence('BUILTIN_SKILL_SOURCE_UNAVAILABLE', 'Builtin Skill source is unavailable.');
      this.replaceDiscoveryState([], [ev]);
      logger.warn({
        event: 'skill.discovery.source_unavailable',
        reason: 'BUILTIN_SKILL_SOURCE_UNAVAILABLE',
      });
      return [];
    }

    const descriptors: CapabilityDescriptor[] = [];
    const loadingFacts: BuiltinSkillLoadingFact[] = [];
    const readinessEvidence: BuiltinSkillReadinessEvidence[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.startsWith('.')) {
        continue;
      }
      if (!safeCandidatePattern.test(entry.name)) {
        const ev = evidence('BUILTIN_SKILL_CANDIDATE_IGNORED', 'Builtin Skill candidate was ignored.', entry.name);
        readinessEvidence.push(ev);
        logger.warn({
          event: 'skill.discovery.candidate_ignored',
          skillId: entry.name,
          reason: 'BUILTIN_SKILL_CANDIDATE_IGNORED',
        });
        continue;
      }
      const manifestFile = join(this.resourceRoot, entry.name, 'SKILL.md');
      let parsed: ReturnType<typeof defaultSkillDocumentService.parseMetadataView>;
      try {
        parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
          manifestFile,
          provider: this.provider,
          safeCandidateName: entry.name,
        });
      } catch {
        const ev = evidence('BUILTIN_SKILL_MANIFEST_MISSING', 'Builtin Skill manifest is missing.', entry.name);
        readinessEvidence.push(ev);
        logger.warn({
          event: 'skill.discovery.manifest_missing',
          skillId: entry.name,
          reason: 'BUILTIN_SKILL_MANIFEST_MISSING',
        });
        continue;
      }
      if (parsed.outcome === 'rejected') {
        const diagnosticReasonCodes = parsed.diagnostics.map((d) => d.reasonCode);
        const ev = evidence('BUILTIN_SKILL_MANIFEST_INVALID', 'Builtin Skill manifest is invalid.', entry.name);
        readinessEvidence.push(ev);
        logger.warn(
          {
            event: 'skill.discovery.manifest_invalid',
            skillId: entry.name,
            diagnosticReasonCodes,
            diagnosticCount: diagnosticReasonCodes.length,
            reason: 'BUILTIN_SKILL_MANIFEST_INVALID',
          },
          `Skill ${entry.name} manifest validation failed with ${diagnosticReasonCodes.length} diagnostic reason codes.`,
        );
        continue;
      }
      const skillVersion = parsed.descriptor.version ?? 'unversioned';
      const fact: BuiltinSkillLoadingFact = {
        providerId: 'builtin-skills',
        capabilityId: parsed.descriptor.capabilityId,
        skillVersion,
        manifestFile,
        sourceIdentity: `builtin-skills:${parsed.descriptor.capabilityId}:${skillVersion}`,
        frontmatterHash: parsed.consistency?.frontmatterHash ?? '',
      };
      loadingFacts.push(fact);
      descriptors.push(descriptorWithSourceMetadata(parsed.descriptor, fact));
      readinessEvidence.push(evidence('BUILTIN_SKILL_REGISTERED', 'Builtin Skill is registered.', entry.name));
      logger.info(
        {
          event: 'skill.discovery.registered',
          skillId: parsed.descriptor.capabilityId,
          skillVersion,
        },
        `Skill ${parsed.descriptor.capabilityId} version ${skillVersion} registered from builtin skills.`,
      );
    }
    this.replaceDiscoveryState(loadingFacts, readinessEvidence);
    return descriptors;
  }

  async loadCanonicalBodyView(input: SkillSourceRequest, _signal: AbortSignal) {
    const fact = this.loadingFact(input);
    if (fact === undefined) {
      return undefined;
    }
    let loaded: unknown;
    try {
      loaded = await defaultSkillDocumentService.loadCanonicalBodyViewFromFile({
        manifestFile: fact.manifestFile,
        provider: this.provider,
        safeCandidateName: input.skillName,
      });
    } catch (error) {
      logger.error({
        err: error,
        event: 'skill.discovery.failed',
        failureStage: 'BUILTIN_SKILL_BODY_LOAD',
        skillId: input.skillName,
        skillVersion: fact.skillVersion,
      });
      return undefined;
    }
    if (!isCanonicalBodyView(loaded)) {
      logger.warn({
        event: 'skill.discovery.body_invalid',
        skillId: input.skillName,
        skillVersion: fact.skillVersion,
        reason: 'BUILTIN_SKILL_BODY_INVALID',
      });
      return undefined;
    }
    if (loaded.frontmatterHash !== fact.frontmatterHash || loaded.skillVersion !== fact.skillVersion) {
      logger.warn({
        event: 'skill.discovery.version_mismatch',
        skillId: input.skillName,
        expectedVersion: fact.skillVersion,
        loadedVersion: loaded.skillVersion,
        reason: 'BUILTIN_SKILL_BODY_VERSION_MISMATCH',
      });
      return undefined;
    }
    return {
      providerId: loaded.providerId,
      capabilityId: loaded.capabilityId,
      skillVersion: loaded.skillVersion,
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
        failureStage: 'BUILTIN_SKILL_RESOURCE_LIST',
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
        failureStage: 'BUILTIN_SKILL_RESOURCE_READ',
        skillId: input.skillName,
        skillVersion: fact.skillVersion,
      });
      return undefined;
    }
  }

  getReadinessEvidence(): readonly BuiltinSkillReadinessEvidence[] {
    return this.readinessEvidence;
  }

  getResourceRoot(): string {
    return this.resourceRoot;
  }

  getSkillScanEvidence(): ReadonlyArray<{ readonly skillId?: string; readonly outcomeCode: string; readonly message: string }> {
    return this.readinessEvidence.map((item) => ({
      ...(item.skillId === undefined ? {} : { skillId: item.skillId }),
      outcomeCode: item.outcomeCode,
      message: item.message,
    }));
  }

  getSkillScanRoot(): string {
    return this.resourceRoot;
  }

  getInternalLoadingFact(capabilityId: CapabilityId): BuiltinSkillLoadingFact | undefined {
    return [...this.loadingFacts.values()].find((fact) => fact.capabilityId === capabilityId);
  }

  private loadingFact(input: SkillSourceRequest): BuiltinSkillLoadingFact | undefined {
    return this.loadingFacts.get(factKey(input.skillName, input.skillVersion));
  }

  private replaceDiscoveryState(loadingFacts: readonly BuiltinSkillLoadingFact[], readinessEvidence: readonly BuiltinSkillReadinessEvidence[]): void {
    this.loadingFacts.clear();
    for (const fact of loadingFacts) {
      this.loadingFacts.set(factKey(fact.capabilityId, fact.skillVersion), fact);
    }
    this.readinessEvidence.length = 0;
    this.readinessEvidence.push(...readinessEvidence);
  }
}

function factKey(skillName: CapabilityId, skillVersion: string): string {
  return `${skillName}\0${skillVersion}`;
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

function evidence(outcomeCode: BuiltinSkillReadinessOutcomeCode, message: string, skillId?: string): BuiltinSkillReadinessEvidence {
  return {
    providerId: 'builtin-skills',
    ...(skillId === undefined ? {} : { skillId }),
    outcomeCode,
    message,
  };
}

function descriptorWithSourceMetadata(descriptor: CapabilityDescriptor, fact: BuiltinSkillLoadingFact): CapabilityDescriptor {
  const metadata = descriptor.metadata;
  return {
    ...descriptor,
    metadata:
      metadata === undefined
        ? {
            sourceMetadata: {
              sourceIdentity: fact.sourceIdentity,
              frontmatterHash: fact.frontmatterHash,
            },
          }
        : {
            ...(metadata as Record<string, unknown>),
            sourceMetadata: {
              ...(((metadata as Record<string, unknown>).sourceMetadata as Record<string, unknown> | undefined) ?? {}),
              sourceIdentity: fact.sourceIdentity,
              frontmatterHash: fact.frontmatterHash,
            },
          },
  };
}

export function createBuiltinSkillDiscoveryForTesting(
  options: BuiltinSkillDiscoveryOptions & { readonly resourceRoot: string },
): BuiltinSkillDiscovery {
  return new BuiltinSkillDiscovery(
    {
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    },
    { resourceRoot: options.resourceRoot },
  );
}
