import type { TurnBlock } from '../../../state/contracts.ts';
import { buildAnswerContent } from './answerContent.ts';
import { SHARE_RUN_IDS_MAX_ITEMS } from '../../../constants/inputLimits.ts';

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED']);

/**
 * Returns the runId when the turn block is eligible for share selection —
 * terminal, not failed, and carrying answer content — otherwise undefined.
 * Single source of truth shared by TurnBlock (per-item checkbox) and
 * ChatPage (select-all set).
 */
export function resolveShareableRunId(block: TurnBlock): string | undefined {
  const runId = block.aiEvents.find((e) => e.runId)?.runId;
  if (!runId) {
    return undefined;
  }
  if (!TERMINAL_RUN_STATUSES.has(block.status) || block.status === 'FAILED') {
    return undefined;
  }
  const hasStructuredAnswer = block.aiEvents.some(
    (event) => event.eventType === 'TOOL_STRUCTURED_DELTA' && (event.payload as Record<string, unknown>).toolEventType === 'ANSWER',
  );
  const hasAnswerContent = buildAnswerContent(block.aiEvents).trim().length > 0 || hasStructuredAnswer;
  return hasAnswerContent ? runId : undefined;
}

export interface ToggleShareSelectionResult {
  readonly next: Set<string>;
  readonly rejected: boolean;
}

export interface SelectAllShareableResult {
  readonly next: Set<string>;
  readonly truncated: boolean;
}

/**
 * Toggle a single runId in the share selection set. If the runId is already
 * selected, remove it (deselection is always allowed). If the runId is not
 * selected and the set is at maxItems, reject the addition.
 */
export function toggleShareSelection(
  prev: ReadonlySet<string>,
  runId: string,
  maxItems: number = SHARE_RUN_IDS_MAX_ITEMS,
): ToggleShareSelectionResult {
  if (prev.has(runId)) {
    const next = new Set(prev);
    next.delete(runId);
    return { next, rejected: false };
  }
  if (prev.size >= maxItems) {
    return { next: new Set(prev), rejected: true };
  }
  const next = new Set(prev);
  next.add(runId);
  return { next, rejected: false };
}

/**
 * Select all shareable runIds, truncating to maxItems if the selectable set
 * exceeds the limit. Returns truncated=true when truncation occurred.
 */
export function selectAllShareable(selectable: Iterable<string>, maxItems: number = SHARE_RUN_IDS_MAX_ITEMS): SelectAllShareableResult {
  const items = [...selectable];
  if (items.length > maxItems) {
    return { next: new Set(items.slice(0, maxItems)), truncated: true };
  }
  return { next: new Set(items), truncated: false };
}
