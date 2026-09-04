import { buildApiUrl } from '../config/runtimeConfig.ts';

export type ApiErrorKind = 'http' | 'network';
export type AuthMode = 'LOCAL_CONFIG' | 'IAM';

export interface AuthChallenge {
  readonly authMode: AuthMode;
  readonly loginUrl: string | null;
  readonly iamStatus: string | null;
  readonly localLoginEnabled: boolean;
}

export interface ApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly error: string;
  readonly kind: ApiErrorKind;
  readonly retriable: boolean;
  readonly authChallenge: AuthChallenge | null;
}

let authChallengeHandler: ((challenge: AuthChallenge) => void) | null = null;

export function setAuthChallengeHandler(handler: ((challenge: AuthChallenge) => void) | null): void {
  authChallengeHandler = handler;
}

let tenantIdHeader: string | null = null;
let subjectIdHeader: string | null = null;
let displayNameHeader: string | null = null;

let csrfToken: string | null = null;

export function setTenantId(value: string | null): void {
  tenantIdHeader = value;
}

export function setSubjectId(value: string | null): void {
  subjectIdHeader = value;
}

export function getSubjectId(): string | null {
  return subjectIdHeader;
}

export function setDisplayName(value: string | null): void {
  displayNameHeader = value;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

function applyRequestInterceptors(config: RequestInit): RequestInit {
  const headers = { ...((config.headers as Record<string, string>) || {}) };
  if (csrfToken) {
    headers['roarand'] = csrfToken;
  }
  if (tenantIdHeader) {
    headers['x-tenant-id'] = tenantIdHeader;
  }
  if (subjectIdHeader) {
    headers['x-subject-id'] = subjectIdHeader;
  }
  if (displayNameHeader) {
    headers['x-display-name'] = displayNameHeader;
  }
  return { ...config, headers, credentials: 'include' };
}

function createApiError(params: {
  status: number | null;
  code?: string | null;
  error: string;
  kind: ApiErrorKind;
  retriable: boolean;
  authChallenge?: AuthChallenge | null;
}): ApiError {
  const apiError = new Error(params.error) as ApiError;
  apiError.name = 'ApiError';
  Object.defineProperties(apiError, {
    status: { value: params.status, enumerable: true },
    code: { value: params.code ?? null, enumerable: true },
    error: { value: params.error, enumerable: true },
    kind: { value: params.kind, enumerable: true },
    retriable: { value: params.retriable, enumerable: true },
    authChallenge: { value: params.authChallenge ?? null, enumerable: true },
  });
  return apiError;
}

function parseAuthChallenge(body: Record<string, unknown> | null): AuthChallenge | null {
  if (!body) {
    return null;
  }
  const authMode = body?.authMode;
  if (authMode !== 'LOCAL_CONFIG' && authMode !== 'IAM') {
    return null;
  }
  return {
    authMode,
    loginUrl: typeof body.loginUrl === 'string' ? body.loginUrl : null,
    iamStatus: typeof body.iamStatus === 'string' ? body.iamStatus : null,
    localLoginEnabled: body.localLoginEnabled === true,
  };
}

async function resolveErrorBody(response: Response): Promise<{ message: string; code: string | null; authChallenge: AuthChallenge | null }> {
  if (typeof response.json === 'function') {
    try {
      const body = (await response.json()) as Record<string, unknown>;
      const authChallenge = parseAuthChallenge(body);
      if (body?.error !== null && typeof body?.error === 'object' && typeof (body.error as Record<string, unknown>)?.message === 'string') {
        const errorBody = body.error as Record<string, unknown>;
        return {
          message: (errorBody.message as string).trim(),
          code: typeof errorBody.code === 'string' ? errorBody.code : null,
          authChallenge,
        };
      }
      if (typeof body?.error === 'string' && body.error.trim().length > 0) {
        return { message: body.error.trim(), code: null, authChallenge };
      }
      if (typeof body?.message === 'string' && body.message.trim().length > 0) {
        return {
          message: body.message.trim(),
          code: typeof body.code === 'string' ? body.code : null,
          authChallenge,
        };
      }
      if (authChallenge) {
        return { message: 'Authentication required', code: null, authChallenge };
      }
    } catch {
      // Fall back to the HTTP status line when the response is not JSON.
    }
  }

  if (typeof response.text === 'function') {
    try {
      const text = await response.text();
      if (text.trim().length > 0) {
        return { message: text.trim(), code: null, authChallenge: null };
      }
    } catch {
      // Fall back to the HTTP status line when the response body cannot be read.
    }
  }

  return { message: `HTTP ${response.status} ${response.statusText}`.trim(), code: null, authChallenge: null };
}

function isRetriableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function throwApiError(response: Response): Promise<never> {
  const errorBody = await resolveErrorBody(response);
  if (response.status === 401 && errorBody.authChallenge) {
    authChallengeHandler?.(errorBody.authChallenge);
  }
  throw createApiError({
    status: response.status,
    code: errorBody.code,
    error: errorBody.message,
    kind: 'http',
    retriable: isRetriableStatus(response.status),
    authChallenge: errorBody.authChallenge,
  });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && 'status' in error && 'error' in error && 'kind' in error && 'retriable' in error;
}

async function readJsonBody<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw createApiError({
      status: response.status,
      code: 'INVALID_RESPONSE_FORMAT',
      error: 'Invalid JSON response.',
      kind: 'http',
      retriable: false,
    });
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const interceptedInit = applyRequestInterceptors(init || {});
    const headers = { ...(interceptedInit.headers as Record<string, string> | undefined) };
    if (interceptedInit.body !== undefined && interceptedInit.body !== null && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, {
      ...interceptedInit,
      credentials: init?.credentials ?? 'include',
      headers,
    });
    if (!response.ok) {
      await throwApiError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return readJsonBody<T>(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    if (isApiError(error)) {
      throw error;
    }
    throw createApiError({
      status: null,
      code: null,
      error: error instanceof Error ? error.message : 'Network request failed.',
      kind: 'network',
      retriable: true,
    });
  }
}

export interface ApiClient {
  get: <T>(path: string, init?: RequestInit) => Promise<T>;
  post: <T>(path: string, body?: unknown, init?: RequestInit) => Promise<T>;
  put: <T>(path: string, body?: unknown, init?: RequestInit) => Promise<T>;
  delete: <T>(path: string, init?: RequestInit) => Promise<T>;
  patch: <T>(path: string, body?: unknown, init?: RequestInit) => Promise<T>;
  uploadFormData: <T>(path: string, formData: FormData, onProgress?: (percent: number) => void) => Promise<T>;
  getBlob: (path: string, init?: RequestInit) => Promise<{ blob: Blob; filename: string | null }>;
}

async function fetchForFormData(url: string, init?: RequestInit): Promise<Response> {
  try {
    const interceptedInit = applyRequestInterceptors(init || {});
    const response = await fetch(url, {
      ...interceptedInit,
      // Do NOT set Content-Type; browser must set it for multipart/form-data with boundary.
      method: interceptedInit.method ?? 'POST',
      credentials: interceptedInit.credentials ?? 'include',
      headers: {
        ...interceptedInit.headers,
      },
    });
    if (!response.ok) {
      await throwApiError(response);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    if (isApiError(error)) {
      throw error;
    }
    throw createApiError({
      status: null,
      code: null,
      error: error instanceof Error ? error.message : 'Network request failed.',
      kind: 'network',
      retriable: true,
    });
  }
}

function resolveXhrErrorMessage(status: number, responseText: string): string {
  if (responseText.trim().length > 0) {
    try {
      const parsed = JSON.parse(responseText) as { error?: unknown };
      if (parsed?.error !== null && typeof parsed?.error === 'object' && typeof (parsed.error as Record<string, unknown>)?.message === 'string') {
        return ((parsed.error as Record<string, unknown>).message as string).trim();
      }
      if (typeof parsed?.error === 'string' && parsed.error.trim().length > 0) {
        return parsed.error.trim();
      }
    } catch {
      // Fall back to raw text when the response is not JSON.
    }
    return responseText.trim();
  }
  return `HTTP ${status}`.trim();
}

function resolveXhrErrorCode(responseText: string): string | null {
  if (responseText.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    const errorField = parsed.error;
    if (errorField !== null && typeof errorField === 'object' && typeof (errorField as Record<string, unknown>).code === 'string') {
      return (errorField as Record<string, unknown>).code as string;
    }
    if (typeof parsed.code === 'string') {
      return parsed.code;
    }
  } catch {
    // Fall back to null when the response is not JSON.
  }
  return null;
}

function resolveXhrAuthChallenge(responseText: string): AuthChallenge | null {
  if (responseText.trim().length === 0) {
    return null;
  }
  try {
    return parseAuthChallenge(JSON.parse(responseText) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function assertSameOriginCredentialUrl(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin) {
    throw createApiError({
      status: null,
      code: 'CROSS_ORIGIN_CREDENTIAL_REQUEST_REJECTED',
      error: 'Credentialed upload requests must target the current origin.',
      kind: 'network',
      retriable: false,
    });
  }
}

function uploadFormDataWithProgress<T>(url: string, formData: FormData, onProgress?: (percent: number) => void): Promise<T> {
  assertSameOriginCredentialUrl(url);
  const intercepted = applyRequestInterceptors({ method: 'POST', body: formData });
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.responseType = 'text';

    const headers = intercepted.headers as Record<string, string> | undefined;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'content-type') {
          continue;
        }
        xhr.setRequestHeader(key, value);
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress?.(percent);
    };

    xhr.onerror = () => {
      reject(
        createApiError({
          status: null,
          error: 'Network request failed.',
          kind: 'network',
          retriable: true,
        }),
      );
    };

    xhr.onload = () => {
      const responseText = xhr.responseText ?? '';
      if (xhr.status < 200 || xhr.status >= 300) {
        const authChallenge = xhr.status === 401 ? resolveXhrAuthChallenge(responseText) : null;
        if (authChallenge) {
          authChallengeHandler?.(authChallenge);
        }
        reject(
          createApiError({
            status: xhr.status,
            code: resolveXhrErrorCode(responseText),
            error: resolveXhrErrorMessage(xhr.status, responseText),
            kind: 'http',
            retriable: isRetriableStatus(xhr.status),
            authChallenge,
          }),
        );
        return;
      }

      onProgress?.(100);
      try {
        resolve((responseText ? JSON.parse(responseText) : null) as T);
      } catch {
        reject(
          createApiError({
            status: xhr.status,
            code: 'INVALID_RESPONSE_FORMAT',
            error: 'Invalid JSON response.',
            kind: 'http',
            retriable: false,
          }),
        );
      }
    };

    xhr.send(formData);
  });
}

