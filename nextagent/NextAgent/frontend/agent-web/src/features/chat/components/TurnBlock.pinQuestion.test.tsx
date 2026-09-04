import { describe, it, expect, vi, afterEach } from 'vitest';
import { createContext } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { StreamEnvelope, TurnBlock } from '../../../state/contracts';

const { mockAuthGateAllowsRef } = vi.hoisted(() => ({ mockAuthGateAllowsRef: { current: true } }));

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => (mockAuthGateAllowsRef.current ? children : null),
}));

vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => null,
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  AppHostContext: createContext(undefined as unknown),
  useAppHostContext: () => ({ mode: 'local', hostTheme: {} as Record<string, unknown> }),
}));

vi.mock('../../../services/annotationService.ts', () => ({
  annotationService: { upsertAnnotation: vi.fn(), listFavoriteTurns: vi.fn() },
  FAVORITE_LIMIT: 100,
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
import { annotationService } from '../../../services/annotationService.ts';
import { message } from 'antd';

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

function renderTurn(isQuestionFavorited: boolean) {
  const onAnnotationChange = vi.fn();
  render(
    <TurnBlockComponent
      block={buildBlock()}
      onRetry={vi.fn()}
      onEdit={vi.fn()}
      onCancel={vi.fn()}
      sessionId="S1"
      annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited }}
      onAnnotationChange={onAnnotationChange}
    />,
  );
  fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
  return { onAnnotationChange };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockAuthGateAllowsRef.current = true;
});

describe('TurnBlock directive placeholder bubble', () => {
  it('renders a skill placeholder when user content is empty but targetSkill is set', () => {
    const block = {
      ...buildBlock(),
      userMessage: {
        messageId: 'root-1',
        sessionId: 'S1',
        content: '',
        createdAt: '2026-07-22T10:00:00.000Z',
        visible: true as const,
        targetSkill: 'bom-test-skill',
      },
    };
    render(
      <TurnBlockComponent
        block={block}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
        onAnnotationChange={vi.fn()}
      />,
    );

    const placeholder = screen.getByTestId('user-skill-placeholder');
    expect(placeholder.textContent).toContain('bom-test-skill');
    expect(screen.queryByTestId('user-bubble')).toBeNull();
  });

  it('renders the normal user bubble when content is non-empty', () => {
    renderTurn(false);
    expect(screen.getByTestId('user-bubble')).toBeTruthy();
    expect(screen.queryByTestId('user-skill-placeholder')).toBeNull();
  });
});

describe('TurnBlock question favorite toggle', () => {
  it('shows pin affordance when question is not favorited', () => {
    renderTurn(false);
    const pinBtn = screen.getByTestId('btn-pin-user');
    expect(pinBtn.getAttribute('aria-label')).toBe('收藏此问题，用于快速提问和输入联想');
  });

  it('shows unpin affordance with highlight when question is favorited', () => {
    renderTurn(true);
    const pinBtn = screen.getByTestId('btn-pin-user');
    expect(pinBtn.getAttribute('aria-label')).toBe('取消收藏');
    expect(pinBtn.querySelector('span.anticon')?.getAttribute('style')).toContain('color');
  });

  it('renders pin button only on the user bubble', () => {
    renderTurn(false);
    expect(screen.getAllByTestId('btn-pin-user')).toHaveLength(1);
    expect(screen.getByTestId('ai-bubble').querySelector("[data-testid='btn-pin-user']")).toBeNull();
  });

  it('pins an unfavorited question on click', async () => {
    vi.mocked(annotationService.upsertAnnotation).mockResolvedValueOnce({
      annotationId: 'ann-1',
      sessionId: 'S1',
      requestRunId: 'run-6',
      sentiment: null,
      isFavorited: false,
      isQuestionFavorited: true,
      createdAt: 0,
    });
    vi.spyOn(message, 'success');

    renderTurn(false);
    fireEvent.click(screen.getByTestId('btn-pin-user'));

    await waitFor(() => {
      expect(annotationService.upsertAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'S1', runId: 'run-6', isQuestionFavorited: true }),
      );
    });
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('已添加至常用问题');
    });
  });

  it('unpins a favorited question on click', async () => {
    vi.mocked(annotationService.upsertAnnotation).mockResolvedValueOnce({
      annotationId: 'ann-1',
      sessionId: 'S1',
      requestRunId: 'run-6',
      sentiment: null,
      isFavorited: false,
      isQuestionFavorited: false,
      createdAt: 0,
    });
    vi.spyOn(message, 'success');

    const { onAnnotationChange } = renderTurn(true);
    fireEvent.click(screen.getByTestId('btn-pin-user'));

    await waitFor(() => {
      expect(annotationService.upsertAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'S1', runId: 'run-6', isQuestionFavorited: false }),
      );
    });
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('已取消收藏');
    });
    expect(onAnnotationChange).toHaveBeenCalledWith('run-6', {
      sentiment: null,
      isFavorited: false,
      isQuestionFavorited: false,
    });
  });

  it('rolls back and shows failure message when pin API fails', async () => {
    vi.mocked(annotationService.upsertAnnotation).mockRejectedValueOnce(new Error('network failure'));
    vi.spyOn(message, 'error');

    const { onAnnotationChange } = renderTurn(false);
    fireEvent.click(screen.getByTestId('btn-pin-user'));

    await waitFor(() => {
      expect(onAnnotationChange).toHaveBeenCalledWith('run-6', {
        sentiment: null,
        isFavorited: false,
        isQuestionFavorited: false,
      });
    });
    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith('标注操作失败，请稍后重试');
    });
  });

  it('does not render pin button without write permission', () => {
    mockAuthGateAllowsRef.current = false;
    renderTurn(false);
    expect(screen.queryByTestId('btn-pin-user')).toBeNull();
  });
});
