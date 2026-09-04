import { brand } from '@nextagent/agent-common';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import type { BackgroundTaskViewPort } from '@nextagent/agent-contracts/channel';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('background task routes', () => {
  it('returns background task list, output and kill DTOs', async () => {
    const app = Fastify();
    const backgroundTasks: BackgroundTaskViewPort = {
      list: vi.fn(async () => [
        {
          taskId: 'bg-1',
          commandName: 'bash',
          status: 'RUNNING' as const,
          startedAt: brand<number, 'EpochMillis'>(1000),
          stdoutRef: 'stdout:bg-1',
          stderrRef: 'stderr:bg-1',
        },
      ]),
      readOutput: vi.fn(async () => ({ content: 'ok', truncated: false })),
      kill: vi.fn(async () => ({ status: 'KILLED' as const })),
    };
    await registerWebChannel(app, makeDependencies({ backgroundTasks }));

    const list = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks' });
    expect(list.statusCode).toBe(200);
    expect(list.json().tasks[0]).toMatchObject({ taskId: 'bg-1', commandName: 'bash', status: 'RUNNING' });

    const output = await app.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks/bg-1/output?stream=stderr&limitBytes=10' });
    expect(output.statusCode).toBe(200);
    expect(output.json()).toEqual({ content: 'ok', truncated: false, stream: 'stderr' });
    expect(backgroundTasks.readOutput).toHaveBeenCalledWith('S1', 'bg-1', 'stderr', 10);

    const kill = await app.inject({ method: 'POST', url: '/api/v1/sessions/S1/background-tasks/bg-1/kill' });
    expect(kill.statusCode).toBe(200);
    expect(kill.json()).toEqual({ status: 'KILLED' });
    await app.close();
  });

  it('degrades gracefully (no 503) when the background task service is unavailable', async () => {
    const missingDependencyApp = Fastify();
    await registerWebChannel(missingDependencyApp, makeDependencies());
    // List: no service => empty list (200), so the UI can poll without error.
    const missingList = await missingDependencyApp.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks' });
    expect(missingList.statusCode).toBe(200);
    expect(missingList.json()).toEqual({ tasks: [] });

    // Output: no service => 404 (not 503).
    const missingOutput = await missingDependencyApp.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks/bg-1/output' });
    expect(missingOutput.statusCode).toBe(404);
    expect(missingOutput.json()).toEqual({
      error: {
        code: 'BACKGROUND_TASK_OUTPUT_UNAVAILABLE',
        message: 'Background task output is unavailable.',
      },
    });

    // Kill: no service => 404 (not 503).
    const missingKill = await missingDependencyApp.inject({ method: 'POST', url: '/api/v1/sessions/S1/background-tasks/bg-1/kill' });
    expect(missingKill.statusCode).toBe(404);
    expect(missingKill.json()).toEqual({
      error: {
        code: 'BACKGROUND_TASK_NOT_FOUND',
        message: 'Background task is unavailable.',
      },
    });
    await missingDependencyApp.close();

    const missingOutputApp = Fastify();
    await registerWebChannel(
      missingOutputApp,
      makeDependencies({
        backgroundTasks: {
          list: vi.fn(async () => []),
          readOutput: vi.fn(async () => ({ unavailable: true as const })),
          kill: vi.fn(async () => ({ status: 'NOT_FOUND' as const })),
        },
      }),
    );
    const missingOutputResult = await missingOutputApp.inject({ method: 'GET', url: '/api/v1/sessions/S1/background-tasks/bg-1/output' });
    expect(missingOutputResult.statusCode).toBe(404);
    expect(missingOutputResult.json()).toEqual({
      error: {
        code: 'BACKGROUND_TASK_OUTPUT_UNAVAILABLE',
        message: 'Background task output is unavailable.',
      },
    });
    await missingOutputApp.close();
  });
});

function makeDependencies(overrides: { readonly backgroundTasks?: BackgroundTaskViewPort } = {}) {
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
  return {
    runtime,
    sessions,
    ...(overrides.backgroundTasks ? { backgroundTasks: overrides.backgroundTasks } : {}),
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
