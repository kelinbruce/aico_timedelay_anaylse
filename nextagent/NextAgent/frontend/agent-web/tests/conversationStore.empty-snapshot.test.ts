import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenLiveBuckets, useConversationStore } from '../src/state/conversationStore.ts';
import { sessionService } from '../src/services/sessionService.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

describe('conversationStore empty snapshot preservation', () => {
  beforeEach(() => {
    useConversationStore.setState({
      historyEnvelopesBySession: {},
      activeLiveBySession: {},
      settledLiveBySession: {},
      nextLiveOrdinalBySession: {},
      historyMessagesBySession: {},
      forkNoticeBySession: {},
      conversationLoadStateBySession: {},
      conversationPageInfoBySession: {},
      runtimeBySession: {},
      isStreaming: false,
      conversationError: null,
      sessionAccessOrder: [],
    });
    vi.restoreAllMocks();
  });

  it('keeps a live optimistic first turn when the first snapshot for a new session is empty', async () => {
    vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
      sessionId: 'session-new',
      items: [],
      nextCursor: null,
    });

    useConversationStore.getState().appendEnvelope('session-new', {
      eventId: 'evt-optimistic-user',
      sessionId: 'session-new',
      requestId: 'req-live',
      sequence: 0,
      timelineEventRef: null,
      transportHints: ['local-optimistic'],
      createdAt: '2024-01-01T00:00:01Z',
      eventType: 'REQUEST_ACCEPTED',
      payload: {
        role: 'USER',
        content: 'first question',
        text: 'first question',
        messageId: 'req-live',
        rootMessageId: 'req-live',
      },
    } as StreamEnvelope);

    const replaced = await useConversationStore.getState().loadConversation('session-new');

    expect(replaced).toBe(false);
    const sessionEnvelopes = flattenLiveBuckets(useConversationStore.getState().activeLiveBySession['session-new']);
    expect(sessionEnvelopes).toHaveLength(1);
    expect(sessionEnvelopes[0]?.payload?.content).toBe('first question');
    expect(sessionEnvelopes[0]?.transportHints).toContain('local-optimistic');
  });

  it('preserves non-empty active content when the same lane receives an unavailable completion', () => {
    useConversationStore
      .getState()
      .appendEnvelopes('session-live', [
        processContent('live-content', 1, 'turn-1', 'I will inspect the network evidence.'),
        unavailableCompletion('completed-content', 2, 'turn-1'),
      ]);

    const [snapshot] = flattenLiveBuckets(useConversationStore.getState().activeLiveBySession['session-live']);
    expect(snapshot).toMatchObject({
      eventId: 'completed-content',
      sequence: 2,
      timelineEventRef: 'timeline-completed-content',
      payload: {
        content: 'I will inspect the network evidence.',
        text: 'I will inspect the network evidence.',
        stepId: 'turn-1',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    });
    expect(snapshot?.payload).not.toHaveProperty('contentUnavailable');
  });

  it('does not reuse active content across a different step lane', () => {
    useConversationStore
      .getState()
      .appendEnvelopes('session-live', [
        processContent('live-content', 1, 'turn-1', 'Scoped content.'),
        unavailableCompletion('completed-content', 2, 'turn-2'),
      ]);

    const snapshots = flattenLiveBuckets(useConversationStore.getState().activeLiveBySession['session-live']);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]?.payload).toMatchObject({ content: '', text: '', stepId: 'turn-2', contentUnavailable: true });
  });

  it('keeps accumulated assistant content in separate lanes across accepted user input', () => {
    useConversationStore
      .getState()
      .appendEnvelopes('session-live', [
        processContent('before-input', 1, 'turn-2', '正在调用意图识别工具'),
        envelope('input-received', 2, 'USER_INPUT_RECEIVED', { pendingInputId: 'pending-1' }),
        processContent('after-input', 3, 'turn-2', '已获取补充信息，调用数据查询工具中'),
      ]);

    const snapshots = flattenLiveBuckets(useConversationStore.getState().activeLiveBySession['session-live']);
    const explanations = snapshots.filter((item) => item.eventType === 'LLM_CONTENT_DELTA');
    expect(explanations.map((item) => item.eventId)).toEqual(['before-input', 'after-input']);
    expect(explanations.map((item) => item.sequence)).toEqual([1, 3]);
  });

  it('does not backfill an unavailable active completion from history content', () => {
    useConversationStore.getState().setEnvelopes('session-live', [processContent('history-content', 1, 'turn-1', 'History content.')]);
    useConversationStore.getState().appendEnvelope('session-live', unavailableCompletion('completed-content', 2, 'turn-1'));

    const [active] = flattenLiveBuckets(useConversationStore.getState().activeLiveBySession['session-live']);
    expect(active?.payload).toMatchObject({ content: '', text: '', contentUnavailable: true });
  });

  it('does not backfill a late settled completion from the former active snapshot', () => {
    useConversationStore.getState().appendEnvelope('session-live', processContent('live-content', 1, 'turn-1', 'Former active content.'));
    useConversationStore.getState().appendEnvelope('session-live', requestCompleted(2));
    useConversationStore.getState().appendEnvelope('session-live', unavailableCompletion('completed-content', 3, 'turn-1'));

    const snapshots = flattenLiveBuckets(useConversationStore.getState().settledLiveBySession['session-live']);
    expect(snapshots.find((envelope) => envelope.eventId === 'completed-content')?.payload).toMatchObject({
      content: '',
      text: '',
      contentUnavailable: true,
    });
  });

  it('does not merge active content into an output-guard terminal', () => {
    useConversationStore
      .getState()
      .appendEnvelopes('session-live', [processContent('live-content', 1, 'turn-1', 'Blocked content.'), outputGuardBlocked(2)]);

    const snapshots = flattenLiveBuckets(useConversationStore.getState().activeLiveBySession['session-live']);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({ eventType: 'OUTPUT_GUARD_BLOCKED', payload: { refusalMessage: 'Content blocked.' } });
    expect(snapshots[1]?.payload).not.toHaveProperty('content');
  });
});

