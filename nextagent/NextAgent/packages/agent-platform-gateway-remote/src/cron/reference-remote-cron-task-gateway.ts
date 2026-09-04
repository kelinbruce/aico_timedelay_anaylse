import { AgentError, CRON_TASK_LIMIT_REACHED_CODE, cronTaskLimitReachedError } from '@nextagent/agent-common';
import type {
  BindCronTriggerRunRequest,
  BindCronTriggerRunResult,
  ClaimCronTriggerRequest,
  ClaimCronTriggerResult,
  CronTaskAgentScopeQuery,
  CronTaskAgentListRequest,
  CronTaskAgentLookupRequest,
  CronClaimedTriggerListRequest,
  CronDueTaskListRequest,
  CronTaskGatewayPort,
  CronTaskListRequest,
  CronTaskLookupRequest,
  CronTaskRecord,
  CronTaskTriggerListRequest,
  CronTaskWriteOptions,
  CronTriggerDeliveryLookupRequest,
  CronTriggerLookupRequest,
  CronTriggerRecord,
  ClaimedCronTriggerDeliveryRecord,
} from '@nextagent/agent-contracts/gateway';

export interface ReferenceRemoteCronTaskClient {
  createTask: (record: CronTaskRecord, options?: CronTaskWriteOptions, signal?: AbortSignal) => Promise<CronTaskRecord>;
  loadTask: (request: CronTaskLookupRequest, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  loadTaskForAgent: (request: CronTaskAgentLookupRequest, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  listTasks: (request: CronTaskListRequest, signal?: AbortSignal) => Promise<readonly CronTaskRecord[]>;
  listTasksForAgent: (request: CronTaskAgentListRequest, signal?: AbortSignal) => Promise<readonly CronTaskRecord[]>;
  countTasksForAgent: (request: CronTaskAgentListRequest, signal?: AbortSignal) => Promise<number>;
  countActiveTasksForAgent?: (request: CronTaskAgentScopeQuery, signal?: AbortSignal) => Promise<number>;
  updateTask: (record: CronTaskRecord, options?: CronTaskWriteOptions, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  deleteTask: (request: CronTaskLookupRequest, options?: CronTaskWriteOptions, signal?: AbortSignal) => Promise<CronTaskRecord | undefined>;
  listDueTasks: (request: CronDueTaskListRequest, signal?: AbortSignal) => Promise<readonly CronTaskRecord[]>;
  listClaimedTriggers: (request: CronClaimedTriggerListRequest, signal?: AbortSignal) => Promise<readonly ClaimedCronTriggerDeliveryRecord[]>;
  loadTriggerDelivery: (request: CronTriggerDeliveryLookupRequest, signal?: AbortSignal) => Promise<ClaimedCronTriggerDeliveryRecord | undefined>;
  loadTrigger: (request: CronTriggerLookupRequest, signal?: AbortSignal) => Promise<CronTriggerRecord | undefined>;
  listTriggersForTask: (request: CronTaskTriggerListRequest, signal?: AbortSignal) => Promise<readonly CronTriggerRecord[]>;
  countTriggersForTask: (request: CronTaskTriggerListRequest, signal?: AbortSignal) => Promise<number>;
  claimCronTrigger: (request: ClaimCronTriggerRequest, signal?: AbortSignal) => Promise<ClaimCronTriggerResult>;
  bindCronTriggerRun: (request: BindCronTriggerRunRequest, signal?: AbortSignal) => Promise<BindCronTriggerRunResult>;
}

type RemoteCronOperation = keyof ReferenceRemoteCronTaskClient;

export function createReferenceRemoteCronTaskGateway(client: ReferenceRemoteCronTaskClient): CronTaskGatewayPort {
  return {
    async createTask(record, writeOptions, signal) {
      return invokeRemoteCron('createTask', signal, async () => requireCronTaskRecord(await client.createTask(record, writeOptions, signal)));
    },
    async loadTask(request, signal) {
      return invokeRemoteCron('loadTask', signal, async () => optionalCronTaskRecord(await client.loadTask(request, signal)));
    },
    async loadTaskForAgent(request, signal) {
      return invokeRemoteCron('loadTaskForAgent', signal, async () => optionalCronTaskRecord(await client.loadTaskForAgent(request, signal)));
    },
    async listTasks(request, signal) {
      return invokeRemoteCron('listTasks', signal, async () => cronTaskRecordList(await client.listTasks(request, signal)));
    },
    async listTasksForAgent(request, signal) {
      return invokeRemoteCron('listTasksForAgent', signal, async () => cronTaskRecordList(await client.listTasksForAgent(request, signal)));
    },
    async countTasksForAgent(request, signal) {
      return invokeRemoteCron('countTasksForAgent', signal, async () => requireNonNegativeInteger(await client.countTasksForAgent(request, signal)));
    },
    ...(client.countActiveTasksForAgent === undefined
      ? {}
      : {
          async countActiveTasksForAgent(request, signal) {
            return invokeRemoteCron('countActiveTasksForAgent', signal, async () =>
              requireNonNegativeInteger(await client.countActiveTasksForAgent!(request, signal)),
            );
          },
        }),
    async updateTask(record, writeOptions, signal) {
      return invokeRemoteCron('updateTask', signal, async () => optionalCronTaskRecord(await client.updateTask(record, writeOptions, signal)));
    },
    async deleteTask(request, writeOptions, signal) {
      return invokeRemoteCron('deleteTask', signal, async () => optionalCronTaskRecord(await client.deleteTask(request, writeOptions, signal)));
    },
    async listDueTasks(request, signal) {
      return invokeRemoteCron('listDueTasks', signal, async () => cronTaskRecordList(await client.listDueTasks(request, signal)));
    },
    async listClaimedTriggers(request, signal) {
      return invokeRemoteCron('listClaimedTriggers', signal, async () => {
        const records = await client.listClaimedTriggers(request, signal);
        if (!Array.isArray(records)) {
          throw invalidResponse();
        }
        return records.map((record) => {
          if (!isObject(record)) {
            throw invalidResponse();
          }
          return {
            task: requireCronTaskRecord(record.task),
            trigger: requireCronTriggerRecord(record.trigger),
          };
        });
      });
    },
    async loadTriggerDelivery(request, signal) {
      return invokeRemoteCron('loadTriggerDelivery', signal, async () => {
        const record = await client.loadTriggerDelivery(request, signal);
        if (record === undefined) {
          return undefined;
        }
        if (!isObject(record)) {
          throw invalidResponse();
        }
        return {
          task: requireCronTaskRecord(record.task),
          trigger: requireCronTriggerRecord(record.trigger),
        };
      });
    },
    async loadTrigger(request, signal) {
      return invokeRemoteCron('loadTrigger', signal, async () => optionalCronTriggerRecord(await client.loadTrigger(request, signal)));
    },
    async listTriggersForTask(request, signal) {
      return invokeRemoteCron('listTriggersForTask', signal, async () => cronTriggerRecordList(await client.listTriggersForTask(request, signal)));
    },
    async countTriggersForTask(request, signal) {
      return invokeRemoteCron('countTriggersForTask', signal, async () =>
        requireNonNegativeInteger(await client.countTriggersForTask(request, signal)),
      );
    },
    async claimCronTrigger(request, signal) {
      return invokeRemoteCron('claimCronTrigger', signal, async () => requireClaimCronTriggerResult(await client.claimCronTrigger(request, signal)));
    },
    async bindCronTriggerRun(request, signal) {
      return invokeRemoteCron('bindCronTriggerRun', signal, async () =>
        requireBindCronTriggerRunResult(await client.bindCronTriggerRun(request, signal)),
      );
    },
  };
}

async function invokeRemoteCron<TResult>(
  _operation: RemoteCronOperation,
  signal: AbortSignal | undefined,
  invoke: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await invoke();
  } catch (error) {
    throw normalizeRemoteCronError(error, signal);
  }
}

function normalizeRemoteCronError(error: unknown, signal?: AbortSignal): AgentError {
  if ((error instanceof AgentError && error.code === CRON_TASK_LIMIT_REACHED_CODE) || errorRecord(error)?.code === CRON_TASK_LIMIT_REACHED_CODE) {
    return cronTaskLimitReachedError(error);
  }
  if (error instanceof AgentError && error.code === 'CRON_REMOTE_INVALID_RESPONSE') {
    return error;
  }
  if (isRemoteCronTimeout(error, signal)) {
    return new AgentError({
      code: 'CRON_REMOTE_TIMEOUT',
      message: 'Remote Cron service timed out.',
      category: 'TIMEOUT',
      retryable: true,
      cause: error,
    });
  }
  if (isRemoteCronAuthorizationFailure(error)) {
    return new AgentError({
      code: 'CRON_REMOTE_UNAUTHORIZED',
      message: 'Remote Cron service authorization failed.',
      category: 'AUTHORIZATION',
      retryable: false,
      cause: error,
    });
  }
  return new AgentError({
    code: 'CRON_REMOTE_UNAVAILABLE',
    message: 'Remote Cron service is unavailable.',
    category: 'UNAVAILABLE',
    retryable: true,
    cause: error,
  });
}

function isRemoteCronTimeout(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) {
    return true;
  }
  if (error instanceof AgentError && (error.category === 'TIMEOUT' || error.category === 'CANCELED')) {
    return true;
  }
  const record = errorRecord(error);
  return (
    record?.name === 'AbortError' ||
    record?.code === 'ETIMEDOUT' ||
    record?.code === 'ECONNABORTED' ||
    record?.status === 408 ||
    record?.status === 504 ||
    record?.statusCode === 408 ||
    record?.statusCode === 504
  );
}

function isRemoteCronAuthorizationFailure(error: unknown): boolean {
  if (error instanceof AgentError && error.category === 'AUTHORIZATION') {
    return true;
  }
  const record = errorRecord(error);
  return (
    record?.status === 401 ||
    record?.status === 403 ||
    record?.statusCode === 401 ||
    record?.statusCode === 403 ||
    record?.code === 'UNAUTHORIZED' ||
    record?.code === 'FORBIDDEN'
  );
}

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined;
}

