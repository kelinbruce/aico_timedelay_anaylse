import { createAppCredentialResolver, createNextAgentTestApp, validateDefaultSystemConfig } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local configured Web auth', () => {
  it('blocks invalid local auth startup configuration without leaking secret values', () => {
    for (const localAuth of [
      { enabled: true, cookieTtlMs: 3_600_000 },
      { enabled: true, credentialRef: 'direct:secret-value', cookieTtlMs: 3_600_000 },
      { enabled: true, credentialRef: 'env:NEXTAGENT_TEST_LOCAL_AUTH', cookieTtlMs: 1 },
    ]) {
      expect(() => validateTestConfig(localAuth)).toThrow('App configuration is blocked before ready.');
    }
  });

  it('fails closed on missing file credential without leaking the file path or resolver exception', () => {
    const sensitiveFile = join(process.cwd(), 'secret', 'local-auth', 'missing-credential.txt');
    const error = catchValidationError({ enabled: true, credentialRef: `file:${sensitiveFile}`, cookieTtlMs: 3_600_000 });

    expect(error).toMatchObject({ code: 'APP_CONFIG_BLOCKED' });
    expect(String(error)).not.toContain(sensitiveFile);
    expect(JSON.stringify(error)).not.toContain(sensitiveFile);
    expect(String(error)).not.toContain('ENOENT');
  });

  it('challenges protected REST and stream entrypoints before runtime side effects', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }], localAuthEnabled: true });

    const bootstrap = await app.server.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap?transportKind=WEBSOCKET&tenantId=evil' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toEqual({ transportKind: 'SSE' });
    expect(bootstrap.body).not.toContain('tenant');

    const createSession = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    expect(createSession.statusCode).toBe(401);
    expect(createSession.json()).toMatchObject({
      error: {
        code: 'LOCAL_AUTH_REQUIRED',
        message: 'Authentication required.',
      },
    });

    const convenienceSubmit = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'auth challenge', idempotencyKey: 'idem-auth-challenge' },
    });
    expect(convenienceSubmit.statusCode).toBe(401);
    expect(convenienceSubmit.json()).toMatchObject({
      error: {
        code: 'LOCAL_AUTH_REQUIRED',
        message: 'Authentication required.',
      },
    });

    const tokenQuery = await app.server.inject({ method: 'GET', url: '/api/v1/sessions?token=test-only' });
    expect(tokenQuery.statusCode).toBe(401);

    const stream = await app.server.inject({ method: 'GET', url: '/api/v1/sessions/session-does-not-leak/stream?lastSeenSequence=0' });
    expect(stream.statusCode).toBe(401);
    expect(stream.body).not.toContain('session-does-not-leak');

    const sessionPage = await app.server.inject({ method: 'GET', url: '/session/session-does-not-leak' });
    expect(sessionPage.statusCode).toBe(401);
    expect(sessionPage.json()).toMatchObject({
      authMode: 'LOCAL_CONFIG',
      loginUrl: '/login',
      localLoginEnabled: true,
    });
    expect(sessionPage.body).not.toContain('session-does-not-leak');

    const loginPage = await app.server.inject({ method: 'GET', url: '/login' });
    expect(loginPage.statusCode).not.toBe(401);

    const staticAsset = await app.server.inject({ method: 'GET', url: '/assets/app.js' });
    expect(staticAsset.statusCode).not.toBe(401);

    const sessions = await app.sessions.listSessions({
      identityContext: {
        tenantId: brand<string, 'TenantId'>('local-tenant'),
        subjectId: brand<string, 'SubjectId'>('local-subject'),
        displayName: 'Local developer',
      },
      agentId: brand<string, 'AgentId'>('default-agent'),
      offset: 0,
      limit: 10,
    });
    expect(sessions.entries).toEqual([]);
  });

  it('sets a signed HttpOnly cookie on login and uses it for trusted REST, SSE and WebSocket identity', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'auth ok' }],
      localAuthEnabled: true,
    });

    const failedLogin = await app.server.inject({ method: 'POST', url: '/api/v1/auth/local/login', payload: { credential: 'wrong' } });
    expect(failedLogin.statusCode).toBe(401);
    expect(failedLogin.body).not.toContain('test-only');

    const login = await app.server.inject({ method: 'POST', url: '/api/v1/auth/local/login', payload: { credential: 'test-local-auth' } });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ identity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' } });
    const cookie = extractCookie(login.headers['set-cookie']);
    expect(cookie).toContain('nextagent_local_auth=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');

    const createSession = await app.server.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { cookie, 'x-tenant-id': 'evil' },
      payload: {},
    });
    expect(createSession.statusCode).toBe(200);
    const { sessionId } = createSession.json<{ sessionId: string }>();

    const accepted = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/requests`,
      headers: { cookie, 'x-tenant-id': 'evil' },
      payload: { inputText: 'auth stream', idempotencyKey: 'idem-auth-stream' },
    });
    expect(accepted.statusCode).toBe(200);
    const { runId } = accepted.json<{ runId: string }>();

    const sse = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}`,
      headers: { cookie },
    });
    expect(sse.statusCode).toBe(200);
    expect(sse.body).toContain('event: REQUEST_COMPLETED');

    const baseUrl = await listenOnRandomPort(app.server);
    const ws = await readUpgradeResponse(Number(new URL(baseUrl).port), `/api/v1/sessions/${sessionId}/ws?lastSeenSequence=0&runId=${runId}`, cookie);
    expect(ws).toContain('HTTP/1.1 101 Switching Protocols');
  });

  it('clears local auth cookie on logout and rejects WebSocket without a valid cookie', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }], localAuthEnabled: true });
    const login = await app.server.inject({ method: 'POST', url: '/api/v1/auth/local/login', payload: { credential: 'test-local-auth' } });
    const cookie = extractCookie(login.headers['set-cookie']);

    const logout = await app.server.inject({ method: 'POST', url: '/api/v1/auth/local/logout', headers: { cookie }, payload: {} });
    expect(logout.statusCode).toBe(200);
    expect(extractCookie(logout.headers['set-cookie'])).toContain('Max-Age=0');

    const baseUrl = await listenOnRandomPort(app.server);
    const rejectedWs = await readUpgradeResponse(Number(new URL(baseUrl).port), '/api/v1/sessions/no-leak/ws?lastSeenSequence=0');
    expect(rejectedWs).toContain('HTTP/1.1 401 Unauthorized');
    expect(rejectedWs).not.toContain('no-leak');
  });
});

