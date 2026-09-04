import { brand } from '@nextagent/agent-common';
import type { CronTaskRecord } from '@nextagent/agent-contracts/gateway';
import { createSqliteCronTaskGateway } from '@nextagent/agent-platform-gateway-local';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SQLite Cron task gateway', () => {
  it('persists scoped tasks across gateway restarts', async () => {
    const sqliteFile = await tempDatabase();
    const first = createSqliteCronTaskGateway(sqliteFile);
    await first.createTask(task());
    first.close();

    const second = createSqliteCronTaskGateway(sqliteFile);
    await expect(second.listTasks(scope())).resolves.toMatchObject([{ taskId: 'cron-1', agentId: 'agent-1' }]);
    await expect(second.listTasks(scope({ subjectId: 'subject-other' }))).resolves.toEqual([]);
    second.close();
  });

  it('migrates legacy session-scoped Cron tables to owner and agent task scope', async () => {
    const sqliteFile = await tempDatabase();
    const db = new DatabaseSync(sqliteFile);
    db.exec(`CREATE TABLE cron_tasks (
      task_id TEXT NOT NULL, tenant_id TEXT NOT NULL, subject_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL, cron TEXT NOT NULL, prompt TEXT NOT NULL, recurring INTEGER NOT NULL,
      status TEXT NOT NULL, next_run_at INTEGER NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, idempotency_key TEXT,
      PRIMARY KEY(tenant_id, subject_id, agent_id, session_id, task_id)
    );
    CREATE TABLE cron_triggers (
      trigger_id TEXT NOT NULL, task_id TEXT NOT NULL, tenant_id TEXT NOT NULL, subject_id TEXT NOT NULL,
      agent_id TEXT NOT NULL, session_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL, status TEXT NOT NULL,
      request_run_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(tenant_id, subject_id, agent_id, session_id, task_id, trigger_id),
      FOREIGN KEY(tenant_id, subject_id, agent_id, session_id, task_id)
        REFERENCES cron_tasks(tenant_id, subject_id, agent_id, session_id, task_id)
    );
    INSERT INTO cron_tasks(task_id, tenant_id, subject_id, agent_id, session_id, cron, prompt, recurring, status, next_run_at, version, created_at, updated_at, idempotency_key)
      VALUES ('cron-legacy', 'tenant-1', 'subject-1', 'agent-1', 'session-legacy', '* * * * *', 'Legacy task', 1, 'ACTIVE', 2000, 1, 1000, 1000, 'legacy-create');
    INSERT INTO cron_triggers(trigger_id, task_id, tenant_id, subject_id, agent_id, session_id, scheduled_at, status, request_run_id, created_at, updated_at)
      VALUES ('trigger-legacy', 'cron-legacy', 'tenant-1', 'subject-1', 'agent-1', 'session-legacy', 2000, 'ACCEPTED', 'run-legacy', 1001, 1002);`);
    db.close();

    const gateway = createSqliteCronTaskGateway(sqliteFile);
    await expect(gateway.listTasks(scope())).resolves.toMatchObject([{ taskId: 'cron-legacy', agentId: 'agent-1' }]);
    const migratedTask = await gateway.loadTask({ ...scope(), taskId: 'cron-legacy' });
    expect(migratedTask).not.toHaveProperty('sessionId');
    await expect(gateway.loadTrigger({ ...scope(), taskId: 'cron-legacy', triggerId: 'trigger-legacy' })).resolves.toMatchObject({
      sessionId: 'session-legacy',
      requestRunId: 'run-legacy',
    });
    await expect(gateway.createTask({ ...task(), taskId: 'cron-created-after-migration' })).resolves.toMatchObject({
      taskId: 'cron-created-after-migration',
    });
    gateway.close();
  });

  it('returns the first task for a repeated scoped idempotency key', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const first = await gateway.createTask(task(), { idempotencyKey: brand<string, 'IdempotencyKey'>('create-1') });
    const replay = await gateway.createTask(
      { ...task(), taskId: 'cron-2', prompt: 'different' },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('create-1') },
    );
    expect(replay).toEqual(first);
    await expect(gateway.listTasks(scope())).resolves.toHaveLength(1);
    gateway.close();
  });

  it('counts only ACTIVE tasks for an agent scope', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    await gateway.createTask(task());
    await gateway.createTask({ ...task(), taskId: 'cron-completed', prompt: 'completed task', status: 'COMPLETED' });
    await gateway.createTask({ ...task(), taskId: 'cron-deleted', prompt: 'deleted task' });
    await gateway.deleteTask({ ...scope(), taskId: 'cron-deleted' });

    await expect(gateway.countActiveTasksForAgent(scope())).resolves.toBe(1);
    await expect(gateway.countTasksForAgent(scope())).resolves.toBe(2);
    await expect(gateway.countTasksForAgent({ ...scope(), includeDeleted: true })).resolves.toBe(3);
    gateway.close();
  });

  it('accepts one queued 50th ACTIVE task and rejects the other without side effects', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    for (let index = 0; index < 49; index += 1) {
      await gateway.createTask({ ...task(), taskId: `cron-before-${index}` });
    }
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(49);

    const results = await Promise.allSettled([
      gateway.createTask({ ...task(), taskId: 'cron-50th-a' }),
      gateway.createTask({ ...task(), taskId: 'cron-50th-b' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({
      code: 'CRON_TASK_LIMIT_REACHED',
      category: 'CONFLICT',
      retryable: false,
    });
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(50);
    await expect(gateway.listTasks(scope())).resolves.toHaveLength(50);
    gateway.close();
  });

  it('releases capacity when tasks are deleted or complete', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    for (let index = 0; index < 50; index += 1) {
      await gateway.createTask({ ...task(), taskId: `cron-release-${index}`, recurring: false });
    }
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(50);

    await gateway.deleteTask({ ...scope(), taskId: 'cron-release-0' });
    await expect(gateway.createTask({ ...task(), taskId: 'cron-after-delete' })).resolves.toMatchObject({
      taskId: 'cron-after-delete',
    });

    await gateway.claimCronTrigger({
      ...scope(),
      taskId: 'cron-release-1',
      triggerId: 'trigger-release-1',
      scheduledAt: epoch(2_000),
      claimedAt: epoch(2_001),
    });
    expect((await gateway.loadTask({ ...scope(), taskId: 'cron-release-1' }))?.status).toBe('COMPLETED');
    await expect(gateway.createTask({ ...task(), taskId: 'cron-after-complete' })).resolves.toMatchObject({
      taskId: 'cron-after-complete',
    });
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(50);
    gateway.close();
  });

  it('keeps ACTIVE capacity isolated by owner and agent scope', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    for (let index = 0; index < 50; index += 1) {
      await gateway.createTask({ ...task(), taskId: `cron-scoped-${index}` });
    }

    await expect(
      gateway.createTask({ ...task(), subjectId: brand<string, 'SubjectId'>('subject-other'), taskId: 'cron-other-subject' }),
    ).resolves.toMatchObject({ taskId: 'cron-other-subject' });
    await expect(
      gateway.createTask({ ...task(), agentId: brand<string, 'AgentId'>('agent-other'), taskId: 'cron-other-agent' }),
    ).resolves.toMatchObject({ taskId: 'cron-other-agent' });
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(50);
    gateway.close();
  });

  it('returns the first fact for an idempotency replay when the scope is at capacity', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const first = await gateway.createTask(task(), { idempotencyKey: brand<string, 'IdempotencyKey'>('create-at-limit') });
    for (let index = 1; index < 50; index += 1) {
      await gateway.createTask({ ...task(), taskId: `cron-replay-${index}` });
    }
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(50);

    const replay = await gateway.createTask(
      { ...task(), taskId: 'cron-replay-overflow', prompt: 'different' },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('create-at-limit') },
    );
    expect(replay).toEqual(first);
    expect(await gateway.countActiveTasksForAgent(scope())).toBe(50);
    await expect(gateway.listTasks(scope())).resolves.toHaveLength(50);
    gateway.close();
  });

  it('scopes task and trigger anchors by owner and agent', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    await gateway.createTask(task());
    await gateway.createTask({ ...task(), taskId: 'cron-2', prompt: 'second task', createdAt: epoch(2_000), updatedAt: epoch(2_000) });

    await expect(gateway.listTasks(scope())).resolves.toMatchObject([{ taskId: 'cron-2' }, { taskId: 'cron-1' }]);
    await expect(gateway.listTasks(scope({ subjectId: 'subject-other' }))).resolves.toEqual([]);

    const firstClaim = await gateway.claimCronTrigger({
      ...scope(),
      taskId: 'cron-1',
      triggerId: 'trigger-1',
      scheduledAt: epoch(2_000),
      nextRunAt: epoch(3_000),
      claimedAt: epoch(2_001),
    });
    const replayClaim = await gateway.claimCronTrigger({
      ...scope(),
      taskId: 'cron-1',
      triggerId: 'trigger-2',
      scheduledAt: epoch(2_000),
      nextRunAt: epoch(3_000),
      claimedAt: epoch(2_001),
    });

    expect(firstClaim.status).toBe('CLAIMED');
    expect(replayClaim.status).toBe('ALREADY_CLAIMED');
    expect(firstClaim.trigger?.sessionId).toBeUndefined();
    await expect(gateway.loadTriggerDelivery({ taskId: 'cron-1', triggerId: 'trigger-1' })).resolves.toMatchObject({
      trigger: { taskId: 'cron-1', triggerId: 'trigger-1' },
    });

    await expect(
      gateway.bindCronTriggerRun({
        ...scope(),
        sessionId: brand<string, 'SessionId'>('session-exec-1'),
        taskId: 'cron-1',
        triggerId: 'trigger-1',
        requestRunId: brand<string, 'RequestRunId'>('run-1'),
        acceptedAt: epoch(2_002),
      }),
    ).resolves.toMatchObject({ status: 'BOUND' });
    const acceptedTrigger = await gateway.loadTrigger({ ...scope(), taskId: 'cron-1', triggerId: 'trigger-1' });
    expect(acceptedTrigger?.sessionId).toBe('session-exec-1');
    expect(acceptedTrigger?.requestRunId).toBe('run-1');
    await expect(gateway.listTriggersForTask({ ...scope(), taskId: 'cron-1' })).resolves.toMatchObject([
      { taskId: 'cron-1', triggerId: 'trigger-1', status: 'ACCEPTED', sessionId: 'session-exec-1', requestRunId: 'run-1' },
    ]);
    await expect(gateway.listTriggersForTask({ ...scope(), taskId: 'cron-1', offset: 0, limit: 1 })).resolves.toMatchObject([
      { taskId: 'cron-1', triggerId: 'trigger-1' },
    ]);
    await expect(gateway.countTriggersForTask({ ...scope(), taskId: 'cron-1' })).resolves.toBe(1);
    await expect(gateway.listTriggersForTask({ ...scope({ subjectId: 'subject-other' }), taskId: 'cron-1' })).resolves.toEqual([]);
    await expect(gateway.countTriggersForTask({ ...scope({ subjectId: 'subject-other' }), taskId: 'cron-1' })).resolves.toBe(0);
    gateway.close();
  });

  it('lists and loads non-deleted tasks for an agent scope', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    await gateway.createTask(task());
    await gateway.createTask({ ...task(), taskId: 'cron-2', prompt: 'second task', createdAt: epoch(2_000), updatedAt: epoch(2_000) });
    await gateway.deleteTask({ ...scope(), taskId: 'cron-2' });

    await expect(
      gateway.listTasksForAgent({ tenantId: scope().tenantId, subjectId: scope().subjectId, agentId: scope().agentId }),
    ).resolves.toMatchObject([{ taskId: 'cron-1' }]);
    await expect(
      gateway.listTasksForAgent({ tenantId: scope().tenantId, subjectId: scope().subjectId, agentId: scope().agentId, includeDeleted: true }),
    ).resolves.toMatchObject([
      { taskId: 'cron-2', status: 'DELETED' },
      { taskId: 'cron-1', status: 'ACTIVE' },
    ]);
    await expect(
      gateway.listTasksForAgent({
        tenantId: scope().tenantId,
        subjectId: scope().subjectId,
        agentId: scope().agentId,
        includeDeleted: true,
        offset: 1,
        limit: 1,
      }),
    ).resolves.toMatchObject([{ taskId: 'cron-1', status: 'ACTIVE' }]);
    await expect(gateway.countTasksForAgent({ tenantId: scope().tenantId, subjectId: scope().subjectId, agentId: scope().agentId })).resolves.toBe(1);
    await expect(
      gateway.countTasksForAgent({ tenantId: scope().tenantId, subjectId: scope().subjectId, agentId: scope().agentId, includeDeleted: true }),
    ).resolves.toBe(2);
    await expect(
      gateway.loadTaskForAgent({ tenantId: scope().tenantId, subjectId: scope().subjectId, agentId: scope().agentId, taskId: 'cron-1' }),
    ).resolves.toMatchObject({ taskId: 'cron-1' });
    await expect(
      gateway.loadTaskForAgent({ tenantId: scope().tenantId, subjectId: scope().subjectId, agentId: scope().agentId, taskId: 'cron-2' }),
    ).resolves.toBeUndefined();
    gateway.close();
  });

  it('updates active tasks with CAS and preserves deleted tasks', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const created = await gateway.createTask(task());
    const updated = await gateway.updateTask(
      {
        ...created,
        cron: '*/5 * * * *',
        prompt: 'Updated telecom alarm check',
        recurring: false,
        nextRunAt: epoch(62_000),
        version: created.version + 1,
        updatedAt: epoch(2_500),
      },
      { expectedVersion: created.version },
    );

    expect(updated).toMatchObject({
      taskId: 'cron-1',
      cron: '*/5 * * * *',
      prompt: 'Updated telecom alarm check',
      recurring: false,
      nextRunAt: 62_000,
      version: 2,
    });
    await expect(
      gateway.updateTask({ ...created, prompt: 'stale', version: created.version + 1 }, { expectedVersion: created.version }),
    ).resolves.toBeUndefined();
    await gateway.deleteTask({ ...scope(), taskId: 'cron-1' });
    await expect(gateway.updateTask({ ...created, prompt: 'deleted' })).resolves.toBeUndefined();
    await expect(gateway.listDueTasks({ dueAtOrBefore: epoch(62_000), limit: 10 })).resolves.toEqual([]);
    gateway.close();
  });

  it('claims one trigger per scoped task and scheduled time', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    await gateway.createTask(task());
    const request = {
      ...scope(),
      taskId: 'cron-1',
      triggerId: 'trigger-1',
      scheduledAt: epoch(2_000),
      nextRunAt: epoch(3_000),
      claimedAt: epoch(2_001),
    };
    const first = await gateway.claimCronTrigger(request);
    const replay = await gateway.claimCronTrigger({ ...request, triggerId: 'trigger-2' });
    expect(first.status).toBe('CLAIMED');
    expect(replay.status).toBe('ALREADY_CLAIMED');
    expect(replay.trigger?.triggerId).toBe('trigger-1');
    await expect(gateway.loadTriggerDelivery({ taskId: 'cron-1', triggerId: 'trigger-1' })).resolves.toMatchObject({
      task: { taskId: 'cron-1', tenantId: 'tenant-1', subjectId: 'subject-1', agentId: 'agent-1' },
      trigger: { taskId: 'cron-1', triggerId: 'trigger-1', tenantId: 'tenant-1', subjectId: 'subject-1', agentId: 'agent-1' },
    });
    await expect(gateway.loadTriggerDelivery({ taskId: 'cron-1', triggerId: 'trigger-missing' })).resolves.toBeUndefined();
    gateway.close();
  });

  it('completes one-shot tasks and binds a trigger to only one request run', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    await gateway.createTask({ ...task(), recurring: false });
    const claimed = await gateway.claimCronTrigger({
      ...scope(),
      taskId: 'cron-1',
      triggerId: 'trigger-1',
      scheduledAt: epoch(2_000),
      claimedAt: epoch(2_001),
    });
    expect(claimed.task?.status).toBe('COMPLETED');
    const first = await gateway.bindCronTriggerRun({
      ...scope(),
      sessionId: brand<string, 'SessionId'>('session-exec-1'),
      taskId: 'cron-1',
      triggerId: 'trigger-1',
      requestRunId: brand<string, 'RequestRunId'>('run-1'),
      acceptedAt: epoch(2_002),
    });
    const replay = await gateway.bindCronTriggerRun({
      ...scope(),
      sessionId: brand<string, 'SessionId'>('session-exec-1'),
      taskId: 'cron-1',
      triggerId: 'trigger-1',
      requestRunId: brand<string, 'RequestRunId'>('run-1'),
      acceptedAt: epoch(2_003),
    });
    const conflict = await gateway.bindCronTriggerRun({
      ...scope(),
      sessionId: brand<string, 'SessionId'>('session-exec-2'),
      taskId: 'cron-1',
      triggerId: 'trigger-1',
      requestRunId: brand<string, 'RequestRunId'>('run-2'),
      acceptedAt: epoch(2_004),
    });
    expect(first.status).toBe('BOUND');
    expect(replay.status).toBe('ALREADY_BOUND');
    expect(conflict.status).toBe('RUN_CONFLICT');
    gateway.close();
  });
});

function task(): CronTaskRecord {
  return {
    ...scope(),
    taskId: 'cron-1',
    cron: '* * * * *',
    prompt: 'Check telecom alarms',
    recurring: true,
    status: 'ACTIVE',
    nextRunAt: epoch(2_000),
    version: 1,
    createdAt: epoch(1_000),
    updatedAt: epoch(1_000),
  };
}

function scope(overrides: { subjectId?: string } = {}) {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>(overrides.subjectId ?? 'subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
  };
}

function epoch(value: number) {
  return brand<number, 'EpochMillis'>(value);
}

async function tempDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-cron-'));
  directories.push(directory);
  return join(directory, 'gateway.sqlite');
}
