import { resourceFromAttributes } from '@opentelemetry/resources';
import { getLogger } from '@nextagent/agent-common';
import {
  AggregationType,
  MeterProvider,
  PeriodicExportingMetricReader,
  createAllowListAttributesProcessor,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { createMetricsRegistry, type MetricsRegistry } from './metrics-registry.js';
import { METRIC_DESCRIPTORS } from './metric-descriptors.js';
import { bindHttpServerMetrics } from './http-server-instrumentation.js';

export interface MetricsSdkOptions {
  readonly exporter?: PushMetricExporter;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly deploymentMode: 'LOCAL' | 'REMOTE';
}

const logger = getLogger({ component: 'agent-observability', source: 'metrics-sdk' });

export interface MetricsReadiness {
  readonly state: 'READY' | 'DEGRADED';
  readonly safeReasonCode?: 'METRICS_EXPORTER_UNAVAILABLE' | 'METRICS_EXPORT_FAILED' | 'METRICS_FLUSH_FAILED' | 'METRICS_SHUTDOWN_FAILED';
}

export interface MetricsInfrastructure {
  readonly registry: MetricsRegistry;
  readiness: () => MetricsReadiness;
  forceFlush: (timeoutMs?: number) => Promise<void>;
  shutdown: (timeoutMs?: number) => Promise<void>;
}

export function createMetricsInfrastructure(options: MetricsSdkOptions): MetricsInfrastructure {
  let readiness: MetricsReadiness =
    options.exporter === undefined ? { state: 'DEGRADED', safeReasonCode: 'METRICS_EXPORTER_UNAVAILABLE' } : { state: 'READY' };
  const transition = (next: MetricsReadiness): void => {
    if (readiness.state === next.state) {
      return;
    }
    readiness = next;
    writeReadinessTransition(options.deploymentMode, next);
  };
  if (readiness.state === 'DEGRADED') {
    writeReadinessTransition(options.deploymentMode, readiness);
  }
  const exporter = monitorExporter(options.exporter ?? unavailableExporter, transition);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 10_000,
    cardinalityLimits: { default: 200 },
  });
  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      'service.name': options.serviceName,
      'service.version': options.serviceVersion,
      'nextagent.deployment.mode': options.deploymentMode,
    }),
    readers: [reader],
    views: Object.values(METRIC_DESCRIPTORS).map((descriptor) => ({
      instrumentName: descriptor.name,
      attributesProcessors: [createAllowListAttributesProcessor(Object.keys(descriptor.allowedLabels))],
      aggregationCardinalityLimit: 200,
      ...(descriptor.kind === 'histogram'
        ? {
            aggregation: {
              type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM as const,
              options: { boundaries: [...descriptor.boundaries], recordMinMax: true },
            },
          }
        : {}),
    })),
  });
  bindHttpServerMetrics(provider);
  return {
    registry: createMetricsRegistry({ meter: provider.getMeter('nextagent-runtime', options.serviceVersion) }),
    readiness: () => ({ ...readiness }),
    forceFlush: (timeoutMs = 10_000) => provider.forceFlush({ timeoutMillis: timeoutMs }),
    shutdown: (timeoutMs = 10_000) => provider.shutdown({ timeoutMillis: timeoutMs }),
  };
}

const unavailableExporter: PushMetricExporter = {
  export(_metrics, callback) {
    callback({ code: 1, error: new Error('metrics exporter unavailable') });
  },
  forceFlush: async () => undefined,
  shutdown: async () => undefined,
};

function monitorExporter(exporter: PushMetricExporter, transition: (readiness: MetricsReadiness) => void): PushMetricExporter {
  return {
    export(metrics, callback): void {
      try {
        exporter.export(metrics, (result) => {
          transition(result.code === 0 ? { state: 'READY' } : { state: 'DEGRADED', safeReasonCode: 'METRICS_EXPORT_FAILED' });
          callback(result);
        });
      } catch {
        transition({ state: 'DEGRADED', safeReasonCode: 'METRICS_EXPORT_FAILED' });
        callback({ code: 1, error: new Error('metrics export failed') });
      }
    },
    async forceFlush(): Promise<void> {
      try {
        await exporter.forceFlush();
      } catch {
        transition({ state: 'DEGRADED', safeReasonCode: 'METRICS_FLUSH_FAILED' });
        throw new Error('metrics flush failed');
      }
    },
    async shutdown(): Promise<void> {
      try {
        await exporter.shutdown();
      } catch {
        transition({ state: 'DEGRADED', safeReasonCode: 'METRICS_SHUTDOWN_FAILED' });
        throw new Error('metrics shutdown failed');
      }
    },
    ...(exporter.selectAggregationTemporality === undefined
      ? {}
      : { selectAggregationTemporality: (instrumentType) => exporter.selectAggregationTemporality!(instrumentType) }),
    ...(exporter.selectAggregation === undefined ? {} : { selectAggregation: (instrumentType) => exporter.selectAggregation!(instrumentType) }),
  };
}

function writeReadinessTransition(mode: 'LOCAL' | 'REMOTE', readiness: MetricsReadiness): void {
  if (readiness.state === 'DEGRADED') {
    logger.warn({
      event: 'metrics.export.degraded',
      exporterMode: mode.toLowerCase(),
      safeReasonCode: readiness.safeReasonCode,
    });
  } else {
    logger.info({ event: 'metrics.export.recovered', exporterMode: mode.toLowerCase() });
  }
}
