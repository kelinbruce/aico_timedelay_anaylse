import { AgentError, bindRuntimeLoggerProvider, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import Fastify from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStartupFailureStages, classifyAppStartupFailure, type AppStartupFailureStage } from '../src/index.js';
import { composeAppLifecycle } from '../src/composition/app-lifecycle-composition.js';

type LifecycleInput = Parameters<typeof composeAppLifecycle>[0];
type TestLifecycleInput = LifecycleInput & { readonly testLogger: RuntimeLogger };
type StartupFailureMap = Partial<Record<AppStartupFailureStage, Error>>;
let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('app lifecycle observability composition', () => {
  const degradedStartupStages = [
    'SCHEDULED_MAINTENANCE_START',
    'CRON_SCHEDULER_START',
    'TRAJECTORY_WORKER_START',
    'MEMORY_AGING_SCHEDULER_START',
    'MEMORY_EXTRACTION_SCHEDULER_START',
    'CAPABILITY_STARTUP_VALIDATION',
    'WEB_CHANNEL_READY',
    'TASK_CHANNEL_READY',
    'CRON_CALLBACK_READY',
    'RAG_KNOWLEDGE_BUILD',
  ] as const satisfies readonly AppStartupFailureStage[];

  it('starts producers and dependencies, listens and completes startup, then starts background recovery and timeout processing', async () => {
    const order: string[] = [];
    const input = lifecycleInput(order);
    const lifecycle = composeAppLifecycle(input);

    await lifecycle.start();

    expect(order).toEqual([
      'maintenance.start',
      'cron.start',
      'trajectory.start',
      'aging.start',
      'extraction.start',
      'capability.validate',
      'web.ready',
      'task.ready',
      'cron-callback.ready',
      'rag.ensure',
      'log:app.server.listen.started',
      'server.listen',
      'log:app.server.listen.completed',
      'log:app.start.completed',
      'log:runtime.recovery.started',
      'runtime.recover',
      'runtime.pending-timeout.start',
      'log:runtime.recovery.completed',
    ]);
  });

  it('completes startup while runtime recovery is still running', async () => {
    const order: string[] = [];
    const input = lifecycleInput(order);
    let resolveRecovery: (() => void) | undefined;
    const recoveryPromise = new Promise<void>((resolve) => {
      resolveRecovery = resolve;
    });
    vi.mocked(input.runtime.recoverLocalRuntime).mockImplementationOnce(() => {
      order.push('runtime.recover');
      return recoveryPromise;
    });
    const lifecycle = composeAppLifecycle(input);

    await expect(lifecycle.start()).resolves.toBeUndefined();

    expect(order).toEqual([
      'maintenance.start',
      'cron.start',
      'trajectory.start',
      'aging.start',
      'extraction.start',
      'capability.validate',
      'web.ready',
      'task.ready',
      'cron-callback.ready',
      'rag.ensure',
      'log:app.server.listen.started',
      'server.listen',
      'log:app.server.listen.completed',
      'log:app.start.completed',
      'log:runtime.recovery.started',
      'runtime.recover',
      'runtime.pending-timeout.start',
    ]);

    resolveRecovery?.();
    await recoveryPromise;
    expect(order.indexOf('log:app.start.completed')).toBeLessThan(order.indexOf('log:runtime.recovery.completed'));
  });

  it('continues every independent finalizer after failures, closes operational output last, and is idempotent', async () => {
    const order: string[] = [];
    const failure = new Error('audit close unavailable');
    const input = lifecycleInput(order, { gatewayCloseFailure: failure });
    const lifecycle = composeAppLifecycle(input);

    const first = lifecycle.close();
    const second = lifecycle.close();
    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();

    expect(input.testLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        event: 'app.shutdown.finalizer_failed',
        failureStage: 'APP_SHUTDOWN_FINALIZER',
        finalizer: 'gateway-audit-and-stores',
      }),
      undefined,
    );

    expect(order).toEqual([
      'log:app.shutdown.started',
      'aging.stop',
      'extraction.stop',
      'trajectory.stop',
      'cron.stop',
      'maintenance.stop',
      'cron-callback.close',
      'server.close',
      'runtime.close',
      'session-activity.close',
      'rag.cleanup',
      'rag.close',
      'rag-governance.close',
      'cron-store.close',
      'projector.close:5000',
      'gateway.close',
      'log:app.shutdown.finalizer_failed',
      'metrics.flush:10000',
      'metrics.shutdown:10000',
      'log:app.shutdown.completed',
      'operational.flush:5000',
      'operational.close:5000',
    ]);
  });

  it('starts and closes developer diagnostic artifacts exactly once without mirroring failures to RuntimeLogger', async () => {
    const order: string[] = [];
    const input = lifecycleInput(order);
    const writer = {
      start: vi.fn(async () => {
        throw new Error('developer-diagnostic-start-canary');
      }),
      emit: vi.fn(async () => ({ status: 'DROPPED' as const, reasonCode: 'OUTPUT_UNAVAILABLE' as const })),
      close: vi.fn(async () => {
        throw new Error('developer-diagnostic-close-canary');
      }),
      status: vi.fn(() => ({ availability: 'DEGRADED' as const, droppedCount: 1, lastFailureCode: 'OUTPUT_UNAVAILABLE' as const })),
    };
    const lifecycle = composeAppLifecycle({ ...input, developerDiagnosticArtifactWriter: writer });

    await expect(lifecycle.start()).resolves.toBeUndefined();
    await Promise.all([lifecycle.close(), lifecycle.close()]);

    expect(writer.start).toHaveBeenCalledOnce();
    expect(writer.close).toHaveBeenCalledOnce();
    expect(writer.close).toHaveBeenCalledWith(5_000);
    expect(JSON.stringify(vi.mocked(input.testLogger.warn).mock.calls)).not.toContain('developer-diagnostic');
    expect(JSON.stringify(vi.mocked(input.testLogger.error).mock.calls)).not.toContain('developer-diagnostic');
  });

  it('wraps listen failure once with its cause and validated startup stage', async () => {
    const order: string[] = [];
    const failure = new TypeError('listen path token=secret');
    const input = lifecycleInput(order);
    vi.mocked(input.server.listen).mockRejectedValueOnce(failure);
    const lifecycle = composeAppLifecycle(input);

    const rejected = await lifecycle.start().catch((error: unknown) => error);

    expect(rejected).toBeInstanceOf(AgentError);
    expect(rejected).toMatchObject({ code: 'APP_START_FAILED', category: 'INTERNAL', cause: failure });
    expect(classifyAppStartupFailure(rejected)).toBe('SERVER_LISTEN');
    expect(input.testLogger.error).not.toHaveBeenCalled();
  });

  it.each([
    { host: '::1', clientHosts: ['[::1]'] },
    { host: '::', clientHosts: ['[::1]', '127.0.0.1'] },
  ] as const)('accepts real loopback requests when listening on $host', async ({ host, clientHosts }) => {
    const order: string[] = [];
    const server = Fastify();
    let receivedRequests = 0;
    server.get('/ipv6-probe', async () => {
      receivedRequests += 1;
      return { receivedRequests };
    });
    const input = lifecycleInput(order);
    const lifecycle = composeAppLifecycle({
      ...input,
      server,
      systemConfig: {
        channel: { transport: 'fastify', host, port: 0 },
      } as unknown as LifecycleInput['systemConfig'],
    });

    try {
      await lifecycle.start();
      const address = server.server.address() as AddressInfo;
      for (const clientHost of clientHosts) {
        const response = await fetch(`http://${clientHost}:${address.port}/ipv6-probe`);
        expect(response.status).toBe(200);
      }
      expect(receivedRequests).toBe(clientHosts.length);
    } finally {
      await lifecycle.close();
    }
  });

  it('continues startup with a degraded diagnostic when runtime recovery rejects', async () => {
    const order: string[] = [];
    const failure = new TypeError('recovery token=secret');
    const input = lifecycleInput(order);
    vi.mocked(input.runtime.recoverLocalRuntime).mockRejectedValueOnce(failure);
    const lifecycle = composeAppLifecycle(input);

    await expect(lifecycle.start()).resolves.toBeUndefined();

    expect(input.testLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        event: 'runtime.recovery.degraded',
        failureStage: 'RUNTIME_RECOVERY',
        recoveryCode: 'UNKNOWN',
      }),
      undefined,
    );
    expect(input.testLogger.error).not.toHaveBeenCalled();
    expect(order).toEqual([
      'maintenance.start',
      'cron.start',
      'trajectory.start',
      'aging.start',
      'extraction.start',
      'capability.validate',
      'web.ready',
      'task.ready',
      'cron-callback.ready',
      'rag.ensure',
      'log:app.server.listen.started',
      'server.listen',
      'log:app.server.listen.completed',
      'log:app.start.completed',
      'log:runtime.recovery.started',
      'runtime.pending-timeout.start',
      'log:runtime.recovery.degraded',
    ]);
  });

  it.each(degradedStartupStages)('continues startup with a degraded diagnostic when %s fails', async (failureStage) => {
    const order: string[] = [];
    const failure = new TypeError(`${failureStage} service unavailable`);
    const input = lifecycleInput(order, { startupFailures: { [failureStage]: failure } });
    const lifecycle = composeAppLifecycle(input);

    await expect(lifecycle.start()).resolves.toBeUndefined();

    expect(input.testLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        event: 'app.start.degraded',
        failureStage,
        startupCode: 'UNKNOWN',
      }),
      undefined,
    );
    expect(input.testLogger.error).not.toHaveBeenCalled();
    expect(input.runtime.recoverLocalRuntime).toHaveBeenCalled();
    expect(input.server.listen).toHaveBeenCalled();
    expect(order).toContain('log:app.start.completed');
  });

  it('falls back to APP_STARTUP for invalid wrapper metadata', () => {
    expect(classifyAppStartupFailure(new Error('unknown'))).toBe('APP_STARTUP');
    expect(
      classifyAppStartupFailure(
        new AgentError({
          code: 'APP_START_FAILED',
          message: 'failed',
          category: 'INTERNAL',
          safeDetails: { failureStage: 'UNTRUSTED_STAGE' },
        }),
      ),
    ).toBe('APP_STARTUP');
  });

  it('classifies every app-owned startup stage from the package-root API', () => {
    for (const failureStage of appStartupFailureStages) {
      const error = new AgentError({
        code: 'APP_START_FAILED',
        message: 'failed',
        category: 'INTERNAL',
        safeDetails: { failureStage },
      });
      expect(classifyAppStartupFailure(error)).toBe(failureStage);
    }
  });
});

