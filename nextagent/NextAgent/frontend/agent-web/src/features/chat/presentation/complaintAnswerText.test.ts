import { describe, it, expect } from 'vitest';
import { buildComplaintAlogCard } from './complaintAnswerText.ts';
import type { AnswerSegment } from './answerContent.ts';

describe('buildComplaintAlogCard', () => {
  it('joins multiple text segments with newline', () => {
    const segments: AnswerSegment[] = [
      { kind: 'text', content: 'Line one', sequence: 0 },
      { kind: 'text', content: 'Line two', sequence: 1 },
    ];
    expect(buildComplaintAlogCard('Why packet loss?', segments)).toBe('[Q]Why packet loss?\n[A]Line one\nLine two');
  });

  it('includes structured TEXT segments joined with newline', () => {
    const segments: AnswerSegment[] = [
      { kind: 'text', content: 'Text answer', sequence: 0 },
      { kind: 'structured', toolMessageType: 'TEXT', content: 'Structured text', sequence: 1 },
    ];
    expect(buildComplaintAlogCard('Q1', segments)).toBe('[Q]Q1\n[A]Text answer\nStructured text');
  });

  it('filters out non-TEXT structured segments', () => {
    const segments: AnswerSegment[] = [
      { kind: 'text', content: 'Keep', sequence: 0 },
      { kind: 'structured', toolMessageType: 'PIU', content: { foo: 'bar' }, sequence: 1 },
      { kind: 'structured', toolMessageType: 'DSL', content: 'dsl content', sequence: 2 },
    ];
    expect(buildComplaintAlogCard('Q1', segments)).toBe('[Q]Q1\n[A]Keep');
  });

  it('returns empty A section when no text segments', () => {
    const segments: AnswerSegment[] = [{ kind: 'structured', toolMessageType: 'PIU', content: {}, sequence: 0 }];
    expect(buildComplaintAlogCard('Q1', segments)).toBe('[Q]Q1\n[A]');
  });

  it('returns empty A section for empty segments', () => {
    expect(buildComplaintAlogCard('Q1', [])).toBe('[Q]Q1\n[A]');
  });

  it('filters out empty text strings', () => {
    const segments: AnswerSegment[] = [
      { kind: 'text', content: '', sequence: 0 },
      { kind: 'text', content: 'Real', sequence: 1 },
    ];
    expect(buildComplaintAlogCard('Q1', segments)).toBe('[Q]Q1\n[A]Real');
  });

  it('falls back to fallbackText when segments have no text', () => {
    const segments: AnswerSegment[] = [{ kind: 'structured', toolMessageType: 'PIU', content: {}, sequence: 0 }];
    expect(buildComplaintAlogCard('Q1', segments, 'Fallback answer')).toBe('[Q]Q1\n[A]Fallback answer');
  });

  it('falls back to fallbackText when segments are empty', () => {
    expect(buildComplaintAlogCard('Q1', [], 'Fallback answer')).toBe('[Q]Q1\n[A]Fallback answer');
  });
});
