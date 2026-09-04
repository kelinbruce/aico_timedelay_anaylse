import { describe, expect, it } from 'vitest';
import i18n from '../src/i18n/index.ts';
import { buildAnswerContent } from '../src/features/chat/presentation/answerContent.ts';
import {
  buildSessionHistoryProjection,
  buildSessionProjection,
  overlaySessionLiveProjection,
} from '../src/features/chat/view-model/buildSessionProjection.ts';
import { buildProcessDisplayEntries, buildProcessEntries } from '../src/features/chat/process/processDetails.ts';
import type { SessionConversationMessage, StreamEnvelope } from '../src/state/contracts.ts';

function makeEnvelope(overrides: Partial<StreamEnvelope>): StreamEnvelope {
  return {
    eventId: 'evt-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    createdAt: '2026-04-19T12:00:00.000Z',
    payload: { content: 'content', role: 'ASSISTANT', rootMessageId: 'req-1' },
    ...overrides,
  } as StreamEnvelope;
}

function makeConversationMessage(overrides: Partial<SessionConversationMessage>): SessionConversationMessage {
  return {
    messageId: 'msg-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    runId: 'run-1',
    requestContextId: 'req-1',
    rootMessageId: 'req-1',
    role: 'ASSISTANT',
    sequence: 1,
    content: 'content',
    contentType: 'MARKDOWN',
    metadata: {},
    createdAt: '2026-04-19T12:00:00.000Z',
    visible: true,
    ...overrides,
  };
}

function makeConversationMessageWithoutRoot(overrides: Partial<SessionConversationMessage>): SessionConversationMessage {
  const message = makeConversationMessage(overrides);
  delete (message as { rootMessageId?: string }).rootMessageId;
  return message;
}

function makeConversationMessageWithoutRequestContext(overrides: Partial<SessionConversationMessage>): SessionConversationMessage {
  const message = makeConversationMessage(overrides);
  delete (message as { requestContextId?: string }).requestContextId;
  return message;
}

