import type { MessageId } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import { COMPACTABLE_TOOL_NAMES } from './config.js';

/**
 * A compactable tool-result candidate identified from prior-turn history.
 */
export interface CompactableCandidate {
  readonly messageId: MessageId;
  readonly toolName: string;
  readonly originalContentSize: number;
  /** Position in `priorTurnCandidates` (0-based). Used for age ordering. */
  readonly orderIndex: number;
}

/**
 * Scan `priorTurnCandidates` and return every CAPABILITY_RESULT record
 * whose toolName is in the compactable whitelist.
 *
 * Pure function: reads `recordsByMessageId` but never mutates it.
 * Current-request records are intentionally excluded — the current
 * request's tool results are never compacted.
 */
export function scanCompactableCandidates(
  priorTurnCandidates: readonly MessageId[],
  recordsByMessageId: ReadonlyMap<MessageId, SessionMessageRecord>,
): CompactableCandidate[] {
  const candidates: CompactableCandidate[] = [];

  for (let i = 0; i < priorTurnCandidates.length; i++) {
    const messageId = priorTurnCandidates[i]!;
    const record = recordsByMessageId.get(messageId);
    if (record === undefined) {
      continue;
    }
    if (record.role !== 'CAPABILITY_RESULT') {
      continue;
    }

    const toolName = extractToolName(record.content);
    if (toolName === undefined) {
      continue;
    }
    if (!COMPACTABLE_TOOL_NAMES.has(toolName.toLowerCase())) {
      continue;
    }

    candidates.push({
      messageId,
      toolName,
      originalContentSize: record.content.length,
      orderIndex: i,
    });
  }

  return candidates;
}

/** Select every Rag result from canonical completed history turns. */
export function scanHistoricalRagCandidates(
  priorTurnCandidates: readonly MessageId[],
  recordsByMessageId: ReadonlyMap<MessageId, SessionMessageRecord>,
): CompactableCandidate[] {
  const candidates: CompactableCandidate[] = [];
  for (let i = 0; i < priorTurnCandidates.length; i += 1) {
    const messageId = priorTurnCandidates[i]!;
    const record = recordsByMessageId.get(messageId);
    if (record?.role !== 'CAPABILITY_RESULT') {
      continue;
    }

    const toolName = extractToolName(record.content);
    if (toolName?.toLowerCase() !== 'rag') {
      continue;
    }
    candidates.push({
      messageId,
      toolName,
      originalContentSize: record.content.length,
      orderIndex: i,
    });
  }
  return candidates;
}

/**
 * Extract the `toolName` field from a CAPABILITY_RESULT JSON content.
 * Returns undefined when the content is not valid JSON or does not
 * carry a string `toolName`.
 */
function extractToolName(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.toolName === 'string') {
      return parsed.toolName;
    }
  } catch {
    // not valid JSON — not a capability result we can parse
  }
  return undefined;
}
