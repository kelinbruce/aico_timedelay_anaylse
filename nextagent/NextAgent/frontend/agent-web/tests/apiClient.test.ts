// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiClient, isApiError, setAuthChallengeHandler } from '../src/services/apiClient.ts';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';

describe('apiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    setAuthChallengeHandler(null);
    runtimeConfig.backendBaseUrl = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('get', () => {
    it('should call fetch with correct URL and method', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.get('/api/v1/test');

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/test', {
        credentials: 'include',
        headers: {},
      });
    });

    it('should return parsed JSON response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: 1, name: 'test' }),
        }),
      );

      const result = await apiClient.get<{ id: number; name: string }>('/api/v1/test');

      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should throw structured error on non-OK response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      );

      const error = await apiClient.get('/api/v1/test').catch((caught) => caught);

      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        throw new Error('Expected ApiError');
      }
      expect(error.status).toBe(404);
      expect(error.error).toBe('HTTP 404 Not Found');
      expect(error.kind).toBe('http');
      expect(error.retriable).toBe(false);
    });

    it('should merge custom headers with default headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.get('/api/v1/test', { headers: { 'X-Custom': 'value' } });

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/test', {
        credentials: 'include',
        headers: { 'X-Custom': 'value' },
      });
    });
  });

  describe('post', () => {
    it('should call fetch with POST method and JSON body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.post('/api/v1/test', { name: 'test' });

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
    });

    it('should handle null body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.post('/api/v1/test', null);

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/test', {
        method: 'POST',
        credentials: 'include',
        headers: {},
        body: null,
      });
    });

    it('should parse backend error envelopes on non-OK responses', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ error: 'backend exploded' }),
        }),
      );

      const error = await apiClient.post('/api/v1/test', {}).catch((caught) => caught);

      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        throw new Error('Expected ApiError');
      }
      expect(error.status).toBe(500);
      expect(error.error).toBe('backend exploded');
      expect(error.kind).toBe('http');
    });

    it('should preserve LtmError 4xx status, code, and message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: () =>
            Promise.resolve({
              code: 'LTM_QUERY_INVALID',
              message: 'At most 10 labels are allowed.',
              retryable: false,
            }),
        }),
      );

      const error = await apiClient.post('/api/v1/memory/long-term-mem/manual', {}).catch((caught) => caught);

      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        throw new Error('Expected ApiError');
      }
      expect(error.status).toBe(400);
      expect(error.code).toBe('LTM_QUERY_INVALID');
      expect(error.error).toBe('At most 10 labels are allowed.');
      expect(error.retriable).toBe(false);
    });

    it('should notify auth challenge handler on 401 challenge responses', async () => {
      const authHandler = vi.fn();
      setAuthChallengeHandler(authHandler);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () =>
            Promise.resolve({
              error: 'Authentication required',
              authMode: 'LOCAL_CONFIG',
              loginUrl: '/login',
              iamStatus: 'DISABLED',
              localLoginEnabled: true,
            }),
        }),
      );

      const error = await apiClient.post('/api/v1/test', {}).catch((caught) => caught);

      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        throw new Error('Expected ApiError');
      }
      expect(error.status).toBe(401);
      expect(error.authChallenge).toEqual({
        authMode: 'LOCAL_CONFIG',
        loginUrl: '/login',
        iamStatus: 'DISABLED',
        localLoginEnabled: true,
      });
      expect(authHandler).toHaveBeenCalledWith(error.authChallenge);
    });

    it('should wrap network failures as retriable api errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const error = await apiClient.post('/api/v1/test', {}).catch((caught) => caught);

      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        throw new Error('Expected ApiError');
      }
      expect(error.status).toBeNull();
      expect(error.error).toBe('Failed to fetch');
      expect(error.kind).toBe('network');
      expect(error.retriable).toBe(true);
    });
  });

  describe('put', () => {
    it('should call fetch with PUT method and JSON body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.put('/api/v1/test', { name: 'test' });

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/test', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
    });
  });

  describe('delete', () => {
    it('should call fetch with DELETE method and no JSON content type when no body is sent', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.delete('/api/v1/test');

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/test', {
        method: 'DELETE',
        credentials: 'include',
        headers: {},
      });
    });
  });

  describe('uploadFormData', () => {
    it('rejects credentialed uploads to a cross-origin backend', async () => {
      runtimeConfig.backendBaseUrl = 'https://api.example.test';

      const error = await apiClient.uploadFormData('/api/v1/files', new FormData()).catch((caught) => caught);

      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        throw new Error('Expected ApiError');
      }
      expect(error.code).toBe('CROSS_ORIGIN_CREDENTIAL_REQUEST_REJECTED');
      expect(error.retriable).toBe(false);
    });
  });
});
