import { describe, expect, it } from 'vitest';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildTurnBlocks } from './buildTurnBlocks.ts';

function makeEnvelope(eventType: StreamEnvelope['eventType'], sequence: number, payload: Record<string, unknown> = {}): StreamEnvelope {
  return {
    eventId: `evt-${sequence}`,
    sessionId: 'session-cancel-test',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload: { content: '', ...payload },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

describe('D2: resolveStatus normalizes cancel-category REQUEST_FAILED to CANCELED', () => {
  it('returns CANCELED for REQUEST_FAILED with category=CANCELED', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('REQUEST_FAILED', 2, { status: 'FAILED', category: 'CANCELED', content: 'Request failed: Model invocation was canceled.' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const turn = blocks.find((b) => b.aiEvents.some((e) => e.eventType === 'REQUEST_FAILED'));
    expect(turn?.status).toBe('CANCELED');
  });

  it('returns FAILED for REQUEST_FAILED without cancel category', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('REQUEST_FAILED', 2, { status: 'FAILED', category: 'INTERNAL', content: 'Request failed safely: INTERNAL_ERROR' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const turn = blocks.find((b) => b.aiEvents.some((e) => e.eventType === 'REQUEST_FAILED'));
    expect(turn?.status).toBe('FAILED');
  });

  it('returns CANCELED for REQUEST_CANCELED event (unchanged)', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('REQUEST_CANCELED', 2, { status: 'CANCELED', content: 'Request canceled by user.' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const turn = blocks.find((b) => b.aiEvents.some((e) => e.eventType === 'REQUEST_CANCELED'));
    expect(turn?.status).toBe('CANCELED');
  });
});
