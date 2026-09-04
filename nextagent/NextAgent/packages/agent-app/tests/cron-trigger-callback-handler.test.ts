import { brand, type AgentError } from '@nextagent/agent-common';
import type {
  ClaimedCronTriggerDeliveryRecord,
  CronTaskGatewayPort,
  CronTaskRecord,
  CronTriggerCallbackInput,
  CronTriggerRecord,
} from '@nextagent/agent-contracts/gateway';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildCronTriggerCallbackSigningPayload, createCronTriggerCallbackVerifier } from '../src/cron/cron-trigger-callback-verifier.js';
import { createCronTriggerCallbackHandler } from '../src/composition/cron-trigger-callback-handler.js';

describe('Cron trigger callback handler', () => {
  const now = 1_700_000_000_000;
  const secret = 'test-only-cron-handler-secret';

  it('delivers only durable task and trigger facts after verification', async () => {
    const record = deliveryRecord();
    const delivered: ClaimedCronTriggerDeliveryRecord[] = [];
    const handler = handlerFor(record, delivered);

    await expect(handler.handle(signedCallback(), new AbortController().signal)).resolves.toEqual({ status: 'DELIVERED', requestRunId: 'run-1' });

    expect(delivered).toEqual([record]);
    expect(delivered[0]?.task.prompt).toBe('Check LTE handover failures from durable task facts.');
  });

  it('rejects callback prompt and identity injection before durable lookup', async () => {
    let lookupCount = 0;
    let deliveryCount = 0;
    const handler = createCronTriggerCallbackHandler({
      verifier: verifier(),
      cronTasks: {
        async loadTriggerDelivery() {
          lookupCount += 1;
          return deliveryRecord();
        },
      } as unknown as CronTaskGatewayPort,
      delivery: {
        async deliver() {
          deliveryCount += 1;
          return { requestRunId: brand<string, 'RequestRunId'>('run-1') };
        },
      },
    });

    const failure = await captureFailure(
      handler.handle(
        {
          ...signedCallback(),
          prompt: 'injected',
          tenantId: 'tenant-injected',
          subjectId: 'subject-injected',
          agentId: 'agent-injected',
          sessionId: 'session-injected',
        },
        new AbortController().signal,
      ),
    );

    expect(failure).toMatchObject({ code: 'CRON_CALLBACK_INVALID', category: 'VALIDATION' });
    expect(lookupCount).toBe(0);
    expect(deliveryCount).toBe(0);
  });

  it.each([
    {
      name: 'missing target',
      record: undefined,
      code: 'CRON_CALLBACK_TARGET_NOT_FOUND',
      category: 'NOT_FOUND',
    },
    {
      name: 'deleted task',
      record: deliveryRecord({ taskStatus: 'DELETED' }),
      code: 'CRON_CALLBACK_TARGET_NOT_FOUND',
      category: 'NOT_FOUND',
    },
    {
      name: 'scope mismatch',
      record: deliveryRecord({ triggerSubjectId: 'subject-other' }),
      code: 'CRON_CALLBACK_SCOPE_MISMATCH',
      category: 'AUTHORIZATION',
    },
  ])('rejects $name without delivery', async ({ record, code, category }) => {
    const delivered: ClaimedCronTriggerDeliveryRecord[] = [];
    const handler = handlerFor(record, delivered);

    const failure = await captureFailure(handler.handle(signedCallback(), new AbortController().signal));

    expect(failure).toMatchObject({ code, category, retryable: false });
    expect(delivered).toEqual([]);
  });

  function handlerFor(record: ClaimedCronTriggerDeliveryRecord | undefined, delivered: ClaimedCronTriggerDeliveryRecord[]) {
    return createCronTriggerCallbackHandler({
      verifier: verifier(),
      cronTasks: {
        async loadTriggerDelivery() {
          return record;
        },
      } as unknown as CronTaskGatewayPort,
      delivery: {
        async deliver(input) {
          delivered.push({ task: input.task, trigger: input.trigger });
          return { requestRunId: brand<string, 'RequestRunId'>('run-1') };
        },
      },
    });
  }

  it('coalesces concurrent duplicates and returns the durable accepted run on replay', async () => {
    let record = deliveryRecord();
    let submitCount = 0;
    const handler = createCronTriggerCallbackHandler({
      verifier: verifier(),
      cronTasks: {
        async loadTriggerDelivery() {
          return record;
        },
      } as unknown as CronTaskGatewayPort,
      delivery: {
        async deliver() {
          submitCount += 1;
          const requestRunId = brand<string, 'RequestRunId'>('run-1');
          record = {
            task: record.task,
            trigger: { ...record.trigger, status: 'ACCEPTED', requestRunId },
          };
          await Promise.resolve();
          return { requestRunId };
        },
      },
    });

    const [first, duplicate] = await Promise.all([
      handler.handle(signedCallback(), new AbortController().signal),
      handler.handle(signedCallback(), new AbortController().signal),
    ]);
    const replay = await handler.handle(signedCallback(), new AbortController().signal);

    expect(first).toEqual({ status: 'DELIVERED', requestRunId: 'run-1' });
    expect(duplicate).toEqual(first);
    expect(replay).toEqual({ status: 'ALREADY_DELIVERED', requestRunId: 'run-1' });
    expect(submitCount).toBe(1);
  });

  function verifier() {
    return createCronTriggerCallbackVerifier({
      credentialRef: 'env:CRON_CALLBACK_SECRET',
      credentialResolver: async () => secret,
      clock: () => now,
    });
  }

  function signedCallback(): CronTriggerCallbackInput {
    const unsigned = {
      taskId: 'task-1',
      triggerId: 'trigger-1',
      issuedAt: brand<number, 'EpochMillis'>(now),
      nonce: 'nonce-1',
    };
    return {
      ...unsigned,
      authentication: {
        algorithm: 'HMAC-SHA256',
        signature: createHmac('sha256', secret).update(buildCronTriggerCallbackSigningPayload(unsigned)).digest('base64url'),
      },
    };
  }
});

function deliveryRecord(
  overrides: {
    readonly taskStatus?: CronTaskRecord['status'];
    readonly triggerSubjectId?: string;
  } = {},
): ClaimedCronTriggerDeliveryRecord {
  const tenantId = brand<string, 'TenantId'>('tenant-1');
  const subjectId = brand<string, 'SubjectId'>('subject-1');
  const agentId = brand<string, 'AgentId'>('agent-1');
  const sessionId = brand<string, 'SessionId'>('session-1');
  const timestamp = brand<number, 'EpochMillis'>(1_700_000_000_000);
  const task: CronTaskRecord = {
    tenantId,
    subjectId,
    agentId,
    taskId: 'task-1',
    cron: '17 3 * * *',
    prompt: 'Check LTE handover failures from durable task facts.',
    recurring: true,
    status: overrides.taskStatus ?? 'ACTIVE',
    nextRunAt: timestamp,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const trigger: CronTriggerRecord = {
    tenantId,
    subjectId: brand<string, 'SubjectId'>(overrides.triggerSubjectId ?? subjectId),
    agentId,
    sessionId,
    taskId: task.taskId,
    triggerId: 'trigger-1',
    scheduledAt: timestamp,
    status: 'CLAIMED',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { task, trigger };
}

async function captureFailure(promise: Promise<unknown>): Promise<AgentError> {
  try {
    await promise;
  } catch (error) {
    return error as AgentError;
  }
  throw new Error('Expected Cron callback handling to fail.');
}
