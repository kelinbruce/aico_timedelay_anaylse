import { brand } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { RuntimeOwnedAgentRunStatePort } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

describe('runtime-owned thinking persistence', () => {
  it('publishes in-progress thinking live-only and appends the completed last delta before publication', async () => {
    const order: string[] = [];
    const appended: RunTimelineEventRecord[] = [];
    const live: RunTimelineEvent[] = [];
    const timelineStore: RunTimelineEventStoreGateway = {
      appendEvent: vi.fn(async (record) => {
        order.push('append');
        const persisted = { ...record, sequence: brand<number, 'TimelineSequence'>(1) };
        appended.push(persisted);
        return persisted;
      }),
      listEvents: vi.fn(async () => []),
    };
    const port = makePort(timelineStore, {
      onTimelineAppend(record) {
        order.push('publish-persisted');
        expect(record).toBe(appended[0]);
      },
      onLiveTimelineEvent(event) {
        order.push('publish-live');
        live.push(event);
      },
    });
    const run = makeRun();
    const context = makeContext(run);

    await port.emitEvent(run, context, {
      type: 'LLM_THINKING_DELTA',
      persistence: 'LIVE_ONLY',
      inlinePayload: { reasoning: 'checking', stepId: 'model:1' },
    });
    await port.emitEvent(run, context, {
      type: 'LLM_THINKING_DELTA',
      persistence: 'PERSISTED',
      inlinePayload: { reasoning: 'checking routes', stepId: 'model:1', completed: true },
    });

    expect(order).toEqual(['publish-live', 'append', 'publish-persisted']);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ persistence: 'LIVE_ONLY' });
    expect(live[0]).not.toHaveProperty('sequence');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: 'LLM_THINKING_DELTA',
      inlinePayload: { reasoning: 'checking routes', stepId: 'model:1', completed: true },
    });
  });

  it('publishes neither completed thinking nor a dependent terminal when append fails', async () => {
    const failure = new Error('timeline unavailable');
    const onTimelineAppend = vi.fn();
    const onLiveTimelineEvent = vi.fn();
    const timelineStore: RunTimelineEventStoreGateway = {
      appendEvent: vi.fn(async () => {
        throw failure;
      }),
      listEvents: vi.fn(async () => []),
    };
    const port = makePort(timelineStore, { onTimelineAppend, onLiveTimelineEvent });
    const run = makeRun();
    const context = makeContext(run);

    await expect(
      port.emitEvent(run, context, {
        type: 'LLM_THINKING_DELTA',
        persistence: 'PERSISTED',
        inlinePayload: { reasoning: 'checking', stepId: 'model:1', completed: true },
      }),
    ).rejects.toBe(failure);

    expect(onTimelineAppend).not.toHaveBeenCalled();
    expect(onLiveTimelineEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid oversized thinking before output-limit or timeline side effects', async () => {
    const appendEvent = vi.fn();
    const onTimelineAppend = vi.fn();
    const onLiveTimelineEvent = vi.fn();
    const idFactory = vi.fn((prefix: string) => `${prefix}-1`);
    const timelineStore: RunTimelineEventStoreGateway = {
      appendEvent,
      listEvents: vi.fn(async () => []),
    };
    const port = new RuntimeOwnedAgentRunStatePort({
      messageStore: {} as SessionMessageStoreGateway,
      timelineStore,
      checkpointStore: {} as CheckpointStoreGateway,
      activeContextStore: {} as ActiveContextStoreGateway,
      clock: () => brand<number, 'EpochMillis'>(10),
      idFactory,
      onTimelineAppend,
      onLiveTimelineEvent,
    });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await expect(
      port.emitEvent(run, context, {
        type: 'LLM_THINKING_DELTA',
        persistence: 'PERSISTED',
        inlinePayload: {
          reasoning: 'invalid payload',
          stepId: 'model:1',
          completed: true,
          content: 'x'.repeat(150_001),
        },
      }),
    ).rejects.toMatchObject({ code: 'TIMELINE_EVENT_PERSISTENCE_INVALID' });

    expect(appendEvent).not.toHaveBeenCalled();
    expect(onTimelineAppend).not.toHaveBeenCalled();
    expect(onLiveTimelineEvent).not.toHaveBeenCalled();
    expect(idFactory).not.toHaveBeenCalled();
    expect(await port.finishRun(run)).toEqual({ finalContent: '', outputExceeded: false });
  });

  it('rejects run context mismatch before persistence or publication side effects', async () => {
    const appendEvent = vi.fn();
    const onTimelineAppend = vi.fn();
    const onLiveTimelineEvent = vi.fn();
    const idFactory = vi.fn((prefix: string) => `${prefix}-1`);
    const timelineStore: RunTimelineEventStoreGateway = {
      appendEvent,
      listEvents: vi.fn(async () => []),
    };
    const port = new RuntimeOwnedAgentRunStatePort({
      messageStore: {} as SessionMessageStoreGateway,
      timelineStore,
      checkpointStore: {} as CheckpointStoreGateway,
      activeContextStore: {} as ActiveContextStoreGateway,
      clock: () => brand<number, 'EpochMillis'>(10),
      idFactory,
      onTimelineAppend,
      onLiveTimelineEvent,
    });
    const run = makeRun();
    const context = {
      ...makeContext(run),
      runId: brand<string, 'RequestRunId'>('different-run'),
    };

    await expect(
      port.emitEvent(run, context, {
        type: 'LLM_THINKING_DELTA',
        persistence: 'PERSISTED',
        inlinePayload: { reasoning: 'valid', stepId: 'model:1', completed: true },
      }),
    ).rejects.toMatchObject({ code: 'RUN_CONTEXT_MISMATCH' });

    expect(appendEvent).not.toHaveBeenCalled();
    expect(onTimelineAppend).not.toHaveBeenCalled();
    expect(onLiveTimelineEvent).not.toHaveBeenCalled();
    expect(idFactory).not.toHaveBeenCalled();
  });
});

function makePort(
  timelineStore: RunTimelineEventStoreGateway,
  callbacks: Pick<import('@nextagent/agent-runtime').RuntimeOwnedAgentRunStatePortDependencies, 'onTimelineAppend' | 'onLiveTimelineEvent'>,
): RuntimeOwnedAgentRunStatePort {
  let id = 0;
  return new RuntimeOwnedAgentRunStatePort({
    messageStore: {} as SessionMessageStoreGateway,
    timelineStore,
    checkpointStore: {} as CheckpointStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    clock: () => brand<number, 'EpochMillis'>(10),
    idFactory: (prefix) => `${prefix}-${++id}`,
    ...callbacks,
  });
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-1:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'thinking-persistence-test',
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
