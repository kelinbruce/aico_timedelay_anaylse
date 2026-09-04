// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { LazyMermaid } from '../src/features/chat/components/LazyMermaid.tsx';

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
    if (!callbacks) {
      return;
    }
    callbacks.delete(this.callback);
    if (callbacks.size === 0) {
      MockResizeObserver.observedCallbacks.delete(target);
    }
  }

  disconnect(): void {}

  static trigger(target: Element) {
    const callbacks = MockResizeObserver.observedCallbacks.get(target);
    if (!callbacks) {
      return;
    }
    for (const callback of callbacks) {
      callback([{ target } as ResizeObserverEntry], {} as ResizeObserver);
    }
  }
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  (globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

afterEach(() => {
  cleanup();
});

describe('LazyMermaid component', () => {
  it('renders sanitized svg output on the main thread', async () => {
    mermaidMock.render.mockResolvedValue({
      svg: '<svg><script>alert(1)</script><foreignObject /><a href="javascript:evil()" style="color:red"><g onload=evil()><text>diagram</text></g></a></svg>',
    });

    const { container } = render(<LazyMermaid content="graph TD;A-->B;" />);

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeTruthy();
    });

    const diagramContainer = container.querySelector('.mermaid-rendered-diagram');
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.style.marginTop).toBe('16px');
    expect(root?.style.marginBottom).toBe('16px');
    expect(root?.classList.contains('markdown-mermaid-scroll')).toBe(true);
    expect(root?.style.overflowX).toBe('auto');
    expect(root?.style.overflowY).toBe('hidden');
    expect(root?.style.justifyContent).toBe('flex-start');
    expect((diagramContainer as HTMLElement | null)?.style.minWidth).toBe('560px');
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('onload=');
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('foreignObject');
    expect(container.innerHTML).not.toContain('style="color:red"');
    expect(diagramContainer?.innerHTML).toContain('width:100%');
    expect(diagramContainer?.innerHTML).toContain('max-width:none');
    expect(mermaidMock.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when mermaid rendering fails', async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error('invalid mermaid'));

    render(<LazyMermaid content="graph TD;A-->B;" />);

    await waitFor(() => {
      expect(screen.getByText(/Mermaid/)).toBeTruthy();
    });
  });

  it('ignores stale render failures after newer content renders successfully', async () => {
    let rejectFirstRender: ((reason?: unknown) => void) | undefined;
    let resolveSecondRender: ((value: { svg: string }) => void) | undefined;
    mermaidMock.render
      .mockImplementationOnce(
        () =>
          new Promise<{ svg: string }>((_resolve, reject) => {
            rejectFirstRender = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ svg: string }>((resolve) => {
            resolveSecondRender = resolve;
          }),
      );

    const { container, rerender } = render(<LazyMermaid content="graph TD;A-->B;" />);

    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    });

    rerender(<LazyMermaid content="graph TD;A-->C;" />);

    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledTimes(2);
    });

    resolveSecondRender?.({ svg: '<svg><text>updated</text></svg>' });

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeTruthy();
      expect(container.textContent).toContain('updated');
    });

    rejectFirstRender?.(new Error('invalid mermaid'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText(/Mermaid 图表渲染失败/)).toBeNull();
    expect(container.textContent).toContain('updated');
  });

  it('suppresses document overflow while rendering and restores it afterwards', async () => {
    let resolveRender: ((value: { svg: string }) => void) | undefined;
    mermaidMock.render.mockImplementation(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          resolveRender = resolve;
        }),
    );

    render(<LazyMermaid content="graph TD;A-->B;" />);

    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    });

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    resolveRender?.({ svg: '<svg><text>diagram</text></svg>' });

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
      expect(document.documentElement.style.overflow).toBe('');
    });
  });

  it('notifies the parent again when the rendered diagram grows after initial paint', async () => {
    mermaidMock.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 100 100"><text>diagram</text></svg>',
    });

    const onRendered = vi.fn();
    const { container } = render(<LazyMermaid content="graph TD;A-->B;" onRendered={onRendered} />);

    const root = container.firstElementChild as HTMLDivElement;
    let measuredHeight = 140;
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          width: 320,
          height: measuredHeight,
          top: 0,
          left: 0,
          right: 320,
          bottom: measuredHeight,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    await waitFor(() => {
      expect(onRendered).toHaveBeenCalledTimes(1);
    });

    measuredHeight = 420;
    MockResizeObserver.trigger(root);

    await waitFor(() => {
      expect(onRendered).toHaveBeenCalledTimes(2);
    });
  });
});
