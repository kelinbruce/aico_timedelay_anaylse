import { describe, it, expect, afterEach } from 'vitest';
import { isSameOriginUrl, isSafeNavigationUrl } from '../src/utils/urlSafety.ts';

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    // @ts-expect-error -- restore non-window state for SSR-style tests
    delete globalThis.window;
  }
});

function setLocation(origin: string): void {
  // jsdom sets window.location; we override href/origin for tests
  const url = new URL(origin);
  Object.defineProperty(window, 'location', {
    value: {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      host: url.host,
      origin: url.origin,
      href: url.href,
    },
    writable: true,
    configurable: true,
  });
}

describe('isSameOriginUrl', () => {
  it('treats relative paths as same-origin', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('/api/data')).toBe(true);
    expect(isSameOriginUrl('./images/logo.png')).toBe(true);
    expect(isSameOriginUrl('../assets/icon.svg')).toBe(true);
  });

  it('treats fragment-only links as same-origin', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('#section')).toBe(true);
    expect(isSameOriginUrl('#')).toBe(true);
  });

  it('treats data: URIs as same-origin', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('data:image/png;base64,iVBOR...')).toBe(true);
  });

  it('treats mailto: and tel: as same-origin (non-navigational)', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('mailto:user@example.com')).toBe(true);
    expect(isSameOriginUrl('tel:+8613800138000')).toBe(true);
  });

  it('returns true for same-origin absolute URLs', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('http://localhost:3000/api/session')).toBe(true);
    expect(isSameOriginUrl('http://localhost:3000')).toBe(true);
  });

  it('returns false for cross-origin absolute URLs', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('https://evil.com/image.png')).toBe(false);
    expect(isSameOriginUrl('http://localhost:8080/image.png')).toBe(false);
    expect(isSameOriginUrl('https://localhost:3000/image.png')).toBe(false);
  });

  it('returns false for protocol-relative cross-origin URLs', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('//evil.com/image.png')).toBe(false);
  });

  it('returns true for protocol-relative same-origin URLs', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('//localhost:3000/api/data')).toBe(true);
  });

  it('returns true for empty string', () => {
    setLocation('http://localhost:3000');
    expect(isSameOriginUrl('')).toBe(true);
  });

  it('handles URLs with explicit ports', () => {
    setLocation('https://example.com:443');
    expect(isSameOriginUrl('https://example.com:443/path')).toBe(true);
    expect(isSameOriginUrl('https://example.com/path')).toBe(true);
    expect(isSameOriginUrl('http://example.com/path')).toBe(false);
  });
});

describe('isSafeNavigationUrl', () => {
  it('allows http and https URLs', () => {
    expect(isSafeNavigationUrl('http://example.com/page')).toBe(true);
    expect(isSafeNavigationUrl('https://example.com/page')).toBe(true);
  });

  it('allows protocol-relative URLs', () => {
    expect(isSafeNavigationUrl('//example.com/page')).toBe(true);
  });

  it('blocks javascript: URLs', () => {
    expect(isSafeNavigationUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeNavigationUrl('javascript:void(0)')).toBe(false);
  });

  it('blocks data: URLs', () => {
    expect(isSafeNavigationUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('blocks vbscript: and other dangerous schemes', () => {
    expect(isSafeNavigationUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeNavigationUrl('file:///etc/passwd')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSafeNavigationUrl('')).toBe(false);
  });

  it('returns false for unparseable URLs', () => {
    expect(isSafeNavigationUrl('not a url at all')).toBe(false);
  });
});
