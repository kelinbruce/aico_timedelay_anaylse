import { AgentError, getLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { GatewayBindings } from '@nextagent/agent-contracts/gateway';
import { type ObservabilityProjectorHost } from '@nextagent/agent-observability';
import type { FastifyInstance } from 'fastify';
import { rm } from 'node:fs/promises';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import type { MetricsInfrastructure } from '@nextagent/agent-observability';
import type {
  NextAgentApp,
  RagRetrievalBinding,
  TaskChannelRegistration,
  CronTriggerCallbackRegistration,
  WebChannelRegistration,
} from './composition-contracts.js';
import type { AppStartupFailureStage } from '../app-startup-failure.js';

const logger = getLogger({ component: 'agent-app', source: 'app-lifecycle-composition' });

export interface AppLifecycleCompositionInput {
  readonly scheduledMaintenance: { start: () => void; stop: () => Promise<void> };
  readonly cronTaskScheduler?: { start: () => void; stop: () => Promise<void> };
  readonly taskTrajectoryWorker?: { start: () => void; stop: () => Promise<void> };
  readonly memoryAgingSchedulers: ReadonlyArray<{ start: () => void; stop: () => Promise<void> }>;
  readonly memoryExtractionSchedulers: ReadonlyArray<{ start: () => void; stop: () => Promise<void> }>;
  readonly capabilitySubsystem: { validateStartupRegistration: () => Promise<unknown> };
  readonly webChannelRegistration: WebChannelRegistration;
  readonly taskChannelRegistration: TaskChannelRegistration;
  readonly cronTriggerCallbackRegistration?: CronTriggerCallbackRegistration;
  readonly ensureRagKnowledgeBuilt: (signal?: AbortSignal) => Promise<void>;
  readonly runtime: {
    recoverLocalRuntime: () => Promise<unknown>;
    startPendingInputTimeoutProcessing: () => void;
    close?: () => Promise<void>;
  };
  readonly sessionActivityService: { close: () => void };
  readonly server: FastifyInstance;
  readonly systemConfig: DefaultSystemConfig;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ragRetrieval: RagRetrievalBinding;
  readonly ragKnowledgeGovernance: RagRetrievalBinding;
  readonly gatewayBindings: GatewayBindings;
  readonly closeCronTasks?: () => Promise<void> | void;
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly runtimeLoggerProviderBinding?: RuntimeLoggerProviderBinding;
  readonly metricsInfrastructure?: MetricsInfrastructure;
  readonly developerDiagnosticArtifactWriter?: import('./composition-contracts.js').DeveloperDiagnosticArtifactWriter;
}

export type AppLifecycleOwnershipClass = 'APP_OWNED_CLEANUP' | 'START_READINESS_ONLY' | 'PURE_FACT';

export const appLifecycleInputOwnership = {
  scheduledMaintenance: 'APP_OWNED_CLEANUP',
  cronTaskScheduler: 'APP_OWNED_CLEANUP',
  taskTrajectoryWorker: 'APP_OWNED_CLEANUP',
  memoryAgingSchedulers: 'APP_OWNED_CLEANUP',
  memoryExtractionSchedulers: 'APP_OWNED_CLEANUP',
  capabilitySubsystem: 'START_READINESS_ONLY',
  webChannelRegistration: 'START_READINESS_ONLY',
  taskChannelRegistration: 'START_READINESS_ONLY',
  cronTriggerCallbackRegistration: 'APP_OWNED_CLEANUP',
  ensureRagKnowledgeBuilt: 'START_READINESS_ONLY',
  runtime: 'APP_OWNED_CLEANUP',
  sessionActivityService: 'APP_OWNED_CLEANUP',
  server: 'APP_OWNED_CLEANUP',
  systemConfig: 'PURE_FACT',
  projectorHost: 'APP_OWNED_CLEANUP',
  ragRetrieval: 'APP_OWNED_CLEANUP',
  ragKnowledgeGovernance: 'APP_OWNED_CLEANUP',
  gatewayBindings: 'APP_OWNED_CLEANUP',
  closeCronTasks: 'APP_OWNED_CLEANUP',
  operationalLogWriter: 'APP_OWNED_CLEANUP',
  runtimeLoggerProviderBinding: 'APP_OWNED_CLEANUP',
  metricsInfrastructure: 'APP_OWNED_CLEANUP',
  developerDiagnosticArtifactWriter: 'APP_OWNED_CLEANUP',
} as const satisfies Record<keyof AppLifecycleCompositionInput, AppLifecycleOwnershipClass>;

export function composeAppLifecycle(input: AppLifecycleCompositionInput): Pick<NextAgentApp, 'start' | 'close'> {
  let closePromise: Promise<void> | undefined;
  return {
    async start(): Promise<void> {
      let failureStage: AppStartupFailureStage = 'SCHEDULED_MAINTENANCE_START';
      try {
        await input.developerDiagnosticArtifactWriter?.start().catch(() => undefined);
        await runStartupStage('SCHEDULED_MAINTENANCE_START', () => input.scheduledMaintenance.start());
        failureStage = 'CRON_SCHEDULER_START';
        await runStartupStage('CRON_SCHEDULER_START', () => input.cronTaskScheduler?.start());
        failureStage = 'TRAJECTORY_WORKER_START';
        await runStartupStage('TRAJECTORY_WORKER_START', () => input.taskTrajectoryWorker?.start());
        failureStage = 'MEMORY_AGING_SCHEDULER_START';
        for (const scheduler of input.memoryAgingSchedulers) {
          await runStartupStage('MEMORY_AGING_SCHEDULER_START', () => scheduler.start());
        }
        failureStage = 'MEMORY_EXTRACTION_SCHEDULER_START';
        for (const scheduler of input.memoryExtractionSchedulers) {
          await runStartupStage('MEMORY_EXTRACTION_SCHEDULER_START', () => scheduler.start());
        }
        failureStage = 'CAPABILITY_STARTUP_VALIDATION';
        await runStartupStage('CAPABILITY_STARTUP_VALIDATION', () => input.capabilitySubsystem.validateStartupRegistration());
        failureStage = 'WEB_CHANNEL_READY';
        await runStartupStage('WEB_CHANNEL_READY', () => input.webChannelRegistration.ready?.());
        failureStage = 'TASK_CHANNEL_READY';
        await runStartupStage('TASK_CHANNEL_READY', () => input.taskChannelRegistration.ready?.());
        failureStage = 'CRON_CALLBACK_READY';
        await runStartupStage('CRON_CALLBACK_READY', () => input.cronTriggerCallbackRegistration?.ready?.());
        failureStage = 'RAG_KNOWLEDGE_BUILD';
        await runStartupStage('RAG_KNOWLEDGE_BUILD', () => input.ensureRagKnowledgeBuilt());
        failureStage = 'SERVER_LISTEN';
        await listen(input);
        logger.info({ event: 'app.start.completed' });
        void recoverRuntimeBestEffort(input);
        input.runtime.startPendingInputTimeoutProcessing();
      } catch (error) {
        throw new AgentError({
          code: 'APP_START_FAILED',
          message: 'NextAgent app startup failed.',
          category: 'INTERNAL',
          retryable: false,
          safeDetails: { failureStage },
          cause: error,
        });
      }
    },
    close(): Promise<void> {
      closePromise ??= closeApp(input);
      return closePromise;
    },
  };
}

async function runStartupStage(stage: AppStartupFailureStage, operation: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await operation();
  } catch (error) {
    logger.warn({
      err: error,
      event: 'app.start.degraded',
      failureStage: stage,
      startupCode: error instanceof AgentError ? error.code : 'UNKNOWN',
    });
  }
}

