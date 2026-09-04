import { createAgentPackageRootLocator } from '../assembly/agent-package-source-locator.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import {
  createLocalPortalAbilityConfigProvider,
  createRemotePortalAbilityConfigProvider,
  type PortalAbilityConfigProvider,
} from '../config/portal-ability-config.js';

export type { PortalAbilityConfigProvider };

export interface PreparedPortalAbilityComposition {
  readonly provider: PortalAbilityConfigProvider;
}

export function preloadPortalAbilityComposition(input: { readonly systemConfig: DefaultSystemConfig }): PreparedPortalAbilityComposition {
  const rootLocator = createAgentPackageRootLocator(input.systemConfig);
  const options = {
    sourceLocator: {
      async locate(request: { readonly agentId: string }) {
        return rootLocator.locate(request.agentId);
      },
    },
    activeAgentId: input.systemConfig.activeAgentId,
  };
  return {
    provider:
      input.systemConfig.deployment.mode === 'LOCAL'
        ? createLocalPortalAbilityConfigProvider(options)
        : createRemotePortalAbilityConfigProvider(options),
  };
}
