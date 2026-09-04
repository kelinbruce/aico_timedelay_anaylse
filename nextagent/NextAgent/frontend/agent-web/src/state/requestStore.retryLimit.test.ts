import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../services/apiClient.ts';
import i18n from '../i18n/index.ts';

const mockRetryRequest = vi.fn();
const mockSubmitRequest = vi.fn();

vi.mock('../services/requestService.ts', () => ({
  requestService: {
    submitRequest: (...args: unknown[]) => mockSubmitRequest(...args),
    retryRequest: (...args: unknown[]) => mockRetryRequest(...args),
    cancelRequest: vi.fn(),
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
      clearForkNotice: vi.fn(),
      removeRequestEnvelopes: vi.fn(),
      loadConversation: vi.fn(async () => undefined),
      selectRetryAttemptForRoot: vi.fn(),
    }),
  },
}));

import { useRequestStore } from './requestStore.ts';

function makeApiError(code: string, status: number): ApiError {
  const error = new Error('api error') as ApiError;
  Object.assign(error, {
    status,
    code,
    error: 'Retry attempt limit was reached for this request.',
    kind: 'http',
    retriable: false,
    authChallenge: null,
  });
  return error;
}

beforeEach(() => {
  mockRetryRequest.mockReset();
  mockSubmitRequest.mockReset();
  window.sessionStorage.clear();
  useRequestStore.setState({
    requestStatus: 'idle',
    pendingRequest: null,
    activeRequestRootMessageId: null,
    activeRequestSessionId: null,
    retryLimitReachedFor: null,
    retryLimitNotice: null,
    retryError: null,
    submitError: null,
  });
});

describe('requestStore retry limit', () => {
  it('marks the limit and surfaces a safe warning notice when backend rejects with REQUEST_RETRY_LIMIT_EXCEEDED', async () => {
    mockRetryRequest.mockRejectedValue(makeApiError('REQUEST_RETRY_LIMIT_EXCEEDED', 409));

    await expect(useRequestStore.getState().retryRequest('req-1')).rejects.toThrow();

    const state = useRequestStore.getState();
    expect(state.retryLimitReachedFor).toEqual({ sessionId: 'S1', requestId: 'req-1' });
    expect(state.retryError).toBeNull();
    expect(state.retryLimitNotice?.level).toBe('warning');
    expect(state.retryLimitNotice?.message).toBe(i18n.t('requestNotices.retryLimitReached'));
    expect(state.requestStatus).toBe('idle');
    expect(state.pendingRequest).toBeNull();
    expect(window.sessionStorage.getItem('request-control-idempotency:retry:S1:req-1')).toBeNull();
  });

  it('marks the limit when the accepted retry reaches the maximum attempt', async () => {
    mockRetryRequest.mockResolvedValue({ sessionId: 'S1', requestId: 'req-1', runId: 'run-6', attempt: 6 });

    const accepted = await useRequestStore.getState().retryRequest('req-1');

    expect(accepted?.attempt).toBe(6);
    expect(useRequestStore.getState().retryLimitReachedFor).toEqual({ sessionId: 'S1', requestId: 'req-1' });
  });

  it('does not mark the limit for an accepted retry below the maximum attempt', async () => {
    mockRetryRequest.mockResolvedValue({ sessionId: 'S1', requestId: 'req-1', runId: 'run-2', attempt: 2 });

    await useRequestStore.getState().retryRequest('req-1');

    expect(useRequestStore.getState().retryLimitReachedFor).toBeNull();
  });

  it('does not mark the limit for other conflict errors', async () => {
    mockRetryRequest.mockRejectedValue(makeApiError('REQUEST_RETRY_NOT_LATEST', 409));

    await expect(useRequestStore.getState().retryRequest('req-1')).rejects.toThrow();

    expect(useRequestStore.getState().retryLimitReachedFor).toBeNull();
  });

  it('resets the limit marker after a new submit is accepted', async () => {
    mockRetryRequest.mockRejectedValue(makeApiError('REQUEST_RETRY_LIMIT_EXCEEDED', 409));
    await expect(useRequestStore.getState().retryRequest('req-1')).rejects.toThrow();
    expect(useRequestStore.getState().retryLimitReachedFor).not.toBeNull();

    mockSubmitRequest.mockResolvedValue({ sessionId: 'S1', requestId: 'req-2', runId: 'run-1', attempt: 1 });
    await useRequestStore.getState().submitRequest('diagnose RAN alarms');

    expect(useRequestStore.getState().retryLimitReachedFor).toBeNull();
  });

  it('marks the limit when a live REQUEST_ACCEPTED event reports the maximum attempt', () => {
    useRequestStore.setState({
      pendingRequest: {
        kind: 'retry',
        sessionId: 'S1',
        idempotencyKey: 'key-1',
        startedAtMs: Date.now(),
      },
    });

    const accepted = useRequestStore.getState().acceptRequestFromStream({
      eventId: 'evt-6',
      sessionId: 'S1',
      requestId: 'req-1',
      rootMessageId: 'req-1',
      runId: 'run-6',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: { attempt: 6, status: 'QUEUED' },
      createdAt: new Date().toISOString(),
    });

    expect(accepted).toBe(true);
    expect(useRequestStore.getState().retryLimitReachedFor).toEqual({ sessionId: 'S1', requestId: 'req-1' });
  });

  it('does not mark the limit for a live REQUEST_ACCEPTED event below the maximum attempt', () => {
    useRequestStore.setState({
      pendingRequest: {
        kind: 'retry',
        sessionId: 'S1',
        idempotencyKey: 'key-1',
        startedAtMs: Date.now(),
      },
    });

    useRequestStore.getState().acceptRequestFromStream({
      eventId: 'evt-2',
      sessionId: 'S1',
      requestId: 'req-1',
      rootMessageId: 'req-1',
      runId: 'run-2',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: { attempt: 2, status: 'QUEUED' },
      createdAt: new Date().toISOString(),
    });

    expect(useRequestStore.getState().retryLimitReachedFor).toBeNull();
  });
});
