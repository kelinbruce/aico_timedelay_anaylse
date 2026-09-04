import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  createTraceState,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanContext,
  type Tracer,
} from '@opentelemetry/api';
import { isTaskEventId, runWithRuntimeLogCorrelation, type JsonObject } from '@nextagent/agent-common';
import type {
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  TerminalCommitStatus,
} from '@nextagent/agent-contracts/gateway';
import type { ExecutionCorrelationPort, ExecutionCorrelationRef, W3CTraceCarrier } from '@nextagent/agent-contracts/observability';

const TOMBSTONE_TTL_MS = 120_000;
const MAX_PREDECESSORS = 128;
const TRACE_HEADER_NAMES = new Set(['traceparent', 'tracestate', 'x-task-event-id']);

interface SpanSnapshot {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly previewSpanIds?: readonly string[];
  readonly traceparent: string;
  readonly tracestate?: string;
}

interface ActiveSpanEntry {
  readonly state: 'ACTIVE';
  readonly ref: ExecutionCorrelationRef;
  readonly span: Span;
  readonly spanContext: SpanContext;
  readonly snapshot: SpanSnapshot;
  readonly eventId?: string;
}

interface ClosedSpanEntry {
  readonly state: 'CLOSED';
  readonly ref: ExecutionCorrelationRef;
  readonly spanContext: SpanContext;
  readonly snapshot: SpanSnapshot;
  readonly eventId?: string;
  readonly closedAt: number;
}

type SpanEntry = ActiveSpanEntry | ClosedSpanEntry;

interface ExecutionScope {
  readonly refs: readonly ExecutionCorrelationRef[];
}

interface TimelineClassification {
  readonly ref?: ExecutionCorrelationRef;
  readonly phase: 'START' | 'TERMINAL' | 'INTERMEDIATE' | 'REQUEST_SNAPSHOT';
  readonly kind?: ExecutionCorrelationRef['kind'];
}

export interface PreparedTimelineSpan {
  readonly record: RunTimelineEventRecord;
  readonly ref?: ExecutionCorrelationRef;
  readonly phase?: TimelineClassification['phase'];
  readonly createdNewSpan?: boolean;
}

export interface TimelineSpanRegistryView {
  requestSpanContext: (requestRunId: string) => SpanContext | undefined;
}

export interface TimelineSpanLifecyclePort {
  prepareSafely: (record: RunTimelineEventRecord) => PreparedTimelineSpan;
  committedSafely: (prepared: PreparedTimelineSpan, persisted: RunTimelineEventRecord) => void;
  failedSafely: (prepared: PreparedTimelineSpan, error: unknown) => void;
  notCommittedSafely: (prepared: PreparedTimelineSpan, status: TerminalCommitStatus) => void;
  alreadyCommittedSafely: (ref?: ExecutionCorrelationRef) => void;
}

export interface TimelineTraceRuntime {
  readonly lifecycle: TimelineSpanLifecyclePort;
  readonly correlation: ExecutionCorrelationPort;
  readonly registry: TimelineSpanRegistryView;
}

export interface TimelineTraceRuntimeOptions {
  readonly enabled: boolean;
  readonly tracer?: Tracer;
  readonly now?: () => number;
  readonly scheduleCleanup?: (operation: () => void, delayMs: number) => unknown;
}

export function createTimelineTraceRuntime(options: TimelineTraceRuntimeOptions): TimelineTraceRuntime {
  const registry = new TimelineSpanRegistry(options);
  return {
    lifecycle: registry,
    correlation: registry,
    registry,
  };
}

class TimelineSpanRegistry implements TimelineSpanLifecyclePort, ExecutionCorrelationPort, TimelineSpanRegistryView {
  private readonly entries = new Map<string, SpanEntry>();
  private readonly incomingCarrier = new AsyncLocalStorage<SpanContext | undefined>();
  private readonly executionScope = new AsyncLocalStorage<ExecutionScope>();
  private readonly tracer: Tracer;
  private readonly now: () => number;
  private readonly scheduleCleanup: (operation: () => void, delayMs: number) => unknown;

