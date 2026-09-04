export type MetricKind = 'counter' | 'histogram';

export type MetricName =
  | 'request_outcome_total'
  | 'request_duration_seconds'
  | 'request_phase_duration_seconds'
  | 'request_first_content_latency_seconds'
  | 'request_token_count'
  | 'request_active_concurrency'
  | 'request_abnormal_termination_total'
  | 'operation_timeout_total'
  | 'model_flow_control_total'
  | 'policy_decision_total'
  | 'model_invocation_total'
  | 'model_invocation_duration_seconds'
  | 'model_token_usage_total'
  | 'model_token_count'
  | 'model_output_token_rate'
  | 'model_ttft_seconds'
  | 'model_chunk_latency_seconds'
  | 'model_total_latency_seconds'
  | 'capability_invocation_total'
  | 'capability_invocation_duration_seconds'
  | 'attachment_intake_total'
  | 'attachment_intake_duration_seconds'
  | 'gateway_call_total'
  | 'gateway_call_duration_seconds'
  | 'observability_degradation_total'
  | 'projector_projection_total'
  | 'configuration_evaluation_total'
  | 'health_probe_total'
  | 'health_probe_duration_seconds';

interface MetricDescriptorBase {
  readonly name: MetricName;
  readonly unit: '1' | 's' | '{token}' | '{token}/s';
  readonly allowedLabels: Readonly<Record<string, readonly string[]>>;
  readonly valueSource: 'count' | 'duration_seconds' | 'token_count' | 'token_rate' | 'concurrency_count';
  readonly acquisitionSource: 'timeline' | 'typed_adapter' | 'projector_host' | 'health_evaluator' | 'configuration';
}

export interface CounterMetricDescriptor extends MetricDescriptorBase {
  readonly kind: 'counter';
}

export interface HistogramMetricDescriptor extends MetricDescriptorBase {
  readonly kind: 'histogram';
  readonly boundaries: readonly number[];
}

export type MetricDescriptor = CounterMetricDescriptor | HistogramMetricDescriptor;