export const apiClient: ApiClient = {
  get: (path, init) => fetchJson(buildApiUrl(path), init),
  post: (path, body, init) =>
    fetchJson(buildApiUrl(path), {
      ...init,
      method: 'POST',
      body: body ? JSON.stringify(body) : null,
    }),
  put: (path, body, init) =>
    fetchJson(buildApiUrl(path), {
      ...init,
      method: 'PUT',
      body: body ? JSON.stringify(body) : null,
    }),
  delete: (path, init) =>
    fetchJson(buildApiUrl(path), {
      ...init,
      method: 'DELETE',
    }),
  patch: (path, body, init) =>
    fetchJson(buildApiUrl(path), {
      ...init,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : null,
    }),
  uploadFormData: async <T>(path: string, formData: FormData, onProgress?: (percent: number) => void): Promise<T> => {
    const url = buildApiUrl(path);
    assertSameOriginCredentialUrl(url);
    if (onProgress) {
      return uploadFormDataWithProgress<T>(url, formData, onProgress);
    }
    const response = await fetchForFormData(url, {
      method: 'POST',
      body: formData,
    });
    return readJsonBody<T>(response);
  },
  getBlob: async (path: string, init?: RequestInit): Promise<{ blob: Blob; filename: string | null }> => {
    const url = buildApiUrl(path);
    const interceptedInit = applyRequestInterceptors(init || {});
    const response = await fetch(url, {
      ...interceptedInit,
      method: interceptedInit.method ?? 'GET',
      credentials: interceptedInit.credentials ?? 'include',
      headers: { ...interceptedInit.headers },
    });
    if (!response.ok) {
      await throwApiError(response);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition');
    return { blob, filename: parseContentDispositionFilename(disposition) };
  },
};

/**
 * Parse filename from Content-Disposition header.
 * Prefers RFC 5987 `filename*=UTF-8''<percent-encoded>` over ASCII `filename` fallback,
 * so non-ASCII filenames (e.g. Chinese) are preserved instead of falling back to underscores.
 */
function parseContentDispositionFilename(disposition: string | null): string | null {
  if (!disposition) {
    return null;
  }
  const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1]);
    } catch {
      // malformed percent-encoding — fall through to plain filename
    }
  }
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}
