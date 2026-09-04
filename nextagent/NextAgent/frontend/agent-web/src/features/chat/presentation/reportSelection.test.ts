import { describe, it, expect } from 'vitest';
import type { StreamEnvelope, TurnBlock } from '../../../state/contracts.ts';
import { resolveReportableRequestId } from './reportSelection.ts';

function makeLlmContentDelta(sequence: number, text: string): StreamEnvelope {
  return {
    eventId: `llm-${sequence}`,
    sessionId: 's1',
    requestId: 'req-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-1',
    sequence,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      contentType: 'PLAIN_TEXT',
      content: text,
      text,
      role: 'ASSISTANT',
      messageId: `msg-${sequence}`,
      runId: 'run-1',
      rootMessageId: 'root-1',
      requestContextId: 'ctx-1',
      visible: true,
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

function makeStructuredAnswer(sequence: number, toolMessageType: string, content: unknown): StreamEnvelope {
  return {
    eventId: `struct-${sequence}`,
    sessionId: 's1',
    requestId: 'req-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-1',
    sequence,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      contentType: 'PLAIN_TEXT',
      content: content as never,
      text: '',
      role: 'CAPABILITY_RESULT',
      messageId: `msg-${sequence}`,
      runId: 'run-1',
      rootMessageId: 'root-1',
      requestContextId: 'ctx-1',
      visible: true,
      toolEventType: 'ANSWER',
      toolMessageType: toolMessageType as never,
      toolCallId: 'call-1',
      capabilityId: 'cap-1',
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

function makeBlock(status: TurnBlock['status'], aiEvents: readonly StreamEnvelope[], rootMessageId = 'root-1'): TurnBlock {
  return {
    rootMessageId,
    userMessage: {
      messageId: 'user-1',
      sessionId: 's1',
      content: 'question',
      createdAt: 1783346000000,
      visible: true,
    },
    aiEvents,
    status,
    isLatest: false,
  };
}

const DTE_BI_AGENT_DSL = { type: 'piu', properties: { name: 'dte-bi-agent' } };
const OTHER_DSL = { type: 'piu', properties: { name: 'other-agent' } };

describe('resolveReportableRequestId', () => {
  it('returns requestId for completed turn with plain LLM text answer', () => {
    const block = makeBlock('COMPLETED', [makeLlmContentDelta(1, 'answer text')]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns requestId for completed turn with answer text from REQUEST_COMPLETED terminal fallback', () => {
    const terminalEvent: StreamEnvelope = {
      eventId: 'term-1',
      sessionId: 's1',
      requestId: 'req-1',
      runId: 'run-1',
      rootMessageId: 'root-1',
      requestContextId: 'ctx-1',
      sequence: 2,
      eventType: 'REQUEST_COMPLETED',
      timelineEventRef: null,
      transportHints: ['history-load'],
      createdAt: 1783346000000,
      payload: {
        contentType: 'PLAIN_TEXT',
        content: 'answer from terminal fallback',
        text: 'answer from terminal fallback',
        role: 'ASSISTANT',
        messageId: 'msg-term-1',
        runId: 'run-1',
        rootMessageId: 'root-1',
        requestContextId: 'ctx-1',
        visible: true,
      },
    } as StreamEnvelope;
    const block = makeBlock('COMPLETED', [terminalEvent]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns requestId for completed turn with TEXT structured answer', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'TEXT', 'structured text')]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns requestId for completed turn with DSL answer matching dte-bi-agent', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'DSL', DTE_BI_AGENT_DSL)]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns requestId for DSL answer with stringified JSON content matching dte-bi-agent', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'DSL', JSON.stringify(DTE_BI_AGENT_DSL))]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns undefined for non-terminal turn', () => {
    const block = makeBlock('EXECUTING', [makeLlmContentDelta(1, 'streaming')]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for FAILED turn', () => {
    const block = makeBlock('FAILED', [makeLlmContentDelta(1, 'partial answer')]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for DSL answer not matching dte-bi-agent', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'DSL', OTHER_DSL)]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for DSL answer with wrong type', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'DSL', { type: 'other', properties: { name: 'dte-bi-agent' } })]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for DSL answer with invalid JSON string content', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'DSL', 'not-json')]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for PIU structured answer', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'PIU', { type: 'piu', properties: { name: 'dte-bi-agent' } })]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for ACTION structured answer', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'ACTION', '{}')]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for OPERATOR structured answer', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'OPERATOR', '{}')]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for FILE structured answer', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'FILE', 'report.pdf')]);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for completed turn with no answer content', () => {
    const block = makeBlock('COMPLETED', []);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns undefined for CANCELED turn without answer', () => {
    const block = makeBlock('CANCELED', []);
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });

  it('returns requestId for CANCELED turn with valid TEXT answer', () => {
    const block = makeBlock('CANCELED', [makeStructuredAnswer(1, 'TEXT', 'partial answer')]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns requestId when both plain text and structured DSL answer exist', () => {
    const block = makeBlock('COMPLETED', [makeLlmContentDelta(1, 'intro'), makeStructuredAnswer(2, 'DSL', DTE_BI_AGENT_DSL)]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns requestId for SUPERSEDED turn with valid answer', () => {
    const block = makeBlock('SUPERSEDED', [makeLlmContentDelta(1, 'superseded answer')]);
    expect(resolveReportableRequestId(block)).toBe('req-1');
  });

  it('returns undefined for synthetic bi-report turn regardless of answer content', () => {
    const block = makeBlock('COMPLETED', [makeStructuredAnswer(1, 'DSL', DTE_BI_AGENT_DSL)], 'bi-report:some-message-id');
    expect(resolveReportableRequestId(block)).toBeUndefined();
  });
});
