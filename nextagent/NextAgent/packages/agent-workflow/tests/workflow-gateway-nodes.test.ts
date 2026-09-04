import type { WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('START node', () => {
  it('records a node result with the correct metadata when it is the entry point', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults).toHaveLength(2);
    expect(result.nodeResults[0]).toMatchObject({
      nodeId: 'start',
      nodeType: 'START',
      status: 'NODE_COMPLETED',
    });
  });

  it('outputs no variables from the START handler', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    // START handler returns undefined, so no output variables are produced
    expect(result.nodeResults[0]?.output).toBeUndefined();
  });

  it('resolves exactly one START node as the entry point when multiple nodes exist', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('LLM', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          LLM: async () => ({ outputVariables: { result: 'done' } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults[0]?.nodeId).toBe('start');
    expect(result.nodeResults[1]?.nodeId).toBe('work');
  });

  it('fails when the recipe exposes zero START nodes', async () => {
    const service = createService({
      recipe: recipe({
        work: node('LLM', { end: {} }),
        end: node('END'),
      }),
    });

    await expect(service.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({
      code: 'WORKFLOW_ENTRY_NODE_UNRESOLVED',
    });
  });

  it('fails when the recipe exposes two or more START nodes', async () => {
    const service = createService({
      recipe: recipe({
        startA: node('START', { end: {} }),
        startB: node('START', { end: {} }),
        end: node('END'),
      }),
    });

    await expect(service.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({
      code: 'WORKFLOW_ENTRY_NODE_UNRESOLVED',
    });
  });

  it('treats START as a gateway node with no retry policy', async () => {
    // gateway nodes bypass the retry loop entirely (maxRetries forced to 0)
    const spy = vi.fn(async () => undefined as void);
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          START: spy,
        },
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    // Gateway nodes: maxRetries=0 so handler called exactly once
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('END node', () => {
  it('terminates execution and records a node result', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults).toHaveLength(2);
    expect(result.nodeResults[1]).toMatchObject({
      nodeId: 'end',
      nodeType: 'END',
      status: 'NODE_COMPLETED',
    });
  });

  it('stops execution so no further nodes run after END', async () => {
    const afterEnd = vi.fn();
    const service = createService({
      recipe: recipe({
        start: node('START', { endNode: {} }),
        endNode: node('END', { extra: {} }),
        extra: node('TOOL', {}),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            afterEnd();
            return {};
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    // END terminates even if it has a next entry
    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults.map((item) => item.nodeId)).toEqual(['start', 'endNode']);
    expect(afterEnd).not.toHaveBeenCalled();
  });

  it('outputs no variables from the END handler', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.nodeResults[1]?.output).toBeUndefined();
  });

  it('treats END as a gateway node with no retry policy', async () => {
    // The engine forces maxRetries=0 for gateway node types
    const spy = vi.fn(async () => ({ transition: { kind: 'TERMINAL' as const } }));
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          END: spy,
        },
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('START + END contract integration', () => {
  it('executes a bare recipe containing only START and END nodes', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults.map((item) => item.nodeId)).toEqual(['start', 'end']);
    expect(result.outputVariables).toEqual({});
  });

  it('emits only NODE_STARTED for START and only NODE_COMPLETED for END', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { end: {} }),
        end: node('END'),
      }),
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    const startEvents = events.filter((e) => e.nodeId === 'start');
    const endEvents = events.filter((e) => e.nodeId === 'end');
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatchObject({ eventType: 'NODE_STARTED' });
    expect(startEvents[0]).not.toHaveProperty('nodeExecutionId');
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]).toMatchObject({ eventType: 'NODE_COMPLETED' });
    expect(endEvents[0]).not.toHaveProperty('nodeExecutionId');
  });

  it('passes input variables from the request through START into downstream nodes', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { show: {} }),
        show: node('DISPLAY', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          DISPLAY: async (context) => ({
            outputVariables: { echoed: context.request.inputVariables.echo ?? null },
          }),
        },
      },
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        inputVariables: { echo: 'hello-start' },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ echoed: 'hello-start' });
  });
});
