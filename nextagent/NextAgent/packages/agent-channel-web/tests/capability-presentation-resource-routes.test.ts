import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { CapabilityPresentationResourceQueryPort, RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerWebChannel, type WebChannelDependencies } from '../src/routes/requests.js';

const routeName = 'sessions/:sessionId/capability-presentation-resources';
let loggerBinding: RuntimeLoggerProviderBinding | undefined;

afterEach(() => loggerBinding?.unbind());

describe('GET /api/v1/sessions/:sessionId/capability-presentation-resources', () => {
  it('requires the scoped Session first and passes its trusted Agent id to the presentation query', async () => {
    const calls: string[] = [];
    const requireSession = vi.fn(async ({ sessionId }: Parameters<RuntimeSessionPort['requireSession']>[0]) => {
      calls.push('require-session');
      return session(sessionId);
    });
    const listResources = vi.fn<CapabilityPresentationResourceQueryPort['listResources']>(async (_request, signal) => {
      calls.push('list-resources');
      expect(signal).toBeInstanceOf(AbortSignal);
      return {
        resources: [
          {
            capabilityKind: 'SKILL',
            capabilityId: brand<string, 'CapabilityId'>('alarm-analysis'),
            displayName: 'alarm-analysis',
            locales: { language: { 'zh-CN': { displayName: '告警分析' }, 'en-US': { displayName: 'Alarm analysis' } } },
          },
        ],
      };
    });
    const app = Fastify();
    await registerWebChannel(app, dependencies(requireSession, { listResources }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-presentation/capability-presentation-resources',
      headers: { 'x-agent-id': 'client-agent-must-not-be-used' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      resources: [
        {
          capabilityKind: 'SKILL',
          capabilityId: 'alarm-analysis',
          displayName: 'alarm-analysis',
          locales: { language: { 'zh-CN': { displayName: '告警分析' }, 'en-US': { displayName: 'Alarm analysis' } } },
        },
      ],
    });
    expect(calls).toEqual(['require-session', 'list-resources']);
    expect(listResources).toHaveBeenCalledWith(
      {
        identityContext: identity(),
        sessionId: 'session-presentation',
        agentId: 'session-bound-agent',
      },
      expect.any(AbortSignal),
    );
  });

  it.each(['locale=zh-CN', 'agentId=client-agent', 'providerId=client-provider'])('rejects unsupported query input %s', async (query) => {
    const listResources = vi.fn<CapabilityPresentationResourceQueryPort['listResources']>();
    const app = Fastify();
    await registerWebChannel(
      app,
      dependencies(async ({ sessionId }) => session(sessionId), { listResources }),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/session-presentation/capability-presentation-resources?${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(listResources).not.toHaveBeenCalled();
  });

  it('rejects a request body', async () => {
    const listResources = vi.fn<CapabilityPresentationResourceQueryPort['listResources']>();
    const app = Fastify();
    await registerWebChannel(
      app,
      dependencies(async ({ sessionId }) => session(sessionId), { listResources }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-presentation/capability-presentation-resources',
      headers: { 'content-type': 'application/json' },
      payload: { locale: 'zh-CN' },
    });

    expect(response.statusCode).toBe(400);
    expect(listResources).not.toHaveBeenCalled();
  });

  it('maps current-view failure to one safe 503 without internal details', async () => {
    const warnings: object[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn(fields) {
          warnings.push(fields);
        },
        error() {},
      }),
    });
    const providerFailure = new Error('private provider path /tmp/secret and token');
    const discoveryFailure = new Error('Capability current discovery failed.', { cause: providerFailure });
    const failure = new Error('Capability current view is unavailable.', { cause: discoveryFailure });
    const app = Fastify();
    await registerWebChannel(
      app,
      dependencies(async ({ sessionId }) => session(sessionId), {
        async listResources() {
          throw failure;
        },
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-presentation/capability-presentation-resources' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE',
        message: 'Capability presentation resources are temporarily unavailable.',
      },
    });
    expect(response.body).not.toContain('/tmp/secret');
    expect(response.body).not.toContain('token');
    expect(warnings).toEqual([
      expect.objectContaining({
        err: failure,
        event: 'capability.presentation_resources.unavailable',
        safeErrorCode: 'CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE',
        rawExceptionData: expect.objectContaining({
          name: 'Error',
          message: 'Capability current view is unavailable.',
          cause: expect.objectContaining({
            message: 'Capability current discovery failed.',
            cause: expect.objectContaining({ message: 'private provider path /tmp/secret and token' }),
          }),
        }),
      }),
    ]);
  });
});

function dependencies(
  requireSession: RuntimeSessionPort['requireSession'],
  capabilityPresentationResources: CapabilityPresentationResourceQueryPort,
): WebChannelDependencies {
  return {
    routeWhitelist: new Set([routeName]),
    runtime: {} as RuntimeCommandPort,
    sessions: { requireSession } as RuntimeSessionPort,
    identityResolver: identity,
    runtimeBootstrap: { transportKind: 'SSE' },
    capabilityPresentationResources,
    defaultAgentId: brand<string, 'AgentId'>('must-not-be-used'),
  };
}

function identity() {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-presentation-route'),
    subjectId: brand<string, 'SubjectId'>('subject-presentation-route'),
    displayName: 'Presentation operator',
  };
}

function session(sessionId: Parameters<RuntimeSessionPort['requireSession']>[0]['sessionId']) {
  return {
    tenantId: identity().tenantId,
    subjectId: identity().subjectId,
    agentId: brand<string, 'AgentId'>('session-bound-agent'),
    sessionId,
    title: 'Presentation Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
}
