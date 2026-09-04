import { brand } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionResumeState } from '@nextagent/agent-contracts/core';
import type { JsonObject } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

function resumeRecipe(): RecipeDefinition {
  return {
    recipeName: 'workflow-test',
    version: 'v1',
    displayName: 'Workflow test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { work: {} } },
        work: { type: 'TOOL', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
  };
}

describe('workflow resume from checkpoint', () => {
  it('resumes from resumeState.nodeId using resumeState.variables', async () => {
    const calls: string[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => resumeRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            return { outputVariables: { result: 'resumed' } };
          },
        },
      },
    });

    const resumeState: WorkflowExecutionResumeState = {
      executionId: 'workflow-resume:test:work',
      recipeName: 'workflow-test',
      nodeId: 'work',
      nodeType: 'TOOL',
      variables: { preloaded: true },
    };

    const request = {
      ...baseRequest(),
      resumeState: resumeState as unknown as JsonObject,
    };

    const result = await service.execute(request, new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(calls).toEqual(['work']);
    expect(result.outputVariables).toMatchObject({ result: 'resumed' });
    expect(result.nodeResults.map((n) => n.nodeId)).toEqual(['work', 'end']);
  });

  it('parses loopContext from resumeState', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => resumeRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
    });

    const resumeState = {
      executionId: 'workflow-resume:test:work',
      recipeName: 'workflow-test',
      nodeId: 'work',
      nodeType: 'TOOL',
      variables: {},
      loopContext: { loopId: 'loop-1', iteration: 2, elementIndex: 1, collectedResults: [{ item: 1 }] },
    };

    const request = {
      ...baseRequest(),
      resumeState: resumeState as unknown as JsonObject,
    };

    const result = await service.execute(request, new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('starts from entry node when resumeState is absent', async () => {
    const calls: string[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => resumeRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            return { outputVariables: { result: 'ok' } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults.map((n) => n.nodeId)).toEqual(['start', 'work', 'end']);
  });

  it('rejects resume when recipeName does not match', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => resumeRecipe(),
      nodeCatalog: { handlers: { TOOL: async () => ({ outputVariables: {} }) } },
    });

    const resumeState = {
      executionId: 'workflow-resume:other:work',
      recipeName: 'other-recipe',
      nodeId: 'work',
      nodeType: 'TOOL',
      variables: {},
    };

    const request = {
      ...baseRequest(),
      resumeState: resumeState as unknown as JsonObject,
    };

    await expect(service.execute(request, new AbortController().signal)).rejects.toThrowError(/resume state recipeName does not match/);
  });
});