function cronTaskRecordList(value: unknown): readonly CronTaskRecord[] {
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map(requireCronTaskRecord);
}

function optionalCronTaskRecord(value: unknown): CronTaskRecord | undefined {
  return value === undefined ? undefined : requireCronTaskRecord(value);
}

function requireCronTaskRecord(value: unknown): CronTaskRecord {
  if (
    !isObject(value) ||
    !isString(value.taskId) ||
    !isString(value.agentId) ||
    !isString(value.tenantId) ||
    !isString(value.subjectId) ||
    !isString(value.cron) ||
    !isString(value.prompt) ||
    !isBoolean(value.recurring) ||
    !isCronTaskStatus(value.status) ||
    !isNumber(value.nextRunAt) ||
    !isNumber(value.createdAt) ||
    !isNumber(value.updatedAt) ||
    !Number.isInteger(value.version)
  ) {
    throw invalidResponse();
  }
  return value as unknown as CronTaskRecord;
}

function optionalCronTriggerRecord(value: unknown): CronTriggerRecord | undefined {
  return value === undefined ? undefined : requireCronTriggerRecord(value);
}

function cronTriggerRecordList(value: unknown): readonly CronTriggerRecord[] {
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map(requireCronTriggerRecord);
}

function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse();
  }
  return value;
}

