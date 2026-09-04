import { brand } from '@nextagent/agent-common';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('capability public identity web projection', () => {
  it.each(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED'] as const)('projects legal identity for %s', (type) => {
    const payload = project(type, {
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'network-diagnosis',
      toolCallId: 'call-1',
      ...(type === 'CAPABILITY_COMPLETED' ? { status: 'SUCCEEDED' } : {}),
      name: 'must-not-leak',
      args: { secret: true },
      prompt: 'must-not-leak',
    });

    expect(payload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'network-diagnosis',
      toolCallId: 'call-1',
    });
    expect(JSON.stringify(payload)).not.toMatch(/must-not-leak|secret|"name"|"args"|"prompt"/);
  });

  it.each([
    [{ capabilityKind: 'RECIPE', capabilityId: 'Read' }, { capabilityId: 'Read' }],
    [
      { capabilityKind: 'TOOL', capabilityId: 'Read', targetCapabilityId: 'unexpected' },
      { capabilityKind: 'TOOL', capabilityId: 'Read' },
    ],
    [
      { capabilityKind: 'TOOL', capabilityId: 'Agent', targetCapabilityId: 'x'.repeat(129) },
      { capabilityKind: 'TOOL', capabilityId: 'Agent' },
    ],
  ] as const)('locally drops invalid identity fields: %o', (identity, expected) => {
    expect(project('CAPABILITY_COMPLETED', { ...identity, toolCallId: 'call-1', status: 'SUCCEEDED' })).toMatchObject(expected);
  });

  it('does not copy new identity onto result delta', () => {
    const payload = project('CAPABILITY_RESULT_DELTA', {
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'network-diagnosis',
      toolCallId: 'call-1',
      result: {},
    });

    expect(payload).not.toHaveProperty('capabilityKind');
    expect(payload).not.toHaveProperty('targetCapabilityId');
    expect(payload).toMatchObject({ capabilityId: 'Skill', toolCallId: 'call-1' });
  });

  it.each(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED'] as const)(
    'keeps legal identity when the referenced process message is unavailable for %s',
    (type) => {
      const payload = project(type, {
        capabilityKind: 'TOOL',
        capabilityId: 'Workflow',
        targetCapabilityId: 'alarm-recovery',
        toolCallId: 'call-1',
        messageId: 'missing-message',
        ...(type === 'CAPABILITY_COMPLETED' ? { status: 'SUCCEEDED' } : {}),
      });

      expect(payload).toMatchObject({
        capabilityKind: 'TOOL',
        capabilityId: 'Workflow',
        targetCapabilityId: 'alarm-recovery',
        toolCallId: 'call-1',
        contentUnavailable: true,
      });
    },
  );

  it('keeps Skill target identity while ignoring a legacy CAPABILITY_COMPLETED inline result', () => {
    const payload = project('CAPABILITY_COMPLETED', {
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'cn-query-ops-monitoring-data',
      toolCallId: 'call-skill-1',
      status: 'SUCCEEDED',
      messageId: 'message-skill-1',
      result: {},
    });

    expect(payload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'cn-query-ops-monitoring-data',
      toolCallId: 'call-skill-1',
      status: 'SUCCEEDED',
      contentUnavailable: true,
    });
  });
});

function project(type: RunTimelineEvent['type'], inlinePayload: Record<string, unknown>): Record<string, unknown> {
  const outcome = projectTimelineEventToStreamEnvelope(event(type, inlinePayload));
  if (outcome.kind !== 'ENVELOPE') {
    throw new Error(`Expected ENVELOPE, received ${outcome.kind}`);
  }
  return outcome.envelope.payload;
}

function event(type: RunTimelineEvent['type'], inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return {
    type,
    inlinePayload,
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1),
  } as RunTimelineEvent;
}
