import { brand } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  PendingInputProducerRef,
  PendingInputRecord,
  PendingInputStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { PendingInputIntent, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { RuntimeOwnedAgentRunStatePort } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

const CREATED_AT = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

describe('AskUserQuestion pending input timeout', () => {
  it('uses the configured default timeout for canonical AskUserQuestion', async () => {
    const { port, pendingInputs } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => 15 * 60 * 1000,
    });

    const result = await requestAskUserQuestion(port, 'session-1');

    expect(result.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
    expect(pendingInputs[0]?.request.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
  });

  it('falls back to 30 minutes when the runtime dependency returns an invalid value', async () => {
    const { port } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => 0,
    });

    const result = await requestAskUserQuestion(port, 'session-1');

    expect(result.timeoutAt).toBe(CREATED_AT + DEFAULT_TIMEOUT_MS);
  });

  it('lets an explicit intent timeout win over the configured default', async () => {
    const { port } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => 15 * 60 * 1000,
    });

    const result = await requestAskUserQuestion(port, 'session-1', CREATED_AT + 60_000);

    expect(result.timeoutAt).toBe(CREATED_AT + 60_000);
  });

  it('keeps existing explicit timeout validation for every producer', async () => {
    const { port } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => 15 * 60 * 1000,
    });

    await expect(requestAskUserQuestion(port, 'session-1', CREATED_AT + 24 * 60 * 60 * 1000 + 1)).rejects.toThrow(/Pending input timeout is invalid/);
  });

  it('falls back to 30 minutes when the trusted provider fails', async () => {
    const { port } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => {
        throw new Error('provider unavailable');
      },
    });

    const result = await requestAskUserQuestion(port, 'session-1');

    expect(result.timeoutAt).toBe(CREATED_AT + DEFAULT_TIMEOUT_MS);
  });

  it('keeps other capability producers on the fixed 30 minute default', async () => {
    const { port } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => 15 * 60 * 1000,
    });

    const run = makeRun('session-1');
    const context = makeContext(run);
    const result = await port.requestPendingInput(run, context, makeIntent(), { producerRef: otherCapabilityProducer() });

    expect(result.timeoutAt).toBe(CREATED_AT + DEFAULT_TIMEOUT_MS);
  });

  it('does not change an accepted deadline when REMOTE config changes later', async () => {
    const values = [15 * 60 * 1000, 60 * 60 * 1000];
    const { port, pendingInputs } = makePort({
      askUserQuestionDefaultTimeoutMs: async () => values.shift() ?? DEFAULT_TIMEOUT_MS,
    });

    await requestAskUserQuestion(port, 'session-1');
    await requestAskUserQuestion(port, 'session-2');

    expect(pendingInputs[0]?.request.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
    expect(pendingInputs[1]?.request.timeoutAt).toBe(CREATED_AT + 60 * 60 * 1000);
  });
});

type PortOverrides = Partial<ConstructorParameters<typeof RuntimeOwnedAgentRunStatePort>[0]> & {
  askUserQuestionDefaultTimeoutMs?: () => Promise<number>;
};

function makePort(overrides: PortOverrides = {}) {
  const pendingInputs: PendingInputRecord[] = [];
  const timelineStore: RunTimelineEventStoreGateway = {
    appendEvent: vi.fn(async (record: RunTimelineEventRecord) => ({
      ...record,
      sequence: brand<number, 'TimelineSequence'>(1),
    })),
    listEvents: vi.fn(async () => []),
  } as unknown as RunTimelineEventStoreGateway;
  const pendingInputStore: PendingInputStoreGateway = {
    loadActivePendingInput: vi.fn(async () => undefined),
    createPendingInput: vi.fn(async (request: { readonly record: PendingInputRecord }) => {
      pendingInputs.push(request.record);
      return request.record;
    }),
  } as unknown as PendingInputStoreGateway;

  const port = new RuntimeOwnedAgentRunStatePort({
    messageStore: {} as SessionMessageStoreGateway,
    timelineStore,
    checkpointStore: {
      saveCheckpoint: vi.fn(async (record: Parameters<CheckpointStoreGateway['saveCheckpoint']>[0]) => record),
    } as unknown as CheckpointStoreGateway,
    activeContextStore: {
      loadActiveContext: vi.fn(async () => undefined),
    } as unknown as ActiveContextStoreGateway,
    pendingInputStore,
    clock: () => brand<number, 'EpochMillis'>(CREATED_AT),
    idFactory: (prefix: string) => `${prefix}-${pendingInputs.length + 1}`,
    ...overrides,
  });
  return { port, pendingInputs, pendingInputStore };
}

async function requestAskUserQuestion(
  port: RuntimeOwnedAgentRunStatePort,
  sessionId: string,
  timeoutAt?: number,
): Promise<ReturnType<RuntimeOwnedAgentRunStatePort['requestPendingInput']>> {
  const run = makeRun(sessionId);
  const context = makeContext(run);
  return port.requestPendingInput(run, context, makeIntent(timeoutAt), { producerRef: askUserQuestionProducer() });
}

function makeIntent(timeoutAt?: number): PendingInputIntent {
  return {
    kind: 'QUESTION',
    questions: [{ prompt: '请选择网络区域', options: [{ label: '核心网', value: 'core' }] }],
    ...(timeoutAt === undefined ? {} : { timeoutAt: brand<number, 'EpochMillis'>(timeoutAt) }),
  };
}

function askUserQuestionProducer(): PendingInputProducerRef {
  return {
    kind: 'CAPABILITY_INVOCATION',
    capabilityId: brand<string, 'CapabilityId'>('AskUserQuestion'),
    toolCallId: brand<string, 'ToolCallId'>('tool-call-1'),
  };
}

function otherCapabilityProducer(): PendingInputProducerRef {
  return {
    kind: 'CAPABILITY_INVOCATION',
    capabilityId: brand<string, 'CapabilityId'>('OtherTool'),
    toolCallId: brand<string, 'ToolCallId'>('tool-call-2'),
  };
}

function makeRun(sessionId: string): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>(`run-${sessionId}`),
    sessionId: brand<string, 'SessionId'>(sessionId),
    requestId: brand<string, 'MessageId'>(`request-${sessionId}`),
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
    requestContextId: brand<string, 'RequestContextId'>(`context-${run.sessionId}`),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'ask-user-question-timeout-test',
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
