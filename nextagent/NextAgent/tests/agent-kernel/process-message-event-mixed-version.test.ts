import { brand } from '@nextagent/agent-common';
import { projectTimelineEventToStreamEnvelope, resolveLegacyProcessMessageAssociation } from '@nextagent/agent-channel-common';
import type { RunTimelineEvent, RuntimeResolvedProcessMessage } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('process message event mixed-version compatibility', () => {
  it('recovers a legacy event only when one message uniquely matches', () => {
    const legacy = event({
      completed: true,
      stepId: 'turn-1',
      content: 'legacy event copy must not be used',
    });
    const canonical = assistantToolUseMessage('message-1', 'Canonical stage note');
    const association = resolveLegacyProcessMessageAssociation(legacy, [canonical]);
    const associated = {
      ...legacy,
      inlinePayload: {
        ...legacy.inlinePayload,
        messageId: canonical.messageId,
      },
    };

    expect(association).toEqual({ message: canonical });
    expect(
      projectTimelineEventToStreamEnvelope(associated, {
        processMessageAssociation: association!,
      }),
    ).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          content: 'Canonical stage note',
          text: 'Canonical stage note',
        },
      },
    });
  });

  it.each([
    { messages: [] as RuntimeResolvedProcessMessage[] },
    { messages: [assistantToolUseMessage('message-1', 'First candidate'), assistantToolUseMessage('message-2', 'Second candidate')] },
  ])('degrades zero or multiple legacy candidates without reading the event copy', ({ messages }) => {
    const legacy = event({
      completed: true,
      stepId: 'turn-1',
      content: 'legacy event copy must not leak',
    });
    const association = resolveLegacyProcessMessageAssociation(legacy, messages);
    const unavailable = {
      ...legacy,
      inlinePayload: {
        ...legacy.inlinePayload,
        messageId: 'legacy-unavailable',
      },
    };
    const outcome = projectTimelineEventToStreamEnvelope(unavailable, association === undefined ? {} : { processMessageAssociation: association });

    expect(association).toBeUndefined();
    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          content: '',
          text: '',
          contentUnavailable: true,
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('legacy event copy must not leak');
  });

  it('keeps a new ref-only event status-only for an old reader and message-backed for the new reader', () => {
    const refOnly = event({
      messageId: 'message-1',
      completed: true,
      stepId: 'turn-1',
    });
    const message = assistantToolUseMessage('message-1', 'Canonical stage note');

    expect(projectTimelineEventToStreamEnvelope(refOnly)).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          content: '',
          text: '',
          contentUnavailable: true,
        },
      },
    });
    expect(
      projectTimelineEventToStreamEnvelope(refOnly, {
        processMessageAssociation: { message },
      }),
    ).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          content: 'Canonical stage note',
          text: 'Canonical stage note',
        },
      },
    });
  });
});

function event(inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return {
    type: 'LLM_CONTENT_DELTA',
    inlinePayload,
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1),
  } as RunTimelineEvent;
}

function assistantToolUseMessage(messageId: string, content: string): RuntimeResolvedProcessMessage {
  return {
    messageId: brand<string, 'MessageId'>(messageId),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    role: 'ASSISTANT',
    content: JSON.stringify({
      content,
      toolCalls: [
        {
          toolCallId: 'tool-1',
          toolName: 'routerAudit',
          input: {},
        },
      ],
    }),
    contentType: 'PLAIN_TEXT',
    metadata: {
      kind: 'ASSISTANT_TOOL_USE',
      toolCallIds: ['tool-1'],
    },
    sequence: 1,
    visible: false,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}
