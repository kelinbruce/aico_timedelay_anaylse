import { describe, expect, it } from 'vitest';
import {
  buildHistoricalTurnBlocks,
  buildTurnBlocks,
  overlayLiveTurnBlocks,
  overlaySettledTurnBlocks,
} from '../src/features/chat/utils/buildTurnBlocks';
import { buildAnswerContent } from '../src/features/chat/presentation/answerContent.ts';
import type { StreamEnvelope } from '../src/state/contracts';

function makeEnvelope(id: string, overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: `evt-${id}`,
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: { content: `Test content ${id}` },
    createdAt: '2026-04-15T00:00:00Z',
    ...overrides,
  } as StreamEnvelope;
}

describe('buildTurnBlocks', () => {
  it('returns empty array for empty inputs', () => {
    expect(buildTurnBlocks([], [])).toEqual([]);
  });

  it('groups envelopes by requestId from history', () => {
    const env1 = makeEnvelope('1', { requestId: 'req-1', sequence: 1 });
    const env2 = makeEnvelope('2', { requestId: 'req-1', sequence: 2 });
    const blocks = buildTurnBlocks([env1, env2], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.rootMessageId).toBe('req-1');
    expect(blocks[0]!.aiEvents).toHaveLength(2);
    expect(blocks[0]!.isLatest).toBe(true);
  });

  it('merges live envelopes with history', () => {
    const historyEnv = makeEnvelope('h1', { requestId: 'req-1', sequence: 1 });
    const liveEnv = makeEnvelope('l1', { requestId: 'req-1', sequence: 2 });
    const blocks = buildTurnBlocks([historyEnv], [liveEnv]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.aiEvents).toHaveLength(2);
  });

  it('preserves unchanged historical turn references when live activity only changes the latest turn', () => {
    const historicalBlocks = buildHistoricalTurnBlocks([
      makeEnvelope('history-1', {
        requestId: 'req-1',
        rootMessageId: 'req-1',
        createdAt: '2026-04-15T00:00:00Z',
      }),
      makeEnvelope('history-2', {
        requestId: 'req-2',
        rootMessageId: 'req-2',
        createdAt: '2026-04-15T00:01:00Z',
      }),
    ]);

    const overlaidBlocks = overlayLiveTurnBlocks(historicalBlocks, [
      makeEnvelope('live-2', {
        requestId: 'req-2',
        rootMessageId: 'req-2',
        sequence: 2,
        createdAt: '2026-04-15T00:01:01Z',
      }),
    ]);

    expect(overlaidBlocks[0]).toBe(historicalBlocks[0]);
    expect(overlaidBlocks[1]).not.toBe(historicalBlocks[1]);
  });

  it('projects only the selected retry attempt when a settled answer replaces an older answer', () => {
    const rootMessageId = 'req-retry';
    const historicalBlocks = buildHistoricalTurnBlocks([
      makeEnvelope('retry-user', {
        requestId: rootMessageId,
        rootMessageId,
        runId: 'run-old',
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'question', rootMessageId },
        sequence: 1,
      }),
      makeEnvelope('retry-old-answer', {
        requestId: rootMessageId,
        rootMessageId,
        runId: 'run-old',
        payload: { role: 'ASSISTANT', content: 'old answer', rootMessageId },
        sequence: 2,
      }),
    ]).map((block) => ({ ...block, displayRunId: 'run-new' }));

    const [block] = overlaySettledTurnBlocks(
      historicalBlocks,
      [
        makeEnvelope('retry-new-answer', {
          requestId: rootMessageId,
          rootMessageId,
          runId: 'run-new',
          payload: { role: 'ASSISTANT', content: 'new answer', rootMessageId },
          sequence: 3,
        }),
      ],
      'COMPLETED',
      false,
    );

    expect(block?.aiEvents.map((event) => event.runId)).toEqual(['run-new']);
    expect(buildAnswerContent(block?.aiEvents ?? [])).toBe('new answer');
  });

  it('projects workflow process and terminal answer only from the selected retry attempt', () => {
    const rootMessageId = 'req-workflow-retry';
    const workflowProduct = (eventId: string, runId: string, sequence: number) =>
      makeEnvelope(eventId, {
        requestId: rootMessageId,
        rootMessageId,
        runId,
        eventType: 'TOOL_STRUCTURED_DELTA',
        payload: {
          rootMessageId,
          workflowEventType: 'NODE_COMPLETED',
          capabilityId: 'show-result',
          toolCallId: 'workflow:shared-execution:show-result',
          nodeId: 'show-result',
          nodeType: 'DISPLAY',
          toolEventType: 'ANSWER',
          toolMessageType: 'TEXT',
          content: 'Alarm ALM-001, Cell Cell-3',
        },
        sequence,
      });
    const terminalAnswer = (eventId: string, runId: string, sequence: number) =>
      makeEnvelope(eventId, {
        requestId: rootMessageId,
        rootMessageId,
        runId,
        eventType: 'REQUEST_COMPLETED',
        payload: {
          rootMessageId,
          role: 'ASSISTANT',
          content: 'Alarm ALM-001, Cell Cell-3',
          status: 'COMPLETED',
        },
        sequence,
      });
    const user = makeEnvelope('workflow-retry-user', {
      requestId: rootMessageId,
      rootMessageId,
      runId: 'run-old',
      eventType: 'REQUEST_ACCEPTED',
      payload: { role: 'USER', content: 'execute workflow', rootMessageId },
      sequence: 1,
    });
    const oldProduct = workflowProduct('workflow-old-product', 'run-old', 2);
    const oldAnswer = terminalAnswer('workflow-old-answer', 'run-old', 3);
    const newProduct = workflowProduct('workflow-new-product', 'run-new', 4);
    const newAnswer = terminalAnswer('workflow-new-answer', 'run-new', 5);
    const historicalBlocks = buildHistoricalTurnBlocks([user, oldProduct, oldAnswer]).map((block) => ({
      ...block,
      displayRunId: 'run-new',
    }));

    const [block] = overlaySettledTurnBlocks(historicalBlocks, [newProduct, newAnswer], 'COMPLETED', false);

    expect(block?.aiEvents.map((event) => event.eventId)).toEqual(['evt-workflow-new-product', 'evt-workflow-new-answer']);
    expect(buildAnswerContent(block?.aiEvents ?? [])).toBe('Alarm ALM-001, Cell Cell-3');

    const [coldBlock] = buildHistoricalTurnBlocks([user, oldProduct, oldAnswer, newProduct, newAnswer]);
    expect(coldBlock?.aiEvents.map((event) => event.eventId)).toEqual(['evt-workflow-new-product', 'evt-workflow-new-answer']);
    expect(buildAnswerContent(coldBlock?.aiEvents ?? [])).toBe('Alarm ALM-001, Cell Cell-3');
  });

  it('does not deduplicate capability result lanes across retry attempts', () => {
    const rootMessageId = 'req-retry-capability';
    const capabilityResult = (eventId: string, runId: string, content: string, sequence: number) =>
      makeEnvelope(eventId, {
        requestId: rootMessageId,
        rootMessageId,
        runId,
        eventType: 'CAPABILITY_RESULT_DELTA',
        payload: {
          role: 'CAPABILITY_RESULT',
          content,
          rootMessageId,
          toolCallId: 'shared-tool-call',
        },
        sequence,
      });
    const historicalBlocks = buildHistoricalTurnBlocks([
      makeEnvelope('retry-capability-user', {
        requestId: rootMessageId,
        rootMessageId,
        runId: 'run-old',
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'question', rootMessageId },
        sequence: 1,
      }),
      capabilityResult('retry-old-capability', 'run-old', 'old result', 2),
    ]).map((block) => ({ ...block, displayRunId: 'run-new' }));

    const [block] = overlaySettledTurnBlocks(
      historicalBlocks,
      [capabilityResult('retry-new-capability', 'run-new', 'new result', 3)],
      'COMPLETED',
      false,
    );

    expect(block?.aiEvents).toHaveLength(1);
    expect(block?.aiEvents[0]).toMatchObject({ runId: 'run-new', payload: { content: 'new result' } });
  });

  it('ignores a late live event from a replaced retry attempt when a display run is selected', () => {
    const rootMessageId = 'req-retry-late-live';
    const historicalBlocks = buildHistoricalTurnBlocks([
      makeEnvelope('retry-late-user', {
        requestId: rootMessageId,
        rootMessageId,
        runId: 'run-old',
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'question', rootMessageId },
        sequence: 1,
      }),
      makeEnvelope('retry-current-answer', {
        requestId: rootMessageId,
        rootMessageId,
        runId: 'run-new',
        payload: { role: 'ASSISTANT', content: 'current answer', rootMessageId },
        sequence: 2,
        createdAt: '2026-04-15T00:00:02Z',
      }),
    ]).map((block) => ({ ...block, displayRunId: 'run-new' }));

    const [block] = overlayLiveTurnBlocks(
      historicalBlocks,
      [
        makeEnvelope('retry-late-old-thinking', {
          requestId: rootMessageId,
          rootMessageId,
          runId: 'run-old',
          eventType: 'LLM_THINKING_DELTA',
          payload: { role: 'ASSISTANT', content: 'late old thinking', rootMessageId },
          sequence: 3,
          createdAt: '2026-04-15T00:00:03Z',
        }),
      ],
      'COMPLETED',
      false,
    );

    expect(block?.aiEvents.map((event) => event.runId)).toEqual(['run-new']);
    expect(buildAnswerContent(block?.aiEvents ?? [])).toBe('current answer');
  });

  it('keeps one canonical thinking step when a display run overlays its retained live snapshot', () => {
    const rootMessageId = 'req-selected-thinking';
    const runId = 'run-selected-thinking';
    const thinking = (eventId: string, completed: boolean) =>
      makeEnvelope(eventId, {
        requestId: rootMessageId,
        rootMessageId,
        runId,
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          rootMessageId,
          runId,
          stepId: 'turn-1',
          text: completed ? 'final accumulated reasoning' : 'partial reasoning',
          metadata: { accumulated: true, ...(completed ? { completed: true } : {}) },
        },
      });
    const historicalBlocks = buildHistoricalTurnBlocks([
      makeEnvelope('selected-thinking-user', {
        requestId: rootMessageId,
        rootMessageId,
        runId,
        eventType: 'REQUEST_ACCEPTED',
        payload: { role: 'USER', content: 'question', rootMessageId },
      }),
      thinking('selected-thinking-completed', true),
    ]).map((block) => ({ ...block, displayRunId: runId }));

    const [block] = overlayLiveTurnBlocks(historicalBlocks, [thinking('selected-thinking-live', false)], undefined, false);

    expect(block?.aiEvents.filter((event) => event.eventType === 'LLM_THINKING_DELTA').map((event) => event.eventId)).toEqual([
      'evt-selected-thinking-completed',
    ]);
  });

  it('exposes the durable assistant message id as the fork anchor for history-loaded answers', () => {
    const userEnv = makeEnvelope('user', {
      requestId: 'user-1',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['history-load'],
      payload: { role: 'USER', content: 'question', messageId: 'user-1', rootMessageId: 'user-1' },
      sequence: 1,
    });
    const assistantEnv = makeEnvelope('assistant', {
      requestId: 'user-1',
      rootMessageId: 'user-1',
      transportHints: ['history-load'],
      payload: {
        role: 'ASSISTANT',
        content: 'answer',
        messageId: 'assistant-1',
        rootMessageId: 'user-1',
        visible: true,
      },
      sequence: 2,
    });

    const blocks = buildTurnBlocks([userEnv, assistantEnv], []);

    expect(blocks[0]?.assistantAnchorMessageId).toBe('assistant-1');
  });

  it('exposes the durable assistant message id for persisted completed assistant messages', () => {
    const userEnv = makeEnvelope('user', {
      requestId: 'user-1',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['history-load'],
      payload: { role: 'USER', content: 'question', messageId: 'user-1', rootMessageId: 'user-1' },
      sequence: 1,
    });
    const assistantEnv = makeEnvelope('assistant', {
      requestId: 'user-1',
      rootMessageId: 'user-1',
      eventType: 'REQUEST_COMPLETED',
      transportHints: ['history-load'],
      payload: {
        role: 'ASSISTANT',
        content: 'persisted completed answer',
        messageId: 'assistant-1',
        rootMessageId: 'user-1',
        visible: true,
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
      },
      sequence: 2,
    });

    const blocks = buildTurnBlocks([userEnv, assistantEnv], []);

    expect(blocks[0]?.assistantAnchorMessageId).toBe('assistant-1');
  });

  it('does not expose a fork anchor for live-only assistant deltas', () => {
    const userEnv = makeEnvelope('user', {
      requestId: 'user-1',
      eventType: 'REQUEST_ACCEPTED',
      payload: { role: 'USER', content: 'question', messageId: 'user-1', rootMessageId: 'user-1' },
      sequence: 1,
    });
    const assistantEnv = makeEnvelope('assistant', {
      requestId: 'user-1',
      rootMessageId: 'user-1',
      payload: {
        role: 'ASSISTANT',
        content: 'answer',
        messageId: 'assistant-1',
        rootMessageId: 'user-1',
        visible: true,
      },
      sequence: 2,
    });

    const blocks = buildTurnBlocks([], [userEnv, assistantEnv]);

    expect(blocks[0]?.assistantAnchorMessageId).toBeUndefined();
  });

  it('preserves receive order for live deltas even when sequence and timestamps are not token order', () => {
    const userEnv = makeEnvelope('live-user', {
      requestId: 'req-live',
      rootMessageId: 'req-live',
      requestContextId: 'req-live',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['local-optimistic'],
      payload: { content: 'stream this', role: 'USER', rootMessageId: 'req-live', requestContextId: 'req-live' },
      sequence: 1,
      createdAt: '2026-04-15T00:00:00Z',
    });
    const token = makeEnvelope('token', {
      requestId: 'req-live',
      rootMessageId: 'req-live',
      requestContextId: 'req-live',
      sequence: 30,
      payload: { delta: ' token', role: 'ASSISTANT', rootMessageId: 'req-live', requestContextId: 'req-live' },
      createdAt: '2026-04-15T00:00:03Z',
    });
    const is = makeEnvelope('is', {
      requestId: 'req-live',
      rootMessageId: 'req-live',
      requestContextId: 'req-live',
      sequence: 10,
      payload: { delta: ' is', role: 'ASSISTANT', rootMessageId: 'req-live', requestContextId: 'req-live' },
      createdAt: '2026-04-15T00:00:01Z',
    });
    const single = makeEnvelope('single', {
      requestId: 'req-live',
      rootMessageId: 'req-live',
      requestContextId: 'req-live',
      sequence: 20,
      payload: { delta: ' single', role: 'ASSISTANT', rootMessageId: 'req-live', requestContextId: 'req-live' },
      createdAt: '2026-04-15T00:00:02Z',
    });

    const blocks = buildTurnBlocks([], [userEnv, token, is, single]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-token', 'evt-is', 'evt-single']);
  });

  it('groups envelopes by different requestIds', () => {
    const env1 = makeEnvelope('1', { requestId: 'req-1', sequence: 1 });
    const env2 = makeEnvelope('2', {
      requestId: 'req-2',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 2,
      transportHints: ['local-optimistic'],
      payload: { content: 'new request', role: 'USER', rootMessageId: 'req-2' },
    });

    const blocks = buildTurnBlocks([env1], [env2]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.rootMessageId).toBe('req-1');
    expect(blocks[1]!.rootMessageId).toBe('req-2');
    expect(blocks[0]!.isLatest).toBe(false);
    expect(blocks[1]!.isLatest).toBe(true);
  });

  it('calculates status based on terminal events', () => {
    const completedEnv = makeEnvelope('1', { eventType: 'REQUEST_COMPLETED' });
    const blocks = buildTurnBlocks([completedEnv], []);

    expect(blocks[0]!.status).toBe('COMPLETED');
  });

  it('maps superseded terminal events to a terminal turn status', () => {
    const supersededEnv = makeEnvelope('1', { eventType: 'REQUEST_SUPERSEDED' });
    const blocks = buildTurnBlocks([supersededEnv], []);

    expect(blocks[0]!.status).toBe('SUPERSEDED');
  });

  it('returns EXECUTING status when no terminal event', () => {
    const streamingEnv = makeEnvelope('1', { eventType: 'LLM_CONTENT_DELTA' });
    const blocks = buildTurnBlocks([streamingEnv], []);

    expect(blocks[0]!.status).toBe('EXECUTING');
  });

  it('uses the persisted root message status for historical turns without terminal events', () => {
    const userEnv = makeEnvelope('history-user', {
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['history-load'],
      payload: {
        content: 'previous question',
        role: 'USER',
        rootMessageId: 'req-1',
        status: 'COMPLETED',
      },
    });
    const assistantEnv = makeEnvelope('history-assistant', {
      requestId: 'req-1',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'previous answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
    });

    const blocks = buildTurnBlocks([userEnv, assistantEnv], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('COMPLETED');
  });

  it('preserves persisted in-flight root statuses', () => {
    const userEnv = makeEnvelope('history-user-in-flight', {
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['history-load'],
      payload: {
        content: 'still running',
        role: 'USER',
        rootMessageId: 'req-1',
        status: 'PLANNING',
      },
    });
    const assistantEnv = makeEnvelope('history-assistant-in-flight', {
      requestId: 'req-1',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'partial answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
    });

    const blocks = buildTurnBlocks([userEnv, assistantEnv], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('PLANNING');
  });

  it('settles older persisted in-flight statuses when they are no longer latest', () => {
    const olderUser = makeEnvelope('older-user-queued', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      transportHints: ['history-load'],
      payload: { content: 'older question', role: 'USER', rootMessageId: 'req-old', status: 'QUEUED' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const latestUser = makeEnvelope('latest-user-executing', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'latest question', role: 'USER', rootMessageId: 'req-new', status: 'EXECUTING' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });

    const blocks = buildTurnBlocks([olderUser, latestUser], [], null);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.status).toBe('COMPLETED');
    expect(blocks[1]!.status).toBe('EXECUTING');
  });

  it('does not fabricate COMPLETED for older turns with AI events when terminal events are missing', () => {
    const olderUser = makeEnvelope('older-user', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      transportHints: ['history-load'],
      payload: { content: 'older question', role: 'USER', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const olderAssistant = makeEnvelope('older-assistant', {
      requestId: 'req-old',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'older answer', role: 'ASSISTANT', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const latestUser = makeEnvelope('latest-user', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 3,
      transportHints: ['history-load'],
      payload: { content: 'latest question', role: 'USER', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const latestAssistant = makeEnvelope('latest-assistant', {
      requestId: 'req-new',
      sequence: 4,
      transportHints: ['history-load'],
      payload: { content: 'latest answer', role: 'ASSISTANT', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });

    const blocks = buildTurnBlocks([olderUser, olderAssistant, latestUser, latestAssistant], [], 'COMPLETED');

    expect(blocks).toHaveLength(2);
    // Older block has AI events but no terminal event; don't fabricate COMPLETED.
    expect(blocks[0]!.status).toBe('EXECUTING');
    // Latest block uses latestPersistedRunStatus='COMPLETED'.
    expect(blocks[1]!.status).toBe('COMPLETED');
  });

  it('keeps an older superseded turn superseded after the latest turn completes', () => {
    const olderUser = makeEnvelope('older-superseded-user', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      transportHints: ['history-load'],
      payload: { content: 'older question', role: 'USER', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const olderAssistant = makeEnvelope('older-superseded-assistant', {
      requestId: 'run-old',
      requestContextId: 'attempt-old',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'partial old answer', role: 'ASSISTANT', rootMessageId: 'req-old', requestContextId: 'attempt-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const latestUser = makeEnvelope('latest-completed-user', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 3,
      transportHints: ['history-load'],
      payload: { content: 'latest question', role: 'USER', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const latestAssistant = makeEnvelope('latest-completed-assistant', {
      requestId: 'run-new',
      sequence: 4,
      transportHints: ['history-load'],
      payload: { content: 'latest answer', role: 'ASSISTANT', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });
    const oldSupersededTerminal = makeEnvelope('older-superseded-terminal', {
      requestId: 'run-old',
      requestContextId: 'attempt-old',
      eventType: 'REQUEST_SUPERSEDED',
      sequence: 5,
      payload: { rootMessageId: 'req-old', requestContextId: 'attempt-old' },
      createdAt: '2026-04-18T10:00:04.000Z',
    });

    const blocks = buildTurnBlocks([olderUser, olderAssistant, latestUser, latestAssistant], [oldSupersededTerminal], 'COMPLETED');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.status).toBe('SUPERSEDED');
    expect(blocks[0]!.aiEvents.map((event) => event.eventType)).toContain('REQUEST_SUPERSEDED');
    expect(blocks[1]!.status).toBe('COMPLETED');
  });

  it('keeps the latest historical turn executing when the session is still in flight', () => {
    const olderUser = makeEnvelope('older-user-running', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      transportHints: ['history-load'],
      payload: { content: 'older question', role: 'USER', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const olderAssistant = makeEnvelope('older-assistant-running', {
      requestId: 'req-old',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'older answer', role: 'ASSISTANT', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const latestUser = makeEnvelope('latest-user-running', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 3,
      transportHints: ['history-load'],
      payload: { content: 'latest question', role: 'USER', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const latestAssistant = makeEnvelope('latest-assistant-running', {
      requestId: 'req-new',
      sequence: 4,
      transportHints: ['history-load'],
      payload: { content: 'partial latest answer', role: 'ASSISTANT', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });

    const blocks = buildTurnBlocks([olderUser, olderAssistant, latestUser, latestAssistant], [], null);

    expect(blocks).toHaveLength(2);
    // Older block has AI events but no terminal; don't fabricate COMPLETED.
    expect(blocks[0]!.status).toBe('EXECUTING');
    expect(blocks[1]!.status).toBe('EXECUTING');
  });

  it('settles a previous history-only turn when a new optimistic turn becomes latest', () => {
    const previousUser = makeEnvelope('previous-user-only', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      transportHints: ['history-load'],
      payload: { content: 'previous question', role: 'USER', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const optimisticUser = makeEnvelope('new-optimistic-user', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 0,
      transportHints: ['local-optimistic'],
      payload: { content: 'new question', role: 'USER', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });

    const blocks = buildTurnBlocks([previousUser], [optimisticUser], null);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.rootMessageId).toBe('req-old');
    expect(blocks[0]!.status).toBe('COMPLETED');
    expect(blocks[1]!.rootMessageId).toBe('req-new');
    expect(blocks[1]!.status).toBe('EXECUTING');
  });

  it('creates synthetic user message for each root', () => {
    const env = makeEnvelope('1', {
      requestId: 'req-1',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['local-optimistic'],
      payload: { content: 'User input', role: 'USER', rootMessageId: 'req-1' },
    });
    const blocks = buildTurnBlocks([env], []);

    expect(blocks[0]!.userMessage.messageId).toBe('req-1');
    expect(blocks[0]!.userMessage.visible).toBe(true);
  });

  it('deduplicates envelopes by eventId', () => {
    const env1 = makeEnvelope('same', { sequence: 1 });
    const env2 = makeEnvelope('same', { sequence: 2 });
    const blocks = buildTurnBlocks([env1], [env2]);

    expect(blocks[0]!.aiEvents).toHaveLength(1);
  });

  it('ignores request runtime REQUEST_ACCEPTED events without user content', () => {
    const env = makeEnvelope('runtime-start', {
      eventType: 'REQUEST_ACCEPTED',
      payload: { responseRef: 'resp-1' },
    });

    expect(buildTurnBlocks([env], [])).toEqual([]);
  });

  it('ignores orphan runtime notices when building message turns', () => {
    const env = makeEnvelope('degraded', {
      eventType: 'DEGRADATION_NOTICE',
      payload: { reason: 'gap refresh required' },
    });

    expect(buildTurnBlocks([env], [])).toEqual([]);
  });

  it('keeps user-visible runtime events attached to the current turn', () => {
    const userEnv = makeEnvelope('user-root', {
      requestId: 'root-1',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['local-optimistic'],
      payload: { content: 'diagnose', role: 'USER', rootMessageId: 'root-1' },
    });
    const hookEnv = makeEnvelope('hook', {
      requestId: 'root-1',
      eventType: 'HOOK_DEGRADED',
      sequence: 2,
      payload: { rootMessageId: 'root-1', text: 'hook downgraded safely' },
    });
    const compactedEnv = makeEnvelope('compacted', {
      requestId: 'root-1',
      eventType: 'CONTEXT_COMPACTED',
      sequence: 3,
      payload: { rootMessageId: 'root-1', text: 'context compacted' },
    });

    const blocks = buildTurnBlocks([userEnv, hookEnv, compactedEnv], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.aiEvents.map((event) => event.eventType)).toEqual(['HOOK_DEGRADED', 'CONTEXT_COMPACTED']);
  });

  it('keeps a user-only turn in EXECUTING state before assistant content arrives', () => {
    const userEnv = makeEnvelope('user-only', {
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['local-optimistic'],
      payload: { content: '测试', role: 'USER', rootMessageId: 'req-1' },
    });

    const blocks = buildTurnBlocks([userEnv], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('EXECUTING');
    expect(blocks[0]!.userMessage.content).toBe('测试');
  });

  it('keeps the latest visible turn state when retry-related events share the same root identity', () => {
    const userEnv = makeEnvelope('user-root', {
      requestId: 'root-1',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      payload: { content: 'retry this', role: 'USER', rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const oldThinking = makeEnvelope('old-thinking', {
      requestId: 'root-1',
      eventType: 'LLM_THINKING_DELTA',
      sequence: 2,
      payload: { content: 'old thinking', rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const oldTerminal = makeEnvelope('old-terminal', {
      requestId: 'root-1',
      eventType: 'REQUEST_COMPLETED',
      sequence: 3,
      payload: { rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const newThinking = makeEnvelope('new-thinking', {
      requestId: 'root-1',
      eventType: 'LLM_THINKING_DELTA',
      sequence: 4,
      payload: { content: 'new thinking', rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });
    const newProgress = makeEnvelope('new-progress', {
      requestId: 'root-1',
      eventType: 'CAPABILITY_RESULT_DELTA',
      sequence: 5,
      payload: { rootMessageId: 'root-1', toolCallId: 'tool-1', progress: 'new progress' },
      createdAt: '2026-04-18T10:00:04.000Z',
    });

    const blocks = buildTurnBlocks([userEnv, oldThinking, oldTerminal, newThinking, newProgress], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.rootMessageId).toBe('root-1');
    expect(blocks[0]!.status).toBe('COMPLETED');
    expect(blocks[0]!.aiEvents.map((event) => event.requestId)).toEqual(['root-1', 'root-1', 'root-1', 'root-1']);
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual([
      'evt-old-thinking',
      'evt-old-terminal',
      'evt-new-thinking',
      'evt-new-progress',
    ]);
  });

  it('drops the previous answer once the latest retry attempt starts', () => {
    const userEnv = makeEnvelope('user-root', {
      requestId: 'root-1',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      payload: { content: 'retry this', role: 'USER', rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const oldAnswer = makeEnvelope('old-answer', {
      requestId: 'root-1',
      requestContextId: 'ctx-old',
      eventType: 'LLM_CONTENT_DELTA',
      sequence: 2,
      payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'root-1', requestContextId: 'ctx-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const oldTerminal = makeEnvelope('old-terminal', {
      requestId: 'root-1',
      requestContextId: 'ctx-old',
      eventType: 'REQUEST_COMPLETED',
      sequence: 3,
      payload: { rootMessageId: 'root-1', requestContextId: 'ctx-old' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const newThinking = makeEnvelope('new-thinking', {
      requestId: 'root-1',
      requestContextId: 'ctx-new',
      eventType: 'LLM_THINKING_DELTA',
      sequence: 1,
      payload: { content: 'new thinking', rootMessageId: 'root-1', requestContextId: 'ctx-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });

    const blocks = buildTurnBlocks([userEnv, oldAnswer, oldTerminal, newThinking], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('EXECUTING');
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-new-thinking']);
  });

  it('drops the previous answer once the latest attempt emits visible answer content', () => {
    const userEnv = makeEnvelope('user-root', {
      requestId: 'root-1',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      payload: { content: 'retry this', role: 'USER', rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const oldAnswer = makeEnvelope('old-answer', {
      requestId: 'root-1',
      requestContextId: 'ctx-old',
      eventType: 'LLM_CONTENT_DELTA',
      sequence: 2,
      payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'root-1', requestContextId: 'ctx-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const oldTerminal = makeEnvelope('old-terminal', {
      requestId: 'root-1',
      requestContextId: 'ctx-old',
      eventType: 'REQUEST_COMPLETED',
      sequence: 3,
      payload: { rootMessageId: 'root-1', requestContextId: 'ctx-old' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const newStart = makeEnvelope('new-start', {
      requestId: 'root-1',
      requestContextId: 'ctx-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      payload: { rootMessageId: 'root-1', requestContextId: 'ctx-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });
    const newAnswer = makeEnvelope('new-answer', {
      requestId: 'root-1',
      requestContextId: 'ctx-new',
      eventType: 'LLM_CONTENT_DELTA',
      sequence: 2,
      payload: { content: 'new answer', role: 'ASSISTANT', rootMessageId: 'root-1', requestContextId: 'ctx-new' },
      createdAt: '2026-04-18T10:00:04.000Z',
    });

    const blocks = buildTurnBlocks([userEnv, oldAnswer, oldTerminal, newStart, newAnswer], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('EXECUTING');
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-new-start', 'evt-new-answer']);
  });

  it('keeps the newer attempt selected when stale old-attempt events arrive later', () => {
    const userEnv = makeEnvelope('user-root', {
      requestId: 'root-1',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      payload: { content: 'retry this', role: 'USER', rootMessageId: 'root-1' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const oldAnswer = makeEnvelope('old-answer', {
      requestId: 'root-1',
      requestContextId: 'ctx-old',
      runId: 'run-old',
      eventType: 'LLM_CONTENT_DELTA',
      sequence: 2,
      payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'root-1', requestContextId: 'ctx-old', runId: 'run-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const newStart = makeEnvelope('new-start', {
      requestId: 'root-1',
      requestContextId: 'ctx-new',
      runId: 'run-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      payload: { rootMessageId: 'root-1', requestContextId: 'ctx-new', runId: 'run-new' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const newThinking = makeEnvelope('new-thinking', {
      requestId: 'root-1',
      requestContextId: 'ctx-new',
      runId: 'run-new',
      eventType: 'LLM_THINKING_DELTA',
      sequence: 2,
      payload: { content: 'new thinking', rootMessageId: 'root-1', requestContextId: 'ctx-new', runId: 'run-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });
    const lateOldTerminal = makeEnvelope('late-old-terminal', {
      requestId: 'root-1',
      requestContextId: 'ctx-old',
      runId: 'run-old',
      eventType: 'REQUEST_COMPLETED',
      sequence: 99,
      payload: { rootMessageId: 'root-1', requestContextId: 'ctx-old', runId: 'run-old' },
      createdAt: '2026-04-18T10:00:04.000Z',
    });

    const blocks = buildTurnBlocks([userEnv, oldAnswer, newStart, newThinking, lateOldTerminal], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('EXECUTING');
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-new-start', 'evt-new-thinking']);
  });

  it('ignores locally hidden superseded envelopes when rendering visible turns', () => {
    const hiddenOldUser = makeEnvelope('hidden-old-user', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      payload: { content: 'old question', role: 'USER', rootMessageId: 'req-old', visible: false },
    });
    const hiddenOldAssistant = makeEnvelope('hidden-old-assistant', {
      requestId: 'run-old',
      sequence: 2,
      payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-old', visible: false },
    });
    const optimisticEditedUser = makeEnvelope('optimistic-edit', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['local-optimistic'],
      payload: { content: 'edited question', role: 'USER', rootMessageId: 'req-new' },
    });

    const blocks = buildTurnBlocks([hiddenOldUser, hiddenOldAssistant, optimisticEditedUser], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.rootMessageId).toBe('req-new');
    expect(blocks[0]!.userMessage.content).toBe('edited question');
  });

  it('does not let a replayed old root create a new visible turn without history visibility', () => {
    const visibleEditedUser = makeEnvelope('visible-user', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 10,
      transportHints: ['history-load'],
      payload: { content: 'edited question', role: 'USER', rootMessageId: 'req-new' },
    });
    const visibleEditedAssistant = makeEnvelope('visible-assistant', {
      requestId: 'run-new',
      sequence: 11,
      transportHints: ['history-load'],
      payload: { content: 'new answer', role: 'ASSISTANT', rootMessageId: 'req-new' },
    });
    const replayedOldAssistant = makeEnvelope('replayed-old-assistant', {
      requestId: 'run-old',
      sequence: 12,
      payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:05.000Z',
    });

    const blocks = buildTurnBlocks([visibleEditedUser, visibleEditedAssistant], [replayedOldAssistant]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.rootMessageId).toBe('req-new');
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-visible-assistant']);
  });

  it('overlays matching process details onto every visible historical root', () => {
    const olderUser = makeEnvelope('older-user', {
      requestId: 'req-old',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 1,
      transportHints: ['history-load'],
      payload: { content: 'old question', role: 'USER', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const olderAssistant = makeEnvelope('older-assistant', {
      requestId: 'run-old',
      sequence: 2,
      transportHints: ['history-load'],
      payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-old' },
      createdAt: '2026-04-18T10:00:01.000Z',
    });
    const latestUser = makeEnvelope('latest-user', {
      requestId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      sequence: 3,
      transportHints: ['history-load'],
      payload: { content: 'new question', role: 'USER', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
    const latestLiveThinking = makeEnvelope('latest-live-thinking', {
      requestId: 'run-new',
      eventType: 'LLM_THINKING_DELTA',
      sequence: 4,
      payload: { content: 'working', rootMessageId: 'req-new' },
      createdAt: '2026-04-18T10:00:03.000Z',
    });
    const replayedOldProgress = makeEnvelope('old-live-progress', {
      requestId: 'run-old',
      eventType: 'CAPABILITY_RESULT_DELTA',
      sequence: 5,
      payload: { rootMessageId: 'req-old', toolCallId: 'tool-old', progress: 'old progress' },
      createdAt: '2026-04-18T10:00:04.000Z',
    });

    const blocks = buildTurnBlocks([olderUser, olderAssistant, latestUser], [latestLiveThinking, replayedOldProgress]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.rootMessageId).toBe('req-old');
    expect(blocks[0]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-older-assistant', 'evt-old-live-progress']);
    expect(blocks[1]!.rootMessageId).toBe('req-new');
    expect(blocks[1]!.aiEvents.map((event) => event.eventId)).toEqual(['evt-latest-live-thinking']);
  });

  it('treats a round as CANCELED when OUTPUT_GUARD_BLOCKED is followed by a runtime REQUEST_COMPLETED', () => {
    const userEnv = makeEnvelope('user', {
      requestId: 'req-1',
      rootMessageId: 'req-1',
      eventType: 'REQUEST_ACCEPTED',
      payload: { role: 'USER', content: 'question', rootMessageId: 'req-1' },
      sequence: 1,
    });
    const contentEnv = makeEnvelope('content', {
      requestId: 'req-1',
      rootMessageId: 'req-1',
      runId: 'run-1',
      eventType: 'LLM_CONTENT_DELTA',
      payload: { content: 'streamed answer that should be retracted', rootMessageId: 'req-1' },
      sequence: 2,
    });
    const guardBlockedEnv = makeEnvelope('guard-blocked', {
      requestId: 'req-1',
      rootMessageId: 'req-1',
      runId: 'run-1',
      eventType: 'OUTPUT_GUARD_BLOCKED',
      payload: {
        rootMessageId: 'req-1',
        requestId: 'req-1',
        runId: 'run-1',
        guardReason: 'OUTPUT_VIOLATION',
        phase: 'OUTPUT_GUARD',
        refusalMessage: '抱歉，该回答已被安全护栏拦截。',
      },
      sequence: 3,
    });
    // Runtime terminal arrives AFTER the guard block (per design: the two
    // terminals coexist independently). Must not mask the block.
    const completedEnv = makeEnvelope('completed', {
      requestId: 'req-1',
      rootMessageId: 'req-1',
      runId: 'run-1',
      eventType: 'REQUEST_COMPLETED',
      payload: { rootMessageId: 'req-1', runId: 'run-1' },
      sequence: 4,
    });

    const blocks = buildTurnBlocks([userEnv, contentEnv, guardBlockedEnv, completedEnv], []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('CANCELED');
  });

  it('places a rehydrated input-guard-blocked turn by its creation time, not at the end', () => {
    // History holds a newer successful turn that the backend persisted.
    const newerUser = makeEnvelope('newer-user', {
      requestId: 'req-new',
      rootMessageId: 'req-new',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['history-load'],
      payload: { role: 'USER', content: 'later question', rootMessageId: 'req-new' },
      sequence: 1,
      createdAt: '2026-04-18T10:01:00.000Z',
    });
    const newerAssistant = makeEnvelope('newer-assistant', {
      requestId: 'run-new',
      rootMessageId: 'req-new',
      eventType: 'REQUEST_COMPLETED',
      transportHints: ['history-load'],
      payload: { rootMessageId: 'req-new', runId: 'run-new' },
      sequence: 2,
      createdAt: '2026-04-18T10:01:01.000Z',
    });

    // The older input-guard-blocked turn is NOT persisted by the backend, so
    // after a refresh it re-enters the live layer (local-optimistic) with its
    // original — older — createdAt.
    const blockedUser = makeEnvelope('blocked-user', {
      eventId: 'temp-req-blocked',
      requestId: 'req-blocked',
      rootMessageId: 'req-blocked',
      eventType: 'REQUEST_ACCEPTED',
      transportHints: ['local-optimistic'],
      payload: { role: 'USER', content: 'blocked question', rootMessageId: 'req-blocked' },
      sequence: 0,
      createdAt: '2026-04-18T10:00:00.000Z',
    });
    const blockedRefusal = makeEnvelope('blocked-refusal', {
      eventId: 'guard-input-blocked:req-blocked',
      requestId: 'req-blocked',
      rootMessageId: 'req-blocked',
      eventType: 'OUTPUT_GUARD_BLOCKED',
      transportHints: ['local-optimistic'],
      payload: {
        rootMessageId: 'req-blocked',
        requestId: 'req-blocked',
        guardReason: 'INPUT_VIOLATION',
        phase: 'INPUT_GUARD',
        refusalMessage: '抱歉，该问题已被安全护栏拦截。',
      },
      sequence: 0,
      createdAt: '2026-04-18T10:00:00.500Z',
    });

    const blocks = buildTurnBlocks([newerUser, newerAssistant], [blockedUser, blockedRefusal]);

    expect(blocks).toHaveLength(2);
    // Older blocked turn first, newer persisted turn last — not the reverse.
    expect(blocks[0]!.rootMessageId).toBe('req-blocked');
    expect(blocks[0]!.status).toBe('CANCELED');
    expect(blocks[1]!.rootMessageId).toBe('req-new');
    expect(blocks[1]!.isLatest).toBe(true);
    expect(blocks[0]!.isLatest).toBe(false);
  });
});
