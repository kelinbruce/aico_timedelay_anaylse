import { DefaultTokenEstimator, createDefaultTokenEstimator } from '@nextagent/agent-context-engine';
import type { TokenEstimator } from '@nextagent/agent-contracts/context';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('DefaultTokenEstimator', () => {
  // Spec scenario: Empty text returns zero
  it('returns 0 for empty text', () => {
    const estimator = createDefaultTokenEstimator();
    expect(estimator.estimateTokens('')).toBe(0);
  });

  // Spec scenario: ASCII text uses 0.25 per code point with floor of one
  it('uses 0.25 per ASCII code point with a floor of 1 for non-empty text', () => {
    const estimator = createDefaultTokenEstimator();
    // 5 ASCII code points × 0.25 = 1.25 → ceil(1.25) = 2 → max(1, 2) = 2
    expect(estimator.estimateTokens('hello')).toBe(2);
    // 1 ASCII × 0.25 = 0.25 → ceil(0.25) = 1 → max(1, 1) = 1 (floor enforcement)
    expect(estimator.estimateTokens('a')).toBe(1);
    // 4 ASCII × 0.25 = 1.0 → ceil(1.0) = 1 → max(1, 1) = 1
    expect(estimator.estimateTokens('aaaa')).toBe(1);
    // 8 ASCII × 0.25 = 2.0 → 2
    expect(estimator.estimateTokens('aaaaaaaa')).toBe(2);
  });

  // Spec scenario: CJK basic-plane text uses 1.5 per code point
  it('uses 1.5 per CJK basic-plane code point', () => {
    const estimator = createDefaultTokenEstimator();
    // 2 CJK × 1.5 = 3.0 → ceil(3.0) = 3
    expect(estimator.estimateTokens('你好')).toBe(3);
    // 1 CJK × 1.5 = 1.5 → ceil(1.5) = 2
    expect(estimator.estimateTokens('好')).toBe(2);
    // Hiragana (U+3000-range covered): "あ" 0x3042 × 1.5 = 1.5 → 2
    expect(estimator.estimateTokens('あ')).toBe(2);
    // Hangul (U+AC00 range covered by 0x3000-0x9FFF? Actually U+AC00 = 44032, outside 0x9FFF=40959): falls under "other BMP" 1.0.
    // Spec range was 0x3000-0x9FFF + 0xFF00-0xFFEF. U+AC00 is between, in 0x9FFF+ but below 0xFF00, so it's "other BMP" 1.0
    expect(estimator.estimateTokens('가')).toBe(1); // 1 × 1.0 = 1 → ceil 1 → 1
  });

  // Spec scenario: Supplementary plane code point counts as ONE weighted unit
  it('counts a supplementary-plane code point as one weighted unit (NOT two UTF-16 chars)', () => {
    const estimator = createDefaultTokenEstimator();
    // "🎉" is U+1F389, one code point in supplementary plane. UTF-16 length = 2 (surrogate pair).
    // If implementation walked by UTF-16 length without code-point-awareness, it would weight twice.
    // Correct: 1 code point × 2.0 = 2.0 → ceil(2.0) = 2
    expect(estimator.estimateTokens('🎉')).toBe(2);
    // Two supplementary-plane code points: 2 × 2.0 = 4.0 → 4
    expect(estimator.estimateTokens('🎉🎉')).toBe(4);
    // Sanity: text.length is 2 per emoji (surrogate pair) but token count must be 2 not 4.
    expect('🎉'.length).toBe(2);
    expect(estimator.estimateTokens('🎉')).not.toBe(4);
  });

  // Spec scenario: Mixed content sums weights
  it('sums weights for mixed-script content', () => {
    const estimator = createDefaultTokenEstimator();
    // "hi 你 🎉" code points:
    //   h(0.25) + i(0.25) + " "(0.25) + 你(1.5) + " "(0.25) + 🎉(2.0) = 4.5
    // → ceil(4.5) = 5
    expect(estimator.estimateTokens('hi 你 🎉')).toBe(5);
  });

  // Spec invariant: result is always a non-negative integer
  it('never returns NaN, negative, or fractional values', () => {
    const estimator = createDefaultTokenEstimator();
    for (const text of ['', 'a', '你', '🎉', 'hi 你 🎉', 'long ASCII ' + 'x'.repeat(1000)]) {
      const result = estimator.estimateTokens(text);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  // Spec scenario: Per-message overhead is applied
  it('adds per-message overhead on top of content estimate', () => {
    const estimator = createDefaultTokenEstimator();
    const content = 'hi';
    const bare = estimator.estimateTokens(content);
    const messaged = estimator.estimateMessageTokens('user', content);
    expect(messaged).toBeGreaterThan(bare);
    // Document the exact overhead = 4 so callers (budget gate) have a stable expectation.
    expect(messaged - bare).toBe(4);
    // Role label is not part of overhead arithmetic (role types only).
    expect(estimator.estimateMessageTokens('system', content)).toBe(messaged);
    expect(estimator.estimateMessageTokens('assistant', content)).toBe(messaged);
    expect(estimator.estimateMessageTokens('tool', content)).toBe(messaged);
  });

  // Spec scenario: Tool message overhead is at least as large as message overhead
  it('uses larger overhead for tool messages than for regular messages', () => {
    const estimator = createDefaultTokenEstimator();
    const content = 'tool result body';
    const toolCallId = 'tool-call-1';
    const toolName = 'Bash';
    const message = estimator.estimateMessageTokens('tool', content);
    const tool = estimator.estimateToolMessageTokens(toolCallId, toolName, content);
    // tool > message because tool carries toolCallId + toolName + extra wrapping
    expect(tool).toBeGreaterThan(message);
    // Exact formula check: tool = 10 + estimate(toolCallId) + estimate(toolName) + estimate(content)
    const expected = 10 + estimator.estimateTokens(toolCallId) + estimator.estimateTokens(toolName) + estimator.estimateTokens(content);
    expect(tool).toBe(expected);
  });

  // Spec: estimateTokensBatch is semantically equivalent to summing per-text estimates
  it('estimateTokensBatch equals sum of per-text estimates', () => {
    const estimator = createDefaultTokenEstimator();
    const texts = ['', 'hi', '你好', '🎉', 'long ' + 'x'.repeat(50)];
    const batch = estimator.estimateTokensBatch(texts);
    const summed = texts.reduce((acc, t) => acc + estimator.estimateTokens(t), 0);
    expect(batch).toBe(summed);
  });

  it('accepts readonly array input for batch', () => {
    const estimator = createDefaultTokenEstimator();
    const texts: readonly string[] = Object.freeze(['a', 'b', 'c']);
    expect(estimator.estimateTokensBatch(texts)).toBe(3);
  });

  // Type-level: createDefaultTokenEstimator returns the TokenEstimator interface (not a concrete class)
  it('createDefaultTokenEstimator returns a TokenEstimator port instance', () => {
    const estimator = createDefaultTokenEstimator();
    expectTypeOf(estimator).toMatchTypeOf<TokenEstimator>();
    // The concrete class is exported too (for tests/customizations), but the factory
    // returns the abstract port — keep them distinguishable.
    expect(new DefaultTokenEstimator()).toBeInstanceOf(DefaultTokenEstimator);
  });
});
