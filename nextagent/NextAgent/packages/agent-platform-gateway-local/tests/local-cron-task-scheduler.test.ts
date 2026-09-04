import { brand } from '@nextagent/agent-common';
import type { CronTaskRecord, CronTriggerRecord } from '@nextagent/agent-contracts/gateway';
import { createLocalCronTaskScheduler, createSqliteCronTaskGateway } from '@nextagent/agent-platform-gateway-local';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('local Cron task scheduler', () => {
  it('continues immediately when the default due-task batch is full', async () => {
    const sqliteFile = await tempDatabase();
    const gateway = createSqliteCronTaskGateway(sqliteFile);
    const raw = new DatabaseSync(sqliteFile);
    raw.exec('PRAGMA busy_timeout = 5000;');
    const insert = raw.prepare(
      `INSERT INTO cron_tasks(
        task_id, tenant_id, subject_id, agent_id, cron, prompt, target_kind, target_name, recurring, status,
        next_run_at, version, created_at, updated_at, created_by_name, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let index = 0; index < 101; index++) {
      const record = task(`cron-${index}`);
      insert.run(
        record.taskId,
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.cron,
        record.prompt,
        record.targetKind ?? null,
        record.targetName ?? null,
        record.recurring ? 1 : 0,
        record.status,
        record.nextRunAt,
        record.version,
        record.createdAt,
        record.updatedAt,
        record.createdByName ?? null,
        null,
      );
    }
    raw.close();
    const delivered: CronTriggerRecord[] = [];
    const scheduler = createLocalCronTaskScheduler({
      cronTasks: gateway,
      computeNextRunAt: (_cron, fromMs) => fromMs + 60_000,
      now: () => 2_000,
      triggerIdFactory: ({ task }) => `trigger-${task.taskId}`,
      delivery: {
        async deliver({ task, trigger }) {
          delivered.push(trigger);
          await gateway.bindCronTriggerRun({
            ...scope(),
            sessionId: brand<string, 'SessionId'>('session-1'),
            taskId: task.taskId,
            triggerId: trigger.triggerId,
            requestRunId: brand<string, 'RequestRunId'>(`run-${trigger.triggerId}`),
            acceptedAt: epoch(2_100),
          });
        },
      },
    });

    await expect(scheduler.runOnce()).resolves.toEqual({ deliveredCount: 101 });
    expect(delivered).toHaveLength(101);
    await expect(gateway.listDueTasks({ dueAtOrBefore: epoch(2_000), limit: 101 })).resolves.toHaveLength(0);
    gateway.close();
  });

  it('redelivers claimed triggers that were not bound before restart', async () => {
    const sqliteFile = await tempDatabase();
    const first = createSqliteCronTaskGateway(sqliteFile);
    await first.createTask(task('cron-retry'));
    await first.claimCronTrigger({
      ...scope(),
      taskId: 'cron-retry',
      triggerId: 'trigger-retry',
      scheduledAt: epoch(2_000),
      nextRunAt: epoch(62_000),
      claimedAt: epoch(2_001),
    });
    first.close();

    const second = createSqliteCronTaskGateway(sqliteFile);
    const delivered: CronTriggerRecord[] = [];
    const scheduler = createLocalCronTaskScheduler({
      cronTasks: second,
      computeNextRunAt: (_cron, fromMs) => fromMs + 60_000,
      now: () => 2_500,
      delivery: {
        async deliver({ task, trigger }) {
          delivered.push(trigger);
          await second.bindCronTriggerRun({
            ...scope(),
            sessionId: brand<string, 'SessionId'>('session-1'),
            taskId: task.taskId,
            triggerId: trigger.triggerId,
            requestRunId: brand<string, 'RequestRunId'>('run-retry'),
            acceptedAt: epoch(2_600),
          });
        },
      },
    });

    await expect(scheduler.runOnce()).resolves.toEqual({ deliveredCount: 1 });
    expect(delivered).toMatchObject([{ triggerId: 'trigger-retry' }]);
    await expect(second.listClaimedTriggers({ limit: 10 })).resolves.toEqual([]);
    second.close();
  });

  it('stops the lifecycle timer before new delivery starts', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    await gateway.createTask(task('cron-stop'));
    const delivered: CronTriggerRecord[] = [];
    const scheduler = createLocalCronTaskScheduler({
      cronTasks: gateway,
      computeNextRunAt: (_cron, fromMs) => fromMs + 60_000,
      now: () => 2_000,
      cadenceMs: 50,
      delivery: {
        async deliver({ trigger }) {
          delivered.push(trigger);
        },
      },
    });

    scheduler.start();
    await scheduler.stop();
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(delivered).toEqual([]);
    gateway.close();
  });
});

function task(taskId: string): CronTaskRecord {
  return {
    ...scope(),
    taskId,
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

function scope() {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
  };
}

function epoch(value: number) {
  return brand<number, 'EpochMillis'>(value);
}

async function tempDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-cron-scheduler-'));
  directories.push(directory);
  return join(directory, 'gateway.sqlite');
}
