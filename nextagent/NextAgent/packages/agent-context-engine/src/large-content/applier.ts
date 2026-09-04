import type { ReplacementEvidence, ReplacementKind, SessionMessage } from '@nextagent/agent-contracts/session';
import { brand, type IdempotencyKey, type MessageId } from '@nextagent/agent-common';

import { LARGE_CONTENT_THRESHOLDS, type LargeContentReasonCode } from './thresholds.js';

/**
 * Build ReplacementEvidence with clean handling of optional fields.
 * Replaces ugly conditional spreads with explicit builder logic.
 */
function buildReplacementEvidence(params: {
  readonly kind: ReplacementKind;
  readonly reason: string;
  readonly contentRef: ReplacementEvidence['contentRef'];
  readonly originalSize: number;
  readonly previewSize: number;
  readonly contentType?: string | undefined;
  readonly lineage: ReplacementEvidence['lineage'];
  readonly decisionState?: 'frozen';
  readonly degradation: ReplacementEvidence['degradation'];
}): ReplacementEvidence {
  // Build the base object with required properties
  const evidence = {
    kind: params.kind,
    reason: params.reason,
    contentRef: params.contentRef,
    originalSize: params.originalSize,
    previewSize: params.previewSize,
    lineage: params.lineage,
  };

  // Conditionally add optional properties using spread
  return {
    ...evidence,
    ...(params.contentType !== undefined && { contentType: params.contentType }),
    ...(params.decisionState !== undefined && { decisionState: params.decisionState }),
    ...(params.degradation !== undefined && { degradation: params.degradation }),
  } as ReplacementEvidence;
}

/**
 * Spec anchor: add-ts-large-content-references §"Stable replacement
 * forms" + §"Replacement decisions are durable session-message facts".
 *
 * The applier consumes a classifier decision and produces:
 *   - the model-visible content (a bounded preview, a specialized
 *     descriptor, or an empty marker)
 *   - the durable `ReplacementEvidence` (kind, reason, contentRef,
 *     originalSize, previewSize, contentType, lineage, decisionState,
 *     degradation)
 *
 * The applier does NOT persist the full content to the gateway; the
 * caller passes a `persistOriginal` callback that the host application
 * implements via the `BlobStoreGateway` entry point. This keeps the
 * engine pure and lets the gateway own the owner-scoped write.
 */

export interface ApplyReplacementInput {
  readonly kind: ReplacementKind;
  readonly reason: LargeContentReasonCode;
  readonly originalContent: string;
  readonly originalSize: number;
  readonly contentType?: string | undefined;
  readonly lineage: ReplacementEvidence['lineage'];
  /**
   * Owner-scoped ContentRef factory. The applier invokes this
   * exactly once when the decision is to persist (PERSISTED_PREVIEW
   * or SPECIALIZED_REF). For INLINE / EMPTY_MARKER the factory
   * is NOT invoked.
   */
  readonly persistContent: () => PersistedContentRef;
  /**
   * Optional offload failure signal. When `shouldPersist` is true
   * but the persist step throws, the applier falls through to the
   * design 5 three-step resolution:
   *   1) if the original block is small AND safe AND does not hit
   *      a provider hard cap, the applier MAY inline fallback with
   *      `degradation.code = offload-failed-into-inline-fallback`.
   *   2) otherwise the applier returns an explicit failure shape
   *      with `degradation.code = offload-failed-into-overflow`.
   *   3) silent drop is forbidden.
   */
  readonly offloadFailure?: { readonly reason: string; readonly canInlineFallback: boolean };
  readonly now: () => number;
}

export interface PersistedContentRef {
  readonly contentRef: ReplacementEvidence['contentRef'];
}

export interface ApplyReplacementSuccess {
  readonly ok: true;
  readonly modelVisibleContent: string;
  readonly replacement: ReplacementEvidence;
  /**
   * Whether the full content was persisted. Persisted content is
   * the source of truth; `SessionMessage.content` is only the
   * model-visible replacement text.
   */
  readonly didPersist: boolean;
}

export interface ApplyReplacementFailure {
  readonly ok: false;
  readonly reason: LargeContentReasonCode;
  readonly message: string;
  /**
   * Presentation-safe marker for the model. The original full
   * content NEVER appears in this field; only an explicit
   * failure marker carrying the reason code. The model sees
   * the marker and the orchestrator (above the applier) decides
   * whether to surface this to the user / retry / fail the
   * assembly.
   */
  readonly modelVisibleContent: string;
  readonly replacement: ReplacementEvidence;
}

