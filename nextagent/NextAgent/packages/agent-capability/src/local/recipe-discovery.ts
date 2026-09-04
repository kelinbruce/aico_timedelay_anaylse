import type { CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';

export const localRecipeProvider: CapabilityProviderIdentity = {
  providerId: 'local-recipes',
  providerKind: 'LOCAL_DIRECTORY',
};
