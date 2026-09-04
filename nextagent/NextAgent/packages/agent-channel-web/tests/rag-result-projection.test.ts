import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope, type CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

describe('Rag CAPABILITY_RESULT_DELTA stream projection', () => {
  it('projects pipe-split sources and full content without raw retrieval fields', () => {
    const longContent = `${'中'.repeat(50)}尾部不应展示`;
    const envelope = projectRagResult({
      status: 'OK',
      results: [
        { source: 'knowledge-base|upf-timeout.md', content: 'Handle N4 timeout first.' },
        { source: 'knowledge-base|amf-overload.md', content: longContent, score: 0.99 },
        { content: 'Counted without a displayable source.' },
      ],
      diagnostics: { providerTrace: 'private-diagnostic' },
    });

    expect(envelope.payload.safeResult).toEqual({
      kind: 'ragRetrieval',
      totalCount: 3,
      items: [
        { source: 'knowledge-base', content: 'Handle N4 timeout first.' },
        { source: 'knowledge-base', content: longContent },
        { source: 'Counted without a displayable source.', content: 'Counted without a displayable source.' },
      ],
    });
    const serializedPayload = JSON.stringify(envelope.payload);
    expect(serializedPayload).not.toContain('private-diagnostic');
    expect(serializedPayload).not.toContain('upf-timeout.md');
  });

  it('does not create a RAG safe result for unsuccessful results', () => {
    const envelope = projectRagResult({ status: 'FAILED', results: [] });

    expect(envelope.payload.safeResult).toBeUndefined();
  });

  it('projects full content without backend truncation', () => {
    const fullContent = `A${'b'.repeat(100)}`;
    const envelope = projectRagResult({
      status: 'OK',
      results: [{ source: 'english-runbook.md', content: fullContent }],
    });

    expect(envelope.payload.safeResult).toEqual({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'english-runbook.md', content: fullContent }],
    });
  });
});

function projectRagResult(result: JsonObject) {
  const outcome = projectTimelineEventToStreamEnvelope(
    {
      type: 'CAPABILITY_RESULT_DELTA',
      eventId: 'timeline-rag-result',
      sessionId: brand<string, 'SessionId'>('session-rag-result'),
      requestId: brand<string, 'MessageId'>('request-rag-result'),
      runId: brand<string, 'RequestRunId'>('run-rag-result'),
      requestContextId: brand<string, 'RequestContextId'>('context-rag-result'),
      sequence: brand<number, 'TimelineSequence'>(20),
      createdAt: new Date(1_000),
      inlinePayload: {
        capabilityId: 'Rag',
        toolCallId: 'call-rag-result',
        result,
      },
    } satisfies RunTimelineEvent,
    { capabilityResultPresentationPolicy: detailPolicy },
  );
  expect(outcome.kind).toBe('ENVELOPE');
  if (outcome.kind !== 'ENVELOPE') {
    throw new Error('Expected capability result to produce a stream envelope.');
  }
  return outcome.envelope;
}

const detailPolicy: CapabilityResultPresentationPolicy = Object.freeze({
  defaultLevel: 'DETAIL',
  levelByCapabilityId: new Map(),
});