export type ApplyReplacementResult = ApplyReplacementSuccess | ApplyReplacementFailure;

/**
 * Render the model-visible content + durable evidence for a
 * classifier decision. Pure function of its inputs.
 */
export function applyReplacement(input: ApplyReplacementInput): ApplyReplacementResult {
  if (input.kind === 'EMPTY_MARKER') {
    const replacement = buildReplacementEvidence({
      kind: 'EMPTY_MARKER',
      reason: input.reason,
      contentRef: null,
      originalSize: input.originalSize,
      previewSize: 0,
      contentType: input.contentType,
      lineage: input.lineage,
      degradation: undefined,
    });
    return {
      ok: true,
      modelVisibleContent: renderEmptyMarker(),
      replacement,
      didPersist: false,
    };
  }

  if (input.kind === 'INLINE') {
    const replacement = buildReplacementEvidence({
      kind: 'INLINE',
      reason: input.reason,
      contentRef: null,
      originalSize: input.originalSize,
      previewSize: input.originalSize,
      contentType: input.contentType,
      lineage: input.lineage,
      degradation: undefined,
    });
    return {
      ok: true,
      modelVisibleContent: input.originalContent,
      replacement,
      didPersist: false,
    };
  }

  // PERSISTED_PREVIEW or SPECIALIZED_REF both require persist.
  if (input.offloadFailure !== undefined && !input.offloadFailure.canInlineFallback) {
    const replacement = buildReplacementEvidence({
      kind: input.kind,
      reason: 'degradation:offload-failed-into-overflow',
      contentRef: null,
      originalSize: input.originalSize,
      previewSize: 0,
      contentType: input.contentType,
      lineage: input.lineage,
      degradation: {
        code: 'degradation:offload-failed-into-overflow',
        message: input.offloadFailure.reason,
        readableContentRef: null,
      },
    });
    return {
      ok: false,
      reason: 'degradation:offload-failed-into-overflow',
      message: input.offloadFailure.reason,
      // The marker is presentation-safe: it carries the reason
      // code so the model can read it, but it does NOT include
      // the original content, the path, the credential, or any
      // raw bytes. The orchestrator decides whether to surface
      // the marker, retry the offload, or fail the assembly.
      modelVisibleContent: `<large-content-offload-failed code="degradation:offload-failed-into-overflow">${input.offloadFailure.reason}</large-content-offload-failed>`,
      replacement,
    };
  }

  // Inline-fallback path (design decision 5 step 1): the orchestrator
  // has decided the original block is small enough AND does not hit
  // a provider hard cap / safety blacklist. The applier must NOT call
  // persistContent (that is the failing call); instead the model sees
  // the original content AND the replacement evidence carries
  // `degradation:offload-failed-into-inline-fallback` with a
  // readableContentRef for the caller to retry later. The block
  // stays in INLINE form semantically (previewSize === originalSize)
  // because it was never persisted.
  if (input.offloadFailure !== undefined && input.offloadFailure.canInlineFallback) {
    const readableRef: { refId: string; refType: 'ATTACHMENT' | 'CAPABILITY_RESULT' | 'MODEL_SUMMARY' | 'ARTIFACT' } = {
      refId: 'pending-persist',
      refType: 'CAPABILITY_RESULT',
    };
    const replacement = buildReplacementEvidence({
      kind: 'INLINE',
      reason: 'degradation:offload-failed-into-inline-fallback',
      contentRef: null,
      originalSize: input.originalSize,
      previewSize: input.originalSize,
      contentType: input.contentType,
      lineage: input.lineage,
      degradation: {
        code: 'degradation:offload-failed-into-inline-fallback',
        message: input.offloadFailure.reason,
        readableContentRef: readableRef,
      },
    });
    return {
      ok: true,
      modelVisibleContent: input.originalContent,
      replacement,
      didPersist: false,
    };
  }

  const persisted = input.persistContent();
  const { renderedPreview, headBytes } = renderPreview(input.originalContent, input.kind);
  const replacement = buildReplacementEvidence({
    kind: input.kind,
    reason: input.reason,
    contentRef: persisted.contentRef,
    originalSize: input.originalSize,
    // previewSize is the bounded original-content head (the
    // access instruction that wraps the head is a presentation
    // marker, NOT counted as preview bytes). The marker is what
    // the model sees; the headBytes is what got truncated.
    previewSize: headBytes,
    contentType: input.contentType,
    lineage: input.lineage,
    degradation:
      input.offloadFailure !== undefined
        ? {
            code: 'degradation:offload-failed-into-inline-fallback' as const,
            message: input.offloadFailure.reason,
            readableContentRef: persisted.contentRef,
          }
        : undefined,
  });
  return {
    ok: true,
    modelVisibleContent: renderedPreview,
    replacement,
    didPersist: true,
  };
}

