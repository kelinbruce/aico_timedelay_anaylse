import { describe, expect, it } from 'vitest';
import { buildRunGraphViewState } from '../src/features/run-graph/buildRunGraphViewState.ts';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';

const labels: Record<string, string> = {
  'turnRunGraph.status.pending': 'Pending',
  'turnRunGraph.status.running': 'Running',
  'turnRunGraph.status.success': 'Completed',
  'turnRunGraph.status.failed': 'Failed',
  'turnRunGraph.status.canceled': 'Canceled',
  'turnRunGraph.status.superseded': 'Superseded',
  'turnRunGraph.status.waiting': 'Waiting',
  'turnRunGraph.status.warning': 'Warning',
  'turnRunGraph.status.info': 'Info',
  'turnRunGraph.nodes.request': 'Request accepted',
  'turnRunGraph.nodes.streamStarted': 'Run stream started',
  'turnRunGraph.nodes.model': 'Model processing',
  'turnRunGraph.nodes.answer': 'Answer generation',
  'turnRunGraph.nodes.terminal': 'Run finished',
  'turnRunGraph.nodes.userInputRequired': 'Waiting for input',
  'turnRunGraph.nodes.userInputReceived': 'Input received',
  'turnRunGraph.nodes.userInputTimeout': 'Input timed out',
  'turnRunGraph.nodes.userInputCanceled': 'Input canceled',
  'turn.process.systemEvent.degradation.title': 'Some work in this task did not complete',
  'turn.process.systemEvent.degradation.summary': 'Review the execution details and response to identify what did not complete.',
  'turn.process.systemEvent.hookDegraded.title': 'Some work in this task did not complete',
  'turn.process.systemEvent.hookDegraded.summary': 'Review the execution details and response to identify what did not complete.',
  'turn.process.systemEvent.contextCompacted.title': 'Earlier messages were condensed',
  'turn.process.systemEvent.contextCompacted.summary': 'The system condensed earlier messages to continue this task.',
  'turnRunGraph.phases.request': 'Web Channel',
  'turnRunGraph.phases.model': 'Model Runtime',
  'turnRunGraph.phases.capability': 'Capability SPI',
  'turnRunGraph.phases.userInput': 'User Input',
  'turnRunGraph.phases.degradation': 'System processing notice',
  'turnRunGraph.phases.answer': 'Assistant Stream',
  'turnRunGraph.phases.terminal': 'Terminal Event',
  'turnRunGraph.eventMeta.none': 'No linked event',
  'turnRunGraph.eventMeta.single': '{{type}} · seq {{seq}}',
  'turnRunGraph.eventMeta.multiple': '{{types}} · {{count}} events · seq {{start}}-{{end}}',
  'turnRunGraph.metrics.eventCount': '{{count}} backend events',
  'turnRunGraph.metrics.toolCall': 'toolCallId: {{id}}',
  'turn.process.errorCodeWithCode': 'Error code: {{code}}',
  'turnRunGraph.summaries.requestAccepted': 'The request was accepted by the runtime.',
  'turnRunGraph.summaries.requestInferred': 'The turn has stream events before an explicit request-accepted event.',
  'turnRunGraph.summaries.modelThinking': 'Model processing updates: {{count}}',
  'turnRunGraph.summaries.thinkingSuppressed': 'Thinking content is hidden. Update count: {{count}}',
  'turnRunGraph.summaries.answerGenerated': 'Assistant content updates: {{count}}, latest length: {{chars}} characters',
  'turnRunGraph.summaries.answerDeltaCount': 'Assistant content update count: {{count}}',
  'turnRunGraph.summaries.unknownCapability': 'Unknown capability',
  'turnRunGraph.summaries.capabilityRunning': 'Capability started.',
  'turnRunGraph.summaries.capabilityOutput': 'Capability output updated.',
  'turnRunGraph.summaries.capabilityOutputWithText': 'Capability output: {{text}}',
  'turnRunGraph.summaries.capabilityCompleted': 'Capability completed.',
  'turnRunGraph.summaries.capabilityCompletedWithText': 'Capability completed: {{text}}',
  'turnRunGraph.summaries.capabilityFailedWithText': 'Capability failed: {{text}}',
  'turnRunGraph.summaries.userInputRequired': 'The run is waiting for user input.',
  'turnRunGraph.summaries.userInputReceived': 'User input was received.',
  'turnRunGraph.summaries.userInputTimeout': 'User input timed out.',
  'turnRunGraph.summaries.userInputCanceled': 'User input was canceled.',
  'turnRunGraph.summaries.degradation': 'The run continued with degraded behavior.',
  'turnRunGraph.summaries.hookDegraded': 'A hook continued with degraded behavior.',
  'turnRunGraph.summaries.contextCompacted': 'Earlier context was compacted.',
  'turnRunGraph.summaries.terminalCompleted': 'The run completed.',
  'turnRunGraph.summaries.terminalFailed': 'The run failed.',
  'turnRunGraph.summaries.terminalFailedWithCode': 'The run failed. Error code: {{code}}',
  'turnRunGraph.summaries.terminalCanceled': 'The run was canceled.',
  'turnRunGraph.summaries.terminalSuperseded': 'The run was superseded by a newer request.',
};

