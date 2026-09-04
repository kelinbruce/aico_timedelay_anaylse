import { createNextAgentFastifyServer, registerSecurityResponseHeaders } from '../src/server/fastify.js';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

const EXPECTED_CONTENT_SECURITY_POLICY = [`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`].join('; ');

describe('security response headers', () => {
  function createServerWithRoute(): FastifyInstance {
    const server = createNextAgentFastifyServer();
    server.get('/probe', async () => ({ ok: true }));
    server.get('/download', async (_request, reply) => {
      // A route that intentionally sets Cache-Control must not be overwritten.
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.header('X-Frame-Options', 'DENY');
      return { ok: true };
    });
    return server;
  }

  it('injects the default hardening headers on a normal JSON response', async () => {
    const server = createServerWithRoute();
    try {
      const response = await server.inject({ method: 'GET', url: '/probe' });
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
      expect(response.headers['pragma']).toBe('no-cache');
      expect(response.headers['expires']).toBe('0');
      expect(response.headers['content-security-policy']).toBe(EXPECTED_CONTENT_SECURITY_POLICY);
    } finally {
      await server.close();
    }
  });

  it('emits Strict-Transport-Security on all responses', async () => {
    const server = createServerWithRoute();
    try {
      const response = await server.inject({ method: 'GET', url: '/probe' });
      expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    } finally {
      await server.close();
    }
  });

  it('does not overwrite headers the route set intentionally', async () => {
    const server = createServerWithRoute();
    try {
      const response = await server.inject({ method: 'GET', url: '/download' });
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
      expect(response.headers['x-frame-options']).toBe('DENY');
      // Non-conflicting defaults are still applied.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await server.close();
    }
  });

  it('registerSecurityResponseHeaders is idempotent and covers routes added after registration', async () => {
    const server = createNextAgentFastifyServer();
    // createNextAgentFastifyServer already registers the hook; re-registering must not throw or duplicate.
    expect(() => registerSecurityResponseHeaders(server)).not.toThrow();
    server.get('/late', async () => ({ ok: true }));
    try {
      const response = await server.inject({ method: 'GET', url: '/late' });
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await server.close();
    }
  });
});
