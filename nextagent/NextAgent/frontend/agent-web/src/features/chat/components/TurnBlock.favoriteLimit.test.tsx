import { describe, it, expect, vi, afterEach } from 'vitest';
import { createContext } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { StreamEnvelope, TurnBlock } from '../../../state/contracts';

const { mockModeRef } = vi.hoisted(() => ({ mockModeRef: { current: 'local' as 'local' | 'immersive' | 'piu' } }));

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => null,
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  AppHostContext: createContext(undefined as unknown),
  useAppHostContext: () => ({ mode: mockModeRef.current, hostTheme: {} as Record<string, unknown> }),
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
import { annotationService, FAVORITE_LIMIT } from '../../../services/annotationService.ts';
import { message } from 'antd';
import { getActionButton } from './_overflowHelper';

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

const fullAnnotation = {
  annotationId: 'ann-1',
  sessionId: 'S1',
  requestRunId: 'run-6',
  sentiment: null as null,
  isFavorited: true,
  isQuestionFavorited: false,
  createdAt: 0,
};

const emptyFavoritePage = { entries: [], offset: 0, limit: FAVORITE_LIMIT, hasMore: false };

function fullFavoritePage(count: number) {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      sessionId: `S${index}`,
      requestRunId: `R${index}`,
      rootMessageId: `M${index}`,
      questionPreview: 'q',
      questionTruncated: false,
      sessionUpdatedAt: 0,
      favoritedAt: 0,
    })),
    offset: 0,
    limit: FAVORITE_LIMIT,
    hasMore: false,
  };
}

function renderTurn(initialFavorite = false) {
  const onAnnotationChange = vi.fn();
  render(
    <TurnBlockComponent
      block={buildBlock()}
      onRetry={vi.fn()}
      onEdit={vi.fn()}
      onCancel={vi.fn()}
      sessionId="S1"
      annotation={{ sentiment: null, isFavorited: initialFavorite, isQuestionFavorited: false }}
      onAnnotationChange={onAnnotationChange}
    />,
  );
  return { onAnnotationChange };
}

function setMode(mode: 'local' | 'immersive' | 'piu'): void {
  mockModeRef.current = mode;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockModeRef.current = 'local';
});

describe('TurnBlock favorite limit (local mode)', () => {
  it('rolls back optimistic favorite and shows dedicated message on FAVORITE_LIMIT_EXCEEDED', async () => {
    setMode('local');
    const error = Object.assign(new Error('Favorite limit reached'), { code: 'FAVORITE_LIMIT_EXCEEDED' });
    vi.mocked(annotationService.upsertAnnotation).mockRejectedValueOnce(error);

    vi.spyOn(message, 'error');

    const { onAnnotationChange } = renderTurn();

    const favoriteBtn = getActionButton('annotation-favorite');
    fireEvent.click(favoriteBtn);

    await waitFor(() => {
      expect(onAnnotationChange).toHaveBeenCalledWith('run-6', { sentiment: null, isFavorited: false, isQuestionFavorited: false });
    });

    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith('收藏数量已达上限（100条），请先取消部分收藏后再收藏');
    });
    expect(annotationService.listFavoriteTurns).not.toHaveBeenCalled();
  });

  it('shows generic annotation error for non-limit errors', async () => {
    setMode('local');
    vi.mocked(annotationService.upsertAnnotation).mockRejectedValueOnce(new Error('network failure'));

    vi.spyOn(message, 'error');

    renderTurn();

    const favoriteBtn = getActionButton('annotation-favorite');
    fireEvent.click(favoriteBtn);

    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith('标注操作失败，请稍后重试');
    });
  });
});

describe('TurnBlock favorite limit (remote mode pre-check)', () => {
  it.each(['immersive', 'piu'] as const)('blocks favorite in %s mode when 100 favorites already exist', async (mode) => {
    setMode(mode);
    vi.mocked(annotationService.listFavoriteTurns).mockResolvedValueOnce(fullFavoritePage(FAVORITE_LIMIT));

    vi.spyOn(message, 'error');

    const { onAnnotationChange } = renderTurn();

    const favoriteBtn = getActionButton('annotation-favorite');
    fireEvent.click(favoriteBtn);

    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith('收藏数量已达上限（100条），请先取消部分收藏后再收藏');
    });
    expect(annotationService.upsertAnnotation).not.toHaveBeenCalled();
    expect(onAnnotationChange).not.toHaveBeenCalled();
  });

  it('proceeds with favorite when under the limit', async () => {
    setMode('immersive');
    vi.mocked(annotationService.listFavoriteTurns).mockResolvedValueOnce(emptyFavoritePage);
    vi.mocked(annotationService.upsertAnnotation).mockResolvedValueOnce({ ...fullAnnotation, isFavorited: true });

    const { onAnnotationChange } = renderTurn();

    const favoriteBtn = getActionButton('annotation-favorite');
    fireEvent.click(favoriteBtn);

    await waitFor(() => {
      expect(annotationService.upsertAnnotation).toHaveBeenCalled();
    });
    expect(onAnnotationChange).toHaveBeenCalledWith('run-6', { sentiment: null, isFavorited: true, isQuestionFavorited: false });
  });

  it('does not pre-check when unfavoriting', async () => {
    setMode('immersive');
    vi.mocked(annotationService.upsertAnnotation).mockResolvedValueOnce({ ...fullAnnotation, isFavorited: false });

    renderTurn(true);

    const favoriteBtn = getActionButton('annotation-favorite');
    fireEvent.click(favoriteBtn);

    await waitFor(() => {
      expect(annotationService.upsertAnnotation).toHaveBeenCalled();
    });
    expect(annotationService.listFavoriteTurns).not.toHaveBeenCalled();
  });
});