  constructor(private readonly options: TimelineTraceRuntimeOptions) {
    this.tracer = options.tracer ?? trace.getTracer('nextagent-timeline-lifecycle');
    this.now = options.now ?? Date.now;
    this.scheduleCleanup =
      options.scheduleCleanup ??
      ((operation, delayMs) => {
        const timer = setTimeout(operation, delayMs);
        timer.unref();
        return timer;
      });
  }

  async withIncomingCarrier<T>(carrier: W3CTraceCarrier | undefined, operation: () => Promise<T>): Promise<T> {
    if (!this.options.enabled) {
      return operation();
    }
    return this.incomingCarrier.run(parseIncomingCarrier(carrier), operation);
  }

  async withExecutionRef<T>(ref: ExecutionCorrelationRef, operation: () => Promise<T>): Promise<T> {
    if (!this.options.enabled) {
      return operation();
    }
    const parent = this.executionScope.getStore();
    const refs = parent === undefined ? [ref] : [...parent.refs, ref];
    return this.executionScope.run({ refs }, () => {
      const entry = this.activeEntryFromScope();
      return entry === undefined
        ? operation()
        : runWithRuntimeLogCorrelation({ traceId: entry.snapshot.traceId, spanId: entry.snapshot.spanId }, operation);
    });
  }

  outboundHeaders(input: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
    const headers = Object.fromEntries(Object.entries(input).filter(([name]) => !TRACE_HEADER_NAMES.has(name.toLowerCase())));
    if (!this.options.enabled) {
      return headers;
    }
    const entry = this.activeEntryFromScope();
    if (entry === undefined || !isValidSpanContext(entry.spanContext)) {
      return headers;
    }
    return {
      ...headers,
      traceparent: entry.snapshot.traceparent,
      ...(entry.snapshot.tracestate === undefined ? {} : { tracestate: entry.snapshot.tracestate }),
      ...(entry.eventId === undefined ? {} : { 'x-task-event-id': entry.eventId }),
    };
  }

  prepareSafely(record: RunTimelineEventRecord): PreparedTimelineSpan {
    const cleanRecord = replaceTrace(record, undefined);
    if (!this.options.enabled) {
      return { record: cleanRecord };
    }
    try {
      return this.prepare(cleanRecord);
    } catch {
      return { record: cleanRecord };
    }
  }

  committedSafely(prepared: PreparedTimelineSpan, persisted: RunTimelineEventRecord): void {
    try {
      if (prepared.ref === undefined || prepared.phase !== 'TERMINAL') {
        return;
      }
      this.closeEntry(prepared.ref, persisted);
    } catch {
      // Observability callbacks never alter persistence outcomes.
    }
  }

  failedSafely(prepared: PreparedTimelineSpan, _error: unknown): void {
    try {
      if (prepared.ref === undefined || prepared.createdNewSpan !== true) {
        return;
      }
      const key = correlationKey(prepared.ref);
      const entry = this.entries.get(key);
      if (entry?.state !== 'ACTIVE') {
        return;
      }
      entry.span.setStatus({ code: SpanStatusCode.ERROR, message: 'TIMELINE_WRITE_FAILED' });
      entry.span.end();
      this.entries.delete(key);
    } catch {
      // Observability cleanup never replaces the original persistence error.
    }
  }

  notCommittedSafely(_prepared: PreparedTimelineSpan, _status: TerminalCommitStatus): void {
    // The ACTIVE entry remains available for the authoritative commit retry.
  }

  alreadyCommittedSafely(ref?: ExecutionCorrelationRef): void {
    try {
      if (ref !== undefined) {
        this.closeEntry(ref);
      }
    } catch {
      // Idempotent cleanup is best effort.
    }
  }

  requestSpanContext(requestRunId: string): SpanContext | undefined {
    return this.entryFor(requestRef(requestRunId))?.spanContext;
  }

