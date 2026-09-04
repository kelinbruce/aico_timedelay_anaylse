import type { ContentRef } from '@nextagent/agent-contracts/session';

/**
 * Spec anchor: add-ts-large-content-references §"Binary content uses
 * specialized ref" + design decision 7 ("图片、PDF、Excel、二进制附件
 * 不走通用文本 stringify") + design decision 4.2 default render template
 * for `SPECIALIZED_REF`.
 *
 * The specialized binary handler renders a SAFE DESCRIPTOR for the
 * model. It NEVER stringifies the binary bytes; the model only sees
 * a tagged text block listing content type, content ref, a small
 * safe descriptor (file name / kind only — no path / credential /
 * handle), and an access instruction pointing to the owning reader /
 * projector for the content type. The owning reader is implementation
 * defined; this module only renders the descriptor and the caller's
 * specialized handler performs the actual read.
 */

export type SpecializedKind = 'image' | 'pdf' | 'excel' | 'binary' | 'mcp-blob';

export interface SpecializedDescriptorInput {
  readonly kind: SpecializedKind;
  readonly contentRef: ContentRef;
  /**
   * Safe, presentation-safe descriptor (e.g. file name without
   * directory). MUST NOT include local path, credential, SDK handle,
   * or raw bytes. The caller is responsible for ensuring the
   * descriptor is safe; the renderer passes it through unchanged.
   */
  readonly safeDescriptor: string;
}

/**
 * Classify a MIME type into a `SpecializedKind` for the descriptor
 * block. Unknown binary MIME types fall back to `"binary"`. The
 * classifier is a pure function of the MIME string.
 *
 * Returns `null` for plain text / structured text MIMEs (json,
 * xml, plain, csv) so the caller routes those to the standard
 * text preview path instead of forcing them through the binary
 * specialized descriptor.
 */
export function classifySpecializedKind(mimeType?: string): SpecializedKind | null {
  if (mimeType === undefined) {
    return null;
  }
  const normalized = mimeType.toLowerCase();
  // Plain text / structured text: not specialized.
  if (normalized.startsWith('text/') || normalized === 'application/json' || normalized === 'application/xml' || normalized === 'application/csv') {
    return null;
  }
  if (normalized.startsWith('image/')) {
    return 'image';
  }
  if (normalized === 'application/pdf') {
    return 'pdf';
  }
  if (normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || normalized === 'application/vnd.ms-excel') {
    return 'excel';
  }
  if (
    normalized === 'application/octet-stream' ||
    normalized === 'application/zip' ||
    normalized.startsWith('video/') ||
    normalized.startsWith('audio/')
  ) {
    return 'binary';
  }
  // MCP blobs and other unknown binary types fall back to `binary`.
  return 'binary';
}

/**
 * Render the `SPECIALIZED_REF` default model-visible block
 * (design 4.2). The output is the exact tagged text the model
 * sees — no stringification, no base64, no hex, no path or
 * credential. The owning reader / projector (e.g. image viewer,
 * PDF text extractor) is referenced by descriptor kind but its
 * implementation is out of scope of this module.
 */
export function renderSpecializedDescriptor(input: SpecializedDescriptorInput): string {
  const contentType = input.contentRef.mimeType ?? 'application/octet-stream';
  return [
    '<specialized-content>',
    `Type: ${contentType}`,
    `Kind: ${input.kind}`,
    `Content ref: ${input.contentRef.refType}:${input.contentRef.refId}`,
    `Descriptor: ${input.safeDescriptor}`,
    'Access: Use the owning reader / projector for this content type to read the underlying bytes.',
    '</specialized-content>',
  ].join('\n');
}

/**
 * Empty output marker (design 4.2). Used by the classifier's
 * EMPTY_MARKER path; included here so the binary path and the
 * empty-output path share the same template source.
 */
export function renderEmptyMarker(sourceName: string): string {
  return `(${sourceName} completed with no output)`;
}
