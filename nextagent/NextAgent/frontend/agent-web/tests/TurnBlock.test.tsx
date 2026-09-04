import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { Profiler } from 'react';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidMock.initialize,
    render: mermaidMock.render,
  },
}));

import { act, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import { getActionButton, queryActionButton } from '../src/features/chat/components/_overflowHelper';
import { __resetProcessPanelTestState } from '../src/features/chat/components/ProcessPanel.tsx';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';
import { compactLiveEnvelopes } from '../src/features/chat/utils/streamCompaction';
import type { TurnBlock, StreamEnvelope } from '../src/state/contracts';
import { aicoConfigStore, resetAICOConfigStoreForTesting } from '../src/aico-config/AICOConfigStore.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect(): void {}

  observe(target: Element): void {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(): void {}
}

afterEach(() => {
  cleanup();
  __resetTurnBlockTestState();
  __resetProcessPanelTestState();
  resetAICOConfigStoreForTesting();
  runtimeConfig.portalAbilityConfig = {
    suggestedQuestionsEnabled: true,
    cronTasksEnabled: true,
    longTermMemoryManagementEnabled: true,
    knowledgeImportEnabled: true,
    fullProcessEnabled: true,
  };
  vi.useRealTimers();
});

const writeTextMock = vi.fn().mockResolvedValue(undefined);
const execCommandMock = vi.fn((_command: string) => true);
beforeEach(() => {
  writeTextMock.mockClear();
  execCommandMock.mockReset();
  execCommandMock.mockReturnValue(true);
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  mermaidMock.render.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: writeTextMock,
    },
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommandMock,
  });
  (globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

const mockBlock: TurnBlock = {
  rootMessageId: 'msg-1',
  userMessage: {
    messageId: 'msg-1',
    sessionId: 'session-1',
    role: 'USER',
    sequence: 1,
    content: 'Hello AI',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-04-15T00:00:00Z',
    visible: true,
    requestContextId: 'req-1',
    rootMessageId: 'msg-1',
  },
  aiEvents: [],
  status: 'COMPLETED',
  isLatest: true,
};

function makeAiEvent(id: string, overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: `evt-${id}`,
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: Number(id) || 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: { content: `delta-${id}` },
    createdAt: '2026-04-15T00:00:00Z',
    ...overrides,
  } as StreamEnvelope;
}

