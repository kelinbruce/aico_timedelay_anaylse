/**
 * Test API Client — NextAgent TS 后端 E2E 测试共用 HTTP 请求工具
 *
 * ⚠️ 真实 API 规则（从 @nextagent/agent-channel-web 源码提取）:
 *   - /health, /health/deep — 无前缀
 *   - /api/v1/* — 带前缀的业务 API
 *   - /api/v1/auth/local/login — 仅 localAuth.enabled=true 时注册
 *   - 默认 trusted identity（localAuth.enabled=false），无需认证
 *   - Create session: { locale? }（无 agentId/sessionId）
 *   - Cancel: { expectedLatestRequestId, idempotencyKey, action? }
 *   - Retry: { expectedLatestRequestId, idempotencyKey }
 */

import { isRunning, startNextAgent, stopNextAgent, waitForReady } from './process-manager.js';

const BASE_URL = process.env.NEXTAGENT_URL || 'http://localhost:3000';

interface RequestOptions {
  method: string;
  path: string;
  noPrefix?: boolean;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let cookieJar: string[] = [];
let ensureServerReadyPromise: Promise<void> | null = null;

function managesLocalServer(): boolean {
  return process.env.NEXTAGENT_URL === undefined;
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toUpperCase();
  if (message.includes('ECONNREFUSED') || message.includes('FETCH FAILED')) {
    return true;
  }
  return false;
}

async function ensureServerReady(forceRestart = false): Promise<void> {
  if (!managesLocalServer()) {
    return;
  }
  if (ensureServerReadyPromise !== null && !forceRestart) {
    return ensureServerReadyPromise;
  }
  const run = async () => {
    if (forceRestart && isRunning()) {
      await stopNextAgent();
    }
    try {
      await waitForReady(forceRestart ? 60_000 : 5_000);
      return;
    } catch {
      if (isRunning()) {
        await stopNextAgent();
      }
      await startNextAgent();
      await waitForReady(60_000);
    }
  };
  const promise = run().finally(() => {
    if (ensureServerReadyPromise === promise) {
      ensureServerReadyPromise = null;
    }
  });
  ensureServerReadyPromise = promise;
  return promise;
}

async function fetchWithReadyServer(url: string, init?: RequestInit): Promise<Response> {
  await ensureServerReady();
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!managesLocalServer() || !isConnectionRefused(error)) {
      throw error;
    }
    await ensureServerReady(true);
    return fetch(url, init);
  }
}

