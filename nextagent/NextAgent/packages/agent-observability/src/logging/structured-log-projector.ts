import type { JsonObject, JsonValue, RuntimeLogger } from '@nextagent/agent-common';
import type { ObservabilityObservationEvent, ObservationModelUsage } from '../linking/observation.js';
import { isDiagnosticCandidateProjectable } from '../linking/diagnostic-projection-policy.js';
import type { ObservabilityProjector, SurfaceProjectionResult } from '../linking/projector-host.js';
import { localLogCorrelationFor } from './local-log-correlation.js';

export type StructuredLogEvent = string;

export interface StructuredLogEntry {
  readonly occurredAt: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly event: StructuredLogEvent;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly timelineEventId?: string;
  readonly capabilityInvocationId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly safeReasonCode?: string;
  readonly details?: JsonObject;
  readonly durationMs?: number;
  readonly firstContentLatencyMs?: number;
  readonly usage?: ObservationModelUsage;
  readonly status?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  readonly summaryStatus?: 'COMPLETE' | 'PARTIAL';
  readonly toolCallCount?: number;
  readonly diagnostic?: JsonObject;
}

export interface StructuredLogProjectorOptions {
  readonly diagnosticDetail?: 'normal' | 'debug';
}

const EXCLUDED_DETAIL_KEYS = new Set([
  'tenantId',
  'subjectId',
  'agentId',
  'agentVersion',
  'sessionId',
  'requestId',
  'requestRunId',
  'requestContextId',
  'messageId',
  'timelineEventId',
  'capabilityInvocationId',
  'toolCallId',
  'stepId',
  'operation',
  'outcome',
  'reasonCode',
]);
const BOUNDED_ARRAY_DETAIL_KEYS = new Set([
  'disclosedCapabilityNames',
  'resolvedToolNames',
  'validatedArgumentNames',
  'validatedResultFieldNames',
  'generatedMessageKinds',
  'contextPatchFields',
]);

export class StructuredLogProjector implements ObservabilityProjector {
  readonly surface = 'LOG' as const;
  private readonly requestSummaries = new Map<string, RequestLogSummaryAccumulator>();

  constructor(
    private readonly logger: RuntimeLogger | undefined,
    private readonly options: Required<StructuredLogProjectorOptions> = { diagnosticDetail: 'normal' },
  ) {}

  covers(event: ObservabilityObservationEvent): boolean {
    return mapEvent(event) !== undefined;
  }

  onObservationDropped(event: ObservabilityObservationEvent): void {
    const runId = event.stableRefs?.requestRunId;
    if (runId === undefined) {
      return;
    }
    const summary = this.summaryFor(runId);
    summary.continuous = false;
    summary.dropped = true;
  }

  project(event: ObservabilityObservationEvent): SurfaceProjectionResult {
    const logEvent = mapEvent(event);
    if (logEvent === undefined) {
      return { surface: 'LOG', outcome: 'skipped_not_covered' };
    }
    if (this.logger === undefined) {
      return { surface: 'LOG', outcome: 'degraded', safeReasonCode: 'SINK_UNAVAILABLE' };
    }
    try {
      const terminalSummary = this.recordSummary(event);
      const entry = { ...toStructuredLogEntry(logEvent, event, this.options), ...terminalSummary };
      const { level, ...fields } = entry;
      this.logger[level](fields);
      return { surface: 'LOG', outcome: 'emitted' };
    } catch {
      return { surface: 'LOG', outcome: 'degraded', safeReasonCode: 'SERIALIZATION_FAILURE' };
    }
  }

