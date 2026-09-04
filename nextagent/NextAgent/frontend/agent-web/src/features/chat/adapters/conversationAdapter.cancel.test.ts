import { describe, expect, it } from 'vitest';
import type { SessionConversationMessage } from '../../../state/contracts.ts';
import { conversationMessagesToHistoryEnvelopes } from './conversationAdapter.ts';

function makeMessage(overrides: Partial<SessionConversationMessage> = {}): SessionConversationMessage {
  return {
    messageId: 'msg-1',
    sessionId: 'session-adapter-test',
    requestId: 'request-1',
    runId: 'run-1',
    requestContextId: 'ctx-1',
    rootMessageId: 'root-1',
    role: 'ASSISTANT',
    sequence: 1,
    content: '',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: 1783346000000,
    visible: true,
    ...overrides,
  } as SessionConversationMessage;
}

describe('D5: toHistoryEnvelope skips unidentified assistant-terminal messages', () => {
  it('skips assistant-terminal message with unrecognized content', () => {
    const messages: SessionConversationMessage[] = [
      makeMessage({
        messageId: 'assistant-terminal-unknown-1',
        content: 'Some unrecognized terminal content that does not match any pattern',
        metadata: {},
      }),
    ];
    const envelopes = conversationMessagesToHistoryEnvelopes(messages);
    expect(envelopes).toHaveLength(0);
  });

  it('still resolves known cancel terminal messages', () => {
    const messages: SessionConversationMessage[] = [
      makeMessage({
        messageId: 'assistant-terminal-cancel-1',
        content: 'Request canceled by user.',
        metadata: { eventType: 'REQUEST_CANCELED', status: 'CANCELED' },
      }),
    ];
    const envelopes = conversationMessagesToHistoryEnvelopes(messages);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.eventType).toBe('REQUEST_CANCELED');
  });

  it('still resolves normal assistant content messages', () => {
    const messages: SessionConversationMessage[] = [
      makeMessage({
        messageId: 'msg-normal-1',
        content: 'This is a normal assistant reply.',
        metadata: {},
      }),
    ];
    const envelopes = conversationMessagesToHistoryEnvelopes(messages);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.eventType).toBe('LLM_CONTENT_DELTA');
  });
});
