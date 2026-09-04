import { describe, expect, it } from 'vitest';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildTurnBlocks } from './buildTurnBlocks.ts';

function makeEnvelope(
  eventType: StreamEnvelope['eventType'],
  sequence: number,
  payload: Record<string, unknown> = {},
  requestContextId = 'ctx-original',
): StreamEnvelope {
  return {
    eventId: `evt-converge-${sequence}`,
    sessionId: 'session-converge',
    requestId: 'req-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId,
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload: { content: '', ...payload },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

describe('D8: cancel status convergence (task 4.3)', () => {
  it('queued run cancel with mismatched attemptId converges to CANCELED', () => {
    // Simulate: REQUEST_ACCEPTED (ctx-original) → REQUEST_CANCELED (ctx-cancel-different)
    // The REQUEST_CANCELED event has a different requestContextId than REQUEST_ACCEPTED.
    // D8 ensures the terminal event is accepted, so resolveStatus finds it and returns CANCELED.
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }, 'ctx-original'),
      makeEnvelope('REQUEST_CANCELED', 2, { status: 'CANCELED', content: 'Request canceled by user.' }, 'ctx-cancel-different'),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const turn = blocks.find((b) => b.rootMessageId === 'root-1');
    expect(turn).toBeDefined();
    expect(turn?.status).toBe('CANCELED');
  });

  it('pending input run cancel converges to CANCELED (not EXECUTING)', () => {
    // Simulate: REQUEST_ACCEPTED → USER_INPUT_REQUIRED → REQUEST_CANCELED
    // Before D7/D8, REQUEST_CANCELED would be rejected and resolveStatus would return EXECUTING.
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }, 'ctx-original'),
      makeEnvelope('USER_INPUT_REQUIRED', 2, { pendingInputId: 'pi-1' }, 'ctx-original'),
      makeEnvelope('REQUEST_CANCELED', 3, { status: 'CANCELED', content: 'Request canceled by user.' }, 'ctx-original'),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const turn = blocks.find((b) => b.rootMessageId === 'root-1');
    expect(turn).toBeDefined();
    expect(turn?.status).toBe('CANCELED');
  });

  it('cancel with mismatched attemptId in same envelope set converges to CANCELED', () => {
    // D8 ensures the terminal event is accepted even when attemptId differs.
    // When both events are in the same envelope set (e.g. history), buildTurnBlocks
    // resolves status to CANCELED because it finds the REQUEST_CANCELED terminal event.
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }, 'ctx-original'),
      makeEnvelope('REQUEST_CANCELED', 2, { status: 'CANCELED', content: 'Request canceled by user.' }, 'ctx-cancel-different'),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const turn = blocks.find((b) => b.rootMessageId === 'root-1');
    expect(turn).toBeDefined();
    expect(turn?.status).toBe('CANCELED');
  });
});
