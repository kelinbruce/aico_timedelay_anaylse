import { describe, expect, it } from 'vitest';
import {
  buildAnswerContent,
  buildAnswerSegments,
  isFinalAnswerHandoffFromPendingProcessContent,
  readPersistedPreviewAnswer,
  readLatestAssistantAnswerPresentationOrder,
  readLatestAssistantAnswerSequence,
  readLatestLiveStreamActivitySignature,
  splitProgressiveMarkdownContent,
} from '../src/features/chat/presentation/answerContent.ts';
import type { StreamEnvelope, StreamEventType } from '../src/state/contracts.ts';

function event(eventType: StreamEventType, sequence: number, payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId: `event-${sequence}`,
    sequence,
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    eventType,
    payload,
    createdAt: `2026-06-02T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    transportHints: [],
    timelineEventRef: null,
  } as StreamEnvelope;
}

describe('answer content presentation', () => {
  it('extracts only the user preview facts from a canonical persisted terminal result', () => {
    const content = [
      '<persisted-content>',
      'Reason: size-above-inline-threshold',
      'Full content ref: CAPABILITY_RESULT:tool-results/abc123.txt',
      'Original size: 50001 chars',
      'Preview:',
      'first line',
      'File path: this line belongs to the preview',
      'last preview line',
      'File path: tool-results/abc123.txt',
      'Access: Invoke the Read tool with file_path="tool-results/abc123.txt". If the file is too large, page it with explicit offset and limit.',
      '</persisted-content>',
    ].join('\n');

    expect(readPersistedPreviewAnswer(content)).toEqual({
      originalSize: 50_001,
      preview: 'first line\nFile path: this line belongs to the preview\nlast preview line',
    });
  });

  it('extracts a canonical persisted preview nested in an ApiCall result envelope', () => {
    const preview = [
      '<persisted-content>',
      'Reason: size-above-inline-threshold',
      'Full content ref: CAPABILITY_RESULT:tool-results/def456.txt',
      'Original size: 60000 chars',
      'Preview:',
      'bounded API result',
      'File path: tool-results/def456.txt',
      'Access: Invoke the Read tool with file_path="tool-results/def456.txt". If the file is too large, page it with explicit offset and limit.',
      '</persisted-content>',
    ].join('\n');
    const content = JSON.stringify({ toolCallId: 'call-1', toolName: 'ApiCall', payload: { preview } });

    expect(readPersistedPreviewAnswer(content)).toEqual({ originalSize: 60_000, preview: 'bounded API result' });
  });

  it('does not infer a persisted preview from an incomplete marker-shaped answer', () => {
    expect(readPersistedPreviewAnswer('<persisted-content>\nPreview:\nordinary model text')).toBeNull();
    expect(readPersistedPreviewAnswer('ordinary answer mentioning tool-results/abc123.txt')).toBeNull();
  });

  it('does not let a completed pre-input step hide a post-input pending handoff with the same step id', () => {
    const events = [
      event('LLM_CONTENT_DELTA', 1, {
        content: '正在调用意图识别工具',
        stepId: 'turn-2',
        completed: true,
        metadata: { accumulated: true, completed: true },
      }),
      event('USER_INPUT_RECEIVED', 2, { pendingInputId: 'pending-1' }),
      event('LLM_CONTENT_DELTA', 3, {
        content: '最终回答开头',
        stepId: 'turn-2',
        metadata: { accumulated: true },
      }),
    ];

    expect(isFinalAnswerHandoffFromPendingProcessContent(events, '最终回答开头，后续正文')).toBe(true);
  });

  it('merges assistant deltas while excluding capability result text', () => {
    const content = buildAnswerContent([
      event('LLM_CONTENT_DELTA', 1, { delta: 'this', accumulated: false }),
      event('LLM_CONTENT_DELTA', 2, { delta: ' is', accumulated: false }),
      event('CAPABILITY_RESULT_DELTA', 3, { delta: 'tool output', role: 'CAPABILITY_RESULT' }),
      event('LLM_CONTENT_DELTA', 4, { delta: ' test', accumulated: false }),
    ]);

    expect(content).toBe('this is test');
  });

  it('merges live assistant token deltas in receive order instead of sequence order', () => {
    const content = buildAnswerContent([
      event('LLM_CONTENT_DELTA', 3, { delta: 'token', accumulated: false }),
      event('LLM_CONTENT_DELTA', 1, { delta: ' is', accumulated: false }),
      event('LLM_CONTENT_DELTA', 2, { delta: ' single', accumulated: false }),
    ]);

    expect(content).toBe('token is single');
  });

  it('does not treat failed terminal content as generated answer content', () => {
    const content = buildAnswerContent([event('REQUEST_FAILED', 4, { content: 'Request failed safely: MODEL_PROVIDER_ERROR' })]);

    expect(content).toBe('');
  });

  it('uses non-placeholder failed terminal content as partial answer fallback', () => {
    const content = buildAnswerContent([event('REQUEST_FAILED', 4, { content: 'I checked the workspace before the tool failed.' })]);

    expect(content).toBe('I checked the workspace before the tool failed.');
  });

  it('does not append failed terminal content when assistant answer content already exists', () => {
    const content = buildAnswerContent([
      event('LLM_CONTENT_DELTA', 3, { content: 'partial answer', accumulated: true }),
      event('REQUEST_FAILED', 4, { content: 'Request failed safely: MODEL_PROVIDER_ERROR' }),
    ]);

    expect(content).toBe('partial answer');
  });

  it('does not treat user cancellation detail as generated answer content', () => {
    const content = buildAnswerContent([event('REQUEST_CANCELED', 4, { content: 'Request canceled by user.' })]);

    expect(content).toBe('');
  });

  it('returns the latest answer sequence and latest non-history activity signature', () => {
    const events = [
      event('LLM_CONTENT_DELTA', 1, { delta: 'first', accumulated: false }),
      event('CAPABILITY_RESULT_DELTA', 2, { delta: 'tool output', role: 'CAPABILITY_RESULT' }),
      event('LLM_CONTENT_DELTA', 3, { delta: ' second', accumulated: false }),
    ];

    expect(readLatestAssistantAnswerSequence(events)).toBe(3);
    expect(readLatestAssistantAnswerPresentationOrder(events)).toBe(2);
    expect(readLatestLiveStreamActivitySignature(events)).toBe('3:event-3:LLM_CONTENT_DELTA');
  });

  it('ignores content-free model control events when reading the latest visible answer sequence', () => {
    const events = [
      event('LLM_CONTENT_DELTA', 1, { delta: 'visible', accumulated: false }),
      event('LLM_CONTENT_DELTA', 2, { complete: true, finishReason: 'tool_calls' }),
    ];

    expect(readLatestAssistantAnswerSequence(events)).toBe(1);
    expect(readLatestAssistantAnswerPresentationOrder(events)).toBe(0);
  });

  it('treats a replaced accumulated answer snapshot as later activity without moving its array slot', () => {
    const events = [
      {
        ...event('LLM_CONTENT_DELTA', 20, { content: 'final answer', role: 'ASSISTANT' }),
        createdAt: '2026-06-02T00:00:02.000Z',
      },
      {
        ...event('LLM_THINKING_DELTA', 10, { content: 'final reasoning' }),
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];

    expect(readLatestAssistantAnswerPresentationOrder(events)).toBe(1);
  });

  it('keeps an unfinished streaming markdown table tail as plain text', () => {
    const progressive = splitProgressiveMarkdownContent('| Name | Status |\n| --- | --- |\n| Core | up |\n| Edge |', true);

    expect(progressive.markdownPrefix).toContain('| Core | up |');
    expect(progressive.liveTail).toBe('| Edge |');
  });

  it('retracts streamed content and shows the refusal when OUTPUT_GUARD_BLOCKED is followed by REQUEST_COMPLETED', () => {
    const content = buildAnswerContent([
      event('LLM_CONTENT_DELTA', 1, { content: 'sensitive answer that should be retracted', accumulated: true }),
      event('OUTPUT_GUARD_BLOCKED', 2, { refusalMessage: '抱歉，该回答已被安全护栏拦截。' }),
      event('REQUEST_COMPLETED', 3, { content: 'sensitive answer that should be retracted' }),
    ]);

    expect(content).toBe('抱歉，该回答已被安全护栏拦截。');
  });

  it('still shows the refusal when OUTPUT_GUARD_BLOCKED is the last event', () => {
    const content = buildAnswerContent([
      event('LLM_CONTENT_DELTA', 1, { content: 'partial sensitive answer', accumulated: true }),
      event('OUTPUT_GUARD_BLOCKED', 2, { refusalMessage: '该回答已被安全护栏拦截。' }),
    ]);

    expect(content).toBe('该回答已被安全护栏拦截。');
  });

  it('returns the streamed answer when the round was not guard-blocked', () => {
    const content = buildAnswerContent([
      event('LLM_CONTENT_DELTA', 1, { content: 'normal answer', accumulated: true }),
      event('REQUEST_COMPLETED', 2, { content: 'normal answer' }),
    ]);

    expect(content).toBe('normal answer');
  });

  it('prefers the committed terminal answer when it rewrites the pre-commit final LLM content', () => {
    const content = buildAnswerContent([
      event('TOOL_STRUCTURED_DELTA', 0, {
        capabilityId: 'render-result',
        toolCallId: 'workflow:execution-1:render-result',
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content: { piuName: 'ranDiagnosis' },
        metadata: { accumulated: true },
      }),
      event('LLM_CONTENT_DELTA', 1, { content: 'answer before terminal policy', final: true, accumulated: true }),
      event('REQUEST_COMPLETED', 2, { content: 'answer after terminal policy', status: 'COMPLETED' }),
    ]);

    expect(content).toBe('answer after terminal policy');
  });

  it('prefers the committed terminal answer for a Workflow turn without a structured ANSWER product', () => {
    const events = [
      event('CAPABILITY_COMPLETED', 0, {
        capabilityId: 'diagnose',
        toolCallId: 'workflow:execution-1:diagnose',
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'diagnose',
        nodeType: 'TOOL',
        status: 'SUCCEEDED',
      }),
      event('LLM_CONTENT_DELTA', 1, { content: 'answer before terminal policy', final: true, accumulated: true }),
      event('REQUEST_COMPLETED', 2, { content: 'answer after terminal policy', status: 'COMPLETED' }),
    ];

    expect(buildAnswerContent(events)).toBe('answer after terminal policy');
    expect(buildAnswerSegments(events)).toEqual([{ kind: 'text', content: 'answer after terminal policy', sequence: 2 }]);
  });

  it('preserves absolute paths in the committed Workflow terminal answer segment', () => {
    const events = [
      event('CAPABILITY_COMPLETED', 1, {
        capabilityId: 'diagnose',
        toolCallId: 'workflow:execution-1:diagnose',
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'diagnose',
        nodeType: 'RESTFUL',
        status: 'SUCCEEDED',
      }),
      event('REQUEST_COMPLETED', 2, {
        content: 'saved at /Users/operator/private/result.json',
        status: 'COMPLETED',
      }),
    ];

    expect(buildAnswerSegments(events)).toEqual([{ kind: 'text', content: 'saved at /Users/operator/private/result.json', sequence: 2 }]);
  });

  it('does not apply Workflow terminal precedence to an ordinary Tool turn', () => {
    const events = [
      event('CAPABILITY_COMPLETED', 0, {
        capabilityId: 'Read',
        toolCallId: 'tool-call-1',
        status: 'SUCCEEDED',
      }),
      event('LLM_CONTENT_DELTA', 1, { content: 'ordinary tool answer', final: true, accumulated: true }),
      event('REQUEST_COMPLETED', 2, { content: 'ordinary terminal mirror', status: 'COMPLETED' }),
    ];

    expect(buildAnswerContent(events)).toBe('ordinary tool answer');
    expect(buildAnswerSegments(events)).toEqual([{ kind: 'text', content: 'ordinary tool answer', sequence: 1 }]);
  });

  it.each([
    ['TEXT', 'partial', 'complete answer'],
    ['DSL', '<dsl>partial</dsl>', '<dsl>complete</dsl>'],
    ['PIU', { component: 'diagnosis', phase: 'partial' }, { component: 'diagnosis', phase: 'complete' }],
  ] as const)('keeps settled Workflow %s ANSWER products in the answer projection', (toolMessageType, partial, complete) => {
    const productPayload = {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'ANSWER',
      toolMessageType,
      metadata: { accumulated: true },
    };
    const completed = event('TOOL_STRUCTURED_DELTA', 3, {
      ...productPayload,
      workflowEventType: 'NODE_COMPLETED',
      content: complete,
    });
    const live = [
      event('TOOL_STRUCTURED_DELTA', 1, { ...productPayload, workflowEventType: 'NODE_OUTPUT_DELTA', content: partial }),
      event('TOOL_STRUCTURED_DELTA', 2, { ...productPayload, workflowEventType: 'NODE_OUTPUT_DELTA', content: complete }),
      completed,
    ];

    const expected = [{ kind: 'structured' as const, toolMessageType, content: complete, sequence: 3, isHistory: false }];
    expect(buildAnswerSegments(live)).toEqual(expected);
    expect(buildAnswerSegments([completed])).toEqual(expected);
  });

  it('keeps Workflow TEXT products in the answer area before terminal handoff', () => {
    const productPayload = {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'ANSWER',
      toolMessageType: 'TEXT',
      metadata: { accumulated: true },
    };
    const sameOccurrenceFragments = [
      event('TOOL_STRUCTURED_DELTA', 1, {
        ...productPayload,
        workflowEventType: 'NODE_OUTPUT_DELTA',
        nodeExecutionId: 'render-result-attempt-1',
        content: 'first partial',
      }),
      event('TOOL_STRUCTURED_DELTA', 2, {
        ...productPayload,
        workflowEventType: 'NODE_OUTPUT_DELTA',
        nodeExecutionId: 'render-result-attempt-1',
        content: 'first complete',
      }),
    ];
    const completedOccurrences = [
      event('TOOL_STRUCTURED_DELTA', 3, {
        ...productPayload,
        workflowEventType: 'NODE_COMPLETED',
        nodeExecutionId: 'render-result-attempt-1',
        content: 'first complete',
      }),
      event('TOOL_STRUCTURED_DELTA', 4, {
        ...productPayload,
        workflowEventType: 'NODE_COMPLETED',
        nodeExecutionId: 'render-result-attempt-2',
        content: 'second complete',
      }),
    ];

    expect(buildAnswerSegments(sameOccurrenceFragments)).toEqual([
      { kind: 'structured', toolMessageType: 'TEXT', content: 'first complete', sequence: 2, isHistory: false },
    ]);
    expect(buildAnswerSegments(completedOccurrences)).toEqual([
      { kind: 'structured', toolMessageType: 'TEXT', content: 'first complete', sequence: 3, isHistory: false },
      { kind: 'structured', toolMessageType: 'TEXT', content: 'second complete', sequence: 4, isHistory: false },
    ]);
  });

  it('removes a residual Workflow fragment when the run terminates without a completed product', () => {
    const fragment = event('TOOL_STRUCTURED_DELTA', 1, {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'ANSWER',
      toolMessageType: 'DSL',
      workflowEventType: 'NODE_OUTPUT_DELTA',
      content: '<dsl>partial</dsl>',
      metadata: { accumulated: true },
    });
    const terminal = event('REQUEST_COMPLETED', 2, { content: 'terminal answer', status: 'COMPLETED' });

    expect(buildAnswerSegments([fragment, terminal])).toEqual(buildAnswerSegments([terminal]));
  });
});
