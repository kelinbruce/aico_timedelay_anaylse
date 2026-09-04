import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '@nextagent/agent-workflow';
import { describe, expect, it } from 'vitest';

describe('workflow llm safety contracts', () => {
  it('keeps raw prompt and raw model output out of workflow llm safe output', async () => {
    const model: ModelInvocationService = {
      async complete() {
        return {
          content: '{"summary":"safe summary","raw_prompt":"secret prompt","rawModelOutput":"secret output"}',
        };
      },
      stream: modelEventStreamFixture(async function* () {
        yield {
          content: '{"summary":"safe summary","raw_prompt":"secret prompt","rawModelOutput":"secret output"}',
        };
      }),
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipe(),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: model,
        resolveModelInvocationConfig: async () => ({
          modelId: 'deterministic-test-model',
          contextWindowTokens: 8192,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      llm_result: {
        content: {
          summary: 'safe summary',
        },
      },
    });
    expect(result.outputVariables.invocation_trace).toMatchObject({
      nodeId: 'ask',
    });
    expect(result.outputVariables.invocation_trace).not.toHaveProperty('providerKind');
    expect(JSON.stringify(result.outputVariables)).not.toContain('secret prompt');
    expect(JSON.stringify(result.outputVariables)).not.toContain('secret output');
  });
});

function recipe(): RecipeDefinition {
  return {
    recipeName: 'workflow-llm-contract',
    version: 'v1',
    displayName: 'workflow-llm-contract',
    flowGraph: {
      nodes: {
        start: {
          type: 'START',
          next: { ask: {} },
        },
        ask: {
          type: 'LLM_ROUTER',
          inputs: {
            is_stream: 'false',
            prompt: 'Summarize safely',
            output_schema: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
              },
              required: ['summary'],
              additionalProperties: true,
            },
          },
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
    recipeName: 'workflow-llm-contract',
    recipeVersion: 'v1',
    inputVariables: {} as JsonObject,
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
