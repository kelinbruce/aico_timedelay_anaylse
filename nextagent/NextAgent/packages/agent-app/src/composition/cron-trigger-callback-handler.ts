import { AgentError, type RequestRunId } from '@nextagent/agent-common';
import type { ClaimedCronTriggerDeliveryRecord, CronTaskGatewayPort, CronTriggerCallbackInput } from '@nextagent/agent-contracts/gateway';

import type { CronTriggerCallbackVerifier } from '../cron/cron-trigger-callback-verifier.js';
import type { CronTriggerDeliveryPort } from './cron-delivery-composition.js';

export interface CronTriggerCallbackHandler {
  handle: (input: unknown, signal: AbortSignal) => Promise<CronTriggerCallbackHandleResult>;
}

export type CronTriggerCallbackHandleResult =
  | { readonly status: 'DELIVERED'; readonly requestRunId: RequestRunId }
  | { readonly status: 'ALREADY_DELIVERED'; readonly requestRunId: RequestRunId };

export function createCronTriggerCallbackHandler(options: {
  readonly verifier: CronTriggerCallbackVerifier;
  readonly cronTasks: CronTaskGatewayPort;
  readonly delivery: CronTriggerDeliveryPort;
}): CronTriggerCallbackHandler {
  const inFlight = new Map<string, Promise<CronTriggerCallbackHandleResult>>();
  return {
    async handle(input, signal) {
      const callback = await options.verifier.verify(input, signal);
      const key = `${callback.taskId}\u0000${callback.triggerId}`;
      const pending = inFlight.get(key);
      if (pending !== undefined) {
        return pending;
      }
      const handling = handleVerifiedCallback(callback, signal, options);
      inFlight.set(key, handling);
      try {
        return await handling;
      } finally {
        if (inFlight.get(key) === handling) {
          inFlight.delete(key);
        }
      }
    },
  };
}

async function handleVerifiedCallback(
  callback: CronTriggerCallbackInput,
  signal: AbortSignal,
  options: {
    readonly cronTasks: CronTaskGatewayPort;
    readonly delivery: CronTriggerDeliveryPort;
  },
): Promise<CronTriggerCallbackHandleResult> {
  const target = await options.cronTasks.loadTriggerDelivery(
    {
      taskId: callback.taskId,
      triggerId: callback.triggerId,
    },
    signal,
  );
  assertValidCallbackTarget(callback, target);
  if (target.trigger.status === 'ACCEPTED' && target.trigger.requestRunId !== undefined) {
    return { status: 'ALREADY_DELIVERED', requestRunId: target.trigger.requestRunId };
  }
  if (target.trigger.status !== 'CLAIMED' || target.trigger.requestRunId !== undefined) {
    throw callbackTargetError('CRON_CALLBACK_TRIGGER_NOT_DELIVERABLE', 'Cron callback trigger is not deliverable.', 'CONFLICT');
  }
  const delivered = await options.delivery.deliver({ ...target, signal });
  return { status: 'DELIVERED', requestRunId: delivered.requestRunId };
}

function assertValidCallbackTarget(
  callback: CronTriggerCallbackInput,
  delivery?: ClaimedCronTriggerDeliveryRecord,
): asserts delivery is ClaimedCronTriggerDeliveryRecord {
  if (delivery === undefined) {
    throw callbackTargetError('CRON_CALLBACK_TARGET_NOT_FOUND', 'Cron callback target was not found.', 'NOT_FOUND');
  }
  const { task, trigger } = delivery;
  if (task.status === 'DELETED') {
    throw callbackTargetError('CRON_CALLBACK_TARGET_NOT_FOUND', 'Cron callback target was not found.', 'NOT_FOUND');
  }
  if (
    task.taskId !== callback.taskId ||
    trigger.taskId !== callback.taskId ||
    trigger.triggerId !== callback.triggerId ||
    task.tenantId !== trigger.tenantId ||
    task.subjectId !== trigger.subjectId ||
    task.agentId !== trigger.agentId
  ) {
    throw callbackTargetError('CRON_CALLBACK_SCOPE_MISMATCH', 'Cron callback scope validation failed.', 'AUTHORIZATION');
  }
}

function callbackTargetError(code: string, message: string, category: 'NOT_FOUND' | 'AUTHORIZATION' | 'CONFLICT'): AgentError {
  return new AgentError({ code, message, category, retryable: false });
}
