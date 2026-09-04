import { brand, type AgentId, type AgentVersion, type EpochMillis, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { Meter } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryMetricsRegistry,
  createMetricsProjector,
  createMetricsRegistry,
  createObservationEvent,
  CONCURRENCY_HISTOGRAM_BOUNDARIES,
  METRIC_DESCRIPTORS,
  SECONDS_HISTOGRAM_BOUNDARIES,
  TOKEN_COUNT_HISTOGRAM_BOUNDARIES,
  TOKEN_RATE_HISTOGRAM_BOUNDARIES,
} from '../src/index.js';

describe('metrics registry', () => {
  it('uses one immutable descriptor inventory for kind, unit, labels, and source', () => {
    expect(Object.keys(METRIC_DESCRIPTORS)).toHaveLength(29);
    expect(Object.isFrozen(METRIC_DESCRIPTORS)).toBe(true);
    for (const descriptor of Object.values(METRIC_DESCRIPTORS)) {
      expect(descriptor.name).toBeTruthy();
      expect(['counter', 'histogram']).toContain(descriptor.kind);
      expect(['1', 's', '{token}', '{token}/s']).toContain(descriptor.unit);
      expect(descriptor.valueSource).toBeTruthy();
      expect(descriptor.acquisitionSource).toBeTruthy();
      if (descriptor.kind === 'histogram') {
        expect(descriptor.boundaries.length).toBeGreaterThan(0);
        expect(
          descriptor.boundaries.every((value, index, values) => Number.isFinite(value) && value >= 0 && (index === 0 || value > values[index - 1]!)),
        ).toBe(true);
      }
      if (descriptor.name === 'model_token_usage_total') {
        expect(descriptor.unit).toBe('{token}');
      }
      if (descriptor.kind === 'counter' && descriptor.name !== 'model_token_usage_total') {
        expect(descriptor.unit).toBe('1');
      }
    }
    expect(SECONDS_HISTOGRAM_BOUNDARIES).toEqual([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]);
    expect(TOKEN_COUNT_HISTOGRAM_BOUNDARIES).toEqual([1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144]);
    expect(TOKEN_RATE_HISTOGRAM_BOUNDARIES).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
    expect(CONCURRENCY_HISTOGRAM_BOUNDARIES).toEqual([0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);
    for (const [name, boundaries] of [
      ['model_token_count', TOKEN_COUNT_HISTOGRAM_BOUNDARIES],
      ['request_token_count', TOKEN_COUNT_HISTOGRAM_BOUNDARIES],
      ['model_output_token_rate', TOKEN_RATE_HISTOGRAM_BOUNDARIES],
      ['request_active_concurrency', CONCURRENCY_HISTOGRAM_BOUNDARIES],
    ] as const) {
      const descriptor = METRIC_DESCRIPTORS[name];
      expect(descriptor.kind).toBe('histogram');
      if (descriptor.kind !== 'histogram') {
        throw new Error(`${name} must be a histogram.`);
      }
      expect(descriptor.boundaries).toEqual(boundaries);
    }
  });

  it('pre-creates OTel instruments and production registry retains no raw samples', () => {
    const add = vi.fn();
    const record = vi.fn();
    const createCounter = vi.fn(() => ({ add }));
    const createHistogram = vi.fn(() => ({ record }));
    const registry = createMetricsRegistry({ meter: { createCounter, createHistogram } as unknown as Meter });

    expect(createCounter).toHaveBeenCalledTimes(14);
    expect(createHistogram).toHaveBeenCalledTimes(15);
    expect(registry.increment('request_outcome_total', { status: 'COMPLETED' })).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(registry.observe('request_duration_seconds', { status: 'COMPLETED' }, 0.25)).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(add).toHaveBeenCalledWith(1, { status: 'COMPLETED' });
    expect(record).toHaveBeenCalledWith(0.25, { status: 'COMPLETED' });
    expect('snapshot' in registry).toBe(false);
    expect('attachSink' in registry).toBe(false);
  });

  it('keeps raw samples only in the explicitly selected in-memory test fixture', () => {
    const registry = createInMemoryMetricsRegistry();

    expect(registry.increment('request_outcome_total', { status: 'COMPLETED' })).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(registry.observe('request_duration_seconds', { status: 'COMPLETED' }, 0.5)).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(registry.snapshot()).toEqual([
      expect.objectContaining({ name: 'request_outcome_total', kind: 'counter', value: 1 }),
      expect.objectContaining({ name: 'request_duration_seconds', kind: 'histogram', value: 0.5 }),
    ]);
  });

  it('rejects invalid labels, kind, and values before recording', () => {
    const registry = createInMemoryMetricsRegistry();
    expect(registry.increment('request_outcome_total', { status: 'UNKNOWN' })).toMatchObject({
      outcome: 'degraded',
      safeReasonCode: 'INVALID_METRIC_LABEL',
    });
    expect(registry.increment('request_outcome_total', { status: 'COMPLETED' }, Number.NaN)).toMatchObject({
      outcome: 'degraded',
      safeReasonCode: 'INVALID_METRIC_VALUE',
    });
    expect(registry.observe('request_duration_seconds', { status: 'COMPLETED' }, -1)).toMatchObject({
      outcome: 'degraded',
      safeReasonCode: 'INVALID_METRIC_VALUE',
    });
    expect(registry.snapshot()).toEqual([]);
  });

  it('bounds recent-fact dedup at 16,384 keys with deterministic FIFO eviction', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    for (let index = 0; index < 16_384; index += 1) {
      expect(projector.project(requestAccepted(`timeline-${index}`)).outcome).toBe('emitted');
    }
    expect(projector.project(requestAccepted('timeline-0'))).toMatchObject({ outcome: 'skipped_policy_denied' });
    expect(projector.project(requestAccepted('timeline-new')).outcome).toBe('emitted');
    expect(projector.project(requestAccepted('timeline-0')).outcome).toBe('emitted');
    expect(registry.snapshot()).toHaveLength(16_386);
  });

  it('emits request_first_content_latency_seconds from REQUEST_FIRST_CONTENT_DELIVERED observation', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_FIRST_CONTENT_DELIVERED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
          durationMs: 150,
          stableRefs: { timelineEventId: 'timeline-first-content' },
        }),
      ).outcome,
    ).toBe('emitted');

    expect(registry.snapshot()).toEqual([
      expect.objectContaining({
        name: 'request_first_content_latency_seconds',
        kind: 'histogram',
        value: 0.15,
        labels: { outcome: 'success' },
      }),
    ]);
  });

  it('counts a model invocation only at terminal and emits token distribution and output rate', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    const started = modelObservation('MODEL_INVOCATION_STARTED', 'success', 'model-started');
    expect(projector.covers(started)).toBe(false);
    expect(projector.project(started)).toMatchObject({ outcome: 'skipped_not_covered' });
    expect(registry.snapshot()).toEqual([]);

    expect(
      projector.project(
        modelObservation('MODEL_INVOCATION_COMPLETED', 'success', 'model-completed', {
          durationMs: 2_400,
          firstContentLatencyMs: 400,
          usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
        }),
      ).outcome,
    ).toBe('emitted');

    expect(registry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'model_invocation_total', value: 1, labels: { outcome: 'success' } }),
        expect.objectContaining({ name: 'model_token_count', kind: 'histogram', value: 120, labels: { outcome: 'success', token_type: 'input' } }),
        expect.objectContaining({ name: 'model_token_count', kind: 'histogram', value: 80, labels: { outcome: 'success', token_type: 'output' } }),
        expect.objectContaining({ name: 'model_output_token_rate', kind: 'histogram', value: 40, labels: { outcome: 'success' } }),
      ]),
    );
    expect(registry.snapshot().filter((sample) => sample.name === 'model_invocation_total')).toHaveLength(1);
  });

  it('omits model output rate when timing inputs are incomplete or non-positive', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    projector.project(
      modelObservation('MODEL_INVOCATION_COMPLETED', 'success', 'model-no-rate', {
        durationMs: 400,
        firstContentLatencyMs: 400,
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    );

    expect(registry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'model_token_count', value: 5, labels: { outcome: 'success', token_type: 'output' } }),
      ]),
    );
    expect(registry.snapshot().some((sample) => sample.name === 'model_output_token_rate')).toBe(false);
  });

  it('counts authoritative timeout, model flow control, and failed request terminal facts', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    projector.project(modelObservation('MODEL_INVOCATION_FAILED', 'timeout', 'model-timeout'));
    projector.project(modelObservation('MODEL_INVOCATION_FAILED', 'failure', 'model-rate-limited', { safeReasonCode: 'MODEL_RATE_LIMITED' }));
    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(5) as EpochMillis,
        stableRefs: { timelineEventId: 'request-failed' },
      }),
    );

    expect(registry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operation_timeout_total', value: 1, labels: { boundary: 'model' } }),
        expect.objectContaining({ name: 'model_flow_control_total', value: 1, labels: {} }),
        expect.objectContaining({ name: 'request_abnormal_termination_total', value: 1, labels: {} }),
      ]),
    );
  });

  it('counts timeout once at each authoritative boundary and ignores free-text timeout wording', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(6) as EpochMillis,
        safeSummary: 'Request mentioned timeout without a canonical classification.',
        stableRefs: { timelineEventId: 'request-free-text-timeout' },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(7) as EpochMillis,
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'safeErrorCategory', value: 'TIMEOUT', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
        stableRefs: { timelineEventId: 'request-canonical-timeout' },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'capability_invocation',
        operation: 'CAPABILITY_TIMED_OUT',
        outcome: 'timeout',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(8) as EpochMillis,
        stableRefs: { timelineEventId: 'capability-timeout' },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'LOCAL_GATEWAY_CALL',
        outcome: 'timeout',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(9) as EpochMillis,
        stableRefs: { timelineEventId: 'gateway-timeout' },
      }),
    );

    expect(registry.snapshot().filter((sample) => sample.name === 'operation_timeout_total')).toEqual([
      expect.objectContaining({ labels: { boundary: 'request' } }),
      expect.objectContaining({ labels: { boundary: 'capability' } }),
      expect.objectContaining({ labels: { boundary: 'gateway' } }),
    ]);
  });

  it('projects queued duration and transition-sampled active concurrency', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);
    const transition = (operation: 'REQUEST_EXECUTION_STARTED' | 'REQUEST_EXECUTION_ENDED', activeCount: number, eventId: string) =>
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation,
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10) as EpochMillis,
        ...(operation === 'REQUEST_EXECUTION_STARTED' ? { durationMs: 250 } : {}),
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'activeCount', value: activeCount, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
        stableRefs: { timelineEventId: eventId },
      });

    projector.project(transition('REQUEST_EXECUTION_STARTED', 2, 'execution-entered'));
    projector.project(transition('REQUEST_EXECUTION_ENDED', 1, 'execution-left'));

    expect(registry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'request_phase_duration_seconds', value: 0.25, labels: { phase: 'queued', status: 'success' } }),
        expect.objectContaining({ name: 'request_active_concurrency', value: 2, labels: {} }),
        expect.objectContaining({ name: 'request_active_concurrency', value: 1, labels: {} }),
      ]),
    );
  });

  it('emits request token distribution from a complete terminal aggregate', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);

    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(6) as EpochMillis,
        usage: { inputTokens: 30, outputTokens: 12 },
        stableRefs: { timelineEventId: 'request-completed' },
      }),
    );

    expect(registry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'request_token_count', kind: 'histogram', value: 30, labels: { status: 'COMPLETED', token_type: 'input' } }),
        expect.objectContaining({ name: 'request_token_count', kind: 'histogram', value: 12, labels: { status: 'COMPLETED', token_type: 'output' } }),
      ]),
    );
  });
});

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-metric') as TenantId,
  subjectId: brand<string, 'SubjectId'>('subject-metric') as SubjectId,
  agentId: brand<string, 'AgentId'>('agent-metric') as AgentId,
  agentVersion: brand<string, 'AgentVersion'>('v1') as AgentVersion,
};

function requestAccepted(timelineEventId: string) {
  return createObservationEvent({
    boundary: 'request_lifecycle',
    operation: 'REQUEST_ACCEPTED',
    outcome: 'success',
    ownerScope,
    occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
    stableRefs: { timelineEventId },
  });
}

function modelObservation(
  operation: string,
  outcome: 'success' | 'failure' | 'timeout',
  timelineEventId: string,
  optional: {
    readonly durationMs?: number;
    readonly firstContentLatencyMs?: number;
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number };
    readonly safeReasonCode?: string;
  } = {},
) {
  return createObservationEvent({
    boundary: 'model_invocation',
    operation,
    outcome,
    ownerScope,
    occurredAt: brand<number, 'EpochMillis'>(2) as EpochMillis,
    ...optional,
    stableRefs: { timelineEventId },
  });
}
