import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { SkillCatalogProviderKind, SkillCatalogQueryPort, SkillCatalogSummaryEntry } from '@nextagent/agent-contracts/runtime';

export interface SkillMetadataView {
  readonly matched: boolean;
  readonly metadata?: {
    readonly userInvocable?: boolean;
    readonly sourceMetadata?: Readonly<Record<string, string | readonly string[]>>;
  };
}

export interface SkillCatalogQueryPortOptions {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly catalog: CapabilityCatalog;
  readonly defaultAgentId: Parameters<AgentAssemblyRegistry['active']>[0];
  readonly readSkillMetadata: (descriptor: CapabilityDescriptor) => SkillMetadataView;
}

export function createSkillCatalogQueryPort(options: SkillCatalogQueryPortOptions): SkillCatalogQueryPort {
  return {
    async listSkills(request, signal) {
      const assembly = await options.assemblyRegistry.active(options.defaultAgentId);
      const descriptors = await options.catalog.listAvailable({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentAssembly: assembly,
        includeUnavailable: false,
      });
      signal?.throwIfAborted();
      const validProviderKinds: readonly SkillCatalogProviderKind[] = ['BUNDLED', 'LOCAL_DIRECTORY', 'SKILL_HUB'];
      const skills: SkillCatalogSummaryEntry[] = descriptors
        .filter((descriptor) => descriptor.kind === 'SKILL')
        .filter((descriptor) => {
          const metadata = options.readSkillMetadata(descriptor);
          return metadata.matched && metadata.metadata?.userInvocable === true;
        })
        .filter((descriptor) => validProviderKinds.includes(descriptor.provider.providerKind as SkillCatalogProviderKind))
        .map((descriptor) => {
          const sourceMetadata = options.readSkillMetadata(descriptor).metadata?.sourceMetadata;
          return {
            capabilityId: descriptor.capabilityId,
            displayName: descriptor.displayName,
            description: descriptor.description,
            providerKind: descriptor.provider.providerKind as SkillCatalogProviderKind,
            ...(descriptor.version === undefined ? {} : { version: descriptor.version }),
            ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
          };
        });
      const filtered =
        request.keyword === undefined || request.keyword.length === 0
          ? skills
          : skills.filter((skill) => {
              const keyword = request.keyword!.toLowerCase();
              const candidates = [skill.displayName, skill.capabilityId, skill.sourceMetadata?.['zh-name'], skill.sourceMetadata?.['en-name']];
              return candidates.some((value) => typeof value === 'string' && value.toLowerCase().includes(keyword));
            });
      const total = filtered.length;
      const start = (request.pageNum - 1) * request.pageSize;
      const end = start + request.pageSize;
      const paged = start >= total ? [] : filtered.slice(start, end);
      return { total, pageNum: request.pageNum, pageSize: request.pageSize, skills: paged };
    },
  };
}
