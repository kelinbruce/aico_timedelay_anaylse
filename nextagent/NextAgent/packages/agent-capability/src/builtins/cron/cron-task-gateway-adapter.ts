import {
  AgentError,
  CRON_MAX_TASKS_PER_SCOPE,
  brand,
  cronTaskLimitReachedError,
  type EpochMillis,
  type IdempotencyKey,
} from '@nextagent/agent-common';
import type { CronTaskGatewayPort, CronTaskRecord as GatewayCronTaskRecord } from '@nextagent/agent-contracts/gateway';
import { randomUUID } from 'node:crypto';
import type { CronDelay, CronTaskMutationObservation, CronTaskPort, CronTaskRecord, CronTaskScope } from '../../tools/tool-spi.js';
import { cronToHuman, nextCronRunMs } from './cron-expression.js';
import { cronDelayMaxMinutes } from './cron-schemas.js';

export interface GatewayCronTaskPortOptions {
  readonly gateway: CronTaskGatewayPort;
  readonly now?: () => number;
  readonly idFactory?: () => string;
  readonly onTaskMutation?: (observation: CronTaskMutationObservation) => void;
}

export function createGatewayCronTaskPort(options: GatewayCronTaskPortOptions): CronTaskPort {
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? (() => randomUUID());
  return {
    async addTask(input) {
      const { scope, prompt, recurring } = input;
      const createdAt = brand<number, 'EpochMillis'>(now());
      const relative = 'delay' in input;
      const nextRunAt = relative ? delayedRunAt(createdAt, input.delay) : nextCronRunMs(input.cron, createdAt);
      if (nextRunAt === null) {
        throw scheduleError('CRON_NO_FUTURE_MATCH');
      }
      if (options.gateway.countActiveTasksForAgent !== undefined) {
        if ((await options.gateway.countActiveTasksForAgent(gatewayScope(scope))) >= CRON_MAX_TASKS_PER_SCOPE) {
          throw cronTaskLimitReachedError();
        }
      }
      const cron = relative ? oneShotCron(nextRunAt) : input.cron;
      const taskId = idFactory();
      await options.gateway.createTask(
        {
          taskId,
          tenantId: scope.tenantId,
          subjectId: scope.subjectId,
          agentId: scope.agentId,
          cron,
          prompt,
          recurring,
          status: 'ACTIVE',
          createdByName: scope.displayName,
          nextRunAt: brand<number, 'EpochMillis'>(nextRunAt),
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`cron-task:${taskId}`) as IdempotencyKey },
      );
      observeTaskMutation(options.onTaskMutation, { operation: 'CRON_TASK_CREATED', taskId, scope });
      return taskId;
    },

    async removeTasks({ scope, ids }) {
      for (const taskId of ids) {
        await options.gateway.deleteTask({ ...gatewayScope(scope), taskId });
        observeTaskMutation(options.onTaskMutation, { operation: 'CRON_TASK_DELETED', taskId, scope });
      }
    },

    async listTasks({ scope }) {
      const tasks = await options.gateway.listTasks(gatewayScope(scope));
      return tasks.filter((task) => task.status !== 'DELETED').map(toToolRecord);
    },

    async findTask({ scope, id }) {
      const task = await options.gateway.loadTask({ ...gatewayScope(scope), taskId: id });
      return task === undefined || task.status === 'DELETED' ? undefined : toToolRecord(task);
    },
  };
}

function delayedRunAt(createdAt: number, delay: CronDelay): number {
  if (!validDelayComponent(delay.days, 365) || !validDelayComponent(delay.hours, 8_760) || !validDelayComponent(delay.minutes, cronDelayMaxMinutes)) {
    throw scheduleError('CRON_DELAY_OUT_OF_RANGE');
  }
  const totalMinutes = (delay.days ?? 0) * 1_440 + (delay.hours ?? 0) * 60 + (delay.minutes ?? 0);
  const rawTarget = createdAt + totalMinutes * 60_000;
  const nextRunAt = Math.ceil(rawTarget / 60_000) * 60_000;
  if (
    !Number.isSafeInteger(createdAt) ||
    !Number.isSafeInteger(totalMinutes) ||
    totalMinutes < 1 ||
    totalMinutes > cronDelayMaxMinutes ||
    !Number.isSafeInteger(nextRunAt)
  ) {
    throw scheduleError('CRON_DELAY_OUT_OF_RANGE');
  }
  return nextRunAt;
}

function validDelayComponent(value: number | undefined, maximum: number): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0 && value <= maximum);
}

function oneShotCron(nextRunAt: number): string {
  const target = new Date(nextRunAt);
  if (Number.isNaN(target.getTime())) {
    throw scheduleError('CRON_DELAY_OUT_OF_RANGE');
  }
  return `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`;
}

function scheduleError(code: string): AgentError {
  return new AgentError({
    code,
    message: 'Cron schedule validation failed before persistence. Provide a supported five-field schedule and call Cron again.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function gatewayScope(scope: CronTaskScope) {
  return {
    tenantId: scope.tenantId,
    subjectId: scope.subjectId,
    agentId: scope.agentId,
  };
}

function observeTaskMutation(observer: GatewayCronTaskPortOptions['onTaskMutation'], observation: CronTaskMutationObservation): void {
  try {
    observer?.(observation);
  } catch {
    // Observation is advisory and must not change a durable Cron mutation result.
  }
}

function toToolRecord(task: GatewayCronTaskRecord): CronTaskRecord {
  return {
    id: task.taskId,
    cron: task.cron,
    prompt: task.prompt,
    createdAt: task.createdAt,
    recurring: task.recurring,
    humanSchedule: cronToHumanSafe(task.cron),
  };
}

function cronToHumanSafe(cron: string): string {
  try {
    return cronToHuman(cron);
  } catch {
    return cron;
  }
}
