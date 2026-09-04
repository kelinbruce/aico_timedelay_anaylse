import { AgentError, type EpochMillis } from '@nextagent/agent-common';
import type { RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RequestRun, SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { toRunRecord } from '../assembly/assembly-binding.js';

export async function startAcceptedRun(
  requestRunStore: RequestRunStoreGateway,
  command: SubmitRequestCommand,
  run: RequestRun,
  now: () => EpochMillis,
): Promise<RequestRun> {
  const executing: RequestRun = { ...run, status: 'EXECUTING', version: run.version + 1, updatedAt: now() };
  const result = await requestRunStore.saveRun(toRunRecord(executing, command), {
    expectedVersion: run.version,
  });
  if (result.status !== 'UPDATED') {
    throw new AgentError({ code: 'RUN_START_CONFLICT', message: 'Run start conflict.', category: 'CONFLICT', retryable: true });
  }
  return executing;
}
