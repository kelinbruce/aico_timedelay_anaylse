// In-memory cron task store, scoped by owner (tenantId + subjectId) and agent.
// Tasks live for the duration of the process — no disk persistence in this
// version. The store enforces a maximum task count per scope and provides
// add / remove / list operations used by the three cron tools.

import {
  CRON_MAX_TASKS_PER_SCOPE,
  cronTaskLimitReachedError,
  type AgentId,
  type AgentVersion,
  type IdentityContext,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import { randomUUID } from 'node:crypto';

import type { CronTaskPort, CronTaskRecord, CronTaskScope } from '../../tools/tool-spi.js';
import { cronToHuman } from './cron-expression.js';

export { CRON_MAX_TASKS_PER_SCOPE };
export const CRON_PROMPT_MAX_LENGTH = 10_000;

interface CronTask {
  readonly id: string;
  readonly cron: string;
  readonly prompt: string;
  readonly createdAt: number;
  readonly recurring: boolean;
  readonly scope: CronTaskScope;
}

function scopeKey(scope: CronTaskScope): string {
  return `${scope.tenantId}/${scope.subjectId}/${scope.agentId}`;
}

export function createInMemoryCronTaskPort(options: { readonly now?: () => number } = {}): CronTaskPort {
  const store = new Map<string, CronTask[]>();
  const now = options.now ?? Date.now;

  function getScope(scope: CronTaskScope): CronTask[] {
    const key = scopeKey(scope);
    let tasks = store.get(key);
    if (tasks === undefined) {
      tasks = [];
      store.set(key, tasks);
    }
    return tasks;
  }

  return {
    async addTask(input) {
      const { scope, prompt, recurring } = input;
      const tasks = getScope(scope);
      if (tasks.length >= CRON_MAX_TASKS_PER_SCOPE) {
        throw cronTaskLimitReachedError();
      }
      const id = randomUUID().slice(0, 8);
      const createdAt = now();
      const cron = 'delay' in input ? delayCron(createdAt, input.delay) : input.cron;
      const task: CronTask = {
        id,
        cron,
        prompt,
        createdAt,
        recurring,
        scope,
      };
      tasks.push(task);
      return id;
    },

    async removeTasks({ scope, ids }) {
      if (ids.length === 0) {
        return;
      }
      const tasks = getScope(scope);
      const idSet = new Set(ids);
      const remaining = tasks.filter((t) => !idSet.has(t.id));
      store.set(scopeKey(scope), remaining);
    },

    async listTasks({ scope }) {
      return getScope(scope).map(toRecord);
    },

    async findTask({ scope, id }) {
      const task = getScope(scope).find((t) => t.id === id);
      return task === undefined ? undefined : toRecord(task);
    },
  };
}

function delayCron(createdAt: number, delay: import('../../tools/tool-spi.js').CronDelay): string {
  const minutes = (delay.days ?? 0) * 1_440 + (delay.hours ?? 0) * 60 + (delay.minutes ?? 0);
  const target = new Date(Math.ceil((createdAt + minutes * 60_000) / 60_000) * 60_000);
  return `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`;
}

function toRecord(task: CronTask): CronTaskRecord {
  return {
    id: task.id,
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

export function cronScopeFromContext(
  identity: IdentityContext,
  agentId: AgentId,
  agentVersion: AgentVersion,
  sessionId: SessionId,
  requestRunId: RequestRunId,
): CronTaskScope {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    displayName: identity.displayName,
    agentId,
    agentVersion,
    sessionId,
    requestRunId,
  };
}