  private prepare(record: RunTimelineEventRecord): PreparedTimelineSpan {
    const classification = classifyTimeline(record);
    if (classification.phase === 'REQUEST_SNAPSHOT') {
      const requestEntry = this.entryFor(requestRef(record.runId));
      return {
        record: replaceTrace(record, requestEntry?.snapshot),
      };
    }
    if (classification.ref === undefined) {
      const requestEntry = this.entryFor(requestRef(record.runId));
      return { record: replaceTrace(record, requestEntry?.snapshot) };
    }
    if (classification.phase === 'START') {
      if (classification.kind === undefined) {
        return { record };
      }
      return this.prepareStart(record, {
        ...classification,
        ref: classification.ref,
        kind: classification.kind,
      });
    }
    const entry = this.entryFor(classification.ref);
    return {
      record: replaceTrace(record, entry?.snapshot),
      ref: classification.ref,
      phase: classification.phase,
    };
  }

  private prepareStart(
    record: RunTimelineEventRecord,
    classification: TimelineClassification & {
      readonly ref: ExecutionCorrelationRef;
      readonly kind: ExecutionCorrelationRef['kind'];
    },
  ): PreparedTimelineSpan {
    const existing = this.entryFor(classification.ref);
    if (existing !== undefined) {
      return {
        record: replaceTrace(record, existing.snapshot),
        ref: classification.ref,
        phase: 'START',
      };
    }
    const parent = classification.kind === 'REQUEST' ? this.incomingCarrier.getStore() : this.requestSpanContext(record.runId);
    if (classification.kind !== 'REQUEST' && parent === undefined) {
      return { record, ref: classification.ref, phase: 'START' };
    }
    const parentContext = parent === undefined ? ROOT_CONTEXT : trace.setSpanContext(ROOT_CONTEXT, parent);
    const previewSpanIds = classification.kind === 'WORKFLOW_NODE' ? this.resolvePredecessors(record, classification.ref, parent) : undefined;
    const span = this.tracer.startSpan(
      spanName(classification.kind),
      {
        startTime: Number(record.createdAt),
        kind: spanKind(classification.kind),
        attributes: startAttributes(record, classification.kind),
      },
      parentContext,
    );
    // Workaround: OTel SDK may not propagate parentSpanId from context in some environments.
    // Use setAttribute instead of Object.defineProperty, which gets overwritten during export.
    if (parent !== undefined) {
      span.setAttribute('_internal.parentSpanId', parent.spanId);
    }
    const spanContext = span.spanContext();
    if (!isValidSpanContext(spanContext)) {
      span.end(Number(record.createdAt));
      return { record, ref: classification.ref, phase: 'START' };
    }
    const snapshot = snapshotFor(spanContext, parent, previewSpanIds);
    const eventId = trustedEventId(record);
    this.entries.set(correlationKey(classification.ref), {
      state: 'ACTIVE',
      ref: classification.ref,
      span,
      spanContext,
      snapshot,
      ...(eventId === undefined ? {} : { eventId }),
    });
    return {
      record: replaceTrace(record, snapshot),
      ref: classification.ref,
      phase: 'START',
      createdNewSpan: true,
    };
  }

  private resolvePredecessors(
    record: RunTimelineEventRecord,
    currentRef: ExecutionCorrelationRef,
    requestContext?: SpanContext,
  ): readonly string[] | undefined {
    const value = record.inlinePayload['predecessorNodeExecutionIds'];
    if (!Array.isArray(value) || value.length > MAX_PREDECESSORS || requestContext === undefined) {
      return undefined;
    }
    const seen = new Set<string>();
    const spanIds: string[] = [];
    for (const executionId of value) {
      if (typeof executionId !== 'string' || executionId.length === 0 || executionId.length > 128) {
        return undefined;
      }
      const predecessor = this.entryFor({
        requestRunId: currentRef.requestRunId,
        kind: 'WORKFLOW_NODE',
        executionId,
      });
      if (
        predecessor === undefined ||
        predecessor.spanContext.traceId !== requestContext.traceId ||
        predecessor.ref.executionId === currentRef.executionId
      ) {
        return undefined;
      }
      if (!seen.has(predecessor.spanContext.spanId)) {
        seen.add(predecessor.spanContext.spanId);
        spanIds.push(predecessor.spanContext.spanId);
      }
    }
    return spanIds;
  }

