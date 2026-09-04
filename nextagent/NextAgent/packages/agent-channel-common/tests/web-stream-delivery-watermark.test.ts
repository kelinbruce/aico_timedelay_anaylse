import { brand } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEvent, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  deliverWebStream,
  type WebWatermarkPort,
  type WebStreamDeliveryRequest,
  type WebGuardrailPort,
} from '../src/transports/web-stream-delivery.js';

const SESSION_ID = brand<string, 'SessionId'>('S1');
const REQUEST_ID = brand<string, 'MessageId'>('req-1');
const RUN_ID = brand<string, 'RequestRunId'>('run-1');
const CONTEXT_ID = brand<string, 'RequestContextId'>('context-1');
const terminalContentByEvent = new WeakMap<RunTimelineEvent, string>();

function makeSessions(events: readonly RunTimelineEvent[]): RuntimeSessionPort {
  return {
    streamEvents: async function* streamEvents() {
      for (const event of events) {
        yield event;
      }
    },
    resolveProcessMessages: async (query: Parameters<NonNullable<RuntimeSessionPort['resolveProcessMessages']>>[0]) =>
      events.flatMap((event) => {
        const terminalMessageId = event.inlinePayload.terminalMessageId;
        const content = terminalContentByEvent.get(event);
        if (
          event.type !== 'REQUEST_COMPLETED' ||
          typeof terminalMessageId !== 'string' ||
          !query.messageIds.includes(brand<string, 'MessageId'>(terminalMessageId)) ||
          content === undefined
        ) {
          return [];
        }
        return [
          {
            messageId: brand<string, 'MessageId'>(terminalMessageId),
            sessionId: SESSION_ID,
            requestId: REQUEST_ID,
            runId: RUN_ID,
            role: 'ASSISTANT' as const,
            content,
            contentType: 'PLAIN_TEXT' as const,
            metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
            sequence: Number(event.sequence ?? 0),
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(Number(event.sequence ?? 0)),
          },
        ];
      }),
  } as unknown as RuntimeSessionPort;
}

const noopGuardrail: WebGuardrailPort = {
  checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
  checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
};

function makeWatermark(impl: (content: string) => Promise<string>): WebWatermarkPort & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    calls,
    applyWatermark: vi.fn(async (content: string) => {
      calls.push(content);
      return impl(content);
    }),
  };
}

function buildWatermarkRequest(
  sessions: RuntimeSessionPort,
  watermark: WebWatermarkPort,
  watermarkEnabled: boolean = true,
): WebStreamDeliveryRequest {
  return {
    sessions,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      displayName: 'Test',
    },
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    guardrail: noopGuardrail,
    guardrailEnabled: true,
    watermark,
    getWatermarkEnabled: () => watermarkEnabled,
    clock: () => brand<number, 'EpochMillis'>(0),
  };
}

function delta(content: string, sequence: number, stepId?: string): RunTimelineEvent {
  return {
    type: 'LLM_CONTENT_DELTA',
    inlinePayload: { content, ...(stepId === undefined ? {} : { stepId }) },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  } as RunTimelineEvent;
}

function completed(content: string, sequence: number): RunTimelineEvent {
  const event = {
    type: 'REQUEST_COMPLETED',
    inlinePayload: { status: 'COMPLETED', terminalMessageId: `terminal-message-${sequence}`, hookResults: [] },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  } as RunTimelineEvent;
  terminalContentByEvent.set(event, content);
  return event;
}

function canceled(sequence: number): RunTimelineEvent {
  return {
    type: 'REQUEST_CANCELED',
    inlinePayload: { status: 'CANCELED', hookResults: [] },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  } as RunTimelineEvent;
}

function finalDelta(content: string, sequence: number): RunTimelineEvent {
  return {
    type: 'LLM_CONTENT_DELTA',
    inlinePayload: { content, final: true },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  } as RunTimelineEvent;
}

function toolStructuredDelta(
  content: string,
  sequence: number,
  opts: { toolEventType?: string; toolMessageType?: string; workflowEventType?: string; persistence?: string } = {},
): RunTimelineEvent {
  return {
    type: 'TOOL_STRUCTURED_DELTA',
    inlinePayload: {
      content,
      toolEventType: opts.toolEventType ?? 'ANSWER',
      toolMessageType: opts.toolMessageType ?? 'TEXT',
      ...(opts.workflowEventType === undefined ? {} : { workflowEventType: opts.workflowEventType }),
      persistence: opts.persistence ?? 'PERSISTED',
    },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  } as RunTimelineEvent;
}

async function collect(request: WebStreamDeliveryRequest): Promise<StreamEnvelope[]> {
  const out: StreamEnvelope[] = [];
  for await (const envelope of deliverWebStream(request)) {
    out.push(envelope);
  }
  return out;
}

