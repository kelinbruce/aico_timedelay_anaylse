import { describe, expect, it, vi } from 'vitest';
import type { WorkflowExecutionRequest, WorkflowRemoteExecutionGateway, WorkflowRemoteExecutionStreamItem } from '@nextagent/agent-contracts/core';
import { createFetchWorkflowRemoteExecutionGateway } from '@nextagent/agent-platform-gateway-remote';
import { adaptFetchWorkflowRemoteGateway } from '@nextagent/agent-app/testing';

type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body?: ReadableStream<Uint8Array> | null;
}>;

function makeRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'test-recipe',
    recipeVersion: 'v1',
    inputVariables: {},
    identityContext: { tenantId: 't1' as never, subjectId: 's1' as never, displayName: 'test' },
    agentId: 'a1' as never,
    agentVersion: 'v1' as never,
    sessionId: 'sess1' as never,
    requestId: 'req1' as never,
    runId: 'run1' as never,
    requestContextId: 'ctx1' as never,
  };
}

function makeSseBody(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

function sseEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeBridgedGateway(fetchImpl: FetchLike): WorkflowRemoteExecutionGateway {
  return adaptFetchWorkflowRemoteGateway(createFetchWorkflowRemoteExecutionGateway({ endpoint: 'http://remote' }, { fetch: fetchImpl }));
}

async function collectItems(gateway: WorkflowRemoteExecutionGateway): Promise<WorkflowRemoteExecutionStreamItem[]> {
  const items: WorkflowRemoteExecutionStreamItem[] = [];
  for await (const item of gateway.execute(makeRequest(), new AbortController().signal)) {
    items.push(item);
  }
  return items;
}

const validEventData = {
  executionId: 'exec-1',
  nodeId: 'node-1',
  nodeType: 'START',
  eventType: 'NODE_STARTED',
  retryCount: 0,
  startedAt: '2025-01-01T00:00:00.000Z',
};

const validResultData = {
  executionId: 'exec-1',
  status: 'COMPLETED',
  outputVariables: { result: 'ok' },
  nodeResults: [],
  startedAt: '2025-01-01T00:00:00.000Z',
  completedAt: '2025-01-01T00:01:00.000Z',
};

describe('FetchWorkflowRemoteExecutionGateway with bridge', () => {
  it('parses SSE event and result frames with schema validation', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('event', validEventData), sseEvent('result', validResultData)]),
    });

    const items = await collectItems(makeBridgedGateway(fetchImpl));

    expect(items).toHaveLength(2);
    const first = items[0];
    const second = items[1];
    expect(first?.kind).toBe('event');
    expect(second?.kind).toBe('result');
    if (second !== undefined && second.kind === 'result') {
      expect(second.result.status).toBe('COMPLETED');
    }
  });

  it('maps HTTP 401/403 to WORKFLOW_REMOTE_UNAUTHORIZED', async () => {
    for (const status of [401, 403]) {
      const fetchImpl: FetchLike = vi.fn().mockResolvedValue({ ok: false, status, body: null });
      const items = await collectItems(makeBridgedGateway(fetchImpl));
      const first = items[0];
      expect(first?.kind).toBe('failure');
      if (first !== undefined && first.kind === 'failure') {
        expect(first.reasonCode).toBe('WORKFLOW_REMOTE_UNAUTHORIZED');
      }
    }
  });

  it('maps HTTP 408/504 to WORKFLOW_REMOTE_TIMEOUT', async () => {
    for (const status of [408, 504]) {
      const fetchImpl: FetchLike = vi.fn().mockResolvedValue({ ok: false, status, body: null });
      const items = await collectItems(makeBridgedGateway(fetchImpl));
      const first = items[0];
      expect(first?.kind).toBe('failure');
      if (first !== undefined && first.kind === 'failure') {
        expect(first.reasonCode).toBe('WORKFLOW_REMOTE_TIMEOUT');
      }
    }
  });

  it('maps HTTP 500 to WORKFLOW_REMOTE_UNAVAILABLE', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({ ok: false, status: 500, body: null });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    const first = items[0];
    if (first !== undefined && first.kind === 'failure') {
      expect(first.reasonCode).toBe('WORKFLOW_REMOTE_UNAVAILABLE');
    }
  });

  it('maps network error to WORKFLOW_REMOTE_UNAVAILABLE', async () => {
    const fetchImpl: FetchLike = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    const first = items[0];
    if (first !== undefined && first.kind === 'failure') {
      expect(first.reasonCode).toBe('WORKFLOW_REMOTE_UNAVAILABLE');
    }
  });

  it('maps invalid event payload to WORKFLOW_REMOTE_INVALID_RESPONSE', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('event', { invalid: 'payload' })]),
    });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    const first = items[0];
    if (first !== undefined && first.kind === 'failure') {
      expect(first.reasonCode).toBe('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
  });

  it('maps invalid result payload to WORKFLOW_REMOTE_INVALID_RESPONSE', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('result', { invalid: 'payload' })]),
    });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    const first = items[0];
    if (first !== undefined && first.kind === 'failure') {
      expect(first.reasonCode).toBe('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
  });

  it('maps stream end without terminal item to WORKFLOW_REMOTE_INVALID_RESPONSE', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('event', validEventData)]),
    });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    expect(items).toHaveLength(2);
    const second = items[1];
    expect(second?.kind).toBe('failure');
    if (second !== undefined && second.kind === 'failure') {
      expect(second.reasonCode).toBe('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
  });

  it('parses failure frame from SSE', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('failure', { reasonCode: 'WORKFLOW_REMOTE_TIMEOUT', message: 'timed out' })]),
    });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first?.kind).toBe('failure');
    if (first !== undefined && first.kind === 'failure') {
      expect(first.reasonCode).toBe('WORKFLOW_REMOTE_TIMEOUT');
    }
  });

  it('safe error message does not contain raw remote message', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({ ok: false, status: 500, body: null });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    const first = items[0];
    if (first !== undefined && first.kind === 'failure') {
      expect(first.message).toBe('Remote workflow execution failed safely.');
      expect(first.message).not.toContain('path');
      expect(first.message).not.toContain('credential');
    }
  });

  it('stops iteration after terminal result item', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('event', validEventData), sseEvent('result', validResultData), sseEvent('event', validEventData)]),
    });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    expect(items).toHaveLength(2);
    const second = items[1];
    expect(second?.kind).toBe('result');
  });

  it('stops iteration after terminal failure item', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([
        sseEvent('event', validEventData),
        sseEvent('failure', { reasonCode: 'WORKFLOW_REMOTE_UNAVAILABLE', message: 'fail' }),
        sseEvent('event', validEventData),
      ]),
    });
    const items = await collectItems(makeBridgedGateway(fetchImpl));
    expect(items).toHaveLength(2);
    const second = items[1];
    expect(second?.kind).toBe('failure');
  });
});

describe('WorkflowVisibleDelta content limit in remote bridge', () => {
  it('accepts event with 150000-char visible delta content', async () => {
    const largeDeltaEvent = {
      ...validEventData,
      eventType: 'NODE_OUTPUT_DELTA',
      visibleDelta: { channel: 'CONTENT', content: 'x'.repeat(150_000) },
    };
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('event', largeDeltaEvent), sseEvent('result', validResultData)]),
    });

    const items = await collectItems(makeBridgedGateway(fetchImpl));

    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe('event');
    expect(items[1]?.kind).toBe('result');
  });

  it('rejects event with 150001-char visible delta content as INVALID_RESPONSE', async () => {
    const oversizedDeltaEvent = {
      ...validEventData,
      eventType: 'NODE_OUTPUT_DELTA',
      visibleDelta: { channel: 'CONTENT', content: 'x'.repeat(150_001) },
    };
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseBody([sseEvent('event', oversizedDeltaEvent)]),
    });

    const items = await collectItems(makeBridgedGateway(fetchImpl));
    const first = items[0];
    expect(first?.kind).toBe('failure');
    if (first !== undefined && first.kind === 'failure') {
      expect(first.reasonCode).toBe('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
  });
});
