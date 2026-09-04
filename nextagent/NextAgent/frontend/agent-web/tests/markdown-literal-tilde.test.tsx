// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

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

import { __renderMarkdownHtmlForTest } from '../src/features/chat/components/MarkdownContent.tsx';

describe('single tilde literal rendering', () => {
  it('renders lone tildes in mount info as literal text without strikethrough', () => {
    const content = [
      '24308 24300 253:18 /pods/7cc54013/volumes/kubernetes.io~configmap/timezone /etc/timezone ro,relatime - ext4 /dev/mapper/caasvg-lv7 rw,prjquota,stripe=384',
      '24309 24300 253:18 /pods/7cc54013/volumes/kubernetes.io~empty-dir/logdir /opt/log rw',
    ].join('\n');

    const html = __renderMarkdownHtmlForTest(content);

    expect(html).not.toContain('<del>');
    expect(html).toContain('kubernetes.io~configmap/timezone');
    expect(html).toContain('kubernetes.io~empty-dir/logdir');
  });

  it('still renders double-tilde strikethrough', () => {
    const html = __renderMarkdownHtmlForTest('~~deprecated~~');
    expect(html).toContain('<del>deprecated</del>');
  });

  it('keeps tildes literal inside code fences and inline code', () => {
    expect(__renderMarkdownHtmlForTest('```\npath~with~tilde\n```')).toContain('path~with~tilde');
    expect(__renderMarkdownHtmlForTest('use `a~b` here', true)).toContain('<code>a~b</code>');
  });
});
