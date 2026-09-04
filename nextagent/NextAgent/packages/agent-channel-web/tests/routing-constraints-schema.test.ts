import { brand } from '@nextagent/agent-common';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort, SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import { submitBody } from '@nextagent/agent-channel-web';
import { Ajv } from 'ajv/dist/ajv.js';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('routing constraints schema', () => {
  it('accepts non-target routingConstraints and forwards them to runtime.submit', async () => {
    let captured: SubmitRequestCommand | undefined;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        submit: async (command) => {
          captured = command;
          return {
            sessionId: command.sessionId ?? brand<string, 'SessionId'>('session-routing-constraints-schema'),
            requestId: brand<string, 'MessageId'>('request-routing-constraints-schema'),
            runId: brand<string, 'RequestRunId'>('run-routing-constraints-schema'),
            attempt: 1,
          };
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/session-routing-constraints-schema/requests',
      payload: {
        inputText: '$workflow:ran-alarm-diagnosis diagnose OLT alarms',
        idempotencyKey: 'idem-routing-constraints-schema',
        locale: 'zh-CN',
        routingConstraints: {
          forbiddenCapabilityIds: ['write-config'],
          executionMode: 'model-only',
          locale: 'en-US',
          allowHumanInput: false,
          allowSubagents: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(captured?.inputText).toBe('$workflow:ran-alarm-diagnosis diagnose OLT alarms');
    expect(captured?.routingConstraints).toEqual({
      forbiddenCapabilityIds: ['write-config'],
      executionMode: 'model-only',
      locale: 'en-US',
      allowHumanInput: false,
      allowSubagents: false,
    });
    await app.close();
  });

  it('rejects targetSkill and targetRecipe in agent-web submit routingConstraints', async () => {
    const submitted: SubmitRequestCommand[] = [];
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies({
        submit: async (command) => {
          submitted.push(command);
          return {
            sessionId: command.sessionId ?? brand<string, 'SessionId'>('session-routing-constraints-schema-target'),
            requestId: brand<string, 'MessageId'>('request-routing-constraints-schema-target'),
            runId: brand<string, 'RequestRunId'>('run-routing-constraints-schema-target'),
            attempt: 1,
          };
        },
      }),
    );

    const targetSkillResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/session-routing-constraints-schema/requests',
      payload: {
        inputText: 'diagnose OLT alarms',
        idempotencyKey: 'idem-routing-target-skill-invalid',
        routingConstraints: {
          targetSkill: 'alarm-diagnosis',
        },
      },
    });

    const targetRecipeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/session-routing-constraints-schema/requests',
      payload: {
        inputText: 'diagnose OLT alarms',
        idempotencyKey: 'idem-routing-target-recipe-invalid',
        routingConstraints: {
          targetRecipe: 'ran-alarm-diagnosis',
        },
      },
    });

    expect(targetSkillResponse.statusCode).toBe(400);
    expect(targetSkillResponse.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(targetRecipeResponse.statusCode).toBe(400);
    expect(targetRecipeResponse.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(targetSkillResponse.body).not.toContain('requestId');
    expect(targetSkillResponse.body).not.toContain('targetSkill');
    expect(targetRecipeResponse.body).not.toContain('requestId');
    expect(targetRecipeResponse.body).not.toContain('targetRecipe');
    expect(submitted).toEqual([]);
    await app.close();
  });

  it('keeps non-sensitive unknown routing constraint field names in validation errors', async () => {
    const app = Fastify();
    await registerWebChannel(app, makeDependencies());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/session-routing-constraints-schema/requests',
      payload: {
        inputText: 'diagnose OLT alarms',
        idempotencyKey: 'idem-routing-non-sensitive-field-invalid',
        routingConstraints: {
          maxToolCalls: 2,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("Field 'maxToolCalls' is not allowed.");
    await app.close();
  });

  it('rejects forbidden override fields inside routingConstraints at the channel schema boundary', async () => {
    const validate = new Ajv({ allErrors: true }).compile(submitBody);

    expect(
      validate({
        inputText: 'diagnose OLT alarms',
        idempotencyKey: 'idem-routing-constraints-schema-invalid',
        routingConstraints: {
          tenantId: 'tenant-override',
          providerOverride: 'vendor-a',
          maxToolCalls: 2,
        },
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
        requestId: brand<string, 'MessageId'>('request-routing-constraints-schema-default'),
        runId: brand<string, 'RequestRunId'>('run-routing-constraints-schema-default'),
        attempt: 1,
      })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-routing-constraints-schema'),
      targetRequestId: brand<string, 'MessageId'>('request-routing-constraints-schema'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-routing-constraints-schema'),
      requestId: brand<string, 'MessageId'>('request-routing-constraints-schema'),
      runId: brand<string, 'RequestRunId'>('run-routing-constraints-schema'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-routing-constraints-schema'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-routing-constraints-schema'),
      status: 'RECEIVED' as const,
    })),
  };
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('tenant-routing-constraints-schema'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-constraints-schema'),
      agentId: brand<string, 'AgentId'>('agent-routing-constraints-schema'),
      sessionId: brand<string, 'SessionId'>('session-routing-constraints-schema'),
      title: 'Routing Constraints Schema',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async ({ sessionId }) => ({
      tenantId: brand<string, 'TenantId'>('tenant-routing-constraints-schema'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-constraints-schema'),
      agentId: brand<string, 'AgentId'>('agent-routing-constraints-schema'),
      sessionId,
      title: 'Routing Constraints Schema',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
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
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
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
      tenantId: brand<string, 'TenantId'>('tenant-routing-constraints-schema'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-constraints-schema'),
      displayName: 'Routing Constraints Schema',
    }),
    runtimeBootstrap: {
      transportKind: 'SSE' as const,
    },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('default-agent'),
  };
}
