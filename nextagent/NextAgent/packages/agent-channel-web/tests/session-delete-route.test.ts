import { AgentError, brand } from '@nextagent/agent-common';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerWebChannel } from '../src/routes/requests.js';

describe('DELETE /api/v1/sessions/:sessionId', () => {
  it('delegates to runtime sessions and returns 204', async () => {
    const deleteSession = vi.fn(async () => undefined);
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ deleteSession }));

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/sessions/session-delete-route' });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(deleteSession).toHaveBeenCalledWith({
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-delete-route'),
        subjectId: brand<string, 'SubjectId'>('subject-delete-route'),
        displayName: 'delete-route-user',
      },
      sessionId: brand<string, 'SessionId'>('session-delete-route'),
    });
  });

  it('maps active-run conflict to 409 safe error', async () => {
    const deleteSession = vi.fn(async () => {
      throw new AgentError({
        code: 'SESSION_DELETE_CONFLICT',
        message: 'Session has an active request run and cannot be deleted.',
        category: 'CONFLICT',
        retryable: true,
      });
    });
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ deleteSession }));

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/sessions/session-running' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'SESSION_DELETE_CONFLICT',
        message: 'Session has an active request run and cannot be deleted.',
      },
    });
  });

  it('maps scoped missing sessions to 404 safe error', async () => {
    const deleteSession = vi.fn(async () => {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    });
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ deleteSession }));

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/sessions/session-missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
      },
    });
  });

  it('maps unavailable storage failures to 503 safe error', async () => {
    const deleteSession = vi.fn(async () => {
      throw new AgentError({
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'Local session store is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    });
    const app = Fastify();
    await registerWebChannel(app, makeDependencies({ deleteSession }));

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/sessions/session-storage-failure' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'LOCAL_STORE_UNAVAILABLE',
        message: 'Local session store is unavailable.',
      },
    });
  });
});

function makeDependencies(overrides: { readonly deleteSession?: RuntimeSessionPort['deleteSession'] } = {}) {
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => makeSession('session-delete-route')),
    requireSession: vi.fn(async ({ sessionId }) => makeSession(sessionId)),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: overrides.deleteSession ?? vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => makeSession('session-delete-route')),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-delete-route'),
      requestId: brand<string, 'MessageId'>('message-delete-route'),
      runId: brand<string, 'RequestRunId'>('run-delete-route'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-delete-route'),
      targetRequestId: brand<string, 'MessageId'>('message-delete-route'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-route-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-delete-route'),
      requestId: brand<string, 'MessageId'>('message-delete-route'),
      runId: brand<string, 'RequestRunId'>('run-delete-route-retry'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-delete-route'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-delete-route'),
      status: 'RECEIVED' as const,
    })),
  };
  return {
    runtime,
    sessions,
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('tenant-delete-route'),
      subjectId: brand<string, 'SubjectId'>('subject-delete-route'),
      displayName: 'delete-route-user',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-delete-route'),
  };
}

function makeSession(sessionId: string) {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-delete-route'),
    subjectId: brand<string, 'SubjectId'>('subject-delete-route'),
    agentId: brand<string, 'AgentId'>('agent-delete-route'),
    sessionId: brand<string, 'SessionId'>(sessionId),
    title: 'Delete route',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
}
