import { AgentError, brand } from '@nextagent/agent-common';
import type {
  RuntimeCommandPort,
  RuntimeConversationAnnotationPort,
  RuntimeSessionPort,
  SkillCatalogQueryPort,
} from '@nextagent/agent-contracts/runtime';
import type { ConversationAnnotationView, ConversationFavoriteTurnPage } from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const IDENTITY = {
  tenantId: brand<string, 'TenantId'>('T1'),
  subjectId: brand<string, 'SubjectId'>('U1'),
  displayName: 'test-user',
};

function makeAnnotationView(overrides: Partial<ConversationAnnotationView> = {}): ConversationAnnotationView {
  return {
    annotationId: 'ann-1',
    sessionId: brand<string, 'SessionId'>('S1'),
    requestRunId: brand<string, 'RequestRunId'>('R1'),
    sentiment: 'UP',
    isFavorited: false,
    isQuestionFavorited: false,
    comment: null,
    createdAt: brand<number, 'EpochMillis'>(1000),
    ...overrides,
  };
}

function makeDependencies(overrides: { annotations?: RuntimeConversationAnnotationPort } = {}) {
  const annotations: RuntimeConversationAnnotationPort = overrides.annotations ?? {
    upsertAnnotation: vi.fn(async () => makeAnnotationView()),
    listFavoriteTurns: vi.fn(async (): Promise<ConversationFavoriteTurnPage> => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    listSessionAnnotations: vi.fn(async () => [makeAnnotationView()]),
    listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
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
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      totalMarkers: 0,
      offset: 0,
      limit: 100,
      markers: [],
    })),
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('msg-1'),
      runId: brand<string, 'RequestRunId'>('R1'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      targetRequestId: brand<string, 'MessageId'>('msg-1'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('msg-1'),
      runId: brand<string, 'RequestRunId'>('R2'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      pendingInputId: brand<string, 'PendingInputId'>('pi-1'),
      status: 'RECEIVED' as const,
    })),
  };
  return {
    runtime,
    sessions,
    annotations,
    identityResolver: () => IDENTITY,
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: AGENT_ID,
  };
}

