import { brand, type TimelineSequence } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { createCoordinator, REQUEST_ID, RUN_ID, SESSION, SUBJECT, TENANT } from './stream-helpers.js';

describe('streamEvents lastSeenSequence routing (D8)', () => {
  it('rejects undefined anchor with filters (filtered live-tail is invalid)', async () => {
    const coordinator = createCoordinator();
    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      signal: abortedSignal(),
    });
    await expect(consumeFirst(iterator)).rejects.toThrowError(expect.objectContaining({ code: 'STREAM_REPLAY_ANCHOR_REQUIRED' }));
  });

  it('does not reject lastSeenSequence=0 with filters (valid replay anchor)', async () => {
    const coordinator = createCoordinator();
    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      lastSeenSequence: brand<number, 'TimelineSequence'>(0),
      signal: abortedSignal(),
    });
    await expect(consumeFirst(iterator)).rejects.toThrowError(expect.not.objectContaining({ code: 'STREAM_REPLAY_ANCHOR_REQUIRED' }));
  });

  it('routes lastSeenSequence=0 without filters to live-tail', async () => {
    const coordinator = createCoordinator();
    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      lastSeenSequence: brand<number, 'TimelineSequence'>(0),
      signal: abortedSignal(),
    });
    const events: unknown[] = [];
    for await (const event of iterator) {
      events.push(event);
    }
    expect(events).toEqual([]);
  });

  it('routes undefined lastSeenSequence without filters to live-tail', async () => {
    const coordinator = createCoordinator();
    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      signal: abortedSignal(),
    });
    const events: unknown[] = [];
    for await (const event of iterator) {
      events.push(event);
    }
    expect(events).toEqual([]);
  });
});

async function consumeFirst<T>(iterable: AsyncIterable<T>): Promise<T> {
  for await (const item of iterable) {
    return item;
  }
  throw new Error('iterator completed without yielding');
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}
