import { describe, expect, it } from 'vitest';
import { conversationMessagesToHistoryEnvelopes } from '../src/features/chat/adapters/conversationAdapter.ts';
import type { SessionConversationMessage } from '../src/state/contracts.ts';

describe('conversation adapter AskUserQuestion answers', () => {
  it('does not rebuild ordinary capability process details from conversation content', () => {
    const message = {
      messageId: 'read-result-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'read-1',
        toolName: 'Read',
        payload: {
          file_path: '/private/network/alarm.json',
          content: 'RAW_RESULT_MUST_NOT_BE_READ',
          truncated: false,
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'read-1', toolName: 'Read' },
      sequence: 1,
      visible: false,
      createdAt: '2026-07-23T00:00:01.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);

    expect(envelopes).toEqual([]);
    expect(JSON.stringify(envelopes)).not.toContain('RAW_RESULT_MUST_NOT_BE_READ');
  });

  it('maps only the conversation pendingInputAnswer projection into a history safe result', () => {
    const message = {
      messageId: 'answer-result-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'ask-user-1',
        toolName: 'AskUserQuestion',
        payload: {
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
          answers: [['RAW_MESSAGE_ANSWER_MUST_NOT_BE_READ']],
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'ask-user-1', toolName: 'AskUserQuestion' },
      pendingInputAnswer: {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
        safeResult: {
          kind: 'pendingInputAnswer',
          answers: [['site-a'], ['custom detail']],
          truncated: false,
        },
      },
      sequence: 1,
      visible: true,
      createdAt: '2026-07-23T00:00:01.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      eventType: 'CAPABILITY_RESULT_DELTA',
      requestContextId: 'request-1',
      rootMessageId: 'request-1',
      runId: 'run-1',
      payload: {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
        safeResult: {
          kind: 'pendingInputAnswer',
          answers: [['site-a'], ['custom detail']],
          truncated: false,
        },
      },
    });
    expect(JSON.stringify(envelopes[0]?.payload)).not.toContain('RAW_MESSAGE_ANSWER_MUST_NOT_BE_READ');
  });

  it('does not rebuild answers from raw content or malformed pendingInputAnswer fields', () => {
    const messages = [
      {
        messageId: 'answer-result-raw-only',
        pendingInputAnswer: undefined,
      },
      {
        messageId: 'answer-result-malformed',
        pendingInputAnswer: {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-1',
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
          safeSummary: 'Pending input answer received.',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['']],
            truncated: false,
          },
        },
      },
    ].map(({ messageId, pendingInputAnswer }) => ({
      messageId,
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT' as const,
      content: JSON.stringify({
        toolCallId: 'ask-user-1',
        toolName: 'AskUserQuestion',
        payload: {
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
          answers: [['SECRET_RAW_ANSWER']],
        },
      }),
      contentType: 'PLAIN_TEXT' as const,
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'ask-user-1', toolName: 'AskUserQuestion' },
      ...(pendingInputAnswer === undefined ? {} : { pendingInputAnswer }),
      sequence: 1,
      visible: true as const,
      createdAt: '2026-07-23T00:00:01.000Z',
    })) as unknown as SessionConversationMessage[];

    const envelopes = conversationMessagesToHistoryEnvelopes(messages);
    for (const envelope of envelopes) {
      expect(envelope.payload.safeResult).toBeUndefined();
      expect(JSON.stringify(envelope.payload)).not.toContain('SECRET_RAW_ANSWER');
    }
  });
});

