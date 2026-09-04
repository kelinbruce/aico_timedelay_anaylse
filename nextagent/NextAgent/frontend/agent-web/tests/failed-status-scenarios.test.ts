import { describe, it, expect } from 'vitest';
import { buildSessionProjection } from '../src/features/chat/view-model/buildSessionProjection.ts';
import type { SessionConversationMessage, StreamEnvelope } from '../src/state/contracts.ts';

function makeMessage(overrides: Partial<SessionConversationMessage>): SessionConversationMessage {
  return {
    messageId: 'msg-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    runId: 'run-1',
    requestContextId: 'req-1',
    rootMessageId: 'req-1',
    role: 'ASSISTANT',
    sequence: 1,
    content: 'content',
    contentType: 'MARKDOWN',
    metadata: {},
    createdAt: '2026-04-19T12:00:00.000Z',
    visible: true,
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<StreamEnvelope>): StreamEnvelope {
  return {
    eventId: 'evt-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    runId: 'run-1',
    rootMessageId: 'req-1',
    requestContextId: 'req-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['history-load'],
    payload: { role: 'ASSISTANT', content: '', text: '' },
    createdAt: '2026-04-19T12:00:00.000Z',
    ...overrides,
  } as StreamEnvelope;
}

describe('failed task status - edge case scenarios', () => {
  // Scenario 1: Happy path - terminal FAILED message in history
  it('S1: history includes terminal FAILED message -> block FAILED', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-terminal-failed-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'Request failed safely: MODEL_PROVIDER_ERROR',
        metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED' },
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('FAILED');
  });

  // Scenario 2: Terminal message missing from history (timing race)
  it('S2: history missing terminal, has AI events, no active run -> EXECUTING (no fake COMPLETED)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
        metadata: {},
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
  });

  // Scenario 3: Same as S2 but latestPersistedRunStatus=FAILED
  it('S3: history missing terminal, latestPersistedRunStatus=FAILED -> FAILED (fix check)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
        metadata: {},
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
      latestPersistedRunStatus: 'FAILED',
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('FAILED');
  });

  // Scenario 4: Guard-blocked terminal message (visible=false)
  it('S4: guard-blocked terminal message (visible=false) -> EXECUTING (terminal hidden)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
        metadata: {},
      }),
      makeMessage({
        messageId: 'assistant-terminal-failed-1',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'Request failed safely: MODEL_PROVIDER_ERROR',
        metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED', guardBlocked: true },
        visible: false,
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
  });

  // Scenario 5: Non-latest failed block with missing terminal
  it('S5: non-latest block missing terminal -> EXECUTING (no fake COMPLETED)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1', rootMessageId: 'req-1', requestId: 'req-1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer 1',
        metadata: {},
        rootMessageId: 'req-1',
        requestId: 'req-1',
      }),
      makeMessage({ messageId: 'user-2', role: 'USER', sequence: 3, content: 'q2', rootMessageId: 'req-2', requestId: 'req-2' }),
      makeMessage({
        messageId: 'assistant-terminal-completed-2',
        role: 'ASSISTANT',
        sequence: 4,
        content: 'answer 2',
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        rootMessageId: 'req-2',
        requestId: 'req-2',
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(2);
    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
    expect(projection.turnBlocks[1]!.status).toBe('COMPLETED');
  });

  // Scenario 6: Terminal message with stripped metadata
  it('S6: terminal message without metadata or prefix -> EXECUTING (no fake COMPLETED)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'Something went wrong',
        metadata: {},
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
  });

  // Scenario 7: Live stream delivers terminal FAILED after history load
  it('S7: live stream delivers REQUEST_FAILED -> FAILED (overlay works)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
        metadata: {},
      }),
    ];
    const liveFailedEnvelope = makeEnvelope({
      eventId: 'live-evt-1',
      eventType: 'REQUEST_FAILED',
      payload: {
        role: 'ASSISTANT',
        content: 'Request failed safely: MODEL_PROVIDER_ERROR',
        text: 'Request failed safely: MODEL_PROVIDER_ERROR',
        status: 'FAILED',
        eventType: 'REQUEST_FAILED',
      },
      transportHints: [],
      sequence: 100,
    });
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [liveFailedEnvelope],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('FAILED');
  });

  // Scenario 8: Settled layer delivers terminal FAILED
  it('S8: settled layer delivers REQUEST_FAILED -> FAILED (overlay works)', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' }),
      makeMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
        metadata: {},
      }),
    ];
    const settledFailedEnvelope = makeEnvelope({
      eventId: 'settled-evt-1',
      eventType: 'REQUEST_FAILED',
      payload: {
        role: 'ASSISTANT',
        content: 'Request failed safely: MODEL_PROVIDER_ERROR',
        text: 'Request failed safely: MODEL_PROVIDER_ERROR',
        status: 'FAILED',
      },
      transportHints: [],
      sequence: 100,
    });
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      settledEnvelopes: [settledFailedEnvelope],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('FAILED');
  });

  // Scenario 9: Empty history
  it('S9: empty history -> no blocks', () => {
    const projection = buildSessionProjection({
      historyMessages: [],
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(0);
  });

  // Scenario 10: Only user message, no assistant response
  it('S10: only user message, no assistant -> EXECUTING', () => {
    const messages = [makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' })];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
  });

  // Scenario 11: Latest block FAILED, activeRun present for different request
  it('S11: latest block FAILED terminal present, activeRun for different req -> FAILED', () => {
    const messages = [
      makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1', rootMessageId: 'req-1', requestId: 'req-1' }),
      makeMessage({
        messageId: 'assistant-terminal-failed-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'Request failed safely: MODEL_PROVIDER_ERROR',
        metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED' },
        rootMessageId: 'req-1',
        requestId: 'req-1',
      }),
    ];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: { requestId: 'req-2', runId: 'run-2', status: 'EXECUTING' },
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('FAILED');
  });

  // Scenario 12: latestPersistedRunStatus=FAILED with only user message
  it('S12: only user message, latestPersistedRunStatus=FAILED -> FAILED (fix check)', () => {
    const messages = [makeMessage({ messageId: 'user-1', role: 'USER', sequence: 1, content: 'q1' })];
    const projection = buildSessionProjection({
      historyMessages: messages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
      latestPersistedRunStatus: 'FAILED',
    });
    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.status).toBe('FAILED');
  });
});
