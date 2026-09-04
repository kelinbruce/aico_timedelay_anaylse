import { executeToolCallsInOrder } from '@nextagent/agent-core';
import { AgentError, bindRuntimeLoggerProvider, brand, type JsonObject, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityDescriptor,
  CapabilityInvocationPort,
  CapabilityInvocationResult,
} from '@nextagent/agent-contracts/capability';
import type {
  AgentRunStatePort,
  LifecycleHookInvocationPort,
  PendingInputIntent,
  PendingInputRequest,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import { LifecycleHookInterruptionError } from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('parallel tool loop', () => {
  it('logs a real tool payload with its model step and without generated message bodies', async () => {
    const runtimeEntries: Array<Record<string, unknown>> = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureRuntimeLogger(runtimeEntries) });

    await executeToolCallsInOrder(
      deps({
        invoke: async () => ({
          status: 'SUCCEEDED',
          structuredPayload: { stdout: 'diagnostic output', exitCode: 0 },
          generatedMessages: [{ role: 'USER', content: 'generated message body' }],
          artifactRefs: [],
        }),
      }),
      input({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: { path: 'alarm.json' } }],
      }),
    );

    const payload = runtimeEntries.find((entry) => entry.event === 'tool.payload.captured');
    expect(payload).toMatchObject({
      stepId: 'turn-1',
      toolCallId: 'call-1',
      toolInput: { path: 'alarm.json' },
      toolSafeSummary: expect.any(String),
      toolOutput: {
        status: 'SUCCEEDED',
        structuredPayload: { stdout: 'diagnostic output', exitCode: 0 },
        generatedMessageCount: 1,
        generatedMessageKinds: ['USER'],
        artifactRefs: [],
      },
    });
    expect(payload).not.toHaveProperty('toolInputPreview');
    expect(payload?.toolOutput).not.toHaveProperty('generatedMessages');
  });

  it('keeps the matching outer protocol Message pair for Workflow-as-Tool', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];
    const structuredPayload = {
      recipeName: 'alarm-diagnosis',
      status: 'succeeded',
      answerPreviews: ['workflow result'],
    };
    let outerStartedBeforeInvoke = false;

    await executeToolCallsInOrder(
      deps({
        invoke: async () => {
          outerStartedBeforeInvoke = events.some(
            (event) => event.type === 'CAPABILITY_STARTED' && event.inlinePayload['toolCallId'] === 'outer-workflow-call',
          );
          return successfulResult(structuredPayload);
        },
      }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [
          {
            toolCallId: 'outer-workflow-call',
            toolName: 'Workflow',
            arguments: { recipeName: 'alarm-diagnosis' },
          },
        ],
      }),
    );

    expect(appendedMessages.map((message) => message.role)).toEqual(['ASSISTANT', 'CAPABILITY_RESULT']);
    expect(capabilityResultMessages(appendedMessages)).toEqual([{ toolCallId: 'outer-workflow-call', payload: structuredPayload }]);
    expect(outerStartedBeforeInvoke).toBe(true);
    expect(events.filter((event) => event.type === 'CAPABILITY_STARTED')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          messageId: 'message-1',
          capabilityId: 'Workflow',
          toolCallId: 'outer-workflow-call',
        }),
      }),
    ]);
    expect(events.filter((event) => event.type === 'CAPABILITY_RESULT_DELTA')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          capabilityId: 'Workflow',
          toolCallId: 'outer-workflow-call',
          result: structuredPayload,
        }),
      }),
    ]);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED' && event.inlinePayload['toolCallId'] === 'outer-workflow-call')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          messageId: 'message-2',
          capabilityId: 'Workflow',
          status: 'SUCCEEDED',
        }),
      }),
    ]);
  });

  it.each(['DEGRADED', 'TIMED_OUT'] as const)('publishes an ordinary message-backed outer result for Workflow-as-Tool %s', async (status) => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];
    const result: CapabilityInvocationResult = {
      status,
      structuredPayload: {
        recipeName: 'alarm-diagnosis',
        status: status === 'DEGRADED' ? 'waiting' : 'failed',
        answerPreviews: [],
      },
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: status === 'DEGRADED' ? 'WORKFLOW_PENDING_INPUT' : 'WORKFLOW_TIMED_OUT',
        message: status === 'DEGRADED' ? 'Workflow is waiting for user input.' : 'Workflow execution timed out.',
        category: status === 'DEGRADED' ? 'UNAVAILABLE' : 'TIMEOUT',
        retryable: false,
      },
    };

    await executeToolCallsInOrder(
      deps({ invoke: async () => result }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [
          {
            toolCallId: 'outer-workflow-call',
            toolName: 'Workflow',
            arguments: { recipeName: 'alarm-diagnosis' },
          },
        ],
      }),
    );

    expect(capabilityResultMessages(appendedMessages)).toHaveLength(1);
    expect(events.filter((event) => event.type === 'CAPABILITY_RESULT_DELTA')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          capabilityId: 'Workflow',
          toolCallId: 'outer-workflow-call',
          result: result.structuredPayload,
        }),
      }),
    ]);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED' && event.inlinePayload['toolCallId'] === 'outer-workflow-call')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          messageId: 'message-2',
          status,
        }),
      }),
    ]);
  });

  it('keeps the Workflow-as-Tool FAILED outer protocol result without inventing a successful result delta', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];
    const result: CapabilityInvocationResult = {
      status: 'FAILED',
      structuredPayload: {
        recipeName: 'alarm-diagnosis',
        status: 'failed',
        answerPreviews: [],
      },
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: 'WORKFLOW_FAILED',
        message: 'Workflow execution failed.',
        category: 'INTERNAL',
        retryable: false,
      },
    };

    await executeToolCallsInOrder(
      deps({ invoke: async () => result }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [
          {
            toolCallId: 'outer-workflow-call',
            toolName: 'Workflow',
            arguments: { recipeName: 'alarm-diagnosis' },
          },
        ],
      }),
    );

    expect(appendedMessages.map((message) => message.role)).toEqual(['ASSISTANT', 'CAPABILITY_RESULT']);
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      {
        toolCallId: 'outer-workflow-call',
        payload: expect.objectContaining({
          status: 'FAILED',
          result: result.structuredPayload,
          safeError: expect.objectContaining({ code: 'WORKFLOW_FAILED', category: 'INTERNAL' }),
        }),
      },
    ]);
    expect(events.filter((event) => event.type === 'CAPABILITY_RESULT_DELTA')).toEqual([]);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED' && event.inlinePayload['toolCallId'] === 'outer-workflow-call')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          messageId: 'message-2',
          capabilityId: 'Workflow',
          status: 'FAILED',
          safeErrorCode: 'WORKFLOW_FAILED',
          safeErrorCategory: 'INTERNAL',
        }),
      }),
    ]);
  });

  it('publishes completed process events as strong references to the messages written first', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];
    const order: string[] = [];
    let messageOrdinal = 0;
    const baseRunState = stubRunState();
    const runState: AgentRunStatePort = {
      ...baseRunState,
      async appendMessage(_run, _context, draft) {
        appendedMessages.push(draft);
        messageOrdinal += 1;
        order.push(`message:${messageOrdinal}`);
        return brand<string, 'MessageId'>(`message-${messageOrdinal}`);
      },
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        events.push(event);
        order.push(`event:${event.type}`);
      },
    };

    await executeToolCallsInOrder(
      deps({ invoke: async () => successfulResult({ value: 'final' }) }),
      input({
        runState,
        toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: { path: 'alarm.json' } }],
        assistantContent: 'I will inspect the alarm evidence.',
      }),
    );

    const completedContent = events.find((event) => event.type === 'LLM_CONTENT_DELTA' && event.inlinePayload.completed === true);
    expect(completedContent).toEqual(
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: {
          messageId: 'message-1',
          stepId: 'turn-1',
          completed: true,
        },
      }),
    );
    expect(completedContent?.inlinePayload).not.toHaveProperty('content');

    const started = events.find((event) => event.type === 'CAPABILITY_STARTED');
    expect(started?.inlinePayload).toEqual(
      expect.objectContaining({
        messageId: 'message-1',
        toolCallId: 'call-1',
      }),
    );
    expect(started?.inlinePayload).not.toHaveProperty('arguments');

    const completed = events.find((event) => event.type === 'CAPABILITY_COMPLETED');
    expect(completed?.inlinePayload).toEqual(
      expect.objectContaining({
        messageId: 'message-2',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
      }),
    );
    expect(completed?.inlinePayload).not.toHaveProperty('result');
    expect(order.indexOf('message:1')).toBeLessThan(order.indexOf('event:LLM_CONTENT_DELTA'));
    expect(order.indexOf('message:1')).toBeLessThan(order.indexOf('event:CAPABILITY_STARTED'));
    expect(order.indexOf('message:2')).toBeLessThan(order.lastIndexOf('event:CAPABILITY_COMPLETED'));
  });

  it('normalizes an unknown invocation rejection into one safe failure result while retaining local exception diagnostics', async () => {
    const failure = new TypeError('capability raw token=secret');
    const events: RunTimelineEvent[] = [];
    const appendedMessages: SessionMessageDraft[] = [];
    const runtimeEntries: Array<Record<string, unknown>> = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureRuntimeLogger(runtimeEntries) });

    await executeToolCallsInOrder(
      deps({
        invoke: async () => {
          throw failure;
        },
      }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          toolCallId: 'call-1',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_EXECUTION_FAILED',
          safeErrorCategory: 'INTERNAL',
        }),
      }),
    ]);
    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toHaveProperty('messageId');
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        payload: expect.objectContaining({
          safeError: expect.objectContaining({ code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL' }),
        }),
      }),
    ]);
    expect(runtimeEntries.find((entry) => entry.event === 'tool.call.failed')).toMatchObject({
      err: failure,
      stepId: 'turn-1',
      toolCallId: 'call-1',
      toolName: 'ReadA',
    });
    expect(runtimeEntries.filter((entry) => entry.event === 'tool.call.exception_captured')).toEqual([]);
  });

  it('feeds a known safe invocation rejection to the model without fabricating exception evidence', async () => {
    const events: RunTimelineEvent[] = [];
    const appendedMessages: SessionMessageDraft[] = [];
    const runtimeEntries: Array<Record<string, unknown>> = [];
    const failure = new AgentError({ code: 'READ_UNAVAILABLE', message: 'Read is unavailable.', category: 'UNAVAILABLE', retryable: true });
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureRuntimeLogger(runtimeEntries) });

    await executeToolCallsInOrder(
      deps({
        invoke: async () => {
          throw failure;
        },
      }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ safeError: expect.objectContaining({ code: 'READ_UNAVAILABLE', category: 'UNAVAILABLE' }) }),
      }),
    ]);
    expect(runtimeEntries.filter((entry) => entry.event === 'tool.call.exception_captured')).toEqual([]);
  });

  it('starts same-round ordinary tool invocations before waiting for the first result', async () => {
    const firstRelease = deferred<void>();
    const secondStarted = deferred<void>();
    const invokeOrder: string[] = [];
    const appendedMessages: SessionMessageDraft[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (request) => {
      const toolCallId = requireToolCallId(request.toolCallId);
      invokeOrder.push(toolCallId);
      if (toolCallId === 'call-1') {
        await secondStarted.promise;
        await firstRelease.promise;
      } else {
        secondStarted.resolve();
      }
      return successfulResult({ value: toolCallId });
    });

    const events: RunTimelineEvent[] = [];
    const execution = executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );

    await waitUntil(() => invokeOrder.length === 2);
    expect(invokeOrder).toEqual(['call-1', 'call-2']);
    firstRelease.resolve();
    await execution;
    expect(events.filter((event) => event.type === 'CAPABILITY_STARTED').map((event) => event.inlinePayload)).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', toolBatchExecutionMode: 'PARALLEL', toolBatchOrdinal: 1, toolBatchSize: 2 }),
      expect.objectContaining({ toolCallId: 'call-2', toolBatchExecutionMode: 'PARALLEL', toolBatchOrdinal: 2, toolBatchSize: 2 }),
    ]);
  });

  it('records serial execution when same-round request-local effects require ordering', async () => {
    const events: RunTimelineEvent[] = [];
    await executeToolCallsInOrder(
      deps({ invoke: async (request) => successfulResult({ value: request.toolCallId ?? 'missing' }) }),
      input({
        runState: stubRunState([], events),
        toolCalls: [
          { toolCallId: 'call-search', toolName: 'ToolSearch', arguments: {} },
          { toolCallId: 'call-skill', toolName: 'Skill', arguments: {} },
        ],
      }),
    );
    expect(events.filter((event) => event.type === 'CAPABILITY_STARTED').map((event) => event.inlinePayload)).toEqual([
      expect.objectContaining({ toolCallId: 'call-search', toolBatchExecutionMode: 'SERIAL', toolBatchOrdinal: 1, toolBatchSize: 2 }),
      expect.objectContaining({ toolCallId: 'call-skill', toolBatchExecutionMode: 'SERIAL', toolBatchOrdinal: 2, toolBatchSize: 2 }),
    ]);
  });

  it('writes model-visible tool results in model tool-call order, not completion order', async () => {
    const firstRelease = deferred<void>();
    const appendedMessages: SessionMessageDraft[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (request) => {
      const toolCallId = requireToolCallId(request.toolCallId);
      if (toolCallId === 'call-1') {
        await firstRelease.promise;
      }
      return successfulResult({ value: toolCallId });
    });

    const execution = executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: stubRunState(appendedMessages),
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );

    await waitUntil(() => invoke.mock.calls.length === 2);
    firstRelease.resolve();
    await execution;

    expect(capabilityResultMessages(appendedMessages).map((message) => message.toolCallId)).toEqual(['call-1', 'call-2']);
  });

  it('adds same-round batch diagnostics to canonical capability start facts', async () => {
    const firstRelease = deferred<void>();
    const events: RunTimelineEvent[] = [];
    const baseRunState = stubRunState();
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (request) => {
      const toolCallId = requireToolCallId(request.toolCallId);
      if (toolCallId === 'call-1') {
        await firstRelease.promise;
      }
      return successfulResult({ value: toolCallId });
    });

    const execution = executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: {
          ...baseRunState,
          async setCapabilityTerminalAnswer(): Promise<void> {},
          async emitEvent(_run, _context, event) {
            events.push(event);
          },
        },
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );

    await waitUntil(() => invoke.mock.calls.length === 2);
    firstRelease.resolve();
    await execution;

    expect(events.filter((event) => event.type === 'CAPABILITY_STARTED').map((event) => event.inlinePayload)).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', toolBatchExecutionMode: 'PARALLEL', toolBatchOrdinal: 1, toolBatchSize: 2 }),
      expect.objectContaining({ toolCallId: 'call-2', toolBatchExecutionMode: 'PARALLEL', toolBatchOrdinal: 2, toolBatchSize: 2 }),
    ]);
  });

  it('preserves successful same-round results when one tool returns a safe failed result', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (request) => {
      const toolCallId = requireToolCallId(request.toolCallId);
      if (toolCallId === 'call-2') {
        return failedResult('READ_DEGRADED');
      }
      return successfulResult({ value: toolCallId });
    });

    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: stubRunState(appendedMessages),
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );

    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', payload: { value: 'call-1' } }),
      expect.objectContaining({
        toolCallId: 'call-2',
        payload: expect.objectContaining({
          status: 'FAILED',
          safeError: expect.objectContaining({ code: 'READ_DEGRADED', category: 'VALIDATION' }),
        }),
      }),
    ]);
  });

  it('projects in-flight capability result deltas before completion and persists only one terminal result message', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_request, _signal, runtimeContext) => {
      await runtimeContext?.emitResultDelta?.({ structuredPayload: { bodyPreview: 'partial-1' } });
      await runtimeContext?.emitResultDelta?.({ structuredPayload: { bodyPreview: 'partial-2' } });
      return successfulResult({ value: 'final' });
    });

    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(events.filter((event) => event.type === 'CAPABILITY_RESULT_DELTA')).toEqual([
      expect.objectContaining({ inlinePayload: expect.objectContaining({ result: { bodyPreview: 'partial-1' } }) }),
      expect.objectContaining({ inlinePayload: expect.objectContaining({ result: { bodyPreview: 'partial-2' } }) }),
      expect.objectContaining({ inlinePayload: expect.objectContaining({ result: { value: 'final' } }) }),
    ]);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).not.toHaveProperty('result');
    expect(capabilityResultMessages(appendedMessages)).toEqual([expect.objectContaining({ toolCallId: 'call-1', payload: { value: 'final' } })]);
  });

  it('keeps terminal failure truth after streamed deltas', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_request, _signal, runtimeContext) => {
      await runtimeContext?.emitResultDelta?.({ structuredPayload: { bodyPreview: 'partial-timeout' } });
      return {
        status: 'TIMED_OUT',
        structuredPayload: { value: 'timed-out' },
        generatedMessages: [],
        artifactRefs: [],
        safeError: {
          code: 'TIMEOUT',
          message: 'Capability execution timed out.',
          category: 'TIMEOUT',
          retryable: false,
        },
      };
    });

    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(events.filter((event) => event.type === 'CAPABILITY_RESULT_DELTA')).toEqual([
      expect.objectContaining({ inlinePayload: expect.objectContaining({ result: { bodyPreview: 'partial-timeout' } }) }),
    ]);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          messageId: 'message-2',
          status: 'TIMED_OUT',
          safeErrorCode: 'TIMEOUT',
        }),
      }),
    ]);
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        payload: expect.objectContaining({
          status: 'TIMED_OUT',
          safeError: expect.objectContaining({ code: 'TIMEOUT', category: 'TIMEOUT' }),
        }),
      }),
    ]);
  });

  it('references the persisted result for a degraded completion', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];

    await executeToolCallsInOrder(
      deps({
        invoke: async () => ({
          ...successfulResult({ partial: true }),
          status: 'DEGRADED',
          safeError: {
            code: 'PARTIAL_RESULT',
            message: 'Only partial evidence is available.',
            category: 'UNAVAILABLE',
            retryable: false,
          },
        }),
      }),
      input({
        runState: stubRunState(appendedMessages, events),
        toolCalls: [{ toolCallId: 'call-degraded', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toEqual(
      expect.objectContaining({
        messageId: 'message-2',
        toolCallId: 'call-degraded',
        status: 'DEGRADED',
        safeErrorCode: 'PARTIAL_RESULT',
      }),
    );
  });

  it('does not publish process references when the assistant tool-use message write fails', async () => {
    const failure = new Error('assistant tool-use persistence unavailable');
    const events: RunTimelineEvent[] = [];
    const baseRunState = stubRunState([], events);
    const runState: AgentRunStatePort = {
      ...baseRunState,
      async appendMessage() {
        throw failure;
      },
    };

    await expect(
      executeToolCallsInOrder(
        deps({ invoke: async () => successfulResult({ value: 'unused' }) }),
        input({
          runState,
          toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: {} }],
          assistantContent: 'I will inspect the evidence.',
        }),
      ),
    ).rejects.toBe(failure);

    expect(events).toEqual([]);
  });

  it('does not publish a capability completion when the result message write fails', async () => {
    const failure = new Error('capability result persistence unavailable');
    const events: RunTimelineEvent[] = [];
    let appendCount = 0;
    const baseRunState = stubRunState([], events);
    const runState: AgentRunStatePort = {
      ...baseRunState,
      async appendMessage() {
        appendCount += 1;
        if (appendCount === 2) {
          throw failure;
        }
        return brand<string, 'MessageId'>('message-1');
      },
    };

    await expect(
      executeToolCallsInOrder(
        deps({ invoke: async () => successfulResult({ value: 'final' }) }),
        input({
          runState,
          toolCalls: [{ toolCallId: 'call-1', toolName: 'ReadA', arguments: {} }],
        }),
      ),
    ).rejects.toBe(failure);

    expect(events.some((event) => event.type === 'CAPABILITY_STARTED')).toBe(true);
    expect(events.some((event) => event.type === 'CAPABILITY_COMPLETED')).toBe(false);
  });

  it('executes the complete prefix supplied by the caller without owning a second quantity limit', async () => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => successfulResult({ ok: true }));

    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not invoke tool calls that appear after AskUserQuestion pending input', async () => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => successfulResult({ ok: true }));
    const pendingInput: PendingInputRequest = {
      id: brand<string, 'PendingInputId'>('pending-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      kind: 'QUESTION',
      questions: [{ prompt: 'Which site should I inspect?', options: [] }],
    };
    const runState = stubRunState();
    const requestPendingInput = vi.fn<AgentRunStatePort['requestPendingInput']>(async () => pendingInput);

    const result = await executeToolCallsInOrder(
      deps({ invoke, catalog: askUserQuestionCatalog() }),
      input({
        runState: { ...runState, requestPendingInput },
        toolCalls: [
          {
            toolCallId: 'ask-1',
            toolName: 'AskUserQuestion',
            arguments: { questions: [{ prompt: 'Which site should I inspect?' }] },
          },
          { toolCallId: 'call-after', toolName: 'ReadA', arguments: {} },
        ],
      }),
    );

    expect(result).toBe(pendingInput);
    expect(requestPendingInput).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects an invalid AskUserQuestion batch before invoking any sibling tool', async () => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => successfulResult({ ok: true }));
    const appendedMessages: SessionMessageDraft[] = [];
    const runState = stubRunState(appendedMessages);
    const requestPendingInput = vi.fn<AgentRunStatePort['requestPendingInput']>();

    await executeToolCallsInOrder(
      deps({ invoke, catalog: askUserQuestionCatalog() }),
      input({
        runState: { ...runState, requestPendingInput },
        toolCalls: [
          { toolCallId: 'call-before', toolName: 'ReadA', arguments: {} },
          {
            toolCallId: 'ask-invalid',
            toolName: 'AskUserQuestion',
            arguments: { questions: [{ prompt: 'Which site?', header: 'Site' }] },
          },
          { toolCallId: 'call-after', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(requestPendingInput).not.toHaveBeenCalled();
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({
        toolCallId: 'call-before',
        payload: expect.objectContaining({ safeError: expect.objectContaining({ code: 'CAPABILITY_BATCH_REJECTED' }) }),
      }),
      expect.objectContaining({
        toolCallId: 'ask-invalid',
        payload: expect.objectContaining({ safeError: expect.objectContaining({ code: 'CAPABILITY_INPUT_INVALID' }) }),
      }),
      expect.objectContaining({
        toolCallId: 'call-after',
        payload: expect.objectContaining({ safeError: expect.objectContaining({ code: 'CAPABILITY_BATCH_REJECTED' }) }),
      }),
    ]);
  });

  it('feeds forbidden capability rejection to the model without invoking the forbidden capability', async () => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => successfulResult({ ok: true }));
    const appendedMessages: SessionMessageDraft[] = [];
    const events: RunTimelineEvent[] = [];

    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        runState: stubRunState(appendedMessages, events),
        forbiddenCapabilityIds: new Set([brand<string, 'CapabilityId'>('ReadB')]),
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        payload: expect.objectContaining({
          safeError: expect.objectContaining({ code: 'CAPABILITY_BATCH_REJECTED', category: 'VALIDATION' }),
        }),
      }),
      expect.objectContaining({
        toolCallId: 'call-2',
        payload: expect.objectContaining({ safeError: expect.objectContaining({ code: 'CAPABILITY_FORBIDDEN_BY_ROUTING_CONSTRAINT' }) }),
      }),
    ]);
    expect(
      events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload.code === 'CAPABILITY_FORBIDDEN_BY_ROUTING_CONSTRAINT'),
    ).toHaveLength(1);
  });

  it('feeds prepare failures to the model without invoking the unavailable capability', async () => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => successfulResult({ ok: true }));
    const appendedMessages: SessionMessageDraft[] = [];

    await executeToolCallsInOrder(
      deps({ invoke, catalog: catalogWithUnavailable('ReadB') }),
      input({
        runState: stubRunState(appendedMessages),
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-2', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(capabilityResultMessages(appendedMessages)).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        payload: expect.objectContaining({
          safeError: expect.objectContaining({ code: 'CAPABILITY_BATCH_REJECTED', category: 'UNAVAILABLE' }),
        }),
      }),
      expect.objectContaining({
        toolCallId: 'call-2',
        payload: expect.objectContaining({ safeError: expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }) }),
      }),
    ]);
  });

  it.each(['DENY', 'BLOCK'] as const)('preserves lifecycle hook %s as request control without invoking or synthesizing a result', async (outcome) => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>();
    const appendedMessages: SessionMessageDraft[] = [];
    const lifecycleHook: LifecycleHookInvocationPort = {
      async invoke(request) {
        if (request.stage === 'BEFORE_CAPABILITY_INVOKE') {
          return {
            status: 'INTERRUPT',
            interruption: {
              stage: request.stage,
              hookInvocationId: `hook-${outcome.toLowerCase()}`,
              outcome,
              safeReason: `hook-${outcome.toLowerCase()}`,
            },
          };
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };

    await expect(
      executeToolCallsInOrder(
        deps({ invoke, lifecycleHook }),
        input({
          runState: stubRunState(appendedMessages),
          toolCalls: [{ toolCallId: `call-${outcome.toLowerCase()}`, toolName: 'ReadA', arguments: {} }],
        }),
      ),
    ).rejects.toBeInstanceOf(LifecycleHookInterruptionError);

    expect(invoke).not.toHaveBeenCalled();
    expect(capabilityResultMessages(appendedMessages)).toHaveLength(0);
  });

  it('preserves the preparation failure as the local diagnostic cause when cancellation wins', async () => {
    const controller = new AbortController();
    controller.abort();

    let caught: unknown;
    try {
      await executeToolCallsInOrder(
        deps({ invoke: vi.fn<CapabilityInvocationPort['invoke']>() }),
        input({
          signal: controller.signal,
          forbiddenCapabilityIds: new Set([brand<string, 'CapabilityId'>('ReadA')]),
          toolCalls: [{ toolCallId: 'call-canceled', toolName: 'ReadA', arguments: {} }],
        }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'ABORTED',
      category: 'CANCELED',
      cause: expect.objectContaining({ code: 'CAPABILITY_FORBIDDEN_BY_ROUTING_CONSTRAINT' }),
    });
  });

  it('does not count an unexecuted CAPABILITY_BATCH_REJECTED sibling as a repeated capability failure', async () => {
    const requestLocalState = { generatedMessages: [] };
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => failedResult('READ_FAILED'));

    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        requestLocalState,
        forbiddenCapabilityIds: new Set([brand<string, 'CapabilityId'>('ReadB')]),
        toolCalls: [
          { toolCallId: 'call-first-read-a', toolName: 'ReadA', arguments: {} },
          { toolCallId: 'call-first-read-b', toolName: 'ReadB', arguments: {} },
        ],
      }),
    );
    await executeToolCallsInOrder(
      deps({ invoke }),
      input({
        requestLocalState,
        toolCalls: [{ toolCallId: 'call-second-read-a', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

function deps(input: {
  readonly invoke: CapabilityInvocationPort['invoke'];
  readonly catalog?: CapabilityCatalog;
  readonly lifecycleHook?: LifecycleHookInvocationPort;
}) {
  const assemblyValue = assembly();
  return {
    capabilityCatalog: input.catalog ?? catalog(),
    capabilityInvocation: { invoke: input.invoke },
    ...(input.lifecycleHook === undefined ? {} : { lifecycleHook: input.lifecycleHook }),
    assemblyRegistry: {
      async active() {
        return assemblyValue;
      },
      async require() {
        return assemblyValue;
      },
    },
  };
}

function input(overrides: {
  readonly runState?: AgentRunStatePort;
  readonly toolCalls: NonNullable<Parameters<typeof executeToolCallsInOrder>[1]['toolCalls']>;
  readonly forbiddenCapabilityIds?: ReadonlySet<string & { readonly __brand: 'CapabilityId' }>;
  readonly assistantContent?: string;
  readonly requestLocalState?: Parameters<typeof executeToolCallsInOrder>[1]['requestLocalState'];
  readonly signal?: AbortSignal;
}): Parameters<typeof executeToolCallsInOrder>[1] {
  return {
    run: run(),
    context: context(),
    runState: overrides.runState ?? stubRunState(),
    signal: overrides.signal ?? new AbortController().signal,
    round: 0,
    toolCalls: overrides.toolCalls,
    requestLocalState: overrides.requestLocalState ?? { generatedMessages: [] },
    ...(overrides.assistantContent === undefined ? {} : { assistantContent: overrides.assistantContent }),
    ...(overrides.forbiddenCapabilityIds === undefined ? {} : { forbiddenCapabilityIds: overrides.forbiddenCapabilityIds }),
  };
}

function captureRuntimeLogger(entries: Array<Record<string, unknown>>) {
  const capture = (fields: object): void => {
    entries.push(fields as Record<string, unknown>);
  };
  return { error: capture, warn: capture, info: capture, debug: capture };
}

function catalog(): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve(request) {
      return descriptor(String(request.capabilityId));
    },
  };
}

function catalogWithUnavailable(unavailableName: string): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve(request) {
      const capabilityId = String(request.capabilityId);
      return capabilityId === unavailableName ? undefined : descriptor(capabilityId);
    },
  };
}

function askUserQuestionCatalog(): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve(request) {
      const capabilityId = String(request.capabilityId);
      return capabilityId === 'AskUserQuestion' ? askUserQuestionDescriptor() : descriptor(capabilityId);
    },
  };
}

