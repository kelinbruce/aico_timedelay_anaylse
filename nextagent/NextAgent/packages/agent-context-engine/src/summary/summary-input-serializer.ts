import type { SessionMessage } from '@nextagent/agent-contracts/session';

/**
 * Serializable, presentation-safe projection of one `SessionMessage`
 * for the summary-generator prompt. Consumes the message's frozen
 * model-visible form — does NOT re-inline externalized large
 * payload bodies — and never carries raw path / credential / secret.
 *
 * Spec anchor: add-ts-traceable-summary-generation design D3 / D6:
 *   "covered SessionMessage[] 序列化为 summary input, 保留 role,
 *    顺序和 message boundary"
 *   "对 CAPABILITY_RESULT 使用安全表达"
 *   "消费已有 large-content replacement 形态, 不重新内联外置大内容"
 *   "不修改原始 SessionMessage.content"
 */
export interface SerializedSummaryTurn {
  readonly ordinal: number;
  readonly role: string;
  readonly content: string;
  readonly safeReplacementSummary?: string;
  readonly hasExternalizedLargeContent: boolean;
  readonly hasUnresolvedError: boolean;
  readonly hasArtifactRef: boolean;
}

/**
 * Build a deterministic, prompt-friendly text block from the
 * covered message range. One turn per line, role-prefixed, with
 * any large-content replacement or artifact reference summarized
 * inline (NOT re-inlined). The serialized form is the ONLY thing
 * the model sees of the covered range; raw content, raw paths,
 * and raw tool-call internals are filtered before serialization.
 */
export function serializeCoveredRangeForSummary(messages: readonly SessionMessage[]): string {
  const projections = messages.map((message, ordinal) => serializeOne(message, ordinal));
  return projections.map(renderTurn).join('\n');
}

/**
 * Compute aggregate input-side statistics. The generator uses
 * these to populate `inputUnitEstimate` on the draft and to
 * compute `outputUnitEstimate` once parsing is done.
 *
 * The estimate is a code-point-aware approximation: every code
 * point maps to one "model unit" at unit weight. This is good
 * enough for "what to log / expose on the draft" without
 * re-implementing the project-wide TokenEstimator. If a stricter
 * estimate is needed, the generator can be reconfigured with
 * a `TokenEstimator` dep.
 */
export function estimateSerializedInputUnits(serialized: string): number {
  let count = 0;
  for (let i = 0; i < serialized.length;) {
    const codePoint = serialized.codePointAt(i)!;
    count += 1;
    i += codePoint > 0xffff ? 2 : 1;
  }
  return count;
}

function serializeOne(message: SessionMessage, ordinal: number): SerializedSummaryTurn {
  const safeContent = sanitizeForPrompt(message.content);
  const replacement = readReplacementSummary(message);
  const hasError = readHasUnresolvedError(message);
  const hasArtifact = readHasArtifactRef(message);

  return {
    ordinal,
    role: roleTag(message.role),
    content: safeContent,
    ...(replacement ? { safeReplacementSummary: replacement, hasExternalizedLargeContent: true } : { hasExternalizedLargeContent: false }),
    hasUnresolvedError: hasError,
    hasArtifactRef: hasArtifact,
  };
}

function renderTurn(turn: SerializedSummaryTurn): string {
  const lines: string[] = [];
  lines.push(`#${turn.ordinal} [${turn.role}]`);
  if (turn.hasExternalizedLargeContent) {
    lines.push(`  (large content externalized; safe summary: ${turn.safeReplacementSummary ?? '<none>'})`);
  }
  if (turn.content.length > 0) {
    lines.push(`  ${turn.content}`);
  }
  if (turn.hasUnresolvedError) {
    lines.push("  (this turn carries an unresolved error — preserve verbatim in the summary's unresolved_errors fact)");
  }
  if (turn.hasArtifactRef) {
    lines.push('  (this turn carries a tracked artifact reference — preserve the reference label in artifact_outcomes)');
  }
  return lines.join('\n');
}

function roleTag(role: SessionMessage['role']): string {
  switch (role) {
    case 'USER':
      return 'USER';
    case 'ASSISTANT':
      return 'ASSISTANT';
    case 'CAPABILITY_RESULT':
      return 'TOOL';
    case 'SUMMARY':
      return 'SUMMARY';
    default:
      return 'OTHER';
  }
}

/**
 * Strip secret-shaped substrings and absolute local paths out of the
 * message content before it enters the prompt. This is the
 * defense-in-depth layer for the summary input — the shared
 * redaction policy (add-ts-redaction-policy) is the canonical
 * boundary, but the summary generator must not depend on it for
 * the content that goes into the model prompt.
 *
 * The filters are intentionally narrow: this is not a
 * general-purpose sanitizer, it is a last-mile gate so a
 * mistakenly-persisted secret never escapes into the model's
 * context during summary.
 */
function sanitizeForPrompt(content: string): string {
  if (content.length === 0) {
    return '';
  }
  let sanitized = content;
  // Path-shaped literals (POSIX + Windows). Matches `prefix:/abs/path` or
  // `prefix:\\abs\\path` and replaces the path with a redacted token.
  sanitized = sanitized.replace(/\b(?:[A-Za-z]:\\|\/)[^\s"'<>]*[^\s"'<>.,;]/g, '[REDACTED:LOCAL_PATH]');
  // Bearer / API-key / token shapes commonly seen in tool args.
  sanitized = sanitized.replace(/\b(?:sk-[A-Za-z0-9_\-]{8,}|Bearer\s+[A-Za-z0-9_\-\.=]{8,}|password\s*=\s*[^\s,;]+)\b/gi, '[REDACTED:SECRET]');
  return sanitized;
}

function readReplacementSummary(message: SessionMessage): string | undefined {
  const metadata = message.metadata;
  const replacement = metadata['replacement'];
  if (!isPlainObject(replacement)) {
    return undefined;
  }
  const kind = typeof replacement['kind'] === 'string' ? replacement['kind'] : undefined;
  const reason = typeof replacement['reason'] === 'string' ? replacement['reason'] : undefined;
  const contentRef = replacement['contentRef'];
  const refLabel = isPlainObject(contentRef) && typeof contentRef['refId'] === 'string' ? contentRef['refId'] : undefined;
  const parts: string[] = [];
  if (kind) {
    parts.push(`kind=${kind}`);
  }
  if (reason) {
    parts.push(`reason=${reason}`);
  }
  if (refLabel) {
    parts.push(`contentRef=${refLabel}`);
  }
  return parts.length > 0 ? parts.join('; ') : 'externalized';
}

function readHasUnresolvedError(message: SessionMessage): boolean {
  const metadata = message.metadata;
  if (metadata['kind'] === 'CAPABILITY_FAILED' || metadata['kind'] === 'CAPABILITY_DEGRADED' || metadata['kind'] === 'CAPABILITY_UNAVAILABLE') {
    return true;
  }
  const safeError = metadata['safeError'];
  if (!isPlainObject(safeError)) {
    return false;
  }
  const category = safeError['category'];
  if (category === 'INTERNAL' || category === 'VALIDATION' || category === 'AUTHORIZATION') {
    return true;
  }
  return false;
}

function readHasArtifactRef(message: SessionMessage): boolean {
  const metadata = message.metadata;
  const result = metadata['capabilityResult'];
  if (!isPlainObject(result)) {
    return false;
  }
  const artifactRefs = result['artifactRefs'];
  return Array.isArray(artifactRefs) && artifactRefs.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