function lifecycleInput(order: string[], options: { gatewayCloseFailure?: Error; startupFailures?: StartupFailureMap } = {}): TestLifecycleInput {
  const failIfRequested = (stage?: AppStartupFailureStage): void => {
    if (stage !== undefined && options.startupFailures?.[stage] !== undefined) {
      throw options.startupFailures[stage];
    }
  };
  const action = (name: string, stage?: AppStartupFailureStage) =>
    vi.fn(async () => {
      order.push(name);
      failIfRequested(stage);
    });
  const start = (name: string, stage?: AppStartupFailureStage) =>
    vi.fn(() => {
      order.push(name);
      failIfRequested(stage);
    });
  const logger = {
    debug: vi.fn(),
    info: vi.fn((entry: { event?: string }) => {
      if (entry.event !== undefined) {
        order.push(`log:${entry.event}`);
      }
    }),
    warn: vi.fn((fields: { event?: string }) => {
      if (fields.event !== undefined) {
        order.push(`log:${fields.event}`);
      }
    }),
    error: vi.fn((fields: { event?: string }) => {
      if (fields.event !== undefined) {
        order.push(`log:${fields.event}`);
      }
    }),
  };
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
  return {
    testLogger: logger,
    scheduledMaintenance: { start: start('maintenance.start', 'SCHEDULED_MAINTENANCE_START'), stop: action('maintenance.stop') },
    cronTaskScheduler: { start: start('cron.start', 'CRON_SCHEDULER_START'), stop: action('cron.stop') },
    taskTrajectoryWorker: { start: start('trajectory.start', 'TRAJECTORY_WORKER_START'), stop: action('trajectory.stop') },
    memoryAgingSchedulers: [{ start: start('aging.start', 'MEMORY_AGING_SCHEDULER_START'), stop: action('aging.stop') }],
    memoryExtractionSchedulers: [{ start: start('extraction.start', 'MEMORY_EXTRACTION_SCHEDULER_START'), stop: action('extraction.stop') }],
    capabilitySubsystem: { validateStartupRegistration: action('capability.validate', 'CAPABILITY_STARTUP_VALIDATION') },
    webChannelRegistration: { ready: action('web.ready', 'WEB_CHANNEL_READY') },
    taskChannelRegistration: { ready: action('task.ready', 'TASK_CHANNEL_READY') },
    cronTriggerCallbackRegistration: { ready: action('cron-callback.ready', 'CRON_CALLBACK_READY'), close: action('cron-callback.close') },
    ensureRagKnowledgeBuilt: action('rag.ensure', 'RAG_KNOWLEDGE_BUILD'),
    runtime: {
      recoverLocalRuntime: action('runtime.recover'),
      startPendingInputTimeoutProcessing: start('runtime.pending-timeout.start'),
      close: action('runtime.close'),
    } as unknown as LifecycleInput['runtime'],
    sessionActivityService: { close: start('session-activity.close') },
    server: {
      listen: action('server.listen'),
      close: action('server.close'),
    } as unknown as LifecycleInput['server'],
    systemConfig: {
      channel: { transport: 'HTTP', host: '127.0.0.1', port: 0 },
    } as unknown as LifecycleInput['systemConfig'],
    projectorHost: {
      acceptObservation() {},
      close: vi.fn(async (timeoutMs?: number) => {
        order.push(`projector.close:${timeoutMs}`);
      }),
    },
    ragRetrieval: { cleanup: action('rag.cleanup'), close: action('rag.close') } as unknown as LifecycleInput['ragRetrieval'],
    ragKnowledgeGovernance: { cleanup: vi.fn(), close: action('rag-governance.close') } as unknown as LifecycleInput['ragKnowledgeGovernance'],
    gatewayBindings: {
      close: vi.fn(async () => {
        order.push('gateway.close');
        if (options.gatewayCloseFailure !== undefined) {
          throw options.gatewayCloseFailure;
        }
      }),
    } as unknown as LifecycleInput['gatewayBindings'],
    closeCronTasks: action('cron-store.close'),
    operationalLogWriter: {
      flush: vi.fn(async (timeoutMs: number) => {
        order.push(`operational.flush:${timeoutMs}`);
      }),
      close: vi.fn(async (timeoutMs: number) => {
        order.push(`operational.close:${timeoutMs}`);
      }),
    } as unknown as NonNullable<LifecycleInput['operationalLogWriter']>,
    metricsInfrastructure: {
      forceFlush: vi.fn(async (timeoutMs: number) => {
        order.push(`metrics.flush:${timeoutMs}`);
      }),
      shutdown: vi.fn(async (timeoutMs: number) => {
        order.push(`metrics.shutdown:${timeoutMs}`);
      }),
    } as unknown as NonNullable<LifecycleInput['metricsInfrastructure']>,
  };
}
