import {
  createAuditProjector,
  createMetricsProjector,
  createObservabilityProjectorHost,
  createProjectionMetricsRecorder,
  createStructuredLogProjector,
  createLocalMetricHistoryExporter,
  createMetricsInfrastructure,
  createMetricsRegistry,
  type AuditEventWriter,
  type MetricsInfrastructure,
  type MetricsRegistry,
  type ObservabilityProjector,
  type ObservabilityProjectorHost,
} from '@nextagent/agent-observability';
import {
  AgentError,
  bindRuntimeLoggerProvider,
  noopRuntimeLogger,
  type RuntimeLogger,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';
import { createOperationalLogWriter, type OperationalLogWriter } from '@nextagent/agent-log';
import type { PushMetricExporter } from '@nextagent/agent-observability';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AppCredentialResolver } from '../config/env.js';
import type { TrustedOwnerScope } from '@nextagent/agent-observability';
import { createGatewayAuditEventWriter } from './gateway-audit-event-writer.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface PreparedObservabilityComposition {
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly runtimeLoggerProviderBinding?: RuntimeLoggerProviderBinding;
  readonly observationLogger?: RuntimeLogger;
  readonly metricsInfrastructure?: MetricsInfrastructure;
  readonly metricsRegistry: MetricsRegistry;
  readonly traceEnabled: boolean;
  readonly traceProjector?: ObservabilityProjector;
}

export function prepareConfigFailureMetricsRegistry(injectedRegistry?: MetricsRegistry): MetricsRegistry {
  return injectedRegistry ?? createMetricsRegistry();
}

export function prepareConfigFailureObservability(input: {
  readonly metricsRegistry?: MetricsRegistry;
  readonly operationalLogWriter?: OperationalLogWriter;
}) {
  const metricsRegistry = prepareConfigFailureMetricsRegistry(input.metricsRegistry);
  const runtimeLoggerProviderBinding = input.operationalLogWriter === undefined ? undefined : bindRuntimeLoggerProvider(input.operationalLogWriter);
  return {
    metricsRegistry,
    ...(input.operationalLogWriter === undefined
      ? {}
      : {
          operationalLogWriter: input.operationalLogWriter,
          runtimeLoggerProviderBinding,
        }),
  };
}

export function preloadObservabilityCompositionSync(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly serviceVersion?: string;
  readonly bootstrapMetricsRegistry: MetricsRegistry;
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly metricsRegistry?: MetricsRegistry;
  readonly metricsInfrastructure?: MetricsInfrastructure;
  readonly metricsExporter?: PushMetricExporter;
  readonly runtimeLoggerProviderBinding?: RuntimeLoggerProviderBinding;
  readonly traceProjector?: ObservabilityProjector;
}): PreparedObservabilityComposition {
  const serviceVersion = resolveAppServiceVersion(input.serviceVersion);
  const traceEnabled = input.systemConfig.observability.tracing?.enabled === true && input.traceProjector !== undefined;
  const metricsInfrastructure =
    input.metricsInfrastructure ??
    (input.metricsRegistry === undefined
      ? createMetricsInfrastructureForDeployment({
          systemConfig: input.systemConfig,
          serviceVersion,
          ...(input.metricsExporter === undefined ? {} : { exporter: input.metricsExporter }),
        })
      : undefined);
  return projectPreparedObservability({
    ...(input.operationalLogWriter === undefined ? {} : { operationalLogWriter: input.operationalLogWriter }),
    ...(metricsInfrastructure === undefined ? {} : { metricsInfrastructure }),
    metricsRegistry: input.metricsRegistry ?? metricsInfrastructure?.registry ?? input.bootstrapMetricsRegistry,
    ...(input.runtimeLoggerProviderBinding === undefined ? {} : { runtimeLoggerProviderBinding: input.runtimeLoggerProviderBinding }),
    traceEnabled,
    ...(traceEnabled && input.traceProjector !== undefined ? { traceProjector: input.traceProjector } : {}),
  });
}

