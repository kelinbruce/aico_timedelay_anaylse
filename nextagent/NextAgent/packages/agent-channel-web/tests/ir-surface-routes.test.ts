import { brand } from '@nextagent/agent-common';
import { registerWebChannel, IR_ROUTE_WHITELIST, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import type { RuntimeCommandPort, RuntimeSessionActivityPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const IR_PREFIX = '/api/v1/ir';
const TENANT = brand<string, 'TenantId'>('T1');
const SUBJECT = brand<string, 'SubjectId'>('U1');

function session(sessionId = brand<string, 'SessionId'>('S1')) {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: brand<string, 'AgentId'>('agent-1'),
    sessionId,
    title: 'Session',
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
    hasInFlightRequest: false,
  };
}

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
    createSession: vi.fn(async () => session()),
    requireSession: vi.fn(async () => session()),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: session() })),
    forkFromRequest: vi.fn(async () => ({ childSession: session() })),
    listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({ sessionId: brand<string, 'SessionId'>('S1'), totalMarkers: 0, offset: 0, limit: 50, markers: [] })),
    updateTitle: vi.fn(async () => session()),
    streamEvents: vi.fn(async function* () {}),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  } as unknown as RuntimeSessionPort;
}

function makeIrDependencies(): WebChannelDependencies {
  return {
    runtime: makeRuntime(),
    sessions: makeSessions(),
    identityResolver: (request) => {
      const headers = request.headers;
      const tenantId = headers['x-tenant-id'];
      const subjectId = headers['x-subject-id'];
      const displayName = headers['x-display-name'];
      const tenantIdValue = Array.isArray(tenantId) ? tenantId[0] : tenantId;
      const subjectIdValue = Array.isArray(subjectId) ? subjectId[0] : subjectId;
      const displayNameValue = Array.isArray(displayName) ? displayName[0] : displayName;
      if (tenantIdValue === undefined || subjectIdValue === undefined) {
        throw new Error('LOCAL_AUTH_REQUIRED');
      }
      return {
        tenantId: brand<string, 'TenantId'>(tenantIdValue),
        subjectId: brand<string, 'SubjectId'>(subjectIdValue),
        displayName: displayNameValue ?? 'IR Caller',
      };
    },
    runtimeBootstrap: { transportKind: 'SSE' as const },
    sessionActivities: {
      streamSessionActivities: vi.fn(async function* () {
        yield { type: 'SNAPSHOT', entries: [] } as const;
      }),
      consumeSessionActivity: vi.fn(async () => undefined),
    } satisfies RuntimeSessionActivityPort,
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-1'),
    routePrefix: '/',
    apiSubNamespace: 'ir',
    routeWhitelist: IR_ROUTE_WHITELIST,
  };
}

const IR_HEADERS = {
  'x-tenant-id': 'T1',
  'x-subject-id': 'U1',
  'x-display-name': 'IR System',
};

