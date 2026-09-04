import { describe, expect, it, vi } from 'vitest';
import {
  composeTurnProcessHistory,
  loadCompleteRunProcessHistory,
  runProcessHistoryQueue,
  selectVisibleProcessRunTargets,
} from '../src/features/chat/history/processHistory.ts';
import i18n from '../src/i18n/index.ts';
import { buildProcessEntries } from '../src/features/chat/process/processDetails.ts';
import type { SessionConversationMessage, SessionRunEventHistoryPage, StreamEnvelope } from '../src/state/contracts.ts';

function message(
  messageId: string,
  sequence: number,
  role: SessionConversationMessage['role'],
  runId: string | null,
  overrides: Partial<SessionConversationMessage> = {},
): SessionConversationMessage {
  return {
    messageId,
    sessionId: 'session-1',
    rootMessageId: 'root-1',
    runId,
    role,
    sequence,
    content: `${role} content`,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: `2026-07-22T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    visible: true,
    ...overrides,
  };
}

function envelope(eventId: string, sequence: number): StreamEnvelope {
  return {
    eventId,
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'context-1',
    sequence,
    eventType: 'REQUEST_COMPLETED',
    timelineEventRef: `timeline-${eventId}`,
    transportHints: [],
    payload: { agentResponseRef: 'assistant-1' },
    createdAt: `2026-07-22T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

function structuredPresentation(
  eventId: string,
  sequence: number,
  toolCallId: string,
  options: {
    readonly persisted?: boolean;
    readonly runId?: string;
    readonly toolEventType?: 'ANSWER' | 'DETAIL';
  } = {},
): StreamEnvelope {
  const persisted = options.persisted ?? true;
  return {
    ...envelope(eventId, sequence),
    runId: options.runId ?? 'run-1',
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: persisted ? `timeline-${eventId}` : null,
    transportHints: ['history-load'],
    payload: {
      capabilityId: 'CloudCoreApi',
      toolCallId,
      ...(persisted ? {} : { messageId: `capability-result-${eventId}`, role: 'CAPABILITY_RESULT' }),
      toolEventType: options.toolEventType ?? 'DETAIL',
      toolMessageType: 'PIU',
      content: { rows: [{ alarmId: `alarm-${eventId}` }] },
    },
  } as StreamEnvelope;
}

describe('composeTurnProcessHistory', () => {
  it('uses persisted completed thinking as the canonical copy for one stable step', () => {
    const livePartial = {
      ...envelope('live-thinking-partial', 8),
      eventType: 'LLM_THINKING_DELTA',
      timelineEventRef: null,
      payload: {
        text: 'inspect access rules',
        stepId: 'turn-2',
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;
    const liveCompleted = {
      ...envelope('live-thinking-completed', 9),
      eventType: 'LLM_THINKING_DELTA',
      timelineEventRef: null,
      payload: {
        text: 'inspect access rules and routing policy',
        stepId: 'turn-2',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const persistedCompleted = {
      ...envelope('persisted-thinking-completed', 9),
      eventType: 'LLM_THINKING_DELTA',
      payload: {
        text: 'inspect access rules and routing policy',
        stepId: 'turn-2',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;

    const firstComposition = composeTurnProcessHistory({
      baseEnvelopes: [livePartial, liveCompleted],
      eventEnvelopes: [persistedCompleted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });
    const replayComposition = composeTurnProcessHistory({
      baseEnvelopes: firstComposition,
      eventEnvelopes: [persistedCompleted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(firstComposition.map((event) => event.eventId)).toEqual(['persisted-thinking-completed']);
    expect(replayComposition.map((event) => event.eventId)).toEqual(['persisted-thinking-completed']);
  });

  it('uses persisted completed thinking when the live copy has the same eventId', () => {
    const livePartial = {
      ...envelope('thinking-shared', 8),
      eventType: 'LLM_THINKING_DELTA',
      timelineEventRef: null,
      payload: {
        text: 'inspect access rules',
        stepId: 'turn-2',
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;
    const persistedCompleted = {
      ...envelope('thinking-shared', 9),
      eventType: 'LLM_THINKING_DELTA',
      payload: {
        text: 'inspect access rules and routing policy',
        stepId: 'turn-2',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [livePartial],
      eventEnvelopes: [persistedCompleted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      eventId: 'thinking-shared',
      timelineEventRef: 'timeline-thinking-shared',
      payload: {
        text: 'inspect access rules and routing policy',
        metadata: { accumulated: true, completed: true },
      },
    });
  });

  it('keeps equal thinking text from distinct stable steps', () => {
    const persistedCompleted = {
      ...envelope('persisted-thinking-step-1', 4),
      eventType: 'LLM_THINKING_DELTA',
      payload: {
        text: 'inspect access rules',
        stepId: 'turn-1',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const liveCompleted = {
      ...envelope('live-thinking-step-2', 5),
      eventType: 'LLM_THINKING_DELTA',
      timelineEventRef: null,
      payload: {
        text: 'inspect access rules',
        stepId: 'turn-2',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [liveCompleted],
      eventEnvelopes: [persistedCompleted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['persisted-thinking-step-1', 'live-thinking-step-2']);
  });

  it('does not infer thinking identity when stepId is missing', () => {
    const persistedCompleted = {
      ...envelope('persisted-thinking-without-step', 4),
      eventType: 'LLM_THINKING_DELTA',
      payload: {
        text: 'inspect access rules',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const liveCompleted = {
      ...envelope('live-thinking-without-step', 5),
      eventType: 'LLM_THINKING_DELTA',
      timelineEventRef: null,
      payload: {
        text: 'inspect access rules',
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [liveCompleted],
      eventEnvelopes: [persistedCompleted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['persisted-thinking-without-step', 'live-thinking-without-step']);
  });

  it('adds only matching process facts without duplicating base messages or answer deltas', () => {
    const base = envelope('base-tool-result', 20);
    const thinking = {
      ...envelope('thinking-1', 2),
      eventType: 'LLM_THINKING_DELTA',
      payload: { text: 'reasoning' },
    } as StreamEnvelope;
    const answer = {
      ...envelope('answer-1', 3),
      eventType: 'LLM_CONTENT_DELTA',
      payload: { text: 'answer' },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [base],
      eventEnvelopes: [thinking, answer, { ...thinking, eventId: base.eventId }, { ...thinking, eventId: 'other-run', runId: 'run-other' }],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['thinking-1', 'base-tool-result']);
    expect(result[0]?.transportHints).toContain('history-load');
  });

  it('restores a persisted Workflow NODE_COMPLETED structured ANSWER as process history', () => {
    const terminalAnswer = {
      ...envelope('terminal-answer', 20),
      payload: {
        status: 'COMPLETED',
        content: 'The diagnosis is complete.',
        text: 'The diagnosis is complete.',
      },
    } as StreamEnvelope;
    const workflowAnswer = {
      ...envelope('workflow-piu-answer', 3),
      eventType: 'TOOL_STRUCTURED_DELTA',
      payload: {
        capabilityId: 'render-result',
        toolCallId: 'workflow:workflow-execution-1:render-result',
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content: { piuName: 'ranDiagnosis', piuVersion: '1.0.0' },
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [terminalAnswer],
      eventEnvelopes: [workflowAnswer],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['workflow-piu-answer', 'terminal-answer']);
    expect(result[0]?.transportHints).toContain('history-load');
    expect(result[0]?.payload).toMatchObject({
      workflowEventType: 'NODE_COMPLETED',
      toolEventType: 'ANSWER',
      toolMessageType: 'PIU',
      content: { piuName: 'ranDiagnosis', piuVersion: '1.0.0' },
    });
  });

  it('uses the persisted structured presentation instead of the Message-derived compatibility copy for one Tool call', () => {
    const messageDerived = structuredPresentation('message-derived-structured', 20, 'tool-structured-1', { persisted: false });
    const persisted = structuredPresentation('persisted-structured', 8, 'tool-structured-1');

    const result = composeTurnProcessHistory({
      baseEnvelopes: [messageDerived],
      eventEnvelopes: [persisted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['persisted-structured']);
  });

  it('does not duplicate live structured deltas when Pending Input timeout history loads', () => {
    const liveFirst = {
      ...structuredPresentation('structured-live-1', 2, 'tool-structured-1', { persisted: false }),
      transportHints: [],
    } as StreamEnvelope;
    const liveSecond = {
      ...structuredPresentation('structured-live-2', 3, 'tool-structured-1', { persisted: false }),
      transportHints: [],
    } as StreamEnvelope;
    const persistedFirst = structuredPresentation('structured-live-1', 10, 'tool-structured-1');
    const persistedSecond = structuredPresentation('structured-live-2', 11, 'tool-structured-1');
    const timeout = {
      ...envelope('pending-input-timeout', 12),
      eventType: 'USER_INPUT_TIMEOUT' as const,
      payload: { pendingInputId: 'pending-1', status: 'TIMED_OUT' },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [liveFirst, liveSecond],
      eventEnvelopes: [persistedFirst, persistedSecond, timeout],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    const structured = result.filter((event) => event.eventType === 'TOOL_STRUCTURED_DELTA');
    expect(structured.map((event) => event.eventId)).toEqual(['structured-live-1', 'structured-live-2']);
    expect(result.some((event) => event.eventType === 'USER_INPUT_TIMEOUT')).toBe(true);
  });

  it('deduplicates live and persisted structured presentations with the same eventId', () => {
    const live = {
      ...structuredPresentation('structured-shared', 8, 'tool-structured-1', { persisted: false }),
      transportHints: [],
    } as StreamEnvelope;
    const persisted = structuredPresentation('structured-shared', 9, 'tool-structured-1');

    const result = composeTurnProcessHistory({
      baseEnvelopes: [live],
      eventEnvelopes: [persisted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.eventId).toBe('structured-shared');
  });

  it('keeps the Message-derived ordinary ANSWER when its persisted Event is excluded from process history', () => {
    const messageDerived = structuredPresentation('message-derived-answer', 20, 'tool-answer-1', {
      persisted: false,
      toolEventType: 'ANSWER',
    });
    const persisted = structuredPresentation('persisted-answer', 8, 'tool-answer-1', { toolEventType: 'ANSWER' });

    const result = composeTurnProcessHistory({
      baseEnvelopes: [messageDerived],
      eventEnvelopes: [persisted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['message-derived-answer']);
  });

  it('keeps a Message-derived structured presentation when no persisted copy exists', () => {
    const messageDerived = structuredPresentation('legacy-message-derived-structured', 20, 'legacy-tool-structured', { persisted: false });

    const result = composeTurnProcessHistory({
      baseEnvelopes: [messageDerived],
      eventEnvelopes: [],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['legacy-message-derived-structured']);
  });

  it('does not suppress a different Tool call Message-derived structured presentation', () => {
    const messageDerived = structuredPresentation('message-derived-tool-b', 20, 'tool-b', { persisted: false });
    const persisted = structuredPresentation('persisted-tool-a', 8, 'tool-a');

    const result = composeTurnProcessHistory({
      baseEnvelopes: [messageDerived],
      eventEnvelopes: [persisted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['persisted-tool-a', 'message-derived-tool-b']);
  });

  it('does not suppress the current run Message-derived presentation because another run has the same Tool call id', () => {
    const messageDerived = structuredPresentation('message-derived-current-run', 20, 'shared-tool-call', { persisted: false });
    const otherRunPersisted = structuredPresentation('persisted-other-run', 8, 'shared-tool-call', { runId: 'run-other' });

    const result = composeTurnProcessHistory({
      baseEnvelopes: [messageDerived],
      eventEnvelopes: [otherRunPersisted],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['message-derived-current-run']);
  });

  it('uses canonical event order and enriches a tool lifecycle with its message result once', () => {
    const toolResult = {
      ...envelope('message-tool-result', 900),
      eventType: 'CAPABILITY_RESULT_DELTA',
      payload: {
        capabilityId: 'message-capability',
        toolCallId: 'tool-1',
        toolName: 'message-tool-name',
        status: 'FAILED',
        content: 'Router audit result',
        text: 'Router audit result',
        safeResult: { compliant: true },
      },
    } as StreamEnvelope;
    const canonical = [
      {
        ...envelope('thinking-1', 1),
        eventType: 'LLM_THINKING_DELTA',
        payload: { text: 'inspect access rules' },
      },
      {
        ...envelope('tool-started', 2),
        eventType: 'CAPABILITY_STARTED',
        payload: { capabilityId: 'router-audit', toolCallId: 'tool-1' },
      },
      {
        ...envelope('tool-completed', 3),
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          capabilityId: 'router-audit',
          toolCallId: 'tool-1',
          toolName: 'canonical-router-audit',
          status: 'SUCCEEDED',
          content: '',
          text: '',
        },
      },
      {
        ...envelope('thinking-2', 4),
        eventType: 'LLM_THINKING_DELTA',
        payload: { text: 'validate result' },
      },
    ] as StreamEnvelope[];

    const result = composeTurnProcessHistory({
      baseEnvelopes: [toolResult],
      eventEnvelopes: [canonical[2]!, canonical[0]!, canonical[3]!, canonical[1]!],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['thinking-1', 'tool-started', 'tool-completed', 'thinking-2']);
    expect(
      result.filter(
        (event) =>
          (event.payload as Record<string, unknown>).toolCallId === 'tool-1' &&
          (event.eventType === 'CAPABILITY_COMPLETED' || event.eventType === 'CAPABILITY_RESULT_DELTA'),
      ),
    ).toHaveLength(1);
    expect(result[2]?.payload).toMatchObject({
      capabilityId: 'router-audit',
      toolCallId: 'tool-1',
      toolName: 'canonical-router-audit',
      status: 'SUCCEEDED',
      content: 'Router audit result',
      text: 'Router audit result',
      safeResult: { compliant: true },
    });
  });

  it('replaces the live process-content snapshot with one persisted completed step', () => {
    const liveProcessContent = {
      ...envelope('live-process-content', 2),
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      payload: {
        content: 'I will inspect',
        stepId: 'turn-1',
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;
    const persistedProcessContent = {
      ...envelope('persisted-process-content', 3),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: 'I will inspect the network evidence.',
        stepId: 'turn-1',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const finalAnswer = {
      ...envelope('assistant-answer', 4),
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      payload: {
        role: 'ASSISTANT',
        content: 'The backbone link is healthy.',
        stepId: 'turn-2',
        final: true,
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [liveProcessContent, finalAnswer],
      eventEnvelopes: [persistedProcessContent],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['persisted-process-content', 'assistant-answer']);
    expect(result.filter((event) => (event.payload as Record<string, unknown>).stepId === 'turn-1')).toHaveLength(1);
  });

  it('does not let a persisted pre-input completion remove a post-input live snapshot with the same step id', () => {
    const persistedBeforeInput = {
      ...envelope('persisted-before-input', 1),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: '正在调用意图识别工具',
        stepId: 'turn-2',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const inputReceived = {
      ...envelope('input-received', 2),
      eventType: 'USER_INPUT_RECEIVED',
      payload: { pendingInputId: 'pending-1' },
    } as StreamEnvelope;
    const liveAfterInput = {
      ...envelope('live-after-input', 3),
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      payload: {
        content: '已获取补充信息，调用数据查询工具中',
        stepId: 'turn-2',
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [inputReceived, liveAfterInput],
      eventEnvelopes: [persistedBeforeInput, inputReceived],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result.map((event) => event.eventId)).toEqual(['persisted-before-input', 'input-received', 'live-after-input']);
  });

  it('keeps the accepted-input boundary before a later persisted occurrence when the base layer already contains that boundary', () => {
    const persistedBeforeInput = {
      ...envelope('persisted-before-input', 2),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: '正在调用意图识别工具',
        stepId: 'turn-2',
        completed: true,
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;
    const inputReceived = {
      ...envelope('input-received', 9),
      eventType: 'USER_INPUT_RECEIVED',
      payload: { pendingInputId: 'pending-1' },
    } as StreamEnvelope;
    const persistedAfterInput = {
      ...envelope('persisted-after-input', 10),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: '已获取补充信息，调用数据查询工具中',
        stepId: 'turn-2',
        completed: true,
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;
    const finalAnswer = {
      ...envelope('assistant-answer', 2),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        role: 'ASSISTANT',
        content: '查询准备完成',
        final: true,
        metadata: { accumulated: true },
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [inputReceived, finalAnswer],
      eventEnvelopes: [persistedBeforeInput, inputReceived, persistedAfterInput],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });
    const explanations = buildProcessEntries(result, i18n.t).filter((entry) => entry.kind === 'process-explanation');

    expect(result.map((event) => event.eventId)).toEqual(['persisted-before-input', 'input-received', 'persisted-after-input', 'assistant-answer']);
    expect(explanations.map((entry) => entry.rawDetail)).toEqual(['正在调用意图识别工具', '已获取补充信息，调用数据查询工具中']);
  });

  it('does not recover a missing referenced result from the conversation message projection', () => {
    const messageResult = {
      ...envelope('message-tool-result', 2),
      eventType: 'CAPABILITY_RESULT_DELTA',
      payload: {
        role: 'CAPABILITY_RESULT',
        capabilityId: 'routerAudit',
        toolCallId: 'tool-1',
        content: 'conversation fallback must not be used',
      },
    } as StreamEnvelope;
    const unavailableCompletion = {
      ...envelope('tool-completed', 3),
      eventType: 'CAPABILITY_COMPLETED',
      payload: {
        capabilityId: 'routerAudit',
        toolCallId: 'tool-1',
        status: 'SUCCEEDED',
        contentUnavailable: true,
        content: '',
        text: '',
      },
    } as StreamEnvelope;

    const result = composeTurnProcessHistory({
      baseEnvelopes: [messageResult],
      eventEnvelopes: [unavailableCompletion],
      sessionId: 'session-1',
      rootMessageId: 'root-1',
      runId: 'run-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      eventId: 'tool-completed',
      payload: {
        toolCallId: 'tool-1',
        contentUnavailable: true,
        content: '',
      },
    });
    expect(JSON.stringify(result)).not.toContain('conversation fallback must not be used');
  });
});

describe('selectVisibleProcessRunTargets', () => {
  it('selects the latest visible assistant retry run for each root', () => {
    const targets = selectVisibleProcessRunTargets([
      message('user-1', 1, 'USER', 'run-old'),
      message('assistant-old', 2, 'ASSISTANT', 'run-old'),
      message('assistant-hidden', 3, 'ASSISTANT', 'run-hidden', { visible: false }),
      message('assistant-new', 4, 'ASSISTANT', 'run-new'),
    ]);

    expect(targets).toEqual([
      {
        sessionId: 'session-1',
        rootMessageId: 'root-1',
        runId: 'run-new',
      },
    ]);
  });

  it('falls back to the latest visible non-summary run when no assistant exists', () => {
    const targets = selectVisibleProcessRunTargets([
      message('user-failed', 1, 'USER', 'run-failed'),
      message('summary', 2, 'SUMMARY', 'run-summary'),
    ]);

    expect(targets).toEqual([
      {
        sessionId: 'session-1',
        rootMessageId: 'root-1',
        runId: 'run-failed',
      },
    ]);
  });

  it('ignores blank run ids and deduplicates a run selected by multiple roots', () => {
    const targets = selectVisibleProcessRunTargets([
      message('root-a', 1, 'USER', ' ', { rootMessageId: '' }),
      message('assistant-a', 2, 'ASSISTANT', 'run-shared', { rootMessageId: 'root-a' }),
      message('root-b', 3, 'USER', 'run-shared', { rootMessageId: '' }),
      message('assistant-b', 4, 'ASSISTANT', 'run-shared', { rootMessageId: 'root-b' }),
      message('root-c', 5, 'USER', null, { rootMessageId: '' }),
    ]);

    expect(targets).toEqual([
      {
        sessionId: 'session-1',
        rootMessageId: 'root-a',
        runId: 'run-shared',
      },
    ]);
  });

  it('keeps distinct selected runs for multiple roots in visible sequence order', () => {
    const targets = selectVisibleProcessRunTargets([
      message('root-b', 3, 'USER', 'run-b', { rootMessageId: '' }),
      message('assistant-a', 2, 'ASSISTANT', 'run-a', { rootMessageId: 'root-a' }),
      message('root-a', 1, 'USER', 'run-a', { rootMessageId: '' }),
      message('assistant-b', 4, 'ASSISTANT', 'run-b', { rootMessageId: 'root-b' }),
    ]);

    expect(targets.map((target) => target.runId)).toEqual(['run-a', 'run-b']);
  });
});

describe('loadCompleteRunProcessHistory', () => {
  it('assembles input-segmented process explanations across pages before projection', async () => {
    const beforeInput = {
      ...envelope('before-input', 1),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: '正在调用意图识别工具',
        stepId: 'turn-2',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const inputReceived = {
      ...envelope('input-received', 2),
      eventType: 'USER_INPUT_RECEIVED',
      payload: { pendingInputId: 'pending-1' },
    } as StreamEnvelope;
    const afterInput = {
      ...envelope('after-input', 3),
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: '已获取补充信息，调用数据查询工具中',
        stepId: 'turn-2',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    } as StreamEnvelope;
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ availability: 'AVAILABLE', events: [beforeInput], nextAfterSequence: 1 } satisfies SessionRunEventHistoryPage)
      .mockResolvedValueOnce({ availability: 'AVAILABLE', events: [inputReceived, afterInput] } satisfies SessionRunEventHistoryPage);

    const history = await loadCompleteRunProcessHistory({ sessionId: 'session-1', runId: 'run-1', loadPage });

    expect(history.availability).toBe('AVAILABLE');
    const entries = buildProcessEntries(history.items, i18n.t).filter((entry) => entry.kind === 'process-explanation');
    expect(entries.map((entry) => [entry.rawDetail, entry.sequence])).toEqual([
      ['正在调用意图识别工具', 1],
      ['已获取补充信息，调用数据查询工具中', 3],
    ]);
  });

  it('loads every page, propagates the signal, deduplicates event ids, and sorts by sequence', async () => {
    const abortController = new AbortController();
    const loadPage = vi
      .fn<
        (query: { sessionId: string; runId: string; afterSequence: number; limit: 1000; signal?: AbortSignal }) => Promise<SessionRunEventHistoryPage>
      >()
      .mockResolvedValueOnce({
        availability: 'AVAILABLE',
        events: [envelope('event-3', 3), envelope('event-1', 1)],
        nextAfterSequence: 3,
      })
      .mockResolvedValueOnce({
        availability: 'AVAILABLE',
        events: [envelope('event-3', 3), envelope('event-2', 2)],
      });

    const result = await loadCompleteRunProcessHistory({
      sessionId: 'session-1',
      runId: 'run-1',
      signal: abortController.signal,
      loadPage,
    });

    expect(loadPage).toHaveBeenNthCalledWith(1, {
      sessionId: 'session-1',
      runId: 'run-1',
      afterSequence: 0,
      limit: 1000,
      signal: abortController.signal,
    });
    expect(loadPage).toHaveBeenNthCalledWith(2, {
      sessionId: 'session-1',
      runId: 'run-1',
      afterSequence: 3,
      limit: 1000,
      signal: abortController.signal,
    });
    expect(result).toEqual({
      availability: 'AVAILABLE',
      items: [envelope('event-1', 1), envelope('event-2', 2), envelope('event-3', 3)],
    });
  });

  it('returns legacy unavailable without requesting another page', async () => {
    const loadPage = vi.fn().mockResolvedValue({
      availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
      events: [],
    } satisfies SessionRunEventHistoryPage);

    await expect(
      loadCompleteRunProcessHistory({
        sessionId: 'session-1',
        runId: 'run-1',
        loadPage,
      }),
    ).resolves.toEqual({
      availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
      items: [],
    });
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['repeated', 3],
    ['decreasing', 2],
  ])('rejects a %s pagination cursor', async (_label, invalidCursor) => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({
        availability: 'AVAILABLE',
        events: [envelope('event-1', 1)],
        nextAfterSequence: 3,
      } satisfies SessionRunEventHistoryPage)
      .mockResolvedValueOnce({
        availability: 'AVAILABLE',
        events: [envelope('event-2', 2)],
        nextAfterSequence: invalidCursor,
      } satisfies SessionRunEventHistoryPage);

    await expect(
      loadCompleteRunProcessHistory({
        sessionId: 'session-1',
        runId: 'run-1',
        loadPage,
      }),
    ).rejects.toThrow('cursor');
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['session', { sessionId: 'session-other' }],
    ['run', { runId: 'run-other' }],
  ])('rejects an envelope from another %s', async (_coordinate, override) => {
    const loadPage = vi.fn().mockResolvedValue({
      availability: 'AVAILABLE',
      events: [{ ...envelope('event-1', 1), ...override }],
    } satisfies SessionRunEventHistoryPage);

    await expect(
      loadCompleteRunProcessHistory({
        sessionId: 'session-1',
        runId: 'run-1',
        loadPage,
      }),
    ).rejects.toThrow('coordinate');
  });

  it('propagates abort to the next page request', async () => {
    const abortController = new AbortController();
    const loadPage = vi.fn((query: { afterSequence: number; signal?: AbortSignal }) => {
      if (query.afterSequence === 0) {
        abortController.abort();
        return Promise.resolve({
          availability: 'AVAILABLE',
          events: [envelope('event-1', 1)],
          nextAfterSequence: 1,
        } satisfies SessionRunEventHistoryPage);
      }
      expect(query.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    await expect(
      loadCompleteRunProcessHistory({
        sessionId: 'session-1',
        runId: 'run-1',
        signal: abortController.signal,
        loadPage,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadPage).toHaveBeenCalledTimes(2);
  });
});

describe('runProcessHistoryQueue', () => {
  it('starts at most four run loads and eventually processes the fifth', async () => {
    const resolvers: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const worker = vi.fn(
      (runId: string) =>
        new Promise<void>((resolve) => {
          started.push(runId);
          active += 1;
          peak = Math.max(peak, active);
          resolvers.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );

    const queuePromise = runProcessHistoryQueue(['run-1', 'run-2', 'run-3', 'run-4', 'run-5'], worker);
    await Promise.resolve();
    expect(started).toEqual(['run-1', 'run-2', 'run-3', 'run-4']);

    resolvers[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toContain('run-5');

    resolvers.slice(1).forEach((resolve) => resolve());
    await Promise.resolve();
    resolvers[4]?.();
    await queuePromise;
    expect(peak).toBe(4);
    expect(worker).toHaveBeenCalledTimes(5);
  });

  it('does not start queued loads after abort', async () => {
    const abortController = new AbortController();
    const resolvers: Array<() => void> = [];
    const started: string[] = [];
    const worker = vi.fn(
      (runId: string) =>
        new Promise<void>((resolve) => {
          started.push(runId);
          resolvers.push(resolve);
        }),
    );

    const queuePromise = runProcessHistoryQueue(['run-1', 'run-2', 'run-3', 'run-4', 'run-5'], worker, abortController.signal);
    await Promise.resolve();
    abortController.abort();
    resolvers.forEach((resolve) => resolve());
    await queuePromise;

    expect(started).toEqual(['run-1', 'run-2', 'run-3', 'run-4']);
  });
});
