import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { describe, expect, it } from 'vitest';

describe('web not-found contract (backend-only profile)', () => {
  // The backend-only profile (DEFAULT_WEB + no frontend hosting, the dev:watch
  // default with auth.localAuth.enabled=false) registers neither auth-local nor
  // frontend-hosting, so a root not-found handler must be installed to return
  // the { error: { code, message } } contract instead of Fastify's default
  // { message, error, statusCode } shape.
  it('returns the standard contract 404 for an unmatched /api/ route', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    try {
      // An empty sessionId path segment collapses (in a real HTTP server) or is
      // captured as "" (under inject); either way the titled route does not
      // match a registered handler and must return the standard 404 contract.
      const res = await app.server.inject({ method: 'PUT', url: '/api/v1/sessions/title', payload: { title: 'x' } });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: { code: string; message: string } }>().error.code).toBe('NOT_FOUND');
      expect(res.json<{ error: { message: string } }>().error.message).toBe('Route not found.');
    } finally {
      await app.close();
    }
  });

  it('returns the standard contract 404 for an unregistered non-/api/ route', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    try {
      const res = await app.server.inject({ method: 'GET', url: '/nonexistent-public-route' });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: { code: string; message: string } }>().error.code).toBe('NOT_FOUND');
      expect(res.json<{ error: { message: string } }>().error.message).toBe('Route not found.');
    } finally {
      await app.close();
    }
  });
});
