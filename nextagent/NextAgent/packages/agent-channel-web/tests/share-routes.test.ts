import {
  AgentError,
  brand,
  type AgentId,
  type EpochMillis,
  type IdempotencyKey,
  type MessageId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  RuntimeCommandPort,
  RuntimeConversationSharePort,
  RuntimeSessionPort,
  SkillCatalogQueryPort,
  SharedConversationPage,
  ShareResult,
} from '@nextagent/agent-contracts/runtime';
import type { SafeError } from '@nextagent/agent-common';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');

function makeShareResult(overrides: Partial<ShareResult> = {}): ShareResult {
  return {
    shareId: 'share-123',
    shareUrl: 'https://host:3000#/shared/share-123',
    ...overrides,
  };
}

function makeSharedPage(overrides: Partial<SharedConversationPage> = {}): SharedConversationPage {
  return {
    sessionId: brand<string, 'SessionId'>('S1'),
    messages: [
      {
        messageId: brand<string, 'MessageId'>('msg-1'),
        sessionId: brand<string, 'SessionId'>('S1'),
        requestId: brand<string, 'MessageId'>('req-1'),
        runId: brand<string, 'RequestRunId'>('R1'),
        role: 'USER',
        content: 'hello',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        sequence: 0,
        visible: true,
        createdAt: brand<number, 'EpochMillis'>(1000),
      },
    ],
    createdAt: brand<number, 'EpochMillis'>(1000),
    ...overrides,
  };
}

function makeDependencies(overrides: { shares?: RuntimeConversationSharePort } = {}) {
  const shares: RuntimeConversationSharePort = overrides.shares ?? {
    createShare: vi.fn(async (cmd) => makeShareResult({ shareUrl: `${cmd.originUrl.split('#')[0]}#/shared/share-123` })),
    loadSharedConversation: vi.fn(async () => makeSharedPage()),
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
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
    listConversationPreview: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      totalMarkers: 0,
      offset: 0,
      limit: 100,
      markers: [],
    })),
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
    shares,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'test-user' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: AGENT_ID,
  };
}