function catchValidationError(localAuth: Record<string, unknown>): unknown {
  try {
    validateTestConfig(localAuth);
    return undefined;
  } catch (error) {
    return error;
  }
}
function validateTestConfig(localAuth: Record<string, unknown>) {
  return validateDefaultSystemConfig(rawSystemConfig(localAuth), process.cwd(), {
    credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only', NEXTAGENT_TEST_LOCAL_AUTH: 'test-local-auth' }),
  });
}

function rawSystemConfig(localAuth: Record<string, unknown>) {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
      localAuth,
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:NEXTAGENT_TEST_ONLY',
        models: [
          {
            modelId: 'deterministic-test-model',
            timeoutMs: 30_000,
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function extractCookie(header?: string | string[] | number): string {
  if (Array.isArray(header)) {
    return header.join('; ');
  }
  return String(header ?? '');
}

async function listenOnRandomPort(server: ReturnType<typeof createNextAgentTestApp>['server']): Promise<string> {
  if (server.server.listening) {
    const address = server.server.address();
    if (address !== null && typeof address === 'object') {
      return `http://127.0.0.1:${address.port}`;
    }
  }
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('Fastify test server did not expose a TCP address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readUpgradeResponse(port: number, path: string, cookie?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000);
    socket.on('connect', () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          'Sec-WebSocket-Version: 13',
          ...(cookie === undefined ? [] : [`Cookie: ${cookie}`]),
          '',
          '',
        ].join('\r\n'),
      );
    });
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).includes(Buffer.from('\r\n\r\n'))) {
        socket.end();
      }
    });
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Upgrade response timed out.'));
    });
    socket.on('error', reject);
  });
}
