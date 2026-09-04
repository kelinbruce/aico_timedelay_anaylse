import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import { MessageList } from '../src/features/chat/components/MessageList';
import type { TurnBlock } from '../src/state/contracts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

afterEach(cleanup);

// No longer mocking react-window since we use native scrolling

// Mock ResizeObserver
beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

const mockBlocks: TurnBlock[] = [
  {
    rootMessageId: 'msg-1',
    userMessage: {
      messageId: 'msg-1',
      sessionId: 's1',
      role: 'USER',
      sequence: 1,
      content: 'Hello',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      createdAt: '2026-04-15T00:00:00Z',
      visible: true,
      requestContextId: 'r1',
      rootMessageId: 'msg-1',
    },
    aiEvents: [],
    status: 'COMPLETED',
    isLatest: false,
  },
  {
    rootMessageId: 'msg-2',
    userMessage: {
      messageId: 'msg-2',
      sessionId: 's1',
      role: 'USER',
      sequence: 3,
      content: 'Retry this',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      createdAt: '2026-04-15T00:00:02Z',
      visible: true,
      requestContextId: 'r2',
      rootMessageId: 'msg-2',
    },
    aiEvents: [],
    status: 'COMPLETED',
    isLatest: true,
  },
];

describe('MessageList Component', () => {
  it('renders all TurnBlocks', () => {
    render(<MessageList blocks={mockBlocks} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    expect(screen.getAllByTestId('turn-block')).toHaveLength(2);
  });

  it('renders edit submit notice when editNoticeVisible is true', () => {
    render(<MessageList blocks={mockBlocks} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} editNoticeVisible />);
    expect(screen.getByTestId('edit-submit-notice')).toBeTruthy();
  });

  it('shows scroll-to-bottom button when not at bottom', () => {
    render(
      <MessageList
        blocks={mockBlocks}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onScrollToBottom={() => {}}
        isAtBottom={false}
        hasNewMessages={true}
      />,
    );
    expect(screen.getByTestId('btn-scroll-to-bottom')).toBeTruthy();
  });

  it('hides scroll-to-bottom button when at bottom', () => {
    render(<MessageList blocks={mockBlocks} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isAtBottom={true} />);
    expect(screen.queryByTestId('btn-scroll-to-bottom')).toBeNull();
  });

  it('calls onScrollToBottom when button is clicked', () => {
    const onScrollToBottom = vi.fn();
    render(
      <MessageList
        blocks={mockBlocks}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onScrollToBottom={onScrollToBottom}
        isAtBottom={false}
        hasNewMessages={true}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-scroll-to-bottom'));
    expect(onScrollToBottom).toHaveBeenCalled();
  });
});
