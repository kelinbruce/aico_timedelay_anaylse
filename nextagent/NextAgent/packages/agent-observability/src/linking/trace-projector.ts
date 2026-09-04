import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Link,
  type SpanContext,
  type Tracer,
} from '@opentelemetry/api';
import { getLogger } from '@nextagent/agent-common';
import { isDiagnosticCandidateProjectable } from './diagnostic-projection-policy.js';
import type { TimelineSpanRegistryView } from './timeline-span-lifecycle.js';
import type { ObservabilityObservationEvent } from './observation.js';
import type { ObservabilityProjector, SurfaceProjectionResult } from './projector-host.js';

const logger = getLogger({ component: 'agent-observability', source: 'trace-projector' });

const REQUEST_DIAGNOSTIC_OPERATIONS = new Set([
  'REQUEST_REJECTED',
  'TERMINAL_COMMITTED',
  'TERMINAL_FAILED',
  'REQUEST_CONTROL_REJECTED',
  'PENDING_INPUT_REJECTED',
  'POLICY_APPLIED',
]);

const SYSTEM_TRACE_OPERATIONS = new Set([
  'HOOK_INVOKED',
  'HOOK_COMPLETED',
  'HOOK_FAILED',
  'POLICY_EVALUATED',
  'POLICY_ALLOWED',
  'POLICY_DENIED',
  'POLICY_FAILED',
  'ATTACHMENT_ACCEPTED',
  'ATTACHMENT_REJECTED',
  'ROUTING_DECISION',
  'SAFE_ERROR_EMITTED',
  'APP_SHUTDOWN',
  'MEMORY_CONFIG_EVALUATED',
  'MEMORY_DESCRIPTION_OVERRIDE_EVALUATED',
]);

const GATEWAY_TRACE_OPERATIONS = new Set([
  'SANDBOX_EXECUTION_STARTED',
  'SANDBOX_EXECUTION_COMPLETED',
  'SANDBOX_EXECUTION_FAILED',
  'SANDBOX_EXECUTION_DENIED',
  'SANDBOX_EXECUTION_TIMED_OUT',
]);

export interface TraceProjectorOptions {
  readonly tracer?: Tracer;
  readonly tracerName?: string;
  readonly timelineSpanRegistry?: TimelineSpanRegistryView;
}

export class TraceProjector implements ObservabilityProjector {
  readonly surface = 'TRACE' as const;
  private readonly tracer: Tracer;
  private timelineSpanRegistry?: TimelineSpanRegistryView | undefined;

  constructor(options: TraceProjectorOptions = {}) {
    this.tracer = options.tracer ?? trace.getTracer(options.tracerName ?? 'nextagent-observability');
    this.timelineSpanRegistry = options.timelineSpanRegistry;
  }

  bindTimelineSpanRegistry(registry: TimelineSpanRegistryView): void {
    this.timelineSpanRegistry = registry;
  }

  covers(event: ObservabilityObservationEvent): boolean {
    return event.spanOwner !== 'TIMELINE_LIFECYCLE' && traceSpanNameFor(event) !== undefined;
  }

