import type { ObservabilityObservationEvent } from '../linking/observation.js';
import type { ObservabilityProjector, SurfaceProjectionResult } from '../linking/projector-host.js';
import { metrics, type Counter, type Histogram, type Meter } from '@opentelemetry/api';
import { METRIC_DESCRIPTORS, type MetricKind, type MetricName } from './metric-descriptors.js';

export type { MetricDescriptor, MetricKind, MetricName } from './metric-descriptors.js';
export {
  CONCURRENCY_HISTOGRAM_BOUNDARIES,
  METRIC_DESCRIPTORS,
  SECONDS_HISTOGRAM_BOUNDARIES,
  TOKEN_COUNT_HISTOGRAM_BOUNDARIES,
  TOKEN_RATE_HISTOGRAM_BOUNDARIES,
} from './metric-descriptors.js';

export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricSample {
  readonly name: MetricName;
  readonly kind: MetricKind;
  readonly value: number;
  readonly labels: MetricLabels;
  readonly occurredAt?: number;
  readonly dedupKey?: string;
}

export interface MetricsRegistry {
  increment: (name: MetricName, labels: MetricLabels, value?: number) => SurfaceProjectionResult;
  observe: (name: MetricName, labels: MetricLabels, value: number) => SurfaceProjectionResult;
}

export interface InMemoryMetricsRegistry extends MetricsRegistry {
  snapshot: () => readonly MetricSample[];
}

export interface MetricsRegistryOptions {
  readonly meter?: Meter;
}

export function createMetricsRegistry(options: MetricsRegistryOptions = {}): MetricsRegistry {
  const meter = options.meter ?? metrics.getMeter('nextagent-runtime', '1.0.0');
  const instruments = createMetricInstruments(meter);
  return {
    increment(name, labels, value = 1) {
      const invalid = validateMetricLabels(name, labels);
      if (invalid !== undefined) {
        return invalid;
      }
      return recordToInstrument(instruments, { name, kind: 'counter', labels: { ...labels }, value });
    },
    observe(name, labels, value) {
      const invalid = validateMetricLabels(name, labels);
      if (invalid !== undefined || !Number.isFinite(value) || value < 0) {
        return invalid ?? { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'INVALID_METRIC_VALUE' };
      }
      return recordToInstrument(instruments, { name, kind: 'histogram', labels: { ...labels }, value });
    },
  };
}

export function createInMemoryMetricsRegistry(): InMemoryMetricsRegistry {
  const samples: MetricSample[] = [];
  return {
    increment(name, labels, value = 1) {
      const invalid = validateMetric(name, 'counter', labels, value);
      if (invalid !== undefined) {
        return invalid;
      }
      samples.push({ name, kind: 'counter', labels: { ...labels }, value, occurredAt: Date.now() });
      return { surface: 'METRIC', outcome: 'emitted' };
    },
    observe(name, labels, value) {
      const invalid = validateMetric(name, 'histogram', labels, value);
      if (invalid !== undefined) {
        return invalid;
      }
      samples.push({ name, kind: 'histogram', labels: { ...labels }, value, occurredAt: Date.now() });
      return { surface: 'METRIC', outcome: 'emitted' };
    },
    snapshot: () => [...samples],
  };
}

export function validateMetricLabels(name: MetricName, labels: MetricLabels): SurfaceProjectionResult | undefined {
  const policy = METRIC_DESCRIPTORS[name].allowedLabels;
  const allowedKeys = Object.keys(policy);
  if (Object.keys(labels).some((key) => !allowedKeys.includes(key)) || allowedKeys.some((key) => labels[key] === undefined)) {
    return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'INVALID_METRIC_LABEL' };
  }
  for (const [key, allowedValues] of Object.entries(policy)) {
    const value = labels[key];
    if (value === undefined || !allowedValues.includes(value)) {
      return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'INVALID_METRIC_LABEL' };
    }
  }
  return undefined;
}

export class MetricsProjector implements ObservabilityProjector {
  readonly surface = 'METRIC' as const;
  private readonly emittedDedupKeys = new Set<string>();
  private readonly dedupOrder: string[] = [];

  constructor(private readonly registry?: MetricsRegistry) {}

  covers(event: ObservabilityObservationEvent): boolean {
    return metricSamplesForObservation(event).length > 0;
  }

