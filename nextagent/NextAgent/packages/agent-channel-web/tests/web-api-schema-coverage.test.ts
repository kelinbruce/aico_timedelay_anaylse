import { brand } from '@nextagent/agent-common';
import { registerWebChannel, webChannelPublicEndpoints } from '@nextagent/agent-channel-web';
import { createLocalConfiguredWebAuth } from '@nextagent/agent-channel-web-auth-local';
import type { CronTaskManagementPort, LongTermMemoryManagementPort } from '@nextagent/agent-contracts/channel';
import type { RuntimeCommandPort, RuntimeSessionActivityPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify, { type RouteOptions } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const documentedRestEndpoints = webChannelPublicEndpoints.filter((endpoint) => !endpoint.startsWith('WS '));

describe('web API schema coverage', () => {
  it('keeps public endpoint inventory aligned with registered Web and auth routes', async () => {
    const routes: RouteOptions[] = [];
    const app = Fastify();
    app.addHook('onRoute', (route) => {
      routes.push(route);
    });
    await registerWebChannel(app, {
      ...makeDependencies(),
      longTermMemoryManagement: makeMemory(),
    });
    const auth = createLocalConfiguredWebAuth({
      loopbackOnly: true,
      identity: {
        tenantId: brand<string, 'TenantId'>('tenant-local'),
        subjectId: brand<string, 'SubjectId'>('subject-local'),
        displayName: 'Local Developer',
      },
      credentialRef: brand<`env:${string}`, 'SecretReference'>('env:LOCAL_PASSWORD'),
      cookieTtlMs: 60_000,
      credentialResolver: async () => 'local-secret',
    });
    await app.register(auth.plugin);

    const registered = new Set(
      routes
        .flatMap((route) => {
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          return methods.map((method) => `${method} ${route.url}`);
        })
        .filter(
          (endpoint) =>
            endpoint.startsWith('GET /api/') ||
            endpoint.startsWith('POST /api/') ||
            endpoint.startsWith('PUT /api/') ||
            endpoint.startsWith('PATCH /api/') ||
            endpoint.startsWith('DELETE /api/'),
        ),
    );

    expect([...registered].sort()).toEqual([...documentedRestEndpoints].sort());
    expect([...registered].some((endpoint) => endpoint.includes('process-messages'))).toBe(false);
    const eventHistory = routes.find((route) => route.url === '/api/v1/sessions/:sessionId/runs/:runId/events');
    expect(eventHistory?.schema?.querystring).toMatchObject({
      additionalProperties: false,
      properties: {
        afterSequence: expect.any(Object),
        limit: expect.any(Object),
      },
    });
    expect(JSON.stringify(eventHistory?.schema?.querystring)).not.toContain('messageIds');
    await app.close();
  });

  it('registers request and response schemas for public Web routes', async () => {
    const routes: RouteOptions[] = [];
    const app = Fastify();
    app.addHook('onRoute', (route) => {
      routes.push(route);
    });
    await registerWebChannel(app, makeDependencies());

    for (const route of routes.filter((entry) => entry.url.startsWith('/api/'))) {
      const endpoint = `${route.method} ${route.url}`;
      expect(route.schema, endpoint).toBeDefined();
      expect(route.schema?.response, `${endpoint} response schema`).toBeDefined();
      if (route.url.includes(':')) {
        expect(route.schema?.params, `${endpoint} params schema`).toBeDefined();
      }
      if (route.method === 'POST' || route.method === 'PUT') {
        const usesManualBodyValidation =
          route.url === '/api/v1/requests' ||
          route.url === '/api/v1/sessions/:sessionId/requests' ||
          route.url === '/api/v1/sessions/:sessionId/requests/latest/edit' ||
          route.url === '/api/v1/sessions/:sessionId/files/upload' ||
          route.url === '/api/v1/sessions/:sessionId/messages/:messageId/fork' ||
          route.url === '/api/v1/sessions/:sessionId/requests/:requestId/fork';
        const isNoBodyCommand =
          route.url.endsWith('/suggested-questions') ||
          route.url.endsWith('/background-tasks/:taskId/kill') ||
          route.url === '/api/v1/cron-tasks/:taskId/runs' ||
          route.url === '/api/v1/auth/local/logout';
        if (!usesManualBodyValidation && !isNoBodyCommand) {
          expect(route.schema?.body, `${endpoint} body schema`).toBeDefined();
        }
      }
    }
    await app.close();
  });
});

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
    createSession: vi.fn(async () => session()),
    requireSession: vi.fn(async ({ sessionId }) => session(sessionId)),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: session(brand<string, 'SessionId'>('child-1')) })),
    forkFromRequest: vi.fn(async () => ({ childSession: session(brand<string, 'SessionId'>('child-1')) })),
    listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 50, markers: [] })),
    updateTitle: vi.fn(async ({ sessionId, title }) => ({ ...session(sessionId), title })),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const cronTaskManagement = {
    listCronTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
    listCronTaskExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
    createCronTask: vi.fn(async () => {
      throw new Error('not invoked by schema coverage');
    }),
    updateCronTask: vi.fn(async () => {
      throw new Error('not invoked by schema coverage');
    }),
    deleteCronTask: vi.fn(async () => undefined),
    executeCronTask: vi.fn(async () => {
      throw new Error('not invoked by schema coverage');
    }),
  } satisfies CronTaskManagementPort;

  return {
    runtime,
    sessions,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'Test User' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    sessionActivities: {
      streamSessionActivities: vi.fn(async function* () {
        yield { type: 'SNAPSHOT', entries: [] } as const;
      }),
      consumeSessionActivity: vi.fn(async () => undefined),
    } satisfies RuntimeSessionActivityPort,
    cronTaskManagement,
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-1'),
  };
}

function makeMemory(): LongTermMemoryManagementPort {
  const unexpectedCall = () =>
    vi.fn(async (): Promise<never> => {
      throw new Error('memory port must not be called while collecting route schemas');
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

function session(sessionId = brand<string, 'SessionId'>('S1')) {
  return {
    tenantId: brand<string, 'TenantId'>('T1'),
    subjectId: brand<string, 'SubjectId'>('U1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    sessionId,
    title: 'Session',
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
    hasInFlightRequest: false,
  };
}
