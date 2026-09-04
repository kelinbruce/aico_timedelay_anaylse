import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

describe('TOOL_STRUCTURED_DELTA stream projection', () => {
  it('projects structured delta with all fields', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      structuredDeltaEvent({
        capabilityId: 'clip-query-user-balance',
        toolCallId: 'call-001',
        toolEventType: 'ANSWER',
        toolMessageType: 'TEXT',
        content: 'User balance is 128 yuan',
        accumulated: true,
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.eventType).toBe('TOOL_STRUCTURED_DELTA');
      expect(outcome.envelope.payload.toolEventType).toBe('ANSWER');
      expect(outcome.envelope.payload.toolMessageType).toBe('TEXT');
      expect(outcome.envelope.payload.content).toBe('User balance is 128 yuan');
      expect(outcome.envelope.payload.capabilityId).toBe('clip-query-user-balance');
      expect(outcome.envelope.payload.toolCallId).toBe('call-001');
      expect(outcome.envelope.payload.metadata).toEqual({ accumulated: true });
    }
  });

  it('projects structured delta with object content', () => {
    const content = { piuName: 'thoughtChain', piuVersion: '1.0.0', data: '{}', method: 'render' };
    const outcome = projectTimelineEventToStreamEnvelope(
      structuredDeltaEvent({
        capabilityId: 'clip-piu',
        toolCallId: 'call-002',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content,
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.toolMessageType).toBe('PIU');
      expect(outcome.envelope.payload.content).toEqual(content);
      expect(outcome.envelope.payload.metadata).toEqual({ accumulated: false });
    }
  });
});

function structuredDeltaEvent(inlinePayload: JsonObject): RunTimelineEvent {
  return {
    type: 'TOOL_STRUCTURED_DELTA',
    eventId: 'timeline-tool-structured-delta',
    sessionId: brand<string, 'SessionId'>('session-structured-delta'),
    requestId: brand<string, 'MessageId'>('request-structured-delta'),
    runId: brand<string, 'RequestRunId'>('run-structured-delta'),
    requestContextId: brand<string, 'RequestContextId'>('context-structured-delta'),
    sequence: brand<number, 'TimelineSequence'>(20),
    createdAt: new Date(1_000),
    inlinePayload,
  };
}
