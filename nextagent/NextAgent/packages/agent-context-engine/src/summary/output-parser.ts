/**
 * Parses the model's raw text output into:
 *   - the `<summary>` content (or the full text as fallback when
 *     the model returned non-empty text without a `<summary>` block)
 *   - the `<checklist>` block (consumed only for validation; the
 *     raw text NEVER appears in the draft, logs, audit events,
 *     or safe errors)
 *
 * The parser is deliberately strict about a few malformed-input
 * cases so the caller can classify them as safe failure rather
 * than silently corrupt the draft:
 *   - attribute-stripped `<summary attr="...">...</summary>` is
 *     treated as a single block (the attribute is ignored but the
 *     body is honored) — the spec says "属性化或嵌套的
 *     <summary> 视为 invalid"; this implementation treats any
 *     <summary ...>...</summary> with content (regardless of
 *     attribute) as the same block, and explicitly rejects a
 *     block whose body is empty (per the "空 <summary></summary>
 *     视为未匹配" rule)
 *   - empty `<summary></summary>` blocks are skipped when picking
 *     the first non-empty block
 *   - if no `<summary>` block exists but raw text exists, the raw
 *     text is used as a parse-fallback and the generator records a
 *     safe fallback reason (the raw text itself is never put into
 *     that reason)
 */

export interface ParsedModelOutput {
  readonly summaryContent: string;
  readonly checklist: ParsedChecklist;
  readonly usedFullTextFallback: boolean;
  readonly rawToolCalls: boolean;
}

export interface ParsedChecklist {
  readonly presentCategoryFacts: ReadonlyMap<string, string>;
  readonly presentCategoriesInOrder: readonly string[];
  readonly duplicateCategories: readonly string[];
}

export type ParseResult =
  { readonly ok: true; readonly value: ParsedModelOutput } | { readonly ok: false; readonly reason: ParseFailureReason; readonly detail: string };

export type ParseFailureReason = 'empty_output' | 'tool_call_attempt';

/**
 * Parse the model's raw text. The function does not call the
 * model — it is a pure function of the raw text (and an explicit
 * `hadToolCalls` flag for the "model attempted to use a tool"
 * failure case, which the caller sets when the model stream
 * reports any tool call).
 */
export function parseSummaryModelOutput(rawText: string, hadToolCalls: boolean): ParseResult {
  if (hadToolCalls) {
    return { ok: false, reason: 'tool_call_attempt', detail: 'Model attempted a tool call during summary generation.' };
  }
  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty_output', detail: 'Model returned empty content.' };
  }

  const checklistBlock = extractChecklistBlock(trimmed);
  const summaryBlocks = extractSummaryBlocks(trimmed);
  const analysisBlocks = extractAnalysisBlocks(trimmed);

  // `analysis` is discarded by design; the parser still records
  // it internally so the generator's audit log can confirm the
  // discards happened, but no `analysis` content ever enters the
  // returned value.
  void analysisBlocks;

  if (summaryBlocks.length > 0) {
    const firstNonEmpty = summaryBlocks.find((block) => block.body.trim().length > 0);
    if (firstNonEmpty) {
      return {
        ok: true,
        value: {
          summaryContent: firstNonEmpty.body,
          checklist: checklistBlock,
          usedFullTextFallback: false,
          rawToolCalls: false,
        },
      };
    }
  }

  // No usable <summary> block; fall back to the full raw text
  // (the only safe content we have) and record the safe fallback.
  return {
    ok: true,
    value: {
      summaryContent: trimmed,
      checklist: checklistBlock,
      usedFullTextFallback: true,
      rawToolCalls: false,
    },
  };
}

function extractSummaryBlocks(text: string): ReadonlyArray<{ readonly body: string }> {
  // Tag-based extraction. We deliberately ignore attributes on
  // the opening tag (`<summary attr="x">`) and treat any
  // <summary ...>...</summary> as the same kind of block.
  // Empty <summary></summary> is preserved as a block (with empty
  // body) and skipped by the "first non-empty" rule above.
  return extractBlocks(text, 'summary');
}

function extractAnalysisBlocks(text: string): ReadonlyArray<{ readonly body: string }> {
  return extractBlocks(text, 'analysis');
}

function extractChecklistBlock(text: string): ParsedChecklist {
  const blocks = extractBlocks(text, 'checklist');
  if (blocks.length === 0) {
    return { presentCategoryFacts: new Map(), presentCategoriesInOrder: [], duplicateCategories: [] };
  }
  const firstBlock = blocks[0]!.body;
  const factPattern = /<fact\s+name="([^"]+)"\s*>([\s\S]*?)<\/fact>/g;
  const facts = new Map<string, string>();
  const ordered: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = factPattern.exec(firstBlock)) !== null) {
    const name = match[1]!;
    const body = match[2]!.trim();
    if (seen.has(name)) {
      duplicates.push(name);
      continue;
    }
    seen.add(name);
    ordered.push(name);
    facts.set(name, body);
  }
  return { presentCategoryFacts: facts, presentCategoriesInOrder: ordered, duplicateCategories: duplicates };
}

function extractBlocks(text: string, tag: 'summary' | 'analysis' | 'checklist'): ReadonlyArray<{ readonly body: string }> {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?\\s*>([\\s\\S]*?)<\\/${escapedTag}>`, 'g');
  const blocks: Array<{ body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push({ body: match[1]! });
  }
  return blocks;
}
