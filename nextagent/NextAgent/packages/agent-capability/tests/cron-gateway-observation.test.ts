import { createGatewayCronTaskPort, type CronTaskMutationObservation, type CronTaskScope } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { CronTaskGatewayPort, CronTaskRecord } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it, vi } from 'vitest';

const scope: CronTaskScope = {
  tenantId: brand<string, 'TenantId'>('tenant-cron'),
  subjectId: brand<string, 'SubjectId'>('subject-cron'),
  displayName: 'Cron Tester',
  agentId: brand<string, 'AgentId'>('agent-cron'),
  agentVersion: brand<string, 'AgentVersion'>('v3'),
  sessionId: brand<string, 'SessionId'>('session-cron'),
  requestRunId: brand<string, 'RequestRunId'>('run-cron'),
};

describe('gateway Cron task mutation observation', () => {
  it('rejects a new task at ACTIVE capacity before invoking durable create', async () => {
    const createTask = vi.fn(async (record: CronTaskRecord) => record);
    const port = createGatewayCronTaskPort({
      gateway: {
        countActiveTasksForAgent: async () => 50,
        createTask,
      } as unknown as CronTaskGatewayPort,
      idFactory: () => 'capacity-blocked',
      now: () => 1_700_000_000_000,
    });

    await expect(port.addTask({ scope, cron: '* * * * *', prompt: 'must not persist', recurring: true })).rejects.toMatchObject({
      code: 'CRON_TASK_LIMIT_REACHED',
      category: 'CONFLICT',
      retryable: false,
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('normalizes structured delay and freezes a minute-rounded target from one clock read', async () => {
    const createdAt = new Date(2026, 6, 22, 23, 55, 30).getTime();
    let reads = 0;
    let stored: CronTaskRecord | undefined;
    const port = createGatewayCronTaskPort({
      gateway: {
        countActiveTasksForAgent: async () => 0,
        async createTask(record: CronTaskRecord) {
          stored = record;
          return record;
        },
      } as unknown as CronTaskGatewayPort,
      idFactory: () => 'delay-task',
      now: () => {
        reads += 1;
        return createdAt;
      },
    });
    await port.addTask({ scope, delay: { hours: 1, minutes: 10 }, prompt: 'recheck', recurring: false });
    expect(reads).toBe(1);
    expect(stored).toMatchObject({ cron: '6 1 23 7 *', recurring: false, nextRunAt: new Date(2026, 6, 23, 1, 6, 0).getTime() });
  });

  it.each([{ minutes: 0 }, { minutes: 525_601 }, { hours: 8_761 }, { days: 1, hours: -1 }, { minutes: 1.5 }])(
    'rejects invalid total delay before durable write %#',
    async (delay) => {
      let writes = 0;
      const port = createGatewayCronTaskPort({
        gateway: {
          async createTask(record: CronTaskRecord) {
            writes += 1;
            return record;
          },
        } as unknown as CronTaskGatewayPort,
        now: () => 1_700_000_000_000,
      });
      await expect(port.addTask({ scope, delay, prompt: 'recheck', recurring: false })).rejects.toMatchObject({ code: 'CRON_DELAY_OUT_OF_RANGE' });
      expect(writes).toBe(0);
    },
  );

  it('emits only trusted scope and stable task references after durable create and delete', async () => {
    const observations: CronTaskMutationObservation[] = [];
    let stored: CronTaskRecord | undefined;
    const port = createGatewayCronTaskPort({
      gateway: {
        countActiveTasksForAgent: async () => 0,
        async createTask(record: CronTaskRecord) {
          stored = record;
          return record;
        },
        async deleteTask(request: { readonly taskId: string }) {
          const current = stored;
          if (current?.taskId === request.taskId) {
            stored = { ...current, status: 'DELETED' };
          }
          return stored;
        },
        async loadTask() {
          return stored;
        },
        async listTasks() {
          return stored === undefined ? [] : [stored];
        },
      } as unknown as CronTaskGatewayPort,
      idFactory: () => 'task-observed',
      now: () => 1_700_000_000_000,
      onTaskMutation: (observation) => observations.push(observation),
    });

    await expect(port.addTask({ scope, cron: '* * * * *', prompt: 'sensitive network prompt', recurring: true })).resolves.toBe('task-observed');
    await expect(port.removeTasks({ scope, ids: ['task-observed'] })).resolves.toBeUndefined();

    expect(observations).toEqual([
      { operation: 'CRON_TASK_CREATED', taskId: 'task-observed', scope },
      { operation: 'CRON_TASK_DELETED', taskId: 'task-observed', scope },
    ]);
    expect(JSON.stringify(observations)).not.toContain('sensitive network prompt');
  });

  it('does not fail a committed mutation when the advisory observer throws', async () => {
    const port = createGatewayCronTaskPort({
      gateway: {
        countActiveTasksForAgent: async () => 0,
        async createTask(record: CronTaskRecord) {
          return record;
        },
      } as unknown as CronTaskGatewayPort,
      idFactory: () => 'task-advisory',
      now: () => 1_700_000_000_000,
      onTaskMutation: () => {
        throw new Error('observer unavailable');
      },
    });

    await expect(port.addTask({ scope, cron: '* * * * *', prompt: 'must remain private', recurring: true })).resolves.toBe('task-advisory');
  });
});
