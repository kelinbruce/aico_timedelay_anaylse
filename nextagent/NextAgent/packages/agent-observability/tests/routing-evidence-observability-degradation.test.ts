import { brand, type JsonObject } from '@nextagent/agent-common';
import {
  createObservabilityProjectorHost,
  createStructuredLogProjector,
  timelineObservationFromRecord,
  type SurfaceProjectionResult,
} from '@nextagent/agent-observability';
import { describe, expect, it, vi } from 'vitest';

describe('routing evidence observability degradation', () => {
  it('degrades safely when the structured log sink is unavailable', () => {
    const projector = createStructuredLogProjector(undefined);
    const observation = makeObservation();

    expect(projector.project(observation)).toEqual({
      surface: 'LOG',
      outcome: 'degraded',
      safeReasonCode: 'SINK_UNAVAILABLE',
    });
  });

  it('degrades safely when a projector throws and does not affect projection host execution', async () => {
    const results: SurfaceProjectionResult[] = [];
    const host = createObservabilityProjectorHost(
      [
        {
          surface: 'LOG',
          covers: () => true,
          project: vi.fn(async () => {
            throw new Error('sink failed');
          }),
        },
      ],
      {
        onProjectionResult: (result) => {
          results.push(result);
        },
      },
    );

    host.acceptObservation(makeObservation());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toContainEqual({
      surface: 'LOG',
      outcome: 'degraded',
      safeReasonCode: 'PROJECTOR_FAILED',
    });
  });

  it('skips projection when redaction cannot safely sanitize routing evidence', async () => {
    const results: SurfaceProjectionResult[] = [];
    const host = createObservabilityProjectorHost(
      [
        {
          surface: 'LOG',
          covers: () => true,
          project: vi.fn(async () => ({ surface: 'LOG' as const, outcome: 'emitted' as const })),
        },
      ],
      {
        onProjectionResult: (result) => {
          results.push(result);
        },
      },
    );

    host.acceptObservation({
      ...makeObservation(),
      diagnosticSnapshot: {
        ...makeObservation().diagnosticSnapshot!,
        diagnosticCandidates: [
          {
            key: 'loop',
            value: {} as unknown as JsonObject,
          } as never,
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([]);
  });
});

function makeObservation() {
  return timelineObservationFromRecord({
    tenantId: brand<string, 'TenantId'>('tenant-routing-observability-degradation'),
    subjectId: brand<string, 'SubjectId'>('subject-routing-observability-degradation'),
    agentId: brand<string, 'AgentId'>('agent-routing-observability-degradation'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    eventId: 'event-routing-observability-degradation',
    sessionId: brand<string, 'SessionId'>('session-routing-observability-degradation'),
    runId: brand<string, 'RequestRunId'>('run-routing-observability-degradation'),
    requestId: brand<string, 'MessageId'>('request-routing-observability-degradation'),
    requestContextId: brand<string, 'RequestContextId'>('context-routing-observability-degradation'),
    type: 'POLICY_APPLIED',
    inlinePayload: {
      policyDomain: 'MODEL_FALLBACK',
      outcome: 'degraded',
      reasonCode: 'MODEL_PRIMARY_FAILED',
      selectedProfileId: 'fallback-profile',
    } satisfies JsonObject,
    createdAt: brand<number, 'EpochMillis'>(1),
  })!;
}