  private closeEntry(ref: ExecutionCorrelationRef, persisted?: RunTimelineEventRecord): void {
    const key = correlationKey(ref);
    const entry = this.entries.get(key);
    if (entry?.state !== 'ACTIVE') {
      return;
    }
    if (ref.kind === 'REQUEST') {
      this.closeRequestChildren(ref.requestRunId);
    }
    if (persisted !== undefined) {
      applyTerminalSpanState(entry.span, persisted);
    }
    entry.span.end(persisted === undefined ? undefined : Number(persisted.createdAt));
    this.entries.set(key, {
      state: 'CLOSED',
      ref: entry.ref,
      spanContext: entry.spanContext,
      snapshot: entry.snapshot,
      ...(entry.eventId === undefined ? {} : { eventId: entry.eventId }),
      closedAt: this.now(),
    });
    if (ref.kind === 'REQUEST') {
      this.scheduleRequestCleanup(ref.requestRunId);
    }
  }

  private closeRequestChildren(requestRunId: string): void {
    for (const entry of this.entries.values()) {
      if (entry.state !== 'ACTIVE' || entry.ref.requestRunId !== requestRunId || entry.ref.kind === 'REQUEST') {
        continue;
      }
      entry.span.setAttribute('nextagent.force_close_reason', 'REQUEST_TERMINATED');
      entry.span.setStatus({ code: SpanStatusCode.ERROR, message: 'REQUEST_TERMINATED' });
      this.closeEntry(entry.ref);
    }
  }

  private scheduleRequestCleanup(requestRunId: string): void {
    this.scheduleCleanup(() => {
      for (const [key, entry] of this.entries) {
        if (entry.ref.requestRunId === requestRunId && entry.state === 'CLOSED') {
          this.entries.delete(key);
        }
      }
    }, TOMBSTONE_TTL_MS);
  }

  private entryFor(ref?: ExecutionCorrelationRef): SpanEntry | undefined {
    return ref === undefined ? undefined : this.entries.get(correlationKey(ref));
  }

  private activeEntryFromScope(): SpanEntry | undefined {
    const refs = this.executionScope.getStore()?.refs;
    if (refs === undefined) {
      return undefined;
    }
    for (let index = refs.length - 1; index >= 0; index -= 1) {
      const entry = this.entryFor(refs[index]);
      if (entry?.state === 'ACTIVE') {
        return entry;
      }
    }
    return undefined;
  }
}

export function createTraceAwareTimelineStore(
  inner: RunTimelineEventStoreGateway,
  lifecycle: TimelineSpanLifecyclePort,
): RunTimelineEventStoreGateway {
  return {
    appendEvent: async (record, options) => {
      const prepared = prepareIsolated(lifecycle, record);
      try {
        const persisted = await inner.appendEvent(prepared.record, options);
        invokeLifecycleSafely(() => lifecycle.committedSafely(prepared, persisted));
        return persisted;
      } catch (error) {
        invokeLifecycleSafely(() => lifecycle.failedSafely(prepared, error));
        throw error;
      }
    },
    listEvents: (request) => inner.listEvents(request),
  };
}

export function createTraceAwareRequestRunStore(inner: RequestRunStoreGateway, lifecycle: TimelineSpanLifecyclePort): RequestRunStoreGateway {
  return {
    saveRun: (record, options) => inner.saveRun(record, options),
    loadRun: (request) => inner.loadRun(request),
    listRuns: (request) => inner.listRuns(request),
    loadSessionLaneSnapshot: (request) => inner.loadSessionLaneSnapshot(request),
    loadRunByIdempotencyKey: (request) => inner.loadRunByIdempotencyKey(request),
    claimRun: (request) => inner.claimRun(request),
    listRecoverableRuns: (request) => inner.listRecoverableRuns(request),
    commitTerminal: async (request) => {
      const prepared = prepareIsolated(lifecycle, request.terminalEvent);
      try {
        const result = await inner.commitTerminal({
          ...request,
          terminalEvent: prepared.record,
        });
        if (result.status === 'COMMITTED' && result.terminalEvent !== undefined) {
          invokeLifecycleSafely(() => lifecycle.committedSafely(prepared, result.terminalEvent!));
        } else if (result.status === 'ALREADY_COMMITTED') {
          invokeLifecycleSafely(() => lifecycle.alreadyCommittedSafely(prepared.ref));
        } else {
          invokeLifecycleSafely(() => lifecycle.notCommittedSafely(prepared, result.status));
        }
        return result;
      } catch (error) {
        invokeLifecycleSafely(() => lifecycle.failedSafely(prepared, error));
        throw error;
      }
    },
  };
}

