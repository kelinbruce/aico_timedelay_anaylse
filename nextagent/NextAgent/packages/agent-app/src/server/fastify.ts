import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
// The security header set + helpers live in @nextagent/agent-channel-common so
// they are reachable from the SSE (sendSseStream) and WebSocket transport code
// paths that bypass Fastify's onSend hook. This module re-exports them to keep
// the historical import path (`server/fastify.js`) stable for callers/tests.
import { SECURITY_RESPONSE_HEADERS, buildSecurityResponseHeaders } from '@nextagent/agent-channel-common';

export { SECURITY_RESPONSE_HEADERS, buildSecurityResponseHeaders };

const MEBIBYTE = 1024 * 1024;
const WEB_MULTIPART_BODY_LIMIT_BYTES = 16 * MEBIBYTE;
const WEB_MAX_HEADER_SIZE_BYTES = 512 * 1024;
// Fastify default server timeouts (see fastify/lib/config-validator.js).
// These are applied by Fastify only when serverFactory is NOT used, so we
// replicate them here to avoid falling back to Node.js defaults.
const FASTIFY_KEEP_ALIVE_TIMEOUT_MS = 72_000;
const FASTIFY_REQUEST_TIMEOUT_MS = 0;
const FASTIFY_CONNECTION_TIMEOUT_MS = 0;

export function registerSecurityResponseHeaders(server: FastifyInstance): void {
  server.addHook('onSend', async (request, reply) => {
    // Reuse the single source of truth so the onSend path and the hijack/raw
    // socket paths can never drift. `reply.hasHeader` is the existing-headers
    // oracle here; buildSecurityResponseHeaders only fills gaps.
    const existing: Record<string, string> = {};
    for (const name of Object.keys(SECURITY_RESPONSE_HEADERS)) {
      if (reply.hasHeader(name)) {
        const value = reply.getHeader(name);
        if (typeof value === 'string') {
          existing[name] = value;
        } else if (Array.isArray(value)) {
          existing[name] = value.join(', ');
        }
      }
    }
    const headers = buildSecurityResponseHeaders({ existingHeaders: existing });
    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }
  });
}

export function createNextAgentFastifyServer(accessLogger?: FastifyBaseLogger) {
  const server = Fastify({
    ...(accessLogger === undefined ? {} : { loggerInstance: accessLogger }),
    requestIdHeader: false,
    bodyLimit: WEB_MULTIPART_BODY_LIMIT_BYTES,
    serverFactory: (handler, opts: Record<string, unknown>): Server => {
      const server = createServer({ maxHeaderSize: WEB_MAX_HEADER_SIZE_BYTES }, handler);
      server.keepAliveTimeout = (opts.keepAliveTimeout as number | undefined) ?? FASTIFY_KEEP_ALIVE_TIMEOUT_MS;
      server.requestTimeout = (opts.requestTimeout as number | undefined) ?? FASTIFY_REQUEST_TIMEOUT_MS;
      server.setTimeout((opts.connectionTimeout as number | undefined) ?? FASTIFY_CONNECTION_TIMEOUT_MS);
      return server;
    },
    ajv: { customOptions: { removeAdditional: false } },
  });
  if (accessLogger !== undefined) {
    server.addHook('onRequest', async (request) => {
      (request.log as FastifyBaseLogger & { setBindings: (bindings: Record<string, unknown>) => void }).setBindings({
        req: { method: request.method, routeOptions: { url: request.routeOptions.url } },
      });
    });
  }
  registerSecurityResponseHeaders(server);
  return server;
}
