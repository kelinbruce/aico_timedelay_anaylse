import { brand, type JsonObject, type JsonValue } from '@nextagent/agent-common';
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
import {
  maxTimelineInlinePayloadBytes,
  truncateTimelineInlinePayload,
} from '../src/timeline/runtime-payload.js';

describe('structured delta payload truncation on persistence', () => {
  it('truncates oversized TOOL_STRUCTURED_DELTA content on flush and persists with truncated=true', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    const oversizedContent = 'x'.repeat(maxTimelineInlinePayloadBytes + 10_000);
    await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', oversizedContent));
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    expect(appendEvent).toHaveBeenCalledTimes(1);
    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['truncated']).toBe(true);
    const persistedContent = record.inlinePayload['content'];
    expect(typeof persistedContent).toBe('string');
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('truncates oversized PIU merged content on finishRun fallback flush', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    const largeData: JsonValue = 'y'.repeat(48_800);
    await port.emitEvent(run, context, makePiuDelta('call-1', 'uuid-1', largeData));
    expect(appendEvent).not.toHaveBeenCalled();
    await port.finishRun(run);

    expect(appendEvent).toHaveBeenCalledTimes(1);
    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
    expect(record.inlinePayload['content']).toEqual(
      expect.objectContaining({
        uuid: 'uuid-1',
        data: expect.any(Array),
      }),
    );
    expect(typeof record.inlinePayload['content']).toBe('object');
  });

  it('preserves STREAM_DSL shape and a valid UTF-8 prefix when nested dsl content is oversized', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(
      run,
      context,
      makeStructuredDelta('call-1', 'STREAM_DSL', { type: 'dsl', content: '网🙂'.repeat(maxTimelineInlinePayloadBytes) }),
    );
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    const content = record.inlinePayload['content'] as JsonObject;
    expect(content['type']).toBe('dsl');
    expect(typeof content['content']).toBe('string');
    expect((content['content'] as string).includes('\uFFFD')).toBe(false);
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('preserves a generic object content shape instead of serializing it into a string', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(run, context, makeStructuredDelta('call-1', 'DSL', { first: 'x'.repeat(30_000), second: 'y'.repeat(30_000) }));
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(Array.isArray(record.inlinePayload['content'])).toBe(false);
    expect(typeof record.inlinePayload['content']).toBe('object');
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('preserves a generic array content shape and only retains complete prefix items', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(run, context, makeStructuredDelta('call-1', 'DSL', ['a'.repeat(30_000), 'b'.repeat(30_000)]));
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['content']).toEqual(['a'.repeat(30_000)]);
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('drops oversized optional shell fields and still enforces the hard byte bound', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => {
      if (Buffer.byteLength(JSON.stringify(record.inlinePayload)) >= 50_000) {
        throw new Error('REMOTE_INLINE_PAYLOAD_TOO_LARGE');
      }
      return { ...record, sequence: brand<number, 'TimelineSequence'>(1) };
    });
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(
      run,
      context,
      makeStructuredDelta('call-1', 'TEXT', 'small', { description: 'x'.repeat(60_000) }),
    );
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['description']).toBeUndefined();
    expect(record.inlinePayload['content']).toBe('small');
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('drops oversized optional PIU content fields while retaining its fixed identity fields', () => {
    const payload: JsonObject = {
      capabilityId: 'ApiCall',
      toolCallId: 'call-1',
      toolEventType: 'ANSWER',
      toolMessageType: 'PIU',
      content: {
        piuName: 'thoughtChain',
        piuVersion: '1.0.0',
        method: 'render',
        uuid: 'uuid-1',
        description: 'x'.repeat(60_000),
        data: [{ step: 1 }],
      },
    };

    const result = truncateTimelineInlinePayload(payload);

    expect(result['content']).toEqual({
      piuName: 'thoughtChain',
      piuVersion: '1.0.0',
      method: 'render',
      uuid: 'uuid-1',
      data: [{ step: 1 }],
    });
    expect(result['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('keeps the original oversized PIU incident below a 50,000-byte rejecting gateway boundary', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => {
      if (Buffer.byteLength(JSON.stringify(record.inlinePayload)) >= 50_000) {
        throw new Error('REMOTE_INLINE_PAYLOAD_TOO_LARGE');
      }
      return { ...record, sequence: brand<number, 'TimelineSequence'>(1) };
    });
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await expect(port.emitEvent(run, context, makePiuDelta('call-ir', 'uuid-ir', 'ir'.repeat(40_000)))).resolves.toBeUndefined();

    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['content']).toEqual(expect.objectContaining({ uuid: 'uuid-ir', data: expect.any(Array) }));
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('applies the same hard bound to an accumulated direct write', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(
      run,
      context,
      makeStructuredDelta('call-direct', 'STREAM_DSL', { type: 'dsl', content: '界'.repeat(60_000) }, { accumulated: true }),
    );

    expect(appendEvent).toHaveBeenCalledTimes(1);
    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['content']).toEqual(expect.objectContaining({ type: 'dsl', content: expect.any(String) }));
    expect(record.inlinePayload['truncated']).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(record.inlinePayload))).toBeLessThanOrEqual(maxTimelineInlinePayloadBytes);
  });

  it('continues to propagate a genuine timeline append rejection', async () => {
    const appendEvent = vi.fn(async () => {
      throw new Error('TIMELINE_STORE_UNAVAILABLE');
    });
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await expect(port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'x'.repeat(60_000)))).rejects.toThrow(
      'TIMELINE_STORE_UNAVAILABLE',
    );
  });

  it('leaves a payload of exactly 49,000 UTF-8 bytes unchanged', () => {
    const shell: JsonObject = {
      capabilityId: 'ApiCall',
      toolCallId: 'call-1',
      toolEventType: 'ANSWER',
      toolMessageType: 'TEXT',
      content: '',
    };
    const shellBytes = Buffer.byteLength(JSON.stringify(shell));
    const payload = { ...shell, content: 'x'.repeat(maxTimelineInlinePayloadBytes - shellBytes) };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBe(maxTimelineInlinePayloadBytes);

    const result = truncateTimelineInlinePayload(payload);

    expect(result).toBe(payload);
    expect(result['truncated']).toBeUndefined();
  });

  it('does not synthesize degradation, completion limitation, or terminal facts for truncation', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'x'.repeat(60_000)));
    await port.finishRun(run);

    const records = appendEvent.mock.calls.map((call) => call[0] as RunTimelineEventRecord);
    expect(records).toHaveLength(1);
    expect(records[0]!.type).toBe('TOOL_STRUCTURED_DELTA');
    expect(records[0]!.inlinePayload['truncated']).toBe(true);
    expect(records[0]!.inlinePayload['completionLimitations']).toBeUndefined();
    expect(run.status).toBe('EXECUTING');
  });

  it('does not truncate payloads within the size limit', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', 'small content'));
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    expect(appendEvent).toHaveBeenCalledTimes(1);
    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['truncated']).toBeUndefined();
    expect(record.inlinePayload['content']).toBe('small content');
  });

  it('preserves non-content payload fields after truncation', async () => {
    const appendEvent = vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) }));
    const port = makePort({ appendEvent });
    const { run, context } = makeRunContext();
    port.beginRun(run);

    const oversizedContent = 'z'.repeat(maxTimelineInlinePayloadBytes + 5_000);
    await port.emitEvent(run, context, makeStructuredDelta('call-1', 'TEXT', oversizedContent));
    await persistCapabilityResultAndFlush(port, run, context, 'call-1');

    const record = appendEvent.mock.calls[0]![0] as RunTimelineEventRecord;
    expect(record.inlinePayload['capabilityId']).toBe('ApiCall');
    expect(record.inlinePayload['toolCallId']).toBe('call-1');
    expect(record.inlinePayload['toolEventType']).toBe('ANSWER');
    expect(record.inlinePayload['toolMessageType']).toBe('TEXT');
    expect(record.inlinePayload['truncated']).toBe(true);
  });
});

