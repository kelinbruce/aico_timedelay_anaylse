import { brand, type IdempotencyKey, type SessionMessageRole, type TimelineEventType } from '@nextagent/agent-common';
import type { TerminalCommitRequest } from '@nextagent/agent-contracts/gateway';
import type { SessionMessage, SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('session message boundary regression', () => {
  it('keeps the four conversation message roles', () => {
    expectTypeOf<SessionMessageRole>().toEqualTypeOf<'USER' | 'ASSISTANT' | 'CAPABILITY_RESULT' | 'SUMMARY'>();
  });

  it('keeps process participation out of message contracts', () => {
    expectTypeOf<SessionMessage>().not.toHaveProperty('contextParticipation');
    expectTypeOf<TerminalCommitRequest>().not.toHaveProperty('thinkingMessages');

    const draft: SessionMessageDraft = {
      role: 'ASSISTANT',
      content: 'Final answer',
      contentType: 'MARKDOWN',
      visible: true,
      idempotencyKey: brand<string, 'IdempotencyKey'>('message-boundary-regression') as IdempotencyKey,
    };

    expect(draft.role).toBe('ASSISTANT');
  });

  it('does not add a parallel completed-thinking event type', () => {
    expectTypeOf<Extract<TimelineEventType, 'LLM_THINKING_SEGMENT_COMPLETED'>>().toEqualTypeOf<never>();
  });
});
