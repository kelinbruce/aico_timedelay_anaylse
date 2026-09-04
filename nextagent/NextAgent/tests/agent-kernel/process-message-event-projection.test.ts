import { brand } from '@nextagent/agent-common';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-common';
import type { RunTimelineEvent, RuntimeResolvedProcessMessage } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('process message event semantic projection', () => {
  it('keeps live, cold history, child and grandchild projections semantically equivalent', () => {
    const generations = [
      generation('source', 'session-source', 'request-source', 'run-source'),
      generation('child', 'session-child', 'request-child', 'run-child'),
      generation('grandchild', 'session-grandchild', 'request-grandchild', 'run-grandchild'),
    ];

    const snapshots = generations.map(({ events, messages, finalAnswer }) => ({
      process: events.map((event) => project(event, messages)),
      finalAnswer,
    }));

    expect(snapshots.map((snapshot) => snapshot.process)).toEqual([snapshots[0]!.process, snapshots[0]!.process, snapshots[0]!.process]);
    expect(snapshots.map((snapshot) => snapshot.finalAnswer)).toEqual([
      'Router configuration is healthy.',
      'Router configuration is healthy.',
      'Router configuration is healthy.',
    ]);
    expect(JSON.stringify(generations[1])).not.toContain('session-source');
    expect(JSON.stringify(generations[2])).not.toContain('session-source');
    expect(JSON.stringify(generations[2])).not.toContain('session-child');
  });
});

function generation(prefix: string, session: string, request: string, run: string) {
  const toolUse = processMessage({
    messageId: `${prefix}-tool-use`,
    session,
    request,
    run,
    role: 'ASSISTANT',
    content: JSON.stringify({
      content: 'I will inspect the router configuration.',
      toolCalls: [{ toolCallId: 'tool-1', toolName: 'routerAudit', input: {} }],
    }),
    metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-1'] },
    visible: false,
  });
  const result = processMessage({
    messageId: `${prefix}-result`,
    session,
    request,
    run,
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({
      toolCallId: 'tool-1',
      toolName: 'routerAudit',
      payload: { status: 'healthy' },
    }),
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-1', toolName: 'routerAudit' },
    visible: true,
  });
  const events = [
    processEvent(
      'LLM_CONTENT_DELTA',
      session,
      request,
      run,
      {
        messageId: toolUse.messageId,
        stepId: 'turn-1',
        completed: true,
      },
      1,
    ),
    processEvent(
      'CAPABILITY_STARTED',
      session,
      request,
      run,
      {
        messageId: toolUse.messageId,
        capabilityId: 'routerAudit',
        toolCallId: 'tool-1',
      },
      2,
    ),
    processEvent(
      'CAPABILITY_COMPLETED',
      session,
      request,
      run,
      {
        messageId: result.messageId,
        capabilityId: 'routerAudit',
        toolCallId: 'tool-1',
        status: 'SUCCEEDED',
      },
      3,
    ),
  ];
  return {
    events,
    messages: new Map([
      [toolUse.messageId, toolUse],
      [result.messageId, result],
    ]),
    finalAnswer: 'Router configuration is healthy.',
  };
}

function project(event: RunTimelineEvent, messages: ReadonlyMap<string, RuntimeResolvedProcessMessage>): unknown {
  const messageId = event.inlinePayload['messageId'];
  const message = typeof messageId === 'string' ? messages.get(messageId) : undefined;
  const outcome = projectTimelineEventToStreamEnvelope(event, {
    ...(message === undefined ? {} : { processMessageAssociation: { message } }),
  });
  if (outcome.kind !== 'ENVELOPE') {
    return outcome;
  }
  const payload = outcome.envelope.payload;
  return {
    eventType: outcome.envelope.eventType,
    content: payload['content'],
    text: payload['text'],
    safeResult: payload['safeResult'],
    status: payload['status'],
    capabilityId: payload['capabilityId'],
    toolCallId: payload['toolCallId'],
  };
}

function processEvent(
  type: RunTimelineEvent['type'],
  session: string,
  request: string,
  run: string,
  inlinePayload: Record<string, unknown>,
  sequence: number,
): RunTimelineEvent {
  return {
    type,
    inlinePayload,
    sessionId: brand<string, 'SessionId'>(session),
    requestId: brand<string, 'MessageId'>(request),
    runId: brand<string, 'RequestRunId'>(run),
    sequence: brand<number, 'TimelineSequence'>(sequence),
    createdAt: new Date(sequence),
  } as RunTimelineEvent;
}

function processMessage(input: {
  readonly messageId: string;
  readonly session: string;
  readonly request: string;
  readonly run: string;
  readonly role: RuntimeResolvedProcessMessage['role'];
  readonly content: string;
  readonly metadata: RuntimeResolvedProcessMessage['metadata'];
  readonly visible: boolean;
}): RuntimeResolvedProcessMessage {
  return {
    messageId: brand<string, 'MessageId'>(input.messageId),
    sessionId: brand<string, 'SessionId'>(input.session),
    requestId: brand<string, 'MessageId'>(input.request),
    runId: brand<string, 'RequestRunId'>(input.run),
    role: input.role,
    content: input.content,
    contentType: 'PLAIN_TEXT',
    metadata: input.metadata,
    sequence: 1,
    visible: input.visible,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}
