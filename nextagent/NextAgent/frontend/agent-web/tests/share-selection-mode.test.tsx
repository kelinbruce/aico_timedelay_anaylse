// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/annotationService.ts', () => ({
  annotationService: {
    upsertAnnotation: vi.fn(),
    listSessionAnnotations: vi.fn().mockResolvedValue([]),
    listFavoriteTurns: vi.fn().mockResolvedValue({ entries: [], offset: 0, limit: 50, hasMore: false }),
  },
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }),
  },
}));

import { TurnBlockComponent } from '../src/features/chat/components/TurnBlock.tsx';
import { ShareModeBar } from '../src/features/share/components/ShareModeBar.tsx';
import type { TurnBlock, StreamEnvelope } from '../src/state/contracts.ts';
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
});

const baseBlock: TurnBlock = {
  rootMessageId: 'msg-1',
  userMessage: {
    messageId: 'msg-1',
    sessionId: 'session-1',
    role: 'USER',
    sequence: 1,
    content: 'Question',
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

function makeAiEvent(id: string, runId: string): StreamEnvelope {
  return {
    eventId: `evt-${id}`,
    sessionId: 'session-1',
    requestId: 'msg-1',
    sequence: Number(id) || 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: { content: `answer-${id}` },
    createdAt: '2026-04-15T00:00:00Z',
    runId,
  } as StreamEnvelope;
}

function makeCompletedBlock(runId: string): TurnBlock {
  return {
    ...baseBlock,
    aiEvents: [makeAiEvent('1', runId), { ...makeAiEvent('2', runId), eventType: 'REQUEST_COMPLETED', payload: { status: 'COMPLETED' } }],
    status: 'COMPLETED',
  } as TurnBlock;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

describe('Share selection mode', () => {
  describe('TurnBlock checkbox', () => {
    it('shows checkbox when shareSelection is enabled', () => {
      const block = makeCompletedBlock('run-1');
      render(
        <TurnBlockComponent
          block={block}
          sessionId="session-1"
          onRetry={() => {}}
          onEdit={() => {}}
          onCancel={() => {}}
          shareSelection={true}
          shareSelected={true}
          onToggleShareSelection={() => {}}
        />,
      );
      expect(screen.getByTestId('share-checkbox-run-1')).toBeTruthy();
    });

    it('does not show checkbox when shareSelection is disabled', () => {
      const block = makeCompletedBlock('run-1');
      render(<TurnBlockComponent block={block} sessionId="session-1" onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);
      expect(screen.queryByTestId('share-checkbox-run-1')).toBeNull();
    });

    it('fires onToggleShareSelection with runId when checkbox is clicked', () => {
      const toggleMock = vi.fn();
      const block = makeCompletedBlock('run-1');
      render(
        <TurnBlockComponent
          block={block}
          sessionId="session-1"
          onRetry={() => {}}
          onEdit={() => {}}
          onCancel={() => {}}
          shareSelection={true}
          shareSelected={false}
          onToggleShareSelection={toggleMock}
        />,
      );
      fireEvent.click(screen.getByTestId('share-checkbox-run-1'));
      expect(toggleMock).toHaveBeenCalledWith('run-1');
    });
  });

  describe('ShareModeBar', () => {
    const baseProps = {
      allSelectableCount: 3,
      selectedRunIds: new Set<string>(),
      selectableRunIds: new Set<string>(['run-1', 'run-2', 'run-3']),
      onToggleSelectAll: () => {},
    };

    it('renders with selected count', () => {
      render(
        <ShareModeBar
          {...baseProps}
          selectedCount={3}
          selectedRunIds={new Set(['run-1', 'run-2', 'run-3'])}
          onShare={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getByTestId('share-mode-bar')).toBeTruthy();
      expect(screen.getByTestId('share-selected-count').textContent).toContain('3');
    });

    it('disables share button when selectedCount is 0', () => {
      render(<ShareModeBar {...baseProps} selectedCount={0} onShare={() => {}} onCancel={() => {}} />);
      expect((screen.getByTestId('share-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('fires onShare when share button is clicked', () => {
      const shareMock = vi.fn();
      render(<ShareModeBar {...baseProps} selectedCount={1} onShare={shareMock} onCancel={() => {}} />);
      fireEvent.click(screen.getByTestId('share-confirm-btn'));
      expect(shareMock).toHaveBeenCalledTimes(1);
    });

    it('fires onCancel when cancel button is clicked', () => {
      const cancelMock = vi.fn();
      render(<ShareModeBar {...baseProps} selectedCount={1} onShare={() => {}} onCancel={cancelMock} />);
      fireEvent.click(screen.getByTestId('share-cancel-btn'));
      expect(cancelMock).toHaveBeenCalledTimes(1);
    });

    it('fires onToggleSelectAll when select-all checkbox is clicked', () => {
      const toggleMock = vi.fn();
      render(<ShareModeBar {...baseProps} selectedCount={0} onToggleSelectAll={toggleMock} onShare={() => {}} onCancel={() => {}} />);
      fireEvent.click(screen.getByTestId('share-select-all-checkbox'));
      expect(toggleMock).toHaveBeenCalledTimes(1);
    });

    it('shows indeterminate state when some but not all are selected', () => {
      render(<ShareModeBar {...baseProps} selectedCount={1} selectedRunIds={new Set(['run-1'])} onShare={() => {}} onCancel={() => {}} />);
      const checkbox = screen.getByTestId('share-select-all-checkbox') as HTMLInputElement;
      expect(checkbox.indeterminate).toBe(true);
    });

    it('shows max limit in count when maxItems is provided', () => {
      render(
        <ShareModeBar {...baseProps} maxItems={100} selectedCount={5} selectedRunIds={new Set(['run-1'])} onShare={() => {}} onCancel={() => {}} />,
      );
      const countEl = screen.getByTestId('share-selected-count');
      expect(countEl.textContent).toContain('5');
      expect(countEl.textContent).toContain('100');
    });

    it('does not show max limit when maxItems is not provided', () => {
      render(<ShareModeBar {...baseProps} selectedCount={5} selectedRunIds={new Set(['run-1'])} onShare={() => {}} onCancel={() => {}} />);
      const countEl = screen.getByTestId('share-selected-count');
      expect(countEl.textContent).toContain('5');
      expect(countEl.textContent).not.toContain('100');
    });
  });
});
