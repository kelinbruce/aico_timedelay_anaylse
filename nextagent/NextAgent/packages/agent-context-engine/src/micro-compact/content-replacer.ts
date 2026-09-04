/**
 * Micro-compact content replacement.
 *
 * Generates deterministic XML placeholders for compacted tool results
 * and replaces the payload inside CAPABILITY_RESULT JSON records while
 * preserving the structural fields (toolCallId / toolName).
 */

/**
 * Render a deterministic placeholder for a compacted tool result.
 *
 * The placeholder is deterministic (same input → same output) for cache
 * stability. It carries the original size and tool name so the model
 * knows what was compacted and how large it was.
 */
export function renderCompactedPlaceholder(params: { readonly originalSize: number; readonly toolName: string }): string {
  return [
    '<compacted-tool-result>',
    `Original size: ${params.originalSize} chars`,
    `Tool: ${params.toolName}`,
    'This result was compacted to save context budget.',
    'The original content can be re-obtained by re-invoking the tool if needed.',
    '</compacted-tool-result>',
  ].join('\n');
}

/** Bounded marker for Rag payloads whose completed turn is now historical. */
export function renderPreviousTurnRagPlaceholder(): string {
  return [
    '<compacted-rag-result>',
    'This retrieval payload belonged to a completed history turn and was removed from model-visible history.',
    'Re-obtain evidence for the current question by re-invoking Rag if needed.',
    '</compacted-rag-result>',
  ].join('\n');
}

/**
 * Replace the payload of a CAPABILITY_RESULT record with a placeholder.
 *
 * Preserves the JSON structure (`toolCallId`, `toolName`) and replaces
 * only the `payload` field. When the content is not valid JSON or does
 * not carry a `toolCallId`, falls back to full-content replacement.
 */
export function replaceCapabilityResultPayload(rawContent: string, placeholder: string): string {
  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.toolCallId === 'string') {
      parsed.payload = { compacted: placeholder };
      return JSON.stringify(parsed);
    }
  } catch {
    // not valid JSON — fall through to full replacement
  }
  return placeholder;
}
