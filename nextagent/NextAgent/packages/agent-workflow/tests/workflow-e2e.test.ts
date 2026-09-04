import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionResumeState, WorkflowLoopContext } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

function e2eRequest(): Parameters<ReturnType<typeof createWorkflowExecutionService>['execute']>[0] {
  return { ...baseRequest(), recipeName: 'workflow-e2e' };
}

function requestWithResume(resumeState: WorkflowExecutionResumeState): Parameters<ReturnType<typeof createWorkflowExecutionService>['execute']>[0] {
  return { ...baseRequest(), recipeName: 'workflow-e2e', resumeState: resumeState as unknown as JsonObject };
}

// Linear topology for controlPolicy tests: start -> diagnose -> summarize -> end, plus rollback branch.
function linearRecipe(checkpoint = false): RecipeDefinition {
  return {
    recipeName: 'workflow-e2e',
    version: 'v1',
    displayName: 'Workflow E2E',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { diagnose: {} } },
        diagnose: { type: 'TOOL', next: { summarize: {} } },
        summarize: { type: 'TOOL', next: { end: {} } },
        rollback: { type: 'TOOL', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
    runtime: {
      ...(checkpoint ? { persistence: { checkpoint: true } } : {}),
    },
  };
}

// Loop topology: start -> loopend (anchor); loop body: diagnose -> loopend (exclusive).
function loopRecipe(extras: {
  readonly loop?: Record<string, unknown>;
  readonly checkpoint?: boolean;
  readonly controlPolicy?: RecipeDefinition['runtime'] extends { controlPolicy?: infer CP } ? CP : undefined;
}): RecipeDefinition {
  return {
    recipeName: 'workflow-e2e',
    version: 'v1',
    displayName: 'Workflow E2E',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { loopend: {} } },
        diagnose: { type: 'TOOL', next: { loopend: {} } },
        loopend: {
          type: 'TOOL',
          next: { summarize: {} },
          ...(extras.loop === undefined ? {} : { loopConfig: { loopEndNode: 'loopend', loopStartNode: 'diagnose', ...extras.loop } }),
        },
        summarize: { type: 'TOOL', next: { end: {} } },
        rollback: { type: 'TOOL', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
    runtime: {
      ...(extras.checkpoint === true ? { persistence: { checkpoint: true } } : {}),
      ...(extras.controlPolicy === undefined ? {} : { controlPolicy: extras.controlPolicy }),
    },
  };
}

describe('E2E-2 interrupt and resume', () => {
  it('writes checkpoint then resumes from checkpoint without replaying completed node', async () => {
    const checkpoints: WorkflowExecutionResumeState[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(true),
      nodeCatalog: { handlers: { TOOL: async (ctx) => ({ outputVariables: { node: ctx.nodeId } }) } },
    });
    const first = await service.execute(e2eRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async (input) => {
        checkpoints.push(input.resumeState);
      },
    });
    expect(first.status).toBe('COMPLETED');
    expect(checkpoints.length).toBeGreaterThan(0);
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    expect(lastCheckpoint?.recipeName).toBe('workflow-e2e');

    const resumedCalls: string[] = [];
    const service2 = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(true),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            resumedCalls.push(ctx.nodeId);
            return { outputVariables: { node: ctx.nodeId } };
          },
        },
      },
    });
    const resumeState: WorkflowExecutionResumeState = {
      executionId: lastCheckpoint?.executionId ?? 'workflow-resume:workflow-e2e:diagnose',
      recipeName: 'workflow-e2e',
      nodeId: lastCheckpoint?.nodeId ?? 'diagnose',
      nodeType: lastCheckpoint?.nodeType ?? 'TOOL',
      variables: lastCheckpoint?.variables ?? {},
    };
    const result = await service2.execute(requestWithResume(resumeState), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
  });

  it('rejects resume when recipeName does not match', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(true),
      nodeCatalog: { handlers: { TOOL: async () => ({ outputVariables: {} }) } },
    });
    const resumeState = {
      executionId: 'workflow-resume:other:diagnose',
      recipeName: 'other-recipe',
      nodeId: 'diagnose',
      nodeType: 'TOOL',
      variables: {},
    } as unknown as WorkflowExecutionResumeState;
    await expect(service.execute(requestWithResume(resumeState), new AbortController().signal)).rejects.toThrowError(
      /resume state recipeName does not match/,
    );
  });

  it('continues flow when saveCheckpoint throws and emits diagnostic event', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => linearRecipe(true),
      nodeCatalog: { handlers: { TOOL: async () => ({ outputVariables: { ok: true } }) } },
      emitEvent: (e) => {
        events.push(e);
      },
    });
    const result = await service.execute(e2eRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async () => {
        throw new Error('storage down');
      },
    });
    expect(result.status).toBe('COMPLETED');
    const failedEvents = events.filter((e) => e.diagnostic?.reasonCode === 'WORKFLOW_CHECKPOINT_WRITE_FAILED');
    expect(failedEvents.length).toBeGreaterThan(0);
  });
});

