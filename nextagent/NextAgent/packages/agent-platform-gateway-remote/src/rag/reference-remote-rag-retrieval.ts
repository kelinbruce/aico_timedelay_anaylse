import type { RagRetrievalGateway, RagRetrievalRequest, RagRetrievalResult } from '@nextagent/agent-contracts/gateway';

export interface ReferenceRemoteRagRetrievalClient {
  retrieve: (request: RagRetrievalRequest, signal?: AbortSignal) => Promise<RagRetrievalResult>;
}

export function createReferenceRemoteRagRetrievalGateway(client: ReferenceRemoteRagRetrievalClient): RagRetrievalGateway {
  return {
    retrieve(request, signal) {
      return client.retrieve(request, signal);
    },
  };
}