  project(event: ObservabilityObservationEvent): SurfaceProjectionResult {
    if (this.registry === undefined) {
      return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'REGISTRY_UNAVAILABLE' };
    }
    const samples = metricSamplesForObservation(event);
    let last: SurfaceProjectionResult = { surface: 'METRIC', outcome: 'skipped_not_covered' };
    for (const sample of samples) {
      if (sample.dedupKey !== undefined && this.emittedDedupKeys.has(sample.dedupKey)) {
        last = { surface: 'METRIC', outcome: 'skipped_policy_denied', safeReasonCode: 'DUPLICATE_METRIC_SAMPLE' };
        continue;
      }
      last =
        sample.kind === 'counter'
          ? this.registry.increment(sample.name, sample.labels, sample.value)
          : this.registry.observe(sample.name, sample.labels, sample.value);
      if (last.outcome === 'emitted' && sample.dedupKey !== undefined) {
        if (this.dedupOrder.length >= 16_384) {
          const evicted = this.dedupOrder.shift();
          if (evicted !== undefined) {
            this.emittedDedupKeys.delete(evicted);
          }
        }
        this.emittedDedupKeys.add(sample.dedupKey);
        this.dedupOrder.push(sample.dedupKey);
      }
    }
    return last;
  }
}

export function createMetricsProjector(registry?: MetricsRegistry): MetricsProjector {
  return new MetricsProjector(registry);
}

type MetricInstrument = Counter | Histogram;

function createMetricInstruments(meter: Meter): ReadonlyMap<MetricName, MetricInstrument> {
  return new Map(
    Object.values(METRIC_DESCRIPTORS).map((descriptor) => [
      descriptor.name,
      descriptor.kind === 'counter'
        ? meter.createCounter(descriptor.name, { unit: descriptor.unit })
        : meter.createHistogram(descriptor.name, { unit: descriptor.unit }),
    ]),
  );
}

function recordToInstrument(
  instruments: ReadonlyMap<MetricName, MetricInstrument>,
  sample: Omit<MetricSample, 'occurredAt' | 'dedupKey'>,
): SurfaceProjectionResult {
  const invalid = validateMetric(sample.name, sample.kind, sample.labels, sample.value);
  if (invalid !== undefined) {
    return invalid;
  }
  try {
    const instrument = instruments.get(sample.name);
    if (instrument === undefined) {
      return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'REGISTRY_UNAVAILABLE' };
    }
    if (sample.kind === 'counter') {
      (instrument as Counter).add(sample.value, sample.labels);
    } else {
      (instrument as Histogram).record(sample.value, sample.labels);
    }
    return { surface: 'METRIC', outcome: 'emitted' };
  } catch {
    return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'SINK_WRITE_FAILED' };
  }
}

function validateMetric(name: MetricName, kind: MetricKind, labels: MetricLabels, value: number): SurfaceProjectionResult | undefined {
  if (METRIC_DESCRIPTORS[name].kind !== kind) {
    return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'INVALID_METRIC_VALUE' };
  }
  const invalid = validateMetricLabels(name, labels);
  if (invalid !== undefined) {
    return invalid;
  }
  if (!Number.isFinite(value) || value < 0) {
    return { surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'INVALID_METRIC_VALUE' };
  }
  return undefined;
}

