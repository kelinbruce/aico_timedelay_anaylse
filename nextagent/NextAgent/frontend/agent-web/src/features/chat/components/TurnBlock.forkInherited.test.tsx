import { describe, it, expect, vi, afterEach } from 'vitest';
import { createContext } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { StreamEnvelope, TurnBlock } from '../../../state/contracts';

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => null,
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  AppHostContext: createContext(undefined as unknown),
  useAppHostContext: () => ({ hostTheme: {} }),
}));

vi.mock('../../../services/annotationService.ts', () => ({
  annotationService: { upsertAnnotation: vi.fn() },
}));

vi.mock('../../suggested-questions/components/SuggestedQuestions.tsx', () => ({
  SuggestedQuestions: () => null,
}));

vi.mock('./ProcessPanel.tsx', () => ({
  ProcessPanel: () => null,
}));

vi.mock('./MarkdownContent.tsx', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
  STREAMING_TEXT_SWEEP_CSS: '',
  __resetMarkdownContentTestState: () => undefined,
  resolveTextSweepDuration: () => '3s',
}));

import { TurnBlockComponent } from './TurnBlock.tsx';

function buildBlock(forkInherited?: boolean): TurnBlock {
  const answerEvent = {
    eventId: 'evt-1',
    sessionId: 'S1',
    requestId: 'req-1',
    runId: 'run-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      content: 'inherited answer',
      role: 'ASSISTANT',
      messageId: 'ai-1',
      rootMessageId: 'root-1',
    },
    createdAt: '2026-07-22T10:00:01.000Z',
  } as unknown as StreamEnvelope;
  return {
    rootMessageId: 'root-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'S1',
      content: 'inherited question',
      createdAt: '2026-07-22T10:00:00.000Z',
      visible: true,
    },
    aiEvents: [answerEvent],
    status: 'COMPLETED',
    isLatest: true,
    ...(forkInherited === undefined ? {} : { forkInherited }),
  };
}

function renderTurn(block: TurnBlock) {
  const onRetry = vi.fn();
  const onEdit = vi.fn();
  render(<TurnBlockComponent block={block} onRetry={onRetry} onEdit={onEdit} onCancel={vi.fn()} />);
  return { onRetry, onEdit };
}

afterEach(() => {
  cleanup();
});

describe('TurnBlock fork-inherited turn actions', () => {
  it('disables retry on an inherited latest turn with explanatory tooltip', async () => {
    const { onRetry } = renderTurn(buildBlock(true));

    const button = screen.getByTestId('btn-retry-ai');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.style.cursor).toBe('not-allowed');
    expect(button.style.opacity).toBe('0.45');

    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();

    fireEvent.mouseOver(button);
    await waitFor(() => {
      expect(screen.getByText('派生会话继承的回答不可重试')).toBeTruthy();
    });
  });

  it('disables edit on an inherited latest turn with explanatory tooltip', async () => {
    const { onEdit } = renderTurn(buildBlock(true));

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    const button = screen.getByTestId('btn-edit-user');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.style.cursor).toBe('not-allowed');
    expect(button.style.opacity).toBe('0.45');

    fireEvent.click(button);
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.mouseOver(button);
    await waitFor(() => {
      expect(screen.getByText('派生会话继承的问题不可编辑')).toBeTruthy();
    });
  });

  it('keeps retry and edit enabled on a non-inherited latest turn', () => {
    const { onRetry, onEdit } = renderTurn(buildBlock());

    const retryButton = screen.getByTestId('btn-retry-ai');
    expect(retryButton.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    const editButton = screen.getByTestId('btn-edit-user');
    fireEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
