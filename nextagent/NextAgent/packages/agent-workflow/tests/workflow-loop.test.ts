import type { RecipeDefinition } from '@nextagent/agent-contracts/core';
import type { JsonObject } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

function loopRecipe(loopConfig: Record<string, unknown>): RecipeDefinition {
  return {
    recipeName: 'workflow-test',
    version: 'v1',
    displayName: 'Workflow test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { loopend: {} } },
        body: { type: 'TOOL', next: { loopend: {} } },
        loopend: { type: 'TOOL', next: { end: {} }, loopConfig: { loopEndNode: 'loopend', loopStartNode: 'body', ...loopConfig } },
        end: { type: 'END', next: {} },
      },
    },
  };
}

describe('workflow multi-node loop', () => {
  it('executes fixed cardinality loop', async () => {
    let bodyCount = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loopCardinality: 3 }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'body') {
              bodyCount += 1;
            }
            return { outputVariables: { count: bodyCount } };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(bodyCount).toBe(3);
  });

  it('executes data-driven loop with element injection', async () => {
    const elements: unknown[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        loopRecipe({
          loopInputDataItem: '${items}',
          loopElementVariable: 'item',
        }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'body') {
              elements.push(ctx.variables['item']);
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const request = { ...baseRequest(), inputVariables: { items: ['a', 'b', 'c'] } as unknown as JsonObject };
    const result = await service.execute(request, new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(elements).toEqual(['a', 'b', 'c']);
  });

  it('ends loop on completion condition', async () => {
    let bodyCount = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        loopRecipe({
          loopCardinality: 10,
          loopCompletionCondition: '${done == true}',
        }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'body') {
              bodyCount += 1;
              return { outputVariables: { done: bodyCount >= 2 } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(bodyCount).toBe(2);
  });

  it('collects loop results as List', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        loopRecipe({
          loopCardinality: 3,
          loopResultVariable: 'LOOP_RESULT',
          loopResultType: 'List',
          loopResultValue: '${count}',
        }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'body') {
              const c = (ctx.variables['count'] as number | undefined) ?? 0;
              return { outputVariables: { count: c + 1 } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables['LOOP_RESULT']).toEqual([1, 2, 3]);
  });

  it('defaults to 1 iteration when no cardinality/data/condition', async () => {
    let bodyCount = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({}),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'body') {
              bodyCount += 1;
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(bodyCount).toBe(1);
  });

  it('fails when loopInputDataItem is not an array', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        loopRecipe({
          loopInputDataItem: '${input.notarray}',
          loopElementVariable: 'item',
        }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: {} }),
        },
      },
    });
    const request = { ...baseRequest(), inputVariables: { notarray: 'scalar' } };
    const result = await service.execute(request, new AbortController().signal);
    expect(result.status).toBe('FAILED');
  });
});
