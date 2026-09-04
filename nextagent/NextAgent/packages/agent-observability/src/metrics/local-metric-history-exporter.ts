import type { Attributes, HrTime } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, type PushMetricExporter, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import {
  createLocalFileRoll,
  type LocalFileAppendResult,
  type LocalFileMaintenanceEvent,
  type LocalFileRollHandle,
  type LocalFileRollPolicy,
} from '@nextagent/agent-local-file-roll';
import { METRIC_DESCRIPTORS, type MetricName } from './metric-descriptors.js';

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const METRICS_BUFFER_BYTES = 8 * 1024 * 1024;
const HTTP_SERVER_REQUEST_DURATION = 'http.server.request.duration';
const HTTP_SERVER_ATTRIBUTE_KEYS = Object.freeze([
  'error.type',
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'network.protocol.version',
  'url.scheme',
]);
type SnapshotMetricName = MetricName | typeof HTTP_SERVER_REQUEST_DURATION;

export interface LocalMetricHistoryExporterOptions {
  readonly logDirectory: string;
  readonly now?: () => Date;
  readonly onMaintenanceEvent?: (event: LocalFileMaintenanceEvent) => void;
}

interface LocalMetricHistoryExporterDependencies {
  readonly createHandle: (policy: LocalFileRollPolicy) => Promise<LocalFileRollHandle>;
}

export class LocalMetricHistoryExporter implements PushMetricExporter {
  private readonly handle: Promise<LocalFileRollHandle | undefined>;
  private readonly now: () => Date;
  private inFlight?: Promise<void> | undefined;
  private shutdownPromise?: Promise<void>;
  private closed = false;

  constructor(
    options: LocalMetricHistoryExporterOptions,
    dependencies: LocalMetricHistoryExporterDependencies = { createHandle: createLocalFileRoll },
  ) {
    this.now = options.now ?? (() => new Date());
    this.handle = dependencies.createHandle(localMetricHistoryPolicy(options.logDirectory)).then(
      (handle) => {
        const listener = options.onMaintenanceEvent;
        if (listener !== undefined) {
          handle.setMaintenanceEventListener((event) => {
            try {
              listener(event);
            } catch {
              // Diagnostics cannot affect metric exports.
            }
          });
        }
        return handle;
      },
      () => undefined,
    );
  }

  export(metrics: ResourceMetrics, resultCallback: (result: { code: 0 | 1; error?: Error }) => void): void {
    if (this.closed || this.inFlight !== undefined) {
      resultCallback({ code: 1, error: new Error(this.closed ? 'exporter closed' : 'export already in progress') });
      return;
    }
    const operation = this.exportOnce(metrics);
    this.inFlight = operation;
    void operation
      .then(
        () => {
          resultCallback({ code: 0 });
        },
        (error: unknown) => {
          resultCallback({ code: 1, error: error instanceof Error ? error : new Error('metric export failed') });
        },
      )
      .finally(() => {
        if (this.inFlight === operation) {
          this.inFlight = undefined;
        }
      });
  }

  selectAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.CUMULATIVE;
  }

  async forceFlush(): Promise<void> {
    await this.inFlight;
    const handle = await this.handle;
    if (handle === undefined) {
      throw new Error('metric file unavailable');
    }
    await handle.flush(10_000);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }
    this.closed = true;
    this.shutdownPromise = this.close();
    return this.shutdownPromise;
  }

  private async exportOnce(metrics: ResourceMetrics): Promise<void> {
    const line = serializeSnapshot(normalizeMetricSnapshot(metrics, this.now()));
    const handle = await this.handle;
    if (handle === undefined) {
      throw new Error('metric file unavailable');
    }
    assertAccepted(handle.appendLine(line));
  }

  private async close(): Promise<void> {
    await this.inFlight;
    await (await this.handle)?.close(10_000);
  }
}

export function createLocalMetricHistoryExporter(options: LocalMetricHistoryExporterOptions): LocalMetricHistoryExporter {
  return new LocalMetricHistoryExporter(options);
}

export function createLocalMetricHistoryExporterForTesting(
  options: LocalMetricHistoryExporterOptions,
  createHandle: LocalMetricHistoryExporterDependencies['createHandle'],
): LocalMetricHistoryExporter {
  return new LocalMetricHistoryExporter(options, { createHandle });
}

export function localMetricHistoryPolicy(logDirectory: string): LocalFileRollPolicy {
  return {
    directory: logDirectory,
    fileName: 'nextagent-metrics.ndjson',
    naming: 'date-sequence',
    maxFileSizeMiB: 30,
    retentionDays: 7,
    maxArchiveFiles: 10,
    bufferCapacityBytes: METRICS_BUFFER_BYTES,
  };
}

export interface NextAgentMetricSnapshotV1 {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly resource: Readonly<Record<string, string>>;
  readonly metrics: readonly NextAgentMetricSnapshotMetric[];
}

interface NextAgentMetricSnapshotMetric {
  readonly name: SnapshotMetricName;
  readonly kind: 'counter' | 'histogram';
  readonly unit: '1' | 's' | '{token}' | '{token}/s';
  readonly temporality: 'cumulative';
  readonly points: ReadonlyArray<Record<string, unknown>>;
}

