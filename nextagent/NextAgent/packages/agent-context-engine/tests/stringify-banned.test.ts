import { classifySpecializedKind, renderSpecializedDescriptor } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Binary content uses
 * specialized ref" + design decision 7 ("图片、PDF、Excel、二进制附件
 * 不走通用文本 stringify").
 *
 * The negative contract: when a binary / non-text content type or raw
 * binary blob enters the pipeline, the rendering path MUST produce a
 * `SPECIALIZED_REF` block, never a base64 / hex / String(byte) dump.
 */
describe('specialized binary path — no generic stringify (task 3.3)', () => {
  it('classifies every binary MIME as a non-text kind', () => {
    for (const mime of [
      'image/png',
      'image/jpeg',
      'image/svg+xml',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'application/zip',
      'video/mp4',
      'audio/mpeg',
    ]) {
      const kind = classifySpecializedKind(mime);
      expect(kind, `mime=${mime} must classify to a non-null specialized kind`).not.toBeNull();
    }
  });

  it('leaves plain-text MIME unclassified (no false-positive specialized path)', () => {
    expect(classifySpecializedKind('text/plain')).toBeNull();
    expect(classifySpecializedKind('application/json')).toBeNull();
    expect(classifySpecializedKind(undefined)).toBeNull();
  });

  it('specialized descriptor never contains base64 / hex / path literals', () => {
    const descriptor = renderSpecializedDescriptor({
      kind: 'excel',
      contentRef: {
        refId: 'art-xlsx',
        refType: 'ARTIFACT',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      safeDescriptor: 'quarterly-rsrp.xlsx',
    });
    // Forbidden patterns that would indicate the binary was
    // stringified into the model-visible form.
    expect(descriptor).not.toMatch(/[A-Za-z0-9+/]{200,}=/); // base64 padding
    expect(descriptor).not.toMatch(/\\x[0-9a-f]{2}/i); // hex escapes
    expect(descriptor).not.toMatch(/data:[^;]+;base64,/);
    expect(descriptor).not.toMatch(/C:\\/);
    expect(descriptor).not.toMatch(/[\\]Users[\\][\\/]/);
    expect(descriptor).not.toMatch(/[\\/]home[\\/][^\\s]+/);
  });

  it('classifySpecializedKind returns image for every image/* MIME', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']) {
      expect(classifySpecializedKind(mime), `mime=${mime}`).toBe('image');
    }
  });
});