describe('conversation adapter CLIP structured delta reconstruction', () => {
  it('rebuilds a TOOL_STRUCTURED_DELTA envelope from a direct-shape CLIP result message', () => {
    const message = {
      messageId: 'clip-result-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'clip-call-1',
        toolName: 'dynamic-clip-network-inspector',
        payload: {
          eventType: 'ANSWER',
          messageType: 'PIU',
          content: { piuName: 'networkChart', piuVersion: '1.0' },
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'clip-call-1', toolName: 'dynamic-clip-network-inspector' },
      sequence: 2,
      visible: true,
      createdAt: '2026-08-07T00:00:01.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      eventType: 'TOOL_STRUCTURED_DELTA',
      transportHints: ['history-load'],
      payload: {
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content: { piuName: 'networkChart', piuVersion: '1.0' },
        capabilityId: 'dynamic-clip-network-inspector',
        toolCallId: 'clip-call-1',
      },
    });
  });

  it('rebuilds a TOOL_STRUCTURED_DELTA envelope from a wrapped envelope payload', () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'recovery steps' });
    const message = {
      messageId: 'clip-result-2',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'clip-call-2',
        toolName: 'clip-tool',
        payload: {
          status: 'ok',
          data: { raw: inner },
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'clip-call-2', toolName: 'clip-tool' },
      sequence: 2,
      visible: true,
      createdAt: '2026-08-07T00:00:02.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      eventType: 'TOOL_STRUCTURED_DELTA',
      payload: {
        toolEventType: 'ANSWER',
        toolMessageType: 'TEXT',
        content: 'recovery steps',
      },
    });
  });

  it('rebuilds a TOOL_STRUCTURED_DELTA envelope when payload includes capabilityResult metadata', () => {
    const message = {
      messageId: 'clip-result-3',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'clip-call-3',
        toolName: 'clip-tool',
        payload: {
          eventType: 'ANSWER',
          messageType: 'DSL',
          content: { type: 'chart', data: [1, 2, 3] },
          capabilityResult: { resultRef: 'ref-1' },
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'clip-call-3', toolName: 'clip-tool' },
      sequence: 2,
      visible: true,
      createdAt: '2026-08-07T00:00:03.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      eventType: 'TOOL_STRUCTURED_DELTA',
      payload: {
        toolEventType: 'ANSWER',
        toolMessageType: 'DSL',
        content: { type: 'chart', data: [1, 2, 3] },
      },
    });
  });

  it('does not rebuild a TOOL_STRUCTURED_DELTA from a non-structured payload', () => {
    const message = {
      messageId: 'read-result-2',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'read-2',
        toolName: 'Read',
        payload: {
          file_path: '/private/network/alarm.json',
          content: 'RAW_RESULT_MUST_NOT_BE_READ',
          truncated: false,
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'read-2', toolName: 'Read' },
      sequence: 2,
      visible: false,
      createdAt: '2026-08-07T00:00:04.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toEqual([]);
  });

  it('does not rebuild a TOOL_STRUCTURED_DELTA when content field is missing', () => {
    const message = {
      messageId: 'clip-result-4',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'clip-call-4',
        toolName: 'clip-tool',
        payload: {
          eventType: 'ANSWER',
          messageType: 'PIU',
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'clip-call-4', toolName: 'clip-tool' },
      sequence: 2,
      visible: true,
      createdAt: '2026-08-07T00:00:05.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toEqual([]);
  });

  it('does not rebuild a TOOL_STRUCTURED_DELTA with invalid eventType', () => {
    const message = {
      messageId: 'clip-result-5',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'clip-call-5',
        toolName: 'clip-tool',
        payload: {
          eventType: 'UNKNOWN_TYPE',
          messageType: 'PIU',
          content: { data: 'test' },
        },
      }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'clip-call-5', toolName: 'clip-tool' },
      sequence: 2,
      visible: true,
      createdAt: '2026-08-07T00:00:06.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes).toEqual([]);
  });
});

describe('conversation adapter input-guard-blocked round projection', () => {
  it('projects a persisted INPUT_GUARD refusal as OUTPUT_GUARD_BLOCKED so buildTurnBlocks renders it as a terminal guard block, not EXECUTING', () => {
    // Mirrors backend recordInputGuardBlock: a visible=true ASSISTANT refusal
    // carrying metadata.guardPhase='INPUT_GUARD' + modelVisibility.excluded=true.
    // The round has no run and no runtime terminal event, so without this
    // projection the refusal would map to LLM_CONTENT_DELTA and the turn would
    // fall through to status='EXECUTING' (stuck on "executing").
    const userMessage = {
      messageId: 'guard-user-1',
      sessionId: 'session-1',
      requestId: 'guard-req-1',
      rootMessageId: 'guard-req-1',
      role: 'USER',
      content: 'blocked question',
      contentType: 'PLAIN_TEXT',
      metadata: { guardPhase: 'INPUT_GUARD', modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' } },
      sequence: 1,
      visible: true,
      createdAt: '2026-08-08T00:00:00.000Z',
    } satisfies SessionConversationMessage;

    const refusalMessage = {
      messageId: 'guard-refusal-1',
      sessionId: 'session-1',
      requestId: 'guard-req-1',
      rootMessageId: 'guard-req-1',
      role: 'ASSISTANT',
      content: '该问题已被安全护栏拦截。',
      contentType: 'PLAIN_TEXT',
      metadata: { guardPhase: 'INPUT_GUARD', modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' } },
      sequence: 2,
      visible: true,
      createdAt: '2026-08-08T00:00:00.500Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([userMessage, refusalMessage]);

    // User message maps to REQUEST_ACCEPTED (the round's user turn).
    expect(envelopes[0]?.eventType).toBe('REQUEST_ACCEPTED');
    // Refusal maps to OUTPUT_GUARD_BLOCKED so resolveStatus returns CANCELED
    // and TurnBlock renders GuardBlockedNotice.
    expect(envelopes[1]?.eventType).toBe('OUTPUT_GUARD_BLOCKED');
    expect(envelopes[1]?.payload).toMatchObject({ guardPhase: 'INPUT_GUARD' });
    expect(envelopes[1]?.transportHints).toContain('history-load');
  });

  it('does not project an OUTPUT_GUARD refusal (guardPhase absent) as OUTPUT_GUARD_BLOCKED via the input-guard path', () => {
    // An ordinary ASSISTANT message without guardPhase must keep mapping to
    // LLM_CONTENT_DELTA so the input-guard projection is scoped to blocked
    // rounds only.
    const message = {
      messageId: 'ordinary-assistant-1',
      sessionId: 'session-1',
      requestId: 'req-1',
      rootMessageId: 'req-1',
      role: 'ASSISTANT',
      content: 'ordinary answer',
      contentType: 'MARKDOWN',
      metadata: {},
      sequence: 2,
      visible: true,
      createdAt: '2026-08-08T00:00:01.000Z',
    } satisfies SessionConversationMessage;

    const envelopes = conversationMessagesToHistoryEnvelopes([message]);
    expect(envelopes[0]?.eventType).toBe('LLM_CONTENT_DELTA');
  });
});
