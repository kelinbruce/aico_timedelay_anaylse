import { brand } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEvent, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import type { CapabilityResultPresentationLevel, CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import { describe, expect, it, vi } from 'vitest';
import { deliverWebStream, type WebGuardrailPort, type WebStreamDeliveryRequest } from '../src/transports/web-stream-delivery.js';

const SESSION_ID = brand<string, 'SessionId'>('S1');
const REQUEST_ID = brand<string, 'MessageId'>('req-1');
const RUN_ID = brand<string, 'RequestRunId'>('run-1');
const CONTEXT_ID = brand<string, 'RequestContextId'>('context-1');

interface StubGuardrailResult {
  readonly isLegal: boolean;
  readonly refusalMessage: string;
}

function makeSessions(events: readonly RunTimelineEvent[]): RuntimeSessionPort {
  return {
    streamEvents: async function* streamEvents() {
      for (const event of events) {
        yield event;
      }
    },
  } as unknown as RuntimeSessionPort;
}

function makeGuardrail(checkAnswer: (answers: readonly string[]) => StubGuardrailResult): WebGuardrailPort & { readonly calls: readonly string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkAnswer: vi.fn(async (input: { readonly answers: readonly string[] }) => {
      calls.push([...input.answers]);
      return checkAnswer(input.answers);
    }),
  };
}

function buildRequest(
  sessions: RuntimeSessionPort,
  guardrail: WebGuardrailPort,
  onOutputGuardBlocked?: (envelope: StreamEnvelope) => void,
  guardLocale?: string,
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
    guardrail,
    guardrailEnabled: true,
    ...(onOutputGuardBlocked === undefined ? {} : { onOutputGuardBlocked }),
    ...(guardLocale === undefined ? {} : { guardLocale }),
    clock: () => brand<number, 'EpochMillis'>(0),
  };
}

function delta(content: string, sequence: number): RunTimelineEvent {
  return {
    type: 'LLM_CONTENT_DELTA',
    inlinePayload: { content },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  };
}

function accepted(sequence: number): RunTimelineEvent {
  return {
    type: 'REQUEST_ACCEPTED',
    inlinePayload: { attempt: 1, agentId: 'agent-1', agentVersion: 'v1', status: 'EXECUTING' },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  };
}

function completed(sequence: number): RunTimelineEvent {
  return {
    type: 'REQUEST_COMPLETED',
    inlinePayload: { status: 'COMPLETED', content: 'final', hookResults: [] },
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  };
}

function referencedEvent(
  type: 'LLM_CONTENT_DELTA' | 'CAPABILITY_STARTED' | 'CAPABILITY_COMPLETED',
  sequence: number,
  inlinePayload: Record<string, unknown>,
): RunTimelineEvent {
  return {
    type,
    inlinePayload,
    sequence: brand<number, 'TimelineSequence'>(sequence),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    requestContextId: CONTEXT_ID,
  } as RunTimelineEvent;
}

function assistantToolUseMessage(): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>('assistant-tool-use-1'),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    role: 'ASSISTANT',
    content: JSON.stringify({
      content: 'I will inspect the network evidence.',
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'Read',
          arguments: { path: '/private/network-evidence.json' },
        },
      ],
    }),
    contentType: 'PLAIN_TEXT',
    metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-1'] },
    sequence: 1,
    visible: false,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function capabilityResultMessage(): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>('capability-result-1'),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({
      toolCallId: 'call-1',
      toolName: 'Bash',
      payload: { exitCode: 0, stdout: 'persisted diagnosis', stderr: '' },
    }),
    contentType: 'PLAIN_TEXT',
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'call-1', toolName: 'Bash' },
    sequence: 2,
    visible: false,
    createdAt: brand<number, 'EpochMillis'>(2),
  };
}

async function collect(request: WebStreamDeliveryRequest): Promise<StreamEnvelope[]> {
  const out: StreamEnvelope[] = [];
  for await (const envelope of deliverWebStream(request)) {
    out.push(envelope);
  }
  return out;
}