async function request(opts: RequestOptions): Promise<ApiResponse> {
  const prefix = opts.noPrefix ? '' : '/api/v1';
  const url = `${BASE_URL}${prefix}${opts.path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
    ...(cookieJar.length > 0 ? { Cookie: cookieJar.join('; ') } : {}),
  };

  const res = await fetchWithReadyServer(url, {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    cookieJar.push(...setCookies.map((c: string) => c.split(';')[0]));
  }

  const contentType = res.headers.get('content-type') ?? '';
  const body = res.status !== 204 && contentType.includes('json') ? await res.json() : {};
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: body as Record<string, unknown>,
  };
}

// ── Health (no prefix) ──

export async function healthCheck(): Promise<ApiResponse> {
  return request({ method: 'GET', path: '/health', noPrefix: true });
}

export async function healthCheckDeep(): Promise<ApiResponse> {
  return request({ method: 'GET', path: '/health/deep', noPrefix: true });
}

// ── Auth ──

export async function localAuthLogin(tenantId: string, subjectId: string, password?: string): Promise<ApiResponse> {
  cookieJar = [];
  return request({
    method: 'POST',
    path: '/auth/local/login',
    body: { tenantId, subjectId, password: password ?? 'test-password' },
  });
}

export async function localAuthLogout(): Promise<ApiResponse> {
  const res = await request({ method: 'POST', path: '/auth/local/logout' });
  cookieJar = [];
  return res;
}

/** Trusted identity login (default config) — no auth needed */
export async function trustedLogin(): Promise<void> {
  cookieJar = [];
}

// ── Sessions ──

/** Create session: POST /api/v1/sessions, body = { locale? } */
export async function createSession(locale?: string): Promise<ApiResponse> {
  const body: Record<string, unknown> = {};
  if (locale) {
    body.locale = locale;
  }
  return request({ method: 'POST', path: '/sessions', body });
}

export async function listSessions(offset?: number, limit?: number): Promise<ApiResponse> {
  const q = new URLSearchParams();
  if (offset) {
    q.set('offset', String(offset));
  }
  if (limit) {
    q.set('limit', String(limit));
  }
  const qs = q.toString();
  return request({ method: 'GET', path: `/sessions${qs ? '?' + qs : ''}` });
}

/** Update session title: PUT /api/v1/sessions/:id/title */
export async function updateSessionTitle(sessionId: string, title: string): Promise<ApiResponse> {
  return request({ method: 'PUT', path: `/sessions/${sessionId}/title`, body: { title } });
}

// ── Requests ──

/** Submit: POST /api/v1/sessions/:id/requests, body = { inputText, idempotencyKey } */
export async function submitRequest(sessionId: string, inputText: string, idempotencyKey?: string): Promise<ApiResponse> {
  return request({
    method: 'POST',
    path: `/sessions/${sessionId}/requests`,
    body: {
      inputText,
      idempotencyKey: idempotencyKey ?? `ik-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

/** Cancel: POST /api/v1/sessions/:id/cancel, body = { expectedLatestRequestId, idempotencyKey, action? } */
export async function cancelRun(
  sessionId: string,
  expectedLatestRequestId: string,
  idempotencyKey?: string,
  action?: 'CANCEL' | 'CANCEL_LATEST',
): Promise<ApiResponse> {
  return request({
    method: 'POST',
    path: `/sessions/${sessionId}/cancel`,
    body: {
      expectedLatestRequestId,
      idempotencyKey: idempotencyKey ?? `ik-cancel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(action ? { action } : {}),
    },
  });
}

/** Retry: POST /api/v1/sessions/:id/retry, body = { expectedLatestRequestId, idempotencyKey } */
export async function retryRun(sessionId: string, expectedLatestRequestId: string, idempotencyKey?: string): Promise<ApiResponse> {
  return request({
    method: 'POST',
    path: `/sessions/${sessionId}/retry`,
    body: {
      expectedLatestRequestId,
      idempotencyKey: idempotencyKey ?? `ik-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

// ── Conversation & Stream ──

export async function getConversation(sessionId: string, options?: { limit?: number; includeCapabilityResults?: boolean }): Promise<ApiResponse> {
  const q = new URLSearchParams();
  if (options?.limit) {
    q.set('limit', String(options.limit));
  }
  if (options?.includeCapabilityResults) {
    q.set('includeCapabilityResults', 'true');
  }
  const qs = q.toString();
  return request({ method: 'GET', path: `/sessions/${sessionId}/conversation${qs ? '?' + qs : ''}` });
}

export async function connectStream(sessionId: string): Promise<ReadableStream<Uint8Array>> {
  const url = `${BASE_URL}/api/v1/sessions/${sessionId}/stream`;
  const res = await fetchWithReadyServer(url, {
    headers: cookieJar.length > 0 ? { Cookie: cookieJar.join('; ') } : {},
  });
  return res.body!;
}

// ── Helpers ──

export async function waitForTerminal(sessionId: string, requestId: string, maxWaitMs = 30_000): Promise<ApiResponse> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await getConversation(sessionId, { includeCapabilityResults: true });
    if (res.status !== 200) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const items = ((res.body as any)?.items ?? []) as any[];
    // Real API can complete with a visible assistant turn or a capability/tool result only.
    // Treat either as terminal evidence for the request so follow-up submits do not race a finished run.
    const requestItems = items.filter((m) => m.requestId === requestId);
    const hasAssistantMessage = requestItems.some((m) => m.role === 'ASSISTANT' && typeof m.content === 'string' && m.content.length > 0);
    const hasCapabilityResult = requestItems.some((m) => m.role === 'CAPABILITY_RESULT');
    const hasTerminalEvent = requestItems.some((m) => m.metadata?.eventType === 'REQUEST_COMPLETED');
    if (hasAssistantMessage || hasCapabilityResult || hasTerminalEvent) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Request ${requestId} did not reach terminal state within ${maxWaitMs}ms`);
}

export function resetCookies(): void {
  cookieJar = [];
}
export function setCookies(cookies: string[]): void {
  cookieJar = cookies;
}
export function getCookies(): string[] {
  return [...cookieJar];
}

// ── Shell/File helpers ──

export async function execCommand(
  command: string,
  options?: { cwd?: string; timeout?: number; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { exec } = await import('child_process');
  const opts = {
    cwd: options?.cwd ?? process.cwd(),
    timeout: options?.timeout ?? 30_000,
    env: { ...process.env, ...options?.env },
    encoding: 'utf8' as const,
    maxBuffer: 1024 * 1024,
  };
  return new Promise((resolve) => {
    exec(command, opts, (error, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: error ? ((error as any).code ?? 1) : 0 });
    });
  });
}

export async function readFileContent(filePath: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  return readFile(filePath, 'utf8');
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  const { writeFile } = await import('fs/promises');
  return writeFile(filePath, content, 'utf8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  const { stat } = await import('fs/promises');
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Test constants ──

export const TEST_IDENTITY = { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' };
export const TEST_TENANT_B = { tenantId: 'tenant-b', subjectId: 'user-b' };
export const TEST_AGENT = { agentId: 'default-agent', agentVersion: 'v1', displayName: 'NextAgent telecom agent', defaultLanguage: 'zh-CN' };
export const TEST_DEFAULT_PROMPT_TEMPLATE = 'minimal-telecom';
export const TEST_PACKAGE_ROOT = process.env.NEXTAGENT_PACKAGE_ROOT || 'D:\\Version\\nextagent-local-win32-x64';

// Backward compat aliases
export const TEST_TENANT_A = TEST_IDENTITY;
