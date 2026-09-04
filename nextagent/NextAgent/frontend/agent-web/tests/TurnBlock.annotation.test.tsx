import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

const upsertMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/annotationService.ts', () => ({
  annotationService: {
    upsertAnnotation: upsertMock,
    listSessionAnnotations: vi.fn().mockResolvedValue([]),
    listFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
  },
}));

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

import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import type { TurnBlock, StreamEnvelope } from '../src/state/contracts';
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
  vi.useRealTimers();
});

beforeEach(() => {
  upsertMock.mockReset();
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  mermaidMock.render.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>' });
  (globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

const baseBlock: TurnBlock = {
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

function makeAiEvent(id: string, runId: string, overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
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
    runId,
    ...overrides,
  } as StreamEnvelope;
}

function makeCompletedBlock(runId: string): TurnBlock {
  return {
    ...baseBlock,
    aiEvents: [
      makeAiEvent('1', runId, { eventType: 'REQUEST_ACCEPTED' }),
      makeAiEvent('2', runId, { eventType: 'LLM_CONTENT_DELTA', payload: { content: 'Hello world' } }),
      makeAiEvent('3', runId, { eventType: 'REQUEST_COMPLETED', payload: { status: 'COMPLETED' } }),
    ],
    status: 'COMPLETED',
  };
}

describe('TurnBlock annotation from neutral state', () => {
  it('triggers upsert with sentiment UP when liking from neutral state', async () => {
    upsertMock.mockResolvedValue({
      annotationId: 'ann-1',
      sessionId: 'session-1',
      requestRunId: 'run-1',
      sentiment: 'UP',
      isFavorited: false,
      createdAt: 0,
    });

    const block = makeCompletedBlock('run-1');
    render(<TurnBlockComponent block={block} sessionId="session-1" onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const likeBtn = await screen.findByTestId('annotation-like');
    fireEvent.click(likeBtn);

    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', runId: 'run-1', sentiment: 'UP' }));
    });
  });

  it('triggers upsert with isFavorited true when favoriting from neutral state', async () => {
    upsertMock.mockResolvedValue({
      annotationId: 'ann-2',
      sessionId: 'session-1',
      requestRunId: 'run-2',
      sentiment: null,
      isFavorited: true,
      createdAt: 0,
    });

    const block = makeCompletedBlock('run-2');
    render(<TurnBlockComponent block={block} sessionId="session-1" onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const favBtn = await screen.findByTestId('annotation-favorite');
    fireEvent.click(favBtn);

    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1', runId: 'run-2', isFavorited: true, isQuestionFavorited: false }),
      );
    });
  });
});

describe('TurnBlock annotation preserves relative favorite state', () => {
  it('preserves isQuestionFavorited when favoriting the answer', async () => {
    upsertMock.mockResolvedValue({
      annotationId: 'ann-3',
      sessionId: 'session-1',
      requestRunId: 'run-3',
      sentiment: null,
      isFavorited: true,
      isQuestionFavorited: true,
      createdAt: 0,
    });

    const block = makeCompletedBlock('run-3');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        annotation={{ sentiment: null, isFavorited: false, isQuestionFavorited: true }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    const favBtn = await screen.findByTestId('annotation-favorite');
    fireEvent.click(favBtn);

    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1', runId: 'run-3', isFavorited: true, isQuestionFavorited: true }),
      );
    });
  });

  it('carries isFavorited when pinning the question', async () => {
    upsertMock.mockResolvedValue({
      annotationId: 'ann-4',
      sessionId: 'session-1',
      requestRunId: 'run-4',
      sentiment: null,
      isFavorited: true,
      isQuestionFavorited: true,
      createdAt: 0,
    });

    const block = makeCompletedBlock('run-4');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        annotation={{ sentiment: null, isFavorited: true, isQuestionFavorited: false }}
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId('user-content-region'));
    const pinBtn = await screen.findByTestId('btn-pin-user');
    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1', runId: 'run-4', isFavorited: true, isQuestionFavorited: true }),
      );
    });
  });
});
