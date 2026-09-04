import { brand } from '@nextagent/agent-common';
import { createObservabilityProjectorHost, createObservationEvent, createTraceProjector, type SurfaceProjectionResult } from '../src/index.js';
import { describe, expect, it } from 'vitest';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-trace-negative'),
  subjectId: brand<string, 'SubjectId'>('subject-trace-negative'),
  agentId: brand<string, 'AgentId'>('agent-trace-negative'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('trace projector negative cases', () => {
  it('degrades TRACE without blocking LOG projection on the same observation', async () => {
    const results: SurfaceProjectionResult[] = [];
    const host = createObservabilityProjectorHost(
      [
        {
          surface: 'LOG',
          covers: () => true,
          project: () => ({ surface: 'LOG' as const, outcome: 'emitted' as const }),
        },
        createTraceProjector({
          timelineSpanRegistry: {
            requestSpanContext: () => ({
              traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              spanId: 'bbbbbbbbbbbbbbbb',
              traceFlags: 1,
            }),
          },
          tracer: {
            startSpan() {
              throw new Error('trace unavailable');
            },
          } as never,
        }),
      ],
      {
        onProjectionResult(result) {
          results.push(result);
        },
      },
    );

    host.acceptObservation(
      createObservationEvent({
        boundary: 'system',
        operation: 'HOOK_FAILED',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10),
        safeReasonCode: 'HOOK_FAILED',
        stableRefs: { requestRunId: 'run-trace-negative' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toContainEqual({ surface: 'LOG', outcome: 'emitted' });
    expect(results).toContainEqual({ surface: 'TRACE', outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' });
  });
});
