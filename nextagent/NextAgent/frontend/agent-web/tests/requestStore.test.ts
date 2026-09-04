import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRequestStore } from '../src/state/requestStore.ts';
import { RECENT_SESSION_LIMIT, useSessionStore } from '../src/state/sessionStore.ts';
import { flattenLiveBuckets, useConversationStore } from '../src/state/conversationStore.ts';
import { buildTurnBlocks } from '../src/features/chat/utils/buildTurnBlocks.ts';
import { buildAnswerContent } from '../src/features/chat/presentation/answerContent.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

function readActiveEnvelopes(sessionId: string): readonly StreamEnvelope[] {
  return flattenLiveBuckets(useConversationStore.getState().activeLiveBySession[sessionId]);
}

function readRetainedEnvelopes(sessionId: string): readonly StreamEnvelope[] {
  const state = useConversationStore.getState();
  return [
    ...(state.historyEnvelopesBySession[sessionId] ?? []),
    ...flattenLiveBuckets(state.settledLiveBySession[sessionId]),
    ...flattenLiveBuckets(state.activeLiveBySession[sessionId]),
  ];
}

function makeAcceptedEnvelope(requestId: string, overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: `request-${requestId}-accepted`,
    sessionId: 'test-session',
    requestId,
    sequence: 1,
    eventType: 'REQUEST_ACCEPTED',
    timelineEventRef: null,
    transportHints: ['replayable'],
    payload: {
      ...(overrides.payload ?? {}),
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  } as StreamEnvelope;
}

function makeOptimisticUserEnvelope(requestId: string): StreamEnvelope {
  return {
    eventId: `temp-${requestId}`,
    sessionId: 'test-session',
    requestId,
    sequence: 0,
    eventType: 'REQUEST_ACCEPTED',
    timelineEventRef: null,
    transportHints: ['local-optimistic'],
    payload: {
      content: 'test input',
      text: 'test input',
      contentType: 'PLAIN_TEXT',
      metadata: { accumulated: true },
      role: 'USER',
      messageId: requestId,
      rootMessageId: requestId,
    },
    createdAt: '2026-05-07T12:00:00.000Z',
  };
}

function makeThinkingEnvelope(requestId: string, overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: `thinking-${requestId}`,
    sessionId: 'test-session',
    requestId,
    sequence: 2,
    eventType: 'LLM_THINKING_DELTA',
    timelineEventRef: null,
    transportHints: ['replayable'],
    payload: {
      delta: 'working',
      contentType: 'PLAIN_TEXT',
      metadata: { accumulated: false },
    },
    createdAt: '2026-05-07T12:00:01.000Z',
    ...overrides,
  } as StreamEnvelope;
}

function makeTerminalEnvelope(
  requestId: string,
  eventType: Extract<
    StreamEnvelope['eventType'],
    'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED'
  > = 'REQUEST_COMPLETED',
  overrides: Partial<StreamEnvelope> = {},
): StreamEnvelope {
  return {
    eventId: `terminal-${requestId}-${eventType}`,
    sessionId: 'test-session',
    requestId,
    sequence: 3,
    eventType,
    timelineEventRef: null,
    transportHints: ['replayable'],
    payload: {
      rootMessageId: requestId,
      ...(overrides.payload ?? {}),
    },
    createdAt: '2026-05-07T12:00:02.000Z',
    ...overrides,
  } as StreamEnvelope;
}

function seedPendingOptimisticRequest(startedAtMs = Date.parse('2026-05-07T12:00:00.000Z')) {
  useConversationStore.getState().appendEnvelope('test-session', makeOptimisticUserEnvelope('client-run-1'));
  useRequestStore.setState({
    isSubmittingRequest: true,
    requestStatus: 'submitting',
    pendingRequest: {
      kind: 'submit',
      sessionId: 'test-session',
      idempotencyKey: 'submit-idempotency-key',
      startedAtMs,
      optimisticRequestId: 'client-run-1',
    },
  });
}

function deferredFetch<T extends Record<string, unknown>>(body: T) {
  let resolveFetch!: () => void;
  const promise = new Promise<Response>((resolve) => {
    resolveFetch = () =>
      resolve({
        ok: true,
        json: () => Promise.resolve(body),
      } as Response);
  });
  return { promise, resolveFetch };
}

function seedHistoricalTurn(rootMessageId: string): void {
  useConversationStore.getState().setEnvelopes('test-session', [
    {
      eventId: `${rootMessageId}-user`,
      sessionId: 'test-session',
      requestId: rootMessageId,
      runId: 'run-old',
      requestContextId: 'context-old',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: {
        content: 'historical question',
        role: 'USER',
        rootMessageId,
        runId: 'run-old',
        requestContextId: 'context-old',
      },
      createdAt: '2026-05-07T12:00:00.000Z',
    },
    {
      eventId: `${rootMessageId}-assistant`,
      sessionId: 'test-session',
      requestId: rootMessageId,
      runId: 'run-old',
      requestContextId: 'context-old',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      transportHints: [],
      payload: {
        content: 'historical answer',
        role: 'ASSISTANT',
        rootMessageId,
        runId: 'run-old',
        requestContextId: 'context-old',
      },
      createdAt: '2026-05-07T12:00:01.000Z',
    },
  ]);
}

