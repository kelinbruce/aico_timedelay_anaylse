import {
  AgentError,
  bindRuntimeLoggerProvider,
  brand,
  type AgentError as AgentErrorType,
  type RuntimeLogger,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';
import type { CronTaskRecord } from '@nextagent/agent-contracts/gateway';
import { createReferenceRemoteCronTaskGateway, type ReferenceRemoteCronTaskClient } from '@nextagent/agent-platform-gateway-remote';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('remote Cron task gateway security', () => {
  it.each([
    {
      name: 'timeout',
      vendorError: Object.assign(new Error('Bearer vendor-secret-token raw timeout body'), { name: 'AbortError' }),
      expected: { code: 'CRON_REMOTE_TIMEOUT', category: 'TIMEOUT', retryable: true },
    },
    {
      name: 'authorization',
      vendorError: Object.assign(new Error('credential=vendor-secret raw authorization body'), { statusCode: 401 }),
      expected: { code: 'CRON_REMOTE_UNAUTHORIZED', category: 'AUTHORIZATION', retryable: false },
    },
    {
      name: 'unavailable',
      vendorError: new Error('token=vendor-secret raw vendor body C:/vendor/cron-client.ts'),
      expected: { code: 'CRON_REMOTE_UNAVAILABLE', category: 'UNAVAILABLE', retryable: true },
    },
  ])('maps $name failures without exposing vendor details', async ({ vendorError, expected }) => {
    const logs: Array<{ readonly caught?: unknown; readonly obj: object }> = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureRuntimeLogger(logs) });
    const gateway = createReferenceRemoteCronTaskGateway(failingClient(vendorError));

    const failure = await captureFailure(gateway.createTask(cronTask()));

    expect(failure).toMatchObject(expected);
    expect(failure.message).toMatch(/^Remote Cron (service|gateway)/u);
    expect(failure.cause).toBe(vendorError);
    expect(logs).toEqual([]);
    const exposed = JSON.stringify({
      error: {
        code: failure.code,
        message: failure.message,
        category: failure.category,
        retryable: failure.retryable,
      },
      logs,
    });
    expect(exposed).not.toContain('vendor-secret');
    expect(exposed).not.toContain('raw vendor body');
    expect(exposed).not.toContain('raw timeout body');
    expect(exposed).not.toContain('raw authorization body');
    expect(exposed).not.toContain('cron-client.ts');
  });

  it('maps malformed vendor payloads to a stable non-retryable safe error', async () => {
    const logs: Array<{ readonly caught?: unknown; readonly obj: object }> = [];
    const client = failingClient(new Error('unused'));
    client.createTask = async () => ({ status: 'BROKEN', vendorBody: 'credential=secret' }) as never;
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureRuntimeLogger(logs) });
    const gateway = createReferenceRemoteCronTaskGateway(client);

    const failure = await captureFailure(gateway.createTask(cronTask()));

    expect(failure).toMatchObject({
      code: 'CRON_REMOTE_INVALID_RESPONSE',
      message: 'Remote Cron gateway returned an invalid response.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
    expect(JSON.stringify(logs)).not.toContain('credential=secret');
  });

  it('preserves a vendor-enforced ACTIVE capacity conflict without requiring the optional count method', async () => {
    const base = failingClient(new Error('unused'));
    const { countActiveTasksForAgent: _legacyActiveCount, ...client } = base;
    void _legacyActiveCount;
    client.createTask = async () => {
      throw new AgentError({
        code: 'CRON_TASK_LIMIT_REACHED',
        message: 'credential=vendor-secret C:/vendor/cron-client.ts',
        category: 'CONFLICT',
        retryable: false,
      });
    };
    const gateway = createReferenceRemoteCronTaskGateway(client);

    const failure = await captureFailure(gateway.createTask(cronTask()));

    expect(failure).toMatchObject({
      code: 'CRON_TASK_LIMIT_REACHED',
      message: 'Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.',
      category: 'CONFLICT',
      retryable: false,
    });
    expect(failure.message).not.toContain('vendor-secret');
    expect(failure.message).not.toContain('cron-client.ts');
  });

  it('normalizes a vendor capacity code without exposing raw vendor details', async () => {
    const base = failingClient(new Error('unused'));
    const { countActiveTasksForAgent: _legacyActiveCount, ...client } = base;
    void _legacyActiveCount;
    client.createTask = async () => {
      throw Object.assign(new Error('credential=vendor-secret C:/vendor/cron-client.ts'), {
        code: 'CRON_TASK_LIMIT_REACHED',
      });
    };
    const gateway = createReferenceRemoteCronTaskGateway(client);

    const failure = await captureFailure(gateway.createTask(cronTask()));

    expect(failure).toMatchObject({
      code: 'CRON_TASK_LIMIT_REACHED',
      category: 'CONFLICT',
      retryable: false,
    });
    expect(failure.message).not.toContain('vendor-secret');
    expect(failure.message).not.toContain('cron-client.ts');
    expect(failure.cause).toBeInstanceOf(Error);
  });
});

async function captureFailure(promise: Promise<unknown>): Promise<AgentErrorType> {
  try {
    await promise;
  } catch (error) {
    return error as AgentErrorType;
  }
  throw new Error('Expected remote Cron gateway call to fail.');
}

function failingClient(error: Error): ReferenceRemoteCronTaskClient {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return {
    createTask: fail,
    loadTask: fail,
    loadTaskForAgent: fail,
    listTasks: fail,
    listTasksForAgent: fail,
    countTasksForAgent: fail,
    countActiveTasksForAgent: fail,
    updateTask: fail,
    deleteTask: fail,
    listDueTasks: fail,
    listClaimedTriggers: fail,
    loadTriggerDelivery: fail,
    loadTrigger: fail,
    listTriggersForTask: fail,
    countTriggersForTask: fail,
    claimCronTrigger: fail,
    bindCronTriggerRun: fail,
  };
}

function captureRuntimeLogger(logs: Array<{ readonly caught?: unknown; readonly obj: object }>): RuntimeLogger {
  return {
    error() {},
    warn(fields: object) {
      const { err, ...safeFields } = fields as Record<string, unknown>;
      logs.push({ ...(err === undefined ? {} : { caught: err }), obj: safeFields });
    },
    info() {},
    debug() {},
  };
}

function cronTask(): CronTaskRecord {
  const now = brand<number, 'EpochMillis'>(1_700_000_000_000);
  return {
    tenantId: brand<string, 'TenantId'>('tenant-remote-cron'),
    subjectId: brand<string, 'SubjectId'>('subject-remote-cron'),
    agentId: brand<string, 'AgentId'>('agent-remote-cron'),
    taskId: 'task-remote-cron',
    cron: '17 3 * * *',
    prompt: 'Check LTE handover failures.',
    recurring: true,
    status: 'ACTIVE',
    nextRunAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
