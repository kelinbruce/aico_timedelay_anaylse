import { AgentError, brand } from '@nextagent/agent-common';
import type {
  RuntimeCommandPort,
  RuntimeConversationAnnotationPort,
  RuntimeSessionPort,
  SkillCatalogQueryPort,
} from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('schema-validation-agent');
const LONG_ID = 'x'.repeat(129);

function makeDependencies() {
  const runtime: RuntimeCommandPort = {
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
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: AGENT_ID,
      sessionId: brand<string, 'SessionId'>('S1'),
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: AGENT_ID,
      sessionId: brand<string, 'SessionId'>('S1'),
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({
      childSession: {
        tenantId: brand<string, 'TenantId'>('T1'),
        subjectId: brand<string, 'SubjectId'>('U1'),
        agentId: AGENT_ID,
        sessionId: brand<string, 'SessionId'>('S-child'),
        createdAt: brand<number, 'EpochMillis'>(0),
        updatedAt: brand<number, 'EpochMillis'>(0),
        hasInFlightRequest: false,
      },
    })),
    forkFromRequest: vi.fn(async () => ({
      childSession: {
        tenantId: brand<string, 'TenantId'>('T1'),
        subjectId: brand<string, 'SubjectId'>('U1'),
        agentId: AGENT_ID,
        sessionId: brand<string, 'SessionId'>('S-child'),
        createdAt: brand<number, 'EpochMillis'>(0),
        updatedAt: brand<number, 'EpochMillis'>(0),
        hasInFlightRequest: false,
      },
    })),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      totalMarkers: 0,
      offset: 0,
      limit: 100,
      markers: [],
    })),
    updateTitle: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: AGENT_ID,
      sessionId: brand<string, 'SessionId'>('S1'),
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const annotations: RuntimeConversationAnnotationPort = {
    upsertAnnotation: vi.fn(async () => ({
      annotationId: 'ann-1',
      sessionId: brand<string, 'SessionId'>('S1'),
      requestRunId: brand<string, 'RequestRunId'>('R1'),
      sentiment: 'UP' as const,
      isFavorited: false,
      isQuestionFavorited: false,
      comment: null,
      createdAt: brand<number, 'EpochMillis'>(1000),
    })),
    listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    listQuestionFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    listSessionAnnotations: vi.fn(async () => []),
  };
  return {
    runtime,
    sessions,
    annotations,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'test-user' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: AGENT_ID,
  };
}