function descriptor(name: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: name,
    description: name,
    availabilityStatus: 'AVAILABLE',
    replayPolicy: 'IDEMPOTENT',
  };
}

function askUserQuestionDescriptor(): CapabilityDescriptor {
  return {
    ...descriptor('AskUserQuestion'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', minLength: 1, maxLength: 500 },
              options: { type: 'array' },
              multiple: { type: 'boolean' },
              custom: { type: 'boolean' },
            },
          },
        },
      },
    },
  };
}

function successfulResult(payload: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload: payload,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function failedResult(code: string): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: { ok: false },
    generatedMessages: [],
    artifactRefs: [],
    safeError: {
      code,
      message: 'Tool failed safely.',
      category: 'VALIDATION',
      retryable: false,
    },
  };
}

function stubRunState(appendedMessages: SessionMessageDraft[] = [], events: RunTimelineEvent[] = []): AgentRunStatePort {
  return {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      events.push(event);
    },
    async appendMessage(_run, _context, draft) {
      appendedMessages.push(draft);
      return brand<string, 'MessageId'>(`message-${appendedMessages.length}`);
    },
    async saveCheckpoint() {},
    async requestPendingInput(_run: RequestRun, _context: RequestContext, _intent: PendingInputIntent) {
      throw new Error('requestPendingInput was not configured for this test.');
    },
  } as AgentRunStatePort;
}

function capabilityResultMessages(messages: readonly SessionMessageDraft[]): Array<{ readonly toolCallId: string; readonly payload: JsonObject }> {
  return messages
    .filter((message) => message.role === 'CAPABILITY_RESULT')
    .map((message) => {
      const parsed = JSON.parse(message.content) as { readonly toolCallId: string; readonly payload: JsonObject };
      return { toolCallId: parsed.toolCallId, payload: parsed.payload };
    });
}

function requireToolCallId(value?: string): string {
  if (value === undefined) {
    throw new Error('Expected test capability invocation to include toolCallId.');
  }
  return value;
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Test agent',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: { requestTimeoutMs: 30_000 },
  };
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function context(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new AgentError({ code: 'WAIT_UNTIL_TIMEOUT', message: 'Timed out waiting for test predicate.', category: 'TIMEOUT', retryable: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
