import type { TokenEstimator } from '@nextagent/agent-contracts/context';

/**
 * Code-point-aware heuristic token estimator for the context-engine pipeline.
 *
 * This is the default implementation of the {@link TokenEstimator} contract.
 * It iterates text by Unicode code point (not by UTF-16 length) and weights
 * each code point by a fixed table. The result is `Math.max(1, Math.ceil(sum))`
 * for non-empty text and `0` for empty text — so no non-empty input is ever
 * estimated as 0 tokens.
 *
 * Weight table (priority order):
 *   - code point > U+FFFF (supplementary plane: emoji, CJK Ext B-G, rare
 *     ideographs): 2.0
 *   - CJK basic-plane ranges (U+3000-U+9FFF and U+FF00-U+FFEF, covering CJK
 *     Unified Ideographs, Hiragana, Katakana, Hangul, CJK punctuation,
 *     fullwidth forms): 1.5
 *   - ASCII (< U+0080): 0.25
 *   - other BMP code points: 1.0 (a neutral default that avoids systematic
 *     undercounting for languages we did not list explicitly)
 *
 * Message and tool-message overhead constants approximate role markers,
 * separators, and (for tool messages) the tool-call wrapping. They are sized
 * to be reasonable upper bounds for OpenAI-style chat APIs; precise tokenizers
 * (tiktoken, etc.) can replace the whole estimator via app composition.
 */
const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_MESSAGE_OVERHEAD_TOKENS = 10;

const CJK_BASIC_LOW = 0x3000;
const CJK_BASIC_HIGH = 0x9fff;
const CJK_FORMS_LOW = 0xff00;
const CJK_FORMS_HIGH = 0xffef;
const SUPPLEMENTARY_PLANE_BOUNDARY = 0xffff;
const ASCII_BOUNDARY = 0x80;

function weightFor(codePoint: number): number {
  if (codePoint > SUPPLEMENTARY_PLANE_BOUNDARY) {
    return 2.0;
  }
  if ((codePoint >= CJK_BASIC_LOW && codePoint <= CJK_BASIC_HIGH) || (codePoint >= CJK_FORMS_LOW && codePoint <= CJK_FORMS_HIGH)) {
    return 1.5;
  }
  if (codePoint < ASCII_BOUNDARY) {
    return 0.25;
  }
  return 1.0;
}

function estimateTokensImpl(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let weightedSum = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    if (cp === undefined) {
      break;
    }
    weightedSum += weightFor(cp);
    i += cp > SUPPLEMENTARY_PLANE_BOUNDARY ? 2 : 1;
  }
  return Math.max(1, Math.ceil(weightedSum));
}

export class DefaultTokenEstimator implements TokenEstimator {
  estimateTokens(text: string): number {
    return estimateTokensImpl(text);
  }

  estimateMessageTokens(_role: 'system' | 'user' | 'assistant' | 'tool', content: string): number {
    return MESSAGE_OVERHEAD_TOKENS + estimateTokensImpl(content);
  }

  estimateToolMessageTokens(toolCallId: string, toolName: string, content: string): number {
    return TOOL_MESSAGE_OVERHEAD_TOKENS + estimateTokensImpl(toolCallId) + estimateTokensImpl(toolName) + estimateTokensImpl(content);
  }

  estimateTokensBatch(texts: readonly string[]): number {
    let sum = 0;
    for (const text of texts) {
      sum += estimateTokensImpl(text);
    }
    return sum;
  }
}

export function createDefaultTokenEstimator(): TokenEstimator {
  return new DefaultTokenEstimator();
}
