// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RightPaneLayout } from '../src/components/RightPaneLayout.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RightPaneLayout scroll shell', () => {
  it('preserves the chat shell ids while using the unified header geometry', () => {
    render(
      <RightPaneLayout title="Chat" footer={<div data-testid="composer">Composer</div>}>
        <div data-testid="chat-body">Body</div>
      </RightPaneLayout>,
    );

    const header = screen.getByTestId('right-pane-header');
    const title = screen.getByTestId('right-pane-title');
    expect(header.style.height).toBe('48px');
    expect(header.style.paddingLeft).toBe('16px');
    expect(header.style.paddingRight).toBe('16px');
    expect(title.style.fontSize).toBe('16px');
    expect(title.style.fontWeight).toBe('500');
    expect(title.style.lineHeight).toBe('28px');
    expect(header.style.background).toBe('transparent');
    expect(header.style.boxShadow).toBe('none');
    expect(screen.getByTestId('right-pane-main').parentElement).toBe(header.parentElement);
    expect(screen.getByTestId('right-pane-scroll-viewport').parentElement).toBe(screen.getByTestId('right-pane-main'));
  });

  it('renders a full-width scroll viewport separate from the centered content column', () => {
    render(
      <RightPaneLayout title="Chat" footer={<div data-testid="composer">Composer</div>}>
        <div data-testid="chat-body">Body</div>
      </RightPaneLayout>,
    );

    const scrollViewport = screen.getByTestId('right-pane-scroll-viewport');
    expect(scrollViewport).toBeTruthy();
    expect(screen.getByTestId('right-pane-content-column')).toBeTruthy();
    expect(screen.getByTestId('right-pane-footer-overlay')).toBeTruthy();
    expect(scrollViewport.classList.contains('right-pane-scroll-viewport')).toBe(true);
    expect(scrollViewport.classList.contains('nextagent-themed-scrollbar')).toBe(true);
    expect(scrollViewport.style.background).toBe('');
    expect(scrollViewport.style.scrollbarColor).toBe('var(--color-scrollbar) transparent');
    expect(scrollViewport.style.zIndex).toBe('0');
    expect(scrollViewport.style.inset).toBe('0px');
    const footerOverlay = screen.getByTestId('right-pane-footer-overlay');
    expect(footerOverlay.style.zIndex).toBe('4');
    expect(footerOverlay.style.background).toBe('');
    expect(screen.getByTestId('right-pane-footer-surface').style.background).toBe('var(--color-chat-pane-bg)');
  });

  it('keeps overlay footer content aligned with the scroll viewport gutter', () => {
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === 'right-pane-scroll-viewport' ? 1020 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === 'right-pane-scroll-viewport' ? 1005 : 0;
      },
    });

    try {
      render(
        <RightPaneLayout title="Chat" footer={<div data-testid="composer">Composer</div>}>
          <div data-testid="chat-body">Body</div>
        </RightPaneLayout>,
      );

      expect(screen.getByTestId('right-pane-scroll-viewport').style.scrollbarGutter).toBe('stable');
      expect(screen.getByTestId('right-pane-footer-overlay').style.right).toBe('15px');
      expect(screen.getByTestId('right-pane-footer-content-frame').style.paddingRight).toBe('16px');
    } finally {
      if (originalOffsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      }
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      }
    }
  });

  it('can center the body shell without changing the scroll viewport container', () => {
    render(
      <RightPaneLayout title="Welcome" footer={<div data-testid="composer">Composer</div>} centerContent>
        <div data-testid="chat-body">Body</div>
      </RightPaneLayout>,
    );

    expect(screen.getByTestId('right-pane-scroll-viewport')).toBeTruthy();
    expect(screen.getByTestId('right-pane-content-column').style.height).toBe('100%');
    expect(screen.getByTestId('right-pane-content-column').style.boxSizing).toBe('border-box');
    expect(screen.getByTestId('right-pane-body-shell').style.justifyContent).toBe('center');
    expect(screen.getByTestId('right-pane-body-shell').style.height).toBe('100%');
  });

  it('centers the floating overlay but reserves only the measured footer surface inside scroll content', () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === 'right-pane-footer-surface' ? 132 : 0;
      },
    });

    try {
      render(
        <RightPaneLayout title="Chat" footer={<div data-testid="composer">Composer</div>} floatingOverlay={<button type="button">Latest</button>}>
          <div data-testid="chat-body">Body</div>
        </RightPaneLayout>,
      );

      const floatingOverlay = screen.getByTestId('right-pane-floating-overlay');
      expect(floatingOverlay.style.justifyContent).toBe('center');
      expect(screen.getByTestId('right-pane-floating-frame').style.maxWidth).toBe('1080px');
      expect(screen.getByTestId('right-pane-floating-frame').style.boxSizing).toBe('border-box');
      expect(screen.getByTestId('right-pane-scroll-viewport').style.inset).toBe('0px');
      expect(screen.getByTestId('right-pane-content-column').style.paddingBottom).toBe('132px');
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
      }
    }
  });

  it('keeps the overlay footer height observer when only the footer node changes', () => {
    let overlayObserveCount = 0;
    let overlayDisconnectCount = 0;
    class TestResizeObserver {
      private observesOverlayFooter = false;

      constructor(_callback: ResizeObserverCallback) {}

      observe(target: Element): void {
        if ((target as HTMLElement).dataset.testid === 'right-pane-footer-surface') {
          this.observesOverlayFooter = true;
          overlayObserveCount += 1;
        }
      }

      disconnect(): void {
        if (this.observesOverlayFooter) {
          overlayDisconnectCount += 1;
        }
      }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    const { rerender } = render(
      <RightPaneLayout title="Chat" footer={<div>Composer A</div>}>
        <div>Body</div>
      </RightPaneLayout>,
    );

    expect(overlayObserveCount).toBe(1);
    rerender(
      <RightPaneLayout title="Chat" footer={<div>Composer B</div>}>
        <div>Body</div>
      </RightPaneLayout>,
    );

    expect(overlayObserveCount).toBe(1);
    expect(overlayDisconnectCount).toBe(0);
  });
});
