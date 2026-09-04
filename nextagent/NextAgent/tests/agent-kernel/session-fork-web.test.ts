import { brand } from '@nextagent/agent-common';
import type { RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-fork-web'),
  subjectId: brand<string, 'SubjectId'>('subject-fork-web'),
  displayName: 'web fork tester',
};
const agentId = brand<string, 'AgentId'>('agent-fork-web');
const sourceSessionId = brand<string, 'SessionId'>('source-web');
const sourceAnchorMessageId = brand<string, 'MessageId'>('source-anchor');
const sourceRequestId = brand<string, 'MessageId'>('source-request');
const childSessionId = brand<string, 'SessionId'>('child-web');

describe('session fork web route', () => {
  it('trims idempotencyKey and delegates fork to runtime session facade', async () => {
    const forkFromMessage = vi.fn(async () => ({
      childSession: {
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        sessionId: childSessionId,
        title: 'Fork Child',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(2),
        hasInFlightRequest: false,
      },
    }));
    const app = await makeApp({ forkFromMessage });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/source-web/messages/source-anchor/fork',
      payload: { idempotencyKey: '  fork-key  ' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessionId: 'child-web', displayTitle: 'Fork Child', lastActivityAt: 2 });
    expect(forkFromMessage).toHaveBeenCalledWith(
      {
        identityContext,
        sourceSessionId,
        sourceAnchorMessageId,
        idempotencyKey: 'fork-key',
      },
      expect.any(AbortSignal),
    );
    await app.close();
  });

  it('trims idempotencyKey and delegates request fork to runtime session facade', async () => {
    const forkFromRequest = vi.fn(async () => ({ childSession: sessionView(childSessionId) }));
    const app = await makeApp({ forkFromRequest });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/source-web/requests/source-request/fork',
      payload: { idempotencyKey: '  fork-key  ' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessionId: 'child-web', displayTitle: 'Fork Child', lastActivityAt: 2 });
    expect(forkFromRequest).toHaveBeenCalledWith(
      {
        identityContext,
        sourceSessionId,
        sourceRequestId,
        idempotencyKey: 'fork-key',
      },
      expect.any(AbortSignal),
    );
    await app.close();
  });

  describe('rejects invalid request-fork payloads', () => {
    let app: Awaited<ReturnType<typeof makeApp>>;
    const forkFromRequest = vi.fn();

    beforeAll(async () => {
      app = await makeApp({ forkFromRequest });
    });

    afterAll(async () => {
      await app.close();
    });

    it.each<Record<string, unknown>>([
      {},
      { idempotencyKey: '   ' },
      { idempotencyKey: 123 },
      { idempotencyKey: 'x'.repeat(129) },
      { idempotencyKey: 'fork-key', tenantId: 'client-tenant' },
      { idempotencyKey: 'fork-key', agentId: 'client-agent' },
      { idempotencyKey: 'fork-key', childSessionId: 'client-child' },
      { idempotencyKey: 'fork-key', messages: [] },
      { idempotencyKey: 'fork-key', activeContextItems: [] },
      { idempotencyKey: 'fork-key', checkpoint: {} },
    ])('rejects request-fork payload %j with 400', async (payload) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/source-web/requests/source-request/fork',
        payload,
      });
      expect(response.statusCode).toBe(400);
    });

    it('does not call forkFromRequest for any invalid payload', () => {
      expect(forkFromRequest).not.toHaveBeenCalled();
    });
  });

  describe('rejects invalid message-fork payloads', () => {
    let app: Awaited<ReturnType<typeof makeApp>>;
    const forkFromMessage = vi.fn();

    beforeAll(async () => {
      app = await makeApp({ forkFromMessage });
    });

    afterAll(async () => {
      await app.close();
    });

    it.each<Record<string, unknown>>([
      {},
      { idempotencyKey: '   ' },
      { idempotencyKey: 123 },
      { idempotencyKey: 'x'.repeat(129) },
      { idempotencyKey: 'fork-key', tenantId: 'client-tenant' },
      { idempotencyKey: 'fork-key', agentId: 'client-agent' },
      { idempotencyKey: 'fork-key', childSessionId: 'client-child' },
      { idempotencyKey: 'fork-key', forkResourceLimits: { maxCopiedMessages: 1 } },
      { idempotencyKey: 'fork-key', maxCopiedMessages: 1 },
      { idempotencyKey: 'fork-key', maxPromotedBytes: 1 },
      { idempotencyKey: 'fork-key', messages: [] },
      { idempotencyKey: 'fork-key', activeContextItems: [] },
      { idempotencyKey: 'fork-key', checkpoint: {} },
    ])('rejects message-fork payload %j with 400', async (payload) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/source-web/messages/source-anchor/fork',
        payload,
      });
      expect(response.statusCode).toBe(400);
    });

    it('does not call forkFromMessage for any invalid payload', () => {
      expect(forkFromMessage).not.toHaveBeenCalled();
    });
  });

  it('projects forkNotice only when the session message page carries it', async () => {
    const listMessages = vi.fn(async (query: Parameters<RuntimeSessionPort['listMessages']>[0]) => ({
      items: [],
      limit: query.limit,
      hasMore: false,
      ...(query.beforeCursor === undefined && query.afterCursor === undefined && query.anchorMessageId === undefined
        ? { forkNotice: { sourceSessionId, sourceSessionTitle: 'Source Snapshot' } }
        : {}),
    }));
    const app = await makeApp({ listMessages });

    const latest = await app.inject({ method: 'GET', url: '/api/v1/sessions/child-web/conversation' });
    const paged = await app.inject({ method: 'GET', url: '/api/v1/sessions/child-web/conversation?cursor=child-a1' });

    expect(latest.json()).toMatchObject({ items: [], forkNotice: { sourceSessionId: 'source-web', sourceSessionTitle: 'Source Snapshot' } });
    expect(paged.json()).toEqual({ items: [] });
    await app.close();
  });

  it('returns child session metadata and then projects copied child conversation with forkNotice', async () => {
    let forked = false;
    const forkFromMessage = vi.fn(async () => {
      forked = true;
      return { childSession: sessionView(childSessionId) };
    });
    const listMessages = vi.fn(async (query: Parameters<RuntimeSessionPort['listMessages']>[0]) => ({
      items: forked
        ? [
            {
              messageId: brand<string, 'MessageId'>('child-anchor'),
              sessionId: childSessionId,
              requestId: brand<string, 'MessageId'>('child-request'),
              role: 'ASSISTANT' as const,
              content: 'copied answer',
              contentType: 'PLAIN_TEXT' as const,
              metadata: {},
              sequence: 0,
              visible: true,
              createdAt: brand<number, 'EpochMillis'>(3),
            },
          ]
        : [],
      limit: query.limit,
      hasMore: false,
      ...(forked ? { forkNotice: { sourceSessionId, sourceSessionTitle: 'Source Snapshot' } } : {}),
    }));
    const app = await makeApp({ forkFromMessage, listMessages });

    const fork = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/source-web/messages/source-anchor/fork',
      payload: { idempotencyKey: 'fork-key' },
    });
    const conversation = await app.inject({ method: 'GET', url: '/api/v1/sessions/child-web/conversation' });

    expect(fork.statusCode).toBe(200);
    expect(fork.json()).toEqual({ sessionId: 'child-web', displayTitle: 'Fork Child', lastActivityAt: 2 });
    expect(conversation.json()).toMatchObject({
      items: [{ messageId: 'child-anchor', role: 'ASSISTANT', content: 'copied answer' }],
      forkNotice: { sourceSessionId: 'source-web', sourceSessionTitle: 'Source Snapshot' },
    });
    await app.close();
  });
});

