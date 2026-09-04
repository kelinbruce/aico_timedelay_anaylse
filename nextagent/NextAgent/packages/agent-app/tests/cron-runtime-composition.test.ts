import { brand } from '@nextagent/agent-common';
import type { CronTaskGatewayPort, RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import type { ObservabilityProjectorHost } from '@nextagent/agent-observability';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { composeCronCapabilityLayer, composeCronRuntimeLayer } from '../src/cron/cron-runtime-composition.js';

const cronTasks = {} as CronTaskGatewayPort;
const projectorHost = {} as ObservabilityProjectorHost;

describe('cron runtime composition', () => {
  it('keeps disabled composition empty and ignores branch-only inputs', () => {
    const capability = composeCronCapabilityLayer({
      deploymentSelection: 'DISABLED',
      cronTasks,
      projectorHost,
    });
    expect(capability).toEqual({ enabled: false });
    expect(composeCronRuntimeLayer(runtimeInput(capability))).toEqual({});
  });

  it('requires and creates only the local scheduler branch', () => {
    const capability = composeCronCapabilityLayer({ deploymentSelection: 'LOCAL', cronTasks, projectorHost });
    expect(() => composeCronRuntimeLayer(runtimeInput(capability))).toThrowError(
      expect.objectContaining({ code: 'CRON_TASK_SCHEDULER_FACTORY_REQUIRED' }),
    );
    const scheduler = { start: vi.fn(), stop: vi.fn(async () => undefined) };
    const cronTaskSchedulerFactory = vi.fn(() => scheduler);
    expect(
      composeCronRuntimeLayer({
        ...runtimeInput(capability),
        cronTaskSchedulerFactory,
        cronTriggerCallbackCredentialRef: brand('env:unused'),
        cronTriggerCallbackRegistration: vi.fn(),
      }),
    ).toEqual({ cronTaskScheduler: scheduler });
    expect(cronTaskSchedulerFactory).toHaveBeenCalledOnce();
  });

  it('orders remote credential validation before callback registration', () => {
    const capability = composeCronCapabilityLayer({ deploymentSelection: 'REMOTE', cronTasks, projectorHost });
    expect(() => composeCronRuntimeLayer(runtimeInput(capability))).toThrowError(
      expect.objectContaining({ code: 'CRON_CALLBACK_CREDENTIAL_REQUIRED' }),
    );
    expect(() =>
      composeCronRuntimeLayer({
        ...runtimeInput(capability),
        cronTriggerCallbackCredentialRef: brand('env:cron-secret'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'CRON_CALLBACK_REGISTRATION_REQUIRED' }));
    const registration = { ready: vi.fn(async () => undefined) };
    const cronTriggerCallbackRegistration = vi.fn(() => registration);
    expect(
      composeCronRuntimeLayer({
        ...runtimeInput(capability),
        cronTriggerCallbackCredentialRef: brand('env:cron-secret'),
        cronTriggerCallbackRegistration,
        cronTaskSchedulerFactory: vi.fn(),
      }),
    ).toEqual({ cronTriggerCallbackRegistration: registration });
    expect(cronTriggerCallbackRegistration).toHaveBeenCalledOnce();
  });

  it('requires a selected cron gateway only for enabled deployments', () => {
    expect(() =>
      composeCronCapabilityLayer({
        deploymentSelection: 'REMOTE',
        projectorHost,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CRON_TASK_GATEWAY_UNAVAILABLE' }));
  });
});

function runtimeInput(capability: ReturnType<typeof composeCronCapabilityLayer>) {
  return {
    capability,
    runtime: { createSession: vi.fn(), submit: vi.fn() } as unknown as Pick<RuntimeSessionPort, 'createSession'> & Pick<RuntimeCommandPort, 'submit'>,
    requestRuns: { loadRun: vi.fn() } as unknown as Pick<RequestRunStoreGateway, 'loadRun'>,
    projectorHost,
    credentialResolver: createAppCredentialResolver({ CRON_SECRET: 'secret' }),
    server: {} as FastifyInstance,
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    computeNextRunAt: vi.fn(() => null),
  };
}
