import { describe, expect, it, vi } from 'vitest';
import { createCoordinator, SESSION, SUBJECT, TENANT } from './stream-helpers.js';

describe('stream idle timeout (D3)', () => {
  it('closes a subscriber after the idle timeout when queue stays empty', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createCoordinator();
      const controller = new AbortController();

      const iterator = coordinator
        .streamEvents({
          identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
          sessionId: SESSION,
          signal: controller.signal,
        })
        [Symbol.asyncIterator]();

      // Start the generator — it will block at nextSubscriberEvent (empty queue)
      const nextPromise = iterator.next();

      // Flush microtasks so the generator reaches nextSubscriberEvent and
      // schedules the idle timeout (300_000ms).
      await vi.advanceTimersByTimeAsync(0);

      // Advance past the idle timeout
      await vi.advanceTimersByTimeAsync(300_001);

      // The stream should end (generator returns, next resolves with done)
      const result = await nextPromise;
      expect(result.done).toBe(true);

      // Clean up
      controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not close a subscriber that receives events before the timeout', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createCoordinator();
      const controller = new AbortController();

      const received: unknown[] = [];
      const consumePromise = (async () => {
        for await (const event of coordinator.streamEvents({
          identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
          sessionId: SESSION,
          signal: controller.signal,
        })) {
          received.push(event);
        }
      })();

      // Flush microtasks so subscriber is registered
      await vi.advanceTimersByTimeAsync(0);

      // Advance time but not past the timeout
      await vi.advanceTimersByTimeAsync(299_999);

      // Publish an event (resets the wait cycle)
      const { makeEventInput } = await import('./stream-helpers.js');
      void coordinator.emitSessionTimelineEvent(makeEventInput(0));
      await vi.advanceTimersByTimeAsync(0);

      // The subscriber should still be active (received the event)
      expect(received).toHaveLength(1);

      controller.abort();
      await consumePromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
