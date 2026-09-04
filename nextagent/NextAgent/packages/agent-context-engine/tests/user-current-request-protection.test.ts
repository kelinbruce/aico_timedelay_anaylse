import { applyReplacement, LARGE_CONTENT_THRESHOLDS } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Large-content handling
 * is differentiated by message source" + design decision 5 + the
 * "USER current request is not summarized, truncated, or substituted
 * with a PERSISTED_PREVIEW excerpt" invariant.
 *
 * Negative contract: the applier MUST NOT silently summarize a
 * user-current-request payload (the engine routes current-request
 * bodies through a different gate that returns explicit
 * insufficient-context rather than producing a PERSISTED_PREVIEW
 * substitution). The "current request" identification is
 * orchestrator-side; this module asserts that the large-content
 * applier does NOT carry any implicit "summarize" semantics for
 * a user-authored payload even when the fresh content exceeds the
 * inline budget — the orchestrator is the boundary that must
 * surface the insufficient-context outcome.
 */
describe('user-current-request protection (task 4.7)', () => {
  const baseLineage = { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null } as const;

  it('a user-authored oversized payload is NEVER summarized into a smaller form by the applier', () => {
    // The applier does not own a "summarize" path. A user request
    // that exceeds the inline budget goes through the same
    // PERSISTED_PREVIEW / offload flow as a tool result; the
    // orchestrator (above the applier) is responsible for the
    // "current request cannot be silently dropped / truncated /
    // summarized" guarantee (pre-send check).
    const userBody = 'USER request body that happens to be very long. '.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes / 50 + 1);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: userBody,
      originalSize: userBody.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => ({ contentRef: { refId: 'user-blob-1', refType: 'ARTIFACT' } }),
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The model-visible content is a bounded preview, NOT a
      // summary. The bounded preview does not say "Summary:" or
      // "TL;DR:" or "The user wants..." — it is the head of the
      // original block (the applier does not rewrite the
      // preview text into a different shape).
      expect(result.modelVisibleContent).toContain('USER request body that happens to be very long.');
      expect(result.modelVisibleContent).not.toMatch(/^Summary:/);
      expect(result.modelVisibleContent).not.toMatch(/^TL;DR:/);
      // The replacement kind is PERSISTED_PREVIEW (NOT a
      // compression-style summary that would have a different
      // refType).
      expect(result.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(result.replacement.contentRef?.refType).not.toBe('MODEL_SUMMARY');
    }
  });

  it('the applier does NOT produce a `summary` keyword or refType on a fresh user payload', () => {
    // The user payload is the "current request" body. The
    // applier must NOT route it through summary; that is owned
    // by add-ts-context-compression / add-ts-traceable-summary-
    // generation. This test asserts the boundary.
    const userBody = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes * 2);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: userBody,
      originalSize: userBody.length,
      contentType: 'text/plain',
      lineage: baseLineage,
      persistContent: () => ({ contentRef: { refId: 'user-blob-2', refType: 'ARTIFACT' } }),
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.replacement);
      expect(serialized).not.toContain('MODEL_SUMMARY');
      expect(serialized).not.toMatch(/lineage[_-]?summary/);
    }
  });
});
