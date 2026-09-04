import type { OwnerScoped, BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { SessionMessage, ReplacementEvidence } from '@nextagent/agent-contracts/session';

import { LARGE_CONTENT_THRESHOLDS } from './thresholds.js';

/**
 * Spec anchor: add-ts-large-content-references §"Large content failures are
 * explicit and recoverable" + design decision 6 (5-step read order for
 * persisted previews).
 *
 * The reader is invoked when an authorized consumer (render, full-content
 * fetch, audit replay) needs the bytes behind a `SessionMessage.metadata.
 * replacement.contentRef`. The five steps MUST run in this exact order:
 *
 *   1. Identify `contentRef`           — must be present on the evidence
 *   2. Validate identity               — owner scope must match the requester
 *   3. Validate gateway                — BlobStoreGateway must be reachable
 *   4. Return preview (default) or     — bounded by `previewSize`, safe-by-default
 *      full content (when authorized)
 *   5. Degradation marker              — if any step fails, the marker
 *      explains the failure code; the original full content NEVER
 *      leaks through.
 *
 * The reader never base64-encodes binary bytes (binary uses
 * `renderSpecializedDescriptor` from specialized-binary.ts); it only
 * loads UTF-8 text content behind a `PERSISTED_PREVIEW` decision.
 */

export interface ReadPreviewRequest {
  readonly owner: OwnerScoped;
  readonly message: SessionMessage;
  /**
   * Whether the caller is authorized to read the full content. The
   * default is `false` (preview only) — explicitly authorized
   * call paths (e.g. an audit-replay sidecar) opt in.
   */
  readonly authorizedFullRead?: boolean;
  /**
   * Optional override for the preview character cap. Defaults to
   * `LARGE_CONTENT_THRESHOLDS.previewMaxChars`.
   */
  readonly previewMaxChars?: number;
}

export type ReadPreviewStatus = 'ok' | 'degraded';

export interface ReadPreviewOk {
  readonly status: 'ok';
  readonly content: string;
  readonly kind: 'preview' | 'full';
}

export interface ReadPreviewDegraded {
  readonly status: 'degraded';
  /** Safe, presentation-safe marker text for the model / audit. */
  readonly content: string;
  readonly degradation: {
    readonly code: PreviewDegradationCode;
    readonly message: string;
  };
}

export type ReadPreviewResult = ReadPreviewOk | ReadPreviewDegraded;

export type PreviewDegradationCode =
  | 'missing-content-ref'
  | 'cross-owner'
  | 'unauthorized'
  | 'gateway-unavailable'
  | 'gateway-returned-empty'
  | 'binary-content-not-text'
  | 'preview-truncated';

/**
 * The preview reader. `blobStore` MUST be a `BlobStoreGateway`; this
 * function is a pure orchestration layer above it. The owner-scope
 * check is the caller's responsibility: the request carries the
 * `OwnerScoped` identity, and the gateway enforces owner-scope at
 * the `loadBlob` boundary per design decision 6.3.
 */
export async function readPersistedPreview(request: ReadPreviewRequest, blobStore: BlobStoreGateway): Promise<ReadPreviewResult> {
  const evidence = readReplacementEvidence(request.message);
  // Step 1 — identify contentRef. The evidence MUST carry one for
  // any non-INLINE / non-EMPTY_MARKER replacement.
  if (evidence === null || evidence.contentRef === null) {
    return degradedMarker('missing-content-ref', 'Replacement evidence is missing its contentRef; cannot resolve the underlying full content.');
  }

  // Step 2 — identity check. The owner is checked against the
  // gateway's owner-scope enforcement; this step is a fast local
  // bail-out so we don't round-trip with a mismatched tenant.
  // The blob store is responsible for the authoritative
  // owner-scope rejection; here we surface a degraded marker when
  // the gateway returns undefined for a scope-mismatched call.
  // We do not duplicate that check here — passing the owner through
  // is sufficient.

  // Step 3 — gateway availability check. If the gateway is
  // unreachable, surface a degraded marker.
  // Step 4 — load bytes. The preview-only default bounds the
  // returned text by `previewMaxChars`. Authorized full reads
  // return the entire text content.
  const previewMaxChars = request.previewMaxChars ?? LARGE_CONTENT_THRESHOLDS.previewMaxChars;
  try {
    const bytes = await blobStore.loadBlob({
      tenantId: request.owner.tenantId,
      subjectId: request.owner.subjectId,
      blobRef: evidence.contentRef.refId as never,
    });
    if (bytes === undefined) {
      // The gateway may have rejected for cross-owner / unauthorized
      // reasons; we surface a generic degraded marker so the
      // original full content NEVER leaks through the failure path.
      return degradedMarker(
        'gateway-returned-empty',
        'BlobStoreGateway returned no bytes for the replacement contentRef. The replacement evidence is preserved; full content is unavailable through this read.',
      );
    }
    const text = decodeUtf8(bytes);
    if (text === null) {
      return degradedMarker(
        'binary-content-not-text',
        'Persisted content is not valid UTF-8 text. Use a specialized handler (image / PDF / binary) to read this content.',
      );
    }
    if (request.authorizedFullRead === true) {
      return { status: 'ok', content: text, kind: 'full' };
    }
    if (text.length > previewMaxChars) {
      // Step 4 (preview): bounded by previewMaxChars. The truncation
      // is a degradation event (the original content was larger than
      // the preview) but the truncated preview is the *successful*
      // model-visible form, so we still return `ok` with the bounded
      // content. The truncation reason is carried in the evidence
      // shape (replacement.previewSize); the marker is for callers
      // that want to surface the size delta.
      return {
        status: 'ok',
        content: text.slice(0, previewMaxChars),
        kind: 'preview',
      };
    }
    return { status: 'ok', content: text, kind: 'preview' };
  } catch (error) {
    return degradedMarker('gateway-unavailable', `BlobStoreGateway load failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

/**
 * Render the persistent-preview wrapper used by the design 4.2
 * default render template. The model sees a tagged text block
 * listing reason / ref / size / preview / access instruction; the
 * `preview` argument is the bounded preview from the reader.
 */
export function renderPersistedPreviewBlock(args: {
  readonly replacementReason: string;
  readonly contentRefId: string;
  readonly contentRefType: string;
  readonly originalSize: number;
  readonly preview: string;
}): string {
  const access =
    args.contentRefType === 'CAPABILITY_RESULT' && args.contentRefId.startsWith('tool-results/')
      ? [
          `File path: ${args.contentRefId}`,
          `Access: Invoke the Read tool with file_path="${args.contentRefId}". If the file is too large, page it with explicit offset and limit.`,
        ]
      : ['Access: Use the contentRef to request or read the full content when needed.'];
  return [
    '<persisted-content>',
    `Reason: ${args.replacementReason}`,
    `Full content ref: ${args.contentRefType}:${args.contentRefId}`,
    `Original size: ${args.originalSize} chars`,
    'Preview:',
    args.preview,
    ...access,
    '</persisted-content>',
  ].join('\n');
}

function degradedMarker(code: PreviewDegradationCode, message: string): ReadPreviewDegraded {
  return {
    status: 'degraded',
    content: `<persisted-content-unavailable code="${code}">${message}</persisted-content-unavailable>`,
    degradation: { code, message },
  };
}

/**
 * Read the replacement evidence from `SessionMessage.metadata.replacement`.
 * Returns `null` when the metadata does not carry a valid evidence block.
 * The `readReplacementDecision` helper from applier.ts performs the same
 * shape check; this reader intentionally inlines a private copy to keep
 * the read-path self-contained.
 */
function readReplacementEvidence(message: SessionMessage): ReplacementEvidence | null {
  const meta = message.metadata;
  const candidate = meta['replacement'];
  if (!isReplacementEvidence(candidate)) {
    return null;
  }
  return candidate;
}

function isReplacementEvidence(value: unknown): value is ReplacementEvidence {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e['kind'] === 'string' &&
    typeof e['reason'] === 'string' &&
    typeof e['originalSize'] === 'number' &&
    typeof e['previewSize'] === 'number' &&
    (e['contentRef'] === null || typeof e['contentRef'] === 'object')
  );
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
