// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithAppProviders } from './renderWithAppProviders.tsx';

const lazyMermaidLifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
}));

vi.mock('../src/features/chat/components/LazyMermaid.tsx', () => ({
  LazyMermaid: ({ onRendered }: { readonly onRendered?: () => void }) => {
    useEffect(() => {
      lazyMermaidLifecycle.mounts += 1;
      return () => {
        lazyMermaidLifecycle.unmounts += 1;
      };
    }, []);

    useEffect(() => {
      onRendered?.();
    }, [onRendered]);

    return <div data-testid="mock-lazy-mermaid">mock mermaid</div>;
  },
}));

import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts';

afterEach(() => {
  cleanup();
  __resetTurnBlockTestState();
  lazyMermaidLifecycle.mounts = 0;
  lazyMermaidLifecycle.unmounts = 0;
});

const baseBlock: TurnBlock = {
  rootMessageId: 'msg-1',
  userMessage: {
    messageId: 'msg-1',
    sessionId: 'session-1',
    role: 'USER',
    sequence: 1,
    content: 'show topology',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-04-15T00:00:00Z',
    visible: true,
    requestContextId: 'req-1',
    rootMessageId: 'msg-1',
  },
  aiEvents: [
    {
      eventId: 'evt-1',
      sessionId: 'session-1',
      requestId: 'req-1',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      transportHints: ['SSE'],
      payload: {
        content: '```mermaid\ngraph TD\nA-->B\n```',
        text: '```mermaid\ngraph TD\nA-->B\n```',
        contentType: 'MARKDOWN',
        metadata: { accumulated: true },
      },
      createdAt: '2026-04-15T00:00:01Z',
    } as StreamEnvelope,
  ],
  status: 'EXECUTING',
  isLatest: true,
};

describe('TurnBlock mermaid scroll behavior', () => {
  it('requests scroll-to-bottom when a followed streaming answer visibly grows', async () => {
    const onRequestScrollToBottom = vi.fn();
    const textBlock: TurnBlock = {
      ...baseBlock,
      aiEvents: [
        {
          ...baseBlock.aiEvents[0],
          eventId: 'evt-text-1',
          payload: {
            content: 'initial diagnostic answer',
            text: 'initial diagnostic answer',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          },
        } as StreamEnvelope,
      ],
    };

    const { rerender } = renderWithAppProviders(
      <TurnBlockComponent
        block={textBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={true}
        onRequestScrollToBottom={onRequestScrollToBottom}
      />,
    );

    expect(onRequestScrollToBottom).toHaveBeenCalled();
    onRequestScrollToBottom.mockClear();

    rerender(
      <TurnBlockComponent
        block={{
          ...textBlock,
          aiEvents: [
            {
              ...(textBlock.aiEvents[0] as StreamEnvelope),
              eventId: 'evt-text-2',
              sequence: 3,
              payload: {
                ...((textBlock.aiEvents[0] as StreamEnvelope).payload as Record<string, unknown>),
                content: 'initial diagnostic answer\n\nadditional streamed paragraph',
                text: 'initial diagnostic answer\n\nadditional streamed paragraph',
              },
            } as StreamEnvelope,
          ],
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={true}
        onRequestScrollToBottom={onRequestScrollToBottom}
      />,
    );

    await waitFor(() => {
      expect(onRequestScrollToBottom).toHaveBeenCalled();
    });
  });

  it('requests scroll-to-bottom when mermaid settles while the viewport is following, even if not pinned', async () => {
    const onRequestScrollToBottom = vi.fn();
    const onRequestPreserveReadingAnchor = vi.fn();

    renderWithAppProviders(
      <TurnBlockComponent
        block={baseBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportAtBottom={false}
        isViewportFollowingBottom={true}
        onRequestScrollToBottom={onRequestScrollToBottom}
        onRequestPreserveReadingAnchor={onRequestPreserveReadingAnchor}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-lazy-mermaid')).toBeTruthy();
    });

    expect(onRequestScrollToBottom).toHaveBeenCalled();
    expect(onRequestPreserveReadingAnchor).not.toHaveBeenCalled();
  });

  it('requests scroll-to-bottom when mermaid settles and the viewport is pinned to bottom', async () => {
    const onRequestScrollToBottom = vi.fn();
    const onRequestPreserveReadingAnchor = vi.fn();

    renderWithAppProviders(
      <TurnBlockComponent
        block={baseBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportAtBottom={true}
        isViewportFollowingBottom={true}
        onRequestScrollToBottom={onRequestScrollToBottom}
        onRequestPreserveReadingAnchor={onRequestPreserveReadingAnchor}
      />,
    );

    await waitFor(() => {
      expect(onRequestScrollToBottom).toHaveBeenCalled();
    });
    expect(onRequestPreserveReadingAnchor).not.toHaveBeenCalled();
  });

  it('does not remount mermaid when bottom-state props change without content changes', async () => {
    const { rerender } = renderWithAppProviders(
      <TurnBlockComponent
        block={baseBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportAtBottom={false}
        isViewportFollowingBottom={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-lazy-mermaid')).toBeTruthy();
    });

    expect(lazyMermaidLifecycle.mounts).toBe(1);
    expect(lazyMermaidLifecycle.unmounts).toBe(0);

    rerender(
      <TurnBlockComponent
        block={baseBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportAtBottom={true}
        isViewportFollowingBottom={true}
      />,
    );

    expect(lazyMermaidLifecycle.mounts).toBe(1);
    expect(lazyMermaidLifecycle.unmounts).toBe(0);
  });

  it('does not remount mermaid when assistant markdown grows after the mermaid block', async () => {
    const blockWithTrailingMarkdown: TurnBlock = {
      ...baseBlock,
      aiEvents: [
        {
          ...baseBlock.aiEvents[0],
          payload: {
            ...((baseBlock.aiEvents[0] as StreamEnvelope).payload as Record<string, unknown>),
            content: ['## 网络拓扑', '', '```mermaid', 'graph TD', 'A-->B', '```', '', '初始说明。'].join('\n'),
            text: ['## 网络拓扑', '', '```mermaid', 'graph TD', 'A-->B', '```', '', '初始说明。'].join('\n'),
          },
        } as StreamEnvelope,
      ],
    };

    const { rerender } = renderWithAppProviders(
      <TurnBlockComponent block={blockWithTrailingMarkdown} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-lazy-mermaid')).toBeTruthy();
    });

    expect(lazyMermaidLifecycle.mounts).toBe(1);
    expect(lazyMermaidLifecycle.unmounts).toBe(0);

    const grownBlock: TurnBlock = {
      ...blockWithTrailingMarkdown,
      aiEvents: [
        {
          ...(blockWithTrailingMarkdown.aiEvents[0] as StreamEnvelope),
          payload: {
            ...((blockWithTrailingMarkdown.aiEvents[0] as StreamEnvelope).payload as Record<string, unknown>),
            content: ['## 网络拓扑', '', '```mermaid', 'graph TD', 'A-->B', '```', '', '初始说明。', '', '新增一段诊断结论。'].join('\n'),
            text: ['## 网络拓扑', '', '```mermaid', 'graph TD', 'A-->B', '```', '', '初始说明。', '', '新增一段诊断结论。'].join('\n'),
          },
        } as StreamEnvelope,
      ],
    };

    rerender(<TurnBlockComponent block={grownBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(lazyMermaidLifecycle.mounts).toBe(1);
    expect(lazyMermaidLifecycle.unmounts).toBe(0);
  });
});