export async function preloadObservabilityCompositionAsync(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly serviceVersion?: string;
  readonly bootstrapMetricsRegistry: MetricsRegistry;
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly metricsRegistry?: MetricsRegistry;
  readonly metricsInfrastructure?: MetricsInfrastructure;
  readonly metricsExporter?: PushMetricExporter;
  readonly credentialResolver: AppCredentialResolver;
  readonly traceProjector?: ObservabilityProjector;
}): Promise<PreparedObservabilityComposition> {
  const serviceVersion = resolveAppServiceVersion(input.serviceVersion);
  const operationalLogWriter = input.operationalLogWriter ?? (await createAppOperationalLogWriter(input.systemConfig, serviceVersion));
  const metricsInfrastructure =
    input.metricsInfrastructure ??
    createMetricsInfrastructureForDeployment({
      systemConfig: input.systemConfig,
      serviceVersion,
      ...(input.metricsExporter === undefined ? {} : { exporter: input.metricsExporter }),
    });
  const trace = await preloadTraceComposition({
    systemConfig: input.systemConfig,
    serviceVersion,
    operationalLogWriter,
    ...(input.traceProjector === undefined ? {} : { injectedTraceProjector: input.traceProjector }),
  });
  return projectPreparedObservability({
    operationalLogWriter,
    metricsInfrastructure,
    metricsRegistry: input.metricsRegistry ?? metricsInfrastructure.registry ?? input.bootstrapMetricsRegistry,
    ...trace,
  });
}

export async function createAppOperationalLogWriter(systemConfig: DefaultSystemConfig, serviceVersion: string): Promise<OperationalLogWriter> {
  return await createOperationalLogWriter(
    {
      level: systemConfig.observability.logging.level,
      console: systemConfig.observability.logging.console,
      file: {
        enabled: systemConfig.observability.logging.file.enabled,
        directory: systemConfig.observability.logging.file.directory,
        name: systemConfig.observability.logging.file.name,
        maxFileSizeMiB: systemConfig.observability.logging.file.rotation.maxFileSizeMiB,
        retentionDays: systemConfig.observability.logging.file.retentionDays,
        maxArchiveFiles: systemConfig.observability.logging.file.maxArchiveFiles,
      },
    },
    { serviceVersion: requireAppServiceVersion(serviceVersion) },
  );
}

function projectPreparedObservability(input: {
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly metricsInfrastructure?: MetricsInfrastructure;
  readonly metricsRegistry: MetricsRegistry;
  readonly runtimeLoggerProviderBinding?: RuntimeLoggerProviderBinding;
  readonly traceEnabled: boolean;
  readonly traceProjector?: ObservabilityProjector;
}): PreparedObservabilityComposition {
  if (input.operationalLogWriter === undefined) {
    return {
      ...(input.metricsInfrastructure === undefined ? {} : { metricsInfrastructure: input.metricsInfrastructure }),
      metricsRegistry: input.metricsRegistry,
      traceEnabled: input.traceEnabled,
      ...(input.traceProjector === undefined ? {} : { traceProjector: input.traceProjector }),
    };
  }
  return {
    operationalLogWriter: input.operationalLogWriter,
    runtimeLoggerProviderBinding: input.runtimeLoggerProviderBinding ?? bindRuntimeLoggerProvider(input.operationalLogWriter),
    observationLogger: input.operationalLogWriter.getObservationLogger({ component: 'agent-observability' }),
    ...(input.metricsInfrastructure === undefined ? {} : { metricsInfrastructure: input.metricsInfrastructure }),
    metricsRegistry: input.metricsRegistry,
    traceEnabled: input.traceEnabled,
    ...(input.traceProjector === undefined ? {} : { traceProjector: input.traceProjector }),
  };
}

async function preloadTraceComposition(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly serviceVersion: string;
  readonly operationalLogWriter: OperationalLogWriter;
  readonly injectedTraceProjector?: ObservabilityProjector;
}): Promise<Pick<PreparedObservabilityComposition, 'traceEnabled' | 'traceProjector'>> {
  const tracing = input.systemConfig.observability.tracing;
  const logger = input.operationalLogWriter.getLogger({ component: 'agent-app', source: 'otel-bootstrap' });
  if (tracing?.enabled !== true) {
    logger.info({
      event: 'otel.trace.init.skipped',
      failureStage: 'config_selection',
      safeReasonCode: tracing === undefined ? 'TRACING_CONFIG_ABSENT' : 'TRACING_DISABLED',
    });
    return { traceEnabled: false };
  }
  if (input.injectedTraceProjector !== undefined) {
    logger.info({ event: 'otel.trace.init.completed', safeReasonCode: 'INJECTED_TRACE_PROJECTOR' });
    return {
      traceEnabled: true,
      traceProjector: input.injectedTraceProjector,
    };
  }

  logger.info({
    event: 'otel.trace.init.skipped',
    failureStage: 'config_selection',
    safeReasonCode: 'NO_INJECTED_TRACE_PROJECTOR',
  });
  return { traceEnabled: false };
}

