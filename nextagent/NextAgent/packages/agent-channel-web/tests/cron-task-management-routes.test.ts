import { AgentError, brand } from '@nextagent/agent-common';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import type { CronTaskExecutionView, CronTaskManagementPort, CronTaskManagementView } from '@nextagent/agent-contracts/channel';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('Cron task management routes', () => {
  it('returns create, list, update and delete DTOs without scope internals', async () => {
    const app = Fastify();
    const cronTaskManagement: CronTaskManagementPort = {
      listCronTasks: vi.fn(async () => ({
        tasks: [view({ prompt: 'Check AMF alarms', target: { kind: 'WORKFLOW', name: 'daily-report' } })],
        total: 1,
      })),
      listCronTaskExecutions: vi.fn(async () => ({ executions: [executionView()], total: 1 })),
      createCronTask: vi.fn(async (command) =>
        view({ cron: command.cron, prompt: command.prompt, target: command.target, recurring: command.recurring ?? true }),
      ),
      updateCronTask: vi.fn(async (command) =>
        view({
          taskId: command.taskId,
          cron: command.cron ?? '0 9 * * *',
          prompt: command.prompt ?? 'Check AMF alarms',
          target: command.target === null ? undefined : command.target,
          recurring: command.recurring ?? true,
        }),
      ),
      deleteCronTask: vi.fn(async () => undefined),
      executeCronTask: vi.fn(async () => executionView({ triggerId: 'trigger-now' })),
    };
    await registerWebChannel(app, makeDependencies({ cronTaskManagement }));

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks',
      payload: { cron: '*/5 * * * *', prompt: 'Check LTE handover failures', target: { kind: 'SKILL', name: 'ran-diagnosis' }, recurring: false },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      taskId: 'cron-1',
      cron: '*/5 * * * *',
      prompt: 'Check LTE handover failures',
      target: { kind: 'SKILL', name: 'ran-diagnosis' },
      recurring: false,
      createdByName: 'Test User',
    });

    const listed = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks?offset=5&limit=25' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ tasks: [view({ prompt: 'Check AMF alarms', target: { kind: 'WORKFLOW', name: 'daily-report' } })], total: 1 });
    expect(listed.json().tasks[0]).toMatchObject({ createdByName: 'Test User' });
    expect(cronTaskManagement.listCronTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext: expect.objectContaining({ tenantId: 'T1', subjectId: 'U1' }),
        agentId: 'agent-1',
        offset: 5,
        limit: 25,
      }),
      expect.any(AbortSignal),
    );
    expect(Object.keys(listed.json().tasks[0])).not.toEqual(
      expect.arrayContaining(['tenantId', 'subjectId', 'sessionId', 'runId', 'version', 'triggerId']),
    );

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/cron-tasks/cron-1',
      payload: { prompt: 'Updated check', target: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ taskId: 'cron-1', prompt: 'Updated check' });
    expect(cronTaskManagement.updateCronTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'cron-1',
        prompt: 'Updated check',
        target: null,
      }),
      expect.any(AbortSignal),
    );

    const executions = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks/cron-1/runs?offset=10&limit=25' });
    expect(executions.statusCode).toBe(200);
    expect(executions.json()).toEqual({ executions: [executionView()], total: 1 });
    expect(cronTaskManagement.listCronTaskExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext: expect.objectContaining({ tenantId: 'T1', subjectId: 'U1' }),
        agentId: 'agent-1',
        taskId: 'cron-1',
        offset: 10,
        limit: 25,
      }),
      expect.any(AbortSignal),
    );

    const executed = await app.inject({ method: 'POST', url: '/api/v1/cron-tasks/cron-1/runs' });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ triggerId: 'trigger-now', taskId: 'cron-1' });
    expect(cronTaskManagement.executeCronTask).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext: expect.objectContaining({ tenantId: 'T1', subjectId: 'U1' }),
        agentId: 'agent-1',
        taskId: 'cron-1',
      }),
      expect.any(AbortSignal),
    );

    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/cron-tasks/cron-1' });
    expect(deleted.statusCode).toBe(204);
    expect(cronTaskManagement.createCronTask).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext: expect.objectContaining({ tenantId: 'T1', subjectId: 'U1' }),
        agentId: 'agent-1',
        cron: '*/5 * * * *',
        prompt: 'Check LTE handover failures',
        target: { kind: 'SKILL', name: 'ran-diagnosis' },
        recurring: false,
      }),
      expect.any(AbortSignal),
    );
    await app.close();
  });

  it('rejects forbidden scope fields before invoking the management port', async () => {
    const app = Fastify();
    const cronTaskManagement: CronTaskManagementPort = {
      listCronTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
      listCronTaskExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
      createCronTask: vi.fn(async () => view()),
      updateCronTask: vi.fn(async () => view()),
      deleteCronTask: vi.fn(async () => undefined),
      executeCronTask: vi.fn(async () => executionView()),
    };
    await registerWebChannel(app, makeDependencies({ cronTaskManagement }));

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks',
      payload: { cron: '0 9 * * *', prompt: 'Daily', tenantId: 'evil' },
    });
    const query = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks?agentId=evil' });
    const update = await app.inject({
      method: 'PUT',
      url: '/api/v1/cron-tasks/cron-1',
      payload: { prompt: 'Daily', status: 'DELETED' },
    });
    const execute = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks/cron-1/runs',
      payload: { agentId: 'evil' },
    });
    const smuggledRouting = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks',
      payload: { cron: '0 9 * * *', prompt: 'Daily', routingConstraints: { targetSkill: 'evil' } },
    });
    const invalidTarget = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks',
      payload: { cron: '0 9 * * *', prompt: 'Daily', target: { kind: 'AGENT', name: 'evil' } },
    });

    expect(create.statusCode).toBe(400);
    expect(query.statusCode).toBe(400);
    expect(update.statusCode).toBe(400);
    expect(execute.statusCode).toBe(400);
    expect(smuggledRouting.statusCode).toBe(400);
    expect(invalidTarget.statusCode).toBe(400);
    expect(cronTaskManagement.createCronTask).not.toHaveBeenCalled();
    expect(cronTaskManagement.updateCronTask).not.toHaveBeenCalled();
    expect(cronTaskManagement.executeCronTask).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not accept createdByName from the request body and returns null for legacy tasks', async () => {
    const app = Fastify();
    const cronTaskManagement: CronTaskManagementPort = {
      listCronTasks: vi.fn(async () => ({
        tasks: [(({ createdByName: _, ...rest }) => rest)(view())],
        total: 1,
      })),
      listCronTaskExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
      createCronTask: vi.fn(async (command) => view({ cron: command.cron, prompt: command.prompt })),
      updateCronTask: vi.fn(async () => view()),
      deleteCronTask: vi.fn(async () => undefined),
      executeCronTask: vi.fn(async () => executionView()),
    };
    await registerWebChannel(app, makeDependencies({ cronTaskManagement }));

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks',
      payload: { cron: '0 9 * * *', prompt: 'Daily', createdByName: 'Attacker' },
    });
    expect(created.statusCode).toBe(400);
    expect(cronTaskManagement.createCronTask).not.toHaveBeenCalled();

    const listed = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().tasks[0].createdByName).toBeNull();

    await app.close();
  });

  it('rejects Cron execution pages larger than 50 before invoking the management port', async () => {
    const app = Fastify();
    const cronTaskManagement: CronTaskManagementPort = {
      listCronTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
      listCronTaskExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
      createCronTask: vi.fn(async () => view()),
      updateCronTask: vi.fn(async () => view()),
      deleteCronTask: vi.fn(async () => undefined),
      executeCronTask: vi.fn(async () => executionView()),
    };
    await registerWebChannel(app, makeDependencies({ cronTaskManagement }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks/cron-1/runs?limit=51' });

    expect(response.statusCode).toBe(400);
    expect(cronTaskManagement.listCronTaskExecutions).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects Cron task list pages larger than 50 before invoking the management port', async () => {
    const app = Fastify();
    const cronTaskManagement: CronTaskManagementPort = {
      listCronTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
      listCronTaskExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
      createCronTask: vi.fn(async () => view()),
      updateCronTask: vi.fn(async () => view()),
      deleteCronTask: vi.fn(async () => undefined),
      executeCronTask: vi.fn(async () => executionView()),
    };
    await registerWebChannel(app, makeDependencies({ cronTaskManagement }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks?limit=51' });

    expect(response.statusCode).toBe(400);
    expect(cronTaskManagement.listCronTasks).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns safe unavailable error when the management port is missing', async () => {
    const app = Fastify();
    await registerWebChannel(app, makeDependencies());

    const response = await app.inject({ method: 'GET', url: '/api/v1/cron-tasks' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'CRON_TASKS_UNAVAILABLE',
        message: 'Cron task management service is unavailable.',
      },
    });
    await app.close();
  });

  it('projects ACTIVE task capacity conflicts as a safe 409 error', async () => {
    const app = Fastify();
    const cronTaskManagement: CronTaskManagementPort = {
      listCronTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
      listCronTaskExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
      createCronTask: vi.fn(async () => {
        throw new AgentError({
          code: 'CRON_TASK_LIMIT_REACHED',
          message: 'Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.',
          category: 'CONFLICT',
          retryable: false,
        });
      }),
      updateCronTask: vi.fn(async () => view()),
      deleteCronTask: vi.fn(async () => undefined),
      executeCronTask: vi.fn(async () => executionView()),
    };
    await registerWebChannel(app, makeDependencies({ cronTaskManagement }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/cron-tasks',
      payload: { cron: '0 9 * * *', prompt: 'Capacity blocked task' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'CRON_TASK_LIMIT_REACHED',
        message: 'Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.',
      },
    });
    expect(response.body).not.toMatch(/T1|U1|agent-1|SQLite|sqlite|stack|C:\\|\//u);
    await app.close();
  });
});

function makeDependencies(overrides: { readonly cronTaskManagement?: CronTaskManagementPort } = {}) {
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
    ...(overrides.cronTaskManagement === undefined ? {} : { cronTaskManagement: overrides.cronTaskManagement }),
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'Test User' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-1'),
  };
}

function view(overrides: Partial<CronTaskManagementView> = {}): CronTaskManagementView {
  return {
    taskId: 'cron-1',
    cron: '0 9 * * *',
    humanSchedule: 'Every day at 9:00 AM',
    prompt: 'Check AMF alarms',
    recurring: true,
    status: 'ACTIVE' as const,
    createdAt: brand<number, 'EpochMillis'>(1_000),
    updatedAt: brand<number, 'EpochMillis'>(1_000),
    nextRunAt: brand<number, 'EpochMillis'>(60_000),
    createdByName: 'Test User',
    ...overrides,
  };
}

function executionView(overrides: Partial<CronTaskExecutionView> = {}): CronTaskExecutionView {
  return {
    triggerId: 'trigger-1',
    taskId: 'cron-1',
    scheduledAt: brand<number, 'EpochMillis'>(2_000),
    triggerStatus: 'ACCEPTED',
    createdAt: brand<number, 'EpochMillis'>(2_001),
    updatedAt: brand<number, 'EpochMillis'>(2_050),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestRunId: brand<string, 'RequestRunId'>('run-1'),
    runStatus: 'COMPLETED',
    terminalCommitState: 'COMMITTED',
    resultEventType: 'REQUEST_COMPLETED',
    resultContent: 'Cron result',
    resultAt: brand<number, 'EpochMillis'>(2_060),
    ...overrides,
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
