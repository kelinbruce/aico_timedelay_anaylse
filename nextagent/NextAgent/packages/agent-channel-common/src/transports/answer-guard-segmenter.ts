/**
 * Token-aware incremental segmenter for the output answer guard.
 *
 * The guard checks AI answer text INCREMENTALLY: each time the answer has
 * grown by ~`GUARD_ANSWER_TOKEN_THRESHOLD` tokens since the last check, only
 * the NEW text (from the last checked sentence boundary to the current end,
 * aligned forward to a complete sentence) is sent to `checkAnswer`. Already
 * checked text is never re-checked. This avoids duplicate guard calls and
 * keeps each call inside the contract limits (≤ 10 items, ≤ 2000 total chars).
 *
 * `lastCheckedOffset` (tracked by the caller) ALWAYS lands on a sentence
 * boundary, so each increment starts at a sentence start — fragments are
 * complete sentences, never mid-clause. When a run-on sentence has no
 * terminator within the scan window, a hard cut is taken (fail-closed: better
 * a clean slice than an unbounded wait for a terminator that exceeds the
 * contract char cap).
 *
 * Token estimation is code-point-weighted (mirrors
 * the context engine's `default-token-estimator`): CJK ~1.5, ASCII ~0.25,
 * supplementary plane (emoji, CJK Ext B+) ~2.0, other BMP ~1.0. The pure
 * function is duplicated here because `agent-channel-common` cannot import
 * the context engine package (architecture boundary).
 */

/** Per-fragment character cap. Each `answers[]` entry stays at or below this. */
export const GUARD_FRAGMENT_MAX_CHARS = 256;
/** Maximum number of fragments per checkAnswer call (contract: 1-10 items). */
export const GUARD_FRAGMENT_MAX_ITEMS = 10;
/** Maximum total characters per checkAnswer call (contract: ≤ 2000). */
export const GUARD_FRAGMENT_MAX_TOTAL_CHARS = 2000;

/** Token threshold that triggers a background checkAnswer on the new increment. */
export const GUARD_ANSWER_TOKEN_THRESHOLD = 128;
/**
 * Max characters to scan forward (past the token threshold) looking for a
 * sentence terminator before falling back to a hard cut. Bounds the wait for a
 * terminator on run-on text so a single call never exceeds the contract char
 * cap. 512 chars ≈ 128 tokens of CJK or ~200 tokens of ASCII — well under the
 * 2000-char contract cap even when combined with prior fragments.
 */
export const GUARD_TERMINATOR_SCAN_LIMIT = 512;

/** Sentence terminators: CJK + Latin + ellipsis + newline. */
const SENTENCE_TERMINATORS = new Set(['。', '！', '？', '…', '.', '!', '?', '\n', '\r']);

// --- Token estimation (code-point-weighted heuristic) ---------------------

const CJK_BASIC_LOW = 0x3000;
const CJK_BASIC_HIGH = 0x9fff;
const CJK_FORMS_LOW = 0xff00;
const CJK_FORMS_HIGH = 0xffef;
const SUPPLEMENTARY_PLANE_BOUNDARY = 0xffff;
const ASCII_BOUNDARY = 0x80;

function tokenWeight(codePoint: number): number {
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

/**
 * Estimate the token count of `text` via code-point weighting. Non-empty text
 * returns at least 1. Mirrors `DefaultTokenEstimator.estimateTokens` semantics
 * so guard thresholds match the context-engine's budget accounting.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let weightedSum = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    if (cp === undefined) {
      break;
    }
    weightedSum += tokenWeight(cp);
    i += cp > SUPPLEMENTARY_PLANE_BOUNDARY ? 2 : 1;
  }
  return Math.max(1, Math.ceil(weightedSum));
}

// --- Sentence-boundary splitting (reused by incremental extraction) -------

/**
 * Find the index of the sentence terminator at or after `from` (the next
 * boundary). Returns the index *of the terminator character* (code point) so
 * the caller can include it in the fragment, or -1 when none remains.
 */
function nextTerminator(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (SENTENCE_TERMINATORS.has(text.charAt(i))) {
      return i;
    }
  }
  return -1;
}

/**
 * Split `text` into complete-sentence fragments, each ≤ `maxChars`.
 *
 * Strategy: always cut at sentence terminators (CJK 。！？…, Latin .!?, newline)
 * so each fragment is one or more complete sentences. When the next terminator
 * lies beyond `maxChars` (a run-on sentence longer than the budget), fall back
 * to a hard cut at `maxChars` — a clean 256-char slice is better than one
 * oversized entry. Whitespace is trimmed from each fragment; empty fragments
 * are dropped.
 */
export function segmentAnswerIntoFragments(text: string, maxChars: number = GUARD_FRAGMENT_MAX_CHARS): readonly string[] {
  const fragments: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const termIdx = nextTerminator(text, cursor);
    let cut: number;
    if (termIdx !== -1 && termIdx < cursor + maxChars) {
      // Include the terminator itself (+1) so the fragment ends on a complete
      // sentence. Consume any immediately-following terminators (e.g. "。!")
      // so they don't form empty fragments.
      cut = termIdx + 1;
      while (cut < text.length && SENTENCE_TERMINATORS.has(text.charAt(cut))) {
        cut += 1;
      }
    } else {
      // No terminator within the budget (run-on sentence): hard cut at the
      // budget so each fragment stays ≤ maxChars. When there is no terminator
      // at all in the remainder (termIdx === -1), still cut at cursor + maxChars
      // and let the loop continue — never take the whole remainder as one
      // fragment (that would exceed the per-fragment cap).
      cut = Math.min(text.length, cursor + maxChars);
    }
    const frag = text.slice(cursor, cut).trim();
    if (frag.length > 0) {
      fragments.push(frag);
    }
    cursor = cut;
  }
  return fragments;
}