function metricSamplesForObservation(event: ObservabilityObservationEvent): readonly MetricSample[] {
  if (event.boundary === 'request_lifecycle' && event.operation === 'REQUEST_ACCEPTED') {
    return [
      withMetricIdentity(event, {
        name: 'request_phase_duration_seconds',
        kind: 'histogram',
        value: 0,
        labels: { phase: 'accepted', status: 'success' },
      }),
    ];
  }
  if (event.boundary === 'request_lifecycle' && event.operation === 'REQUEST_FIRST_CONTENT_DELIVERED' && event.durationMs !== undefined) {
    return [
      withMetricIdentity(event, {
        name: 'request_first_content_latency_seconds',
        kind: 'histogram',
        value: event.durationMs / 1000,
        labels: { outcome: 'success' },
      }),
    ];
  }
  if (event.boundary === 'request_lifecycle' && (event.operation === 'REQUEST_EXECUTION_STARTED' || event.operation === 'REQUEST_EXECUTION_ENDED')) {
    const activeCount = diagnosticCandidateNumber(event, 'activeCount');
    return withMetricIdentities(event, [
      ...(event.operation === 'REQUEST_EXECUTION_STARTED' && event.durationMs !== undefined
        ? [
            {
              name: 'request_phase_duration_seconds' as const,
              kind: 'histogram' as const,
              value: event.durationMs / 1000,
              labels: { phase: 'queued', status: 'success' },
            },
          ]
        : []),
      ...(activeCount === undefined
        ? []
        : [{ name: 'request_active_concurrency' as const, kind: 'histogram' as const, value: activeCount, labels: {} }]),
    ]);
  }
  if (
    event.boundary === 'request_lifecycle' &&
    (event.operation === 'TERMINAL_COMMITTED' || event.operation === 'REQUEST_COMPLETED' || event.operation === 'REQUEST_FAILED')
  ) {
    const status = requestStatusFor(event);
    const phaseStatus = terminalPhaseStatus(status);
    return withMetricIdentities(event, [
      { name: 'request_outcome_total', kind: 'counter', value: 1, labels: { status } },
      ...(status === 'FAILED' ? [{ name: 'request_abnormal_termination_total' as const, kind: 'counter' as const, value: 1, labels: {} }] : []),
      ...(requestTerminalTimedOut(event)
        ? [{ name: 'operation_timeout_total' as const, kind: 'counter' as const, value: 1, labels: { boundary: 'request' } }]
        : []),
      ...(event.durationMs === undefined
        ? []
        : [{ name: 'request_duration_seconds' as const, kind: 'histogram' as const, value: event.durationMs / 1000, labels: { status } }]),
      ...(event.durationMs === undefined
        ? []
        : [
            {
              name: 'request_phase_duration_seconds' as const,
              kind: 'histogram' as const,
              value: event.durationMs / 1000,
              labels: { phase: 'terminal_commit', status: phaseStatus },
            },
          ]),
      ...requestUsageSamples(event, status),
    ]);
  }
  if (event.boundary === 'system' && policyMetricOperation(event.operation)) {
    const operation_kind = diagnosticCandidateValue(event, 'operationKind');
    if (operation_kind !== undefined && isPolicyOperationKind(operation_kind)) {
      return withMetricIdentities(event, [
        {
          name: 'policy_decision_total',
          kind: 'counter',
          value: 1,
          labels: { operation_kind, outcome: policyMetricOutcome(event.outcome) },
        },
      ]);
    }
  }
  if (event.boundary === 'system' && (event.operation === 'ATTACHMENT_ACCEPTED' || event.operation === 'ATTACHMENT_REJECTED')) {
    const outcome = event.operation === 'ATTACHMENT_ACCEPTED' ? 'accepted' : 'rejected';
    const reason_code = attachmentReasonCode(event);
    const size_bucket = attachmentSizeBucket(event);
    const labels = { outcome, reason_code, size_bucket };
    return withMetricIdentities(event, [
      { name: 'attachment_intake_total', kind: 'counter', value: 1, labels },
      ...(event.durationMs === undefined
        ? []
        : [{ name: 'attachment_intake_duration_seconds' as const, kind: 'histogram' as const, value: event.durationMs / 1000, labels }]),
    ]);
  }
  if (event.boundary === 'gateway_call') {
    const outcome =
      event.outcome === 'success' ? 'success' : event.outcome === 'timeout' ? 'timeout' : event.outcome === 'degraded' ? 'degraded' : 'failure';
    const labels = { gateway_category: 'local', outcome };
    return withMetricIdentities(event, [
      { name: 'gateway_call_total', kind: 'counter', value: 1, labels },
      ...(outcome === 'timeout'
        ? [{ name: 'operation_timeout_total' as const, kind: 'counter' as const, value: 1, labels: { boundary: 'gateway' } }]
        : []),
      ...(event.durationMs === undefined
        ? []
        : [{ name: 'gateway_call_duration_seconds' as const, kind: 'histogram' as const, value: event.durationMs / 1000, labels }]),
    ]);
  }
  if (event.boundary === 'model_invocation') {
    const streamSamples = modelStreamSamples(event);
    if (streamSamples.length > 0) {
      return streamSamples;
    }
    if (!modelTerminalOperation(event.operation)) {
      return [];
    }
    const outcome = modelMetricOutcome(event);
    const labels = { outcome };
    return withMetricIdentities(event, [
      { name: 'model_invocation_total', kind: 'counter', value: 1, labels },
      ...(outcome === 'timeout'
        ? [{ name: 'operation_timeout_total' as const, kind: 'counter' as const, value: 1, labels: { boundary: 'model' } }]
        : []),
      ...(event.safeReasonCode === 'MODEL_RATE_LIMITED'
        ? [{ name: 'model_flow_control_total' as const, kind: 'counter' as const, value: 1, labels: {} }]
        : []),
      ...(event.durationMs === undefined
        ? []
        : [{ name: 'model_invocation_duration_seconds' as const, kind: 'histogram' as const, value: event.durationMs / 1000, labels }]),
      ...modelUsageSamples(event, labels),
      ...modelOutputRateSamples(event, labels),
    ]);
  }
  if (event.boundary === 'capability_invocation' && capabilityMetricOperation(event.operation)) {
    const outcome = capabilityMetricOutcome(event.outcome);
    const labels = { capability_kind: 'TOOL', outcome };
    return withMetricIdentities(event, [
      { name: 'capability_invocation_total', kind: 'counter', value: 1, labels },
      ...(outcome === 'timeout'
        ? [{ name: 'operation_timeout_total' as const, kind: 'counter' as const, value: 1, labels: { boundary: 'capability' } }]
        : []),
      ...(event.durationMs === undefined
        ? []
        : [{ name: 'capability_invocation_duration_seconds' as const, kind: 'histogram' as const, value: event.durationMs / 1000, labels }]),
    ]);
  }
  return [];
}

