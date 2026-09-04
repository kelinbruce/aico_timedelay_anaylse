import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('session list search route', () => {
  it('forwards validated search filters and defaults search pages to 20', async () => {
    let captured: Parameters<RuntimeSessionPort['listSessions']>[0] | undefined;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listSessions: async (query) => {
          captured = query;
          return { entries: [], offset: query.offset, limit: query.limit, hasMore: false };
        },
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?q=%20CPU%20&createdFrom=1000&createdTo=2000&offset=2',
    });

    expect(response.statusCode).toBe(200);
    expect(captured).toMatchObject({
      questionSearchText: 'CPU',
      createdAtFrom: 1000,
      createdAtTo: 2000,
      offset: 2,
      limit: 20,
    });
    await app.close();
  });

  it('keeps the existing non-search default page size', async () => {
    let captured: Parameters<RuntimeSessionPort['listSessions']>[0] | undefined;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listSessions: async (query) => {
          captured = query;
          return { entries: [], offset: query.offset, limit: query.limit, hasMore: false };
        },
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions' });

    expect(response.statusCode).toBe(200);
    expect(captured).toMatchObject({ offset: 0, limit: 50 });
    expect(captured).not.toHaveProperty('questionSearchText');
    await app.close();
  });

  it('forwards single-character and two-character keywords', async () => {
    const capturedQueries: Array<Parameters<RuntimeSessionPort['listSessions']>[0]> = [];
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listSessions: async (query) => {
          capturedQueries.push(query);
          return { entries: [], offset: query.offset, limit: query.limit, hasMore: false };
        },
      }),
    );

    for (const url of ['/api/v1/sessions?q=a', '/api/v1/sessions?q=ab', '/api/v1/sessions?q=%E5%91%8A']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
    }
    expect(capturedQueries.map((query) => query.questionSearchText)).toEqual(['a', 'ab', '告']);
    await app.close();
  });

  it('accepts 200 code point session keywords and rejects 201 before runtime', async () => {
    const capturedQueries: Array<Parameters<RuntimeSessionPort['listSessions']>[0]> = [];
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listSessions: async (query) => {
          capturedQueries.push(query);
          return { entries: [], offset: query.offset, limit: query.limit, hasMore: false };
        },
      }),
    );

    const legalKeyword = 'a'.repeat(200);
    const legalResponse = await app.inject({ method: 'GET', url: `/api/v1/sessions?q=${legalKeyword}` });
    expect(legalResponse.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]).toMatchObject({ questionSearchText: legalKeyword });

    const illegalResponse = await app.inject({ method: 'GET', url: `/api/v1/sessions?q=${'a'.repeat(201)}` });
    expect(illegalResponse.statusCode).toBe(400);
    expect(illegalResponse.json<{ error: { code: string } }>().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(capturedQueries).toHaveLength(1);
    await app.close();
  });

  it('rejects invalid search filters before calling the runtime session facade', async () => {
    const listSessions = vi.fn(async (query: Parameters<RuntimeSessionPort['listSessions']>[0]) => ({
      entries: [],
      offset: query.offset,
      limit: query.limit,
      hasMore: false,
    }));
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ listSessions }));

    for (const url of [
      `/api/v1/sessions?q=${'a'.repeat(201)}`,
      '/api/v1/sessions?createdFrom=1',
      '/api/v1/sessions?createdFrom=2&createdTo=1',
      '/api/v1/sessions?createdFrom=0&createdTo=7776000000',
      '/api/v1/sessions?q=%E5%91%8A%E8%AD%A6&limit=51',
      '/api/v1/sessions?offset=-1',
      '/api/v1/sessions?createdFrom=-1&createdTo=1000',
      '/api/v1/sessions?createdFrom=1000&createdTo=-1',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('REQUEST_VALIDATION_FAILED');
    }
    expect(listSessions).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns doc-aligned field-level messages for invalid created/offset/limit params', async () => {
    const listSessions = vi.fn(async (query: Parameters<RuntimeSessionPort['listSessions']>[0]) => ({
      entries: [],
      offset: query.offset,
      limit: query.limit,
      hasMore: false,
    }));
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ listSessions }));

    // Each case mirrors a row in docs/apis/agent-web-api-list.md GET /api/v1/sessions error table.
    const cases: ReadonlyArray<{ readonly url: string; readonly message: string }> = [
      { url: '/api/v1/sessions?createdFrom=2&createdTo=1', message: 'createdFrom must be less than or equal to createdTo.' },
      { url: '/api/v1/sessions?createdFrom=0&createdTo=7776000000', message: 'created time range must not exceed 90 days.' },
      { url: '/api/v1/sessions?createdFrom=1000&createdTo=abc', message: 'createdTo must be an integer.' },
      { url: '/api/v1/sessions?createdFrom=abc&createdTo=2000', message: 'createdFrom must be an integer.' },
      { url: '/api/v1/sessions?createdFrom=-1&createdTo=1000', message: 'createdFrom must be a non-negative epoch millisecond.' },
      { url: '/api/v1/sessions?createdFrom=1000&createdTo=-1', message: 'createdTo must be a non-negative epoch millisecond.' },
      { url: '/api/v1/sessions?offset=-1', message: 'offset must be a non-negative integer.' },
      { url: '/api/v1/sessions?offset=abc', message: 'offset must be an integer.' },
      { url: '/api/v1/sessions?limit=0', message: 'limit must be a positive integer.' },
      { url: '/api/v1/sessions?q=abc&limit=51', message: 'search limit must not exceed 50.' },
      // Issue 1: empty-string createdTo should be treated as not-provided.
      { url: '/api/v1/sessions?createdFrom=1000&createdTo=', message: 'createdFrom and createdTo must be provided together.' },
      // Issue 3: non-numeric limit should say "positive integer" not "an integer".
      { url: '/api/v1/sessions?limit=abc', message: 'limit must be a positive integer.' },
      { url: '/api/v1/sessions?limit=-5', message: 'limit must be a positive integer.' },
    ];
    for (const { url, message } of cases) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string; message: string } }>().error).toEqual({
        code: 'REQUEST_VALIDATION_FAILED',
        message,
      });
    }
    expect(listSessions).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects createdTo beyond end of today without reaching the memory service', async () => {
    const listSessions = vi.fn(async (query: Parameters<RuntimeSessionPort['listSessions']>[0]) => ({
      entries: [],
      offset: query.offset,
      limit: query.limit,
      hasMore: false,
    }));
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ listSessions }));
    // Use today's start as createdFrom and tomorrow as createdTo: within the 90-day range
    // but createdTo is beyond the end of today.
    const now = Date.now();
    const startOfToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    const tomorrow = now + 86_400_000;
    const response = await app.inject({ method: 'GET', url: `/api/v1/sessions?createdFrom=${startOfToday}&createdTo=${tomorrow}` });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string; message: string } }>().error.message).toBe('createdTo must not be later than the end of today.');
    expect(listSessions).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps an unknown Web transport-root failure to safe 500 with one diagnostic', async () => {
    const errors: object[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error(fields) {
          errors.push(fields);
        },
      }),
    });
    const failure = new TypeError('private Web provider body');
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listSessions: async () => {
          throw failure;
        },
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Request failed safely.' } });
    expect(errors).toEqual([
      expect.objectContaining({
        err: failure,
        event: 'server.framework.failed',
        failureStage: 'FASTIFY_INTERNAL',
        serverRequestId: expect.any(String),
      }),
    ]);
    await app.close();
  });
});

