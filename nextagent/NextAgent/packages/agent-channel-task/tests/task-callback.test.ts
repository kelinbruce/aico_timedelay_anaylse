import { brand, type JsonObject } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEvent, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createHttpTaskCallbackDelivery, validateTaskCallbackTarget } from '../src/http-task-callback.js';
import { deliverTaskCallbacks } from '../src/task-callback.js';
import { projectStreamEnvelopeToTaskEvent, isCallbackEventType, isTerminalTaskEventType, type TaskEvent } from '../src/task-status.js';

async function createUdsTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ socketPath: string; close: () => void }> {
  const socketPath = path.join(os.tmpdir(), `nextagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return { socketPath, close: () => server.close() };
}

describe('projectStreamEnvelopeToTaskEvent', () => {
  it('projects a completed event with external coordinates', () => {
    expect(projectStreamEnvelopeToTaskEvent(envelope('REQUEST_COMPLETED', { content: 'done' }))).toEqual({
      eventId: 'evt-1',
      eventType: 'TASK_COMPLETED',
      sessionId: 'sess-123',
      taskId: 'req-456',
      sequence: 42,
      createdAt: 1700000000000,
      payload: { content: 'done' },
    });
  });

  it('projects user input recovery data in payload', () => {
    const event = projectStreamEnvelopeToTaskEvent(
      envelope('USER_INPUT_REQUIRED', {
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        questions: [{ prompt: 'continue?', options: [] }],
        timeoutAt: 1700000030000,
        metadata: { source: 'user-check' },
      }),
    );

    expect(event).toMatchObject({
      eventType: 'USER_INPUT_REQUIRED',
      payload: {
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        questions: [{ prompt: 'continue?', options: [] }],
        timeoutAt: 1700000030000,
        metadata: { source: 'user-check' },
      },
    });
  });

  it('projects user input without timeout in payload', () => {
    const event = projectStreamEnvelopeToTaskEvent(
      envelope('USER_INPUT_REQUIRED', {
        pendingInputId: 'pending-1',
        questions: [],
      }),
    );

    expect(event.eventType).toBe('USER_INPUT_REQUIRED');
    expect(event.payload).not.toHaveProperty('timeoutAt');
  });

  it('projects all stream event types without filtering', () => {
    const contentEvent = projectStreamEnvelopeToTaskEvent(envelope('LLM_CONTENT_DELTA', { content: 'partial' }));
    expect(contentEvent.eventType).toBe('CONTENT_DELTA');
    expect(contentEvent.payload).toEqual({ content: 'partial' });

    const backgroundEvent = projectStreamEnvelopeToTaskEvent(envelope('BACKGROUND_TASK_COMPLETED', {}));
    expect(backgroundEvent.eventType).toBe('BACKGROUND_TASK_COMPLETED');
  });

  it.each([
    ['REQUEST_COMPLETED', 'TASK_COMPLETED'],
    ['REQUEST_FAILED', 'TASK_FAILED'],
    ['REQUEST_CANCELED', 'TASK_CANCELED'],
    ['USER_INPUT_REQUIRED', 'USER_INPUT_REQUIRED'],
  ] as const)('projects %s as the task event type %s', (streamType, taskEventType) => {
    expect(projectStreamEnvelopeToTaskEvent(envelope(streamType, {})).eventType).toBe(taskEventType);
  });
});

describe('isCallbackEventType', () => {
  it('returns true for callback event types', () => {
    expect(isCallbackEventType('TASK_COMPLETED')).toBe(true);
    expect(isCallbackEventType('TASK_FAILED')).toBe(true);
    expect(isCallbackEventType('TASK_CANCELED')).toBe(true);
    expect(isCallbackEventType('USER_INPUT_REQUIRED')).toBe(true);
  });

  it('returns false for non-callback event types', () => {
    expect(isCallbackEventType('CONTENT_DELTA')).toBe(false);
    expect(isCallbackEventType('BACKGROUND_TASK_COMPLETED')).toBe(false);
  });
});

describe('isTerminalTaskEventType', () => {
  it('returns true for terminal event types', () => {
    expect(isTerminalTaskEventType('TASK_COMPLETED')).toBe(true);
    expect(isTerminalTaskEventType('TASK_FAILED')).toBe(true);
    expect(isTerminalTaskEventType('TASK_CANCELED')).toBe(true);
    expect(isTerminalTaskEventType('TASK_SUPERSEDED')).toBe(true);
  });

  it('returns false for non-terminal event types', () => {
    expect(isTerminalTaskEventType('USER_INPUT_REQUIRED')).toBe(false);
    expect(isTerminalTaskEventType('CONTENT_DELTA')).toBe(false);
  });
});

describe('HTTP Task callback transport', () => {
  it('delivers an HTTP callback to an IPv6 literal endpoint over a real socket', async () => {
    let receivedRequest = false;
    const server = http.createServer((_request, response) => {
      receivedRequest = true;
      response.writeHead(204);
      response.end();
    });
    try {
      const port = await listenOnIpv6Loopback(server);
      const origin = `http://[::1]:${port}`;
      const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: [origin] });

      await expect(
        delivery.deliver({ target: { url: `${origin}/callback` }, events: [completedEvent()] }, new AbortController().signal),
      ).resolves.toBe(true);
      expect(receivedRequest).toBe(true);
    } finally {
      await closeTestServer(server);
    }
  });

  it('delivers an insecure HTTPS callback to an IPv6 literal endpoint over a real socket', async () => {
    let receivedRequest = false;
    const server = https.createServer({ key: ipv6TestPrivateKey, cert: ipv6TestCertificate }, (_request, response) => {
      receivedRequest = true;
      response.writeHead(204);
      response.end();
    });
    try {
      const port = await listenOnIpv6Loopback(server);
      const origin = `https://[::1]:${port}`;
      const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: [origin], tlsInsecure: true });

      await expect(
        delivery.deliver({ target: { url: `${origin}/callback` }, events: [completedEvent()] }, new AbortController().signal),
      ).resolves.toBe(true);
      expect(receivedRequest).toBe(true);
    } finally {
      await closeTestServer(server);
    }
  });

  it('posts only the fixed events payload', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['https://ir.example'],
      fetch: fetchImplementation,
    });
    const event = completedEvent();

    await expect(
      delivery.deliver(
        {
          target: { url: 'https://ir.example/callback' },
          events: [event],
        },
        new AbortController().signal,
      ),
    ).resolves.toBe(true);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://ir.example/callback');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({ events: [event] });
  });

  it.each([
    'https://evil.example/callback',
    'file:///tmp/callback',
    'https://user:secret@ir.example/callback',
    'https://ir.example/callback#fragment',
  ])('rejects an unsafe target before fetch: %s', async (url) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['https://ir.example'],
      fetch: fetchImplementation,
    });

    await expect(
      delivery.deliver(
        {
          target: { url },
          events: [completedEvent()],
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CALLBACK_TARGET_REJECTED' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('validates exact configured origins', () => {
    expect(validateTaskCallbackTarget({ url: 'http://internal-ir.local:8080/callback' }, ['http://internal-ir.local:8080']).pathname).toBe(
      '/callback',
    );
  });

  it('validates a relative URL with udsOrigin', () => {
    expect(validateTaskCallbackTarget({ url: '/rest/naie/callback' }, ['http://localhost'], 'http://localhost').href).toBe(
      'http://localhost/rest/naie/callback',
    );
  });

  it('rejects a relative URL without udsOrigin', () => {
    expect(() => validateTaskCallbackTarget({ url: '/rest/naie/callback' }, ['http://localhost'])).toThrow();
  });

  it('preserves multiple callback events in canonical sequence order', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: ['https://ir.example'], fetch: fetchImplementation });
    const first = { ...completedEvent(), eventId: 'evt-1', sequence: 10 } as TaskEvent;
    const second = { ...completedEvent(), eventId: 'evt-2', sequence: 11 } as TaskEvent;

    await expect(
      delivery.deliver({ target: { url: 'https://ir.example/callback' }, events: [first, second] }, new AbortController().signal),
    ).resolves.toBe(true);

    const body = fetchImplementation.mock.calls[0]?.[1]?.body;
    expect(JSON.parse(String(body)).events.map((event: { eventId: string }) => event.eventId)).toEqual(['evt-1', 'evt-2']);
  });

  it('rejects empty or out-of-order event batches before fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: ['https://ir.example'], fetch: fetchImplementation });
    const later = { ...completedEvent(), eventId: 'evt-later', sequence: 2 } as TaskEvent;
    const earlier = { ...completedEvent(), eventId: 'evt-earlier', sequence: 1 } as TaskEvent;

    await expect(
      delivery.deliver({ target: { url: 'https://ir.example/callback' }, events: [] }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'TASK_CALLBACK_PAYLOAD_INVALID' });
    await expect(
      delivery.deliver({ target: { url: 'https://ir.example/callback' }, events: [later, earlier] }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'TASK_CALLBACK_PAYLOAD_INVALID' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects an oversized callback payload before fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: ['https://ir.example'], fetch: fetchImplementation });
    const oversized = { ...completedEvent(), payload: { content: 'x'.repeat(1024 * 1024) } } as TaskEvent;

    await expect(
      delivery.deliver({ target: { url: 'https://ir.example/callback' }, events: [oversized] }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'TASK_CALLBACK_PAYLOAD_INVALID' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('resolves a relative callback URL against udsOrigin and delivers via fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['http://localhost'],
      udsOrigin: 'http://localhost',
      fetch: fetchImplementation,
    });

    await expect(
      delivery.deliver(
        {
          target: { url: '/rest/naie/aiagent/v1/resources/service-api-sync' },
          events: [completedEvent()],
        },
        new AbortController().signal,
      ),
    ).resolves.toBe(true);

    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe('http://localhost/rest/naie/aiagent/v1/resources/service-api-sync');
  });

  it('rejects a relative URL when no udsOrigin is configured', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['http://localhost'],
      fetch: fetchImplementation,
    });

    await expect(
      delivery.deliver(
        {
          target: { url: '/rest/naie/callback' },
          events: [completedEvent()],
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CALLBACK_TARGET_REJECTED' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('delivers via UDS socket when socketPath is set', async () => {
    let server: { socketPath: string; close: () => void };
    try {
      server = await createUdsTestServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });
    } catch {
      // UDS sockets may be unavailable on some platforms (e.g. Windows temp dir ACLs).
      return;
    }
    try {
      const delivery = createHttpTaskCallbackDelivery({
        allowedOrigins: ['http://localhost'],
        socketPath: server.socketPath,
        udsOrigin: 'http://localhost',
      });

      await expect(
        delivery.deliver(
          {
            target: { url: '/rest/naie/callback' },
            events: [completedEvent()],
          },
          new AbortController().signal,
        ),
      ).resolves.toBe(true);
    } finally {
      server.close();
    }
  });

  it('returns false on UDS connection failure', async () => {
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['http://localhost'],
      socketPath: path.join(os.tmpdir(), `nonexistent-socket-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`),
      udsOrigin: 'http://localhost',
    });

    await expect(
      delivery.deliver(
        {
          target: { url: '/rest/naie/callback' },
          events: [completedEvent()],
        },
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });

  it('rejects network callbacks when allowedOrigins is empty', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: [], fetch: fetchImplementation });

    await expect(
      delivery.deliver(
        {
          target: { url: 'https://10.0.0.5:8443/callback' },
          events: [completedEvent()],
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CALLBACK_TARGET_REJECTED' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('still rejects protocol/credential/fragment when allowedOrigins is empty', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({ allowedOrigins: [], fetch: fetchImplementation });

    for (const url of ['file:///tmp/callback', 'https://user:secret@host/callback', 'https://host/callback#frag']) {
      await expect(
        delivery.deliver(
          {
            target: { url },
            events: [completedEvent()],
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'TASK_CALLBACK_TARGET_REJECTED' });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('routes HTTPS through insecure transport when tlsInsecure is true', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['https://127.0.0.1:1'],
      tlsInsecure: true,
      fetch: fetchImplementation,
    });

    // HTTPS target: fetch must NOT be called (goes through https.request instead).
    // Delivery will fail (no server listening), but that proves routing, not fetch.
    await delivery.deliver(
      {
        target: { url: 'https://127.0.0.1:1/callback' },
        events: [completedEvent()],
      },
      new AbortController().signal,
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('still uses fetch for HTTP when tlsInsecure is true', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const delivery = createHttpTaskCallbackDelivery({
      allowedOrigins: ['http://10.0.0.5:8080'],
      tlsInsecure: true,
      fetch: fetchImplementation,
    });

    await expect(
      delivery.deliver(
        {
          target: { url: 'http://10.0.0.5:8080/callback' },
          events: [completedEvent()],
        },
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

async function listenOnIpv6Loopback(server: http.Server | https.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function closeTestServer(server: http.Server | https.Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

const ipv6TestPrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDFhJBVNgUpGYT0
f45SJSSX+o5E9UV2Lt+Mmz68bKjaagYZ5CsTEITCHL3UY2BvcZvS5n3uPSyljj7k
1oR/tQCaja5kc03n4SrVCGGArvA6aEOrJ1tl+POMZy+Aok/jkV6Pp1s3HFKsqNOs
vXHD21SUrR2WodhsJyB996OVU5LEZqDcm2xF2NI5OaQfzVjqJmsFd5JsSuzq1NPn
Dpsl+LOfNfkblSiW7Qc5LxE1tDpGLvxEVi9pz5LKYkOoQoVrITJhOyBQ4FUpFegc
VOmDzLjyT6F1Z5aN8x4Y3m26NDSP/tIblEHScroDtDUoeeQpffDflz7txicqMWKp
7FLlPtoPAgMBAAECggEAR6zRS3qs6Lsv+iGHnduIqfXsRq3SpQ5hZP65B1tO8uNi
j2azEtn9swsG/9mIFyjc6O1naVqdpv41aIlHz6f5LhyX2i/VZ33YMzI1X6Mb3bYU
SDmh+yEaECspm75Ky0PnUq3idd87SRiCp76fV/lxefpQMGdOyABy1ANXQ0ruiYIo
l2tTIXyRP+4k2Kmj1vUfPs0fyB7Vl0Uw3dDW9VG11MC4v4+ZrE0qrv3fIdl/l8kx
fEn53b92p5l1KeAxFo+8D9Db9ozy3T+igAicaXSAkt/W2QKJDdy0zdjt6IM3KLEj
fECj3uAPcjbuZLk0dJBhNG1axXfDYUOIgyMnbqwSsQKBgQD26dPprrsL5yVtByF+
rQBFy+q/fJcf4oeelSB59nswshRIl+E7ucenXgEroPSWBX+U3MV8sStIhNtXGsN5
R0IKvUGVOINxVtcQhul1ZCy19axqp5YzwPt6fS+bQV9U4bCyfy8VQ2qACTmgCA/+
7c+BTGhQWWTCN7O9zw/ebl3N5QKBgQDMyWFT/jitiReAMyWHQpXgzowr/OoZkQXs
trtKpf/mRvG0/UtTGwhSRQ1oi1VskK2U8Ze8hRZYiKclAjYY4IrBQQSiEqXbjVN9
tEI4kuyGZ+lbsgJdDFRV1v9zUgC7TE1uwfY2fR7vnVzCKzQ2E5ttpnIW1GxSZll0
0Rczffeo4wKBgAfwLpL1vie8z7Q4pXgIIdkcnDh5zfYFd2y+yKODLCS9pO9Mir47
09JqsEjxzMtB8/8aNfMzUvvq4Y5kWuJ8SwBDY2djwL4VF6b9X2YZyWI0Os3XA3o4
ex1OBwjLyj/VXbPvaNkbKMJjCYo+mB0PEjvK9BOZPCcOWWYB0TXKgJONAoGBAJnS
biwUGeinwCJIyNinuELLgtiLuiAIIeYjf91bgTMseOQVGp5LAN4jBiZP+pN4vRnS
usIdSaKoyrvuxEm9aBwvRVakITcgGeWjH9a07bsrlEqPFF1mJHbx7qFlqC0H7GXU
had6JmGf1wv2PdqcsbQUQUBKwS7HuEwZvo6sAPo3AoGBAL1YIURsuei6U1TE9mLS
sntvNtbe+yOwWmlMgYHlHfJXEr16Ti2IAVS/6eZkT4mbCmuct3thK/V40UHCeRqp
n5lMa7V/aJPNruX3S/oNq6GPq/8qiXkEYCmybVSOXj3iW1pYIcWqe4yQMDru3PKZ
5IZbuFTvZbCKE4dip65FI3t7
-----END PRIVATE KEY-----`;

const ipv6TestCertificate = `-----BEGIN CERTIFICATE-----
MIICyTCCAbGgAwIBAgIUL5Jf5QJoOg9H3uUO0/8byG4U6JMwDQYJKoZIhvcNAQEL
BQAwDjEMMAoGA1UEAwwDOjoxMB4XDTI2MDgwOTA5MzE1MFoXDTI2MDkwOTA5MzE1
MFowDjEMMAoGA1UEAwwDOjoxMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAxYSQVTYFKRmE9H+OUiUkl/qORPVFdi7fjJs+vGyo2moGGeQrExCEwhy91GNg
b3Gb0uZ97j0spY4+5NaEf7UAmo2uZHNN5+Eq1QhhgK7wOmhDqydbZfjzjGcvgKJP
45Fej6dbNxxSrKjTrL1xw9tUlK0dlqHYbCcgffejlVOSxGag3JtsRdjSOTmkH81Y
6iZrBXeSbErs6tTT5w6bJfiznzX5G5Uolu0HOS8RNbQ6Ri78RFYvac+SymJDqEKF
ayEyYTsgUOBVKRXoHFTpg8y48k+hdWeWjfMeGN5tujQ0j/7SG5RB0nK6A7Q1KHnk
KX3w35c+7cYnKjFiqexS5T7aDwIDAQABox8wHTAbBgNVHREEFDAShxAAAAAAAAAA
AAAAAAAAAAABMA0GCSqGSIb3DQEBCwUAA4IBAQAzn/QFb4Cx0F+j6a/SepE5juES
1Bn0gf1qyNo3IMa8kXrWn+hLTY57TxSydShUnHVFYNzkwPCETFcpphFX/4b2p8YY
BXExS/0iPFmNL9B+KGqLev2xBtp/KI7sxMsyPqE3oHVLCUkCAm88Xe4BXF3oBjvp
v2EL5fWlPEYZfE81e6XMHISrbHHLiiRibloscW/7ckbU/+bKg99S+W9Pdx7hkbi7
KkGdRB2RmLEM/yh5xoQBZysGlKsA5Z0mOXMyGF6oW9rgIQBbhBIsAdAShp4QICNL
EXbz9LkZ/zbHg2NH0TUKOEKQVtBr/wynYTEpFIHqcd4Sz0aHGaWxTw/S04Go
-----END CERTIFICATE-----`;

describe('deliverTaskCallbacks', () => {
  it('replays the request stream from sequence zero and delivers terminal data', async () => {
    const streamEvents = vi.fn(async function* () {
      yield completedTimelineEvent();
    });
    const deliver = vi.fn(async () => true);

    await deliverTaskCallbacks({
      sessions: { streamEvents } as unknown as RuntimeSessionPort,
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        displayName: 'Task callback test',
      },
      sessionId: brand<string, 'SessionId'>('sess-123'),
      requestId: brand<string, 'MessageId'>('req-456'),
      reportEvents: 'TERMINAL',
      options: {
        target: { url: 'https://ir.example/callback' },
        deliveryPort: { validateTarget() {}, deliver },
        maxRetries: 1,
      },
    });

    expect(streamEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-123',
        requestId: 'req-456',
        lastSeenSequence: 0,
      }),
    );
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [expect.objectContaining({ eventType: 'TASK_COMPLETED', taskId: 'req-456' })],
      }),
      expect.any(AbortSignal),
    );
  });

  it('retries with stable event identity and sequence', async () => {
    const sessions = {
      streamEvents: vi.fn(async function* () {
        yield completedTimelineEvent();
      }),
    } as unknown as RuntimeSessionPort;
    const deliver = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await deliverTaskCallbacks({
      sessions,
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        displayName: 'Task callback test',
      },
      sessionId: brand<string, 'SessionId'>('sess-123'),
      requestId: brand<string, 'MessageId'>('req-456'),
      reportEvents: 'TERMINAL',
      options: {
        target: { url: 'https://ir.example/callback' },
        deliveryPort: { validateTarget() {}, deliver },
        maxRetries: 2,
      },
    });

    const firstEvent = deliver.mock.calls[0]?.[0].events[0];
    const retriedEvent = deliver.mock.calls[1]?.[0].events[0];
    expect({ eventId: retriedEvent?.eventId, sequence: retriedEvent?.sequence }).toEqual({
      eventId: firstEvent?.eventId,
      sequence: firstEvent?.sequence,
    });
  });

  it('delivers user-input-required and stops the stream before terminal', async () => {
    const userInputTimeline: RunTimelineEvent = {
      ...completedTimelineEvent(),
      eventId: 'evt-input',
      sequence: brand<number, 'TimelineSequence'>(10),
      type: 'USER_INPUT_REQUIRED',
      inlinePayload: {
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        questions: [{ prompt: 'continue?', options: [] }],
        timeoutAt: 1700000030000,
      },
      createdAt: new Date(1700000010000),
    };
    const completedTimeline: RunTimelineEvent = {
      ...completedTimelineEvent(),
      eventId: 'evt-done',
      sequence: brand<number, 'TimelineSequence'>(20),
      createdAt: new Date(1700000020000),
    };
    const sessions = {
      streamEvents: vi.fn(async function* () {
        yield userInputTimeline;
        yield completedTimeline;
      }),
    } as unknown as RuntimeSessionPort;
    const deliver = vi.fn().mockResolvedValue(true);

    await deliverTaskCallbacks({
      sessions,
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        displayName: 'Task callback test',
      },
      sessionId: brand<string, 'SessionId'>('sess-123'),
      requestId: brand<string, 'MessageId'>('req-456'),
      reportEvents: 'TERMINAL',
      options: {
        target: { url: 'https://ir.example/callback' },
        deliveryPort: { validateTarget() {}, deliver },
        maxRetries: 1,
      },
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0].events[0]).toMatchObject({
      eventType: 'USER_INPUT_REQUIRED',
      taskId: 'req-456',
      payload: expect.objectContaining({
        pendingInputId: 'pending-1',
        timeoutAt: 1700000030000,
      }),
    });
  });
});

function completedTimelineEvent(): RunTimelineEvent {
  return {
    eventId: 'evt-1',
    sessionId: brand<string, 'SessionId'>('sess-123'),
    requestId: brand<string, 'MessageId'>('req-456'),
    runId: brand<string, 'RequestRunId'>('run-789'),
    sequence: brand<number, 'TimelineSequence'>(42),
    type: 'REQUEST_COMPLETED',
    inlinePayload: { content: 'done', hookResults: [] },
    createdAt: new Date(1700000000000),
  };
}

function completedEvent(): TaskEvent {
  return projectStreamEnvelopeToTaskEvent(envelope('REQUEST_COMPLETED', { content: 'done' }));
}

function envelope(eventType: StreamEnvelope['eventType'], payload: JsonObject): StreamEnvelope {
  return {
    eventId: 'evt-1',
    sessionId: brand<string, 'SessionId'>('sess-123'),
    requestId: brand<string, 'MessageId'>('req-456'),
    runId: brand<string, 'RequestRunId'>('run-789'),
    sequence: brand<number, 'TimelineSequence'>(42),
    eventType,
    transportHints: [],
    payload,
    createdAt: brand<number, 'EpochMillis'>(1700000000000),
  };
}