interface PortTestDeps {
  appendEvent: RunTimelineEventStoreGateway['appendEvent'];
}

function makePort(deps: PortTestDeps): RuntimeOwnedAgentRunStatePort {
  let id = 0;
  return new RuntimeOwnedAgentRunStatePort({
    messageStore: {
      appendSessionMessage: vi.fn(async (record) => record),
    } as unknown as SessionMessageStoreGateway,
    timelineStore: {
      appendEvent: deps.appendEvent,
      listEvents: vi.fn(async () => []),
    } satisfies RunTimelineEventStoreGateway,
    checkpointStore: {} as CheckpointStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    clock: () => brand<number, 'EpochMillis'>(10),
    idFactory: (prefix: string) => `${prefix}-${++id}`,
  });
}

async function persistCapabilityResultAndFlush(
  port: RuntimeOwnedAgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  toolCallId: string,
): Promise<void> {
  await port.appendMessage(run, context, {
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId, toolName: 'ApiCall', payload: {} }),
    contentType: 'PLAIN_TEXT',
    visible: true,
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId, toolName: 'ApiCall' },
    idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:capability-result:${toolCallId}`),
  });
}

function makeRunContext(): { run: RequestRun; context: RequestContext } {
  const run: RequestRun = {
    runId: brand<string, 'RequestRunId'>('run-trunc-1'),
    sessionId: brand<string, 'SessionId'>('session-trunc-1'),
    requestId: brand<string, 'MessageId'>('request-trunc-1'),
    agentId: brand<string, 'AgentId'>('agent-trunc-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-trunc-1:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-trunc-1'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-trunc-1'),
      subjectId: brand<string, 'SubjectId'>('subject-trunc-1'),
      displayName: 'truncation-test',
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
