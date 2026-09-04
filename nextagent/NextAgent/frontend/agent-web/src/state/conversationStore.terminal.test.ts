import { describe, expect, it } from 'vitest';
import type { StreamEnvelope } from './contracts.ts';
import { useConversationStore } from './conversationStore.ts';

function makeEnvelope(eventType: StreamEnvelope['eventType'], sequence: number, overrides: Record<string, unknown> = {}): StreamEnvelope {
  return {
    eventId: `evt-d8-${sequence}`,
    sessionId: 'session-d8-terminal',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-original',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload: { content: '' },
    createdAt: 1783346000000,
    ...overrides,
  } as StreamEnvelope;
}

describe('D8: appendEnvelopes accepts terminal events with mismatched attemptId', () => {
  it('accepts REQUEST_CANCELED with different requestContextId when active bucket exists', () => {
    const sessionId = 'session-d8-accept';
    const store = useConversationStore.getState();

    // Step 1: create an active bucket with REQUEST_ACCEPTED.
    const acceptedEnvelope = makeEnvelope('REQUEST_ACCEPTED', 1, {
      requestContextId: 'ctx-original',
    });
    const result1 = store.appendEnvelopes(sessionId, [acceptedEnvelope]);
    expect(result1.acceptedEnvelopes).toContain(acceptedEnvelope);

    // Step 2: send a terminal event with a DIFFERENT requestContextId (attemptId mismatch).
    const terminalEnvelope = makeEnvelope('REQUEST_CANCELED', 2, {
      eventId: 'evt-d8-terminal',
      requestContextId: 'ctx-cancel-different',
      payload: { status: 'CANCELED', content: 'Request canceled by user.' },
    });
    const result2 = store.appendEnvelopes(sessionId, [terminalEnvelope]);

    expect(result2.acceptedEnvelopes).toContain(terminalEnvelope);
    expect(result2.rejectedEnvelopes).not.toContain(terminalEnvelope);
  });

  it('still rejects non-terminal events with mismatched attemptId', () => {
    const sessionId = 'session-d8-reject';
    const store = useConversationStore.getState();

    const acceptedEnvelope = makeEnvelope('REQUEST_ACCEPTED', 1, {
      requestContextId: 'ctx-original',
    });
    store.appendEnvelopes(sessionId, [acceptedEnvelope]);

    const nonTerminalEnvelope = makeEnvelope('LLM_CONTENT_DELTA', 2, {
      eventId: 'evt-d8-non-terminal',
      requestContextId: 'ctx-different',
      payload: { content: 'should be rejected' },
    });
    const result = store.appendEnvelopes(sessionId, [nonTerminalEnvelope]);

    expect(result.rejectedEnvelopes).toContain(nonTerminalEnvelope);
    expect(result.acceptedEnvelopes).not.toContain(nonTerminalEnvelope);
  });
});
