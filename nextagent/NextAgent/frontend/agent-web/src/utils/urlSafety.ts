/**
 * Determines whether a URL resolves to the same origin as the current page.
 *
 * Same-origin means the protocol, hostname, and port all match
 * `window.location`. Relative paths, anchors, and `data:` URIs are treated as
 * same-origin because they do not initiate a cross-origin request.
 *
 * Non-navigational schemes such as `mailto:` and `tel:` are treated as
 * same-origin for link purposes (they open the OS handler, not a web page).
 */
export function isSameOriginUrl(url: string): boolean {
  if (url.length === 0) {
    return true;
  }

  const trimmed = url.trim();

  // Relative paths: /path, ./path, ../path
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true;
  }

  // Fragment-only links: #section
  if (trimmed.startsWith('#')) {
    return true;
  }

  // data: URIs are embedded, never cross-origin
  if (trimmed.toLowerCase().startsWith('data:')) {
    return true;
  }

  // mailto: and tel: open OS handlers, not web navigation
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return true;
  }

  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    // SSR / non-browser: treat absolute URLs as cross-origin by default
    return false;
  }

  let parsed: URL;
  try {
    // Protocol-relative URLs (//host/path) need a base to resolve
    const base = `${window.location.protocol}//${window.location.host}`;
    parsed = trimmed.startsWith('//') ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    // If the URL cannot be parsed, treat it as a relative path (same-origin)
    return true;
  }

  return parsed.protocol === window.location.protocol && parsed.hostname === window.location.hostname && parsed.port === window.location.port;
}

/**
 * Determines whether a URL is safe for external window.open navigation.
 *
 * Only http/https and protocol-relative URLs are allowed. This blocks
 * javascript:, data:, vbscript: and other dangerous schemes from being
 * opened via window.open even if they reach the click handler.
 */
const SAFE_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeNavigationUrl(url: string): boolean {
  if (url.length === 0) {
    return false;
  }
  const trimmed = url.trim();
  // Protocol-relative URLs resolve to http/https at runtime
  if (trimmed.startsWith('//')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return SAFE_NAVIGATION_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
