import { brand } from '@nextagent/agent-common';
import { registerWebChannel, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import type { GuardrailGatewayPort, GuardrailCheckQuestionResult } from '@nextagent/agent-contracts/gateway';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

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

function makeRuntime(): RuntimeCommandPort {
  return {
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

function makeDependencies(
  runtime: RuntimeCommandPort,
  guardrail: GuardrailGatewayPort | undefined,
  guardrailEnabled: boolean,
): WebChannelDependencies {
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => session()),
    requireSession: vi.fn(async () => session()),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: session(brand<string, 'SessionId'>('child-1')) })),
    forkFromRequest: vi.fn(async () => ({ childSession: session(brand<string, 'SessionId'>('child-1')) })),
    listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({ sessionId: brand<string, 'SessionId'>('S1'), totalMarkers: 0, offset: 0, limit: 50, markers: [] })),
    updateTitle: vi.fn(async () => session()),
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
    ...(guardrail === undefined ? {} : { guardrail }),
    guardrailEnabled,
  };
}

function makeStubGuardrail(result: GuardrailCheckQuestionResult): GuardrailGatewayPort {
  return {
    checkQuestion: vi.fn(async () => result),
    checkNl2Python: vi.fn(async () => ({ status: true, errorMsg: [] })),
    checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkKnowledge: vi.fn(async () => ({ isLegal: true })),
  };
}

describe('submit guard-forward', () => {
  it('routes an input-guard-blocked round through runtime.submit with guardBlockRefusal', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    const guardrail = makeStubGuardrail({
      isLegal: false,
      refusalMessage: '请修改输入',
    });
    await registerWebChannel(app, makeDependencies(runtime, guardrail, true));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-block-1' },
    });

    // No HTTP 400 — the guard round is a normal submit that the runtime
    // terminalizes as COMPLETED without invoking the model.
    expect(response.statusCode).toBe(200);
    expect(guardrail.checkQuestion).toHaveBeenCalledTimes(1);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
    const command = (runtime.submit as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(command.inputText).toBe('hello');
    expect(command.guardBlockRefusal).toBe('请修改输入');
    expect(command.idempotencyKey).toBe(brand<string, 'IdempotencyKey'>('idem-block-1'));
    await app.close();
  });

  it('proceeds to runtime.submit when input passes the guard', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    const guardrail = makeStubGuardrail({ isLegal: true, refusalMessage: '' });
    await registerWebChannel(app, makeDependencies(runtime, guardrail, true));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-2' },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
    expect(guardrail.checkQuestion).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('skips the guard when guardrailEnabled is false', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    const guardrail = makeStubGuardrail({ isLegal: false, refusalMessage: 'blocked' });
    await registerWebChannel(app, makeDependencies(runtime, guardrail, false));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-3' },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
    expect(guardrail.checkQuestion).not.toHaveBeenCalled();
    await app.close();
  });

  it('skips the guard when no guardrail binding is present', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(app, makeDependencies(runtime, undefined, true));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-4' },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('projects guardrail enabled state on the runtime bootstrap', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    const deps = makeDependencies(runtime, undefined, false);
    await registerWebChannel(app, { ...deps, runtimeBootstrap: { transportKind: 'SSE', guardrail: { enabled: true } } });

    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.json().guardrail).toEqual({ enabled: true });
    await app.close();
  });

  it('omits guardrail from bootstrap when no guardrail state is configured', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(app, makeDependencies(runtime, undefined, false));

    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.json().guardrail).toBeUndefined();
    await app.close();
  });
});
