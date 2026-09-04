import { applyReplacement, classifyReplacement, renderSpecializedDescriptor, renderPersistedPreviewBlock } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Owner Scope" + design
 * decision 6.3 ("ContentRef 解析 owner 收口").
 *
 * Negative contract: the model-visible content, replacement evidence
 * metadata, and rendered preview/specialized blocks MUST NOT contain
 * `BlobRef` literals, local file paths, provider SDK handles, or raw
 * binary bytes. The boundary is "presentation-safe" — only the
 * information a model can consume (ref id, kind, size, reason, safe
 * descriptor) crosses the boundary.
 */
describe('path / BlobRef / binary redaction (task 4.6)', () => {
  // Patterns that, if found in any model-visible block, indicate
  // a redaction boundary breach. The grep is intentionally
  // conservative (looks for ANY occurrence, even partial).
  const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
    { name: 'Windows path', pattern: /[A-Z]:\\/i },
    { name: 'Unix /home path', pattern: /\/home\// },
    { name: 'blobRef /Users', pattern: /\/Users\// },
    { name: 'blob-store-raw', pattern: /blobRef:[^,}\s]+/i },
    { name: 'data URL base64', pattern: /data:[^;]+;base64,/ },
    { name: 'hex escape', pattern: /\\x[0-9a-f]{2}/i },
    { name: 'ANSI C escape', pattern: /\\u[0-9a-f]{4}/i },
  ];

  function assertNoLeak(name: string, content: string): void {
    for (const { name: pname, pattern } of FORBIDDEN_PATTERNS) {
      expect(content.match(pattern), `${name} leaked ${pname}: ${content.slice(0, 200)}`).toBeNull();
    }
  }

  it("the classifier's decision output never leaks path / BlobRef / bytes", () => {
    const inputs = [
      { content: 'x'.repeat(20_000), contentType: 'text/plain', originalSize: 20_000 },
      { content: '\x00\xff\xfe\xfd', contentType: 'application/octet-stream', originalSize: 4 },
    ];
    for (const input of inputs) {
      const decision = classifyReplacement(input);
      assertNoLeak('classifyReplacement', JSON.stringify(decision));
    }
  });

  it("the applier's success result never leaks path / BlobRef / bytes in modelVisibleContent", () => {
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: 'x'.repeat(20_000),
      originalSize: 20_000,
      contentType: 'text/plain',
      lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      persistContent: () => ({ contentRef: { refId: 'blob-1', refType: 'CAPABILITY_RESULT' } }),
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      assertNoLeak('applyReplacement success modelVisibleContent', result.modelVisibleContent);
      assertNoLeak('applyReplacement success replacement', JSON.stringify(result.replacement));
    }
  });

  it("the applier's failure result never leaks path / BlobRef / bytes", () => {
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: 'x'.repeat(20_000),
      originalSize: 20_000,
      contentType: 'text/plain',
      lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      persistContent: () => {
        throw new Error('blob-store-degraded');
      },
      offloadFailure: { reason: 'blob-store-degraded', canInlineFallback: false },
      now: () => 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      assertNoLeak('applyReplacement failure modelVisibleContent', result.modelVisibleContent);
      assertNoLeak('applyReplacement failure replacement', JSON.stringify(result.replacement));
      // The original block MUST NOT appear in the failure block
      // (no leak-through of the raw bytes).
      expect(result.modelVisibleContent).not.toContain('x'.repeat(20_000));
    }
  });

  it('renderSpecializedDescriptor never includes a path or BlobRef literal', () => {
    const descriptor = renderSpecializedDescriptor({
      kind: 'excel',
      contentRef: { refId: 'art-1', refType: 'ARTIFACT', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      safeDescriptor: 'cell-tower-east-01.xlsx',
    });
    assertNoLeak('renderSpecializedDescriptor', descriptor);
  });

  it('renderPersistedPreviewBlock never includes a path or BlobRef literal', () => {
    const block = renderPersistedPreviewBlock({
      replacementReason: 'policy:oversized-single-result',
      contentRefId: 'blob-1',
      contentRefType: 'CAPABILITY_RESULT',
      originalSize: 20_000,
      preview: 'preview-only — bounded by previewMaxChars',
    });
    assertNoLeak('renderPersistedPreviewBlock', block);
  });
});
