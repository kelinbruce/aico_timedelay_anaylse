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
import { registerWebChannel } from '@nextagent/agent-channel-web';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('retry limit route', () => {
  it('passes through the retry attempt limit safe error without sensitive details', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    runtime.retryLatest = vi.fn(async () => {
      throw new AgentError({
        code: 'REQUEST_RETRY_LIMIT_EXCEEDED',
        message: 'Retry attempt limit was reached for this request.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'REQUEST_RETRY_LIMIT_EXCEEDED' },
      });
    });
    await registerWebChannel(app, makeDependencies(runtime));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/retry',
      payload: { expectedLatestRequestId: 'req-1', idempotencyKey: 'idem-retry-limit' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe('REQUEST_RETRY_LIMIT_EXCEEDED');
    expect(body.error.message).toBe('Retry attempt limit was reached for this request.');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('T1');
    expect(serialized).not.toContain('U1');
    expect(serialized).not.toContain('reasonCode');
    expect(serialized).not.toContain('stack');
    await app.close();
  });
});

function makeRuntime(): RuntimeCommandPort {
  return {
    reserveSubmit: vi.fn(async () => {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    }),
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
}

function makeDependencies(runtime: RuntimeCommandPort) {
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
  return {
    runtime,
    sessions,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'Test User' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-1'),
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
