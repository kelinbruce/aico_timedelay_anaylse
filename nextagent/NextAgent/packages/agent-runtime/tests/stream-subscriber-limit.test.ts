import { describe, expect, it } from 'vitest';
import { createCoordinator, SESSION, SUBJECT, TENANT } from './stream-helpers.js';

describe('stream subscriber limit (D1)', () => {
  it('rejects the 11th concurrent subscriber with STREAM_SUBSCRIBER_LIMIT_EXCEEDED', async () => {
    const coordinator = createCoordinator();
    const controllers: AbortController[] = [];

    // Register 10 concurrent live-tail subscribers (blocked at nextSubscriberEvent)
    for (let i = 0; i < 10; i += 1) {
      const controller = new AbortController();
      controllers.push(controller);
      const iterator = coordinator.streamEvents({
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
        sessionId: SESSION,
        signal: controller.signal,
      });
      // Start iterating without awaiting - the generator will add the subscriber
      // and block at nextSubscriberEvent (empty queue, non-aborted signal).
      void (async () => {
        for await (const _event of iterator) {
          // drain
        }
      })();
    }

    // Flush microtasks so all 10 generators reach nextSubscriberEvent
    await new Promise((resolve) => setImmediate(resolve));

    // The 11th subscriber should be rejected
    const eleventhController = new AbortController();
    controllers.push(eleventhController);
    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      signal: eleventhController.signal,
    });

    await expect(async () => {
      for await (const _event of iterator) {
        // drain
      }
    }).rejects.toMatchObject({
      code: 'STREAM_SUBSCRIBER_LIMIT_EXCEEDED',
      category: 'UNAVAILABLE',
      retryable: true,
    });

    // Cleanup: abort all controllers
    for (const controller of controllers) {
      controller.abort();
    }
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('allows a new subscriber after a previous one is removed', async () => {
    const coordinator = createCoordinator();

    // Create and immediately abort a subscriber (aborted signal -> generator exits,
    // finally block removes the subscriber)
    const controller = new AbortController();
    controller.abort();
    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      signal: controller.signal,
    });
    for await (const _event of iterator) {
      // drain (aborted, so this loop exits immediately)
    }

    // A new subscriber should be allowed
    const controller2 = new AbortController();
    const iterator2 = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      signal: controller2.signal,
    });

    // Should not throw - subscriber was accepted
    const consumePromise = (async () => {
      for await (const _event of iterator2) {
        // drain
      }
    })();
    await new Promise((resolve) => setImmediate(resolve));
    controller2.abort();
    await consumePromise;
  });
});
