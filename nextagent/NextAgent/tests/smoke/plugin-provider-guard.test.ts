import { brand } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { expect, it } from 'vitest';
import { assembleCapabilityProviders } from '../../packages/agent-capability/src/extension-registration.js';
import { describeRealModelSmoke } from './system-smoke-helpers.js';

describeRealModelSmoke('plugin provider guard', () => {
  it('keeps non-Tool descriptors from plugin providers unavailable', async () => {
    const provider: CapabilityProviderIdentity = {
      providerId: 'telecom.plugin',
      providerKind: 'CUSTOM',
      providerType: 'nextagent-plugin-tool',
    };
    const snapshot = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: {
          provider,
          discoveryMode: 'EAGER',
          async listAll() {
            return [agentDescriptor('plugin-agent', provider)];
          },
        },
      },
    ]);

    const diagnostics = await snapshot.validateStartupRegistration(new AbortController().signal);
    const descriptors = await snapshot.eagerDiscoveries[0]!.listAll!(new AbortController().signal);

    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'plugin-agent',
        availabilityStatus: 'UNAVAILABLE',
        availabilityReason: 'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED',
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED',
        providerId: 'telecom.plugin',
        capabilityId: 'plugin-agent',
        summary: 'Plugin provider descriptor kind is unsupported.',
      },
    ]);
  });
});

function agentDescriptor(capabilityId: string, provider: CapabilityProviderIdentity): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'AGENT',
    provider,
    displayName: capabilityId,
    description: `${capabilityId} descriptor.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}
