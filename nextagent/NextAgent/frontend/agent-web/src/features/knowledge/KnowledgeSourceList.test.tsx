// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../chat/components/MarkdownContent.tsx', () => ({
  MarkdownContent: ({ content }: { readonly content: string }) => <div data-testid="markdown-content">{content}</div>,
}));

vi.mock('antd', () => ({
  Modal: ({ children, open }: { readonly children?: ReactNode; readonly open?: boolean }) =>
    open ? <div data-testid="antd-modal">{children}</div> : null,
}));

import { KnowledgeSourceList, resolveKnowledgeTitle, type KnowledgeSourceItem } from './KnowledgeSourceList.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('resolveKnowledgeTitle', () => {
  it('takes first segment of source split by pipe', () => {
    const item: KnowledgeSourceItem = { source: 'kb-a | kb-b | kb-c', title: 'doc', knowledge: 'k' };
    expect(resolveKnowledgeTitle(item)).toBe('kb-a');
  });

  it('trims whitespace around first source segment', () => {
    const item: KnowledgeSourceItem = { source: '  kb-a  | kb-b', title: 'doc', knowledge: 'k' };
    expect(resolveKnowledgeTitle(item)).toBe('kb-a');
  });

  it('falls back to title when source is empty', () => {
    const item: KnowledgeSourceItem = { source: '', title: 'network-doc', knowledge: 'k' };
    expect(resolveKnowledgeTitle(item)).toBe('network-doc');
  });

  it('falls back to title when source is whitespace-only', () => {
    const item: KnowledgeSourceItem = { source: '   ', title: 'fallback', knowledge: 'k' };
    expect(resolveKnowledgeTitle(item)).toBe('fallback');
  });

  it('falls back to knowledge prefix when source and title are empty', () => {
    const knowledge = 'a'.repeat(250);
    const item: KnowledgeSourceItem = { source: '', title: '', knowledge };
    expect(resolveKnowledgeTitle(item)).toBe(knowledge.slice(0, 100));
  });

  it('falls back to knowledge prefix when source and title are whitespace-only', () => {
    const knowledge = 'a'.repeat(250);
    const item: KnowledgeSourceItem = { source: '   ', title: '  ', knowledge };
    expect(resolveKnowledgeTitle(item)).toBe(knowledge.slice(0, 100));
  });
});

describe('KnowledgeSourceList', () => {
  it('renders list items with resolved titles', () => {
    const data: readonly KnowledgeSourceItem[] = [
      { source: 'kb-a | kb-b', title: 'doc-a', knowledge: 'ka' },
      { source: '', title: 'doc-b', knowledge: 'kb' },
    ];
    render(<KnowledgeSourceList data={data} />);

    expect(screen.getByText('kb-a')).toBeTruthy();
    expect(screen.getByText('doc-b')).toBeTruthy();
    expect(screen.getAllByTestId('knowledge-source-item')).toHaveLength(2);
  });

  it('renders empty list without errors when data is empty', () => {
    render(<KnowledgeSourceList data={[]} />);
    expect(screen.queryAllByTestId('knowledge-source-item')).toHaveLength(0);
    expect(screen.queryByTestId('antd-modal')).toBeNull();
  });

  it('opens modal with MarkdownContent when list item is clicked', () => {
    const data: readonly KnowledgeSourceItem[] = [{ source: 'kb-a', title: 'doc', knowledge: '# Heading' }];
    render(<KnowledgeSourceList data={data} />);

    expect(screen.queryByTestId('antd-modal')).toBeNull();

    fireEvent.click(screen.getByText('kb-a'));

    expect(screen.getByTestId('antd-modal')).toBeTruthy();
    expect(screen.getByTestId('markdown-content')).toBeTruthy();
    expect(screen.getByTestId('markdown-content').textContent).toBe('# Heading');
  });

  it('replaces modal content when another item is clicked', () => {
    const data: readonly KnowledgeSourceItem[] = [
      { source: 'kb-a', title: 'doc-a', knowledge: 'content-a' },
      { source: 'kb-b', title: 'doc-b', knowledge: 'content-b' },
    ];
    render(<KnowledgeSourceList data={data} />);

    fireEvent.click(screen.getByText('kb-a'));
    expect(screen.getByTestId('markdown-content').textContent).toBe('content-a');

    fireEvent.click(screen.getByText('kb-b'));
    expect(screen.getByTestId('markdown-content').textContent).toBe('content-b');
    expect(screen.getAllByTestId('antd-modal')).toHaveLength(1);
  });
});
