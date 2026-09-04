import { brand } from '@nextagent/agent-common';
import { registerWebChannel, sessionActivityMessageSchema, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import type { RuntimeSessionActivityPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { Value } from '@sinclair/typebox/value';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-activity-route'),
  subjectId: brand<string, 'SubjectId'>('subject-activity-route'),
  displayName: 'Activity Route Tester',
};

describe('session activity HTTP routes', () => {
  it('streams one scope snapshot followed by DELTA messages without execution envelopes', async () => {
    const streamSessionActivities = vi.fn(async function* () {
      yield {
        type: 'SNAPSHOT',
        entries: [{ sessionId: brand<string, 'SessionId'>('session-1'), status: 'RUNNING' }],
      } as const;
      yield {
        type: 'DELTA',
        entry: { sessionId: brand<string, 'SessionId'>('session-1'), status: 'NONE' },
      } as const;
    });
    const app = await createApp({
      streamSessionActivities,
      consumeSessionActivity: vi.fn(async () => undefined),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session-activities/stream',
    });

    expect(response.statusCode).toBe(200);
    expect(parseSseMessages(response.body)).toEqual([
      { type: 'SNAPSHOT', entries: [{ sessionId: 'session-1', status: 'RUNNING' }] },
      { type: 'DELTA', entry: { sessionId: 'session-1', status: 'NONE' } },
    ]);
    expect(response.body).not.toContain('eventType');
    expect(streamSessionActivities).toHaveBeenCalledWith({
      identityContext,
      signal: expect.any(AbortSignal),
    });
    await app.close();
  });

  it('accepts only activityId and observedRunId and returns 204 for matching or stale consumes', async () => {
    const consumeSessionActivity = vi.fn(async () => undefined);
    const app = await createApp({
      streamSessionActivities: vi.fn(async function* () {}),
      consumeSessionActivity,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/session-1/activity/consume',
      payload: { activityId: 'activity-1', observedRunId: 'run-1' },
    });

    expect(response.statusCode).toBe(204);
    expect(consumeSessionActivity).toHaveBeenCalledWith({
      identityContext,
      sessionId: 'session-1',
      activityId: 'activity-1',
      observedRunId: 'run-1',
    });

    for (const payload of [
      { activityId: 'activity-1', observedRunId: 'run-1', agentId: 'injected' },
      { activityId: 'x'.repeat(257), observedRunId: 'run-1' },
      { activityId: 'activity-1' },
    ]) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/session-1/activity/consume',
        payload,
      });
      expect(invalid.statusCode).toBe(400);
    }
    expect(consumeSessionActivity).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('keeps registerWebChannel source compatible when the optional activity port is absent', async () => {
    const app = await createApp();

    expect((await app.inject({ method: 'GET', url: '/api/v1/session-activities/stream' })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/sessions/session-1/activity/consume',
          payload: { activityId: 'activity-1', observedRunId: 'run-1' },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('rejects illegal conditional fields and unknown message fields at the projection boundary', () => {
    expect(
      Value.Check(sessionActivityMessageSchema, {
        type: 'SNAPSHOT',
        entries: [{ sessionId: 'session-1', status: 'NONE' }],
      }),
    ).toBe(false);
    expect(
      Value.Check(sessionActivityMessageSchema, {
        type: 'DELTA',
        entry: { sessionId: 'session-1', status: 'RUNNING', activityId: 'illegal' },
      }),
    ).toBe(false);
    expect(
      Value.Check(sessionActivityMessageSchema, {
        type: 'DELTA',
        entry: { sessionId: 'session-1', status: 'UNREAD_RESULT', activityId: 'activity-1', runId: 'leak' },
      }),
    ).toBe(false);
  });
});

async function createApp(sessionActivities?: RuntimeSessionActivityPort) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
  });
  const dependencies = {
    runtime: {},
    sessions: {
      streamEvents: vi.fn(async function* () {}),
    } as unknown as RuntimeSessionPort,
    identityResolver: () => identityContext,
    runtimeBootstrap: { transportKind: 'SSE' as const },
    defaultAgentId: brand<string, 'AgentId'>('agent-activity-route'),
    ...(sessionActivities === undefined ? {} : { sessionActivities }),
  } as unknown as WebChannelDependencies;
  await registerWebChannel(app, dependencies);
  return app;
}

function parseSseMessages(body: string): unknown[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
}
