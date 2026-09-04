import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildMockRequestPlan } = require('../../agent-web-mock-server/data/events.js') as {
  buildMockRequestPlan: (
    sessionId: string,
    requestId: string,
    options?: {
      mockControls?: {
        answerDeltaMode?: 'append-token' | 'cumulative';
        delayMs?: number;
        terminalDelayMs?: number;
        pauseAfterAnswerDeltas?: number;
        pauseAfterProcessDeltas?: number;
        pauseMs?: number;
      };
    },
  ) => {
    delayMs: number;
    terminalDelayMs: number;
    pauseAfterAnswerDeltas: number | null;
    pauseAfterProcessDeltas: number | null;
    pauseMs: number;
    events: Array<{
      eventType: string;
      payload: {
        text?: string;
        content?: string;
        delta?: string;
        role?: string;
        metadata?: Record<string, unknown>;
      };
    }>;
  };
};
const store = require('../../agent-web-mock-server/data/store.js') as {
  sseConnections: Record<string, unknown>;
  replayBuffer: {
    append: (sessionId: string, envelope: Record<string, unknown>) => void;
    replay: (
      sessionId: string,
      lastSeenSequence: number,
      maxItems: number,
      filters?: { requestId?: string; runId?: string },
    ) => {
      envelopes: Array<Record<string, unknown>>;
      continuityAvailable: boolean;
      gapRefreshRequired: boolean;
    };
  };
};
const { pushEvent } = require('../../agent-web-mock-server/data/stream.js') as {
  pushEvent: (sessionId: string, event: Record<string, unknown>) => void;
};

describe('agent-web mock-server stream contract', () => {
  afterEach(() => {
    for (const key of Object.keys(store.sseConnections)) {
      delete store.sseConnections[key];
    }
  });

  it('filters live stream events per connection without hiding events from the session stream', () => {
    const sessionId = `session-live-filter-${Date.now()}-${Math.random()}`;
    const filteredWriter = vi.fn();
    const sessionWriter = vi.fn();
    store.sseConnections[sessionId] = [
      { res: { write: filteredWriter }, filters: { requestId: 'request-a', runId: 'run-a' } },
      { res: { write: sessionWriter }, filters: {} },
    ];

    pushEvent(sessionId, {
      eventId: 'evt-live-filter',
      sessionId,
      requestId: 'request-b',
      runId: 'run-b',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
    });

    expect(filteredWriter).not.toHaveBeenCalled();
    expect(sessionWriter).toHaveBeenCalledTimes(1);
  });

  it('replays filtered request streams without treating unrelated session events as gaps', () => {
    const sessionId = `session-filter-${Date.now()}-${Math.random()}`;
    store.replayBuffer.append(sessionId, {
      eventId: 'evt-filter-1',
      sessionId,
      requestId: 'request-a',
      runId: 'run-a',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
    });
    store.replayBuffer.append(sessionId, {
      eventId: 'evt-filter-2',
      sessionId,
      requestId: 'request-b',
      runId: 'run-b',
      sequence: 2,
      eventType: 'REQUEST_ACCEPTED',
    });
    store.replayBuffer.append(sessionId, {
      eventId: 'evt-filter-3',
      sessionId,
      requestId: 'request-a',
      runId: 'run-a',
      sequence: 3,
      eventType: 'LLM_CONTENT_DELTA',
    });

    const result = store.replayBuffer.replay(sessionId, 0, 10, { requestId: 'request-a', runId: 'run-a' });

    expect(result.envelopes.map((envelope) => envelope.sequence)).toEqual([1, 3]);
    expect(result.continuityAvailable).toBe(true);
    expect(result.gapRefreshRequired).toBe(false);
  });

  it('emits default assistant content deltas as cumulative snapshots', () => {
    const plan = buildMockRequestPlan('session-1', 'request-1');
    const answerEvents = plan.events.filter((event) => event.eventType === 'LLM_CONTENT_DELTA' && event.payload.role !== 'CAPABILITY_RESULT');

    expect(answerEvents.length).toBeGreaterThan(900);

    let previous = '';
    for (const event of answerEvents) {
      const text = event.payload.text ?? event.payload.content ?? event.payload.delta ?? '';
      expect(event.payload.metadata?.accumulated).toBe(true);
      expect(text.length).toBeGreaterThan(0);
      if (previous) {
        expect(text.startsWith(previous)).toBe(true);
      }
      previous = text;
    }

    expect(previous).toContain(' this is for test');
  });

  it('can emit append-token compatibility deltas per request without changing the default contract stream', () => {
    const plan = buildMockRequestPlan('session-1', 'request-1', {
      mockControls: { answerDeltaMode: 'append-token', delayMs: 16 },
    });
    const answerEvents = plan.events.filter((event) => event.eventType === 'LLM_CONTENT_DELTA' && event.payload.role !== 'CAPABILITY_RESULT');

    expect(plan.delayMs).toBe(16);
    expect(answerEvents.length).toBeGreaterThan(900);
    expect(answerEvents.some((event) => event.payload.delta === ' this')).toBe(true);
    expect(answerEvents.every((event) => event.payload.metadata?.accumulated === false)).toBe(true);
  });

  it('can pause before the terminal event per request to exercise frontend idle indicators', () => {
    const plan = buildMockRequestPlan('session-1', 'request-1', {
      mockControls: { answerDeltaMode: 'cumulative', delayMs: 4, terminalDelayMs: 3500 },
    });

    expect(plan.delayMs).toBe(4);
    expect(plan.terminalDelayMs).toBe(3500);
    expect(plan.events.some((event) => event.eventType === 'REQUEST_COMPLETED')).toBe(false);
  });

  it('can pause in the middle of answer deltas per request to exercise idle indicators before completion', () => {
    const plan = buildMockRequestPlan('session-1', 'request-1', {
      mockControls: {
        answerDeltaMode: 'cumulative',
        delayMs: 20,
        pauseAfterAnswerDeltas: 120,
        pauseMs: 4000,
      },
    });

    expect(plan.pauseAfterAnswerDeltas).toBe(120);
    expect(plan.pauseMs).toBe(4000);
  });

  it('can pause in the middle of process detail deltas before assistant answer content starts', () => {
    const plan = buildMockRequestPlan('session-1', 'request-1', {
      mockControls: {
        answerDeltaMode: 'cumulative',
        delayMs: 8,
        pauseAfterProcessDeltas: 180,
        pauseMs: 8000,
      },
    });

    const firstAnswerIndex = plan.events.findIndex((event) => event.eventType === 'LLM_CONTENT_DELTA');
    let processDeltaCount = 0;
    const pauseIndex = plan.events.findIndex((event) => {
      if (event.eventType === 'LLM_THINKING_DELTA' || event.eventType === 'CAPABILITY_RESULT_DELTA') {
        processDeltaCount += 1;
      }
      return processDeltaCount === 180;
    });

    expect(plan.pauseAfterProcessDeltas).toBe(180);
    expect(plan.pauseMs).toBe(8000);
    expect(pauseIndex).toBeGreaterThan(-1);
    expect(firstAnswerIndex).toBeGreaterThan(pauseIndex);
    const pauseEvent = plan.events[pauseIndex];
    expect(pauseEvent).toBeDefined();
    expect(pauseEvent?.eventType).toBe('CAPABILITY_RESULT_DELTA');
  });
});
