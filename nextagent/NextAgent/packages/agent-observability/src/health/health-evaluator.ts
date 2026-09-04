import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { MetricsRegistry } from '../metrics/metrics-registry.js';

export type HealthStatus = 'UP' | 'DOWN' | 'DEGRADED';
export type HealthComponentName = 'runtime_authority' | 'gateway' | 'model_provider' | 'capability';

export interface ComponentHealth {
  readonly name: HealthComponentName;
  readonly status: HealthStatus;
  readonly summary?: string;
  readonly reasonCode?: string;
  readonly latencyMs?: number;
}

export interface HealthCheckResponse {
  readonly status: HealthStatus;
  readonly components: readonly ComponentHealth[];
  readonly timestamp: EpochMillis;
}

export interface HealthProbeResult {
  readonly status: HealthStatus;
  readonly summary?: string;
  readonly reasonCode?: string;
  readonly latencyMs?: number;
}

export interface HealthProbe {
  readonly name: HealthComponentName;
  readonly critical: boolean;
  readonly timeoutMs: number;
  run: (signal: AbortSignal) => Promise<HealthProbeResult> | HealthProbeResult;
}

export interface HealthEvaluator {
  primary: (signal?: AbortSignal) => Promise<HealthCheckResponse>;
  deep: (signal?: AbortSignal) => Promise<HealthCheckResponse>;
}

export interface HealthEvaluatorOptions {
  readonly probes?: readonly HealthProbe[];
  readonly metricsRegistry?: MetricsRegistry;
  readonly clock?: () => EpochMillis;
  readonly primaryCheck?: (signal: AbortSignal) => Promise<HealthProbeResult> | HealthProbeResult;
}

export function createHealthEvaluator(options: HealthEvaluatorOptions = {}): HealthEvaluator {
  const clock = options.clock ?? (() => brand<number, 'EpochMillis'>(Date.now()));
  const primaryProbe: HealthProbe = {
    name: 'runtime_authority',
    critical: true,
    timeoutMs: 250,
    run: options.primaryCheck ?? (() => ({ status: 'UP', summary: 'Runtime authority is responsive.', reasonCode: 'RUNTIME_AUTHORITY_UP' })),
  };
  return {
    async primary(signal) {
      const startedAt = Date.now();
      const evaluated = await runProbe(primaryProbe, signal);
      const response = aggregateProbeHealth([evaluated], clock());
      const component = evaluated.component;
      recordHealthProbeMetrics(options.metricsRegistry, 'primary', component, Date.now() - startedAt);
      return response;
    },
    async deep(signal) {
      const evaluated = [];
      const probes = options.probes ?? [];
      for (const probe of probes.length === 0 ? [primaryProbe] : probes) {
        const startedAt = Date.now();
        const component = await runProbe(probe, signal);
        evaluated.push(component);
        recordHealthProbeMetrics(options.metricsRegistry, 'deep', component.component, Date.now() - startedAt);
      }
      return aggregateProbeHealth(evaluated, clock());
    },
  };
}

interface EvaluatedComponentHealth {
  readonly component: ComponentHealth;
  readonly critical: boolean;
}

function aggregateProbeHealth(evaluated: readonly EvaluatedComponentHealth[], timestamp: EpochMillis): HealthCheckResponse {
  const criticalDown = evaluated.some((item) => item.critical && item.component.status === 'DOWN');
  const degraded = evaluated.some((item) => item.component.status === 'DEGRADED' || (!item.critical && item.component.status === 'DOWN'));
  return {
    status: criticalDown ? 'DOWN' : degraded ? 'DEGRADED' : 'UP',
    components: evaluated.map((item) => item.component),
    timestamp,
  };
}

async function runProbe(probe: HealthProbe, parentSignal?: AbortSignal): Promise<EvaluatedComponentHealth> {
  const controller = new AbortController();
  let timedOut = false;
  const abortForTimeout = () => {
    timedOut = true;
    controller.abort();
  };
  const timeoutHandle = setTimeout(abortForTimeout, probe.timeoutMs);
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  const startedAt = Date.now();
  try {
    const result = await runWithAbort(() => probe.run(controller.signal), controller.signal);
    return {
      component: sanitizeComponent(probe.name, { ...result, latencyMs: result.latencyMs ?? Date.now() - startedAt }),
      critical: probe.critical,
    };
  } catch (error) {
    return {
      component: sanitizeComponent(probe.name, {
        status: probe.critical ? 'DOWN' : 'DEGRADED',
        reasonCode: timedOut ? 'HEALTH_PROBE_TIMEOUT' : controller.signal.aborted ? 'HEALTH_PROBE_ABORTED' : 'HEALTH_PROBE_FAILED',
        summary: 'Health probe failed safely.',
        latencyMs: Date.now() - startedAt,
      }),
      critical: probe.critical,
    };
  } finally {
    clearTimeout(timeoutHandle);
    parentSignal?.removeEventListener('abort', abort);
  }
}

async function runWithAbort<T>(operation: () => Promise<T> | T, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new Error('Health probe aborted.');
  }
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error('Health probe aborted.'));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort !== undefined) {
      signal.removeEventListener('abort', abort);
    }
  }
}

function sanitizeComponent(name: HealthComponentName, result: HealthProbeResult): ComponentHealth {
  const summary = sanitizeHealthText(result.summary ?? safeSummary(result.status), safeSummary(result.status));
  const reasonCode = sanitizeHealthToken(result.reasonCode ?? reasonCodeForStatus(result.status), reasonCodeForStatus(result.status));
  return {
    name,
    status: result.status,
    summary,
    reasonCode,
    ...(result.latencyMs === undefined ? {} : { latencyMs: Math.max(0, Math.round(result.latencyMs)) }),
  };
}

function sanitizeHealthText(value: string, fallback: string): string {
  if (/secret|token|credential|password|apikey|authorization|bearer|stack|raw|path/iu.test(value)) {
    return fallback;
  }
  return value.length <= 256 ? value : value.slice(0, 256);
}

function sanitizeHealthToken(value: string, fallback: string): string {
  return /^[A-Z0-9_.:-]{1,128}$/iu.test(value) ? value : fallback;
}

function recordHealthProbeMetrics(
  registry: MetricsRegistry | undefined,
  endpoint: 'primary' | 'deep',
  component: ComponentHealth,
  durationMs: number,
): void {
  if (registry === undefined) {
    return;
  }
  const labels = { endpoint, status: component.status, component: component.name };
  registry.increment('health_probe_total', labels);
  registry.observe('health_probe_duration_seconds', labels, durationMs / 1000);
}

function safeSummary(status: HealthStatus): string {
  return status === 'UP' ? 'Health check passed.' : status === 'DOWN' ? 'Health check failed safely.' : 'Health check is degraded.';
}

function reasonCodeForStatus(status: HealthStatus): string {
  return status === 'UP' ? 'HEALTH_UP' : status === 'DOWN' ? 'HEALTH_DOWN' : 'HEALTH_DEGRADED';
}
