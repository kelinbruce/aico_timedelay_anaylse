import type { RagRetrievalGateway, RagRetrievalReason } from '@nextagent/agent-contracts/gateway';

export function createUnavailableRagRetrievalGateway(reason: RagRetrievalReason = 'PROVIDER_UNAVAILABLE'): RagRetrievalGateway {
  return {
    async retrieve() {
      return { status: 'UNAVAILABLE', results: [], diagnostics: { reason } };
    },
  };
}
