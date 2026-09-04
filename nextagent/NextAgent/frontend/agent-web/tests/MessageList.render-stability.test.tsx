// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnBlock } from '../src/state/contracts.ts';

const renderedTurnProps = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const renderedTurnCounts = vi.hoisted(() => new Map<string, number>());

vi.mock('../src/features/chat/components/TurnBlock', async () => {
  const { memo } = await import('react');
  return {
    TurnBlockComponent: memo((props: { block: TurnBlock }) => {
      renderedTurnProps.set(props.block.rootMessageId, props as unknown as Record<string, unknown>);
      renderedTurnCounts.set(props.block.rootMessageId, (renderedTurnCounts.get(props.block.rootMessageId) ?? 0) + 1);
      return <div data-testid={`turn-${props.block.rootMessageId}`} />;
    }),
  };
});

import { MessageList } from '../src/features/chat/components/MessageList';

function makeBlock(rootMessageId: string, isLatest: boolean): TurnBlock {
  const userMessage = {
    messageId: `user-${rootMessageId}`,
    sessionId: 'session-1',
    content: rootMessageId,
    createdAt: '2026-07-20T00:00:00.000Z',
    visible: true,
  } as const;
  return {
    rootMessageId,
    userMessage,
    aiEvents: [],
    status: 'COMPLETED',
    isLatest,
  };
}

describe('MessageList turn follow signals', () => {
  beforeEach(() => {
    renderedTurnProps.clear();
    renderedTurnCounts.clear();
  });

  it('only sends the reactive follow-bottom signal to the latest turn', () => {
    const blocks = [makeBlock('root-1', false), makeBlock('root-2', true)];
    let isFollowingBottom = true;
    const readIsFollowingBottom = () => isFollowingBottom;
    const commonProps = {
      blocks,
      onRetry: vi.fn(),
      onEdit: vi.fn(),
      onCancel: vi.fn(),
      readIsFollowingBottom,
    };

    const { rerender } = render(<MessageList {...commonProps} isFollowingBottom onSuggestedQuestionClick={() => {}} />);

    expect(renderedTurnProps.get('root-1')?.isViewportFollowingBottom).toBe(false);
    expect(renderedTurnProps.get('root-2')?.isViewportFollowingBottom).toBe(true);

    isFollowingBottom = false;
    rerender(<MessageList {...commonProps} isFollowingBottom={false} onSuggestedQuestionClick={() => {}} />);

    expect(renderedTurnProps.get('root-1')?.isViewportFollowingBottom).toBe(false);
    expect(renderedTurnProps.get('root-2')?.isViewportFollowingBottom).toBe(false);
    expect((renderedTurnProps.get('root-1')?.readIsViewportFollowingBottom as () => boolean)()).toBe(false);
    expect(renderedTurnCounts.get('root-1')).toBe(1);
    expect(renderedTurnCounts.get('root-2')).toBe(2);
  });

  it('only changes the latest turn when request actions become disabled', () => {
    const blocks = [makeBlock('root-1', false), makeBlock('root-2', true)];
    const commonProps = {
      blocks,
      onRetry: vi.fn(),
      onEdit: vi.fn(),
      onCancel: vi.fn(),
      readIsFollowingBottom: () => true,
    };

    const { rerender } = render(<MessageList {...commonProps} turnActionsDisabled={false} />);
    rerender(<MessageList {...commonProps} turnActionsDisabled />);

    expect(renderedTurnProps.get('root-1')?.turnActionsDisabled).toBe(false);
    expect(renderedTurnProps.get('root-2')?.turnActionsDisabled).toBe(true);
    expect(renderedTurnCounts.get('root-1')).toBe(1);
    expect(renderedTurnCounts.get('root-2')).toBe(2);
  });

  it('does not re-render 200 settled turns when only a new active turn changes', () => {
    const settledBlocks = Array.from({ length: 200 }, (_, index) => makeBlock(`history-${index}`, false));
    const firstActiveBlock = makeBlock('active', true);
    const commonProps = {
      onRetry: vi.fn(),
      onEdit: vi.fn(),
      onCancel: vi.fn(),
      readIsFollowingBottom: () => true,
    };
    const { rerender } = render(<MessageList {...commonProps} blocks={[...settledBlocks, firstActiveBlock]} />);
    const nextActiveBlock = {
      ...firstActiveBlock,
      aiEvents: [
        {
          eventId: 'active-delta',
          sessionId: 'session-1',
          requestId: 'active',
          sequence: 1,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { role: 'ASSISTANT', delta: 'next', contentType: 'PLAIN_TEXT' },
          createdAt: '2026-07-20T00:00:01.000Z',
        },
      ],
    } satisfies TurnBlock;

    rerender(<MessageList {...commonProps} blocks={[...settledBlocks, nextActiveBlock]} />);

    for (const block of settledBlocks) {
      expect(renderedTurnCounts.get(block.rootMessageId)).toBe(1);
    }
    expect(renderedTurnCounts.get('active')).toBe(2);
  });
});
