import type { MessageId } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import type { HistorySelectionOutcome } from './active-context-selector.js';

/**
 * SessionMessage ↔ SessionMessageRecord projection (extracted from
 * assemble-context.ts and summary-compression-orchestrator.ts).
 *
 * The gateway-layer `SessionMessageRecord` carries tenant/subject/agent
 * ownership fields that the domain-layer `SessionMessage` does not.
 * These projections strip (forward) or add (reverse) those fields.
 * All projection logic is centralized here so field additions or
 * removals only need to be made in one place.
 */

/**
 * Project a gateway `SessionMessageRecord` to a domain `SessionMessage`
 * by stripping owner-scoped fields (tenantId, subjectId, agentId) and
 * setting `sequence` to 0 (the domain model does not track ordering at
 * this level; the message store is the source of truth for sequence).
 */
export function projectRecordToSessionMessage(record: SessionMessageRecord): SessionMessage {
  return {
    messageId: record.messageId,
    sessionId: record.sessionId,
    requestId: record.requestId,
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    role: record.role,
    content: record.content,
    contentType: record.contentType,
    metadata: record.metadata,
    sequence: 0,
    visible: record.visible,
    createdAt: record.createdAt,
  };
}

/**
 * Project multiple records from a `HistorySelectionOutcome`'s
 * `recordsByMessageId` map, preserving the order of the given
 * `messageIds`. Records not found in the map are silently skipped.
 */
export function projectRecordsByIds(outcome: HistorySelectionOutcome, messageIds: readonly MessageId[]): readonly SessionMessage[] {
  const out: SessionMessage[] = [];
  for (const messageId of messageIds) {
    const record = outcome.recordsByMessageId.get(messageId);
    if (record === undefined) {
      continue;
    }
    out.push(projectRecordToSessionMessage(record));
  }
  return out;
}
