import { AgentError, brand, getLogger, type IdentityContext, type MessageId, type RequestRunId, type SessionId } from '@nextagent/agent-common';
import type { RuntimeCommandPort, RuntimeSessionActivityPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import type { FastifyInstance } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import type { CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import { buildSecurityResponseHeaders } from '@nextagent/agent-channel-common';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

import { deliverWebStream, parseLastSeenSequence, type WebStreamDiagnostic, type WebGuardrailPort } from './web-stream-delivery.js';
import type { WebWatermarkPort } from './web-stream-delivery.js';
import { sessionActivityMessageSchema } from '../schemas/session-activity-dto.js';

const websocketGuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsSessionPathPattern = /^\/api\/v1\/sessions\/([^/]+)\/ws$/;
const wsSessionActivityPath = '/api/v1/session-activities/ws';
const streamBackpressureTimeoutMs = 15_000;
const maxWebSocketFramePayloadBytes = 1 * 1024 * 1024;
const maxWebSocketControlFramePayloadBytes = 125;

export interface WebSocketStreamDependencies {
  readonly capabilityResultPresentationPolicy?: CapabilityResultPresentationPolicy;
  readonly sessions: RuntimeSessionPort;
  readonly sessionActivities?: RuntimeSessionActivityPort;
  readonly runtime?: RuntimeCommandPort;
  readonly identityResolver: (request: IncomingMessage) => IdentityContext;
  readonly guardrail?: WebGuardrailPort;
  readonly guardrailEnabled?: boolean;
  readonly watermark?: WebWatermarkPort;
  readonly getWatermarkEnabled?: () => boolean;
  readonly guardLocale?: string;
  readonly sessionStreamEnabled?: boolean;
  readonly activityStreamEnabled?: boolean;
}

const logger = getLogger({ component: 'agent-channel-web', source: 'websocket' });

export function registerWebSocketStream(instance: FastifyInstance, dependencies: WebSocketStreamDependencies): void {
  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const parsed = parseWebSocketStreamUrl(request.url, dependencies);
    if (parsed === undefined) {
      return;
    }
    void handleWebSocketStreamUpgrade(request, socket, head, parsed, dependencies);
  };
  instance.server.on('upgrade', onUpgrade);
  instance.addHook('onClose', async () => {
    instance.server.off('upgrade', onUpgrade);
  });
}

async function handleWebSocketStreamUpgrade(
  request: IncomingMessage,
  socket: Socket,
  _head: Buffer,
  parsed: WebSocketStreamUrl,
  dependencies: WebSocketStreamDependencies,
): Promise<void> {
  const serverRequestId = `ws-${randomUUID()}`;
  let trustedFields: Record<string, unknown> | undefined;
  try {
    assertAllowedWebSocketQuery(parsed);
    const key = websocketHeader(request, 'sec-websocket-key');
    if (key === undefined || websocketHeader(request, 'upgrade')?.toLowerCase() !== 'websocket') {
      sendHttpError(socket, 400, 'WEBSOCKET_HANDSHAKE_INVALID');
      return;
    }
    const identityContext = dependencies.identityResolver(request);
    if (parsed.kind === 'ACTIVITY') {
      if (dependencies.sessionActivities === undefined) {
        sendHttpError(socket, 404, 'SESSION_ACTIVITY_STREAM_NOT_FOUND');
        return;
      }
      trustedFields = { transport: 'WEBSOCKET', requestId: serverRequestId, streamKind: 'SESSION_ACTIVITY' };
      await deliverWebSocketMessages(
        socket,
        key,
        (signal) =>
          validateSessionActivityMessages(
            dependencies.sessionActivities!.streamSessionActivities({
              identityContext,
              signal,
            }),
          ),
        trustedFields,
      );
      return;
    }
    const sessionId = brand<string, 'SessionId'>(decodeURIComponent(parsed.sessionId));
    const session = await dependencies.sessions.requireSession({ identityContext, sessionId });
    trustedFields = { transport: 'WEBSOCKET', requestId: serverRequestId, agentId: session.agentId, sessionId };
    const lastSeenSequence = parseLastSeenSequence(parsed.searchParams.get('lastSeenSequence') ?? undefined);
    const requestId = parsed.searchParams.get('requestId');
    const runId = parsed.searchParams.get('runId');

    const brandedRequestId = requestId === null ? undefined : brand<string, 'MessageId'>(requestId);
    const brandedRunId = runId === null ? undefined : brand<string, 'RequestRunId'>(runId);
    if (lastSeenSequence !== undefined) {
      logger.debug({ event: 'stream.replay.started', ...trustedFields });
    }
    await deliverWebSocketMessages(
      socket,
      key,
      (signal) =>
        deliverWebStream({
          ...(dependencies.capabilityResultPresentationPolicy === undefined
            ? {}
            : {
                capabilityResultPresentationPolicy: dependencies.capabilityResultPresentationPolicy,
              }),
          sessions: dependencies.sessions,
          identityContext,
          sessionId,
          ...(lastSeenSequence === undefined ? {} : { lastSeenSequence }),
          ...(brandedRequestId === undefined ? {} : { requestId: brandedRequestId }),
          ...(brandedRunId === undefined ? {} : { runId: brandedRunId }),
          signal,
          ...(dependencies.guardrail === undefined
            ? {}
            : { guardrail: dependencies.guardrail, guardrailEnabled: dependencies.guardrailEnabled === true, guardLocale: dependencies.guardLocale }),
          ...(dependencies.watermark === undefined
            ? {}
            : { watermark: dependencies.watermark, getWatermarkEnabled: dependencies.getWatermarkEnabled }),
          ...(dependencies.runtime === undefined
            ? {}
            : {
                onOutputGuardBlocked: (envelope) => {
                  const runId = envelope.runId;
                  if (runId === undefined) {
                    return;
                  }
                  void dependencies.runtime!.hideRunMessages?.({
                    identityContext,
                    agentId: session.agentId,
                    sessionId,
                    requestId: envelope.requestId,
                    runId,
                    reason: 'GUARD_BLOCKED',
                  });
                },
              }),
          onDiagnostic: (diagnostic) => writeWebSocketDiagnostic(trustedFields!, diagnostic),
        }),
      trustedFields,
    );
  } catch (error) {
    if (!(error instanceof AgentError) || error.category === 'INTERNAL') {
      logger.error({
        err: error,
        event: 'stream.delivery.failed',
        transport: 'WEBSOCKET',
        serverRequestId,
        ...(trustedFields ?? {}),
        failureStage: 'STREAM_DELIVERY',
      });
    }
    sendHttpError(socket, statusFor(error), error instanceof AgentError ? error.code : 'WEBSOCKET_STREAM_FAILED');
  }
}

function writeWebSocketDiagnostic(fields: Record<string, unknown>, diagnostic: WebStreamDiagnostic): void {
  if (diagnostic.kind === 'STREAM_OPEN') {
    logger.debug({ event: 'stream.opened', ...fields });
    return;
  }
  if (diagnostic.kind === 'STREAM_CLOSE') {
    logger.debug({ event: 'stream.closed', ...fields });
    return;
  }
  logger.error({ event: 'stream.delivery.failed', ...fields, failureStage: 'STREAM_DELIVERY', safeReasonCode: diagnostic.code });
}

type WebSocketStreamUrl =
  | {
      readonly kind: 'SESSION';
      readonly sessionId: string;
      readonly searchParams: URLSearchParams;
    }
  | {
      readonly kind: 'ACTIVITY';
      readonly searchParams: URLSearchParams;
    };

function parseWebSocketStreamUrl(rawUrl: string | undefined, dependencies: WebSocketStreamDependencies): WebSocketStreamUrl | undefined {
  if (rawUrl === undefined) {
    return undefined;
  }
  const url = new URL(rawUrl, 'http://localhost');
  if (url.pathname === wsSessionActivityPath && dependencies.activityStreamEnabled === true && dependencies.sessionActivities !== undefined) {
    return { kind: 'ACTIVITY', searchParams: url.searchParams };
  }
  const sessionEnabled = dependencies.sessionStreamEnabled !== false;
  const match = sessionEnabled ? wsSessionPathPattern.exec(url.pathname) : null;
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  return { kind: 'SESSION', sessionId: match[1], searchParams: url.searchParams };
}

async function deliverWebSocketMessages(
  socket: Socket,
  key: string,
  createMessages: (signal: AbortSignal) => AsyncIterable<unknown>,
  trustedFields: Record<string, unknown>,
): Promise<void> {
  sendWebSocketHandshake(socket, key);
  const abortController = new AbortController();
  let incoming: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const closeSubscription = () => abortController.abort();
  socket.on('close', closeSubscription);
  socket.on('error', closeSubscription);
  socket.on('data', (chunk) => {
    incoming = consumeClientFrames(socket, Buffer.concat([incoming, chunk]), closeSubscription);
  });
  let streamFailed = false;
  try {
    for await (const message of createMessages(abortController.signal)) {
      if (socket.destroyed) {
        return;
      }
      const delivered = await sendWebSocketText(socket, JSON.stringify(message));
      if (!delivered) {
        abortController.abort();
        logger.warn({ event: 'stream.backpressure', ...trustedFields, safeReasonCode: 'BACKPRESSURE_TIMEOUT' });
        sendWebSocketClose(socket, 1011, 'BACKPRESSURE_TIMEOUT');
        return;
      }
    }
  } catch (error) {
    streamFailed = true;
    abortController.abort();
    logger.error({
      event: 'stream.delivery.failed',
      ...trustedFields,
      failureStage: 'STREAM_DELIVERY',
      safeReasonCode: error instanceof AgentError ? error.code : 'WEBSOCKET_STREAM_FAILED',
    });
    sendWebSocketClose(socket, 1011, 'stream failed');
  } finally {
    socket.off('close', closeSubscription);
    socket.off('error', closeSubscription);
    if (!streamFailed && !socket.destroyed) {
      sendWebSocketClose(socket, 1000, 'stream closed');
    }
  }
}

async function* validateSessionActivityMessages(messages: ReturnType<RuntimeSessionActivityPort['streamSessionActivities']>): AsyncIterable<unknown> {
  for await (const message of messages) {
    if (!Value.Check(sessionActivityMessageSchema, message)) {
      throw new AgentError({
        code: 'SESSION_ACTIVITY_PROJECTION_INVALID',
        message: 'Session activity projection is unavailable.',
        category: 'VALIDATION',
        retryable: true,
      });
    }
    yield message;
  }
}

function assertAllowedWebSocketQuery(parsed: WebSocketStreamUrl): void {
  if (parsed.kind === 'ACTIVITY' && [...parsed.searchParams.keys()].length > 0) {
    throw new AgentError({
      code: 'WEBSOCKET_STREAM_QUERY_INVALID',
      message: 'WebSocket stream query is invalid.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WEBSOCKET_STREAM_QUERY_INVALID' },
    });
  }
  const searchParams = parsed.searchParams;
  const allowed = new Set(['lastSeenSequence', 'requestId', 'runId']);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new AgentError({
        code: 'WEBSOCKET_STREAM_QUERY_INVALID',
        message: 'WebSocket stream query is invalid.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'WEBSOCKET_STREAM_QUERY_INVALID' },
      });
    }
  }
}

function websocketHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Write the 101 Switching Protocols handshake onto a raw socket.
 *
 * Exported solely for direct unit testing of the security headers applied to
 * the bypass-onSend handshake path. Production code reaches this via
 * `deliverWebSocketMessages`; callers must NOT depend on this export.
 * @internal
 */
export function sendWebSocketHandshake(socket: Socket, key: string): void {
  const accept = createHash('sha1').update(`${key}${websocketGuid}`).digest('base64');
  // The 101 Switching Protocols response bypasses Fastify's onSend hook (the
  // WebSocket upgrade is handled on `instance.server.on('upgrade')` and written
  // to a raw socket). Browsers ignore most hardening headers on a 101 response,
  // but compliance scanners check for their presence, and the headers are
  // semantically harmless here. All headers are applied unconditionally.
  const securityHeaders = buildSecurityResponseHeaders();
  const handshakeLines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`];
  for (const [name, value] of Object.entries(securityHeaders)) {
    handshakeLines.push(`${name}: ${value}`);
  }
  handshakeLines.push('', '');
  socket.write(handshakeLines.join('\r\n'));
}

/**
 * Write a JSON HTTP error response onto a raw socket (used when the WebSocket
 * handshake is rejected before upgrade).
 *
 * Exported solely for direct unit testing of the security headers applied to
 * this bypass-onSend error path. Production code reaches this via
 * `handleWebSocketStreamUpgrade`; callers must NOT depend on this export.
 * @internal
 */
export function sendHttpError(socket: Socket, statusCode: number, code: string): void {
  if (socket.destroyed) {
    return;
  }
  const body = JSON.stringify({ error: { code, message: 'WebSocket stream failed safely.' } });
  // This is a real HTTP error response (handshake rejected before upgrade), so
  // it MUST carry the full security header set. The onSend hook does not run for
  // raw-socket writes, so re-apply the headers here.
  const securityHeaders = buildSecurityResponseHeaders();
  const lines = [
    `HTTP/1.1 ${statusCode} ${statusText(statusCode)}`,
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
  ];
  for (const [name, value] of Object.entries(securityHeaders)) {
    lines.push(`${name}: ${value}`);
  }
  lines.push('', body);
  socket.end(lines.join('\r\n'));
}

async function sendWebSocketText(socket: Socket, text: string): Promise<boolean> {
  const accepted = writeWebSocketFrame(socket, 0x1, Buffer.from(text, 'utf8'));
  return accepted || waitForSocketDrain(socket, streamBackpressureTimeoutMs);
}

function sendWebSocketClose(socket: Socket, code: number, reason: string): void {
  if (!canWrite(socket)) {
    return;
  }
  const reasonBuffer = Buffer.from(reason.slice(0, 80), 'utf8');
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  writeWebSocketFrame(socket, 0x8, payload);
  if (!socket.writableEnded) {
    socket.end();
  }
}

function sendWebSocketPong(socket: Socket, payload: Buffer<ArrayBufferLike>): boolean {
  return writeWebSocketFrame(socket, 0xa, payload);
}

function writeWebSocketFrame(socket: Socket, opcode: number, payload: Buffer): boolean {
  if (!canWrite(socket)) {
    return false;
  }
  let header: Buffer;
  if (payload.length <= 125) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return socket.write(Buffer.concat([header, payload]));
}

async function waitForSocketDrain(socket: Socket, timeoutMs: number): Promise<boolean> {
  if (!canWrite(socket)) {
    return false;
  }
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (drained: boolean) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      socket.off('drain', onDrain);
      socket.off('close', onClose);
      socket.off('error', onError);
      resolve(drained);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    const onError = () => finish(false);
    timeout = setTimeout(() => finish(false), timeoutMs);
    socket.once('drain', onDrain);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

function canWrite(socket: Socket): boolean {
  return !socket.destroyed && !socket.writableEnded;
}

function consumeClientFrames(socket: Socket, buffer: Buffer<ArrayBufferLike>, onClose: () => void): Buffer<ArrayBufferLike> {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;
    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const length = buffer.readBigUInt64BE(offset + 2);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
        sendWebSocketClose(socket, 1009, 'frame too large');
        onClose();
        return Buffer.alloc(0);
      }
      payloadLength = Number(length);
      headerLength = 10;
    }
    if (payloadLength > maxWebSocketFramePayloadBytes) {
      sendWebSocketClose(socket, 1009, 'frame too large');
      onClose();
      return Buffer.alloc(0);
    }
    const isControlFrame = opcode >= 0x8;
    if (isControlFrame && payloadLength > maxWebSocketControlFramePayloadBytes) {
      sendWebSocketClose(socket, 1002, 'control frame too large');
      onClose();
      return Buffer.alloc(0);
    }
    const maskLength = masked ? 4 : 0;
    const frameEnd = offset + headerLength + maskLength + payloadLength;
    if (frameEnd > buffer.length) {
      break;
    }
    if (!fin || !masked) {
      sendWebSocketClose(socket, 1002, 'protocol error');
      onClose();
      return Buffer.alloc(0);
    }
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : Buffer.alloc(0);
    const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, frameEnd));
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i]! ^ mask[i % 4]!;
    }
    if (opcode === 0x8) {
      onClose();
      sendWebSocketClose(socket, 1000, 'client closed');
      return Buffer.alloc(0);
    }
    if (opcode === 0x9) {
      const pongAccepted = sendWebSocketPong(socket, payload);
      if (!pongAccepted) {
        sendWebSocketClose(socket, 1011, 'backpressure timeout');
        onClose();
        return Buffer.alloc(0);
      }
    }
    offset = frameEnd;
  }
  return buffer.subarray(offset);
}

function statusFor(error: unknown): number {
  if (!(error instanceof AgentError)) {
    return 500;
  }
  if (error.code === 'LOCAL_AUTH_REQUIRED') {
    return 401;
  }
  if (error.category === 'AUTHORIZATION') {
    return 403;
  }
  if (error.category === 'NOT_FOUND') {
    return 404;
  }
  if (error.category === 'CONFLICT') {
    return 409;
  }
  return 400;
}

function statusText(statusCode: number): string {
  if (statusCode === 400) {
    return 'Bad Request';
  }
  if (statusCode === 401) {
    return 'Unauthorized';
  }
  if (statusCode === 403) {
    return 'Forbidden';
  }
  if (statusCode === 404) {
    return 'Not Found';
  }
  if (statusCode === 409) {
    return 'Conflict';
  }
  return 'Internal Server Error';
}
