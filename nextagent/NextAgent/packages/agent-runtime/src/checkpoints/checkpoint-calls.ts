import { brand, type EpochMillis, type IdempotencyKey } from '@nextagent/agent-common';
import type { ActiveContextStoreGateway, CheckpointRecord, CheckpointStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

export async function saveRuntimeCheckpoint(
  stores: { checkpointStore: CheckpointStoreGateway; activeContextStore: ActiveContextStoreGateway },
  run: RequestRun,
  context: RequestContext,
  triggerReason: CheckpointRecord['triggerReason'],
  helpers: { now: () => EpochMillis; id: (prefix: string) => string; idempotencyKey?: IdempotencyKey },
): Promise<CheckpointRecord> {
  const active = await stores.activeContextStore
    .loadActiveContext({
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      agentId: run.agentId,
      sessionId: run.sessionId,
    })
    .catch(() => undefined);
  const record: CheckpointRecord = {
    tenantId: context.identityContext.tenantId,
    subjectId: context.identityContext.subjectId,
    agentId: run.agentId,
    checkpointId: brand<string, 'CheckpointId'>(helpers.id('checkpoint')),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    requestContextId: context.requestContextId,
    runVersion: run.version,
    agentTurnIndex: context.agentTurnIndex,
    triggerReason,
    lastSequence: brand<number, 'TimelineSequence'>(0),
    activeContextVersion: active?.state.activeContextVersion ?? 0,
    flowVariables: context.flowVariables,
    savedAt: helpers.now(),
  };
  await stores.checkpointStore.saveCheckpoint(record, {
    idempotencyKey:
      helpers.idempotencyKey ?? brand<string, 'IdempotencyKey'>(`${run.runId}:checkpoint:${triggerReason}:${run.version}:${context.agentTurnIndex}`),
  });
  return record;
}
