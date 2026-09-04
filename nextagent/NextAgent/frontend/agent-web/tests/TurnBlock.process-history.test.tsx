import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../src/i18n/index.ts';
import { TurnBlockComponent } from '../src/features/chat/components/TurnBlock.tsx';
import { __resetProcessPanelTestState } from '../src/features/chat/components/ProcessPanel.tsx';
import { compactLiveEnvelopes } from '../src/features/chat/utils/streamCompaction.ts';
import type { RunProcessHistoryState, TurnBlock } from '../src/state/contracts.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const block: TurnBlock = {
  rootMessageId: 'root-1',
  displayRunId: 'run-1',
  userMessage: {
    messageId: 'root-1',
    sessionId: 'session-1',
    content: 'check router policy',
    createdAt: '2026-07-22T00:00:00.000Z',
    visible: true,
  },
  aiEvents: [
    {
      eventId: 'answer-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      rootMessageId: 'root-1',
      requestContextId: 'context-1',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      transportHints: ['history-load'],
      payload: { content: 'router is compliant', contentType: 'MARKDOWN' },
      createdAt: '2026-07-22T00:00:02.000Z',
    },
  ],
  status: 'COMPLETED',
  isLatest: true,
};

function renderBlock(processHistoryState: RunProcessHistoryState, onRetryRunProcessHistory = vi.fn(), onProcessPanelExpansionChange = vi.fn()) {
  return render(
    <TurnBlockComponent
      block={block}
      processHistoryState={processHistoryState}
      onRetryRunProcessHistory={onRetryRunProcessHistory}
      onProcessPanelExpansionChange={onProcessPanelExpansionChange}
      onRetry={() => {}}
      onEdit={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe('TurnBlock process history state', () => {
  beforeEach(async () => {
    __resetProcessPanelTestState();
    await i18n.changeLanguage('zh-CN');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not expose an active run as an automatic process-history target', () => {
    const activeBlock: TurnBlock = {
      ...block,
      status: 'EXECUTING',
      aiEvents: [
        {
          ...block.aiEvents[0]!,
          eventId: 'thinking-live',
          eventType: 'LLM_THINKING_DELTA',
          payload: {
            text: 'live reasoning',
            stepId: 'turn-1',
            metadata: { accumulated: true },
          },
        },
      ],
    };
    const { rerender } = render(
      <TurnBlockComponent block={activeBlock} processHistoryState={{ status: 'IDLE' }} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByTestId('turn-block').hasAttribute('data-process-run-id')).toBe(false);

    rerender(
      <TurnBlockComponent
        block={{ ...activeBlock, status: 'COMPLETED' }}
        processHistoryState={{ status: 'IDLE' }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByTestId('turn-block').getAttribute('data-process-run-id')).toBe('run-1');
  });

  it('does not publish an explicit process-history target when an active panel expands', () => {
    const onExpansionChange = vi.fn();
    render(
      <TurnBlockComponent
        block={{
          ...block,
          status: 'EXECUTING',
          aiEvents: [
            {
              ...block.aiEvents[0]!,
              eventId: 'thinking-live',
              eventType: 'LLM_THINKING_DELTA',
              payload: {
                text: 'live reasoning',
                stepId: 'turn-1',
                metadata: { accumulated: true },
              },
            },
          ],
        }}
        processHistoryState={{ status: 'IDLE' }}
        onProcessPanelExpansionChange={onExpansionChange}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(onExpansionChange).not.toHaveBeenCalled();
  });

  it('shows a delayed stable loading affordance without hiding the committed answer', () => {
    vi.useFakeTimers();
    renderBlock({ status: 'LOADING' });

    expect(screen.queryByTestId('turn-process-summary')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('执行详情');
    expect(screen.getByTestId('turn-process-history-spinner')).toBeTruthy();
    expect(screen.queryByText('正在加载历史过程详情…')).toBeNull();
    expect(screen.getByTestId('assistant-content-region').textContent).toContain('router is compliant');
  });

  it('delays a loading-only row for 300ms without replacing the existing process title', () => {
    vi.useFakeTimers();
    const existingProcessBlock: TurnBlock = {
      ...block,
      aiEvents: [
        {
          ...block.aiEvents[0]!,
          eventId: 'existing-thinking',
          sequence: 1,
          eventType: 'LLM_THINKING_DELTA',
          payload: {
            text: 'existing completed thinking',
            metadata: { accumulated: true, completed: true },
          },
        },
        block.aiEvents[0]!,
      ],
    };
    render(
      <TurnBlockComponent
        block={existingProcessBlock}
        processHistoryState={{ status: 'LOADING', startedAt: 1 }}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('执行详情');
    expect(screen.queryByText('正在加载历史过程详情…')).toBeNull();
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('执行详情');
    expect(screen.queryByText('正在加载历史过程详情…')).toBeNull();

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-history-loading-body').textContent).toContain('正在加载历史过程详情…');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('执行详情');
    expect(screen.getByTestId('turn-process-history-spinner')).toBeTruthy();
  });

  it('keeps an expanded empty process panel mounted and shows its loading body immediately on revisit', () => {
    vi.useFakeTimers();
    const historicalThinking = {
      ...block.aiEvents[0]!,
      eventId: 'thinking-before-eviction',
      sequence: 1,
      eventType: 'LLM_THINKING_DELTA' as const,
      payload: {
        text: 'history available before eviction',
        metadata: { accumulated: true, completed: true },
      },
    };
    const availableBlock = {
      ...block,
      aiEvents: [historicalThinking, block.aiEvents[0]!],
    };
    const { rerender } = render(
      <TurnBlockComponent
        block={availableBlock}
        processHistoryState={{ status: 'AVAILABLE', envelopes: [historicalThinking] }}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');

    rerender(
      <TurnBlockComponent
        block={block}
        processHistoryState={{ status: 'LOADING', startedAt: 2 }}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('turn-process-history-loading-body').textContent).toContain('正在加载历史过程详情…');
    expect(screen.queryByTestId('turn-process-history-spinner')).toBeNull();
  });

  it('shows only a safe retryable failure and invokes retry for the selected run', () => {
    const onRetry = vi.fn();
    renderBlock({ status: 'FAILED', errorCode: 'PROCESS_HISTORY_LOAD_FAILED' }, onRetry);

    expect(screen.queryByTestId('turn-process-history-state')).toBeNull();
    expect(document.body.textContent).not.toContain('无法加载');
    expect(document.body.textContent).not.toContain('provider');
    expect(screen.queryByRole('button', { name: /重试加载历史过程详情/ })).toBeNull();
  });

  it('shows legacy unavailable without a retry control', () => {
    renderBlock({ status: 'LEGACY_UNAVAILABLE' });

    expect(screen.getByTestId('turn-process-history-state').textContent).toBe('此升级前分叉会话没有可用的历史过程详情。');
    expect(screen.queryByRole('button', { name: /重试加载历史过程详情/ })).toBeNull();
  });

  it('does not show an error or legacy notice for AVAILABLE empty history', () => {
    renderBlock({ status: 'AVAILABLE', envelopes: [] });

    expect(screen.queryByTestId('turn-process-history-state')).toBeNull();
    expect(document.body.textContent).not.toContain('无法加载');
    expect(document.body.textContent).not.toContain('升级前分叉');
  });

  it('keeps completed historical thinking inspectable from the collapsed process panel', () => {
    const historyThinkingBlock: TurnBlock = {
      ...block,
      aiEvents: [
        {
          ...block.aiEvents[0]!,
          eventId: 'thinking-history',
          sequence: 1,
          eventType: 'LLM_THINKING_DELTA',
          transportHints: ['history-load'],
          payload: {
            text: 'historical router reasoning',
            metadata: { accumulated: true, completed: true },
          },
        },
        block.aiEvents[0]!,
      ],
    };

    render(
      <TurnBlockComponent
        block={historyThinkingBlock}
        processHistoryState={{ status: 'AVAILABLE', envelopes: [historyThinkingBlock.aiEvents[0]!] }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    const panelToggle = screen.getByTestId('turn-process-toggle');
    expect(panelToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(panelToggle);
    expect(screen.getByTestId('turn-process-entry-title').textContent).toBe('思考');
    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('turn-process-entry-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    expect(screen.getByTestId('turn-process-entry-detail').textContent).toContain('historical router reasoning');
  });

  it('keeps one complete supplemental-information entry after settlement', () => {
    const supplementalBlock: TurnBlock = {
      ...block,
      rootMessageId: 'root-supplemental',
      userMessage: {
        ...block.userMessage,
        messageId: 'root-supplemental',
      },
      aiEvents: [
        {
          ...block.aiEvents[0]!,
          rootMessageId: 'root-supplemental',
          eventId: 'ask-user-required',
          sequence: 1,
          eventType: 'USER_INPUT_REQUIRED',
          payload: {
            pendingInputId: 'pending-1',
            kind: 'QUESTION',
            questions: [
              {
                prompt: '选择站点',
                options: [{ label: '站点 A', value: 'site-a' }],
              },
            ],
          },
        },
        {
          ...block.aiEvents[0]!,
          rootMessageId: 'root-supplemental',
          eventId: 'ask-user-answer',
          sequence: 2,
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            capabilityId: 'AskUserQuestion',
            toolCallId: 'ask-user-1',
            pendingInputId: 'pending-1',
            kind: 'QUESTION',
            status: 'RECEIVED',
            safeResult: {
              kind: 'pendingInputAnswer',
              answers: [['site-a']],
              truncated: false,
            },
          },
        },
        {
          ...block.aiEvents[0]!,
          rootMessageId: 'root-supplemental',
        },
      ],
    };

    render(
      <TurnBlockComponent
        block={supplementalBlock}
        processHistoryState={{ status: 'AVAILABLE', envelopes: supplementalBlock.aiEvents.slice(0, 2) }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getAllByText('用户补充信息')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    const detail = screen.getByTestId('turn-process-entry-detail').textContent;
    expect(detail).toContain('选择站点');
    expect(detail).toContain('站点 A');
    expect(document.body.textContent).not.toContain('已响应');
    expect(document.body.textContent).not.toContain('AskUserQuestion');
  });

  it('renders the English state and accessible retry name', async () => {
    await i18n.changeLanguage('en-US');
    renderBlock({ status: 'FAILED', errorCode: 'PROCESS_HISTORY_LOAD_FAILED' });

    expect(screen.queryByTestId('turn-process-history-state')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry loading historical process details/ })).toBeNull();
  });

  it('collapses completed live thinking immediately before later activity can shift the layout', () => {
    const liveThinkingBlock = (completed: boolean): TurnBlock => ({
      ...block,
      status: 'EXECUTING',
      aiEvents: [
        {
          ...block.aiEvents[0]!,
          eventId: 'thinking-1',
          eventType: 'LLM_THINKING_DELTA',
          transportHints: ['SSE'],
          payload: {
            text: 'complete router reasoning',
            metadata: { accumulated: true, ...(completed ? { completed: true } : {}) },
          },
        },
      ],
    });
    const { rerender } = render(<TurnBlockComponent block={liveThinkingBlock(false)} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('turn-process-entry-detail').textContent).toContain('complete router reasoning');
    rerender(<TurnBlockComponent block={liveThinkingBlock(true)} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('turn-process-entry-detail')).toBeNull();
  });

  it('keeps one panel height observer while accumulated thinking text updates', () => {
    const createObserver = vi.fn();
    const observe = vi.fn();
    const disconnect = vi.fn();
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        createObserver(callback);
      }

      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    const thinkingEvent = (eventId: string, sequence: number, text: string) => ({
      ...block.aiEvents[0]!,
      eventId,
      sequence,
      eventType: 'LLM_THINKING_DELTA' as const,
      transportHints: ['SSE'],
      payload: { text, metadata: { accumulated: true } },
    });
    const liveThinkingBlock = (events: TurnBlock['aiEvents']): TurnBlock => ({
      ...block,
      status: 'EXECUTING',
      aiEvents: events,
    });
    const first = thinkingEvent('thinking-1', 1, 'inspect');
    const second = thinkingEvent('thinking-2', 2, 'inspect router');
    const third = thinkingEvent('thinking-3', 3, 'inspect router policy');

    const { rerender } = render(<TurnBlockComponent block={liveThinkingBlock([first])} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    rerender(<TurnBlockComponent block={liveThinkingBlock([first, second])} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    rerender(<TurnBlockComponent block={liveThinkingBlock([first, second, third])} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('turn-process-entry-detail').textContent).toContain('inspect router policy');
    expect(createObserver).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('keeps the same thinking detail mounted while live compaction advances', () => {
    const thinkingEvents = Array.from({ length: 502 }, (_, index) => ({
      ...block.aiEvents[0]!,
      eventId: `thinking-${index + 1}`,
      sequence: index + 1,
      eventType: 'LLM_THINKING_DELTA' as const,
      transportHints: ['SSE'],
      payload: {
        delta: index % 2 === 0 ? '思' : '考',
        metadata: { accumulated: false },
      },
    }));
    const liveThinkingBlock = (eventCount: number): TurnBlock => ({
      ...block,
      status: 'EXECUTING',
      aiEvents: compactLiveEnvelopes(thinkingEvents.slice(0, eventCount), 500),
    });

    const { rerender } = render(<TurnBlockComponent block={liveThinkingBlock(501)} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    const mountedDetail = screen.getByTestId('turn-process-entry-detail');

    rerender(<TurnBlockComponent block={liveThinkingBlock(502)} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('turn-process-entry-detail')).toBe(mountedDetail);
    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('uses zero-duration panel and entry transitions for reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
    const liveThinkingBlock: TurnBlock = {
      ...block,
      status: 'EXECUTING',
      aiEvents: [
        {
          ...block.aiEvents[0]!,
          eventId: 'thinking-reduced',
          eventType: 'LLM_THINKING_DELTA',
          transportHints: ['SSE'],
          payload: { text: 'reduced motion thinking', metadata: { accumulated: true } },
        },
      ],
    };

    render(<TurnBlockComponent block={liveThinkingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect((screen.getByTestId('turn-process-panel').parentElement as HTMLElement).style.transition).toContain('0ms');
    expect((screen.getByTestId('turn-process-entry-detail').parentElement as HTMLElement).style.transition).toContain('0ms');
    expect((screen.getByTestId('turn-process-toggle').querySelector('img:last-of-type') as HTMLImageElement | null)?.style.transition).toBe(
      'transform 0ms ease',
    );
    expect(screen.getByTestId('turn-process-entry-toggle').querySelector('img')?.style.transition).toBe('transform 0ms ease');
  });
});
