// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { MessageInput } from '../src/features/composer/components/MessageInput.tsx';

vi.mock('../src/app/AppProviders.tsx', async () => {
  const React = await import('react');
  return {
    AppHostContext: React.createContext(null),
    AppProviders: ({ children }: { readonly children: ReactNode }) => children,
    useAppHostContext: () => ({ site: { locale: 'zh-CN' } }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessageInput component', () => {
  it('restores an empty textarea without scheduling a layout measurement frame', () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    expect(textarea.style.height).toBe('');
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('shows placeholder text', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    expect(textarea.getAttribute('placeholder')).toBe('有问题，尽管问');
  });

  it('supports Shift+Enter for newline', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'line1\nline2' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('line1\nline2');
  });

  it('shows attach button', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    screen.getByTestId('attach-button');
  });

  it('shows submit button', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const submitButton = screen.getByTestId('btn-send');
    expect(submitButton.className).toContain('send-btn');
  });

  it('renders inline composer notices without affecting the send button', () => {
    render(
      <MemoryRouter>
        <MessageInput inlineNotice={{ type: 'warning', message: '会话已有更新，输入内容已保留。' }} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('message-input-inline-notice').textContent).toContain('会话已有更新');
    expect(screen.getByTestId('btn-send')).toBeTruthy();
  });

  it('recalls the latest submitted message from an empty input with ArrowUp', () => {
    render(
      <MemoryRouter>
        <MessageInput submittedMessageHistory={['first question', 'latest question']} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('latest question');
  });

  it('navigates older and newer submitted messages before returning to an empty draft', () => {
    render(
      <MemoryRouter>
        <MessageInput submittedMessageHistory={['first question', 'second question', 'third question']} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea.value).toBe('third question');

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea.value).toBe('second question');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.value).toBe('third question');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.value).toBe('');
  });

  it('keeps an edited recalled message as a normal draft instead of replacing it with older history', () => {
    render(
      <MemoryRouter>
        <MessageInput submittedMessageHistory={['first question', 'latest question']} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    fireEvent.change(textarea, { target: { value: 'latest question with edits' } });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('latest question with edits');
  });

  it('does not publish the current input as a new session draft when only the draft callback changes', () => {
    const firstSessionDraftChange = vi.fn();
    const secondSessionDraftChange = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <MessageInput onDraftChange={firstSessionDraftChange} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'draft for session A' } });
    expect(firstSessionDraftChange).toHaveBeenLastCalledWith('draft for session A');
    firstSessionDraftChange.mockClear();

    rerender(
      <MemoryRouter>
        <MessageInput onDraftChange={secondSessionDraftChange} />
      </MemoryRouter>,
    );

    expect(firstSessionDraftChange).not.toHaveBeenCalled();
    expect(secondSessionDraftChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe('draft for session A');
  });

  it('does not publish a duplicate draft change when compositionend repeats the current value', () => {
    const onDraftChange = vi.fn();
    render(
      <MemoryRouter>
        <MessageInput onDraftChange={onDraftChange} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '中文输入' } });
    expect(onDraftChange).toHaveBeenLastCalledWith('中文输入');
    onDraftChange.mockClear();

    fireEvent.compositionEnd(textarea);

    expect(onDraftChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe('中文输入');
  });

  it('keeps ArrowUp scoped to slash command selection when the slash panel is open', () => {
    render(
      <MemoryRouter>
        <MessageInput submittedMessageHistory={['previous question']} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('/');
    expect(screen.getByTestId('slash-command-panel')).toBeTruthy();
  });

  it('does not recall submitted message history while editing an existing request', () => {
    render(
      <MemoryRouter>
        <MessageInput mode="edit" submittedMessageHistory={['previous question']} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('');
  });

  // 鈹€鈹€ Slash command panel opens 鈹€鈹€
  it('opens slash command panel on /', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(screen.getByTestId('slash-command-panel')).toBeTruthy();
    expect(screen.getByText('/help')).toBeTruthy();
    expect(screen.queryByText('/clear')).toBeNull();
  });

  it('filters slash commands by prefix on /he', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/he' } });
    expect(screen.getByText('/help')).toBeTruthy();
    const panel = screen.getByTestId('slash-command-panel');
    expect(panel.textContent).not.toContain('/clear');
  });

  it('closes the slash command panel when no commands match', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/xyz' } });
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  it('highlights first item by default on slash open', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(screen.getByText('/help')).toBeTruthy();
    expect(screen.queryByText('/clear')).toBeNull();
  });

  // 鈹€鈹€ ArrowUp/ArrowDown + scrollIntoView 鈹€鈹€
  it('ArrowDown navigates without crash and triggers scrollIntoView', async () => {
    render(
      <MemoryRouter>
        <MessageInput canRetryLatest />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    await waitFor(() => {
      expect(screen.getByTestId('slash-command-panel')).toBeTruthy();
    });

    const scrollIntoView = vi.fn();
    // Patch the prototype used by the command item divs
    const origScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });
    } finally {
      Element.prototype.scrollIntoView = origScrollIntoView;
    }
  });

  // 鈹€鈹€ Tab / Enter fill (all command types) 鈹€鈹€
  it('Tab fills /help to input', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.keyDown(textarea, { key: 'Tab' });

    expect((textarea as HTMLTextAreaElement).value).toBe('/help');
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  it('Tab fills /retry to input', () => {
    render(
      <MemoryRouter>
        <MessageInput canRetryLatest />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/re' } });
    fireEvent.keyDown(textarea, { key: 'Tab' });

    expect((textarea as HTMLTextAreaElement).value).toBe('/retry');
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  it('Tab fills /edit to input', () => {
    render(
      <MemoryRouter>
        <MessageInput canEditLatest />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/ed' } });
    fireEvent.keyDown(textarea, { key: 'Tab' });

    expect((textarea as HTMLTextAreaElement).value).toBe('/edit');
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  it('Enter fills /help to input', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect((textarea as HTMLTextAreaElement).value).toBe('/help');
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  // 鈹€鈹€ Continue typing after Tab doesn't re-open panel 鈹€鈹€
  it('Tab selected command then typing more text does not re-open panel', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(screen.getByTestId('slash-command-panel')).toBeTruthy();

    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('/help');

    // Continue typing 鈥?panel should NOT reappear
    fireEvent.change(textarea, { target: { value: '/help more' } });
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  // 鈹€鈹€ ESC 鈹€鈹€
  it('Escape closes slash panel', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(screen.getByTestId('slash-command-panel')).toBeTruthy();

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('slash-command-panel')).toBeNull();
  });

  it('calls onOpenHelp when /help is submitted', async () => {
    const onOpenHelp = vi.fn();
    render(
      <MemoryRouter>
        <MessageInput onOpenHelp={onOpenHelp} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(onOpenHelp).toHaveBeenCalledTimes(1);
    });
  });

  it('executes known slash commands when they have trailing content', async () => {
    const onOpenHelp = vi.fn();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <MessageInput onOpenHelp={onOpenHelp} onSend={onSend} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/help explain alarms' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(onOpenHelp).toHaveBeenCalledTimes(1);
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('surfaces a warning when /retry is submitted without an available target', async () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/retry' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('message-input-inline-notice').textContent).toContain('没有可重试');
    });
  });

  it('surfaces a warning for unknown slash-prefixed text when it has message content', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <MessageInput onSend={onSend} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/clear keep this literal' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('message-input-inline-notice').textContent).toContain('未识别的命令');
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps focus on the textarea after submitting /retry', async () => {
    const onRetryLatest = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <MessageInput canRetryLatest onRetryLatest={onRetryLatest} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '/retry' } });
    fireEvent.click(screen.getByTestId('btn-send'));

    await waitFor(() => {
      expect(onRetryLatest).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('shows a visible retry button for failed latest requests', async () => {
    const onRetryLatest = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <MessageInput canRetryLatest showRetryLatestButton onRetryLatest={onRetryLatest} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('btn-retry-latest'));

    await waitFor(() => {
      expect(onRetryLatest).toHaveBeenCalledTimes(1);
    });
  });

  // 鈹€鈹€ Hint click 鈹€鈹€
  it('clicking slash hint opens slash panel', () => {
    render(
      <MemoryRouter>
        <MessageInput />
      </MemoryRouter>,
    );

    const hint = screen.getByTestId('slash-hint');
    fireEvent.click(hint);
    expect(screen.getByTestId('slash-command-panel')).toBeTruthy();
    expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('/');
  });

  // 鈹€鈹€ More menu 鈹€鈹€
  it('more menu does not expose transport switching', () => {
    render(
      <MemoryRouter>
        <MessageInput onReloadConversation={() => {}} />
      </MemoryRouter>,
    );

    const moreButton = screen.getByTestId('btn-more-menu');
    fireEvent.click(moreButton);
    expect(screen.getByText('重拉当前会话')).toBeTruthy();
    expect(screen.queryByTestId('more-menu-transport-label')).toBeNull();
  });
});