function processContent(eventId: string, sequence: number, stepId: string, content: string): StreamEnvelope {
  return envelope(eventId, sequence, 'LLM_CONTENT_DELTA', {
    content,
    text: content,
    role: 'ASSISTANT',
    contentType: 'MARKDOWN',
    stepId,
    metadata: { accumulated: true },
  });
}

function unavailableCompletion(eventId: string, sequence: number, stepId: string): StreamEnvelope {
  return envelope(eventId, sequence, 'LLM_CONTENT_DELTA', {
    content: '',
    text: '',
    role: 'ASSISTANT',
    contentType: 'MARKDOWN',
    stepId,
    completed: true,
    contentUnavailable: true,
    metadata: { accumulated: true, completed: true },
  });
}

function requestCompleted(sequence: number): StreamEnvelope {
  return envelope('request-completed', sequence, 'REQUEST_COMPLETED', { status: 'COMPLETED' });
}

function outputGuardBlocked(sequence: number): StreamEnvelope {
  return envelope('output-guard-blocked', sequence, 'OUTPUT_GUARD_BLOCKED', {
    guardReason: 'OUTPUT_VIOLATION',
    refusalMessage: 'Content blocked.',
  });
}

function envelope(eventId: string, sequence: number, eventType: StreamEnvelope['eventType'], payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId,
    sessionId: 'session-live',
    requestId: 'request-live',
    runId: 'run-live',
    requestContextId: 'attempt-live',
    rootMessageId: 'root-live',
    sequence,
    timelineEventRef: `timeline-${eventId}`,
    transportHints: [],
    createdAt: `2024-01-01T00:00:${String(sequence).padStart(2, '0')}Z`,
    eventType,
    payload: {
      rootMessageId: 'root-live',
      requestId: 'request-live',
      runId: 'run-live',
      requestContextId: 'attempt-live',
      ...payload,
    },
  } as StreamEnvelope;
}
