/**
 * HTTP security response headers, applied to every outbound response.
 *
 * These satisfy the compliance rule C.WEB.NGINX.O_1_17.G_9.R_2 (HTTP security
 * response headers). Content-Security-Policy keeps resources same-origin by
 * default, allows the runtime styles and data images required by Agent Web,
 * and continues to block inline scripts.
 *
 * The headers are applied uniformly to JSON, SSE, WebSocket-handshake, and
 * streamed responses alike. Fastify's `onSend` hook covers normal `reply.send`
 * responses, but two response paths bypass `onSend` and must re-apply this set
 * themselves:
 *  - `sendSseStream` uses `reply.hijack()` + `reply.raw.writeHead(...)` for
 *    backpressure-aware streaming (see projections/stream-envelope.ts).
 *  - The WebSocket transport writes the 101 Switching Protocols handshake and
 *    4xx downgrade responses onto a raw socket (see transports/websocket.ts).
 *
 * Notes on the mandatory headers:
 *  - X-XSS-Protection is required by the rule even though modern browsers have
 *    deprecated it (audit-mode variants could introduce XSS). The rule
 *    mandates `1; mode=block`, the safer of the variants.
 *  - X-Frame-Options is set to DENY: no same-origin iframe embed dependency
 *    exists (the only `iframe` matches in the codebase are sanitizer/exclusion
 *    patterns, not embeds).
 *  - Cache-Control + Pragma + Expires form the legacy+modern triple that
 *    prevents sensitive page caching.
 */
const CONTENT_SECURITY_POLICY = [`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`].join('; ');

export const SECURITY_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
});

/**
 * Lowercased security header names, for case-insensitive "already set?" checks
 * against an arbitrary headers object without allocating a Set.
 */
export const SECURITY_HEADER_NAMES: readonly string[] = Object.freeze(Object.keys(SECURITY_RESPONSE_HEADERS).map((name) => name.toLowerCase()));

export interface SecurityHeadersOptions {
  /**
   * Headers the caller has already intentionally set (e.g. a stream route's
   * own `cache-control`, or a download endpoint's `Content-Disposition`).
   * These are preserved and NOT overwritten — mirrors the onSend "fill in
   * defaults only" contract. Matching is case-insensitive on header name.
   */
  readonly existingHeaders?: Readonly<Record<string, string>>;
}

/**
 * Build the full security header set as a plain Record suitable for passing to
 * `reply.raw.writeHead(...)` or writing onto a raw socket. Used by response
 * paths that bypass Fastify's onSend hook:
 *  - `sendSseStream` (reply.hijack())
 *  - WebSocket 101 handshake + 4xx downgrade (raw socket)
 *
 * HSTS is always included. Caller-supplied `existingHeaders` win over the
 * defaults (case-insensitive on name).
 */
export function buildSecurityResponseHeaders(options: SecurityHeadersOptions = {}): Record<string, string> {
  const existing = options.existingHeaders ?? {};
  const existingLower = new Set(Object.keys(existing).map((name) => name.toLowerCase()));
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    if (existingLower.has(name.toLowerCase())) {
      continue;
    }
    headers[name] = value;
  }
  return headers;
}
