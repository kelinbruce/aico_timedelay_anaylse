import { AgentError, getLogger } from '@nextagent/agent-common';
import type { AgentId, AgentVersion, JsonObject, MessageId, RequestRunId, SafeError, SessionId, SubjectId, TenantId } from '@nextagent/agent-common';
import type {
  WorkflowRagRetrievalGateway,
  WorkflowRagRetrievalRequest,
  WorkflowRagRetrievalResult,
  WorkflowRagRetrievalIndex,
} from '@nextagent/agent-contracts/gateway';
import type { CreateWorkflowNodeCatalogOptions } from './nodes/types.js';
import type { ModelMessage } from '@nextagent/agent-contracts/model';

const workflowRagAdapterLogger = getLogger({ component: 'agent-workflow', source: 'workflow-rag-adapter' });

export type {
  WorkflowRagRetrievalGateway,
  WorkflowRagRetrievalRequest,
  WorkflowRagRetrievalResult,
  WorkflowRagRetrievalIndex,
} from '@nextagent/agent-contracts/gateway';

export interface WorkflowLifecycleHookInput {
  readonly hookId: string;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly requestRunId?: RequestRunId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly stage: 'BEFORE_MODEL_INVOKE';
  readonly boundary: {
    readonly stepId: string;
    readonly modelId: string;
    readonly toolCount: number;
    readonly safeModelRequestSummary: string;
    readonly messages?: readonly ModelMessage[];
  };
}

export interface WorkflowLifecycleHookResult {
  readonly outcome: 'PASS' | 'SKIP' | 'DENY' | 'BLOCK' | 'PEND';
  readonly safeReason?: string;
  readonly error?: SafeError;
}

export interface WorkflowGuardrailLifecycleHookAdapterOptions {
  readonly lifecycleHook: {
    invoke: (input: WorkflowLifecycleHookInput, signal?: AbortSignal) => Promise<WorkflowLifecycleHookResult> | WorkflowLifecycleHookResult;
  };
}

export function createWorkflowGuardrailLifecycleHookAdapter(
  options: WorkflowGuardrailLifecycleHookAdapterOptions,
): NonNullable<CreateWorkflowNodeCatalogOptions['evaluateGuardrail']> {
  return async (request, signal) => {
    const hookResult = await options.lifecycleHook.invoke(
      {
        hookId: request.policyId,
        sessionId: request.sessionId,
        requestId: request.requestId,
        requestRunId: request.runId,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        stage: 'BEFORE_MODEL_INVOKE',
        boundary: {
          stepId: `workflow:${request.workflowNodeId}:guardrail`,
          modelId: request.policyId,
          toolCount: 0,
          safeModelRequestSummary: request.safeContentSummary,
          messages: Object.freeze([
            {
              role: 'USER',
              content: [{ type: 'text', text: request.content }],
            },
          ]),
        },
      },
      signal,
    );
    return {
      decision: workflowGuardrailDecision(hookResult),
      ...(hookResult.safeReason === undefined ? {} : { safeReason: hookResult.safeReason }),
      ...(hookResult.error === undefined
        ? {}
        : {
            safeError: {
              code: hookResult.error.code,
              message: hookResult.error.message,
              category: hookResult.error.category,
              retryable: hookResult.error.retryable,
              ...(hookResult.error.safeDetails === undefined ? {} : { safeDetails: hookResult.error.safeDetails }),
            },
          }),
    };
  };
}

export interface WorkflowRagKnowledgeRetrieverAdapterOptions {
  readonly gateway: WorkflowRagRetrievalGateway | (() => WorkflowRagRetrievalGateway);
  readonly ensureBuilt?: (signal?: AbortSignal) => Promise<void>;
}

export function createWorkflowRagKnowledgeRetrieverAdapter(
  options: WorkflowRagKnowledgeRetrieverAdapterOptions,
): NonNullable<CreateWorkflowNodeCatalogOptions['retrieveKnowledge']> {
  return async (request, signal) => {
    await options.ensureBuilt?.(signal);
    workflowRagAdapterLogger.info({
      event: 'workflow_rag_retrieval_started',
      indexNames: request.indexes.map((index) => index.indexName),
      indexCount: request.indexes.length,
      topK: request.topK,
    });
    const result = await resolveRagRetrievalGateway(options.gateway).retrieve(
      {
        tenantId: request.request.identityContext.tenantId,
        subjectId: request.request.identityContext.subjectId,
        agentId: request.request.agentId,
        agentVersion: request.request.agentVersion,
        knowledgeScope: {
          scopeKind: 'AGENT_WORKSPACE',
          logicalRoot: 'workspace',
        },
        query: request.query,
        indexes: request.indexes.map((index): WorkflowRagRetrievalIndex => ({
          indexName: index.indexName,
          indexType: index.indexType ?? request.defaultIndexType,
          ...(index.domain === undefined ? {} : { domain: index.domain }),
          ...(index.scene === undefined ? {} : { scene: index.scene }),
          ...(index.priority === undefined ? {} : { priority: index.priority }),
          ...(index.vsTopN === undefined && request.vsTopN === undefined ? {} : { vsTopN: index.vsTopN ?? request.vsTopN }),
          ...(index.esTopN === undefined && request.esTopN === undefined ? {} : { esTopN: index.esTopN ?? request.esTopN }),
          ...(index.filters === undefined && request.filters === undefined ? {} : { filters: index.filters ?? request.filters }),
        })),
        options: {
          topK: request.topK,
        },
      },
      signal,
    );
    if (result.status === 'UNAVAILABLE') {
      workflowRagAdapterLogger.error({
        event: 'workflow_rag_retrieval_unavailable',
        status: result.status,
        diagnosticReason: result.diagnostics?.reason,
      });
      throw new AgentError({
        code: 'WORKFLOW_RAG_GATEWAY_UNAVAILABLE',
        message:
          'Workflow RAG gateway is unavailable. Configure rag-knowledge=REMOTE with a workflowRagRetrieval binding to enable workflow RAG retrieval.',
        category: 'UNAVAILABLE',
        retryable: false,
        safeDetails: {
          reasonCode: 'WORKFLOW_RAG_GATEWAY_UNAVAILABLE',
          ...(result.diagnostics?.reason === undefined ? {} : { diagnosticReason: result.diagnostics.reason }),
        },
      });
    }
    workflowRagAdapterLogger.info({
      event: 'workflow_rag_retrieval_completed',
      status: result.status,
      recommendCount: result.recommends.length,
    });
    return {
      status: result.status,
      recommends: result.recommends.slice(0, request.rankTopN),
      ...(result.diagnostics?.reason === undefined ? {} : { diagnosticReason: result.diagnostics.reason }),
    };
  };
}

function resolveRagRetrievalGateway(gateway: WorkflowRagRetrievalGateway | (() => WorkflowRagRetrievalGateway)): WorkflowRagRetrievalGateway {
  return typeof gateway === 'function' ? gateway() : gateway;
}

export function createUnavailableWorkflowRagGateway(): WorkflowRagRetrievalGateway {
  return {
    async retrieve(): Promise<WorkflowRagRetrievalResult> {
      return { status: 'UNAVAILABLE', recommends: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
    },
  };
}
function workflowGuardrailDecision(hookResult: WorkflowLifecycleHookResult) {
  return hookResult.outcome === 'DENY' || hookResult.outcome === 'BLOCK' ? 'REJECT' : hookResult.outcome === 'PASS' ? 'PASS' : 'NO_OPINION';
}
