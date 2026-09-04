import { describe, expect, it } from 'vitest';
import { brand, type MessageId } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import { scanCompactableCandidates, scanHistoricalRagCandidates } from '../src/micro-compact/candidate-scanner.js';

const TENANT = brand<string, 'TenantId'>('tenant-test');
const SUBJECT = brand<string, 'SubjectId'>('subject-test');
const AGENT = brand<string, 'AgentId'>('agent-test');
const SESSION = brand<string, 'SessionId'>('session-test');
const REQUEST = brand<string, 'MessageId'>('req-test');

function msgId(id: string): MessageId {
  return brand<string, 'MessageId'>(id);
}

function capabilityResult(id: string, toolName: string, payload: string = 'some output'): SessionMessageRecord {
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

function userMessage(id: string): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(id),
    sessionId: SESSION,
    requestId: REQUEST,
    role: 'USER',
    content: 'user message',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function assistantMessage(id: string): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(id),
    sessionId: SESSION,
    requestId: REQUEST,
    role: 'ASSISTANT',
    content: 'assistant response',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

describe('scanCompactableCandidates', () => {
  it('identifies all 6 whitelisted tools', () => {
    const tools = ['bash', 'read', 'grep', 'glob', 'write', 'python'];
    const records = new Map<MessageId, SessionMessageRecord>();
    const ids: MessageId[] = [];
    for (let i = 0; i < tools.length; i++) {
      const id = `msg-${i}`;
      ids.push(msgId(id));
      records.set(msgId(id), capabilityResult(id, tools[i]!));
    }

    const result = scanCompactableCandidates(ids, records);
    expect(result).toHaveLength(6);
    for (let i = 0; i < tools.length; i++) {
      expect(result[i]!.toolName).toBe(tools[i]);
      expect(result[i]!.orderIndex).toBe(i);
    }
  });

  it('excludes non-whitelisted tools (MCP custom tool)', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const ids = [msgId('mcp-1')];
    records.set(msgId('mcp-1'), capabilityResult('mcp-1', 'mcp__custom__queryDb'));

    const result = scanCompactableCandidates(ids, records);
    expect(result).toHaveLength(0);
  });

  it('excludes Agent orchestration tools', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const ids = [msgId('agent-1')];
    records.set(msgId('agent-1'), capabilityResult('agent-1', 'Agent'));

    const result = scanCompactableCandidates(ids, records);
    expect(result).toHaveLength(0);
  });

  it('does not scan non-CAPABILITY_RESULT roles', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const ids = [msgId('user-1'), msgId('asst-1')];
    records.set(msgId('user-1'), userMessage('user-1'));
    records.set(msgId('asst-1'), assistantMessage('asst-1'));

    const result = scanCompactableCandidates(ids, records);
    expect(result).toHaveLength(0);
  });

  it('does not scan non-JSON content', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const id = msgId('bad-json');
    records.set(id, {
      ...capabilityResult('bad-json', 'bash'),
      content: 'not json at all',
    });

    const result = scanCompactableCandidates([id], records);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty priorTurnCandidates', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const result = scanCompactableCandidates([], records);
    expect(result).toEqual([]);
  });

  it('skips records not found in recordsByMessageId', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const ids = [msgId('missing')];
    // records is empty — "missing" is not in the map

    const result = scanCompactableCandidates(ids, records);
    expect(result).toHaveLength(0);
  });

  it('records originalContentSize from content.length', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const id = msgId('size-test');
    const record = capabilityResult('size-test', 'bash', 'x'.repeat(500));
    records.set(id, record);

    const result = scanCompactableCandidates([id], records);
    expect(result).toHaveLength(1);
    expect(result[0]!.originalContentSize).toBe(record.content.length);
  });
});

describe('scanHistoricalRagCandidates', () => {
  it('selects Rag results across every completed history request', () => {
    const records = new Map<MessageId, SessionMessageRecord>();
    const first = { ...capabilityResult('rag-1', 'Rag'), requestId: msgId('req-1') };
    const second = { ...capabilityResult('rag-2', 'rag'), requestId: msgId('req-2') };
    const nonRag = { ...capabilityResult('read-1', 'read'), requestId: msgId('req-1') };
    for (const record of [first, nonRag, second]) {
      records.set(record.messageId, record);
    }

    expect(scanHistoricalRagCandidates([first.messageId, nonRag.messageId, second.messageId], records).map((item) => item.messageId)).toEqual([
      first.messageId,
      second.messageId,
    ]);
  });
});
