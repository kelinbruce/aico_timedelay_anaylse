import { describe, it, expect } from 'vitest';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildAnswerSegments } from './answerContent.ts';

function makeEnvelope(sequence: number, eventId: string, toolEventType: string, toolMessageType: string, content: unknown): StreamEnvelope {
  return {
    eventId,
    sessionId: 'test-session',
    requestId: 'test-request',
    runId: 'test-run',
    rootMessageId: 'test-root',
    requestContextId: 'test-context',
    sequence,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      contentType: 'PLAIN_TEXT',
      content: content as never,
      text: '',
      role: 'CAPABILITY_RESULT',
      messageId: `msg-${sequence}`,
      runId: 'test-run',
      rootMessageId: 'test-root',
      requestContextId: 'test-context',
      visible: true,
      toolEventType: toolEventType as never,
      toolMessageType: toolMessageType as never,
      toolCallId: 'test-call',
      capabilityId: 'test-cap',
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

describe('buildAnswerSegments EXPAND_PANEL negative test', () => {
  it('does not include EXPAND_PANEL events in answer segments', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-1', 'ANSWER', 'TEXT', 'Answer content'),
      makeEnvelope(2, 'evt-2', 'EXPAND_PANEL', 'TEXT', 'Expand panel content'),
      makeEnvelope(3, 'evt-3', 'ANSWER', 'FILE', 'report.pdf'),
    ];
    const segments = buildAnswerSegments(events);
    const structuredSegments = segments.filter((s) => s.kind === 'structured');
    expect(structuredSegments).toHaveLength(2);
    for (const seg of structuredSegments) {
      if (seg.kind === 'structured') {
        expect(seg.content).not.toBe('Expand panel content');
      }
    }
  });

  it('returns empty when only EXPAND_PANEL events exist', () => {
    const events: StreamEnvelope[] = [makeEnvelope(1, 'evt-1', 'EXPAND_PANEL', 'TEXT', 'Only expand panel')];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(0);
  });
});

describe('buildAnswerSegments streaming TEXT ANSWER merge', () => {
  it('merges consecutive ANSWER TEXT segments without separator', () => {
    const events: StreamEnvelope[] = [makeEnvelope(1, 'evt-1', 'ANSWER', 'TEXT', 'Hello '), makeEnvelope(2, 'evt-2', 'ANSWER', 'TEXT', 'World')];
    const segments = buildAnswerSegments(events);
    const structuredSegments = segments.filter((s) => s.kind === 'structured');
    expect(structuredSegments).toHaveLength(1);
    if (structuredSegments[0]!.kind === 'structured') {
      expect(structuredSegments[0]!.content).toBe('Hello World');
      expect(structuredSegments[0]!.toolMessageType).toBe('TEXT');
    }
  });

  it('does not merge ANSWER TEXT segments separated by non-TEXT ANSWER', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-1', 'ANSWER', 'TEXT', 'First'),
      makeEnvelope(2, 'evt-2', 'ANSWER', 'FILE', 'report.pdf'),
      makeEnvelope(3, 'evt-3', 'ANSWER', 'TEXT', 'Second'),
    ];
    const segments = buildAnswerSegments(events);
    const structuredSegments = segments.filter((s) => s.kind === 'structured');
    expect(structuredSegments).toHaveLength(3);
  });

  it('merges three consecutive ANSWER TEXT fragments', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-1', 'ANSWER', 'TEXT', 'The '),
      makeEnvelope(2, 'evt-2', 'ANSWER', 'TEXT', 'quick '),
      makeEnvelope(3, 'evt-3', 'ANSWER', 'TEXT', 'fox'),
    ];
    const segments = buildAnswerSegments(events);
    const structuredSegments = segments.filter((s) => s.kind === 'structured');
    expect(structuredSegments).toHaveLength(1);
    if (structuredSegments[0]!.kind === 'structured') {
      expect(structuredSegments[0]!.content).toBe('The quick fox');
    }
  });

  it('suppresses an LLM projection that duplicates a structured ANSWER', () => {
    const structuredAnswer = makeEnvelope(8, 'structured-answer', 'ANSWER', 'TEXT', 'Final answer');
    const llmAnswer = {
      ...structuredAnswer,
      eventId: 'llm-answer',
      sequence: 11,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        ...structuredAnswer.payload,
        content: 'Final answer',
        text: 'Final answer',
        role: 'ASSISTANT',
      },
    } as StreamEnvelope;

    expect(buildAnswerSegments([structuredAnswer, llmAnswer])).toEqual([
      { kind: 'structured', toolMessageType: 'TEXT', content: 'Final answer', sequence: 8, isHistory: false },
    ]);
  });
});

