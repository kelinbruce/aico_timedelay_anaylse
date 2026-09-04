import { AgentError } from '@nextagent/agent-common';
import http from 'node:http';
import https from 'node:https';

import type { TaskCallbackDeliveryPort, TaskCallbackTarget } from './task-callback.js';

export interface HttpTaskCallbackDeliveryOptions {
  readonly allowedOrigins: readonly string[];
  readonly socketPath?: string;
  readonly udsOrigin?: string;
  readonly tlsInsecure?: boolean;
  readonly fetch?: typeof globalThis.fetch;
}

const maxCallbackPayloadBytes = 1024 * 1024;

export function createHttpTaskCallbackDelivery(options: HttpTaskCallbackDeliveryOptions): TaskCallbackDeliveryPort {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const udsOrigin = options.udsOrigin;
  const socketPath = options.socketPath;
  const tlsInsecure = options.tlsInsecure ?? false;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  return {
    validateTarget(target) {
      validateTarget(target, allowedOrigins, udsOrigin);
    },
    async deliver(request, signal) {
      const target = validateTarget(request.target, allowedOrigins, udsOrigin);
      assertOrderedEvents(request.events);
      const body = JSON.stringify({ events: request.events });
      if (Buffer.byteLength(body, 'utf8') > maxCallbackPayloadBytes) {
        throw callbackPayloadError('Task callback payload exceeds the delivery limit.');
      }
      if (socketPath !== undefined) {
        return deliverViaUds(socketPath, target, body, signal);
      }
      if (tlsInsecure && target.protocol === 'https:') {
        return deliverViaHttpsInsecure(target, body, signal);
      }
      const response = await fetchImplementation(target, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body,
        signal,
      });
      await response.body?.cancel();
      return response.ok;
    },
  };
}

function deliverViaUds(socketPath: string, target: URL, body: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const requestOptions: http.RequestOptions = {
      method: 'POST',
      socketPath,
      path: target.pathname + target.search,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body, 'utf8') },
    };
    const req = http.request(requestOptions, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    if (signal.aborted) {
      req.destroy();
      resolve(false);
      return;
    }
    signal.addEventListener('abort', () => req.destroy(), { once: true });
    req.write(body);
    req.end();
  });
}

function assertOrderedEvents(events: Parameters<TaskCallbackDeliveryPort['deliver']>[0]['events']): void {
  if (events.length === 0 || events.some((event, index) => index > 0 && event.sequence < events[index - 1]!.sequence)) {
    throw callbackPayloadError('Task callback events must be a non-empty ordered array.');
  }
}

function callbackPayloadError(message: string): AgentError {
  return new AgentError({
    code: 'TASK_CALLBACK_PAYLOAD_INVALID',
    message,
    category: 'VALIDATION',
    retryable: false,
  });
}

export function validateTaskCallbackTarget(target: TaskCallbackTarget, allowedOrigins: readonly string[], udsOrigin?: string): URL {
  return validateTarget(target, new Set(allowedOrigins.map(normalizeOrigin)), udsOrigin);
}

function validateTarget(target: TaskCallbackTarget, allowedOrigins: ReadonlySet<string>, udsOrigin?: string): URL {
  let parsed: URL;
  try {
    parsed = udsOrigin !== undefined ? new URL(target.url, udsOrigin) : new URL(target.url);
  } catch {
    throw callbackTargetError();
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0 ||
    allowedOrigins.size === 0 ||
    !allowedOrigins.has(parsed.origin)
  ) {
    throw callbackTargetError();
  }
  return parsed;
}

function deliverViaHttpsInsecure(target: URL, body: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const requestOptions: https.RequestOptions = {
      method: 'POST',
      hostname: toHttpsRequestHostname(target.hostname),
      port: target.port || 443,
      path: target.pathname + target.search,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body, 'utf8') },
      rejectUnauthorized: false,
    };
    const req = https.request(requestOptions, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    if (signal.aborted) {
      req.destroy();
      resolve(false);
      return;
    }
    signal.addEventListener('abort', () => req.destroy(), { once: true });
    req.write(body);
    req.end();
  });
}

function toHttpsRequestHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function normalizeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new Error('origin only');
    }
    return parsed.origin;
  } catch {
    throw new AgentError({
      code: 'TASK_CALLBACK_CONFIG_INVALID',
      message: 'Task callback configuration is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function callbackTargetError(): AgentError {
  return new AgentError({
    code: 'TASK_CALLBACK_TARGET_REJECTED',
    message: 'Task callback target is not allowed.',
    category: 'AUTHORIZATION',
    retryable: false,
  });
}