const LONG_CONTENT = 'x'.repeat(501);
const SHORT_CONTENT = 'x'.repeat(500);

describe('deliverWebStream watermark LLM_CONTENT_DELTA', () => {
  it('yields an extra watermark delta at REQUEST_COMPLETED for long content', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([delta(LONG_CONTENT, 1, 'step-1'), completed('done', 2)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const watermarkDeltas = output.filter(
      (e) =>
        e.eventType === 'LLM_CONTENT_DELTA' &&
        (e.payload as Record<string, unknown>).metadata !== undefined &&
        (e.payload as Record<string, { watermarked?: boolean }>).metadata?.watermarked === true,
    );
    expect(watermarkDeltas).toHaveLength(1);
    expect((watermarkDeltas[0]!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT + '[WM]');
    expect(watermark.calls).toEqual([LONG_CONTENT]);
    expect(watermarkDeltas[0]!.runId).toBe(RUN_ID);
    expect(watermarkDeltas[0]!.requestContextId).toBe(CONTEXT_ID);
    expect(watermarkDeltas[0]!.eventId).toContain(':watermark');
  });

  it('does not yield watermark delta for short content (<= 500 chars)', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([delta(SHORT_CONTENT, 1, 'step-1'), completed('done', 2)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const watermarkDeltas = output.filter(
      (e) => e.eventType === 'LLM_CONTENT_DELTA' && (e.payload as Record<string, { watermarked?: boolean }>).metadata?.watermarked === true,
    );
    expect(watermarkDeltas).toHaveLength(0);
    expect(watermark.calls).toEqual([]);
  });

  it('flushes watermark delta on stepId change for multi-round invocations', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([delta(LONG_CONTENT, 1, 'step-1'), delta(LONG_CONTENT + 'b', 2, 'step-2'), completed('done', 3)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const watermarkDeltas = output.filter(
      (e) => e.eventType === 'LLM_CONTENT_DELTA' && (e.payload as Record<string, { watermarked?: boolean }>).metadata?.watermarked === true,
    );
    expect(watermarkDeltas).toHaveLength(2);
    expect(watermark.calls).toEqual([LONG_CONTENT, LONG_CONTENT + 'b']);
    expect(watermarkDeltas[0]!.runId).toBe(RUN_ID);
    expect(watermarkDeltas[0]!.requestContextId).toBe(CONTEXT_ID);
    expect(watermarkDeltas[1]!.runId).toBe(RUN_ID);
    expect(watermarkDeltas[1]!.requestContextId).toBe(CONTEXT_ID);
    expect(watermarkDeltas[0]!.eventId).toContain(':watermark');
    expect(watermarkDeltas[1]!.eventId).toContain(':watermark');
  });

  it('tracks final delta without stepId and inherits final flag in watermark delta', async () => {
    // Reproduces the real-world sequence: an intermediate LLM_CONTENT_DELTA
    // with stepId (pending process-content), followed by a final delta
    // without stepId but with final:true (the actual answer snapshot).
    // The watermark must be built from the final delta so it inherits
    // final:true and is not filtered as pending process-content by the
    // frontend.
    const watermark = makeWatermark(async (c) => 'WM:' + c);
    const finalContent = LONG_CONTENT + ' (final)';
    const sessions = makeSessions([delta(LONG_CONTENT, 1, 'turn-4'), finalDelta(finalContent, 2), completed('done', 3)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const watermarkDeltas = output.filter(
      (e) => e.eventType === 'LLM_CONTENT_DELTA' && (e.payload as Record<string, { watermarked?: boolean }>).metadata?.watermarked === true,
    );
    expect(watermarkDeltas).toHaveLength(1);
    expect((watermarkDeltas[0]!.payload as Record<string, unknown>).content).toBe('WM:' + finalContent);
    expect((watermarkDeltas[0]!.payload as Record<string, unknown>).final).toBe(true);
    expect((watermarkDeltas[0]!.payload as Record<string, unknown>).stepId).toBeUndefined();
    expect(watermark.calls).toEqual([finalContent]);
  });

  it('does not execute watermark on REQUEST_CANCELED', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([delta(LONG_CONTENT, 1, 'step-1'), canceled(2)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const watermarkDeltas = output.filter(
      (e) => e.eventType === 'LLM_CONTENT_DELTA' && (e.payload as Record<string, { watermarked?: boolean }>).metadata?.watermarked === true,
    );
    expect(watermarkDeltas).toHaveLength(0);
    expect(watermark.calls).toEqual([]);
  });

  it('fail-open: no extra delta when watermark service throws', async () => {
    const watermark = makeWatermark(async () => {
      throw new Error('service down');
    });
    const sessions = makeSessions([delta(LONG_CONTENT, 1, 'step-1'), completed('done', 2)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const watermarkDeltas = output.filter(
      (e) => e.eventType === 'LLM_CONTENT_DELTA' && (e.payload as Record<string, { watermarked?: boolean }>).metadata?.watermarked === true,
    );
    expect(watermarkDeltas).toHaveLength(0);
    expect(output.some((e) => e.eventType === 'REQUEST_COMPLETED')).toBe(true);
  });
});

describe('deliverWebStream watermark TOOL_STRUCTURED_DELTA', () => {
  it('watermarks workflow DETAIL TEXT with long content', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([
      toolStructuredDelta(LONG_CONTENT, 1, { toolEventType: 'DETAIL', toolMessageType: 'TEXT', workflowEventType: 'NODE_OUTPUT' }),
      completed('done', 2),
    ]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect(toolDelta).toBeDefined();
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT + '[WM]');
    expect(watermark.calls).toEqual([LONG_CONTENT]);
  });

  it('watermarks workflow ANSWER TEXT with long content', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([
      toolStructuredDelta(LONG_CONTENT, 1, { toolEventType: 'ANSWER', toolMessageType: 'TEXT', workflowEventType: 'NODE_OUTPUT' }),
      completed('done', 2),
    ]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT + '[WM]');
  });

  it('does not watermark non-workflow TOOL_STRUCTURED_DELTA (no workflowEventType)', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([toolStructuredDelta(LONG_CONTENT, 1, { toolEventType: 'ANSWER', toolMessageType: 'TEXT' }), completed('done', 2)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT);
    expect(watermark.calls).toEqual([]);
  });

  it('does not watermark TITLE toolEventType', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([
      toolStructuredDelta(LONG_CONTENT, 1, { toolEventType: 'TITLE', toolMessageType: 'TEXT', workflowEventType: 'NODE_OUTPUT' }),
      completed('done', 2),
    ]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT);
    expect(watermark.calls).toEqual([]);
  });

  it('does not watermark non-TEXT messageType', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([
      toolStructuredDelta(LONG_CONTENT, 1, { toolEventType: 'ANSWER', toolMessageType: 'PIU', workflowEventType: 'NODE_OUTPUT' }),
      completed('done', 2),
    ]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT);
    expect(watermark.calls).toEqual([]);
  });

  it('does not watermark short content (<= 500 chars)', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([
      toolStructuredDelta(SHORT_CONTENT, 1, { toolEventType: 'ANSWER', toolMessageType: 'TEXT', workflowEventType: 'NODE_OUTPUT' }),
      completed('done', 2),
    ]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(SHORT_CONTENT);
    expect(watermark.calls).toEqual([]);
  });

  it('fail-open: original content on watermark service throw', async () => {
    const watermark = makeWatermark(async () => {
      throw new Error('service down');
    });
    const sessions = makeSessions([
      toolStructuredDelta(LONG_CONTENT, 1, { toolEventType: 'ANSWER', toolMessageType: 'TEXT', workflowEventType: 'NODE_OUTPUT' }),
      completed('done', 2),
    ]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const toolDelta = output.find((e) => e.eventType === 'TOOL_STRUCTURED_DELTA');
    expect((toolDelta!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT);
  });
});

describe('deliverWebStream watermark REQUEST_COMPLETED', () => {
  it('inline-transforms REQUEST_COMPLETED content when long', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([completed(LONG_CONTENT, 1)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const completedEnv = output.find((e) => e.eventType === 'REQUEST_COMPLETED');
    expect(completedEnv).toBeDefined();
    expect((completedEnv!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT + '[WM]');
  });

  it('does not transform short REQUEST_COMPLETED content', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([completed(SHORT_CONTENT, 1)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const completedEnv = output.find((e) => e.eventType === 'REQUEST_COMPLETED');
    expect((completedEnv!.payload as Record<string, unknown>).content).toBe(SHORT_CONTENT);
    expect(watermark.calls).toEqual([]);
  });

  it('fail-open: original content on REQUEST_COMPLETED when service throws', async () => {
    const watermark = makeWatermark(async () => {
      throw new Error('service down');
    });
    const sessions = makeSessions([completed(LONG_CONTENT, 1)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark));
    const completedEnv = output.find((e) => e.eventType === 'REQUEST_COMPLETED');
    expect((completedEnv!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT);
  });
});

describe('deliverWebStream watermark disabled', () => {
  it('does not call watermark when watermarkEnabled is false', async () => {
    const watermark = makeWatermark(async (c) => c + '[WM]');
    const sessions = makeSessions([delta(LONG_CONTENT, 1, 'step-1'), completed(LONG_CONTENT, 2)]);
    const output = await collect(buildWatermarkRequest(sessions, watermark, false));
    expect(watermark.calls).toEqual([]);
    const completedEnv = output.find((e) => e.eventType === 'REQUEST_COMPLETED');
    expect((completedEnv!.payload as Record<string, unknown>).content).toBe(LONG_CONTENT);
  });
});