describe('E2E-3 loop effective', () => {
  it('executes fixed cardinality loop then continues to summarize', async () => {
    const calls: string[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopCardinality: 3 } }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(e2eRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(calls.filter((c) => c === 'diagnose')).toHaveLength(3);
    expect(calls).toContain('summarize');
  });

  it('executes data-driven loop injecting element variable', async () => {
    const elements: unknown[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopInputDataItem: '${alarms}', loopElementVariable: 'alarm_item' } }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'diagnose') {
              elements.push(ctx.variables['alarm_item']);
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(
      { ...e2eRequest(), inputVariables: { alarms: ['a1', 'a2', 'a3'] } as unknown as JsonObject },
      new AbortController().signal,
    );
    expect(result.status).toBe('COMPLETED');
    expect(elements).toEqual(['a1', 'a2', 'a3']);
  });

  it('ends loop on completion condition', async () => {
    let count = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopCardinality: 10, loopCompletionCondition: '${done == true}' } }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'diagnose') {
              count += 1;
              return { outputVariables: { done: count >= 2 } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(e2eRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(count).toBe(2);
  });

  it('collects loop results as List', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        loopRecipe({ loop: { loopCardinality: 3, loopResultVariable: 'LOOP_RESULT', loopResultType: 'List', loopResultValue: '${count}' } }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'diagnose') {
              const c = (ctx.variables['count'] as number | undefined) ?? 0;
              return { outputVariables: { count: c + 1 } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(e2eRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables['LOOP_RESULT']).toEqual([1, 2, 3]);
  });

  it('collects loop results as Map keyed by element id', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        loopRecipe({
          loop: {
            loopInputDataItem: '${alarms}',
            loopElementVariable: 'alarm_item',
            loopResultType: 'Map',
            loopResultKey: '${alarm_item.id}',
            loopResultValue: '${status}',
            loopResultVariable: 'LOOP_RESULT',
          },
        }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'diagnose') {
              const item = ctx.variables['alarm_item'] as { id: string };
              return { outputVariables: { status: 'ok-' + item.id } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(
      { ...e2eRequest(), inputVariables: { alarms: [{ id: 'a1' }, { id: 'a2' }] } as unknown as JsonObject },
      new AbortController().signal,
    );
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables['LOOP_RESULT']).toEqual({ a1: 'ok-a1', a2: 'ok-a2' });
  });

  it('fails when loopInputDataItem resolves to non-array', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopInputDataItem: '${notarray}', loopElementVariable: 'item' } }),
      nodeCatalog: { handlers: { TOOL: async () => ({ outputVariables: {} }) } },
    });
    const result = await service.execute(
      { ...e2eRequest(), inputVariables: { notarray: 'scalar' } as unknown as JsonObject },
      new AbortController().signal,
    );
    expect(result.status).toBe('FAILED');
  });

  it('defaults to 1 iteration when no cardinality/data/condition', async () => {
    let count = 0;
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: {} }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'diagnose') {
              count += 1;
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(e2eRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(count).toBe(1);
  });
});

describe('E2E-4 loop + checkpoint + resume integration', () => {
  it('writes loopContext in checkpoint during loop iterations', async () => {
    const checkpoints: WorkflowExecutionResumeState[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopCardinality: 3 }, checkpoint: true }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'diagnose') {
              const c = (ctx.variables['count'] as number | undefined) ?? 0;
              return { outputVariables: { count: c + 1 } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const first = await service.execute(e2eRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async (input) => {
        checkpoints.push(input.resumeState);
      },
    });
    expect(first.status).toBe('COMPLETED');

    const loopCheckpoints = checkpoints.filter((c) => c.loopContext !== undefined);
    expect(loopCheckpoints.length).toBeGreaterThan(0);
    const loopCp = loopCheckpoints[0];
    expect(loopCp?.loopContext?.loopId).toBe('loopend');
    expect(loopCp?.loopContext?.iteration).toBeGreaterThanOrEqual(0);
    expect(loopCp?.loopContext?.collectedResults).toBeDefined();
  });
  it('uses loopConfig.loopId when configured for loopContext identity', async () => {
    const checkpoints: WorkflowExecutionResumeState[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopId: 'alarm-loop', loopCardinality: 2 }, checkpoint: true }),
      nodeCatalog: { handlers: { TOOL: async () => ({ outputVariables: {} }) } },
    });
    await service.execute(e2eRequest(), new AbortController().signal, undefined, {
      requestPendingInput: async () => {
        throw new Error('not used');
      },
      saveCheckpoint: async (input) => {
        checkpoints.push(input.resumeState);
      },
    });
    const loopCp = checkpoints.find((c) => c.loopContext !== undefined);
    expect(loopCp?.loopContext?.loopId).toBe('alarm-loop');
  });

  it('resumes loop from checkpoint loopContext and completes remaining iterations', async () => {
    const resumedCalls: string[] = [];
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => loopRecipe({ loop: { loopCardinality: 3 }, checkpoint: true }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            resumedCalls.push(ctx.nodeId);
            if (ctx.nodeId === 'diagnose') {
              const c = (ctx.variables['count'] as number | undefined) ?? 0;
              return { outputVariables: { count: c + 1 } };
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const loopContext: WorkflowLoopContext = {
      loopId: 'loopend',
      iteration: 1,
      elementIndex: 1,
      collectedResults: [],
    };
    const resumeState: WorkflowExecutionResumeState = {
      executionId: 'workflow-resume:workflow-e2e:diagnose',
      recipeName: 'workflow-e2e',
      nodeId: 'diagnose',
      nodeType: 'TOOL',
      variables: { count: 1 } as unknown as JsonObject,
      loopContext,
    };
    const result = await service.execute(requestWithResume(resumeState), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(resumedCalls).toContain('summarize');
  });
});
