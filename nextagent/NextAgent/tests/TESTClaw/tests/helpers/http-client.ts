import { DEFAULT_HOST, DEFAULT_PORT, BASE_URL } from './package-root.js';

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: <T = unknown>() => T;
}

export async function httpRequest(path: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };

  let body: string | undefined;
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  } else if (typeof options.body === 'string') {
    body = options.body;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const resp = await fetch(url, { method, headers, body, signal: controller.signal });
    const respBody = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return {
      status: resp.status,
      headers: respHeaders,
      body: respBody,
      json: <T = unknown>() => JSON.parse(respBody) as T,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGet(path: string, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse> {
  return httpRequest(path, { ...options, method: 'GET' });
}

export async function httpPost(
  path: string,
  body: Record<string, unknown>,
  options?: Omit<HttpRequestOptions, 'method' | 'body'>,
): Promise<HttpResponse> {
  return httpRequest(path, { ...options, method: 'POST', body });
}

export async function isServerHealthy(timeoutMs = 5_000): Promise<boolean> {
  try {
    const resp = await httpRequest('/', { timeoutMs });
    return resp.status < 500;
  } catch {
    return false;
  }
}

export async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy(2_000)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not healthy at ${BASE_URL} within ${timeoutMs}ms`);
}