  project(event: ObservabilityObservationEvent): SurfaceProjectionResult {
    const spanName = traceSpanNameFor(event);
    if (event.spanOwner === 'TIMELINE_LIFECYCLE' || spanName === undefined) {
      return { surface: 'TRACE', outcome: 'skipped_not_covered' };
    }
    const parentContext = this.parentContext(event);
    if (parentContext === undefined) {
      return {
        surface: 'TRACE',
        outcome: 'degraded',
        safeReasonCode: 'REQUEST_TRACE_CONTEXT_UNAVAILABLE',
      };
    }
    try {
      const occurredAt = Number(event.occurredAt);
      const startedAt = occurredAt - Math.max(0, event.durationMs ?? 0);
      const span = this.tracer.startSpan(
        spanName,
        {
          startTime: startedAt,
          attributes: traceAttributesFor(event),
          links: traceLinksFor(event),
          kind: SpanKind.INTERNAL,
        },
        parentContext,
      );
      // Workaround: OTel SDK may not propagate parentSpanId from context in some environments.
      // Use setAttribute instead of Object.defineProperty, which gets overwritten during export.
      {
        const parentSpanCtx = trace.getSpanContext(parentContext);
        if (parentSpanCtx !== undefined) {
          span.setAttribute('_internal.parentSpanId', parentSpanCtx.spanId);
        }
      }
      span.setStatus(traceStatusFor(event));
      span.addEvent('observability.authoritative_fact', spanEventAttributesFor(event), occurredAt);
      const spanContext = span.spanContext();
      span.end(occurredAt);
      logger.debug({
        event: 'trace.span.emitted',
        spanId: spanContext.spanId,
        requestRunId: event.stableRefs?.requestRunId,
      });
      return { surface: 'TRACE', outcome: 'emitted' };
    } catch (error) {
      logger.error({
        err: error,
        event: 'trace.projection.exception_captured',
        failureStage: 'span_projection',
        runId: event.stableRefs?.requestRunId,
      });
      return { surface: 'TRACE', outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' };
    }
  }

  private parentContext(event: ObservabilityObservationEvent): Context | undefined {
    const requestRunId = event.stableRefs?.requestRunId;
    const requestSpanContext = requestRunId === undefined ? undefined : this.timelineSpanRegistry?.requestSpanContext(requestRunId);
    if (requestSpanContext !== undefined) {
      return trace.setSpanContext(ROOT_CONTEXT, requestSpanContext);
    }
    return event.boundary === 'request_lifecycle' ? ROOT_CONTEXT : undefined;
  }
}

export function createTraceProjector(options: TraceProjectorOptions = {}): TraceProjector {
  return new TraceProjector(options);
}

function traceSpanNameFor(event: ObservabilityObservationEvent): string | undefined {
  if (event.boundary === 'request_lifecycle' && REQUEST_DIAGNOSTIC_OPERATIONS.has(event.operation)) {
    return `${event.boundary}.${event.operation}`;
  }
  if (
    event.boundary === 'system' &&
    (SYSTEM_TRACE_OPERATIONS.has(event.operation) || event.operation.startsWith('LANE_DRAIN_') || event.operation.startsWith('RECOVERY_SCAN_'))
  ) {
    return `${event.boundary}.${event.operation}`;
  }
  if (event.boundary === 'gateway_call' && GATEWAY_TRACE_OPERATIONS.has(event.operation)) {
    return `${event.boundary}.${event.operation}`;
  }
  return undefined;
}

function traceAttributesFor(event: ObservabilityObservationEvent): Attributes {
  const attributes: Attributes = {
    'nextagent.boundary': event.boundary,
    'langfuse.observation.type': observationTypeFor(event),
    'nextagent.operation': event.operation,
    'nextagent.outcome': event.outcome,
    'nextagent.owner.agent_id': event.ownerScope.agentId,
    'nextagent.owner.agent_version': event.ownerScope.agentVersion,
    'session.id': event.stableRefs?.sessionId,
    'user.id': event.ownerScope.subjectId,
  };
  if (event.safeReasonCode !== undefined) {
    attributes['nextagent.reason_code'] = event.safeReasonCode;
  }
  if (event.durationMs !== undefined) {
    attributes['nextagent.duration_ms'] = event.durationMs;
  }
  if (event.usage?.inputTokens !== undefined) {
    attributes['nextagent.usage.input_tokens'] = event.usage.inputTokens;
  }
  if (event.usage?.outputTokens !== undefined) {
    attributes['nextagent.usage.output_tokens'] = event.usage.outputTokens;
  }
  if (event.usage?.totalTokens !== undefined) {
    attributes['nextagent.usage.total_tokens'] = event.usage.totalTokens;
  }
  for (const candidate of event.diagnosticSnapshot?.diagnosticCandidates ?? []) {
    if (
      candidate.key === 'traceparent' ||
      candidate.key === 'tracestate' ||
      !isDiagnosticCandidateProjectable(event.boundary, event.operation, candidate.key)
    ) {
      continue;
    }
    if (
      (candidate.classification === 'LOW_CARDINALITY' || candidate.classification === 'SAFE') &&
      candidate.cardinality === 'LOW' &&
      (typeof candidate.value === 'string' || typeof candidate.value === 'number' || typeof candidate.value === 'boolean')
    ) {
      attributes[`nextagent.diag.${candidate.key}`] = candidate.value;
    }
  }
  return attributes;
}

function observationTypeFor(event: ObservabilityObservationEvent): string {
  if (event.boundary === 'system' && event.operation.startsWith('POLICY_')) {
    return 'guardrail';
  }
  return 'span';
}

function spanEventAttributesFor(event: ObservabilityObservationEvent): Attributes {
  return {
    'nextagent.outcome': event.outcome,
    ...(event.safeReasonCode === undefined ? {} : { 'nextagent.reason_code': event.safeReasonCode }),
  };
}

function traceStatusFor(event: ObservabilityObservationEvent): { code: SpanStatusCode; message?: string } {
  if (event.outcome === 'success') {
    return { code: SpanStatusCode.OK };
  }
  return {
    code: SpanStatusCode.ERROR,
    ...(event.safeReasonCode === undefined ? {} : { message: event.safeReasonCode }),
  };
}

function traceLinksFor(event: ObservabilityObservationEvent): Link[] {
  const traceparent = diagnosticString(event, 'traceparent');
  const parsed = traceparent === undefined ? undefined : parseTraceparent(traceparent);
  return parsed === undefined ? [] : [{ context: parsed }];
}

function diagnosticString(event: ObservabilityObservationEvent, key: string): string | undefined {
  const value = event.diagnosticSnapshot?.diagnosticCandidates?.find((candidate) => candidate.key === key)?.value;
  return typeof value === 'string' ? value : undefined;
}

function parseTraceparent(value: string): SpanContext | undefined {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/iu.exec(value);
  if (match === null || /^0+$/u.test(match[1]!) || /^0+$/u.test(match[2]!)) {
    return undefined;
  }
  return {
    traceId: match[1]!.toLowerCase(),
    spanId: match[2]!.toLowerCase(),
    traceFlags: parseInt(match[3]!, 16),
    isRemote: true,
  };
}