function createMetricsInfrastructureForDeployment(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly serviceVersion: string;
  readonly exporter?: PushMetricExporter;
}): MetricsInfrastructure {
  const exporter =
    input.exporter ??
    (input.systemConfig.gateway.deploymentMode === 'LOCAL'
      ? createLocalMetricHistoryExporter({ logDirectory: input.systemConfig.paths.logDirectory })
      : undefined);
  return createMetricsInfrastructure({
    ...(exporter === undefined ? {} : { exporter }),
    serviceName: 'nextagent',
    serviceVersion: input.serviceVersion,
    deploymentMode: input.systemConfig.gateway.deploymentMode,
  });
}

function resolveAppServiceVersion(serviceVersion?: string): string {
  return requireAppServiceVersion(serviceVersion ?? readAppPackageVersion());
}

function requireAppServiceVersion(serviceVersion?: string): string {
  if (serviceVersion !== undefined && serviceVersion.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(serviceVersion)) {
    return serviceVersion;
  }
  throw new AgentError({
    code: 'APP_SERVICE_VERSION_INVALID',
    message: 'App service version is missing or invalid.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function readAppPackageVersion(): string {
  const manifest = require('../../package.json') as { readonly version?: unknown };
  return requireAppServiceVersion(typeof manifest.version === 'string' ? manifest.version : undefined);
}

export interface ComposeObservabilityInfrastructureInput {
  readonly systemConfig: DefaultSystemConfig;
  readonly metricsRegistry: MetricsRegistry;
  readonly observationLogger?: RuntimeLogger;
  readonly traceProjector?: ObservabilityProjector;
  readonly defaultRouteOwnerScope: TrustedOwnerScope;
}

export interface ComposedObservabilityInfrastructureBootstrap {
  complete: (input: CompleteObservabilityInfrastructureInput) => CompletedObservabilityInfrastructure;
}

export interface CompleteObservabilityInfrastructureInput {
  readonly gatewayAuditStore?:
    | {
        appendAuditEvent: (record: import('@nextagent/agent-contracts/gateway').AuditEventRecord) => Promise<void>;
      }
    | undefined;
}

export interface CompletedObservabilityInfrastructure {
  readonly projectorHost: ObservabilityProjectorHost;
  readonly auditWriter?: AuditEventWriter;
}

export function composeObservabilityInfrastructure(input: ComposeObservabilityInfrastructureInput): ComposedObservabilityInfrastructureBootstrap {
  const structuredLogProjector = createStructuredLogProjector(input.observationLogger ?? noopRuntimeLogger, {
    diagnosticDetail: input.systemConfig.observability.logging.diagnosticDetail,
  });
  const metricsProjector = createMetricsProjector(input.metricsRegistry);
  return {
    complete: (completionInput) =>
      completeObservabilityInfrastructure({
        systemConfig: input.systemConfig,
        metricsRegistry: input.metricsRegistry,
        ...(input.traceProjector === undefined ? {} : { traceProjector: input.traceProjector }),
        structuredLogProjector,
        metricsProjector,
        gatewayAuditStore: completionInput.gatewayAuditStore,
      }),
  };
}

function completeObservabilityInfrastructure(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly metricsRegistry: MetricsRegistry;
  readonly traceProjector?: ObservabilityProjector;
  readonly structuredLogProjector: ObservabilityProjector;
  readonly metricsProjector: ObservabilityProjector;
  readonly gatewayAuditStore?:
    | {
        appendAuditEvent: (record: import('@nextagent/agent-contracts/gateway').AuditEventRecord) => Promise<void>;
      }
    | undefined;
}): CompletedObservabilityInfrastructure {
  const auditWriter = input.gatewayAuditStore === undefined ? undefined : createGatewayAuditEventWriter(input.gatewayAuditStore);
  const auditProjector = createAuditProjector(auditWriter);
  const projectorHost = createObservabilityProjectorHost(
    [input.structuredLogProjector, auditProjector, input.metricsProjector, ...(input.traceProjector === undefined ? [] : [input.traceProjector])],
    {
      onProjectionResult: createProjectionMetricsRecorder(input.metricsRegistry),
    },
  );
  return {
    projectorHost,
    ...(auditWriter === undefined ? {} : { auditWriter }),
  };
}
