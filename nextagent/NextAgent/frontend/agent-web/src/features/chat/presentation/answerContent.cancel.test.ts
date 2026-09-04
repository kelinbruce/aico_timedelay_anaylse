import { describe, expect, it } from 'vitest';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildAnswerContent } from './answerContent.ts';

function makeEnvelope(eventType: StreamEnvelope['eventType'], sequence: number, payload: Record<string, unknown> = {}): StreamEnvelope {
  return {
    eventId: `evt-${sequence}`,
    sessionId: 'session-cancel-answer',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload: { content: '', ...payload },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

describe('D3: answerContent skips cancel-category REQUEST_FAILED and placeholder text', () => {
  it('does not use cancel-category REQUEST_FAILED content as answer fallback', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('REQUEST_FAILED', 2, {
        status: 'FAILED',
        category: 'CANCELED',
        content: 'Request failed: Model invocation was canceled.',
      }),
    ];
    expect(buildAnswerContent(envelopes)).toBe('');
  });

  it('does not use "Request canceled by user." as answer content', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('REQUEST_CANCELED', 2, {
        status: 'CANCELED',
        content: 'Request canceled by user.',
      }),
    ];
    expect(buildAnswerContent(envelopes)).toBe('');
  });

  it('preserves real LLM_CONTENT_DELTA content even when cancel follows', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('LLM_CONTENT_DELTA', 2, { content: 'Partial answer text' }),
      makeEnvelope('REQUEST_CANCELED', 3, {
        status: 'CANCELED',
        content: 'Request canceled by user.',
      }),
    ];
    expect(buildAnswerContent(envelopes)).toBe('Partial answer text');
  });

  it('uses non-cancel REQUEST_FAILED content when it is not a placeholder', () => {
    const envelopes: StreamEnvelope[] = [
      makeEnvelope('REQUEST_ACCEPTED', 1, { content: 'hello' }),
      makeEnvelope('REQUEST_FAILED', 2, {
        status: 'FAILED',
        category: 'INTERNAL',
        content: 'A real error message with substance',
      }),
    ];
    expect(buildAnswerContent(envelopes)).toBe('A real error message with substance');
  });
});
