import type {
  WorkflowExecutionEvent,
  WorkflowExecutionObserver,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { createRemoteWorkflowExecutionService } from '../src/index.js';
import { baseRequest, createService, node, recipe } from './test-helpers.js';

describe('workflow remote characterization', () => {
  it('local and remote produce equivalent result shape for same recipe', async () => {
    const testRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });

    const localService = createService({ recipe: testRecipe });
    const localResult = await localService.execute(baseRequest(), new AbortController().signal);

    const fakeGateway: WorkflowRemoteExecutionGateway = {
      async *execute(): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
        for (const nr of localResult.nodeResults) {
          const event: WorkflowExecutionEvent = {
            executionId: 'remote-exec-1',
            nodeId: nr.nodeId,
            nodeType: nr.nodeType,
            eventType: nr.status === 'NODE_COMPLETED' ? 'NODE_COMPLETED' : 'NODE_STARTED',
            retryCount: nr.retryCount,
            startedAt: nr.startedAt,
          };
          yield { kind: 'event', event };
        }
        yield {
          kind: 'result',
          result: {
            executionId: 'remote-exec-1',
            status: localResult.status,
            outputVariables: localResult.outputVariables,
            nodeResults: localResult.nodeResults,
            startedAt: localResult.startedAt,
            completedAt: localResult.completedAt,
          },
        };
      },
    };

    const remoteService = createRemoteWorkflowExecutionService({ gateway: fakeGateway });
    const remoteFinalResult = await remoteService.execute(baseRequest(), new AbortController().signal);

    expect(remoteFinalResult.status).toBe(localResult.status);
    expect(remoteFinalResult.outputVariables).toEqual(localResult.outputVariables);
    expect(remoteFinalResult.nodeResults.map((nr) => nr.nodeId)).toEqual(localResult.nodeResults.map((nr) => nr.nodeId));
    expect(remoteFinalResult.nodeResults.map((nr) => nr.status)).toEqual(localResult.nodeResults.map((nr) => nr.status));
  });

  it('remote event streaming uses same workflow event vocabulary as local', async () => {
    const testRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });

    const localEvents: WorkflowExecutionEvent[] = [];
    const localService = createService({
      recipe: testRecipe,
      emitEvent(event) {
        localEvents.push(event);
      },
    });
    await localService.execute(baseRequest(), new AbortController().signal);

    const localEventTypes = localEvents.map((e) => e.eventType);
    expect(localEventTypes).toContain('NODE_STARTED');
    expect(localEventTypes).toContain('NODE_COMPLETED');

    const remoteEvents: WorkflowExecutionEvent[] = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent(event) {
        remoteEvents.push(event);
      },
    };

    const fakeGateway: WorkflowRemoteExecutionGateway = {
      async *execute(): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
        for (const e of localEvents) {
          yield { kind: 'event', event: e };
        }
        yield {
          kind: 'result',
          result: {
            executionId: 'remote-exec-1',
            status: 'COMPLETED',
            outputVariables: {},
            nodeResults: [],
            startedAt: new Date(),
            completedAt: new Date(),
          },
        };
      },
    };

    const remoteService = createRemoteWorkflowExecutionService({ gateway: fakeGateway });
    await remoteService.execute(baseRequest(), new AbortController().signal, observer);

    expect(remoteEvents.map((e) => e.eventType)).toEqual(localEventTypes);
    expect(remoteEvents.map((e) => e.nodeType)).toEqual(localEvents.map((e) => e.nodeType));
  });
});
