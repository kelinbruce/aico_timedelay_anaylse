import type { AgentId, AgentVersion, EpochMillis, JsonObject, SubjectId, TenantId } from '@nextagent/agent-common';
import type { ObservabilityContext } from './context.js';

export type ObservationBoundary = 'request_lifecycle' | 'model_invocation' | 'capability_invocation' | 'gateway_call' | 'health_probe' | 'system';

export type ObservationOutcome = 'success' | 'failure' | 'timeout' | 'canceled' | 'denied' | 'degraded';
export type OwnerScopeSource = 'trusted_identity' | 'persisted_record' | 'trusted_system';

export interface TrustedOwnerScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
}

export interface StableObservationRefs {
  readonly sessionId?: string;
  readonly requestRunId?: string;
  readonly cronTaskId?: string;
  readonly cronTriggerId?: string;
  readonly requestContextId?: string;
  readonly requestId?: string;
  readonly messageId?: string;
  readonly timelineEventId?: string;
  readonly capabilityInvocationId?: string;
  readonly auditEventId?: string;
}

export interface ObservationModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ObservabilityObservationEvent {
  readonly spanOwner?: 'TIMELINE_LIFECYCLE';
  readonly boundary: ObservationBoundary;
  readonly operation: string;
  readonly outcome: ObservationOutcome;
  readonly ownerScope: TrustedOwnerScope;
  readonly occurredAt: EpochMillis;
  readonly durationMs?: number;
  readonly firstContentLatencyMs?: number;
  readonly usage?: ObservationModelUsage;
  readonly safeSummary?: string;
  readonly safeReasonCode?: string;
  readonly stableRefs?: StableObservationRefs;
  readonly diagnosticSnapshot?: ObservabilityContext;
}

export interface BoundedObservabilityDegradationInput {
  readonly boundary: ObservationBoundary;
  readonly operation: string;
  readonly ownerScope?: TrustedOwnerScope;
  readonly occurredAt?: EpochMillis;
  readonly durationMs?: number;
  readonly usage?: ObservationModelUsage;
  readonly safeSummary?: string;
  readonly safeReasonCode: string;
  readonly stableRefs?: StableObservationRefs;
  readonly diagnosticSnapshot?: ObservabilityContext;
}

export function createObservationEvent(input: ObservabilityObservationEvent): ObservabilityObservationEvent {
  assertSafeObservationShape(input);
  return input;
}

export function createBoundedObservabilityDegradationEvidence(
  input: BoundedObservabilityDegradationInput,
): ObservabilityObservationEvent | undefined {
  if (input.ownerScope === undefined || input.occurredAt === undefined) {
    return undefined;
  }
  return createObservationEvent({
    boundary: input.boundary,
    operation: input.operation,
    outcome: 'degraded',
    ownerScope: input.ownerScope,
    occurredAt: input.occurredAt,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    ...(input.safeSummary === undefined ? {} : { safeSummary: input.safeSummary }),
    safeReasonCode: input.safeReasonCode,
    ...(input.stableRefs === undefined ? {} : { stableRefs: input.stableRefs }),
    ...(input.diagnosticSnapshot === undefined ? {} : { diagnosticSnapshot: input.diagnosticSnapshot }),
  });
}

function assertSafeObservationShape(event: ObservabilityObservationEvent): void {
  assertLowCardinality(event.operation, 'operation');
  if (event.safeReasonCode !== undefined) {
    assertLowCardinality(event.safeReasonCode, 'safeReasonCode');
  }
  if (event.safeSummary !== undefined && event.safeSummary.length > 512) {
    throw new Error('Observation safeSummary must be bounded.');
  }
  if (event.durationMs !== undefined && (!Number.isFinite(event.durationMs) || event.durationMs < 0)) {
    throw new Error('Observation duration must be a non-negative finite number.');
  }
  if (event.firstContentLatencyMs !== undefined) {
    if (
      event.boundary !== 'model_invocation' ||
      (event.operation !== 'MODEL_INVOCATION_COMPLETED' && !event.operation.endsWith('_FAILED')) ||
      !Number.isFinite(event.firstContentLatencyMs) ||
      event.firstContentLatencyMs < 0 ||
      (event.durationMs !== undefined && event.firstContentLatencyMs > event.durationMs)
    ) {
      throw new Error('Observation first content latency must be a valid Model terminal timing.');
    }
  }
  assertModelUsage(event.usage);
  assertNoRawPayload(event as unknown as JsonObject);
}

function assertModelUsage(usage?: ObservationModelUsage): void {
  if (usage === undefined) {
    return;
  }
  for (const [key, value] of Object.entries(usage)) {
    if (key !== 'inputTokens' && key !== 'outputTokens' && key !== 'totalTokens') {
      throw new Error('Observation usage cannot carry open-ended keys.');
    }
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error('Observation usage values must be non-negative integers.');
    }
  }
}

function assertLowCardinality(value: string, field: string): void {
  if (!/^[A-Z0-9_.:-]{1,128}$/iu.test(value)) {
    throw new Error(`Observation ${field} must be a stable low-cardinality token.`);
  }
}

function assertNoRawPayload(value: JsonObject): void {
  const serialized = JSON.stringify(value);
  const forbidden =
    '(?:rawArgs|rawResult|rawProvider|rawBody|prompt|modelOutput|toolArgs|toolResult|attachmentContent|secret|credential|freeTextReason|clientTime)';
  if (new RegExp(`"${forbidden}"\\s*:|"key"\\s*:\\s*"${forbidden}"`, 'iu').test(serialized)) {
    throw new Error('Observation event cannot carry raw or dynamic payload fields.');
  }
}
