import { AgentError, CRON_MAX_TASKS_PER_SCOPE, brand, cronTaskLimitReachedError } from '@nextagent/agent-common';
import { cronToHuman, nextCronRunMs, parseCronExpression } from '@nextagent/agent-capability';
import type {
  CreateCronTaskManagementCommand,
  CronTaskExecutionView,
  CronTaskManagementPort,
  CronTaskTargetView,
  CronTaskManagementView,
  DeleteCronTaskManagementCommand,
  ExecuteCronTaskManagementCommand,
  ListCronTaskExecutionsQuery,
  UpdateCronTaskManagementCommand,
} from '@nextagent/agent-contracts/channel';
import type {
  CronTaskGatewayPort,
  CronTaskRecord,
  CronTriggerRecord,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { randomUUID } from 'node:crypto';

const CRON_EXPRESSION_MAX_LENGTH = 256;
const CRON_PROMPT_MAX_LENGTH = 10_000;
const CRON_MANAGEMENT_LIST_LIMIT = 50;
const CRON_EXECUTION_LIST_LIMIT = 50;
const CRON_EXECUTION_TIMELINE_LIMIT = 1_000;
const CRON_TARGET_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CAPABILITY_DIRECTIVE_PATTERN = /\$(skill|workflow):([A-Za-z0-9._-]+)/u;

export interface CronTaskManagementServiceOptions {
  readonly cronTasks: CronTaskGatewayPort;
  readonly requestRuns: Pick<RequestRunStoreGateway, 'loadRun'>;
  readonly timeline: Pick<RunTimelineEventStoreGateway, 'listEvents'>;
  readonly messages: Pick<SessionMessageStoreGateway, 'loadMessage'>;
  readonly delivery?: {
    deliver: (input: { readonly task: CronTaskRecord; readonly trigger: CronTriggerRecord; readonly signal: AbortSignal }) => Promise<unknown>;
  };
  readonly now?: () => number;
  readonly taskIdFactory?: () => string;
  readonly triggerIdFactory?: () => string;
}

export function createCronTaskManagementService(options: CronTaskManagementServiceOptions): CronTaskManagementPort {
  const now = options.now ?? Date.now;
  const taskIdFactory = options.taskIdFactory ?? (() => randomUUID());
  const triggerIdFactory = options.triggerIdFactory ?? (() => randomUUID());
  return {
    async listCronTasks(scope, signal) {
      const page = normalizeManagementPage(scope.offset, scope.limit);
      const tasks = await options.cronTasks.listTasksForAgent(
        {
          tenantId: scope.identityContext.tenantId,
          subjectId: scope.identityContext.subjectId,
          agentId: scope.agentId,
          offset: page.offset,
          limit: page.limit,
        },
        signal,
      );
      const total = await options.cronTasks.countTasksForAgent(
        {
          tenantId: scope.identityContext.tenantId,
          subjectId: scope.identityContext.subjectId,
          agentId: scope.agentId,
        },
        signal,
      );
      return { tasks: tasks.map(projectTask), total };
    },

    async listCronTaskExecutions(query, signal) {
      await requireManagedTask(options.cronTasks, query, signal);
      const page = normalizeExecutionPage(query.offset, query.limit);
      const triggers = await options.cronTasks.listTriggersForTask(
        {
          tenantId: query.identityContext.tenantId,
          subjectId: query.identityContext.subjectId,
          agentId: query.agentId,
          taskId: query.taskId,
          offset: page.offset,
          limit: page.limit,
        },
        signal,
      );
      const total = await options.cronTasks.countTriggersForTask(
        {
          tenantId: query.identityContext.tenantId,
          subjectId: query.identityContext.subjectId,
          agentId: query.agentId,
          taskId: query.taskId,
        },
        signal,
      );
      return {
        executions: await Promise.all(triggers.map((trigger) => projectExecution(options, trigger))),
        total,
      };
    },

    async createCronTask(command, signal) {
      const cron = normalizeCron(command.cron);
      const prompt = normalizePrompt(command.prompt);
      const target = normalizeTarget(command.target);
      assertPromptTargetCompatible(prompt, target);
      const recurring = command.recurring ?? true;
      const createdAt = brand<number, 'EpochMillis'>(now());
      const nextRunAt = requireNextRun(cron, createdAt);
      const scope = {
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: command.agentId,
      };
      if (options.cronTasks.countActiveTasksForAgent !== undefined) {
        if ((await options.cronTasks.countActiveTasksForAgent(scope, signal)) >= CRON_MAX_TASKS_PER_SCOPE) {
          throw cronTaskLimitReachedError();
        }
      }
      const record = await options.cronTasks.createTask(
        {
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          taskId: taskIdFactory(),
          cron,
          prompt,
          ...targetRecordFields(target),
          recurring,
          status: 'ACTIVE',
          nextRunAt,
          version: 1,
          createdAt,
          updatedAt: createdAt,
          createdByName: command.identityContext.displayName,
        },
        undefined,
        signal,
      );
      return projectTask(record);
    },

    async updateCronTask(command, signal) {
      if (command.cron === undefined && command.prompt === undefined && command.recurring === undefined && command.target === undefined) {
        throwValidation('Cron task update requires at least one field.');
      }
      const existing = await options.cronTasks.loadTaskForAgent(
        {
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          taskId: command.taskId,
        },
        signal,
      );
      if (existing === undefined) {
        throwNotFound(command.taskId);
      }
      if (existing.status !== 'ACTIVE') {
        throw new AgentError({
          code: 'CRON_TASK_NOT_ACTIVE',
          message: 'Cron task is not active.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      const cron = command.cron === undefined ? existing.cron : normalizeCron(command.cron);
      const prompt = command.prompt === undefined ? existing.prompt : normalizePrompt(command.prompt);
      const target = command.target === undefined ? targetFromRecord(existing) : normalizeTarget(command.target);
      assertPromptTargetCompatible(prompt, target);
      const updatedAt = brand<number, 'EpochMillis'>(now());
      const nextRunAt = command.cron === undefined ? existing.nextRunAt : requireNextRun(cron, updatedAt);
      const updated = await options.cronTasks.updateTask(
        {
          ...omitTargetRecordFields(existing),
          cron,
          prompt,
          ...targetRecordFields(target),
          recurring: command.recurring ?? existing.recurring,
          nextRunAt,
          version: existing.version + 1,
          updatedAt,
        },
        { expectedVersion: existing.version },
        signal,
      );
      if (updated === undefined) {
        throw new AgentError({
          code: 'CRON_TASK_UPDATE_CONFLICT',
          message: 'Cron task update conflicted.',
          category: 'CONFLICT',
          retryable: true,
        });
      }
      return projectTask(updated);
    },

    async deleteCronTask(command, signal) {
      const existing = await options.cronTasks.loadTaskForAgent(
        {
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          taskId: command.taskId,
        },
        signal,
      );
      if (existing === undefined) {
        throwNotFound(command.taskId);
      }
      await options.cronTasks.deleteTask(existing, { expectedVersion: existing.version }, signal);
    },

    async executeCronTask(command, signal) {
      if (options.delivery === undefined) {
        throw new AgentError({
          code: 'CRON_TASK_EXECUTION_UNAVAILABLE',
          message: 'Cron task execution service is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      const existing = await requireManagedTask(options.cronTasks, command, signal);
      if (existing.status !== 'ACTIVE') {
        throw new AgentError({
          code: 'CRON_TASK_NOT_ACTIVE',
          message: 'Cron task is not active.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      const scheduledAt = brand<number, 'EpochMillis'>(now());
      const claim = await options.cronTasks.claimCronTrigger(
        {
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          taskId: command.taskId,
          scheduledAt,
          triggerId: triggerIdFactory(),
          ...(existing.recurring ? { nextRunAt: existing.nextRunAt } : {}),
          claimedAt: scheduledAt,
        },
        signal,
      );
      if (claim.status === 'TASK_NOT_FOUND') {
        throwNotFound(command.taskId);
      }
      if (claim.status === 'TASK_NOT_ACTIVE') {
        throw new AgentError({
          code: 'CRON_TASK_NOT_ACTIVE',
          message: 'Cron task is not active.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      if (claim.status === 'VERSION_CONFLICT' || claim.trigger === undefined) {
        throw new AgentError({
          code: 'CRON_TASK_EXECUTION_CONFLICT',
          message: 'Cron task execution conflicted.',
          category: 'CONFLICT',
          retryable: true,
        });
      }
      await options.delivery.deliver({ task: claim.task ?? existing, trigger: claim.trigger, signal: signal ?? new AbortController().signal });
      const deliveredTrigger = await options.cronTasks.loadTrigger(
        {
          tenantId: command.identityContext.tenantId,
          subjectId: command.identityContext.subjectId,
          agentId: command.agentId,
          taskId: command.taskId,
          triggerId: claim.trigger.triggerId,
        },
        signal,
      );
      return projectExecution(options, deliveredTrigger ?? claim.trigger);
    },
  };
}

async function requireManagedTask(
  cronTasks: CronTaskGatewayPort,
  query: Pick<ListCronTaskExecutionsQuery | ExecuteCronTaskManagementCommand, 'identityContext' | 'agentId' | 'taskId'>,
  signal?: AbortSignal,
): Promise<CronTaskRecord> {
  const existing = await cronTasks.loadTaskForAgent(
    {
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
      taskId: query.taskId,
    },
    signal,
  );
  if (existing === undefined) {
    throwNotFound(query.taskId);
  }
  return existing;
}

async function projectExecution(options: CronTaskManagementServiceOptions, trigger: CronTriggerRecord): Promise<CronTaskExecutionView> {
  const base = {
    triggerId: trigger.triggerId,
    taskId: trigger.taskId,
    scheduledAt: trigger.scheduledAt,
    triggerStatus: trigger.status,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
    ...(trigger.sessionId === undefined ? {} : { sessionId: trigger.sessionId }),
    ...(trigger.requestRunId === undefined ? {} : { requestRunId: trigger.requestRunId }),
  };
  if (trigger.requestRunId === undefined || trigger.sessionId === undefined) {
    return base;
  }
  const run = await options.requestRuns.loadRun({
    tenantId: trigger.tenantId,
    subjectId: trigger.subjectId,
    agentId: trigger.agentId,
    runId: trigger.requestRunId,
  });
  if (run === undefined) {
    return base;
  }
  const terminalEvent = await loadTerminalEvent(options.timeline, trigger, run.sessionId, trigger.requestRunId);
  const execution = {
    ...base,
    sessionId: run.sessionId,
    runStatus: run.status,
    terminalCommitState: run.terminalCommitState,
  };
  if (terminalEvent === undefined) {
    return execution;
  }
  const terminalMessage = await loadTerminalMessage(options.messages, trigger, run, terminalEvent);
  return {
    ...execution,
    resultEventType: terminalEvent.type as NonNullable<CronTaskExecutionView['resultEventType']>,
    ...(terminalMessage === undefined ? {} : { resultContent: terminalMessage.content }),
    resultAt: terminalEvent.createdAt,
  };
}

async function loadTerminalMessage(
  messages: Pick<SessionMessageStoreGateway, 'loadMessage'>,
  trigger: CronTriggerRecord,
  run: NonNullable<Awaited<ReturnType<RequestRunStoreGateway['loadRun']>>>,
  terminalEvent: RunTimelineEventRecord,
): Promise<SessionMessageRecord | undefined> {
  const terminalMessageId = terminalEvent.inlinePayload.terminalMessageId;
  const terminalStatus = terminalStatusForEvent(terminalEvent.type);
  if (
    typeof terminalMessageId !== 'string' ||
    terminalMessageId.trim().length === 0 ||
    terminalStatus === undefined ||
    run.status !== terminalStatus
  ) {
    return undefined;
  }
  const message = await messages.loadMessage({
    tenantId: trigger.tenantId,
    subjectId: trigger.subjectId,
    agentId: trigger.agentId,
    messageId: brand<string, 'MessageId'>(terminalMessageId),
  });
  if (
    message?.tenantId !== trigger.tenantId ||
    message.subjectId !== trigger.subjectId ||
    message.agentId !== trigger.agentId ||
    message.sessionId !== run.sessionId ||
    message.requestId !== run.requestId ||
    message.runId !== run.runId ||
    message.role !== 'ASSISTANT' ||
    message.visible !== true ||
    message.metadata.eventType !== terminalEvent.type ||
    message.metadata.status !== terminalStatus
  ) {
    return undefined;
  }
  return message;
}

function terminalStatusForEvent(type: RunTimelineEventRecord['type']): RequestRunRecord['status'] | undefined {
  if (type === 'REQUEST_COMPLETED') {
    return 'COMPLETED';
  }
  if (type === 'REQUEST_FAILED') {
    return 'FAILED';
  }
  if (type === 'REQUEST_CANCELED') {
    return 'CANCELED';
  }
  if (type === 'REQUEST_SUPERSEDED') {
    return 'SUPERSEDED';
  }
  return undefined;
}

async function loadTerminalEvent(
  timeline: Pick<RunTimelineEventStoreGateway, 'listEvents'>,
  trigger: CronTriggerRecord,
  sessionId: NonNullable<CronTriggerRecord['sessionId']>,
  runId: NonNullable<CronTriggerRecord['requestRunId']>,
): Promise<RunTimelineEventRecord | undefined> {
  const events = await timeline.listEvents({
    tenantId: trigger.tenantId,
    subjectId: trigger.subjectId,
    agentId: trigger.agentId,
    sessionId,
    runId,
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: CRON_EXECUTION_TIMELINE_LIMIT,
  });
  return [...events].reverse().find(isTerminalExecutionEvent);
}

function isTerminalExecutionEvent(event: RunTimelineEventRecord): boolean {
  return (
    event.type === 'REQUEST_COMPLETED' || event.type === 'REQUEST_FAILED' || event.type === 'REQUEST_CANCELED' || event.type === 'REQUEST_SUPERSEDED'
  );
}

function normalizeCron(value: string): string {
  const cron = value.trim();
  if (cron.length === 0 || cron.length > CRON_EXPRESSION_MAX_LENGTH || parseCronExpression(cron) === null) {
    throw new AgentError({
      code: 'CRON_INVALID_EXPRESSION',
      message: 'Cron expression is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return cron;
}

function normalizePrompt(value: string): string {
  const prompt = value.trim();
  if (prompt.length === 0) {
    throwValidation('Cron prompt must not be empty.');
  }
  if (prompt.length > CRON_PROMPT_MAX_LENGTH) {
    throw new AgentError({
      code: 'CRON_PROMPT_TOO_LONG',
      message: `Prompt exceeds max length ${CRON_PROMPT_MAX_LENGTH}.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return prompt;
}

function normalizeTarget(value?: CronTaskTargetView | null): CronTaskTargetView | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const name = value.name.trim();
  if ((value.kind !== 'SKILL' && value.kind !== 'WORKFLOW') || name.length === 0 || name.length > 128 || !CRON_TARGET_NAME_PATTERN.test(name)) {
    throw new AgentError({
      code: 'CRON_TASK_TARGET_INVALID',
      message: 'Cron task target is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return { kind: value.kind, name };
}

function assertPromptTargetCompatible(prompt: string, target?: CronTaskTargetView): void {
  if (target !== undefined && CAPABILITY_DIRECTIVE_PATTERN.test(prompt)) {
    throw new AgentError({
      code: 'CRON_TASK_TARGET_PROMPT_CONFLICT',
      message: 'Cron task target conflicts with a prompt capability directive.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function targetRecordFields(target?: CronTaskTargetView): Partial<Pick<CronTaskRecord, 'targetKind' | 'targetName'>> {
  return target === undefined ? {} : { targetKind: target.kind, targetName: target.name };
}

function omitTargetRecordFields(record: CronTaskRecord): Omit<CronTaskRecord, 'targetKind' | 'targetName'> {
  const { targetKind: _targetKind, targetName: _targetName, ...rest } = record;
  return rest;
}

function targetFromRecord(record: CronTaskRecord): CronTaskTargetView | undefined {
  if (record.targetKind === undefined && record.targetName === undefined) {
    return undefined;
  }
  if ((record.targetKind !== 'SKILL' && record.targetKind !== 'WORKFLOW') || record.targetName === undefined) {
    throw new AgentError({
      code: 'CRON_TASK_TARGET_INVALID',
      message: 'Cron task target is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return { kind: record.targetKind, name: record.targetName };
}

function requireNextRun(cron: string, fromMs: number): ReturnType<typeof brand<number, 'EpochMillis'>> {
  const nextRunAt = nextCronRunMs(cron, fromMs);
  if (nextRunAt === null) {
    throw new AgentError({
      code: 'CRON_NO_FUTURE_MATCH',
      message: 'Cron expression does not match any calendar date in the next year.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return brand<number, 'EpochMillis'>(nextRunAt);
}

function projectTask(record: CronTaskRecord): CronTaskManagementView {
  const target = targetFromRecord(record);
  return {
    taskId: record.taskId,
    cron: record.cron,
    humanSchedule: cronToHumanSafe(record.cron),
    prompt: record.prompt,
    ...(target === undefined ? {} : { target }),
    recurring: record.recurring,
    status: record.status === 'DELETED' ? 'COMPLETED' : record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nextRunAt: record.nextRunAt,
    ...(record.createdByName === undefined ? {} : { createdByName: record.createdByName }),
  };
}

function cronToHumanSafe(cron: string): string {
  try {
    return cronToHuman(cron);
  } catch {
    return cron;
  }
}

function throwValidation(message: string): never {
  throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message, category: 'VALIDATION', retryable: false });
}

function throwNotFound(taskId: string): never {
  throw new AgentError({
    code: 'CRON_TASK_NOT_FOUND',
    message: `No Cron task with id '${taskId}'.`,
    category: 'NOT_FOUND',
    retryable: false,
  });
}

function normalizeExecutionPage(offset?: number, limit?: number): { readonly offset: number; readonly limit: number } {
  const resolvedOffset = offset ?? 0;
  const resolvedLimit = limit ?? CRON_EXECUTION_LIST_LIMIT;
  if (!Number.isSafeInteger(resolvedOffset) || resolvedOffset < 0) {
    throwValidation('Cron task execution offset must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > CRON_EXECUTION_LIST_LIMIT) {
    throwValidation('Cron task execution limit must be between 1 and 50.');
  }
  return { offset: resolvedOffset, limit: resolvedLimit };
}

function normalizeManagementPage(offset?: number, limit?: number): { readonly offset: number; readonly limit: number } {
  const resolvedOffset = offset ?? 0;
  const resolvedLimit = limit ?? CRON_MANAGEMENT_LIST_LIMIT;
  if (!Number.isSafeInteger(resolvedOffset) || resolvedOffset < 0) {
    throwValidation('Cron task offset must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > CRON_MANAGEMENT_LIST_LIMIT) {
    throwValidation('Cron task limit must be between 1 and 50.');
  }
  return { offset: resolvedOffset, limit: resolvedLimit };
}
