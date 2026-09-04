import { brand, type AgentId, type EpochMillis, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type {
  FrequentQuestionPort,
  RuntimeCommandPort,
  RuntimeSessionPort,
  SkillCatalogQueryPort,
  QuestionAssociationResult,
} from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');

function makeDependencies(
  overrides: {
    frequentQuestions?: FrequentQuestionPort;
  } = {},
) {
  const frequentQuestions: FrequentQuestionPort = overrides.frequentQuestions ?? {
    listFrequentQuestions: vi.fn(async (request: { locale?: string }) => ({
      locale: request.locale ?? 'zh',
      questions: [{ text: 'question 1' }, { text: 'question 2' }],
    })),
    listQuestionAssociations: vi.fn(async () => ({ locale: 'zh', questions: [] })),
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
    listMessages: vi.fn(async () => ({ items: [], limit: 10, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({ sessionId: brand<string, 'SessionId'>('S1'), totalMarkers: 0, offset: 0, limit: 10, markers: [] })),
    updateTitle: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: AGENT_ID,
      sessionId: brand<string, 'SessionId'>('S1'),
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
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
      requestId: brand<string, 'MessageId'>('M1'),
      runId: brand<string, 'RequestRunId'>('R1'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      targetRequestId: brand<string, 'MessageId'>('M1'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('K1'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('M1'),
      runId: brand<string, 'RequestRunId'>('R1'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('M1'),
      runId: brand<string, 'RequestRunId'>('R1'),
      attempt: 1,
    })),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      pendingInputId: brand<string, 'PendingInputId'>('P1'),
      status: 'RECEIVED' as const,
    })),
  };
  return {
    runtime,
    sessions,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'test' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: {
      listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 10, skills: [] })),
    } as unknown as SkillCatalogQueryPort,
    frequentQuestions,
    defaultAgentId: AGENT_ID,
    annotations: {
      upsertAnnotation: vi.fn(async () => ({
        annotationId: brand<string, 'AnnotationId'>('A1'),
        sessionId: brand<string, 'SessionId'>('S1'),
        requestRunId: brand<string, 'RequestRunId'>('R1'),
        sentiment: null,
        isFavorited: false,
        isQuestionFavorited: true,
        comment: null,
        createdAt: brand<number, 'EpochMillis'>(0),
      })),
      listFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
      listQuestionFavoriteTurns: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
      listSessionAnnotations: vi.fn(async () => []),
    },
  };
}

describe('Frequent question API routes', () => {
  it('GET /api/v1/frequent-questions returns questions without internal fields', async () => {
    const app = Fastify();
    const deps = makeDependencies();
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/frequent-questions?locale=zh-CN' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.locale).toBe('zh-CN');
    expect(body.questions).toHaveLength(2);
    for (const q of body.questions) {
      expect(q).toHaveProperty('text');
      expect(q).not.toHaveProperty('hash');
      expect(q).not.toHaveProperty('frequency');
      expect(q).not.toHaveProperty('isPinned');
      expect(q).not.toHaveProperty('is_pinned');
      expect(q).not.toHaveProperty('pinnedAt');
      expect(q).not.toHaveProperty('pinned_at');
    }
    await app.close();
  });

  it('GET /api/v1/frequent-questions returns empty list when no data', async () => {
    const app = Fastify();
    const deps = makeDependencies({
      frequentQuestions: {
        listFrequentQuestions: vi.fn(async () => ({ locale: 'zh', questions: [] })),
        listQuestionAssociations: vi.fn(async () => ({ locale: 'zh', questions: [] })),
      },
    });
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/frequent-questions' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.questions).toHaveLength(0);
    await app.close();
  });

  it('POST /api/v1/user-questions/pin returns 404 (pin endpoint removed)', async () => {
    const app = Fastify();
    const deps = makeDependencies();
    await registerWebChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/user-questions/pin',
      payload: { sessionId: 'sess_1', runId: 'run_1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('GET /api/v1/question-association returns associations with source labels', async () => {
    const app = Fastify();
    const deps = makeDependencies({
      frequentQuestions: {
        listFrequentQuestions: vi.fn(async () => ({ locale: 'zh', questions: [] })),
        listQuestionAssociations: vi.fn(
          async () =>
            ({
              locale: 'zh-CN',
              questions: [
                { text: 'pinned question', source: 'pinned' },
                { text: 'freq question', source: 'high-frequency' },
                { text: 'static question', source: 'static' },
              ],
            }) as QuestionAssociationResult,
        ),
      },
    });
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=test&locale=zh-CN' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.questions).toHaveLength(3);
    expect(body.questions[0]).toHaveProperty('source');
    expect(body.questions[0].source).toBe('pinned');
    await app.close();
  });

  it('GET /api/v1/question-association serializes recommended source (REMOTE mode)', async () => {
    const app = Fastify();
    const deps = makeDependencies({
      frequentQuestions: {
        listFrequentQuestions: vi.fn(async () => ({ locale: 'zh', questions: [] })),
        listQuestionAssociations: vi.fn(
          async () =>
            ({
              locale: 'zh-CN',
              questions: [
                { text: 'recommended question', source: 'recommended' },
                { text: 'static question', source: 'static' },
              ],
            }) as QuestionAssociationResult,
        ),
      },
    });
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=test&locale=zh-CN' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0].source).toBe('recommended');
    expect(body.questions[1].source).toBe('static');
    await app.close();
  });

  it('GET /api/v1/question-association returns 400 when keyword is empty', async () => {
    const app = Fastify();
    const deps = makeDependencies();
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=' });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/v1/question-association returns 400 when keyword is whitespace', async () => {
    const app = Fastify();
    const deps = makeDependencies();
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=%20%20' });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/v1/question-association returns empty list when no matches', async () => {
    const app = Fastify();
    const deps = makeDependencies({
      frequentQuestions: {
        listFrequentQuestions: vi.fn(async () => ({ locale: 'zh', questions: [] })),
        listQuestionAssociations: vi.fn(async () => ({ locale: 'zh-CN', questions: [] }) as QuestionAssociationResult),
      },
    });
    await registerWebChannel(app, deps);
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=nomatch' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.questions).toHaveLength(0);
    await app.close();
  });
});
