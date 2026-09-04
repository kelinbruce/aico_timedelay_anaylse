import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope as projectWithoutPolicy } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

const projectTimelineEventToStreamEnvelope = (event: RunTimelineEvent) =>
  projectWithoutPolicy(event, {
    capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
  });

describe('ToolSearch CAPABILITY_RESULT_DELTA stream projection', () => {
  it('projects governed capability metadata for frontend display', () => {
    const envelope = projectToolSearchResult({
      tools: [
        {
          capability_id: 'ran-alarm-diagnosis',
          name: 'RAN Alarm Diagnosis',
          kind: 'SKILL',
          description: 'Diagnose active radio access network alarms.',
          providerId: 'must-not-cross-project',
          inputSchema: { secret: true },
        },
        {
          capability_id: 'clipc-api-021',
          name: 'CLIP API 021',
          kind: 'TOOL',
          description: 'Query a governed telecom KPI snapshot.',
          searchHint: 'private-ranking-hint',
        },
      ],
      truncated: false,
      rawQuery: 'private-search-query',
    });

    expect(envelope.payload.safeSummary).toBe('ToolSearch found 2 governed capabilities.');
    expect(envelope.payload.text).toContain('RAN Alarm Diagnosis (SKILL · ran-alarm-diagnosis)');
    expect(envelope.payload.safeResult).toEqual({
      kind: 'toolSearch',
      tools: [
        {
          capability_id: 'ran-alarm-diagnosis',
          name: 'RAN Alarm Diagnosis',
          kind: 'SKILL',
          description: 'Diagnose active radio access network alarms.',
        },
        {
          capability_id: 'clipc-api-021',
          name: 'CLIP API 021',
          kind: 'TOOL',
          description: 'Query a governed telecom KPI snapshot.',
        },
      ],
      totalCount: 2,
      truncated: false,
    });
    expect(JSON.stringify(envelope.payload)).not.toContain('must-not-cross-project');
    expect(JSON.stringify(envelope.payload)).not.toContain('inputSchema');
    expect(JSON.stringify(envelope.payload)).not.toContain('private-ranking-hint');
    expect(JSON.stringify(envelope.payload)).not.toContain('private-search-query');
  });

  it('bounds the frontend result list and descriptions', () => {
    const tools = Array.from({ length: 51 }, (_, index) => ({
      capability_id: `tool-${index + 1}`,
      name: `Tool ${index + 1}`,
      kind: 'TOOL',
      description: index === 0 ? 'x'.repeat(1_001) : 'Safe description',
    }));
    const envelope = projectToolSearchResult({ tools, truncated: false });
    const safeResult = envelope.payload.safeResult as JsonObject;

    expect(safeResult.kind).toBe('toolSearch');
    expect(safeResult.tools).toHaveLength(50);
    expect(safeResult.totalCount).toBe(51);
    expect(safeResult.truncated).toBe(true);
    expect(JSON.stringify(safeResult)).not.toContain('x'.repeat(1_001));
  });

  it('fails closed for malformed or non-ToolSearch results', () => {
    const malformed = projectToolSearchResult({
      tools: [{ capability_id: 'unsafe', name: 'Unsafe', kind: 'AGENT', raw: 'secret' }],
      truncated: false,
    });
    const unrelated = projectCapabilityResult('OtherTool', {
      tools: [{ capability_id: 'unsafe', name: 'Unsafe', kind: 'TOOL', raw: 'secret' }],
      truncated: false,
    });

    for (const envelope of [malformed, unrelated]) {
      expect(envelope.payload.safeResult).toBeUndefined();
      expect(envelope.payload.safeSummary).toBeUndefined();
      expect(envelope.payload.text).toBe('');
      expect(JSON.stringify(envelope.payload)).not.toContain('secret');
    }
  });
});

function projectToolSearchResult(result: JsonObject) {
  return projectCapabilityResult('ToolSearch', result);
}

function projectCapabilityResult(capabilityId: string, result: JsonObject) {
  const outcome = projectTimelineEventToStreamEnvelope(capabilityResultEvent(capabilityId, result));
  expect(outcome.kind).toBe('ENVELOPE');
  if (outcome.kind !== 'ENVELOPE') {
    throw new Error('Expected capability result to produce a stream envelope.');
  }
  return outcome.envelope;
}

function capabilityResultEvent(capabilityId: string, result: JsonObject): RunTimelineEvent {
  return {
    type: 'CAPABILITY_RESULT_DELTA',
    eventId: 'timeline-tool-search-result',
    sessionId: brand<string, 'SessionId'>('session-tool-search-result'),
    requestId: brand<string, 'MessageId'>('request-tool-search-result'),
    runId: brand<string, 'RequestRunId'>('run-tool-search-result'),
    requestContextId: brand<string, 'RequestContextId'>('context-tool-search-result'),
    sequence: brand<number, 'TimelineSequence'>(20),
    createdAt: new Date(1_000),
    inlinePayload: {
      capabilityId,
      toolCallId: 'call-tool-search-result',
      result,
    },
  };
}