  private recordSummary(event: ObservabilityObservationEvent): RequestTerminalLogSummary | undefined {
    const runId = event.stableRefs?.requestRunId;
    if (runId === undefined) {
      return undefined;
    }
    const summary = this.summaryFor(runId);
    const timelineEventId = event.stableRefs?.timelineEventId;
    if (timelineEventId !== undefined && summary.timelineEventIds.has(timelineEventId)) {
      return event.operation === 'TERMINAL_COMMITTED' ? this.finishSummary(runId, event, summary) : undefined;
    }
    if (timelineEventId !== undefined) {
      summary.timelineEventIds.add(timelineEventId);
    }

    if (event.operation === 'REQUEST_ACCEPTED') {
      if (summary.seenAny) {
        summary.continuous = false;
      }
      summary.accepted = true;
    } else if (event.operation === 'MODEL_INVOCATION_STARTED') {
      const stepId = diagnosticString(event, 'stepId');
      if (stepId === undefined) {
        summary.continuous = false;
      } else {
        summary.openModelSteps.add(stepId);
      }
    } else if (event.boundary === 'model_invocation' && isModelTerminal(event.operation)) {
      const stepId = diagnosticString(event, 'stepId');
      if (stepId === undefined || !summary.openModelSteps.delete(stepId)) {
        summary.continuous = false;
      }
      this.addModelUsage(summary, event.usage, event.outcome === 'success');
    } else if (event.operation === 'CAPABILITY_STARTED') {
      const invocationId = event.stableRefs?.capabilityInvocationId;
      if (invocationId === undefined) {
        summary.continuous = false;
      } else {
        summary.capabilityInvocationIds.add(invocationId);
      }
    }
    summary.seenAny = true;
    return event.operation === 'TERMINAL_COMMITTED' ? this.finishSummary(runId, event, summary) : undefined;
  }

  private summaryFor(runId: string): RequestLogSummaryAccumulator {
    const existing = this.requestSummaries.get(runId);
    if (existing !== undefined) {
      return existing;
    }
    if (this.requestSummaries.size >= 1_024) {
      const oldest = this.requestSummaries.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        this.requestSummaries.delete(oldest);
      }
    }
    const created: RequestLogSummaryAccumulator = {
      accepted: false,
      seenAny: false,
      continuous: true,
      dropped: false,
      usageComplete: true,
      usage: {},
      openModelSteps: new Set(),
      capabilityInvocationIds: new Set(),
      timelineEventIds: new Set(),
    };
    this.requestSummaries.set(runId, created);
    return created;
  }

  private addModelUsage(summary: RequestLogSummaryAccumulator, usage: ObservationModelUsage | undefined, completeUsageRequired: boolean): void {
    if (completeUsageRequired && !hasCompleteUsage(usage)) {
      summary.usageComplete = false;
    }
    if (usage === undefined) {
      return;
    }
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const value = usage[key];
      if (value !== undefined) {
        summary.usage[key] = (summary.usage[key] ?? 0) + value;
      }
    }
  }

  private finishSummary(runId: string, event: ObservabilityObservationEvent, summary: RequestLogSummaryAccumulator): RequestTerminalLogSummary {
    this.requestSummaries.delete(runId);
    const usage = Object.keys(summary.usage).length === 0 ? undefined : { ...summary.usage };
    const toolCountKnown = summary.accepted && !summary.dropped;
    const complete = summary.accepted && summary.continuous && !summary.dropped && summary.usageComplete && summary.openModelSteps.size === 0;
    return {
      status: event.outcome === 'success' ? 'SUCCEEDED' : event.outcome === 'canceled' ? 'CANCELED' : 'FAILED',
      ...(complete ? {} : { summaryStatus: 'PARTIAL' }),
      ...(usage === undefined ? {} : { usage }),
      ...(toolCountKnown ? { toolCallCount: summary.capabilityInvocationIds.size } : {}),
    };
  }
}

interface RequestLogSummaryAccumulator {
  accepted: boolean;
  seenAny: boolean;
  continuous: boolean;
  dropped: boolean;
  usageComplete: boolean;
  readonly usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  readonly openModelSteps: Set<string>;
  readonly capabilityInvocationIds: Set<string>;
  readonly timelineEventIds: Set<string>;
}

interface RequestTerminalLogSummary {
  readonly status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  readonly summaryStatus?: 'PARTIAL';
  readonly usage?: ObservationModelUsage;
  readonly toolCallCount?: number;
}

function hasCompleteUsage(usage?: ObservationModelUsage): usage is Required<ObservationModelUsage> {
  return usage?.inputTokens !== undefined && usage.outputTokens !== undefined && usage.totalTokens !== undefined;
}