describe('share routes', () => {
  describe('POST /api/v1/sessions/:sessionId/shares', () => {
    it('creates share and returns 200 with shareUrl', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds: ['R1', 'R2'], originUrl: 'https://10.0.0.1:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.shareId).toBeDefined();
      expect(body.shareUrl).toMatch(/^https:\/\/10\.0\.0\.1:3000#\/shared\/.+$/);
      expect(deps.sessions.listEvents).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 400 with a field-level message when runIds is empty', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds: [], originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.error.message).toBe('runIds must contain at least 1 item(s).');
      await app.close();
    });

    it('returns 400 with a field-level message when runIds is missing', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.error.message).toBe('runIds is required.');
      await app.close();
    });

    it('returns 400 when runIds exceeds 100 items', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const runIds = Array.from({ length: 101 }, (_, i) => `run-${i}`);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds, originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.error.message).toBe('runIds must not exceed 100 items.');
      await app.close();
    });

    it('returns 400 when a single runId exceeds 256 characters', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const longRunId = 'x'.repeat(257);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds: [longRunId], originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.error.message).toBe('runIds must not exceed 256 characters.');
      await app.close();
    });

    it('returns 503 when shares dependency is not injected', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      const { shares: _, ...depsWithoutShares } = deps;
      await registerWebChannel(app, depsWithoutShares as typeof deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds: ['R1'], originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARES_UNAVAILABLE');
      await app.close();
    });

    it('ignores client-supplied scope fields in body', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: {
          runIds: ['R1'],
          originUrl: 'https://host:3000',
          expiresIn: '7d',
          allowedOps: null,
          tenantId: 'HACKED',
          subjectId: 'HACKED',
          agentId: 'HACKED',
        },
      });
      expect(response.statusCode).toBe(200);
      const createShareCall = (deps.shares.createShare as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(createShareCall.identityContext.tenantId).not.toBe('HACKED');
      expect(createShareCall.identityContext.subjectId).not.toBe('HACKED');
      expect(createShareCall.agentId).not.toBe('HACKED');
      await app.close();
    });

    it('creates share with ops hash array (length 1)', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const opsHash = 'a1b2c3d4e5f6';
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds: ['R1'], originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: [opsHash] },
      });
      expect(response.statusCode).toBe(200);
      const createShareCall = (deps.shares.createShare as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(createShareCall.allowedOps).toHaveLength(1);
      expect(createShareCall.allowedOps[0]).toBe(opsHash);
      await app.close();
    });

    it('returns 404 SHARE_RUN_NOT_RESOLVABLE when a runId is not a resolvable share unit', async () => {
      // The share service throws SHARE_RUN_NOT_RESOLVABLE (NOT_FOUND) at create
      // time when a runId does not exist or is not a complete question-answer
      // pair. The route error handler MUST map that to 404 — never a 200 with a
      // dead shareUrl.
      const app = Fastify();
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => {
            throw new AgentError({
              code: 'SHARE_RUN_NOT_RESOLVABLE',
              message: 'One or more selected runs cannot be shared.',
              category: 'NOT_FOUND',
              retryable: false,
            });
          }),
          loadSharedConversation: vi.fn(async () => makeSharedPage()),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/shares',
        payload: { runIds: ['RUN_DOES_NOT_EXIST'], originUrl: 'https://host:3000', expiresIn: '7d', allowedOps: null },
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARE_RUN_NOT_RESOLVABLE');
      await app.close();
    });
  });

  describe('GET /api/v1/shares/:shareId/conversation', () => {
    it('returns 200 with shared conversation for public share without ops header', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sessionId).toBe('S1');
      expect(body.messages).toHaveLength(1);
      await app.close();
    });

    it('fails closed when an injected share port returns internal protocol messages', async () => {
      const userMessage = makeSharedPage().messages[0]!;
      const finalAnswer = {
        ...userMessage,
        messageId: brand<string, 'MessageId'>('answer-1'),
        role: 'ASSISTANT' as const,
        content: 'public final answer',
        metadata: {},
      };
      const capabilityResult = {
        ...userMessage,
        messageId: brand<string, 'MessageId'>('capability-result-1'),
        role: 'CAPABILITY_RESULT' as const,
        content: 'SECRET_SHARED_CAPABILITY_RESULT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'read-1', toolName: 'Read' },
      };
      const assistantToolUse = {
        ...userMessage,
        messageId: brand<string, 'MessageId'>('assistant-tool-use-1'),
        role: 'ASSISTANT' as const,
        content: 'SECRET_SHARED_TOOL_ARGUMENTS',
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['read-1'] },
      };
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => makeShareResult()),
          loadSharedConversation: vi.fn(async () =>
            makeSharedPage({
              messages: [userMessage, capabilityResult, assistantToolUse, finalAnswer],
            }),
          ),
        },
      });
      const app = Fastify();
      await registerWebChannel(app, deps);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
      });
      const body = response.json<{ readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }> }>();

      expect(response.statusCode).toBe(200);
      expect(body.messages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
      expect(body.messages.map((message) => message.content)).toEqual(['hello', 'public final answer']);
      expect(JSON.stringify(body)).not.toContain('SECRET_SHARED_');
      await app.close();
    });

    it('returns 200 when ops header matches allowedOps', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
        headers: { 'x-viewer-ops': JSON.stringify(['hashH']) },
      });
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('returns 403 SHARE_FORBIDDEN when ops insufficient', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => makeShareResult()),
          loadSharedConversation: vi.fn(
            async () => ({ code: 'SHARE_FORBIDDEN', message: 'Insufficient permissions.', category: 'AUTHORIZATION', retryable: false }) as SafeError,
          ),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
        headers: { 'x-viewer-ops': JSON.stringify(['hashH2']) },
      });
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARE_FORBIDDEN');
      await app.close();
    });

    it('returns 410 SHARE_EXPIRED when share is expired', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => makeShareResult()),
          loadSharedConversation: vi.fn(
            async () => ({ code: 'SHARE_EXPIRED', message: 'Share has expired.', category: 'NOT_FOUND', retryable: false }) as SafeError,
          ),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
      });
      expect(response.statusCode).toBe(410);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARE_EXPIRED');
      await app.close();
    });

    it('returns 404 SHARE_CONTENT_DELETED when content is deleted', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => makeShareResult()),
          loadSharedConversation: vi.fn(
            async () => ({ code: 'SHARE_CONTENT_DELETED', message: 'Content deleted.', category: 'NOT_FOUND', retryable: false }) as SafeError,
          ),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARE_CONTENT_DELETED');
      await app.close();
    });

    it('returns 404 SHARE_NOT_FOUND for non-existent share', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => makeShareResult()),
          loadSharedConversation: vi.fn(
            async () => ({ code: 'SHARE_NOT_FOUND', message: 'Share not found.', category: 'NOT_FOUND', retryable: false }) as SafeError,
          ),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/nonexistent/conversation',
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARE_NOT_FOUND');
      await app.close();
    });

    it('returns 503 when shares dependency is not injected', async () => {
      const app = Fastify();
      const deps = makeDependencies();
      const { shares: _, ...depsWithoutShares } = deps;
      await registerWebChannel(app, depsWithoutShares as typeof deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
      });
      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHARES_UNAVAILABLE');
      await app.close();
    });

    it('passes empty viewerOps when header is empty array and allowedOps is non-null returns 403', async () => {
      const app = Fastify();
      const deps = makeDependencies({
        shares: {
          createShare: vi.fn(async () => makeShareResult()),
          loadSharedConversation: vi.fn(async (query: { viewerOps: readonly string[] | null }) => {
            if (query.viewerOps !== null && query.viewerOps.length === 0) {
              return { code: 'SHARE_FORBIDDEN', message: 'Insufficient permissions.', category: 'AUTHORIZATION', retryable: false } as SafeError;
            }
            return makeSharedPage();
          }),
        },
      });
      await registerWebChannel(app, deps);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shares/share-123/conversation',
        headers: { 'x-viewer-ops': JSON.stringify([]) },
      });
      expect(response.statusCode).toBe(403);
      await app.close();
    });
  });
});
