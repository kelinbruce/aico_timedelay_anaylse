import { brand, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type { CapabilityInvocationPort, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionObserver, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '@nextagent/agent-workflow';
import { describe, expect, it, vi } from 'vitest';

describe('workflow capability safety contracts', () => {
  it('keeps resolved secrets out of workflow outputs while preserving traceable keys', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const capabilityInvocation: CapabilityInvocationPort = {
      invoke: vi.fn(async () =>
        succeeded({
          status: 'ok',
          echoed_header: 'Bearer workflow-secret',
        }),
      ),
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipe(),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        resolveSecretReference: async () => 'Bearer workflow-secret',
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal, observer(events));

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      api_result: {
        status: 'ok',
        echoed_header: '[REDACTED]',
        _trace: {
          nodeId: 'api',
          retryCount: 0,
        },
      },
    });
    expect(result.outputVariables.api_result).toMatchObject({
      _trace: {
        executionId: expect.stringMatching(/^workflow-/u),
      },
    });
    expect(JSON.stringify(result.outputVariables)).not.toContain('workflow-secret');
    expect(events.find((event) => event.nodeId === 'api' && event.eventType === 'NODE_COMPLETED')).toMatchObject({
      output: {
        api_result: {
          _trace: {
            executionId: expect.stringMatching(/^workflow-/u),
            nodeId: 'api',
            retryCount: 0,
          },
        },
      },
    });
  });
});

describe('workflow batch shape consistency across node types', () => {
  it('produces consistent batch_results and failed_items shape for RESTFUL, LLM_ROUTER, and KNOWLEDGE_SEARCH', async () => {
    // RESTFUL batch
    const restfulService = createWorkflowExecutionService({
      resolveRecipeDefinition: () => batchRecipe('RESTFUL'),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation: {
          invoke: vi.fn(async (request) => {
            const element = request.arguments.sub_question as string;
            if (element === 'fail') {
              return failed('RESTFUL_FAIL', 'timeout');
            }
            return succeeded({ ne_id: element, status: 'ok' });
          }),
        },
      }),
    });
    const restfulResult = await restfulService.execute(batchRequest(), new AbortController().signal);

    // LLM_ROUTER batch
    const llmModel: ModelInvocationService = {
      async complete(request) {
        const userMsg = request.messages.find((m) => m.role === 'USER');
        const text = userMsg && 'content' in userMsg ? userMsg.content[0] : null;
        const promptText = text && 'text' in text ? text.text : '';
        if (promptText === 'fail') {
          return {
            content: '',
            safeError: {
              code: 'MODEL_TIMEOUT',
              message: 'timeout',
              category: 'INTERNAL',
              retryable: false,
              safeDetails: { reasonCode: 'MODEL_TIMEOUT' },
            },
          };
        }
        return { content: JSON.stringify({ result: promptText }) };
      },
      stream: modelEventStreamFixture(async function* () {
        yield { content: '' };
      }),
    };
    const llmService = createWorkflowExecutionService({
      resolveRecipeDefinition: () => batchRecipe('LLM_ROUTER'),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: llmModel,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 8192,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 0,
        }),
      }),
    });
    const llmResult = await llmService.execute(batchRequest(), new AbortController().signal);

    // KNOWLEDGE_SEARCH batch
    const knowledgeService = createWorkflowExecutionService({
      resolveRecipeDefinition: () => batchRecipe('KNOWLEDGE_SEARCH'),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          if (request.query === 'fail') {
            return { status: 'OK' as const, recommends: [] };
          }
          return { status: 'OK' as const, recommends: [{ id: 'doc', title: 't', knowledge: `answer for ${request.query}`, vsScore: 1 }] };
        },
      }),
    });
    const knowledgeResult = await knowledgeService.execute(batchRequest(), new AbortController().signal);

    // Assert all three produce batch_results (append = array) and failed_items (array)
    for (const [label, result] of [
      ['RESTFUL', restfulResult],
      ['LLM_ROUTER', llmResult],
      ['KNOWLEDGE_SEARCH', knowledgeResult],
    ] as const) {
      expect(result.status, `${label} should complete`).toBe('COMPLETED');
      const batchResults = result.outputVariables.batch_results as unknown;
      expect(Array.isArray(batchResults), `${label} batch_results should be array in append mode`).toBe(true);
      const failedItems = result.outputVariables.failed_items as unknown[];
      expect(Array.isArray(failedItems), `${label} failed_items should be array`).toBe(true);
      expect(failedItems).toHaveLength(1);
      const failed = failedItems[0] as { index: number; item: unknown; error: { code: string; message: string } };
      expect(typeof failed.index).toBe('number');
      expect(failed.item).toBeDefined();
      expect(typeof failed.error.code).toBe('string');
      expect(typeof failed.error.message).toBe('string');
    }
  });
});

function recipe(): RecipeDefinition {
  return {
    recipeName: 'workflow-capability-contract',
    version: 'v1',
    displayName: 'workflow-capability-contract',
    flowGraph: {
      nodes: {
        start: {
          type: 'START',
          next: { api: {} },
        },
        api: {
          type: 'RESTFUL',
          inputs: {
            api_name: 'weather_query',
            request_header: { Authorization: 'env:WF_TOKEN' },
          },
          outputs: { api_result: '${api_response}' },
          next: { end: {} },
        },
        end: {
          type: 'END',
          next: {},
        },
      },
    },
  };
}

function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-capability-contract',
    recipeVersion: 'v1',
    inputVariables: {},
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-workflow'),
      subjectId: brand<string, 'SubjectId'>('subject-workflow'),
      displayName: 'Workflow Operator',
    },
    agentId: brand<string, 'AgentId'>('workflow-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-workflow'),
    requestId: brand<string, 'MessageId'>('request-workflow'),
    runId: brand<string, 'RequestRunId'>('run-workflow'),
    requestContextId: brand<string, 'RequestContextId'>('context-workflow'),
  };
}

function observer(events: WorkflowExecutionEvent[]): WorkflowExecutionObserver {
  return {
    emitEvent(event) {
      events.push(event);
    },
  };
}

function succeeded(structuredPayload: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload,
    generatedMessages: [],
    artifactRefs: [],
  };
}
function failed(code: string, message: string): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: {
      code,
      message,
      category: 'INTERNAL',
      retryable: false,
      safeDetails: { reasonCode: code },
    },
  };
}

function batchRecipe(nodeType: 'RESTFUL' | 'LLM_ROUTER' | 'KNOWLEDGE_SEARCH'): RecipeDefinition {
  const inputs: Record<string, unknown> =
    nodeType === 'RESTFUL'
      ? { api_name: 'batch_test' }
      : nodeType === 'LLM_ROUTER'
        ? { prompt: '${sub_question}' }
        : { rag_index: [{ index_name: 'ran-kb' }], query: '${sub_question}' };
  return {
    recipeName: 'workflow-batch-contract',
    version: 'v1',
    displayName: 'workflow-batch-contract',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { batch: {} } },
        batch: {
          type: nodeType,
          inputs: inputs as unknown as JsonObject,
          batchConfig: {
            batchInputDataItem: ['ok', 'fail', 'ok'] as unknown as readonly JsonValue[],
            batchElementVariable: 'sub_question',
            batchMode: 'serial',
            batchFailStrategy: 'continue',
          },
          outputs: {
            batch_results: '${batch_results}',
            failed_items: '${failed_items}',
          },
          next: { end: {} },
        },
        end: { type: 'END' },
      },
    },
  };
}

function batchRequest(): WorkflowExecutionRequest {
  return {
    ...baseRequest(),
    recipeName: 'workflow-batch-contract',
  };
}
import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
