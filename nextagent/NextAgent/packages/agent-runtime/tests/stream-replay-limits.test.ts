import { brand, type EpochMillis, type TimelineSequence } from '@nextagent/agent-common';
import type { RunTimelineEventRecord, RunTimelineEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';
import {
  AGENT,
  AGENT_VERSION,
  CONTEXT_ID,
  createCoordinatorWithOptions,
  makeRequestRunStoreWithRun,
  REQUEST_ID,
  RUN_ID,
  SESSION,
  SUBJECT,
  TENANT,
} from './stream-helpers.js';

const maxReplayBatchEvents = 1000;

describe('stream replay limits (D4)', () => {
  it('throws STREAM_REPLAY_LIMIT_EXCEEDED when total events exceed the limit', async () => {
    const timelineStore = makeInfiniteTimelineStore();
    const coordinator = createCoordinatorWithOptions({
      timelineStore,
      requestRunStore: makeRequestRunStoreWithRun(),
    });
    const controller = new AbortController();

    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      lastSeenSequence: brand<number, 'TimelineSequence'>(0),
      signal: controller.signal,
    });

    await expect(async () => {
      for await (const _event of iterator) {
        // drain
      }
    }).rejects.toMatchObject({
      code: 'STREAM_REPLAY_LIMIT_EXCEEDED',
      category: 'UNAVAILABLE',
      retryable: true,
      safeDetails: { reasonCode: 'REPLAY_TOTAL_EVENTS_EXCEEDED' },
    });

    controller.abort();
  });

  it('exits silently when the signal is aborted during replay', async () => {
    const timelineStore = makeInfiniteTimelineStore();
    const coordinator = createCoordinatorWithOptions({
      timelineStore,
      requestRunStore: makeRequestRunStoreWithRun(),
    });
    const controller = new AbortController();

    const iterator = coordinator.streamEvents({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      sessionId: SESSION,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      lastSeenSequence: brand<number, 'TimelineSequence'>(0),
      signal: controller.signal,
    });

    // Start consuming — the generator will begin replaying events.
    // Abort after receiving the first batch of 1000 events.
    const events: unknown[] = [];
    for await (const event of iterator) {
      events.push(event);
      if (events.length >= maxReplayBatchEvents) {
        controller.abort();
      }
    }

    // The stream should have exited silently (no error thrown).
    // It received at least one full batch before abort was detected.
    expect(events.length).toBeGreaterThanOrEqual(maxReplayBatchEvents);
  });
});

function makeInfiniteTimelineStore(): RunTimelineEventStoreGateway {
  let callCount = 0;
  return {
    async appendEvent(record) {
      return record;
    },
    async listEvents(request) {
      callCount += 1;
      const afterSeq = Number(request.afterSequence);
      const records: RunTimelineEventRecord[] = [];
      for (let i = 0; i < maxReplayBatchEvents; i += 1) {
        const seq = afterSeq + i + 1;
        records.push({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          agentVersion: AGENT_VERSION,
          eventId: `evt-${callCount}-${i}`,
          sessionId: request.sessionId,
          runId: request.runId ?? RUN_ID,
          requestId: request.requestId ?? REQUEST_ID,
          requestContextId: CONTEXT_ID,
          sequence: brand<number, 'TimelineSequence'>(seq),
          type: 'LLM_CONTENT_DELTA',
          inlinePayload: { content: `replay-${seq}` },
          createdAt: brand<number, 'EpochMillis'>(seq),
        });
      }
      return records;
    },
  };
}
