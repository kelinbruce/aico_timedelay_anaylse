import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import mermaid from 'mermaid';
import { reportError } from '../../../utils/diagnostics.ts';
import { SanitizedHtmlDiv } from './SanitizedHtml.tsx';

let documentOverflowSuppressionDepth = 0;
let previousBodyOverflow = '';
let previousHtmlOverflow = '';

const MERMAID_MIN_READABLE_WIDTH_PX = 560;

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[^>]*(?:>[\s\S]*?<\s*\/\s*\1\s*>|\/?\s*>)/gi, '')
    .replace(/\s(?:on[a-z]+|href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attribute) =>
      /^\s(?:href|xlink:href)\s*=\s*(?:"#|'#|#)/iu.test(attribute) ? attribute : '',
    )
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function initMermaidMainThread(): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    htmlLabels: false,
    // Keep labels in SVG text nodes so our sanitizer can strip foreignObject safely.
    flowchart: { htmlLabels: false },
  });
}

async function withDocumentOverflowSuppressed<T>(task: () => Promise<T>): Promise<T> {
  if (typeof document === 'undefined') {
    return task();
  }

  if (documentOverflowSuppressionDepth === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  documentOverflowSuppressionDepth += 1;

  try {
    return await task();
  } finally {
    documentOverflowSuppressionDepth = Math.max(0, documentOverflowSuppressionDepth - 1);
    if (documentOverflowSuppressionDepth === 0) {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    }
  }
}

export interface LazyMermaidProps {
  readonly content: string;
  readonly onRendered?: (() => void) | undefined;
}

export function LazyMermaid({ content, onRendered }: LazyMermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedNotificationFrameRef = useRef<number | null>(null);
  const activeRenderIdRef = useRef(0);
  const [isVisible, setIsVisible] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);

  const scheduleRenderedNotification = useCallback(() => {
    if (!onRendered) {
      return;
    }
    if (renderedNotificationFrameRef.current !== null) {
      cancelAnimationFrame(renderedNotificationFrameRef.current);
    }
    renderedNotificationFrameRef.current = requestAnimationFrame(() => {
      renderedNotificationFrameRef.current = null;
      onRendered();
    });
  }, [onRendered]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const renderMermaid = useCallback(async (diagramContent: string) => {
    const renderId = activeRenderIdRef.current + 1;
    activeRenderIdRef.current = renderId;
    setIsRendering(true);
    setHasError(false);

    try {
      const svg = await withDocumentOverflowSuppressed(async () => {
        initMermaidMainThread();
        const nodeId = `mermaid-main-${Date.now()}`;
        const rendered = await mermaid.render(nodeId, diagramContent);
        return sanitizeSvg(rendered.svg);
      });
      if (renderId !== activeRenderIdRef.current) {
        return;
      }
      setSvgContent(svg);
      setHasError(false);
    } catch (error) {
      if (renderId !== activeRenderIdRef.current) {
        return;
      }
      reportError('Mermaid rendering failed:', error);
      setHasError(true);
      setSvgContent(null);
    } finally {
      if (renderId === activeRenderIdRef.current) {
        setIsRendering(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isVisible || !content) {
      return;
    }

    void renderMermaid(content);
  }, [content, isVisible, renderMermaid]);

  useEffect(() => {
    if (isRendering || (!svgContent && !hasError)) {
      return undefined;
    }

    scheduleRenderedNotification();

    if (!svgContent || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      const rect = element.getBoundingClientRect();
      return {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      };
    };

    let previousSize = measure();
    const observer = new ResizeObserver(() => {
      const nextSize = measure();
      if (nextSize.width === previousSize.width && nextSize.height === previousSize.height) {
        return;
      }
      previousSize = nextSize;
      scheduleRenderedNotification();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (renderedNotificationFrameRef.current !== null) {
        cancelAnimationFrame(renderedNotificationFrameRef.current);
        renderedNotificationFrameRef.current = null;
      }
    };
  }, [hasError, isRendering, scheduleRenderedNotification, svgContent]);

  useEffect(() => {
    return () => {
      if (renderedNotificationFrameRef.current !== null) {
        cancelAnimationFrame(renderedNotificationFrameRef.current);
        renderedNotificationFrameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="markdown-mermaid-scroll nextagent-themed-scrollbar"
      style={{
        minHeight: 140,
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: svgContent ? 'flex-start' : 'center',
        background: 'var(--color-thinking-bg)',
        borderRadius: 8,
        margin: '16px 0 16px',
        padding: 12,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {isRendering && <Spin size="small" />}
      {svgContent && (
        <SanitizedHtmlDiv
          className="mermaid-rendered-diagram"
          style={{ width: '100%', minWidth: MERMAID_MIN_READABLE_WIDTH_PX }}
          html={`${svgContent}<style>.mermaid-rendered-diagram svg{display:block;width:100%;max-width:none;height:auto;margin:0 auto;overflow:visible;}</style>`}
        />
      )}
      {hasError && <div style={{ color: 'var(--color-error)', fontSize: 12, padding: 8 }}>{'Mermaid \u56fe\u8868\u6e32\u67d3\u5931\u8d25'}</div>}
    </div>
  );
}
