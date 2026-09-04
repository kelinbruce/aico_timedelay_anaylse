import { describe, expect, it } from 'vitest';
import { createCoordinator, flushMicrotasks, makeEventInput, SESSION, SUBJECT, TENANT } from './stream-helpers.js';

describe('stream queue high-water (D2)', () => {
  it('delivers published events to a live-tail subscriber', async () => {
    const coordinator = createCoordinator();
    const controller = new AbortController();

    const received: string[] = [];
    const consumePromise = (async () => {
      for await (const event of coordinator.streamEvents({
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
        sessionId: SESSION,
        signal: controller.signal,
      })) {
        received.push(event.inlinePayload.content as string);
      }
    })();

    await flushMicrotasks();

    await coordinator.emitSessionTimelineEvent(makeEventInput(0));
    await coordinator.emitSessionTimelineEvent(makeEventInput(1));
    await flushMicrotasks();

    controller.abort();
    await consumePromise;

    expect(received).toEqual(['event-0', 'event-1']);
  });

  it('removes subscriber at queue hard limit and stops delivering new events', async () => {
    const coordinator = createCoordinator();
    const controller = new AbortController();

    const received: string[] = [];
    const consumePromise = (async () => {
      for await (const event of coordinator.streamEvents({
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
        sessionId: SESSION,
        signal: controller.signal,
      })) {
        received.push(event.inlinePayload.content as string);
      }
    })();

    // Wait for subscriber to register and block at nextSubscriberEvent
    await flushMicrotasks();

    // Publish 2002 events: first is consumed by wake, next 2000 fill the queue,
    // the 2002nd triggers hard-limit removal (subscriber removed from set).
    for (let i = 0; i < 2002; i += 1) {
      void coordinator.emitSessionTimelineEvent(makeEventInput(i));
    }
    await flushMicrotasks();

    // Publish one more event — subscriber was removed, so this must NOT be delivered
    await coordinator.emitSessionTimelineEvent(makeEventInput(2002));
    await flushMicrotasks();

    // Abort to end the stream (queue is drained, subscriber is waiting)
    controller.abort();
    await consumePromise;

    // Subscriber received exactly 2001 events (1 from wake + 2000 from queue)
    expect(received).toHaveLength(2001);
    // The 2003rd event (index 2002) was NOT delivered
    expect(received).not.toContain('event-2002');
    // First and last delivered events are correct
    expect(received[0]).toBe('event-0');
    expect(received[2000]).toBe('event-2000');
  });
});
