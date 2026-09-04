import { describe, expect, it } from 'vitest';
import { brand, type MessageId } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { HistorySelectionOutcome } from '../src/assembly/active-context-selector.js';
import { microcompactHistory, replaceCompactableRecordContent } from '../src/micro-compact/micro-compact.js';
import { readMicroCompactState } from '../src/micro-compact/state-manager.js';
import { COMPACTABLE_TOOL_NAMES } from '../src/micro-compact/config.js';

const TENANT = brand<string, 'TenantId'>('tenant-int');
const SUBJECT = brand<string, 'SubjectId'>('subject-int');
const AGENT = brand<string, 'AgentId'>('agent-int');
const SESSION = brand<string, 'SessionId'>('session-int');
const REQUEST = brand<string, 'MessageId'>('req-int');

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

function makeOutcome(records: SessionMessageRecord[]): HistorySelectionOutcome {
  const recordsByMessageId = new Map<MessageId, SessionMessageRecord>();
  for (const r of records) {
    recordsByMessageId.set(r.messageId, r);
  }
  return {
    currentRequestRecords: [],
    priorTurnCandidates: records.map((r) => r.messageId),
    recordsByMessageId,
    excludedTurnCount: 0,
    activeContextVersion: 1,
  };
}

describe('micro-compact + budget gate integration', () => {
  it('reduces total content size before budget gate sees it', () => {
    // 12 Bash results of ~500 chars each
    const records = Array.from({ length: 12 }, (_, i) => capabilityResult(`budget-${i}`, 'bash', 500));
    const outcome = makeOutcome(records);

    // Measure total content size before
    const sizeBefore = Array.from(outcome.recordsByMessageId.values()).reduce((sum, r) => sum + r.content.length, 0);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    // Measure total content size after
    const sizeAfter = Array.from(outcome.recordsByMessageId.values()).reduce((sum, r) => sum + r.content.length, 0);

    expect(result.evidence.path).toBe('compacted');
    expect(result.evidence.newlyCompactedCount).toBe(7); // 12 - 5
    // Content should be smaller after compaction
    expect(sizeAfter).toBeLessThan(sizeBefore);
  });
});

describe('micro-compact + large-content truncation integration', () => {
  it('micro-compact runs first, large-content handles the rest', () => {
    // 12 whitelisted results, 3 of which are >8KB
    const records: SessionMessageRecord[] = [];
    for (let i = 0; i < 12; i++) {
      const size = i < 3 ? 10000 : 200; // first 3 are large
      records.push(capabilityResult(`lc-${i}`, 'bash', size));
    }
    const outcome = makeOutcome(records);

    // Run micro-compact first
    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    expect(result.evidence.newlyCompactedCount).toBe(7); // 12 - 5

    // The first 7 (oldest) are compacted, including the 3 large ones.
    // After micro-compact, the 3 large results have been replaced with
    // small placeholders, so large-content truncation has less to do.
    for (let i = 0; i < 7; i++) {
      const record = outcome.recordsByMessageId.get(msgId(`lc-${i}`))!;
      expect(record.content).toContain('compacted');
      expect(record.content.length).toBeLessThan(500); // placeholder is small
    }
  });
});

describe('micro-compact + summary compression coordination', () => {
  it('state is naturally cleared when active context is replaced', () => {
    // Simulate: after micro-compact runs and updates metadata,
    // summary compression replaces the active context.
    // The new active context does NOT carry microCompactState.

    const records = Array.from({ length: 12 }, (_, i) => capabilityResult(`comp-${i}`, 'bash'));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({
      outcome,
      metadata: undefined,
    });

    // The updated metadata has microCompactState
    expect(result.updatedMetadata).toHaveProperty('microCompactState');

    // After commitCompaction, the new ActiveContextView has no metadata
    // (or empty metadata). The next assemble() reads from the new view.
    const newActiveMetadata = {}; // fresh view, no microCompactState
    const state = readMicroCompactState(newActiveMetadata);
    expect(state.compactedIds).toEqual([]);

    // Next assemble scan would start fresh
    const nextOutcome = makeOutcome(records.slice(-5)); // only retained tail
    const nextResult = microcompactHistory({
      outcome: nextOutcome,
      metadata: newActiveMetadata,
    });
    expect(nextResult.evidence.path).toBe('no-op'); // 5 candidates, below threshold
  });
});

describe('render stage re-apply', () => {
  it('re-applies replacement for compacted messageIds on fresh SessionMessageRecords', () => {
    const records = Array.from({ length: 12 }, (_, i) => capabilityResult(`render-${i}`, 'bash', 300));
    const outcome = makeOutcome(records);

    const result = microcompactHistory({ outcome, metadata: undefined });
    const compactedIds = new Set(readMicroCompactState(result.updatedMetadata).compactedIds);

    // Render phase: fresh records from store (original content)
    const freshRecords = records.map((r) => ({ ...r }));
    let replacedCount = 0;
    for (const record of freshRecords) {
      if (replaceCompactableRecordContent(record, compactedIds)) {
        replacedCount++;
      }
    }
    expect(replacedCount).toBe(7);

    for (const record of freshRecords) {
      if (compactedIds.has(record.messageId)) {
        expect(record.content).toContain('compacted');
      } else {
        expect(record.content).not.toContain('<compacted-tool-result>');
      }
    }
  });

  it('skips records not in compactedIds or non-CAPABILITY_RESULT', () => {
    const compactedIds = new Set(['msg-1']);
    const userRecord: SessionMessageRecord = {
      ...capabilityResult('msg-2', 'bash'),
      messageId: brand<string, 'MessageId'>('msg-2'),
      role: 'USER',
      content: 'user text',
    };
    const notCompacted = capabilityResult('msg-3', 'bash');

    expect(replaceCompactableRecordContent(userRecord, compactedIds)).toBe(false);
    expect(replaceCompactableRecordContent(notCompacted, compactedIds)).toBe(false);
    expect(userRecord.content).toBe('user text');
  });
});

describe('architecture boundary: micro-compact module isolation', () => {
  it('exports only the public API', async () => {
    const module = await import('../src/micro-compact/index.js');
    expect(module).toHaveProperty('COMPACTABLE_TOOL_NAMES');
    expect(module).toHaveProperty('MICRO_COMPACT_CONFIG');
    expect(module).toHaveProperty('readMicroCompactState');
    expect(module).toHaveProperty('microcompactHistory');
    expect(module).toHaveProperty('replaceCompactableRecordContent');
    // Internal functions NOT exported
    expect(module).not.toHaveProperty('writeMicroCompactState');
    expect(module).not.toHaveProperty('clearMicroCompactState');
    expect(module).not.toHaveProperty('EMPTY_MICRO_COMPACT_STATE');
    expect(module).not.toHaveProperty('renderCompactedPlaceholder');
    expect(module).not.toHaveProperty('replaceCapabilityResultPayload');
    expect(module).not.toHaveProperty('applyMicroCompactReplacementAtRender');
    expect(module).not.toHaveProperty('scanCompactableCandidates');
  });

  it('COMPACTABLE_TOOL_NAMES contains exactly 6 tools', () => {
    expect(COMPACTABLE_TOOL_NAMES.size).toBe(6);
    expect(COMPACTABLE_TOOL_NAMES.has('bash')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('read')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('grep')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('glob')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('write')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('python')).toBe(true);
    // Non-whitelisted
    expect(COMPACTABLE_TOOL_NAMES.has('Agent')).toBe(false);
  });
});
