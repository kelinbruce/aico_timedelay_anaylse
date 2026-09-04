import { createNextAgentTestApp, readCapturedMetricSamples } from '@nextagent/agent-platform-gateway-local/testing';
import { createHealthEvaluator, createInMemoryMetricsRegistry } from '@nextagent/agent-observability';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('health checks', () => {
  it('runs primary as a bounded live check without registered deep probes', async () => {
    let probeCalls = 0;
    const registry = createInMemoryMetricsRegistry();
    const evaluator = createHealthEvaluator({
      metricsRegistry: registry,
      probes: [
        {
          name: 'gateway',
          critical: true,
          timeoutMs: 10,
          run: () => {
            probeCalls += 1;
            return { status: 'DOWN', reasonCode: 'SHOULD_NOT_RUN' };
          },
        },
      ],
    });

    const response = await evaluator.primary();

    expect(response.status).toBe('UP');
    expect(response.components).toEqual([expect.objectContaining({ name: 'runtime_authority', status: 'UP', reasonCode: 'RUNTIME_AUTHORITY_UP' })]);
    expect(probeCalls).toBe(0);
    expect(registry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'health_probe_total', labels: { endpoint: 'primary', status: 'UP', component: 'runtime_authority' } }),
        expect.objectContaining({
          name: 'health_probe_duration_seconds',
          labels: { endpoint: 'primary', status: 'UP', component: 'runtime_authority' },
        }),
      ]),
    );
  });

  it('bounds deep critical probes by timeout and keeps diagnostics safe', async () => {
    const startedAt = Date.now();
    const evaluator = createHealthEvaluator({
      probes: [
        {
          name: 'gateway',
          critical: true,
          timeoutMs: 20,
          run: () => new Promise(() => undefined),
        },
      ],
    });

    const response = await evaluator.deep();

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(response.status).toBe('DOWN');
    expect(response.components[0]).toEqual(expect.objectContaining({ name: 'gateway', status: 'DOWN', reasonCode: 'HEALTH_PROBE_TIMEOUT' }));
    expect(JSON.stringify(response)).not.toMatch(/stack|Bearer|C:\\|secret|prompt|model output/i);
  });

  it('degrades aggregate health for non-critical failures', async () => {
    const evaluator = createHealthEvaluator({
      probes: [
        { name: 'gateway', critical: true, timeoutMs: 50, run: () => ({ status: 'UP', reasonCode: 'GATEWAY_READY' }) },
        {
          name: 'capability',
          critical: false,
          timeoutMs: 50,
          run: () => ({ status: 'DOWN', reasonCode: 'CAPABILITY_UNAVAILABLE', summary: 'Capability is unavailable.' }),
        },
      ],
    });

    const response = await evaluator.deep();

    expect(response.status).toBe('DEGRADED');
    expect(response.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'gateway', status: 'UP' }),
        expect.objectContaining({ name: 'capability', status: 'DOWN' }),
      ]),
    );
  });

  it('forces aborted deep probes to a safe evaluator reason', async () => {
    const controller = new AbortController();
    const evaluator = createHealthEvaluator({
      probes: [
        {
          name: 'model_provider',
          critical: true,
          timeoutMs: 500,
          run: (signal) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => resolve({ status: 'DOWN', reasonCode: 'ABORTED', summary: 'Probe aborted.' }), { once: true });
            }),
        },
      ],
    });
    setTimeout(() => controller.abort(), 10);

    const response = await evaluator.deep(controller.signal);

    expect(response.status).toBe('DOWN');
    expect(response.components[0]).toEqual(expect.objectContaining({ name: 'model_provider', status: 'DOWN', reasonCode: 'HEALTH_PROBE_ABORTED' }));
  });

  it('preserves cooperative probe cancellation results', async () => {
    const evaluator = createHealthEvaluator({
      probes: [
        {
          name: 'model_provider',
          critical: true,
          timeoutMs: 50,
          run: () => ({ status: 'DOWN', reasonCode: 'MODEL_PROVIDER_ABORTED', summary: 'Model provider check aborted safely.' }),
        },
      ],
    });

    const response = await evaluator.deep();

    expect(response.status).toBe('DOWN');
    expect(response.components[0]).toEqual(
      expect.objectContaining({
        name: 'model_provider',
        status: 'DOWN',
        reasonCode: 'MODEL_PROVIDER_ABORTED',
        summary: 'Model provider check aborted safely.',
      }),
    );
  });

  it('keeps health truth when metric writes degrade', async () => {
    const evaluator = createHealthEvaluator({
      metricsRegistry: {
        increment: () => ({ surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'REGISTRY_UNAVAILABLE' }),
        observe: () => ({ surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'REGISTRY_UNAVAILABLE' }),
      },
      primaryCheck: () => ({ status: 'UP', reasonCode: 'RUNTIME_AUTHORITY_UP' }),
    });

    await expect(evaluator.primary()).resolves.toEqual(expect.objectContaining({ status: 'UP' }));
  });

  it('projects primary and deep health routes from app composition', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-health-test-'));
    const app = createNextAgentTestApp({ workspaceDir, modelSteps: [{ content: 'ok' }] });
    try {
      const primary = await app.server.inject({ method: 'GET', url: '/health' });
      const deep = await app.server.inject({ method: 'GET', url: '/health/deep' });

      expect(primary.statusCode).toBe(200);
      expect(primary.json()).toEqual(expect.objectContaining({ status: 'UP', components: expect.any(Array), timestamp: expect.any(Number) }));
      expect(deep.statusCode).toBe(200);
      expect(deep.json()).toEqual(
        expect.objectContaining({
          status: 'UP',
          components: expect.arrayContaining([
            expect.objectContaining({ name: 'gateway', status: 'UP', reasonCode: 'GATEWAY_READ_OK' }),
            expect.objectContaining({ name: 'model_provider', status: 'UP', reasonCode: 'MODEL_AVAILABLE' }),
            expect.objectContaining({ name: 'capability', status: 'UP', reasonCode: 'CAPABILITY_CATALOG_READ_OK' }),
          ]),
          timestamp: expect.any(Number),
        }),
      );
      expect(readCapturedMetricSamples(app)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'health_probe_total', labels: expect.objectContaining({ endpoint: 'primary' }) }),
          expect.objectContaining({ name: 'health_probe_total', labels: expect.objectContaining({ endpoint: 'deep' }) }),
        ]),
      );
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
