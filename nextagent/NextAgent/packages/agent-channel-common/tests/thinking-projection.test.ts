import { brand } from '@nextagent/agent-common';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('thinking stream-envelope projection', () => {
  it('projects partial and final snapshots through the same public event type', () => {
    const partial = projectTimelineEventToStreamEnvelope(
      thinking({
        persistence: 'LIVE_ONLY',
        inlinePayload: { reasoning: 'checking', stepId: 'model:1' },
      }),
    );
    const final = projectTimelineEventToStreamEnvelope(
      thinking({
        persistence: 'PERSISTED',
        inlinePayload: { reasoning: 'checking routes', stepId: 'model:1', completed: true },
      }),
    );

    expect(partial).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          reasoning: 'checking',
          content: 'checking',
          text: 'checking',
          stepId: 'model:1',
          metadata: { accumulated: true },
        },
      },
    });
    expect(final).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          reasoning: 'checking routes',
          content: 'checking routes',
          text: 'checking routes',
          stepId: 'model:1',
          metadata: { accumulated: true, completed: true },
        },
      },
    });
  });

  it.each([
    { persistence: 'LIVE_ONLY' as const, inlinePayload: { reasoning: 'checking', stepId: 'model:1', completed: false } },
    { persistence: 'LIVE_ONLY' as const, inlinePayload: { reasoning: '', stepId: 'model:1' } },
    { persistence: 'LIVE_ONLY' as const, inlinePayload: { reasoning: 'checking', stepId: '' } },
    { persistence: 'PERSISTED' as const, inlinePayload: { reasoning: 'checking', stepId: 'model:1' } },
    { persistence: 'LIVE_ONLY' as const, inlinePayload: { reasoning: 'checking', stepId: 'model:1', completed: true } },
  ])('fails closed for an illegal canonical thinking event', (overrides) => {
    expect(projectTimelineEventToStreamEnvelope(thinking(overrides))).toMatchObject({
      kind: 'PROJECTION_FAILURE',
      safeError: { code: 'STREAM_PROJECTION_THINKING_INVALID' },
    });
  });
});

function thinking(overrides: Pick<RunTimelineEvent, 'persistence' | 'inlinePayload'>): RunTimelineEvent {
  return {
    eventId: 'thinking-1',
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    type: 'LLM_THINKING_DELTA',
    createdAt: new Date(1),
    ...overrides,
  };
}
