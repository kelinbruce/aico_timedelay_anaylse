import type { JsonObject } from '@nextagent/agent-common';
import type { WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { adaptFetchWorkflowRemoteGateway } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

describe('workflow remote bridge', () => {
  it('deserializes validated HTTP dates before exposing typed workflow events and results', async () => {
    const gateway = adaptFetchWorkflowRemoteGateway({
      async *execute(_request: JsonObject, _signal: AbortSignal) {
        yield {
          kind: 'event' as const,
          event: {
            executionId: 'remote-execution',
            nodeId: 'start',
            nodeType: 'START',
            eventType: 'NODE_STARTED',
            retryCount: 0,
            startedAt: '2026-07-31T00:00:00.000Z',
          },
        };
        yield {
          kind: 'result' as const,
          result: {
            executionId: 'remote-execution',
            status: 'COMPLETED',
            outputVariables: { outcome: 'ok' },
            nodeResults: [
              {
                nodeId: 'start',
                nodeType: 'START',
                status: 'NODE_COMPLETED',
                retryCount: 0,
                startedAt: '2026-07-31T00:00:00.000Z',
                completedAt: '2026-07-31T00:00:01.000Z',
              },
            ],
            startedAt: '2026-07-31T00:00:00.000Z',
            completedAt: '2026-07-31T00:00:01.000Z',
          },
        };
      },
    });

    const items = [];
    for await (const item of gateway.execute(baseRequest() as WorkflowExecutionRequest, new AbortController().signal)) {
      items.push(item);
    }

    expect(items[0]?.kind).toBe('event');
    expect(items[0]?.kind === 'event' && items[0].event.startedAt).toBeInstanceOf(Date);
    expect(items[1]?.kind).toBe('result');
    expect(items[1]?.kind === 'result' && items[1].result.startedAt).toBeInstanceOf(Date);
    expect(items[1]?.kind === 'result' && items[1].result.nodeResults[0]?.completedAt).toBeInstanceOf(Date);
  });
});
