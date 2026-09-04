import { describe, expect, it } from 'vitest';

import { buildLocalIdentityContext, buildSubmittedMessageHistory } from '../src/features/chat/hooks/useChatComposerController.ts';
import type { TurnBlock } from '../src/state/contracts.ts';

function makeTurn(content: string): TurnBlock {
  return {
    rootMessageId: `root-${content}`,
    userMessage: {
      messageId: `msg-${content}`,
      sessionId: 'session-1',
      content,
      createdAt: '2026-06-02T00:00:00.000Z',
      visible: true,
    },
    aiEvents: [],
    status: 'COMPLETED',
    isLatest: false,
  };
}

describe('useChatComposerController identity placeholder', () => {
  it('does not depend on runtime bootstrap for session creation', () => {
    expect(buildLocalIdentityContext()).toEqual({
      tenantId: 'local',
      subjectId: 'local',
      displayName: 'local',
    });
  });

  it('derives submitted message history from the current turn blocks', () => {
    expect(buildSubmittedMessageHistory([makeTurn('first question'), makeTurn('   '), makeTurn('second question')])).toEqual([
      'first question',
      'second question',
    ]);
  });
});
