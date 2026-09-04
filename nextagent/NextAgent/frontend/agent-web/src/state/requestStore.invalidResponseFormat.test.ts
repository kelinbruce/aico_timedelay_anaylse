import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../services/apiClient.ts';
import i18n from '../i18n/index.ts';

const mockRetryRequest = vi.fn();

vi.mock('../services/requestService.ts', () => ({
  requestService: {
    submitRequest: vi.fn(),
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

function makeInvalidResponseFormatError(): ApiError {
  const error = new Error('Invalid JSON response.') as ApiError;
  Object.assign(error, {
    status: 200,
    code: 'INVALID_RESPONSE_FORMAT',
    error: 'Invalid JSON response.',
    kind: 'http',
    retriable: false,
    authChallenge: null,
  });
  return error;
}

beforeEach(() => {
  mockRetryRequest.mockReset();
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

describe('requestStore invalid response format notice', () => {
  it('surfaces a user-understandable i18n notice when retry acceptance returns a non-JSON response', async () => {
    mockRetryRequest.mockRejectedValue(makeInvalidResponseFormatError());

    await expect(useRequestStore.getState().retryRequest('req-1')).rejects.toThrow('Invalid JSON response.');

    const state = useRequestStore.getState();
    expect(state.retryError).not.toBeNull();
    expect(state.retryError?.level).toBe('error');
    expect(state.retryError?.message).toBe(i18n.t('requestNotices.invalidResponseFormat'));
    expect(state.retryError?.message).not.toContain('Unexpected token');
    expect(state.requestStatus).toBe('idle');
    expect(state.pendingRequest).toBeNull();
  });

  it('clears the retry idempotency key because the invalid response is not retriable', async () => {
    mockRetryRequest.mockRejectedValue(makeInvalidResponseFormatError());

    await expect(useRequestStore.getState().retryRequest('req-1')).rejects.toThrow();

    const storageKey = `request-control-idempotency:retry:S1:req-1`;
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });
});
