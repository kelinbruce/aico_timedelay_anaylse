// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageLayout } from '../src/components/PageLayout.tsx';

afterEach(() => {
  cleanup();
});

describe('PageLayout', () => {
  it('renders the unified header and the default contained layout scroll viewport', () => {
    render(
      <PageLayout title="Network operations">
        <div>Content</div>
      </PageLayout>,
    );

    const header = screen.getByTestId('page-layout-header');
    const title = screen.getByTestId('page-layout-title');
    const contentFrame = screen.getByTestId('page-layout-content-frame');

    expect(header.style.height).toBe('48px');
    expect(header.style.paddingLeft).toBe('16px');
    expect(header.style.paddingRight).toBe('16px');
    expect(title.style.fontSize).toBe('16px');
    expect(title.style.fontWeight).toBe('500');
    expect(title.style.lineHeight).toBe('28px');
    expect(header.style.background).toBe('transparent');
    expect(header.style.boxShadow).toBe('none');
    expect(contentFrame.dataset.contentWidth).toBe('contained');
    expect(contentFrame.style.maxWidth).toBe('1080px');
    expect(screen.getByTestId('page-layout-scroll-viewport')).toBeTruthy();
    expect(screen.queryByTestId('page-layout-footer')).toBeNull();
  });

  it('uses fluid content without adding a layout-owned scrollbar', () => {
    const onBack = vi.fn();
    render(
      <PageLayout title="Favorites" backAction={{ ariaLabel: 'Back to conversation', onClick: onBack }} contentWidth="fluid" scrollOwner="content">
        <div>Content-owned scroll region</div>
      </PageLayout>,
    );

    const contentFrame = screen.getByTestId('page-layout-content-frame');
    expect(contentFrame.dataset.contentWidth).toBe('fluid');
    expect(contentFrame.style.maxWidth).toBe('');
    expect(screen.queryByTestId('page-layout-scroll-viewport')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps a docked footer outside the content viewport and aligned to the content width', () => {
    render(
      <PageLayout title="Settings" footer={<button type="button">Save</button>} contentWidth="contained">
        <div>Scrollable settings</div>
      </PageLayout>,
    );

    const footer = screen.getByTestId('page-layout-footer');
    const footerFrame = screen.getByTestId('page-layout-footer-frame');
    expect(footer.parentElement).toBe(screen.getByTestId('page-layout-root'));
    expect(footerFrame.dataset.contentWidth).toBe('contained');
    expect(footerFrame.style.maxWidth).toBe('1080px');
    expect(screen.queryByTestId('page-layout-footer-overlay')).toBeNull();
  });

  it('renders page-owned actions without reordering or converting them into a menu', () => {
    const onManualCreate = vi.fn();
    const onCreateFromConversation = vi.fn();
    render(
      <PageLayout
        title="Cron tasks"
        actions={
          <div data-testid="cron-owned-actions">
            <button type="button" onClick={onManualCreate}>
              Manual create
            </button>
            <button type="button" onClick={onCreateFromConversation}>
              Create from conversation
            </button>
          </div>
        }
      >
        <div>Content</div>
      </PageLayout>,
    );

    expect(screen.getByTestId('cron-owned-actions').parentElement).toBe(screen.getByTestId('page-layout-actions'));
    expect(screen.queryByTestId('page-layout-more-actions')).toBeNull();
    expect(screen.getByTestId('page-layout-header-content').style.flexWrap).toBe('nowrap');

    fireEvent.click(screen.getByRole('button', { name: 'Manual create' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create from conversation' }));
    expect(onManualCreate).toHaveBeenCalledTimes(1);
    expect(onCreateFromConversation).toHaveBeenCalledTimes(1);
  });
});
