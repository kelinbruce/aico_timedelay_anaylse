import { brand, type JsonObject } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { RuntimeOwnedAgentRunStatePort } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

describe('runtime-owned inline payload degradation', () => {
  it('persists events with payload under the size limit', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({
      ...record,
      sequence: brand<number, 'TimelineSequence'>(1),
    }));
    const onLiveTimelineEvent = vi.fn();
    const port = makePort({ appendEvent, onLiveTimelineEvent });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: 'NORMAL' },
    });

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(onLiveTimelineEvent).not.toHaveBeenCalled();
  });

  it('degrades oversized persisted events to live-only instead of appending', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({
      ...record,
      sequence: brand<number, 'TimelineSequence'>(1),
    }));
    const onLiveTimelineEvent = vi.fn();
    const port = makePort({ appendEvent, onLiveTimelineEvent });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    const oversizedPayload: JsonObject = { code: 'OVERSIZED', detail: 'x'.repeat(50_000) };

    await port.emitEvent(run, context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: oversizedPayload,
    });

    expect(appendEvent).not.toHaveBeenCalled();
    expect(onLiveTimelineEvent).toHaveBeenCalledTimes(1);
    expect(onLiveTimelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DEGRADATION_NOTICE',
        inlinePayload: oversizedPayload,
      }),
    );
  });
});

interface PortTestDeps {
  appendEvent: RunTimelineEventStoreGateway['appendEvent'];
  onLiveTimelineEvent: () => void;
}

function makePort(deps: PortTestDeps): RuntimeOwnedAgentRunStatePort {
  let id = 0;
  return new RuntimeOwnedAgentRunStatePort({
    messageStore: {} as SessionMessageStoreGateway,
    timelineStore: {
      appendEvent: deps.appendEvent,
      listEvents: vi.fn(async () => []),
    } satisfies RunTimelineEventStoreGateway,
    checkpointStore: {} as CheckpointStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    clock: () => brand<number, 'EpochMillis'>(10),
    idFactory: (prefix: string) => `${prefix}-${++id}`,
    onLiveTimelineEvent: deps.onLiveTimelineEvent,
  });
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-degrade-1'),
    sessionId: brand<string, 'SessionId'>('session-degrade-1'),
    requestId: brand<string, 'MessageId'>('request-degrade-1'),
    agentId: brand<string, 'AgentId'>('agent-degrade-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-degrade-1:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(run: RequestRun): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-degrade-1'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-degrade-1'),
      subjectId: brand<string, 'SubjectId'>('subject-degrade-1'),
      displayName: 'payload-degradation-test',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}