describe('buildSessionProjection', () => {
  it('hides the previous attempt process while retry acceptance is pending', () => {
    const projection = buildSessionProjection({
      historyMessages: [
        makeConversationMessage({
          messageId: 'retry-pending-user',
          requestId: 'retry-pending-root',
          rootMessageId: 'retry-pending-root',
          runId: 'previous-run',
          role: 'USER',
          content: 'check router',
        }),
        makeConversationMessage({
          messageId: 'retry-pending-answer',
          requestId: 'retry-pending-root',
          rootMessageId: 'retry-pending-root',
          runId: 'previous-run',
          role: 'ASSISTANT',
          sequence: 2,
          content: 'previous answer',
        }),
      ],
      historyEnvelopes: [
        makeEnvelope({
          eventId: 'retry-pending-thinking',
          requestId: 'retry-pending-root',
          rootMessageId: 'retry-pending-root',
          runId: 'previous-run',
          eventType: 'LLM_THINKING_DELTA',
          payload: {
            rootMessageId: 'retry-pending-root',
            reasoning: 'previous thinking',
            stepId: 'turn-1',
            metadata: { accumulated: true, completed: true },
          },
        }),
      ],
      activeEnvelopes: [],
      pendingRetryRootMessageId: 'retry-pending-root',
    });

    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]?.userMessage.content).toBe('check router');
    expect(projection.turnBlocks[0]?.aiEvents).toEqual([]);
  });

  it('shows the new retry run stream without restoring the pending attempt history', () => {
    const projection = buildSessionProjection({
      historyMessages: [
        makeConversationMessage({
          messageId: 'retry-stream-user',
          requestId: 'retry-stream-root',
          rootMessageId: 'retry-stream-root',
          runId: 'previous-run',
          role: 'USER',
          content: 'check router',
        }),
        makeConversationMessage({
          messageId: 'retry-stream-answer',
          requestId: 'retry-stream-root',
          rootMessageId: 'retry-stream-root',
          runId: 'previous-run',
          role: 'ASSISTANT',
          sequence: 2,
          content: 'previous answer',
        }),
      ],
      historyEnvelopes: [
        makeEnvelope({
          eventId: 'retry-stream-old-thinking',
          requestId: 'retry-stream-root',
          rootMessageId: 'retry-stream-root',
          runId: 'previous-run',
          eventType: 'LLM_THINKING_DELTA',
          payload: {
            rootMessageId: 'retry-stream-root',
            reasoning: 'previous thinking',
            stepId: 'turn-1',
            metadata: { accumulated: true, completed: true },
          },
        }),
      ],
      activeEnvelopes: [
        makeEnvelope({
          eventId: 'retry-stream-new-thinking',
          requestId: 'retry-stream-root',
          rootMessageId: 'retry-stream-root',
          runId: 'retry-run',
          eventType: 'LLM_THINKING_DELTA',
          payload: {
            rootMessageId: 'retry-stream-root',
            reasoning: 'new thinking',
            stepId: 'turn-1',
            metadata: { accumulated: true },
          },
        }),
      ],
      pendingRetryRootMessageId: 'retry-stream-root',
    });

    expect(projection.turnBlocks[0]?.aiEvents.map((event) => event.eventId)).toEqual(['retry-stream-new-thinking']);
  });

  it('keeps persisted process-history authority separate from live retry identity', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'retry-user',
        requestId: 'retry-root',
        rootMessageId: 'retry-root',
        runId: 'previous-run',
        requestContextId: 'previous-context',
        role: 'USER',
        content: 'check router',
      }),
      makeConversationMessage({
        messageId: 'previous-answer',
        requestId: 'retry-root',
        rootMessageId: 'retry-root',
        runId: 'previous-run',
        requestContextId: 'previous-context',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'previous answer',
      }),
    ];
    const retryThinking = makeEnvelope({
      eventId: 'retry-thinking',
      requestId: 'retry-root',
      rootMessageId: 'retry-root',
      runId: 'retry-run',
      requestContextId: 'retry-context',
      sequence: 3,
      eventType: 'LLM_THINKING_DELTA',
      payload: {
        text: 'running retry',
        metadata: { accumulated: true },
      },
      createdAt: '2026-04-19T12:00:03.000Z',
    });
    const historyProjection = buildSessionHistoryProjection({
      historyMessages,
      historyEnvelopes: [],
      displayRunByRoot: { 'retry-root': 'previous-run' },
    });

    const liveProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [retryThinking],
      activeRun: { requestId: 'retry-root', runId: 'retry-run', status: 'EXECUTING' },
    });
    const settledProjection = overlaySessionLiveProjection({
      historyProjection,
      settledEnvelopes: [retryThinking],
      activeEnvelopes: [],
      activeRun: null,
      latestPersistedRunStatus: 'COMPLETED',
    });

    expect(historyProjection.historicalTurnBlocks[0]?.displayRunId).toBe('previous-run');
    expect(liveProjection.turnBlocks[0]?.displayRunId).toBe('previous-run');
    expect(settledProjection.turnBlocks[0]?.displayRunId).toBe('previous-run');
  });

  it('preserves unchanged history blocks across request lifecycle and first live activity', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'user-1',
        requestId: 'req-1',
        rootMessageId: 'req-1',
        role: 'USER',
        content: 'question 1',
      }),
      makeConversationMessage({
        messageId: 'assistant-1',
        requestId: 'req-1',
        rootMessageId: 'req-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'answer 1',
      }),
      makeConversationMessage({
        messageId: 'user-2',
        requestId: 'req-2',
        rootMessageId: 'req-2',
        role: 'USER',
        sequence: 3,
        content: 'question 2',
      }),
      makeConversationMessage({
        messageId: 'assistant-2',
        requestId: 'req-2',
        rootMessageId: 'req-2',
        role: 'ASSISTANT',
        sequence: 4,
        content: 'answer 2',
      }),
      makeConversationMessage({
        messageId: 'user-3',
        requestId: 'req-3',
        rootMessageId: 'req-3',
        role: 'USER',
        sequence: 5,
        content: 'question 3',
      }),
      makeConversationMessage({
        messageId: 'assistant-3',
        requestId: 'req-3',
        rootMessageId: 'req-3',
        role: 'ASSISTANT',
        sequence: 6,
        content: 'partial answer 3',
      }),
    ];
    const historyProjection = buildSessionHistoryProjection({
      historyMessages,
      historyEnvelopes: [],
    });
    const settledProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [],
      activeRun: null,
    });
    const executingProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [],
      activeRun: { requestId: 'req-3', runId: 'run-3', status: 'EXECUTING' },
    });
    const terminalProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [],
      activeRun: { requestId: 'req-3', runId: 'run-3', status: 'FAILED' },
    });
    const firstLiveProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [
        makeEnvelope({
          eventId: 'live-user-4',
          requestId: 'req-4',
          rootMessageId: 'req-4',
          eventType: 'REQUEST_ACCEPTED',
          transportHints: ['local-optimistic'],
          payload: { content: 'question 4', role: 'USER', rootMessageId: 'req-4', messageId: 'req-4' },
        }),
      ],
      activeRun: { requestId: 'req-4', runId: 'run-4', status: 'ACCEPTED' },
    });

    // No activeRun and no terminal event in history: don't fabricate COMPLETED.
    expect(settledProjection.turnBlocks[2]?.status).toBe('EXECUTING');
    expect(executingProjection.turnBlocks[2]?.status).toBe('EXECUTING');
    expect(terminalProjection.turnBlocks[2]?.status).toBe('FAILED');
    for (const projection of [settledProjection, executingProjection, terminalProjection, firstLiveProjection]) {
      expect(projection.historicalTurnBlocks[0]).toBe(historyProjection.historicalTurnBlocks[0]);
      expect(projection.historicalTurnBlocks[1]).toBe(historyProjection.historicalTurnBlocks[1]);
    }
    expect(firstLiveProjection.turnBlocks).toHaveLength(4);
  });

  it('reuses historical turn references across successive live overlays', () => {
    const historyEnvelopes = [
      makeEnvelope({
        eventId: 'history-1',
        requestId: 'req-1',
        rootMessageId: 'req-1',
        transportHints: ['history-load'],
        createdAt: '2026-04-19T12:00:00.000Z',
      }),
      makeEnvelope({
        eventId: 'history-2',
        requestId: 'req-2',
        rootMessageId: 'req-2',
        transportHints: ['history-load'],
        createdAt: '2026-04-19T12:01:00.000Z',
      }),
    ];
    const historyProjection = buildSessionHistoryProjection({
      historyMessages: [],
      historyEnvelopes,
    });
    const firstLiveEnvelope = makeEnvelope({
      eventId: 'live-1',
      requestId: 'req-2',
      rootMessageId: 'req-2',
      sequence: 2,
      createdAt: '2026-04-19T12:01:01.000Z',
    });
    const firstProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [firstLiveEnvelope],
    });
    const secondProjection = overlaySessionLiveProjection({
      historyProjection,
      activeEnvelopes: [
        firstLiveEnvelope,
        makeEnvelope({
          eventId: 'live-2',
          requestId: 'req-2',
          rootMessageId: 'req-2',
          sequence: 3,
          createdAt: '2026-04-19T12:01:02.000Z',
        }),
      ],
    });

    expect(firstProjection.historicalTurnBlocks).toBe(historyProjection.historicalTurnBlocks);
    expect(secondProjection.historicalTurnBlocks).toBe(historyProjection.historicalTurnBlocks);
    expect(secondProjection.turnBlocks[0]).toBe(firstProjection.turnBlocks[0]);
    expect(secondProjection.turnBlocks[1]).not.toBe(firstProjection.turnBlocks[1]);
  });

  it('keeps a completed thinking event when durable message and event sequences overlap', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'root-overlap',
        requestId: 'request-overlap',
        runId: 'run-overlap',
        requestContextId: 'context-overlap',
        rootMessageId: 'root-overlap',
        role: 'USER',
        sequence: 1,
        content: 'check router policy',
        createdAt: '2026-07-22T00:00:00.000Z',
      }),
      makeConversationMessage({
        messageId: 'assistant-overlap',
        requestId: 'request-overlap',
        runId: 'run-overlap',
        requestContextId: 'context-overlap',
        rootMessageId: 'root-overlap',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'router is compliant',
        createdAt: '2026-07-22T00:00:02.000Z',
      }),
    ];
    const completedThinking = makeEnvelope({
      eventId: 'thinking-overlap',
      requestId: 'request-overlap',
      runId: 'run-overlap',
      requestContextId: 'context-overlap',
      rootMessageId: 'root-overlap',
      sequence: 1,
      eventType: 'LLM_THINKING_DELTA',
      transportHints: ['history-load'],
      payload: {
        text: 'checked router policy',
        metadata: { accumulated: true, completed: true },
      },
      createdAt: '2026-07-22T00:00:01.000Z',
    });

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [completedThinking],
      activeEnvelopes: [],
      displayRunByRoot: { 'root-overlap': 'run-overlap' },
    });

    expect(projection.turnBlocks[0]?.aiEvents.map((event) => event.eventId)).toContain('thinking-overlap');
    expect(buildProcessEntries(projection.turnBlocks[0]?.aiEvents ?? [], i18n.t)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'thinking', detail: 'checked router policy' })]),
    );
  });

  it('keeps selected-run process events when message history omits requestContextId', () => {
    const historyMessages = [
      makeConversationMessageWithoutRequestContext({
        messageId: 'root-real-shape',
        requestId: 'request-real-shape',
        runId: 'run-real-shape',
        rootMessageId: 'root-real-shape',
        role: 'USER',
        sequence: 1,
        content: 'what is AMF',
        createdAt: '2026-07-22T01:00:00.000Z',
      }),
      makeConversationMessageWithoutRequestContext({
        messageId: 'assistant-real-shape',
        requestId: 'request-real-shape',
        runId: 'run-real-shape',
        rootMessageId: 'root-real-shape',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'AMF is a 5G core network function.',
        createdAt: '2026-07-22T01:00:02.000Z',
      }),
    ];
    const completedThinking = makeEnvelope({
      eventId: 'thinking-real-shape',
      requestId: 'request-real-shape',
      runId: 'run-real-shape',
      requestContextId: 'context-real-shape',
      rootMessageId: 'root-real-shape',
      sequence: 1,
      eventType: 'LLM_THINKING_DELTA',
      transportHints: ['history-load'],
      payload: {
        content: 'checking AMF responsibilities',
        metadata: { accumulated: true, completed: true },
      },
      createdAt: '2026-07-22T01:00:01.000Z',
    });

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [completedThinking],
      activeEnvelopes: [],
      displayRunByRoot: { 'root-real-shape': 'run-real-shape' },
    });
    const block = projection.turnBlocks[0]!;

    expect(block.aiEvents.map((event) => event.eventId)).toContain('thinking-real-shape');
    expect(buildProcessEntries(block.aiEvents, i18n.t)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'thinking', detail: 'checking AMF responsibilities', isFinal: true })]),
    );
    expect(buildAnswerContent(block.aiEvents)).toBe('AMF is a 5G core network function.');
  });

  it('projects persisted process events with message-owned answer and event-owned capability result like completed live data', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'user-1',
        role: 'USER',
        sequence: 1,
        content: 'check router policy',
      }),
      makeConversationMessage({
        messageId: 'capability-result-1',
        role: 'CAPABILITY_RESULT',
        sequence: 4,
        content: 'router policy is compliant',
        contentType: 'PLAIN_TEXT',
        metadata: { toolCallId: 'tool-1', toolName: 'routerAudit', status: 'SUCCEEDED' },
      }),
      makeConversationMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 6,
        content: 'The router configuration is compliant.',
      }),
    ];
    const persistedProcessEvents = [
      makeEnvelope({
        eventId: 'thinking-1',
        runId: 'run-1',
        rootMessageId: 'req-1',
        requestContextId: 'req-1',
        sequence: 2,
        eventType: 'LLM_THINKING_DELTA',
        transportHints: ['history-load'],
        payload: {
          text: 'checking router policy',
          metadata: { accumulated: true, completed: true },
        },
      }),
      makeEnvelope({
        eventId: 'capability-started-1',
        runId: 'run-1',
        rootMessageId: 'req-1',
        requestContextId: 'req-1',
        sequence: 3,
        eventType: 'CAPABILITY_STARTED',
        transportHints: ['history-load'],
        payload: { toolCallId: 'tool-1', toolName: 'routerAudit' },
      }),
      makeEnvelope({
        eventId: 'capability-result-1',
        runId: 'run-1',
        rootMessageId: 'req-1',
        requestContextId: 'req-1',
        sequence: 4,
        eventType: 'CAPABILITY_RESULT_DELTA',
        transportHints: ['history-load'],
        payload: {
          role: 'CAPABILITY_RESULT',
          toolCallId: 'tool-1',
          toolName: 'routerAudit',
          content: '',
          contentType: 'PLAIN_TEXT',
          safeSummary: 'router policy is compliant',
        },
      }),
      makeEnvelope({
        eventId: 'capability-completed-1',
        runId: 'run-1',
        rootMessageId: 'req-1',
        requestContextId: 'req-1',
        sequence: 5,
        eventType: 'CAPABILITY_COMPLETED',
        transportHints: ['history-load'],
        payload: { toolCallId: 'tool-1', toolName: 'routerAudit', status: 'SUCCEEDED' },
      }),
    ];

    const coldProjection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: persistedProcessEvents,
      activeEnvelopes: [],
      displayRunByRoot: { 'req-1': 'run-1' },
    });
    const coldBlock = coldProjection.turnBlocks[0]!;
    const coldEntries = buildProcessDisplayEntries(buildProcessEntries(coldBlock.aiEvents, i18n.t), i18n.t);
    const liveEvents = [
      makeEnvelope({
        eventId: 'live-user',
        eventType: 'REQUEST_ACCEPTED',
        sequence: 1,
        payload: { content: 'check router policy', role: 'USER', rootMessageId: 'req-1' },
      }),
      ...persistedProcessEvents.slice(0, 2).map((event) => ({
        ...event,
        transportHints: ['SSE'],
      })),
      makeEnvelope({
        eventId: 'live-capability-result',
        runId: 'run-1',
        rootMessageId: 'req-1',
        requestContextId: 'req-1',
        sequence: 4,
        eventType: 'CAPABILITY_RESULT_DELTA',
        payload: {
          toolCallId: 'tool-1',
          toolName: 'routerAudit',
          content: '',
          contentType: 'PLAIN_TEXT',
          safeSummary: 'router policy is compliant',
        },
      }),
      {
        ...persistedProcessEvents[3]!,
        transportHints: ['SSE'],
      },
      makeEnvelope({
        eventId: 'live-answer',
        runId: 'run-1',
        rootMessageId: 'req-1',
        requestContextId: 'req-1',
        sequence: 6,
        eventType: 'LLM_CONTENT_DELTA',
        payload: { content: 'The router configuration is compliant.', contentType: 'MARKDOWN' },
      }),
    ];
    const liveProjection = buildSessionProjection({
      historyMessages: [],
      historyEnvelopes: [],
      activeEnvelopes: liveEvents,
    });
    const liveBlock = liveProjection.turnBlocks[0]!;
    const liveEntries = buildProcessDisplayEntries(buildProcessEntries(liveBlock.aiEvents, i18n.t), i18n.t);

    expect(buildAnswerContent(coldBlock.aiEvents)).toBe('The router configuration is compliant.');
    expect(coldBlock.displayRunId).toBe('run-1');
    expect(buildAnswerContent(liveBlock.aiEvents)).toBe('The router configuration is compliant.');
    expect(
      coldEntries.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
        isFinal: entry.isFinal,
      })),
    ).toEqual(
      liveEntries.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
        isFinal: entry.isFinal,
      })),
    );
    expect(coldEntries.filter((entry) => entry.kind === 'thinking')).toHaveLength(1);
    expect(coldEntries.filter((entry) => entry.kind === 'tool')).toHaveLength(1);
    expect(coldEntries.find((entry) => entry.kind === 'tool')).toEqual(expect.objectContaining({ detail: '', isExpandable: false }));
    expect(new Set(coldProjection.historyEnvelopes.map((event) => event.eventId)).size).toBe(coldProjection.historyEnvelopes.length);
  });
  it('prefers raw history messages and overlays layered history envelopes on top', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-1',
        role: 'USER',
        content: 'question',
      }),
      makeConversationMessage({
        messageId: 'msg-2',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'answer',
      }),
    ];
    const layeredHistory = [
      makeEnvelope({
        eventId: 'conv-msg-2-2',
        sequence: 2,
        transportHints: ['history-load', 'local-superseded'],
        payload: {
          content: 'answer',
          contentType: 'MARKDOWN',
          role: 'ASSISTANT',
          messageId: 'msg-2',
          rootMessageId: 'req-1',
          visible: false,
        },
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: layeredHistory,
      activeEnvelopes: [],
    });

    expect(projection.historyEnvelopes).toHaveLength(2);
    expect(projection.historyEnvelopes[1]?.payload.visible).toBe(false);
  });

  it('projects explicit history and active owners', () => {
    const layeredHistory = [makeEnvelope({ eventId: 'layered-history', transportHints: ['history-load'] })];
    const layeredLive = [makeEnvelope({ eventId: 'layered-live', transportHints: ['SSE'], sequence: 3 })];

    const projection = buildSessionProjection({
      historyMessages: [],
      historyEnvelopes: layeredHistory,
      activeEnvelopes: layeredLive,
    });

    expect(projection.historyEnvelopes).toEqual(layeredHistory);
    expect(projection.activeEnvelopes).toEqual(layeredLive);
  });

  it('projects explicit history and settled process owners', () => {
    const historyEnvelopes = [
      makeEnvelope({
        eventId: 'history-user',
        eventType: 'REQUEST_ACCEPTED',
        transportHints: ['history-load'],
        payload: { content: 'question', role: 'USER', rootMessageId: 'req-1', messageId: 'req-1' },
      }),
      makeEnvelope({
        eventId: 'history-answer',
        transportHints: ['history-load'],
        sequence: 2,
      }),
    ];
    const settledEnvelopes = [
      makeEnvelope({
        eventId: 'live-progress',
        eventType: 'CAPABILITY_RESULT_DELTA',
        transportHints: ['SSE'],
        sequence: 3,
        payload: { toolCallId: 'tool-1', progress: 'working...' },
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages: [],
      historyEnvelopes,
      settledEnvelopes,
      activeEnvelopes: [],
    });

    expect(projection.historyEnvelopes).toHaveLength(2);
    expect(projection.settledEnvelopes).toHaveLength(1);
    expect(projection.turnBlocks).toHaveLength(1);
  });

  it('restores terminal turn status from history message metadata after refresh', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-1',
        role: 'USER',
        content: 'question',
        metadata: { status: 'COMPLETED' },
      }),
      makeConversationMessage({
        messageId: 'msg-tool-1',
        role: 'CAPABILITY_RESULT',
        sequence: 2,
        content: 'tool result',
        metadata: { toolCallId: 'tool-1', toolName: 'diagnose' },
      }),
      makeConversationMessage({
        messageId: 'msg-assistant-1',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'answer',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historicalTurnBlocks).toHaveLength(1);
    expect(projection.historicalTurnBlocks[0]!.status).toBe('COMPLETED');
    expect(projection.turnBlocks[0]!.status).toBe('COMPLETED');
  });

  it('restores completed terminal history from assistant message metadata after refresh', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-completed',
        role: 'USER',
        content: 'question',
      }),
      makeConversationMessage({
        messageId: 'msg-assistant-completed',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'answer',
        metadata: {
          eventType: 'REQUEST_COMPLETED',
          status: 'COMPLETED',
        },
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historyEnvelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']);
    expect(projection.historicalTurnBlocks[0]!.status).toBe('COMPLETED');
    expect(buildAnswerContent(projection.historicalTurnBlocks[0]!.aiEvents)).toBe('answer');
  });

  it('restores canceled terminal history messages without treating cancellation text as an answer', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-cancel',
        role: 'USER',
        content: 'cancel this request',
      }),
      makeConversationMessage({
        messageId: 'assistant-terminal-cancel',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'Request canceled by user.',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historyEnvelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_CANCELED']);
    expect(projection.historicalTurnBlocks[0]!.status).toBe('CANCELED');
    expect(buildAnswerContent(projection.historicalTurnBlocks[0]!.aiEvents)).toBe('');
  });

  it('keeps real partial answer content when refreshed canceled history has a terminal message', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-partial-cancel',
        role: 'USER',
        content: 'start and cancel',
      }),
      makeConversationMessage({
        messageId: 'assistant-partial-cancel',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
      }),
      makeConversationMessage({
        messageId: 'assistant-terminal-cancel',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'Request canceled by user.',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historicalTurnBlocks[0]!.status).toBe('CANCELED');
    expect(buildAnswerContent(projection.historicalTurnBlocks[0]!.aiEvents)).toBe('partial answer');
  });

  it('restores failed terminal history messages with a structured error code and no answer fallback', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-failed',
        role: 'USER',
        content: 'run unsafe capability',
      }),
      makeConversationMessage({
        messageId: 'assistant-terminal-failed',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'Request failed safely: CAPABILITY_PATH_REJECTED',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    const failedEvent = projection.historicalTurnBlocks[0]!.aiEvents.find((event) => event.eventType === 'REQUEST_FAILED');
    expect(projection.historyEnvelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_FAILED']);
    expect(projection.historicalTurnBlocks[0]!.status).toBe('FAILED');
    expect(failedEvent?.payload).toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      metadata: {
        code: 'CAPABILITY_PATH_REJECTED',
        eventType: 'REQUEST_FAILED',
        status: 'FAILED',
      },
    });
    expect(buildAnswerContent(projection.historicalTurnBlocks[0]!.aiEvents)).toBe('');
  });

  it('restores failed terminal history messages as partial answers when content is not a safe failure placeholder', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-failed-partial',
        role: 'USER',
        content: 'run then fail',
      }),
      makeConversationMessage({
        messageId: 'assistant-terminal-failed-partial',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'I checked the workspace before the tool failed.',
        metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED' },
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historicalTurnBlocks[0]!.status).toBe('FAILED');
    expect(buildAnswerContent(projection.historicalTurnBlocks[0]!.aiEvents)).toBe('I checked the workspace before the tool failed.');
  });

  it('keeps backend conversation order when persisted sequence is only a placeholder', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-placeholder',
        role: 'USER',
        sequence: 99,
        content: 'question',
      }),
      makeConversationMessage({
        messageId: 'msg-assistant-placeholder',
        role: 'ASSISTANT',
        sequence: 0,
        content: 'answer',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historyEnvelopes.map((envelope) => envelope.payload.messageId)).toEqual(['msg-user-placeholder', 'msg-assistant-placeholder']);
    expect(projection.historyEnvelopes.map((envelope) => envelope.sequence)).toEqual([1, 2]);
  });

  it('groups refreshed tool turns by request id and keeps assistant tool-use JSON out of the answer', () => {
    const historyMessages = [
      makeConversationMessageWithoutRoot({
        messageId: 'req-tool-1',
        requestContextId: null,
        role: 'USER',
        content: 'read skill-smoke.txt',
        metadata: { status: 'COMPLETED' },
      }),
      makeConversationMessageWithoutRoot({
        messageId: 'assistant-tool-use-1',
        requestContextId: null,
        role: 'ASSISTANT',
        sequence: 2,
        content: '{"toolCalls":[{"toolCallId":"tool-1","capabilityId":"read","arguments":{"file_path":"skill-smoke.txt"}}]}',
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-1'] },
      }),
      makeConversationMessageWithoutRoot({
        messageId: 'capability-result-1',
        requestContextId: null,
        role: 'CAPABILITY_RESULT',
        sequence: 3,
        content: '{"toolCallId":"tool-1","payload":{"content":"NextAgent skill smoke fixture."}}',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-1' },
      }),
      makeConversationMessageWithoutRoot({
        messageId: 'assistant-final-1',
        requestContextId: null,
        role: 'ASSISTANT',
        sequence: 4,
        content: 'READ_CONTENT: NextAgent skill smoke fixture.',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.turnBlocks).toHaveLength(1);
    expect(projection.turnBlocks[0]!.rootMessageId).toBe('req-1');
    expect(buildAnswerContent(projection.turnBlocks[0]!.aiEvents)).toBe('READ_CONTENT: NextAgent skill smoke fixture.');
    expect(JSON.stringify(projection.historyEnvelopes)).not.toContain('toolCalls');
  });

  it('does not render NextAgent summary messages as conversation turns', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-summary-1',
        role: 'SUMMARY',
        content: 'Compacted context summary',
      }),
      makeConversationMessage({
        messageId: 'msg-user-1',
        role: 'USER',
        sequence: 2,
        content: 'question',
      }),
      makeConversationMessage({
        messageId: 'msg-assistant-1',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'answer',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
    });

    expect(projection.historyEnvelopes.map((envelope) => envelope.payload.role)).toEqual(['USER', 'ASSISTANT']);
    expect(projection.turnBlocks).toHaveLength(1);
  });

  it('does not fabricate COMPLETED for the latest history answer when terminal event is missing and activeRun is null', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-settled',
        role: 'USER',
        content: 'question',
      }),
      makeConversationMessage({
        messageId: 'msg-assistant-settled',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'answer',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: null,
    });

    // Terminal event is missing; don't fabricate COMPLETED (ts-run-status-visibility).
    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
  });

  it('keeps the latest visible history answer in flight when conversation activeRun is present', () => {
    const historyMessages = [
      makeConversationMessage({
        messageId: 'msg-user-active',
        role: 'USER',
        content: 'question',
      }),
      makeConversationMessage({
        messageId: 'msg-assistant-active',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'partial answer',
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [],
      activeRun: {
        requestId: 'req-1',
        runId: 'run-1',
        status: 'EXECUTING',
      },
    });

    expect(projection.turnBlocks[0]!.status).toBe('EXECUTING');
  });

  it('projects active envelopes without reclassifying them as history', () => {
    const activeEnvelopes = [
      makeEnvelope({
        eventId: 'optimistic-user',
        eventType: 'REQUEST_ACCEPTED',
        transportHints: ['local-optimistic'],
        payload: { content: 'draft', role: 'USER', rootMessageId: 'req-1', messageId: 'req-1' },
      }),
      makeEnvelope({
        eventId: 'live-answer',
        transportHints: ['SSE'],
        sequence: 2,
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages: [],
      historyEnvelopes: [],
      activeEnvelopes,
    });

    expect(projection.historyEnvelopes).toEqual([]);
    expect(projection.activeEnvelopes).toEqual(activeEnvelopes);
    expect(projection.turnBlocks).toHaveLength(1);
  });

  it('keeps the settled answer visible while matching history only contains the user message', () => {
    const historyMessages = [makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' })];
    const settledEnvelopes = [
      makeEnvelope({
        eventId: 'settled-answer',
        eventType: 'LLM_CONTENT_DELTA',
        sequence: 2,
        payload: { role: 'ASSISTANT', content: 'stream answer', rootMessageId: 'req-1' },
      }),
      makeEnvelope({
        eventId: 'settled-terminal',
        eventType: 'REQUEST_COMPLETED',
        sequence: 3,
        payload: { status: 'COMPLETED', rootMessageId: 'req-1' },
      }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes,
      activeEnvelopes: [],
    });

    expect(projection.turnBlocks).toHaveLength(1);
    expect(buildAnswerContent(projection.turnBlocks[0]!.aiEvents)).toBe('stream answer');
  });

  it('keeps history as the final answer owner while settled events retain process detail', () => {
    const historyMessages = [
      makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' }),
      makeConversationMessage({ messageId: 'assistant-1', role: 'ASSISTANT', sequence: 2, content: 'canonical answer' }),
    ];
    const settledEnvelopes = [
      makeEnvelope({
        eventId: 'settled-user',
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'question', rootMessageId: 'req-1' },
      }),
      makeEnvelope({
        eventId: 'settled-thinking',
        eventType: 'LLM_THINKING_DELTA',
        sequence: 2,
        payload: { delta: 'retained reasoning', rootMessageId: 'req-1' },
      }),
      makeEnvelope({
        eventId: 'settled-answer',
        eventType: 'LLM_CONTENT_DELTA',
        sequence: 3,
        payload: { role: 'ASSISTANT', content: 'stream answer', rootMessageId: 'req-1' },
      }),
      makeEnvelope({ eventId: 'settled-terminal', eventType: 'REQUEST_COMPLETED', sequence: 4 }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes,
      activeEnvelopes: [],
    });

    expect(projection.turnBlocks).toHaveLength(1);
    expect(buildAnswerContent(projection.turnBlocks[0]!.aiEvents)).toBe('canonical answer');
    expect(projection.turnBlocks[0]!.aiEvents.some((event) => event.eventId === 'settled-thinking')).toBe(true);
  });

  it('hands a settled completed thinking step off from the still-present live layer', () => {
    const historyMessages = [
      makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' }),
      makeConversationMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'canonical answer',
      }),
    ];
    const settledThinking = makeEnvelope({
      eventId: 'settled-thinking-turn-2',
      eventType: 'LLM_THINKING_DELTA',
      runId: 'run-1',
      sequence: 13,
      payload: {
        text: 'final accumulated reasoning',
        rootMessageId: 'req-1',
        runId: 'run-1',
        stepId: 'turn-2',
        metadata: { accumulated: true, completed: true },
      },
    });
    const liveThinking = makeEnvelope({
      eventId: 'live-thinking-turn-2',
      eventType: 'LLM_THINKING_DELTA',
      runId: 'run-1',
      sequence: 13,
      payload: {
        text: 'final accumulated reasoning',
        rootMessageId: 'req-1',
        runId: 'run-1',
        stepId: 'turn-2',
        metadata: { accumulated: true, completed: true },
      },
    });

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes: [settledThinking],
      activeEnvelopes: [liveThinking],
    });

    expect(buildProcessEntries(projection.turnBlocks[0]!.aiEvents, i18n.t)).toMatchObject([
      {
        kind: 'thinking',
        detail: 'final accumulated reasoning',
      },
    ]);
    expect(projection.turnBlocks[0]!.aiEvents.filter((event) => event.eventType === 'LLM_THINKING_DELTA').map((event) => event.eventId)).toEqual([
      'settled-thinking-turn-2',
    ]);
  });

  it('keeps the selected display run on one thinking entry during active settled-live handoff', () => {
    const historyMessages = [makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' })];
    const thinking = (eventId: string, completed: boolean) =>
      makeEnvelope({
        eventId,
        eventType: 'LLM_THINKING_DELTA',
        runId: 'run-1',
        sequence: completed ? 13 : 12,
        payload: {
          text: completed ? 'final accumulated reasoning' : 'partial reasoning',
          rootMessageId: 'req-1',
          runId: 'run-1',
          stepId: 'turn-2',
          metadata: { accumulated: true, ...(completed ? { completed: true } : {}) },
        },
      });

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes: [thinking('settled-selected-thinking', true)],
      activeEnvelopes: [thinking('live-selected-thinking', false)],
      displayRunByRoot: { 'req-1': 'run-1' },
      activeRun: { requestId: 'req-1', runId: 'run-1', status: 'EXECUTING' },
    });

    expect(projection.turnBlocks[0]!.aiEvents.filter((event) => event.eventType === 'LLM_THINKING_DELTA').map((event) => event.eventId)).toEqual([
      'settled-selected-thinking',
    ]);
    expect(buildProcessEntries(projection.turnBlocks[0]!.aiEvents, i18n.t)).toMatchObject([
      {
        kind: 'thinking',
        detail: 'final accumulated reasoning',
        isFinal: true,
      },
    ]);
  });

  it('keeps only the latest cumulative snapshot for one stable live thinking step', () => {
    const historyMessages = [makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' })];
    const liveThinking = (eventId: string, sequence: number, text: string) =>
      makeEnvelope({
        eventId,
        eventType: 'LLM_THINKING_DELTA',
        runId: 'run-1',
        sequence,
        payload: {
          text,
          rootMessageId: 'req-1',
          runId: 'run-1',
          stepId: 'turn-1',
          metadata: { accumulated: true },
        },
      });

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      activeEnvelopes: [
        liveThinking('live-thinking-partial', 2, 'partial reasoning'),
        liveThinking('live-thinking-latest', 3, 'authoritative current snapshot'),
      ],
      activeRun: { requestId: 'req-1', runId: 'run-1', status: 'EXECUTING' },
    });

    expect(projection.turnBlocks[0]!.aiEvents.filter((event) => event.eventType === 'LLM_THINKING_DELTA').map((event) => event.eventId)).toEqual([
      'live-thinking-latest',
    ]);
    expect(buildProcessEntries(projection.turnBlocks[0]!.aiEvents, i18n.t)).toMatchObject([
      {
        kind: 'thinking',
        detail: 'authoritative current snapshot',
      },
    ]);
  });

  it('keeps settled and live thinking from different stable steps distinct', () => {
    const historyMessages = [
      makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' }),
      makeConversationMessage({
        messageId: 'assistant-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'canonical answer',
      }),
    ];
    const thinking = (eventId: string, stepId: string) =>
      makeEnvelope({
        eventId,
        eventType: 'LLM_THINKING_DELTA',
        runId: 'run-1',
        sequence: 13,
        payload: {
          text: 'same reasoning text',
          rootMessageId: 'req-1',
          runId: 'run-1',
          stepId,
          metadata: { accumulated: true, completed: true },
        },
      });

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes: [thinking('settled-thinking-turn-1', 'turn-1')],
      activeEnvelopes: [thinking('live-thinking-turn-2', 'turn-2')],
    });

    expect(projection.turnBlocks[0]!.aiEvents.filter((event) => event.eventType === 'LLM_THINKING_DELTA').map((event) => event.eventId)).toEqual([
      'settled-thinking-turn-1',
      'live-thinking-turn-2',
    ]);
  });

  it('ignores the conversation capability result while retaining settled safe progress for the same lane', () => {
    const historyMessages = [
      makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'question' }),
      makeConversationMessage({
        messageId: 'capability-result-1',
        role: 'CAPABILITY_RESULT',
        sequence: 2,
        content: 'canonical capability result',
        metadata: { toolCallId: 'tool-1' },
      }),
    ];
    const settledEnvelopes = [
      makeEnvelope({
        eventId: 'settled-progress',
        eventType: 'CAPABILITY_RESULT_DELTA',
        sequence: 2,
        payload: { toolCallId: 'tool-1', progress: 'working', rootMessageId: 'req-1' },
      }),
      makeEnvelope({
        eventId: 'settled-capability-result',
        eventType: 'CAPABILITY_RESULT_DELTA',
        sequence: 3,
        payload: {
          toolCallId: 'tool-1',
          content: '',
          safeSummary: 'stream capability result',
          rootMessageId: 'req-1',
        },
      }),
      makeEnvelope({ eventId: 'settled-terminal', eventType: 'REQUEST_COMPLETED', sequence: 4 }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes,
      activeEnvelopes: [],
    });
    const capabilityResults = projection.turnBlocks[0]!.aiEvents.filter((event) => event.eventType === 'CAPABILITY_RESULT_DELTA');

    expect(capabilityResults.map((event) => event.eventId)).toEqual(['settled-progress', 'settled-capability-result']);
    expect(capabilityResults.every((event) => !event.transportHints.includes('history-load'))).toBe(true);
    expect(JSON.stringify(projection.turnBlocks[0]!.aiEvents)).not.toContain('canonical capability result');
    expect(projection.turnBlocks[0]!.aiEvents.some((event) => event.eventId === 'settled-progress')).toBe(true);
  });

  it('does not let retained live state revive a canonically invisible root', () => {
    const historyMessages = [
      makeConversationMessage({ messageId: 'user-hidden', role: 'USER', visible: false }),
      makeConversationMessage({ messageId: 'assistant-hidden', role: 'ASSISTANT', sequence: 2, visible: false }),
    ];
    const settledEnvelopes = [
      makeEnvelope({
        eventId: 'hidden-live-user',
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'hidden question', rootMessageId: 'req-1' },
      }),
      makeEnvelope({ eventId: 'hidden-live-answer', sequence: 2 }),
      makeEnvelope({ eventId: 'hidden-live-terminal', eventType: 'REQUEST_COMPLETED', sequence: 3 }),
    ];

    const projection = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes,
      activeEnvelopes: [],
    });

    expect(projection.turnBlocks).toHaveLength(0);
  });

  it('keeps live-only roots outside an anchored projection until recent mode resumes', () => {
    const historyMessages = [
      makeConversationMessage({ messageId: 'user-1', role: 'USER', content: 'visible question' }),
      makeConversationMessage({ messageId: 'assistant-1', role: 'ASSISTANT', sequence: 2, content: 'visible answer' }),
    ];
    const settledEnvelopes = [
      makeEnvelope({
        eventId: 'outside-user',
        requestId: 'req-2',
        rootMessageId: 'req-2',
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'outside question', rootMessageId: 'req-2' },
      }),
      makeEnvelope({
        eventId: 'outside-terminal',
        requestId: 'req-2',
        rootMessageId: 'req-2',
        eventType: 'REQUEST_COMPLETED',
        sequence: 2,
        payload: { rootMessageId: 'req-2' },
      }),
    ];

    const anchored = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes,
      activeEnvelopes: [],
      includeLiveOnlyRoots: false,
    });
    const recent = buildSessionProjection({
      historyMessages,
      historyEnvelopes: [],
      settledEnvelopes,
      activeEnvelopes: [],
      includeLiveOnlyRoots: true,
    });

    expect(anchored.turnBlocks.map((block) => block.rootMessageId)).toEqual(['req-1']);
    expect(recent.turnBlocks.map((block) => block.rootMessageId)).toEqual(['req-1', 'req-2']);
  });
});
