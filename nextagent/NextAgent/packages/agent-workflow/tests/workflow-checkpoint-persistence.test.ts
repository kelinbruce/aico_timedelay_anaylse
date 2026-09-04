import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionRequest, WorkflowExecutionResumeState } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

function recipeWithCheckpoint(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'workflow-test',
    version: 'v1',
    displayName: 'Workflow test',
    flowGraph: { nodes },
    runtime: { persistence: { checkpoint: true } },
  };
}

function linearRecipe(): RecipeDefinition {
  return recipeWithCheckpoint({
    start: { type: 'START', next: { work: {} } },
    work: { type: 'TOOL', next: { end: {} } },
    end: { type: 'END', next: {} },
  });
}

describe('workflow checkpoint persistence', () => {
  it('writes checkpoint after non-gateway node completion when persistence.checkpoint is true', async () => {
    const checkpoints: WorkflowExecutionResumeState[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
    });

    await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async (input) => {
        checkpoints.push(input.resumeState);
      },
    });

    expect(checkpoints.length).toBe(1);
    const [checkpoint] = checkpoints;
    expect(checkpoint?.nodeId).toBe('work');
    expect(checkpoint?.nodeType).toBe('TOOL');
    expect(checkpoint?.recipeName).toBe('workflow-test');
    expect(checkpoint?.variables).toMatchObject({ result: 'ok' });
  });

  it('does not write checkpoint for gateway nodes', async () => {
    const checkpoints: WorkflowExecutionResumeState[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
    });

    await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async (input) => {
        checkpoints.push(input.resumeState);
      },
    });

    const nodeIds = checkpoints.map((c) => c.nodeId);
    expect(nodeIds).not.toContain('start');
    expect(nodeIds).not.toContain('end');
  });

  it('does not write checkpoint when persistence.checkpoint is not enabled', async () => {
    const checkpoints: WorkflowExecutionResumeState[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
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
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
    });

    await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async (input) => {
        checkpoints.push(input.resumeState);
      },
    });

    expect(checkpoints.length).toBe(0);
  });

  it('continues execution when saveCheckpoint throws', async () => {
    const events: string[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
      emitEvent: (event) => {
        if (event.diagnostic?.reasonCode === 'WORKFLOW_CHECKPOINT_WRITE_FAILED') {
          events.push(event.diagnostic.reasonCode);
        }
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async () => {
        throw new Error('checkpoint store unavailable');
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(events).toContain('WORKFLOW_CHECKPOINT_WRITE_FAILED');
  });
});