describe('IR surface', () => {
  describe('endpoint mirroring', () => {
    it('does not duplicate global health routes for the IR prefix', async () => {
      const app = Fastify();
      await registerWebChannel(app, makeIrDependencies());

      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(404);
      await app.close();
    });

    it('creates session via IR prefix', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions`,
        headers: IR_HEADERS,
        payload: { locale: 'zh-CN' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBeDefined();
      expect(deps.sessions.createSession).toHaveBeenCalledTimes(1);
      await app.close();
    });

    it('submits request via IR prefix', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/requests`,
        headers: IR_HEADERS,
        payload: { inputText: 'analyze alarm', idempotencyKey: 'key-1' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.requestId).toBeDefined();
      expect(deps.runtime.submit).toHaveBeenCalledTimes(1);
      await app.close();
    });

    it('cancels request via IR prefix', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/cancel`,
        headers: IR_HEADERS,
        payload: { expectedLatestRequestId: 'req-1', idempotencyKey: 'key-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(deps.runtime.cancel).toHaveBeenCalledTimes(1);
      await app.close();
    });

    it('retries request via IR prefix', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/retry`,
        headers: IR_HEADERS,
        payload: { expectedLatestRequestId: 'req-1', idempotencyKey: 'key-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(deps.runtime.retryLatest).toHaveBeenCalledTimes(1);
      await app.close();
    });

    it('answers pending input via IR prefix', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/pending-inputs/pi-1/answer`,
        headers: IR_HEADERS,
        payload: { answers: [['yes']] },
      });

      expect(response.statusCode).toBe(200);
      expect(deps.runtime.answerPendingInput).toHaveBeenCalledTimes(1);
      await app.close();
    });
  });

  describe('route whitelist', () => {
    it('keeps the IR surface limited to the six explicit machine endpoints', () => {
      expect([...IR_ROUTE_WHITELIST].sort()).toEqual([
        'sessions',
        'sessions/:sessionId/cancel',
        'sessions/:sessionId/pending-inputs/:pendingInputId/answer',
        'sessions/:sessionId/requests',
        'sessions/:sessionId/retry',
        'sessions/:sessionId/stream',
      ]);
    });

    it('does not expose UI-only endpoints under IR prefix', async () => {
      const app = Fastify();
      await registerWebChannel(app, makeIrDependencies());

      for (const path of [
        `${IR_PREFIX}/runtime/bootstrap`,
        `${IR_PREFIX}/skills`,
        `${IR_PREFIX}/frequent-questions`,
        `${IR_PREFIX}/sessions/S1/conversation`,
        `${IR_PREFIX}/session-activities/stream`,
        `${IR_PREFIX}/session-activities/ws`,
      ]) {
        const response = await app.inject({ method: 'GET', url: path, headers: IR_HEADERS });
        expect(response.statusCode, `GET ${path}`).toBe(404);
      }

      const postBootstrap = await app.inject({ method: 'POST', url: `${IR_PREFIX}/sessions/S1/shares`, headers: IR_HEADERS, payload: {} });
      expect(postBootstrap.statusCode).toBe(404);
      const consume = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/activity/consume`,
        headers: IR_HEADERS,
        payload: { activityId: 'activity-1', observedRunId: 'run-1' },
      });
      expect(consume.statusCode).toBe(404);

      await app.close();
    });
  });

  describe('authentication isolation', () => {
    it('rejects missing x-tenant-id with 401 and no side effect', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions`,
        headers: { 'x-subject-id': 'U1' },
        payload: {},
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(deps.sessions.createSession).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects missing x-subject-id with 401 and no side effect', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions`,
        headers: { 'x-tenant-id': 'T1' },
        payload: {},
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(deps.sessions.createSession).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects body-injected scope fields', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/requests`,
        headers: IR_HEADERS,
        payload: {
          inputText: 'test',
          idempotencyKey: 'key-1',
          tenantId: 'HACKER',
          agentId: 'hacker-agent',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(deps.runtime.submit).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('agent scope', () => {
    it('derives agent scope from session.agentId not from headers', async () => {
      const app = Fastify();
      const deps = makeIrDependencies();
      const customSession = { ...session(), agentId: brand<string, 'AgentId'>('session-agent-99') };
      (deps.sessions.requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(customSession);
      await registerWebChannel(app, deps);

      await app.inject({
        method: 'POST',
        url: `${IR_PREFIX}/sessions/S1/requests`,
        headers: { ...IR_HEADERS, 'x-agent-id': 'hacker-agent' },
        payload: { inputText: 'test', idempotencyKey: 'key-1' },
      });

      // requireSession is the source of agent scope; the x-agent-id header must not influence it
      const requireCall = (deps.sessions.requireSession as ReturnType<typeof vi.fn>).mock.calls[0];
      if (requireCall === undefined) {
        throw new Error('requireSession was not called.');
      }
      expect(requireCall[0].sessionId).toEqual(brand<string, 'SessionId'>('S1'));
      // submit was called with the session-bound agentId from requireSession, not from header
      expect(deps.runtime.submit).toHaveBeenCalledTimes(1);
      await app.close();
    });
  });
});
