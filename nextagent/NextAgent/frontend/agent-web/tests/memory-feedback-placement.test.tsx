// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { App as AntdApp } from 'antd';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useShellFeedbackTop } from '../src/app/useShellFeedbackTop.ts';

function FeedbackTrigger() {
  const { message } = AntdApp.useApp();
  return (
    <button type="button" onClick={() => message.success({ content: '操作成功', duration: 0 })}>
      Show feedback
    </button>
  );
}

function FeedbackHarness({ contentTop }: { readonly contentTop: number }) {
  const contentRef = useRef<HTMLElement | null>(null);
  const contentTopRef = useRef(contentTop);
  contentTopRef.current = contentTop;
  const setContentRef = useCallback((node: HTMLElement | null) => {
    if (node !== null) {
      node.getBoundingClientRect = () => ({
        bottom: contentTopRef.current + 400,
        height: 400,
        left: 0,
        right: 800,
        top: contentTopRef.current,
        width: 800,
        x: 0,
        y: contentTopRef.current,
        toJSON: () => ({}),
      });
    }
    contentRef.current = node;
  }, []);
  const feedbackTop = useShellFeedbackTop(contentRef);

  return (
    <AntdApp component={false} message={{ top: feedbackTop }}>
      <main ref={setContentRef} className="ltm-main">
        <FeedbackTrigger />
      </main>
    </AntdApp>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('shell feedback placement', () => {
  it.each([
    { layout: 'LEFT', contentTop: 0, expectedTop: '12px' },
    { layout: 'RIGHT', contentTop: 54, expectedTop: '66px' },
  ])('places $layout feedback below the actual content top', async ({ contentTop, expectedTop }) => {
    const { container } = render(<FeedbackHarness contentTop={contentTop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show feedback' }));

    await waitFor(() => {
      expect(document.body.querySelector<HTMLElement>('.ant-message')?.style.top).toBe(expectedTop);
    });
    expect(container.querySelector('.ltm-main .ant-message')).toBeNull();
    expect(document.body.querySelector('.ant-message')).toBeTruthy();
  });

  it('recomputes the feedback offset after shell layout resize', async () => {
    const { rerender } = render(<FeedbackHarness contentTop={54} />);
    rerender(<FeedbackHarness contentTop={72} />);
    fireEvent(window, new Event('resize'));
    fireEvent.click(screen.getByRole('button', { name: 'Show feedback' }));

    await waitFor(() => {
      expect(document.body.querySelector<HTMLElement>('.ant-message')?.style.top).toBe('84px');
    });
  });

  it('forbids static message calls and host-menu height coupling', () => {
    const pageSource = readFileSync(path.resolve(process.cwd(), 'src/pages/MemoryManagePage.tsx'), 'utf8');
    const shellSource = readFileSync(path.resolve(process.cwd(), 'src/app/ImmersiveApp.tsx'), 'utf8');
    const hookSource = readFileSync(path.resolve(process.cwd(), 'src/app/useShellFeedbackTop.ts'), 'utf8');

    expect(pageSource).not.toMatch(/import\s*\{[^}]*\bmessage\b[^}]*\}\s*from\s*["']antd["']/);
    expect(pageSource).not.toMatch(/\bmessage\.(success|warning|error)\b/);
    expect(shellSource).not.toContain('PREL_MENU_HEIGHT');
    expect(hookSource).toContain('ResizeObserver');
    expect(hookSource).toContain('getBoundingClientRect().top');
  });
});
