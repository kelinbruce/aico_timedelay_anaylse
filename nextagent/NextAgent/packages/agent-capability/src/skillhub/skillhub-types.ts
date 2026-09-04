import type { AgentId, AgentVersion, CapabilityId, SubjectId, TenantId } from '@nextagent/agent-common';

export type SkillHubReadinessOutcomeCode =
  | 'SKILLHUB_PROVIDER_DISABLED'
  | 'SKILLHUB_PROVIDER_UNAVAILABLE'
  | 'SKILLHUB_REFRESH_UNAVAILABLE'
  | 'SKILLHUB_REMOTE_METADATA_INVALID'
  | 'SKILLHUB_REMOTE_SCOPE_MISMATCH'
  | 'SKILLHUB_CONTENT_FETCH_FAILED'
  | 'SKILLHUB_CONTENT_REJECTED'
  | 'SKILLHUB_ARTIFACT_REJECTED'
  | 'SKILLHUB_INSTALL_INCOMPLETE'
  | 'SKILLHUB_MANIFEST_MISSING'
  | 'SKILLHUB_MANIFEST_INVALID'
  | 'SKILLHUB_CANDIDATE_INSTALLED'
  | 'SKILLHUB_GOVERNANCE_UNAVAILABLE'
  | 'SKILLHUB_SKILL_SHADOWED'
  | 'SKILLHUB_SKILL_REGISTERED';

export interface SkillHubReadinessEvidence {
  readonly providerId: string;
  readonly providerKind: 'SKILL_HUB';
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly skillId?: string;
  readonly outcomeCode: SkillHubReadinessOutcomeCode;
  readonly message: string;
}

export interface SkillHubRemoteCandidate {
  readonly skillId: string;
  readonly contentRef: string;
  readonly contentVersion?: string;
  readonly contentHash?: string;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly agentAssemblyRef?: string;
}

export interface SkillHubRemoteAccessPort {
  listCandidates: (input: SkillHubRemoteListInput, signal: AbortSignal) => Promise<SkillHubRemoteListResult>;
  fetchContent: (input: SkillHubRemoteContentInput, signal: AbortSignal) => Promise<SkillHubRemoteContentResult>;
}

export interface SkillHubRemoteListInput {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly requestedCapabilityId?: CapabilityId;
}

export interface SkillHubRemoteContentInput {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly contentRef: string;
  readonly stagingRoot: string;
}

export type SkillHubRemoteListResult =
  | { readonly status: 'ok'; readonly candidates: readonly SkillHubRemoteCandidate[] }
  | { readonly status: 'failed'; readonly reasonCode: 'unavailable' | 'timeout' | 'unauthorized' | 'invalid-response'; readonly message?: string };

export type SkillHubRemoteContentResult =
  | {
      readonly status: 'ok';
      readonly stagingRoot: string;
      readonly stagedFolder: string;
      readonly contentVersion?: string;
      readonly contentHash?: string;
    }
  | {
      readonly status: 'failed';
      readonly reasonCode: 'download-failed' | 'unavailable' | 'timeout' | 'unauthorized' | 'invalid-response';
      readonly message?: string;
    };

export interface SkillHubLoadingFact {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly providerId: string;
  readonly skillId: CapabilityId;
  readonly contentVersion?: string;
  readonly contentHash?: string;
  readonly manifestFile: string;
  readonly sourceIdentity: string;
  readonly frontmatterHash: string;
}

export type SkillHubEvidenceSink = (
  outcomeCode: SkillHubReadinessOutcomeCode,
  message: string,
  criteria: {
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
  },
  skillId?: string,
) => void;
