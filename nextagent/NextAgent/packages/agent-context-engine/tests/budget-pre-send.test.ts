import { applyReplacement, LARGE_CONTENT_THRESHOLDS } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Offload failure feeds
 * budget pre-send check" + design decision 5 step 2.
 *
 * Boundary contract: when an offload fails with the explicit-failure
 * path (no inline fallback), the replacement evidence carries
 * `degradation.code = "degradation:offload-failed-into-overflow"`.
 * This signal MUST feed `add-ts-context-budget-explainability`'s
 * `PRE_SEND_CHECK_REQUIRED` entry (the budget gate), and the
 * orchestrator MUST NOT proceed to model invocation with the
 * original payload.
 *
 * This test pins the boundary at the applier side: the explicit
 * failure shape carries the reason code that the budget gate
 * reads. The full gate logic lives in the budget-explainability
 * change; this test asserts the upstream signal shape.
 */
describe('offload-failed-into-overflow feeds PRE_SEND_CHECK_REQUIRED (task 5.2)', () => {
  const baseLineage = { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null } as const;

  it('explicit failure shape carries the PRE_SEND_CHECK_REQUIRED signal', () => {
    // A fresh oversized payload that cannot be persisted (persist
    // throws, block is too large for inline fallback) returns the
    // explicit failure shape. The orchestrator / budget gate
    // reads `result.replacement.degradation.code` and
    // `result.reason` to surface PRE_SEND_CHECK_REQUIRED.
    const bigContent = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: bigContent,
      originalSize: bigContent.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => {
        throw new Error('blob-store-unavailable');
      },
      offloadFailure: { reason: 'blob-store-unavailable', canInlineFallback: false },
      now: () => 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The shape the budget gate reads.
      expect(result.reason).toBe('degradation:offload-failed-into-overflow');
      expect(result.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(result.replacement.degradation?.code).toBe('degradation:offload-failed-into-overflow');
      // The model-visible marker is a presentation-safe tagged
      // block, NOT the original bytes (no leak-through).
      expect(result.modelVisibleContent).toContain('degradation:offload-failed-into-overflow');
      expect(result.modelVisibleContent).not.toContain(bigContent);
    }
  });

  it('inline-fallback path does NOT carry the PRE_SEND_CHECK_REQUIRED signal', () => {
    // When the block is small enough to inline, the applier
    // returns success (didPersist=false). The orchestrator does
    // NOT need to invoke the pre-send check on this path; the
    // boundary is explicit via the lack of overflow reason.
    const smallContent = 'small block — inline budget fits';
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: smallContent,
      originalSize: smallContent.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => {
        throw new Error('blob-store-degraded');
      },
      offloadFailure: { reason: 'blob-store-degraded', canInlineFallback: true },
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.didPersist).toBe(false);
      expect(result.replacement.kind).toBe('INLINE');
      expect(result.replacement.degradation?.code).toBe('degradation:offload-failed-into-inline-fallback');
      // Crucially, NOT the overflow reason — the pre-send check is
      // not needed when the orchestrator can fall back to inline.
      expect(result.replacement.degradation?.code).not.toBe('degradation:offload-failed-into-overflow');
    }
  });
});
