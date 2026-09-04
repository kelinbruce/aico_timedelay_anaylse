import type { GatewayProvider } from '@nextagent/agent-contracts/gateway';
import { createLocalGatewayProvider, createSqliteLongTermMemoryGatewayProvider, createSqliteWorkingMemoryGatewayProvider } from './index.js';

export function createDefaultLocalGatewayProviders(): readonly GatewayProvider[] {
  return [
    createSqliteWorkingMemoryGatewayProvider(),
    createSqliteLongTermMemoryGatewayProvider(),
    createLocalGatewayProvider(),
    createRemoteSkillHubReadinessProvider(),
  ];
}

export const unavailableLocalSkillHubAccessFactory = () => ({
  async listCandidates() {
    return { status: 'failed' as const, reasonCode: 'unavailable' as const, message: 'SkillHub unavailable.' };
  },
  async fetchContent() {
    return { status: 'failed' as const, reasonCode: 'download-failed' as const, message: 'Package unavailable.' };
  },
});

function createRemoteSkillHubReadinessProvider(): GatewayProvider {
  return {
    providerId: 'remote-skillhub-readiness',
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: ['skillhub'],
    create() {
      return {
        providerId: 'remote-skillhub-readiness',
        deploymentMode: 'REMOTE',
        readiness: {
          state: 'READY',
          evidenceRef: 'gateway-provider:remote-skillhub-readiness:ready',
          safeMessage: 'Remote SkillHub gateway selection is ready.',
        },
      };
    },
  };
}