function requireCronTriggerRecord(value: unknown): CronTriggerRecord {
  if (
    !isObject(value) ||
    !isString(value.triggerId) ||
    !isString(value.taskId) ||
    !isString(value.agentId) ||
    !isString(value.tenantId) ||
    !isString(value.subjectId) ||
    !isNumber(value.scheduledAt) ||
    !isCronTriggerStatus(value.status) ||
    !isNumber(value.createdAt) ||
    !isNumber(value.updatedAt) ||
    (value.sessionId !== undefined && !isString(value.sessionId)) ||
    (value.requestRunId !== undefined && !isString(value.requestRunId))
  ) {
    throw invalidResponse();
  }
  return value as unknown as CronTriggerRecord;
}

function requireClaimCronTriggerResult(value: unknown): ClaimCronTriggerResult {
  if (!isObject(value) || !isClaimCronTriggerStatus(value.status)) {
    throw invalidResponse();
  }
  return {
    status: value.status,
    ...(value.trigger === undefined ? {} : { trigger: requireCronTriggerRecord(value.trigger) }),
    ...(value.task === undefined ? {} : { task: requireCronTaskRecord(value.task) }),
  };
}

function requireBindCronTriggerRunResult(value: unknown): BindCronTriggerRunResult {
  if (!isObject(value) || !isBindCronTriggerRunStatus(value.status)) {
    throw invalidResponse();
  }
  return {
    status: value.status,
    ...(value.trigger === undefined ? {} : { trigger: requireCronTriggerRecord(value.trigger) }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isCronTaskStatus(value: unknown): value is CronTaskRecord['status'] {
  return value === 'ACTIVE' || value === 'COMPLETED' || value === 'DELETED';
}

function isCronTriggerStatus(value: unknown): value is CronTriggerRecord['status'] {
  return value === 'CLAIMED' || value === 'ACCEPTED';
}

function isClaimCronTriggerStatus(value: unknown): value is ClaimCronTriggerResult['status'] {
  return (
    value === 'CLAIMED' || value === 'ALREADY_CLAIMED' || value === 'TASK_NOT_FOUND' || value === 'TASK_NOT_ACTIVE' || value === 'VERSION_CONFLICT'
  );
}

function isBindCronTriggerRunStatus(value: unknown): value is BindCronTriggerRunResult['status'] {
  return value === 'BOUND' || value === 'ALREADY_BOUND' || value === 'TRIGGER_NOT_FOUND' || value === 'RUN_CONFLICT';
}

function invalidResponse(): AgentError {
  return new AgentError({
    code: 'CRON_REMOTE_INVALID_RESPONSE',
    message: 'Remote Cron gateway returned an invalid response.',
    category: 'UNAVAILABLE',
    retryable: false,
  });
}