function t(key: string, options?: Record<string, string | number>): string {
  let value = labels[key] ?? key;
  for (const [name, replacement] of Object.entries(options ?? {})) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
}

function event(
  sequence: number,
  eventType: StreamEnvelope['eventType'],
  payload: Record<string, any> = {},
  overrides: Partial<StreamEnvelope> = {},
): StreamEnvelope {
  return {
    eventId: `evt-${sequence}-${eventType}`,
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'context-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload,
    createdAt: `2026-04-20T12:00:${String(sequence).padStart(2, '0')}.000Z`,
    ...overrides,
  } as StreamEnvelope;
}

function block(events: readonly StreamEnvelope[], status: TurnBlock['status'] = 'EXECUTING'): TurnBlock {
  return {
    rootMessageId: 'root-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'session-1',
      role: 'USER',
      sequence: 1,
      content: 'Question',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      createdAt: '2026-04-20T12:00:00.000Z',
      visible: true,
      rootMessageId: 'root-1',
      requestContextId: 'context-1',
    },
    aiEvents: events,
    status,
    isLatest: true,
  };
}

describe('run graph view state', () => {
  it('maps request, model, answer, and terminal runtime facts in chronological order', () => {
    const viewState = buildRunGraphViewState(
      block(
        [
          event(4, 'REQUEST_COMPLETED', {}),
          event(2, 'LLM_THINKING_DELTA', { delta: 'private thinking' }),
          event(1, 'REQUEST_ACCEPTED', {}),
          event(3, 'LLM_CONTENT_DELTA', { content: 'final answer' }),
        ],
        'COMPLETED',
      ),
      t,
    );

    expect(viewState.status).toBe('success');
    expect(viewState.nodes.map((node) => node.kind)).toEqual(['request', 'model', 'answer', 'terminal']);
    expect(viewState.edges).toHaveLength(3);
    expect(viewState.nodes[0]).toMatchObject({
      phaseLabel: 'Web Channel',
      eventLabel: 'REQUEST_ACCEPTED · seq 1',
      metricLabel: '1 backend events',
    });
    expect(viewState.nodes.find((node) => node.kind === 'model')?.summary).toBe('Model processing updates: 1');
    expect(viewState.nodes.find((node) => node.kind === 'answer')?.summary).toContain('Assistant content updates: 1');
  });

  it('accumulates answer length for non-accumulated content deltas', () => {
    const viewState = buildRunGraphViewState(
      block([
        event(1, 'LLM_CONTENT_DELTA', { delta: 'Hel', accumulated: false }),
        event(2, 'LLM_CONTENT_DELTA', { delta: 'lo', accumulated: false }),
      ]),
      t,
    );

    expect(viewState.nodes.find((node) => node.kind === 'answer')?.summary).toBe('Assistant content updates: 2, latest length: 5 characters');
  });

  it('counts compacted answer updates and merges rolling text windows', () => {
    const viewState = buildRunGraphViewState(
      block([
        event(1, 'LLM_CONTENT_DELTA', {
          text: '1234567',
          metadata: { compactedEventCount: 3, accumulated: true },
        }),
        event(4, 'LLM_CONTENT_DELTA', { text: '4567890' }),
      ]),
      t,
    );

    expect(viewState.summary.eventCount).toBe(4);
    expect(viewState.nodes.find((node) => node.kind === 'answer')?.summary).toBe('Assistant content updates: 4, latest length: 10 characters');
  });

  it('keeps inferred stream-start nodes separate from the first real backend event', () => {
    const viewState = buildRunGraphViewState(block([event(2, 'LLM_THINKING_DELTA', { delta: 'private thinking' })]), t);

    expect(viewState.nodes[0]).toMatchObject({
      kind: 'request',
      title: 'Run stream started',
      eventLabel: 'No linked event',
      metricLabel: '0 backend events',
      relatedEventIds: [],
    });
    expect(viewState.nodes[1]).toMatchObject({
      kind: 'model',
      eventLabel: 'LLM_THINKING_DELTA · seq 2',
    });
  });

  it('orders graph nodes by backend sequence before event timestamps', () => {
    const viewState = buildRunGraphViewState(
      block(
        [
          event(6, 'REQUEST_COMPLETED', {}, { createdAt: '2026-04-20T12:00:01.000Z' }),
          event(1, 'REQUEST_ACCEPTED', {}, { createdAt: '2026-04-20T12:00:02.000Z' }),
          event(4, 'LLM_CONTENT_DELTA', { content: 'final answer' }, { createdAt: '2026-04-20T12:00:09.000Z' }),
        ],
        'COMPLETED',
      ),
      t,
    );

    expect(viewState.rawEvents.map((item) => item.sequence)).toEqual([1, 4, 6]);
    expect(viewState.nodes.map((node) => node.kind)).toEqual(['request', 'answer', 'terminal']);
  });

  it('correlates capability start, output, completion, and failure by tool call or fallback identity', () => {
    const viewState = buildRunGraphViewState(
      block(
        [
          event(1, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'diagnose' }),
          event(2, 'CAPABILITY_RESULT_DELTA', { toolCallId: 'tool-1', toolName: 'diagnose', delta: 'step 1' }),
          event(3, 'CAPABILITY_COMPLETED', { toolCallId: 'tool-1', toolName: 'diagnose', status: 'COMPLETED' }),
          event(4, 'CAPABILITY_COMPLETED', { invocationId: 'inv-2', capabilityId: 'repair', status: 'FAILED', errorMessage: 'denied' }),
        ],
        'FAILED',
      ),
      t,
    );

    const capabilityNodes = viewState.nodes.filter((node) => node.kind === 'capability');
    expect(capabilityNodes).toHaveLength(2);
    expect(capabilityNodes[0]?.relatedToolCallIds).toEqual(['tool-1']);
    expect(capabilityNodes[0]?.status).toBe('success');
    expect(capabilityNodes[0]?.summary).toBe('Capability output: step 1');
    expect(capabilityNodes[1]?.relatedToolCallIds).toEqual(['inv-2']);
    expect(capabilityNodes[1]?.status).toBe('failed');
    expect(capabilityNodes[1]?.summary).toBe('Capability failed: denied');
  });

  it.each([
    ['REQUEST_COMPLETED', 'COMPLETED', 'success'],
    ['REQUEST_FAILED', 'FAILED', 'failed'],
    ['REQUEST_CANCELED', 'CANCELED', 'canceled'],
    ['REQUEST_SUPERSEDED', 'SUPERSEDED', 'superseded'],
  ] as const)('finalizes unresolved running nodes when the run ends with %s', (terminalEventType, blockStatus, expectedStatus) => {
    const viewState = buildRunGraphViewState(
      block([event(1, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'diagnose' }), event(2, terminalEventType, {})], blockStatus),
      t,
    );

    const capabilityNode = viewState.nodes.find((node) => node.kind === 'capability');
    expect(viewState.status).toBe(expectedStatus);
    expect(capabilityNode?.status).toBe(expectedStatus);
    expect(viewState.latestRunningNodeId).toBeNull();
    expect(viewState.nodes.some((node) => node.status === 'running' || node.status === 'waiting')).toBe(false);
  });

  it('uses the failed terminal error code instead of raw safe-failure prose', () => {
    const viewState = buildRunGraphViewState(
      block([event(1, 'REQUEST_FAILED', { content: 'Request failed safely: CAPABILITY_PATH_REJECTED' })], 'FAILED'),
      t,
    );

    const terminalNode = viewState.nodes.find((node) => node.kind === 'terminal');
    expect(terminalNode?.summary).toBe('The run failed. Error code: CAPABILITY_PATH_REJECTED');
    expect(terminalNode?.detailLines).toEqual(['The run failed. Error code: CAPABILITY_PATH_REJECTED']);
    expect(viewState.activities.find((activity) => activity.type === 'terminal')?.description).toBe(
      'The run failed. Error code: CAPABILITY_PATH_REJECTED',
    );
  });

  it('maps user-input and degradation events without inventing stage or loop semantics', () => {
    const viewState = buildRunGraphViewState(
      block([
        event(1, 'USER_INPUT_REQUIRED', { inputRequestId: 'input-1', prompt: 'Approve?' }),
        event(2, 'USER_INPUT_RECEIVED', { inputRequestId: 'input-1' }),
        event(3, 'DEGRADATION_NOTICE', { message: 'fallback model', code: 'MODEL_FALLBACK' }),
        event(4, 'CONTEXT_COMPACTED', {}),
      ]),
      t,
    );

    expect(viewState.nodes.map((node) => node.title)).toEqual([
      'Run stream started',
      'Waiting for input',
      'Input received',
      'Some work in this task did not complete',
      'Earlier messages were condensed',
    ]);
    const degradation = viewState.nodes.find((node) => node.title === 'Some work in this task did not complete');
    const context = viewState.nodes.find((node) => node.title === 'Earlier messages were condensed');
    expect(degradation).toMatchObject({
      status: 'warning',
      phaseLabel: 'System processing notice',
      summary: 'Review the execution details and response to identify what did not complete.',
    });
    expect(degradation?.detailLines).toContain('Error code: MODEL_FALLBACK');
    expect(viewState.activities.find((activity) => activity.title === 'Some work in this task did not complete')?.description).toBe(
      'Review the execution details and response to identify what did not complete.',
    );
    expect(context).toMatchObject({
      status: 'info',
      phaseLabel: 'System processing notice',
      summary: 'The system condensed earlier messages to continue this task.',
    });
    expect(JSON.stringify({ nodes: viewState.nodes, activities: viewState.activities })).not.toContain('fallback model');
    expect(JSON.stringify(viewState)).not.toContain('iteration');
    expect(JSON.stringify(viewState)).not.toContain('loop');
    expect(JSON.stringify(viewState)).not.toContain('stage');
  });

  it('suppresses raw thinking, raw event JSON, and raw JSON-like capability payloads from summaries', () => {
    const viewState = buildRunGraphViewState(
      block([
        event(1, 'LLM_THINKING_DELTA', { delta: 'secret chain of thought' }),
        event(2, 'CAPABILITY_RESULT_DELTA', {
          toolCallId: 'tool-json',
          toolName: 'jsonTool',
          result: '{"raw":"tool result","args":{"secret":true}}',
        }),
      ]),
      t,
    );

    const renderedText = viewState.nodes.flatMap((node) => [node.title, node.summary, ...node.detailLines]).join('\n');
    expect(renderedText).not.toContain('secret chain of thought');
    expect(renderedText).not.toContain('"raw"');
    expect(renderedText).not.toContain('"args"');
    expect(renderedText).toContain('Thinking content is hidden');
    expect(renderedText).toContain('Capability output updated.');
  });

  it('keeps graph availability delegated to existing full-process affordance rules for history-load events', () => {
    const viewState = buildRunGraphViewState(
      block([
        event(
          1,
          'CAPABILITY_COMPLETED',
          { role: 'CAPABILITY_RESULT', toolCallId: 'tool-1', toolName: 'diagnose', result: 'historical result' },
          { transportHints: ['history-load'] },
        ),
      ]),
      t,
    );

    expect(viewState.nodes).toHaveLength(2);
    expect(viewState.nodes.map((node) => node.kind)).toEqual(['request', 'capability']);
  });
});
