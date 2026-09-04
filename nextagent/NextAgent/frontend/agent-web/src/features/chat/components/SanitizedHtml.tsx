import { useLayoutEffect, useRef, type CSSProperties } from 'react';

/** Mounts HTML that the caller has already sanitized. This component is not a sanitizer. */
function mountParsedHtml(host: HTMLElement, html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  host.replaceChildren(...parsed.body.childNodes);
}

export function SanitizedHtmlDiv({ html, className, style }: { readonly html: string; readonly className?: string; readonly style?: CSSProperties }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (hostRef.current !== null) {
      mountParsedHtml(hostRef.current, html);
    }
  }, [html]);

  return <div ref={hostRef} className={className} style={style} />;
}

export function SanitizedHtmlSpan({ html }: { readonly html: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (hostRef.current !== null) {
      mountParsedHtml(hostRef.current, html);
    }
  }, [html]);

  return <span ref={hostRef} />;
}
