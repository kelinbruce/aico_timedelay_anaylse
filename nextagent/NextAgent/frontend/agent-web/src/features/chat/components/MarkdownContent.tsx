import React, { memo, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import xss, { escapeHtml, getDefaultWhiteList, type IFilterXSSOptions } from 'xss';
import { MarkdownWithTables } from '../../../components/MarkdownWithTables.tsx';
import { normalizeBrokenMarkdownTables, normalizeMarkdownBlockSpacing } from '../utils/markdownFormatting.ts';
import { LazyMermaid } from './LazyMermaid.tsx';
import { SanitizedHtmlDiv, SanitizedHtmlSpan } from './SanitizedHtml.tsx';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { isSameOriginUrl, isSafeNavigationUrl } from '../../../utils/urlSafety.ts';

const MARKDOWN_AST_CACHE_LIMIT = 300;
const MAX_CACHEABLE_MARKDOWN_CHARS = 50_000;
const SHORT_STREAMING_TEXT_MAX_LENGTH = 40;
const MEDIUM_STREAMING_TEXT_MAX_LENGTH = 120;

const markdownAstCache = new Map<string, string>();
const markdownRenderer = new marked.Renderer();

// marked's GFM strikethrough treats a pair of single `~` as `<del>`, which
// corrupts machine text such as `kubernetes.io~configmap ... io~empty-dir`.
// Render lone tildes as literal text while keeping `~~text~~` strikethrough.
marked.use({
  extensions: [
    {
      name: 'literalSingleTilde',
      level: 'inline',
      start(src) {
        return src.indexOf('~');
      },
      tokenizer(src) {
        if (/^~(?!~)/.test(src)) {
          return { type: 'text', raw: '~', text: '~' };
        }
        return undefined;
      },
    },
  ],
});
const defaultMarkdownWhiteList = getDefaultWhiteList();
const markdownXssOptions: IFilterXSSOptions = {
  whiteList: {
    ...defaultMarkdownWhiteList,
    a: [...(defaultMarkdownWhiteList.a ?? []), 'rel', 'data-external-href', 'class'],
    span: [...(defaultMarkdownWhiteList.span ?? []), 'class', 'role', 'aria-checked', 'aria-disabled'],
  },
};

markdownRenderer.checkbox = ({ checked }) =>
  `<span class="markdown-task-checkbox${checked ? ' markdown-task-checkbox--checked' : ''}" role="checkbox" aria-checked="${String(
    checked,
  )}" aria-disabled="true">${checked ? '&#10003;' : ''}</span>`;
markdownRenderer.html = ({ text }) => escapeHtml(text);

// Only render same-origin images; cross-origin URLs are shown as plain text.
markdownRenderer.image = ({ href, title, text }) => {
  if (typeof href !== 'string' || href.length === 0) {
    return escapeHtml(text);
  }
  if (!isSameOriginUrl(href)) {
    return escapeHtml(href);
  }
  let out = `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"`;
  if (title) {
    out += ` title="${escapeHtml(title)}"`;
  }
  out += ' loading="lazy">';
  return out;
};

// All links open in a new tab with noopener/noreferrer.
// Cross-origin links are intercepted via data-external-href for confirmation.
markdownRenderer.link = function ({ href, title, tokens }) {
  const innerText = this.parser.parseInline(tokens);
  if (typeof href !== 'string' || href.length === 0) {
    return innerText;
  }
  const sameOrigin = isSameOriginUrl(href);
  if (!sameOrigin && !isSafeNavigationUrl(href)) {
    // Dangerous protocol (javascript:, vbscript:, etc.) on cross-origin URL
    return escapeHtml(href);
  }
  if (sameOrigin) {
    let out = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`;
    if (title) {
      out += ` title="${escapeHtml(title)}"`;
    }
    out += `>${innerText}</a>`;
    return out;
  }
  // Cross-origin: store real URL in data-external-href, use href="#" to
  // prevent direct navigation. Click is intercepted by the container's
  // onClickCapture handler to show a confirmation dialog.
  let out = `<a href="#" class="markdown-external-link" data-external-href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`;
  if (title) {
    out += ` title="${escapeHtml(title)}"`;
  }
  out += `>${innerText}</a>`;
  return out;
};

export function __resetMarkdownContentTestState(): void {
  markdownAstCache.clear();
}

export function __getMarkdownContentCacheSizeForTest(): number {
  return markdownAstCache.size;
}

function getCachedMarkdown(content: string): string | null {
  return markdownAstCache.get(content) ?? null;
}

function setCachedMarkdown(content: string, sanitized: string): void {
  markdownAstCache.set(content, sanitized);
  while (markdownAstCache.size > MARKDOWN_AST_CACHE_LIMIT) {
    const oldestKey = markdownAstCache.keys().next().value;
    if (oldestKey !== undefined) {
      markdownAstCache.delete(oldestKey);
    }
  }
}

function renderMarkdownHtml(markdown: string, inline = false): string {
  const options = { async: false as const, renderer: markdownRenderer };
  const html = inline ? marked.parseInline(markdown, options) : marked.parse(markdown, options);
  return xss(html, markdownXssOptions);
}

export function __renderMarkdownHtmlForTest(markdown: string, inline = false): string {
  return renderMarkdownHtml(markdown, inline);
}

export function resolveTextSweepDuration(content: string): '3s' | '3.5s' | '4s' {
  const length = content.trim().length;
  if (length < SHORT_STREAMING_TEXT_MAX_LENGTH) {
    return '3s';
  }
  if (length < MEDIUM_STREAMING_TEXT_MAX_LENGTH) {
    return '3.5s';
  }
  return '4s';
}

export const STREAMING_TEXT_SWEEP_CSS = `
  @keyframes nextagent-text-sweep {
    0% { background-position: 180% 0; }
    100% { background-position: -180% 0; }
  }
  .markdown-content--streaming-answer > :where(p, li, h1, h2, h3, h4, h5, h6):last-child,
  .markdown-content--streaming-answer > :where(ul, ol):last-child > li:last-child,
  .markdown-content--streaming-answer > blockquote:last-child > :last-child,
  .markdown-content--streaming-answer > pre:last-child code,
  .markdown-content--streaming-answer > div:last-child table tbody tr:last-child td {
    color: transparent;
    background-image: linear-gradient(
      90deg,
      var(--color-text-primary) 0%,
      var(--color-text-primary) 38%,
      var(--color-primary) 50%,
      var(--color-text-primary) 62%,
      var(--color-text-primary) 100%
    );
    background-size: 220% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    animation: nextagent-text-sweep var(--nextagent-text-sweep-duration, 3s) linear infinite;
  }
  .markdown-content--streaming-answer > :where(p, li, h1, h2, h3, h4, h5, h6):last-child :where(code, a, strong, em),
  .markdown-content--streaming-answer > :where(ul, ol):last-child > li:last-child :where(code, a, strong, em),
  .markdown-content--streaming-answer > blockquote:last-child > :last-child :where(code, a, strong, em),
  .markdown-content--streaming-answer > div:last-child table tbody tr:last-child td :where(code, a, strong, em) {
    color: inherit;
  }
  @media (prefers-reduced-motion: reduce) {
    .markdown-content--streaming-answer > :where(p, li, h1, h2, h3, h4, h5, h6):last-child,
    .markdown-content--streaming-answer > :where(ul, ol):last-child > li:last-child,
    .markdown-content--streaming-answer > blockquote:last-child > :last-child,
    .markdown-content--streaming-answer > pre:last-child code,
    .markdown-content--streaming-answer > div:last-child table tbody tr:last-child td {
      color: var(--color-text-primary);
      background-image: none;
      animation: none;
    }
  }
`;

export const MarkdownContent = memo(
  function MarkdownContent({
    content,
    isStreamingAnswer = false,
    sweepDuration,
    cachePolicy = 'stable',
    fontSize = 16,
    textColor = 'var(--color-text-primary)',
    onMermaidRendered,
  }: {
    readonly content: string;
    readonly isStreamingAnswer?: boolean;
    readonly sweepDuration?: ReturnType<typeof resolveTextSweepDuration>;
    readonly cachePolicy?: 'stable' | 'streaming';
    readonly fontSize?: number;
    readonly textColor?: string;
    readonly onMermaidRendered?: () => void;
  }) {
    const sanitizedContent = useMemo(() => {
      const shouldUseCache = cachePolicy === 'stable' && content.length <= MAX_CACHEABLE_MARKDOWN_CHARS;
      if (shouldUseCache) {
        const cached = getCachedMarkdown(content);
        if (cached) {
          return cached;
        }
      }
      const sanitized = normalizeBrokenMarkdownTables(normalizeMarkdownBlockSpacing(content));
      if (shouldUseCache) {
        setCachedMarkdown(content, sanitized);
      }
      return sanitized;
    }, [cachePolicy, content]);
    const resolvedSweepDuration = sweepDuration ?? resolveTextSweepDuration(content);

    const { t } = useTranslation();
    const handleLinkClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest?.('a[data-external-href]') as HTMLAnchorElement | null;
        if (!anchor) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const externalUrl = anchor.getAttribute('data-external-href');
        if (!externalUrl || !isSafeNavigationUrl(externalUrl)) {
          return;
        }
        Modal.confirm({
          title: t('markdown.externalLinkConfirmTitle'),
          content: t('markdown.externalLinkConfirmContent'),
          okText: t('markdown.externalLinkConfirmOk'),
          cancelText: t('markdown.externalLinkConfirmCancel'),
          onOk: () => {
            window.open(externalUrl, '_blank', 'noopener,noreferrer');
          },
        });
      },
      [t],
    );

    return (
      <div
        className={`markdown-content${isStreamingAnswer ? ' markdown-content--streaming-answer' : ''}`}
        onClickCapture={handleLinkClick}
        style={
          {
            fontSize,
            lineHeight: 1.5,
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            color: textColor,
            ...(isStreamingAnswer ? { '--nextagent-text-sweep-duration': resolvedSweepDuration } : {}),
          } as React.CSSProperties
        }
      >
        <style>
          {`
          .markdown-content > :where(div):first-of-type > :first-child { margin-top: 0; }
          .markdown-content > :where(div):last-of-type > :last-child { margin-bottom: 0; }
          .markdown-content :where(*) {
            font-family: inherit;
          }
          .markdown-content :where(blockquote, th, td, small) {
            font-size: inherit;
          }
          .markdown-content :where(h1, h2, h3, h4, h5, h6) {
            margin: 16px 0 8px;
            font-weight: 600;
            line-height: 24px;
          }
          .markdown-content :where(h1) {
            font-size: 20px;
          }
          .markdown-content :where(h2) {
            font-size: 18px;
          }
          .markdown-content :where(h3, h4) {
            font-size: 17px;
          }
          .markdown-content :where(h5, h6) {
            font-size: 16px;
          }
          .markdown-content :where(p) {
            margin: 0 0 10px;
          }
          .markdown-content :where(ul, ol) {
            margin: 0 0 10px;
            padding-inline-start: 21px;
            list-style-position: outside;
          }
          .markdown-content :where(li) {
            padding-inline-start: 2px;
          }
          .markdown-content :where(li + li) {
            margin-top: 6px;
          }
          .markdown-content :where(li > p) {
            margin: 0;
          }
          .markdown-content :where(li > ul, li > ol) {
            margin-top: 6px;
            margin-bottom: 0;
          }
          .markdown-content :where(.markdown-task-checkbox) {
            display: inline-flex;
            width: 16px;
            height: 16px;
            margin-inline-end: 7px;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            border: 1px solid var(--color-border);
            border-radius: 4px;
            color: #fff;
            font-size: 12px;
            line-height: 1;
            vertical-align: -2px;
          }
          .markdown-content :where(.markdown-task-checkbox--checked) {
            border-color: var(--color-primary);
            background: var(--color-primary);
          }
          .markdown-content :where(p, ul, ol, blockquote, pre, table) {
            max-width: 100%;
          }
          .markdown-content :where(.markdown-table-scroll + div > :first-child) {
            margin-top: 0;
          }
          .markdown-content :where(blockquote) {
            position: relative;
            margin: 0 0 10px;
            padding: 6px 0 6px 20px;
            color: var(--color-text-secondary);
          }
          .markdown-content :where(blockquote)::before {
            position: absolute;
            inset-block: 6px;
            inset-inline-start: 0;
            width: 3px;
            border-radius: 2px;
            background: var(--color-border);
            content: '';
          }
          .markdown-content :where(blockquote) > :last-child {
            margin-bottom: 0;
          }
          .markdown-content :where(pre) {
            margin: 12px 0;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
            word-break: break-word;
            background: var(--color-bg-secondary);
            border-radius: 8px;
            padding: 12px 14px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
            font-size: 14px;
            line-height: 20px;
          }
          .markdown-content :where(code) {
            overflow-wrap: anywhere;
            white-space: break-spaces;
            word-break: break-word;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
          }
          .markdown-content :where(p, li, blockquote) {
            overflow-wrap: anywhere;
            word-break: break-word;
            white-space: pre-wrap;
          }
          .markdown-content :where(td, th) {
            white-space: pre-wrap;
          }
          .markdown-content :where(hr) {
            border: 0;
            border-top: 1px solid var(--color-bg-tertiary);
            margin: 22px 0;
          }
          .markdown-content :where(a) {
            color: var(--color-text-link, var(--color-primary));
            text-decoration: none;
          }
          .markdown-content :where(a:hover) {
            color: var(--color-primary-hover, var(--color-primary));
            text-decoration: underline;
          }
          .markdown-content :where(.markdown-external-link)::after {
            content: '\\2197';
            display: inline-block;
            margin-inline-start: 2px;
            font-size: 0.85em;
            vertical-align: baseline;
          }
          ${STREAMING_TEXT_SWEEP_CSS}
        `}
        </style>
        <MarkdownWithTables
          content={sanitizedContent}
          renderMarkdown={(markdown) => (
            <SanitizedHtmlDiv className="markdown-prose-segment" style={{ width: '100%' }} html={renderMarkdownHtml(markdown)} />
          )}
          renderInlineMarkdown={(markdown) => <SanitizedHtmlSpan html={renderMarkdownHtml(markdown, true)} />}
          renderMermaid={(mermaidContent, stableKey) => <LazyMermaid key={stableKey} content={mermaidContent} onRendered={onMermaidRendered} />}
        />
      </div>
    );
  },
  // A cache-policy-only transition must not re-render unchanged Markdown just to prewarm the stable cache.
  (prev, next) =>
    prev.content === next.content &&
    prev.isStreamingAnswer === next.isStreamingAnswer &&
    prev.sweepDuration === next.sweepDuration &&
    prev.fontSize === next.fontSize &&
    prev.textColor === next.textColor,
);
