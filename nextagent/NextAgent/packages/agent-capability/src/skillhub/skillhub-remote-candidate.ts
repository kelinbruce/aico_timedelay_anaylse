import type { CapabilitySearchCriteria } from '../discovery/discovery.js';
import type { SkillHubLoadingFact, SkillHubRemoteCandidate, SkillHubRemoteListInput } from './skillhub-types.js';
import { createHash } from 'node:crypto';

const safeCandidatePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function remoteListInput(criteria: CapabilitySearchCriteria): SkillHubRemoteListInput {
  return {
    tenantId: criteria.tenantId,
    subjectId: criteria.subjectId,
    agentId: criteria.agentId,
    agentVersion: criteria.agentVersion,
    agentAssemblyRef: criteria.agentAssemblyRef,
    ...(criteria.requestedCapabilityId === undefined ? {} : { requestedCapabilityId: criteria.requestedCapabilityId }),
  };
}

export function validateRemoteCandidate(
  candidate: SkillHubRemoteCandidate,
  criteria: CapabilitySearchCriteria,
): 'SKILLHUB_REMOTE_METADATA_INVALID' | 'SKILLHUB_REMOTE_SCOPE_MISMATCH' | undefined {
  if (!safeCandidatePattern.test(candidate.skillId) || candidate.contentRef.trim().length === 0) {
    return 'SKILLHUB_REMOTE_METADATA_INVALID';
  }
  if (
    (candidate.agentId !== undefined && candidate.agentId !== criteria.agentId) ||
    (candidate.agentVersion !== undefined && candidate.agentVersion !== criteria.agentVersion) ||
    (candidate.agentAssemblyRef !== undefined && candidate.agentAssemblyRef !== criteria.agentAssemblyRef)
  ) {
    return 'SKILLHUB_REMOTE_SCOPE_MISMATCH';
  }
  return undefined;
}

export function sourceIdentity(providerId: string, criteria: CapabilitySearchCriteria, candidate: SkillHubRemoteCandidate): string {
  const hash = createHash('sha256')
    .update('skillhub-source-identity\0', 'utf8')
    .update(providerId, 'utf8')
    .update('\0', 'utf8')
    .update(criteria.tenantId, 'utf8')
    .update('\0', 'utf8')
    .update(criteria.subjectId, 'utf8')
    .update('\0', 'utf8')
    .update(criteria.agentId, 'utf8')
    .update('\0', 'utf8')
    .update(criteria.agentVersion, 'utf8')
    .update('\0', 'utf8')
    .update(criteria.agentAssemblyRef, 'utf8')
    .update('\0', 'utf8')
    .update(candidate.skillId, 'utf8')
    .update('\0', 'utf8')
    .update(contentConsistencyToken(candidate), 'utf8')
    .digest('hex');
  return `remote-skill-content-${hash}`;
}

export function withArtifactFacts(
  candidate: SkillHubRemoteCandidate,
  facts: {
    readonly contentVersion?: string;
    readonly contentHash?: string;
  },
): SkillHubRemoteCandidate {
  return {
    ...candidate,
    ...(facts.contentVersion === undefined ? {} : { contentVersion: facts.contentVersion }),
    ...(facts.contentHash === undefined ? {} : { contentHash: facts.contentHash }),
  };
}

export function safeInstallId(providerId: string, criteria: CapabilitySearchCriteria, candidate: SkillHubRemoteCandidate): string {
  return sourceIdentity(providerId, criteria, candidate);
}

function contentConsistencyToken(candidate: Pick<SkillHubRemoteCandidate, 'contentHash' | 'contentVersion'>): string {
  return candidate.contentHash ?? candidate.contentVersion ?? 'content';
}

export function safeSkillId(value: string): string | undefined {
  return safeCandidatePattern.test(value) ? value : undefined;
}

export function matchesScope(
  fact: SkillHubLoadingFact,
  scope: Pick<CapabilitySearchCriteria, 'tenantId' | 'subjectId' | 'agentId' | 'agentVersion' | 'agentAssemblyRef'>,
): boolean {
  return (
    fact.tenantId === scope.tenantId &&
    fact.subjectId === scope.subjectId &&
    fact.agentId === scope.agentId &&
    fact.agentVersion === scope.agentVersion &&
    fact.agentAssemblyRef === scope.agentAssemblyRef
  );
}

export function dedupeFacts(facts: readonly SkillHubLoadingFact[]): readonly SkillHubLoadingFact[] {
  const byKey = new Map<string, SkillHubLoadingFact>();
  for (const fact of facts) {
    byKey.set(
      `${fact.tenantId}\0${fact.subjectId}\0${fact.agentId}\0${fact.agentVersion}\0${fact.agentAssemblyRef}\0${fact.providerId}\0${fact.skillId}`,
      fact,
    );
  }
  return [...byKey.values()];
}

export function isLoadingFact(value: unknown): value is SkillHubLoadingFact {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    [
      'tenantId',
      'subjectId',
      'agentId',
      'agentVersion',
      'agentAssemblyRef',
      'providerId',
      'skillId',
      'manifestFile',
      'sourceIdentity',
      'frontmatterHash',
    ].every((key) => typeof item[key] === 'string') &&
    (item.artifactKind === undefined || typeof item.artifactKind === 'string')
  );
}
