// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatViewportController } from '../src/features/chat/hooks/useChatViewportController';

class MockResizeObserver {
  private static readonly observedCallbacks = new Map<Element, Set<ResizeObserverCallback>>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const callbacks = MockResizeObserver.observedCallbacks.get(target) ?? new Set<ResizeObserverCallback>();
    callbacks.add(this.callback);
    MockResizeObserver.observedCallbacks.set(target, callbacks);
  }

  unobserve(target: Element): void {
    const callbacks = MockResizeObserver.observedCallbacks.get(target);
    callbacks?.delete(this.callback);
    if (callbacks?.size === 0) {
      MockResizeObserver.observedCallbacks.delete(target);
    }
  }

  disconnect(): void {
    for (const [target, callbacks] of MockResizeObserver.observedCallbacks.entries()) {
      callbacks.delete(this.callback);
      if (callbacks.size === 0) {
        MockResizeObserver.observedCallbacks.delete(target);
      }
    }
  }

  static reset(): void {
    MockResizeObserver.observedCallbacks.clear();
  }

  static trigger(target: Element): void {
    const callbacks = MockResizeObserver.observedCallbacks.get(target);
    callbacks?.forEach((callback) => {
      callback([{ target } as ResizeObserverEntry], {} as ResizeObserver);
    });
  }
}

