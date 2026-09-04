import type { LocalFileRollHandle, LocalFileRollPolicy } from '@nextagent/agent-local-file-roll';
import { bindRuntimeLoggerProvider, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import { AggregationTemporality, DataPointType, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { createMetricsInfrastructure } from '../src/index.js';
import { createRequire } from 'node:module';
import type { createServer as CreateHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalMetricHistoryExporterForTesting,
  localMetricHistoryPolicy,
  normalizeMetricSnapshot,
} from '../src/metrics/local-metric-history-exporter.js';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('local metric history exporter', () => {
  it('records standard HTTP server duration through the shared MeterProvider', async () => {
    const { createServer } = createRequire(import.meta.url)('node:http') as { createServer: typeof CreateHttpServer };
    const exports: ResourceMetrics[] = [];
    const infrastructure = createMetricsInfrastructure({
      exporter: {
        export(metrics, callback) {
          exports.push(metrics);
          callback({ code: 0 });
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined,
      },
      serviceName: 'nextagent',
      serviceVersion: '1.0.0',
      deploymentMode: 'LOCAL',
    });
    const server = createServer((_request, response) => {
      response.statusCode = 200;
      response.end('ok');
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/sensitive-path?token=metric-secret-canary`, {
        headers: { 'x-request-id': 'forged-metric-request-id', authorization: 'Bearer metric-secret-canary' },
      });
      await response.text();
      await infrastructure.forceFlush();

      const metrics = exports.flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
      const httpMetric = metrics.find((metric) => metric.descriptor.name === 'http.server.request.duration');
      expect(httpMetric?.descriptor.unit).toBe('s');
      expect(httpMetric?.dataPointType).toBe(DataPointType.HISTOGRAM);
      expect(httpMetric?.dataPoints).toHaveLength(1);
      expect(httpMetric?.dataPoints[0]?.attributes).toMatchObject({
        'http.request.method': 'GET',
        'http.response.status_code': 200,
      });
      expect(httpMetric?.dataPoints[0]?.value).toMatchObject({
        count: 1,
        buckets: { boundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10] },
      });
      expect(JSON.stringify(httpMetric)).not.toContain('metric-secret-canary');
      expect(JSON.stringify(httpMetric)).not.toContain('forged-metric-request-id');
      expect(
        metrics.some((metric) => metric.descriptor.name === 'web_request_total' || metric.descriptor.name === 'web_request_duration_seconds'),
      ).toBe(false);
      const localSnapshot = normalizeMetricSnapshot(exports.at(-1)!, new Date('2026-07-17T00:00:00.000Z'));
      expect(localSnapshot.metrics).toContainEqual(
        expect.objectContaining({
          name: 'http.server.request.duration',
          kind: 'histogram',
          unit: 's',
          points: [expect.objectContaining({ count: 1 })],
        }),
      );
      expect(JSON.stringify(localSnapshot)).not.toContain('metric-secret-canary');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
      await infrastructure.shutdown();
    }
  });

  it('owns the fixed metrics family policy and appends cumulative SDK snapshots', async () => {
    const lines: string[] = [];
    const policies: LocalFileRollPolicy[] = [];
    const exporter = createLocalMetricHistoryExporterForTesting(
      { logDirectory: 'C:\\trusted\\logs', now: () => new Date('2026-07-15T00:00:00.000Z') },
      async (policy) => {
        policies.push(policy);
        return captureHandle(lines);
      },
    );
    const infrastructure = createMetricsInfrastructure({
      exporter,
      serviceName: 'nextagent',
      serviceVersion: '1.0.0',
      deploymentMode: 'LOCAL',
    });

    infrastructure.registry.increment('request_outcome_total', { status: 'COMPLETED' });
    infrastructure.registry.observe('request_duration_seconds', { status: 'COMPLETED' }, 0.25);
    await infrastructure.forceFlush();
    infrastructure.registry.increment('request_outcome_total', { status: 'COMPLETED' }, 2);
    await infrastructure.forceFlush();

    expect(policies).toEqual([localMetricHistoryPolicy('C:\\trusted\\logs')]);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first).toMatchObject({
      schemaVersion: 1,
      exportedAt: '2026-07-15T00:00:00.000Z',
      resource: {
        'service.name': 'nextagent',
        'service.version': '1.0.0',
        'nextagent.deployment.mode': 'LOCAL',
      },
    });
    expect(first.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'request_outcome_total', kind: 'counter', unit: '1', temporality: 'cumulative' }),
        expect.objectContaining({
          name: 'request_duration_seconds',
          kind: 'histogram',
          unit: 's',
          points: [
            expect.objectContaining({
              boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
            }),
          ],
        }),
      ]),
    );
    expect(JSON.stringify(first)).not.toMatch(/tenant|subject|agentId|requestRun|trace|span|exemplar|credential|token=/iu);
    await infrastructure.shutdown();
  });

  it('exports token count, token rate, and concurrency with descriptor-owned buckets and min/max', async () => {
    const exports: ResourceMetrics[] = [];
    const infrastructure = createMetricsInfrastructure({
      exporter: {
        export(metrics, callback) {
          exports.push(metrics);
          callback({ code: 0 });
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined,
      },
      serviceName: 'nextagent',
      serviceVersion: '1.0.0',
      deploymentMode: 'LOCAL',
    });
    try {
      infrastructure.registry.observe('model_token_count', { token_type: 'output', outcome: 'success' }, 80);
      infrastructure.registry.observe('model_token_count', { token_type: 'output', outcome: 'success' }, 120);
      infrastructure.registry.observe('model_output_token_rate', { outcome: 'success' }, 40);
      infrastructure.registry.observe('request_active_concurrency', {}, 2);
      await infrastructure.forceFlush();

      const metrics = exports.flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
      expect(metrics.find((metric) => metric.descriptor.name === 'model_token_count')).toMatchObject({
        descriptor: { unit: '{token}' },
        dataPoints: [
          {
            value: {
              count: 2,
              sum: 200,
              min: 80,
              max: 120,
              buckets: { boundaries: [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144] },
            },
          },
        ],
      });
      expect(metrics.find((metric) => metric.descriptor.name === 'model_output_token_rate')).toMatchObject({
        descriptor: { unit: '{token}/s' },
        dataPoints: [{ value: { buckets: { boundaries: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000] } } }],
      });
      expect(metrics.find((metric) => metric.descriptor.name === 'request_active_concurrency')).toMatchObject({
        descriptor: { unit: '1' },
        dataPoints: [{ value: { buckets: { boundaries: [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] } } }],
      });
    } finally {
      await infrastructure.shutdown();
    }
  });

  it('uses an independent 8 MiB handle and reports saturation without partial enqueue', async () => {
    const appendLine = vi.fn(() => ({ status: 'dropped', reason: 'buffer_full' }) as const);
    const exporter = createLocalMetricHistoryExporterForTesting({ logDirectory: 'C:\\trusted\\logs' }, async () => captureHandle([], { appendLine }));

    await expect(expectExport(exporter, oneCounterResourceMetrics())).resolves.toBe(1);
    expect(appendLine).toHaveBeenCalledOnce();
    expect(localMetricHistoryPolicy('C:\\trusted\\logs')).toMatchObject({
      maxFileSizeMiB: 30,
      maxArchiveFiles: 10,
      bufferCapacityBytes: 8 * 1024 * 1024,
    });
  });

  it('enforces single-flight and double-shutdown safety', async () => {
    let release!: (handle: LocalFileRollHandle) => void;
    const handleReady = new Promise<LocalFileRollHandle>((resolve) => {
      release = resolve;
    });
    const exporter = createLocalMetricHistoryExporterForTesting({ logDirectory: 'C:\\trusted\\logs' }, async () => await handleReady);

    const first = expectExport(exporter, oneCounterResourceMetrics());
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(1));
    const close = vi.fn(async () => undefined);
    release(captureHandle([], { close }));
    await expect(first).resolves.toBe(0);
    await Promise.all([exporter.shutdown(), exporter.shutdown()]);
    expect(close).toHaveBeenCalledOnce();
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(1));
  });

  it('rejects a snapshot larger than 4 MiB before append', async () => {
    const appendLine = vi.fn(() => ({ status: 'accepted' }) as const);
    const exporter = createLocalMetricHistoryExporterForTesting({ logDirectory: 'C:\\trusted\\logs' }, async () => captureHandle([], { appendLine }));
    const oversized = oneCounterResourceMetrics(90_000);

    await expectExport(exporter, oversized).then((code) => expect(code).toBe(1));
    expect(appendLine).not.toHaveBeenCalled();
  });

  it('reports maintenance degradation without rejecting active metric exports', async () => {
    let maintenanceListener: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] | undefined;
    const maintenanceEvents: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] extends (event: infer T) => void ? T[] : never = [];
    const exporter = createLocalMetricHistoryExporterForTesting(
      { logDirectory: 'C:\\trusted\\logs', onMaintenanceEvent: (event) => maintenanceEvents.push(event) },
      async () =>
        captureHandle([], {
          setMaintenanceEventListener: (listener) => {
            maintenanceListener = listener;
          },
        }),
    );
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(0));

    maintenanceListener?.({ operation: 'archive', outcome: 'failed', affectedCount: 1 });
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(0));

    maintenanceListener?.({ operation: 'archive', outcome: 'completed', affectedCount: 1 });
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(0));
    expect(maintenanceEvents).toEqual([
      { operation: 'archive', outcome: 'failed', affectedCount: 1 },
      { operation: 'archive', outcome: 'completed', affectedCount: 1 },
    ]);
    await exporter.shutdown();
  });

  it('isolates maintenance listener failure from metric exports', async () => {
    let maintenanceListener: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] | undefined;
    const exporter = createLocalMetricHistoryExporterForTesting(
      {
        logDirectory: 'C:\\trusted\\logs',
        onMaintenanceEvent: () => {
          throw new Error('listener failure');
        },
      },
      async () =>
        captureHandle([], {
          setMaintenanceEventListener: (listener) => {
            maintenanceListener = listener;
          },
        }),
    );
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(0));

    expect(() => maintenanceListener?.({ operation: 'retention', outcome: 'failed', affectedCount: 1 })).not.toThrow();
    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(0));
    await exporter.shutdown();
  });

  it('contains file initialization failure as owner degradation without rejecting construction or shutdown', async () => {
    const exporter = createLocalMetricHistoryExporterForTesting({ logDirectory: 'C:\\trusted\\logs' }, async () => {
      throw new Error('forbidden-init-error-canary');
    });
    await new Promise((resolve) => setImmediate(resolve));

    await expectExport(exporter, oneCounterResourceMetrics()).then((code) => expect(code).toBe(1));
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });

  it('exposes bounded SDK readiness and diagnostics for unavailable and recovered exporters', async () => {
    const warn = vi.fn();
    const info = vi.fn();
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({ error: vi.fn(), warn, info, debug: vi.fn() }),
    });
    const unavailable = createMetricsInfrastructure({
      serviceName: 'nextagent',
      serviceVersion: '1.0.0',
      deploymentMode: 'REMOTE',
    });
    expect(unavailable.readiness()).toEqual({ state: 'DEGRADED', safeReasonCode: 'METRICS_EXPORTER_UNAVAILABLE' });
    expect(warn).toHaveBeenCalledOnce();
    expect(unavailable.registry.increment('request_outcome_total', { status: 'COMPLETED' }).outcome).toBe('emitted');
    await unavailable.forceFlush().catch(() => undefined);
    expect(warn).toHaveBeenCalledOnce();
    await unavailable.shutdown().catch(() => undefined);

    let succeeds = false;
    const exporterWarn = vi.fn();
    const exporterInfo = vi.fn();
    loggerBinding.unbind();
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({ error: vi.fn(), warn: exporterWarn, info: exporterInfo, debug: vi.fn() }),
    });
    const exporter = createMetricsInfrastructure({
      exporter: {
        export(_metrics, callback) {
          callback(succeeds ? { code: 0 } : { code: 1, error: new Error('forbidden-export-canary') });
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined,
      },
      serviceName: 'nextagent',
      serviceVersion: '1.0.0',
      deploymentMode: 'REMOTE',
    });
    exporter.registry.increment('request_outcome_total', { status: 'COMPLETED' });
    await exporter.forceFlush().catch(() => undefined);
    expect(exporter.readiness()).toEqual({ state: 'DEGRADED', safeReasonCode: 'METRICS_EXPORT_FAILED' });
    expect(exporterWarn).toHaveBeenCalledOnce();
    succeeds = true;
    exporter.registry.increment('request_outcome_total', { status: 'COMPLETED' });
    await exporter.forceFlush();
    expect(exporter.readiness()).toEqual({ state: 'READY' });
    expect(exporterInfo).toHaveBeenCalledOnce();
    await exporter.shutdown();
  });
});

function captureHandle(lines: string[], overrides: Partial<LocalFileRollHandle> = {}): LocalFileRollHandle {
  return {
    appendLine(line) {
      lines.push(line);
      return { status: 'accepted' };
    },
    activeIdentity: () => undefined,
    setMaintenanceEventListener: () => undefined,
    flush: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}

function expectExport(
  exporter: { export: (metrics: ResourceMetrics, callback: (result: { code: number }) => void) => void },
  metrics: ResourceMetrics,
): Promise<number> {
  return new Promise((resolve) => exporter.export(metrics, (result) => resolve(result.code)));
}

function oneCounterResourceMetrics(pointCount = 1): ResourceMetrics {
  const points = Array.from({ length: pointCount }, (_, index) => ({
    attributes: { status: 'COMPLETED' },
    startTime: [1, 0] as [number, number],
    endTime: [2 + index, 0] as [number, number],
    value: 1,
  }));
  return {
    resource: resourceFromAttributes({
      'service.name': 'nextagent',
      'service.version': '1.0.0',
      'nextagent.deployment.mode': 'LOCAL',
      'host.name': 'forbidden-host',
    }),
    scopeMetrics: [
      {
        scope: { name: 'nextagent-runtime' },
        metrics: [
          {
            descriptor: { name: 'request_outcome_total', description: '', unit: '1', valueType: 1 },
            aggregationTemporality: AggregationTemporality.CUMULATIVE,
            dataPointType: DataPointType.SUM,
            isMonotonic: true,
            dataPoints: points,
          },
        ],
      },
    ],
  };
}
