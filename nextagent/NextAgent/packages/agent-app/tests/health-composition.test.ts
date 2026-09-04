import { bindRuntimeLoggerProvider, brand, type RuntimeLogger } from '@nextagent/agent-common';
import type { HealthCheckResponse, HealthEvaluator } from '@nextagent/agent-observability';
import { describe, expect, it, vi } from 'vitest';
import { withHealthDiagnostics } from '../src/composition/health-composition.js';

describe('health operational diagnostics', () => {
  it('keeps repeated success silent and bounds transitions and subsystem failures to an active incident', async () => {
    const entries: Array<{ level: string; event?: string }> = [];
    const logger: RuntimeLogger = {
      debug: vi.fn(),
      info: vi.fn((entry: object) => entries.push({ ...entry, level: 'info' })),
      warn: vi.fn((entry: object) => entries.push({ ...entry, level: 'warn' })),
      error: vi.fn((entry: object) => entries.push({ ...entry, level: 'error' })),
    };
    const responses = [health('UP'), health('UP'), health('DEGRADED', true), health('DEGRADED', true), health('UP'), health('DEGRADED', true)];
    const evaluator: HealthEvaluator = {
      primary: async () => responses.shift()!,
      deep: async () => health('UP'),
    };
    const loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const observed = withHealthDiagnostics(evaluator);

    for (let index = 0; index < 6; index += 1) {
      await observed.primary();
    }
    loggerBinding.unbind();

    expect(entries).toEqual([
      expect.objectContaining({ level: 'warn', event: 'health.state.changed', previousStatus: 'UP', status: 'DEGRADED' }),
      expect.objectContaining({
        level: 'error',
        event: 'health.probe.subsystem_failed',
        component: 'capability',
        safeReasonCode: 'CAPABILITY_UNAVAILABLE',
      }),
      expect.objectContaining({ level: 'info', event: 'health.state.changed', previousStatus: 'DEGRADED', status: 'UP' }),
      expect.objectContaining({ level: 'warn', event: 'health.state.changed', previousStatus: 'UP', status: 'DEGRADED' }),
      expect.objectContaining({
        level: 'error',
        event: 'health.probe.subsystem_failed',
        component: 'capability',
        safeReasonCode: 'CAPABILITY_UNAVAILABLE',
      }),
    ]);
  });
});

function health(status: HealthCheckResponse['status'], failed = false): HealthCheckResponse {
  return {
    status,
    components: failed
      ? [{ name: 'capability', status: 'DOWN', reasonCode: 'CAPABILITY_UNAVAILABLE', summary: 'Capability unavailable.' }]
      : [{ name: 'runtime_authority', status: 'UP', reasonCode: 'RUNTIME_AUTHORITY_UP', summary: 'Runtime ready.' }],
    timestamp: brand<number, 'EpochMillis'>(Date.now()),
  };
}
