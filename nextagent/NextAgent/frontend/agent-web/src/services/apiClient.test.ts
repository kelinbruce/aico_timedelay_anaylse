import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, isApiError, type ApiError } from './apiClient.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function htmlResponse(body = '<html><head><title>Burp Suite Professional</title></head><body>Intercepted</body></html>'): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error('Expected the request to reject.');
    },
    (rejection: unknown) => rejection,
  );
  expect(isApiError(error)).toBe(true);
  return error as ApiError;
}

describe('apiClient JSON response parsing', () => {
  it('rejects a 200 HTML response with a safe INVALID_RESPONSE_FORMAT error instead of JSON parser internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse()),
    );

    const error = await captureApiError(
      apiClient.post('/api/v1/sessions/session-1/retry', { expectedLatestRequestId: 'request-1', idempotencyKey: 'key-1' }),
    );

    expect(error.status).toBe(200);
    expect(error.code).toBe('INVALID_RESPONSE_FORMAT');
    expect(error.kind).toBe('http');
    expect(error.retriable).toBe(false);
    expect(error.error).not.toContain('Unexpected token');
    expect(error.error).toBe('Invalid JSON response.');
  });

  it('rejects invalid JSON bodies with the same safe error shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"broken": ', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    const error = await captureApiError(apiClient.get('/api/v1/sessions/session-1/conversation'));

    expect(error.code).toBe('INVALID_RESPONSE_FORMAT');
    expect(error.kind).toBe('http');
    expect(error.retriable).toBe(false);
  });

  it('returns parsed JSON for valid responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    await expect(apiClient.get('/api/v1/sessions/session-1/conversation')).resolves.toEqual({ ok: true });
  });

  it('returns undefined for 204 responses without parsing the body', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.delete('/api/v1/sessions/session-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