export function normalizeMetricSnapshot(metrics: ResourceMetrics, exportedAt: Date): NextAgentMetricSnapshotV1 {
  const normalized = metrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .map((metric): NextAgentMetricSnapshotMetric | undefined => {
      if (metric.descriptor.name === HTTP_SERVER_REQUEST_DURATION) {
        if (
          metric.aggregationTemporality !== AggregationTemporality.CUMULATIVE ||
          metric.descriptor.unit !== 's' ||
          metric.dataPointType !== DataPointType.HISTOGRAM
        ) {
          return undefined;
        }
        return {
          name: HTTP_SERVER_REQUEST_DURATION,
          kind: 'histogram',
          unit: 's',
          temporality: 'cumulative',
          points: metric.dataPoints
            .map((point) => normalizeHttpServerPoint(point.attributes, point.startTime, point.endTime, point.value))
            .sort((left, right) => JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels))),
        };
      }
      if (!(metric.descriptor.name in METRIC_DESCRIPTORS)) {
        return undefined;
      }
      const descriptor = METRIC_DESCRIPTORS[metric.descriptor.name as MetricName];
      if (metric.aggregationTemporality !== AggregationTemporality.CUMULATIVE || metric.descriptor.unit !== descriptor.unit) {
        return undefined;
      }
      if (descriptor.kind === 'counter' && metric.dataPointType !== DataPointType.SUM) {
        return undefined;
      }
      if (descriptor.kind === 'histogram' && metric.dataPointType !== DataPointType.HISTOGRAM) {
        return undefined;
      }
      return {
        name: descriptor.name,
        kind: descriptor.kind,
        unit: descriptor.unit,
        temporality: 'cumulative',
        points: metric.dataPoints
          .map((point) => normalizePoint(descriptor.name, point.attributes, point.startTime, point.endTime, point.value))
          .sort((left, right) => JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels))),
      };
    })
    .filter((metric): metric is NextAgentMetricSnapshotMetric => metric !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    resource: allowlistedResource(metrics.resource.attributes),
    metrics: normalized,
  };
}

function normalizeHttpServerPoint(attributes: Attributes, startTime: HrTime, endTime: HrTime, value: unknown): Record<string, unknown> {
  return normalizeHistogramPoint(allowlistedHttpServerAttributes(attributes), startTime, endTime, value);
}

function normalizePoint(name: MetricName, attributes: Attributes, startTime: HrTime, endTime: HrTime, value: unknown): Record<string, unknown> {
  return normalizeHistogramOrNumberPoint(allowedLabels(name, attributes), startTime, endTime, value);
}

function normalizeHistogramOrNumberPoint(
  labels: Readonly<Record<string, string | number>>,
  startTime: HrTime,
  endTime: HrTime,
  value: unknown,
): Record<string, unknown> {
  const base = { labels, startTime: hrTimeToIso(startTime), endTime: hrTimeToIso(endTime) };
  if (typeof value === 'number') {
    return { ...base, value };
  }
  return normalizeHistogramPoint(labels, startTime, endTime, value);
}

function normalizeHistogramPoint(
  labels: Readonly<Record<string, string | number>>,
  startTime: HrTime,
  endTime: HrTime,
  value: unknown,
): Record<string, unknown> {
  const base = { labels, startTime: hrTimeToIso(startTime), endTime: hrTimeToIso(endTime) };
  const histogram = value as { count: number; sum?: number; min?: number; max?: number; buckets: { boundaries: number[]; counts: number[] } };
  return {
    ...base,
    count: histogram.count,
    ...(histogram.sum === undefined ? {} : { sum: histogram.sum }),
    ...(histogram.min === undefined ? {} : { min: histogram.min }),
    ...(histogram.max === undefined ? {} : { max: histogram.max }),
    boundaries: [...histogram.buckets.boundaries],
    bucketCounts: [...histogram.buckets.counts],
  };
}

function allowlistedHttpServerAttributes(attributes: Attributes): Record<string, string | number> {
  return HTTP_SERVER_ATTRIBUTE_KEYS.reduce<Record<string, string | number>>((result, key) => {
    const value = attributes[key];
    if (typeof value === 'string' || typeof value === 'number') {
      result[key] = value;
    }
    return result;
  }, {});
}

function allowedLabels(name: MetricName, attributes: Attributes): Record<string, string> {
  const allowed = METRIC_DESCRIPTORS[name].allowedLabels;
  return Object.keys(allowed)
    .sort()
    .reduce<Record<string, string>>((result, key) => {
      const value = attributes[key];
      if (typeof value === 'string' && allowed[key]?.includes(value)) {
        result[key] = value;
      }
      return result;
    }, {});
}

function allowlistedResource(attributes: Attributes): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['service.name', 'service.version', 'nextagent.deployment.mode'] as const) {
    const value = attributes[key];
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function hrTimeToIso(time: HrTime): string {
  return new Date(time[0] * 1_000 + time[1] / 1_000_000).toISOString();
}

function serializeSnapshot(snapshot: NextAgentMetricSnapshotV1): string {
  const line = `${JSON.stringify(snapshot)}\n`;
  if (Buffer.byteLength(line, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('metric snapshot exceeds 4 MiB');
  }
  return line;
}

function assertAccepted(result: LocalFileAppendResult): void {
  if (result.status !== 'accepted') {
    throw new Error(`metric snapshot append ${result.reason}`);
  }
}
