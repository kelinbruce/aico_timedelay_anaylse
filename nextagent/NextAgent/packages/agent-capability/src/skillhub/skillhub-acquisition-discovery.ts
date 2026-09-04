import type { CapabilityDescriptor, CapabilityDiscovery, CapabilitySearchCriteria } from '@nextagent/agent-contracts/capability';

import type { SkillSourceDiscovery } from '../skills/skill-source-discovery.js';
import { skillHubAcquireSkillCapabilityId, skillHubAcquireSkillInputSchema, skillHubAcquireSkillOutputSchema } from './skillhub-acquisition-tool.js';

export function withSkillHubAcquisitionCapability(
  discovery: CapabilityDiscovery & { readonly provider: { readonly providerKind: 'SKILL_HUB' } },
): CapabilityDiscovery {
  const source = discovery as Partial<SkillSourceDiscovery>;
  return {
    provider: discovery.provider,
    discoveryMode: discovery.discoveryMode,
    ...(discovery.listAll === undefined ? {} : { listAll: discovery.listAll.bind(discovery) }),
    ...(discovery.resolve === undefined ? {} : { resolve: discovery.resolve.bind(discovery) }),
    ...(discovery.listCurrent === undefined
      ? {}
      : {
          async listCurrent(criteria, signal) {
            return [descriptor(discovery.provider), ...(await discovery.listCurrent!(criteria, signal))];
          },
        }),
    ...(discovery.getSkillScanEvidence === undefined ? {} : { getSkillScanEvidence: discovery.getSkillScanEvidence.bind(discovery) }),
    ...(discovery.getSkillScanRoot === undefined ? {} : { getSkillScanRoot: discovery.getSkillScanRoot.bind(discovery) }),
    ...(source.loadCanonicalBodyView === undefined ? {} : { loadCanonicalBodyView: source.loadCanonicalBodyView.bind(discovery) }),
    ...(source.listSkillResources === undefined ? {} : { listSkillResources: source.listSkillResources.bind(discovery) }),
    ...(source.readSkillResource === undefined ? {} : { readSkillResource: source.readSkillResource.bind(discovery) }),
    async search(criteria: CapabilitySearchCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
      if (criteria.requestedCapabilityId === skillHubAcquireSkillCapabilityId) {
        return [descriptor(discovery.provider)];
      }
      const discovered = (await discovery.search?.(criteria, signal)) ?? [];
      if (criteria.requestedCapabilityId !== undefined || criteria.modelInvocable === false) {
        return discovered;
      }
      return [descriptor(discovery.provider), ...discovered];
    },
  };
}

function descriptor(provider: CapabilityDescriptor['provider']): CapabilityDescriptor {
  return {
    capabilityId: skillHubAcquireSkillCapabilityId,
    kind: 'TOOL',
    provider,
    displayName: 'Acquire skill',
    locales: {
      language: {
        'zh-CN': { displayName: '获取技能' },
        'en-US': { displayName: 'Acquire skill' },
      },
    },
    description:
      'Acquire a governed SkillHub Skill when current Skills are insufficient. Successful acquisition only affects a later capability resolution and model step.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: skillHubAcquireSkillInputSchema,
    outputSchema: skillHubAcquireSkillOutputSchema,
    replayPolicy: 'IDEMPOTENT',
    disclosurePolicy: { mode: 'EAGER' },
  };
}
