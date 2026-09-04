import type { PushMetricExporter } from '@nextagent/agent-observability';
import { describe, expect, it, vi } from 'vitest';
import { createNextAgentTestApp } from '../src/composition/create-test-composition.js';

describe('metrics exporter app composition', () => {
  it('rejects an invalid test deployment service version', () => {
    expect(() =>
      createNextAgentTestApp({
        modelSteps: [{ content: 'not started' }],
        serviceVersion: 'invalid/service/version',
      }),
    ).toThrow(/service version/i);
  });

  it('routes runtime metrics through the injected SDK exporter and flushes then shuts it down during app close', async () => {
    const order: string[] = [];
    const snapshots: Array<Parameters<PushMetricExporter['export']>[0]> = [];
    const exporter: PushMetricExporter = {
      export(metrics, callback) {
        snapshots.push(metrics);
        callback({ code: 0 });
      },
      forceFlush: vi.fn(async () => {
        order.push('exporter.forceFlush');
      }),
      shutdown: vi.fn(async () => {
        order.push('exporter.shutdown');
      }),
    };
    const app = createNextAgentTestApp({
      modelSteps: [{ content: 'metrics complete' }],
      metricsExporter: exporter,
      serviceVersion: 'agent-test-1.0.0',
    });
    try {
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'collect metrics', idempotencyKey: 'metrics-exporter-composition' },
      });
      expect(response.statusCode).toBe(200);
      await app.runtime.waitForIdle({ timeoutMs: 5_000 });
    } finally {
      await app.close();
    }

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]!.resource.attributes['service.version']).toBe('agent-test-1.0.0');
    expect(
      snapshots
        .flatMap((snapshot) => snapshot.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .map((metric) => metric.descriptor.name),
    ).toEqual(expect.arrayContaining(['request_outcome_total', 'request_duration_seconds', 'request_active_concurrency']));
    const phaseMetrics = snapshots
      .flatMap((snapshot) => snapshot.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === 'request_phase_duration_seconds');
    expect(
      phaseMetrics
        .flatMap((metric) => metric.dataPoints as ReadonlyArray<{ readonly attributes: Readonly<Record<string, unknown>> }>)
        .map((point) => point.attributes),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'queued', status: 'success' })]));
    expect(app.metricsReadiness()).toEqual({ state: 'READY' });
    expect(order.at(-1)).toBe('exporter.shutdown');
    expect(exporter.forceFlush).toHaveBeenCalled();
    expect(exporter.shutdown).toHaveBeenCalledOnce();
  });
});