describe('annotation routes', () => {
  describe('POST /api/v1/sessions/:sessionId/runs/:runId/annotations', () => {
    it('upserts sentiment and returns 200', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: { sentiment: 'UP' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sentiment).toBe('UP');
      expect(body.annotationId).toBe('ann-1');
      await app.close();
    });

    it('returns empty state when annotation is deleted', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: vi.fn(async () => undefined),
          listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: { sentiment: null, isFavorited: false },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sentiment).toBeNull();
      expect(body.isFavorited).toBe(false);
      expect(body.isQuestionFavorited).toBe(false);
      await app.close();
    });

    it('returns 400 when no annotation field is provided', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toEqual({
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'At least one of sentiment, isFavorited, or isQuestionFavorited must be provided.',
      });
      await app.close();
    });

    it('ignores client-supplied scope fields', async () => {
      const app = Fastify();
      const upsertSpy = vi.fn(async () => makeAnnotationView());
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: upsertSpy,
          listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);
      await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: { sentiment: 'UP', tenantId: 'evil-tenant', subjectId: 'evil-user', agentId: 'evil-agent' },
      });
      expect(upsertSpy).toHaveBeenCalledOnce();
      const captured = upsertSpy.mock.calls.at(0) as unknown as
        [{ identityContext: { tenantId: string; subjectId: string }; agentId: string }] | undefined;
      expect(captured).toBeDefined();
      const call = captured![0];
      expect(call.identityContext.tenantId).toBe(brand<string, 'TenantId'>('T1'));
      expect(call.identityContext.subjectId).toBe(brand<string, 'SubjectId'>('U1'));
      expect(call.agentId).toBe(AGENT_ID);
      await app.close();
    });

    it('ignores a client-supplied comment field (no longer part of the upsert API)', async () => {
      // comment was removed from upsertAnnotationBody. Like other unrecognized
      // body fields, it is stripped at the schema boundary (additionalProperties)
      // and never reaches the service or the response.
      const app = Fastify();
      const upsertSpy = vi.fn(async () => makeAnnotationView());
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: upsertSpy,
          listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: { sentiment: 'UP', comment: 'please store me' },
      });
      expect(response.statusCode).toBe(200);
      const captured = upsertSpy.mock.calls.at(0) as unknown as [{ comment?: unknown }] | undefined;
      expect(captured).toBeDefined();
      expect(captured![0]?.comment).toBeUndefined();
      expect(JSON.parse(response.body)).not.toHaveProperty('comment');
      await app.close();
    });

    it('returns 400 with FAVORITE_LIMIT_EXCEEDED when favorite limit is reached', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: vi.fn(async () => {
            throw new AgentError({
              code: 'FAVORITE_LIMIT_EXCEEDED',
              message: 'Favorite limit reached for this agent scope.',
              category: 'VALIDATION',
              retryable: false,
            });
          }),
          listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: { isFavorited: true },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FAVORITE_LIMIT_EXCEEDED');
      await app.close();
    });

    it('returns 404 when the run does not exist for the session', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: vi.fn(async () => {
            throw new AgentError({
              code: 'ANNOTATION_RUN_NOT_FOUND',
              message: 'The request run does not exist for this session.',
              category: 'NOT_FOUND',
              retryable: false,
            });
          }),
          listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/runs/R1/annotations',
        payload: { sentiment: 'UP' },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('ANNOTATION_RUN_NOT_FOUND');
      await app.close();
    });
  });

  describe('GET /api/v1/favorites', () => {
    it('returns favorited sessions', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: vi.fn(),
          listFavoriteTurns: vi.fn(async (): Promise<ConversationFavoriteTurnPage> => ({
            entries: [
              {
                sessionId: brand<string, 'SessionId'>('S1'),
                requestRunId: brand<string, 'RequestRunId'>('R1'),
                rootMessageId: brand<string, 'MessageId'>('M1'),
                questionPreview: 'test question',
                questionTruncated: false,
                sessionTitle: 'My Session',
                sessionUpdatedAt: brand<number, 'EpochMillis'>(2000),
                favoritedAt: brand<number, 'EpochMillis'>(2000),
              },
            ],
            offset: 0,
            limit: 10,
            hasMore: false,
          })),
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=0&limit=10' });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].sessionId).toBe('S1');
      expect(body.entries[0].questionPreview).toBe('test question');
      expect(deps.annotations?.listFavoriteTurns).toHaveBeenCalledWith({
        identityContext: IDENTITY,
        agentId: AGENT_ID,
        offset: 0,
        limit: 10,
      });
      await app.close();
    });

    it('returns question favorites when favoriteType is QUESTION', async () => {
      const listFavoriteTurns = vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false }));
      const listQuestionFavoriteTurns = vi.fn(async (): Promise<ConversationFavoriteTurnPage> => ({
        entries: [
          {
            sessionId: brand<string, 'SessionId'>('S-question'),
            requestRunId: brand<string, 'RequestRunId'>('R-question'),
            rootMessageId: brand<string, 'MessageId'>('M-question'),
            questionPreview: 'favorite question',
            questionTruncated: false,
            sessionTitle: 'Question favorites',
            sessionUpdatedAt: brand<number, 'EpochMillis'>(2000),
            favoritedAt: brand<number, 'EpochMillis'>(2000),
          },
        ],
        offset: 0,
        limit: 10,
        hasMore: false,
      }));
      const app = Fastify();
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: vi.fn(),
          listFavoriteTurns,
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns,
        },
      });
      await registerWebChannel(app, deps);

      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=0&limit=10&favoriteType=QUESTION' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).entries[0].sessionId).toBe('S-question');
      expect(listQuestionFavoriteTurns).toHaveBeenCalledWith({
        identityContext: IDENTITY,
        agentId: AGENT_ID,
        offset: 0,
        limit: 10,
      });
      expect(listFavoriteTurns).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 400 when limit exceeds 100', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?limit=200' });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toBe('limit must not exceed 100.');
      await app.close();
    });

    it('returns 400 with a field-level message when limit is fractional', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=0&limit=1.5' });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toBe('limit must be a positive integer.');
      await app.close();
    });

    it('returns 400 with a field-level message when offset is negative', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=-1&limit=20' });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toBe('offset must be a non-negative integer.');
      await app.close();
    });

    it('returns 400 with a field-level message when offset is fractional', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=1.5&limit=20' });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toBe('offset must be an integer.');
      await app.close();
    });

    it('returns 400 when offset exceeds 10000 instead of leaking to the backing service', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      // 9999999 (7 digits) previously passed the schema and leaked into the memory service, which
      // returned an opaque WM_HTTP_ERROR. The length guard now rejects it up front.
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=9999999&limit=20' });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toBe('offset must not exceed 10000.');
      expect(deps.annotations?.listFavoriteTurns).not.toHaveBeenCalled();
      await app.close();
    });

    it('accepts offset at the 10000 boundary', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?offset=10000&limit=20' });
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('rejects unsupported favoriteType values before querying runtime', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites?favoriteType=UNKNOWN' });

      expect(response.statusCode).toBe(400);
      expect(deps.annotations?.listFavoriteTurns).not.toHaveBeenCalled();
      expect(deps.annotations?.listQuestionFavoriteTurns).not.toHaveBeenCalled();
      await app.close();
    });

    it('filters favorites before applying offset and limit', async () => {
      const listFavoriteTurns = vi.fn(async (): Promise<ConversationFavoriteTurnPage> => ({
        entries: [
          {
            sessionId: brand<string, 'SessionId'>('S1'),
            requestRunId: brand<string, 'RequestRunId'>('R1'),
            rootMessageId: brand<string, 'MessageId'>('M1'),
            questionPreview: 'unrelated question',
            questionTruncated: false,
            sessionTitle: 'Network health',
            sessionUpdatedAt: brand<number, 'EpochMillis'>(2000),
            favoritedAt: brand<number, 'EpochMillis'>(2000),
          },
          {
            sessionId: brand<string, 'SessionId'>('S2'),
            requestRunId: brand<string, 'RequestRunId'>('R2'),
            rootMessageId: brand<string, 'MessageId'>('M2'),
            questionPreview: 'NETWORK quality analysis',
            questionTruncated: false,
            sessionTitle: 'Quality review',
            sessionUpdatedAt: brand<number, 'EpochMillis'>(3000),
            favoritedAt: brand<number, 'EpochMillis'>(3000),
          },
          {
            sessionId: brand<string, 'SessionId'>('S3'),
            requestRunId: brand<string, 'RequestRunId'>('R3'),
            rootMessageId: brand<string, 'MessageId'>('M3'),
            questionPreview: 'network outside range',
            questionTruncated: false,
            sessionTitle: 'Historical network',
            sessionUpdatedAt: brand<number, 'EpochMillis'>(4000),
            favoritedAt: brand<number, 'EpochMillis'>(4000),
          },
        ],
        offset: 0,
        limit: 100,
        hasMore: false,
      }));
      const app = Fastify();
      const deps = makeDependencies({
        annotations: {
          upsertAnnotation: vi.fn(),
          listFavoriteTurns,
          listSessionAnnotations: vi.fn(async () => []),
          listQuestionFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
        },
      });
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/favorites?offset=1&limit=1&keyword=network&favoritedFrom=1500&favoritedTo=3500',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        entries: [{ sessionId: 'S2' }],
        offset: 1,
        limit: 1,
        hasMore: false,
      });
      expect(listFavoriteTurns).toHaveBeenCalledWith({
        identityContext: IDENTITY,
        agentId: AGENT_ID,
        offset: 0,
        limit: 100,
      });
      await app.close();
    });

    it('rejects an inverted favorite time range before querying runtime', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/favorites?favoritedFrom=3000&favoritedTo=2000',
      });

      expect(response.statusCode).toBe(400);
      expect(deps.annotations?.listFavoriteTurns).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects favorite keywords longer than 50 characters', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/favorites?keyword=${'a'.repeat(51)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(deps.annotations?.listFavoriteTurns).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('GET /api/v1/sessions/:sessionId/annotations', () => {
    it('returns session annotations', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/annotations' });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.annotations).toHaveLength(1);
      expect(body.annotations[0].annotationId).toBe('ann-1');
      await app.close();
    });
  });

  describe('503 when annotations unavailable', () => {
    it('POST annotations returns 503', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      delete (deps as { annotations?: unknown }).annotations;
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'POST', url: '/api/v1/sessions/S1/runs/R1/annotations', payload: { sentiment: 'UP' } });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).error).toEqual({
        code: 'ANNOTATIONS_UNAVAILABLE',
        message: 'Annotations service is unavailable.',
      });
      await app.close();
    });

    it('GET favorites returns 503', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      delete (deps as { annotations?: unknown }).annotations;
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites' });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).error).toEqual({
        code: 'ANNOTATIONS_UNAVAILABLE',
        message: 'Annotations service is unavailable.',
      });
      await app.close();
    });

    it('GET session annotations returns 503', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      delete (deps as { annotations?: unknown }).annotations;
      await registerWebChannel(app, deps);
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/annotations' });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).error).toEqual({
        code: 'ANNOTATIONS_UNAVAILABLE',
        message: 'Annotations service is unavailable.',
      });
      await app.close();
    });
  });
});
