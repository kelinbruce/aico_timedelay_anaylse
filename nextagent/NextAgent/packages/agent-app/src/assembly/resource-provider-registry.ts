import type { CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';

export interface StartupResourceProviderRegistry {
  readonly capabilityProviders: readonly CapabilityProviderIdentity[];
  readonly pluginsEnabled: false;
}

export function createStartupResourceProviderRegistry(capabilityProviders: readonly CapabilityProviderIdentity[]): StartupResourceProviderRegistry {
  return {
    capabilityProviders,
    pluginsEnabled: false,
  };
}
