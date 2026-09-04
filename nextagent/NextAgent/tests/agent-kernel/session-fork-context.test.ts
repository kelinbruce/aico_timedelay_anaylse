import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { ForkActiveContextMessage } from '@nextagent/agent-contracts/context';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-fork-context');
const subjectId = brand<string, 'SubjectId'>('subject-fork-context');
const agentId = brand<string, 'AgentId'>('agent-fork-context');
const childSessionId = brand<string, 'SessionId'>('child-context');

function at(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}

function message(overrides: Partial<ForkActiveContextMessage> = {}): ForkActiveContextMessage {
  return {
    tenantId,
    subjectId,
    agentId,
    sessionId: childSessionId,
    messageId: brand<string, 'MessageId'>('child-u1'),
    requestId: brand<string, 'MessageId'>('child-u1'),
    role: 'USER',
    content: 'hello',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: at(1),
    ...overrides,
  };
}

describe('fork active context selector', () => {
  it('selects only copied child message ids through the child anchor', async () => {
    const selector = createForkActiveContextSelector();
    const copied = [
      message({ messageId: brand<string, 'MessageId'>('child-u1'), requestId: brand<string, 'MessageId'>('child-u1'), createdAt: at(1) }),
      message({
        messageId: brand<string, 'MessageId'>('child-a1'),
        requestId: brand<string, 'MessageId'>('child-u1'),
        role: 'ASSISTANT',
        content: 'answer',
        createdAt: at(2),
      }),
    ];

    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('child-a1'),
        copiedMessages: copied,
      }),
    ).resolves.toEqual({ messageIds: ['child-u1', 'child-a1'] });
  });

  it('rejects mixed child sessions, duplicate ids and records after anchor', async () => {
    const selector = createForkActiveContextSelector();
    const base = [
      message({ messageId: brand<string, 'MessageId'>('child-u1'), requestId: brand<string, 'MessageId'>('child-u1'), createdAt: at(1) }),
      message({
        messageId: brand<string, 'MessageId'>('child-a1'),
        requestId: brand<string, 'MessageId'>('child-u1'),
        role: 'ASSISTANT',
        content: 'answer',
        createdAt: at(2),
      }),
    ];

    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('child-a1'),
        copiedMessages: [
          ...base,
          message({ messageId: brand<string, 'MessageId'>('child-u2'), requestId: brand<string, 'MessageId'>('child-u2'), createdAt: at(3) }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'FORK_CONTEXT_RECORD_AFTER_ANCHOR' });
    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('child-a1'),
        copiedMessages: [base[0]!, { ...base[1]!, sessionId: brand<string, 'SessionId'>('other-child') }],
      }),
    ).rejects.toMatchObject({ code: 'FORK_CONTEXT_MIXED_CHILD_SESSIONS' });
    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('child-u1'),
        copiedMessages: [base[0]!, { ...base[0]!, createdAt: at(2) }],
      }),
    ).rejects.toMatchObject({ code: 'FORK_CONTEXT_DUPLICATE_MESSAGE_ID' });
    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('missing-anchor'),
        copiedMessages: base,
      }),
    ).rejects.toMatchObject({ code: 'FORK_CONTEXT_ANCHOR_NOT_COPIED' });
  });

  it('keeps child summary messages and drops covered original refs', async () => {
    const selector = createForkActiveContextSelector();
    const copied = [
      message({ messageId: brand<string, 'MessageId'>('covered-u1'), requestId: brand<string, 'MessageId'>('covered-u1'), createdAt: at(1) }),
      message({
        messageId: brand<string, 'MessageId'>('covered-a1'),
        requestId: brand<string, 'MessageId'>('covered-u1'),
        role: 'ASSISTANT',
        content: 'old',
        createdAt: at(2),
      }),
      message({
        messageId: brand<string, 'MessageId'>('summary-1'),
        requestId: brand<string, 'MessageId'>('summary-1'),
        role: 'SUMMARY',
        content: 'summary',
        metadata: {
          kind: 'CONTEXT_COMPRESSION_SUMMARY',
          coveredMessageRefs: ['covered-u1', 'covered-a1'],
          retainedTailMessageRefs: ['tail-u2', 'tail-a2'],
        },
        createdAt: at(3),
      }),
      message({ messageId: brand<string, 'MessageId'>('tail-u2'), requestId: brand<string, 'MessageId'>('tail-u2'), createdAt: at(4) }),
      message({
        messageId: brand<string, 'MessageId'>('tail-a2'),
        requestId: brand<string, 'MessageId'>('tail-u2'),
        role: 'ASSISTANT',
        content: 'tail',
        createdAt: at(5),
      }),
    ];

    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('tail-a2'),
        copiedMessages: copied,
      }),
    ).resolves.toEqual({ messageIds: ['summary-1', 'tail-u2', 'tail-a2'] });
  });

  it('rejects unresolved summary refs before selecting child active context', async () => {
    const selector = createForkActiveContextSelector();
    const copied = [
      message({
        messageId: brand<string, 'MessageId'>('summary-1'),
        requestId: brand<string, 'MessageId'>('summary-1'),
        role: 'SUMMARY',
        content: 'summary',
        metadata: {
          kind: 'CONTEXT_COMPRESSION_SUMMARY',
          coveredMessageRefs: ['source-only-message'],
          retainedTailMessageRefs: [],
        },
      }),
    ];

    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('summary-1'),
        copiedMessages: copied,
      }),
    ).rejects.toMatchObject({ code: 'FORK_CONTEXT_SUMMARY_REF_UNRESOLVABLE' });
  });

  it('uses normal prior-history exclusions for hidden replacements and broken tool protocol fragments', async () => {
    const selector = createForkActiveContextSelector();
    const copied = [
      message({ messageId: brand<string, 'MessageId'>('good-u1'), requestId: brand<string, 'MessageId'>('good-u1'), createdAt: at(1) }),
      message({
        messageId: brand<string, 'MessageId'>('good-a1'),
        requestId: brand<string, 'MessageId'>('good-u1'),
        role: 'ASSISTANT',
        content: 'answer',
        createdAt: at(2),
      }),
      message({
        messageId: brand<string, 'MessageId'>('hidden-u1'),
        requestId: brand<string, 'MessageId'>('hidden-u1'),
        metadata: { replacement: { kind: 'TRUNCATED' } },
        createdAt: at(3),
      }),
      message({
        messageId: brand<string, 'MessageId'>('hidden-a1'),
        requestId: brand<string, 'MessageId'>('hidden-u1'),
        role: 'ASSISTANT',
        content: 'hidden answer',
        createdAt: at(4),
      }),
      message({ messageId: brand<string, 'MessageId'>('tool-u1'), requestId: brand<string, 'MessageId'>('tool-u1'), createdAt: at(5) }),
      message({
        messageId: brand<string, 'MessageId'>('tool-a1'),
        requestId: brand<string, 'MessageId'>('tool-u1'),
        role: 'ASSISTANT',
        content: JSON.stringify({ toolCalls: [{ toolCallId: 'call-1', toolName: 'lookup', arguments: {} }] }),
        createdAt: at(6),
      }),
      message({ messageId: brand<string, 'MessageId'>('orphan-u1'), requestId: brand<string, 'MessageId'>('orphan-u1'), createdAt: at(7) }),
      message({
        messageId: brand<string, 'MessageId'>('orphan-result'),
        requestId: brand<string, 'MessageId'>('orphan-u1'),
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({ toolCallId: 'missing-call' }),
        createdAt: at(8),
      }),
      message({
        messageId: brand<string, 'MessageId'>('orphan-a1'),
        requestId: brand<string, 'MessageId'>('orphan-u1'),
        role: 'ASSISTANT',
        content: 'orphan answer',
        createdAt: at(9),
      }),
      message({ messageId: brand<string, 'MessageId'>('tail-u1'), requestId: brand<string, 'MessageId'>('tail-u1'), createdAt: at(10) }),
      message({
        messageId: brand<string, 'MessageId'>('tail-a1'),
        requestId: brand<string, 'MessageId'>('tail-u1'),
        role: 'ASSISTANT',
        content: 'tail answer',
        createdAt: at(11),
      }),
    ];

    await expect(
      selector.select({
        childSessionId,
        childAnchorMessageId: brand<string, 'MessageId'>('tail-a1'),
        copiedMessages: copied,
      }),
    ).resolves.toEqual({ messageIds: ['good-u1', 'good-a1', 'tail-u1', 'tail-a1'] });
  });
});
