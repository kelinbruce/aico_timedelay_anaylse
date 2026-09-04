import { brand } from '@nextagent/agent-common';
import type { ActiveContextStoreGateway, CheckpointStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { saveRuntimeCheckpoint } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

describe('saveRuntimeCheckpoint', () => {
  it('keeps same-turn replay idempotent without collapsing consecutive turn coordinates', async () => {
    const keys: string[] = [];
    const checkpointStore = {
      async saveCheckpoint(record, options) {
        keys.push(String(options.idempotencyKey));
        return record;
      },
    } as CheckpointStoreGateway;
    const activeContextStore = {
      async loadActiveContext() {
        throw new Error('no active context');
      },
    } as unknown as ActiveContextStoreGateway;
    const run = requestRun();
    const save = async (agentTurnIndex: number) =>
      await saveRuntimeCheckpoint({ checkpointStore, activeContextStore }, run, { ...requestContext(), agentTurnIndex }, 'STEP_STARTED', {
        now: () => brand<number, 'EpochMillis'>(1),
        id: () => `checkpoint-${agentTurnIndex}`,
      });

    await save(0);
    await save(0);
    await save(1);

    expect(keys).toEqual([
      'run-checkpoint:checkpoint:STEP_STARTED:7:0',
      'run-checkpoint:checkpoint:STEP_STARTED:7:0',
      'run-checkpoint:checkpoint:STEP_STARTED:7:1',
    ]);
  });
});

function requestRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-checkpoint'),
    sessionId: brand<string, 'SessionId'>('session-checkpoint'),
    requestId: brand<string, 'MessageId'>('request-checkpoint'),
    agentId: brand<string, 'AgentId'>('agent-checkpoint'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-checkpoint:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 7,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function requestContext(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-checkpoint'),
    sessionId: brand<string, 'SessionId'>('session-checkpoint'),
    requestId: brand<string, 'MessageId'>('request-checkpoint'),
    runId: brand<string, 'RequestRunId'>('run-checkpoint'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-checkpoint'),
      subjectId: brand<string, 'SubjectId'>('subject-checkpoint'),
      displayName: 'checkpoint tester',
    },
    locale: brand<string, 'RequestLocale'>('en-US'),
    agentId: brand<string, 'AgentId'>('agent-checkpoint'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-checkpoint:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}
