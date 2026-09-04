import { AgentError, type JsonObject } from '@nextagent/agent-common';
import type { WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNodeCatalog } from '../src/index.js';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('workflow execution engine', () => {
  it('executes a linear recipe in graph order', async () => {
    const calls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { result: 'ok' } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(calls).toEqual(['work']);
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
    expect(result.nodeResults.map((item) => item.nodeId)).toEqual(['start', 'work', 'end']);
  });

  it('assigns stable per-attempt ids, direct predecessors, and activates only after START observation', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const activated: string[] = [];
    const ids = ['node-1', 'node-2'];
    const service = createService({
      recipe: recipe({
        start: node('START', { first: {} }),
        first: node('TOOL', { second: {} }),
        second: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { first: true } }),
          SKILL: async () => ({ outputVariables: { second: true } }),
        },
      },
      emitEvent: (event) => {
        events.push(event);
      },
      createNodeExecutionId: () => ids.shift()!,
      executionCorrelation: {
        async withIncomingCarrier(_carrier, operation) {
          return operation();
        },
        async withExecutionRef(ref, operation) {
          expect(events).toContainEqual(
            expect.objectContaining({
              eventType: 'NODE_STARTED',
              nodeExecutionId: ref.executionId,
            }),
          );
          activated.push(ref.executionId);
          return operation();
        },
        outboundHeaders(input = {}) {
          return input;
        },
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(activated).toEqual(['node-1', 'node-2']);
    const firstEvents = events.filter((event) => event.nodeId === 'first');
    const secondEvents = events.filter((event) => event.nodeId === 'second');
    expect(firstEvents).toHaveLength(3);
    expect(firstEvents.every((event) => event.nodeExecutionId === 'node-1')).toBe(true);
    expect(firstEvents[0]?.predecessorNodeExecutionIds).toEqual([]);
    expect(secondEvents).toHaveLength(3);
    expect(secondEvents.every((event) => event.nodeExecutionId === 'node-2')).toBe(true);
    expect(secondEvents[0]?.predecessorNodeExecutionIds).toEqual(['node-1']);
  });

  it('does not invoke a node handler when its START observer fails', async () => {
    const handler = vi.fn(async () => ({ outputVariables: { result: 'unexpected' } }));
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: { TOOL: handler },
      },
    });

    await expect(
      service.execute(baseRequest(), new AbortController().signal, {
        emitEvent(event) {
          if (event.nodeId === 'work' && event.eventType === 'NODE_STARTED') {
            throw new Error('timeline unavailable');
          }
        },
      }),
    ).rejects.toThrow('timeline unavailable');

    expect(handler).not.toHaveBeenCalled();
  });

  it('consumes branch selection from gateway control semantics handlers', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { route: {} }),
        route: node('CONDITION', { fast: {}, slow: {} }),
        fast: node('TOOL', { end: {} }),
        slow: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => ({ outputVariables: { chosen: context.nodeId } }),
          SKILL: async (context) => ({ outputVariables: { chosen: context.nodeId } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ chosen: 'fast' });
    expect(result.nodeResults.map((item) => item.nodeId)).toEqual(['start', 'route', 'fast', 'end']);
  });

  it('executes a recipe across the supported capability node types', async () => {
    const calls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node('LLM', { callTool: {} }),
        callTool: node('TOOL', { callSkill: {} }),
        callSkill: node('SKILL', { callSubflow: {} }),
        callSubflow: node('SUBFLOW', { wait: {} }),
        wait: node('DELAY', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          LLM: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { modelAnswer: 'draft-plan' } };
          },
          TOOL: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { toolResult: `${String(context.variables.modelAnswer)}-checked` } };
          },
          SKILL: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { skillResult: `${String(context.variables.toolResult)}-enriched` } };
          },
          SUBFLOW: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { subflowResult: `${String(context.variables.skillResult)}-delegated` } };
          },
          DELAY: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { delayedResult: `${String(context.variables.subflowResult)}-released` } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(calls).toEqual(['askModel', 'callTool', 'callSkill', 'callSubflow', 'wait']);
    expect(result.outputVariables).toMatchObject({
      modelAnswer: 'draft-plan',
      toolResult: 'draft-plan-checked',
      skillResult: 'draft-plan-checked-enriched',
      subflowResult: 'draft-plan-checked-enriched-delegated',
      delayedResult: 'draft-plan-checked-enriched-delegated-released',
    });
    expect(result.nodeResults.map((item) => item.nodeId)).toEqual(['start', 'askModel', 'callTool', 'callSkill', 'callSubflow', 'wait', 'end']);
  });

  it('uses the last empty-condition branch as the exclusive fallback', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { route: {} }),
        route: node('CONDITION', {
          fast: { condition: "${speed == 'fast'}" },
          fallback: { condition: '' },
        }),
        fast: node('TOOL', { end: {} }),
        fallback: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { chosen: 'fast' } }),
          SKILL: async () => ({ outputVariables: { chosen: 'fallback' } }),
        },
      },
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        inputVariables: { speed: 'slow' },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ chosen: 'fallback' });
    expect(result.nodeResults.find((item) => item.nodeId === 'route')?.output).toBeUndefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        nodeId: 'route',
        eventType: 'NODE_COMPLETED',
        diagnostic: {
          reasonCode: 'WORKFLOW_EXCLUSIVE_GATEWAY_FALLBACK_SELECTED',
          selectedBranchId: 'fallback',
        },
      }),
    );
  });

  it('forwards safe visible deltas through the per-request observer', async () => {
    const observedEvents: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node('LLM', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          LLM: async (context) => {
            await context.emitOutputDelta({ channel: 'THINKING', content: 'checking context' });
            await context.emitOutputDelta({ channel: 'CONTENT', content: 'partial answer ' });
            await context.emitOutputDelta({ channel: 'CONTENT', content: 'ready' });
            return { outputVariables: { message: 'partial answer ready' } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal, {
      emitEvent: async (event) => {
        observedEvents.push(event);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(observedEvents.filter((event) => event.eventType === 'NODE_OUTPUT_DELTA')).toEqual([
      expect.objectContaining({
        nodeId: 'askModel',
        visibleDelta: {
          channel: 'THINKING',
          content: 'checking context',
          level: 'ANSWER',
        },
      }),
      expect.objectContaining({
        nodeId: 'askModel',
        visibleDelta: {
          channel: 'CONTENT',
          content: 'partial answer ',
          level: 'ANSWER',
        },
      }),
      expect.objectContaining({
        nodeId: 'askModel',
        visibleDelta: {
          channel: 'CONTENT',
          content: 'ready',
          level: 'ANSWER',
        },
      }),
    ]);
    expect(observedEvents).toContainEqual(
      expect.objectContaining({
        nodeId: 'askModel',
        eventType: 'NODE_COMPLETED',
        output: {
          message: 'partial answer ready',
        },
      }),
    );
  });

  it('records safe diagnostics when exclusive gateway conditions fail to parse', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { route: {} }),
        route: node('CONDITION', {
          fast: { condition: '${speed == }' },
          fallback: { condition: '' },
        }),
        fast: node('TOOL', { end: {} }),
        fallback: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { chosen: 'fast' } }),
          SKILL: async () => ({ outputVariables: { chosen: 'fallback' } }),
        },
      },
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        inputVariables: { speed: 'slow' },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    expect(events).toContainEqual(
      expect.objectContaining({
        nodeId: 'route',
        eventType: 'NODE_COMPLETED',
        diagnostic: {
          reasonCode: 'WORKFLOW_EXCLUSIVE_GATEWAY_FALLBACK_SELECTED',
          selectedBranchId: 'fallback',
          conditionIndex: 0,
        },
      }),
    );
  });

  it('executes an in-process parallel gateway and joins once', async () => {
    const calls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { toolDone: true } };
          },
          SKILL: async (context) => {
            calls.push(context.nodeId);
            return { outputVariables: { skillDone: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(calls.sort()).toEqual(['branchA', 'branchB']);
    expect(result.outputVariables).toMatchObject({ toolDone: true, skillDone: true });
    const nodeIds = result.nodeResults.map((item) => item.nodeId);
    expect(nodeIds[0]).toBe('start');
    expect(nodeIds[1]).toBe('fork');
    expect(nodeIds.slice(2, 4).sort()).toEqual(['branchA', 'branchB']);
    expect(nodeIds[4]).toBe('end');
  });

  it('executes parallel branches concurrently rather than sequentially', async () => {
    const startTimes: Record<string, number> = {};
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            startTimes[context.nodeId] = Date.now();
            await wait(50);
            return { outputVariables: { toolDone: true } };
          },
          SKILL: async (context) => {
            startTimes[context.nodeId] = Date.now();
            await wait(50);
            return { outputVariables: { skillDone: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const overlap = Math.abs((startTimes['branchA'] ?? 0) - (startTimes['branchB'] ?? 0));
    expect(overlap).toBeLessThan(40);
  });

  it('uses branch declaration order for parallel join predecessors', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const ids = ['node-fork', 'node-a', 'node-b', 'node-join'];
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_node: 'join' } }),
        branchA: node('TOOL', { join: {} }),
        branchB: node('SKILL', { join: {} }),
        join: node('RESTFUL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            await wait(30);
            return { outputVariables: { branchA: true } };
          },
          SKILL: async () => ({ outputVariables: { branchB: true } }),
          RESTFUL: async () => ({ outputVariables: { joined: true } }),
        },
      },
      emitEvent: (event) => {
        events.push(event);
      },
      createNodeExecutionId: () => ids.shift()!,
    });

    await service.execute(baseRequest(), new AbortController().signal);

    const joinStarted = events.find((event) => event.nodeId === 'join' && event.eventType === 'NODE_STARTED');
    expect(joinStarted).toMatchObject({
      nodeExecutionId: 'node-join',
      predecessorNodeExecutionIds: ['node-a', 'node-b'],
    });
  });

  it('uses explicit join_node from parallel gateway inputs', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_node: 'end' } }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { toolDone: true } }),
          SKILL: async () => ({ outputVariables: { skillDone: true } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ toolDone: true, skillDone: true });
  });

  it('aborts remaining branches on failure when join_on_failure is break', async () => {
    const executed: string[] = [];
    let branchBCompleted = false;
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_on_failure: 'break' } }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            executed.push(context.nodeId);
            throw new Error('branch A failed');
          },
          SKILL: async (context) => {
            executed.push(context.nodeId);
            await wait(100);
            if (!context.signal.aborted) {
              branchBCompleted = true;
            }
            return { outputVariables: { skillDone: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(executed).toContain('branchA');
    expect(branchBCompleted).toBe(false);
  });

  it('waits for all branches on failure when join_on_failure is wait', async () => {
    const executed: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_on_failure: 'wait' } }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            executed.push(context.nodeId);
            throw new Error('branch A failed');
          },
          SKILL: async (context) => {
            executed.push(context.nodeId);
            await wait(80);
            return { outputVariables: { skillDone: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(executed).toEqual(['branchA', 'branchB']);
  });

  it('aborts all branches when join_timeout expires', async () => {
    const executed: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_timeout: 1 } }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            executed.push(context.nodeId);
            await wait(1200);
            return { outputVariables: { toolDone: true } };
          },
          SKILL: async (context) => {
            executed.push(context.nodeId);
            await wait(1200);
            return { outputVariables: { skillDone: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(executed.sort()).toEqual(['branchA', 'branchB']);
  });

  it('fails when all branches fail under join_on_failure wait', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_on_failure: 'wait' } }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            throw new Error('branch A failed');
          },
          SKILL: async () => {
            throw new Error('branch B failed');
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
  });

  it('applies default wait strategy when join_on_failure is unspecified', async () => {
    const executed: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            executed.push(context.nodeId);
            throw new Error('branch A failed');
          },
          SKILL: async (context) => {
            executed.push(context.nodeId);
            await wait(40);
            return { outputVariables: { skillDone: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ skillDone: true });
  });

  it('resolves default join node to common end_node', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { toolDone: true } }),
          SKILL: async () => ({ outputVariables: { skillDone: true } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ toolDone: true, skillDone: true });
  });

  it('applies default 600s join_timeout when unspecified', async () => {
    vi.useFakeTimers();
    try {
      const service = createService({
        recipe: recipe({
          start: node('START', { fork: {} }),
          fork: node('PARALLEL', { branchA: {}, branchB: {} }),
          branchA: node('TOOL', { end: {} }),
          branchB: node('SKILL', { end: {} }),
          end: node('END'),
        }),
        nodeCatalog: {
          handlers: {
            TOOL: async () => ({ outputVariables: { toolDone: true } }),
            // branchB hangs forever; only the default 600s convergence timer can abort it.
            SKILL: async (context) => {
              await new Promise<void>((_, reject) => {
                context.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
              });
              return { outputVariables: { skillDone: true } };
            },
          },
        },
      });

      const execution = service.execute(baseRequest(), new AbortController().signal);
      // Default join_timeout is 600s; advancing past it fires the convergence timer and
      // aborts the hanging branch. Without the default the promise would never settle.
      await vi.advanceTimersByTimeAsync(600_500);
      const result = await execution;

      expect(result.status).toBe('COMPLETED');
      expect(result.outputVariables).toMatchObject({ toolDone: true });
      expect(result.outputVariables).not.toHaveProperty('skillDone');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails safely when parallel gateway matches no branch', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: { condition: "${nonexistent == 'X'}" }, branchB: { condition: "${other == 'Y'}" } }),
        branchA: node('TOOL', { end: {} }),
        branchB: node('SKILL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { toolDone: true } }),
          SKILL: async () => ({ outputVariables: { skillDone: true } }),
        },
      },
    });

    const noMatchResult = await service.execute(baseRequest(), new AbortController().signal);
    expect(noMatchResult.status).toBe('FAILED');
    expect(noMatchResult.nodeResults.find((item) => item.nodeId === 'fork')?.safeError?.code).toBe('WORKFLOW_PARALLEL_GATEWAY_NO_MATCH');
  });

  it('fails safely when parallel gateway cannot resolve a join node', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }),
        branchA: node('TOOL', { endA: {} }),
        branchB: node('SKILL', { endB: {} }),
        endA: node('END'),
        endB: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { toolDone: true } }),
          SKILL: async () => ({ outputVariables: { skillDone: true } }),
        },
      },
    });
    const joinFailedResult = await service.execute(baseRequest(), new AbortController().signal);
    expect(joinFailedResult.status).toBe('FAILED');
    expect(joinFailedResult.nodeResults.find((item) => item.nodeId === 'fork')?.safeError?.code).toBe('WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED');
  });

  it('rejects cross-branch dependsOn within concurrent fork', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node('PARALLEL', { branchA: {}, branchB: {} }, { inputs: { join_on_failure: 'break' } }),
        branchA: node('TOOL', { end: {} }),
        branchB: { type: 'SKILL', next: { end: {} }, dependsOn: ['branchA'] },
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            await wait(100);
            return { outputVariables: { toolDone: true } };
          },
          SKILL: async () => ({ outputVariables: { skillDone: true } }),
        },
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
  });

  it('fails when the workflow graph does not expose exactly one start node', async () => {
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

  it('retries timed out nodes and completes when a later attempt succeeds', async () => {
    const tool = vi.fn(async ({ signal }: { readonly signal: AbortSignal }) => {
      if (tool.mock.calls.length === 1) {
        await waitForAbort(signal);
        return {};
      }
      return { outputVariables: { recovered: true } };
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('TOOL', { end: {} }, { timeout: 1, retryPolicy: { maxRetries: 1 } }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: tool,
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(tool).toHaveBeenCalledTimes(2);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.retryCount).toBe(1);
  });

  it('links each retry attempt to the immediately failed attempt', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const ids = ['attempt-1', 'attempt-2'];
    let attempt = 0;
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('TOOL', { end: {} }, { retryPolicy: { maxRetries: 1 } }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            attempt += 1;
            if (attempt === 1) {
              throw new Error('retry');
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
      emitEvent: (event) => {
        events.push(event);
      },
      createNodeExecutionId: () => ids.shift()!,
    });

    await service.execute(baseRequest(), new AbortController().signal);

    const workEvents = events.filter((event) => event.nodeId === 'work');
    expect(workEvents.map((event) => [event.eventType, event.nodeExecutionId])).toEqual([
      ['NODE_STARTED', 'attempt-1'],
      ['NODE_FAILED', 'attempt-1'],
      ['NODE_STARTED', 'attempt-2'],
      ['NODE_OUTPUT_DELTA', 'attempt-2'],
      ['NODE_COMPLETED', 'attempt-2'],
    ]);
    expect(workEvents[2]?.predecessorNodeExecutionIds).toEqual(['attempt-1']);
  });

  it('returns FAILED after retry exhaustion and supports skip-on-error fallback', async () => {
    const failedService = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('TOOL', { end: {} }, { retryPolicy: { maxRetries: 1 } }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            throw new Error('boom');
          },
        },
      },
    });
    const skippedService = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('TOOL', { end: {} }, { exception: { end: {} } }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            throw new Error('skip');
          },
        },
      },
    });

    const failed = await failedService.execute(baseRequest(), new AbortController().signal);
    const skipped = await skippedService.execute(baseRequest(), new AbortController().signal);

    expect(failed.status).toBe('FAILED');
    expect(failed.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
    expect(skipped.status).toBe('COMPLETED');
    expect(skipped.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
  });

  it('routes to exception transition when a failing node has a matching exception branch', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              recover: {},
            },
          },
        ),
        recover: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'work') {
              throw new Error('boom');
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['work', 'recover']);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
    expect(result.outputVariables).toMatchObject({ recovered: true });
  });

  it('fails to TERMINAL when exception conditions do not match', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              only_path: { condition: '${never_match == true}' },
            },
          },
        ),
        only_path: node('END'),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            throw new Error('boom');
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
  });

  it('routes exception branch by reading error.code', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              recover: { condition: "${error.code == 'WORKFLOW_NODE_FAILED'}" },
              terminal: { condition: "${error.code == 'UNEXPECTED'}" },
            },
          },
        ),
        recover: node('TOOL', { end: {} }),
        terminal: node('END'),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'work') {
              throw new Error('boom');
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['work', 'recover']);
    expect(result.outputVariables).toMatchObject({ recovered: true });
  });

  it('routes exception branch by business error code from capability failure', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              recover_5001: { condition: "${error.code == '5001'}" },
              recover_timeout: { condition: "${error.category == 'TIMEOUT'}" },
              terminal: { condition: '' },
            },
          },
        ),
        recover_5001: node('TOOL', { end: {} }),
        recover_timeout: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'work') {
              throw new AgentError({
                code: '5001',
                message: 'order not found',
                category: 'INTERNAL',
                retryable: false,
              });
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['work', 'recover_5001']);
    expect(result.outputVariables).toMatchObject({ recovered: true });
  });

  it('does not retry the node and evaluates the explicit exception for a Capability final failure', async () => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'ORDER_CONFLICT', message: 'order changed', category: 'INTERNAL' as const, retryable: false },
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'RESTFUL',
          { recover_conflict: {} },
          {
            inputs: { api_name: 'conflict_api' },
            retryPolicy: { maxRetries: 2 },
            exception: {
              recover_conflict: { condition: "${error.code == 'ORDER_CONFLICT'}" },
              recover_fallback: { condition: '' },
            },
          },
        ),
        recover_conflict: node('TOOL', { end: {} }),
        recover_fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          ...createWorkflowNodeCatalog({ capabilityInvocation }).handlers,
          TOOL: async () => ({ outputVariables: { recovered: true } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.retryCount).toBe(0);
    expect(result.outputVariables).toMatchObject({ recovered: true });
  });

  it('treats a Capability canceled result as an interruption, not an exception', async () => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'CANCELED', message: 'canceled', category: 'CANCELED' as const, retryable: false },
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'RESTFUL',
          { recover_canceled: {} },
          {
            inputs: { api_name: 'canceled_api' },
            exception: {
              recover_canceled: { condition: "${error.category == 'CANCELED'}" },
              recover_fallback: { condition: '' },
            },
          },
        ),
        recover_canceled: node('TOOL', { end: {} }),
        recover_fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('INTERRUPTED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['VALIDATION', 'CAPABILITY_INPUT_INVALID', 'VALIDATION'],
    ['NOT_FOUND', 'CAPABILITY_NOT_FOUND', 'NOT_FOUND'],
    ['CONFLICT', 'ORDER_CONFLICT', 'CONFLICT'],
    ['UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE'],
    ['AUTHORIZATION', 'AUTHORIZATION', 'AUTHORIZATION'],
    ['POLICY_DENIED', 'POLICY_DENIED', 'POLICY_DENIED'],
    ['INTERNAL', 'INTERNAL', 'INTERNAL'],
    ['TIMEOUT', 'SANDBOX_TIMEOUT', 'TIMEOUT'],
  ] as const)('routes a Capability final %s failure into the explicit exception without node retry', async (_category, code, _category2) => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code, message: `failure ${code}`, category: _category, retryable: false },
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'RESTFUL',
          { recover: {} },
          {
            inputs: { api_name: 'category_api' },
            retryPolicy: { maxRetries: 2 },
            exception: {
              recover: { condition: "${error.code == '" + code + "'}" },
              fallback: { condition: '' },
            },
          },
        ),
        recover: node('TOOL', { end: {} }),
        fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          ...createWorkflowNodeCatalog({ capabilityInvocation }).handlers,
          TOOL: async () => ({ outputVariables: { recovered: true } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.retryCount).toBe(0);
  });

  it('evaluates the explicit exception for a CAPABILITY_OUTPUT_INVALID final failure without node retry', async () => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'CAPABILITY_OUTPUT_INVALID', message: 'output invalid', category: 'VALIDATION' as const, retryable: false },
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'RESTFUL',
          { recover: {} },
          {
            inputs: { api_name: 'output_invalid_api' },
            retryPolicy: { maxRetries: 2 },
            exception: {
              recover: { condition: "${error.code == 'CAPABILITY_OUTPUT_INVALID'}" },
              fallback: { condition: '' },
            },
          },
        ),
        recover: node('TOOL', { end: {} }),
        fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          ...createWorkflowNodeCatalog({ capabilityInvocation }).handlers,
          TOOL: async () => ({ outputVariables: { recovered: true } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.retryCount).toBe(0);
  });

  it('evaluates the explicit exception for a CAPABILITY_RESULT_UNKNOWN final failure without node retry', async () => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'CAPABILITY_RESULT_UNKNOWN', message: 'result unknown', category: 'TIMEOUT' as const, retryable: false },
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'RESTFUL',
          { recover: {} },
          {
            inputs: { api_name: 'result_unknown_api' },
            retryPolicy: { maxRetries: 2 },
            exception: {
              recover: { condition: "${error.code == 'CAPABILITY_RESULT_UNKNOWN'}" },
              fallback: { condition: '' },
            },
          },
        ),
        recover: node('TOOL', { end: {} }),
        fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          ...createWorkflowNodeCatalog({ capabilityInvocation }).handlers,
          TOOL: async () => ({ outputVariables: { recovered: true } }),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.retryCount).toBe(0);
  });

  it('normalizes a missing safeError on a final Capability failure into a safe internal failure', async () => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node('RESTFUL', { end: {} }, { inputs: { api_name: 'missing_safe_error_api' } }),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.safeError?.code).toBe('WORKFLOW_CAPABILITY_FAILED');
  });

  it('does not expose intermediate Capability retry attempts to the explicit exception', async () => {
    const capabilityInvocation = {
      invoke: vi.fn(async () => ({
        status: 'FAILED' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'UNAVAILABLE', message: 'final unavailable after governed retries', category: 'UNAVAILABLE' as const, retryable: true },
      })),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'RESTFUL',
          { recover: {} },
          {
            inputs: { api_name: 'retry_api' },
            exception: {
              recover: { condition: "${error.code == 'UNAVAILABLE'}" },
              fallback: { condition: '' },
            },
          },
        ),
        recover: node('TOOL', { end: {} }),
        fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    const workNode = result.nodeResults.find((item) => item.nodeId === 'work');
    expect(workNode?.status).toBe('NODE_FAILED');
    expect(workNode?.safeError?.code).toBe('UNAVAILABLE');
    expect(workNode?.retryCount).toBe(0);
  });

  it('injects error.category TIMEOUT and error.code WORKFLOW_NODE_TIMEOUT on timeout', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            timeout: 1,
            retryPolicy: { maxRetries: 0 },
            exception: {
              recover_timeout: { condition: "${error.category == 'TIMEOUT'}" },
              terminal: { condition: '' },
            },
          },
        ),
        recover_timeout: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'work') {
              await new Promise<void>((_, reject) => {
                context.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
              });
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['work', 'recover_timeout']);
    expect(result.outputVariables).toMatchObject({ recovered: true });
  });

  it('does not inject error.category for non-timeout engine structural failure', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              recover_validation: { condition: "${error.category == 'VALIDATION'}" },
              recover_no_category: { condition: '${error.category == null || error.category == undefined}' },
              terminal: { condition: '' },
            },
          },
        ),
        recover_validation: node('TOOL', { end: {} }),
        recover_no_category: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            if (context.nodeId === 'work') {
              throw new AgentError({
                code: 'WORKFLOW_NODE_INPUT_INVALID',
                message: 'bad input',
                category: 'VALIDATION',
                retryable: false,
              });
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
  });

  it('freezes error object and keeps existing workflow variables visible in exception condition', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { setup: {} }),
        setup: node('TOOL', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              recover_with_api: { condition: "${api_name == 'test_api' && error.code == 'WORKFLOW_NODE_FAILED'}" },
              terminal: { condition: '' },
            },
          },
        ),
        recover_with_api: node('TOOL', { end: {} }),
        terminal: node('END'),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'setup') {
              return { outputVariables: { api_name: 'test_api' } };
            }
            if (context.nodeId === 'work') {
              throw new Error('boom');
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['setup', 'work', 'recover_with_api']);
    expect(result.outputVariables).toMatchObject({ recovered: true });
  });

  it('does not include reasonCode, __workflow, or code-as-nested-key in error variable space', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: {
              has_reasonCode: { condition: "${error.reasonCode == 'WORKFLOW_NODE_FAILED'}" },
              has_workflow: { condition: "${__workflow.safeError.code == 'WORKFLOW_NODE_FAILED'}" },
            },
          },
        ),
        has_reasonCode: node('END'),
        has_workflow: node('END'),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            throw new Error('boom');
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
  });

  it('stops launching new nodes after abort and emits safe lifecycle events', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const controller = new AbortController();
    const service = createService({
      recipe: recipe({
        start: node('START', { delay: {} }),
        delay: node('DELAY', { end: {} }),
        end: node('END'),
      }),
      emitEvent: async (event) => {
        events.push(event);
        if (event.nodeId === 'delay' && event.eventType === 'NODE_STARTED') {
          controller.abort();
        }
      },
      nodeCatalog: {
        handlers: {
          DELAY: async ({ signal }) => {
            await waitForAbort(signal);
            return { outputVariables: { secret: 'token-123', path: 'C:/private/log.txt' } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
    expect(result.nodeResults.some((item) => item.nodeId === 'end')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('token-123');
    expect(JSON.stringify(events)).not.toContain('C:/private/log.txt');
  });

  it('gives exception branch precedence over onError SKIP', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: { recover: {} },
            onError: { action: 'SKIP' },
          },
        ),
        recover: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'work') {
              throw new Error('boom');
            }
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['work', 'recover']);
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
  });

  it('returns INTERRUPTED when abort fires on a node with onError SKIP', async () => {
    const controller = new AbortController();
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            onError: { action: 'SKIP' },
          },
        ),
        end: node('END'),
      }),
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
    expect(result.nodeResults.find((item) => item.nodeId === 'work')?.status).toBe('NODE_FAILED');
  });

  it('jumps to exception target when exception branch matches', async () => {
    const handlerCalls: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: { fallback: {} },
          },
        ),
        fallback: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            handlerCalls.push(context.nodeId);
            if (context.nodeId === 'work') {
              throw new Error('boom');
            }
            return { outputVariables: { fallback: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(handlerCalls).toEqual(['work', 'fallback']);
    expect(result.outputVariables).toMatchObject({ fallback: true });
  });

  it('fails safely when exception target node does not exist', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: node(
          'TOOL',
          { end: {} },
          {
            retryPolicy: { maxRetries: 0 },
            exception: { nonexistent: {} },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            throw new Error('boom');
          },
        },
      },
    });

    await expect(service.execute(baseRequest(), new AbortController().signal)).rejects.toThrow();
  });

  it('applies runtime.timeout as flow-level timeout', async () => {
    const service = createService({
      recipe: {
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
        runtime: { timeout: 1 },
      },
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            await waitForAbort(context.signal);
            return { outputVariables: { result: 'ok' } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('INTERRUPTED');
  });

  it('prefers structured retry over legacy retryPolicy', async () => {
    let calls = 0;
    const service = createService({
      recipe: {
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { work: {} } },
            work: {
              type: 'TOOL',
              next: { end: {} },
              retry: { maxAttempts: 2, delay: 0 },
              retryPolicy: { maxRetries: 0 },
            },
            end: { type: 'END', next: {} },
          },
        },
      },
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            calls += 1;
            throw new Error('boom');
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(calls).toBe(3);
  });

  it('uses runtime.defaultRetry when node has no retry', async () => {
    let calls = 0;
    const service = createService({
      recipe: {
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
        runtime: { defaultRetry: { maxAttempts: 1, delay: 0 } },
      },
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            calls += 1;
            throw new Error('boom');
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(calls).toBe(2);
  });

  it('prefers node timeout over timeoutMs', async () => {
    const service = createService({
      recipe: {
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { work: {} } },
            work: {
              type: 'TOOL',
              next: { end: {} },
              timeout: 1,
            },
            end: { type: 'END', next: {} },
          },
        },
      },
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            await waitForAbort(context.signal);
            return { outputVariables: { result: 'ok' } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    const workResult = result.nodeResults.find((item) => item.nodeId === 'work');
    expect(workResult?.status).toBe('NODE_FAILED');
  });

  it('throws WORKFLOW_DEPENDENCY_NOT_SATISFIED when dependsOn node not completed', async () => {
    const service = createService({
      recipe: {
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { work: {} } },
            work: {
              type: 'TOOL',
              next: { end: {} },
              dependsOn: ['missing'],
            },
            end: { type: 'END', next: {} },
          },
        },
      },
      nodeCatalog: {
        handlers: {
          TOOL: async () => {
            return { outputVariables: { result: 'ok' } };
          },
        },
      },
    });

    await expect(service.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({
      code: 'WORKFLOW_DEPENDENCY_NOT_SATISFIED',
    });
  });

  it('terminates with INTERRUPTED when controlPolicy.cancel is not configured', async () => {
    const controller = new AbortController();
    const service = createService({
      recipe: {
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
        runtime: {
          controlPolicy: {},
        },
      },
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
    expect(result.nodeResults.some((item) => item.nodeId === 'end')).toBe(false);
  });

  it('executes rollback node on cancel then returns INTERRUPTED', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const service = createService({
      recipe: {
        recipeName: 'workflow-test',
        version: 'v1',
        displayName: 'Workflow test',
        flowGraph: {
          nodes: {
            start: { type: 'START', next: { work: {} } },
            work: { type: 'TOOL', next: { end: {} } },
            rollback: { type: 'TOOL', next: { end: {} } },
            end: { type: 'END', next: {} },
          },
        },
        runtime: {
          controlPolicy: {
            cancel: { rollbackNode: { rollback: { condition: '' } } },
          },
        },
      },
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
    expect(calls).toContain('rollback');
  });
  it('emits NODE_STARTED with safe resolved input carrying resolved variable references', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: {
          type: 'TOOL',
          inputs: { tool_name: 'code', device_id: '${deviceId}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
      emitEvent: (event) => {
        events.push(event);
      },
    });

    await service.execute(
      {
        ...baseRequest(),
        inputVariables: { deviceId: 'device-001' },
      },
      new AbortController().signal,
    );

    const started = events.find((item) => item.nodeId === 'work' && item.eventType === 'NODE_STARTED');
    expect(started?.input).toEqual({ tool_name: 'code', device_id: 'device-001' });

    const completed = events.find((item) => item.nodeId === 'work' && item.eventType === 'NODE_COMPLETED');
    expect(completed?.input).toBeUndefined();
  });

  it('redacts secret plaintext from NODE_STARTED input', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: {
          type: 'TOOL',
          inputs: { api_name: 'query', token: 'env:API_TOKEN' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
      emitEvent: (event) => {
        events.push(event);
      },
      resolveSecretReference: async () => 'super-secret-value',
    });

    await service.execute(baseRequest(), new AbortController().signal);

    const started = events.find((item) => item.nodeId === 'work' && item.eventType === 'NODE_STARTED');
    expect(started?.input).toEqual({ api_name: 'query', token: '[REDACTED]' });
  });

  it('does not block workflow when input resolve fails', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { work: {} }),
        work: {
          type: 'TOOL',
          inputs: { token: 'env:API_TOKEN' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { result: 'ok' } }),
        },
      },
      emitEvent: (event) => {
        events.push(event);
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const started = events.find((item) => item.nodeId === 'work' && item.eventType === 'NODE_STARTED');
    expect(started?.input).toBeUndefined();
  });
  it('output_parser injected by handler does not leak into downstream node variables', async () => {
    const downstreamBindings: JsonObject[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { first: {} }),
        first: node('TOOL', { second: {} }),
        second: node('TOOL', { end: {} }),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (context) => {
            if (context.nodeId === 'first') {
              return {
                outputVariables: {
                  result: 'ok',
                  output_parser: { type: 'PIU', data: 'resolved' },
                },
              };
            }
            downstreamBindings.push(context.variables as JsonObject);
            return { outputVariables: { seen: true } };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const secondBindings = downstreamBindings[0];
    expect(secondBindings).toBeDefined();
    expect(secondBindings).not.toHaveProperty('output_parser');
    expect(secondBindings).toHaveProperty('result', 'ok');
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}
