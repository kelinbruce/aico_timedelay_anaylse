import { createTimelineEventPersistencePolicy } from '@nextagent/agent-runtime';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('timeline event persistence policy', () => {
  const selectiveWorkflowPolicy = createTimelineEventPersistencePolicy();

  it.each([
    [thinking({ reasoning: 'checking', stepId: 'model:1' }), 'LIVE_ONLY'],
    [thinking({ reasoning: 'checking', stepId: 'model:1', completed: true }), 'PERSISTED'],
    [event('LLM_CONTENT_DELTA', { content: 'answer', stepId: 'model:1' }), 'LIVE_ONLY'],
    [event('LLM_CONTENT_DELTA', { messageId: 'message-1', stepId: 'model:1', completed: true }), 'PERSISTED'],
    [event('LLM_CONTENT_DELTA', { content: 'final answer', final: true }), 'LIVE_ONLY'],
    [event('CAPABILITY_RESULT_DELTA', { result: 'fragment' }), 'LIVE_ONLY'],
    [
      event('CAPABILITY_RESULT_DELTA', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        capabilityId: 'queryDevice',
        toolCallId: 'workflow:execution-1:callApi',
        result: { api_response: { events: [] } },
      }),
      'LIVE_ONLY',
    ],
    [event('TOOL_STRUCTURED_DELTA', { workflowEventType: 'NODE_OUTPUT_DELTA', content: 'fragment' }), 'LIVE_ONLY'],
    [event('TOOL_STRUCTURED_DELTA', { streaming: true, content: 'stream-chunk' }), 'PERSISTED'],
    [
      event('TOOL_STRUCTURED_DELTA', { streaming: true, toolEventType: 'ANSWER', toolMessageType: 'TEXT', content: 'stream-structured' }),
      'PERSISTED',
    ],
    [event('TOOL_STRUCTURED_DELTA', { content: 'non-streaming-fragment' }), 'LIVE_ONLY'],
    [
      workflowProduct({
        workflowEventType: 'NODE_STARTED',
        toolEventType: 'TITLE',
        content: 'title',
      }),
      'PERSISTED',
    ],
    [
      workflowProduct({
        workflowEventType: 'NODE_COMPLETED',
        toolEventType: 'ANSWER',
        content: 'complete',
      }),
      'PERSISTED',
    ],
    [event('CAPABILITY_STARTED', { messageId: 'message-1', capabilityKind: 'TOOL', capabilityId: 'Read', toolCallId: 'call-1' }), 'PERSISTED'],
    [
      event('CAPABILITY_COMPLETED', {
        messageId: 'message-2',
        capabilityKind: 'TOOL',
        capabilityId: 'Read',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_STARTED', {
        messageId: 'message-wrapper',
        capabilityKind: 'TOOL',
        capabilityId: 'Workflow',
        targetCapabilityId: 'alarm-recovery',
        toolCallId: 'call-workflow',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_COMPLETED', {
        messageId: 'message-clip',
        capabilityId: 'dynamic-clip-network-inspector',
        toolCallId: 'call-clip',
        status: 'SUCCEEDED',
        resultProjectionKind: 'CLIP_STREAM_V1',
      }),
      'PERSISTED',
    ],
    [event('CAPABILITY_COMPLETED', { capabilityId: 'Read', toolCallId: 'call-1', status: 'FAILED' }), 'PERSISTED'],
    [
      event('CAPABILITY_STARTED', {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'condition-1',
        nodeType: 'CONDITION',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_COMPLETED', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'condition-1',
        nodeType: 'CONDITION',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
        status: 'SUCCEEDED',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_STARTED', {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'knowledge-search-1',
        nodeType: 'KNOWLEDGE_SEARCH',
        capabilityId: 'knowledge-search-1',
        toolCallId: 'workflow:execution-1:knowledge-search-1',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_COMPLETED', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'knowledge-search-1',
        nodeType: 'KNOWLEDGE_SEARCH',
        capabilityId: 'knowledge-search-1',
        toolCallId: 'workflow:execution-1:knowledge-search-1',
        status: 'SUCCEEDED',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_STARTED', {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'tool-1',
        nodeType: 'TOOL',
        capabilityKind: 'TOOL',
        capabilityId: 'Read',
        toolCallId: 'workflow:execution-1:tool-1',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_COMPLETED', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'skill-1',
        nodeType: 'SKILL',
        capabilityKind: 'SKILL',
        capabilityId: 'network-diagnosis',
        toolCallId: 'workflow:execution-1:skill-1',
        status: 'SUCCEEDED',
      }),
      'PERSISTED',
    ],
    [
      event('CAPABILITY_COMPLETED', {
        workflowEventType: 'NODE_FAILED',
        nodeId: 'subflow-1',
        nodeType: 'SUBFLOW',
        capabilityKind: 'WORKFLOW',
        capabilityId: 'remediation-flow',
        toolCallId: 'workflow:execution-1:subflow-1',
        status: 'FAILED',
        safeErrorCode: 'WORKFLOW_NODE_FAILED',
        safeErrorCategory: 'INTERNAL',
      }),
      'PERSISTED',
    ],
    [event('REQUEST_ACCEPTED', {}), 'PERSISTED'],
  ] as const)('classifies %s as %s', (timelineEvent, expected) => {
    expect(selectiveWorkflowPolicy.resolve(timelineEvent)).toBe(expected);
  });

  it('does not allow a composition override to downgrade completed thinking', () => {
    const downgradeEverything = createTimelineEventPersistencePolicy(() => 'LIVE_ONLY');

    expect(
      downgradeEverything.resolve(
        thinking({
          reasoning: 'checking',
          stepId: 'model:1',
          completed: true,
        }),
      ),
    ).toBe('PERSISTED');
  });

  it.each(['result', 'safeResult', 'structuredPayload', 'output'] as const)(
    'rejects ordinary capability completion carrying recoverable %s body',
    (bodyField) => {
      expect(() =>
        selectiveWorkflowPolicy.resolve(
          event('CAPABILITY_COMPLETED', {
            messageId: 'message-2',
            capabilityId: 'Read',
            toolCallId: 'call-1',
            status: 'SUCCEEDED',
            [bodyField]: { private: 'duplicate body' },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'TIMELINE_EVENT_PERSISTENCE_INVALID' }));
    },
  );

  it.each([
    thinking({ reasoning: 'checking', stepId: 'model:1', completed: false }),
    thinking({ reasoning: '   ', stepId: 'model:1' }),
    thinking({ reasoning: 'checking', stepId: '' }),
    { ...thinking({ reasoning: 'checking', stepId: 'model:1' }), persistence: 'PERSISTED' as const },
    { ...thinking({ reasoning: 'checking', stepId: 'model:1', completed: true }), persistence: 'LIVE_ONLY' as const },
  ])('rejects invalid thinking payload or explicit persistence mismatch', (timelineEvent) => {
    expect(() => selectiveWorkflowPolicy.resolve(timelineEvent)).toThrowError(
      expect.objectContaining({
        code: 'TIMELINE_EVENT_PERSISTENCE_INVALID',
      }),
    );
  });

  it.each([
    event('LLM_CONTENT_DELTA', { stepId: 'model:1', completed: true }),
    event('LLM_CONTENT_DELTA', { messageId: 'message-1', stepId: 'model:1', completed: true, content: 'duplicate' }),
    event('LLM_CONTENT_DELTA', { messageId: 'message-1', stepId: 'model:1', completed: false }),
    { ...event('LLM_CONTENT_DELTA', { messageId: 'message-1', stepId: 'model:1', completed: true }), persistence: 'LIVE_ONLY' as const },
  ])('rejects malformed completed content references', (timelineEvent) => {
    expect(() => selectiveWorkflowPolicy.resolve(timelineEvent)).toThrowError(
      expect.objectContaining({
        code: 'TIMELINE_EVENT_PERSISTENCE_INVALID',
      }),
    );
  });

  it.each([
    event('CAPABILITY_STARTED', {
      capabilityId: 'Read',
      toolCallId: 'call-1',
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
      capabilityId: 'condition-1',
      toolCallId: 'workflow:execution-1:condition-1',
      input: { route: 'protected' },
    }),
    event('CAPABILITY_COMPLETED', {
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
      capabilityId: 'condition-1',
      toolCallId: 'workflow:execution-1:condition-1',
      status: 'SUCCEEDED',
      output: { matched: true },
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
      capabilityId: 'condition-1',
      toolCallId: 'workflow:execution-1:condition-1',
      description: 'must not be persisted in lifecycle',
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
      nodeExecutionId: '',
      capabilityId: 'condition-1',
      toolCallId: 'workflow:execution-1:condition-1',
    }),
    event('CAPABILITY_COMPLETED', {
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
      capabilityId: 'condition-1',
      toolCallId: 'workflow:execution-1:condition-1',
      retryCount: -1,
      status: 'SUCCEEDED',
    }),
    event('CAPABILITY_COMPLETED', {
      workflowEventType: 'NODE_FAILED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
      capabilityId: 'condition-1',
      toolCallId: 'workflow:execution-1:condition-1',
      status: 'SUCCEEDED',
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'condition-1',
      nodeType: 'CONDITION',
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'tool-1',
      nodeType: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'workflow:execution-1:tool-1',
      input: { path: 'secret' },
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'tool-1',
      nodeType: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'workflow:execution-1:tool-1',
      description: 'must not be persisted in lifecycle',
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'tool-1',
      nodeType: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'workflow:execution-1:tool-1',
    }),
    event('CAPABILITY_STARTED', {
      workflowEventType: 'NODE_STARTED',
      nodeId: 'tool-1',
      nodeType: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'call-1',
    }),
    event('CAPABILITY_STARTED', {
      messageId: ' ',
      capabilityId: 'Read',
      toolCallId: 'call-1',
    }),
    event('CAPABILITY_STARTED', {
      messageId: 'message-1',
      capabilityId: 'Read',
      toolCallId: '',
    }),
    event('CAPABILITY_COMPLETED', {
      messageId: ' ',
      capabilityId: 'Read',
      toolCallId: 'call-1',
      status: 'SUCCEEDED',
    }),
    event('CAPABILITY_COMPLETED', {
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'tool-1',
      nodeType: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'workflow:execution-1:tool-1',
      status: 'SUCCEEDED',
      output: { secret: 'duplicate' },
    }),
    event('CAPABILITY_COMPLETED', {
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'tool-1',
      nodeType: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'workflow:execution-1:tool-1',
      status: 'SUCCEEDED',
      description: 'must not be persisted in lifecycle',
    }),
    event('CAPABILITY_COMPLETED', {
      messageId: 'message-2',
      capabilityId: 'Read',
      status: 'SUCCEEDED',
    }),
    event('CAPABILITY_STARTED', {
      messageId: 'message-1',
      capabilityId: 'Read',
      toolCallId: 'call-1',
      arguments: { path: 'duplicate' },
    }),
    event('CAPABILITY_COMPLETED', {
      capabilityId: 'Read',
      toolCallId: 'call-1',
      status: 'SUCCEEDED',
      safeResult: 'duplicate',
    }),
    event('CAPABILITY_COMPLETED', {
      messageId: 'message-clip',
      capabilityId: 'dynamic-clip-network-inspector',
      toolCallId: 'call-clip',
      status: 'SUCCEEDED',
      resultProjectionKind: 'UNTRUSTED_PROJECTOR',
    }),
    event('CAPABILITY_STARTED', {
      messageId: 'message-1',
      capabilityKind: 'RECIPE',
      capabilityId: 'Read',
      toolCallId: 'call-1',
    }),
    event('CAPABILITY_COMPLETED', {
      messageId: 'message-2',
      capabilityKind: 'TOOL',
      capabilityId: 'Read',
      targetCapabilityId: 'unexpected-target',
      toolCallId: 'call-1',
      status: 'SUCCEEDED',
    }),
    event('CAPABILITY_STARTED', {
      messageId: 'message-1',
      capabilityKind: 'TOOL',
      capabilityId: 'Agent',
      targetCapabilityId: 'x'.repeat(129),
      toolCallId: 'call-1',
    }),
    event('CAPABILITY_RESULT_DELTA', {
      capabilityId: 'Read',
      capabilityKind: 'TOOL',
      toolCallId: 'call-1',
      result: 'fragment',
    }),
    {
      ...event('TOOL_STRUCTURED_DELTA', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        capabilityId: 'render-result',
        toolCallId: 'call-1',
        toolEventType: 'ANSWER',
        toolMessageType: 'TEXT',
        content: 'self-reported product',
        accumulated: true,
      }),
      persistence: 'PERSISTED' as const,
    },
    { ...workflowProduct({ nodeType: 'UNKNOWN' }), persistence: 'PERSISTED' as const },
    { ...workflowProduct({ toolEventType: 'UNKNOWN' }), persistence: 'PERSISTED' as const },
    { ...workflowProduct({ toolMessageType: 'UNKNOWN' }), persistence: 'PERSISTED' as const },
    { ...workflowProduct({ content: null }), persistence: 'PERSISTED' as const },
    { ...workflowProduct({ output: { duplicate: 'body' } }), persistence: 'PERSISTED' as const },
    { ...workflowProduct({ nodeExecutionId: '' }), persistence: 'PERSISTED' as const },
    { ...workflowProduct({ retryCount: -1 }), persistence: 'PERSISTED' as const },
    { ...event('CAPABILITY_RESULT_DELTA', { result: 'fragment' }), persistence: 'PERSISTED' as const },
    { ...event('TOOL_STRUCTURED_DELTA', { content: 'fragment' }), persistence: 'PERSISTED' as const },
    { ...event('LLM_CONTENT_DELTA', { content: 'final', final: true }), persistence: 'PERSISTED' as const },
  ])('rejects malformed process references, recoverable copies, or persistence overrides', (timelineEvent) => {
    expect(() => selectiveWorkflowPolicy.resolve(timelineEvent)).toThrowError(
      expect.objectContaining({
        code: 'TIMELINE_EVENT_PERSISTENCE_INVALID',
      }),
    );
  });
});

function thinking(inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return event('LLM_THINKING_DELTA', inlinePayload);
}

function event(type: RunTimelineEvent['type'], inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return { type, inlinePayload } as RunTimelineEvent;
}

function workflowProduct(inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return event('TOOL_STRUCTURED_DELTA', {
    nodeId: 'render-result',
    nodeType: 'DISPLAY',
    capabilityId: 'render-result',
    toolCallId: 'workflow:execution-1:render-result',
    workflowEventType: 'NODE_COMPLETED',
    toolEventType: 'ANSWER',
    toolMessageType: 'TEXT',
    content: 'complete',
    accumulated: true,
    ...inlinePayload,
  });
}
