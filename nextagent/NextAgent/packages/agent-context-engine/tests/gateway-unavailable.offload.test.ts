import { applyReplacement, LARGE_CONTENT_THRESHOLDS } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Offload failure cannot be
 * silently inlined under hard caps" + design decision 5 step 2.
 *
 * Negative contract: when the persist step throws and the original
 * block is LARGER than the inline budget, the applier MUST return
 * an explicit failure shape carrying
 * `reason=degradation:offload-failed-into-overflow`. The original
 * full content MUST NOT leak through the failure path as a silent
 * inline.
 */
describe('offload failure → explicit failure (task 4.2)', () => {
  it('returns explicit failure with offload-failed-into-overflow when persist throws and block exceeds inline-max-bytes', () => {
    const originalContent = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent,
      originalSize: originalContent.length,
      contentType: 'text/plain',
      lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      persistContent: () => {
        throw new Error('blob-store-gateway-unavailable');
      },
      offloadFailure: { reason: 'blob-store-gateway-unavailable', canInlineFallback: false },
      now: () => 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('degradation:offload-failed-into-overflow');
      // The original content MUST NOT appear in the failure result
      // (the failure path surfaces a marker, not the raw bytes).
      expect(result.modelVisibleContent).not.toContain(originalContent);
      expect(result.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(result.replacement.reason).toBe('degradation:offload-failed-into-overflow');
      expect(result.replacement.contentRef).toBeNull();
      expect(result.replacement.degradation).not.toBeNull();
      expect(result.replacement.degradation?.code).toBe('degradation:offload-failed-into-overflow');
    }
  });

  it('never returns silently empty content when offload fails', () => {
    const originalContent = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes * 2);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent,
      originalSize: originalContent.length,
      contentType: 'text/plain',
      lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      persistContent: () => {
        throw new Error('sqlite-lock-failure');
      },
      offloadFailure: { reason: 'sqlite-lock-failure', canInlineFallback: false },
      now: () => 0,
    });
    // The failure shape is always non-empty AND non-original.
    if (!result.ok) {
      expect(result.modelVisibleContent.length).toBeGreaterThan(0);
      expect(result.modelVisibleContent).not.toBe(originalContent);
    } else {
      throw new Error('expected failure but got ok=true');
    }
  });
});
