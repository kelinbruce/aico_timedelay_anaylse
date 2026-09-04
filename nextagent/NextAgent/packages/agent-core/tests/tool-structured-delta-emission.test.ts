import { executeToolCallsInOrder } from '@nextagent/agent-core';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

function clipInvokeResult(payload: unknown): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload: payload as never,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function collectEmittedEvents() {
  const events: Array<{ type: string; inlinePayload: Record<string, unknown> }> = [];
  const runState: AgentRunStatePort = {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      events.push(event as { type: string; inlinePayload: Record<string, unknown> });
    },
    async appendMessage() {
      return brand<string, 'MessageId'>('msg');
    },
    async saveCheckpoint() {},
    async requestPendingInput() {
      throw new Error('not expected');
    },
  };
  return { events, runState };
}

async function runClipToolCall(payload: unknown, providerKind = 'CUSTOM', providerType = 'clip_server', deltas: readonly unknown[] = []) {
  const { events, runState } = collectEmittedEvents();
  const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_request, _signal, runtimeContext) => {
    for (const delta of deltas) {
      await runtimeContext?.emitResultDelta?.({ structuredPayload: delta as JsonObject });
    }
    return clipInvokeResult(payload);
  });

  await executeToolCallsInOrder(
    {
      capabilityCatalog: clipCatalog(providerKind, providerType),
      capabilityInvocation: { invoke },
      assemblyRegistry: {
        async active() {
          return assembly();
        },
        async require() {
          return assembly();
        },
      },
    },
    {
      run: run(),
      context: context(),
      runState,
      signal: new AbortController().signal,
      round: 0,
      toolCalls: [{ toolCallId: 'call-1', toolName: 'clip-tool', arguments: {} }],
      requestLocalState: { generatedMessages: [] },
    },
  );

  return events;
}