async function recoverRuntimeBestEffort(input: AppLifecycleCompositionInput): Promise<void> {
  logger.info({ event: 'runtime.recovery.started' });
  try {
    await input.runtime.recoverLocalRuntime();
    logger.info({ event: 'runtime.recovery.completed' });
  } catch (error) {
    logger.warn({
      err: error,
      event: 'runtime.recovery.degraded',
      failureStage: 'RUNTIME_RECOVERY',
      recoveryCode: error instanceof AgentError ? error.code : 'UNKNOWN',
    });
  }
}

async function closeApp(input: Parameters<typeof composeAppLifecycle>[0]): Promise<void> {
  logger.info({ event: 'app.shutdown.started' });
  const finalize = async (operation: () => Promise<void> | void, name: string): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      logger.error({ err: error, event: 'app.shutdown.finalizer_failed', failureStage: 'APP_SHUTDOWN_FINALIZER', finalizer: name });
    }
  };

  for (const scheduler of input.memoryAgingSchedulers) {
    await finalize(() => scheduler.stop(), 'memory-aging');
  }
  for (const scheduler of input.memoryExtractionSchedulers) {
    await finalize(() => scheduler.stop(), 'memory-extraction');
  }
  await finalize(() => input.taskTrajectoryWorker?.stop(), 'task-trajectory');
  await finalize(() => input.cronTaskScheduler?.stop(), 'cron-scheduler');
  await finalize(() => input.scheduledMaintenance.stop(), 'scheduled-maintenance');
  await finalize(() => input.cronTriggerCallbackRegistration?.close?.(), 'cron-callback');
  await finalize(() => input.server.close(), 'server');
  await finalize(() => input.runtime.close?.(), 'runtime');
  await finalize(() => input.sessionActivityService.close(), 'session-activity');
  await finalize(() => input.ragRetrieval.cleanup(), 'rag-cleanup');
  await finalize(() => input.ragRetrieval.close(), 'rag-retrieval');
  await finalize(() => input.ragKnowledgeGovernance.close(), 'rag-governance');
  await finalize(() => input.closeCronTasks?.(), 'cron-store');

  await finalize(() => input.projectorHost.close?.(5_000), 'observability-projectors');
  await finalize(() => input.gatewayBindings.close?.(), 'gateway-audit-and-stores');
  await input.developerDiagnosticArtifactWriter?.close(5_000).catch(() => undefined);
  await finalize(() => input.metricsInfrastructure?.forceFlush(10_000), 'metrics-flush');
  await finalize(() => input.metricsInfrastructure?.shutdown(10_000), 'metrics-shutdown');

  logger.info({ event: 'app.shutdown.completed' });
  await finalize(() => input.operationalLogWriter?.flush(5_000), 'operational-flush');
  await finalize(() => input.operationalLogWriter?.close(5_000), 'operational-close');
  input.runtimeLoggerProviderBinding?.unbind();
}

