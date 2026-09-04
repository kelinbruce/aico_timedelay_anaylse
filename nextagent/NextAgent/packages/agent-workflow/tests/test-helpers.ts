import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { createWorkflowExecutionService, type WorkflowNodeCatalog } from '../src/index.js';

export function createService(input: {
  readonly recipe: RecipeDefinition;
  readonly nodeCatalog?: WorkflowNodeCatalog;
  readonly emitEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>;
  readonly resolveSecretReference?: (reference: string) => Promise<string>;
  readonly createNodeExecutionId?: () => string;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}) {
  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    ...(input.nodeCatalog === undefined ? {} : { nodeCatalog: input.nodeCatalog }),
    ...(input.emitEvent === undefined ? {} : { emitEvent: input.emitEvent }),
    ...(input.resolveSecretReference === undefined ? {} : { resolveSecretReference: input.resolveSecretReference }),
    ...(input.createNodeExecutionId === undefined ? {} : { createNodeExecutionId: input.createNodeExecutionId }),
    ...(input.executionCorrelation === undefined ? {} : { executionCorrelation: input.executionCorrelation }),
  });
}

export function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-test',
    recipeVersion: 'v1',
    inputVariables: {},
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-workflow'),
      subjectId: brand<string, 'SubjectId'>('subject-workflow'),
      displayName: 'Workflow tester',
    },
    agentId: brand<string, 'AgentId'>('agent-workflow'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-workflow'),
    requestId: brand<string, 'MessageId'>('request-workflow'),
    runId: brand<string, 'RequestRunId'>('run-workflow'),
    requestContextId: brand<string, 'RequestContextId'>('context-workflow'),
  };
}

export function recipe(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'workflow-test',
    version: 'v1',
    displayName: 'Workflow test',
    flowGraph: { nodes },
  };
}

export function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  extras: Partial<{
    readonly timeout: number;
    readonly retryPolicy: JsonObject;
    readonly onError: JsonObject;
    readonly exception: Record<string, { readonly condition?: string }>;
    readonly inputs: JsonObject;
    readonly outputs: JsonObject;
    readonly batchConfig: JsonObject;
  }> = {},
) {
  return {
    type,
    next,
    ...(extras.timeout === undefined ? {} : { timeout: extras.timeout }),
    ...(extras.retryPolicy === undefined ? {} : { retryPolicy: extras.retryPolicy }),
    ...(extras.exception === undefined ? {} : { exception: extras.exception }),
    ...(extras.onError === undefined ? {} : { onError: extras.onError }),
    ...(extras.inputs === undefined ? {} : { inputs: extras.inputs }),
    ...(extras.outputs === undefined ? {} : { outputs: extras.outputs }),
    ...(extras.batchConfig === undefined ? {} : { batchConfig: extras.batchConfig }),
  };
}