function prepareIsolated(lifecycle: TimelineSpanLifecyclePort, record: RunTimelineEventRecord): PreparedTimelineSpan {
  try {
    return lifecycle.prepareSafely(record);
  } catch {
    return { record: replaceTrace(record, undefined) };
  }
}

function invokeLifecycleSafely(operation: () => void): void {
  try {
    operation();
  } catch {
    // A lifecycle adapter cannot replace an authoritative persistence result.
  }
}

function classifyTimeline(record: RunTimelineEventRecord): TimelineClassification {
  if (record.type === 'REQUEST_ACCEPTED') {
    return { ref: requestRef(record.runId), phase: 'START', kind: 'REQUEST' };
  }
  if (isRequestTerminal(record.type)) {
    return { ref: requestRef(record.runId), phase: 'TERMINAL', kind: 'REQUEST' };
  }
  const stepId = readString(record.inlinePayload, 'stepId');
  if (record.type === 'MODEL_INVOCATION_STARTED' && stepId !== undefined) {
    return { ref: executionRef(record, 'MODEL', stepId), phase: 'START', kind: 'MODEL' };
  }
  if ((record.type === 'MODEL_INVOCATION_COMPLETED' || record.type === 'MODEL_INVOCATION_FAILED') && stepId !== undefined) {
    return { ref: executionRef(record, 'MODEL', stepId), phase: 'TERMINAL', kind: 'MODEL' };
  }
  const nodeType = readString(record.inlinePayload, 'nodeType');
  if ((nodeType === 'START' || nodeType === 'END') && (record.type === 'CAPABILITY_STARTED' || record.type === 'CAPABILITY_COMPLETED')) {
    return { phase: 'REQUEST_SNAPSHOT' };
  }
  const nodeExecutionId = readString(record.inlinePayload, 'nodeExecutionId');
  if (nodeExecutionId !== undefined && record.type === 'CAPABILITY_STARTED') {
    return { ref: executionRef(record, 'WORKFLOW_NODE', nodeExecutionId), phase: 'START', kind: 'WORKFLOW_NODE' };
  }
  if (nodeExecutionId !== undefined && record.type === 'CAPABILITY_COMPLETED') {
    return { ref: executionRef(record, 'WORKFLOW_NODE', nodeExecutionId), phase: 'TERMINAL', kind: 'WORKFLOW_NODE' };
  }
  const toolCallId = readString(record.inlinePayload, 'toolCallId');
  if (toolCallId !== undefined && record.type === 'CAPABILITY_STARTED') {
    return { ref: executionRef(record, 'CAPABILITY', toolCallId), phase: 'START', kind: 'CAPABILITY' };
  }
  if (toolCallId !== undefined && record.type === 'CAPABILITY_COMPLETED') {
    return { ref: executionRef(record, 'CAPABILITY', toolCallId), phase: 'TERMINAL', kind: 'CAPABILITY' };
  }
  if (nodeExecutionId !== undefined) {
    return { ref: executionRef(record, 'WORKFLOW_NODE', nodeExecutionId), phase: 'INTERMEDIATE', kind: 'WORKFLOW_NODE' };
  }
  if (toolCallId !== undefined) {
    return { ref: executionRef(record, 'CAPABILITY', toolCallId), phase: 'INTERMEDIATE', kind: 'CAPABILITY' };
  }
  if (stepId !== undefined) {
    return { ref: executionRef(record, 'MODEL', stepId), phase: 'INTERMEDIATE', kind: 'MODEL' };
  }
  return { phase: 'REQUEST_SNAPSHOT' };
}

