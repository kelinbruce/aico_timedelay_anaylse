import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { __resetTurnBlockTestState, TurnBlockComponent, type AnnotationState } from '../src/features/chat/components/TurnBlock';
import type { TurnBlock, StreamEnvelope } from '../src/state/contracts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const upsertMock = vi.hoisted(() => vi.fn());
const listSessionAnnotationsMock = vi.hoisted(() => vi.fn());
vi.mock('../src/services/annotationService.ts', () => ({
  annotationService: {
    upsertAnnotation: upsertMock,
    listSessionAnnotations: listSessionAnnotationsMock,
    listFavoriteTurns: vi.fn(),
  },
}));

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
  vi.useRealTimers();
  upsertMock.mockReset();
  listSessionAnnotationsMock.mockReset();
});

beforeEach(() => {
  upsertMock.mockReset();
  listSessionAnnotationsMock.mockReset();
  (globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

const SESSION_ID = 'session-annotation';
const RUN_ID = 'run-annotation-1';

function makeBlock(status: TurnBlock['status'] = 'COMPLETED', sentiment: string | null = null): TurnBlock {
  return {
    rootMessageId: 'msg-1',
    userMessage: {
      messageId: 'msg-1',
      sessionId: SESSION_ID,
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
    aiEvents: [
      {
        eventId: 'evt-1',
        sessionId: SESSION_ID,
        requestId: 'req-1',
        sequence: 1,
        runId: RUN_ID,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: { content: 'assistant reply' },
        createdAt: '2026-04-15T00:00:00Z',
      } as StreamEnvelope,
    ],
    status,
    isLatest: true,
  };
}

function hoverAssistantRegion(): void {
  fireEvent.mouseEnter(screen.getByTestId('assistant-content-region'));
}

function mockUpsertResolve(view: AnnotationState | null) {
  if (view === null) {
    upsertMock.mockResolvedValue({ sentiment: null, isFavorited: false, isQuestionFavorited: false });
  } else {
    upsertMock.mockResolvedValue({
      annotationId: 'annotation-1',
      sessionId: SESSION_ID,
      requestRunId: RUN_ID,
      sentiment: view.sentiment,
      isFavorited: view.isFavorited,
      isQuestionFavorited: view.isQuestionFavorited,
      createdAt: 1000,
    });
  }
}

describe('annotation icon toggle', () => {
  it('shows like, dislike, and favorite icons on a terminal turn with answer content', () => {
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();
    expect(screen.getByTestId('annotation-like')).toBeTruthy();
    expect(screen.getByTestId('annotation-dislike')).toBeTruthy();
    expect(screen.getByTestId('annotation-favorite')).toBeTruthy();
  });

  it('renders the primary-colored active dislike icon', () => {
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: 'DOWN', isFavorited: false, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();

    const icon = screen.getByTestId('annotation-dislike').querySelector('img');
    expect(icon?.getAttribute('src')).toContain('dislike-active-light.svg');

    const lightSvg = readFileSync(resolve(process.cwd(), 'src/assets/turn-icons/dislike-active-light.svg'), 'utf8');
    const darkSvg = readFileSync(resolve(process.cwd(), 'src/assets/turn-icons/dislike-active-dark.svg'), 'utf8');
    expect(lightSvg).toContain('fill="#0067D1"');
    expect(darkSvg).toContain('fill="#5CA2E9"');
  });

  it('does not show annotation icons when sessionId is missing', () => {
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();
    expect(screen.queryByTestId('annotation-like')).toBeNull();
  });

  it('does not show annotation icons when turn is not terminal', () => {
    render(
      <TurnBlockComponent
        block={makeBlock('EXECUTING')}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();
    expect(screen.queryByTestId('annotation-like')).toBeNull();
  });

  it.each([
    {
      name: 'like added',
      initial: { sentiment: null, isFavorited: false },
      button: 'annotation-like',
      result: { sentiment: 'UP', isFavorited: false, isQuestionFavorited: false },
      expected: '已点赞',
    },
    { name: 'like removed', initial: { sentiment: 'UP', isFavorited: false }, button: 'annotation-like', result: null, expected: '已取消点赞' },
    {
      name: 'dislike added',
      initial: { sentiment: null, isFavorited: false },
      button: 'annotation-dislike',
      result: { sentiment: 'DOWN', isFavorited: false, isQuestionFavorited: false },
      expected: '已点踩',
    },
    {
      name: 'dislike removed',
      initial: { sentiment: 'DOWN', isFavorited: false },
      button: 'annotation-dislike',
      result: null,
      expected: '已取消点踩',
    },
    {
      name: 'favorite added',
      initial: { sentiment: null, isFavorited: false },
      button: 'annotation-favorite',
      result: { sentiment: null, isFavorited: true, isQuestionFavorited: false },
      expected: '已收藏',
    },
    {
      name: 'favorite removed',
      initial: { sentiment: null, isFavorited: true },
      button: 'annotation-favorite',
      result: { sentiment: null, isFavorited: false, isQuestionFavorited: false },
      expected: '已取消收藏',
    },
  ] as const)('shows a localized success message when $name', async ({ initial, button, result, expected }) => {
    mockUpsertResolve(result);
    const successSpy = vi.spyOn(message, 'success');
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: initial.sentiment, isFavorited: initial.isFavorited, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId(button));
    });

    expect(successSpy).toHaveBeenCalledWith(expected);
  });

  it('does not show a success message when annotation upsert fails', async () => {
    upsertMock.mockRejectedValue(new Error('network failure'));
    const successSpy = vi.spyOn(message, 'success');
    const errorSpy = vi.spyOn(message, 'error');
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-like'));
    });

    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('标注操作失败，请稍后重试');
  });

  it('toggles thumbs up from neutral to UP and calls upsert', async () => {
    mockUpsertResolve({ sentiment: 'UP', isFavorited: false, isQuestionFavorited: false });
    const onAnnotationChange = vi.fn();
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
        onAnnotationChange={onAnnotationChange}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-like'));
    });

    expect(upsertMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      sentiment: 'UP',
      isFavorited: false,
      isQuestionFavorited: false,
    });
    await waitFor(() => {
      expect(onAnnotationChange).toHaveBeenCalledWith(RUN_ID, { sentiment: 'UP', isFavorited: false, isQuestionFavorited: false });
    });
  });

  it('toggles thumbs up off when already UP and not favorited', async () => {
    mockUpsertResolve(null);
    const onAnnotationChange = vi.fn();
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: 'UP', isFavorited: false, isQuestionFavorited: false }}
        onAnnotationChange={onAnnotationChange}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-like'));
    });

    expect(upsertMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      sentiment: null,
      isFavorited: false,
      isQuestionFavorited: false,
    });
    await waitFor(() => {
      expect(onAnnotationChange).toHaveBeenCalledWith(RUN_ID, null);
    });
  });

  it('switches from thumbs up to thumbs down', async () => {
    mockUpsertResolve({ sentiment: 'DOWN', isFavorited: false, isQuestionFavorited: false });
    const onAnnotationChange = vi.fn();
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: 'UP', isFavorited: false, isQuestionFavorited: false }}
        onAnnotationChange={onAnnotationChange}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-dislike'));
    });

    expect(upsertMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      sentiment: 'DOWN',
      isFavorited: false,
      isQuestionFavorited: false,
    });
  });

  it('toggles favorite from neutral to favorited', async () => {
    mockUpsertResolve({ sentiment: null, isFavorited: true, isQuestionFavorited: false });
    const onAnnotationChange = vi.fn();
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
        onAnnotationChange={onAnnotationChange}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-favorite'));
    });

    expect(upsertMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      sentiment: null,
      isFavorited: true,
      isQuestionFavorited: false,
    });
    await waitFor(() => {
      expect(onAnnotationChange).toHaveBeenCalledWith(RUN_ID, { sentiment: null, isFavorited: true, isQuestionFavorited: false });
    });
  });

  it('toggles favorite off when already favorited', async () => {
    mockUpsertResolve({ sentiment: 'UP', isFavorited: false, isQuestionFavorited: false });
    const onAnnotationChange = vi.fn();
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: 'UP', isFavorited: true, isQuestionFavorited: false }}
        onAnnotationChange={onAnnotationChange}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-favorite'));
    });

    expect(upsertMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      sentiment: 'UP',
      isFavorited: false,
      isQuestionFavorited: false,
    });
  });

  it('rolls back optimistic state when upsert fails', async () => {
    upsertMock.mockRejectedValue(new Error('network failure'));
    const onAnnotationChange = vi.fn();
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: false }}
        onAnnotationChange={onAnnotationChange}
      />,
    );
    hoverAssistantRegion();

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotation-like'));
    });

    await waitFor(() => {
      expect(onAnnotationChange).toHaveBeenCalledWith(RUN_ID, { sentiment: null, isFavorited: false, isQuestionFavorited: false });
    });
  });

  it('persists annotation state from annotation prop after reload', () => {
    render(
      <TurnBlockComponent
        block={makeBlock()}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        sessionId={SESSION_ID}
        annotation={{ sentiment: 'UP', isFavorited: true, isQuestionFavorited: false }}
      />,
    );
    hoverAssistantRegion();

    const likeIcon = screen.getByTestId('annotation-like').querySelector('img');
    expect(likeIcon?.getAttribute('src')).toContain('like-active-light.svg');

    const favoriteIcon = screen.getByTestId('annotation-favorite').querySelector('img');
    expect(favoriteIcon?.getAttribute('src')).toContain('favorite-active-light.svg');
  });
});
