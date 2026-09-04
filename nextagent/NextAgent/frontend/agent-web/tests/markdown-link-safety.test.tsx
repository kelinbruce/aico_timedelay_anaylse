// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

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

// Mock antd Modal.confirm so it doesn't require full antd rendering
const modalConfirmMock = vi.hoisted(() => vi.fn());
vi.mock('antd', () => ({
  Modal: {
    confirm: modalConfirmMock,
  },
  message: { success: vi.fn(), error: vi.fn() },
  ConfigProvider: ({ children }: { children: React.ReactNode }) => children,
  theme: { darkAlgorithm: {}, defaultAlgorithm: {} },
}));

import { MarkdownContent, __renderMarkdownHtmlForTest, __resetMarkdownContentTestState } from '../src/features/chat/components/MarkdownContent.tsx';
import '../src/i18n/index.ts';

let root: Root | null = null;

afterEach(() => {
  if (root) {
    root.unmount();
    root = null;
  }
  __resetMarkdownContentTestState();
  modalConfirmMock.mockReset();
  document.body.innerHTML = '';
});

function renderMarkdown(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  flushSync(() => {
    r.render(createElement(MarkdownContent, { content }));
  });
  return container;
}

describe('__renderMarkdownHtmlForTest - image same-origin constraint', () => {
  it('renders same-origin images as <img>', () => {
    const html = __renderMarkdownHtmlForTest('![alt text](/local/image.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="/local/image.png"');
    expect(html).toContain('alt="alt text"');
  });

  it('shows cross-origin image URL as text, not as <img>', () => {
    const html = __renderMarkdownHtmlForTest('![alt text](https://evil.com/image.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('https://evil.com/image.png');
  });

  it('renders data: URI images (same-origin)', () => {
    const html = __renderMarkdownHtmlForTest('![alt](data:image/png;base64,iVBOR)');
    expect(html).toContain('<img');
    expect(html).toContain('src="data:image/png;base64,iVBOR"');
  });

  it('shows javascript: image URL as text, not as <img>', () => {
    const html = __renderMarkdownHtmlForTest('![alt](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).toContain('javascript:alert(1)');
  });
});

describe('__renderMarkdownHtmlForTest - link target/rel constraint', () => {
  it('adds target=_blank and rel=noopener noreferrer to all links', () => {
    const html = __renderMarkdownHtmlForTest('[link](/local/page)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps href for same-origin links', () => {
    const html = __renderMarkdownHtmlForTest('[link](/local/page)');
    expect(html).toContain('href="/local/page"');
    expect(html).not.toContain('data-external-href');
  });

  it('uses href="#" and data-external-href for cross-origin links', () => {
    const html = __renderMarkdownHtmlForTest('[link](https://evil.com/page)');
    expect(html).toContain('href="#"');
    expect(html).toContain('data-external-href="https://evil.com/page"');
    expect(html).toContain('class="markdown-external-link"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('preserves link text content', () => {
    const html = __renderMarkdownHtmlForTest('[click here](https://evil.com/page)');
    expect(html).toContain('click here');
  });

  it('preserves title attribute on links', () => {
    const html = __renderMarkdownHtmlForTest('[link](/page "My Title")');
    expect(html).toContain('title="My Title"');
  });

  it('shows javascript: link URL as plain text, not as <a>', () => {
    const html = __renderMarkdownHtmlForTest('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('data-external-href');
    expect(html).toContain('javascript:alert(1)');
  });
});

describe('MarkdownContent - external link click confirmation', () => {
  it('shows confirmation modal when clicking cross-origin link', () => {
    const container = renderMarkdown('[link](https://evil.com/page)');
    const link = container.querySelector('a[data-external-href]') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('data-external-href')).toBe('https://evil.com/page');

    link.click();

    expect(modalConfirmMock).toHaveBeenCalledTimes(1);
    const callArg = modalConfirmMock.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(callArg.onOk).toBeDefined();
  });

  it('does not show modal when clicking same-origin link', () => {
    const container = renderMarkdown('[link](/local/page)');
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.classList.contains('markdown-external-link')).toBe(false);

    link.click();

    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it('opens the URL in a new tab when confirmation is accepted', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const container = renderMarkdown('[link](https://evil.com/page)');
    const link = container.querySelector('a[data-external-href]') as HTMLAnchorElement;
    link.click();

    const callArg = modalConfirmMock.mock.calls[0]?.[0];
    callArg.onOk();

    expect(openSpy).toHaveBeenCalledWith('https://evil.com/page', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('does not show modal for javascript: URL in data-external-href', () => {
    const container = renderMarkdown('[link](https://evil.com/page)');
    const link = container.querySelector('a[data-external-href]') as HTMLAnchorElement;
    // Simulate DOM tampering: replace safe URL with dangerous protocol
    link.setAttribute('data-external-href', 'javascript:alert(1)');
    link.click();
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });
});
