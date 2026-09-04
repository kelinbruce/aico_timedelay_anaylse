import { brand } from '@nextagent/agent-common';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort, SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { registerWebChannel, submitBody } from '@nextagent/agent-channel-web';
import { Ajv } from 'ajv/dist/ajv.js';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { upsertAnnotationBody } from '../src/schemas/annotation-dto.js';
import { createShareBody } from '../src/schemas/share-dto.js';
import { WEB_SHARE_ALLOWED_OPS_MAX_ITEMS } from '../src/schemas/validation-limits.js';

describe('request model options schema', () => {
  it('accepts thinking OFF and canonical toolChoice and forwards them as requestModelOptions', async () => {
    let captured: SubmitRequestCommand | undefined;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        submit: async (command) => {
          captured = command;
          return {
            sessionId: command.sessionId ?? brand<string, 'SessionId'>('session-request-model-options'),
            requestId: brand<string, 'MessageId'>('request-request-model-options'),
            runId: brand<string, 'RequestRunId'>('run-request-model-options'),
            attempt: 1,
          };
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/session-request-model-options/requests',
      payload: {
        inputText: 'diagnose OLT alarm summary',
        idempotencyKey: 'idem-request-model-options',
        modelOptions: {
          thinking: {
            depth: 'OFF',
          },
          toolChoice: 'NONE',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(captured?.requestModelOptions).toEqual({ thinking: { depth: 'OFF' }, toolChoice: 'NONE' });
    await app.close();
  });

  it('rejects non-OFF thinking depth and unknown model override fields at the schema boundary', () => {
    const validate = new Ajv({ allErrors: true }).compile(submitBody);

    expect(
      validate({
        inputText: 'diagnose OLT alarm summary',
        idempotencyKey: 'idem-request-model-options-invalid-depth',
        modelOptions: {
          thinking: {
            depth: 'HIGH',
          },
        },
      }),
    ).toBe(false);

    expect(
      validate({
        inputText: 'diagnose OLT alarm summary',
        idempotencyKey: 'idem-request-model-options-invalid-tool-choice',
        modelOptions: {
          toolChoice: 'Read',
        },
      }),
    ).toBe(false);

    expect(
      validate({
        inputText: 'diagnose OLT alarm summary',
        idempotencyKey: 'idem-request-model-options-invalid-field',
        modelOptions: {
          temperature: 0.2,
        },
      }),
    ).toBe(false);
  });

  it('rejects oversized request text and idempotency keys at the schema boundary', () => {
    const validate = new Ajv({ allErrors: true }).compile(submitBody);

    expect(
      validate({
        inputText: 'x'.repeat(32769),
        idempotencyKey: 'idem-request-model-options',
      }),
    ).toBe(false);

    expect(
      validate({
        inputText: 'diagnose OLT alarm summary',
        idempotencyKey: 'x'.repeat(257),
      }),
    ).toBe(false);
  });

  it('rejects extra share and annotation body fields at the schema boundary', () => {
    const ajv = new Ajv({ allErrors: true });
    const validateShare = ajv.compile(createShareBody);
    const validateAnnotation = ajv.compile(upsertAnnotationBody);

    expect(
      validateShare({
        runIds: ['run-1'],
        originUrl: 'https://nextagent.local/session',
        expiresIn: '24h',
        allowedOps: null,
        tenantId: 'tenant-spoof',
      }),
    ).toBe(false);

    expect(
      validateAnnotation({
        sentiment: 'UP',
        isFavorited: true,
        tenantId: 'tenant-spoof',
      }),
    ).toBe(false);
  });

  it('accepts large allowedOps array within limit and rejects beyond limit', () => {
    const ajv = new Ajv({ allErrors: true });
    const validateShare = ajv.compile(createShareBody);
    const longOp = 'EMS.APP.SystemMaintenance.iMAP_LOG_ITM_SecurityLog';

    const withinLimit = Array.from({ length: WEB_SHARE_ALLOWED_OPS_MAX_ITEMS - 1 }, (_, i) => `${longOp}_${i}`);
    expect(
      validateShare({
        runIds: ['R1'],
        originUrl: 'https://host:3000',
        expiresIn: '7d',
        allowedOps: withinLimit,
      }),
    ).toBe(true);

    const atLimit = Array.from({ length: WEB_SHARE_ALLOWED_OPS_MAX_ITEMS }, () => longOp);
    expect(
      validateShare({
        runIds: ['R1'],
        originUrl: 'https://host:3000',
        expiresIn: '7d',
        allowedOps: atLimit,
      }),
    ).toBe(true);

    const overLimit = Array.from({ length: WEB_SHARE_ALLOWED_OPS_MAX_ITEMS + 1 }, () => longOp);
    expect(
      validateShare({
        runIds: ['R1'],
        originUrl: 'https://host:3000',
        expiresIn: '7d',
        allowedOps: overLimit,
      }),
    ).toBe(false);
  });
});

function makeDependencies(overrides: { submit?: RuntimeCommandPort['submit'] } = {}) {
  const runtime: RuntimeCommandPort = {
    submit:
      overrides.submit ??
      vi.fn(async (command) => ({
        sessionId: command.sessionId,
        requestId: brand<string, 'MessageId'>('request-request-model-options-default'),
        runId: brand<string, 'RequestRunId'>('run-request-model-options-default'),
        attempt: 1,
      })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-request-model-options'),
      targetRequestId: brand<string, 'MessageId'>('request-request-model-options'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-request-model-options'),
      requestId: brand<string, 'MessageId'>('request-request-model-options'),
      runId: brand<string, 'RequestRunId'>('run-request-model-options'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-request-model-options'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-request-model-options'),
      status: 'RECEIVED' as const,
    })),
  };
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('tenant-request-model-options'),
      subjectId: brand<string, 'SubjectId'>('subject-request-model-options'),
      agentId: brand<string, 'AgentId'>('agent-request-model-options'),
      sessionId: brand<string, 'SessionId'>('session-request-model-options'),
      title: 'Request Model Options',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async ({ sessionId }) => ({
      tenantId: brand<string, 'TenantId'>('tenant-request-model-options'),
      subjectId: brand<string, 'SubjectId'>('subject-request-model-options'),
      agentId: brand<string, 'AgentId'>('agent-request-model-options'),
      sessionId,
      title: 'Request Model Options',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
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

  return {
    runtime,
    sessions,
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('tenant-request-model-options'),
      subjectId: brand<string, 'SubjectId'>('subject-request-model-options'),
      displayName: 'Request Model Options',
    }),
    runtimeBootstrap: {
      transportKind: 'SSE' as const,
    },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('default-agent'),
  };
}
