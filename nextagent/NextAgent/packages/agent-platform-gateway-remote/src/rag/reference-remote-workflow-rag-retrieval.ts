import { getLogger } from '@nextagent/agent-common';
import type { WorkflowRagRetrievalGateway, WorkflowRagRetrievalRequest, WorkflowRagRetrievalResult } from '@nextagent/agent-contracts/gateway';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { workflowRagRetrievalResultSchema } from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';

const validateWorkflowRagRetrievalResult = new Ajv({ allErrors: true, strict: false }).compile(workflowRagRetrievalResultSchema);
const remoteWorkflowRagLogger = getLogger({ component: 'agent-platform-gateway-remote', source: 'remote-workflow-rag' });

interface PlatformRagIndex {
  readonly ragIndex: string;
  readonly indexType: WorkflowRagRetrievalRequest['indexes'][number]['indexType'];
  readonly vsTopN?: number;
  readonly esTopN?: number;
  readonly filters?: unknown;
}

interface PlatformWorkflowRagRequest {
  readonly query: string;
  readonly ragIndexes: readonly PlatformRagIndex[];
}

function mapWorkflowRagRequestToPlatform(request: WorkflowRagRetrievalRequest): PlatformWorkflowRagRequest {
  return {
    query: request.query,
    ragIndexes: request.indexes.map((index): PlatformRagIndex => ({
      ragIndex: index.indexName,
      indexType: index.indexType,
      ...(index.vsTopN === undefined ? {} : { vsTopN: index.vsTopN }),
      ...(index.esTopN === undefined ? {} : { esTopN: index.esTopN }),
      ...(index.filters === undefined ? {} : { filters: index.filters }),
    })),
  };
}

export interface ReferenceRemoteWorkflowRagClient {
  retrieve: (request: WorkflowRagRetrievalRequest, signal?: AbortSignal) => Promise<WorkflowRagRetrievalResult>;
}

export function createReferenceRemoteWorkflowRagGateway(client: ReferenceRemoteWorkflowRagClient): WorkflowRagRetrievalGateway {
  return {
    retrieve(request, signal) {
      return client.retrieve(request, signal);
    },
  };
}

export function createHttpWorkflowRagClient(endpoint: string, executionCorrelation?: ExecutionCorrelationPort): ReferenceRemoteWorkflowRagClient {
  return {
    async retrieve(request, signal) {
      remoteWorkflowRagLogger.info({ event: 'remote_workflow_rag_request_sent', endpoint, indexCount: request.indexes.length });
      const raw = await postJson(endpoint, mapWorkflowRagRequestToPlatform(request), signal, executionCorrelation);
      if (!validateWorkflowRagRetrievalResult(raw)) {
        remoteWorkflowRagLogger.error({ event: 'remote_workflow_rag_response_invalid', endpoint });
        throw new Error('Remote workflow RAG returned an invalid response.');
      }
      const result = raw as WorkflowRagRetrievalResult;
      remoteWorkflowRagLogger.info({
        event: 'remote_workflow_rag_response_received',
        status: result.status,
        recommendCount: result.recommends.length,
      });
      return result;
    },
  };
}

async function postJson(endpoint: string, body: unknown, signal?: AbortSignal, executionCorrelation?: ExecutionCorrelationPort): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: executionCorrelation?.outboundHeaders({ 'content-type': 'application/json' }) ?? { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error('Remote workflow RAG request failed.');
  }
  return (await response.json()) as unknown;
}
