import { brand } from '@nextagent/agent-common';
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

describe('cancel terminal content suppression exemption', () => {
  it('keeps one Capability terminal answer run-local and ignores intermediate LLM deltas as a source conflict', async () => {
    const port = makePort({});
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'streaming draft' } });
    await port.setCapabilityTerminalAnswer(run, context, { content: 'capability answer' });

    expect(await port.finishRun(run)).toEqual({
      finalContent: 'streaming draft',
      outputExceeded: false,
      capabilityTerminalAnswer: { content: 'capability answer' },
    });
  });

  it('fails closed on duplicate or conflicting terminal answer sources', async () => {
    const run = makeRun();
    const context = makeContext(run);
    const duplicate = makePort({});
    duplicate.beginRun(run);
    await duplicate.setCapabilityTerminalAnswer(run, context, { content: 'first' });
    await expect(duplicate.setCapabilityTerminalAnswer(run, context, { content: 'second' })).rejects.toMatchObject({
      code: 'CAPABILITY_TERMINAL_ANSWER_ALREADY_SET',
    });

    const llmFirst = makePort({});
    llmFirst.beginRun(run);
    await llmFirst.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'llm answer' } });
    await expect(llmFirst.setCapabilityTerminalAnswer(run, context, { content: 'capability answer' })).rejects.toMatchObject({
      code: 'TERMINAL_ANSWER_SOURCE_CONFLICT',
    });

    const capabilityFirst = makePort({});
    capabilityFirst.beginRun(run);
    await capabilityFirst.setCapabilityTerminalAnswer(run, context, { content: 'capability answer' });
    await expect(
      capabilityFirst.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'llm answer' } }),
    ).rejects.toMatchObject({ code: 'TERMINAL_ANSWER_SOURCE_CONFLICT' });
  });

  it('clears a pending Capability terminal answer when the run is discarded', async () => {
    const port = makePort({});
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);
    await port.setCapabilityTerminalAnswer(run, context, { content: 'must not escape' });

    port.discardRun(run);

    await expect(port.setCapabilityTerminalAnswer(run, context, { content: 'late answer' })).rejects.toMatchObject({
      code: 'CAPABILITY_TERMINAL_ANSWER_RUN_NOT_ACTIVE',
    });
  });

  it('exempts LLM_CONTENT_DELTA with final:true from suppression and writes output.content', async () => {
    const onLiveTimelineEvent = vi.fn();
    const port = makePort({ onLiveTimelineEvent, shouldSuppress: () => true });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { final: true, content: 'rollback result data' },
    });

    expect(onLiveTimelineEvent).toHaveBeenCalledTimes(1);
    expect(onLiveTimelineEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { final: true, content: 'rollback result data' },
    });
    expect(await port.finishRun(run)).toEqual({ finalContent: 'rollback result data', outputExceeded: false });
  });

  it('suppresses intermediate LLM_CONTENT_DELTA (final not true) during cancel', async () => {
    const onLiveTimelineEvent = vi.fn();
    const port = makePort({ onLiveTimelineEvent, shouldSuppress: () => true });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { content: 'partial streaming content' },
    });

    expect(onLiveTimelineEvent).not.toHaveBeenCalled();
    expect(await port.finishRun(run)).toEqual({ finalContent: '', outputExceeded: false });
  });

  it('suppresses non-LLM_CONTENT_DELTA events during cancel', async () => {
    const onLiveTimelineEvent = vi.fn();
    const onTimelineAppend = vi.fn();
    const port = makePort({ onLiveTimelineEvent, onTimelineAppend, shouldSuppress: () => true });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'CAPABILITY_RESULT_DELTA',
      inlinePayload: { toolCallId: 'tc-1', status: 'SUCCEEDED', content: 'tool output' },
    });

    expect(onLiveTimelineEvent).not.toHaveBeenCalled();
    expect(onTimelineAppend).not.toHaveBeenCalled();
  });

  it('does not suppress when shouldSuppress is false (normal path unchanged)', async () => {
    const onLiveTimelineEvent = vi.fn();
    const port = makePort({ onLiveTimelineEvent, shouldSuppress: () => false });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { content: 'normal streaming content' },
    });

    expect(onLiveTimelineEvent).toHaveBeenCalledTimes(1);
    expect(await port.finishRun(run)).toEqual({ finalContent: 'normal streaming content', outputExceeded: false });
  });

  it('applies terminal message size limit to exempted final content', async () => {
    const onLiveTimelineEvent = vi.fn();
    const port = makePort({ onLiveTimelineEvent, shouldSuppress: () => true });
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { final: true, content: 'x'.repeat(200_000) },
    });

    expect(await port.finishRun(run)).toEqual({
      finalContent: 'Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED',
      outputExceeded: true,
    });
  });

  it('does not apply the terminal Message limit to a large Workflow product Event', async () => {
    const port = makePort({});
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'TOOL_STRUCTURED_DELTA',
      inlinePayload: {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        capabilityId: 'render-result',
        toolCallId: 'workflow:execution-1:render-result',
        toolEventType: 'DETAIL',
        toolMessageType: 'TEXT',
        content: 'x'.repeat(200_000),
        accumulated: true,
      },
    });
    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { final: true, content: 'small terminal answer' },
    });

    expect(await port.finishRun(run)).toEqual({ finalContent: 'small terminal answer', outputExceeded: false });
  });

  it('does not treat an inner Workflow LLM delta as the turn answer', async () => {
    const port = makePort({});
    const run = makeRun();
    const context = makeContext(run);
    port.beginRun(run);

    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: {
        workflowEventType: 'NODE_OUTPUT_DELTA',
        nodeId: 'inner-llm',
        nodeType: 'LLM',
        content: 'x'.repeat(200_000),
      },
    });
    await port.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { final: true, content: 'small terminal answer' },
    });

    expect(await port.finishRun(run)).toEqual({ finalContent: 'small terminal answer', outputExceeded: false });
  });
});

function makePort(overrides: Partial<import('@nextagent/agent-runtime').RuntimeOwnedAgentRunStatePortDependencies>): RuntimeOwnedAgentRunStatePort {
  const timelineStore: RunTimelineEventStoreGateway = {
    appendEvent: vi.fn(async (record: RunTimelineEventRecord) => ({
      ...record,
      sequence: brand<number, 'TimelineSequence'>(1),
    })),
    listEvents: vi.fn(async () => []),
  };
  return new RuntimeOwnedAgentRunStatePort({
    messageStore: {} as SessionMessageStoreGateway,
    timelineStore,
    checkpointStore: {} as CheckpointStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    clock: () => brand<number, 'EpochMillis'>(10),
    idFactory: (prefix: string) => `${prefix}-1`,
    ...overrides,
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
      displayName: 'cancel-suppression-test',
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