function mockScrollableViewport(
  viewport: HTMLDivElement & {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
    scrollTo: typeof HTMLElement.prototype.scrollTo;
  },
  options?: {
    scrollHeight?: number;
    clientHeight?: number;
    scrollTop?: number;
  },
) {
  const scrollHeight = options?.scrollHeight ?? 1000;
  const clientHeight = options?.clientHeight ?? 400;
  const scrollTop = options?.scrollTop ?? scrollHeight - clientHeight;

  Object.defineProperty(viewport, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(viewport, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(viewport, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  viewport.scrollTo = vi.fn((...args: [ScrollToOptions] | [number, number]) => {
    const [firstArg, secondArg] = args;
    if (typeof firstArg === 'number') {
      viewport.scrollTop = secondArg ?? viewport.scrollTop;
      return;
    }
    if (typeof firstArg?.top === 'number') {
      viewport.scrollTop = firstArg.top;
    }
  }) as typeof viewport.scrollTo;
}

function setViewportScrollHeight(viewport: HTMLDivElement, scrollHeight: number): void {
  Object.defineProperty(viewport, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
}

function ViewportHarness({
  sessionId = 'session-1',
  isConversationLoading = false,
  isAnchoredConversation = false,
  activeSessionEventCount = 1,
  hasOlderMessages = false,
  isLoadingOlder = false,
  loadOlderConversation = async () => false,
}: {
  readonly sessionId?: string;
  readonly isConversationLoading?: boolean;
  readonly isAnchoredConversation?: boolean;
  readonly activeSessionEventCount?: number;
  readonly hasOlderMessages?: boolean;
  readonly isLoadingOlder?: boolean;
  readonly loadOlderConversation?: (sessionId: string) => Promise<boolean>;
}) {
  const viewport = useChatViewportController({
    sessionId,
    latestEnvelopeCursor: 'event-1:1',
    turnBlockCursor: 'turn-1:EXECUTING:1',
    isConversationLoading,
    shouldShowWelcome: false,
    isAnchoredConversation,
    activeSessionEventCount,
    hasOlderMessages,
    isLoadingOlder,
    loadOlderConversation,
  });

  return (
    <>
      <button type="button" onClick={viewport.stopFollowingBottom}>
        stop following
      </button>
      <button type="button" onClick={viewport.scrollToBottom}>
        scroll to bottom
      </button>
      <button type="button" onClick={viewport.requestScrollToBottomIfFollowing}>
        follow latest
      </button>
      <div
        ref={viewport.scrollViewportRef}
        data-testid="viewport"
        data-at-bottom={String(viewport.isAtBottom)}
        data-following-bottom={String(viewport.isFollowingBottom)}
        onScroll={viewport.handleScroll}
        onWheel={viewport.handleViewportWheel}
      >
        <div data-testid="content-column">
          <div data-testid="turn-block" data-root-message-id="turn-1">
            streaming answer
          </div>
        </div>
      </div>
    </>
  );
}

describe('useChatViewportController', () => {
  beforeEach(() => {
    let frameId = 0;
    MockResizeObserver.reset();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      callback(frameId * 16);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    MockResizeObserver.reset();
  });

  it('sticks to the latest scroll height when followed content grows without a new stream envelope', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);

    setViewportScrollHeight(viewport, 1240);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.scrollTop).toBe(1240);
  });

  it('coalesces same-frame follow requests into one final bottom pin', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(<ViewportHarness activeSessionEventCount={0} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);

    setViewportScrollHeight(viewport, 1240);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
      fireEvent.click(screen.getByRole('button', { name: 'follow latest' }));
    });

    expect(viewport.scrollTop).toBe(600);
    expect(viewport.scrollTo).not.toHaveBeenCalled();
    expect(queuedFrames).toHaveLength(1);

    act(() => queuedFrames.shift()?.(16));

    expect(viewport.scrollTop).toBe(1240);
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
    expect(viewport.dataset.atBottom).toBe('true');
  });

  it('reuses ResizeObserver bottom geometry in the scheduled follow frame', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(<ViewportHarness activeSessionEventCount={0} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1000, clientHeight: 400 });

    let scrollHeightReads = 0;
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => {
        scrollHeightReads += 1;
        return 1240;
      },
    });

    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });
    expect(scrollHeightReads).toBe(1);

    act(() => queuedFrames.shift()?.(16));

    expect(scrollHeightReads).toBe(1);
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 1240, behavior: 'auto' });
  });

  it('does not steal scroll position after the user leaves bottom-following mode', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);
    fireEvent.scroll(viewport);

    viewport.scrollTop = 540;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    setViewportScrollHeight(viewport, 1240);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.scrollTop).toBe(540);
  });

  it('does not pull back to bottom when content grows between wheel-up and the scroll-state rAF', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);
    fireEvent.scroll(viewport);

    viewport.scrollTop = 540;
    fireEvent.wheel(viewport, { deltaY: -30 });

    setViewportScrollHeight(viewport, 1240);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.scrollTop).toBe(540);
  });

  it('does not pull back to bottom when scrollbar movement occurs before the scroll-state rAF', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);
    fireEvent.scroll(viewport);
    act(() => queuedFrames.shift()?.(16));

    viewport.scrollTop = 540;
    fireEvent.scroll(viewport);

    setViewportScrollHeight(viewport, 1240);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.dataset.followingBottom).toBe('false');
    expect(viewport.scrollTop).toBe(540);
  });

  it('does not push back when user scrolls down while content is streaming', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(viewport);

    viewport.scrollTop = 1000;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    setViewportScrollHeight(viewport, 2100);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    viewport.scrollTop = 1100;
    fireEvent.wheel(viewport, { deltaY: 30 });
    fireEvent.scroll(viewport);

    setViewportScrollHeight(viewport, 2200);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.scrollTop).toBe(1100);
  });

  it('loads one older page when upward scrolling reaches the top boundary', async () => {
    const loadOlderConversation = vi.fn().mockResolvedValue(true);
    render(<ViewportHarness hasOlderMessages loadOlderConversation={loadOlderConversation} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1200, clientHeight: 400, scrollTop: 240 });
    fireEvent.scroll(viewport);
    viewport.scrollTop = 96;

    await act(async () => {
      fireEvent.scroll(viewport);
      await Promise.resolve();
    });

    expect(loadOlderConversation).toHaveBeenCalledTimes(1);
    expect(loadOlderConversation).toHaveBeenCalledWith('session-1');
  });

  it('loads older from an upward wheel at the boundary without cascading after compensation', async () => {
    const loadOlderConversation = vi.fn(async () => {
      setViewportScrollHeight(screen.getByTestId('viewport'), 1600);
      return true;
    });
    render(<ViewportHarness hasOlderMessages loadOlderConversation={loadOlderConversation} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1200, clientHeight: 400, scrollTop: 80 });

    await act(async () => {
      fireEvent.wheel(viewport, { deltaY: -40 });
      await Promise.resolve();
    });
    fireEvent.scroll(viewport);

    expect(loadOlderConversation).toHaveBeenCalledTimes(1);
    expect(viewport.scrollTop).toBe(480);
  });

  it('does not request older while the current older page is loading', () => {
    const loadOlderConversation = vi.fn().mockResolvedValue(true);
    render(<ViewportHarness hasOlderMessages isLoadingOlder loadOlderConversation={loadOlderConversation} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1200, clientHeight: 400, scrollTop: 80 });
    fireEvent.wheel(viewport, { deltaY: -40 });

    expect(loadOlderConversation).not.toHaveBeenCalled();
  });

  it('does not request older while the conversation window is loading', () => {
    const loadOlderConversation = vi.fn().mockResolvedValue(true);
    render(<ViewportHarness isConversationLoading hasOlderMessages loadOlderConversation={loadOlderConversation} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1200, clientHeight: 400, scrollTop: 80 });
    fireEvent.wheel(viewport, { deltaY: -40 });

    expect(loadOlderConversation).not.toHaveBeenCalled();
  });

  it('does not restore bottom-following until the viewport reaches the physical bottom tolerance', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(viewport);

    viewport.scrollTop = 1000;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    viewport.scrollTop = 1560;
    fireEvent.wheel(viewport, { deltaY: 30 });
    fireEvent.scroll(viewport);

    expect(viewport.dataset.atBottom).toBe('false');
    expect(viewport.dataset.followingBottom).toBe('false');

    viewport.scrollTop = 1598;
    fireEvent.scroll(viewport);

    setViewportScrollHeight(viewport, 2100);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.scrollTop).toBe(2100);
  });

  it('reports physical bottom only after the explicit scroll transition completes', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(viewport);
    viewport.scrollTop = 1000;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    let frameId = 0;
    let timestamp = 0;
    const frames: Array<{ readonly id: number; readonly callback: FrameRequestCallback }> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.push({ id: frameId, callback });
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const index = frames.findIndex((frame) => frame.id === id);
      if (index >= 0) {
        frames.splice(index, 1);
      }
    });

    fireEvent.click(screen.getByRole('button', { name: 'scroll to bottom' }));

    expect(viewport.dataset.followingBottom).toBe('true');
    expect(viewport.dataset.atBottom).toBe('false');

    act(() => {
      for (let index = 0; index < 2; index += 1) {
        const frame = frames.shift()!;
        timestamp += 16;
        frame.callback(timestamp);
      }
    });
    fireEvent.scroll(viewport);

    act(() => {
      let completedFrames = 0;
      while (frames.length > 0 && completedFrames < 30) {
        const frame = frames.shift()!;
        timestamp += 16;
        frame.callback(timestamp);
        completedFrames += 1;
      }
    });

    expect(viewport.scrollTop).toBe(2000);
    expect(viewport.dataset.atBottom).toBe('true');
  });

  it('does not reread bottom geometry during an explicit scroll transition frame', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(<ViewportHarness activeSessionEventCount={0} />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 2000, clientHeight: 400, scrollTop: 1000 });
    fireEvent.wheel(viewport, { deltaY: -30 });

    let scrollHeightReads = 0;
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => {
        scrollHeightReads += 1;
        return 2000;
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'scroll to bottom' }));
    expect(scrollHeightReads).toBe(1);

    act(() => queuedFrames.shift()?.(16));
    fireEvent.scroll(viewport);

    expect(scrollHeightReads).toBe(1);
  });

  it('reports the real physical-bottom state when review mode stops following on short content', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 300, clientHeight: 400, scrollTop: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'stop following' }));

    expect(viewport.dataset.atBottom).toBe('true');
    expect(viewport.dataset.followingBottom).toBe('false');
  });

  it('does not restore bottom-following from physical scroll while the conversation is anchored', () => {
    render(<ViewportHarness isAnchoredConversation />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });
    fireEvent.click(screen.getByRole('button', { name: 'stop following' }));

    viewport.scrollTop = 600;
    fireEvent.scroll(viewport);

    expect(viewport.dataset.atBottom).toBe('true');
    expect(viewport.dataset.followingBottom).toBe('false');
  });

  it('does not auto-follow content growth when the conversation opens anchored', () => {
    render(<ViewportHarness isAnchoredConversation />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });

    setViewportScrollHeight(viewport, 1240);
    act(() => {
      MockResizeObserver.trigger(screen.getByTestId('content-column'));
    });

    expect(viewport.scrollTop).toBe(520);
    expect(viewport.dataset.followingBottom).toBe('false');
  });

  it('resets physical-bottom and following state when the active session changes', () => {
    const { rerender } = render(<ViewportHarness />);
    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);
    fireEvent.scroll(viewport);
    viewport.scrollTop = 540;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);
    expect(viewport.dataset.followingBottom).toBe('false');

    rerender(<ViewportHarness sessionId="session-2" />);

    expect(viewport.dataset.atBottom).toBe('true');
    expect(viewport.dataset.followingBottom).toBe('true');
  });

  it('defers reading-anchor DOM scans until scrolling settles', () => {
    vi.useFakeTimers();
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport);
    const querySelectorAllSpy = vi.spyOn(viewport, 'querySelectorAll');

    fireEvent.scroll(viewport);
    viewport.scrollTop = 540;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    expect(querySelectorAllSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(querySelectorAllSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(querySelectorAllSpy).toHaveBeenCalledTimes(1);
  });

  it('scrolls to bottom unconditionally via scrollToBottom when the user is not following bottom', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(viewport);

    viewport.scrollTop = 1000;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    expect(viewport.dataset.followingBottom).toBe('false');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'scroll to bottom' }));
    });

    expect(viewport.scrollTop).toBe(2000);
    expect(viewport.dataset.followingBottom).toBe('true');
    expect(viewport.dataset.atBottom).toBe('true');
  });

  it('does not scroll when requestScrollToBottomIfFollowing is called while not following bottom', () => {
    render(<ViewportHarness />);

    const viewport = screen.getByTestId('viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(viewport, { scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(viewport);

    viewport.scrollTop = 1000;
    fireEvent.wheel(viewport, { deltaY: -30 });
    fireEvent.scroll(viewport);

    expect(viewport.dataset.followingBottom).toBe('false');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'follow latest' }));
    });

    expect(viewport.scrollTop).toBe(1000);
    expect(viewport.dataset.followingBottom).toBe('false');
  });
});
