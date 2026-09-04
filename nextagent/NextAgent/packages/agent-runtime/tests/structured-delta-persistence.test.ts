import { brand, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { RuntimeOwnedAgentRunStatePort } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

describe('structured delta persistence interception and flush', () => {
  describe('emitEvent interception (Task 2)', () => {
    it('intercepts PERSISTED TOOL_STRUCTURED_DELTA — does not appendEvent, notifies live subscriber', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const onLiveTimelineEvent = vi.fn();
      const port = makePort({ appendEvent, onLiveTimelineEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'hello', { streaming: true }));

      expect(appendEvent).not.toHaveBeenCalled();
      expect(onLiveTimelineEvent).toHaveBeenCalledTimes(1);
      expect(onLiveTimelineEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'TOOL_STRUCTURED_DELTA', persistence: 'LIVE_ONLY' }));
    });

    it('intercepts LIVE_ONLY TOOL_STRUCTURED_DELTA — does not discard, notifies subscriber, stores in accumulator', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const onLiveTimelineEvent = vi.fn();
      const port = makePort({ appendEvent, onLiveTimelineEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'hello'));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(onLiveTimelineEvent).toHaveBeenCalledTimes(1);
      expect(appendEvent).toHaveBeenCalledTimes(1);
    });

    it('does not intercept non-TOOL_STRUCTURED_DELTA events', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const onLiveTimelineEvent = vi.fn();
      const port = makePort({ appendEvent, onLiveTimelineEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'NORMAL' } });

      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect(onLiveTimelineEvent).not.toHaveBeenCalled();
    });

    it('does not intercept Workflow product TOOL_STRUCTURED_DELTA', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const onLiveTimelineEvent = vi.fn();
      const port = makePort({ appendEvent, onLiveTimelineEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, {
        type: 'TOOL_STRUCTURED_DELTA',
        inlinePayload: {
          capabilityId: 'Workflow',
          toolCallId: 'workflow:node-1:node-1',
          toolEventType: 'ANSWER',
          toolMessageType: 'PIU',
          content: { data: { result: 'done' } },
          accumulated: true,
          nodeId: 'node-1',
          nodeType: 'TOOL',
          workflowEventType: 'NODE_COMPLETED',
        },
      });

      expect(appendEvent).toHaveBeenCalledTimes(1);
    });

    it('persists an oversized Workflow completed product as the bounded canonical live/history record', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => {
        if (Buffer.byteLength(JSON.stringify(record.inlinePayload)) >= 50_000) {
          throw new Error('REMOTE_INLINE_PAYLOAD_TOO_LARGE');
        }
        return { ...record, sequence: brand<number, 'TimelineSequence'>(1) };
      });
      const onLiveTimelineEvent = vi.fn();
      const onTimelineAppend = vi.fn();
      const port = makePort({ appendEvent, onLiveTimelineEvent, onTimelineAppend });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(
        run,
        context,
        makeWorkflowCompletedProduct('x'.repeat(60_000), { description: 'y'.repeat(60_000) }),
      );

      expect(appendEvent).toHaveBeenCalledTimes(1);
      const persistedInput = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
      expect(Buffer.byteLength(JSON.stringify(persistedInput.inlinePayload))).toBeLessThanOrEqual(49_000);
      expect(persistedInput.inlinePayload).toEqual(
        expect.objectContaining({
          capabilityId: 'render-result',
          toolCallId: 'workflow:execution-1:render-result',
          toolEventType: 'DETAIL',
          toolMessageType: 'TEXT',
          accumulated: true,
          workflowEventType: 'NODE_COMPLETED',
          nodeId: 'render-result',
          nodeType: 'DISPLAY',
          nodeExecutionId: 'node-execution-1',
          parentToolCallId: 'workflow:execution-1',
          truncated: true,
        }),
      );
      expect(typeof persistedInput.inlinePayload['content']).toBe('string');
      expect((persistedInput.inlinePayload['content'] as string).length).toBeLessThan(60_000);
      expect(onLiveTimelineEvent).not.toHaveBeenCalled();
      expect(onTimelineAppend).toHaveBeenCalledTimes(1);
      expect(onTimelineAppend.mock.calls[0]![0].inlinePayload).toEqual(persistedInput.inlinePayload);
    });

    it('propagates a real append failure for an oversized Workflow completed product', async () => {
      const appendEvent = vi.fn(async () => {
        throw new Error('TIMELINE_STORE_UNAVAILABLE');
      });
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await expect(port.emitEvent(run, context, makeWorkflowCompletedProduct('x'.repeat(60_000)))).rejects.toThrow(
        'TIMELINE_STORE_UNAVAILABLE',
      );
    });
  });

  describe('flush behavior (Task 3)', () => {
    it('flushes the matching structured presentation only after its Capability result Message is durable', async () => {
      const writeOrder: string[] = [];
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => {
        writeOrder.push('timeline');
        return { ...record, sequence: brand<number, 'TimelineSequence'>(1) };
      });
      const messageStore = {
        appendSessionMessage: vi.fn(async (record: SessionMessageRecord) => {
          writeOrder.push('message');
          return record;
        }),
      } as unknown as SessionMessageStoreGateway;
      const port = makePort({ appendEvent, messageStore });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'complete result'));
      await port.appendMessage(run, context, makeCapabilityResultDraft(run, 'call-1'));

      expect(writeOrder).toEqual(['message', 'timeline']);
      expect(appendEvent).toHaveBeenCalledTimes(1);
    });

    it('does not persist a structured presentation when its Capability result Message fails', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const messageStore = {
        appendSessionMessage: vi.fn(async () => {
          throw new Error('MESSAGE_STORE_UNAVAILABLE');
        }),
      } as unknown as SessionMessageStoreGateway;
      const port = makePort({ appendEvent, messageStore });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'partial result'));

      await expect(port.appendMessage(run, context, makeCapabilityResultDraft(run, 'call-1'))).rejects.toThrow(
        'MESSAGE_STORE_UNAVAILABLE',
      );
      expect(appendEvent).not.toHaveBeenCalled();
    });

    it('persists a bounded batch before the 257th event without duplicating live delivery', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const onLiveTimelineEvent = vi.fn();
      const onTimelineAppend = vi.fn();
      const port = makePort({ appendEvent, onLiveTimelineEvent, onTimelineAppend });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      for (let index = 0; index < 257; index += 1) {
        await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', `part-${index}`));
      }

      expect(appendEvent).toHaveBeenCalledTimes(256);
      expect(onLiveTimelineEvent).toHaveBeenCalledTimes(257);
      expect(onTimelineAppend).not.toHaveBeenCalled();

      await persistCapabilityResultAndFlush(port, run, context, 'call-1');
      expect(appendEvent).toHaveBeenCalledTimes(257);
      expect(onLiveTimelineEvent).toHaveBeenCalledTimes(257);
    });

    it('keeps owner and run coordinates isolated when concurrent runs share a toolCallId', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const runA = makeRunContext('a');
      const runB = makeRunContext('b');
      port.beginRun(runA.run);
      port.beginRun(runB.run);

      await port.emitEvent(runA.run, runA.context, makePiuDelta('shared-call', 'shared-uuid', { source: 'run-a' }));
      await port.emitEvent(runB.run, runB.context, makePiuDelta('shared-call', 'shared-uuid', { source: 'run-b' }));
      await persistCapabilityResultAndFlush(port, runA.run, runA.context, 'shared-call');
      await persistCapabilityResultAndFlush(port, runB.run, runB.context, 'shared-call');

      expect(appendEvent).toHaveBeenCalledTimes(2);
      const records = appendEvent.mock.calls.map((call) => call[0] as RunTimelineEventRecord);
      expect(records).toEqual([
        expect.objectContaining({
          tenantId: runA.context.identityContext.tenantId,
          subjectId: runA.context.identityContext.subjectId,
          agentId: runA.run.agentId,
          sessionId: runA.run.sessionId,
          requestId: runA.run.requestId,
          runId: runA.run.runId,
        }),
        expect.objectContaining({
          tenantId: runB.context.identityContext.tenantId,
          subjectId: runB.context.identityContext.subjectId,
          agentId: runB.run.agentId,
          sessionId: runB.run.sessionId,
          requestId: runB.run.requestId,
          runId: runB.run.runId,
        }),
      ]);
      expect((records[0]!.inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-a' }]);
      expect((records[1]!.inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-b' }]);
    });

    it('finishRun fallback only flushes the matching run when toolCallId values collide', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const runA = makeRunContext('a');
      const runB = makeRunContext('b');
      port.beginRun(runA.run);
      port.beginRun(runB.run);

      await port.emitEvent(runA.run, runA.context, makePiuDelta('shared-call', 'shared-uuid', { source: 'run-a' }));
      await port.emitEvent(runB.run, runB.context, makePiuDelta('shared-call', 'shared-uuid', { source: 'run-b' }));
      await port.finishRun(runA.run);

      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect((appendEvent.mock.calls[0]![0].inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-a' }]);

      await persistCapabilityResultAndFlush(port, runB.run, runB.context, 'shared-call');
      expect(appendEvent).toHaveBeenCalledTimes(2);
      expect((appendEvent.mock.calls[1]![0].inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-b' }]);
    });

    it('beginRun cleanup for one run does not clear another run with the same toolCallId', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const runA = makeRunContext('a');
      const runB = makeRunContext('b');
      port.beginRun(runA.run);
      port.beginRun(runB.run);

      await port.emitEvent(runA.run, runA.context, makePiuDelta('shared-call', 'shared-uuid', { source: 'run-a' }));
      await port.emitEvent(runB.run, runB.context, makePiuDelta('shared-call', 'shared-uuid', { source: 'run-b' }));
      port.discardRun(runA.run);
      port.beginRun(runA.run);

      await persistCapabilityResultAndFlush(port, runB.run, runB.context, 'shared-call');
      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect((appendEvent.mock.calls[0]![0].inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-b' }]);
    });

    it('flush writes aggregated event and does not trigger onTimelineAppend', async () => {
      const onTimelineAppend = vi.fn();
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent, onTimelineAppend });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 1 }));
      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 2 }));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect(onTimelineAppend).not.toHaveBeenCalled();
      const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
      const content = record.inlinePayload['content'] as JsonObject;
      expect(content['uuid']).toBe('uuid-1');
      expect(content['data']).toEqual([{ x: 1 }, { x: 2 }]);
    });

    it('flush clears state — subsequent events start fresh', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 1 }));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');
      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 2 }));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(appendEvent).toHaveBeenCalledTimes(2);
      const record1 = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
      const record2 = appendEvent.mock.calls[1]![0] as RunTimelineEventRecord;
      expect((record1.inlinePayload['content'] as JsonObject)['data']).toEqual([{ x: 1 }]);
      expect((record2.inlinePayload['content'] as JsonObject)['data']).toEqual([{ x: 2 }]);
    });

    it('empty flush does not write anything', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(appendEvent).not.toHaveBeenCalled();
    });

    it('finishRun does fallback flush for pending groups', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 1 }));
      await port.finishRun(run);

      expect(appendEvent).toHaveBeenCalledTimes(1);
      const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
      expect((record.inlinePayload['content'] as JsonObject)['data']).toEqual([{ x: 1 }]);
    });

    it('finishRun with no pending data does not write anything', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'hello'));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');
      await port.finishRun(run);

      expect(appendEvent).toHaveBeenCalledTimes(1);
    });

    it('beginRun clears stale accumulator state', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 1 }));
      port.discardRun(run);
      port.beginRun(run);
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(appendEvent).not.toHaveBeenCalled();
    });
  });

  describe('history restore consistency (Task 5)', () => {
    it('STREAM_DSL ordering preserved: dataModel -> dsl-merged -> done', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeDslDelta('call-1', 'dataModel', { fields: [] }));
      await port.emitEvent(run, context, makeDslDelta('call-1', 'dsl', 'root = Stack('));
      await port.emitEvent(run, context, makeDslDelta('call-1', 'dsl', '  TextContent('));
      await port.emitEvent(run, context, makeDslDelta('call-1', 'done', null));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(appendEvent).toHaveBeenCalledTimes(3);
      const records = appendEvent.mock.calls.map((c) => c[0] as RunTimelineEventRecord);
      const types = records.map((r) => (r.inlinePayload['content'] as JsonObject)['type']);
      expect(types).toEqual(['dataModel', 'dsl', 'done']);
      const dslContent = (records[1]!.inlinePayload['content'] as JsonObject)['content'];
      expect(dslContent).toBe('root = Stack(  TextContent(');
    });

    it('multiple toolCallIds flushed independently', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 1 }));
      await port.emitEvent(run, context, makePiuDelta('call-2', 'uuid-2', { y: 1 }));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');
      await persistCapabilityResultAndFlush(port, run, context, 'call-2');

      expect(appendEvent).toHaveBeenCalledTimes(2);
    });

    it('non-streaming LIVE_ONLY structured delta is persisted via flush', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'complete result'));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(appendEvent).toHaveBeenCalledTimes(1);
      const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
      expect(record.inlinePayload['content']).toBe('complete result');
    });

    it('non-structured delta events unaffected — CAPABILITY_STARTED goes through normal path', async () => {
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, {
        type: 'CAPABILITY_STARTED',
        inlinePayload: { capabilityId: 'Bash', toolCallId: 'call-1', messageId: 'msg-1' },
      });

      expect(appendEvent).toHaveBeenCalledTimes(1);
      const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
      expect(record.type).toBe('CAPABILITY_STARTED');
    });

    it('reuses one eventId for the live and persisted structured delta fact', async () => {
      const liveEvents: Array<{ eventId?: string }> = [];
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({
        appendEvent,
        onLiveTimelineEvent: (event) => {
          liveEvents.push(event as { eventId?: string });
        },
      });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'frame-1'));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(liveEvents).toHaveLength(1);
      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect(appendEvent.mock.calls[0]![0].eventId).toBe(liveEvents[0]?.eventId);
    });

    it('subscriber does not receive duplicate notification on flush', async () => {
      const onLiveTimelineEvent = vi.fn();
      const onTimelineAppend = vi.fn();
      const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
      const port = makePort({ appendEvent, onLiveTimelineEvent, onTimelineAppend });
      const { run, context } = makeRunContext();
      port.beginRun(run);

      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 1 }));
      await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', { x: 2 }));
      await persistCapabilityResultAndFlush(port, run, context, 'call-1');

      expect(onLiveTimelineEvent).toHaveBeenCalledTimes(2);
      expect(onTimelineAppend).not.toHaveBeenCalled();
    });
  });
});

