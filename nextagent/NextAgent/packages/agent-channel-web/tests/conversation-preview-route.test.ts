import { brand } from '@nextagent/agent-common';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('conversation preview and navigation routes', () => {
  it('returns the latest preview marker page when offset is omitted', async () => {
    let captured: Parameters<RuntimeSessionPort['listConversationPreview']>[0] | undefined;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listConversationPreview: async (query) => {
          captured = query;
          return {
            sessionId: query.sessionId,
            totalMarkers: 120,
            offset: query.offset ?? 20,
            limit: query.limit,
            markers: [
              {
                messageId: brand<string, 'MessageId'>('msg-preview-route'),
                requestId: brand<string, 'MessageId'>('request-preview-route'),
                createdAt: brand<number, 'EpochMillis'>(10),
                previewText: 'hello',
                previewTruncated: false,
                answerPreviewText: 'answer',
                answerPreviewTruncated: false,
              },
            ],
          };
        },
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-preview-route/conversation/preview?limit=100' });
    expect(response.statusCode).toBe(200);
    expect(captured?.sessionId).toBe('session-preview-route');
    expect(captured).toMatchObject({ limit: 100 });
    expect(captured?.offset).toBeUndefined();
    expect(response.json<{ totalMarkers: number; offset: number; limit: number; markers: Array<{ previewText: string }> }>()).toEqual({
      sessionId: 'session-preview-route',
      totalMarkers: 120,
      offset: 20,
      limit: 100,
      markers: [
        {
          messageId: 'msg-preview-route',
          requestId: 'request-preview-route',
          createdAt: 10,
          previewText: 'hello',
          previewTruncated: false,
          answerPreviewText: 'answer',
          answerPreviewTruncated: false,
        },
      ],
    });

    const missingLimit = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-preview-route/conversation/preview' });
    expect(missingLimit.statusCode).toBe(400);
    expect(missingLimit.json<{ error: { message: string } }>().error.message).toBe('limit is required.');
    const explicitOffset = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=0&limit=100' });
    expect(explicitOffset.statusCode).toBe(200);
    const overLimit = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=0&limit=101' });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json<{ error: { message: string } }>().error.message).toBe('limit must not exceed 100.');
    const zeroLimit = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=0&limit=0' });
    expect(zeroLimit.statusCode).toBe(400);
    expect(zeroLimit.json<{ error: { message: string } }>().error.message).toBe('limit must be a positive integer.');
    const nonNumericLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=0&limit=abc',
    });
    expect(nonNumericLimit.statusCode).toBe(400);
    expect(nonNumericLimit.json<{ error: { message: string } }>().error.message).toBe('limit must be a positive integer.');
    const negativeOffset = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=-1111&limit=100',
    });
    expect(negativeOffset.statusCode).toBe(400);
    expect(negativeOffset.json<{ error: { message: string } }>().error.message).toBe('offset must be a non-negative integer.');
    const nonNumericOffset = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=abc&limit=100',
    });
    expect(nonNumericOffset.statusCode).toBe(400);
    expect(nonNumericOffset.json<{ error: { message: string } }>().error.message).toBe('offset must be an integer.');
    const overOffset = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=10001&limit=100',
    });
    expect(overOffset.statusCode).toBe(400);
    expect(overOffset.json<{ error: { message: string } }>().error.message).toBe('offset must not exceed 10000.');
    const boundaryOffset = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=10000&limit=100',
    });
    expect(boundaryOffset.statusCode).toBe(200);
    // Oversized digit string (e.g. 1e27) must surface the field-level range message, not
    // parseStrictInteger's opaque "finite safe integer" message (Number() overflows MAX_SAFE_INTEGER
    // before the numeric range check can run).
    const overflowOffset = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/session-preview-route/conversation/preview?offset=${'1'.repeat(28)}&limit=100`,
    });
    expect(overflowOffset.statusCode).toBe(400);
    expect(overflowOffset.json<{ error: { message: string } }>().error.message).toBe('offset must not exceed 10000.');
    const leadingZeroLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=0&limit=01',
    });
    expect(leadingZeroLimit.statusCode).toBe(200);
    const searchParam = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-preview-route/conversation/preview?offset=0&limit=100&q=alert',
    });
    expect(searchParam.statusCode).toBe(400);
    expect(searchParam.json<{ error: { message: string } }>().error.message).toBe(
      'Conversation preview only supports offset and limit query parameters.',
    );
    await app.close();
  });

  it('maps public conversation cursors to internal names and rejects combinations', async () => {
    const captured: Array<Parameters<RuntimeSessionPort['listMessages']>[0]> = [];
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        listMessages: async (query) => {
          captured.push(query);
          return {
            items: [],
            limit: query.limit,
            hasMore: false,
            ...(query.afterCursor === undefined ? {} : { newerCursor: query.afterCursor }),
          };
        },
      }),
    );

    const newer = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-nav-route/conversation?newerCursor=msg-3&limit=3&includeCapabilityResults=true',
    });
    expect(newer.statusCode).toBe(200);
    expect(captured[0]).toMatchObject({ afterCursor: 'msg-3', includeCapabilityResults: true, limit: 3 });
    expect(captured[0]).not.toHaveProperty('newerCursor');
    expect(newer.json<{ newerCursor?: string }>().newerCursor).toBe('msg-3');

    const anchor = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-nav-route/conversation?anchorMessageId=msg-anchor&limit=5' });
    expect(anchor.statusCode).toBe(200);
    expect(captured[1]).toMatchObject({ anchorMessageId: 'msg-anchor', includeCapabilityResults: false, limit: 5 });

    const combined = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-nav-route/conversation?cursor=older&newerCursor=newer' });
    expect(combined.statusCode).toBe(400);
    await app.close();
  });
});

function makeDependencies(
  overrides: {
    readonly listMessages?: RuntimeSessionPort['listMessages'];
    readonly listConversationPreview?: RuntimeSessionPort['listConversationPreview'];
  } = {},
) {
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async (command) => ({
      sessionId: command.sessionId,
      requestId: brand<string, 'MessageId'>('request-conversation-route'),
      runId: brand<string, 'RequestRunId'>('run-conversation-route'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      targetRequestId: brand<string, 'MessageId'>('request-conversation-route'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-conversation-route-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      requestId: brand<string, 'MessageId'>('request-conversation-route'),
      runId: brand<string, 'RequestRunId'>('run-conversation-route'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-conversation-route'),
      status: 'RECEIVED' as const,
    })),
  };
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('tenant-conversation-route'),
      subjectId: brand<string, 'SubjectId'>('subject-conversation-route'),
      agentId: brand<string, 'AgentId'>('agent-conversation-route'),
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      title: 'Conversation Route',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async ({ sessionId }) => ({
      tenantId: brand<string, 'TenantId'>('tenant-conversation-route'),
      subjectId: brand<string, 'SubjectId'>('subject-conversation-route'),
      agentId: brand<string, 'AgentId'>('agent-conversation-route'),
      sessionId,
      title: 'Conversation Route',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    listSessions: vi.fn(async (query) => ({ entries: [], offset: query.offset, limit: query.limit, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: overrides.listMessages ?? vi.fn(async (query) => ({ items: [], limit: query.limit, hasMore: false })),
    listConversationPreview:
      overrides.listConversationPreview ??
      vi.fn(async ({ sessionId, offset, limit }) => ({ sessionId, totalMarkers: 0, offset: offset ?? 0, limit, markers: [] })),
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
      tenantId: brand<string, 'TenantId'>('tenant-conversation-route'),
      subjectId: brand<string, 'SubjectId'>('subject-conversation-route'),
      displayName: 'Conversation Route',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-conversation-route'),
  };
}
