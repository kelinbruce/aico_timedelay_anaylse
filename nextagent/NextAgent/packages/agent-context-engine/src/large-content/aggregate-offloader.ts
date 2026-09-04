import type { ReplacementKind } from '@nextagent/agent-contracts/session';

import { classifyReplacement } from './classifier.js';
import { LARGE_CONTENT_THRESHOLDS } from './thresholds.js';

/**
 * Spec anchor: add-ts-large-content-references §"Stable replacement
 * forms" + design decision 1 / 4 step 4.
 *
 * The aggregate offloader decides which fresh results in a single
 * batch (a user message's tool batch, or a single tool result's
 * children) MUST be offloaded so the aggregate size fits within
 * `aggregateMaxBytes`. The rule is:
 *   - process only `fresh` results (previously `INLINE` or
 *     `REPLACED` decisions are FROZEN — they do not move)
 *   - sort fresh results by size descending
 *   - offload the largest first, stopping once the aggregate is
 *     within budget
 *   - if the aggregate is STILL over budget after every fresh
 *     result has been offloaded, the caller walks the design 5
 *     three-step resolution (per-call, not the engine's job here)
 */
export interface AggregateFreshEntry {
  readonly entryId: string;
  readonly content: string;
  readonly contentType?: string;
  readonly originalSize: number;
  /** true if the entry has a previously-persisted replacement evidence. */
  readonly previouslyFrozen: boolean;
}

export interface AggregateOffloadDecision {
  readonly entryId: string;
  readonly shouldOffload: boolean;
  readonly reason: import('./thresholds.js').LargeContentReasonCode;
  readonly resultingKind: ReplacementKind;
}

export interface AggregateOffloadInput {
  readonly entries: readonly AggregateFreshEntry[];
  readonly previouslyPersistedTotalBytes: number;
}

export interface AggregateOffloadPlan {
  readonly decisions: readonly AggregateOffloadDecision[];
  readonly projectedAggregateBytes: number;
}

/**
 * Compute the aggregate offload plan for a single batch. The
 * previously-persisted total is treated as a fixed floor
 * (offload-frozen); only the fresh entries may move.
 */
export function planAggregateOffload(input: AggregateOffloadInput): AggregateOffloadPlan {
  const decisions: AggregateOffloadDecision[] = [];
  let runningTotal = input.previouslyPersistedTotalBytes;

  // Step 1: previously-frozen decisions are pinned.
  for (const entry of input.entries) {
    if (entry.previouslyFrozen) {
      decisions.push({
        entryId: entry.entryId,
        shouldOffload: true,
        reason: 'frozen-from-prior-decision',
        resultingKind: classifyFrozenKind(entry),
      });
      // The previously-frozen entry is already a PERSISTED_PREVIEW
      // (or SPECIALIZED_REF) so its contribution to runningTotal is
      // bounded to the preview size. We approximate it by the
      // originalSize the caller said was previously persisted —
      // the caller is expected to pass the bounded preview size in
      // `originalSize` for previously-frozen entries.
    }
  }

  // Step 2: fresh entries. Sort largest first, offload until total fits.
  const fresh = input.entries.filter((entry) => !entry.previouslyFrozen);
  fresh.sort((a, b) => b.originalSize - a.originalSize);

  for (const entry of fresh) {
    // Classify first. EMPTY / INLINE bypass offload unless the
    // aggregate is still over budget.
    const classification = classifyReplacement({
      content: entry.content,
      ...(entry.contentType === undefined ? {} : { contentType: entry.contentType }),
      originalSize: entry.originalSize,
    });
    const overBudget = runningTotal > LARGE_CONTENT_THRESHOLDS.aggregateMaxBytes;
    if (classification.kind === 'EMPTY_MARKER' || classification.kind === 'INLINE') {
      // Decide INLINE only when the aggregate is still within
      // budget; otherwise offload (treat as oversized) to free room.
      if (overBudget) {
        decisions.push({
          entryId: entry.entryId,
          shouldOffload: true,
          reason: 'aggregate-above-budget',
          resultingKind: 'PERSISTED_PREVIEW',
        });
        // Offloading replaces the inline content with a bounded
        // preview; running total contribution drops to
        // previewMaxChars worth of model-visible bytes.
        runningTotal += LARGE_CONTENT_THRESHOLDS.previewMaxChars;
        continue;
      }
      decisions.push({
        entryId: entry.entryId,
        shouldOffload: false,
        reason: classification.reason,
        resultingKind: classification.kind,
      });
      runningTotal += entry.originalSize;
      continue;
    }

    if (classification.kind === 'SPECIALIZED_REF') {
      decisions.push({
        entryId: entry.entryId,
        shouldOffload: true,
        reason: 'content-type-binary',
        resultingKind: 'SPECIALIZED_REF',
      });
      runningTotal += LARGE_CONTENT_THRESHOLDS.previewMaxChars;
      continue;
    }

    // PERSISTED_PREVIEW: always offload (the entry was over the
    // single-result inline threshold to begin with).
    decisions.push({
      entryId: entry.entryId,
      shouldOffload: true,
      reason: 'size-above-inline-threshold',
      resultingKind: 'PERSISTED_PREVIEW',
    });
    runningTotal += LARGE_CONTENT_THRESHOLDS.previewMaxChars;
  }

  return {
    decisions,
    projectedAggregateBytes: runningTotal,
  };
}

function classifyFrozenKind(entry: AggregateFreshEntry): ReplacementKind {
  // For a previously-frozen entry the caller indicates the
  // resultingKind via the entry's contentType signal. We default to
  // PERSISTED_PREVIEW when unknown.
  if (entry.contentType === 'BINARY') {
    return 'SPECIALIZED_REF';
  }
  return 'PERSISTED_PREVIEW';
}
