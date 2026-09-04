import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Socket } from 'node:net';
import { sendWebSocketHandshake, sendHttpError } from '../src/transports/websocket.js';

const EXPECTED_CONTENT_SECURITY_POLICY = [`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`].join('; ');

// A socket stand-in: PassThrough captures the raw bytes written.
interface CapturedSocket extends PassThrough {
  destroyed: boolean;
}

function createCaptureSocket(): CapturedSocket {
  const stream = new PassThrough() as CapturedSocket;
  stream.destroyed = false;
  return stream;
}

// Parse the raw HTTP response bytes into a status line + header map.
function parseHttpResponse(raw: string): { statusLine: string; headers: Record<string, string> } {
  const headerEnd = raw.indexOf('\r\n\r\n');
  expect(headerEnd).toBeGreaterThanOrEqual(0);
  const headerBlock = raw.slice(0, headerEnd);
  const lines = headerBlock.split('\r\n');
  const statusLine = lines[0]!;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const sep = line.indexOf(':');
    expect(sep).toBeGreaterThan(0);
    const name = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    headers[name] = value;
  }
  return { statusLine, headers };
}

const EXPECTED_SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': EXPECTED_CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-xss-protection': '1; mode=block',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'x-dns-prefetch-control': 'off',
  'cache-control': 'no-cache, no-store, must-revalidate',
  pragma: 'no-cache',
  expires: '0',
};

describe('sendWebSocketHandshake security headers (101 path)', () => {
  it('applies the full security header set over plain HTTP', () => {
    const socket = createCaptureSocket();
    sendWebSocketHandshake(socket as unknown as Socket, 'dGhlIHNhbXBsZSBub25jZQ==');

    const { statusLine, headers } = parseHttpResponse(socket.read().toString('utf8'));
    expect(statusLine).toBe('HTTP/1.1 101 Switching Protocols');
    expect(headers['upgrade']).toBe('websocket');
    expect(headers['connection']).toBe('Upgrade');
    // Sec-WebSocket-Accept is the SHA1 of key + GUID, base64 — just assert presence.
    expect(headers['sec-websocket-accept']).toBeTruthy();

    for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
      expect(headers[name], `${name} header`).toBe(value);
    }
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('sendHttpError security headers (4xx downgrade path)', () => {
  it('applies the full security header set to the 400 error over plain HTTP', () => {
    const socket = createCaptureSocket();
    sendHttpError(socket as unknown as Socket, 400, 'WEBSOCKET_HANDSHAKE_INVALID');

    const { statusLine, headers } = parseHttpResponse(socket.read().toString('utf8'));
    expect(statusLine).toBe('HTTP/1.1 400 Bad Request');
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    // Content-Length must reflect the JSON body length.
    const body = '{"error":{"code":"WEBSOCKET_HANDSHAKE_INVALID","message":"WebSocket stream failed safely."}}';
    expect(headers['content-length']).toBe(String(Buffer.byteLength(body)));

    for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
      expect(headers[name], `${name} header`).toBe(value);
    }
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('is a no-op on an already-destroyed socket', () => {
    const socket = createCaptureSocket();
    socket.destroyed = true;
    // Must not throw and must not write anything.
    expect(() => sendHttpError(socket as unknown as Socket, 400, 'WEBSOCKET_HANDSHAKE_INVALID')).not.toThrow();
    expect(socket.read()).toBeNull();
  });
});
