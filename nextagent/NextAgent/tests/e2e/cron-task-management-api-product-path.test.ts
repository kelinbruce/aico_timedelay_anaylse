import { brand } from '@nextagent/agent-common';
import type { CronTaskGatewayPort } from '@nextagent/agent-contracts/gateway';
import { createLocalCronTaskScheduler } from '@nextagent/agent-platform-gateway-local';
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-cron-management-api');
const subjectId = brand<string, 'SubjectId'>('subject-cron-management-api');
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = { tenantId, subjectId, displayName: 'Cron management API e2e' };

describe('Cron task management API product path', () => {
  it('creates durable tasks that trigger standard runtime runs and excludes deleted tasks from due scan', async () => {
    let cronTasks: CronTaskGatewayPort | undefined;
    let scheduler: ReturnType<typeof createLocalCronTaskScheduler> | undefined;
    const app = createNextAgentTestApp({
      identity,
      modelSteps: [{ content: 'Cron management REST trigger completed.' }],
      cronTaskIdFactory: (() => {
        let index = 0;
        return () => `cron-rest-${++index}`;
      })(),
      cronTaskSchedulerFactory(input) {
        cronTasks = input.cronTasks;
        scheduler = createLocalCronTaskScheduler({
          ...input,
          now: () => Number.MAX_SAFE_INTEGER - 1,
          triggerIdFactory: ({ task }) => `trigger-${task.taskId}`,
        });
        return scheduler;
      },
    });

    try {
      const created = await app.server.inject({
        method: 'POST',
        url: '/api/v1/cron-tasks',
        payload: { cron: '* * * * *', prompt: 'Inspect 5GC registration failures.', recurring: false },
      });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({ taskId: 'cron-rest-1', status: 'ACTIVE' });
      const listed = await app.server.inject({ method: 'GET', url: '/api/v1/cron-tasks?offset=0&limit=50' });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({ tasks: [expect.objectContaining({ taskId: 'cron-rest-1' })], total: 1 });
      const task = await cronTasks!.loadTaskForAgent({ tenantId, subjectId, agentId, taskId: 'cron-rest-1' });
      expect(task).toBeDefined();

      await expect(scheduler!.runOnce()).resolves.toEqual({ deliveredCount: 1 });
      const trigger = await cronTasks!.loadTrigger({
        tenantId,
        subjectId,
        agentId,
        taskId: task!.taskId,
        triggerId: 'trigger-cron-rest-1',
      });
      expect(trigger?.status).toBe('ACCEPTED');
      expect(trigger?.requestRunId).toBeDefined();
      await waitForRunCompleted(app, trigger!.requestRunId!);
      const executions = await app.server.inject({ method: 'GET', url: '/api/v1/cron-tasks/cron-rest-1/runs' });
      expect(executions.statusCode).toBe(200);
      expect(executions.json()).toMatchObject({
        executions: [
          {
            triggerId: 'trigger-cron-rest-1',
            taskId: 'cron-rest-1',
            triggerStatus: 'ACCEPTED',
            requestRunId: trigger!.requestRunId,
            runStatus: 'COMPLETED',
            terminalCommitState: 'COMMITTED',
            resultEventType: 'REQUEST_COMPLETED',
            resultContent: 'Cron management REST trigger completed.',
          },
        ],
        total: 1,
      });

      const deletedTask = await app.server.inject({
        method: 'POST',
        url: '/api/v1/cron-tasks',
        payload: { cron: '* * * * *', prompt: 'Delete before due scan.', recurring: true },
      });
      expect(deletedTask.statusCode).toBe(200);
      await expect(app.server.inject({ method: 'DELETE', url: '/api/v1/cron-tasks/cron-rest-2' })).resolves.toMatchObject({ statusCode: 204 });
      await expect(cronTasks!.listDueTasks({ dueAtOrBefore: brand<number, 'EpochMillis'>(Number.MAX_SAFE_INTEGER), limit: 10 })).resolves.toEqual([]);
    } finally {
      await app.close();
    }
  });
});

async function waitForRunCompleted(app: ReturnType<typeof createNextAgentTestApp>, runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({ tenantId, subjectId, agentId, runId: brand<string, 'RequestRunId'>(runId) });
    if (run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for Cron management API run completion.');
}
