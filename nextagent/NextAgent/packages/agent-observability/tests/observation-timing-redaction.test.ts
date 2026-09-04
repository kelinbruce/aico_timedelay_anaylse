import { brand } from '@nextagent/agent-common';
import { createObservationEvent, sanitizeObservation, type ObservabilityObservationEvent } from '@nextagent/agent-observability';
import { describe, expect, it } from 'vitest';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-timing'),
  subjectId: brand<string, 'SubjectId'>('subject-timing'),
  agentId: brand<string, 'AgentId'>('agent-timing'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('Model terminal timing redaction', () => {
  it('retains bounded first feedback latency on a Model terminal observation', () => {
    const sanitized = sanitizeObservation({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(1),
      durationMs: 40,
      firstContentLatencyMs: 12,
    } as ObservabilityObservationEvent);

    expect(sanitized).toMatchObject({ durationMs: 40, firstContentLatencyMs: 12 });
  });

  it('rejects invalid, out-of-order, and non-terminal first feedback latency', () => {
    const base = {
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(1),
      durationMs: 10,
    } as const;

    expect(() => createObservationEvent({ ...base, firstContentLatencyMs: -1 } as ObservabilityObservationEvent)).toThrow();
    expect(() => createObservationEvent({ ...base, firstContentLatencyMs: Number.POSITIVE_INFINITY } as ObservabilityObservationEvent)).toThrow();
    expect(() => createObservationEvent({ ...base, firstContentLatencyMs: 11 } as ObservabilityObservationEvent)).toThrow();
    expect(() =>
      createObservationEvent({ ...base, operation: 'MODEL_INVOCATION_STARTED', firstContentLatencyMs: 1 } as ObservabilityObservationEvent),
    ).toThrow();
  });
});
