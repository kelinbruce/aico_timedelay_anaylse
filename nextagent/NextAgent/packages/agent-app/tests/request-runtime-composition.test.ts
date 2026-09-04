import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';
import { createSessionActivityTimelineListener, resolveRunTimelineEventPersistence } from '../src/composition/request-runtime-composition.js';

describe('request runtime timeline persistence', () => {
  it.each(['NODE_STARTED', 'NODE_COMPLETED'] as const)('persists workflow structured %s events for replay', (workflowEventType) => {
    expect(resolveRunTimelineEventPersistence(structuredEvent(workflowEventType))).toBe('PERSISTED');
  });

  it('keeps intermediate workflow structured deltas live-only', () => {
    expect(resolveRunTimelineEventPersistence(structuredEvent('NODE_OUTPUT_DELTA'))).toBe('LIVE_ONLY');
  });

  it('persists non-structured runtime events', () => {
    expect(resolveRunTimelineEventPersistence({ type: 'REQUEST_COMPLETED', inlinePayload: {} })).toBe('PERSISTED');
  });
});

describe('session activity timeline invalidation', () => {
  it.each([
    'REQUEST_ACCEPTED',
    'USER_INPUT_REQUIRED',
    'USER_INPUT_RECEIVED',
    'USER_INPUT_TIMEOUT',
    'USER_INPUT_CANCELED',
    'REQUEST_COMPLETED',
    'REQUEST_FAILED',
    'REQUEST_CANCELED',
    'REQUEST_SUPERSEDED',
  ] as const)('invalidates the affected session for committed %s facts', (type) => {
    const invalidate = vi.fn();

    createSessionActivityTimelineListener({ invalidateSessionActivity: invalidate })(timelineEvent({ type }));

    expect(invalidate).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
    });
  });

  it('ignores live-only, unrelated, and incomplete events', () => {
    const invalidate = vi.fn();
    const listener = createSessionActivityTimelineListener({ invalidateSessionActivity: invalidate });

    listener(timelineEvent({ type: 'REQUEST_COMPLETED', persistence: 'LIVE_ONLY' }));
    listener(timelineEvent({ type: 'LLM_CONTENT_DELTA' }));
    listener({ ...timelineEvent({ type: 'REQUEST_COMPLETED' }), sessionId: undefined } as unknown as RunTimelineEvent);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not forward runtime payload or run coordinates', () => {
    const received: unknown[] = [];
    const listener = createSessionActivityTimelineListener({
      invalidateSessionActivity(coordinates) {
        received.push(coordinates);
      },
    });

    listener(timelineEvent({ type: 'REQUEST_FAILED' }));

    expect(received).toEqual([
      {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
      },
    ]);
  });
});

function structuredEvent(workflowEventType: string): Pick<RunTimelineEvent, 'type' | 'inlinePayload'> {
  return {
    type: 'TOOL_STRUCTURED_DELTA',
    inlinePayload: { workflowEventType },
  };
}

function timelineEvent(overrides: Partial<RunTimelineEvent>): RunTimelineEvent {
  return {
    tenantId: 'tenant-1',
    subjectId: 'subject-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    runId: 'run-1',
    requestId: 'request-1',
    requestContextId: 'context-1',
    persistence: 'PERSISTED',
    type: 'REQUEST_ACCEPTED',
    inlinePayload: { raw: 'must-not-cross-boundary' },
    ...overrides,
  } as RunTimelineEvent;
}