/**
 * Result of extracting a new answer increment for a `checkAnswer` call.
 */
export interface AnswerIncrement {
  /** Fragments ready for `checkAnswer({ answers })`; empty when no new text. */
  readonly fragments: readonly string[];
  /** Offset to record as the next `lastCheckedOffset` (always on a boundary). */
  readonly nextOffset: number;
}

/**
 * Extract the NEW increment of `text` (from `lastCheckedOffset` to end) for a
 * `checkAnswer` call, aligned forward to complete sentences.
 *
 * Steps:
 * 1. If the new tail has fewer than `tokenThreshold` tokens, return empty
 *    (wait for more text) — unless `force` is set (final tail check at stream
 *    end), in which case check whatever non-empty increment remains.
 * 2. Find a cut point at or past the token-threshold position that lands on a
 *    sentence terminator (scan forward up to `GUARD_TERMINATOR_SCAN_LIMIT`).
 *    If no terminator is found in the scan window, hard-cut at the scan limit
 *    so a single call never exceeds the contract char cap.
 * 3. Split `[lastCheckedOffset, cut)` into complete-sentence fragments via
 *    `segmentAnswerIntoFragments`, then enforce the contract caps (≤ 10 items,
 *    ≤ 2000 total chars — keep the LAST fragments, i.e. the most recent text).
 *
 * `nextOffset` is the cut point, so the next call starts on a sentence
 * boundary. `lastCheckedOffset` MUST itself land on a sentence boundary
 * (which it will, since `nextOffset` from the previous call is a boundary).
 */
export function extractAnswerIncrement(
  text: string,
  lastCheckedOffset: number,
  tokenThreshold: number = GUARD_ANSWER_TOKEN_THRESHOLD,
  force: boolean = false,
): AnswerIncrement {
  const total = text.length;
  const start = Math.max(0, Math.min(lastCheckedOffset, total));
  const tail = text.slice(start);
  if (tail.trim().length === 0) {
    return { fragments: [], nextOffset: start };
  }
  if (!force && estimateTokens(tail) < tokenThreshold) {
    // Not enough new text yet — wait for more. nextOffset unchanged so the
    // caller keeps the same boundary anchor.
    return { fragments: [], nextOffset: start };
  }

  // Determine the cut point.
  // - force (stream-end flush): check ALL remaining unchecked text up to the
  //   end, so no trailing increment is missed. Still split into <=256 fragments
  //   and enforce contract caps below.
  // - otherwise: scan from `start` until the token threshold is met, then
  //   continue up to GUARD_TERMINATOR_SCAN_LIMIT chars looking for a terminator.
  let cut: number;
  if (force) {
    cut = total;
  } else {
    let tokensSeen = 0;
    let thresholdIdx = start;
    while (thresholdIdx < total) {
      const cp = text.codePointAt(thresholdIdx);
      if (cp === undefined) {
        break;
      }
      tokensSeen += tokenWeight(cp);
      thresholdIdx += cp > SUPPLEMENTARY_PLANE_BOUNDARY ? 2 : 1;
      if (tokensSeen >= tokenThreshold) {
        break;
      }
    }
    // Scan forward from the threshold position for a terminator (include it).
    const scanCeiling = Math.min(total, thresholdIdx + GUARD_TERMINATOR_SCAN_LIMIT);
    let terminatorCut = -1;
    for (let i = thresholdIdx; i < scanCeiling; i += 1) {
      if (SENTENCE_TERMINATORS.has(text.charAt(i))) {
        terminatorCut = i + 1; // include the terminator
        // Consume immediately-following terminators so nextOffset is clean.
        while (terminatorCut < total && SENTENCE_TERMINATORS.has(text.charAt(terminatorCut))) {
          terminatorCut += 1;
        }
        break;
      }
    }
    // No terminator in the scan window (run-on text). Hard-cut at the ceiling.
    cut = terminatorCut === -1 ? scanCeiling : terminatorCut;
  }

  let fragments = segmentAnswerIntoFragments(text.slice(start, cut));
  // Enforce total-char cap: drop leading (oldest) fragments until it fits.
  const fitsTotal = (frags: readonly string[]): boolean => frags.reduce((sum, f) => sum + f.length, 0) <= GUARD_FRAGMENT_MAX_TOTAL_CHARS;
  while (fragments.length > 1 && !fitsTotal(fragments)) {
    fragments = fragments.slice(1);
  }
  if (fragments.length === 1 && fragments[0]!.length > GUARD_FRAGMENT_MAX_TOTAL_CHARS) {
    fragments = [fragments[0]!.slice(fragments[0]!.length - GUARD_FRAGMENT_MAX_TOTAL_CHARS)];
  }
  // Enforce item cap: keep the LAST N (most recent).
  if (fragments.length > GUARD_FRAGMENT_MAX_ITEMS) {
    fragments = fragments.slice(fragments.length - GUARD_FRAGMENT_MAX_ITEMS);
  }
  return { fragments, nextOffset: cut };
}