function renderEmptyMarker(): string {
  return '<empty tool result>';
}

function renderPreview(content: string, kind: ReplacementKind): { readonly renderedPreview: string; readonly headBytes: number } {
  const maxChars = LARGE_CONTENT_THRESHOLDS.previewMaxChars;
  const head = content.length <= maxChars ? content : content.slice(0, maxChars);
  const headBytes = head.length;
  const accessInstruction = kind === 'SPECIALIZED_REF' ? '[full content available via specialized ref]' : '[full content available via contentRef]';
  const renderedPreview = ['<preview>', head, content.length > maxChars ? '\n… (truncated)' : '', '\n', accessInstruction].join('');
  return { renderedPreview, headBytes };
}

/**
 * Project the durable replacement evidence into the metadata of a
 * `SessionMessage` to be written via the gateway. The metadata is
 * the JSON-compatible typed extension `replacement` (per design
 * decision 6.2) keyed under a single property so the schema guard
 * can validate it on read.
 *
 * The evidence is returned as a `JsonValue`-shaped record (with
 * the typed `ReplacementEvidence` payload JSONified). The caller
 * stores it under `SessionMessage.metadata.replacement`; the
 * `readReplacementDecision` reader does a structural
 * `isReplacementEvidence` check on read.
 */
export function projectReplacementMetadata(replacement: ReplacementEvidence): {
  readonly replacement: Record<string, unknown>;
} {
  return { replacement: JSON.parse(JSON.stringify(replacement)) as Record<string, unknown> };
}

/**
 * Read a previously persisted replacement decision from a
 * `SessionMessage.metadata` payload. Returns undefined when the
 * metadata does not carry a `replacement` block (e.g. a historical
 * `INLINE` message that was written before this capability landed).
 * The spec scenario "Reuse prior replacement by later turns"
 * requires this reader.
 */
export function readReplacementDecision(message: SessionMessage): ReplacementEvidence | undefined {
  const meta = message.metadata;
  const candidate = meta['replacement'];
  if (!isReplacementEvidence(candidate)) {
    return undefined;
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

/**
 * Stable, presentation-safe ContentRef shape used by the
 * engine-internal preview path. The real `ContentRef` is owned by
 * the gateway; this factory exists so the engine does not need
 * to import a concrete blob store.
 */
export function createInMemoryContentRef(args: {
  readonly refType: import('@nextagent/agent-contracts/session').ContentRef['refType'];
  readonly refId: string;
}): { readonly refType: import('@nextagent/agent-contracts/session').ContentRef['refType']; readonly refId: string } {
  return { refType: args.refType, refId: args.refId };
}

/**
 * Convenience: derive a fresh `MessageId`-branded value for the
 * persisted preview. The gateway test doubles use this to keep the
 * engine-side message-id generation deterministic in unit tests.
 */
export function newReplacementMessageId(idFactory: (prefix: string) => string): MessageId {
  return brand<string, 'MessageId'>(idFactory('replacement'));
}

/**
 * Convenience: derive a stable idempotency key the caller can pass
 * to the gateway's save / commit endpoints.
 */
export function newReplacementIdempotencyKey(args: {
  readonly sessionId: string;
  readonly runId: string;
  readonly sourceMessageId: MessageId;
  readonly kind: ReplacementKind;
  readonly idFactory: (prefix: string) => string;
}): IdempotencyKey {
  return brand<string, 'IdempotencyKey'>(`${args.sessionId}:${args.runId}:replacement:${args.sourceMessageId}:${args.kind}:${args.idFactory('ik')}`);
}
