import {
  bindRuntimeLoggerProvider,
  brand,
  noopRuntimeLogger,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type RuntimeLoggerProviderBinding,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import { SpanKind } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { createObservationEvent, createTraceProjector } from '../src/index.js';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-trace') as TenantId,
  subjectId: brand<string, 'SubjectId'>('subject-trace') as SubjectId,
  agentId: brand<string, 'AgentId'>('agent-trace') as AgentId,
  agentVersion: brand<string, 'AgentVersion'>('v1') as AgentVersion,
};

describe('trace projector', () => {
  it('maps a sanitized observation to a span with bounded attributes and span links', () => {
    const starts: Array<{ name: string; options: Record<string, unknown> }> = [];
    const diagnostics = { debug: [] as Array<Record<string, unknown>>, info: [] as Array<Record<string, unknown>> };
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        ...noopRuntimeLogger,
        debug: (fields) => diagnostics.debug.push(fields as Record<string, unknown>),
        info: (fields) => diagnostics.info.push(fields as Record<string, unknown>),
      }),
    });
    const projector = createTraceProjector({
      timelineSpanRegistry: {
        requestSpanContext: () => ({
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          spanId: 'bbbbbbbbbbbbbbbb',
          traceFlags: 1,
        }),
      },
      tracer: {
        startSpan(name: string, options?: Record<string, unknown>) {
          starts.push({ name, options: options ?? {} });
          return {
            setStatus() {},
            addEvent() {},
            setAttribute() {
              return this;
            },
            spanContext() {
              return {
                traceId: 'fedcba9876543210fedcba9876543210',
                spanId: 'fedcba9876543210',
                traceFlags: 1,
              };
            },
            end() {},
          };
        },
      } as never,
    });

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'system',
          operation: 'HOOK_COMPLETED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(200) as EpochMillis,
          durationMs: 25,
          safeReasonCode: 'MODEL_COMPLETED',
          stableRefs: { requestRunId: 'run-1', requestId: 'request-1' },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          diagnosticSnapshot: {
            diagnosticCandidates: [
              { key: 'providerKind', value: 'OPENAI', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
              { key: 'traceparent', value: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01', classification: 'SAFE', cardinality: 'LOW' },
              { key: 'ignored', value: 'secret-path', classification: 'SAFE', cardinality: 'HIGH' },
            ],
          },
        }),
      ),
    ).toEqual({ surface: 'TRACE', outcome: 'emitted' });

    expect(starts).toHaveLength(1);
    const [firstSpan] = starts;
    expect(firstSpan).toBeDefined();
    expect(firstSpan!.name).toBe('system.HOOK_COMPLETED');
    const attributes = firstSpan!.options.attributes as Record<string, unknown>;
    expect(attributes['nextagent.operation']).toBe('HOOK_COMPLETED');
    expect(attributes['nextagent.usage.total_tokens']).toBe(15);
    expect(attributes['nextagent.diag.providerKind']).toBeUndefined();
    expect(attributes['nextagent.ref.requestRunId']).toBeUndefined();
    expect(attributes['nextagent.ref.requestId']).toBeUndefined();
    expect(attributes['nextagent.diag.traceparent']).toBeUndefined();
    expect(attributes['nextagent.diag.ignored']).toBeUndefined();
    expect(firstSpan!.options.links).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          traceId: '0123456789abcdef0123456789abcdef',
          spanId: '0123456789abcdef',
          isRemote: true,
        }),
      }),
    ]);
    expect(firstSpan!.options.kind).toBe(SpanKind.INTERNAL);
    expect(diagnostics.info).toEqual([]);
    expect(diagnostics.debug).toEqual([expect.objectContaining({ event: 'trace.span.emitted', spanId: 'fedcba9876543210', requestRunId: 'run-1' })]);
    expect(diagnostics.debug[0]).not.toHaveProperty('tracerConstructor');
  });

  it('skips timeline-owned observations and applies the missing-parent policy by boundary', () => {
    const starts: string[] = [];
    const projector = createTraceProjector({
      tracer: {
        startSpan(name: string) {
          starts.push(name);
          return {
            setStatus() {},
            addEvent() {},
            spanContext() {
              return {
                traceId: 'fedcba9876543210fedcba9876543210',
                spanId: 'fedcba9876543210',
                traceFlags: 1,
              };
            },
            end() {},
          };
        },
      } as never,
    });
    const timelineOwned = createObservationEvent({
      spanOwner: 'TIMELINE_LIFECYCLE',
      boundary: 'request_lifecycle',
      operation: 'TERMINAL_COMMITTED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
      stableRefs: { requestRunId: 'run-owned' },
    });
    expect(projector.covers(timelineOwned)).toBe(false);
    expect(projector.project(timelineOwned)).toEqual({
      surface: 'TRACE',
      outcome: 'skipped_not_covered',
    });

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'system',
          operation: 'HOOK_COMPLETED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(2) as EpochMillis,
          stableRefs: { requestRunId: 'run-missing' },
        }),
      ),
    ).toEqual({
      surface: 'TRACE',
      outcome: 'degraded',
      safeReasonCode: 'REQUEST_TRACE_CONTEXT_UNAVAILABLE',
    });
    expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_REJECTED',
          outcome: 'denied',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(3) as EpochMillis,
        }),
      ),
    ).toEqual({ surface: 'TRACE', outcome: 'emitted' });
    expect(starts).toEqual(['request_lifecycle.REQUEST_REJECTED']);
  });

  it('skips unsupported operations and degrades safely when the tracer throws', () => {
    const skipped = createTraceProjector();
    expect(
      skipped.project(
        createObservationEvent({
          boundary: 'system',
          operation: 'UNAPPROVED_TRACE_EVENT',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        }),
      ),
    ).toEqual({ surface: 'TRACE', outcome: 'skipped_not_covered' });

    const diagnostics: Array<{ readonly caught?: unknown; readonly fields: Record<string, unknown> }> = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        ...noopRuntimeLogger,
        error(fields: object) {
          const { err, ...safeFields } = fields as Record<string, unknown>;
          diagnostics.push({ ...(err === undefined ? {} : { caught: err }), fields: safeFields });
        },
      }),
    });
    const degraded = createTraceProjector({
      timelineSpanRegistry: {
        requestSpanContext: () => ({
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          spanId: 'bbbbbbbbbbbbbbbb',
          traceFlags: 1,
        }),
      },
      tracer: {
        startSpan() {
          throw new Error('no tracer');
        },
      } as never,
    });
    expect(
      degraded.project(
        createObservationEvent({
          boundary: 'system',
          operation: 'HOOK_FAILED',
          outcome: 'failure',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(2) as EpochMillis,
          safeReasonCode: 'HOOK_FAILED',
          stableRefs: { requestRunId: 'run-2' },
        }),
      ),
    ).toEqual({ surface: 'TRACE', outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        caught: expect.any(Error),
        fields: expect.objectContaining({
          event: 'trace.projection.exception_captured',
          failureStage: 'span_projection',
        }),
      }),
    ]);
    expect(diagnostics[0]).not.toHaveProperty('errorMessage');
  });
});
