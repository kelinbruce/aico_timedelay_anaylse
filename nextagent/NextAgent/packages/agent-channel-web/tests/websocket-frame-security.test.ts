import { brand } from '@nextagent/agent-common';
import type { RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { registerWebChannel, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { connect, Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const ONE_MIB = 1 * 1024 * 1024;
const SESSION_PATH = '/api/v1/sessions/session-frame-security/ws';

function craftMaskedFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    maskedPayload[i] = payload[i]! ^ mask[i % 4]!;
  }
  if (payload.length <= 125) {
    return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, maskedPayload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, mask, maskedPayload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, mask, maskedPayload]);
}

function craftMaskedFrameHeader(opcode: number, declaredPayloadLength: number): Buffer {
  if (declaredPayloadLength <= 125) {
    return Buffer.from([0x80 | opcode, 0x80 | declaredPayloadLength]);
  }
  if (declaredPayloadLength <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(declaredPayloadLength, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(declaredPayloadLength), 2);
  return header;
}

interface ServerFrame {
  readonly opcode: number;
  readonly payload: Buffer;
}

interface RawWebSocketClient {
  readonly handshake: (port: number, path: string) => Promise<void>;
  readonly readFrame: (timeoutMs?: number) => Promise<ServerFrame>;
  readonly readCloseFrame: (timeoutMs?: number) => Promise<{ code: number; reason: string }>;
  readonly send: (data: Buffer) => boolean;
  readonly destroy: () => void;
}

function createRawClient(socket: Socket): RawWebSocketClient {
  let buffer = Buffer.alloc(0);
  let closed = false;
  const waiters: Array<{
    readonly check: () => boolean;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }> = [];

  const drainWaiters = () => {
    if (waiters.length === 0) {
      return;
    }
    const remaining: typeof waiters = [];
    for (const waiter of waiters) {
      if (waiter.check()) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    waiters.length = 0;
    waiters.push(...remaining);
  };

  const dataListener = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    drainWaiters();
  };

  const failWaiters = (message: string) => {
    const error = new Error(message);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
    waiters.length = 0;
  };

  const closeListener = () => {
    if (closed) {
      return;
    }
    closed = true;
    failWaiters('Socket closed before frame received.');
  };

  const errorListener = () => {
    if (closed) {
      return;
    }
    closed = true;
    failWaiters('Socket error while waiting for data.');
  };

  socket.on('data', dataListener);
  socket.once('close', closeListener);
  socket.once('error', errorListener);

  function waitForData(check: () => boolean, timeoutMs: number): Promise<void> {
    if (check()) {
      return Promise.resolve();
    }
    if (closed) {
      return Promise.reject(new Error('Socket is already closed.'));
    }
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        const idx = waiters.findIndex((w) => w.resolve === resolveFn);
        if (idx !== -1) {
          waiters.splice(idx, 1);
        }
        reject(new Error('Timed out waiting for server frame.'));
      }, timeoutMs);
      const resolveFn = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        resolve();
      };
      const rejectFn = (error: Error) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        reject(error);
      };
      waiters.push({ check, resolve: resolveFn, reject: rejectFn });
    });
  }

  function tryParseFrame(): { opcode: number; payload: Buffer; frameEnd: number } | null {
    if (buffer.length < 2) {
      return null;
    }
    const payloadLength = buffer[1]! & 0x7f;
    let headerLength = 2;
    if (payloadLength === 126) {
      if (buffer.length < 4) {
        return null;
      }
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) {
        return null;
      }
      headerLength = 10;
    }
    const actualPayloadLength =
      payloadLength === 126 ? buffer.readUInt16BE(2) : payloadLength === 127 ? Number(buffer.readBigUInt64BE(2)) : payloadLength;
    const frameEnd = headerLength + actualPayloadLength;
    if (buffer.length < frameEnd) {
      return null;
    }
    const payload = Buffer.from(buffer.subarray(headerLength, frameEnd));
    return { opcode: buffer[0]! & 0x0f, payload, frameEnd };
  }

  async function handshake(port: number, path: string): Promise<void> {
    const key = randomBytes(16).toString('base64');
    const request = [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');
    socket.write(request);
    await waitForData(() => buffer.indexOf('\r\n\r\n') !== -1, 3000);
    const headerEnd = buffer.indexOf('\r\n\r\n');
    const headerStr = buffer.subarray(0, headerEnd).toString('ascii');
    if (!headerStr.startsWith('HTTP/1.1 101')) {
      throw new Error(`Handshake failed: ${headerStr}`);
    }
    buffer = buffer.subarray(headerEnd + 4);
  }

  async function readFrame(timeoutMs = 3000): Promise<ServerFrame> {
    await waitForData(() => tryParseFrame() !== null, timeoutMs);
    const frame = tryParseFrame()!;
    buffer = buffer.subarray(frame.frameEnd);
    return { opcode: frame.opcode, payload: frame.payload };
  }

  async function readCloseFrame(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    const frame = await readFrame(timeoutMs);
    if (frame.opcode !== 0x8) {
      throw new Error(`Expected close frame, got opcode ${frame.opcode}.`);
    }
    const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005;
    const reason = frame.payload.length > 2 ? frame.payload.subarray(2).toString('utf8') : '';
    return { code, reason };
  }

  function send(data: Buffer): boolean {
    return socket.write(data);
  }

  function destroy(): void {
    if (closed) {
      return;
    }
    closed = true;
    socket.off('data', dataListener);
    socket.off('close', closeListener);
    socket.off('error', errorListener);
    if (!socket.destroyed) {
      try {
        socket.write(craftMaskedFrame(0x8, Buffer.from([0x03, 0xe8])));
        socket.end();
      } catch {
        // socket already closed
      }
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, 500);
    } else {
      socket.destroy();
    }
  }

  return { handshake, readFrame, readCloseFrame, send, destroy };
}

