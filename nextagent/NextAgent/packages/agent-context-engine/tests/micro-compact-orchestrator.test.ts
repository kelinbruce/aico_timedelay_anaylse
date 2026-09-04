import { describe, expect, it } from 'vitest';
import { brand, type MessageId } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { HistorySelectionOutcome } from '../src/assembly/active-context-selector.js';
import { microcompactHistory } from '../src/micro-compact/micro-compact.js';

const TENANT = brand<string, 'TenantId'>('tenant-mc');
const SUBJECT = brand<string, 'SubjectId'>('subject-mc');
const AGENT = brand<string, 'AgentId'>('agent-mc');
const SESSION = brand<string, 'SessionId'>('session-mc');
const REQUEST = brand<string, 'MessageId'>('req-mc');

function msgId(id: string): MessageId {
  return brand<string, 'MessageId'>(id);
}

function capabilityResult(id: string, toolName: string, payloadSize: number = 100): SessionMessageRecord {
  const payload = 'x'.repeat(payloadSize);
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(id),
    sessionId: SESSION,
    requestId: REQUEST,
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId: `tc-${id}`, toolName, payload }),
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeOutcome(records: SessionMessageRecord[], priorIds?: MessageId[]): HistorySelectionOutcome {
  const recordsByMessageId = new Map<MessageId, SessionMessageRecord>();
  for (const r of records) {
    recordsByMessageId.set(r.messageId, r);
  }
  return {
    currentRequestRecords: [],
    priorTurnCandidates: priorIds ?? records.map((r) => r.messageId),
    recordsByMessageId,
    excludedTurnCount: 0,
    activeContextVersion: 1,
  };
}

describe('microcompactHistory', () => {
  it('compacts all historical Rag results without the generic threshold', () => {
    const first = { ...capabilityResult('rag-1', 'Rag'), requestId: msgId('req-1') };
    const second = { ...capabilityResult('rag-2', 'Rag'), requestId: msgId('req-2') };
    const result = microcompactHistory({ outcome: makeOutcome([first, second]), metadata: undefined });

    expect(result.evidence.newlyCompactedCount).toBe(2);
    expect(first.content).toContain('compacted-rag-result');
    expect(second.content).toContain('compacted-rag-result');
  });

  it('returns no-op when candidates are at or below threshold (10)', () => {
    const records = Array.from({ length: 10 }, (_, i) => capabilityResult(`msg-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    expect(result.evidence.path).toBe('no-op');
    expect(result.evidence.newlyCompactedCount).toBe(0);
    expect(result.evidence.retainedCount).toBe(10);
  });

  it('returns no-op for empty candidates', () => {
    const outcome = makeOutcome([]);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    expect(result.evidence.path).toBe('no-op');
    expect(result.evidence.newlyCompactedCount).toBe(0);
    expect(result.evidence.retainedCount).toBe(0);
  });

  it('compacts oldest and retains 5 when 11 candidates', () => {
    const records = Array.from({ length: 11 }, (_, i) => capabilityResult(`msg-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    expect(result.evidence.path).toBe('compacted');
    expect(result.evidence.newlyCompactedCount).toBe(6); // 11 - 5
    expect(result.evidence.retainedCount).toBe(5);
    expect(result.evidence.totalCompactedCount).toBe(6);

    // Verify the 6 oldest were replaced
    for (let i = 0; i < 6; i++) {
      const record = outcome.recordsByMessageId.get(msgId(`msg-${i}`))!;
      expect(record.content).toContain('compacted');
    }
    // Verify the 5 most recent are untouched
    for (let i = 6; i < 11; i++) {
      const record = outcome.recordsByMessageId.get(msgId(`msg-${i}`))!;
      expect(record.content).not.toContain('compacted');
    }
  });

  it('compacts 10 and retains 5 when 15 candidates', () => {
    const records = Array.from({ length: 15 }, (_, i) => capabilityResult(`msg-${i}`, 'read'));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    expect(result.evidence.newlyCompactedCount).toBe(10);
    expect(result.evidence.retainedCount).toBe(5);
  });

  it('is idempotent — already-compacted IDs are not re-processed', () => {
    const records = Array.from({ length: 15 }, (_, i) => capabilityResult(`msg-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    // First pass
    const first = microcompactHistory({
      outcome,
      metadata: undefined,
    });
    expect(first.evidence.newlyCompactedCount).toBe(10);

    // Second pass with updated metadata (simulating next assemble call)
    const second = microcompactHistory({
      outcome,
      metadata: first.updatedMetadata,
    });

    expect(second.evidence.newlyCompactedCount).toBe(0);
    expect(second.evidence.totalCompactedCount).toBe(10);
  });

  it('emits compacted path when compaction runs', () => {
    const records = Array.from({ length: 12 }, (_, i) => capabilityResult(`msg-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    expect(result.evidence.path).toBe('compacted');
  });

  it('updates metadata with compacted IDs', () => {
    const records = Array.from({ length: 12 }, (_, i) => capabilityResult(`msg-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: { existingField: true },
    });

    expect(result.updatedMetadata).toHaveProperty('existingField', true);
    expect(result.updatedMetadata).toHaveProperty('microCompactState');
    const state = result.updatedMetadata.microCompactState as { compactedIds: string[] };
    expect(state.compactedIds).toHaveLength(7); // 12 - 5
  });

  it('does not trigger when all candidates are already compacted', () => {
    const records = Array.from({ length: 15 }, (_, i) => capabilityResult(`msg-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    // Pre-populate metadata with all IDs already compacted
    const allIds = records.map((r) => r.messageId);
    const metadata = {
      microCompactState: { compactedIds: allIds },
    };

    const result = microcompactHistory({
      outcome,
      metadata,
    });

    // 15 candidates > threshold 10, but all already compacted
    // The function still enters the compaction path but newlyCompactedCount = 0
    expect(result.evidence.newlyCompactedCount).toBe(0);
  });

  it('only scans whitelisted tools — non-whitelisted are invisible', () => {
    const records = [
      capabilityResult('bash-1', 'bash'),
      capabilityResult('mcp-1', 'mcp__custom__tool'),
      capabilityResult('agent-1', 'Agent'),
      capabilityResult('bash-2', 'bash'),
    ];
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    // Only 2 compactable candidates (Bash), below threshold
    expect(result.evidence.path).toBe('no-op');
    expect(result.evidence.retainedCount).toBe(2);
  });
});