describe('buildAnswerSegments STREAM_DSL accumulation', () => {
  it('accumulates a complete dataModel + dsl + done stream into one segment', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-dm', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { chart: 'bar' } }),
      makeEnvelope(2, 'evt-dsl-1', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'chart1' }),
      makeEnvelope(3, 'evt-dsl-2', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: '.render()' }),
      makeEnvelope(4, 'evt-done', 'ANSWER', 'STREAM_DSL', { type: 'done' }),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(1);
    if (segments[0]!.kind === 'structured') {
      expect(segments[0]!.toolMessageType).toBe('STREAM_DSL');
      const content = segments[0]!.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
      expect(content.dataModel).toEqual({ chart: 'bar' });
      expect(content.dsl).toBe('chart1.render()');
      expect(content.isDone).toBe(true);
    }
  });

  it('flushes an incomplete stream (no done) at end of events', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-dm', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { chart: 'line' } }),
      makeEnvelope(2, 'evt-dsl-1', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'partial' }),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(1);
    if (segments[0]!.kind === 'structured') {
      const content = segments[0]!.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
      expect(content.dsl).toBe('partial');
      expect(content.isDone).toBe(false);
    }
  });

  it('produces two independent segments when a new dataModel arrives', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-dm-1', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { id: 1 } }),
      makeEnvelope(2, 'evt-dsl-1', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'first' }),
      makeEnvelope(3, 'evt-done-1', 'ANSWER', 'STREAM_DSL', { type: 'done' }),
      makeEnvelope(4, 'evt-dm-2', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { id: 2 } }),
      makeEnvelope(5, 'evt-dsl-2', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'second' }),
      makeEnvelope(6, 'evt-done-2', 'ANSWER', 'STREAM_DSL', { type: 'done' }),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
    if (segments[0]!.kind === 'structured' && segments[1]!.kind === 'structured') {
      const first = segments[0]!.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
      const second = segments[1]!.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
      expect((first.dataModel as { id: number }).id).toBe(1);
      expect(first.dsl).toBe('first');
      expect((second.dataModel as { id: number }).id).toBe(2);
      expect(second.dsl).toBe('second');
    }
  });

  it('flushes the previous stream when a new dataModel interrupts without done', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-dm-1', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { id: 1 } }),
      makeEnvelope(2, 'evt-dsl-1', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'first' }),
      makeEnvelope(3, 'evt-dm-2', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { id: 2 } }),
      makeEnvelope(4, 'evt-dsl-2', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'second' }),
      makeEnvelope(5, 'evt-done-2', 'ANSWER', 'STREAM_DSL', { type: 'done' }),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
    if (segments[0]!.kind === 'structured' && segments[1]!.kind === 'structured') {
      const first = segments[0]!.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
      const second = segments[1]!.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
      expect(first.isDone).toBe(false);
      expect(first.dsl).toBe('first');
      expect(second.isDone).toBe(true);
      expect(second.dsl).toBe('second');
    }
  });

  it('flushes the STREAM_DSL segment before a following TEXT ANSWER', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(1, 'evt-dm', 'ANSWER', 'STREAM_DSL', { type: 'dataModel', content: { chart: 'bar' } }),
      makeEnvelope(2, 'evt-dsl', 'ANSWER', 'STREAM_DSL', { type: 'dsl', content: 'chart' }),
      makeEnvelope(3, 'evt-done', 'ANSWER', 'STREAM_DSL', { type: 'done' }),
      makeEnvelope(4, 'evt-text', 'ANSWER', 'TEXT', 'Summary text'),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.kind).toBe('structured');
    if (segments[0]!.kind === 'structured') {
      expect(segments[0]!.toolMessageType).toBe('STREAM_DSL');
    }
    expect(segments[1]!.kind).toBe('structured');
    if (segments[1]!.kind === 'structured') {
      expect(segments[1]!.toolMessageType).toBe('TEXT');
      expect(segments[1]!.content).toBe('Summary text');
    }
  });
});