async function createTestServer(): Promise<{ app: ReturnType<typeof Fastify>; port: number }> {
  const identityContext = {
    tenantId: brand<string, 'TenantId'>('tenant-frame-security'),
    subjectId: brand<string, 'SubjectId'>('subject-frame-security'),
    displayName: 'Frame Security Tester',
  };
  const requireSession = vi.fn(async () => ({
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId: brand<string, 'AgentId'>('agent-frame-security'),
    sessionId: brand<string, 'SessionId'>('session-frame-security'),
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  }));
  const sessions = {
    requireSession,
    streamEvents: vi.fn(async function* (args: { signal: AbortSignal }) {
      await new Promise<void>((resolve) => {
        if (args.signal.aborted) {
          resolve();
          return;
        }
        args.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }),
  } as unknown as RuntimeSessionPort;
  const app = Fastify();
  await registerWebChannel(app, {
    runtime: {},
    sessions,
    identityResolver: () => identityContext,
    runtimeBootstrap: { transportKind: 'WEBSOCKET' },
    defaultAgentId: brand<string, 'AgentId'>('agent-frame-security'),
  } as unknown as WebChannelDependencies);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fastify did not expose a TCP address.');
  }
  return { app, port: address.port };
}

describe('WebSocket frame security', () => {
  it('rejects frame payload exceeding 1 MiB with close 1009', async () => {
    const { app, port } = await createTestServer();
    const client = createRawClient(connect({ host: '127.0.0.1', port }));
    try {
      await client.handshake(port, SESSION_PATH);
      client.send(craftMaskedFrameHeader(0x2, ONE_MIB + 1));
      const close = await client.readCloseFrame();
      expect(close.code).toBe(1009);
    } finally {
      client.destroy();
      await app.close();
    }
  });

  it('rejects control frame payload exceeding 125 bytes with close 1002', async () => {
    const { app, port } = await createTestServer();
    const client = createRawClient(connect({ host: '127.0.0.1', port }));
    try {
      await client.handshake(port, SESSION_PATH);
      client.send(craftMaskedFrameHeader(0x9, 126));
      const close = await client.readCloseFrame();
      expect(close.code).toBe(1002);
    } finally {
      client.destroy();
      await app.close();
    }
  });

  it('accepts valid data frame under 1 MiB', async () => {
    const { app, port } = await createTestServer();
    const client = createRawClient(connect({ host: '127.0.0.1', port }));
    try {
      await client.handshake(port, SESSION_PATH);
      client.send(craftMaskedFrame(0x1, Buffer.from('hello', 'utf8')));
      const pingPayload = Buffer.from('alive', 'utf8');
      client.send(craftMaskedFrame(0x9, pingPayload));
      const pong = await client.readFrame();
      expect(pong.opcode).toBe(0xa);
      expect(pong.payload.equals(pingPayload)).toBe(true);
    } finally {
      client.destroy();
      await app.close();
    }
  });

  it('responds with pong when ping is received', async () => {
    const { app, port } = await createTestServer();
    const client = createRawClient(connect({ host: '127.0.0.1', port }));
    try {
      await client.handshake(port, SESSION_PATH);
      const pingPayload = Buffer.from('test', 'utf8');
      client.send(craftMaskedFrame(0x9, pingPayload));
      const pong = await client.readFrame();
      expect(pong.opcode).toBe(0xa);
      expect(pong.payload.equals(pingPayload)).toBe(true);
    } finally {
      client.destroy();
      await app.close();
    }
  });

  it('closes connection with 1011 when pong write fails due to backpressure', async () => {
    const originalWrite = Socket.prototype.write;
    const spy = vi.spyOn(Socket.prototype, 'write');
    spy.mockImplementation(function (this: Socket, data: unknown, ...rest: unknown[]) {
      if (Buffer.isBuffer(data) && data.length > 0 && data[0] === 0x8a) {
        return false;
      }
      return Reflect.apply(originalWrite, this, [data, ...rest]) as boolean;
    });
    const { app, port } = await createTestServer();
    const client = createRawClient(connect({ host: '127.0.0.1', port }));
    try {
      await client.handshake(port, SESSION_PATH);
      client.send(craftMaskedFrame(0x9, Buffer.from('bp', 'utf8')));
      const close = await client.readCloseFrame();
      expect(close.code).toBe(1011);
    } finally {
      spy.mockRestore();
      client.destroy();
      await app.close();
    }
  });

  it('does not queue further pong after backpressure failure', async () => {
    const originalWrite = Socket.prototype.write;
    const spy = vi.spyOn(Socket.prototype, 'write');
    spy.mockImplementation(function (this: Socket, data: unknown, ...rest: unknown[]) {
      if (Buffer.isBuffer(data) && data.length > 0 && data[0] === 0x8a) {
        return false;
      }
      return Reflect.apply(originalWrite, this, [data, ...rest]) as boolean;
    });
    const { app, port } = await createTestServer();
    const client = createRawClient(connect({ host: '127.0.0.1', port }));
    try {
      await client.handshake(port, SESSION_PATH);
      const frame1 = craftMaskedFrame(0x9, Buffer.from('p1', 'utf8'));
      const frame2 = craftMaskedFrame(0x9, Buffer.from('p2', 'utf8'));
      client.send(Buffer.concat([frame1, frame2]));
      const close = await client.readCloseFrame();
      expect(close.code).toBe(1011);
    } finally {
      spy.mockRestore();
      client.destroy();
      await app.close();
    }
  });
});