function requestRef(requestRunId: string): ExecutionCorrelationRef {
  return { requestRunId, kind: 'REQUEST', executionId: requestRunId };
}

function executionRef(
  record: RunTimelineEventRecord,
  kind: Exclude<ExecutionCorrelationRef['kind'], 'REQUEST'>,
  executionId: string,
): ExecutionCorrelationRef {
  return { requestRunId: record.runId, kind, executionId };
}

function correlationKey(ref: ExecutionCorrelationRef): string {
  return `${ref.requestRunId}\u0000${ref.kind}\u0000${ref.executionId}`;
}

function replaceTrace(record: RunTimelineEventRecord, snapshot?: SpanSnapshot): RunTimelineEventRecord {
  const { trace: _untrustedTrace, ...payload } = record.inlinePayload;
  return {
    ...record,
    inlinePayload: snapshot === undefined ? payload : { ...payload, trace: snapshotToJson(snapshot) },
  };
}

function snapshotToJson(snapshot: SpanSnapshot): JsonObject {
  return {
    traceId: snapshot.traceId,
    spanId: snapshot.spanId,
    ...(snapshot.parentSpanId === undefined ? {} : { parentSpanId: snapshot.parentSpanId }),
    ...(snapshot.previewSpanIds === undefined ? {} : { previewSpanIds: snapshot.previewSpanIds }),
    traceparent: snapshot.traceparent,
    ...(snapshot.tracestate === undefined ? {} : { tracestate: snapshot.tracestate }),
  };
}

function snapshotFor(spanContext: SpanContext, parent?: SpanContext, previewSpanIds?: readonly string[]): SpanSnapshot {
  const tracestate = spanContext.traceState?.serialize();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
    ...(previewSpanIds === undefined ? {} : { previewSpanIds }),
    traceparent: formatTraceparent(spanContext),
    ...(tracestate === undefined || tracestate.length === 0 ? {} : { tracestate }),
  };
}

function startAttributes(record: RunTimelineEventRecord, kind: ExecutionCorrelationRef['kind']): Attributes {
  const attributes: Attributes = {
    'nextagent.observation_type': observationType(kind),
    'nextagent.execution.kind': kind,
  };
  const eventId = trustedEventId(record);
  const nodeId = readString(record.inlinePayload, 'nodeId');
  const description = readString(record.inlinePayload, 'description') ?? readString(record.inlinePayload, 'nodeDesc');
  if (eventId !== undefined) {
    attributes.eventId = eventId;
  }
  if (nodeId !== undefined) {
    attributes.nodeId = nodeId;
  }
  if (description !== undefined) {
    attributes.description = description;
  }
  return attributes;
}

function applyTerminalSpanState(span: Span, record: RunTimelineEventRecord): void {
  const outcome = terminalOutcome(record);
  span.setAttribute('nextagent.outcome', outcome);
  const durationMs = record.inlinePayload['durationMs'];
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
    span.setAttribute('nextagent.duration_ms', durationMs);
  }
  const reasonCode = readString(record.inlinePayload, 'safeErrorCode') ?? readString(record.inlinePayload, 'reasonCode');
  if (reasonCode !== undefined) {
    span.setAttribute('nextagent.reason_code', reasonCode);
  }
  // Extract token usage from MODEL_INVOCATION_COMPLETED inlinePayload.
  if (record.type === 'MODEL_INVOCATION_COMPLETED') {
    const usage = record.inlinePayload['usage'];
    if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
      const usageObj = usage as Record<string, unknown>;
      const inputTokens = usageObj['inputTokens'];
      if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
        span.setAttribute('nextagent.usage.input_tokens', inputTokens);
      }
      const outputTokens = usageObj['outputTokens'];
      if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
        span.setAttribute('nextagent.usage.output_tokens', outputTokens);
      }
      const totalTokens = usageObj['totalTokens'];
      if (typeof totalTokens === 'number' && Number.isFinite(totalTokens)) {
        span.setAttribute('nextagent.usage.total_tokens', totalTokens);
      }
    }
  }
  span.setStatus(
    outcome === 'success'
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR, ...(reasonCode === undefined ? {} : { message: reasonCode }) },
  );
}