function makeDependencies(overrides: { readonly listSessions?: RuntimeSessionPort['listSessions'] } = {}) {
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async (command) => ({
      sessionId: command.sessionId,
      requestId: brand<string, 'MessageId'>('request-session-list-search'),
      runId: brand<string, 'RequestRunId'>('run-session-list-search'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-list-search'),
      targetRequestId: brand<string, 'MessageId'>('request-session-list-search'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-session-list-search-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-list-search'),
      requestId: brand<string, 'MessageId'>('request-session-list-search'),
      runId: brand<string, 'RequestRunId'>('run-session-list-search'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-list-search'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-session-list-search'),
      status: 'RECEIVED' as const,
    })),
  };
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('tenant-session-list-search'),
      subjectId: brand<string, 'SubjectId'>('subject-session-list-search'),
      agentId: brand<string, 'AgentId'>('agent-session-list-search'),
      sessionId: brand<string, 'SessionId'>('session-list-search'),
      title: 'Session List Search',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async ({ sessionId }) => ({
      tenantId: brand<string, 'TenantId'>('tenant-session-list-search'),
      subjectId: brand<string, 'SubjectId'>('subject-session-list-search'),
      agentId: brand<string, 'AgentId'>('agent-session-list-search'),
      sessionId,
      title: 'Session List Search',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    listSessions: overrides.listSessions ?? vi.fn(async (query) => ({ entries: [], offset: query.offset, limit: query.limit, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };

  return {
    runtime,
    sessions,
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('tenant-session-list-search'),
      subjectId: brand<string, 'SubjectId'>('subject-session-list-search'),
      displayName: 'Session List Search',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-session-list-search'),
  };
}
