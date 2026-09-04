import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flattenLiveBuckets, useConversationStore } from '../src/state/conversationStore.ts';
import type { SessionConversationMessage, SessionConversationPage, StreamEnvelope } from '../src/state/contracts.ts';
import { sessionService } from '../src/services/sessionService.ts';
import { FRONTEND_COMPACTED_HINT } from '../src/features/chat/utils/streamCompaction.ts';
import { mergeStreamText, readStreamText } from '../src/features/chat/utils/streamTextSemantics.ts';
import { buildProcessDisplayEntries, buildProcessEntries } from '../src/features/chat/process/processDetails.ts';
import i18n from '../src/i18n/index.ts';

const mockEnvelopes: StreamEnvelope[] = [
  {
    eventId: 'evt-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 1,
    timelineEventRef: null,
    transportHints: [],
    createdAt: '2024-01-01T00:00:00Z',
    eventType: 'REQUEST_ACCEPTED',
    payload: { content: 'Hello', role: 'USER' },
  },
  {
    eventId: 'evt-2',
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 2,
    timelineEventRef: null,
    transportHints: [],
    createdAt: '2024-01-01T00:00:01Z',
    eventType: 'LLM_CONTENT_DELTA',
    payload: { content: 'Response', role: 'ASSISTANT' },
  },
];

function readActiveEnvelopes(sessionId: string): readonly StreamEnvelope[] {
  return flattenLiveBuckets(useConversationStore.getState().activeLiveBySession[sessionId]);
}

function readSettledEnvelopes(sessionId: string): readonly StreamEnvelope[] {
  return flattenLiveBuckets(useConversationStore.getState().settledLiveBySession[sessionId]);
}

function readRetainedEnvelopes(sessionId: string): readonly StreamEnvelope[] {
  const state = useConversationStore.getState();
  return [
    ...(state.historyEnvelopesBySession[sessionId] ?? []),
    ...flattenLiveBuckets(state.settledLiveBySession[sessionId]),
    ...flattenLiveBuckets(state.activeLiveBySession[sessionId]),
  ];
}

function makeLifecycleEnvelope(
  rootMessageId: string,
  attemptId: string,
  sequence: number,
  eventType: StreamEnvelope['eventType'],
  role?: 'USER' | 'ASSISTANT',
  sessionId = 'session-lifecycle',
): StreamEnvelope {
  return {
    eventId: `${rootMessageId}-${attemptId}-${sequence}-${eventType}`,
    sessionId,
    requestId: attemptId,
    requestContextId: attemptId,
    rootMessageId,
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE'],
    createdAt: new Date(Date.UTC(2026, 6, 22, 0, 0, sequence)).toISOString(),
    payload: {
      rootMessageId,
      requestContextId: attemptId,
      ...(role ? { role, content: role === 'USER' ? rootMessageId : `answer-${sequence}` } : {}),
    },
  } as StreamEnvelope;
}

function makeHistoryMessage(messageId: string, content: string, sequence = 1, sessionId = 'session-1'): SessionConversationMessage {
  return {
    messageId,
    sessionId,
    requestContextId: messageId,
    rootMessageId: messageId,
    role: 'USER',
    sequence,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    visible: true,
  };
}

function deferredConversationPage(): {
  readonly promise: Promise<SessionConversationPage>;
  readonly resolve: (page: SessionConversationPage) => void;
} {
  let resolve!: (page: SessionConversationPage) => void;
  return {
    promise: new Promise<SessionConversationPage>((nextResolve) => {
      resolve = nextResolve;
    }),
    resolve: (page) => resolve(page),
  };
}

function mergeStreamEventText(envelopes: readonly StreamEnvelope[], eventType: StreamEnvelope['eventType']): string {
  return [...envelopes]
    .filter((envelope) => envelope.eventType === eventType)
    .reduce(
      (content, envelope) =>
        mergeStreamText(content, readStreamText(envelope, undefined, { allowWhitespaceOnly: true }), envelope.payload as Record<string, unknown>),
      '',
    );
}

function makeLocalOptimisticEnvelope(requestId: string, sequence = 0): StreamEnvelope {
  return {
    eventId: `temp-${requestId}`,
    sessionId: 'session-1',
    requestId,
    rootMessageId: requestId,
    requestContextId: requestId,
    sequence,
    eventType: 'REQUEST_ACCEPTED',
    timelineEventRef: null,
    transportHints: ['local-optimistic'],
    payload: {
      content: 'new message',
      role: 'USER',
      messageId: requestId,
      rootMessageId: requestId,
    },
    createdAt: '2026-07-21T00:00:00.000Z',
  };
}

