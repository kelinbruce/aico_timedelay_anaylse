import { brand } from '@nextagent/agent-common';
import { registerWebChannel, IR_ROUTE_WHITELIST, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import type { RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Verifies the "prepend public prefix P in front of the fixed /api/v1 segment"
// route semantics: P=/ keeps /api/v1/... (no regression), P=/svcA mounts
// everything under /svcA/api/v1/... and /api/v1/... misses (404).

function makeRuntime(): RuntimeCommandPort {
  return {
    submit: vi.fn(async (command) => ({
      sessionId: command.sessionId,
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      targetRequestId: brand<string, 'MessageId'>('req-1'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-2'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('req-2'),
      runId: brand<string, 'RequestRunId'>('run-2'),
      attempt: 1,
    })),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      pendingInputId: brand<string, 'PendingInputId'>('pi-1'),
      status: 'RECEIVED' as const,
    })),
  };
}

function makeSessions(): RuntimeSessionPort {
  return {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      sessionId: brand<string, 'SessionId'>('S1'),
      title: 'S',
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      sessionId: brand<string, 'SessionId'>('S1'),
      title: 'S',
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: {} })),
    forkFromRequest: vi.fn(async () => ({ childSession: {} })),
    listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({ sessionId: brand<string, 'SessionId'>('S1'), totalMarkers: 0, offset: 0, limit: 50, markers: [] })),
    updateTitle: vi.fn(async () => ({})),
    streamEvents: vi.fn(async function* () {}),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  } as unknown as RuntimeSessionPort;
}

function makeDependencies(routePrefix?: string, apiSubNamespace?: string): WebChannelDependencies {
  return {
    runtime: makeRuntime(),
    sessions: makeSessions(),
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'Caller' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    defaultAgentId: brand<string, 'AgentId'>('agent-1'),
    ...(routePrefix === undefined ? {} : { routePrefix }),
    ...(apiSubNamespace === undefined ? {} : { apiSubNamespace }),
    ...(apiSubNamespace === 'ir' ? { routeWhitelist: IR_ROUTE_WHITELIST } : {}),
  } as unknown as WebChannelDependencies;
}

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close().catch(() => undefined)));
});

describe('route prefix P (prepended in front of /api/v1)', () => {
  it('mounts routes at /api/v1/... when P is the default /', async () => {
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies());

    const sessions = await app.inject({ method: 'GET', url: '/api/v1/sessions' });
    expect(sessions.statusCode).toBe(200);

    // health route is registered (hits) even without a health evaluator; it
    // reports DOWN (503), not 404 — proving the route mounted under /api/v1.
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).not.toBe(404);
  });

  it('mounts routes at /svcA/api/v1/... and 404s /api/v1/... when P=/svcA', async () => {
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies('/svcA'));

    const sessions = await app.inject({ method: 'GET', url: '/svcA/api/v1/sessions' });
    expect(sessions.statusCode).toBe(200);

    const health = await app.inject({ method: 'GET', url: '/svcA/api/v1/health' });
    expect(health.statusCode).not.toBe(404);

    const oldHealth = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(oldHealth.statusCode).toBe(404);

    const oldSessions = await app.inject({ method: 'GET', url: '/api/v1/sessions' });
    expect(oldSessions.statusCode).toBe(404);
  });

  it('mounts the IR sub-namespace at /svcA/api/v1/ir/... when P=/svcA', async () => {
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies('/svcA', 'ir'));

    // IR whitelist exposes sessions; the create endpoint mirrors the main API.
    const irSessions = await app.inject({
      method: 'POST',
      url: '/svcA/api/v1/ir/sessions',
      headers: { 'x-tenant-id': 'T1', 'x-subject-id': 'U1', 'x-display-name': 'IR' },
      payload: {},
    });
    expect(irSessions.statusCode).toBe(200);

    const oldIr = await app.inject({
      method: 'POST',
      url: '/api/v1/ir/sessions',
      headers: { 'x-tenant-id': 'T1', 'x-subject-id': 'U1' },
      payload: {},
    });
    expect(oldIr.statusCode).toBe(404);
  });

  it('keeps /api/v1/ir/... for the IR sub-namespace when P is the default /', async () => {
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies('/', 'ir'));

    const irSessions = await app.inject({
      method: 'POST',
      url: '/api/v1/ir/sessions',
      headers: { 'x-tenant-id': 'T1', 'x-subject-id': 'U1', 'x-display-name': 'IR' },
      payload: {},
    });
    expect(irSessions.statusCode).toBe(200);
  });
});
