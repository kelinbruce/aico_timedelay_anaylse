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

function buildBlock(): TurnBlock {
  const answerEvent = {
    eventId: 'evt-1',
    sessionId: 'S1',
    requestId: 'req-1',
    runId: 'run-6',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      content: 'RAN alarm diagnosis result',
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
      content: 'diagnose RAN alarms',
      createdAt: '2026-07-22T10:00:00.000Z',
      visible: true,
    },
    aiEvents: [answerEvent],
    status: 'COMPLETED',
    isLatest: true,
  };
}

function renderTurn(retryDisabled: boolean) {
  const onRetry = vi.fn();
  render(<TurnBlockComponent block={buildBlock()} onRetry={onRetry} onEdit={vi.fn()} onCancel={vi.fn()} retryDisabled={retryDisabled} />);
  return { onRetry };
}

afterEach(() => {
  cleanup();
});

describe('TurnBlock retry limit', () => {
  it('keeps the retry action enabled when the limit is not reached', () => {
    const { onRetry } = renderTurn(false);

    const button = screen.getByTestId('btn-retry-ai');
    expect(button.getAttribute('aria-disabled')).toBe('false');

    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith('root-1');
  });

  it('disables the retry action with the limit affordances and blocks retry when the limit is reached', async () => {
    const { onRetry } = renderTurn(true);

    const button = screen.getByTestId('btn-retry-ai');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.style.cursor).toBe('not-allowed');
    expect(button.style.opacity).toBe('0.45');

    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();

    fireEvent.mouseOver(button);
    await waitFor(() => {
      expect(screen.getByText('当前系统仅支持最多5次的重试')).toBeTruthy();
    });
  });
});