describe('requestStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useRequestStore.setState({
      isSubmittingRequest: false,
      activeRequestRootMessageId: null,
      activeRequestSessionId: null,
      requestStatus: 'idle',
      lastIdempotencyKey: null,
      submitError: null,
      cancelError: null,
      retryError: null,
      editError: null,
      lastSubmittedInput: '',
      lastSubmittedAttachments: [],
      uploadError: null,
      draftBeforeEdit: null,
      pendingRequest: null,
    });
    useSessionStore.setState({
      activeSessionId: 'test-session',
      historyWindowLimit: RECENT_SESSION_LIMIT,
    });
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setSubmittingRequest', () => {
    it('should update submitting state', () => {
      useRequestStore.getState().setSubmittingRequest(true);
      expect(useRequestStore.getState().isSubmittingRequest).toBe(true);
    });
  });

  describe('setActiveRequestRootMessageId', () => {
    it('should update the active root message id', () => {
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-123');
    });

    it('should allow clearing the active root message id', () => {
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setActiveRequestRootMessageId(null);
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
    });
  });

  describe('setRequestStatus', () => {
    it('should update request status', () => {
      useRequestStore.getState().setRequestStatus('submitting');
      expect(useRequestStore.getState().requestStatus).toBe('submitting');
    });

    it('should allow all valid status values', () => {
      const statuses = ['idle', 'submitting', 'accepted', 'failed', 'canceling', 'canceled', 'retrying', 'editing'] as const;
      for (const status of statuses) {
        useRequestStore.getState().setRequestStatus(status);
        expect(useRequestStore.getState().requestStatus).toBe(status);
      }
    });
  });

  describe('reconcilePendingRequestFromLiveEnvelope', () => {
    it('lets stream acceptance establish canonical identity before the POST response returns', () => {
      seedPendingOptimisticRequest();
      const streamAccepted = makeAcceptedEnvelope('backend-request-1', {
        runId: 'backend-run-1',
        rootMessageId: 'backend-request-1',
        requestContextId: 'backend-context-1',
        payload: {
          rootMessageId: 'backend-request-1',
          runId: 'backend-run-1',
          requestContextId: 'backend-context-1',
        },
      });

      const reconciled = useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(streamAccepted);
      useConversationStore.getState().appendEnvelope('test-session', streamAccepted);

      const sessionLiveEnvelopes = readActiveEnvelopes('test-session');
      const blocks = buildTurnBlocks([], sessionLiveEnvelopes);

      expect(reconciled).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('backend-request-1');
      expect(useRequestStore.getState().pendingRequest).toMatchObject({
        acceptedRootMessageId: 'backend-request-1',
        acceptedRunId: 'backend-run-1',
        acceptedRequestContextId: 'backend-context-1',
      });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.rootMessageId).toBe('backend-request-1');
      expect(blocks[0]!.userMessage.content).toBe('test input');
      expect(blocks[0]!.aiEvents.map((event) => event.eventType)).toEqual(['REQUEST_ACCEPTED']);
    });

    it('ignores replayed historical events while a local optimistic request is pending', () => {
      seedPendingOptimisticRequest();
      const replayedThinking = makeThinkingEnvelope('backend-run-1', {
        transportHints: ['history-load'],
      });

      const reconciled = useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(replayedThinking);

      const [optimisticEnvelope] = readActiveEnvelopes('test-session');
      expect(reconciled).toBe(false);
      expect(optimisticEnvelope?.requestId).toBe('client-run-1');
      expect(useRequestStore.getState().requestStatus).toBe('submitting');
      expect(useRequestStore.getState().pendingRequest?.acceptedRootMessageId).toBeUndefined();
    });

    it('ignores live events that predate the pending request window', () => {
      seedPendingOptimisticRequest(Date.parse('2026-05-07T12:00:10.000Z'));
      const staleThinking = makeThinkingEnvelope('backend-run-1', {
        createdAt: '2026-05-07T11:59:00.000Z',
      });

      const reconciled = useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(staleThinking);

      const [optimisticEnvelope] = readActiveEnvelopes('test-session');
      expect(reconciled).toBe(false);
      expect(optimisticEnvelope?.requestId).toBe('client-run-1');
      expect(useRequestStore.getState().requestStatus).toBe('submitting');
      expect(useRequestStore.getState().pendingRequest?.acceptedRootMessageId).toBeUndefined();
    });

    it('does not let a terminal event claim a pending optimistic request', () => {
      seedPendingOptimisticRequest();
      const staleTerminal = makeTerminalEnvelope('old-run-1', 'REQUEST_SUPERSEDED');

      const reconciled = useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(staleTerminal);

      expect(reconciled).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('submitting');
      expect(useRequestStore.getState().pendingRequest?.acceptedRootMessageId).toBeUndefined();
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
    });

    it('binds the first ordinary live event after HTTP acceptance when all canonical ids differ', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'request-1',
            sessionId: 'test-session',
            runId: 'run-1',
            attempt: 1,
          }),
      });

      await useRequestStore.getState().submitRequest('test input');

      const liveThinking = makeThinkingEnvelope('request-1', {
        runId: 'run-1',
        rootMessageId: 'request-1',
        requestContextId: 'context-1',
        createdAt: new Date().toISOString(),
        payload: {
          rootMessageId: 'request-1',
          runId: 'run-1',
          requestContextId: 'context-1',
          delta: 'working',
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: false },
        },
      });
      const reconciled = useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(liveThinking);
      useConversationStore.getState().appendEnvelope('test-session', liveThinking);

      const blocks = buildTurnBlocks([], readActiveEnvelopes('test-session'));
      expect(reconciled).toBe(true);
      expect(useRequestStore.getState().pendingRequest).toMatchObject({
        acceptedRootMessageId: 'request-1',
        acceptedRunId: 'run-1',
        acceptedRequestContextId: 'context-1',
      });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.rootMessageId).toBe('request-1');
      expect(blocks[0]?.userMessage.content).toBe('test input');
      expect(blocks[0]?.aiEvents.map((event) => event.eventType)).toEqual(['LLM_THINKING_DELTA']);
    });

    it('does not publish another request state for duplicate acceptance or later matching detail', () => {
      seedPendingOptimisticRequest();
      const accepted = makeAcceptedEnvelope('request-1', {
        runId: 'run-1',
        rootMessageId: 'request-1',
        requestContextId: 'context-1',
        payload: {
          rootMessageId: 'request-1',
          runId: 'run-1',
          requestContextId: 'context-1',
        },
      });
      expect(useRequestStore.getState().acceptRequestFromStream(accepted)).toBe(true);
      useConversationStore.getState().appendEnvelope('test-session', accepted);
      const pendingAfterBinding = useRequestStore.getState().pendingRequest;
      const stateListener = vi.fn();
      const unsubscribe = useRequestStore.subscribe(stateListener);

      expect(useRequestStore.getState().acceptRequestFromStream(accepted)).toBe(true);

      const repeatedDetail = makeThinkingEnvelope('request-1', {
        runId: 'run-1',
        rootMessageId: 'request-1',
        requestContextId: 'context-1',
        payload: {
          rootMessageId: 'request-1',
          runId: 'run-1',
          requestContextId: 'context-1',
          delta: 'still working',
        },
      });

      expect(useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(repeatedDetail)).toBe(true);
      expect(useRequestStore.getState().pendingRequest).toBe(pendingAfterBinding);
      expect(stateListener).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('binds a matching terminal as the first live event after HTTP acceptance', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'request-terminal',
            sessionId: 'test-session',
            runId: 'run-terminal',
            attempt: 1,
          }),
      });

      await useRequestStore.getState().submitRequest('test input');
      const acceptedPending = useRequestStore.getState().pendingRequest;
      expect(acceptedPending).not.toBeNull();
      useRequestStore.setState({
        pendingRequest: acceptedPending ? { ...acceptedPending, startedAtMs: Date.now() - 60_000 } : null,
      });

      const terminal = makeTerminalEnvelope('request-terminal', 'REQUEST_COMPLETED', {
        runId: 'run-terminal',
        rootMessageId: 'request-terminal',
        requestContextId: 'context-terminal',
        createdAt: new Date().toISOString(),
        payload: {
          rootMessageId: 'request-terminal',
          runId: 'run-terminal',
          requestContextId: 'context-terminal',
          status: 'COMPLETED',
          content: 'done',
          text: 'done',
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: true },
        },
      });

      expect(useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(terminal)).toBe(true);
      useConversationStore.getState().appendEnvelope('test-session', terminal);
      expect(useRequestStore.getState().settleRequestFromTerminal(terminal)).toBe(true);

      const settled = readRetainedEnvelopes('test-session');
      const blocks = buildTurnBlocks([], settled);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(blocks).toHaveLength(1);
      expect(buildAnswerContent(blocks[0]?.aiEvents ?? [])).toBe('done');
    });

    it('rejects a live envelope whose run conflicts with the HTTP-accepted identity', () => {
      seedPendingOptimisticRequest();
      const pending = useRequestStore.getState().pendingRequest;
      expect(pending).not.toBeNull();
      useRequestStore.setState({
        requestStatus: 'accepted',
        pendingRequest: pending
          ? {
              ...pending,
              acceptedRootMessageId: 'request-1',
              acceptedRunId: 'run-1',
            }
          : null,
      });

      const conflicting = makeThinkingEnvelope('request-1', {
        runId: 'run-other',
        rootMessageId: 'request-1',
        requestContextId: 'context-other',
        createdAt: new Date().toISOString(),
      });

      expect(useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(conflicting)).toBe(false);
      expect(useRequestStore.getState().pendingRequest).toMatchObject({
        acceptedRootMessageId: 'request-1',
        acceptedRunId: 'run-1',
      });
      expect(useRequestStore.getState().pendingRequest?.acceptedRequestContextId).toBeUndefined();
      expect(readActiveEnvelopes('test-session')[0]?.requestId).toBe('client-run-1');
    });

    it('does not let an older attempt terminal settle the accepted run', () => {
      seedPendingOptimisticRequest();
      const pending = useRequestStore.getState().pendingRequest;
      expect(pending).not.toBeNull();
      useRequestStore.setState({
        requestStatus: 'accepted',
        activeRequestRootMessageId: 'request-1',
        pendingRequest: pending
          ? {
              ...pending,
              acceptedRootMessageId: 'request-1',
              acceptedRunId: 'run-new',
              acceptedRequestContextId: 'context-new',
            }
          : null,
      });

      const staleTerminal = makeTerminalEnvelope('request-1', 'REQUEST_COMPLETED', {
        runId: 'run-old',
        rootMessageId: 'request-1',
        requestContextId: 'context-old',
        payload: {
          rootMessageId: 'request-1',
          runId: 'run-old',
          requestContextId: 'context-old',
        },
      });

      expect(useRequestStore.getState().settleRequestFromTerminal(staleTerminal)).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().pendingRequest?.acceptedRunId).toBe('run-new');
    });
  });

  describe('edit draft helpers', () => {
    it('stores draftBeforeEdit when entering edit mode', () => {
      useRequestStore.getState().setDraftBeforeEdit('draft text');
      expect(useRequestStore.getState().draftBeforeEdit).toBe('draft text');
    });

    it('clears draftBeforeEdit when leaving edit mode', () => {
      useRequestStore.getState().setDraftBeforeEdit('draft text');
      useRequestStore.getState().clearDraftBeforeEdit();
      expect(useRequestStore.getState().draftBeforeEdit).toBeNull();
    });
  });

  describe('settleRequestFromTerminal', () => {
    it('should reset the composer to idle after completion', () => {
      useRequestStore.setState({
        isSubmittingRequest: true,
        activeRequestRootMessageId: 'run-123',
        requestStatus: 'accepted',
      });

      useRequestStore.getState().settleRequestFromTerminal('REQUEST_COMPLETED', 'run-123');

      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(useRequestStore.getState().isSubmittingRequest).toBe(false);
    });

    it('settles completion when the local active identity is the run id', () => {
      useRequestStore.setState({
        isSubmittingRequest: true,
        activeRequestRootMessageId: 'run-attempt-123',
        requestStatus: 'accepted',
      });

      const settled = useRequestStore.getState().settleRequestFromTerminal(
        makeTerminalEnvelope('request-root-123', 'REQUEST_COMPLETED', {
          runId: 'run-attempt-123',
          requestContextId: 'context-123',
          payload: {
            rootMessageId: 'request-root-123',
            runId: 'run-attempt-123',
            requestContextId: 'context-123',
          },
        }),
      );

      expect(settled).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(useRequestStore.getState().isSubmittingRequest).toBe(false);
    });

    it('should surface failed terminal events without leaving the composer in executing state', () => {
      useRequestStore.setState({
        isSubmittingRequest: true,
        activeRequestRootMessageId: 'run-123',
        requestStatus: 'accepted',
      });

      useRequestStore.getState().settleRequestFromTerminal('REQUEST_FAILED', 'run-123');

      expect(useRequestStore.getState().requestStatus).toBe('failed');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-123');
      expect(useRequestStore.getState().isSubmittingRequest).toBe(false);
    });

    it('settles superseded terminal events for the accepted pending request', () => {
      seedPendingOptimisticRequest();
      useRequestStore.setState({
        activeRequestRootMessageId: 'backend-root-1',
        requestStatus: 'accepted',
        pendingRequest: {
          ...useRequestStore.getState().pendingRequest!,
          acceptedRootMessageId: 'backend-root-1',
          acceptedRunId: 'backend-run-1',
          acceptedRequestContextId: 'backend-attempt-1',
        },
      });

      const settled = useRequestStore.getState().settleRequestFromTerminal(
        makeTerminalEnvelope('backend-attempt-1', 'REQUEST_SUPERSEDED', {
          runId: 'backend-run-1',
          requestContextId: 'backend-attempt-1',
          payload: {
            rootMessageId: 'backend-root-1',
            runId: 'backend-run-1',
            requestContextId: 'backend-attempt-1',
          },
        }),
      );

      expect(settled).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(useRequestStore.getState().pendingRequest).toBeNull();
    });

    it('does not settle pending request B from same-session run A terminal', () => {
      seedPendingOptimisticRequest();
      useRequestStore.setState({
        activeRequestRootMessageId: 'old-root-1',
      });

      const settled = useRequestStore.getState().settleRequestFromTerminal(makeTerminalEnvelope('old-root-1', 'REQUEST_COMPLETED'));

      expect(settled).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('submitting');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('old-root-1');
      expect(useRequestStore.getState().pendingRequest?.optimisticRequestId).toBe('client-run-1');
    });
  });

  describe('submitRequest', () => {
    it('should throw if no active session', async () => {
      useSessionStore.getState().setActiveSessionId(null);

      await expect(useRequestStore.getState().submitRequest('test input')).rejects.toThrow('No active session is selected.');
    });

    it('should return early if input is empty', async () => {
      await useRequestStore.getState().submitRequest('   ');

      expect(useRequestStore.getState().isSubmittingRequest).toBe(false);
    });

    it('should set submitting state during submission', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'req-1', sessionId: 'test-session' }),
      });

      const submitPromise = useRequestStore.getState().submitRequest('test input');
      expect(useRequestStore.getState().isSubmittingRequest).toBe(true);

      await submitPromise;
      expect(useRequestStore.getState().isSubmittingRequest).toBe(false);
    });

    it('shows a composer-level error and removes the optimistic turn when submission fails before accept', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}) as Record<string, unknown>,
      });

      await expect(useRequestStore.getState().submitRequest('test input')).rejects.toThrow();
      expect(readRetainedEnvelopes('test-session')).toHaveLength(0);
      expect(useRequestStore.getState().submitError?.message ?? '').toContain('500');
    });

    it('surfaces empty attachments with a dedicated warning on submit', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: { code: 'ATTACHMENT_EMPTY', message: 'Attachment must not be empty.' } }),
      });

      const file = new File([''], 'empty.md', { type: 'text/markdown' });
      await expect(useRequestStore.getState().submitRequest('test input', [file])).rejects.toThrow('Attachment must not be empty.');

      expect(useRequestStore.getState().submitError?.level).toBe('warning');
      expect(useRequestStore.getState().submitError?.message).toBe('附件为空，请重新选择一个非空文件后再提交。');
    });

    it('keeps the draft and rolls back the optimistic turn on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(useRequestStore.getState().submitRequest('test input')).rejects.toThrow('Failed to fetch');

      expect(readRetainedEnvelopes('test-session')).toHaveLength(0);
      expect(useRequestStore.getState().submitError?.message).toBe('网络不稳定，发送失败，输入内容已保留。');
      expect(sessionStorage.getItem('draft-test-session')).toBe('test input');
    });

    it('normalizes an unexpected non-error rejection to an Error', async () => {
      global.fetch = vi.fn().mockRejectedValue('socket closed');

      await expect(useRequestStore.getState().submitRequest('test input')).rejects.toBeInstanceOf(Error);

      expect(useRequestStore.getState().submitError?.level).toBe('error');
    });

    it('refreshes session history and keeps the draft when submit hits a conflict', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const loadConversationSpy = vi.fn().mockResolvedValue(true);
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      useConversationStore.setState({ loadConversation: loadConversationSpy });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ error: 'latest request changed' }),
      });

      await expect(useRequestStore.getState().submitRequest('test input')).rejects.toThrow('latest request changed');

      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
      expect(loadConversationSpy).toHaveBeenCalledWith('test-session', { background: true });
      expect(useRequestStore.getState().submitError?.level).toBe('warning');
      expect(useRequestStore.getState().submitError?.message).toBe('会话已有更新，输入内容已保留。请基于最新内容发送。');
      expect(readRetainedEnvelopes('test-session')).toHaveLength(0);
      expect(sessionStorage.getItem('draft-test-session')).toBe('test input');
    });

    it('stages attachments then submits their refs as JSON', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tempRunId: 'temp-1', fileName: 'test.md', sizeBytes: 4 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ requestId: 'req-1', sessionId: 'test-session' }),
        });

      const file = new File(['test'], 'test.md', { type: 'text/markdown' });
      await useRequestStore.getState().submitRequest('test input', [file]);

      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]?.[0]).toContain('/files/upload');
      expect(calls[0]?.[1].body).toBeInstanceOf(FormData);
      const submitBody = JSON.parse(calls[1]?.[1].body as string);
      expect(submitBody.inputText).toBe('test input');
      expect(submitBody.attachments).toEqual([{ tempRunId: 'temp-1', fileName: 'test.md' }]);
    });

    it('should send JSON when no attachments are provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'req-1', sessionId: 'test-session' }),
      });

      await useRequestStore.getState().submitRequest('test input');

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.inputText).toBe('test input');
      expect(body.idempotencyKey).toBeDefined();
    });

    it('should reconcile the optimistic envelope with the accepted request id', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'accepted-run-1', sessionId: 'test-session' }),
      });

      await useRequestStore.getState().submitRequest('test input');

      const [envelope] = readRetainedEnvelopes('test-session');
      expect(envelope?.requestId).toBe('accepted-run-1');
      expect((envelope?.payload as { rootMessageId?: string }).rootMessageId).toBe('accepted-run-1');
    });

    it('clears a cached fork notice once the child request is accepted', async () => {
      useConversationStore.setState({
        forkNoticeBySession: {
          'test-session': {
            sourceSessionId: 'source-session',
            sourceSessionTitle: 'Source title',
          },
        },
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'accepted-run-1', sessionId: 'test-session' }),
      });

      await useRequestStore.getState().submitRequest('test input');

      expect(useConversationStore.getState().forkNoticeBySession['test-session']).toBeUndefined();
    });

    it('tracks accepted requestId as the latest request identity', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'root-1',
            sessionId: 'test-session',
            runId: 'run-1',
            attempt: 1,
          }),
      });

      await useRequestStore.getState().submitRequest('test input');

      const [envelope] = readRetainedEnvelopes('test-session');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('root-1');
      expect(envelope?.requestId).toBe('root-1');
      expect(envelope?.payload.rootMessageId).toBe('root-1');
    });

    it('should create a local optimistic envelope that does not pollute replay state', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'accepted-run-1', sessionId: 'test-session' }),
      });

      await useRequestStore.getState().submitRequest('test input');

      const [envelope] = readRetainedEnvelopes('test-session');
      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);

      expect(body).not.toHaveProperty('requestId');
      expect(body.idempotencyKey).toBeDefined();
      expect(envelope?.requestId).toBe('accepted-run-1');
      expect(envelope?.eventId).toContain('temp-');
      expect(envelope?.sequence).toBe(0);
      expect(envelope?.transportHints).toContain('local-optimistic');
      expect(envelope?.payload.contentType).toBe('PLAIN_TEXT');
      expect(envelope?.payload.metadata).toEqual({ accumulated: true });
    });

    it('reconciles the optimistic turn as soon as the stream accepted event arrives', async () => {
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        requestId: 'accepted-request-1',
        sessionId: 'test-session',
        runId: 'accepted-run-1',
        attempt: 1,
      });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      const submitPromise = useRequestStore.getState().submitRequest('test input');

      const [optimisticEnvelope] = readRetainedEnvelopes('test-session');
      expect(optimisticEnvelope?.requestId).not.toBe('accepted-request-1');
      expect(useRequestStore.getState().requestStatus).toBe('submitting');

      useRequestStore.getState().acceptRequestFromStream(
        makeAcceptedEnvelope('accepted-request-1', {
          runId: 'accepted-run-1',
          requestContextId: 'accepted-context-1',
          payload: {
            rootMessageId: 'accepted-request-1',
            runId: 'accepted-run-1',
            requestContextId: 'accepted-context-1',
          },
        }),
      );

      const [reconciledEnvelope] = readRetainedEnvelopes('test-session');
      expect(reconciledEnvelope?.requestId).toBe('accepted-request-1');
      expect(reconciledEnvelope?.runId).toBe('accepted-run-1');
      expect(reconciledEnvelope?.requestContextId).toBe('accepted-context-1');
      expect(reconciledEnvelope?.payload.rootMessageId).toBe('accepted-request-1');
      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('accepted-request-1');

      resolveFetch();
      await submitPromise;

      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('accepted-request-1');
      expect(useRequestStore.getState().pendingRequest).toMatchObject({
        acceptedRootMessageId: 'accepted-request-1',
        acceptedRunId: 'accepted-run-1',
        acceptedRequestContextId: 'accepted-context-1',
        httpIdentityConfirmed: true,
      });
    });

    it('preserves ordinary content and terminal that arrive before the HTTP response', async () => {
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        requestId: 'http-root-before-stream',
        sessionId: 'test-session',
        runId: 'http-run-before-stream',
        attempt: 1,
      });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      const submitPromise = useRequestStore.getState().submitRequest('test input');
      const thinking = makeThinkingEnvelope('http-root-before-stream', {
        runId: 'http-run-before-stream',
        rootMessageId: 'http-root-before-stream',
        requestContextId: 'context-before-stream',
        payload: {
          rootMessageId: 'http-root-before-stream',
          runId: 'http-run-before-stream',
          requestContextId: 'context-before-stream',
          delta: 'working before HTTP',
        },
      });
      const terminal = makeTerminalEnvelope('http-root-before-stream', 'REQUEST_COMPLETED', {
        runId: 'http-run-before-stream',
        rootMessageId: 'http-root-before-stream',
        requestContextId: 'context-before-stream',
        payload: {
          rootMessageId: 'http-root-before-stream',
          runId: 'http-run-before-stream',
          requestContextId: 'context-before-stream',
          status: 'COMPLETED',
          content: 'answer before HTTP',
          text: 'answer before HTTP',
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: true },
        },
      });

      expect(useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(thinking)).toBe(false);
      useConversationStore.getState().appendEnvelopes('test-session', [thinking, terminal]);
      expect(useRequestStore.getState().settleRequestFromTerminal(terminal)).toBe(false);

      resolveFetch();
      await submitPromise;

      const pending = useRequestStore.getState().pendingRequest;
      const blocks = buildTurnBlocks([], readRetainedEnvelopes('test-session'));
      expect(pending).toMatchObject({
        acceptedRootMessageId: 'http-root-before-stream',
        acceptedRunId: 'http-run-before-stream',
        acceptedRequestContextId: 'context-before-stream',
        httpIdentityConfirmed: true,
      });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.rootMessageId).toBe('http-root-before-stream');
      expect(blocks[0]?.userMessage.content).toBe('test input');
      expect(buildAnswerContent(blocks[0]?.aiEvents ?? [])).toBe('answer before HTTP');
      expect(useRequestStore.getState().settleRequestFromTerminal(terminal)).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
    });

    it('rebinds a conflicting pre-HTTP stream candidate to the HTTP-confirmed run', async () => {
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        requestId: 'http-root',
        sessionId: 'test-session',
        runId: 'http-run',
        attempt: 1,
      });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      const submitPromise = useRequestStore.getState().submitRequest('test input');
      const candidateAccepted = makeAcceptedEnvelope('candidate-root', {
        runId: 'candidate-run',
        rootMessageId: 'candidate-root',
        requestContextId: 'candidate-context',
        payload: {
          rootMessageId: 'candidate-root',
          runId: 'candidate-run',
          requestContextId: 'candidate-context',
        },
      });
      const candidateTerminal = makeTerminalEnvelope('candidate-root', 'REQUEST_COMPLETED', {
        runId: 'candidate-run',
        rootMessageId: 'candidate-root',
        requestContextId: 'candidate-context',
        payload: {
          rootMessageId: 'candidate-root',
          runId: 'candidate-run',
          requestContextId: 'candidate-context',
          status: 'COMPLETED',
        },
      });
      expect(useRequestStore.getState().acceptRequestFromStream(candidateAccepted)).toBe(true);
      useConversationStore.getState().appendEnvelopes('test-session', [candidateAccepted, candidateTerminal]);
      expect(useRequestStore.getState().settleRequestFromTerminal(candidateTerminal)).toBe(false);

      resolveFetch();
      await submitPromise;

      const state = useConversationStore.getState();
      const httpBucket = state.activeLiveBySession['test-session']?.['http-root'];
      const candidateBucket = state.settledLiveBySession['test-session']?.['candidate-root'];
      expect(useRequestStore.getState().pendingRequest).toMatchObject({
        acceptedRootMessageId: 'http-root',
        acceptedRunId: 'http-run',
        httpIdentityConfirmed: true,
      });
      expect(useRequestStore.getState().pendingRequest?.acceptedRequestContextId).toBeUndefined();
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('http-root');
      expect(httpBucket?.envelopes).toHaveLength(1);
      expect(httpBucket?.envelopes[0]?.transportHints).toContain('local-optimistic');
      expect(candidateBucket?.envelopes.every((envelope) => !envelope.transportHints.includes('local-optimistic'))).toBe(true);
      expect(useRequestStore.getState().settleRequestFromTerminal(candidateTerminal)).toBe(false);
    });

    it('rekeys an HTTP-accepted optimistic turn to the canonical stream attempt before terminal delivery', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'root-1',
            sessionId: 'test-session',
            runId: 'run-1',
            attempt: 1,
          }),
      });
      await useRequestStore.getState().submitRequest('test input');

      const accepted = makeAcceptedEnvelope('root-1', {
        runId: 'run-1',
        requestContextId: 'context-1',
        payload: {
          rootMessageId: 'root-1',
          requestId: 'root-1',
          runId: 'run-1',
          requestContextId: 'context-1',
          status: 'QUEUED',
          metadata: { accumulated: true },
        },
      });
      useRequestStore.getState().acceptRequestFromStream(accepted);
      useConversationStore.getState().appendEnvelope('test-session', accepted);
      useConversationStore.getState().appendEnvelope(
        'test-session',
        makeTerminalEnvelope('root-1', 'REQUEST_COMPLETED', {
          runId: 'run-1',
          requestContextId: 'context-1',
          payload: {
            rootMessageId: 'root-1',
            requestId: 'root-1',
            runId: 'run-1',
            requestContextId: 'context-1',
            status: 'COMPLETED',
            content: 'final answer without a content delta',
            text: 'final answer without a content delta',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: true },
          },
        }),
      );

      const state = useConversationStore.getState();
      const settled = flattenLiveBuckets(state.settledLiveBySession['test-session']);
      const blocks = buildTurnBlocks([], settled);

      expect(state.activeLiveBySession['test-session']?.['root-1']).toBeUndefined();
      expect(state.settledLiveBySession['test-session']?.['root-1']?.attemptId).toBe('context-1');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.userMessage.content).toBe('test input');
      expect(buildAnswerContent(blocks[0]?.aiEvents ?? [])).toBe('final answer without a content delta');
    });

    it('waits for HTTP confirmation before a stream candidate terminal settles the request', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        requestId: 'accepted-run-1',
        sessionId: 'test-session',
      });
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      const submitPromise = useRequestStore.getState().submitRequest('test input');

      useRequestStore.getState().acceptRequestFromStream(makeAcceptedEnvelope('accepted-run-1'));
      const settledBeforeHttp = useRequestStore.getState().settleRequestFromTerminal('REQUEST_COMPLETED', 'accepted-run-1');

      expect(settledBeforeHttp).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('accepted');

      resolveFetch();
      await submitPromise;

      expect(useRequestStore.getState().pendingRequest?.httpIdentityConfirmed).toBe(true);
      expect(useRequestStore.getState().settleRequestFromTerminal('REQUEST_COMPLETED', 'accepted-run-1')).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
    });

    it('keeps an early terminal unmatched until the accepted identity arrives', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        requestId: 'accepted-run-1',
        sessionId: 'test-session',
      });
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      const submitPromise = useRequestStore.getState().submitRequest('test input');

      const terminalEnvelope = makeTerminalEnvelope('accepted-run-1', 'REQUEST_FAILED', {
        createdAt: new Date().toISOString(),
      });
      const settled = useRequestStore.getState().settleRequestFromTerminal(terminalEnvelope);

      expect(settled).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('submitting');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(useRequestStore.getState().pendingRequest).not.toBeNull();

      resolveFetch();
      await submitPromise;

      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('accepted-run-1');
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);

      const replayed = useRequestStore.getState().settleRequestFromTerminal(terminalEnvelope);

      expect(replayed).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('failed');
      expect(useRequestStore.getState().pendingRequest).toBeNull();
    });
  });

  describe('cancelRequest', () => {
    it('should return early if no run id', async () => {
      await useRequestStore.getState().cancelRequest();
      expect(useRequestStore.getState().requestStatus).toBe('idle');
    });

    it('should use an explicit target request id when no active run is tracked', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            targetRequestId: 'recovered-request-1',
            action: 'CANCEL_LATEST',
          }),
      });

      await useRequestStore.getState().cancelRequest('recovered-request-1');

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.expectedLatestRequestId).toBe('recovered-request-1');
      expect(body.action).toBe('CANCEL_LATEST');
    });

    it('should implement optimistic UI: set cancelPending immediately', async () => {
      let resolveFetch: () => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            json: () => Promise.resolve({}),
          } as Response);
      });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      const cancelPromise = useRequestStore.getState().cancelRequest();

      expect(useRequestStore.getState().requestStatus).toBe('canceling');

      resolveFetch!();
      await cancelPromise;
    });

    it('settles canceled and refreshes the session snapshot after cancel is accepted', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const loadConversationSpy = vi.fn().mockResolvedValue(true);
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      useConversationStore.setState({ loadConversation: loadConversationSpy });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            targetRequestId: 'run-123',
            action: 'CANCEL_LATEST',
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().cancelRequest();

      expect(useRequestStore.getState().requestStatus).toBe('canceled');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-123');
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
      expect(loadConversationSpy).toHaveBeenCalledWith('test-session', { background: true });
    });

    it('should rollback to previous status on failure', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const loadConversationSpy = vi.fn().mockResolvedValue(true);
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      useConversationStore.setState({ loadConversation: loadConversationSpy });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ error: 'request already changed' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setRequestStatus('accepted');

      await useRequestStore.getState().cancelRequest();

      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().cancelError?.level).toBe('warning');
      expect(useRequestStore.getState().cancelError?.message).toBe('当前请求状态已变化，已同步到最新内容。');
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
      expect(loadConversationSpy).toHaveBeenCalledWith('test-session', { background: true });
    });

    it('should include expectedLatestRequestId in cancel command', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            targetRequestId: 'run-123',
            action: 'CANCEL_LATEST',
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().cancelRequest();

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.expectedLatestRequestId).toBe('run-123');
      expect(body.action).toBe('CANCEL_LATEST');
      expect(body.idempotencyKey).toBeDefined();
    });

    it('ignores non-string cancel targets and falls back to the active request', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            targetRequestId: 'run-123',
            action: 'CANCEL_LATEST',
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().cancelRequest({ type: 'click' } as unknown as string);

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.expectedLatestRequestId).toBe('run-123');
      expect(useRequestStore.getState().requestStatus).toBe('canceled');
    });

    it('uses the accepted root identity when canceling a pending request', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            targetRequestId: 'accepted-root-1',
            action: 'CANCEL_LATEST',
          }),
      });
      useRequestStore.setState({
        activeRequestRootMessageId: 'old-root-1',
        pendingRequest: {
          kind: 'submit',
          sessionId: 'test-session',
          idempotencyKey: 'submit-idempotency-key',
          startedAtMs: Date.now(),
          acceptedRootMessageId: 'accepted-root-1',
          acceptedRunId: 'accepted-run-1',
          acceptedRequestContextId: 'accepted-attempt-1',
        },
      });

      await useRequestStore.getState().cancelRequest();

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.expectedLatestRequestId).toBe('accepted-root-1');
    });

    it('does not cancel an unconfirmed pre-HTTP stream candidate', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;
      useRequestStore.setState({
        requestStatus: 'accepted',
        activeRequestRootMessageId: 'candidate-root',
        activeRequestSessionId: 'test-session',
        pendingRequest: {
          kind: 'submit',
          sessionId: 'test-session',
          idempotencyKey: 'submit-idempotency-key',
          startedAtMs: Date.now(),
          optimisticRequestId: 'client-submit',
          acceptedRootMessageId: 'candidate-root',
          acceptedRunId: 'candidate-run',
          acceptedRequestContextId: 'candidate-context',
          httpIdentityConfirmed: false,
        },
      });

      await useRequestStore.getState().cancelRequest();
      await useRequestStore.getState().cancelRequest('candidate-root');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().pendingRequest?.acceptedRootMessageId).toBe('candidate-root');
    });

    it('reuses the scoped cancel idempotency key after a retriable failure', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve({ error: 'temporary outage' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'test-session',
              targetRequestId: 'run-123',
              action: 'CANCEL_LATEST',
            }),
        });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setRequestStatus('accepted');

      await useRequestStore.getState().cancelRequest();
      await useRequestStore.getState().cancelRequest();

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const firstBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(firstBody.idempotencyKey).toBe(secondBody.idempotencyKey);
    });
  });

  describe('retryRequest', () => {
    it('should return early if no run id', async () => {
      await useRequestStore.getState().retryRequest();
      expect(useRequestStore.getState().requestStatus).toBe('idle');
    });

    it('should allow retrying an explicit historical run id when no active run is tracked', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            requestId: 'run-history',
            runId: 'retry-run-1',
            attempt: 2,
          }),
      });

      await useRequestStore.getState().retryRequest('run-history');

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[0]).toContain('/retry');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-history');
    });

    it('removes the old historical answer when HTTP accepts a retry before stream identity arrives', async () => {
      seedHistoricalTurn('run-history');
      useSessionStore.setState({ loadSessions: vi.fn().mockResolvedValue(undefined) });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            requestId: 'run-history',
            runId: 'run-retry',
            attempt: 2,
          }),
      });

      await useRequestStore.getState().retryRequest('run-history');

      const history = useConversationStore.getState().historyEnvelopesBySession['test-session'] ?? [];
      expect(history.map((envelope) => envelope.payload.role)).toEqual(['USER']);
      expect(history[0]?.runId).toBe('run-old');
      expect(history[0]?.requestContextId).toBe('context-old');
      expect(useConversationStore.getState().displayProcessRunByRootBySession['test-session']?.['run-history']).toBe('run-retry');
    });

    it('removes rather than rekeys the old historical answer when retry stream acceptance arrives first', async () => {
      seedHistoricalTurn('run-history');
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        sessionId: 'test-session',
        requestId: 'run-history',
        runId: 'run-retry',
        attempt: 2,
      });
      useSessionStore.setState({ loadSessions: vi.fn().mockResolvedValue(undefined) });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      const retryPromise = useRequestStore.getState().retryRequest('run-history');
      const streamAccepted = makeAcceptedEnvelope('run-history', {
        runId: 'run-retry',
        rootMessageId: 'run-history',
        requestContextId: 'context-retry',
        payload: {
          rootMessageId: 'run-history',
          runId: 'run-retry',
          requestContextId: 'context-retry',
        },
      });

      expect(useRequestStore.getState().acceptRequestFromStream(streamAccepted)).toBe(true);
      const historyBeforeHttp = useConversationStore.getState().historyEnvelopesBySession['test-session'] ?? [];
      expect(historyBeforeHttp.map((envelope) => envelope.payload.role)).toEqual(['USER']);
      expect(historyBeforeHttp[0]?.runId).toBe('run-old');
      expect(historyBeforeHttp[0]?.requestContextId).toBe('context-old');

      resolveFetch();
      await retryPromise;
    });

    it('does not substitute the accepted root when retry source identity is absent', () => {
      seedHistoricalTurn('run-history');
      useRequestStore.setState({
        requestStatus: 'retrying',
        pendingRequest: {
          kind: 'retry',
          sessionId: 'test-session',
          idempotencyKey: 'retry-without-source',
          startedAtMs: Date.now(),
        },
      });

      const streamAccepted = makeAcceptedEnvelope('run-history', {
        runId: 'run-retry',
        rootMessageId: 'run-history',
        requestContextId: 'context-retry',
        payload: {
          rootMessageId: 'run-history',
          runId: 'run-retry',
          requestContextId: 'context-retry',
        },
      });

      expect(useRequestStore.getState().acceptRequestFromStream(streamAccepted)).toBe(true);
      const history = useConversationStore.getState().historyEnvelopesBySession['test-session'] ?? [];
      expect(history.map((envelope) => envelope.payload.role)).toEqual(['USER', 'ASSISTANT']);
      expect(history.every((envelope) => envelope.runId === 'run-old')).toBe(true);
      expect(history.every((envelope) => envelope.requestContextId === 'context-old')).toBe(true);
    });

    it('should implement optimistic UI: set retrying immediately', async () => {
      let resolveFetch: () => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sessionId: 'test-session',
                requestId: 'run-123',
                runId: 'retry-run-1',
                attempt: 2,
              }),
          } as Response);
      });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      const retryPromise = useRequestStore.getState().retryRequest();

      expect(useRequestStore.getState().requestStatus).toBe('retrying');

      resolveFetch!();
      await retryPromise;
    });

    it('should set status to accepted on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            requestId: 'run-123',
            runId: 'retry-run-1',
            attempt: 2,
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().retryRequest();

      expect(useRequestStore.getState().requestStatus).toBe('accepted');
    });

    it('should switch activeRequestRootMessageId to accepted requestId when provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            requestId: 'run-456',
            runId: 'retry-run-1',
            attempt: 2,
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().retryRequest();

      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-456');
    });

    it('confirms retry identity before settling a stream-first terminal', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        sessionId: 'test-session',
        requestId: 'run-123',
        runId: 'retry-run-1',
        attempt: 2,
      });
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      const retryPromise = useRequestStore.getState().retryRequest();

      expect(useRequestStore.getState().requestStatus).toBe('retrying');
      const retryAccepted = makeAcceptedEnvelope('run-123', {
        runId: 'retry-run-1',
        rootMessageId: 'run-123',
        requestContextId: 'retry-context-1',
        payload: {
          rootMessageId: 'run-123',
          runId: 'retry-run-1',
          requestContextId: 'retry-context-1',
        },
      });
      const retryTerminal = makeTerminalEnvelope('run-123', 'REQUEST_COMPLETED', {
        runId: 'retry-run-1',
        rootMessageId: 'run-123',
        requestContextId: 'retry-context-1',
        payload: {
          rootMessageId: 'run-123',
          runId: 'retry-run-1',
          requestContextId: 'retry-context-1',
        },
      });
      useRequestStore.getState().acceptRequestFromStream(retryAccepted);
      expect(useRequestStore.getState().requestStatus).toBe('accepted');

      expect(useRequestStore.getState().settleRequestFromTerminal(retryTerminal)).toBe(false);
      resolveFetch();
      await retryPromise;

      expect(useRequestStore.getState().settleRequestFromTerminal(retryTerminal)).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    });

    it('should rollback to previous status on failure', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const loadConversationSpy = vi.fn().mockResolvedValue(true);
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      useConversationStore.setState({ loadConversation: loadConversationSpy });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ error: 'not latest anymore' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setRequestStatus('canceled');

      await expect(useRequestStore.getState().retryRequest()).rejects.toThrow('not latest anymore');

      expect(useRequestStore.getState().requestStatus).toBe('canceled');
      expect(useRequestStore.getState().retryError?.level).toBe('warning');
      expect(useRequestStore.getState().retryError?.message).toBe('这条回复已不是最新版本，已同步到最新内容。请在最新一轮上重试。');
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
      expect(loadConversationSpy).toHaveBeenCalledWith('test-session', { background: true });
    });

    it('should include expectedLatestRequestId in retry command', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'test-session',
            requestId: 'run-123',
            runId: 'retry-run-1',
            attempt: 2,
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().retryRequest();

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.expectedLatestRequestId).toBe('run-123');
      expect(body.action).toBeUndefined();
      expect(body.idempotencyKey).toBeDefined();
    });

    it('reuses the scoped retry idempotency key after a retriable failure', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          json: () => Promise.resolve({ error: 'gateway timeout' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'test-session',
              requestId: 'run-123',
              runId: 'retry-run-1',
              attempt: 2,
            }),
        });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setRequestStatus('canceled');

      await expect(useRequestStore.getState().retryRequest()).rejects.toThrow('gateway timeout');
      await useRequestStore.getState().retryRequest();

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const firstBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(firstBody.idempotencyKey).toBe(secondBody.idempotencyKey);
    });
  });

  describe('editRequest', () => {
    it('should return early if no run id', async () => {
      await useRequestStore.getState().editRequest('new input');
      expect(useRequestStore.getState().requestStatus).toBe('idle');
    });

    it('does not submit or replace the turn when the effective edit input is unchanged', async () => {
      global.fetch = vi.fn();
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      const result = await useRequestStore.getState().editRequest('  same input  ', [], 'run-123', 'req-1', { sourceInputText: 'same input' });

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().editError).toMatchObject({ level: 'warning', message: '内容未修改' });
    });

    it('submits an unchanged visible text when a new Skill is selected', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'run-789' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore
        .getState()
        .editRequest('same input', [], 'run-123', 'req-1', { targetSkill: 'alarm-diagnosis', sourceInputText: 'same input' });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the attachment rejection when visible text is unchanged', async () => {
      global.fetch = vi.fn();
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      const file = new File(['test'], 'test.md', { type: 'text/markdown' });

      await expect(
        useRequestStore.getState().editRequest('same input', [file], 'run-123', 'req-1', { sourceInputText: 'same input' }),
      ).rejects.toThrow('Attachments must be staged before request submission.');

      expect(useRequestStore.getState().editError?.message).not.toBe('内容未修改');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should allow editing an explicit historical run id when no active run is tracked', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await useRequestStore.getState().editRequest('new input', [], 'run-history');

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[0]).toContain('/requests/latest/edit');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-history');
    });

    it('should implement optimistic UI: set editing immediately', async () => {
      let resolveFetch: () => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            json: () => Promise.resolve({}),
          } as Response);
      });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      const editPromise = useRequestStore.getState().editRequest('new input');

      expect(useRequestStore.getState().requestStatus).toBe('editing');

      resolveFetch!();
      await editPromise;
    });

    it('should set status to accepted on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().editRequest('new input');

      expect(useRequestStore.getState().requestStatus).toBe('accepted');
    });

    it('should switch activeRequestRootMessageId to accepted requestId when provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'run-789' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().editRequest('new input');

      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-789');
    });

    it('reconciles edited optimistic roots from stream accepted events and keeps terminal settlement', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const { promise: fetchPromise, resolveFetch } = deferredFetch({
        requestId: 'run-789',
      });
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      global.fetch = vi.fn().mockReturnValue(fetchPromise);
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useConversationStore.getState().setEnvelopes('test-session', [
        {
          eventId: 'user-1',
          sessionId: 'test-session',
          requestId: 'run-123',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old input',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
          },
        },
      ]);

      const editPromise = useRequestStore.getState().editRequest('new input', [], 'run-123', 'req-1');

      expect(useRequestStore.getState().requestStatus).toBe('editing');
      useRequestStore.getState().acceptRequestFromStream(makeAcceptedEnvelope('run-789'));

      const sessionEnvelopes = readRetainedEnvelopes('test-session');
      const editedEnvelope = sessionEnvelopes.find((envelope) => envelope.payload.content === 'new input');
      expect(editedEnvelope?.requestId).toBe('run-789');
      expect(editedEnvelope?.payload.rootMessageId).toBe('run-789');
      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-789');

      expect(useRequestStore.getState().settleRequestFromTerminal('REQUEST_COMPLETED', 'run-789')).toBe(false);
      resolveFetch();
      await editPromise;

      expect(useRequestStore.getState().settleRequestFromTerminal('REQUEST_COMPLETED', 'run-789')).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    });

    it('should hide the superseded root and create a new optimistic edited root', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requestId: 'run-789' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useConversationStore.getState().setEnvelopes('test-session', [
        {
          eventId: 'user-1',
          sessionId: 'test-session',
          requestId: 'run-123',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old input',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'assistant-1',
          sessionId: 'test-session',
          requestId: 'run-123',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            content: 'old answer',
            role: 'ASSISTANT',
            rootMessageId: 'req-1',
          },
        },
      ]);

      await useRequestStore.getState().editRequest('new input', [], 'run-123', 'req-1');

      const sessionEnvelopes = readRetainedEnvelopes('test-session');
      expect(sessionEnvelopes).toHaveLength(3);
      expect(sessionEnvelopes[0]?.payload.visible).toBe(false);
      expect(sessionEnvelopes[1]?.payload.visible).toBe(false);
      expect(sessionEnvelopes[2]?.requestId).toBe('run-789');
      expect(sessionEnvelopes[2]?.payload.content).toBe('new input');
      expect((sessionEnvelopes[2]?.payload as { rootMessageId?: string }).rootMessageId).toBe('run-789');
    });

    it('should restore the superseded root if the edit request fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ error: 'edit target moved' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useConversationStore.getState().setEnvelopes('test-session', [
        {
          eventId: 'user-1',
          sessionId: 'test-session',
          requestId: 'run-123',
          sequence: 1,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:00Z',
          eventType: 'REQUEST_ACCEPTED',
          payload: {
            content: 'old input',
            role: 'USER',
            messageId: 'req-1',
            rootMessageId: 'req-1',
          },
        },
        {
          eventId: 'assistant-1',
          sessionId: 'test-session',
          requestId: 'run-123',
          sequence: 2,
          timelineEventRef: null,
          transportHints: [],
          createdAt: '2024-01-01T00:00:01Z',
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            content: 'old answer',
            role: 'ASSISTANT',
            rootMessageId: 'req-1',
          },
        },
      ]);

      await expect(useRequestStore.getState().editRequest('new input', [], 'run-123', 'req-1')).rejects.toThrow('edit target moved');

      const sessionEnvelopes = readRetainedEnvelopes('test-session');
      expect(sessionEnvelopes).toHaveLength(2);
      expect(sessionEnvelopes.every((envelope) => envelope.payload.visible !== false)).toBe(true);
      expect(sessionEnvelopes.some((envelope) => envelope.payload.content === 'new input')).toBe(false);
    });

    it('surfaces empty attachments with a dedicated warning', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: { code: 'ATTACHMENT_EMPTY', message: 'Attachment must not be empty.' } }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setRequestStatus('accepted');

      await expect(useRequestStore.getState().editRequest('new input')).rejects.toThrow('Attachment must not be empty.');

      expect(useRequestStore.getState().editError?.level).toBe('warning');
      expect(useRequestStore.getState().editError?.message).toBe('附件为空，请重新选择一个非空文件后再提交。');
    });

    it('should rollback to previous status on failure', async () => {
      const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
      const loadConversationSpy = vi.fn().mockResolvedValue(true);
      useSessionStore.setState({ loadSessions: loadSessionsSpy });
      useConversationStore.setState({ loadConversation: loadConversationSpy });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ error: 'edit target moved' }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');
      useRequestStore.getState().setRequestStatus('canceled');

      await expect(useRequestStore.getState().editRequest('new input')).rejects.toThrow('edit target moved');

      expect(useRequestStore.getState().requestStatus).toBe('canceled');
      expect(useRequestStore.getState().editError?.level).toBe('warning');
      expect(useRequestStore.getState().editError?.message).toBe('你要编辑的消息已不是最新一条，已同步到最新内容。请编辑最新一条用户消息。');
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
      expect(loadConversationSpy).toHaveBeenCalledWith('test-session', { background: true });
    });

    it('rejects attachments in edit command without uploading or submitting', async () => {
      global.fetch = vi.fn();
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      const file = new File(['test'], 'test.md', { type: 'text/markdown' });
      await expect(useRequestStore.getState().editRequest('new input', [file])).rejects.toThrow(
        'Attachments must be staged before request submission.',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should include no files field when editing without attachments', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'edit-run-1',
            sessionId: 'test-session',
            runId: 'edit-attempt-1',
            attempt: 2,
          }),
      });
      useRequestStore.getState().setActiveRequestRootMessageId('run-123');

      await useRequestStore.getState().editRequest('new input');

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.expectedLatestRequestId).toBe('run-123');
      expect(body.editedInputText).toBe('new input');
      expect(body.idempotencyKey).toEqual(expect.any(String));
    });
  });

  describe('session-scoped request tracking', () => {
    it('tracks the session when a live envelope reconciles the pending request', () => {
      seedPendingOptimisticRequest();

      const reconciled = useRequestStore.getState().reconcilePendingRequestFromLiveEnvelope(
        makeAcceptedEnvelope('backend-request-1', {
          runId: 'backend-run-1',
          requestContextId: 'backend-context-1',
        }),
      );

      expect(reconciled).toBe(true);
      expect(useRequestStore.getState().activeRequestSessionId).toBe('test-session');
    });

    it('clears the tracked session when the request completes', () => {
      useRequestStore.setState({
        requestStatus: 'accepted',
        activeRequestRootMessageId: 'run-123',
        activeRequestSessionId: 'session-a',
      });

      const settled = useRequestStore.getState().settleRequestFromTerminal('REQUEST_COMPLETED', 'run-123');

      expect(settled).toBe(true);
      expect(useRequestStore.getState().activeRequestSessionId).toBeNull();
    });

    it('settles a stale accepted state only for the tracked session', () => {
      useRequestStore.setState({
        requestStatus: 'accepted',
        activeRequestRootMessageId: 'run-a',
        activeRequestSessionId: 'session-a',
      });

      expect(useRequestStore.getState().settleStaleSessionRequest('session-b')).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('accepted');

      expect(useRequestStore.getState().settleStaleSessionRequest('session-a')).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(useRequestStore.getState().activeRequestSessionId).toBeNull();
    });

    it('does not settle a stale state that is idle', () => {
      useRequestStore.setState({
        requestStatus: 'idle',
        activeRequestSessionId: 'session-a',
      });

      expect(useRequestStore.getState().settleStaleSessionRequest('session-a')).toBe(false);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
    });

    it('settles a stale submitting state for the tracked session', () => {
      useRequestStore.setState({
        requestStatus: 'submitting',
        activeRequestRootMessageId: 'run-a',
        activeRequestSessionId: 'session-a',
      });

      expect(useRequestStore.getState().settleStaleSessionRequest('session-a')).toBe(true);
      expect(useRequestStore.getState().requestStatus).toBe('idle');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBeNull();
      expect(useRequestStore.getState().activeRequestSessionId).toBeNull();
    });

    it('hydrates from activeRun and re-tracks when the viewed session differs', () => {
      useRequestStore.getState().hydrateFromActiveRun('session-a', 'run-a');
      expect(useRequestStore.getState().requestStatus).toBe('accepted');
      expect(useRequestStore.getState().activeRequestSessionId).toBe('session-a');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-a');

      useRequestStore.getState().hydrateFromActiveRun('session-a', 'run-older');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-a');

      useRequestStore.getState().hydrateFromActiveRun('session-b', 'run-b');
      expect(useRequestStore.getState().activeRequestSessionId).toBe('session-b');
      expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-b');
    });
  });
});
