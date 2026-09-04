import { AgentError, brand, type AgentId, type IdentityContext } from '@nextagent/agent-common';
import type { FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';

export type IdentityResolver = (request: FastifyRequest | IncomingMessage) => IdentityContext;

const safeAgentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function readHeader(request: FastifyRequest | IncomingMessage, name: string): string | undefined {
  const headers = request.headers as Record<string, string | readonly string[] | undefined>;
  const raw = headers[name];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return Array.isArray(raw) ? raw[0] : String(raw);
}

export function resolveAgentIdFromHeader(request: FastifyRequest | IncomingMessage, defaultAgentId: AgentId): AgentId {
  const value = readHeader(request, 'x-agent-id');
  if (value === undefined || value.length === 0) {
    return defaultAgentId;
  }
  if (!safeAgentIdPattern.test(value)) {
    throw new AgentError({
      code: 'AGENT_ID_HEADER_INVALID',
      message: 'Header x-agent-id does not satisfy agentId format constraints.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'AGENT_ID_HEADER_INVALID' },
    });
  }
  return brand<string, 'AgentId'>(value);
}

export function extractHeaderAgentId(request: FastifyRequest | IncomingMessage): string | undefined {
  const value = readHeader(request, 'x-agent-id');
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}
