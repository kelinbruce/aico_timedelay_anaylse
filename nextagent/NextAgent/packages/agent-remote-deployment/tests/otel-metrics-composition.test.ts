import { beforeEach, describe, expect, it, vi } from 'vitest';

const captures = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>> }));

vi.mock('@opentelemetry/exporter-metrics-otlp-proto', () => ({
  OTLPMetricExporter: class {
    constructor(config: Record<string, unknown>) {
      captures.configs.push(config);
    }
    export(_metrics: unknown, callback: (result: { code: number }) => void) {
      callback({ code: 0 });
    }
    async forceFlush() {}
    async shutdown() {}
  },
}));

import { createRemoteOtlpMetricExporter } from '../src/index.js';

describe('remote OTLP metrics composition', () => {
  beforeEach(() => captures.configs.splice(0));

  it('prefers the signal-specific endpoint and signal-specific optional settings', () => {
    const exporter = createRemoteOtlpMetricExporter({
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://metrics.example/v1/metrics',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://general.example',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'authorization=signal-secret,x-tenant=platform',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=general-secret',
      OTEL_EXPORTER_OTLP_METRICS_COMPRESSION: 'gzip',
      OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: '9000',
    });

    expect(exporter).toBeDefined();
    expect(captures.configs).toEqual([
      {
        url: 'https://metrics.example/v1/metrics',
        headers: { authorization: 'signal-secret', 'x-tenant': 'platform' },
        compression: 'gzip',
        timeoutMillis: 9000,
      },
    ]);
  });

  it('appends the standard metrics path to the general endpoint', () => {
    createRemoteOtlpMetricExporter({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/root/',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-platform=remote',
      OTEL_EXPORTER_OTLP_TIMEOUT: '10000',
    });

    expect(captures.configs).toEqual([
      {
        url: 'https://collector.example/root/v1/metrics',
        headers: { 'x-platform': 'remote' },
        timeoutMillis: 10000,
      },
    ]);
  });

  it('returns degraded selection evidence as absence instead of localhost fallback', () => {
    expect(createRemoteOtlpMetricExporter({})).toBeUndefined();
    expect(captures.configs).toEqual([]);
  });

  it('ignores invalid optional values without exposing them', () => {
    createRemoteOtlpMetricExporter({
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://metrics.example/v1/metrics',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'invalid,=empty',
      OTEL_EXPORTER_OTLP_METRICS_COMPRESSION: 'brotli',
      OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: 'not-a-number',
    });

    expect(captures.configs).toEqual([{ url: 'https://metrics.example/v1/metrics' }]);
  });
});
