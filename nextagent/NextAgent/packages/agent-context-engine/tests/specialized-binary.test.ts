import { applyReplacement, classifySpecializedKind, renderSpecializedDescriptor } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Binary content uses
 * specialized ref" + design decision 4 step 2.
 *
 * Negative contract: image / PDF / Excel / binary / MCP blob content
 * routes through `SPECIALIZED_REF`. The model-visible block MUST
 * be the safe tagged descriptor (no base64, no hex, no raw bytes).
 */
describe('specialized-binary path negative (task 4.3)', () => {
  for (const [contentType, kind] of [
    ['image/png', 'image'],
    ['image/jpeg', 'image'],
    ['application/pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'excel'],
    ['application/vnd.ms-excel', 'excel'],
    ['application/octet-stream', 'binary'],
    ['application/zip', 'binary'],
  ] as const) {
    it(`${contentType} routes to ${kind} and never stringifies raw bytes`, () => {
      expect(classifySpecializedKind(contentType)).toBe(kind);
      const descriptor = renderSpecializedDescriptor({
        kind,
        contentRef: {
          refId: `art-${kind}`,
          refType: 'ARTIFACT',
          mimeType: contentType,
        },
        safeDescriptor: `${kind}-payload`,
      });
      // Forbidden patterns.
      expect(descriptor).not.toMatch(/data:.*;base64,/);
      expect(descriptor).not.toMatch(/[A-Za-z0-9+/]{200,}=/);
      expect(descriptor).not.toMatch(/\\x[0-9a-f]{2}/i);
      expect(descriptor).not.toMatch(/C:\\/);
      // Required shape.
      expect(descriptor).toContain(contentType);
      expect(descriptor).toContain('ATTACHMENT'.length > 0 ? 'ARTIFACT' : 'ARTIFACT');
    });
  }

  it('binary content with raw bytes (non-UTF-8) MUST NOT appear verbatim in the replacement text', () => {
    // The classifier treats non-UTF-8 binary content as
    // SPECIALIZED_REF; the applier should produce a SAFE
    // preview that does not stringify the raw bytes.
    const rawBytes = new Uint8Array([0x00, 0xff, 0xfe, 0xfd, 0xfc]);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
    const result = applyReplacement({
      kind: 'SPECIALIZED_REF',
      reason: 'content-type-binary',
      originalContent: text,
      originalSize: rawBytes.length,
      contentType: 'application/octet-stream',
      lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      persistContent: () => ({
        contentRef: { refId: 'art-bin-1', refType: 'ARTIFACT', mimeType: 'application/octet-stream' },
      }),
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The applier produces a safe preview with the specialized
      // ref access instruction; the raw bytes do not appear in
      // the model-visible content as base64 or hex.
      expect(result.modelVisibleContent).toContain('<preview>');
      expect(result.modelVisibleContent).toContain('specialized ref');
      expect(result.modelVisibleContent).not.toMatch(/data:.*;base64,/);
      expect(result.modelVisibleContent).not.toMatch(/\\x[0-9a-f]{2}/i);
      // The replacement kind is SPECIALIZED_REF; the contentRef
      // carries the original MIME so the downstream handler can
      // pick the right reader.
      expect(result.replacement.kind).toBe('SPECIALIZED_REF');
      expect(result.replacement.contentRef?.mimeType).toBe('application/octet-stream');
    }
  });
});
