import type { RecipeDefinition } from '@nextagent/agent-contracts/core';
import type { CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import { bindRuntimeLoggerProvider, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

function recipeWithCancel(rollbackNode?: string, cancelTimeout?: number): RecipeDefinition {
  return {
    recipeName: 'workflow-cancel-test',
    version: 'v1',
    displayName: 'Cancel test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { work: {} } },
        work: { type: 'TOOL', next: { end: {} } },
        ...(rollbackNode === undefined ? {} : { [rollbackNode]: { type: 'TOOL', next: { end: {} } } }),
        end: { type: 'END', next: {} },
      },
    },
    runtime: {
      ...(rollbackNode === undefined
        ? {}
        : {
            controlPolicy: {
              cancel: { rollbackNode: { [rollbackNode]: { condition: '' } } },
              ...(cancelTimeout === undefined ? {} : { cancelTimeout }),
            },
          }),
    },
  };
}

function recipeWithCancelWithCapability(controller: AbortController, _capabilityInvocation: CapabilityInvocationPort): RecipeDefinition {
  void controller;
  void _capabilityInvocation;
  return {
    recipeName: 'workflow-cancel-capability-test',
    version: 'v1',
    displayName: 'Cancel capability test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { work: {} } },
        work: { type: 'TOOL', next: { end: {} } },
        rollback: { type: 'RESTFUL', next: { end: {} }, inputs: { api_name: 'rollback_api' } },
        end: { type: 'END', next: {} },
      },
    },
    runtime: {
      controlPolicy: {
        cancel: { rollbackNode: { rollback: { condition: '' } } },
      },
    },
  };
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

function createRecordingLogger(): RuntimeLogger & { readonly calls: ReadonlyArray<{ level: string; obj: object }> } {
  const calls: Array<{ level: string; obj: object }> = [];
  return {
    calls,
    error(obj) {
      calls.push({ level: 'error', obj });
    },
    warn(obj) {
      calls.push({ level: 'warn', obj });
    },
    info(obj) {
      calls.push({ level: 'info', obj });
    },
    debug(obj) {
      calls.push({ level: 'debug', obj });
    },
  };
}

function findLog(calls: ReadonlyArray<{ level: string; obj: object }>, event: string) {
  return calls.find((c) => c.level === 'info' && (c.obj as { event?: string }).event === event);
}

describe('workflow cancel policy', () => {
  it('aborts directly to INTERRUPTED when no cancel policy configured', async () => {
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel(),
      nodeCatalog: {
        handlers: {
          TOOL: async ({ signal }) => {
            controller.abort();
            await waitForAbort(signal);
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
  });

  it('executes rollback node on external cancel then returns INTERRUPTED', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel('rollback_cleanup'),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            return { outputVariables: { cleaned: true } };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(calls).toContain('rollback_cleanup');
    expect(result.outputVariables).toHaveProperty('cleaned');
  });

  it('fails the cancel rollback as interrupted when a rollback Capability node returns a final failure', async () => {
    const controller = new AbortController();
    const capabilityInvocation = {
      invoke: async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'ROLLBACK_CAPABILITY_FAILED', message: 'rollback failed', category: 'INTERNAL' as const, retryable: false },
      }),
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipeWithCancelWithCapability(controller, capabilityInvocation as import('@nextagent/agent-contracts/capability').CapabilityInvocationPort),
      nodeCatalog: {
        handlers: {
          ...createWorkflowNodeCatalog({
            capabilityInvocation: capabilityInvocation as import('@nextagent/agent-contracts/capability').CapabilityInvocationPort,
          }).handlers,
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            return { outputVariables: { cleaned: true } };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
  });

  it('executes rollback even when abort happens before any node', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel('rollback_cleanup'),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(calls).toContain('rollback_cleanup');
  });

  it('rollback failure logs WORKFLOW_ROLLBACK_FAILED and returns INTERRUPTED', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel('rollback_cleanup'),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            if (ctx.nodeId === 'rollback_cleanup') {
              throw new Error('cleanup failed');
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(calls).toContain('rollback_cleanup');
  });

  it('rollback does not write checkpoint', async () => {
    const checkpoints: unknown[] = [];
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-cancel-test',
        version: 'v1',
        displayName: 'Cancel test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { work: {} } },
            work: { type: 'TOOL', next: { end: {} } },
            rollback_cleanup: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
        runtime: {
          persistence: { checkpoint: true },
          controlPolicy: { cancel: { rollbackNode: { rollback_cleanup: { condition: '' } } } },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    await service.execute({ ...baseRequest(), recipeName: 'workflow-cancel-test' }, controller.signal, undefined, {
      requestPendingInput: async () => ({}),
      saveCheckpoint: async (input) => {
        checkpoints.push(input);
      },
    });
    expect(
      checkpoints.every((cp) => {
        const rs = (cp as { resumeState: { nodeId: string } }).resumeState;
        return rs.nodeId !== 'rollback_cleanup';
      }),
    ).toBe(true);
  });

  it('takes first entry when multiple cancel entries configured', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        recipeName: 'workflow-cancel-test',
        version: 'v1',
        displayName: 'Cancel test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { work: {} } },
            work: { type: 'TOOL', next: { end: {} } },
            rollback_a: { type: 'TOOL', next: { end: {} } },
            rollback_b: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
        runtime: {
          controlPolicy: {
            cancel: {
              rollbackNode: {
                rollback_a: { condition: '' },
                rollback_b: { condition: 'false' },
              },
            },
          },
        },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            calls.push(ctx.nodeId);
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(calls).toContain('rollback_a');
  });

  it('cancelTimeout aborts rollback sub-signal when exceeded', async () => {
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel('rollback_cleanup', 1),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            if (ctx.nodeId === 'rollback_cleanup') {
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
  });

  it('logs cancel_detected and cancel_no_rollback when abort has no rollback node', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel(),
      nodeCatalog: {
        handlers: {
          TOOL: async ({ signal }) => {
            controller.abort();
            await waitForAbort(signal);
            return { outputVariables: {} };
          },
        },
      },
    });
    await service.execute(baseRequest(), controller.signal);
    expect(findLog(logger.calls, 'workflow.cancel_detected')).toBeDefined();
    expect(findLog(logger.calls, 'workflow.cancel_no_rollback')).toBeDefined();
    expect(findLog(logger.calls, 'workflow.cancel_rollback_started')).toBeUndefined();
  });

  it('logs cancel_rollback_started and completed when rollback node executes', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const controller = new AbortController();
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithCancel('rollback_cleanup'),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            if (ctx.nodeId === 'work') {
              controller.abort();
              await waitForAbort(ctx.signal);
            }
            return { outputVariables: {} };
          },
        },
      },
    });
    await service.execute(baseRequest(), controller.signal);
    const detected = findLog(logger.calls, 'workflow.cancel_detected');
    expect(detected).toBeDefined();
    const started = findLog(logger.calls, 'workflow.cancel_rollback_started');
    expect(started).toBeDefined();
    expect((started!.obj as { rollbackNodeId?: string }).rollbackNodeId).toBe('rollback_cleanup');
    const completed = findLog(logger.calls, 'workflow.cancel_rollback_completed');
    expect(completed).toBeDefined();
    expect((completed!.obj as { rollbackPathState?: string }).rollbackPathState).toBe('TERMINAL');
    expect(findLog(logger.calls, 'workflow.cancel_no_rollback')).toBeUndefined();
  });
});