describe('schema validation constraints (section 5)', () => {
  // 5.A.1: Path params maxLength — Fastify rejects overly long path values
  // at the HTTP layer (414 URI Too Long) before reaching schema validation,
  // which is still a correct rejection. For shorter over-limit values that
  // fit in the URI but exceed schema maxLength, the schema returns 400.
  describe('5.A path params', () => {
    it('rejects sessionId that exceeds maxLength (414 for long URI)', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${LONG_ID}` });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(deps.sessions.deleteSession).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects shareId that exceeds maxLength (414 for long URI)', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: `/api/v1/shares/${LONG_ID}/conversation` });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      await app.close();
    });
  });

  // 5.B.1: Empty title rejected by schema
  describe('5.B.1 empty title body', () => {
    it('rejects empty title at the schema boundary', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/sessions/S1/title',
        payload: { title: '' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string; message: string } }>().error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(response.json<{ error: { message: string } }>().error.message).toBe('title must not be empty.');
      expect(deps.sessions.updateTitle).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects a missing title body field with a field-level required message', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/sessions/S1/title',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string; message: string } }>().error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(response.json<{ error: { message: string } }>().error.message).toBe('title is required.');
      expect(deps.sessions.updateTitle).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects an empty sessionId path segment with a field-level message', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'PUT',
        // Under app.inject (light-my-request) the empty segment is not
        // collapsed, so :sessionId captures "" and the params schema
        // (minLength: 1) rejects it with a field-level message. Under a real
        // HTTP server Fastify collapses //, the route does not match, and the
        // auth-local not-found handler returns 404 NOT_FOUND (covered by the
        // not-found contract test in schema-validation-boundary.test.ts).
        url: '/api/v1/sessions//title',
        payload: { title: 'x' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string; message: string } }>().error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(response.json<{ error: { message: string } }>().error.message).toBe('sessionId must not be empty.');
      expect(deps.sessions.updateTitle).not.toHaveBeenCalled();
      await app.close();
    });
  });

  // 5.C.1: Non-integer query patterns
  describe('5.C.1 session list non-integer query patterns', () => {
    it('rejects non-integer offset value', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions?offset=abc' });
      expect(response.statusCode).toBe(400);
      expect(deps.sessions.listSessions).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects non-integer limit value', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions?limit=ten' });
      expect(response.statusCode).toBe(400);
      expect(deps.sessions.listSessions).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects non-integer createdFrom value', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions?createdFrom=not-a-number&createdTo=2000' });
      expect(response.statusCode).toBe(400);
      expect(deps.sessions.listSessions).not.toHaveBeenCalled();
      await app.close();
    });
  });

  // 5.C.6: Non-stdout/stderr stream value rejected
  describe('5.C.6 background task output stream enum', () => {
    it('rejects invalid stream value', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks/T1/output?stream=invalid' });
      expect(response.statusCode).toBe(400);
      await app.close();
    });
  });

  // 5.D.1: Fork idempotencyKey keeps the 128-character public boundary.
  describe('5.D.1 fork idempotencyKey length', () => {
    it('accepts 128-character idempotencyKey for message fork', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const forkFromMessage = vi.fn(async (_command: Parameters<RuntimeSessionPort['forkFromMessage']>[0], _signal?: AbortSignal) => ({
        childSession: {
          tenantId: brand<string, 'TenantId'>('T1'),
          subjectId: brand<string, 'SubjectId'>('U1'),
          agentId: AGENT_ID,
          sessionId: brand<string, 'SessionId'>('S-child'),
          title: 'Forked Session',
          createdAt: brand<number, 'EpochMillis'>(0),
          updatedAt: brand<number, 'EpochMillis'>(0),
          hasInFlightRequest: false,
        },
      }));
      const deps = { ...makeDependencies(), sessions: { ...makeDependencies().sessions, forkFromMessage } };
      await registerWebChannel(app, deps);
      const key128 = 'k'.repeat(128);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/messages/M1/fork',
        payload: { idempotencyKey: key128 },
      });
      expect(response.statusCode).toBe(200);
      expect(forkFromMessage).toHaveBeenCalledOnce();
      expect(forkFromMessage.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
      await app.close();
    });

    it('accepts 128-character idempotencyKey for request fork', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const forkFromRequest = vi.fn(async () => ({
        childSession: {
          tenantId: brand<string, 'TenantId'>('T1'),
          subjectId: brand<string, 'SubjectId'>('U1'),
          agentId: AGENT_ID,
          sessionId: brand<string, 'SessionId'>('S-child'),
          title: 'Forked Session',
          createdAt: brand<number, 'EpochMillis'>(0),
          updatedAt: brand<number, 'EpochMillis'>(0),
          hasInFlightRequest: false,
        },
      }));
      const deps = { ...makeDependencies(), sessions: { ...makeDependencies().sessions, forkFromRequest } };
      await registerWebChannel(app, deps);
      const key128b = 'k'.repeat(128);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/requests/R1/fork',
        payload: { idempotencyKey: key128b },
      });
      expect(response.statusCode).toBe(200);
      expect(forkFromRequest).toHaveBeenCalledOnce();
      await app.close();
    });

    it('rejects 129-character idempotencyKey for fork', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const key129 = 'k'.repeat(257);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/messages/M1/fork',
        payload: { idempotencyKey: key129 },
      });
      expect(response.statusCode).toBe(400);
      expect(deps.sessions.forkFromMessage).not.toHaveBeenCalled();
      await app.close();
    });

    it('preserves the canonical fork code while replacing provider diagnostics with the fixed public message', async () => {
      const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      const forkFromMessage = vi.fn(async () => {
        throw new AgentError({
          code: 'SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE',
          message: 'C:\\private\\workspace\\tool-result.txt',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: { path: 'C:\\private\\workspace\\tool-result.txt' },
        });
      });
      const deps = { ...makeDependencies(), sessions: { ...makeDependencies().sessions, forkFromMessage } };
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/messages/M1/fork',
        payload: { idempotencyKey: 'fork-failure' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: 'SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE',
          message: 'Session fork failed.',
        },
      });
      expect(response.body).not.toContain('private');
      await app.close();
    });
  });
});
