import { describe, expect, it } from 'vitest';
import { type FastifyReply } from 'fastify';
import { buildSecurityResponseHeaders, SECURITY_RESPONSE_HEADERS, sendSseStream, type SseEnvelope } from '../src/index.js';

const EXPECTED_CONTENT_SECURITY_POLICY = [`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`].join('; ');

describe('buildSecurityResponseHeaders', () => {
  it('returns the full header set (HSTS included)', () => {
    const headers = buildSecurityResponseHeaders();
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['X-DNS-Prefetch-Control']).toBe('off');
    expect(headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
    expect(headers['Pragma']).toBe('no-cache');
    expect(headers['Expires']).toBe('0');
    expect(headers['Content-Security-Policy']).toBe(EXPECTED_CONTENT_SECURITY_POLICY);
  });

  it('allows required inline styles and data images without allowing inline scripts', () => {
    const policy = buildSecurityResponseHeaders()['Content-Security-Policy'];
    expect(policy).toBeDefined();
    const directives = new Map(
      policy
        ?.split(';')
        .map((directive) => directive.trim().split(/\s+/u))
        .filter((tokens) => tokens.length > 0)
        .map(([name, ...sources]) => [name, sources]),
    );

    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:']);
    expect(directives.get('script-src') ?? directives.get('default-src')).not.toContain("'unsafe-inline'");
  });

  it('emits HSTS over plain HTTP', () => {
    const headers = buildSecurityResponseHeaders();
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('emits HSTS when no options are passed', () => {
    const headers = buildSecurityResponseHeaders();
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('preserves caller-supplied existing headers (case-insensitive, not duplicated)', () => {
    const headers = buildSecurityResponseHeaders({
      existingHeaders: {
        'cache-control': 'public, max-age=3600',
        'X-FRAME-OPTIONS': 'SAMEORIGIN',
      },
    });
    // existingHeaders are the caller's responsibility — buildSecurityResponseHeaders
    // returns only the gap-fillers, so conflicting names are OMITTED from the result
    // (the caller already has them and will merge via {...own, ...security}).
    expect(headers['Cache-Control']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBeUndefined();
    // Non-conflicting defaults are still filled in.
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('every SECURITY_RESPONSE_HEADERS entry has a stable non-empty value', () => {
    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

// Capture the headers written by sendSseStream via reply.raw.writeHead. Because
// sendSseStream hijacks the reply, we drive it with a minimal fake reply rather
// than Fastify's inject (light-my-request does not reliably expose writeHead on
// a hijacked raw response). The fake reply records the writeHead headers and
// accepts all writes (events are drained synchronously since the generator is
// finite and writes never block).
async function captureSseStreamHeaders(events: readonly SseEnvelope[]): Promise<Record<string, string>> {
  let captured: Record<string, string> = {};
  const raw = {
    destroyed: false,
    writeHead(status: number, headers?: Record<string, string>) {
      captured = { ...(headers ?? {}) };
      return raw;
    },
    write(chunk: unknown): boolean {
      // Accept all writes; chunk content is irrelevant for header assertions.
      void chunk;
      return true;
    },
    end(): void {
      raw.destroyed = true;
    },
    once(): void {},
    off(): void {},
  };
  const reply = {
    hijack() {},
    raw,
  } as unknown as FastifyReply;
  await sendSseStream(
    reply,
    (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  );
  // Normalize header names to lowercase so assertions are case-insensitive
  // (HTTP header names are case-insensitive on the wire, but the JS object
  // preserves the original casing from SECURITY_RESPONSE_HEADERS).
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(captured)) {
    normalized[name.toLowerCase()] = value;
  }
  return normalized;
}

describe('sendSseStream security headers (hijack path)', () => {
  it('applies the full security header set to the SSE writeHead response over HTTP', async () => {
    const headers = await captureSseStreamHeaders([{ eventType: 'REQUEST_ACCEPTED' }]);
    // SSE transport headers preserved.
    expect(headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(headers['connection']).toBe('keep-alive');
    expect(headers['x-accel-buffering']).toBe('no');
    // Security defaults applied (cache-control upgraded to the stricter default).
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-xss-protection']).toBe('1; mode=block');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-dns-prefetch-control']).toBe('off');
    expect(headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(headers['pragma']).toBe('no-cache');
    expect(headers['expires']).toBe('0');
    expect(headers['content-security-policy']).toBe(EXPECTED_CONTENT_SECURITY_POLICY);
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('emits HSTS over HTTPS', async () => {
    const headers = await captureSseStreamHeaders([{ eventType: 'REQUEST_ACCEPTED' }]);
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});
