/**
 * Built-in `compact-summary/v1` prompt template.
 *
 * Spec anchor: add-ts-traceable-summary-generation design D4 / black-box
 * goal "通过 by-purpose prompt template resolver 以 purpose = SUMMARY_GENERATION
 * 解析摘要 prompt (resolver 契约由 add-ts-context-prompt-shaping 拥有,
 * 本 change 消费), 内置 compact-summary/v1 作为 built-in fallback".
 *
 * The system prompt for this invocation is selected through
 * purpose-scoped prompt template assembly. This helper only owns the
 * deterministic user prompt that carries the serialized covered range.
 *
 * The template instructs the model to emit THREE structured blocks:
 *   1. `<analysis>` — discarded; never enters the draft
 *   2. `<summary>` — the model-visible continuation-critical content
 *   3. `<checklist>` — one `<fact name="<category>">body</fact>` per
 *      continuation-critical category that the covered range contains
 *      (validated against the generator's pre-classification, never
 *      shown to the model)
 *
 * The generator consumes the `<checklist>` block to enforce
 * continuation-critical fact preservation; raw checklist text is
 * never returned to the caller, logged, audited, or surfaced in
 * safe errors.
 */

export const COMPACT_SUMMARY_TEMPLATE_VERSION = 'compact-summary/v1';

/**
 * User-prompt builder. The covered messages are passed in as a
 * pre-serialized, deterministic text block (see
 * `summary-input-serializer.ts`). The user prompt is the
 * deterministic boundary between the in-memory message array and
 * the model's text input — it MUST NOT carry raw secrets, raw
 * local paths, raw tool-call internals, or externalized large
 * payload bodies.
 */
export function buildCompactSummaryUserPrompt(serializedCoveredRange: string, targetBudgetUnits: number): string {
  return [
    'Target output budget (model units, advisory): ' + Math.max(0, Math.floor(targetBudgetUnits)),
    '',
    'Covered older turns (in order, role-tagged). Do NOT cite this verbatim into the <summary>; the <summary> is your re-narration.',
    '',
    serializedCoveredRange,
    '',
    'Emit the three blocks now: <analysis>...</analysis>, then <summary>...</summary>, then <checklist>...</checklist>.',
  ].join('\n');
}