function terminalOutcome(record: RunTimelineEventRecord): string {
  if (record.type === 'REQUEST_COMPLETED') {
    return 'success';
  }
  if (record.type === 'REQUEST_CANCELED' || record.type === 'REQUEST_SUPERSEDED') {
    return 'canceled';
  }
  if (record.type === 'CAPABILITY_COMPLETED' && record.inlinePayload['status'] === 'SUCCEEDED') {
    return 'success';
  }
  if (record.type === 'MODEL_INVOCATION_COMPLETED') {
    return 'success';
  }
  return 'failure';
}

function observationType(kind: ExecutionCorrelationRef['kind']): string {
  if (kind === 'REQUEST') {
    return 'request';
  }
  if (kind === 'MODEL') {
    return 'model';
  }
  if (kind === 'CAPABILITY') {
    return 'tool';
  }
  return 'workflow_node';
}

function spanName(kind: ExecutionCorrelationRef['kind']): string {
  return `nextagent.${observationType(kind)}`;
}

function spanKind(kind: ExecutionCorrelationRef['kind']): SpanKind {
  return kind === 'MODEL' || kind === 'CAPABILITY' ? SpanKind.CLIENT : SpanKind.INTERNAL;
}

function trustedEventId(record: RunTimelineEventRecord): string | undefined {
  const attributes = record.inlinePayload['attributes'];
  if (!isJsonObject(attributes)) {
    return undefined;
  }
  const eventId = attributes['eventId'];
  return isTaskEventId(eventId) ? eventId : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRequestTerminal(type: string): boolean {
  return type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED';
}

function parseIncomingCarrier(carrier?: W3CTraceCarrier): SpanContext | undefined {
  const traceparent = carrier?.traceparent;
  if (traceparent === undefined || traceparent.length > 55) {
    return undefined;
  }
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u.exec(traceparent);
  if (match === null || /^0+$/u.test(match[1]!) || /^0+$/u.test(match[2]!)) {
    return undefined;
  }
  const tracestate = validTracestate(carrier?.tracestate);
  return {
    traceId: match[1]!,
    spanId: match[2]!,
    traceFlags: Number.parseInt(match[3]!, 16) & 1,
    isRemote: true,
    ...(tracestate === undefined ? {} : { traceState: createTraceState(tracestate) }),
  };
}

function validTracestate(value?: string): string | undefined {
  if (value === undefined || value.length === 0 || value.length > 512 || /[\r\n]/u.test(value)) {
    return undefined;
  }
  const members = value.split(',');
  if (members.length > 32) {
    return undefined;
  }
  const keys = new Set<string>();
  for (const rawMember of members) {
    const member = rawMember.trim();
    const separator = member.indexOf('=');
    if (separator <= 0 || separator !== member.lastIndexOf('=')) {
      return undefined;
    }
    const key = member.slice(0, separator);
    const memberValue = member.slice(separator + 1);
    if (
      !isValidTracestateKey(key) ||
      memberValue.length === 0 ||
      memberValue.length > 256 ||
      memberValue.endsWith(' ') ||
      !/^[\x20-\x2b\x2d-\x3c\x3e-\x7e]+$/u.test(memberValue) ||
      keys.has(key)
    ) {
      return undefined;
    }
    keys.add(key);
  }
  return value;
}

function isValidTracestateKey(value: string): boolean {
  return /^[a-z][a-z0-9_\-*\/]{0,255}$/u.test(value) || /^[a-z0-9][a-z0-9_\-*\/]{0,240}@[a-z][a-z0-9_\-*\/]{0,13}$/u.test(value);
}

function isValidSpanContext(spanContext: SpanContext): boolean {
  return (
    /^[0-9a-f]{32}$/u.test(spanContext.traceId) &&
    !/^0+$/u.test(spanContext.traceId) &&
    /^[0-9a-f]{16}$/u.test(spanContext.spanId) &&
    !/^0+$/u.test(spanContext.spanId)
  );
}

function formatTraceparent(spanContext: SpanContext): string {
  const flags = (spanContext.traceFlags & 1) === 1 ? '01' : '00';
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}