function isModelTerminal(operation: string): boolean {
  return operation === 'MODEL_INVOCATION_COMPLETED' || operation.endsWith('_FAILED');
}

function diagnosticString(event: ObservabilityObservationEvent, key: string): string | undefined {
  const value = diagnosticValue(event, key);
  return typeof value === 'string' ? value : undefined;
}

export function createStructuredLogProjector(logger?: RuntimeLogger, options?: StructuredLogProjectorOptions): StructuredLogProjector {
  return new StructuredLogProjector(logger, {
    diagnosticDetail: options?.diagnosticDetail ?? 'normal',
  });
}

export function toStructuredLogEntry(
  event: StructuredLogEvent,
  observation: ObservabilityObservationEvent,
  options: Required<StructuredLogProjectorOptions> = { diagnosticDetail: 'normal' },
): StructuredLogEntry {
  const details = detailsFor(event, observation);
  const refs = observation.stableRefs;
  const stepId = diagnosticValue(observation, 'stepId');
  const correlation = localLogCorrelationFor(observation);
  const safeReasonCode = safeReasonCodeFor(event, observation);
  return {
    occurredAt: new Date(Number(observation.occurredAt)).toISOString(),
    level: levelFor(event, observation),
    event,
    agentId: observation.ownerScope.agentId,
    agentVersion: observation.ownerScope.agentVersion,
    ...(refs?.sessionId === undefined ? {} : { sessionId: refs.sessionId }),
    ...(refs?.requestId === undefined ? {} : { requestId: refs.requestId }),
    ...(refs?.requestRunId === undefined ? {} : { runId: refs.requestRunId }),
    ...(typeof stepId !== 'string' ? {} : { stepId }),
    ...(refs?.timelineEventId === undefined ? {} : { timelineEventId: refs.timelineEventId }),
    ...(refs?.capabilityInvocationId === undefined ? {} : { capabilityInvocationId: refs.capabilityInvocationId }),
    ...(correlation === undefined ? {} : correlation),
    ...(safeReasonCode === undefined ? {} : { safeReasonCode }),
    ...(Object.keys(details).length === 0 ? {} : { details }),
    ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
    ...(observation.firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs: observation.firstContentLatencyMs }),
    ...(observation.usage === undefined ? {} : { usage: observation.usage }),
    ...(options.diagnosticDetail === 'debug' ? debugDetailsFor(observation) : {}),
  };
}

function lowCardinalityDiagnosticState(observation: ObservabilityObservationEvent): JsonObject {
  const state: Record<string, JsonValue> = {};
  for (const candidate of observation.diagnosticSnapshot?.diagnosticCandidates ?? []) {
    if (
      !EXCLUDED_DETAIL_KEYS.has(candidate.key) &&
      isDiagnosticCandidateProjectable(observation.boundary, observation.operation, candidate.key) &&
      (candidate.classification === 'LOW_CARDINALITY' || candidate.classification === 'SAFE') &&
      candidate.cardinality === 'LOW' &&
      (!Array.isArray(candidate.value) || isSafeBoundedArray(candidate.key, candidate.value))
    ) {
      state[candidate.key] = Array.isArray(candidate.value) ? [...candidate.value] : candidate.value;
    }
  }
  return state;
}

function detailsFor(logEvent: StructuredLogEvent, observation: ObservabilityObservationEvent): JsonObject {
  const details = lowCardinalityDiagnosticState(observation);
  if (logEvent !== 'request.completed') {
    return details;
  }
  const { persistence: _persistence, terminalStatus: _terminalStatus, ...remaining } = details;
  return remaining;
}

function safeReasonCodeFor(logEvent: StructuredLogEvent, observation: ObservabilityObservationEvent): string | undefined {
  return logEvent === 'request.completed' && observation.safeReasonCode === 'TERMINAL_COMPLETED' ? undefined : observation.safeReasonCode;
}

function isSafeBoundedArray(key: string, value: readonly unknown[]): value is readonly string[] {
  return (
    BOUNDED_ARRAY_DETAIL_KEYS.has(key) &&
    value.length <= 100 &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <= 4_096 &&
    value.every((item) => typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(item))
  );
}

