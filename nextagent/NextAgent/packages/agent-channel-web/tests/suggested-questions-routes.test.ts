import { AgentError, brand } from '@nextagent/agent-common';
import type {
  RuntimeCommandPort,
  RuntimeSessionPort,
  SuggestedQuestionPort,
  SuggestedQuestionRequest,
  SuggestedQuestionResult,
  SkillCatalogQueryPort,
} from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import type { SessionMessagePage } from '@nextagent/agent-contracts/session';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const SESSION_ID = brand<string, 'SessionId'>('S1');
const REQUEST_ID = brand<string, 'MessageId'>('msg-1');
const RUN_ID = brand<string, 'RequestRunId'>('R1');

function makeDependencies(
  overrides: {
    suggestedQuestions?: SuggestedQuestionPort;
    sessionAgentId?: typeof AGENT_ID;
    sessionSubjectId?: string;
    requireSessionThrows?: Error;
    messagesWithRunId?: boolean;
    messageRunIds?: readonly string[];
  } = {},
) {
  const sessionAgentId = overrides.sessionAgentId ?? AGENT_ID;
  const sessionSubjectId = overrides.sessionSubjectId ?? 'U1';
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      agentId: sessionAgentId,
      sessionId: SESSION_ID,
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>(sessionSubjectId),
      agentId: sessionAgentId,
      sessionId: SESSION_ID,
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    ...(overrides.requireSessionThrows !== undefined
      ? {
          requireSession: vi.fn(async () => Promise.reject(overrides.requireSessionThrows)),
        }
      : {}),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: vi.fn(async (): Promise<SessionMessagePage> => ({
      items:
        overrides.messagesWithRunId === false
          ? []
          : (overrides.messageRunIds ?? [RUN_ID]).map((runId, index) => ({
              messageId: brand<string, 'MessageId'>(`msg-${index + 1}`),
              sessionId: SESSION_ID,
              requestId: REQUEST_ID,
              runId: brand<string, 'RequestRunId'>(runId),
              role: index === 0 ? ('USER' as const) : ('ASSISTANT' as const),
              content: index === 0 ? 'hello' : 'answer',
              contentType: 'PLAIN_TEXT' as const,
              metadata: {},
              sequence: index + 1,
              visible: true,
              createdAt: brand<number, 'EpochMillis'>(index),
            })),
      limit: 50,
      hasMore: false,
    })),
    listConversationPreview: vi.fn(async () => ({ sessionId: SESSION_ID, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async () => ({ sessionId: SESSION_ID, requestId: REQUEST_ID, runId: RUN_ID, attempt: 1 })),
    cancel: vi.fn(async () => ({
      sessionId: SESSION_ID,
      targetRequestId: REQUEST_ID,
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem'),
    })),
    retryLatest: vi.fn(async () => ({ sessionId: SESSION_ID, requestId: REQUEST_ID, runId: brand<string, 'RequestRunId'>('R2'), attempt: 2 })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: SESSION_ID,
      pendingInputId: brand<string, 'PendingInputId'>('pi-1'),
      status: 'RECEIVED' as const,
    })),
  };
  const suggestedQuestions: SuggestedQuestionPort = overrides.suggestedQuestions ?? {
    generate: vi.fn(async (): Promise<SuggestedQuestionResult> => ({ questions: ['q1', 'q2', 'q3'] })),
  };
  return {
    runtime,
    sessions,
    suggestedQuestions,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'test-user' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: AGENT_ID,
  };
}

describe('suggested-questions routes', () => {
  it('returns 200 with questions for a valid request', async () => {
    const app = Fastify();
    const deps = makeDependencies();
    await registerWebChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.questions).toEqual(['q1', 'q2', 'q3']);
    await app.close();
  });

  it('returns 404 when session does not belong to current user', async () => {
    const app = Fastify();
    const deps = makeDependencies({
      requireSessionThrows: new AgentError({ code: 'SESSION_NOT_FOUND', message: 'Session was not found.', category: 'NOT_FOUND', retryable: false }),
    });
    await registerWebChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 when no message with runId is found for the request', async () => {
    const app = Fastify();
    const deps = makeDependencies({ messagesWithRunId: false });
    await registerWebChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 200 with empty questions when service returns empty list', async () => {
    const app = Fastify();
    const deps = makeDependencies({
      suggestedQuestions: { generate: vi.fn(async (): Promise<SuggestedQuestionResult> => ({ questions: [] })) },
    });
    await registerWebChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.questions).toEqual([]);
    await app.close();
  });

  it('passes owner scope and agent scope to the service', async () => {
    const app = Fastify();
    const generateMock = vi.fn(async (_req: SuggestedQuestionRequest): Promise<SuggestedQuestionResult> => ({ questions: ['q1'] }));
    const deps = makeDependencies({
      suggestedQuestions: { generate: generateMock },
    });
    await registerWebChannel(app, deps);
    await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });
    expect(generateMock).toHaveBeenCalledTimes(1);
    const callArg = generateMock.mock.calls[0]![0]!;
    expect(callArg.tenantId).toEqual(brand<string, 'TenantId'>('T1'));
    expect(callArg.subjectId).toEqual(brand<string, 'SubjectId'>('U1'));
    expect(callArg.agentId).toEqual(AGENT_ID);
    expect(callArg.sessionId).toEqual(SESSION_ID);
    expect(callArg.requestId).toEqual(REQUEST_ID);
    expect(callArg.runId).toEqual(RUN_ID);
    await app.close();
  });

  it('uses the latest runId when the request contains messages from multiple runs', async () => {
    const app = Fastify();
    const generateMock = vi.fn(async (_req: SuggestedQuestionRequest): Promise<SuggestedQuestionResult> => ({ questions: ['q1'] }));
    const deps = makeDependencies({
      messageRunIds: ['superseded-run', 'completed-run'],
      suggestedQuestions: { generate: generateMock },
    });
    await registerWebChannel(app, deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });

    expect(response.statusCode).toBe(200);
    expect(generateMock.mock.calls[0]![0]!.runId).toEqual(brand<string, 'RequestRunId'>('completed-run'));
    await app.close();
  });
});
