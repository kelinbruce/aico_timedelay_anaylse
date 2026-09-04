import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope as projectWithoutPolicy } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

const projectTimelineEventToStreamEnvelope = (event: RunTimelineEvent) =>
  projectWithoutPolicy(event, {
    capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
  });

describe('Workflow delta stream projection via safe fields', () => {
  it('projects CONTENT channel delta as visible text', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      capabilityResultEvent({
        capabilityId: 'Workflow',
        toolCallId: 'call-wf-delta-1',
        result: {
          workflowDelta: {
            channel: 'CONTENT',
            content: 'The root cause is a fiber cut at sector 3.',
          },
        },
        safeSummary: 'Workflow is generating output.',
        safeDetailText: 'The root cause is a fiber cut at sector 3.',
        safeResult: {
          kind: 'workflowDelta',
          channel: 'CONTENT',
          truncated: false,
        },
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.eventType).toBe('CAPABILITY_RESULT_DELTA');
      expect(outcome.envelope.payload.capabilityId).toBe('Workflow');
      expect(outcome.envelope.payload.toolCallId).toBe('call-wf-delta-1');
      expect(String(outcome.envelope.payload.text)).toBe('The root cause is a fiber cut at sector 3.');
      expect(outcome.envelope.payload.content).toBe(outcome.envelope.payload.text);
      expect(outcome.envelope.payload.metadata).toEqual({ accumulated: true });
      expect(outcome.envelope.payload.safeResult as JsonObject).toEqual({
        kind: 'workflowDelta',
        channel: 'CONTENT',
        truncated: false,
      });
      expect(outcome.envelope.payload.safeSummary).toBe('Workflow is generating output.');
    }
  });

  it('projects THINKING channel delta with thinking summary', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      capabilityResultEvent({
        capabilityId: 'Workflow',
        toolCallId: 'call-wf-delta-2',
        result: {
          workflowDelta: {
            channel: 'THINKING',
            content: 'Analyzing alarm patterns...',
          },
        },
        safeSummary: 'Workflow is generating reasoning.',
        safeDetailText: 'Analyzing alarm patterns...',
        safeResult: {
          kind: 'workflowDelta',
          channel: 'THINKING',
          truncated: false,
        },
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(String(outcome.envelope.payload.text)).toBe('Analyzing alarm patterns...');
      expect(outcome.envelope.payload.safeResult as JsonObject).toEqual({
        kind: 'workflowDelta',
        channel: 'THINKING',
        truncated: false,
      });
      expect(outcome.envelope.payload.safeSummary).toBe('Workflow is generating reasoning.');
    }
  });

  it('truncates large delta content', () => {
    const longContent = 'y'.repeat(5000);
    const truncatedPreview = longContent.slice(0, 4000).trimEnd() + '\n...';
    const outcome = projectTimelineEventToStreamEnvelope(
      capabilityResultEvent({
        capabilityId: 'Workflow',
        toolCallId: 'call-wf-delta-3',
        result: {
          workflowDelta: {
            channel: 'CONTENT',
            content: longContent,
          },
        },
        safeSummary: 'Workflow is generating output.',
        safeDetailText: truncatedPreview,
        safeResult: {
          kind: 'workflowDelta',
          channel: 'CONTENT',
          truncated: true,
        },
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      const text = String(outcome.envelope.payload.text);
      expect(text.length).toBeLessThan(longContent.length);
      expect(text).toContain('...');
      expect((outcome.envelope.payload.safeResult as JsonObject | undefined)?.truncated).toBe(true);
    }
  });
});

describe('Workflow final result stream projection', () => {
  it('does NOT project final result outputVariables as visible text', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      capabilityResultEvent({
        capabilityId: 'Workflow',
        toolCallId: 'call-wf-final',
        result: {
          recipeName: 'alarm-localization',
          status: 'succeeded',
          outputVariables: {
            rootCause: 'fiber cut at sector 3',
            affectedCells: 12,
            recommendation: 'dispatch field team',
          },
        },
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(String(outcome.envelope.payload.text)).toBe('');
      expect(outcome.envelope.payload.safeResult).toEqual({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'succeeded',
      });
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('fiber cut');
    }
  });

  it('does NOT project waiting workflow final result as visible text', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      capabilityResultEvent({
        capabilityId: 'Workflow',
        toolCallId: 'call-wf-waiting',
        result: {
          recipeName: 'user-confirmation',
          status: 'waiting',
        },
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(String(outcome.envelope.payload.text)).toBe('');
      expect(outcome.envelope.payload.safeResult).toEqual({
        kind: 'workflowResult',
        recipeName: 'user-confirmation',
        status: 'waiting',
      });
    }
  });
});

function capabilityResultEvent(inlinePayload: JsonObject): RunTimelineEvent {
  return {
    type: 'CAPABILITY_RESULT_DELTA',
    eventId: 'timeline-workflow-result',
    sessionId: brand<string, 'SessionId'>('session-workflow-projection'),
    requestId: brand<string, 'MessageId'>('request-workflow-projection'),
    runId: brand<string, 'RequestRunId'>('run-workflow-projection'),
    requestContextId: brand<string, 'RequestContextId'>('context-workflow-projection'),
    sequence: brand<number, 'TimelineSequence'>(30),
    createdAt: new Date(1_000),
    inlinePayload,
  };
}
