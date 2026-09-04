import { AgentError, brand, type AgentId, type IdentityContext } from '@nextagent/agent-common';
import type { LongTermMemoryManagementPort } from '@nextagent/agent-contracts/channel';
import type {
  RuntimeCommandPort,
  RuntimeConversationAnnotationPort,
  RuntimeSessionPort,
  SkillCatalogQueryPort,
} from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import { createLocalConfiguredWebAuth } from '@nextagent/agent-channel-web-auth-local';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('val-boundary-agent');
const OVER_256 = 'x'.repeat(257);
const OVER_3 = '1'.repeat(4);
const OVER_7 = '1'.repeat(8);
const OVER_8 = '1'.repeat(9);
const OVER_512 = 'q'.repeat(513);
const OVER_4096 = 'c'.repeat(4097);
const OVER_32 = 'r'.repeat(33);
const OVER_64 = 'm'.repeat(65);
const OVER_255 = 'f'.repeat(256);

function makeSessions(): RuntimeSessionPort {
  return {
    createSession: vi.fn(async () => session()),
    requireSession: vi.fn(async () => session()),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: session() })),
    forkFromRequest: vi.fn(async () => ({ childSession: session() })),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      totalMarkers: 0,
      offset: 0,
      limit: 100,
      markers: [],
    })),
    updateTitle: vi.fn(async () => session()),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
}

function makeAnnotations(): RuntimeConversationAnnotationPort {
  return {
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
}

function makeRuntime(): RuntimeCommandPort {
  return {
    submit: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('r1'),
      runId: brand<string, 'RequestRunId'>('run1'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      targetRequestId: brand<string, 'MessageId'>('r1'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('ik'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('r2'),
      runId: brand<string, 'RequestRunId'>('run2'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('r3'),
      runId: brand<string, 'RequestRunId'>('run3'),
      attempt: 1,
    })),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      pendingInputId: brand<string, 'PendingInputId'>('pi1'),
      status: 'RECEIVED' as const,
    })),
  };
}

function makeMemory(): LongTermMemoryManagementPort {
  const unexpectedCall = () =>
    vi.fn(async (): Promise<never> => {
      throw new Error('memory port must not be called for invalid input');
    });
  return {
    saveLongTermMemory: unexpectedCall(),
    listLongTermMemory: unexpectedCall(),
    batchCreateLongTermMemory: unexpectedCall(),
    manualSaveLongTermMemory: unexpectedCall(),
    getLongTermMemory: unexpectedCall(),
    deleteLongTermMemory: unexpectedCall(),
    mutateLongTermMemory: unexpectedCall(),
    searchLongTermMemory: unexpectedCall(),
    getLongTermMemoryDetail: unexpectedCall(),
    publishLongTermMemory: unexpectedCall(),
    unpublishLongTermMemory: unexpectedCall(),
    listPublishedLongTermMemory: unexpectedCall(),
    copyPublishedMemory: unexpectedCall(),
  };
}

function makeBaseDeps() {
  return {
    runtime: makeRuntime(),
    sessions: makeSessions(),
    annotations: makeAnnotations(),
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'test' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: AGENT_ID,
  };
}

function session(sid = brand<string, 'SessionId'>('S1')) {
  return {
    tenantId: brand<string, 'TenantId'>('T1'),
    subjectId: brand<string, 'SubjectId'>('U1'),
    agentId: AGENT_ID,
    sessionId: sid,
    title: 'Test',
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
    hasInFlightRequest: false,
  };
}

async function makeApp(extra?: Record<string, unknown>) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await registerWebChannel(app, { ...makeBaseDeps(), ...extra });
  const auth = createLocalConfiguredWebAuth({
    loopbackOnly: true,
    identity: { tenantId: brand('T1'), subjectId: brand('U1'), displayName: 'Dev' },
    credentialRef: brand('env:P'),
    cookieTtlMs: 60_000,
    credentialResolver: async () => 'secret',
  });
  await app.register(auth.plugin);
  return app;
}

// -- Stream --

