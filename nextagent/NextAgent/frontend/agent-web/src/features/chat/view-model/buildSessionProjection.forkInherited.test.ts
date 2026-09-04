import { describe, expect, it } from 'vitest';
import type { SessionConversationMessage } from '../../../state/contracts.ts';
import { buildSessionHistoryProjection } from './buildSessionProjection.ts';

function historyMessage(overrides: Partial<SessionConversationMessage>): SessionConversationMessage {
  return {
    messageId: 'm-1',
    sessionId: 'S1',
    role: 'USER',
    sequence: 1,
    content: 'question',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-07-22T10:00:00.000Z',
    visible: true,
    ...overrides,
  } as SessionConversationMessage;
}

describe('buildSessionHistoryProjection fork-inherited marking', () => {
  it('marks turn blocks whose history messages carry the forkInherited metadata flag', () => {
    const inheritedUser = historyMessage({
      messageId: 'root-inherited',
      requestId: 'root-inherited',
      runId: 'run-inherited',
      metadata: { forkInherited: true },
    });
    const inheritedAssistant = historyMessage({
      messageId: 'ai-inherited',
      role: 'ASSISTANT',
      requestId: 'root-inherited',
      runId: 'run-inherited',
      sequence: 2,
      content: 'inherited answer',
      metadata: { forkInherited: true, eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
      createdAt: '2026-07-22T10:00:01.000Z',
    });
    const ownUser = historyMessage({
      messageId: 'root-own',
      requestId: 'root-own',
      runId: 'run-own',
      sequence: 3,
      content: 'own question',
      createdAt: '2026-07-22T10:01:00.000Z',
    });
    const ownAssistant = historyMessage({
      messageId: 'ai-own',
      role: 'ASSISTANT',
      requestId: 'root-own',
      runId: 'run-own',
      sequence: 4,
      content: 'own answer',
      metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
      createdAt: '2026-07-22T10:01:01.000Z',
    });

    const projection = buildSessionHistoryProjection({
      historyMessages: [inheritedUser, inheritedAssistant, ownUser, ownAssistant],
      historyEnvelopes: [],
    });

    const inheritedBlock = projection.historicalTurnBlocks.find((block) => block.rootMessageId === 'root-inherited');
    const ownBlock = projection.historicalTurnBlocks.find((block) => block.rootMessageId === 'root-own');
    expect(inheritedBlock?.forkInherited).toBe(true);
    expect(ownBlock?.forkInherited).toBeUndefined();
  });
});