function withMetricIdentities(
  event: ObservabilityObservationEvent,
  samples: ReadonlyArray<Omit<MetricSample, 'occurredAt' | 'dedupKey'>>,
): readonly MetricSample[] {
  return samples.map((sample) => withMetricIdentity(event, sample));
}

function withMetricIdentity(event: ObservabilityObservationEvent, sample: Omit<MetricSample, 'occurredAt' | 'dedupKey'>): MetricSample {
  const dedupKey = dedupKeyFor(event, sample);
  return {
    ...sample,
    occurredAt: Number(event.occurredAt),
    ...(dedupKey === undefined ? {} : { dedupKey }),
  };
}

function dedupKeyFor(event: ObservabilityObservationEvent, sample: Omit<MetricSample, 'occurredAt' | 'dedupKey'>): string | undefined {
  const stableFact =
    diagnosticCandidateValue(event, 'metricFactKey') ?? event.stableRefs?.capabilityInvocationId ?? event.stableRefs?.timelineEventId;
  return stableFact === undefined ? undefined : `${sample.name}:${JSON.stringify(sample.labels)}:${stableFact}`;
}

function capabilityMetricOperation(operation: string): boolean {
  return (
    operation === 'CAPABILITY_COMPLETED' ||
    operation === 'CAPABILITY_TIMED_OUT' ||
    operation === 'CAPABILITY_CANCELED' ||
    operation === 'CAPABILITY_DENIED' ||
    operation === 'CAPABILITY_SECURITY_FAILED' ||
    operation === 'CAPABILITY_POLICY_BLOCKED'
  );
}

function capabilityMetricOutcome(
  outcome: ObservabilityObservationEvent['outcome'],
): 'success' | 'failure' | 'timeout' | 'canceled' | 'denied' | 'degraded' {
  if (outcome === 'success' || outcome === 'timeout' || outcome === 'canceled' || outcome === 'denied' || outcome === 'degraded') {
    return outcome;
  }
  return 'failure';
}

function attachmentReasonCode(
  event: ObservabilityObservationEvent,
):
  | 'NONE'
  | 'ATTACHMENT_VALIDATION_FAILED'
  | 'ATTACHMENT_AUTHORIZATION_FAILED'
  | 'ATTACHMENT_COUNT_EXCEEDED'
  | 'ATTACHMENT_EMPTY'
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_TYPE_UNSUPPORTED'
  | 'ATTACHMENT_TYPE_MISMATCH'
  | 'ATTACHMENT_READ_FAILED'
  | 'ATTACHMENT_STAGING_FAILED'
  | 'ATTACHMENT_INTAKE_TIMEOUT'
  | 'ATTACHMENT_BUDGET_EXCEEDED'
  | 'ATTACHMENT_DEPENDENCY_UNAVAILABLE' {
  const value = event.safeReasonCode ?? diagnosticCandidateValue(event, 'reasonCode');
  if (
    value === 'ATTACHMENT_VALIDATION_FAILED' ||
    value === 'ATTACHMENT_AUTHORIZATION_FAILED' ||
    value === 'ATTACHMENT_COUNT_EXCEEDED' ||
    value === 'ATTACHMENT_EMPTY' ||
    value === 'ATTACHMENT_TOO_LARGE' ||
    value === 'ATTACHMENT_TYPE_UNSUPPORTED' ||
    value === 'ATTACHMENT_TYPE_MISMATCH' ||
    value === 'ATTACHMENT_READ_FAILED' ||
    value === 'ATTACHMENT_STAGING_FAILED' ||
    value === 'ATTACHMENT_INTAKE_TIMEOUT' ||
    value === 'ATTACHMENT_BUDGET_EXCEEDED' ||
    value === 'ATTACHMENT_DEPENDENCY_UNAVAILABLE'
  ) {
    return value;
  }
  return 'NONE';
}

