import type { ObservabilityObservationEvent } from './observation.js';
import { sanitizeObservation } from '../logging/redaction.js';
import type { MetricsRegistry } from '../metrics/metrics-registry.js';
import { transferLocalLogCorrelation } from '../logging/local-log-correlation.js';

export type ObservabilitySurface = 'LOG' | 'AUDIT' | 'METRIC' | 'HEALTH' | 'TRACE';
export type ProjectionOutcome = 'emitted' | 'skipped_not_covered' | 'skipped_policy_denied' | 'degraded' | 'failed_closed';

export interface SurfaceProjectionResult {
  readonly surface: ObservabilitySurface;
  readonly outcome: ProjectionOutcome;
  readonly safeReasonCode?: string;
}

export interface ObservabilityProjector {
  readonly surface: ObservabilitySurface;
  covers: (event: ObservabilityObservationEvent) => boolean;
  project: (event: ObservabilityObservationEvent) => Promise<SurfaceProjectionResult> | SurfaceProjectionResult;
  onObservationDropped?: (event: ObservabilityObservationEvent) => void;
}

export interface ObservabilityProjectorHost {
  acceptObservation: (event: ObservabilityObservationEvent) => void;
  drain?: (timeoutMs?: number) => Promise<void>;
  close?: (timeoutMs?: number) => Promise<void>;
}

export interface ObservabilityProjectorHostOptions {
  readonly queueCapacity?: number;
  readonly onProjectionResult?: (result: SurfaceProjectionResult) => void;
}

export function createProjectionMetricsRecorder(metricsRegistry: MetricsRegistry): (result: SurfaceProjectionResult) => void {
  return (result) => {
    metricsRegistry.increment('projector_projection_total', { surface: result.surface, result: result.outcome });
    if (result.outcome === 'degraded' || result.outcome === 'failed_closed') {
      metricsRegistry.increment('observability_degradation_total', {
        surface: result.surface,
        reason_code: result.safeReasonCode ?? 'PROJECTOR_FAILED',
      });
    }
  };
}

export function createObservabilityProjectorHost(
  projectors: readonly ObservabilityProjector[],
  options: ObservabilityProjectorHostOptions = {},
): ObservabilityProjectorHost {
  const fixedProjectors = [...projectors];
  const queue: ObservabilityObservationEvent[] = [];
  const capacity = options.queueCapacity ?? 1024;
  let drainTask: Promise<void> | undefined;
  let closed = false;
  const scheduleDrain = () => {
    if (drainTask !== undefined) {
      return;
    }
    drainTask = Promise.resolve()
      .then(() => drainQueue(fixedProjectors, queue, options))
      .finally(() => {
        drainTask = undefined;
        if (queue.length > 0) {
          scheduleDrain();
        }
      });
  };
  const waitUntilDrained = async (): Promise<void> => {
    while (queue.length > 0 || drainTask !== undefined) {
      scheduleDrain();
      await drainTask;
    }
  };
  return {
    acceptObservation(event) {
      if (closed) {
        return;
      }
      let sanitized: ObservabilityObservationEvent;
      try {
        sanitized = sanitizeObservation(event);
        transferLocalLogCorrelation(event, sanitized);
      } catch {
        return;
      }
      if (queue.length >= capacity) {
        for (const projector of fixedProjectors) {
          try {
            projector.onObservationDropped?.(sanitized);
          } catch {
            // Drop accounting must not affect the caller or other surfaces.
          }
          recordProjectionResult(options, { surface: projector.surface, outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' });
        }
        return;
      }
      queue.push(sanitized);
      scheduleDrain();
    },
    drain(timeoutMs = 5_000) {
      return bounded(waitUntilDrained(), timeoutMs);
    },
    close(timeoutMs = 5_000) {
      closed = true;
      return bounded(waitUntilDrained(), timeoutMs);
    },
  };
}

async function bounded(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('OBSERVABILITY_PROJECTOR_DRAIN_TIMEOUT')), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function drainQueue(
  projectors: readonly ObservabilityProjector[],
  queue: ObservabilityObservationEvent[],
  options: ObservabilityProjectorHostOptions,
): Promise<void> {
  while (queue.length > 0) {
    const event = queue.shift();
    if (event === undefined) {
      return;
    }
    const results = await projectToSurfaces(projectors, event);
    for (const result of results) {
      recordProjectionResult(options, result);
    }
  }
}

async function projectToSurfaces(
  projectors: readonly ObservabilityProjector[],
  event: ObservabilityObservationEvent,
): Promise<readonly SurfaceProjectionResult[]> {
  const results: SurfaceProjectionResult[] = [];
  for (const projector of projectors) {
    if (!projector.covers(event)) {
      results.push({ surface: projector.surface, outcome: 'skipped_not_covered' });
      continue;
    }
    try {
      results.push(await projector.project(event));
    } catch {
      results.push({ surface: projector.surface, outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' });
    }
  }
  return results;
}

function recordProjectionResult(options: ObservabilityProjectorHostOptions, result: SurfaceProjectionResult): void {
  try {
    options.onProjectionResult?.(result);
  } catch {
    // Projection outcome recording must not affect business execution.
  }
}
