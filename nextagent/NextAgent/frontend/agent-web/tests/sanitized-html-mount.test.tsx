// @vitest-environment jsdom
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownContent } from '../src/features/chat/components/MarkdownContent.tsx';
import { SanitizedHtmlDiv } from '../src/features/chat/components/SanitizedHtml.tsx';

afterEach(() => {
  document.body.replaceChildren();
});

describe('sanitized HTML mounting', () => {
  it('mounts parsed HTML content without stale nodes', () => {
    const { container, rerender } = render(<SanitizedHtmlDiv html="<p>first</p>" />);

    expect(container.querySelector('p')?.textContent).toBe('first');

    rerender(<SanitizedHtmlDiv html="<ul><li>second</li></ul>" />);

    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('li')?.textContent).toBe('second');
  });

  it('does not mount executable raw HTML from assistant Markdown', () => {
    const { container } = render(<MarkdownContent content={'<script>window.__markdownXss="executed"</script>**网络诊断**'} />);

    expect(container.querySelector('script')).toBeNull();
    expect((window as typeof window & { readonly __markdownXss?: unknown }).__markdownXss).toBeUndefined();
    expect(container.textContent).toContain('网络诊断');
  });

  it('keeps browser production source free of direct raw HTML assignment', () => {
    const sourceRoot = path.resolve(__dirname, '..', 'src');
    const offenders: string[] = [];
    const collectFiles = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }) as Dirent[]) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          collectFiles(entryPath);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) {
          continue;
        }
        if (/\bdangerouslySetInnerHTML\b|\binnerHTML\s*=/.test(readFileSync(entryPath, 'utf8'))) {
          offenders.push(path.relative(sourceRoot, entryPath));
        }
      }
    };

    collectFiles(sourceRoot);

    expect(offenders).toEqual([]);
  });
});
