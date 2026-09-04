import { brand, type AgentId, type AgentVersion, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { RuntimeConversationAnnotationPort, ConversationFavoriteTurnPage } from '@nextagent/agent-contracts/runtime';
import type { UserQuestionActivityStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import { createFrequentQuestionService, type CategoryQuestionCatalogPort } from '@nextagent/agent-session';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const TENANT_ID = brand<string, 'TenantId'>('T1');
const SUBJECT_ID = brand<string, 'SubjectId'>('U1');

function makeAssemblyRegistry(): AgentAssemblyRegistry {
  return {
    active: vi.fn(
      async () =>
        ({
          agentId: AGENT_ID,
          agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
          agentAssemblyRef: 'ref',
          capabilityBindings: [],
        }) as unknown as AgentAssembly,
    ),
  } as unknown as AgentAssemblyRegistry;
}

function makeCatalogPort(): CategoryQuestionCatalogPort {
  return {
    loadCatalog: vi.fn(async () => undefined),
  } as unknown as CategoryQuestionCatalogPort;
}

function makeAnnotations(): RuntimeConversationAnnotationPort {
  const page: ConversationFavoriteTurnPage = {
    entries: [],
    offset: 0,
    limit: 100,
    hasMore: false,
  };
  return {
    upsertAnnotation: vi.fn(),
    listFavoriteTurns: vi.fn(),
    listQuestionFavoriteTurns: vi.fn(async () => page),
    listSessionAnnotations: vi.fn(),
  } as unknown as RuntimeConversationAnnotationPort;
}

function makeActivityStore(): UserQuestionActivityStoreGateway {
  return {
    upsertActivity: vi.fn(async (r) => r),
    listHighFrequency: vi.fn(async () => []),
  };
}

function makeSessionPort(): RuntimeSessionPort {
  return {
    createSession: vi.fn(),
    requireSession: vi.fn(),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(),
    listMessages: vi.fn(async () => ({ items: [], limit: 10, hasMore: false })),
    listConversationPreview: vi.fn(),
    updateTitle: vi.fn(),
    forkFromMessage: vi.fn(),
    forkFromRequest: vi.fn(),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  } as unknown as RuntimeSessionPort;
}

function makeRuntime(): RuntimeCommandPort {
  return {
    submit: vi.fn(),
    cancel: vi.fn(),
    retryLatest: vi.fn(),
    editLatest: vi.fn(),
    answerPendingInput: vi.fn(),
  } as unknown as RuntimeCommandPort;
}

function makeApp() {
  const frequentQuestions = createFrequentQuestionService({
    categoryCatalog: makeCatalogPort(),
    assemblyRegistry: makeAssemblyRegistry(),
    annotations: makeAnnotations(),
    activityStore: makeActivityStore(),
    frequencyThreshold: 8,
    deploymentMode: 'LOCAL',
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  return { app, frequentQuestions };
}

describe('question-association full HTTP chain locale regression', () => {
  it('GET /api/v1/question-association?keyword=5&locale=zh-CN returns 200 with canonical locale', async () => {
    const { app, frequentQuestions } = makeApp();
    await registerWebChannel(app, {
      runtime: makeRuntime(),
      sessions: makeSessionPort(),
      identityResolver: () => ({ tenantId: TENANT_ID, subjectId: SUBJECT_ID, displayName: 'test' }),
      runtimeBootstrap: { transportKind: 'SSE' },
      skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 10, skills: [] })) } as unknown as SkillCatalogQueryPort,
      frequentQuestions,
      defaultAgentId: AGENT_ID,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=5&locale=zh-CN' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.locale).toBe('zh-CN');
    expect(body.questions).toEqual([]);
    await app.close();
  });

  it('GET /api/v1/question-association without locale defaults to zh-CN', async () => {
    const { app, frequentQuestions } = makeApp();
    await registerWebChannel(app, {
      runtime: makeRuntime(),
      sessions: makeSessionPort(),
      identityResolver: () => ({ tenantId: TENANT_ID, subjectId: SUBJECT_ID, displayName: 'test' }),
      runtimeBootstrap: { transportKind: 'SSE' },
      skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 10, skills: [] })) } as unknown as SkillCatalogQueryPort,
      frequentQuestions,
      defaultAgentId: AGENT_ID,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/question-association?keyword=5' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.locale).toBe('zh-CN');
    await app.close();
  });

  it('GET /api/v1/frequent-questions?locale=zh-CN returns 200 with canonical locale', async () => {
    const { app, frequentQuestions } = makeApp();
    await registerWebChannel(app, {
      runtime: makeRuntime(),
      sessions: makeSessionPort(),
      identityResolver: () => ({ tenantId: TENANT_ID, subjectId: SUBJECT_ID, displayName: 'test' }),
      runtimeBootstrap: { transportKind: 'SSE' },
      skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 10, skills: [] })) } as unknown as SkillCatalogQueryPort,
      frequentQuestions,
      defaultAgentId: AGENT_ID,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/frequent-questions?locale=zh-CN' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.locale).toBe('zh-CN');
    await app.close();
  });
});
