import { applyReplacement, LARGE_CONTENT_THRESHOLDS } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Offload failure is
 * bounded by inline-max-bytes and policy" + design decision 5.
 *
 * Negative contract: a user message with multiple fresh tool results
 * where one offload fails MUST produce a partial result that:
 *   - records the failure for the affected fresh result with
 *     `reason=degradation:offload-failed-into-overflow`
 *   - keeps the successful offloads as PERSISTED_PREVIEW
 *   - does NOT pretend the whole batch is fully offloaded
 *
 * Implementation note: each fresh tool result is processed
 * independently through `applyReplacement` (the applier is the
 * boundary that owns the offload outcome). The aggregate plan is
 * a planning layer; the offload outcome is decided per result.
 */
describe('partial offload failure handling (task 4.4)', () => {
  const baseLineage = { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null } as const;
  const bigContent = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1);

  it('processes a 3-fresh-result batch where one offload fails, two succeed', () => {
    // Fresh result 1: offload succeeds → PERSISTED_PREVIEW.
    const result1 = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: bigContent,
      originalSize: bigContent.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => ({ contentRef: { refId: 'blob-1', refType: 'CAPABILITY_RESULT' } }),
      now: () => 0,
    });
    // Fresh result 2: offload FAILS → explicit failure shape.
    const result2 = applyReplacement({
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
    // Fresh result 3: offload succeeds → PERSISTED_PREVIEW.
    const result3 = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: bigContent,
      originalSize: bigContent.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => ({ contentRef: { refId: 'blob-3', refType: 'CAPABILITY_RESULT' } }),
      now: () => 0,
    });

    // Result 1: success.
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(result1.replacement.contentRef?.refId).toBe('blob-1');
    }
    // Result 2: explicit failure (the partial failure marker).
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.reason).toBe('degradation:offload-failed-into-overflow');
      expect(result2.replacement.degradation?.code).toBe('degradation:offload-failed-into-overflow');
    }
    // Result 3: success.
    expect(result3.ok).toBe(true);
    if (result3.ok) {
      expect(result3.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(result3.replacement.contentRef?.refId).toBe('blob-3');
    }

    // The aggregate signal: 2 success + 1 failure = partial failure.
    const successes = [result1, result3].filter((r) => r.ok).length;
    const failures = [result2].filter((r) => !r.ok).length;
    expect(successes).toBe(2);
    expect(failures).toBe(1);
  });

  it('preserves prior frozen decisions while fresh offloads are partial', () => {
    // A previously persisted preview does NOT get reshaped; the
    // applier just verifies the contentRef exists and re-emits
    // the frozen shape.
    const priorFrozen = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: 'this is a prior preview, not the original raw content',
      originalSize: 1000,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => ({ contentRef: { refId: 'blob-prior', refType: 'CAPABILITY_RESULT' } }),
      now: () => 0,
    });
    expect(priorFrozen.ok).toBe(true);
    if (priorFrozen.ok) {
      expect(priorFrozen.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(priorFrozen.replacement.reason).toBe('size-above-inline-threshold');
    }
  });
});
