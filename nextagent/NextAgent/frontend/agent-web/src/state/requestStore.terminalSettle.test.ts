import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../services/apiClient.ts';

const mockSubmitRequest = vi.fn();
const mockCancelRequest = vi.fn();

vi.mock('../services/requestService.ts', () => ({
  requestService: {
    submitRequest: (...args: unknown[]) => mockSubmitRequest(...args),
    retryRequest: vi.fn(),
    cancelRequest: (...args: unknown[]) => mockCancelRequest(...args),
    editRequest: vi.fn(),
  },
}));

vi.mock('./sessionStore.ts', () => ({
  useSessionStore: {
    getState: () => ({
      activeSessionId: 'S1',
      loadSessions: vi.fn(async () => undefined),
    }),
  },
}));

vi.mock('./conversationStore.ts', () => ({
  useConversationStore: {
    getState: () => ({
      appendEnvelope: vi.fn(),
      setConversationError: vi.fn(),
      reconcileOptimisticRequest: vi.fn(),
      clearAssistantEnvelopesForRoot: vi.fn(),
      selectRetryAttemptForRoot: vi.fn(),
      clearForkNotice: vi.fn(),
      removeRequestEnvelopes: vi.fn(),
      loadConversation: vi.fn(async () => undefined),
      setRuntimeState: vi.fn(),
    }),
  },
}));

vi.mock('./guardInputBlockPersistence.ts', () => ({
  saveGuardInputBlockTurn: vi.fn(),
}));

import { useRequestStore } from './requestStore.ts';
import type { StreamEnvelope } from './contracts.ts';

function makeApiError(code: string, status: number): ApiError {
  const error = new Error('api error') as ApiError;
  Object.assign(error, {
    status,
    code,
    error: 'Conflict',
    kind: 'http',
    retriable: false,
    authChallenge: null,
  });
  return error;
}

function makeTerminalEnvelope(opts: {
  readonly requestId: string;
  readonly rootMessageId: string;
  readonly runId: string;
  readonly requestContextId?: string;
  readonly eventType?: 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED';
  readonly sequence?: number;
}): StreamEnvelope {
  return {
    eventId: `evt-${opts.requestId}-${opts.eventType ?? 'REQUEST_COMPLETED'}`,
    sessionId: 'S1',
    requestId: opts.requestId,
    sequence: opts.sequence ?? 99,
    eventType: opts.eventType ?? 'REQUEST_COMPLETED',
    payload: {
      rootMessageId: opts.rootMessageId,
      requestId: opts.requestId,
      runId: opts.runId,
      content: 'Done',
      contentType: 'PLAIN_TEXT',
      role: 'ASSISTANT',
      metadata: { accumulated: true },
    },
    timelineEventRef: null,
    transportHints: [],
    createdAt: new Date().toISOString(),
    ...(opts.runId === undefined ? {} : { runId: opts.runId }),
    ...(opts.requestContextId === undefined ? {} : { requestContextId: opts.requestContextId }),
  };
}

function getStoreState() {
  return useRequestStore.getState();
}

function setAcceptedState(opts: { readonly rootMessageId: string; readonly runId: string; readonly requestContextId?: string }): void {
  useRequestStore.setState({
    isSubmittingRequest: false,
    requestStatus: 'accepted',
    activeRequestRootMessageId: opts.rootMessageId,
    activeRequestSessionId: 'S1',
    pendingRequest: {
      kind: 'submit',
      sessionId: 'S1',
      idempotencyKey: 'key-1',
      startedAtMs: Date.now(),
      acceptedRootMessageId: opts.rootMessageId,
      acceptedRunId: opts.runId,
      ...(opts.requestContextId === undefined ? {} : { acceptedRequestContextId: opts.requestContextId }),
      httpIdentityConfirmed: true,
    },
  });
}

beforeEach(() => {
  useRequestStore.setState({
    isSubmittingRequest: false,
    requestStatus: 'idle',
    activeRequestRootMessageId: null,
    activeRequestSessionId: null,
    pendingRequest: null,
    submitError: null,
    cancelError: null,
    retryError: null,
    editError: null,
    retryLimitReachedFor: null,
    retryLimitNotice: null,
    lastIdempotencyKey: null,
    lastSubmittedInput: '',
    lastSubmittedAttachments: [],
  });
  mockSubmitRequest.mockReset();
  mockCancelRequest.mockReset();
  vi.clearAllMocks();
});