describe('conversationStore', () => {
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
      conversationPreviewBySession: {},
      conversationViewBySession: {},
      runtimeBySession: {},
      isStreaming: false,
      conversationError: null,
      sessionAccessOrder: [],
    });
  });

  describe('setEnvelopes', () => {
    it('should set envelopes for a session', () => {
      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);

      const state = useConversationStore.getState();
      expect(state.historyEnvelopesBySession['session-1']).toHaveLength(2);
      expect(state.historyEnvelopesBySession['session-1']).toHaveLength(2);
      expect(readActiveEnvelopes('session-1')).toHaveLength(0);
      expect(state.sessionAccessOrder).toContain('session-1');
    });

    it('should replace existing envelopes for a session', () => {
      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!]);
      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[1]!]);

      expect(readRetainedEnvelopes('session-1')).toHaveLength(1);
      expect(readRetainedEnvelopes('session-1')![0]!.eventId).toBe('evt-2');
    });

    it('should preserve runtime envelopes for matching requests when replacing with a snapshot', () => {
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[1]!);
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-cancel',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 3,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:02Z',
        eventType: 'REQUEST_CANCELED',
        payload: {},
      });

      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!, mockEnvelopes[1]!]);

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.some((envelope) => envelope.eventType === 'REQUEST_CANCELED')).toBe(true);
    });

    it('should preserve partial assistant content for canceled requests when a snapshot only contains the user message', () => {
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-user',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 1,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:00Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: { content: 'Hello', role: 'USER', rootMessageId: 'req-1' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-delta',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 2,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'LLM_CONTENT_DELTA',
        payload: { content: 'partial answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-cancel',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 3,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:02Z',
        eventType: 'REQUEST_CANCELED',
        payload: {},
      });

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'conv-user',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'Hello', role: 'USER', rootMessageId: 'req-1' },
        },
      ]);

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.some((envelope) => envelope.eventType === 'LLM_CONTENT_DELTA')).toBe(true);
      expect(sessionEnvelopes.some((envelope) => envelope.eventType === 'REQUEST_CANCELED')).toBe(true);
    });

    it('should preserve superseded terminal events when snapshot identities use the root message id', () => {
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-user',
        sessionId: 'session-1',
        requestId: 'req-old',
        requestContextId: 'attempt-old',
        sequence: 1,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:00Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: { content: 'old question', role: 'USER', rootMessageId: 'req-old' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-delta',
        sessionId: 'session-1',
        requestId: 'run-old',
        requestContextId: 'attempt-old',
        sequence: 2,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          content: 'partial answer',
          role: 'ASSISTANT',
          rootMessageId: 'req-old',
          requestContextId: 'attempt-old',
        },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-superseded',
        sessionId: 'session-1',
        requestId: 'run-old',
        requestContextId: 'attempt-old',
        sequence: 3,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:02Z',
        eventType: 'REQUEST_SUPERSEDED',
        payload: { rootMessageId: 'req-old', requestContextId: 'attempt-old' },
      });

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'conv-user',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'old question', role: 'USER', rootMessageId: 'req-old' },
        },
        {
          eventId: 'conv-answer',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'partial answer', role: 'ASSISTANT', rootMessageId: 'req-old' },
        },
      ]);

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.some((envelope) => envelope.eventType === 'REQUEST_SUPERSEDED')).toBe(true);
    });

    it('should keep superseded roots hidden when a snapshot reintroduces the edited-out root', () => {
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'old-user-local',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['local-superseded'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old question',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
            visible: false,
            supersededByRootMessageId: 'req-2',
          },
        },
        {
          eventId: 'new-user-local',
          sessionId: 'session-1',
          requestId: 'req-2',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['local-optimistic'],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'edited question',
            role: 'USER',
            messageId: 'req-2',
            rootMessageId: 'req-2',
          },
        },
      ]);

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'conv-old-user',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old question',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'conv-old-answer',
          sessionId: 'session-1',
          requestId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            content: 'old answer',
            role: 'ASSISTANT',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'conv-new-user',
          sessionId: 'session-1',
          requestId: 'req-2',
          sequence: 3,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'edited question',
            role: 'USER',
            messageId: 'req-2',
            rootMessageId: 'req-2',
          },
        },
        {
          eventId: 'conv-new-answer',
          sessionId: 'session-1',
          requestId: 'run-new',
          sequence: 4,
          timelineEventRef: null,
          transportHints: ['history-load'],
          createdAt: '2024-01-01T00:00:03Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            content: 'new answer',
            role: 'ASSISTANT',
            rootMessageId: 'req-2',
          },
        },
      ]);

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      const oldRootEnvelopes = sessionEnvelopes.filter((envelope) => (envelope.payload as { rootMessageId?: string }).rootMessageId === 'req-1');

      expect(oldRootEnvelopes).toHaveLength(2);
      expect(oldRootEnvelopes.every((envelope) => envelope.payload.visible === false)).toBe(true);
      expect(oldRootEnvelopes.every((envelope) => envelope.payload.supersededByRootMessageId === 'req-2')).toBe(true);
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            (envelope.payload as { rootMessageId?: string; visible?: boolean }).rootMessageId === 'req-2' && envelope.payload.visible !== false,
        ),
      ).toBe(true);
    });
  });

  describe('appendEnvelope', () => {
    it('should append a new envelope', () => {
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[1]!);

      expect(readRetainedEnvelopes('session-1')).toHaveLength(2);
      expect(useConversationStore.getState().historyEnvelopesBySession['session-1'] ?? []).toHaveLength(0);
      expect(readActiveEnvelopes('session-1')).toHaveLength(2);
    });

    it('should not append duplicate envelopes', () => {
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);
      const duplicateResult = useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);

      expect(readRetainedEnvelopes('session-1')).toHaveLength(1);
      expect(duplicateResult.acceptedEnvelopes).toEqual([mockEnvelopes[0]]);
      expect(duplicateResult.rejectedEnvelopes).toHaveLength(0);
    });

    it('reports an envelope rejected by attempt isolation', () => {
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);
      const staleAttempt = {
        ...mockEnvelopes[1]!,
        eventId: 'evt-stale-attempt',
        requestContextId: 'ctx-stale',
      } as StreamEnvelope;

      const result = useConversationStore.getState().appendEnvelope('session-1', staleAttempt);

      expect(result.acceptedEnvelopes).toHaveLength(0);
      expect(result.rejectedEnvelopes).toEqual([staleAttempt]);
      expect(readRetainedEnvelopes('session-1')).toEqual([mockEnvelopes[0]]);
    });

    it('preserves the history layer reference when appending an unrelated live envelope', () => {
      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);
      const historyBeforeLiveAppend = useConversationStore.getState().historyEnvelopesBySession['session-1'];

      useConversationStore.getState().appendEnvelope('session-1', {
        ...mockEnvelopes[0]!,
        eventId: 'evt-live-new-request',
        requestId: 'req-live-new-request',
        requestContextId: 'ctx-live-new-request',
        rootMessageId: 'req-live-new-request',
        transportHints: [],
      });

      expect(useConversationStore.getState().historyEnvelopesBySession['session-1']).toBe(historyBeforeLiveAppend);
    });

    it('preserves stable history state when appending one local optimistic user envelope', () => {
      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);
      const stateBeforeAppend = useConversationStore.getState();
      const historyBeforeAppend = stateBeforeAppend.historyEnvelopesBySession['session-1'];
      const optimisticEnvelope = makeLocalOptimisticEnvelope('temp-request-fast-path');

      useConversationStore.getState().appendEnvelope('session-1', optimisticEnvelope);

      const stateAfterAppend = useConversationStore.getState();
      expect(stateAfterAppend.historyEnvelopesBySession).toBe(stateBeforeAppend.historyEnvelopesBySession);
      expect(stateAfterAppend.historyMessagesBySession).toBe(stateBeforeAppend.historyMessagesBySession);
      expect(stateAfterAppend.historyEnvelopesBySession['session-1']).toBe(historyBeforeAppend);
      expect(readActiveEnvelopes('session-1')).toEqual([optimisticEnvelope]);
    });

    it('keeps a duplicate local optimistic user envelope as a no-op', () => {
      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);
      const optimisticEnvelope = makeLocalOptimisticEnvelope('temp-request-duplicate');
      useConversationStore.getState().appendEnvelope('session-1', optimisticEnvelope);
      const stateBeforeDuplicate = useConversationStore.getState();

      useConversationStore.getState().appendEnvelope('session-1', optimisticEnvelope);

      expect(useConversationStore.getState()).toBe(stateBeforeDuplicate);
    });

    it('does not evict history when a local optimistic append reaches the live watermark', () => {
      const historyEnvelopes = Array.from({ length: 500 }, (_, index) => ({
        ...mockEnvelopes[0]!,
        eventId: `history-${index}`,
        requestId: `history-request-${index}`,
        requestContextId: `history-request-${index}`,
        sequence: index + 1,
      }));
      useConversationStore.getState().setEnvelopes('session-1', historyEnvelopes);
      const optimisticEnvelope = makeLocalOptimisticEnvelope('temp-request-at-capacity', 501);

      useConversationStore.getState().appendEnvelope('session-1', optimisticEnvelope);

      const state = useConversationStore.getState();
      expect(state.historyEnvelopesBySession['session-1']).toHaveLength(500);
      expect(readActiveEnvelopes('session-1')).toEqual([optimisticEnvelope]);
    });

    it('should replace older accumulated assistant content snapshots in the same live lane', () => {
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);

      for (let index = 0; index < 120; index += 1) {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `snapshot-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'req-snapshot-answer',
          rootMessageId: 'req-snapshot-answer',
          requestContextId: 'ctx-snapshot-answer',
          sequence: index + 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            content: `answer snapshot ${index + 1}`,
            text: `answer snapshot ${index + 1}`,
            role: 'ASSISTANT',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          },
          createdAt: `2024-01-01T05:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
        } as StreamEnvelope);
      }

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes).toHaveLength(2);
      expect(liveEnvelopes[0]?.eventType).toBe('REQUEST_ACCEPTED');
      expect(liveEnvelopes[1]?.eventId).toBe('snapshot-120');
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA')).toBe('answer snapshot 120');
    });

    it('should continue appending non-accumulated assistant content deltas', () => {
      const tokens = ['one', ' ', 'two'];

      tokens.forEach((token, index) => {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `token-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'run-1',
          runId: 'run-1',
          rootMessageId: 'root-1',
          requestContextId: 'attempt-1',
          sequence: index + 1,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            delta: token,
            role: 'ASSISTANT',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false },
            rootMessageId: 'root-1',
            requestContextId: 'attempt-1',
          },
          createdAt: `2024-01-01T00:00:0${index}Z`,
        } as StreamEnvelope);
      });

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes).toHaveLength(3);
      expect(liveEnvelopes.map((envelope) => envelope.eventId)).toEqual(['token-1', 'token-2', 'token-3']);
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA')).toBe('one two');
    });

    it('should append live envelope batches with one store notification', () => {
      const listener = vi.fn();
      const unsubscribe = useConversationStore.subscribe(listener);

      useConversationStore.getState().appendEnvelopes('session-1', [mockEnvelopes[0]!, mockEnvelopes[1]!]);
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(readRetainedEnvelopes('session-1')).toHaveLength(2);
      expect(readActiveEnvelopes('session-1')).toHaveLength(2);
    });

    it('should preserve accumulated snapshot replacement and dedupe semantics within one batch', () => {
      const makeSnapshot = (eventId: string, sequence: number, content: string): StreamEnvelope => ({
        eventId,
        sessionId: 'session-1',
        requestId: 'req-1',
        rootMessageId: 'root-1',
        requestContextId: 'attempt-1',
        sequence,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          content,
          role: 'ASSISTANT',
          metadata: { accumulated: true },
        },
        createdAt: `2024-01-01T00:00:0${sequence}Z`,
      });
      const token: StreamEnvelope = {
        eventId: 'token-1',
        sessionId: 'session-1',
        requestId: 'req-1',
        rootMessageId: 'root-1',
        requestContextId: 'attempt-1',
        sequence: 4,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          delta: '!',
          role: 'ASSISTANT',
          metadata: { accumulated: false },
        },
        createdAt: '2024-01-01T00:00:04Z',
      };

      useConversationStore
        .getState()
        .appendEnvelopes('session-1', [
          mockEnvelopes[0]!,
          makeSnapshot('snapshot-1', 2, 'one'),
          makeSnapshot('snapshot-2', 3, 'one two'),
          token,
          token,
        ]);

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes.map((envelope) => envelope.eventId)).toEqual(['evt-1', 'snapshot-2', 'token-1']);
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA')).toBe('one two!');
    });

    it('should accept live envelopes without changing an anchored history window', () => {
      useConversationStore.getState().setConversationPageInfo('session-1', { newerCursor: 'newer-1' });
      useConversationStore.setState({
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);

      expect(readActiveEnvelopes('session-1')).toHaveLength(1);
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.newerCursor).toBe('newer-1');
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.activeAnchorMessageId).toBe('anchor-1');
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.newMessagesWhileAnchored).toBe(true);
    });

    it('should append live envelopes into anchored state after newer continuity is loaded', () => {
      useConversationStore.getState().setConversationPageInfo('session-1', { newerCursor: null });
      useConversationStore.setState({
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);

      expect(readRetainedEnvelopes('session-1')).toHaveLength(1);
      expect(readActiveEnvelopes('session-1')).toHaveLength(1);
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.newMessagesWhileAnchored).toBe(false);
    });

    it('should keep live envelopes in receive order even when sequence is lower', () => {
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[1]!);
      useConversationStore.getState().appendEnvelope('session-1', mockEnvelopes[0]!);

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes).toHaveLength(2);
      expect(liveEnvelopes.map((envelope) => envelope.eventId)).toEqual(['evt-2', 'evt-1']);
    });

    it('should retain structural events beyond the compaction watermark', () => {
      const manyEnvelopes = Array.from({ length: 501 }, (_, i) => ({
        ...mockEnvelopes[0]!,
        eventId: `evt-${i}`,
        sequence: i + 1,
      }));

      manyEnvelopes.forEach((env) => {
        useConversationStore.getState().appendEnvelope('session-1', env as StreamEnvelope);
      });

      expect(readActiveEnvelopes('session-1')).toHaveLength(501);
    });

    it('should compact long live assistant delta streams without dropping early text', () => {
      const expected = Array.from({ length: 520 }, (_, index) => String(index % 10)).join('');

      for (let index = 0; index < expected.length; index += 1) {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `answer-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'req-long-answer',
          rootMessageId: 'req-long-answer',
          requestContextId: 'req-long-answer',
          sequence: index + 1,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            delta: expected[index]!,
            role: 'ASSISTANT',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false },
          },
          createdAt: `2024-01-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
        } as StreamEnvelope);
      }

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes.length).toBeLessThan(expected.length);
      expect(liveEnvelopes.some((envelope) => envelope.transportHints.includes(FRONTEND_COMPACTED_HINT))).toBe(true);
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA')).toBe(expected);
    });

    it('should preserve word-boundary whitespace while compacting long assistant delta streams', () => {
      const tokens = Array.from({ length: 260 }, (_, index) => [`word${index}`, ' ']).flat();
      const expected = tokens.join('');

      for (let index = 0; index < tokens.length; index += 1) {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `word-token-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'req-word-answer',
          rootMessageId: 'req-word-answer',
          requestContextId: 'req-word-answer',
          sequence: index + 1,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            delta: tokens[index]!,
            role: 'ASSISTANT',
            contentType: 'PLAIN_TEXT',
          },
          createdAt: `2024-01-01T03:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
        } as StreamEnvelope);
      }

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes.length).toBeLessThan(tokens.length);
      expect(liveEnvelopes.some((envelope) => envelope.transportHints.includes(FRONTEND_COMPACTED_HINT))).toBe(true);
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA')).toBe(expected);
    });

    it('should compact a 600-word backend delta stream while preserving complete word-spaced text', () => {
      const words = Array.from({ length: 600 }, (_, index) => `word${index + 1}`);
      const expected = words.map((word) => ` ${word}`).join('');
      const sessionId = 'session-600';
      const requestId = 'req-600';
      const runId = 'run-600';
      const rootMessageId = 'msg-user-600';
      const requestContextId = 'ctx-600';
      const startedAt = Date.parse('2026-05-20T01:00:00.000Z');
      const events: StreamEnvelope[] = [
        {
          eventId: 'evt-600-accepted',
          sessionId,
          requestId,
          runId,
          rootMessageId,
          requestContextId,
          sequence: 1,
          eventType: 'REQUEST_ACCEPTED',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: {
            role: 'USER',
            content: 'Generate a 600 word response.',
            contentType: 'PLAIN_TEXT',
            status: 'EXECUTING',
            runId,
            rootMessageId,
            requestContextId,
          },
          createdAt: new Date(startedAt).toISOString(),
        } as StreamEnvelope,
        ...words.map(
          (word, index) =>
            ({
              eventId: `evt-600-delta-${index + 1}`,
              sessionId,
              requestId,
              runId,
              rootMessageId,
              requestContextId,
              sequence: index + 2,
              eventType: 'LLM_CONTENT_DELTA',
              timelineEventRef: null,
              transportHints: ['SSE'],
              payload: {
                role: 'ASSISTANT',
                delta: ` ${word}`,
                contentType: 'PLAIN_TEXT',
                metadata: { accumulated: false, tokenIndex: index + 1 },
                runId,
                rootMessageId,
                requestContextId,
              },
              createdAt: new Date(startedAt + index + 1).toISOString(),
            }) as StreamEnvelope,
        ),
        {
          eventId: 'evt-600-completed',
          sessionId,
          requestId,
          runId,
          rootMessageId,
          requestContextId,
          sequence: 602,
          eventType: 'REQUEST_COMPLETED',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: {
            status: 'COMPLETED',
            contentType: 'PLAIN_TEXT',
            runId,
            rootMessageId,
            requestContextId,
          },
          createdAt: new Date(startedAt + 601).toISOString(),
        } as StreamEnvelope,
      ];

      for (const event of events) {
        useConversationStore.getState().appendEnvelope(sessionId, event);
      }

      const liveEnvelopes = readSettledEnvelopes(sessionId);
      expect(liveEnvelopes.length).toBeLessThan(events.length);
      expect(liveEnvelopes[0]?.eventType).toBe('REQUEST_ACCEPTED');
      expect(liveEnvelopes[liveEnvelopes.length - 1]?.eventType).toBe('REQUEST_COMPLETED');
      expect(liveEnvelopes.some((envelope) => envelope.transportHints.includes(FRONTEND_COMPACTED_HINT))).toBe(true);
      const mergedText = mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA');
      expect(mergedText).toBe(expected);
      expect(mergedText.trim().split(/\s+/)).toEqual(words);
    });

    it('should compact long live assistant delta streams in receive order instead of timestamp order', () => {
      const tokens = Array.from({ length: 520 }, (_, index) => String.fromCharCode(65 + (index % 26)));
      const expected = tokens.join('');

      for (let index = 0; index < tokens.length; index += 1) {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `reverse-time-token-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'req-reverse-time-answer',
          rootMessageId: 'req-reverse-time-answer',
          requestContextId: 'req-reverse-time-answer',
          sequence: index + 1,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            delta: tokens[index]!,
            role: 'ASSISTANT',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false },
          },
          createdAt: `2024-01-01T04:${String(Math.floor((tokens.length - index) / 60)).padStart(2, '0')}:${String((tokens.length - index) % 60).padStart(2, '0')}Z`,
        } as StreamEnvelope);
      }

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes.length).toBeLessThan(tokens.length);
      expect(liveEnvelopes.some((envelope) => envelope.transportHints.includes(FRONTEND_COMPACTED_HINT))).toBe(true);
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_CONTENT_DELTA')).toBe(expected);
    });

    it('should compact long live thinking streams without dropping early detail', () => {
      const expected = Array.from({ length: 515 }, (_, index) => (index % 2 === 0 ? '思' : '考')).join('');

      for (let index = 0; index < expected.length; index += 1) {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `thinking-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'req-long-thinking',
          rootMessageId: 'req-long-thinking',
          requestContextId: 'req-long-thinking',
          sequence: index + 1,
          eventType: 'LLM_THINKING_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            delta: expected[index]!,
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false },
          },
          createdAt: `2024-01-01T01:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
        } as StreamEnvelope);
      }

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes.length).toBeLessThan(expected.length);
      expect(liveEnvelopes.some((envelope) => envelope.transportHints.includes(FRONTEND_COMPACTED_HINT))).toBe(true);
      expect(mergeStreamEventText(liveEnvelopes, 'LLM_THINKING_DELTA')).toBe(expected);
    });

    it('should compact long live capability result streams without dropping early detail', () => {
      const expected = Array.from({ length: 515 }, (_, index) => String.fromCharCode(97 + (index % 26))).join('');

      for (let index = 0; index < expected.length; index += 1) {
        useConversationStore.getState().appendEnvelope('session-1', {
          eventId: `capability-${index + 1}`,
          sessionId: 'session-1',
          requestId: 'req-long-capability',
          rootMessageId: 'req-long-capability',
          requestContextId: 'req-long-capability',
          sequence: index + 1,
          eventType: 'CAPABILITY_RESULT_DELTA',
          timelineEventRef: null,
          transportHints: [],
          payload: {
            toolCallId: 'tool-1',
            delta: expected[index]!,
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false },
          },
          createdAt: `2024-01-01T02:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
        } as StreamEnvelope);
      }

      const liveEnvelopes = readActiveEnvelopes('session-1');
      expect(liveEnvelopes.length).toBeLessThan(expected.length);
      expect(liveEnvelopes.some((envelope) => envelope.transportHints.includes(FRONTEND_COMPACTED_HINT))).toBe(true);
      expect(mergeStreamEventText(liveEnvelopes, 'CAPABILITY_RESULT_DELTA')).toBe(expected);
    });

    it('should keep local optimistic envelopes after older persisted requests when merged snapshots re-sort the session', () => {
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'evt-old-user',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 10,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'old', role: 'USER', rootMessageId: 'req-old' },
        },
        {
          eventId: 'evt-old-cancel',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 12,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'REQUEST_CANCELED',
          payload: {},
        },
      ]);

      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'temp-new-user',
        sessionId: 'session-1',
        requestId: 'req-new',
        sequence: 0,
        timelineEventRef: null,
        transportHints: ['local-optimistic'],
        createdAt: '2024-01-01T00:00:03Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: { content: 'new', role: 'USER', rootMessageId: 'req-new' },
      });

      useConversationStore.getState().mergeEnvelopes('session-1', [
        {
          eventId: 'conv-old-user',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'old', role: 'USER', rootMessageId: 'req-old' },
        },
        {
          eventId: 'conv-old-assistant',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old response', role: 'ASSISTANT', rootMessageId: 'req-old' },
        },
      ]);

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.at(-1)?.requestId).toBe('req-new');
    });
  });

  describe('active and settled live lifecycle', () => {
    it('moves a terminal batch from active to settled in one observable transition', () => {
      const sessionId = 'session-lifecycle';
      const accepted = makeLifecycleEnvelope('root-1', 'attempt-1', 1, 'REQUEST_ACCEPTED', 'USER');
      useConversationStore.getState().appendEnvelope(sessionId, accepted);
      const snapshots: Array<{ active: boolean; settled: boolean }> = [];
      const unsubscribe = useConversationStore.subscribe((state) => {
        snapshots.push({
          active: Boolean(state.activeLiveBySession[sessionId]?.['root-1']),
          settled: Boolean(state.settledLiveBySession[sessionId]?.['root-1']),
        });
      });

      useConversationStore
        .getState()
        .appendEnvelopes(sessionId, [
          makeLifecycleEnvelope('root-1', 'attempt-1', 2, 'LLM_CONTENT_DELTA', 'ASSISTANT'),
          makeLifecycleEnvelope('root-1', 'attempt-1', 3, 'REQUEST_COMPLETED'),
        ]);
      unsubscribe();

      expect(snapshots).toEqual([{ active: false, settled: true }]);
      expect(readSettledEnvelopes(sessionId).map((envelope) => envelope.eventType)).toEqual([
        'REQUEST_ACCEPTED',
        'LLM_CONTENT_DELTA',
        'REQUEST_COMPLETED',
      ]);
    });

    it('preserves process display semantics when terminal moves an active bucket to settled', () => {
      const sessionId = 'session-lifecycle';
      const rootMessageId = 'root-capability';
      const attemptId = 'attempt-capability';
      const accepted = makeLifecycleEnvelope(rootMessageId, attemptId, 1, 'REQUEST_ACCEPTED', 'USER');
      const structuredResult = {
        ...makeLifecycleEnvelope(rootMessageId, attemptId, 2, 'CAPABILITY_RESULT_DELTA'),
        payload: {
          rootMessageId,
          requestContextId: attemptId,
          toolCallId: 'tool-1',
          toolName: 'networkDiagnostic',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: true },
          safeSummary: 'Validated three network interfaces.',
          safeResult: {
            kind: 'fileList',
            filenames: ['interface-1', 'interface-2', 'interface-3'],
            totalCount: 3,
            truncated: false,
          },
          status: 'SUCCEEDED',
        },
      } as StreamEnvelope;
      const trailingDelta = {
        ...makeLifecycleEnvelope(rootMessageId, attemptId, 3, 'CAPABILITY_RESULT_DELTA'),
        payload: {
          rootMessageId,
          requestContextId: attemptId,
          toolCallId: 'tool-1',
          delta: 'Follow-up detail.',
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: false },
        },
      } as StreamEnvelope;

      useConversationStore.getState().appendEnvelopes(sessionId, [accepted, structuredResult, trailingDelta]);
      const activeDisplay = buildProcessDisplayEntries(buildProcessEntries(readActiveEnvelopes(sessionId), i18n.t), i18n.t);

      useConversationStore.getState().appendEnvelope(sessionId, makeLifecycleEnvelope(rootMessageId, attemptId, 4, 'REQUEST_COMPLETED'));
      const settledEnvelopes = readSettledEnvelopes(sessionId);
      const settledDisplay = buildProcessDisplayEntries(buildProcessEntries(settledEnvelopes, i18n.t), i18n.t);

      expect(settledDisplay).toEqual(activeDisplay);
      expect(settledEnvelopes).toContain(structuredResult);
    });

    it('merges accepted identity and late detail into a terminal-first settled bucket', () => {
      const sessionId = 'session-lifecycle';
      const terminal = makeLifecycleEnvelope('root-1', 'attempt-1', 3, 'REQUEST_COMPLETED');
      useConversationStore.getState().appendEnvelope(sessionId, terminal);
      useConversationStore.getState().appendEnvelope(sessionId, makeLifecycleEnvelope('root-1', 'attempt-1', 1, 'REQUEST_ACCEPTED', 'USER'));
      useConversationStore.getState().appendEnvelope(sessionId, makeLifecycleEnvelope('root-1', 'attempt-1', 2, 'LLM_THINKING_DELTA'));

      expect(useConversationStore.getState().activeLiveBySession[sessionId]?.['root-1']).toBeUndefined();
      expect(readSettledEnvelopes(sessionId).map((envelope) => envelope.eventType)).toEqual([
        'REQUEST_COMPLETED',
        'REQUEST_ACCEPTED',
        'LLM_THINKING_DELTA',
      ]);
    });

    it('keeps duplicate terminal events as a store no-op', () => {
      const sessionId = 'session-lifecycle';
      const terminal = makeLifecycleEnvelope('root-1', 'attempt-1', 2, 'REQUEST_COMPLETED');
      useConversationStore
        .getState()
        .appendEnvelopes(sessionId, [makeLifecycleEnvelope('root-1', 'attempt-1', 1, 'REQUEST_ACCEPTED', 'USER'), terminal]);
      const beforeDuplicate = useConversationStore.getState();

      useConversationStore.getState().appendEnvelope(sessionId, terminal);

      expect(useConversationStore.getState()).toBe(beforeDuplicate);
    });

    it('does not let an older attempt overwrite a newer attempt for the same root', () => {
      const sessionId = 'session-lifecycle';
      useConversationStore
        .getState()
        .appendEnvelopes(sessionId, [
          makeLifecycleEnvelope('root-1', 'attempt-1', 1, 'REQUEST_ACCEPTED', 'USER'),
          makeLifecycleEnvelope('root-1', 'attempt-1', 2, 'REQUEST_COMPLETED'),
          makeLifecycleEnvelope('root-1', 'attempt-2', 3, 'REQUEST_ACCEPTED'),
          makeLifecycleEnvelope('root-1', 'attempt-1', 4, 'LLM_CONTENT_DELTA', 'ASSISTANT'),
          makeLifecycleEnvelope('root-1', 'attempt-1', 1, 'REQUEST_ACCEPTED'),
        ]);

      const activeBucket = useConversationStore.getState().activeLiveBySession[sessionId]?.['root-1'];
      expect(activeBucket?.attemptId).toBe('attempt-2');
      expect(activeBucket?.envelopes).toHaveLength(1);
      expect(useConversationStore.getState().settledLiveBySession[sessionId]?.['root-1']).toBeUndefined();
    });

    it('atomically rekeys an optimistic root into an already-settled accepted identity', () => {
      const sessionId = 'session-lifecycle';
      useConversationStore.getState().appendEnvelope(sessionId, makeLifecycleEnvelope('temp-root', 'temp-root', 0, 'REQUEST_ACCEPTED', 'USER'));
      useConversationStore.getState().appendEnvelope(sessionId, makeLifecycleEnvelope('accepted-root', 'accepted-root', 2, 'REQUEST_COMPLETED'));

      useConversationStore.getState().reconcileOptimisticRequest(sessionId, 'temp-root', { rootMessageId: 'accepted-root' });

      expect(useConversationStore.getState().activeLiveBySession[sessionId]?.['temp-root']).toBeUndefined();
      expect(useConversationStore.getState().activeLiveBySession[sessionId]?.['accepted-root']).toBeUndefined();
      expect(useConversationStore.getState().settledLiveBySession[sessionId]?.['accepted-root']?.firstSeenOrdinal).toBe(0);
      expect(useConversationStore.getState().nextLiveOrdinalBySession[sessionId]).toBe(2);
      expect(readSettledEnvelopes(sessionId).map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']);
    });

    it('retains at least 600 completed live-only turns without session-wide eviction', () => {
      const sessionId = 'session-lifecycle';
      for (let index = 0; index < 600; index += 1) {
        const root = `root-${index}`;
        const attempt = `attempt-${index}`;
        useConversationStore
          .getState()
          .appendEnvelopes(sessionId, [
            makeLifecycleEnvelope(root, attempt, index * 2 + 1, 'REQUEST_ACCEPTED', 'USER'),
            makeLifecycleEnvelope(root, attempt, index * 2 + 2, 'REQUEST_COMPLETED'),
          ]);
      }

      expect(Object.keys(useConversationStore.getState().settledLiveBySession[sessionId] ?? {})).toHaveLength(600);
      expect(readSettledEnvelopes(sessionId).filter((envelope) => envelope.eventType === 'REQUEST_COMPLETED')).toHaveLength(600);
    });
  });

  describe('reconcileOptimisticRequest', () => {
    it('should replace the optimistic request id with the accepted request id', () => {
      useConversationStore.getState().appendEnvelope('session-1', makeLocalOptimisticEnvelope('temp-request-1'));

      useConversationStore.getState().reconcileOptimisticRequest('session-1', 'temp-request-1', {
        rootMessageId: 'accepted-request-1',
        runId: 'run-1',
        requestContextId: 'request-context-1',
      });

      const [envelope] = readRetainedEnvelopes('session-1');
      expect(envelope?.requestId).toBe('accepted-request-1');
      expect((envelope?.payload as { rootMessageId?: string }).rootMessageId).toBe('accepted-request-1');
    });

    it('should update superseded root mappings from the optimistic id to the accepted id', () => {
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'old-user',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['local-superseded'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old question',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
            visible: false,
            supersededByRootMessageId: 'temp-request-1',
          },
        },
      ]);
      useConversationStore.getState().appendEnvelope('session-1', makeLocalOptimisticEnvelope('temp-request-1'));

      useConversationStore.getState().reconcileOptimisticRequest('session-1', 'temp-request-1', {
        rootMessageId: 'accepted-request-1',
        runId: 'run-1',
        requestContextId: 'request-context-1',
      });

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes[0]?.payload.supersededByRootMessageId).toBe('accepted-request-1');
      expect(sessionEnvelopes[1]?.requestId).toBe('accepted-request-1');
      expect((sessionEnvelopes[1]?.payload as { rootMessageId?: string }).rootMessageId).toBe('accepted-request-1');
    });

    it('does not rekey history-loaded envelopes that share a retry root', () => {
      useConversationStore
        .getState()
        .setEnvelopes('session-1', [
          makeLifecycleEnvelope('root-1', 'attempt-old', 1, 'REQUEST_ACCEPTED', 'USER'),
          makeLifecycleEnvelope('root-1', 'attempt-old', 2, 'LLM_CONTENT_DELTA', 'ASSISTANT'),
        ]);

      useConversationStore.getState().reconcileOptimisticRequest('session-1', 'root-1', {
        rootMessageId: 'root-1',
        runId: 'run-new',
        requestContextId: 'attempt-new',
      });

      const history = useConversationStore.getState().historyEnvelopesBySession['session-1'] ?? [];
      expect(history).toHaveLength(2);
      expect(history.every((envelope) => envelope.runId !== 'run-new')).toBe(true);
      expect(history.every((envelope) => envelope.requestContextId === 'attempt-old')).toBe(true);
    });

    it('keeps the optimistic user anchor when the first canonical event uses a distinct attempt', () => {
      useConversationStore.getState().appendEnvelope('session-1', makeLocalOptimisticEnvelope('temp-request-1'));
      useConversationStore.getState().reconcileOptimisticRequest('session-1', 'temp-request-1', {
        rootMessageId: 'accepted-request-1',
        runId: 'run-1',
        requestContextId: 'request-context-1',
      });

      useConversationStore
        .getState()
        .appendEnvelope('session-1', makeLifecycleEnvelope('accepted-request-1', 'request-context-1', 2, 'LLM_THINKING_DELTA'));

      const bucket = useConversationStore.getState().activeLiveBySession['session-1']?.['accepted-request-1'];
      expect(bucket?.attemptId).toBe('request-context-1');
      expect(bucket?.envelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'LLM_THINKING_DELTA']);
    });

    it('merges an exact live bucket that arrived before HTTP identity into the optimistic turn', () => {
      const optimisticRequestId = 'temp-request-before-http';
      const rootMessageId = 'accepted-request-before-http';
      const runId = 'run-before-http';
      const requestContextId = 'context-before-http';
      useConversationStore.getState().appendEnvelope('session-1', makeLocalOptimisticEnvelope(optimisticRequestId));

      const thinking = {
        ...makeLifecycleEnvelope(rootMessageId, requestContextId, 2, 'LLM_THINKING_DELTA'),
        requestId: rootMessageId,
        runId,
        payload: {
          rootMessageId,
          runId,
          requestContextId,
          delta: 'working before HTTP',
        },
      } as StreamEnvelope;
      const terminal = {
        ...makeLifecycleEnvelope(rootMessageId, requestContextId, 3, 'REQUEST_COMPLETED'),
        requestId: rootMessageId,
        runId,
        payload: {
          rootMessageId,
          runId,
          requestContextId,
          status: 'COMPLETED',
          content: 'done before HTTP',
        },
      } as StreamEnvelope;
      useConversationStore.getState().appendEnvelopes('session-1', [thinking, terminal]);

      const resolvedRequestContextId = useConversationStore
        .getState()
        .reconcileOptimisticRequest('session-1', optimisticRequestId, { rootMessageId, runId });

      const state = useConversationStore.getState();
      const settledBucket = state.settledLiveBySession['session-1']?.[rootMessageId];
      expect(resolvedRequestContextId).toBe(requestContextId);
      expect(state.activeLiveBySession['session-1']?.[optimisticRequestId]).toBeUndefined();
      expect(settledBucket?.attemptId).toBe(requestContextId);
      expect(settledBucket?.envelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'LLM_THINKING_DELTA', 'REQUEST_COMPLETED']);
      expect(settledBucket?.envelopes[0]).toMatchObject({
        requestId: rootMessageId,
        runId,
        requestContextId,
        payload: {
          role: 'USER',
          rootMessageId,
          runId,
          requestContextId,
        },
      });
    });

    it('can move a stable optimistic anchor away from a conflicting stream candidate', () => {
      const optimisticRequestId = 'temp-request-conflict';
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'old-user-conflict',
          sessionId: 'session-1',
          requestId: 'old-root',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['local-superseded'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old question',
            role: 'USER',
            messageId: 'old-root',
            rootMessageId: 'old-root',
            visible: false,
            supersededByRootMessageId: optimisticRequestId,
          },
        },
      ]);
      useConversationStore.getState().appendEnvelope('session-1', makeLocalOptimisticEnvelope(optimisticRequestId));
      useConversationStore.getState().reconcileOptimisticRequest('session-1', optimisticRequestId, {
        rootMessageId: 'candidate-root',
        runId: 'candidate-run',
        requestContextId: 'candidate-context',
      });

      useConversationStore.getState().reconcileOptimisticRequest('session-1', optimisticRequestId, {
        rootMessageId: 'http-root',
        runId: 'http-run',
        previousRootMessageId: 'candidate-root',
      });

      const state = useConversationStore.getState();
      const history = state.historyEnvelopesBySession['session-1'] ?? [];
      const httpBucket = state.activeLiveBySession['session-1']?.['http-root'];
      expect(history[0]?.payload.supersededByRootMessageId).toBe('http-root');
      expect(httpBucket?.envelopes[0]).toMatchObject({
        eventId: `temp-${optimisticRequestId}`,
        requestId: 'http-root',
        runId: 'http-run',
        requestContextId: 'http-root',
        payload: {
          rootMessageId: 'http-root',
          requestContextId: 'http-root',
        },
      });
    });
  });

  describe('optimisticallyEditRoot', () => {
    it('should hide the superseded root and append a new optimistic edited root', () => {
      useConversationStore.setState((state) => ({
        historyMessagesBySession: {
          ...state.historyMessagesBySession,
          'session-1': [
            {
              messageId: 'req-1',
              sessionId: 'session-1',
              requestId: 'req-1',
              role: 'USER',
              sequence: 1,
              content: 'old question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'assistant-1',
              sessionId: 'session-1',
              requestId: 'req-1',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'old answer',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2024-01-01T00:00:01Z',
              visible: true,
            },
          ],
        },
      }));
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'user-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old question',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'assistant-1',
          sessionId: 'session-1',
          requestId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
      ]);

      useConversationStore.getState().optimisticallyEditRoot('session-1', 'req-1', 'edited question', 'temp-edit-1');

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes).toHaveLength(3);
      expect(sessionEnvelopes[0]?.payload.visible).toBe(false);
      expect(sessionEnvelopes[1]?.payload.visible).toBe(false);
      expect(sessionEnvelopes[2]?.requestId).toBe('temp-edit-1');
      expect(sessionEnvelopes[2]?.payload.content).toBe('edited question');
      expect((sessionEnvelopes[2]?.payload as { rootMessageId?: string }).rootMessageId).toBe('temp-edit-1');
      expect((sessionEnvelopes[2]?.payload as { editedFromMessageId?: string }).editedFromMessageId).toBe('req-1');
      expect(useConversationStore.getState().historyMessagesBySession['session-1']?.map((message) => message.visible)).toEqual([false, false]);
    });
  });

  describe('rollbackOptimisticEdit', () => {
    it('should restore the superseded root when edit submission fails', () => {
      useConversationStore.setState((state) => ({
        historyMessagesBySession: {
          ...state.historyMessagesBySession,
          'session-1': [
            {
              messageId: 'req-1',
              sessionId: 'session-1',
              requestId: 'req-1',
              role: 'USER',
              sequence: 1,
              content: 'old question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'assistant-1',
              sessionId: 'session-1',
              requestId: 'req-1',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'old answer',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2024-01-01T00:00:01Z',
              visible: true,
            },
          ],
        },
      }));
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'user-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old question',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'assistant-1',
          sessionId: 'session-1',
          requestId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
      ]);

      useConversationStore.getState().optimisticallyEditRoot('session-1', 'req-1', 'edited question', 'temp-edit-1');

      useConversationStore.getState().rollbackOptimisticEdit('session-1', 'req-1', 'temp-edit-1');

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes).toHaveLength(2);
      expect(sessionEnvelopes.every((envelope) => envelope.payload.visible !== false)).toBe(true);
      expect(sessionEnvelopes.some((envelope) => envelope.requestId === 'temp-edit-1')).toBe(false);
      expect(useConversationStore.getState().historyMessagesBySession['session-1']?.map((message) => message.visible)).toEqual([true, true]);
    });
  });

  describe('clearAssistantEnvelopesForRoot', () => {
    it('should keep the user envelope while removing assistant envelopes for the retried root', () => {
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'user-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'hello', role: 'USER', rootMessageId: 'req-1' },
        },
        {
          eventId: 'assistant-1',
          sessionId: 'session-1',
          requestId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
        {
          eventId: 'assistant-other',
          sessionId: 'session-1',
          requestId: 'run-other',
          sequence: 3,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'other root', role: 'ASSISTANT', rootMessageId: 'req-2' },
        },
      ]);
      useConversationStore.setState({
        historyMessagesBySession: {
          'session-1': [
            {
              messageId: 'user-1',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'USER',
              sequence: 1,
              content: 'hello',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'assistant-1',
              sessionId: 'session-1',
              requestContextId: 'run-old',
              rootMessageId: 'req-1',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'old answer',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2024-01-01T00:00:01Z',
              visible: true,
            },
            {
              messageId: 'assistant-other',
              sessionId: 'session-1',
              requestContextId: 'run-other',
              rootMessageId: 'req-2',
              role: 'ASSISTANT',
              sequence: 3,
              content: 'other root',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2024-01-01T00:00:02Z',
              visible: true,
            },
          ],
        },
      });

      useConversationStore.getState().clearAssistantEnvelopesForRoot('session-1', 'req-1');

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      const historyMessages = useConversationStore.getState().historyMessagesBySession['session-1'] ?? [];
      expect(sessionEnvelopes).toHaveLength(2);
      expect(sessionEnvelopes.some((envelope) => envelope.payload?.role === 'USER' && envelope.payload?.rootMessageId === 'req-1')).toBe(true);
      expect(sessionEnvelopes.some((envelope) => envelope.payload?.rootMessageId === 'req-1' && envelope.eventType === 'LLM_CONTENT_DELTA')).toBe(
        false,
      );
      expect(sessionEnvelopes.some((envelope) => envelope.payload?.rootMessageId === 'req-2')).toBe(true);
      expect(historyMessages).toHaveLength(2);
      expect(historyMessages.some((message) => message.rootMessageId === 'req-1' && message.role === 'ASSISTANT')).toBe(false);
      expect(historyMessages.some((message) => message.rootMessageId === 'req-1' && message.role === 'USER')).toBe(true);
    });

    it('should preserve the accepted retry run while removing old attempt envelopes', () => {
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'user-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'hello', role: 'USER', rootMessageId: 'req-1' },
        },
        {
          eventId: 'assistant-old',
          sessionId: 'session-1',
          requestId: 'req-1',
          runId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-1', runId: 'run-old' },
        },
        {
          eventId: 'assistant-new',
          sessionId: 'session-1',
          requestId: 'req-1',
          runId: 'run-new',
          sequence: 3,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'new thinking', role: 'ASSISTANT', rootMessageId: 'req-1', runId: 'run-new' },
        },
      ]);

      useConversationStore.getState().clearAssistantEnvelopesForRoot('session-1', 'req-1', {
        preserveRunId: 'run-new',
      });

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.some((envelope) => envelope.eventId === 'assistant-old')).toBe(false);
      expect(sessionEnvelopes.some((envelope) => envelope.eventId === 'assistant-new')).toBe(true);
    });

    it('preserves the edited optimistic user when retry stream settles before retry acceptance returns', () => {
      const sessionId = 'session-1';
      const rootMessageId = 'root-edited';

      useConversationStore.getState().appendEnvelope(sessionId, makeLocalOptimisticEnvelope(rootMessageId));
      useConversationStore
        .getState()
        .appendEnvelopes(sessionId, [
          makeLifecycleEnvelope(rootMessageId, 'attempt-edit', 1, 'REQUEST_ACCEPTED', undefined, sessionId),
          makeLifecycleEnvelope(rootMessageId, 'attempt-edit', 2, 'LLM_CONTENT_DELTA', 'ASSISTANT', sessionId),
          makeLifecycleEnvelope(rootMessageId, 'attempt-edit', 3, 'REQUEST_COMPLETED', undefined, sessionId),
        ]);

      useConversationStore
        .getState()
        .appendEnvelopes(sessionId, [
          makeLifecycleEnvelope(rootMessageId, 'attempt-retry', 4, 'REQUEST_ACCEPTED', undefined, sessionId),
          makeLifecycleEnvelope(rootMessageId, 'attempt-retry', 5, 'LLM_CONTENT_DELTA', 'ASSISTANT', sessionId),
          makeLifecycleEnvelope(rootMessageId, 'attempt-retry', 6, 'REQUEST_COMPLETED', undefined, sessionId),
        ]);
      useConversationStore.getState().clearAssistantEnvelopesForRoot(sessionId, rootMessageId, {
        preserveRunId: 'attempt-retry',
      });

      const retained = readRetainedEnvelopes(sessionId);
      expect(retained.some((envelope) => envelope.payload?.role === 'USER' && envelope.transportHints.includes('local-optimistic'))).toBe(true);
      expect(retained.some((envelope) => envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.requestContextId === 'attempt-edit')).toBe(false);
      expect(retained.some((envelope) => envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.requestContextId === 'attempt-retry')).toBe(true);
      expect(retained.some((envelope) => envelope.eventType === 'REQUEST_COMPLETED' && envelope.requestContextId === 'attempt-retry')).toBe(true);
    });
  });

  describe('selectRetryAttemptForRoot', () => {
    it('selects the accepted run without deleting the old process-history cache', () => {
      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'user-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          runId: 'run-old',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'hello', role: 'USER', rootMessageId: 'req-1' },
        },
        {
          eventId: 'assistant-old',
          sessionId: 'session-1',
          requestId: 'req-1',
          runId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
        {
          eventId: 'assistant-new',
          sessionId: 'session-1',
          requestId: 'req-1',
          runId: 'run-new',
          sequence: 3,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'new thinking', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
      ]);
      const oldCache = {
        status: 'AVAILABLE' as const,
        envelopes: [
          {
            eventId: 'cached-old',
            sessionId: 'session-1',
            requestId: 'req-1',
            runId: 'run-old',
            rootMessageId: 'req-1',
            sequence: 2,
            timelineEventRef: null,
            transportHints: ['history-load'],
            createdAt: '2024-01-01T00:00:01Z',
            eventType: 'LLM_THINKING_DELTA' as const,
            payload: { content: 'cached old thinking' },
          },
        ],
      };
      useConversationStore.setState({
        displayProcessRunByRootBySession: { 'session-1': { 'req-1': 'run-old' } },
        processHistoryBySession: { 'session-1': { 'run-old': oldCache } },
      });

      useConversationStore.getState().selectRetryAttemptForRoot('session-1', 'req-1', 'run-new');

      const state = useConversationStore.getState();
      const retained = readRetainedEnvelopes('session-1');
      expect(retained.some((envelope) => envelope.eventId === 'assistant-old')).toBe(false);
      expect(retained.some((envelope) => envelope.eventId === 'assistant-new')).toBe(true);
      expect(state.displayProcessRunByRootBySession['session-1']?.['req-1']).toBe('run-new');
      expect(state.processHistoryBySession['session-1']?.['run-old']).toEqual(oldCache);
    });

    it('keeps the parent session unchanged when a fork child selects its retry run', () => {
      const rootMessageId = 'shared-root';
      const parentEvents = [
        makeLifecycleEnvelope(rootMessageId, 'parent-run', 1, 'REQUEST_ACCEPTED', undefined, 'parent-session'),
        makeLifecycleEnvelope(rootMessageId, 'parent-run', 2, 'LLM_CONTENT_DELTA', 'ASSISTANT', 'parent-session'),
      ];
      const childEvents = [
        makeLifecycleEnvelope(rootMessageId, 'child-old-run', 1, 'REQUEST_ACCEPTED', undefined, 'child-session'),
        makeLifecycleEnvelope(rootMessageId, 'child-old-run', 2, 'LLM_CONTENT_DELTA', 'ASSISTANT', 'child-session'),
        makeLifecycleEnvelope(rootMessageId, 'child-new-run', 3, 'LLM_THINKING_DELTA', 'ASSISTANT', 'child-session'),
      ];
      useConversationStore.getState().setEnvelopes('parent-session', parentEvents);
      useConversationStore.getState().setEnvelopes('child-session', childEvents);

      useConversationStore.getState().selectRetryAttemptForRoot('child-session', rootMessageId, 'child-new-run');

      expect(readRetainedEnvelopes('parent-session').map((event) => event.eventId)).toEqual(parentEvents.map((event) => event.eventId));
      expect(
        readRetainedEnvelopes('parent-session').some((event) => event.requestContextId === 'parent-run' && event.payload?.role === 'ASSISTANT'),
      ).toBe(true);
      expect(
        readRetainedEnvelopes('child-session').some((event) => event.requestContextId === 'child-old-run' && event.payload?.role === 'ASSISTANT'),
      ).toBe(false);
      expect(useConversationStore.getState().displayProcessRunByRootBySession['parent-session']).toBeUndefined();
      expect(useConversationStore.getState().displayProcessRunByRootBySession['child-session']?.[rootMessageId]).toBe('child-new-run');
    });
  });

  describe('setConversationLoadState', () => {
    it('should update load state for a session', () => {
      useConversationStore.getState().setConversationLoadState('session-1', 'loading');
      expect(useConversationStore.getState().conversationLoadStateBySession['session-1']).toBe('loading');
    });

    it('should allow updating to different states', () => {
      useConversationStore.getState().setConversationLoadState('session-1', 'loading');
      useConversationStore.getState().setConversationLoadState('session-1', 'ready');
      expect(useConversationStore.getState().conversationLoadStateBySession['session-1']).toBe('ready');
    });
  });

  describe('loadConversation', () => {
    it('uses the routed chat default conversation query when loading history', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [],
        nextCursor: null,
      });

      await useConversationStore.getState().loadConversation('session-1');

      expect(loadConversationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          includeCapabilityResults: false,
        }),
      );
      loadConversationSpy.mockRestore();
    });

    it('localizes the conversation error when the session is not found', async () => {
      const notFoundError = new Error('Session was not found.') as Error & { code?: string };
      Object.assign(notFoundError, {
        status: 404,
        code: 'SESSION_NOT_FOUND',
        error: 'Session was not found.',
        kind: 'http',
        retriable: false,
        authChallenge: null,
      });
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockRejectedValue(notFoundError);

      await useConversationStore.getState().loadConversation('missing-session');

      expect(useConversationStore.getState().conversationError).toBe(i18n.t('requestNotices.sessionNotFound'));
      expect(useConversationStore.getState().conversationError).not.toContain('Session was not found.');
      expect(useConversationStore.getState().conversationErrorCode).toBe('SESSION_NOT_FOUND');
      loadConversationSpy.mockRestore();
    });

    it('stores and clears fork notice only from default conversation loads', async () => {
      const loadConversationSpy = vi
        .spyOn(sessionService, 'loadConversation')
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [],
          nextCursor: null,
          forkNotice: {
            sourceSessionId: 'source-session',
            sourceSessionTitle: 'Source title',
          },
        })
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [],
          nextCursor: null,
        });

      await useConversationStore.getState().loadConversation('session-1');
      expect(useConversationStore.getState().forkNoticeBySession['session-1']).toEqual({
        sourceSessionId: 'source-session',
        sourceSessionTitle: 'Source title',
      });

      await useConversationStore.getState().loadConversation('session-1');
      expect(useConversationStore.getState().forkNoticeBySession['session-1']).toBeUndefined();
      loadConversationSpy.mockRestore();
    });

    it('does not clear fork notice when loading an anchored conversation page', async () => {
      useConversationStore.setState({
        forkNoticeBySession: {
          'session-1': {
            sourceSessionId: 'source-session',
            sourceSessionTitle: 'Source title',
          },
        },
      });
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [],
        nextCursor: null,
      });

      await useConversationStore.getState().loadAnchoredConversation('session-1', 'anchor-message');

      expect(useConversationStore.getState().forkNoticeBySession['session-1']).toEqual({
        sourceSessionId: 'source-session',
        sourceSessionTitle: 'Source title',
      });
      loadConversationSpy.mockRestore();
    });

    it('stores raw history messages alongside layered envelopes', async () => {
      vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'msg-user',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'msg-answer',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'ASSISTANT',
            sequence: 2,
            content: 'answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:01Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1');

      expect(replaced).toBe(true);
      expect(useConversationStore.getState().historyMessagesBySession['session-1']).toHaveLength(2);
      expect(readRetainedEnvelopes('session-1')).toHaveLength(2);
    });

    it('stores server-projected activeRun from the conversation bootstrap', async () => {
      vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [],
        nextCursor: null,
        activeRun: {
          requestId: 'req-active',
          runId: 'run-active',
          status: 'EXECUTING',
        },
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1');

      expect(replaced).toBe(true);
      expect(useConversationStore.getState().runtimeBySession['session-1']?.activeRun).toEqual({
        requestId: 'req-active',
        runId: 'run-active',
        status: 'EXECUTING',
      });
    });

    it('does not publish an anchored load as ready before the anchored view is stored', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'anchor-root',
            sessionId: 'session-1',
            requestContextId: 'anchor-root',
            rootMessageId: 'anchor-root',
            role: 'USER',
            sequence: 1,
            content: 'anchor question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
        ],
        nextCursor: null,
        newerCursor: 'newer-cursor',
      });
      const readyBeforeAnchoredSnapshots: unknown[] = [];
      const unsubscribe = useConversationStore.subscribe((state) => {
        const loadState = state.conversationLoadStateBySession['session-1'];
        const view = state.conversationViewBySession['session-1'];
        if (loadState === 'ready' && view?.mode !== 'anchored') {
          readyBeforeAnchoredSnapshots.push({ loadState, view });
        }
      });

      const loaded = await useConversationStore.getState().loadAnchoredConversation('session-1', 'anchor-root');
      unsubscribe();

      expect(loaded).toBe(true);
      expect(readyBeforeAnchoredSnapshots).toEqual([]);
      expect(useConversationStore.getState().conversationViewBySession['session-1']).toEqual({
        mode: 'anchored',
        activeAnchorMessageId: 'anchor-root',
        newMessagesWhileAnchored: false,
      });
      expect(loadConversationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          anchorMessageId: 'anchor-root',
          limit: 50,
        }),
      );
      loadConversationSpy.mockRestore();
    });

    it('does not let a background refresh overwrite an anchored conversation', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'latest-root',
            sessionId: 'session-1',
            requestContextId: 'latest-root',
            rootMessageId: 'latest-root',
            role: 'USER',
            sequence: 10,
            content: 'latest question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:10Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });
      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!]);
      useConversationStore.setState({
        conversationLoadStateBySession: { 'session-1': 'ready' },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-root',
            newMessagesWhileAnchored: false,
          },
        },
      });

      const refreshed = await useConversationStore.getState().loadConversation('session-1', { background: true });

      expect(refreshed).toBe(false);
      expect(loadConversationSpy).toHaveBeenCalled();
      expect(useConversationStore.getState().conversationViewBySession['session-1']).toEqual({
        mode: 'anchored',
        activeAnchorMessageId: 'anchor-root',
        newMessagesWhileAnchored: false,
      });
      expect(readRetainedEnvelopes('session-1')?.map((envelope) => envelope.eventId)).toEqual(['evt-1']);
      loadConversationSpy.mockRestore();
    });

    it('should preserve existing envelopes when a background refresh snapshots as empty', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [],
        nextCursor: null,
      });

      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);

      await useConversationStore.getState().loadConversation('session-1', { background: true });

      expect(readRetainedEnvelopes('session-1')).toHaveLength(2);
      expect(useConversationStore.getState().conversationLoadStateBySession['session-1']).toBe('ready');
      loadConversationSpy.mockRestore();
    });

    it('should ignore background snapshots that miss a local optimistic request', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'Hello',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!]);
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'temp-req-new',
        sessionId: 'session-1',
        requestId: 'req-new',
        sequence: 0,
        timelineEventRef: null,
        transportHints: ['local-optimistic'],
        createdAt: '2024-01-01T00:00:03Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: {
          content: 'new local question',
          role: 'USER',
          messageId: 'req-new',
          rootMessageId: 'req-new',
        },
      });

      const refreshed = await useConversationStore.getState().loadConversation('session-1', { background: true });

      expect(refreshed).toBe(false);
      expect(
        readRetainedEnvelopes('session-1')?.some(
          (envelope) => envelope.requestId === 'req-new' && envelope.transportHints.includes('local-optimistic'),
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });

    it('should ignore stale snapshots that complete after retry replacement clears old assistant output', async () => {
      let resolveSnapshot: ((page: Awaited<ReturnType<typeof sessionService.loadConversation>>) => void) | undefined;
      const snapshotPromise = new Promise<Awaited<ReturnType<typeof sessionService.loadConversation>>>((resolve) => {
        resolveSnapshot = resolve;
      });
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockReturnValue(snapshotPromise);

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'user-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'hello', role: 'USER', rootMessageId: 'req-1' },
        },
        {
          eventId: 'assistant-old',
          sessionId: 'session-1',
          requestId: 'req-1',
          runId: 'run-old',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'old answer', role: 'ASSISTANT', rootMessageId: 'req-1', runId: 'run-old' },
        },
      ]);

      const loadPromise = useConversationStore.getState().loadConversation('session-1', { background: true });
      useConversationStore.getState().clearAssistantEnvelopesForRoot('session-1', 'req-1', {
        preserveRunId: 'run-new',
      });
      resolveSnapshot?.({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'user-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'hello',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'assistant-old',
            sessionId: 'session-1',
            requestContextId: 'run-old',
            runId: 'run-old',
            rootMessageId: 'req-1',
            role: 'ASSISTANT',
            sequence: 2,
            content: 'old answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:01Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      await expect(loadPromise).resolves.toBe(false);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.some((envelope) => envelope.eventId === 'assistant-old')).toBe(false);
      expect(loadConversationSpy).toHaveBeenCalledTimes(1);
      loadConversationSpy.mockRestore();
    });

    it('should preserve live optimistic envelopes when an initial foreground snapshot is empty', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [],
        nextCursor: null,
      });

      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-optimistic-user',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 0,
        timelineEventRef: null,
        transportHints: ['local-optimistic'],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: {
          content: 'Live question',
          text: 'Live question',
          role: 'USER',
          rootMessageId: 'req-live',
        },
      } as StreamEnvelope);

      const replaced = await useConversationStore.getState().loadConversation('session-1');

      expect(replaced).toBe(false);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes).toHaveLength(1);
      expect(sessionEnvelopes[0]?.payload?.content).toBe('Live question');
      expect(useConversationStore.getState().conversationLoadStateBySession['session-1']).toBe('ready');
      loadConversationSpy.mockRestore();
    });

    it('should preserve history visibility flags when rebuilding envelopes after refresh', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'old-user',
            sessionId: 'session-1',
            requestContextId: 'req-old',
            rootMessageId: 'req-old',
            role: 'USER',
            sequence: 1,
            content: 'old question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: false,
          },
          {
            messageId: 'old-answer',
            sessionId: 'session-1',
            requestContextId: 'run-old',
            rootMessageId: 'req-old',
            role: 'ASSISTANT',
            sequence: 2,
            content: 'old answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:01Z',
            visible: false,
          },
          {
            messageId: 'new-user',
            sessionId: 'session-1',
            requestContextId: 'req-new',
            rootMessageId: 'req-new',
            role: 'USER',
            sequence: 3,
            content: 'edited question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:02Z',
            visible: true,
          },
          {
            messageId: 'new-answer',
            sessionId: 'session-1',
            requestContextId: 'run-new',
            rootMessageId: 'req-new',
            role: 'ASSISTANT',
            sequence: 4,
            content: 'new answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:03Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1');

      expect(replaced).toBe(true);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(
        sessionEnvelopes.filter(
          (envelope) =>
            (envelope.payload as { rootMessageId?: string; visible?: boolean }).rootMessageId === 'req-old' && envelope.payload.visible === false,
        ),
      ).toHaveLength(2);
      expect(
        sessionEnvelopes.filter(
          (envelope) =>
            (envelope.payload as { rootMessageId?: string; visible?: boolean }).rootMessageId === 'req-new' && envelope.payload.visible !== false,
        ),
      ).toHaveLength(2);
      loadConversationSpy.mockRestore();
    });

    it('should store nextCursor for the loaded recent history page', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'Hello',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
        ],
        nextCursor: 'older-cursor-1',
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1');

      expect(replaced).toBe(true);
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.nextCursor).toBe('older-cursor-1');
      loadConversationSpy.mockRestore();
    });

    it('should abort the previous older-page request before starting another older load', async () => {
      const abortErrors: Error[] = [];
      const resolvers: Array<(page: Awaited<ReturnType<typeof sessionService.loadConversation>>) => void> = [];
      const signals: AbortSignal[] = [];
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
        if (query.signal) {
          signals.push(query.signal);
        }
        return new Promise((resolve, reject) => {
          resolvers.push(resolve);
          query.signal?.addEventListener('abort', () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            abortErrors.push(abortError);
            reject(abortError);
          });
        });
      });

      useConversationStore.getState().setConversationPageInfo('session-1', {
        nextCursor: 'older-cursor-1',
      });

      const firstLoad = useConversationStore.getState().loadOlderConversation('session-1');
      const secondLoad = useConversationStore.getState().loadOlderConversation('session-1');

      expect(signals[0]?.aborted).toBe(true);
      expect(abortErrors).toHaveLength(1);

      resolvers[1]?.({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'older-user',
            sessionId: 'session-1',
            requestContextId: 'older-req',
            rootMessageId: 'older-req',
            role: 'USER',
            sequence: 1,
            content: 'older question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      await expect(firstLoad).resolves.toBe(false);
      await expect(secondLoad).resolves.toBe(true);
      expect(useConversationStore.getState().historyMessagesBySession['session-1']).toHaveLength(1);
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.isLoadingOlder).toBe(false);
      loadConversationSpy.mockRestore();
    });

    it('should keep the current live turn when a terminal snapshot has not settled yet', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'Hello',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);

      const replaced = await useConversationStore.getState().loadConversation('session-1', {
        background: true,
        requiredRootMessageId: 'req-1',
      });

      expect(replaced).toBe(false);
      expect(readRetainedEnvelopes('session-1')).toHaveLength(2);
      loadConversationSpy.mockRestore();
    });

    it('should preserve live assistant content when a background snapshot only contains the current user', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-live',
            sessionId: 'session-1',
            requestContextId: 'req-live',
            rootMessageId: 'req-live',
            role: 'USER',
            sequence: 1,
            content: 'Live question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-live-user',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 1,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:00Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: { content: 'Live question', role: 'USER', rootMessageId: 'req-live' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-live-delta',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 2,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'LLM_CONTENT_DELTA',
        payload: { delta: 'partial answer', role: 'ASSISTANT', rootMessageId: 'req-live' },
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1', {
        background: true,
      });

      expect(replaced).toBe(true);
      expect(
        readRetainedEnvelopes('session-1')?.some(
          (envelope) =>
            envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.requestId === 'req-live' && envelope.payload?.delta === 'partial answer',
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });

    it('should not treat capability-only terminal snapshots as settled assistant history', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'Check firewall',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'cap-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'CAPABILITY_RESULT',
            sequence: 2,
            content: 'Firewall check completed.',
            contentType: 'PLAIN_TEXT',
            metadata: { toolCallId: 'tool-firewall', capabilityName: 'firewallDiagnostic' },
            createdAt: '2024-01-01T00:00:01Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'evt-user',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'Check firewall', role: 'USER', rootMessageId: 'req-1' },
        },
        {
          eventId: 'evt-tool',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'CAPABILITY_COMPLETED',
          payload: {
            toolCallId: 'tool-firewall',
            toolName: 'firewallDiagnostic',
            text: 'Firewall check completed.',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'evt-answer',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 3,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { delta: 'partial diagnosis', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
        {
          eventId: 'evt-completed',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 4,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:03Z',
          eventType: 'REQUEST_COMPLETED',
          payload: { rootMessageId: 'req-1' },
        },
      ]);

      const replaced = await useConversationStore.getState().loadConversation('session-1', {
        background: true,
        requiredRootMessageId: 'req-1',
      });

      expect(replaced).toBe(false);
      expect(
        readRetainedEnvelopes('session-1')?.some(
          (envelope) =>
            envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.requestId === 'req-1' && envelope.payload?.delta === 'partial diagnosis',
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });

    it('should settle from conversation messages without waiting for capability result messages', async () => {
      const loadConversationSpy = vi
        .spyOn(sessionService, 'loadConversation')
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [
            {
              messageId: 'req-1',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'USER',
              sequence: 1,
              content: 'Check network status',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'assistant-1',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'Combined diagnosis completed.',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2024-01-01T00:00:03Z',
              visible: true,
            },
          ],
          nextCursor: null,
        })
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [
            {
              messageId: 'req-1',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'USER',
              sequence: 1,
              content: 'Check network status',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'cap-1',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'CAPABILITY_RESULT',
              sequence: 2,
              content: 'IP pool utilization is 68% and healthy.',
              contentType: 'PLAIN_TEXT',
              metadata: { toolCallId: 'tool-network', capabilityName: 'networkDiagnostic' },
              createdAt: '2024-01-01T00:00:01Z',
              visible: true,
            },
            {
              messageId: 'cap-2',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'CAPABILITY_RESULT',
              sequence: 3,
              content: 'Topology scan completed with five online devices.',
              contentType: 'PLAIN_TEXT',
              metadata: { toolCallId: 'tool-vlan', capabilityName: 'vlanManager' },
              createdAt: '2024-01-01T00:00:02Z',
              visible: true,
            },
            {
              messageId: 'assistant-1',
              sessionId: 'session-1',
              requestContextId: 'req-1',
              rootMessageId: 'req-1',
              role: 'ASSISTANT',
              sequence: 4,
              content: 'Combined diagnosis completed.',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2024-01-01T00:00:03Z',
              visible: true,
            },
          ],
          nextCursor: null,
        });

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'evt-user',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'Check network status', text: 'Check network status', role: 'USER', rootMessageId: 'req-1' },
        },
        {
          eventId: 'evt-tool-network',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 5,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            toolCallId: 'tool-network',
            toolName: 'networkDiagnostic',
            text: 'Validating configuration...',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'evt-tool-vlan',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 6,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:02Z',
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            toolCallId: 'tool-vlan',
            toolName: 'vlanManager',
            text: 'Scanning topology...',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'evt-answer',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 7,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:03Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'Combined diagnosis completed.', text: 'Combined diagnosis completed.', role: 'ASSISTANT', rootMessageId: 'req-1' },
        },
        {
          eventId: 'evt-completed',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 8,
          timelineEventRef: null,
          transportHints: ['SSE'],
          createdAt: '2024-01-01T00:00:04Z',
          eventType: 'REQUEST_COMPLETED',
          payload: { rootMessageId: 'req-1' },
        },
      ]);

      const firstAttempt = await useConversationStore.getState().loadConversation('session-1', {
        background: true,
        requiredRootMessageId: 'req-1',
      });

      expect(firstAttempt).toBe(true);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(
        sessionEnvelopes.some(
          (envelope) => envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.payload?.content === 'Combined diagnosis completed.',
        ),
      ).toBe(true);
      expect(sessionEnvelopes.some((envelope) => envelope.eventType === 'CAPABILITY_RESULT_DELTA')).toBe(false);
      expect(loadConversationSpy).toHaveBeenCalledTimes(1);
      loadConversationSpy.mockRestore();
    });

    it('should refresh settled history while preserving live envelopes for the active request', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-old',
            sessionId: 'session-1',
            requestContextId: 'req-old',
            rootMessageId: 'req-old',
            role: 'USER',
            sequence: 1,
            content: 'Old question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'assistant-old',
            sessionId: 'session-1',
            requestContextId: 'req-old',
            rootMessageId: 'req-old',
            role: 'ASSISTANT',
            sequence: 2,
            content: 'Old answer',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:01Z',
            visible: true,
          },
          {
            messageId: 'req-live',
            sessionId: 'session-1',
            requestContextId: 'req-live',
            rootMessageId: 'req-live',
            role: 'USER',
            sequence: 3,
            content: 'Live question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:02Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'evt-old-user',
          sessionId: 'session-1',
          requestId: 'req-old',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'Old question', role: 'USER', rootMessageId: 'req-old' },
        },
      ]);
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-live-user',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 0,
        timelineEventRef: null,
        transportHints: ['local-optimistic'],
        createdAt: '2024-01-01T00:00:02Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: { content: 'Live question', role: 'USER', rootMessageId: 'req-live' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-live-delta',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 4,
        timelineEventRef: null,
        transportHints: [],
        createdAt: '2024-01-01T00:00:03Z',
        eventType: 'LLM_CONTENT_DELTA',
        payload: { content: 'partial answer', role: 'ASSISTANT', rootMessageId: 'req-live' },
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1', {
        background: true,
        preserveRequestId: 'req-live',
      });

      expect(replaced).toBe(true);

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(
        useConversationStore.getState().historyEnvelopesBySession['session-1']?.filter((envelope) => envelope.requestId === 'req-live'),
      ).toHaveLength(1);
      expect(readActiveEnvelopes('session-1').filter((envelope) => envelope.requestId === 'req-live')).toHaveLength(2);
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            envelope.requestId === 'req-live' && envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.payload?.content === 'partial answer',
        ),
      ).toBe(true);
      expect(
        sessionEnvelopes.some(
          (envelope) => envelope.requestId === 'req-old' && envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.payload?.content === 'Old answer',
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });

    it('keeps accepted live process state when history gains the final response', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-live',
            sessionId: 'session-1',
            requestContextId: 'req-live',
            rootMessageId: 'req-live',
            role: 'USER',
            sequence: 1,
            content: 'Live question',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'assistant-live',
            sessionId: 'session-1',
            requestContextId: 'req-live',
            rootMessageId: 'req-live',
            role: 'ASSISTANT',
            sequence: 2,
            content: 'final answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:02Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-live-user',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 1,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:00Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: { content: 'Live question', role: 'USER', rootMessageId: 'req-live' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-live-delta',
        sessionId: 'session-1',
        requestId: 'req-live',
        sequence: 2,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'LLM_CONTENT_DELTA',
        payload: { delta: 'partial answer', role: 'ASSISTANT', rootMessageId: 'req-live' },
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1', {
        background: true,
        preserveRequestId: 'req-live',
      });

      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(replaced).toBe(true);
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.requestId === 'req-live' && envelope.payload?.content === 'final answer',
        ),
      ).toBe(true);
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.requestId === 'req-live' && envelope.payload?.delta === 'partial answer',
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });

    it('should preserve a live capability result until the snapshot includes the matching tool result', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'Check firewall',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'assistant-1',
            sessionId: 'session-1',
            requestContextId: 'req-1',
            rootMessageId: 'req-1',
            role: 'ASSISTANT',
            sequence: 2,
            content: 'Final answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:02Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      useConversationStore.getState().setEnvelopes('session-1', [
        {
          eventId: 'evt-user',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: { content: 'Check firewall', role: 'USER', rootMessageId: 'req-1' },
        },
      ]);
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-progress',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 8,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'CAPABILITY_RESULT_DELTA',
        payload: { toolCallId: 'tool-1', progress: 'checking...' },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-finished',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 9,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:01Z',
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          toolCallId: 'tool-1',
          toolName: 'firewallConfig',
          result: 'Configuration check passed.',
        },
      });
      useConversationStore.getState().appendEnvelope('session-1', {
        eventId: 'evt-answer',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 10,
        timelineEventRef: null,
        transportHints: ['SSE'],
        createdAt: '2024-01-01T00:00:02Z',
        eventType: 'LLM_CONTENT_DELTA',
        payload: { content: 'Final answer', role: 'ASSISTANT', rootMessageId: 'req-1' },
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1', { background: true });

      expect(replaced).toBe(true);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            envelope.eventType === 'CAPABILITY_COMPLETED' &&
            envelope.requestId === 'req-1' &&
            envelope.payload?.toolName === 'firewallConfig' &&
            envelope.payload?.result === 'Configuration check passed.',
        ),
      ).toBe(true);
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            envelope.eventType === 'CAPABILITY_RESULT_DELTA' && envelope.requestId === 'req-1' && envelope.payload?.toolCallId === 'tool-1',
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });

    it('should ignore ordinary capability-result messages while retaining assistant conversation messages', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
        sessionId: 'session-1',
        items: [
          {
            messageId: 'req-1',
            sessionId: 'session-1',
            requestContextId: 'req-ctx-1',
            rootMessageId: 'req-1',
            role: 'USER',
            sequence: 1,
            content: 'Hello',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            createdAt: '2024-01-01T00:00:00Z',
            visible: true,
          },
          {
            messageId: 'cap-1',
            sessionId: 'session-1',
            requestContextId: 'req-ctx-1',
            rootMessageId: 'req-1',
            role: 'CAPABILITY_RESULT',
            sequence: 2,
            content: 'tool output',
            contentType: 'PLAIN_TEXT',
            metadata: { toolCallId: 'tool-1', capabilityName: 'topologyDiscovery' },
            createdAt: '2024-01-01T00:00:01Z',
            visible: true,
          },
          {
            messageId: 'assistant-1',
            sessionId: 'session-1',
            requestContextId: 'req-ctx-1',
            rootMessageId: 'req-1',
            role: 'ASSISTANT',
            sequence: 3,
            content: 'final answer',
            contentType: 'MARKDOWN',
            metadata: {},
            createdAt: '2024-01-01T00:00:02Z',
            visible: true,
          },
        ],
        nextCursor: null,
      });

      const replaced = await useConversationStore.getState().loadConversation('session-1');

      expect(replaced).toBe(true);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes).toHaveLength(2);
      expect(sessionEnvelopes.some((envelope) => envelope.eventType === 'CAPABILITY_RESULT_DELTA')).toBe(false);
      expect(
        sessionEnvelopes.some(
          (envelope) =>
            envelope.eventType === 'LLM_CONTENT_DELTA' && envelope.payload?.role === 'ASSISTANT' && envelope.payload?.content === 'final answer',
        ),
      ).toBe(true);
      loadConversationSpy.mockRestore();
    });
  });

  describe('loadOlderConversation', () => {
    it('should prepend older messages and update nextCursor', async () => {
      const loadConversationSpy = vi
        .spyOn(sessionService, 'loadConversation')
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [
            {
              messageId: 'req-new',
              sessionId: 'session-1',
              requestContextId: 'req-new',
              rootMessageId: 'req-new',
              role: 'USER',
              sequence: 3,
              content: 'New question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:02Z',
              visible: true,
            },
            {
              messageId: 'assistant-new',
              sessionId: 'session-1',
              requestContextId: 'req-new',
              rootMessageId: 'req-new',
              role: 'ASSISTANT',
              sequence: 4,
              content: 'New answer',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:03Z',
              visible: true,
            },
          ],
          nextCursor: 'older-cursor-2',
        })
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [
            {
              messageId: 'req-old',
              sessionId: 'session-1',
              requestContextId: 'req-old',
              rootMessageId: 'req-old',
              role: 'USER',
              sequence: 1,
              content: 'Old question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'assistant-old',
              sessionId: 'session-1',
              requestContextId: 'req-old',
              rootMessageId: 'req-old',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'Old answer',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:01Z',
              visible: true,
            },
          ],
          nextCursor: null,
        });

      await useConversationStore.getState().loadConversation('session-1');
      const loaded = await useConversationStore.getState().loadOlderConversation('session-1');

      expect(loaded).toBe(true);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(sessionEnvelopes.map((envelope) => envelope.payload?.content)).toEqual(['Old question', 'Old answer', 'New question', 'New answer']);
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.nextCursor).toBeNull();
      loadConversationSpy.mockRestore();
    });

    it('should not duplicate older history messages when a page overlaps with the current snapshot', async () => {
      const loadConversationSpy = vi
        .spyOn(sessionService, 'loadConversation')
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [
            {
              messageId: 'req-new',
              sessionId: 'session-1',
              requestContextId: 'req-new',
              rootMessageId: 'req-new',
              role: 'USER',
              sequence: 3,
              content: 'New question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:02Z',
              visible: true,
            },
            {
              messageId: 'assistant-new',
              sessionId: 'session-1',
              requestContextId: 'req-new',
              rootMessageId: 'req-new',
              role: 'ASSISTANT',
              sequence: 4,
              content: 'New answer',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:03Z',
              visible: true,
            },
          ],
          nextCursor: 'older-cursor-overlap',
        })
        .mockResolvedValueOnce({
          sessionId: 'session-1',
          items: [
            {
              messageId: 'req-old',
              sessionId: 'session-1',
              requestContextId: 'req-old',
              rootMessageId: 'req-old',
              role: 'USER',
              sequence: 1,
              content: 'Old question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:00Z',
              visible: true,
            },
            {
              messageId: 'assistant-old',
              sessionId: 'session-1',
              requestContextId: 'req-old',
              rootMessageId: 'req-old',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'Old answer',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:01Z',
              visible: true,
            },
            {
              messageId: 'req-new',
              sessionId: 'session-1',
              requestContextId: 'req-new',
              rootMessageId: 'req-new',
              role: 'USER',
              sequence: 3,
              content: 'New question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2024-01-01T00:00:02Z',
              visible: true,
            },
          ],
          nextCursor: null,
        });

      await useConversationStore.getState().loadConversation('session-1');
      const loaded = await useConversationStore.getState().loadOlderConversation('session-1');

      expect(loaded).toBe(true);
      const sessionEnvelopes = readRetainedEnvelopes('session-1');
      expect(
        sessionEnvelopes.filter((envelope) => envelope.eventType === 'REQUEST_ACCEPTED' && envelope.payload?.content === 'New question'),
      ).toHaveLength(1);
      loadConversationSpy.mockRestore();
    });
  });

  describe('anchored conversation window identity', () => {
    it('only completes the active anchored window after all newer pages are exhausted', () => {
      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!]);
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: null,
            newerCursor: 'newer-cursor-1',
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: true,
          },
        },
      });

      expect(useConversationStore.getState().completeAnchoredConversation('session-1', 'anchor-1')).toBe(false);
      useConversationStore.getState().setConversationPageInfo('session-1', { newerCursor: null });
      expect(useConversationStore.getState().completeAnchoredConversation('session-1', 'other-anchor')).toBe(false);
      expect(useConversationStore.getState().completeAnchoredConversation('session-1', 'anchor-1')).toBe(true);

      expect(useConversationStore.getState().conversationViewBySession['session-1']).toEqual({
        mode: 'recent',
        activeAnchorMessageId: null,
        newMessagesWhileAnchored: false,
      });
      expect(readRetainedEnvelopes('session-1')?.map((envelope) => envelope.eventId)).toEqual(['evt-1']);
    });

    it('clears an in-flight older load when anchored review naturally reaches recent', async () => {
      let olderSignal: AbortSignal | undefined;
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
        olderSignal = query.signal;
        return new Promise((_resolve, reject) => {
          query.signal?.addEventListener(
            'abort',
            () => {
              const abortError = new Error('Aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            },
            { once: true },
          );
        });
      });
      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!]);
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: 'older-cursor-1',
            newerCursor: null,
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      const olderLoad = useConversationStore.getState().loadOlderConversation('session-1');
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.isLoadingOlder).toBe(true);

      expect(useConversationStore.getState().completeAnchoredConversation('session-1', 'anchor-1')).toBe(true);
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('recent');
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.isLoadingOlder).toBe(false);
      expect(olderSignal?.aborted).toBe(true);
      await expect(olderLoad).resolves.toBe(false);
      expect(readRetainedEnvelopes('session-1')?.map((envelope) => envelope.eventId)).toEqual(['evt-1']);
      loadConversationSpy.mockRestore();
    });

    it('ignores a newer-page response after the window returns to latest', async () => {
      const pendingNewerPage = deferredConversationPage();
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
        if (query.newerCursor) {
          return pendingNewerPage.promise;
        }
        return Promise.resolve({
          sessionId: 'session-1',
          items: [makeHistoryMessage('latest-message', 'latest')],
          nextCursor: null,
          newerCursor: null,
        });
      });
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: null,
            newerCursor: 'newer-cursor-1',
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      const staleLoad = useConversationStore.getState().loadNewerConversation('session-1');
      await useConversationStore.getState().loadConversation('session-1');
      pendingNewerPage.resolve({
        sessionId: 'session-1',
        items: [makeHistoryMessage('stale-newer-message', 'stale newer')],
        nextCursor: null,
        newerCursor: null,
      });

      expect(await staleLoad).toBe(false);
      expect(readRetainedEnvelopes('session-1')?.map((envelope) => envelope.payload?.content)).toEqual(['latest']);
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('recent');
      loadConversationSpy.mockRestore();
    });

    it('does not clear the loading state owned by a replacement page request', async () => {
      const stalePage = deferredConversationPage();
      const replacementPage = deferredConversationPage();
      let newerRequestCount = 0;
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
        if (query.anchorMessageId) {
          return Promise.resolve({
            sessionId: 'session-1',
            items: [makeHistoryMessage('anchor-1', 'anchor one')],
            nextCursor: null,
            newerCursor: 'newer-cursor-1',
          });
        }
        newerRequestCount += 1;
        return newerRequestCount === 1 ? stalePage.promise : replacementPage.promise;
      });
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: null,
            newerCursor: 'newer-cursor-1',
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      const staleLoad = useConversationStore.getState().loadNewerConversation('session-1');
      await useConversationStore.getState().loadAnchoredConversation('session-1', 'anchor-1');
      const replacementLoad = useConversationStore.getState().loadNewerConversation('session-1');
      stalePage.resolve({
        sessionId: 'session-1',
        items: [makeHistoryMessage('stale-newer-message', 'stale newer')],
        nextCursor: null,
        newerCursor: null,
      });

      expect(await staleLoad).toBe(false);
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.isLoadingNewer).toBe(true);

      replacementPage.resolve({
        sessionId: 'session-1',
        items: [makeHistoryMessage('replacement-newer-message', 'replacement newer')],
        nextCursor: null,
        newerCursor: null,
      });
      expect(await replacementLoad).toBe(true);
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']?.isLoadingNewer).toBe(false);
      loadConversationSpy.mockRestore();
    });

    it('preserves the active anchored window when a newer-page request fails', async () => {
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockRejectedValue(new Error('newer page unavailable'));
      useConversationStore.getState().setEnvelopes('session-1', [mockEnvelopes[0]!]);
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: null,
            newerCursor: 'newer-cursor-1',
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      expect(await useConversationStore.getState().loadNewerConversation('session-1')).toBe(false);
      expect(readRetainedEnvelopes('session-1')?.map((envelope) => envelope.eventId)).toEqual(['evt-1']);
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.activeAnchorMessageId).toBe('anchor-1');
      expect(useConversationStore.getState().conversationPageInfoBySession['session-1']).toMatchObject({
        newerCursor: 'newer-cursor-1',
        isLoadingNewer: false,
        newerLoadError: 'newer page unavailable',
      });
      loadConversationSpy.mockRestore();
    });

    it('ignores an older-page response after another preview anchor replaces the window', async () => {
      const pendingOlderPage = deferredConversationPage();
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
        if (query.cursor) {
          return pendingOlderPage.promise;
        }
        return Promise.resolve({
          sessionId: 'session-1',
          items: [makeHistoryMessage('anchor-2', 'anchor two')],
          nextCursor: null,
          newerCursor: 'newer-cursor-2',
        });
      });
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: 'older-cursor-1',
            newerCursor: 'newer-cursor-1',
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      const staleLoad = useConversationStore.getState().loadOlderConversation('session-1');
      await useConversationStore.getState().loadAnchoredConversation('session-1', 'anchor-2');
      pendingOlderPage.resolve({
        sessionId: 'session-1',
        items: [makeHistoryMessage('stale-older-message', 'stale older')],
        nextCursor: null,
        newerCursor: null,
      });

      expect(await staleLoad).toBe(false);
      expect(readRetainedEnvelopes('session-1')?.map((envelope) => envelope.payload?.content)).toEqual(['anchor two']);
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.activeAnchorMessageId).toBe('anchor-2');
      loadConversationSpy.mockRestore();
    });

    it('ignores a pagination response from the session left behind by a session switch', async () => {
      const pendingNewerPage = deferredConversationPage();
      const loadConversationSpy = vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
        if (query.newerCursor) {
          return pendingNewerPage.promise;
        }
        return Promise.resolve({
          sessionId: query.sessionId,
          items: [makeHistoryMessage('session-2-message', 'session two', 1, query.sessionId)],
          nextCursor: null,
          newerCursor: null,
        });
      });
      useConversationStore.setState({
        conversationPageInfoBySession: {
          'session-1': {
            nextCursor: null,
            newerCursor: 'newer-cursor-1',
            isLoadingOlder: false,
            isLoadingNewer: false,
            olderLoadError: null,
            newerLoadError: null,
            hasLoadedOlder: false,
          },
        },
        conversationViewBySession: {
          'session-1': {
            mode: 'anchored',
            activeAnchorMessageId: 'anchor-1',
            newMessagesWhileAnchored: false,
          },
        },
      });

      const staleLoad = useConversationStore.getState().loadNewerConversation('session-1');
      await useConversationStore.getState().loadConversation('session-2');
      pendingNewerPage.resolve({
        sessionId: 'session-1',
        items: [makeHistoryMessage('stale-session-1-message', 'stale session one')],
        nextCursor: null,
        newerCursor: null,
      });

      expect(await staleLoad).toBe(false);
      expect(readRetainedEnvelopes('session-1')).toHaveLength(0);
      expect(useConversationStore.getState().historyEnvelopesBySession['session-2']?.map((envelope) => envelope.payload?.content)).toEqual([
        'session two',
      ]);
      loadConversationSpy.mockRestore();
    });
  });

  describe('setStreaming', () => {
    it('should update streaming state', () => {
      useConversationStore.getState().setStreaming(true);
      expect(useConversationStore.getState().isStreaming).toBe(true);
    });
  });

  describe('setConversationError', () => {
    it('should update error state', () => {
      useConversationStore.getState().setConversationError('Failed to load');
      expect(useConversationStore.getState().conversationError).toBe('Failed to load');
    });
  });

  describe('clearConversation', () => {
    it('should remove session data', () => {
      useConversationStore.getState().setEnvelopes('session-1', mockEnvelopes);
      useConversationStore
        .getState()
        .appendEnvelope('session-1', makeLifecycleEnvelope('root-clear', 'attempt-clear', 1, 'REQUEST_ACCEPTED', 'USER'));
      useConversationStore.getState().setConversationLoadState('session-1', 'ready');
      useConversationStore.getState().setConversationPageInfo('session-1', { nextCursor: 'older-cursor-3' });
      useConversationStore.getState().setRuntimeState('session-1', {
        activeRootMessageId: 'req-1',
        continuityPhase: 'reconnecting',
        continuityMessage: 'reconnecting',
      });
      useConversationStore.getState().clearConversation('session-1');

      const state = useConversationStore.getState();
      expect(state.historyEnvelopesBySession['session-1']).toBeUndefined();
      expect(state.activeLiveBySession['session-1']).toBeUndefined();
      expect(state.settledLiveBySession['session-1']).toBeUndefined();
      expect(state.nextLiveOrdinalBySession['session-1']).toBeUndefined();
      expect(state.conversationLoadStateBySession['session-1']).toBeUndefined();
      expect(state.conversationPageInfoBySession['session-1']).toBeUndefined();
      expect(state.runtimeBySession['session-1']).toBeUndefined();
      expect(state.sessionAccessOrder).not.toContain('session-1');
    });

    it('evicts every retained owner for the oldest session when an eleventh session becomes active', () => {
      for (let index = 0; index < 10; index += 1) {
        useConversationStore.getState().appendEnvelope(`session-${index}`, {
          ...makeLifecycleEnvelope(`root-${index}`, `attempt-${index}`, 1, 'REQUEST_ACCEPTED', 'USER'),
          sessionId: `session-${index}`,
        });
      }
      useConversationStore.getState().setConversationPageInfo('session-0', { nextCursor: 'older' });
      useConversationStore.getState().setRuntimeState('session-0', { activeRootMessageId: 'root-0' });
      useConversationStore.setState((state) => ({
        historyEnvelopesBySession: { ...state.historyEnvelopesBySession, 'session-0': [mockEnvelopes[0]!] },
        historyMessagesBySession: { ...state.historyMessagesBySession, 'session-0': [makeHistoryMessage('root-0', 'history')] },
        conversationPreviewBySession: {
          ...state.conversationPreviewBySession,
          'session-0': { totalMarkers: 0, markersByIndex: {} },
        },
        conversationViewBySession: {
          ...state.conversationViewBySession,
          'session-0': { mode: 'recent', activeAnchorMessageId: null, newMessagesWhileAnchored: false },
        },
      }));

      useConversationStore.getState().appendEnvelope('session-10', {
        ...makeLifecycleEnvelope('root-10', 'attempt-10', 1, 'REQUEST_ACCEPTED', 'USER'),
        sessionId: 'session-10',
      });

      const state = useConversationStore.getState();
      expect(state.historyEnvelopesBySession['session-0']).toBeUndefined();
      expect(state.historyMessagesBySession['session-0']).toBeUndefined();
      expect(state.activeLiveBySession['session-0']).toBeUndefined();
      expect(state.settledLiveBySession['session-0']).toBeUndefined();
      expect(state.nextLiveOrdinalBySession['session-0']).toBeUndefined();
      expect(state.runtimeBySession['session-0']).toBeUndefined();
      expect(state.conversationPreviewBySession['session-0']).toBeUndefined();
      expect(state.conversationPageInfoBySession['session-0']).toBeUndefined();
      expect(state.conversationViewBySession['session-0']).toBeUndefined();
    });
  });
});
