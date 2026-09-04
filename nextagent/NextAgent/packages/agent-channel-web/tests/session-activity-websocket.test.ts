import { brand } from '@nextagent/agent-common';
import { registerWebChannel, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import type { RuntimeSessionActivityPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('session activity WebSocket route', () => {
  it('uses the single upgrade dispatcher for activity and detail stream paths', async () => {
    const identityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-activity-ws'),
      subjectId: brand<string, 'SubjectId'>('subject-activity-ws'),
      displayName: 'Activity WS Tester',
    };
    const sessionActivities: RuntimeSessionActivityPort = {
      streamSessionActivities: vi.fn(async function* () {
        yield {
          type: 'SNAPSHOT',
          entries: [{ sessionId: brand<string, 'SessionId'>('session-1'), status: 'RUNNING' }],
        } as const;
        yield {
          type: 'DELTA',
          entry: { sessionId: brand<string, 'SessionId'>('session-1'), status: 'NONE' },
        } as const;
      }),
      consumeSessionActivity: vi.fn(async () => undefined),
    };
    const requireSession = vi.fn(async () => ({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId: brand<string, 'AgentId'>('agent-activity-ws'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    }));
    const sessions = {
      requireSession,
      streamEvents: vi.fn(async function* () {}),
    } as unknown as RuntimeSessionPort;
    const app = Fastify();
    await registerWebChannel(app, {
      runtime: {},
      sessions,
      sessionActivities,
      identityResolver: () => identityContext,
      runtimeBootstrap: { transportKind: 'WEBSOCKET' },
      defaultAgentId: brand<string, 'AgentId'>('agent-activity-ws'),
    } as unknown as WebChannelDependencies);

    expect(app.server.listenerCount('upgrade')).toBe(1);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Fastify did not expose a TCP address.');
    }
    const baseUrl = `ws://127.0.0.1:${address.port}/api/v1`;

    expect(await readMessages(`${baseUrl}/session-activities/ws`)).toEqual([
      { type: 'SNAPSHOT', entries: [{ sessionId: 'session-1', status: 'RUNNING' }] },
      { type: 'DELTA', entry: { sessionId: 'session-1', status: 'NONE' } },
    ]);
    expect(requireSession).not.toHaveBeenCalled();

    expect(await readMessages(`${baseUrl}/sessions/session-1/ws`)).toEqual([]);
    expect(requireSession).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('closes the upgraded socket with a server error when an activity projection is invalid', async () => {
    const identityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-invalid-activity-ws'),
      subjectId: brand<string, 'SubjectId'>('subject-invalid-activity-ws'),
      displayName: 'Invalid Activity WS Tester',
    };
    const sessionActivities: RuntimeSessionActivityPort = {
      streamSessionActivities: vi.fn(async function* () {
        yield {
          type: 'SNAPSHOT',
          entries: [{ sessionId: brand<string, 'SessionId'>('session-1'), status: 'NONE' }],
        } as never;
      }),
      consumeSessionActivity: vi.fn(async () => undefined),
    };
    const sessions = {
      requireSession: vi.fn(),
      streamEvents: vi.fn(async function* () {}),
    } as unknown as RuntimeSessionPort;
    const app = Fastify();
    await registerWebChannel(app, {
      runtime: {},
      sessions,
      sessionActivities,
      identityResolver: () => identityContext,
      runtimeBootstrap: { transportKind: 'WEBSOCKET' },
      defaultAgentId: brand<string, 'AgentId'>('agent-invalid-activity-ws'),
    } as unknown as WebChannelDependencies);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Fastify did not expose a TCP address.');
    }

    const outcome = await readOutcome(`ws://127.0.0.1:${address.port}/api/v1/session-activities/ws`);

    expect(outcome).toEqual({
      messages: [],
      closeCode: 1011,
      closeReason: 'stream failed',
    });
    await app.close();
  });
});

interface TestWebSocket {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
}

async function readMessages(url: string): Promise<unknown[]> {
  return (await readOutcome(url)).messages;
}

async function readOutcome(url: string): Promise<{
  readonly messages: unknown[];
  readonly closeCode: number;
  readonly closeReason: string;
}> {
  const WebSocketCtor = (
    globalThis as unknown as {
      WebSocket: new (url: string) => TestWebSocket;
    }
  ).WebSocket;
  return new Promise((resolve, reject) => {
    const socket = new WebSocketCtor(url);
    const messages: unknown[] = [];
    const timeout = setTimeout(() => reject(new Error('WebSocket test timed out.')), 2_000);
    socket.onmessage = (event) => {
      messages.push(JSON.parse(String(event.data)));
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('WebSocket stream failed.'));
    };
    socket.onclose = (event) => {
      clearTimeout(timeout);
      resolve({
        messages,
        closeCode: event.code,
        closeReason: event.reason,
      });
    };
  });
}
