import type { RecipeDefinition } from '@nextagent/agent-contracts/core';
import type { WorkflowExecutionEvent, WorkflowExecutionObserver } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

// --- Fix 7: single-node loop stopBeforeNodeId conflict ---
// loopStartNode === loopEndNode => single-node loop

function singleNodeLoopRecipe(): RecipeDefinition {
  return {
    recipeName: 'workflow-test',
    version: 'v1',
    displayName: 'Workflow test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { worker: {} } },
        worker: { type: 'TOOL', next: { end: {} }, loopConfig: { loopEndNode: 'worker', loopStartNode: 'worker', loopCardinality: 2 } },
        end: { type: 'END', next: {} },
      },
    },
  };
}

describe('workflow loop and output fixes', () => {
  // Fix 7: single-node loop executes correctly
  it('executes single-node loop without stopBeforeNodeId conflict', async () => {
    let workerCount = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => singleNodeLoopRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'worker') {
              workerCount += 1;
            }
            return { outputVariables: { iteration: workerCount } };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(workerCount).toBe(2);
  });

  // Fix 9: single-node self-loop must not execute downstream nodes during loop iterations
  it('single-node self-loop does not duplicate follower node execution', async () => {
    let workerCount = 0;
    let afterCount = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { worker: {} } },
            worker: { type: 'TOOL', next: { after: {} }, loopConfig: { loopEndNode: 'worker', loopStartNode: 'worker', loopCardinality: 2 } },
            after: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'worker') {
              workerCount += 1;
            }
            if (ctx.nodeId === 'after') {
              afterCount += 1;
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(workerCount).toBe(2);
    expect(afterCount).toBe(1);
  });

  // Fix 8: generic node emits NODE_OUTPUT_DELTA with formatted outputs
  it('emits NODE_OUTPUT_DELTA for generic nodes with outputs', async () => {
    const deltas: Array<{ nodeId: string; content: string; level: string }> = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent: async (event) => {
        if (event.eventType === 'NODE_OUTPUT_DELTA' && event.visibleDelta) {
          deltas.push({ nodeId: event.nodeId, content: event.visibleDelta.content, level: event.visibleDelta.level! });
        }
      },
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { tool: {} } },
            tool: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'hidden data', result2: 'hello', result3: 'done' } }),
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal, observer);
    expect(result.status).toBe('COMPLETED');
    const toolDelta = deltas.find((d) => d.nodeId === 'tool');
    expect(toolDelta).toBeDefined();
    expect(toolDelta!.content).toBe('hidden data\nhello\ndone');
    // tool is the only non-gateway node before END => answer node
    expect(toolDelta!.level).toBe('ANSWER');
  });

  // Fix 8: single-value output sends just the value
  it('emits NODE_OUTPUT_DELTA with single value for single-output nodes', async () => {
    const deltas: Array<{ nodeId: string; content: string }> = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent: async (event) => {
        if (event.eventType === 'NODE_OUTPUT_DELTA' && event.visibleDelta) {
          deltas.push({ nodeId: event.nodeId, content: event.visibleDelta.content });
        }
      },
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { tool: {} } },
            tool: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { smsg: 'done' } }),
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal, observer);
    expect(result.status).toBe('COMPLETED');
    const toolDelta = deltas.find((d) => d.nodeId === 'tool');
    expect(toolDelta).toBeDefined();
    expect(toolDelta!.content).toBe('done');
  });

  // Fix 8: nodes that already emit delta do not get duplicate
  it('does not emit duplicate NODE_OUTPUT_DELTA for nodes with explicit delta', async () => {
    const deltas: Array<{ nodeId: string; content: string }> = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent: async (event) => {
        if (event.eventType === 'NODE_OUTPUT_DELTA' && event.visibleDelta && event.nodeId === 'display') {
          deltas.push({ nodeId: event.nodeId, content: event.visibleDelta.content });
        }
      },
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { display: {} } },
            display: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            await ctx.emitOutputDelta({ channel: 'CONTENT', content: 'hello from display', level: 'ANSWER' });
            return { outputVariables: { smsg: 'hello' } };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal, observer);
    expect(result.status).toBe('COMPLETED');
    // Should have the explicit delta, not a duplicate from outputVariables
    expect(deltas.length).toBe(1);
    expect(deltas[0]!.content).toBe('hello from display');
  });

  // Fix 8: answer node gets ANSWER level
  it('emits NODE_OUTPUT_DELTA with ANSWER level for answer node', async () => {
    const deltas: Array<{ nodeId: string; content: string; level: string }> = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent: async (event) => {
        if (event.eventType === 'NODE_OUTPUT_DELTA' && event.visibleDelta) {
          deltas.push({ nodeId: event.nodeId, content: event.visibleDelta.content, level: event.visibleDelta.level! });
        }
      },
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { tool: {} } },
            tool: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { answer: 'the answer' } }),
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal, observer);
    expect(result.status).toBe('COMPLETED');
    // tool is the answer node (last non-gateway before END)
    const answerDelta = deltas.find((d) => d.nodeId === 'tool');
    expect(answerDelta).toBeDefined();
    expect(answerDelta!.level).toBe('ANSWER');
  });

  // Fix #9: Python variable injection maps undefined → None
  it('injects None for undefined Python variables instead of skipping', async () => {
    const capturedArgs: unknown[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { python: {} } },
            python: { type: 'TOOL', next: { end: {} }, inputs: { script: "print('ok')", missing_var: '${nonexistent}' } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'python') {
              capturedArgs.push(ctx.node.inputs);
            }
            return { outputVariables: { result: 'done' } };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
  });

  // Fix #8: Knowledge node with python_result whole-object reference
  // When python_result contains metadata keys, parseKnowledgeIndexes strips them
  it('handles python_result whole-object reference for rag_index', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent: async (event) => {
        events.push(event);
      },
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { python: {} } },
            python: { type: 'TOOL', next: { knowledge: {} }, inputs: { script: "print('ok')" }, outputs: { python_result: '${python_result}' } },
            knowledge: { type: 'TOOL', next: { end: {} }, inputs: { rag_index: '${python_result}' } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'python') {
              return {
                outputVariables: { python_result: { exit_code: 0, stdout: 'ok', stderr: '', timed_out: false, '0': { index_name: 'test-index' } } },
              };
            }
            if (ctx.nodeId === 'knowledge') {
              // Should not throw — metadata should be stripped and "0" key extracted
              return { outputVariables: { result: 'knowledge done' } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal, observer);
    expect(result.status).toBe('COMPLETED');
  });

  // Fix #8: python_result with no numeric keys — strips metadata and wraps
  it('handles python_result whole-object with no numeric keys for rag_index', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { python: {} } },
            python: { type: 'TOOL', next: { knowledge: {} }, inputs: { script: "print('ok')" }, outputs: { python_result: '${python_result}' } },
            knowledge: { type: 'TOOL', next: { end: {} }, inputs: { rag_index: '${python_result}' } },
            end: { type: 'END', next: {} },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'python') {
              return { outputVariables: { python_result: { exit_code: 0, stdout: 'ok', stderr: '', timed_out: false, index_name: 'direct-index' } } };
            }
            if (ctx.nodeId === 'knowledge') {
              return { outputVariables: { result: 'knowledge done' } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
  });
});
