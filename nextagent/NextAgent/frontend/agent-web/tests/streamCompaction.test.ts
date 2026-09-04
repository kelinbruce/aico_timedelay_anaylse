import { describe, expect, it } from 'vitest';

import type { StreamEnvelope, StreamEventType } from '../src/state/contracts.ts';
import { compactLiveEnvelopes } from '../src/features/chat/utils/streamCompaction.ts';
import { readStreamText } from '../src/features/chat/utils/streamTextSemantics.ts';

function envelope(sequence: number, eventType: StreamEventType, payload: Record<string, unknown> = {}): StreamEnvelope {
  return {
    eventId: `evt-${sequence}`,
    sessionId: 'session-1',
    requestId: 'request-1',
    requestContextId: 'request-1',
    rootMessageId: 'root-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {
      rootMessageId: 'root-1',
      runId: 'request-1',
      ...payload,
    },
    createdAt: `2026-07-22T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
  } as StreamEnvelope;
}

describe('compactLiveEnvelopes', () => {
  it('losslessly compacts a text lane after the watermark', () => {
    const input = Array.from({ length: 520 }, (_, index) =>
      envelope(index + 1, 'LLM_CONTENT_DELTA', { role: 'ASSISTANT', delta: `token-${index} ` }),
    );

    const compacted = compactLiveEnvelopes(input, 500);

    expect(compacted).toHaveLength(1);
    expect(readStreamText(compacted[0]!)).toBe(input.map((item) => item.payload.delta).join(''));
  });

  it('retains every non-mergeable structural event beyond the watermark', () => {
    const input = Array.from({ length: 1001 }, (_, index) => envelope(index + 1, 'TOOL_STRUCTURED_DELTA', { invocationId: `invocation-${index}` }));

    const compacted = compactLiveEnvelopes(input, 500);

    expect(compacted).toHaveLength(1001);
    expect(compacted.map((item) => item.eventId)).toEqual(input.map((item) => item.eventId));
  });

  it('keeps capability invocations and sequence-gap segments independent', () => {
    const input = [
      envelope(1, 'CAPABILITY_RESULT_DELTA', { invocationId: 'a', delta: 'a1' }),
      envelope(2, 'CAPABILITY_RESULT_DELTA', { invocationId: 'b', delta: 'b1' }),
      envelope(3, 'CAPABILITY_RESULT_DELTA', { invocationId: 'a', delta: 'a2' }),
      envelope(5, 'CAPABILITY_RESULT_DELTA', { invocationId: 'a', delta: 'a3' }),
    ];

    const compacted = compactLiveEnvelopes(input, 4);

    expect(compacted).toHaveLength(4);
    expect(compacted.map((item) => item.payload.invocationId)).toEqual(['a', 'b', 'a', 'a']);
  });

  it('preserves capability result frames with structured presentation semantics', () => {
    const structuredResult = envelope(1, 'CAPABILITY_RESULT_DELTA', {
      toolCallId: 'tool-1',
      toolName: 'networkDiagnostic',
      text: 'Capability result is available.',
      safeSummary: 'Validated three network interfaces.',
      safeResult: {
        kind: 'fileList',
        filenames: ['interface-1', 'interface-2', 'interface-3'],
        totalCount: 3,
        truncated: false,
      },
      status: 'SUCCEEDED',
    });
    const trailingDelta = envelope(2, 'CAPABILITY_RESULT_DELTA', {
      toolCallId: 'tool-1',
      delta: 'Follow-up detail.',
      metadata: { accumulated: false },
    });

    const compacted = compactLiveEnvelopes([structuredResult, trailingDelta], 2);

    expect(compacted).toHaveLength(2);
    expect(compacted[0]).toBe(structuredResult);
    expect(compacted[1]).toBe(trailingDelta);
    expect(compacted[1]?.payload.metadata).toEqual({ accumulated: false });
    expect(compacted[0]?.payload).toMatchObject({
      toolName: 'networkDiagnostic',
      safeSummary: 'Validated three network interfaces.',
      safeResult: { kind: 'fileList', totalCount: 3 },
      status: 'SUCCEEDED',
    });
  });

  it('waits for the next watermark before recompressing a previously compacted lane', () => {
    const firstWindow = Array.from({ length: 500 }, (_, index) =>
      envelope(index + 1, 'LLM_CONTENT_DELTA', { role: 'ASSISTANT', delta: `a${index}` }),
    );
    const firstCompacted = compactLiveEnvelopes(firstWindow, 500);
    const belowNextWatermark = [
      ...firstCompacted,
      ...Array.from({ length: 499 }, (_, index) => envelope(index + 501, 'TOOL_STRUCTURED_DELTA', { invocationId: `invocation-${index}` })),
    ];

    const unchanged = compactLiveEnvelopes(belowNextWatermark, firstCompacted.length + 500);
    const atNextWatermark = compactLiveEnvelopes(
      [...belowNextWatermark, envelope(1000, 'TOOL_STRUCTURED_DELTA', { invocationId: 'invocation-499' })],
      firstCompacted.length + 500,
    );

    expect(unchanged).toEqual(belowNextWatermark);
    expect(unchanged[0]).toBe(firstCompacted[0]);
    expect(atNextWatermark).toHaveLength(501);
  });

  it('does not merge identical capability identities across attempts', () => {
    const firstAttempt = envelope(1, 'CAPABILITY_RESULT_DELTA', { invocationId: 'shared', delta: 'first' });
    const secondAttempt = {
      ...envelope(2, 'CAPABILITY_RESULT_DELTA', { invocationId: 'shared', delta: 'second' }),
      requestId: 'request-2',
      requestContextId: 'request-2',
      payload: {
        ...envelope(2, 'CAPABILITY_RESULT_DELTA').payload,
        rootMessageId: 'root-1',
        requestContextId: 'request-2',
        invocationId: 'shared',
        delta: 'second',
      },
    } as StreamEnvelope;

    const compacted = compactLiveEnvelopes([firstAttempt, secondAttempt], 2);

    expect(compacted).toHaveLength(2);
    expect(compacted.map((item) => item.requestContextId)).toEqual(['request-1', 'request-2']);
  });

  it('keeps a completed process-content step separate from the later final-answer lane', () => {
    const completedProcessContent = envelope(2, 'LLM_CONTENT_DELTA', {
      role: 'ASSISTANT',
      content: 'I will inspect the network evidence.',
      stepId: 'turn-1',
      completed: true,
      metadata: { accumulated: true, completed: true },
    });
    const compacted = compactLiveEnvelopes(
      [
        envelope(1, 'LLM_CONTENT_DELTA', {
          role: 'ASSISTANT',
          content: 'I will inspect',
          stepId: 'turn-1',
          metadata: { accumulated: true },
        }),
        completedProcessContent,
        envelope(3, 'LLM_CONTENT_DELTA', {
          role: 'ASSISTANT',
          content: 'The backbone link is healthy.',
          stepId: 'turn-2',
          final: true,
          metadata: { accumulated: true },
        }),
      ],
      3,
    );

    expect(compacted).toHaveLength(2);
    expect(compacted[0]?.payload).toMatchObject({
      stepId: 'turn-1',
      completed: true,
      content: 'I will inspect the network evidence.',
    });
    expect(compacted[1]?.payload).toMatchObject({
      stepId: 'turn-2',
      final: true,
      content: 'The backbone link is healthy.',
    });
  });

  it('does not compact the same assistant step across accepted user input', () => {
    const compacted = compactLiveEnvelopes(
      [
        envelope(1, 'LLM_CONTENT_DELTA', {
          role: 'ASSISTANT',
          content: '正在调用意图识别工具',
          stepId: 'turn-2',
          metadata: { accumulated: true, completed: true },
        }),
        envelope(2, 'USER_INPUT_RECEIVED', { pendingInputId: 'pending-1' }),
        envelope(3, 'LLM_CONTENT_DELTA', {
          role: 'ASSISTANT',
          content: '已获取补充信息，调用数据查询工具中',
          stepId: 'turn-2',
          metadata: { accumulated: true, completed: true },
        }),
      ],
      3,
    );

    const explanations = compacted.filter((item) => item.eventType === 'LLM_CONTENT_DELTA');
    expect(explanations).toHaveLength(2);
    expect(explanations.map((item) => readStreamText(item))).toEqual(['正在调用意图识别工具', '已获取补充信息，调用数据查询工具中']);
  });
});
