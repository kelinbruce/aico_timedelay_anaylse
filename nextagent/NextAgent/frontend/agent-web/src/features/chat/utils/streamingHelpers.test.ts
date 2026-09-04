import { describe, expect, it } from 'vitest';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildEnvelopeMergeIdentity } from './streamingHelpers.ts';

function makeStructuredEnvelope(toolEventType: 'TITLE' | 'DETAIL'): StreamEnvelope {
  return {
    eventId: `event-${toolEventType.toLowerCase()}`,
    sessionId: 'session',
    requestId: 'request',
    requestContextId: 'context',
    runId: 'run',
    rootMessageId: 'root',
    sequence: 4,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      toolEventType,
      toolMessageType: 'TEXT',
      toolCallId: 'workflow:first-display',
      capabilityId: 'first-display',
      content: toolEventType,
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

describe('buildEnvelopeMergeIdentity', () => {
  it('keeps structured TITLE and DETAIL with the same sequence distinct', () => {
    expect(buildEnvelopeMergeIdentity(makeStructuredEnvelope('TITLE'))).not.toBe(buildEnvelopeMergeIdentity(makeStructuredEnvelope('DETAIL')));
  });
});