describe('settleRequestFromTerminal identity matching', () => {
  it('settles when all identity fields match', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    const envelope = makeTerminalEnvelope({
      requestId: 'msg-001',
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    const settled = getStoreState().settleRequestFromTerminal(envelope);
    expect(settled).toBe(true);
    expect(getStoreState().requestStatus).toBe('idle');
    expect(getStoreState().pendingRequest).toBeNull();
    expect(getStoreState().activeRequestRootMessageId).toBeNull();
  });

  it('settles when acceptedRequestContextId is absent (HTTP-only identity)', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
    });

    const envelope = makeTerminalEnvelope({
      requestId: 'msg-001',
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    const settled = getStoreState().settleRequestFromTerminal(envelope);
    expect(settled).toBe(true);
    expect(getStoreState().requestStatus).toBe('idle');
  });

  it('does NOT settle when requestContextId mismatch (BUG: request stays stuck)', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    // Terminal envelope arrives WITHOUT requestContextId.
    // getEnvelopeAttemptId falls back to requestId, which differs from acceptedRequestContextId.
    const envelope = makeTerminalEnvelope({
      requestId: 'msg-001',
      rootMessageId: 'msg-001',
      runId: 'run-001',
      // no requestContextId; attemptId falls back to requestId msg-001
    });

    const settled = getStoreState().settleRequestFromTerminal(envelope);
    expect(settled).toBe(false);
    // BUG: request stays stuck in accepted state
    expect(getStoreState().requestStatus).toBe('accepted');
    expect(getStoreState().pendingRequest).not.toBeNull();
    expect(getStoreState().activeRequestRootMessageId).toBe('msg-001');
  });

  it('does NOT settle when runId mismatch (BUG: request stays stuck)', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    const envelope = makeTerminalEnvelope({
      requestId: 'msg-001',
      rootMessageId: 'msg-001',
      runId: 'run-different',
      requestContextId: 'ctx-001',
    });

    const settled = getStoreState().settleRequestFromTerminal(envelope);
    expect(settled).toBe(false);
    expect(getStoreState().requestStatus).toBe('accepted');
  });

  it('settleStaleSessionRequest recovers stuck accepted state', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    const recovered = getStoreState().settleStaleSessionRequest('S1');
    expect(recovered).toBe(true);
    expect(getStoreState().requestStatus).toBe('idle');
    expect(getStoreState().pendingRequest).toBeNull();
    expect(getStoreState().activeRequestRootMessageId).toBeNull();
  });

  it('FIX: settleRequestFromTerminal fails then settleStaleSessionRequest recovers', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    // Terminal envelope without requestContextId — settleRequestFromTerminal
    // returns false due to identity mismatch.
    const envelope = makeTerminalEnvelope({
      requestId: 'msg-001',
      rootMessageId: 'msg-001',
      runId: 'run-001',
    });

    const settled = getStoreState().settleRequestFromTerminal(envelope);
    expect(settled).toBe(false);
    expect(getStoreState().requestStatus).toBe('accepted');

    // The hook (handleTerminalEvent) calls settleStaleSessionRequest as a
    // fallback when the terminal matches the active/accepted run but
    // settleRequestFromTerminal returned false. This should recover the
    // stuck state.
    const recovered = getStoreState().settleStaleSessionRequest('S1');
    expect(recovered).toBe(true);
    expect(getStoreState().requestStatus).toBe('idle');
    expect(getStoreState().pendingRequest).toBeNull();
    expect(getStoreState().activeRequestRootMessageId).toBeNull();
  });

  it('cancelRequest on stuck state returns 409 and restores accepted (BUG)', async () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    mockCancelRequest.mockRejectedValueOnce(makeApiError('CONFLICT', 409));

    await getStoreState().cancelRequest();

    // BUG: after 409, requestStatus is restored to previousStatus (accepted),
    // leaving the UI permanently stuck
    expect(getStoreState().requestStatus).toBe('accepted');
    expect(getStoreState().activeRequestRootMessageId).toBe('msg-001');
  });
});

describe('settleStaleSessionRequest guard conditions', () => {
  it('does not settle if requestStatus is idle', () => {
    const recovered = getStoreState().settleStaleSessionRequest('S1');
    expect(recovered).toBe(false);
  });

  it('does not settle if sessionId does not match', () => {
    setAcceptedState({
      rootMessageId: 'msg-001',
      runId: 'run-001',
      requestContextId: 'ctx-001',
    });

    const recovered = getStoreState().settleStaleSessionRequest('S2');
    expect(recovered).toBe(false);
  });

  it('does not settle if requestStatus is failed', () => {
    useRequestStore.setState({
      isSubmittingRequest: false,
      requestStatus: 'failed',
      activeRequestRootMessageId: 'msg-001',
      activeRequestSessionId: 'S1',
      pendingRequest: null,
    });

    const recovered = getStoreState().settleStaleSessionRequest('S1');
    expect(recovered).toBe(false);
  });
});

describe('new submit after terminal keeps no stale root', () => {
  it('resets activeRequestRootMessageId when a canceled turn precedes a new submit', async () => {
    useRequestStore.setState({
      isSubmittingRequest: false,
      requestStatus: 'canceled',
      activeRequestRootMessageId: 'msg-old',
      activeRequestSessionId: 'S1',
      pendingRequest: null,
    });

    let stateDuringHttp: ReturnType<typeof getStoreState> | null = null;
    mockSubmitRequest.mockImplementation(async () => {
      stateDuringHttp = { ...getStoreState() };
      return { requestId: 'msg-new', runId: 'run-new' };
    });

    await getStoreState().submitRequest('帮我定位网络问题');

    expect(stateDuringHttp).not.toBeNull();
    expect(stateDuringHttp!.activeRequestRootMessageId).toBeNull();
    expect(stateDuringHttp!.pendingRequest?.kind).toBe('submit');
    expect(stateDuringHttp!.pendingRequest?.optimisticRequestId).toBeTruthy();

    expect(getStoreState().requestStatus).toBe('accepted');
    expect(getStoreState().activeRequestRootMessageId).toBe('msg-new');
  });
});
