import type { MessageId } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { HistorySelectionOutcome } from '../assembly/active-context-selector.js';
import { scanCompactableCandidates, scanHistoricalRagCandidates } from './candidate-scanner.js';
import { readMicroCompactState, writeMicroCompactState, type MicroCompactState } from './state-manager.js';
import { renderCompactedPlaceholder, renderPreviousTurnRagPlaceholder, replaceCapabilityResultPayload } from './content-replacer.js';
import { MICRO_COMPACT_CONFIG } from './config.js';

/**
 * Micro-compact execution result.
 */
export interface MicroCompactResult {
  readonly newlyCompactedCount: number;
  readonly totalCompactedCount: number;
  readonly retainedCount: number;
  readonly path: 'no-op' | 'compacted';
}

/** Utility: strip readonly modifiers for in-place mutation. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Replace a single CAPABILITY_RESULT record's content with a compacted
 * placeholder if its messageId is in the compacted set. Used by both
 * the assemble stage (on in-memory records) and the render stage
 * (on fresh records loaded from the message store).
 *
 * @returns true if the record was replaced, false otherwise.
 */
export function replaceCompactableRecordContent(record: SessionMessageRecord, compactedIds: ReadonlySet<string>): boolean {
  if (!compactedIds.has(record.messageId)) {
    return false;
  }
  if (record.role !== 'CAPABILITY_RESULT') {
    return false;
  }

  let toolName = 'unknown';
  try {
    const parsed = JSON.parse(record.content) as Record<string, unknown> | undefined;
    if (typeof parsed?.toolName === 'string') {
      toolName = parsed.toolName;
    }
  } catch {
    /* not valid JSON — use "unknown" */
  }

  const placeholder =
    toolName.toLowerCase() === 'rag'
      ? renderPreviousTurnRagPlaceholder()
      : renderCompactedPlaceholder({ originalSize: record.content.length, toolName });
  const replaced = replaceCapabilityResultPayload(record.content, placeholder);
  (record as Writable<SessionMessageRecord>).content = replaced;
  return true;
}

/**
 * Micro-compact main orchestrator.
 *
 * Called after history selection and before large-content truncation.
 * Identifies old compactable tool results, replaces their content with
 * lightweight placeholders (in-place on `recordsByMessageId`), and
 * returns updated metadata carrying the new compacted-id set.
 *
 * Single execution path: in-memory replacement only. Provider-side
 * cache protection is deferred to a future change.
 *
 * @param params.outcome  - history selection output
 * @param params.metadata - ActiveContextViewRecord.metadata
 * @returns evidence + updated metadata
 */
export function microcompactHistory(params: { readonly outcome: HistorySelectionOutcome; readonly metadata?: Record<string, unknown> | undefined }): {
  readonly evidence: MicroCompactResult;
  readonly updatedMetadata: Record<string, unknown>;
} {
  const { outcome, metadata } = params;
  const compactedIdSet = new Set(readMicroCompactState(metadata).compactedIds);
  const ragCandidates = scanHistoricalRagCandidates(outcome.priorTurnCandidates, outcome.recordsByMessageId);

  // 1. Scan all compactable candidates from prior turns
  const allCandidates = scanCompactableCandidates(outcome.priorTurnCandidates, outcome.recordsByMessageId);

  const totalCompactable = allCandidates.length;

  // 2. Sort generic candidates by appearance order (oldest first)
  const sortedByOrder = [...allCandidates].sort((a, b) => a.orderIndex - b.orderIndex);

  // 3. Keep the most recent generic results only when the generic threshold is exceeded.
  const genericThresholdExceeded = totalCompactable > MICRO_COMPACT_CONFIG.triggerThreshold;
  const keepCount = genericThresholdExceeded ? Math.min(MICRO_COMPACT_CONFIG.keepRecent, sortedByOrder.length) : totalCompactable;
  const genericToCompact = genericThresholdExceeded ? sortedByOrder.slice(0, sortedByOrder.length - keepCount) : [];

  // 4. Replay persisted decisions before selecting newly compacted records.
  let replacementCount = 0;
  for (const messageId of outcome.priorTurnCandidates) {
    const record = outcome.recordsByMessageId.get(messageId);
    if (record !== undefined) {
      replacementCount += replaceCompactableRecordContent(record, compactedIdSet) ? 1 : 0;
    }
  }

  // 5. Every historical Rag result is compacted; generic tools keep their existing policy.
  const newlyCompactedIds: string[] = [];
  for (const candidate of [...ragCandidates, ...genericToCompact]) {
    if (compactedIdSet.has(candidate.messageId)) {
      continue;
    }

    const record = outcome.recordsByMessageId.get(candidate.messageId);
    if (record !== undefined) {
      replacementCount += replaceCompactableRecordContent(record, new Set([candidate.messageId])) ? 1 : 0;
    }

    compactedIdSet.add(candidate.messageId);
    newlyCompactedIds.push(candidate.messageId);
  }

  // 6. Build updated state
  const updatedMetadata =
    newlyCompactedIds.length === 0
      ? (metadata ?? {})
      : writeMicroCompactState(metadata ?? {}, { compactedIds: [...compactedIdSet] } satisfies MicroCompactState);

  return {
    evidence: {
      newlyCompactedCount: newlyCompactedIds.length,
      totalCompactedCount: compactedIdSet.size,
      retainedCount: keepCount,
      path: replacementCount > 0 ? 'compacted' : 'no-op',
    },
    updatedMetadata,
  };
}
