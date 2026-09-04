import { describe, expect, it } from 'vitest';
import { hasProcessTimelineDetail, resolveTurnDetailAffordances } from '../src/features/chat/utils/detailAffordances.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

function makeEvent(eventType: StreamEnvelope['eventType'], payload: Record<string, unknown> = {}): StreamEnvelope {
  return {
    eventId: `evt-${eventType}`,
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 1,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload,
    createdAt: '2026-04-20T12:00:00.000Z',
  } as StreamEnvelope;
}

describe('detail affordances', () => {
  it('treats conversation-message historical results as execution detail, not full process detail', () => {
    const aiEvents = [
      {
        ...makeEvent('CAPABILITY_RESULT_DELTA', {
          role: 'CAPABILITY_RESULT',
          toolCallId: 'tool-1',
          text: 'done',
          metadata: { accumulated: true },
        }),
        transportHints: ['history-load'],
      },
      makeEvent('LLM_CONTENT_DELTA', { text: 'final answer', metadata: { accumulated: true } }),
    ];

    expect(hasProcessTimelineDetail(aiEvents)).toBe(false);
    expect(
      resolveTurnDetailAffordances({
        aiEvents,
        processEntryCount: 1,
        processTimelineEntryCount: 1,
        isStreaming: false,
      }),
    ).toEqual({
      showExecutionSummary: true,
      showFullProcessTimeline: false,
    });
  });

  it('allows the full process timeline when live process events are present', () => {
    const aiEvents = [
      makeEvent('LLM_THINKING_DELTA', { text: 'thinking', metadata: { accumulated: true } }),
      makeEvent('CAPABILITY_RESULT_DELTA', {
        toolCallId: 'tool-1',
        text: 'step 1',
        metadata: { invocationId: 'inv-1', accumulated: false },
      }),
      makeEvent('LLM_CONTENT_DELTA', { text: 'final answer', metadata: { accumulated: true } }),
    ];

    expect(hasProcessTimelineDetail(aiEvents)).toBe(true);
    expect(
      resolveTurnDetailAffordances({
        aiEvents,
        processEntryCount: 2,
        processTimelineEntryCount: 2,
        isStreaming: true,
      }),
    ).toEqual({
      showExecutionSummary: true,
      showFullProcessTimeline: true,
    });
  });

  it('allows the full process timeline for history-loaded timeline-backed process events', () => {
    const aiEvents = [
      {
        ...makeEvent('CAPABILITY_COMPLETED', {
          toolCallId: 'tool-1',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_INPUT_INVALID',
          metadata: { accumulated: true },
        }),
        timelineEventRef: 'timeline-capability-completed-1',
        transportHints: ['history-load'],
      },
      makeEvent('REQUEST_FAILED', { text: 'Request failed', metadata: { accumulated: true } }),
    ];

    expect(hasProcessTimelineDetail(aiEvents)).toBe(true);
    expect(
      resolveTurnDetailAffordances({
        aiEvents,
        processEntryCount: 1,
        processTimelineEntryCount: 1,
        isStreaming: false,
      }),
    ).toEqual({
      showExecutionSummary: true,
      showFullProcessTimeline: true,
    });
  });

  it('keeps execution details visible while streaming even before process entries are materialized', () => {
    expect(
      resolveTurnDetailAffordances({
        aiEvents: [],
        processEntryCount: 0,
        processTimelineEntryCount: 0,
        isStreaming: true,
      }),
    ).toEqual({
      showExecutionSummary: true,
      showFullProcessTimeline: false,
    });
  });
});
