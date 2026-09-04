import { applyReplacement, LARGE_CONTENT_THRESHOLDS } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references design decision 5
 * step 1 + §"Offload failure is bounded by inline-max-bytes and
 * policy".
 *
 * Negative contract: when the offload fails AND the original block
 * is small enough to fit the inline budget (≤ inline-max-bytes)
 * AND it does NOT hit a provider hard cap / safety blacklist,
 * the applier MUST inline-fallback and record
 * `reason=degradation:offload-failed-into-inline-fallback` in the
 * replacement evidence. When the inline-fallback is NOT allowed
 * (e.g. block too large or safety), the applier must NOT write
 * that reason; it writes `degradation:offload-failed-into-overflow`
 * instead.
 */
describe('offload-failure inline-fallback reason (task 4.5)', () => {
  const baseLineage = { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null } as const;

  it('inline-fallback path records degradation:offload-failed-into-inline-fallback', () => {
    // Original block is small (well under inline-max-bytes); the
    // applier is told canInlineFallback=true. The persisted
    // preview wrapping is dropped; the model sees the original
    // block AND the replacement evidence carries the inline-
    // fallback reason.
    const smallContent = 'small block — under inline budget';
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
      // Inline-fallback: the model sees the original content.
      expect(result.modelVisibleContent).toBe(smallContent);
      // The replacement evidence carries the inline-fallback reason.
      expect(result.replacement.reason).toBe('degradation:offload-failed-into-inline-fallback');
      expect(result.replacement.degradation).not.toBeNull();
      expect(result.replacement.degradation?.code).toBe('degradation:offload-failed-into-inline-fallback');
      expect(result.replacement.degradation?.readableContentRef).not.toBeNull();
    }
  });

  it('no-fallback path (block too large) records degradation:offload-failed-into-overflow, NOT inline-fallback', () => {
    // Original block is over inline-max-bytes; the applier is
    // told canInlineFallback=false. The model sees the explicit
    // failure marker (NOT the original content); the replacement
    // evidence carries the overflow reason.
    const bigContent = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: bigContent,
      originalSize: bigContent.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => {
        throw new Error('blob-store-degraded');
      },
      offloadFailure: { reason: 'blob-store-degraded', canInlineFallback: false },
      now: () => 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The overflow reason is the boundary; the inline-fallback
      // reason MUST NOT appear.
      expect(result.reason).toBe('degradation:offload-failed-into-overflow');
      expect(result.replacement.reason).toBe('degradation:offload-failed-into-overflow');
      expect(result.replacement.reason).not.toBe('degradation:offload-failed-into-inline-fallback');
    }
  });
});