function makeSafeCommandResultPayload(
  toolCallId: string,
  toolName: string,
  stdoutPreview: string,
): StreamEnvelope['payload'] & { readonly toolCallId: string } {
  return {
    capabilityId: 'Bash',
    toolCallId,
    toolName,
    text: stdoutPreview,
    content: stdoutPreview,
    contentType: 'PLAIN_TEXT',
    metadata: { accumulated: true },
    resultPresentationLevel: 'DETAIL',
    safeSummaryCode: 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT',
    safeSummaryArgs: { exitCode: 0 },
    safeResult: {
      kind: 'commandOutput',
      exitCode: 0,
      stdoutPreview,
      stderrPreview: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  };
}

function makeSafeFileReadResultPayload(
  toolCallId: string,
  toolName: string,
  contentPreview: string,
): StreamEnvelope['payload'] & { readonly toolCallId: string } {
  return {
    capabilityId: 'Read',
    toolCallId,
    toolName,
    text: contentPreview,
    content: contentPreview,
    contentType: 'PLAIN_TEXT',
    metadata: { accumulated: true },
    resultPresentationLevel: 'DETAIL',
    safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
    safeSummaryArgs: { filePath: 'topology.txt' },
    safeResult: {
      kind: 'fileRead',
      filePath: 'topology.txt',
      contentPreview,
      truncated: false,
    },
  };
}

function expandCollapsedProcessEntries(): void {
  const panel = screen.getByTestId('turn-process-panel');
  for (const toggle of within(panel).queryAllByTestId('turn-process-entry-toggle')) {
    if (toggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(toggle);
    }
  }
}

function padTimestampPart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatExpectedProcessTimelineTime(iso: string, nowIso: string): string {
  const date = new Date(iso);
  const now = new Date(nowIso);
  const hours = padTimestampPart(date.getHours());
  const minutes = padTimestampPart(date.getMinutes());
  const seconds = padTimestampPart(date.getSeconds());
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  if (sameDay) {
    return `${hours}:${minutes}:${seconds}`;
  }

  if (sameYear) {
    return `${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())} ${hours}:${minutes}:${seconds}`;
  }

  return `${date.getFullYear()}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())} ${hours}:${minutes}:${seconds}`;
}

describe('TurnBlock Component', () => {
  it('renders user message on the right and AI content on the left', () => {
    render(<TurnBlockComponent block={mockBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Hello AI')).toBeTruthy();
    const userBubble = screen.getByText('Hello AI').closest('[data-testid="user-bubble"]');
    expect(userBubble).toBeTruthy();
    expect((userBubble as HTMLElement | null)?.style.background).toBe('var(--color-user-bubble-bg)');
    expect((userBubble as HTMLElement | null)?.style.color).toBe('var(--color-user-bubble-text)');
  });

  it('keeps retry available and reveals edit on user hover for the latest turn', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: 'assistant reply' } })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId('btn-retry-ai')).toBeTruthy();
    expect(screen.queryByTestId('btn-edit-user')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));
    expect(screen.getByTestId('btn-retry-ai')).toBeTruthy();
    expect(screen.getByTestId('btn-edit-user')).toBeTruthy();
  });

  it('shows a fork action for assistant content with a durable anchor message id', () => {
    const onFork = vi.fn();
    const block: TurnBlock = {
      ...mockBlock,
      assistantAnchorMessageId: 'assistant-anchor-1',
      aiEvents: [
        makeAiEvent('1', {
          runId: 'run-1',
          transportHints: ['history-load'],
          payload: {
            role: 'ASSISTANT',
            content: 'persisted answer',
            messageId: 'assistant-anchor-1',
            visible: true,
          },
        }),
      ],
    };

    render(<TurnBlockComponent block={block} sessionId="session-1" onFork={onFork} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.click(getActionButton('btn-fork-ai'));

    expect(onFork).toHaveBeenCalledWith({ kind: 'message', messageId: 'assistant-anchor-1' });
  });

  it('keeps the persisted fork action visible while another request is submitting', () => {
    const onFork = vi.fn();
    const block: TurnBlock = {
      ...mockBlock,
      assistantAnchorMessageId: 'assistant-anchor-1',
      aiEvents: [
        makeAiEvent('1', {
          runId: 'run-1',
          transportHints: ['history-load'],
          payload: {
            role: 'ASSISTANT',
            content: 'persisted answer',
            messageId: 'assistant-anchor-1',
            visible: true,
          },
        }),
      ],
    };

    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        turnActionsDisabled
        onFork={onFork}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByTestId('btn-retry-ai')).toBeNull();
    fireEvent.click(getActionButton('btn-fork-ai'));

    expect(onFork).toHaveBeenCalledWith({ kind: 'message', messageId: 'assistant-anchor-1' });
  });

  it('shows a request fork action after a live assistant response completes', () => {
    const onFork = vi.fn();
    const block: TurnBlock = {
      ...mockBlock,
      rootMessageId: 'root-live-1',
      aiEvents: [
        makeAiEvent('1', {
          requestId: 'root-live-1',
          rootMessageId: 'root-live-1',
          eventType: 'LLM_CONTENT_DELTA',
          transportHints: ['SSE'],
          payload: { content: 'live answer' },
        }),
        makeAiEvent('2', {
          requestId: 'root-live-1',
          rootMessageId: 'root-live-1',
          eventType: 'REQUEST_COMPLETED',
          transportHints: ['SSE'],
          payload: { content: 'live answer' },
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} sessionId="session-1" onFork={onFork} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.click(getActionButton('btn-fork-ai'));

    expect(onFork).toHaveBeenCalledWith({ kind: 'request', requestId: 'root-live-1' });
  });

  it('keeps copy, like, dislike, and favorite in the main action area', () => {
    const block: TurnBlock = {
      ...mockBlock,
      assistantAnchorMessageId: 'assistant-anchor-1',
      aiEvents: [
        makeAiEvent('1', {
          runId: 'run-1',
          transportHints: ['history-load'],
          payload: {
            role: 'ASSISTANT',
            content: 'persisted answer',
            messageId: 'assistant-anchor-1',
            visible: true,
          },
        }),
      ],
    };

    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
        onFork={() => {}}
        onShare={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    const actionRow = screen.getByTestId('assistant-action-row');
    expect(within(actionRow).getByTestId('btn-copy-assistant')).toBeTruthy();
    expect(within(actionRow).getByTestId('annotation-like')).toBeTruthy();
    expect(within(actionRow).getByTestId('annotation-dislike')).toBeTruthy();
    expect(within(actionRow).getByTestId('annotation-favorite')).toBeTruthy();
    expect(within(actionRow).queryByTestId('btn-fork-ai')).toBeNull();
    expect(within(actionRow).queryByTestId('btn-share')).toBeNull();

    fireEvent.click(within(actionRow).getByTestId('btn-more-actions'));
    expect(screen.getByTestId('btn-fork-ai')).toBeTruthy();
    expect(screen.getByTestId('btn-share')).toBeTruthy();
  });

  it('does not show the request fork action while a live assistant response is still streaming', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: 'assistant reply' } })],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} sessionId="session-1" onFork={() => {}} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(queryActionButton('btn-fork-ai')).toBeNull();
  });

  it('merges rolling assistant text windows in the main answer', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { payload: { text: '1234567', contentType: 'PLAIN_TEXT' } }),
        makeAiEvent('2', { payload: { text: '2345678', contentType: 'PLAIN_TEXT' } }),
        makeAiEvent('3', { payload: { text: '3456789', contentType: 'PLAIN_TEXT' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('assistant-content-region').textContent).toContain('123456789');
  });

  it('preserves whitespace-only assistant token deltas', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { payload: { delta: 'hello', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' } }),
        makeAiEvent('2', { payload: { delta: ' ', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' } }),
        makeAiEvent('3', { payload: { delta: 'world', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('assistant-content-region').textContent).toContain('hello world');
  });

  it('renders a compacted 600-word assistant delta stream without losing word boundaries', () => {
    const words = Array.from({ length: 600 }, (_, index) => `word${index + 1}`);
    const aiEvents = compactLiveEnvelopes(
      words.map((word, index) =>
        makeAiEvent(`word-${index + 1}`, {
          eventId: `evt-600-delta-${index + 1}`,
          requestId: 'req-600',
          rootMessageId: 'msg-user-600',
          requestContextId: 'ctx-600',
          sequence: index + 2,
          payload: {
            role: 'ASSISTANT',
            delta: ` ${word}`,
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false, tokenIndex: index + 1 },
          },
          createdAt: new Date(Date.parse('2026-05-20T01:00:00.000Z') + index + 1).toISOString(),
        }),
      ),
      500,
    );
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents,
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const answerParagraph = container.querySelector('[data-testid="assistant-content-region"] .markdown-content p');
    const normalizedText = answerParagraph?.textContent?.replace(/\s+/g, ' ').trim();
    expect(aiEvents).toHaveLength(1);
    expect(aiEvents[0]?.payload.metadata).toMatchObject({ accumulated: true });
    expect(normalizedText?.split(' ')).toEqual(words);
  });

  it('merges live assistant token deltas in receive order even when timestamps and sequences are not token order', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('token', {
          sequence: 30,
          payload: { delta: ' token', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' },
          createdAt: '2026-04-15T00:00:03Z',
        }),
        makeAiEvent('is', {
          sequence: 10,
          payload: { delta: ' is', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' },
          createdAt: '2026-04-15T00:00:01Z',
        }),
        makeAiEvent('single', {
          sequence: 20,
          payload: { delta: ' single', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' },
          createdAt: '2026-04-15T00:00:02Z',
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('assistant-content-region').textContent).toContain('token is single');
  });

  it('merges live thinking deltas in receive order even when timestamps and sequences are not token order', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('thinking-a', {
          eventType: 'LLM_THINKING_DELTA',
          sequence: 30,
          payload: { delta: ' first', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' },
          createdAt: '2026-04-15T00:00:03Z',
        }),
        makeAiEvent('thinking-b', {
          eventType: 'LLM_THINKING_DELTA',
          sequence: 10,
          payload: { delta: ' second', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' },
          createdAt: '2026-04-15T00:00:01Z',
        }),
        makeAiEvent('thinking-c', {
          eventType: 'LLM_THINKING_DELTA',
          sequence: 20,
          payload: { delta: ' third', metadata: { accumulated: false }, contentType: 'PLAIN_TEXT' },
          createdAt: '2026-04-15T00:00:02Z',
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('turn-process-panel').textContent).toContain('first second third');
  });

  it('keeps retry hidden and edit disabled for non-latest turns', () => {
    const nonLatestBlock = { ...mockBlock, isLatest: false };
    render(<TurnBlockComponent block={nonLatestBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    expect(screen.queryByTestId('btn-retry-ai')).toBeNull();
    expect(screen.getByTestId('btn-edit-user').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('btn-copy-user')).toBeTruthy();
  });

  it('renders mixed markdown with tables, code fences, task lists, and emoji blockquotes without falling back', () => {
    const content = `# 配置文件变更报告

## 变更内容

| 序号 | 设备名称 | 变更内容 |
|:----:|:--------|:--------|
| 1 | Core-SW-01 | ACL规则调整 |
| 2 | FW-01 | 安全策略优化 |

\`\`\`diff
- old rule
+ new rule
\`\`\`

- [ ] 业务系统功能正常
- [ ] VPN连接正常

> ?? **影响范围**: 办公网络全部用户
> ?? **预计中断时间**: 5-10分钟
> ?? **回滚难度**: 低（配置已备份）`;

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content },
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.queryByText('内容渲染失败')).toBeNull();
    expect(screen.getByText('配置文件变更报告')).toBeTruthy();
    expect(screen.getByText('影响范围')).toBeTruthy();
  });

  it('renders concatenated numbered markdown items as separate list rows', () => {
    const content =
      '## 问题原因SkillTool报错 "Skill not found" 可能是因为：\n\n1. **Skill 未打包** - 根据 skill-creator指引，skill 需要通过 `package_skill.py`打包成 `.skill` 文件才能被系统识别2. **路径问题** - 当前 skill 在 workspaces目录下';

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content } })],
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const listItems = container.querySelectorAll('[data-testid="assistant-content-region"] ol li');
    expect(listItems).toHaveLength(2);
    expect(listItems[0]?.textContent).toContain('Skill 未打包');
    expect(listItems[1]?.textContent).toContain('路径问题');
  });

  it('renders task list markers as safe non-interactive checkbox states', () => {
    const content = [
      '- [x] 已完成检查',
      '- [ ] 等待人工确认',
      '',
      '<input type="text" onclick="alert(1)">',
      '<script>alert(1)</script>',
      '<span class="markdown-task-checkbox markdown-task-checkbox--checked arbitrary-app-class" role="checkbox" aria-checked="true">伪造状态</span>',
      '<span class="arbitrary-app-class" role="button">伪造按钮</span>',
    ].join('\n');
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content } })],
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const taskStates = container.querySelectorAll('[data-testid="assistant-content-region"] [role="checkbox"]');
    expect(taskStates).toHaveLength(2);
    expect(taskStates[0]?.getAttribute('aria-checked')).toBe('true');
    expect(taskStates[1]?.getAttribute('aria-checked')).toBe('false');
    expect(Array.from(taskStates).every((state) => state.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(container.querySelector('[data-testid="assistant-content-region"] input')).toBeNull();
    expect(container.querySelector('[data-testid="assistant-content-region"] script')).toBeNull();
    expect(container.querySelector('[data-testid="assistant-content-region"] .arbitrary-app-class')).toBeNull();
    expect(container.querySelector('[data-testid="assistant-content-region"] [role="button"]')).toBeNull();
    expect(screen.getByTestId('assistant-content-region').textContent).not.toContain('<input checked');
  });

  it('wraps long code block content instead of relying on horizontal scrolling', () => {
    const content = [
      '```bash',
      'python package_skill.py ../skills/user_troubleshooting/with/a/very/long/path/that/should/wrap/in/the/chat/bubble',
      '```',
    ].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content } })],
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const pre = container.querySelector('[data-testid="assistant-content-region"] pre') as HTMLPreElement | null;
    const code = container.querySelector('[data-testid="assistant-content-region"] code') as HTMLElement | null;
    expect(pre).toBeTruthy();
    expect(code?.textContent).toContain('python package_skill.py');
    expect(pre?.closest('.markdown-content')).toBeTruthy();
  });

  it('renders fenced code blocks with semantic pre and code elements', () => {
    const content = ['```ts', 'const answer = 42;', '```'].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content } })],
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const pre = container.querySelector('[data-testid="assistant-content-region"] pre') as HTMLPreElement | null;
    const code = pre?.querySelector('code');
    expect(pre).toBeTruthy();
    expect(code?.textContent).toContain('const answer = 42;');
  });

  it('renders inline code without chip background styling', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: '正文中的 `query_user_metric` 跟随正文显示' } })],
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const inlineCode = container.querySelector('[data-testid="assistant-content-region"] p code') as HTMLElement | null;
    expect(inlineCode?.style.background).toBe('');
    expect(inlineCode?.style.padding).toBe('');
    expect(inlineCode?.style.borderRadius).toBe('');
  });

  it('keeps markdown body width stable while inheriting the assistant body typography', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: '# 标题\n\n---\n\n正文 `inline`\n\n> 引用内容' } })],
      status: 'COMPLETED',
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const heading = screen.getByRole('heading', { level: 1, name: '标题' }) as HTMLElement;
    const markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content') as HTMLElement | null;
    const inlineCode = container.querySelector('[data-testid="assistant-content-region"] p code') as HTMLElement | null;
    const blockquote = container.querySelector('[data-testid="assistant-content-region"] blockquote') as HTMLElement | null;
    const horizontalRule = container.querySelector('[data-testid="assistant-content-region"] hr');
    const style = container.querySelector('[data-testid="assistant-content-region"] .markdown-content style');
    expect(markdownContent?.style.width).toBe('100%');
    expect(markdownContent?.style.maxWidth).toBe('100%');
    expect(markdownContent?.style.minWidth).toBe('0px');
    expect(markdownContent?.style.overflowWrap).toBe('anywhere');
    expect(markdownContent?.style.wordBreak).toBe('break-word');
    expect(markdownContent?.style.color).toBe('var(--color-text-primary)');
    expect(heading.style.fontSize).toBe('');
    expect(inlineCode?.style.fontSize).toBe('');
    expect(blockquote?.style.fontSize).toBe('');
    expect(horizontalRule).toBeTruthy();
    expect(style?.textContent).toContain('.markdown-content > :where(div):first-of-type > :first-child');
    expect(style?.textContent).toContain('.markdown-content > :where(div):last-of-type > :last-child');
    expect(style?.textContent).toContain('.markdown-content :where(*)');
    expect(style?.textContent).toContain('font-family: inherit');
    expect(style?.textContent).toContain('margin: 16px 0 8px');
    expect(style?.textContent).toContain('font-weight: 600');
    expect(style?.textContent).toContain('font-size: 20px');
    expect(style?.textContent).toContain('font-size: 18px');
    expect(style?.textContent).toContain('font-size: 17px');
    expect(style?.textContent).toContain('margin: 0 0 10px');
    expect(style?.textContent).toContain('padding-inline-start: 21px');
    expect(style?.textContent).toContain('margin-top: 6px');
    expect(style?.textContent).toContain('padding: 6px 0 6px 20px');
    expect(style?.textContent).toContain('.markdown-task-checkbox');
    expect(style?.textContent).toContain('.markdown-table-scroll + div > :first-child');
    expect(style?.textContent).toContain('margin: 12px 0');
    expect(style?.textContent).toContain('font-size: 14px');
    expect(style?.textContent).toContain('line-height: 20px');
    expect(style?.textContent).toContain('max-width: 100%');
    expect(style?.textContent).toContain('overflow-wrap: anywhere');
    expect(style?.textContent).toContain('border-top: 1px solid var(--color-bg-tertiary)');
    expect(style?.textContent).toContain('margin: 22px 0');
  });

  it('keeps an accumulated snapshot visible when it replaces non-prefix streaming content', async () => {
    const initialAnswer = '初始流式回答仍在显示';
    const replacementAnswer = '最终快照正文一次性替换为完整答案';
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: { content: initialAnswer, metadata: { accumulated: true } },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { rerender } = render(<TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('assistant-content-region').textContent).toContain(initialAnswer);

    rerender(
      <TurnBlockComponent
        block={{
          ...initialBlock,
          aiEvents: [
            ...initialBlock.aiEvents,
            makeAiEvent('2', {
              payload: { content: replacementAnswer, metadata: { accumulated: true } },
            }),
          ],
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    await act(async () => {});

    const assistantContent = screen.getByTestId('assistant-content-region');
    expect(assistantContent.textContent).toContain(replacementAnswer);
    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
  });

  it('does not replay a pending step output when it is confirmed as the final answer', () => {
    vi.useFakeTimers();
    const pendingContent = `骨干网络检查完成。${'链路状态正常，'.repeat(80)}结论已确认。`;
    const pendingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: {
            content: pendingContent,
            stepId: 'step-final',
            metadata: { accumulated: true },
          },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { rerender } = render(<TurnBlockComponent block={pendingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.queryByTestId('assistant-content-region')).toBeNull();
    const details = screen.getAllByTestId('turn-process-entry-detail');
    expect(details.some((d) => d.textContent?.includes('骨干网络检查完成'))).toBe(true);

    rerender(
      <TurnBlockComponent
        block={{
          ...pendingBlock,
          aiEvents: [
            ...pendingBlock.aiEvents,
            makeAiEvent('2', {
              payload: {
                content: pendingContent,
                final: true,
                metadata: { accumulated: true },
              },
            }),
          ],
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    const detailsAfterRerender = screen.queryAllByTestId('turn-process-entry-detail');
    expect(detailsAfterRerender.every((d) => !d.textContent?.includes('骨干网络检查完成'))).toBe(true);
    const answerRegion = screen.getByTestId('assistant-content-region');
    expect(answerRegion.textContent).toContain('结论已确认');
    expect(answerRegion.getAttribute('data-process-output-handoff')).toBe('true');
    expect(answerRegion.classList.contains('turn-answer--handoff-from-process')).toBe(false);
    expect(answerRegion.querySelector('.markdown-content--streaming-answer')).toBeNull();
  });

  it('adds a streaming text effect to an active assistant answer only after the stream becomes idle', () => {
    vi.useFakeTimers();
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: 'partial answer' } })],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    let markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(true);
    expect((markdownContent as HTMLElement | null)?.style.getPropertyValue('--nextagent-text-sweep-duration')).toBe('3s');
  });

  it('renders each backend-batched cumulative answer without timer-driven reveal updates', () => {
    vi.useFakeTimers();
    const initialContent = 'stream start';
    const longContent = `${initialContent}${' token'.repeat(700)}`;
    const onRender = vi.fn();
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: initialContent, metadata: { accumulated: true } } })],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container, rerender } = render(
      <Profiler id="live-answer" onRender={onRender}>
        <TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />
      </Profiler>,
    );
    const readParagraphText = () => container.querySelector('[data-testid="assistant-content-region"] .markdown-content p')?.textContent ?? '';

    expect(readParagraphText()).toBe(initialContent);

    rerender(
      <Profiler id="live-answer" onRender={onRender}>
        <TurnBlockComponent
          block={{
            ...initialBlock,
            aiEvents: [...initialBlock.aiEvents, makeAiEvent('2', { payload: { content: longContent, metadata: { accumulated: true } } })],
          }}
          onRetry={() => {}}
          onEdit={() => {}}
          onCancel={() => {}}
        />
      </Profiler>,
    );

    expect(readParagraphText()).toBe(longContent);
    const renderCountAfterStreamUpdate = onRender.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(32);
    });

    expect(readParagraphText()).toBe(longContent);
    expect(onRender).toHaveBeenCalledTimes(renderCountAfterStreamUpdate);
  });

  it('shows the idle streaming text effect after stream silence with the latest cumulative content visible', () => {
    vi.useFakeTimers();
    const initialContent = 'stream start';
    const longContent = `${initialContent}${' token'.repeat(5000)}`;
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: initialContent, metadata: { accumulated: true } } })],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container, rerender } = render(<TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    const readParagraphText = () => container.querySelector('[data-testid="assistant-content-region"] .markdown-content p')?.textContent ?? '';

    rerender(
      <TurnBlockComponent
        block={{
          ...initialBlock,
          aiEvents: [...initialBlock.aiEvents, makeAiEvent('2', { payload: { content: longContent, metadata: { accumulated: true } } })],
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    const markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(readParagraphText()).toBe(longContent);
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(true);
  });

  it('keeps the latest cumulative content visible across rapid live updates', () => {
    vi.useFakeTimers();
    const initialContent = 'stream start';
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: initialContent, metadata: { accumulated: true } } })],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container, rerender } = render(<TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    const readParagraphText = () => container.querySelector('[data-testid="assistant-content-region"] .markdown-content p')?.textContent ?? '';

    for (let index = 1; index <= 8; index += 1) {
      rerender(
        <TurnBlockComponent
          block={{
            ...initialBlock,
            aiEvents: [
              ...initialBlock.aiEvents,
              makeAiEvent(String(index + 1), {
                payload: {
                  content: `${initialContent}${' token'.repeat(index * 50)}`,
                  metadata: { accumulated: true },
                },
              }),
            ],
          }}
          onRetry={() => {}}
          onEdit={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(readParagraphText()).toBe(`${initialContent}${' token'.repeat(index * 50)}`);
    }

    expect(readParagraphText()).toBe(`${initialContent}${' token'.repeat(8 * 50)}`);
  });

  it('shows the latest cumulative answer immediately after the request reaches terminal state', () => {
    vi.useFakeTimers();
    const initialContent = 'stream start';
    const longContent = `${initialContent}${' token'.repeat(700)}`;
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: initialContent, metadata: { accumulated: true } } })],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container, rerender } = render(<TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    const readParagraphText = () => container.querySelector('[data-testid="assistant-content-region"] .markdown-content p')?.textContent ?? '';

    rerender(
      <TurnBlockComponent
        block={{
          ...initialBlock,
          status: 'COMPLETED',
          aiEvents: [
            ...initialBlock.aiEvents,
            makeAiEvent('2', { payload: { content: longContent, metadata: { accumulated: true } } }),
            makeAiEvent('3', {
              eventType: 'REQUEST_COMPLETED',
              payload: { text: 'Processing completed', metadata: { accumulated: true } },
            }),
          ],
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(readParagraphText()).toBe(longContent);
  });

  it('sets longer streaming text effect durations for medium and long assistant answers', () => {
    vi.useFakeTimers();
    const mediumContent = '这是一段中等长度的回答内容，用来确认流光动画节奏会稍微放慢，避免短促闪烁，并保持阅读时的稳定感。';
    const longContent = `${mediumContent}${mediumContent}${mediumContent}${mediumContent}`;
    const { container, rerender } = render(
      <TurnBlockComponent
        block={{
          ...mockBlock,
          aiEvents: [makeAiEvent('1', { transportHints: ['history-load'], payload: { content: mediumContent } })],
          status: 'EXECUTING',
          isLatest: true,
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    let markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content') as HTMLElement | null;
    expect(markdownContent?.style.getPropertyValue('--nextagent-text-sweep-duration')).toBe('3.5s');

    rerender(
      <TurnBlockComponent
        block={{
          ...mockBlock,
          aiEvents: [makeAiEvent('1', { transportHints: ['history-load'], payload: { content: longContent } })],
          status: 'EXECUTING',
          isLatest: true,
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content') as HTMLElement | null;
    expect(markdownContent?.style.getPropertyValue('--nextagent-text-sweep-duration')).toBe('4s');
  });

  it('targets table and code block tails with the streaming text effect', () => {
    vi.useFakeTimers();
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: {
            content: ['| 项目 | 数值 |', '|------|------|', '| 丢包 | 0% |', '', '```', 'ping 127.0.0.1', '```'].join('\n'),
          },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    const markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content--streaming-answer');
    const style = container.querySelector('[data-testid="assistant-content-region"] .markdown-content style');
    expect(markdownContent).toBeTruthy();
    expect(style?.textContent).toContain('pre:last-child code');
    expect(style?.textContent).toContain('table tbody tr:last-child td');
  });

  it('progressively renders completed streaming table rows while keeping the unfinished row plain', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          transportHints: ['history-load'],
          payload: {
            content: [
              '网络诊断结果',
              '',
              '| 编号 | 对象 | 现象 |',
              '| --- | --- | --- |',
              '| F-01 | Edge-RTR-02 | CPU 高 |',
              '| F-02 | Access-SW-02',
            ].join('\n'),
          },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const table = container.querySelector('[data-testid="assistant-content-region"] table');
    const bodyRows = container.querySelectorAll('[data-testid="assistant-content-region"] tbody tr');
    const liveTail = screen.getByTestId('assistant-live-plain-tail');
    expect(table).toBeTruthy();
    expect(bodyRows).toHaveLength(1);
    expect(table?.textContent).toContain('F-01');
    expect(table?.textContent).not.toContain('F-02');
    expect(liveTail.textContent).toContain('| F-02 | Access-SW-02');
  });

  it('does not progressively render ordinary pipe prose as a table', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          transportHints: ['history-load'],
          payload: {
            content: 'Latency A | B is ordinary prose\nStill streaming',
          },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('[data-testid="assistant-content-region"] table')).toBeNull();
    expect(screen.getByTestId('assistant-live-plain-tail').textContent).toContain('Latency A | B');
  });

  it('does not progressively render table-shaped text inside an open code fence', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          transportHints: ['history-load'],
          payload: {
            content: ['```text', '| 编号 | 对象 |', '| --- | --- |', '| F-01 | Edge-RTR-02 |'].join('\n'),
          },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('[data-testid="assistant-content-region"] table')).toBeNull();
    expect(screen.getByTestId('assistant-live-plain-tail').textContent).toContain('| 编号 | 对象 |');
  });

  it('shows the streaming text effect while keeping the thinking placeholder after an executing answer stream becomes idle', () => {
    vi.useFakeTimers();
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: '正在分析链路质量' } })],
      status: 'EXECUTING',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    let markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(false);
    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(true);
  });

  it('hides the streaming text effect when later live stream events arrive and restores it after another idle period', () => {
    vi.useFakeTimers();
    const firstEvent = makeAiEvent('1', { payload: { content: '正在分析链路质量' } });
    const { container, rerender } = render(
      <TurnBlockComponent
        block={{
          ...mockBlock,
          aiEvents: [firstEvent],
          status: 'EXECUTING',
          isLatest: true,
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    let markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(true);

    rerender(
      <TurnBlockComponent
        block={{
          ...mockBlock,
          aiEvents: [
            firstEvent,
            makeAiEvent('2', {
              eventType: 'LLM_THINKING_DELTA',
              payload: { delta: '继续检查射频指标' },
              createdAt: '2026-04-15T00:00:01Z',
            }),
          ],
          status: 'EXECUTING',
          isLatest: true,
        }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(true);
  });

  it('removes the streaming text effect after the assistant answer settles', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: 'final answer' } })],
      status: 'COMPLETED',
      isLatest: true,
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const markdownContent = container.querySelector('[data-testid="assistant-content-region"] .markdown-content');
    expect(markdownContent?.classList.contains('markdown-content--streaming-answer')).toBe(false);
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<TurnBlockComponent block={mockBlock} onRetry={() => {}} onEdit={onEdit} onCancel={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    fireEvent.click(screen.getByTestId('btn-edit-user'));
    expect(onEdit).toHaveBeenCalledWith('msg-1');
  });

  it('keeps assistant copy available and reveals user copy on hover', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: '# Heading' } })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    expect(screen.queryByTestId('btn-copy-user')).toBeNull();
    expect(screen.getByTestId('btn-copy-assistant')).toBeTruthy();
    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));
    expect(screen.getByTestId('btn-copy-user')).toBeTruthy();
    expect(screen.getByTestId('btn-copy-assistant')).toBeTruthy();
  });

  it('shows the more actions button for assistant bubbles', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: 'assistant reply' } })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const moreButton = within(screen.getByTestId('assistant-action-row')).getByTestId('btn-more-actions');
    expect(moreButton).toBeTruthy();
  });

  it('shows the user timestamp before the action icons on hover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));

    render(<TurnBlockComponent block={mockBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));

    const actionRow = screen.getByTestId('user-action-row');
    const timestamp = screen.getByTestId('user-action-timestamp');

    expect(timestamp.textContent).toBe('04-15 08:00:00');
    expect(actionRow.firstElementChild).toBe(timestamp);
    expect(within(actionRow).getByTestId('btn-copy-user')).toBeTruthy();
    expect(within(actionRow).getByTestId('btn-edit-user')).toBeTruthy();

    vi.useRealTimers();
  });

  it('hides more actions for user bubbles', () => {
    render(<TurnBlockComponent block={mockBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));

    expect(within(screen.getByTestId('user-action-row')).queryByTestId('btn-more-actions')).toBeNull();
  });

  it('shows the assistant completion time before the action icons on hover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T12:00:00Z'));

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: { content: 'assistant reply' },
          createdAt: '2026-04-15T10:24:00Z',
        }),
        makeAiEvent('2', {
          eventType: 'REQUEST_COMPLETED',
          payload: {},
          createdAt: '2026-04-15T10:26:00Z',
        }),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));

    const actionRow = screen.getByTestId('assistant-action-row');
    const timestamp = screen.getByTestId('assistant-action-timestamp');

    expect(timestamp.textContent).toBe('04-15 18:26:00');
    expect(actionRow.firstElementChild).toBe(timestamp);
    expect(within(actionRow).getByTestId('btn-copy-assistant')).toBeTruthy();
    expect(within(actionRow).getByTestId('btn-retry-ai')).toBeTruthy();

    vi.useRealTimers();
  });

  it('copies the raw message content and switches the icon state to copied', async () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: '# Heading\n\nBody' } })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    fireEvent.click(screen.getByTestId('btn-copy-user'));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('Hello AI');
      expect(screen.getByLabelText('已复制')).toBeTruthy();
    });
    fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));
    fireEvent.click(screen.getByTestId('btn-copy-assistant'));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('# Heading\n\nBody');
    });
  });

  it('falls back to a selected textarea when clipboard write is rejected', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('Clipboard write denied'));
    execCommandMock.mockImplementationOnce((command) => {
      const textArea = document.querySelector('textarea');
      expect(command).toBe('copy');
      expect(textArea?.value).toBe('# Heading\n\nBody');
      return true;
    });
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: '# Heading\n\nBody' } })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));
    fireEvent.click(screen.getByTestId('btn-copy-assistant'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('# Heading\n\nBody');
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(screen.getByLabelText('已复制')).toBeTruthy();
    });
  });

  it('shows a copy failure state when both clipboard paths fail', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('Clipboard write denied'));
    execCommandMock.mockReturnValueOnce(false);

    render(<TurnBlockComponent block={mockBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    fireEvent.click(screen.getByTestId('btn-copy-user'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('Hello AI');
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(screen.getByLabelText('复制失败')).toBeTruthy();
    });
    expect(screen.queryByLabelText('已复制')).toBeNull();
  });

  it('reveals edit and retry icons in the hovered action rows for the latest completed turn', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { payload: { content: 'assistant reply' } })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));

    expect(screen.getByTestId('user-action-row').contains(screen.getByTestId('btn-edit-user'))).toBe(true);
    expect(screen.getByTestId('assistant-action-row').contains(screen.getByTestId('btn-retry-ai'))).toBe(true);
  });

  it('renders headings when inline markdown starts immediately after a sentence', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: {
            content: 'Completed.# Heading\n\nBody copy',
          },
        }),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeTruthy();
    expect(screen.queryByText('Completed.# Heading', { exact: false })).toBeNull();
  });

  it('renders only LLM_CONTENT_DELTA events in the main answer area', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '思考中...' } }),
        makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByText('final answer')).toBeTruthy();
    expect(screen.getByTestId('assistant-content-region').textContent).toContain('final answer');
    expect(screen.getByTestId('assistant-content-region').textContent).not.toContain('思考中...');
  });

  it('excludes capability result deltas from the assistant body while preserving them in process details', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', toolName: 'networkDiagnostic', result: 'tool completed result' },
        }),
        makeAiEvent('2', {
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'tool inline delta', contentRef: 'ref-tool-1' },
        }),
        makeAiEvent('3', {
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: 'final answer' },
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByText('final answer')).toBeTruthy();
    expect(screen.queryByText('tool inline delta')).toBeNull();
    expect(screen.queryByTestId('turn-process-timeline-button')).toBeNull();

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expandCollapsedProcessEntries();

    expect(within(screen.getByTestId('assistant-content-region')).queryByText(/tool completed result/)).toBeNull();
    expect(within(screen.getByTestId('turn-process-panel')).getAllByText(/tool completed result/).length).toBeGreaterThan(0);
  });

  it.each([['SSE'], ['history-load']] as const)(
    'keeps Workflow ANSWER products in the answer region and shows a friendly persisted terminal preview for %s',
    (transportHints) => {
      const workflowPayload = {
        capabilityId: 'render-result',
        toolCallId: 'workflow:execution-1:render-result',
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        nodeExecutionId: 'render-result-attempt-1',
        toolMessageType: 'TEXT',
        metadata: { accumulated: true },
      };
      const block: TurnBlock = {
        ...mockBlock,
        aiEvents: [
          makeAiEvent('1', {
            eventType: 'TOOL_STRUCTURED_DELTA',
            payload: { ...workflowPayload, toolEventType: 'TITLE', content: '汇总诊断结论' },
          }),
          makeAiEvent('2', {
            eventType: 'TOOL_STRUCTURED_DELTA',
            payload: { ...workflowPayload, toolEventType: 'ANSWER', content: '节点完整产物' },
          }),
          makeAiEvent('3', {
            eventType: 'REQUEST_COMPLETED',
            transportHints: [...transportHints],
            payload: {
              status: 'COMPLETED',
              content: [
                '<persisted-content>',
                'Reason: size-above-inline-threshold',
                'Full content ref: CAPABILITY_RESULT:tool-results/abc123.txt',
                'Original size: 50001 chars',
                'Preview:',
                '终态预览内容',
                'File path: tool-results/abc123.txt',
                'Access: Invoke the Read tool with file_path="tool-results/abc123.txt". If the file is too large, page it with explicit offset and limit.',
                '</persisted-content>',
              ].join('\n'),
            },
          }),
        ],
      };

      render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

      const answerRegion = screen.getByTestId('assistant-content-region');
      expect(answerRegion.textContent).toContain('结果内容较长，以下展示部分内容（完整结果共 50,001 字符）。');
      expect(answerRegion.textContent).toContain('终态预览内容');
      expect(answerRegion.textContent).toContain('完整结果已保存，你可以继续提问，让我按需查看。');
      expect(answerRegion.textContent).not.toContain('<persisted-content>');
      expect(answerRegion.textContent).not.toContain('size-above-inline-threshold');
      expect(answerRegion.textContent).not.toContain('tool-results/abc123.txt');
      expect(answerRegion.textContent).not.toContain('Invoke the Read tool');
      expect(answerRegion.textContent).toContain('节点完整产物');
      fireEvent.click(screen.getByTestId('turn-process-toggle'));
      expandCollapsedProcessEntries();
      const processPanel = screen.getByTestId('turn-process-panel');
      expect(processPanel.textContent).toContain('汇总诊断结论');
      expect(processPanel.textContent).not.toContain('节点完整产物');
    },
  );

  it('does not show the full process action for historical-only turn details', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_COMPLETED',
          transportHints: ['history-load'],
          payload: {
            toolCallId: 'tool-1',
            toolName: 'networkDiagnostic',
            role: 'CAPABILITY_RESULT',
            result: '历史工具结果',
          },
        }),
        makeAiEvent('2', {
          eventType: 'LLM_CONTENT_DELTA',
          transportHints: ['history-load'],
          payload: { content: '历史最终回答', role: 'ASSISTANT' },
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('turn-process-toggle')).toBeTruthy();
    expect(screen.queryByTestId('turn-process-timeline-button')).toBeNull();
  });

  it('shows a centered transient compaction notice after the latest answer content and auto-hides it', () => {
    vi.useFakeTimers();

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'partial answer' } }),
        makeAiEvent('2', { eventType: 'CONTEXT_COMPACTED', payload: { reason: 'OUTPUT_WINDOW_LIMIT' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const notice = screen.getByTestId('assistant-compaction-notice');
    expect(notice.textContent).toBe('系统已整理较早的对话内容，以便继续处理本次任务。');
    expect((notice as HTMLElement).style.textAlign).toBe('center');

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByTestId('assistant-compaction-notice')).toBeNull();
    vi.useRealTimers();
  });

  it('keeps the compaction notice on its original three-second timer while answer content continues', () => {
    vi.useFakeTimers();

    const compactingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'partial answer' } }),
        makeAiEvent('2', { eventType: 'CONTEXT_COMPACTED', payload: { reason: 'OUTPUT_WINDOW_LIMIT' } }),
      ],
      status: 'EXECUTING',
    };
    const resumedBlock: TurnBlock = {
      ...compactingBlock,
      aiEvents: [...compactingBlock.aiEvents, makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'partial answer continued' } })],
    };

    const { rerender } = render(<TurnBlockComponent block={compactingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('assistant-compaction-notice')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(<TurnBlockComponent block={resumedBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('assistant-compaction-notice')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('assistant-compaction-notice')).toBeNull();
    vi.useRealTimers();
  });

  it('shows user-visible system events in default execution details', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'DEGRADATION_NOTICE',
          payload: { reason: 'MODEL_UNAVAILABLE', message: '已切换到备用模型继续处理' },
        }),
        makeAiEvent('2', {
          eventType: 'ATTACHMENT_ACCEPTED',
          payload: { fileName: 'report.pdf', message: '附件已接收' },
        }),
        makeAiEvent('3', {
          eventType: 'HOOK_DEGRADED',
          payload: { reason: 'timeout', message: 'hook timeout' },
        }),
        makeAiEvent('4', {
          eventType: 'CONTEXT_COMPACTED',
          payload: { reason: 'OUTPUT_WINDOW_LIMIT' },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getAllByText('本次任务有部分内容未完成')).toHaveLength(2);
    expect(screen.getAllByText('请查看执行详情和本次答复，确认未完成的内容。')).toHaveLength(2);
    expect(screen.queryByText('已切换到备用模型继续处理')).toBeNull();
    expect(screen.queryByText('附件已接收')).toBeNull();
    expect(screen.queryByText('hook timeout')).toBeNull();
    expect(screen.getByText('已整理较早的对话')).toBeTruthy();
    expect(screen.getByText('系统已整理较早的对话内容，以便继续处理本次任务。')).toBeTruthy();
    expect(within(screen.getByTestId('turn-process-panel')).queryByTestId('turn-process-entry-toggle')).toBeNull();
  });

  it('requests the full-process graph instead of opening the old timeline modal', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '先检查 IP 地址池', metadata: { accumulated: false } },
          createdAt: '2000-04-15T03:04:05Z',
        }),
        makeAiEvent('2', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '，确认使用率', metadata: { accumulated: false } },
          createdAt: '2000-04-15T03:05:05Z',
        }),
        makeAiEvent('3', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'ipPoolManager' },
          createdAt: '2000-04-15T03:06:05Z',
        }),
        makeAiEvent('4', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', result: 'IP 地址池使用率为 68%，状态良好。' },
          createdAt: '2000-04-15T03:07:05Z',
        }),
        makeAiEvent('5', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '继续核查 VLAN', metadata: { accumulated: true } },
          createdAt: '2000-04-15T03:08:05Z',
        }),
        makeAiEvent('6', {
          eventType: 'LLM_CONTENT_DELTA',
          payload: { content: '我先检查了 IP 地址池，当前使用率 68%。' },
          createdAt: '2000-04-15T03:09:05Z',
        }),
        makeAiEvent('7', {
          eventType: 'CONTEXT_COMPACTED',
          payload: { reason: 'OUTPUT_WINDOW_LIMIT' },
          createdAt: '2000-04-15T03:10:05Z',
        }),
      ],
      status: 'EXECUTING',
    };

    const onOpenFullProcess = vi.fn();
    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} onOpenFullProcess={onOpenFullProcess} />);

    expect(screen.getByText('已整理较早的对话')).toBeTruthy();
    expect(screen.getByText('完整过程')).toBeTruthy();

    const button = screen.getByTestId('turn-process-timeline-button') as HTMLButtonElement;
    fireEvent.click(button);

    expect(onOpenFullProcess).toHaveBeenCalledWith(block, button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the full-process graph entry hidden until the collapsed execution details are expanded', async () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'networkDiagnostic' },
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', text: 'step 1', metadata: { accumulated: false } },
        }),
        makeAiEvent('3', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', text: '\n\nstep 2', metadata: { accumulated: false } },
        }),
        makeAiEvent('4', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', result: '诊断完成' },
        }),
      ],
      status: 'COMPLETED',
    };

    const onOpenFullProcess = vi.fn();
    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} onOpenFullProcess={onOpenFullProcess} />);

    expect(screen.queryByTestId('turn-process-timeline-button')).toBeNull();
    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    await waitFor(() => expect(screen.getByTestId('turn-process-timeline-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('turn-process-timeline-button'));

    expect(onOpenFullProcess).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides the full-process graph entry when the portal ability switch is false', async () => {
    runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: false,
    };
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'networkDiagnostic' },
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', result: '诊断完成' },
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    await waitFor(() => expect(screen.getByTestId('turn-process-panel')).toBeTruthy());
    expect(screen.getByTestId('turn-process-summary-text')).toBeTruthy();
    expect(screen.queryByTestId('turn-process-timeline-button')).toBeNull();
  });

  it('hides the full-process graph entry when showThinkingChain is false', async () => {
    aicoConfigStore.setConfig({ showThinkingChain: false });
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'networkDiagnostic' },
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', result: '诊断完成' },
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    await waitFor(() => expect(screen.getByTestId('turn-process-panel')).toBeTruthy());
    expect(screen.getByTestId('turn-process-summary-text')).toBeTruthy();
    expect(screen.queryByTestId('turn-process-timeline-button')).toBeNull();
  });

  it('keeps the full-process graph entry available when aiEvents arrive out of order', async () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('3', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', result: '结果已生成' },
          createdAt: '2000-04-15T03:07:05Z',
        }),
        makeAiEvent('1', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '正在分析您的问题...' },
          createdAt: '2000-04-15T03:05:05Z',
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'logAnalyzer' },
          createdAt: '2000-04-15T03:06:05Z',
        }),
      ],
      status: 'COMPLETED',
    };

    const onOpenFullProcess = vi.fn();
    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} onOpenFullProcess={onOpenFullProcess} />);

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    await waitFor(() => expect(screen.getByTestId('turn-process-timeline-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('turn-process-timeline-button'));

    expect(onOpenFullProcess).toHaveBeenCalledWith(block, screen.getByTestId('turn-process-timeline-button'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps only the latest accumulated thinking summary in execution details', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'first thinking', metadata: { accumulated: true } },
        }),
        makeAiEvent('2', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'latest thinking', metadata: { accumulated: true } },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByText('思考中')).toBeTruthy();
    expect(screen.getByText('latest thinking')).toBeTruthy();
    expect(screen.queryByText('first thinking')).toBeNull();
  });

  it('appends non-accumulated thinking chunks into one current-thinking entry', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'network ', metadata: { accumulated: false } },
        }),
        makeAiEvent('2', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'analysis', metadata: { accumulated: false } },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByText('思考中')).toBeTruthy();
    expect(screen.getByText('network analysis')).toBeTruthy();
    expect(screen.getAllByText('思考中')).toHaveLength(1);
  });

  it('keeps separated thinking segments visible in execution details', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '阶段一：解析问题', metadata: { accumulated: true } },
        }),
        makeAiEvent('2', {
          eventType: 'HOOK_DEGRADED',
          payload: { message: 'Hook 执行超时，已降级继续处理' },
        }),
        makeAiEvent('3', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '阶段二：继续组织回复', metadata: { accumulated: true } },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    expandCollapsedProcessEntries();

    expect(screen.getAllByText('思考')).toHaveLength(1);
    expect(screen.getAllByText('思考中')).toHaveLength(1);
    expect(screen.getByText('阶段一：解析问题')).toBeTruthy();
    expect(screen.getByText('本次任务有部分内容未完成')).toBeTruthy();
    expect(screen.queryByText('Hook 执行超时，已降级继续处理')).toBeNull();
    expect(screen.getByText('阶段二：继续组织回复')).toBeTruthy();
  });

  it('does not expose unrecognized ordinary capability result text', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'networkDiagnostic' },
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', text: 'step 1' },
        }),
        makeAiEvent('3', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', text: 'step 2' },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByText('networkDiagnostic · 已返回')).toBeTruthy();
    expect(screen.queryByText('工具输出 · step 2')).toBeNull();
    expect(screen.queryByText('工具输出 · step 1')).toBeNull();
  });

  it('shows the latest trusted accumulated capability result snapshot', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-1', 'networkDiagnostic', 'step 1'),
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-1', 'networkDiagnostic', 'step 2'),
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const panelText = screen.getByTestId('turn-process-panel').textContent ?? '';
    expect(panelText).toContain('输出:\nstep 2');
    expect(panelText).not.toContain('step 1');
  });

  it('labels model tool argument deltas as pending tool calls instead of ordinary capability output', () => {
    const skillArgs = '{"skill_id":"network-diagnosis"}';
    const commandArgs = '{"command":"dir classpath:skills/bundled\\\\network-diagnosis\\\\"}';
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventId: 'llm-stream-ctx-1-tool-delta-2',
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            requestContextId: 'ctx-1',
            toolCallId: 'call-function-1',
            toolCallIndex: 0,
            toolName: 'SkillTool',
            delta: '',
          },
        }),
        makeAiEvent('2', {
          eventId: 'llm-stream-ctx-1-tool-delta-3',
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            requestContextId: 'ctx-1',
            toolCallId: '',
            toolCallIndex: 0,
            toolName: '',
            delta: skillArgs,
          },
        }),
        makeAiEvent('3', {
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            requestContextId: 'ctx-1',
            complete: true,
            finishReason: 'tool_calls',
          },
        }),
        makeAiEvent('4', {
          eventId: 'llm-stream-ctx-1-tool-delta-6',
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            requestContextId: 'ctx-1',
            toolCallId: 'call-function-2',
            toolCallIndex: 0,
            toolName: 'powershell',
            delta: '',
          },
        }),
        makeAiEvent('5', {
          eventId: 'llm-stream-ctx-1-tool-delta-7',
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            requestContextId: 'ctx-1',
            toolCallId: '',
            toolCallIndex: 0,
            toolName: '',
            delta: commandArgs,
          },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.queryByText('未知工具')).toBeNull();
    expect(screen.queryByText(`工具输出 · ${skillArgs}`)).toBeNull();
    expect(screen.getAllByText('准备调用工具')).toHaveLength(2);
    expect(screen.getByText(skillArgs)).toBeTruthy();
    expect(screen.getByText(commandArgs)).toBeTruthy();
  });

  it('shows NextAgent thinking state before answer deltas arrive', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '思考中...' } })],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
    expect(screen.getByText('NextAgent正在执行中...')).toBeTruthy();
  });

  it('renders the executing indicator inside the process summary before answer content appears', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    const gif = screen.getByTestId('turn-process-executing-gif');
    const summary = screen.getByTestId('turn-process-summary');

    expect(summary.contains(gif)).toBe(true);
  });

  it('renders process events in a collapsible run-details section', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
        makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.getByTestId('turn-process-summary').textContent).toContain('NextAgent正在执行中');
    expect(screen.queryByText('查看运行详情')).toBeNull();
    expect(screen.queryByText('隐藏运行详情')).toBeNull();
    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    expect(screen.queryByText('正在构建回复内容...')).toBeNull();
    expect(screen.getByText('topologyDiscovery · 执行中')).toBeTruthy();
    expect(screen.getAllByTestId('turn-process-entry-toggle').every((entryToggle) => entryToggle.getAttribute('aria-expanded') === 'false')).toBe(
      true,
    );

    fireEvent.click(screen.getAllByTestId('turn-process-entry-toggle')[0]!);
    expect(screen.getByText('正在构建回复内容...')).toBeTruthy();

    const toggle = screen.getByTestId('turn-process-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('adds an idle sweep only to the latest expanded process detail while the stream is silent', () => {
    vi.useFakeTimers();
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeFileReadResultPayload('tool-1', 'topologyDiscovery', '正在扫描拓扑'),
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };
    const resumedBlock: TurnBlock = {
      ...initialBlock,
      aiEvents: [
        ...initialBlock.aiEvents,
        makeAiEvent('3', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: '继续分析链路指标' },
        }),
      ],
    };

    const { container, rerender } = render(
      <TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    expect(screen.queryByTestId('turn-process-idle-sweep')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    const sweptDetail = screen.getByTestId('turn-process-idle-sweep');
    expect(sweptDetail.textContent).toContain('已读取 topology.txt，内容已返回。');
    expect(container.querySelectorAll('.turn-process-detail--idle-sweep')).toHaveLength(1);
    expect(screen.getByTestId('turn-process-summary-text').classList.contains('turn-process-detail--idle-sweep')).toBe(false);

    rerender(<TurnBlockComponent block={resumedBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.queryByTestId('turn-process-idle-sweep')).toBeNull();
  });

  it('keeps a superseded process detail collapsed while answer content continues', () => {
    vi.useFakeTimers();
    const initialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          sequence: 1,
          payload: makeSafeFileReadResultPayload('tool-1', 'topologyDiscovery', '正在扫描拓扑'),
        }),
        makeAiEvent('2', {
          eventType: 'LLM_CONTENT_DELTA',
          sequence: 2,
          payload: { content: 'partial answer', metadata: { accumulated: true } },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };
    const answerContinuesBlock: TurnBlock = {
      ...initialBlock,
      aiEvents: [
        ...initialBlock.aiEvents,
        makeAiEvent('3', {
          eventType: 'LLM_CONTENT_DELTA',
          sequence: 3,
          payload: { content: 'partial answer continued', metadata: { accumulated: true } },
        }),
      ],
    };

    const { rerender } = render(
      <TurnBlockComponent block={initialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByTestId('turn-process-idle-sweep')).toBeNull();

    rerender(
      <TurnBlockComponent block={answerContinuesBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.queryByTestId('turn-process-idle-sweep')).toBeNull();
    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('does not sweep an older process detail after the latest process entry has completed', () => {
    vi.useFakeTimers();
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery', result: '拓扑扫描完成' },
        }),
      ],
      status: 'EXECUTING',
      isLatest: true,
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.queryByTestId('turn-process-idle-sweep')).toBeNull();
  });

  it('shows the execution-details summary once answer content appears', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
        makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.getByTestId('turn-process-summary').textContent).toContain('NextAgent正在执行中');
  });

  it('keeps the execution-details summary focused on status while executing', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
        makeAiEvent('3', { eventType: 'CAPABILITY_RESULT_DELTA', payload: { toolCallId: 'tool-1', progress: 'step 1' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    const summaryText = screen.getByTestId('turn-process-summary-text').textContent;
    expect(summaryText).toBe('NextAgent正在执行中...');
    expect(summaryText).not.toContain('topologyDiscovery');
    expect(summaryText).not.toContain('+');
  });

  it('keeps the execution-details summary focused on status after completion', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('0', { eventType: 'LLM_THINKING_DELTA', payload: { content: 'thinking' } }),
        makeAiEvent('1', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: makeSafeCommandResultPayload('tool-1', 'topologyDiscovery', 'done'),
        }),
        makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    const summaryText = screen.getByTestId('turn-process-summary-text').textContent;
    expect(summaryText).toBe('执行详情 · 已完成');
    expect(summaryText).not.toContain('topologyDiscovery');
    expect(summaryText).not.toContain('+');
    expect(screen.queryByTestId('turn-process-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expandCollapsedProcessEntries();

    expect(screen.getByText('思考')).toBeTruthy();
    expect(screen.getByText('Bash · 已完成')).toBeTruthy();
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('输出:\ndone');
  });

  it('keeps settled thinking available after a later turn becomes latest', () => {
    const settledBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'LLM_THINKING_DELTA',
          payload: { content: 'retained settled thinking' },
        }),
        makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'COMPLETED',
      isLatest: true,
    };

    const { rerender } = render(
      <TurnBlockComponent block={settledBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />,
    );

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expandCollapsedProcessEntries();
    expect(screen.getByText('思考')).toBeTruthy();
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('retained settled thinking');

    rerender(
      <TurnBlockComponent
        block={{ ...settledBlock, isLatest: false }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={false}
      />,
    );

    expect(screen.getByTestId('turn-process-toggle')).toBeTruthy();
    expect(screen.getByText('思考')).toBeTruthy();
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('retained settled thinking');
  });

  it('merges thinking windows but hides unrecognized ordinary capability text', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { text: '1234567' } }),
        makeAiEvent('2', { eventType: 'LLM_THINKING_DELTA', payload: { text: '2345678' } }),
        makeAiEvent('3', { eventType: 'LLM_THINKING_DELTA', payload: { text: '3456789' } }),
        makeAiEvent('4', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', toolName: 'diagnose', text: 'abcdefg' },
        }),
        makeAiEvent('5', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', toolName: 'diagnose', text: 'bcdefgh' },
        }),
        makeAiEvent('6', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', toolName: 'diagnose', text: 'cdefghi' },
        }),
        makeAiEvent('7', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expandCollapsedProcessEntries();

    const panelText = screen.getByTestId('turn-process-panel').textContent ?? '';
    expect(panelText).toContain('123456789');
    expect(panelText).not.toContain('abcdefghi');
  });

  it('does not regress completed tools back to in-progress when later progress events arrive', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('0', { eventType: 'LLM_THINKING_DELTA', payload: { content: 'organizing response' } }),
        makeAiEvent('1', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: makeSafeCommandResultPayload('tool-1', 'ipPoolManager', 'IP 地址池使用率为 68%，状态良好。'),
        }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: { toolCallId: 'tool-1', progress: '正在整理输出内容...' },
        }),
        makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-process-summary-text').textContent).toBe('执行详情 · 已完成');

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expandCollapsedProcessEntries();

    expect(screen.getByText('思考')).toBeTruthy();
    expect(screen.getByText('Bash · 已完成')).toBeTruthy();
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('输出:\nIP 地址池使用率为 68%，状态良好。');
    expect(screen.queryByText('执行中 · 正在整理输出内容...')).toBeNull();
  });

  it('keeps repeated same-tool invocations as stable summary rows while streaming', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('102', {
          eventType: 'REQUEST_ACCEPTED',
          payload: { text: '已开始处理本次请求', contentType: 'PLAIN_TEXT', metadata: { accumulated: true } },
        }),
        makeAiEvent('120', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'logAnalyzer', text: 'logAnalyzer started' },
        }),
        makeAiEvent('121', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-1', 'logAnalyzer', '上一轮分析输出'),
        }),
        makeAiEvent('139', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', toolName: 'logAnalyzer', text: 'logAnalyzer completed' },
        }),
        makeAiEvent('140', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-2', toolName: 'logAnalyzer', text: 'logAnalyzer started' },
        }),
        makeAiEvent('141', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-2', 'logAnalyzer', '开始分析日志内容'),
        }),
        makeAiEvent('142', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-2', 'logAnalyzer', '开始分析日志内容\n\n1. 汇总 24 小时内的告警日志'),
        }),
        makeAiEvent('155', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-2', toolName: 'logAnalyzer', text: 'logAnalyzer completed' },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    const panel = screen.getByTestId('turn-process-panel');
    expandCollapsedProcessEntries();
    expect(within(panel).getAllByText('logAnalyzer · 已完成')).toHaveLength(2);
    expect(panel.textContent).toContain('输出:\n上一轮分析输出');
    expect(panel.textContent).toContain('输出:\n开始分析日志内容');
    expect(panel.textContent).toContain('1. 汇总 24 小时内的告警日志');
    expect(panel.textContent).not.toContain('logAnalyzer completed');
    expect(within(panel).queryByText('运行事件')).toBeNull();
    expect(within(panel).queryByText('已开始处理本次请求')).toBeNull();
  });

  it('does not summarize or expose unrecognized markdown tool output', () => {
    const longMarkdown = `# Capability Result: network-diagnostic-suite

## Device Health Summary

| 编号 | 对象 | 现象 | 影响 | 建议 |
|:--|:--|:--|:--|:--|
| F-01 | Edge-RTR-02 | CPU 持续高于 85%，峰值达到 91% | 可能导致控制面延迟 | 先确认高 CPU 进程 |

## Alarm Aggregation

The diagnostic output includes enough detail to make this result too dense for the default execution detail view.`;
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            toolCallId: 'tool-1',
            toolName: 'networkDiagnostic',
            contentType: 'MARKDOWN',
            text: longMarkdown,
          },
        }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    const panel = screen.getByTestId('turn-process-panel');
    expect(panel.textContent).not.toContain('设备健康、告警聚合和 KPI 趋势诊断已生成。');
    expect(panel.textContent).not.toContain('CPU 持续高于 85%');
    expect(screen.queryByTestId('turn-process-entry-toggle')).toBeNull();
  });

  it('keeps execution-detail row order anchored when a tool summary receives later completion events', () => {
    const partialBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '准备检查设备' } }),
        makeAiEvent('2', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-1', 'inventoryLookup', '正在查询设备清单'),
        }),
        makeAiEvent('3', { eventType: 'HOOK_DEGRADED', payload: { message: 'Hook 执行超时，已降级继续处理' } }),
        makeAiEvent('4', { eventType: 'CONTEXT_COMPACTED', payload: { message: '已压缩较早上下文以继续处理' } }),
      ],
      status: 'EXECUTING',
    };
    const completedToolBlock: TurnBlock = {
      ...partialBlock,
      aiEvents: [
        ...partialBlock.aiEvents,
        makeAiEvent('5', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: makeSafeCommandResultPayload('tool-1', 'inventoryLookup', '设备清单查询完成'),
        }),
      ],
    };

    const { rerender } = render(
      <TurnBlockComponent block={partialBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    const readRows = () => Array.from(screen.getByTestId('turn-process-panel').children).map((row) => row.textContent ?? '');
    expect(readRows()).toEqual([
      expect.stringContaining('思考'),
      expect.stringContaining('Bash'),
      expect.stringContaining('本次任务有部分内容未完成'),
      expect.stringContaining('已整理较早的对话'),
    ]);

    rerender(
      <TurnBlockComponent block={completedToolBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    expect(readRows()).toEqual([
      expect.stringContaining('思考'),
      expect.stringContaining('Bash'),
      expect.stringContaining('本次任务有部分内容未完成'),
      expect.stringContaining('已整理较早的对话'),
    ]);
    expandCollapsedProcessEntries();
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('输出:\n设备清单查询完成');
  });

  it('opens the full-process graph entry for repeated same-tool invocations without changing inline details', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('120', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-1', toolName: 'logAnalyzer', text: 'logAnalyzer started' },
        }),
        makeAiEvent('121', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-1', 'logAnalyzer', '上一轮分析输出'),
        }),
        makeAiEvent('139', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-1', toolName: 'logAnalyzer', text: 'logAnalyzer completed' },
        }),
        makeAiEvent('140', {
          eventType: 'CAPABILITY_STARTED',
          payload: { toolCallId: 'tool-2', toolName: 'logAnalyzer', text: 'logAnalyzer started' },
        }),
        makeAiEvent('141', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-2', 'logAnalyzer', '开始分析日志内容'),
        }),
        makeAiEvent('142', {
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: makeSafeCommandResultPayload('tool-2', 'logAnalyzer', '开始分析日志内容\n\n1. 汇总 24 小时内的告警日志'),
        }),
        makeAiEvent('155', {
          eventType: 'CAPABILITY_COMPLETED',
          payload: { toolCallId: 'tool-2', toolName: 'logAnalyzer', text: 'logAnalyzer completed' },
        }),
      ],
      status: 'EXECUTING',
    };

    const onOpenFullProcess = vi.fn();
    render(
      <TurnBlockComponent
        block={block}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={true}
        onOpenFullProcess={onOpenFullProcess}
      />,
    );

    fireEvent.click(screen.getByTestId('turn-process-timeline-button'));

    expect(onOpenFullProcess).toHaveBeenCalledWith(block, screen.getByTestId('turn-process-timeline-button'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('logAnalyzer · 已完成').length).toBeGreaterThan(0);
    expandCollapsedProcessEntries();
    const panelText = screen.getByTestId('turn-process-panel').textContent ?? '';
    expect(panelText).toContain('上一轮分析输出');
    expect(panelText).toMatch(/开始分析日志内容\s+1. 汇总 24 小时内的告警日志/);
  });

  it('settles the execution-details summary when the turn is completed even if a tool entry has no final marker', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: 'checking devices' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_RESULT_DELTA', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery', text: 'step 2' } }),
        makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.getByTestId('turn-process-summary-text').textContent).toBe('执行详情 · 已完成');
    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
  });

  it('hides the execution-details summary when a turn has only answer content', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { eventType: 'LLM_CONTENT_DELTA', payload: { content: '只有正文' } })],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.queryByTestId('turn-process-summary')).toBeNull();
    expect(screen.queryByTestId('turn-process-toggle')).toBeNull();
  });

  it('shows the completed execution summary when refreshed history only has the terminal event', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          eventType: 'REQUEST_COMPLETED',
          payload: { content: 'final answer' },
          transportHints: ['history-load'],
        }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-process-summary-text').textContent).toBe('执行详情 · 已完成');
    expect(screen.queryByTestId('turn-process-toggle')).toBeNull();
    expect(screen.getByTestId('assistant-content-region').textContent).toContain('final answer');
  });

  it('keeps the summary text as the left anchor and only toggles the arrow', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
        makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('NextAgent正在执行中');
    expect(screen.queryByText('查看运行详情')).toBeNull();
    expect(screen.queryByText('隐藏运行详情')).toBeNull();
  });

  it('renders the expanded process details panel without changing the summary text', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
        makeAiEvent('3', { eventType: 'CAPABILITY_RESULT_DELTA', payload: { toolCallId: 'tool-1', progress: '步骤一' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    const summaryText = screen.getByTestId('turn-process-summary-text');
    const panel = screen.getByTestId('turn-process-panel');
    expect(summaryText.textContent).toBeTruthy();
    expect((panel as HTMLElement).style.maxHeight).toBe('');
    expect((panel as HTMLElement).style.overflowY).toBe('');
    expect((panel as HTMLElement).style.borderRadius).toBe('');
    expect(screen.getByTestId('turn-process-summary').parentElement?.style.marginBottom).toBe('12px');
    expect(panel.parentElement?.style.paddingTop).toBe('12px');

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(screen.getByTestId('turn-process-summary-text').textContent).toBe(summaryText.textContent);
  });

  it('animates the execution-details panel when it expands and collapses', () => {
    vi.useFakeTimers();
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    let pendingFrame: FrameRequestCallback | null = null;

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pendingFrame = null;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'turn-process-panel') {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 126,
          right: 200,
          width: 200,
          height: 126,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    try {
      const block: TurnBlock = {
        ...mockBlock,
        aiEvents: [
          makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
          makeAiEvent('2', { eventType: 'CAPABILITY_COMPLETED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery', result: 'done' } }),
          makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
        ],
        status: 'COMPLETED',
      };

      render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

      expect(screen.queryByTestId('turn-process-panel')).toBeNull();

      fireEvent.click(screen.getByTestId('turn-process-toggle'));
      const panel = screen.getByTestId('turn-process-panel');
      const panelWrapper = panel.parentElement as HTMLElement;
      expect(panelWrapper.style.height).toBe('0px');
      expect(panelWrapper.style.opacity).toBe('0');
      expect(panelWrapper.style.overflow).toBe('hidden');
      expect(panelWrapper.style.transition).toContain('height');
      expect(panelWrapper.style.transition).toContain('padding-top');

      act(() => {
        pendingFrame?.(0);
      });

      expect(panelWrapper.style.height).toBe('138px');
      expect(panelWrapper.style.opacity).toBe('1');
      expect(panelWrapper.style.paddingTop).toBe('12px');
      expect(panelWrapper.style.overflow).toBe('hidden');

      fireEvent.click(screen.getByTestId('turn-process-toggle'));
      expect(panelWrapper.style.height).toBe('138px');

      act(() => {
        pendingFrame?.(0);
      });

      expect(panelWrapper.style.height).toBe('0px');
      expect(panelWrapper.style.opacity).toBe('0');
      expect(panelWrapper.style.paddingTop).toBe('0px');
      expect(panelWrapper.style.overflow).toBe('hidden');

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(screen.queryByTestId('turn-process-panel')).toBeNull();
    } finally {
      vi.useRealTimers();
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
      vi.restoreAllMocks();
    }
  });

  it('allocates enough wrapper height to preserve short process content', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'turn-process-panel') {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 126,
          right: 200,
          width: 200,
          height: 126,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    const panel = screen.getByTestId('turn-process-panel');
    const panelWrapper = panel.parentElement as HTMLElement | null;
    expect(panelWrapper?.style.height).toBe('auto');
    expect(panelWrapper?.style.paddingTop).toBe('12px');
    expect((panel as HTMLElement).style.marginTop).toBe('');
    rectSpy.mockRestore();
  });

  it('lets wheel events bubble to outer containers when the expanded process panel no longer owns scrolling', () => {
    const outerWheel = vi.fn();
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
        makeAiEvent('3', { eventType: 'CAPABILITY_RESULT_DELTA', payload: { toolCallId: 'tool-1', progress: '步骤一' } }),
      ],
      status: 'EXECUTING',
    };

    render(
      <div onWheel={outerWheel}>
        <TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />
      </div>,
    );

    const panel = screen.getByTestId('turn-process-panel') as HTMLDivElement;
    fireEvent.wheel(panel, { deltaY: 20 });

    expect(outerWheel).toHaveBeenCalledTimes(1);
  });

  it('keeps process details expanded before answer content appears', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
      ],
      status: 'EXECUTING',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    expect(screen.getByText('正在构建回复内容...')).toBeTruthy();
  });

  it('re-expands auto-collapsed process details when the turn returns to executing before any answer content arrives', () => {
    const misclassifiedBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_COMPLETED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery', result: 'done' } }),
      ],
      status: 'COMPLETED',
    };
    const executingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
      ],
      status: 'EXECUTING',
    };

    const { rerender } = render(
      <TurnBlockComponent block={misclassifiedBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    expect(screen.queryByTestId('turn-process-panel')).toBeNull();

    rerender(<TurnBlockComponent block={executingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    expect(screen.getByTestId('turn-process-summary-text').textContent).toBe('NextAgent正在执行中...');
  });

  it('keeps process details expanded when answer content appears but execution is still in progress', () => {
    vi.useFakeTimers();

    const streamingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } })],
      status: 'EXECUTING',
    };
    const answeredBlock: TurnBlock = {
      ...streamingBlock,
      aiEvents: [...streamingBlock.aiEvents, makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } })],
    };

    const onRequestScrollToBottom = vi.fn();
    const { rerender } = render(
      <TurnBlockComponent
        block={streamingBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={true}
        onRequestScrollToBottom={onRequestScrollToBottom}
      />,
    );

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();

    rerender(
      <TurnBlockComponent
        block={answeredBlock}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={true}
        onRequestScrollToBottom={onRequestScrollToBottom}
      />,
    );

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    onRequestScrollToBottom.mockClear();

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    expect(onRequestScrollToBottom).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not auto-collapse process details when the user is reading away from the bottom', () => {
    const streamingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } })],
      status: 'EXECUTING',
    };
    const answeredBlock: TurnBlock = {
      ...streamingBlock,
      aiEvents: [...streamingBlock.aiEvents, makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } })],
    };

    const { rerender } = render(
      <TurnBlockComponent block={streamingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />,
    );

    rerender(<TurnBlockComponent block={answeredBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
  });

  it('keeps system-opened process details visible after terminal while the user is reading history', () => {
    vi.useFakeTimers();

    const streamingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } })],
      status: 'EXECUTING',
    };
    const answeredBlock: TurnBlock = {
      ...streamingBlock,
      aiEvents: [...streamingBlock.aiEvents, makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } })],
      status: 'COMPLETED',
    };

    const { rerender } = render(
      <TurnBlockComponent block={streamingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />,
    );

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();

    rerender(<TurnBlockComponent block={answeredBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    vi.useRealTimers();
  });

  it('cancels a pending auto-collapse if the user leaves bottom-following before the delay elapses', () => {
    vi.useFakeTimers();

    const streamingBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } })],
      status: 'EXECUTING',
    };
    const answeredBlock: TurnBlock = {
      ...streamingBlock,
      aiEvents: [...streamingBlock.aiEvents, makeAiEvent('2', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } })],
    };

    const { rerender } = render(
      <TurnBlockComponent block={streamingBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    rerender(<TurnBlockComponent block={answeredBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />);

    rerender(<TurnBlockComponent block={answeredBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
    vi.useRealTimers();
  });

  it('does not auto-collapse again after the user manually expands process details', () => {
    const firstAnsweredBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_COMPLETED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery', result: 'done' } }),
        makeAiEvent('3', { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'final answer' } }),
      ],
      status: 'COMPLETED',
    };
    const laterAnsweredBlock: TurnBlock = {
      ...firstAnsweredBlock,
      aiEvents: [...firstAnsweredBlock.aiEvents, makeAiEvent('4', { eventType: 'LLM_CONTENT_DELTA', payload: { content: '最终回复 + 更多内容' } })],
    };

    const { rerender } = render(
      <TurnBlockComponent block={firstAnsweredBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    expect(screen.queryByTestId('turn-process-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();

    rerender(
      <TurnBlockComponent block={laterAnsweredBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={true} />,
    );

    expect(screen.getByTestId('turn-process-panel')).toBeTruthy();
  });

  it('requests anchor compensation when the user toggles process details away from the bottom', () => {
    const onRequestAnchorCompensation = vi.fn();
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    let summaryCallCount = 0;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'turn-process-summary') {
        summaryCallCount += 1;
        return {
          x: 0,
          y: summaryCallCount === 1 ? 120 : 84,
          top: summaryCallCount === 1 ? 120 : 84,
          left: 0,
          bottom: summaryCallCount === 1 ? 140 : 104,
          right: 200,
          width: 200,
          height: 20,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { eventType: 'LLM_THINKING_DELTA', payload: { content: '正在构建回复内容...' } }),
        makeAiEvent('2', { eventType: 'CAPABILITY_STARTED', payload: { toolCallId: 'tool-1', toolName: 'topologyDiscovery' } }),
      ],
      status: 'EXECUTING',
    };

    render(
      <TurnBlockComponent
        block={block}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        isViewportFollowingBottom={false}
        onRequestAnchorCompensation={onRequestAnchorCompensation}
      />,
    );

    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(onRequestAnchorCompensation).toHaveBeenCalledWith(-36);
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('requests scroll-to-bottom after mermaid diagrams finish rendering while following the bottom', async () => {
    const onRequestScrollToBottom = vi.fn();
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: {
            content: '```mermaid\ngraph TD;\nA-->B;\n```',
          },
        }),
      ],
      status: 'COMPLETED',
    };

    render(
      <TurnBlockComponent
        block={block}
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

  it('waits for a closing mermaid fence before invoking mermaid rendering', async () => {
    const incompleteBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: {
            content: '```mermaid\ngraph TD;\nA-->B;',
          },
        }),
      ],
      status: 'EXECUTING',
    };

    const { rerender } = render(<TurnBlockComponent block={incompleteBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mermaidMock.render).not.toHaveBeenCalled();

    const completedBlock: TurnBlock = {
      ...incompleteBlock,
      aiEvents: [
        makeAiEvent('1', {
          payload: {
            content: '```mermaid\ngraph TD;\nA-->B;\n```',
          },
        }),
      ],
      status: 'COMPLETED',
    };

    rerender(<TurnBlockComponent block={completedBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    });
  });

  it('does not duplicate answer content when later deltas repeat or supersede earlier content', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        makeAiEvent('1', { payload: { content: 'first' } }),
        makeAiEvent('2', { payload: { content: 'second' } }),
        makeAiEvent('3', { payload: { content: 'second' } }),
        makeAiEvent('4', { payload: { content: '绗竴娈电浜屾' } }),
      ],
      status: 'COMPLETED',
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(screen.getAllByText(/绗竴娈电浜屾/)).toHaveLength(1);
  });
});
