import { createLocalConfiguredWebAuth, localIdentityFromConfig } from '@nextagent/agent-channel-web-auth-local';
import { AgentError } from '@nextagent/agent-common';
import type { LocalConfiguredAuthChannelContribution } from './channel-composition.js';

export function createLocalConfiguredAuthChannelContribution(): LocalConfiguredAuthChannelContribution {
  return {
    register(input) {
      const localAuthConfig = input.context.systemConfig.auth.localAuth;
      if (localAuthConfig?.enabled !== true || localAuthConfig.credentialRef === undefined || localAuthConfig.cookieTtlMs === undefined) {
        throw new AgentError({
          code: 'LOCAL_AUTH_CONFIGURATION_REQUIRED',
          message: 'Local configured auth entrypoint requires enabled local auth configuration.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const localAuth = createLocalConfiguredWebAuth({
        loopbackOnly: true,
        identity: localIdentityFromConfig(input.context.systemConfig.auth.localIdentity),
        credentialRef: localAuthConfig.credentialRef,
        cookieTtlMs: localAuthConfig.cookieTtlMs,
        credentialResolver: input.context.credentialResolver,
        ...(input.protectedPathPrefixes === undefined ? {} : { protectedPathPrefixes: input.protectedPathPrefixes }),
        ...(input.routePrefix === undefined ? {} : { routePrefix: input.routePrefix }),
        registerProtectedRoutes: async (server, auth) => {
          await input.registerProtectedWebChannel(server, auth.resolveIdentity);
        },
      });
      void input.context.server.register(localAuth.plugin);
      return { ready: () => localAuth.ready() };
    },
  };
}
