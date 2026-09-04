import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../services/apiClient.ts';
import i18n from '../i18n/index.ts';

const mockSubmitRequest = vi.fn();

vi.mock('../services/requestService.ts', () => ({
  requestService: {
    submitRequest: (...args: unknown[]) => mockSubmitRequest(...args),
    retryRequest: vi.fn(),
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

function makeSessionNotFoundError(): ApiError {
  const error = new Error('Session was not found.') as ApiError;
  Object.assign(error, {
    status: 404,
    code: 'SESSION_NOT_FOUND',
    error: 'Session was not found.',
    kind: 'http',
    retriable: false,
    authChallenge: null,
  });
  return error;
}

beforeEach(() => {
  mockSubmitRequest.mockReset();
  window.sessionStorage.clear();
  useRequestStore.setState({
    requestStatus: 'idle',
    pendingRequest: null,
    activeRequestRootMessageId: null,
    activeRequestSessionId: null,
    submitError: null,
    isSubmittingRequest: false,
  });
});

describe('requestStore session not found notice', () => {
  it('surfaces a localized session-not-found notice when submitting to a deleted session', async () => {
    mockSubmitRequest.mockRejectedValue(makeSessionNotFoundError());

    await expect(useRequestStore.getState().submitRequest('hello')).rejects.toThrow('Session was not found.');

    const state = useRequestStore.getState();
    expect(state.submitError).not.toBeNull();
    expect(state.submitError?.level).toBe('error');
    expect(state.submitError?.message).toBe(i18n.t('requestNotices.sessionNotFound'));
    expect(state.submitError?.message).not.toContain('Session was not found.');
    expect(state.requestStatus).toBe('failed');
    expect(state.pendingRequest).toBeNull();
  });
});