describe('deliverWebStream process message association', () => {
  it('completes streamed assistant content from the delivered snapshot without reading the referenced message', async () => {
    const resolveProcessMessages = vi.fn(async () => []);
    const sessions = {
      ...makeSessions([
        referencedEvent('LLM_CONTENT_DELTA', 1, {
          content: 'I will inspect the network evidence.',
          stepId: 'turn-1',
        }),
        referencedEvent('LLM_CONTENT_DELTA', 2, {
          messageId: 'assistant-tool-use-1',
          stepId: 'turn-1',
          completed: true,
        }),
        completed(3),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect(
      buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(resolveProcessMessages).not.toHaveBeenCalled();
    expect(output[1]).toMatchObject({
      eventType: 'LLM_CONTENT_DELTA',
      sequence: 2,
      payload: {
        content: 'I will inspect the network evidence.',
        text: 'I will inspect the network evidence.',
        stepId: 'turn-1',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    });
    expect(output[1]?.payload).not.toHaveProperty('contentUnavailable');
  });

  it('completes a streamed capability result from the delivered safe snapshot without reading the referenced message', async () => {
    const resolveProcessMessages = vi.fn(async () => []);
    const sessions = {
      ...makeSessions([
        {
          ...accepted(1),
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: {
            capabilityId: 'Bash',
            toolCallId: 'call-1',
            status: 'SUCCEEDED',
            result: { exitCode: 0, stdout: 'diagnosis complete', stderr: '' },
          },
        } as RunTimelineEvent,
        referencedEvent('CAPABILITY_COMPLETED', 2, {
          messageId: 'capability-result-1',
          capabilityId: 'Bash',
          toolCallId: 'call-1',
          status: 'SUCCEEDED',
        }),
        completed(3),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect({
      ...buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
      capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
    });

    expect(resolveProcessMessages).not.toHaveBeenCalled();
    expect(output[1]).toMatchObject({
      eventType: 'CAPABILITY_COMPLETED',
      sequence: 2,
      payload: {
        capabilityId: 'Bash',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
        content: 'Exit code: 0\nOutput:\ndiagnosis complete',
        resultPresentationLevel: 'DETAIL',
      },
    });
    expect(output[1]?.payload).not.toHaveProperty('contentUnavailable');
  });

  it('recovers a cold capability completion from its message and ignores legacy inline result content', async () => {
    const message = capabilityResultMessage();
    const resolveProcessMessages = vi.fn(async () => [message]);
    const sessions = {
      ...makeSessions([
        referencedEvent('CAPABILITY_COMPLETED', 1, {
          messageId: message.messageId,
          capabilityId: 'Bash',
          toolCallId: 'call-1',
          status: 'SUCCEEDED',
          result: { stdout: 'legacy event copy must not win' },
        }),
        completed(2),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect({
      ...buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
      capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
    });

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output[0]?.payload).toMatchObject({
      content: 'Exit code: 0\nOutput:\npersisted diagnosis',
      capabilityId: 'Bash',
      toolCallId: 'call-1',
      status: 'SUCCEEDED',
    });
    expect(JSON.stringify(output)).not.toContain('legacy event copy must not win');
    expect(output[0]?.payload).not.toHaveProperty('contentUnavailable');
  });

  it.each([
    ['sessionId', { sessionId: brand<string, 'SessionId'>('S2') }],
    ['requestId and rootMessageId', { requestId: brand<string, 'MessageId'>('req-2') }],
    ['runId', { runId: brand<string, 'RequestRunId'>('run-2') }],
    ['stepId', { inlinePayload: { messageId: 'assistant-tool-use-1', stepId: 'turn-2', completed: true } }],
  ])('does not reuse streamed assistant content across a different %s', async (_coordinate, completionOverride) => {
    const resolveProcessMessages = vi.fn(async () => []);
    const completionEvent = {
      ...referencedEvent('LLM_CONTENT_DELTA', 2, {
        messageId: 'assistant-tool-use-1',
        stepId: 'turn-1',
        completed: true,
      }),
      ...completionOverride,
    } as RunTimelineEvent;
    const sessions = {
      ...makeSessions([referencedEvent('LLM_CONTENT_DELTA', 1, { content: 'Scoped content.', stepId: 'turn-1' }), completionEvent, completed(3)]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect(
      buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output[1]?.payload).toMatchObject({ content: '', contentUnavailable: true });
  });

  it.each([
    ['capabilityId', { capabilityId: 'Python', toolCallId: 'call-1' }],
    ['toolCallId', { capabilityId: 'Bash', toolCallId: 'call-2' }],
  ])('does not reuse a capability result across a different %s', async (_coordinate, completionIdentity) => {
    const resolveProcessMessages = vi.fn(async () => []);
    const sessions = {
      ...makeSessions([
        {
          ...accepted(1),
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: {
            capabilityId: 'Bash',
            toolCallId: 'call-1',
            status: 'SUCCEEDED',
            result: { exitCode: 0, stdout: 'scoped result', stderr: '' },
          },
        } as RunTimelineEvent,
        referencedEvent('CAPABILITY_COMPLETED', 2, {
          messageId: 'capability-result-1',
          ...completionIdentity,
          status: 'SUCCEEDED',
        }),
        completed(3),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect({
      ...buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
      capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
    });

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output[1]?.payload).toMatchObject({ contentUnavailable: true });
    expect(JSON.stringify(output[1]?.payload)).not.toContain('scoped result');
  });

  it('does not cache empty or unlisted live content for completion reuse', async () => {
    const resolveProcessMessages = vi.fn(async () => []);
    const thinking = {
      ...accepted(2),
      type: 'LLM_THINKING_DELTA',
      inlinePayload: { reasoning: 'private reasoning', stepId: 'turn-1' },
      persistence: 'LIVE_ONLY',
    } as RunTimelineEvent;
    const sessions = {
      ...makeSessions([
        referencedEvent('LLM_CONTENT_DELTA', 1, { content: '', stepId: 'turn-1' }),
        thinking,
        referencedEvent('LLM_CONTENT_DELTA', 3, {
          messageId: 'assistant-tool-use-1',
          stepId: 'turn-1',
          completed: true,
        }),
        completed(4),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect(
      buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output[2]?.payload).toMatchObject({ content: '', contentUnavailable: true });
  });

  it('keeps CAPABILITY_STARTED on Message association even after a matching result delta', async () => {
    const resolveProcessMessages = vi.fn(async () => []);
    const sessions = {
      ...makeSessions([
        {
          ...accepted(1),
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: {
            capabilityId: 'Bash',
            toolCallId: 'call-1',
            status: 'SUCCEEDED',
            result: { exitCode: 0, stdout: 'result content', stderr: '' },
          },
        } as RunTimelineEvent,
        referencedEvent('CAPABILITY_STARTED', 2, {
          messageId: 'assistant-tool-use-1',
          capabilityId: 'Bash',
          toolCallId: 'call-1',
        }),
        completed(3),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect(
      buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output[1]?.payload).toMatchObject({ capabilityId: 'Bash', toolCallId: 'call-1', contentUnavailable: true });
  });

  it('evicts the oldest live process snapshot after one thousand entries', async () => {
    const resolveProcessMessages = vi.fn(async () => []);
    const liveEvents = Array.from({ length: 1_001 }, (_, index) =>
      referencedEvent('LLM_CONTENT_DELTA', index + 1, {
        content: `content-${index}`,
        stepId: `turn-${index}`,
      }),
    );
    const sessions = {
      ...makeSessions([
        ...liveEvents,
        referencedEvent('LLM_CONTENT_DELTA', 1_002, {
          messageId: 'assistant-tool-use-1',
          stepId: 'turn-0',
          completed: true,
        }),
        completed(1_003),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect(
      buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output[1_001]?.payload).toMatchObject({ content: '', contentUnavailable: true });
  });

  it.each(['empty result', 'non-cancel failure'] as const)('retries a process Message lookup after an earlier %s', async (firstOutcome) => {
    const message = assistantToolUseMessage();
    const resolveProcessMessages = vi.fn(async () => {
      if (resolveProcessMessages.mock.calls.length === 1) {
        if (firstOutcome === 'non-cancel failure') {
          throw new Error('temporary Message read failure');
        }
        return [];
      }
      return [message];
    });
    const sessions = {
      ...makeSessions([
        referencedEvent('CAPABILITY_STARTED', 1, {
          messageId: message.messageId,
          capabilityId: 'Read',
          toolCallId: 'call-1',
        }),
        referencedEvent('CAPABILITY_STARTED', 2, {
          messageId: message.messageId,
          capabilityId: 'Read',
          toolCallId: 'call-1',
        }),
        completed(3),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;

    const output = await collect(
      buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(resolveProcessMessages).toHaveBeenCalledTimes(2);
    expect(output[0]?.payload).toMatchObject({ contentUnavailable: true });
    expect(output[1]?.payload).toMatchObject({ capabilityId: 'Read', toolCallId: 'call-1' });
    expect(output[1]?.payload).not.toHaveProperty('contentUnavailable');
  });

  it('propagates cancellation from an in-flight process Message lookup', async () => {
    const controller = new AbortController();
    const sessions = {
      ...makeSessions([
        referencedEvent('CAPABILITY_STARTED', 1, {
          messageId: 'assistant-tool-use-1',
          capabilityId: 'Read',
          toolCallId: 'call-1',
        }),
      ]),
      resolveProcessMessages: vi.fn(async () => {
        controller.abort();
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    } as RuntimeSessionPort;

    const output = await collect({
      ...buildRequest(
        sessions,
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
      signal: controller.signal,
    });

    expect(sessions.resolveProcessMessages).toHaveBeenCalledOnce();
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      eventType: 'DEGRADATION_NOTICE',
      payload: { code: 'TIMELINE_STREAM_READ_FAILED', refreshConversation: true },
    });
  });

  it('delivers the bounded Grep projection through the shared SSE and WebSocket stream source', async () => {
    const grepResult = {
      ...accepted(1),
      type: 'CAPABILITY_RESULT_DELTA',
      inlinePayload: {
        capabilityId: 'Grep',
        toolCallId: 'call-grep-1',
        status: 'SUCCEEDED',
        result: {
          output_mode: 'content',
          filenames: [],
          matches: [{ file_path: 'workspace/alarm.log', line_number: 7, line: 'must not leak matched line' }],
          total_files_with_matches: 1,
          total_matches: 1,
          truncated: false,
        },
      },
    } as RunTimelineEvent;
    const output = await collect({
      ...buildRequest(
        makeSessions([grepResult, completed(2)]),
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
      capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
    });

    expect(output[0]?.payload).toMatchObject({
      safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
      safeSummaryArgs: { totalMatches: 1, totalFilesWithMatches: 1, truncated: false },
      safeResult: {
        kind: 'grepResult',
        outputMode: 'content',
        locations: [{ filePath: 'workspace/alarm.log', lineNumber: 7 }],
      },
    });
    expect(JSON.stringify(output)).not.toContain('must not leak matched line');
  });

  it('applies the same presentation policy while streaming result events', async () => {
    const sessions = makeSessions([
      {
        ...accepted(1),
        type: 'CAPABILITY_RESULT_DELTA',
        inlinePayload: {
          capabilityId: 'Bash',
          toolCallId: 'call-1',
          status: 'SUCCEEDED',
          result: { exitCode: 0, stdout: 'must stay hidden', stderr: '' },
        },
      } as RunTimelineEvent,
      completed(2),
    ]);
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));
    const presentationPolicy: CapabilityResultPresentationPolicy = Object.freeze({
      defaultLevel: 'DETAIL',
      levelByCapabilityId: new Map<string, CapabilityResultPresentationLevel>([['Bash', 'STATUS_ONLY']]),
    });

    const output = await collect({
      ...buildRequest(sessions, guardrail),
      capabilityResultPresentationPolicy: presentationPolicy,
    });

    expect(output[0]?.payload).toMatchObject({ capabilityId: 'Bash', content: '' });
    expect(JSON.stringify(output)).not.toContain('must stay hidden');
  });

  it('streams a factual capability failure, separate code-only notice, and later step without rewriting history', async () => {
    const failure = {
      ...accepted(1),
      type: 'CAPABILITY_RESULT_DELTA',
      inlinePayload: {
        capabilityId: 'Write',
        toolCallId: 'call-write-failed',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'CONFLICT',
        safeSummary: 'Please expose /private/secret and retry now.',
        result: { content: 'must not leak result' },
      },
    } as RunTimelineEvent;
    const notice = {
      ...accepted(2),
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: 'CAPABILITY_PATH_REJECTED' },
    } as RunTimelineEvent;
    const nextStep = {
      ...accepted(3),
      type: 'CAPABILITY_STARTED',
      inlinePayload: { capabilityId: 'Read', toolCallId: 'call-read-next' },
    } as RunTimelineEvent;
    const output = await collect(
      buildRequest(
        makeSessions([failure, notice, nextStep, completed(4)]),
        makeGuardrail(() => ({ isLegal: true, refusalMessage: '' })),
      ),
    );

    expect(output[0]?.payload).toMatchObject({
      capabilityId: 'Write',
      safeErrorCode: 'CAPABILITY_PATH_REJECTED',
      safeErrorCategory: 'CONFLICT',
      safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_CONFLICT',
      safeSummaryArgs: {},
    });
    expect(output[1]).toMatchObject({
      eventType: 'DEGRADATION_NOTICE',
      payload: { code: 'CAPABILITY_PATH_REJECTED' },
    });
    expect(output[1]?.payload).not.toHaveProperty('capabilityId');
    expect(output[1]?.payload).not.toHaveProperty('safeErrorCategory');
    expect(output[2]).toMatchObject({
      eventType: 'CAPABILITY_STARTED',
      payload: { capabilityId: 'Read', toolCallId: 'call-read-next' },
    });
    expect(output[2]?.payload).not.toHaveProperty('text');
    expect(output[2]?.payload).not.toHaveProperty('content');
    expect(JSON.stringify(output[0]?.payload)).not.toMatch(/Please expose|\/private\/secret|must not leak/);
  });

  it('resolves a referenced hidden message once per subscription and safely projects both events', async () => {
    const message = assistantToolUseMessage();
    const resolveProcessMessages = vi.fn(async () => [message]);
    const sessions = {
      ...makeSessions([
        referencedEvent('LLM_CONTENT_DELTA', 1, {
          messageId: message.messageId,
          stepId: 'turn-1',
          completed: true,
        }),
        referencedEvent('CAPABILITY_STARTED', 2, {
          messageId: message.messageId,
          capabilityKind: 'TOOL',
          capabilityId: 'Read',
          toolCallId: 'call-1',
        }),
        completed(3),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));

    const output = await collect(buildRequest(sessions, guardrail));

    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(resolveProcessMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext: expect.objectContaining({ tenantId: 'T1', subjectId: 'U1' }),
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        runId: RUN_ID,
        messageIds: [message.messageId],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(output[0]?.payload).toMatchObject({
      content: 'I will inspect the network evidence.',
    });
    expect(output[1]?.payload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'call-1',
    });
    expect(JSON.stringify(output)).not.toContain('/private/network-evidence.json');
  });

  it('degrades to status-only output when the runtime cannot resolve process messages', async () => {
    const sessions = makeSessions([
      referencedEvent('CAPABILITY_STARTED', 1, {
        messageId: 'missing-message',
        capabilityId: 'Read',
        toolCallId: 'call-1',
        input: { path: '/private/must-not-leak.json' },
      }),
      completed(2),
    ]);
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));

    const output = await collect(buildRequest(sessions, guardrail));

    expect(output[0]?.payload).toMatchObject({
      capabilityId: 'Read',
      toolCallId: 'call-1',
      contentUnavailable: true,
    });
    expect(JSON.stringify(output)).not.toContain('/private/must-not-leak.json');
  });

  it('degrades one failed process-message lookup without terminating the live stream', async () => {
    const sessions = {
      ...makeSessions([
        referencedEvent('CAPABILITY_STARTED', 1, {
          messageId: 'unavailable-message',
          capabilityId: 'Read',
          toolCallId: 'call-1',
        }),
        completed(2),
      ]),
      resolveProcessMessages: vi.fn(async () => {
        throw new Error('message store unavailable');
      }),
    } as RuntimeSessionPort;
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));

    const output = await collect(buildRequest(sessions, guardrail));

    expect(output).toHaveLength(2);
    expect(output[0]?.payload).toMatchObject({
      capabilityId: 'Read',
      toolCallId: 'call-1',
      contentUnavailable: true,
    });
    expect(output[1]?.eventType).toBe('REQUEST_COMPLETED');
    expect(JSON.stringify(output)).not.toContain('message store unavailable');
  });

  it('does not resolve message ids carried by non-process lifecycle events', async () => {
    const resolveProcessMessages = vi.fn(async () => [assistantToolUseMessage()]);
    const sessions = {
      ...makeSessions([
        {
          ...accepted(1),
          inlinePayload: {
            attempt: 1,
            agentId: 'agent-1',
            agentVersion: 'v1',
            status: 'EXECUTING',
            messageId: REQUEST_ID,
          },
        },
        completed(2),
      ]),
      resolveProcessMessages,
    } as RuntimeSessionPort;
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));

    const output = await collect(buildRequest(sessions, guardrail));

    expect(output.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']);
    expect(resolveProcessMessages).not.toHaveBeenCalled();
  });
});

describe('deliverWebStream output guard', () => {
  it('keeps every checkAnswer call inside the contract and checks the final increment at stream end', async () => {
    // A long answer (well past 2000 chars) split across two cumulative snapshots.
    // Each checkAnswer call sends only the NEW increment (<=256-char sentence
    // fragments), so no single call exceeds the contract. Already-checked text
    // is never re-sent.
    const first = '这是一个用来测试分段护栏的句子。'.repeat(40); // ~520 chars
    const second = first + '后续追加的另外一段内容用于覆盖尾部检测。'.repeat(40); // ~1240 chars
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));
    const sessions = makeSessions([accepted(1), delta(first, 2), delta(second, 3), completed(4)]);

    const output = await collect(buildRequest(sessions, guardrail));

    // Contract invariants on EVERY checkAnswer call.
    for (const answers of guardrail.calls) {
      expect(answers.length, '1-10 items per call').toBeGreaterThanOrEqual(1);
      expect(answers.length, 'at most 10 items per call').toBeLessThanOrEqual(10);
      for (const frag of answers) {
        expect(frag.length, 'each fragment <= 256 chars').toBeLessThanOrEqual(256);
      }
      const total = answers.reduce((sum, f) => sum + f.length, 0);
      expect(total, 'total <= 2000 chars per call').toBeLessThanOrEqual(2000);
    }
    // The final (unchecked) increment is checked at stream end via the force
    // tail check — the last call's fragments must include the trailing sentence
    // of `second` (the most recent text).
    const lastCall = guardrail.calls[guardrail.calls.length - 1]!;
    const tailSentence = '后续追加的另外一段内容用于覆盖尾部检测。';
    expect(lastCall.some((frag) => frag.includes(tailSentence))).toBe(true);
    // At least one mid-stream increment check + one terminal tail check.
    expect(guardrail.calls.length).toBeGreaterThanOrEqual(2);
    // Legal run: terminal passes through, no guard block injected.
    expect(output.some((env) => env.eventType === 'REQUEST_COMPLETED')).toBe(true);
    expect(output.some((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED')).toBe(false);
  });

  it('checks a short answer (<threshold) once at the terminal tail as a single fragment', async () => {
    const short = 'hello';
    const guardrail = makeGuardrail(() => ({ isLegal: true, refusalMessage: '' }));
    const sessions = makeSessions([accepted(1), delta(short, 2), completed(3)]);

    await collect(buildRequest(sessions, guardrail));

    // No mid-stream chunk check (under 256), exactly one tail check on the full
    // text, carried as a single short fragment.
    expect(guardrail.calls).toEqual([[short]]);
  });

  it('retracts to OUTPUT_GUARD_BLOCKED and drops the runtime terminal when the guard blocks', async () => {
    const sensitive = 'sensitive answer that should be retracted';
    const refusal = '抱歉，该回答已被安全护栏拦截。';
    const guardrail = makeGuardrail(() => ({ isLegal: false, refusalMessage: refusal }));
    const onOutputGuardBlocked = vi.fn();
    const sessions = makeSessions([accepted(1), delta(sensitive, 2), completed(3)]);

    const output = await collect(buildRequest(sessions, guardrail, onOutputGuardBlocked));

    const blocked = output.find((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED');
    expect(blocked).toBeDefined();
    expect((blocked!.payload as { refusalMessage: string }).refusalMessage).toBe(refusal);
    expect(onOutputGuardBlocked).toHaveBeenCalledOnce();
    // The blocked envelope MUST carry requestContextId so the frontend's
    // getEnvelopeAttemptId matches the other events in the same attempt
    // (otherwise the store drops it and retraction never happens).
    expect(blocked!.requestContextId).toBe(CONTEXT_ID);
    expect((blocked!.payload as { requestContextId?: string }).requestContextId).toBe(CONTEXT_ID);
    // The runtime terminal is replaced by the guard terminal.
    expect(output.some((env) => env.eventType === 'REQUEST_COMPLETED')).toBe(false);
  });

  it('blocks mid-stream when a chunk check settles blocked before the terminal', async () => {
    const chunk = 'x'.repeat(300);
    const refusal = 'blocked';
    // First check (on the 300-char chunk) blocks; resolve on a microtask so it
    // settles before the terminal event is processed.
    const guardrail = makeGuardrail(() => ({ isLegal: false, refusalMessage: refusal }));
    const onOutputGuardBlocked = vi.fn();
    const sessions = makeSessions([accepted(1), delta(chunk, 2), completed(3)]);

    const output = await collect(buildRequest(sessions, guardrail, onOutputGuardBlocked));

    expect(output.some((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED')).toBe(true);
    expect(onOutputGuardBlocked).toHaveBeenCalled();
    expect(output.some((env) => env.eventType === 'REQUEST_COMPLETED')).toBe(false);
  });

  it('still blocks when the violation sits in a later increment of a long answer', async () => {
    // A long answer whose early text is benign but a LATER sentence is
    // sensitive. Incremental detection must still surface the sensitive
    // sentence in its own increment and retract — proving the guard does not
    // drop mid-answer violations just because earlier text was checked first.
    const benign = '这是一段完全正常的开场白内容用来填充前面的片段。'.repeat(8);
    const sensitive = '这是包含敏感词的句子需要被拦截。';
    const longAnswer = benign + sensitive;
    const refusal = 'blocked';
    const guardrail = makeGuardrail((answers) => ({
      isLegal: !answers.some((frag) => frag.includes('敏感词')),
      refusalMessage: refusal,
    }));
    const onOutputGuardBlocked = vi.fn();
    const sessions = makeSessions([accepted(1), delta(longAnswer, 2), completed(3)]);

    const output = await collect(buildRequest(sessions, guardrail, onOutputGuardBlocked));

    // The sensitive sentence was sent to checkAnswer (in whichever increment
    // covered it). The guard must have seen it.
    const sentSensitive = guardrail.calls.some((answers) => answers.some((frag) => frag.includes('敏感词')));
    expect(sentSensitive, 'sensitive text was sent to checkAnswer').toBe(true);
    // And the run was blocked.
    expect(output.some((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED')).toBe(true);
    expect(onOutputGuardBlocked).toHaveBeenCalled();
    expect(output.some((env) => env.eventType === 'REQUEST_COMPLETED')).toBe(false);
  });

  it('localizes the fail-closed refusal by guardLocale when the guard service throws', async () => {
    // checkAnswer throws (guard service unreachable) → checkAnswerSegmented's
    // catch must fail-closed with a message in the deployment language.
    const throwingGuardrail: WebGuardrailPort = {
      checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
      checkAnswer: vi.fn(async () => {
        throw new Error('guard service unreachable');
      }),
    };
    const onOutputGuardBlocked = vi.fn();

    const enSessions = makeSessions([accepted(1), delta('some answer', 2), completed(3)]);
    const enOutput = await collect(buildRequest(enSessions, throwingGuardrail, onOutputGuardBlocked, 'en-US'));
    const enBlocked = enOutput.find((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED');
    expect(enBlocked).toBeDefined();
    expect((enBlocked!.payload as { refusalMessage: string }).refusalMessage).toBe(
      'The guardrail service is unavailable. The response has been refused.',
    );

    const zhSessions = makeSessions([accepted(1), delta('some answer', 2), completed(3)]);
    const zhOutput = await collect(buildRequest(zhSessions, throwingGuardrail, onOutputGuardBlocked, 'zh-CN'));
    const zhBlocked = zhOutput.find((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED');
    expect(zhBlocked).toBeDefined();
    expect((zhBlocked!.payload as { refusalMessage: string }).refusalMessage).toBe('护栏服务不可用，拒绝回答。');
  });

  it('defaults the fail-closed refusal to Chinese when guardLocale is absent', async () => {
    const throwingGuardrail: WebGuardrailPort = {
      checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
      checkAnswer: vi.fn(async () => {
        throw new Error('guard service unreachable');
      }),
    };
    const sessions = makeSessions([accepted(1), delta('some answer', 2), completed(3)]);
    const output = await collect(buildRequest(sessions, throwingGuardrail));
    const blocked = output.find((env) => env.eventType === 'OUTPUT_GUARD_BLOCKED');
    expect(blocked).toBeDefined();
    expect((blocked!.payload as { refusalMessage: string }).refusalMessage).toBe('护栏服务不可用，拒绝回答。');
  });
});