describe('tool-loop structured delta emission', () => {
  it('emits TOOL_STRUCTURED_DELTA for structured event with TITLE eventType (CLIP)', async () => {
    const events = await runClipToolCall({
      eventType: 'TITLE',
      messageType: 'TEXT',
      content: 'Querying user balance',
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('TITLE');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('TEXT');
    expect(structured[0]!.inlinePayload.content).toBe('Querying user balance');
  });

  // ---------- Bash+clipc structured delta ----------

  async function runBashToolCall(stdout: string, exitCode = 0, stdoutTruncated = false) {
    const { events, runState } = collectEmittedEvents();
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => {
      return clipInvokeResult({ exitCode, stdout, stderr: '', stdoutTruncated, stderrTruncated: false });
    });

    await executeToolCallsInOrder(
      {
        capabilityCatalog: bashCatalog(),
        capabilityInvocation: { invoke },
        assemblyRegistry: {
          async active() {
            return assembly();
          },
          async require() {
            return assembly();
          },
        },
      },
      {
        run: run(),
        context: context(),
        runState,
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'call-bash-1', toolName: 'Bash', arguments: {} }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    return events;
  }

  function bashCatalog(): CapabilityCatalog {
    return {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return {
          capabilityId: brand<string, 'CapabilityId'>('Bash'),
          kind: 'TOOL',
          provider: {
            providerId: 'builtin-bash',
            providerKind: 'BUNDLED' as never,
          },
          displayName: 'Bash',
          description: 'Bash',
          availabilityStatus: 'AVAILABLE',
          replayPolicy: 'IDEMPOTENT',
        };
      },
    };
  }

  // ---------- Bash streaming structured delta ----------

  async function runBashStreamingToolCall(deltas: readonly unknown[], stdout = '', exitCode = 0, stdoutTruncated = false) {
    const { events, runState } = collectEmittedEvents();
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_request, _signal, runtimeContext) => {
      for (const delta of deltas) {
        await runtimeContext?.emitResultDelta?.({ structuredPayload: delta as JsonObject });
      }
      return clipInvokeResult({ exitCode, stdout, stderr: '', stdoutTruncated, stderrTruncated: false });
    });

    await executeToolCallsInOrder(
      {
        capabilityCatalog: bashCatalog(),
        capabilityInvocation: { invoke },
        assemblyRegistry: {
          async active() {
            return assembly();
          },
          async require() {
            return assembly();
          },
        },
      },
      {
        run: run(),
        context: context(),
        runState,
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'call-bash-stream-1', toolName: 'Bash', arguments: {} }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    return events;
  }

  it('emits TOOL_STRUCTURED_DELTA for Bash+clipc envelope with ANSWER eventType', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'recovery steps' });
    const stdout = JSON.stringify({ status: 'ok', data: { raw: inner } });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('ANSWER');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('TEXT');
    expect(structured[0]!.inlinePayload.content).toBe('recovery steps');
    expect(structured[0]!.inlinePayload.capabilityId).toBe('Bash');
    expect(structured[0]!.inlinePayload.toolCallId).toBe('call-bash-1');
  });

  it('emits TOOL_STRUCTURED_DELTA for Bash direct structured event', async () => {
    const stdout = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'curl result' });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('ANSWER');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('TEXT');
    expect(structured[0]!.inlinePayload.content).toBe('curl result');
    expect(structured[0]!.inlinePayload.capabilityId).toBe('Bash');
  });

  it('emits TOOL_STRUCTURED_DELTA for Bash+code-msg-data envelope', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'api result' });
    const stdout = JSON.stringify({ code: 200, msg: 'success', data: inner });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('ANSWER');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('TEXT');
    expect(structured[0]!.inlinePayload.content).toBe('api result');
    expect(structured[0]!.inlinePayload.capabilityId).toBe('Bash');
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for Bash non-clipc stdout', async () => {
    const events = await runBashToolCall('hello world');
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA when clipc status is not ok', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'x' });
    const stdout = JSON.stringify({ status: 'error', data: { raw: inner } });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });
  it('does NOT emit TOOL_STRUCTURED_DELTA when code-msg-data envelope has non-200 code', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'x' });
    const stdout = JSON.stringify({ code: 500, msg: 'error', data: inner });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA when data.raw is malformed JSON', async () => {
    const stdout = JSON.stringify({ status: 'ok', data: { raw: 'not valid json' } });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for sensitive content in clipc envelope', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'The api_key is abc123' });
    const stdout = JSON.stringify({ status: 'ok', data: { raw: inner } });
    const events = await runBashToolCall(stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });

  it('emits CAPABILITY_RESULT_DELTA and CAPABILITY_COMPLETED alongside TOOL_STRUCTURED_DELTA for Bash+clipc', async () => {
    const inner = JSON.stringify({ eventType: 'TITLE', messageType: 'DSL', content: 'diag result' });
    const stdout = JSON.stringify({ status: 'ok', data: { raw: inner } });
    const events = await runBashToolCall(stdout);
    const types = events.map((e) => e.type);
    expect(types).toContain('TOOL_STRUCTURED_DELTA');
    expect(types).toContain('CAPABILITY_RESULT_DELTA');
    expect(types).toContain('CAPABILITY_COMPLETED');
    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toEqual(
      expect.objectContaining({ messageId: 'msg', toolCallId: 'call-bash-1', status: 'SUCCEEDED' }),
    );
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for Bash with non-zero exit code', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'x' });
    const stdout = JSON.stringify({ status: 'ok', data: { raw: inner } });
    const events = await runBashToolCall(stdout, 1);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for Bash with truncated stdout', async () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'x' });
    const stdout = JSON.stringify({ status: 'ok', data: { raw: inner } });
    const events = await runBashToolCall(stdout, 0, true);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
  });

  it('emits TOOL_STRUCTURED_DELTA for structured event payload (CLIP)', async () => {
    const events = await runClipToolCall({
      eventType: 'ANSWER',
      messageType: 'TEXT',
      content: 'Network status is normal',
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('ANSWER');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('TEXT');
    expect(structured[0]!.inlinePayload.content).toBe('Network status is normal');
  });

  it('emits TOOL_STRUCTURED_DELTA for structured event with PIU messageType', async () => {
    const events = await runClipToolCall({
      eventType: 'ANSWER',
      messageType: 'PIU',
      content: { piuName: 'thoughtChain', piuVersion: '1.0.0', data: '{}', method: 'render' },
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('PIU');
  });

  it('emits TOOL_STRUCTURED_DELTA for EXPAND_PANEL eventType (CLIP)', async () => {
    const events = await runClipToolCall({
      eventType: 'EXPAND_PANEL',
      messageType: 'PIU',
      content: { piuName: 'reportViewer', piuVersion: '1.0.0', data: '{}', method: 'render' },
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('EXPAND_PANEL');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('PIU');
    expect(structured[0]!.inlinePayload.content).toEqual({
      piuName: 'reportViewer',
      piuVersion: '1.0.0',
      data: '{}',
      method: 'render',
    });
  });

  it('emits TOOL_STRUCTURED_DELTA for EXPAND_PANEL with TEXT messageType', async () => {
    const events = await runClipToolCall({
      eventType: 'EXPAND_PANEL',
      messageType: 'TEXT',
      content: 'Large report content',
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('EXPAND_PANEL');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('TEXT');
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for plain JSON (CLIP)', async () => {
    const events = await runClipToolCall({ foo: 'bar', count: 42 });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for non-CLIP provider', async () => {
    const events = await runClipToolCall({ eventType: 'ANSWER', messageType: 'TEXT', content: 'test' }, 'BUNDLED', undefined);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for invalid eventType', async () => {
    const events = await runClipToolCall({
      eventType: 'UNKNOWN',
      messageType: 'TEXT',
      content: 'test',
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
  });

  it('does NOT emit TOOL_STRUCTURED_DELTA for content with sensitive patterns', async () => {
    const events = await runClipToolCall({
      eventType: 'ANSWER',
      messageType: 'TEXT',
      content: 'The api_key is leaked',
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
  });

  it('emits TOOL_STRUCTURED_DELTA when authorization is the only credential indicator keyword', async () => {
    const events = await runClipToolCall({
      eventType: 'ANSWER',
      messageType: 'TEXT',
      content: 'authorizationUrl is available',
    });
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.content).toBe('authorizationUrl is available');
  });

  it('emits both TOOL_STRUCTURED_DELTA and CAPABILITY_RESULT_DELTA for structured CLIP result', async () => {
    const events = await runClipToolCall({ eventType: 'ANSWER', messageType: 'TEXT', content: 'structured result' });
    const types = events.map((e) => e.type);
    expect(types).toContain('TOOL_STRUCTURED_DELTA');
    expect(types).toContain('CAPABILITY_RESULT_DELTA');
    expect(types).toContain('CAPABILITY_COMPLETED');
    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toEqual(
      expect.objectContaining({ messageId: 'msg', toolCallId: 'call-1', status: 'SUCCEEDED' }),
    );
  });

  it('classifies normalized CLIP stream result deltas without owning the Web safe projection', async () => {
    const dataRaw = JSON.stringify({ char: 'H', index: 0 });
    const events = await runClipToolCall({ status: 'ok' }, 'CUSTOM', 'clip_server', [
      {
        event: 'char',
        data: { char: 'H', index: 0 },
        data_raw: dataRaw,
        trace_id: 'trace-should-stay-private',
      },
    ]);

    const delta = events.find(
      (event) => event.type === 'CAPABILITY_RESULT_DELTA' && (event.inlinePayload.result as JsonObject)['data_raw'] === dataRaw,
    );

    expect(delta?.inlinePayload).toMatchObject({
      resultProjectionKind: 'CLIP_STREAM_V1',
      result: expect.objectContaining({ data_raw: dataRaw }),
    });
    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toMatchObject({
      resultProjectionKind: 'CLIP_STREAM_V1',
    });
    expect(delta?.inlinePayload).not.toHaveProperty('safeSummary');
    expect(delta?.inlinePayload).not.toHaveProperty('safeDetailText');
    expect(delta?.inlinePayload).not.toHaveProperty('safeResult');
  });

  it('classifies legacy CLIP stream chunk deltas', async () => {
    const events = await runClipToolCall({ status: 'ok' }, 'CUSTOM', 'clip_server', [{ event: { type: 'data', data: { chunk: 'H' } } }]);

    const delta = events.find(
      (event) => event.type === 'CAPABILITY_RESULT_DELTA' && JSON.stringify(event.inlinePayload.result).includes('"chunk":"H"'),
    );

    expect(delta?.inlinePayload).toMatchObject({
      resultProjectionKind: 'CLIP_STREAM_V1',
      result: { event: { type: 'data', data: { chunk: 'H' } } },
    });
    expect(delta?.inlinePayload).not.toHaveProperty('safeResult');
  });

  it('classifies CLIP stream completion results', async () => {
    const events = await runClipToolCall({
      events: [
        { type: 'data', data: { chunk: 'H' } },
        { type: 'data', data: { chunk: 'i' } },
      ],
      completion: { reason: 'eof', event_count: 2 },
    });

    const delta = events.find((event) => event.type === 'CAPABILITY_RESULT_DELTA' && 'resultProjectionKind' in event.inlinePayload);

    expect(delta?.inlinePayload).toMatchObject({
      resultProjectionKind: 'CLIP_STREAM_V1',
      result: {
        completion: { reason: 'eof', event_count: 2 },
      },
    });
    expect(delta?.inlinePayload).not.toHaveProperty('safeResult');
  });

  it('does not classify a non-CLIP custom provider', async () => {
    const events = await runClipToolCall({ status: 'ok' }, 'CUSTOM', 'vendor_network_probe', [{ event: 'char', data_raw: 'H' }]);

    expect(events.some((event) => event.inlinePayload.resultProjectionKind !== undefined)).toBe(false);
  });

  // ---------- Bash streaming structured delta tests ----------

  it('emits per-frame TOOL_STRUCTURED_DELTA during Bash streaming execution (SSE)', async () => {
    const events = await runBashStreamingToolCall([
      { eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'chunk-1' },
      { eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'chunk-2' },
      { eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'chunk-3' },
    ]);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(3);
    expect(structured[0]!.inlinePayload.content).toBe('chunk-1');
    expect(structured[1]!.inlinePayload.content).toBe('chunk-2');
    expect(structured[2]!.inlinePayload.content).toBe('chunk-3');
    expect(structured[0]!.inlinePayload.toolCallId).toBe('call-bash-stream-1');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('STREAM_DSL');
  });

  it('does not duplicate TOOL_STRUCTURED_DELTA or terminal CAPABILITY_RESULT_DELTA after streaming emission', async () => {
    const stdout = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'same content' });
    const events = await runBashStreamingToolCall([{ eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'streamed-frame' }], stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.content).toBe('streamed-frame');
    expect(events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
  });

  it('emits each matching frame independently for mixed Bash streaming frames', async () => {
    const events = await runBashStreamingToolCall([
      { eventType: 'SUB_TITLE', messageType: 'TEXT', content: 'Cell analysis' },
      { nonStructured: true },
      { eventType: 'SUB_DETAIL', messageType: 'TEXT', content: 'RSRP is below threshold' },
    ]);

    const structured = events.filter((event) => event.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(2);
    expect(structured.map((event) => event.inlinePayload.toolEventType)).toEqual(['SUB_TITLE', 'SUB_DETAIL']);
    const resultDeltas = events.filter((event) => event.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDeltas).toHaveLength(1);
    expect((resultDeltas[0]!.inlinePayload.result as JsonObject)?.nonStructured).toBe(true);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
  });

  it('falls through to one CAPABILITY_RESULT_DELTA for non-structured streaming frames', async () => {
    const events = await runBashStreamingToolCall([{ foo: 'bar', count: 42 }]);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA' && (e.inlinePayload.result as JsonObject)?.foo === 'bar');
    expect(resultDelta).toHaveLength(1);
    expect(events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
  });

  it('keeps terminal CAPABILITY_RESULT_DELTA when Bash emits no streaming result delta', async () => {
    const stdout = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'non-streaming result' });
    const events = await runBashToolCall(stdout);
    expect(events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
  });

  it('does not emit TOOL_STRUCTURED_DELTA for sensitive content in streaming frames', async () => {
    const events = await runBashStreamingToolCall([{ eventType: 'ANSWER', messageType: 'TEXT', content: 'The api_key is leaked' }]);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(0);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta.length).toBeGreaterThan(0);
  });

  it('emits exactly one CAPABILITY_COMPLETED during streaming execution', async () => {
    const events = await runBashStreamingToolCall([
      { eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'a' },
      { eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'b' },
    ]);
    const completed = events.filter((e) => e.type === 'CAPABILITY_COMPLETED');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.inlinePayload.toolCallId).toBe('call-bash-stream-1');
  });

  it('falls back to post-completion identification when no streaming frames matched', async () => {
    const stdout = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'post-completion result' });
    const events = await runBashStreamingToolCall([{ nonStructured: true }], stdout);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.content).toBe('post-completion result');
  });

  // ---------- tool-loop executor bridge unwrap tests ----------

  it('unwraps executor bridge double-wrapping for model tool-call streaming chunks', async () => {
    const events = await runBashStreamingToolCall([
      { structuredPayload: { eventType: 'ANSWER', messageType: 'STREAM_DSL', content: 'bridged-chunk' } },
    ]);
    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.content).toBe('bridged-chunk');
    expect(structured[0]!.inlinePayload.streaming).toBe(true);
  });

  it('uses unwrapped payload for CAPABILITY_RESULT_DELTA result field after bridge unwrap', async () => {
    const events = await runBashStreamingToolCall([{ structuredPayload: { nonStructured: true, foo: 'bar' } }]);
    const resultDelta = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA' && (e.inlinePayload.result as JsonObject)?.foo === 'bar');
    expect(resultDelta.length).toBeGreaterThan(0);
    expect((resultDelta[0]!.inlinePayload.result as JsonObject)?.structuredPayload).toBeUndefined();
  });
});

function clipCatalog(providerKind: string, providerType?: string): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve() {
      return {
        capabilityId: brand<string, 'CapabilityId'>('clip-tool'),
        kind: 'TOOL',
        provider: {
          providerId: 'clip-server',
          providerKind: providerKind as never,
          ...(providerType ? { providerType } : {}),
        },
        displayName: 'clip-tool',
        description: 'clip-tool',
        availabilityStatus: 'AVAILABLE',
        replayPolicy: 'IDEMPOTENT',
      };
    },
  };
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
    capabilityBindings: [{ capabilityId: 'clip-tool', capabilityType: 'TOOL', providerId: 'clip-server', enabled: true }],
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