function debugDetailsFor(observation: ObservabilityObservationEvent): { readonly diagnostic: JsonObject } | {} {
  const candidates = debugCandidates(observation);
  const diagnostic = {
    ...(candidates.length === 0 ? {} : { candidates }),
  } satisfies JsonObject;
  return Object.keys(diagnostic).length === 0 ? {} : { diagnostic };
}

function debugCandidates(observation: ObservabilityObservationEvent): readonly string[] {
  return (observation.diagnosticSnapshot?.diagnosticCandidates ?? [])
    .filter(
      (candidate) =>
        !EXCLUDED_DETAIL_KEYS.has(candidate.key) &&
        isDiagnosticCandidateProjectable(observation.boundary, observation.operation, candidate.key) &&
        (candidate.classification === 'LOW_CARDINALITY' || candidate.classification === 'SAFE') &&
        candidate.cardinality === 'LOW' &&
        !Array.isArray(candidate.value),
    )
    .map((candidate) => `${candidate.key}=${String(candidate.value)} [${candidate.classification}/${candidate.cardinality}]`);
}

function mapEvent(event: ObservabilityObservationEvent): StructuredLogEvent | undefined {
  if (event.boundary === 'health_probe') {
    return undefined;
  }
  if (event.operation === 'TERMINAL_COMMITTED') {
    return event.outcome === 'success' ? 'request.completed' : event.outcome === 'canceled' ? 'request.canceled' : 'request.failed';
  }
  if (event.operation === 'POLICY_APPLIED') {
    return event.outcome === 'success'
      ? 'policy.allowed'
      : event.outcome === 'denied'
        ? 'policy.denied'
        : event.outcome === 'degraded'
          ? 'policy.degraded'
          : 'policy.failed';
  }
  if (event.operation === 'HOOK_INVOKED') {
    return event.outcome === 'success'
      ? 'hook.completed'
      : event.outcome === 'timeout'
        ? 'hook.timed_out'
        : event.outcome === 'canceled'
          ? 'hook.canceled'
          : 'hook.failed';
  }
  if (event.operation === 'MODEL_STREAM_FIRST_VISIBLE_CONTENT') {
    return 'model.stream.first_visible_content';
  }
  if (event.operation === 'REQUEST_FIRST_CONTENT_DELIVERED') {
    return 'request.first_content_delivered';
  }
  if (event.operation === 'TASK_TRAJECTORY_BUILD') {
    const status = diagnosticValue(event, 'status');
    if (status === 'ENQUEUED') {
      return 'task.trajectory.build.enqueued';
    }
    if (status === 'BUILT') {
      return 'task.trajectory.build.completed';
    }
    if (status === 'SKIPPED') {
      return 'task.trajectory.build.skipped';
    }
    if (status === 'DROPPED') {
      return 'task.trajectory.build.dropped';
    }
    return 'task.trajectory.build.failed';
  }
  return event.operation.toLowerCase().replaceAll('_', '.');
}

function levelFor(logEvent: StructuredLogEvent, event: ObservabilityObservationEvent): StructuredLogEntry['level'] {
  if (
    logEvent === 'task.trajectory.build.enqueued' ||
    logEvent === 'task.trajectory.build.completed' ||
    logEvent === 'task.trajectory.build.skipped'
  ) {
    return 'debug';
  }
  if (logEvent === 'task.trajectory.build.dropped') {
    return 'warn';
  }
  if (
    logEvent === 'hook.completed' &&
    event.outcome === 'success' &&
    diagnosticValue(event, 'status') === 'SUCCESS' &&
    diagnosticValue(event, 'executionStrategy') === 'OBSERVE_PARALLEL'
  ) {
    return 'debug';
  }
  if (event.outcome === 'failure' || event.outcome === 'timeout') {
    return 'error';
  }
  if (event.outcome === 'degraded' || event.outcome === 'denied') {
    return 'warn';
  }
  return 'info';
}

function diagnosticValue(event: ObservabilityObservationEvent, key: string): JsonValue | undefined {
  return event.diagnosticSnapshot?.diagnosticCandidates?.find((candidate) => candidate.key === key)?.value;
}
