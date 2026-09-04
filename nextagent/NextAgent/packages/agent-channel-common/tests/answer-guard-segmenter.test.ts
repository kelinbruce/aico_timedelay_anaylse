import { describe, expect, it } from 'vitest';
import {
  GUARD_ANSWER_TOKEN_THRESHOLD,
  GUARD_FRAGMENT_MAX_CHARS,
  GUARD_FRAGMENT_MAX_ITEMS,
  GUARD_FRAGMENT_MAX_TOTAL_CHARS,
  estimateTokens,
  extractAnswerIncrement,
  segmentAnswerIntoFragments,
} from '../src/transports/answer-guard-segmenter.js';

describe('segmentAnswerIntoFragments', () => {
  it('splits CJK text on 。！？ boundaries, keeping each fragment <= 256', () => {
    const text = '第一句话。第二句话！第三句话？第四句。';
    const frags = segmentAnswerIntoFragments(text);
    expect(frags).toEqual(['第一句话。', '第二句话！', '第三句话？', '第四句。']);
    for (const f of frags) {
      expect(f.length).toBeLessThanOrEqual(GUARD_FRAGMENT_MAX_CHARS);
    }
  });

  it('splits Latin text on .!? and newlines', () => {
    const text = 'Hello world.\nThis is a test! Is it working? Yes.';
    const frags = segmentAnswerIntoFragments(text);
    expect(frags).toEqual(['Hello world.', 'This is a test!', 'Is it working?', 'Yes.']);
  });

  it('hard-cuts a run-on sentence with no terminator inside the budget', () => {
    const runon = 'x'.repeat(500) + '。';
    const frags = segmentAnswerIntoFragments(runon);
    expect(frags.length).toBe(2);
    expect(frags[0]!.length).toBe(GUARD_FRAGMENT_MAX_CHARS);
    expect(frags[1]!.length).toBeLessThanOrEqual(GUARD_FRAGMENT_MAX_CHARS);
  });

  it('returns the whole text as one fragment when it fits the budget', () => {
    const short = 'short answer.';
    expect(segmentAnswerIntoFragments(short)).toEqual([short]);
  });

  it('drops empty / whitespace-only fragments', () => {
    const text = 'first.   \n\n  second.';
    const frags = segmentAnswerIntoFragments(text);
    expect(frags).toEqual(['first.', 'second.']);
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns at least 1 for non-empty text', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
  });

  it('weights CJK higher than ASCII (same char count → CJK more tokens)', () => {
    const cjk = '这是一些中文内容'; // 8 chars, CJK weight 1.5 → ~12 tokens
    const ascii = 'abcdefgh'; // 8 chars, ASCII weight 0.25 → ~2 tokens
    expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens(ascii));
  });
});

describe('extractAnswerIncrement', () => {
  it('returns empty fragments when the new tail is below the token threshold', () => {
    // A few short CJK sentences — well below 128 tokens.
    const text = '第一句。第二句。';
    const result = extractAnswerIncrement(text, 0);
    expect(result.fragments).toEqual([]);
    // nextOffset unchanged so the caller keeps the same anchor.
    expect(result.nextOffset).toBe(0);
  });

  it('extracts only the new increment from lastCheckedOffset, aligned to complete sentences', () => {
    // Build text with enough CJK to exceed 128 tokens. CJK weight 1.5 → ~86 chars
    // hits 128 tokens. Use ~100 chars of CJK sentences.
    const sentence = '这是一句完整的中文字句子用来测试增量提取逻辑是否正确。'; // ~28 chars
    const text = sentence.repeat(5); // ~140 chars → ~210 tokens
    // First call from offset 0: should extract the first increment and land
    // nextOffset on a sentence boundary (a 。 position).
    const first = extractAnswerIncrement(text, 0);
    expect(first.fragments.length).toBeGreaterThan(0);
    // Every fragment must be a complete sentence (start with 这, end with 。).
    for (const frag of first.fragments) {
      expect(frag.endsWith('。')).toBe(true);
    }
    // nextOffset must be > 0 (advanced past checked text) and <= text.length.
    expect(first.nextOffset).toBeGreaterThan(0);
    expect(first.nextOffset).toBeLessThanOrEqual(text.length);
    // nextOffset lands on a 。 boundary (the char before nextOffset is 。 or
    // part of consumed trailing terminators).
    expect(text.charAt(first.nextOffset - 1)).toBe('。');
  });

  it('second call from nextOffset extracts the NEXT increment, not the full text', () => {
    const sentence = '这是一句完整的中文字句子用来测试增量提取逻辑是否正确。';
    const text = sentence.repeat(8); // ~224 chars → enough for two increments
    const first = extractAnswerIncrement(text, 0);
    expect(first.fragments.length).toBeGreaterThan(0);
    const firstCheckedChars = first.fragments.reduce((sum, f) => sum + f.length, 0);

    // Second call from first.nextOffset — must NOT re-include the already
    // checked text. The fragments' content must come from after nextOffset.
    const second = extractAnswerIncrement(text, first.nextOffset);
    for (const frag of second.fragments) {
      // The fragment must be a substring of text starting at/after first.nextOffset.
      expect(text.indexOf(frag, first.nextOffset)).toBeGreaterThanOrEqual(first.nextOffset);
    }
    // And the second increment's checked chars must be less than the full text
    // minus the first increment (it only checks the new tail, not the whole).
    if (second.fragments.length > 0) {
      const secondCheckedChars = second.fragments.reduce((sum, f) => sum + f.length, 0);
      expect(secondCheckedChars).toBeLessThan(text.length);
      expect(firstCheckedChars + secondCheckedChars).toBeLessThanOrEqual(text.length);
    }
  });

  it('force=true checks the remaining increment even below the token threshold', () => {
    // Stream-end tail check: small remaining text below threshold must still be checked.
    const text = '前面已经查过的很长内容。最后这点尾巴。';
    // Simulate firstCheckedOffset past the long part.
    const offset = text.indexOf('最后');
    const result = extractAnswerIncrement(text, offset, GUARD_ANSWER_TOKEN_THRESHOLD, true);
    expect(result.fragments.length).toBeGreaterThan(0);
    expect(result.fragments[0]!.includes('最后这点尾巴')).toBe(true);
  });

  it('never exceeds the contract: <=10 items, <=256/fragment, <=2000 total', () => {
    // A very long run-on with no terminators: hard-cut must keep caps.
    const text = 'x'.repeat(5000);
    const result = extractAnswerIncrement(text, 0, GUARD_ANSWER_TOKEN_THRESHOLD, true);
    expect(result.fragments.length).toBeLessThanOrEqual(GUARD_FRAGMENT_MAX_ITEMS);
    for (const frag of result.fragments) {
      expect(frag.length).toBeLessThanOrEqual(GUARD_FRAGMENT_MAX_CHARS);
    }
    const total = result.fragments.reduce((sum, f) => sum + f.length, 0);
    expect(total).toBeLessThanOrEqual(GUARD_FRAGMENT_MAX_TOTAL_CHARS);
  });

  it('returns empty when lastCheckedOffset is at/past the end', () => {
    const text = '第一句。第二句。';
    expect(extractAnswerIncrement(text, text.length).fragments).toEqual([]);
    expect(extractAnswerIncrement(text, text.length + 10).fragments).toEqual([]);
  });

  it('returns empty for whitespace-only new tail', () => {
    const text = '第一句。   \n  ';
    const result = extractAnswerIncrement(text, 4); // past 第一句。
    expect(result.fragments).toEqual([]);
  });
});