describe('validation boundary: stream', () => {
  it('rejects lastSeenSequence that is non-numeric', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/stream?lastSeenSequence=abc' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects lastSeenSequence exceeding 16 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/stream?lastSeenSequence=${OVER_7}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects requestId exceeding 256 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/stream?requestId=${OVER_256}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects runId exceeding 256 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/stream?runId=${OVER_256}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Skill --

describe('validation boundary: skill', () => {
  it('rejects pageNum that is non-numeric', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/skills?pageNum=abc' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects pageNum exceeding 3 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/skills?pageNum=${OVER_3}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects pageSize that is non-numeric', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/skills?pageSize=abc' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects pageSize exceeding 3 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/skills?pageSize=${OVER_3}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects keyword exceeding 512 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/skills?keyword=${OVER_512}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Question locale --

describe('validation boundary: question locale', () => {
  it('rejects invalid locale on category-questions', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/category-questions?locale=1' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects invalid locale on frequent-questions', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/frequent-questions?locale=1' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects invalid locale on question-association', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=test&locale=1' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Conversation --

describe('validation boundary: conversation', () => {
  it('rejects includeCapabilityResults exceeding 32 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/conversation?includeCapabilityResults=${OVER_32}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects cursor exceeding 64 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/conversation?cursor=${OVER_64}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('cursor must not exceed 64 characters.');
    await app.close();
  });

  it('rejects newerCursor exceeding 64 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/conversation?newerCursor=${OVER_64}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('newerCursor must not exceed 64 characters.');
    await app.close();
  });

  it('rejects anchorMessageId exceeding 64 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/conversation?anchorMessageId=${OVER_64}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('anchorMessageId must not exceed 64 characters.');
    await app.close();
  });

  it('rejects non-numeric limit on conversation', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/conversation?limit=abc' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects zero limit on conversation with positive-integer message', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/conversation?limit=0' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('limit must be a positive integer.');
    await app.close();
  });

  it('rejects negative limit on conversation with positive-integer message', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/conversation?limit=-5' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('limit must be a positive integer.');
    await app.close();
  });

  it('accepts zero-leading limit on conversation preview as a positive integer', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/conversation/preview?limit=01' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// -- Auth --

describe('validation boundary: auth', () => {
  it('rejects credential exceeding 4096 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/local/login', payload: { credential: OVER_4096 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects empty credential', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/local/login', payload: { credential: '' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Session --

describe('validation boundary: session', () => {
  it('rejects q exceeding 512 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions?q=${OVER_512}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects invalid locale on createSession', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: { locale: '1' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects empty-string locale without leaking Ajv keyword', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: { locale: '' } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('locale value is not allowed.');
    expect(body.error.message).not.toContain('const');
    expect(body.error.message).not.toContain('anyOf');
    await app.close();
  });

  it('accepts over-length numeric createdFrom as a valid integer when paired with createdTo', async () => {
    const app = await makeApp();
    // Use a 14-digit timestamp within the valid range (current day) to verify that
    // over-length numeric strings are still accepted as valid integers.
    const now = Date.now();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions?createdFrom=${now}&createdTo=${now}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// -- RequestCommand locale & attachments --

describe('validation boundary: request locale & attachments', () => {
  it('rejects invalid locale on submitRequest', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'hi', idempotencyKey: 'ik1', locale: '1' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects invalid locale on convenienceSubmit', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'hi', idempotencyKey: 'ik2', locale: '1' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('cleans up session when convenience submit fails before run acceptance', async () => {
    const sessions = makeSessions();
    const runtime = makeRuntime();
    runtime.submit = vi.fn(async () => {
      throw new AgentError({
        code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY',
        message: 'Capability directive stripped the effective user question to empty.',
        category: 'VALIDATION',
        retryable: false,
      });
    });
    const app = await makeApp({ runtime, sessions });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '$workflow:recipe_name', idempotencyKey: 'ik-cleanup' },
    });
    expect(res.statusCode).toBe(400);
    expect(sessions.deleteSession).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects invalid locale on editLatestRequest', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/latest/edit',
      payload: { editedInputText: 'hi', expectedLatestRequestId: 'r1', idempotencyKey: 'ik3', locale: '1' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects attachments exceeding maxItems on submitRequest', async () => {
    const app = await makeApp();
    const many = Array.from({ length: 11 }, (_, i) => ({ tempRunId: `t${i}`, fileName: `f${i}` }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'hi', idempotencyKey: 'ik4', attachments: many },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- BackgroundTask --

describe('validation boundary: background task', () => {
  it('rejects non-numeric limitBytes', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks/T1/output?limitBytes=abc' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects limitBytes exceeding 16 chars', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/S1/background-tasks/T1/output?limitBytes=${OVER_8}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Attachment --

describe('validation boundary: attachment', () => {
  it('rejects fileName exceeding 255 chars on deleteTempFile', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/sessions/S1/files/tmp/TR1?fileName=${OVER_255}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects empty fileName on deleteTempFile', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/sessions/S1/files/tmp/TR1?fileName=' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Memory --

describe('validation boundary: memory', () => {
  it('rejects confidence above 1 on saveLongTermMemory', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/long-term-mem',
      payload: { confidence: 2.0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects negative delta on mutateMemory', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/memory/long-term-mem/m1',
      payload: { delta: -1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects expectedVersion below 1 on mutateMemory', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/memory/long-term-mem/m1',
      payload: { expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects limit exceeding 10000 on searchLongTermMemory', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/long-term-mem/search',
      payload: { limit: 10001 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects memoryInstance exceeding 256 chars on listLongTermMemory', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const res = await app.inject({ method: 'GET', url: `/api/v1/memory/long-term-mem?memoryInstance=${OVER_256}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects sinceTime as negative number body on searchLongTermMemory', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/long-term-mem/search',
      payload: { sinceTime: -1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects labels array exceeding maxItems on manualSave', async () => {
    const app = await makeApp({ longTermMemoryManagement: makeMemory() });
    const manyLabels = Array.from({ length: 11 }, (_, i) => `label${i}`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/long-term-mem/manual',
      payload: {
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'LEARNED',
        briefIndex: 'bi',
        content: 'c',
        labels: manyLabels,
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// -- Not-found contract --

describe('validation boundary: not-found contract', () => {
  it('returns the standard { error: { code, message } } 404 for an unauthenticated non-/api/ route', async () => {
    const app = await makeApp();
    // /api/ paths are protected (require auth) so an unmatched /api/ route
    // returns 401 when unauthenticated. A non-/api/ unmatched route returns
    // the standard contract 404 directly via the auth-local not-found handler.
    const res = await app.inject({ method: 'GET', url: '/nonexistent-public-route' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string; message: string } }>().error.code).toBe('NOT_FOUND');
    expect(res.json<{ error: { message: string } }>().error.message).toBe('Route not found.');
    await app.close();
  });
});

// -- Body parse errors (empty / malformed / wrong media type / NUL byte) --

describe('validation boundary: body parse errors return 400/415 not 500', () => {
  it('returns 400 for an empty body with Content-Type application/json', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Request body cannot be empty when Content-Type is application/json.');
    await app.close();
  });

  it('returns 400 for malformed JSON', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'content-type': 'application/json' },
      payload: '{"title":',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Request body is not valid JSON.');
    await app.close();
  });

  it('returns 400 for a non-JSON body with Content-Type application/json', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'content-type': 'application/json' },
      payload: 'not json',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Request body is not valid JSON.');
    await app.close();
  });

  it('returns 415 when Content-Type is missing', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      // No content-type header; Fastify cannot determine the body parser.
      payload: '{}',
    });
    expect(res.statusCode).toBe(415);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Unsupported Media Type. Use application/json.');
    await app.close();
  });

  it('returns 400 for a JSON string value containing a raw NUL byte', async () => {
    const app = await makeApp();
    // RFC 8259 forbids raw control characters in JSON strings; Fastify's parser
    // rejects a body like {"title":"test\0title"} as invalid JSON. Inject the
    // real byte via Buffer (a TS "\0" literal would be interpreted at compile).
    const payload = Buffer.from('{"title":"test' + String.fromCharCode(0) + 'title"}', 'utf8');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/sessions/S1/title',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Request body is not valid JSON.');
    await app.close();
  });
});
