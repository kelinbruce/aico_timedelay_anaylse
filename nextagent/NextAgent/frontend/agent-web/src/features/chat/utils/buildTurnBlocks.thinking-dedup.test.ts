import { describe, expect, it } from 'vitest';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildTurnBlocks } from './buildTurnBlocks.ts';

function makeEnvelope(eventType: StreamEnvelope['eventType'], sequence: number, payload: Record<string, unknown> = {}): StreamEnvelope {
  return {
    eventId: `evt-${sequence}`,
    sessionId: 'session-thinking-test',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload: { content: '', ...payload },
    createdAt: 1783346000000 + sequence,
  } as StreamEnvelope;
}

function makeThinkingEnvelope(sequence: number, stepId: string, reasoning: string, completed: boolean): StreamEnvelope {
  return makeEnvelope('LLM_THINKING_DELTA', sequence, {
    reasoning,
    content: reasoning,
    text: reasoning,
    stepId,
    metadata: completed ? { accumulated: true, completed: true } : { accumulated: true },
  });
}

describe('deduplicateTurnEnvelopes: thinking segment boundary', () => {
  it('preserves pre-input and post-input completed thinking with the same stepId', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'accepted' }),
      makeThinkingEnvelope(2, 'turn-1', 'thinking before user input', true),
      makeEnvelope('USER_INPUT_REQUIRED', 3, { kind: 'CONFIRMATION', pendingInputId: 'pi-1' }),
      makeEnvelope('USER_INPUT_RECEIVED', 4, { kind: 'CONFIRMATION', pendingInputId: 'pi-1', value: 'yes' }),
      makeThinkingEnvelope(5, 'turn-1', 'thinking after user input', true),
      makeEnvelope('REQUEST_COMPLETED', 6, { status: 'COMPLETED', content: 'done' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const thinkingEvents = blocks[0]?.aiEvents.filter((e) => e.eventType === 'LLM_THINKING_DELTA') ?? [];
    expect(thinkingEvents).toHaveLength(2);
    expect((thinkingEvents[0]?.payload as Record<string, unknown>).reasoning).toBe('thinking before user input');
    expect((thinkingEvents[1]?.payload as Record<string, unknown>).reasoning).toBe('thinking after user input');
  });
  it('preserves pre-input and post-input intermediate thinking with the same stepId', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'accepted' }),
      makeThinkingEnvelope(2, 'turn-1', 'partial thinking before input', false),
      makeEnvelope('USER_INPUT_RECEIVED', 3, { kind: 'CONFIRMATION', value: 'yes' }),
      makeThinkingEnvelope(4, 'turn-1', 'partial thinking after input', false),
      makeEnvelope('REQUEST_COMPLETED', 5, { status: 'COMPLETED', content: 'done' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const thinkingEvents = blocks[0]?.aiEvents.filter((e) => e.eventType === 'LLM_THINKING_DELTA') ?? [];
    expect(thinkingEvents).toHaveLength(2);
  });
  it('still deduplicates duplicate completed thinking within the same segment (reconnect replay)', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'accepted' }),
      makeThinkingEnvelope(2, 'turn-1', 'completed thinking', true),
      makeThinkingEnvelope(3, 'turn-1', 'completed thinking replay', true),
      makeEnvelope('REQUEST_COMPLETED', 4, { status: 'COMPLETED', content: 'done' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const thinkingEvents = blocks[0]?.aiEvents.filter((e) => e.eventType === 'LLM_THINKING_DELTA') ?? [];
    expect(thinkingEvents).toHaveLength(1);
  });
  it('still deduplicates intermediate thinking within the same segment keeping the latest', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'accepted' }),
      makeThinkingEnvelope(2, 'turn-1', 'first partial', false),
      makeThinkingEnvelope(3, 'turn-1', 'second partial', false),
      makeEnvelope('REQUEST_COMPLETED', 4, { status: 'COMPLETED', content: 'done' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const thinkingEvents = blocks[0]?.aiEvents.filter((e) => e.eventType === 'LLM_THINKING_DELTA') ?? [];
    expect(thinkingEvents).toHaveLength(1);
    expect((thinkingEvents[0]?.payload as Record<string, unknown>).reasoning).toBe('second partial');
  });
  it('handles multiple USER_INPUT_RECEIVED boundaries', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'accepted' }),
      makeThinkingEnvelope(2, 'turn-1', 'first segment', true),
      makeEnvelope('USER_INPUT_RECEIVED', 3, { kind: 'CONFIRMATION', value: 'a' }),
      makeThinkingEnvelope(4, 'turn-1', 'second segment', true),
      makeEnvelope('USER_INPUT_RECEIVED', 5, { kind: 'CONFIRMATION', value: 'b' }),
      makeThinkingEnvelope(6, 'turn-1', 'third segment', true),
      makeEnvelope('REQUEST_COMPLETED', 7, { status: 'COMPLETED', content: 'done' }),
    ];
    const blocks = buildTurnBlocks(envelopes, []);
    const thinkingEvents = blocks[0]?.aiEvents.filter((e) => e.eventType === 'LLM_THINKING_DELTA') ?? [];
    expect(thinkingEvents).toHaveLength(3);
  });
});