async function listen(input: { readonly server: FastifyInstance; readonly systemConfig: DefaultSystemConfig }): Promise<void> {
  if (input.systemConfig.channel.udsPath) {
    try {
      await rm(input.systemConfig.channel.udsPath, { force: true });
    } catch {}
    logger.info(
      { event: 'app.server.listen.started', transport: input.systemConfig.channel.transport, bindMode: 'uds' },
      `Server listen is starting with ${input.systemConfig.channel.transport} transport in uds mode.`,
    );
    await input.server.listen({ path: input.systemConfig.channel.udsPath });
    logger.info(
      { event: 'app.server.listen.completed', transport: input.systemConfig.channel.transport, bindMode: 'uds' },
      `Server listen completed with ${input.systemConfig.channel.transport} transport in uds mode.`,
    );
    return;
  }
  const listenOptions = {
    host: input.systemConfig.channel.host ?? '127.0.0.1',
    ...(input.systemConfig.channel.port === undefined ? {} : { port: input.systemConfig.channel.port }),
  };
  logger.info(
    { event: 'app.server.listen.started', transport: input.systemConfig.channel.transport, bindMode: 'tcp' },
    `Server listen is starting with ${input.systemConfig.channel.transport} transport in tcp mode.`,
  );
  await input.server.listen(listenOptions);
  logger.info(
    { event: 'app.server.listen.completed', transport: input.systemConfig.channel.transport, bindMode: 'tcp' },
    `Server listen completed with ${input.systemConfig.channel.transport} transport in tcp mode.`,
  );
}