function attachmentSizeBucket(event: ObservabilityObservationEvent): 'none' | 'small' | 'medium' | 'large' {
  const value = diagnosticCandidateValue(event, 'sizeBucket');
  if (value === 'none' || value === 'small' || value === 'medium' || value === 'large') {
    return value;
  }
  return 'none';
}

function policyMetricOperation(operation: string): boolean {
  return operation === 'POLICY_ALLOWED' || operation === 'POLICY_DENIED' || operation === 'POLICY_FAILED';
}

function isPolicyOperationKind(value: string): value is 'CAPABILITY_INVOCATION' | 'SANDBOX_EXECUTION' | 'AUTHORIZATION_REQUEST' | 'RECOVERY_REPLAY' {
  return value === 'CAPABILITY_INVOCATION' || value === 'SANDBOX_EXECUTION' || value === 'AUTHORIZATION_REQUEST' || value === 'RECOVERY_REPLAY';
}

function policyMetricOutcome(outcome: ObservabilityObservationEvent['outcome']): 'success' | 'failure' | 'denied' | 'degraded' {
  if (outcome === 'success' || outcome === 'denied' || outcome === 'degraded') {
    return outcome;
  }
  return 'failure';
}

function modelUsageSamples(
  event: ObservabilityObservationEvent,
  labels: {
    readonly outcome: 'success' | 'failure' | 'timeout' | 'canceled' | 'denied' | 'degraded' | 'no_first_token';
  },
): ReadonlyArray<Omit<MetricSample, 'occurredAt' | 'dedupKey'>> {
  return [
    ...(event.usage?.inputTokens === undefined
      ? []
      : [
          {
            name: 'model_token_usage_total' as const,
            kind: 'counter' as const,
            value: event.usage.inputTokens,
            labels: { ...labels, token_type: 'input' },
          },
          {
            name: 'model_token_count' as const,
            kind: 'histogram' as const,
            value: event.usage.inputTokens,
            labels: { ...labels, token_type: 'input' },
          },
        ]),
    ...(event.usage?.outputTokens === undefined
      ? []
      : [
          {
            name: 'model_token_usage_total' as const,
            kind: 'counter' as const,
            value: event.usage.outputTokens,
            labels: { ...labels, token_type: 'output' },
          },
          {
            name: 'model_token_count' as const,
            kind: 'histogram' as const,
            value: event.usage.outputTokens,
            labels: { ...labels, token_type: 'output' },
          },
        ]),
    ...(event.usage?.totalTokens === undefined
      ? []
      : [
          {
            name: 'model_token_usage_total' as const,
            kind: 'counter' as const,
            value: event.usage.totalTokens,
            labels: { ...labels, token_type: 'total' },
          },
        ]),
  ];
}

function modelOutputRateSamples(
  event: ObservabilityObservationEvent,
  labels: {
    readonly outcome: 'success' | 'failure' | 'timeout' | 'canceled' | 'denied' | 'degraded' | 'no_first_token';
  },
): ReadonlyArray<Omit<MetricSample, 'occurredAt' | 'dedupKey'>> {
  const outputTokens = event.usage?.outputTokens;
  const durationMs = event.durationMs;
  const firstContentLatencyMs = event.firstContentLatencyMs;
  if (outputTokens === undefined || durationMs === undefined || firstContentLatencyMs === undefined || durationMs <= firstContentLatencyMs) {
    return [];
  }
  return [
    {
      name: 'model_output_token_rate',
      kind: 'histogram',
      value: outputTokens / ((durationMs - firstContentLatencyMs) / 1000),
      labels,
    },
  ];
}

function requestUsageSamples(
  event: ObservabilityObservationEvent,
  status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED',
): ReadonlyArray<Omit<MetricSample, 'occurredAt' | 'dedupKey'>> {
  return [
    ...(event.usage?.inputTokens === undefined
      ? []
      : [
          {
            name: 'request_token_count' as const,
            kind: 'histogram' as const,
            value: event.usage.inputTokens,
            labels: { token_type: 'input', status },
          },
        ]),
    ...(event.usage?.outputTokens === undefined
      ? []
      : [
          {
            name: 'request_token_count' as const,
            kind: 'histogram' as const,
            value: event.usage.outputTokens,
            labels: { token_type: 'output', status },
          },
        ]),
  ];
}

