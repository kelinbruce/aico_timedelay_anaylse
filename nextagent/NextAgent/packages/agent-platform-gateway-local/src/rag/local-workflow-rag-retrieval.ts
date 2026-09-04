import { getLogger } from '@nextagent/agent-common';
import type {
  RagRetrievalGateway,
  WorkflowRagRetrievalGateway,
  WorkflowRagRetrievalRequest,
  WorkflowRagRetrievalResult,
} from '@nextagent/agent-contracts/gateway';

const logger = getLogger({ component: 'agent-platform-gateway-local', source: 'local-workflow-rag-adapter' });

export function createLocalWorkflowRagGateway(gateway: RagRetrievalGateway): WorkflowRagRetrievalGateway {
  return {
    async retrieve(request: WorkflowRagRetrievalRequest, signal?: AbortSignal): Promise<WorkflowRagRetrievalResult> {
      const indexNames = request.indexes.map((index) => index.indexName);
      logger.info({
        event: 'local_workflow_rag_retrieval_started',
        indexCount: indexNames.length,
        queryLength: request.query.length,
        topK: request.options.topK,
      });
      const result = await gateway.retrieve(
        {
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          agentVersion: request.agentVersion,
          knowledgeScope: request.knowledgeScope,
          query: request.query,
          indexes: indexNames,
          options: request.options,
        },
        signal,
      );
      return {
        status: result.status,
        recommends: result.results.map((chunk) => ({
          id: chunk.source,
          title: fileNameFromRef(chunk.source),
          knowledge: chunk.content,
          source: chunk.source,
          ...(chunk.score === undefined ? {} : { vsScore: chunk.score }),
          ...(chunk.rankHint === undefined ? {} : { rankHint: chunk.rankHint }),
        })),
        ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
      };
    },
  };
}

function fileNameFromRef(ref: string): string {
  const normalized = ref.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return segments.at(-1) ?? normalized;
}