export const SECONDS_HISTOGRAM_BOUNDARIES = Object.freeze([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]);
export const TOKEN_COUNT_HISTOGRAM_BOUNDARIES = Object.freeze([1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144]);
export const TOKEN_RATE_HISTOGRAM_BOUNDARIES = Object.freeze([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
export const CONCURRENCY_HISTOGRAM_BOUNDARIES = Object.freeze([0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);

const attachmentLabels = Object.freeze({
  outcome: Object.freeze(['accepted', 'rejected']),
  reason_code: Object.freeze([
    'NONE',
    'ATTACHMENT_VALIDATION_FAILED',
    'ATTACHMENT_AUTHORIZATION_FAILED',
    'ATTACHMENT_COUNT_EXCEEDED',
    'ATTACHMENT_EMPTY',
    'ATTACHMENT_TOO_LARGE',
    'ATTACHMENT_TYPE_UNSUPPORTED',
    'ATTACHMENT_TYPE_MISMATCH',
    'ATTACHMENT_READ_FAILED',
    'ATTACHMENT_STAGING_FAILED',
    'ATTACHMENT_INTAKE_TIMEOUT',
    'ATTACHMENT_BUDGET_EXCEEDED',
    'ATTACHMENT_DEPENDENCY_UNAVAILABLE',
  ]),
  size_bucket: Object.freeze(['none', 'small', 'medium', 'large']),
});
const modelOutcomeLabels = Object.freeze({
  outcome: Object.freeze(['success', 'failure', 'timeout', 'canceled', 'denied', 'degraded', 'no_first_token']),
});

export const METRIC_DESCRIPTORS: Readonly<Record<MetricName, MetricDescriptor>> = Object.freeze({
  request_outcome_total: descriptor(
    'request_outcome_total',
    'counter',
    '1',
    { status: ['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'] },
    'count',
    'timeline',
  ),
  request_duration_seconds: descriptor(
    'request_duration_seconds',
    'histogram',
    's',
    { status: ['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'] },
    'duration_seconds',
    'timeline',
  ),
  request_phase_duration_seconds: descriptor(
    'request_phase_duration_seconds',
    'histogram',
    's',
    { phase: ['accepted', 'queued', 'executing', 'terminal_commit'], status: ['success', 'failure', 'timeout', 'canceled', 'degraded'] },
    'duration_seconds',
    'timeline',
  ),
  request_first_content_latency_seconds: descriptor(
    'request_first_content_latency_seconds',
    'histogram',
    's',
    { outcome: ['success'] },
    'duration_seconds',
    'timeline',
  ),
  request_token_count: descriptor(
    'request_token_count',
    'histogram',
    '{token}',
    { token_type: ['input', 'output'], status: ['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'] },
    'token_count',
    'timeline',
    TOKEN_COUNT_HISTOGRAM_BOUNDARIES,
  ),
  request_active_concurrency: descriptor(
    'request_active_concurrency',
    'histogram',
    '1',
    {},
    'concurrency_count',
    'typed_adapter',
    CONCURRENCY_HISTOGRAM_BOUNDARIES,
  ),
  request_abnormal_termination_total: descriptor('request_abnormal_termination_total', 'counter', '1', {}, 'count', 'timeline'),
  operation_timeout_total: descriptor(
    'operation_timeout_total',
    'counter',
    '1',
    { boundary: ['request', 'model', 'capability', 'gateway'] },
    'count',
    'timeline',
  ),
  model_flow_control_total: descriptor('model_flow_control_total', 'counter', '1', {}, 'count', 'timeline'),
  policy_decision_total: descriptor(
    'policy_decision_total',
    'counter',
    '1',
    {
      operation_kind: ['CAPABILITY_INVOCATION', 'SANDBOX_EXECUTION', 'AUTHORIZATION_REQUEST', 'RECOVERY_REPLAY'],
      outcome: ['success', 'failure', 'denied', 'degraded'],
    },
    'count',
    'timeline',
  ),
  model_invocation_total: descriptor('model_invocation_total', 'counter', '1', modelOutcomeLabels, 'count', 'timeline'),
  model_invocation_duration_seconds: descriptor(
    'model_invocation_duration_seconds',
    'histogram',
    's',
    modelOutcomeLabels,
    'duration_seconds',
    'timeline',
  ),
  model_token_usage_total: descriptor(
    'model_token_usage_total',
    'counter',
    '{token}',
    { ...modelOutcomeLabels, token_type: ['input', 'output', 'total'] },
    'token_count',
    'timeline',
  ),
  model_token_count: descriptor(
    'model_token_count',
    'histogram',
    '{token}',
    { ...modelOutcomeLabels, token_type: ['input', 'output'] },
    'token_count',
    'timeline',
    TOKEN_COUNT_HISTOGRAM_BOUNDARIES,
  ),
  model_output_token_rate: descriptor(
    'model_output_token_rate',
    'histogram',
    '{token}/s',
    modelOutcomeLabels,
    'token_rate',
    'timeline',
    TOKEN_RATE_HISTOGRAM_BOUNDARIES,
  ),
  model_ttft_seconds: descriptor('model_ttft_seconds', 'histogram', 's', { outcome: ['success'] }, 'duration_seconds', 'typed_adapter'),
  model_chunk_latency_seconds: descriptor('model_chunk_latency_seconds', 'histogram', 's', {}, 'duration_seconds', 'typed_adapter'),
  model_total_latency_seconds: descriptor(
    'model_total_latency_seconds',
    'histogram',
    's',
    { outcome: ['success', 'failure', 'timeout', 'canceled', 'no_first_token'] },
    'duration_seconds',
    'typed_adapter',
  ),
  capability_invocation_total: descriptor(
    'capability_invocation_total',
    'counter',
    '1',
    { capability_kind: ['TOOL', 'SKILL', 'AGENT', 'WORKFLOW'], outcome: ['success', 'failure', 'timeout', 'canceled', 'denied', 'degraded'] },
    'count',
    'timeline',
  ),
  capability_invocation_duration_seconds: descriptor(
    'capability_invocation_duration_seconds',
    'histogram',
    's',
    { capability_kind: ['TOOL', 'SKILL', 'AGENT', 'WORKFLOW'], outcome: ['success', 'failure', 'timeout', 'canceled', 'denied', 'degraded'] },
    'duration_seconds',
    'timeline',
  ),
  attachment_intake_total: descriptor('attachment_intake_total', 'counter', '1', attachmentLabels, 'count', 'typed_adapter'),
  attachment_intake_duration_seconds: descriptor(
    'attachment_intake_duration_seconds',
    'histogram',
    's',
    attachmentLabels,
    'duration_seconds',
    'typed_adapter',
  ),
  gateway_call_total: descriptor(
    'gateway_call_total',
    'counter',
    '1',
    { gateway_category: ['local', 'remote', 'model_provider', 'content'], outcome: ['success', 'failure', 'timeout', 'degraded'] },
    'count',
    'typed_adapter',
  ),
  gateway_call_duration_seconds: descriptor(
    'gateway_call_duration_seconds',
    'histogram',
    's',
    { gateway_category: ['local', 'remote', 'model_provider', 'content'], outcome: ['success', 'failure', 'timeout', 'degraded'] },
    'duration_seconds',
    'typed_adapter',
  ),
  observability_degradation_total: descriptor(
    'observability_degradation_total',
    'counter',
    '1',
    {
      surface: ['LOG', 'AUDIT', 'METRIC', 'HEALTH', 'TRACE'],
      reason_code: [
        'PROJECTOR_FAILED',
        'SINK_WRITE_FAILED',
        'SINK_UNAVAILABLE',
        'REGISTRY_UNAVAILABLE',
        'SERIALIZATION_FAILURE',
        'SERIALIZATION_FAILED',
        'MISSING_REQUIRED_FIELDS',
        'INVALID_METRIC_LABEL',
        'INVALID_METRIC_VALUE',
      ],
    },
    'count',
    'projector_host',
  ),
  projector_projection_total: descriptor(
    'projector_projection_total',
    'counter',
    '1',
    {
      surface: ['LOG', 'AUDIT', 'METRIC', 'HEALTH', 'TRACE'],
      result: ['emitted', 'skipped_not_covered', 'skipped_policy_denied', 'degraded', 'failed_closed'],
    },
    'count',
    'projector_host',
  ),
  configuration_evaluation_total: descriptor(
    'configuration_evaluation_total',
    'counter',
    '1',
    { component: ['memory', 'capability_description_override'], outcome: ['success', 'failure', 'disabled', 'degraded'] },
    'count',
    'configuration',
  ),
  health_probe_total: descriptor(
    'health_probe_total',
    'counter',
    '1',
    {
      endpoint: ['primary', 'deep'],
      status: ['UP', 'DOWN', 'DEGRADED'],
      component: ['runtime_authority', 'gateway', 'model_provider', 'capability'],
    },
    'count',
    'health_evaluator',
  ),
  health_probe_duration_seconds: descriptor(
    'health_probe_duration_seconds',
    'histogram',
    's',
    {
      endpoint: ['primary', 'deep'],
      status: ['UP', 'DOWN', 'DEGRADED'],
      component: ['runtime_authority', 'gateway', 'model_provider', 'capability'],
    },
    'duration_seconds',
    'health_evaluator',
  ),
});

function descriptor(
  name: MetricName,
  kind: MetricKind,
  unit: MetricDescriptor['unit'],
  allowedLabels: MetricDescriptor['allowedLabels'],
  valueSource: MetricDescriptor['valueSource'],
  acquisitionSource: MetricDescriptor['acquisitionSource'],
  boundaries?: readonly number[],
): MetricDescriptor {
  const base = { name, unit, allowedLabels: Object.freeze(allowedLabels), valueSource, acquisitionSource };
  if (kind === 'histogram') {
    const histogramBoundaries = boundaries ?? SECONDS_HISTOGRAM_BOUNDARIES;
    if (
      histogramBoundaries.length === 0 ||
      histogramBoundaries.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value <= histogramBoundaries[index - 1]!))
    ) {
      throw new Error(`Invalid histogram boundaries for ${name}.`);
    }
    return Object.freeze({ ...base, kind, boundaries: Object.freeze([...histogramBoundaries]) });
  }
  return Object.freeze({ ...base, kind });
}