function makePort(deps: {
  appendEvent: RunTimelineEventStoreGateway['appendEvent'];
  messageStore?: SessionMessageStoreGateway;
  onLiveTimelineEvent?: (event: { type: string; inlinePayload: JsonObject }) => void;
  onTimelineAppend?: (record: RunTimelineEventRecord) => void;
}): RuntimeOwnedAgentRunStatePort {
  let id = 0;
  const onLiveTimelineEvent = deps.onLiveTimelineEvent ?? vi.fn();
  const onTimelineAppend = deps.onTimelineAppend ?? vi.fn();
  return new RuntimeOwnedAgentRunStatePort({
    messageStore:
      deps.messageStore ??
      ({ appendSessionMessage: vi.fn(async (record: SessionMessageRecord) => record) } as unknown as SessionMessageStoreGateway),
    timelineStore: { appendEvent: deps.appendEvent, listEvents: vi.fn(async () => []) } satisfies RunTimelineEventStoreGateway,
    checkpointStore: {} as CheckpointStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    clock: () => brand<number, 'EpochMillis'>(10),
    idFactory: (prefix: string) => `${prefix}-${++id}`,
    onLiveTimelineEvent,
    onTimelineAppend,
  });
}

function makeCapabilityResultDraft(run: RequestRun, toolCallId: string) {
  return {
    role: 'CAPABILITY_RESULT' as const,
    content: JSON.stringify({ toolCallId, toolName: 'ApiCall', payload: { result: 'complete result' } }),
    contentType: 'PLAIN_TEXT' as const,
    visible: true,
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId, toolName: 'ApiCall' },
    idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:capability-result:${toolCallId}`),
  };
}

async function persistCapabilityResultAndFlush(
  port: RuntimeOwnedAgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  toolCallId: string,
): Promise<void> {
  await port.appendMessage(run, context, makeCapabilityResultDraft(run, toolCallId));
}

function makeRunContext(suffix = 'test-1'): { run: RequestRun; context: RequestContext } {
  const run: RequestRun = {
    runId: brand<string, 'RequestRunId'>(`run-${suffix}`),
    sessionId: brand<string, 'SessionId'>(`session-${suffix}`),
    requestId: brand<string, 'MessageId'>(`request-${suffix}`),
    agentId: brand<string, 'AgentId'>(`agent-${suffix}`),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: `agent-${suffix}:v1`,
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>(`context-${suffix}`),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>(`tenant-${suffix}`),
      subjectId: brand<string, 'SubjectId'>(`subject-${suffix}`),
      displayName: 'test',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
  return { run, context };
}

function makeStructuredDelta(
  toolCallId: string,
  messageType: string,
  content: JsonValue,
  extra: JsonObject = {},
): { type: 'TOOL_STRUCTURED_DELTA'; inlinePayload: JsonObject } {
  return {
    type: 'TOOL_STRUCTURED_DELTA',
    inlinePayload: {
      capabilityId: 'ApiCall',
      toolCallId,
      toolEventType: 'ANSWER',
      toolMessageType: messageType,
      content,
      ...extra,
    },
  };
}

function makePiuDelta(toolCallId: string, uuid: string, data: JsonValue): { type: 'TOOL_STRUCTURED_DELTA'; inlinePayload: JsonObject } {
  return makeStructuredDelta(toolCallId, 'PIU', {
    piuName: 'thoughtChain',
    piuVersion: '1.0.0',
    data,
    method: 'render',
    uuid,
  });
}

function makeWorkflowCompletedProduct(
  content: JsonValue,
  extra: JsonObject = {},
): { type: 'TOOL_STRUCTURED_DELTA'; inlinePayload: JsonObject } {
  return {
    type: 'TOOL_STRUCTURED_DELTA',
    inlinePayload: {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      toolEventType: 'DETAIL',
      toolMessageType: 'TEXT',
      content,
      accumulated: true,
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      nodeExecutionId: 'node-execution-1',
      parentToolCallId: 'workflow:execution-1',
      ...extra,
    },
  };
}

function makeDslDelta(toolCallId: string, innerType: string, innerContent: JsonValue): { type: 'TOOL_STRUCTURED_DELTA'; inlinePayload: JsonObject } {
  return makeStructuredDelta(toolCallId, 'STREAM_DSL', { type: innerType, content: innerContent });
}
