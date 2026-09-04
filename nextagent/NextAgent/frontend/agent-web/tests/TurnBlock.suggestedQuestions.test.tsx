import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

const mockPost = vi.hoisted(() => vi.fn());
vi.mock('../src/services/apiClient.ts', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
  setTenantId: vi.fn(),
  setSubjectId: vi.fn(),
  setDisplayName: vi.fn(),
  setCsrfToken: vi.fn(),
}));

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

import { screen, cleanup, waitFor } from '@testing-library/react';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';
import type { TurnBlock, StreamEnvelope } from '../src/state/contracts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [1];
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
  mockPost.mockReset();
  runtimeConfig.portalAbilityConfig = {
    suggestedQuestionsEnabled: true,
    cronTasksEnabled: true,
    longTermMemoryManagementEnabled: true,
    knowledgeImportEnabled: true,
    fullProcessEnabled: true,
  };
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

function makeFailedBlock(runId: string): TurnBlock {
  return {
    ...baseBlock,
    aiEvents: [
      makeAiEvent('1', runId, { eventType: 'REQUEST_ACCEPTED' }),
      makeAiEvent('2', runId, { eventType: 'REQUEST_FAILED', payload: { status: 'FAILED' } }),
    ],
    status: 'FAILED',
  };
}

function makeCanceledBlock(runId: string): TurnBlock {
  return {
    ...baseBlock,
    aiEvents: [
      makeAiEvent('1', runId, { eventType: 'REQUEST_ACCEPTED' }),
      makeAiEvent('2', runId, { eventType: 'REQUEST_CANCELED', payload: { status: 'CANCELED' } }),
    ],
    status: 'CANCELED',
  };
}

function makeHistoryLoadedBlock(runId: string): TurnBlock {
  return {
    ...baseBlock,
    aiEvents: [
      makeAiEvent('1', runId, {
        eventType: 'REQUEST_ACCEPTED',
        transportHints: ['history-load'],
      }),
      makeAiEvent('2', runId, {
        eventType: 'LLM_CONTENT_DELTA',
        payload: { content: 'Hello world' },
        transportHints: ['history-load'],
      }),
      makeAiEvent('3', runId, {
        eventType: 'REQUEST_COMPLETED',
        payload: { status: 'COMPLETED' },
        transportHints: ['history-load'],
      }),
    ],
    status: 'COMPLETED',
  };
}

describe('TurnBlock suggested questions trigger', () => {
  it('renders suggested questions component when turn is COMPLETED, latest, and live-streamed', async () => {
    mockPost.mockResolvedValue({ questions: ['q1', 'q2', 'q3'] });

    const block = makeCompletedBlock('run-1');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('suggested-questions')).toBeTruthy();
    });
  });

  it('does not render, show loading, or call the API when the portal ability switch is false', async () => {
    runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: false,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    };
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block = makeCompletedBlock('run-1');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('defaults to enabled when bootstrap is missing portalAbilityConfig', async () => {
    delete (runtimeConfig as { portalAbilityConfig?: { suggestedQuestionsEnabled: boolean } }).portalAbilityConfig;
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block = makeCompletedBlock('run-1');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('suggested-questions')).toBeTruthy();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('does not render suggested questions when turn status is FAILED', async () => {
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block = makeFailedBlock('run-1');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not render suggested questions when turn status is CANCELED', async () => {
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block = makeCanceledBlock('run-1');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not render suggested questions when turn is not the latest turn', async () => {
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block: TurnBlock = { ...makeCompletedBlock('run-1'), isLatest: false };
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not render suggested questions when turn was loaded from history', async () => {
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block = makeHistoryLoadedBlock('run-1');
    render(
      <TurnBlockComponent
        block={block}
        sessionId="session-1"
        onRetry={() => {}}
        onEdit={() => {}}
        onCancel={() => {}}
        onSuggestedQuestionClick={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not render suggested questions when onSuggestedQuestionClick is not provided', async () => {
    mockPost.mockResolvedValue({ questions: ['q1'] });

    const block = makeCompletedBlock('run-1');
    render(<TurnBlockComponent block={block} sessionId="session-1" onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
