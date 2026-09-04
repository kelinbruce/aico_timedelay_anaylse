// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '../src/features/chat/components/MessageList.tsx';
import { sessionService } from '../src/services/sessionService.ts';
import type { SessionConversationMessage, SessionRunEventHistoryPage, TurnBlock } from '../src/state/contracts.ts';
import { useConversationStore } from '../src/state/conversationStore.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';
import {
  selectBoundedVisibilityTargets,
  useConversationTurnVisibility,
  type ConversationTurnVisibility,
} from '../src/features/chat/history/useConversationTurnVisibility.ts';
import type { ProcessHistoryTargetUpdate } from '../src/features/chat/history/processHistoryScheduler.ts';

function messages(): readonly SessionConversationMessage[] {
  return Array.from({ length: 20 }, (_, index) => {
    const ordinal = index + 1;
    const rootMessageId = `root-${ordinal}`;
    const runId = `run-${ordinal}`;
    return [
      {
        messageId: rootMessageId,
        sessionId: 'session-1',
        requestId: `request-${ordinal}`,
        runId,
        rootMessageId,
        role: 'USER' as const,
        sequence: ordinal * 2 - 1,
        content: `question ${ordinal}`,
        contentType: 'PLAIN_TEXT' as const,
        metadata: {},
        createdAt: `2026-07-22T00:00:${String(ordinal).padStart(2, '0')}.000Z`,
        visible: true,
      },
      {
        messageId: `assistant-${ordinal}`,
        sessionId: 'session-1',
        requestId: `request-${ordinal}`,
        runId,
        rootMessageId,
        role: 'ASSISTANT' as const,
        sequence: ordinal * 2,
        content: `answer ${ordinal}`,
        contentType: 'MARKDOWN' as const,
        metadata: {},
        createdAt: `2026-07-22T00:01:${String(ordinal).padStart(2, '0')}.000Z`,
        visible: true,
      },
    ];
  }).flat();
}

function blocks(): readonly TurnBlock[] {
  return Array.from({ length: 20 }, (_, index) => {
    const ordinal = index + 1;
    const rootMessageId = `root-${ordinal}`;
    return {
      rootMessageId,
      userMessage: messages()[(ordinal - 1) * 2]!,
      aiEvents: [],
      status: 'COMPLETED',
      isLatest: ordinal === 20,
      displayRunId: `run-${ordinal}`,
    };
  });
}

describe('MessageList process-history visibility', () => {
  const observers: Array<{
    readonly callback: IntersectionObserverCallback;
    readonly options: IntersectionObserverInit | undefined;
  }> = [];

  beforeEach(() => {
    observers.length = 0;
    useConversationStore.getState().clearConversation('session-1');
    vi.restoreAllMocks();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null;
        readonly rootMargin = '0px';
        readonly thresholds = [0];
        readonly callback: IntersectionObserverCallback;
        readonly options: IntersectionObserverInit | undefined;

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.callback = callback;
          this.options = options;
          observers.push(this);
        }

        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      },
    );
  });

  afterEach(() => {
    cleanup();
    useConversationStore.getState().clearConversation('session-1');
    vi.unstubAllGlobals();
  });

  it('does not request process history for an offscreen MessageList turn', async () => {
    vi.spyOn(sessionService, 'loadConversation').mockResolvedValue({
      sessionId: 'session-1',
      items: messages(),
      nextCursor: null,
    });
    const pending = new Promise<SessionRunEventHistoryPage>(() => undefined);
    const loadRunEvents = vi.spyOn(sessionService, 'loadRunEvents').mockReturnValue(pending);

    await useConversationStore.getState().loadConversation('session-1');
    render(<MessageList blocks={blocks()} sessionId="session-1" onRetry={() => undefined} onEdit={() => undefined} onCancel={() => undefined} />);

    expect(loadRunEvents).not.toHaveBeenCalled();
  });

  it('bounds viewport before preload and deduplicates the same run', () => {
    const visible = (runId: string, kind: ConversationTurnVisibility['kind'], distanceFromViewportCenter: number): ConversationTurnVisibility => ({
      sessionId: 'session-1',
      rootMessageId: `root-${runId}`,
      runId,
      kind,
      distanceFromViewportCenter,
    });
    const result = selectBoundedVisibilityTargets(
      [
        visible('shared', 'PRELOAD', 1),
        visible('shared', 'VIEWPORT', 5),
        ...Array.from({ length: 20 }, (_, index) => visible(`preload-${index}`, 'PRELOAD', index + 2)),
      ],
      7,
    );

    expect(result).toHaveLength(16);
    expect(result[0]).toMatchObject({
      runId: 'shared',
      priority: 'VIEWPORT',
      generation: 7,
    });
  });

  it('uses the shared viewport, coalesces wheel frames, and waits for pointer release', () => {
    vi.useFakeTimers();
    const hookObservers: Array<{
      readonly callback: IntersectionObserverCallback;
      readonly options: IntersectionObserverInit | undefined;
    }> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null;
        readonly rootMargin = '0px';
        readonly thresholds = [0];
        readonly callback: IntersectionObserverCallback;
        readonly options: IntersectionObserverInit | undefined;

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.callback = callback;
          this.options = options;
          hookObservers.push(this);
        }

        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    const onTargetsChange = vi.fn<(targets: ProcessHistoryTargetUpdate) => void>();

    function Harness() {
      const viewportRef = useRef<HTMLDivElement>(null);
      const containerRef = useRef<HTMLDivElement>(null);
      useConversationTurnVisibility({
        sessionId: 'session-1',
        containerRef,
        viewportRef,
        turnIdentityKey: 'root-1:run-1',
        onTargetsChange,
      });
      return (
        <div ref={viewportRef} data-testid="viewport">
          <div ref={containerRef}>
            <div data-testid="turn" data-root-message-id="root-1" data-process-run-id="run-1" />
          </div>
        </div>
      );
    }

    const rendered = render(<Harness />);
    const viewport = screen.getByTestId('viewport');
    const turn = screen.getByTestId('turn');
    expect(hookObservers).toHaveLength(2);
    expect(hookObservers[0]?.options?.root).toBe(viewport);
    expect(hookObservers[1]?.options).toMatchObject({
      root: viewport,
      rootMargin: '100% 0px',
    });
    act(() => {
      hookObservers[0]?.callback([{ target: turn, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      vi.advanceTimersByTime(120);
    });
    onTargetsChange.mockClear();

    fireEvent.wheel(viewport);
    fireEvent.wheel(viewport);
    act(() => vi.advanceTimersByTime(0));
    expect(onTargetsChange).toHaveBeenCalledOnce();
    expect(onTargetsChange.mock.lastCall?.[0].automatic[0]).toMatchObject({
      runId: 'run-1',
      priority: 'VIEWPORT',
    });

    onTargetsChange.mockClear();
    fireEvent.pointerDown(viewport);
    act(() => {
      hookObservers[0]?.callback([{ target: turn, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      vi.advanceTimersByTime(200);
    });
    expect(onTargetsChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    act(() => vi.advanceTimersByTime(0));
    expect(onTargetsChange).toHaveBeenCalledWith({ automatic: [], explicit: [] });

    onTargetsChange.mockClear();
    rendered.unmount();
    expect(onTargetsChange).toHaveBeenCalledWith({ automatic: [], explicit: [] });
    vi.useRealTimers();
  });
});