async function makeApp(overrides: {
  readonly forkFromMessage?: RuntimeSessionPort['forkFromMessage'];
  readonly forkFromRequest?: RuntimeSessionPort['forkFromRequest'];
  readonly listMessages?: RuntimeSessionPort['listMessages'];
}) {
  const app = Fastify();
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => sessionView(childSessionId)),
    requireSession: vi.fn(async ({ sessionId }) => sessionView(sessionId)),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: overrides.forkFromMessage ?? vi.fn(async () => ({ childSession: sessionView(childSessionId) })),
    forkFromRequest: overrides.forkFromRequest ?? vi.fn(async () => ({ childSession: sessionView(childSessionId) })),
    listMessages: overrides.listMessages ?? vi.fn(async (query) => ({ items: [], limit: query.limit, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => sessionView(childSessionId)),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async () => ({
      sessionId: childSessionId,
      requestId: brand<string, 'MessageId'>('request-web'),
      runId: brand<string, 'RequestRunId'>('run-web'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: childSessionId,
      targetRequestId: brand<string, 'MessageId'>('request-web'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: childSessionId,
      requestId: brand<string, 'MessageId'>('request-web'),
      runId: brand<string, 'RequestRunId'>('run-web'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => ({
      sessionId: childSessionId,
      requestId: brand<string, 'MessageId'>('request-web'),
      runId: brand<string, 'RequestRunId'>('run-web'),
      attempt: 2,
    })),
    answerPendingInput: vi.fn(async () => ({
      sessionId: childSessionId,
      pendingInputId: brand<string, 'PendingInputId'>('pending-web'),
      status: 'RECEIVED' as const,
    })),
  };
  await registerWebChannel(app, {
    runtime,
    sessions,
    identityResolver: () => identityContext,
    runtimeBootstrap: { transportKind: 'SSE' },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) },
    defaultAgentId: agentId,
  });
  return app;
}

function sessionView(sessionId: typeof childSessionId) {
  return {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    title: 'Fork Child',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(2),
    hasInFlightRequest: false,
  };
}