function diagnosticCandidateValue(event: ObservabilityObservationEvent, key: string): string | undefined {
  const value = event.diagnosticSnapshot?.diagnosticCandidates?.find((candidate) => candidate.key === key)?.value;
  return typeof value === 'string' ? value : undefined;
}

function diagnosticCandidateNumber(event: ObservabilityObservationEvent, key: string): number | undefined {
  const value = event.diagnosticSnapshot?.diagnosticCandidates?.find((candidate) => candidate.key === key)?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function requestTerminalTimedOut(event: ObservabilityObservationEvent): boolean {
  return (
    diagnosticCandidateValue(event, 'safeErrorCategory') === 'TIMEOUT' || diagnosticCandidateValue(event, 'safeErrorCode') === 'PENDING_INPUT_TIMEOUT'
  );
}

function modelTerminalOperation(operation: string): boolean {
  return (
    operation === 'MODEL_INVOCATION_COMPLETED' ||
    operation === 'MODEL_INVOCATION_FAILED' ||
    operation === 'MODEL_CREDENTIAL_FAILED' ||
    operation === 'MODEL_QUOTA_FAILED' ||
    operation === 'MODEL_SECURITY_FAILED'
  );
}

function modelStreamSamples(event: ObservabilityObservationEvent): readonly MetricSample[] {
  if (event.operation === 'MODEL_STREAM_FIRST_VISIBLE_CONTENT' && event.durationMs !== undefined) {
    return [
      withMetricIdentity(event, { name: 'model_ttft_seconds', kind: 'histogram', value: event.durationMs / 1000, labels: { outcome: 'success' } }),
    ];
  }
  if (event.operation === 'MODEL_STREAM_VISIBLE_CHUNK' && event.durationMs !== undefined) {
    return [withMetricIdentity(event, { name: 'model_chunk_latency_seconds', kind: 'histogram', value: event.durationMs / 1000, labels: {} })];
  }
  if (
    (event.operation === 'MODEL_STREAM_COMPLETED' ||
      event.operation === 'MODEL_STREAM_FAILED' ||
      event.operation === 'MODEL_STREAM_NO_FIRST_TOKEN') &&
    event.durationMs !== undefined
  ) {
    const outcome = event.operation === 'MODEL_STREAM_NO_FIRST_TOKEN' ? 'no_first_token' : modelTotalLatencyOutcome(event);
    return [
      withMetricIdentity(event, { name: 'model_total_latency_seconds', kind: 'histogram', value: event.durationMs / 1000, labels: { outcome } }),
    ];
  }
  return [];
}

function modelMetricOutcome(
  event: ObservabilityObservationEvent,
): 'success' | 'failure' | 'timeout' | 'canceled' | 'denied' | 'degraded' | 'no_first_token' {
  if (event.operation === 'MODEL_STREAM_NO_FIRST_TOKEN') {
    return 'no_first_token';
  }
  if (
    event.outcome === 'success' ||
    event.outcome === 'timeout' ||
    event.outcome === 'canceled' ||
    event.outcome === 'denied' ||
    event.outcome === 'degraded'
  ) {
    return event.outcome;
  }
  return 'failure';
}

function modelTotalLatencyOutcome(event: ObservabilityObservationEvent): 'success' | 'failure' | 'timeout' | 'canceled' | 'no_first_token' {
  if (event.outcome === 'success' || event.outcome === 'timeout' || event.outcome === 'canceled') {
    return event.outcome;
  }
  return 'failure';
}

function requestStatusFor(event: ObservabilityObservationEvent): 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED' {
  if (event.safeReasonCode === 'TERMINAL_SUPERSEDED') {
    return 'SUPERSEDED';
  }
  if (event.outcome === 'success') {
    return 'COMPLETED';
  }
  if (event.outcome === 'canceled') {
    return 'CANCELED';
  }
  return 'FAILED';
}

function terminalPhaseStatus(status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'): 'success' | 'failure' | 'canceled' {
  return status === 'COMPLETED' ? 'success' : status === 'CANCELED' || status === 'SUPERSEDED' ? 'canceled' : 'failure';
}
