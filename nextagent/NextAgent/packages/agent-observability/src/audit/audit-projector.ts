import type { AttributeValue, AuditEvent, AuditEventWriter } from './audit-event.js';
import type { ObservabilityObservationEvent } from '../linking/observation.js';
import type { ObservabilityProjector, SurfaceProjectionResult } from '../linking/projector-host.js';

export class AuditProjector implements ObservabilityProjector {
  readonly surface = 'AUDIT' as const;

  constructor(private readonly writer?: AuditEventWriter) {}

  covers(event: ObservabilityObservationEvent): boolean {
    return auditEventName(event) !== undefined;
  }

  async project(event: ObservabilityObservationEvent): Promise<SurfaceProjectionResult> {
    if (auditEventName(event) === undefined) {
      return { surface: 'AUDIT', outcome: 'skipped_not_covered' };
    }
    if (this.writer === undefined) {
      return { surface: 'AUDIT', outcome: 'degraded', safeReasonCode: 'SINK_WRITE_FAILED' };
    }
    const candidate = buildAuditEventCandidate(event);
    if (candidate.event === undefined) {
      return { surface: 'AUDIT', outcome: 'failed_closed', safeReasonCode: candidate.reason };
    }
    try {
      JSON.stringify(candidate.event);
    } catch {
      return { surface: 'AUDIT', outcome: 'failed_closed', safeReasonCode: 'SERIALIZATION_FAILED' };
    }
    try {
      await this.writer.write(candidate.event);
      return { surface: 'AUDIT', outcome: 'emitted' };
    } catch {
      return { surface: 'AUDIT', outcome: 'degraded', safeReasonCode: 'SINK_WRITE_FAILED' };
    }
  }
}

export function createAuditProjector(writer?: AuditEventWriter): AuditProjector {
  return new AuditProjector(writer);
}

export function buildAuditEvent(event: ObservabilityObservationEvent): AuditEvent | undefined {
  return buildAuditEventCandidate(event).event;
}

function buildAuditEventCandidate(event: ObservabilityObservationEvent): { readonly event?: AuditEvent; readonly reason: string } {
  const eventName = auditEventName(event);
  const requestRunId = event.stableRefs?.requestRunId;
  const auditId = event.stableRefs?.auditEventId;
  if (eventName === undefined || auditId === undefined || (requestRunId === undefined && eventName !== 'request.rejected')) {
    return { reason: 'MISSING_REQUIRED_FIELDS' };
  }
  const stableRefs = event.stableRefs ?? {};
  const attributes = toAuditAttributes({
    boundary: event.boundary,
    operation: event.operation,
    outcome: event.outcome,
    agentVersion: event.ownerScope.agentVersion,
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.usage?.inputTokens === undefined ? {} : { inputTokens: event.usage.inputTokens }),
    ...(event.usage?.outputTokens === undefined ? {} : { outputTokens: event.usage.outputTokens }),
    ...(event.usage?.totalTokens === undefined ? {} : { totalTokens: event.usage.totalTokens }),
    ...(event.safeReasonCode === undefined ? {} : { safeReasonCode: event.safeReasonCode }),
    ...(stableRefs.sessionId === undefined ? {} : { sessionId: stableRefs.sessionId }),
    ...(stableRefs.cronTaskId === undefined ? {} : { cronTaskId: stableRefs.cronTaskId }),
    ...(stableRefs.cronTriggerId === undefined ? {} : { cronTriggerId: stableRefs.cronTriggerId }),
    ...(stableRefs.requestId === undefined ? {} : { requestId: stableRefs.requestId }),
  });
  return {
    reason: 'OK',
    event: {
      auditId,
      eventName,
      tenantId: event.ownerScope.tenantId,
      subjectId: event.ownerScope.subjectId,
      agentId: event.ownerScope.agentId as NonNullable<AuditEvent['agentId']>,
      ...(requestRunId === undefined ? {} : { requestRunId: requestRunId as NonNullable<AuditEvent['requestRunId']> }),
      safeSummary: event.safeSummary ?? event.safeReasonCode ?? `${event.boundary}.${event.outcome}`,
      attributes,
      occurredAt: event.occurredAt,
    },
  };
}

const CAPABILITY_AUDIT_EVENT: Record<string, string> = {
  CAPABILITY_STARTED: 'capability.started',
  CAPABILITY_COMPLETED: 'capability.completed',
  CAPABILITY_FAILED: 'capability.failed',
  CAPABILITY_TIMED_OUT: 'capability.timed_out',
  CAPABILITY_CANCELED: 'capability.canceled',
  CAPABILITY_NOT_FOUND: 'capability.not_found',
  CAPABILITY_SECURITY_FAILED: 'capability.security_failed',
  CAPABILITY_POLICY_BLOCKED: 'capability.policy_blocked',
  CAPABILITY_DENIED: 'capability.denied',
};

function capabilityAuditEventName(operation: string): string | undefined {
  return CAPABILITY_AUDIT_EVENT[operation];
}

function auditEventName(event: ObservabilityObservationEvent): string | undefined {
  if (diagnosticCandidateValue(event, 'persistence') === 'LIVE_ONLY') {
    return undefined;
  }
  if (event.boundary === 'request_lifecycle') {
    if (event.operation === 'REQUEST_ACCEPTED') {
      return 'request.accepted';
    }
    if (event.operation === 'REQUEST_REJECTED') {
      return 'request.rejected';
    }
    if (event.operation === 'TERMINAL_COMMITTED') {
      return 'terminal.committed';
    }
    if (event.operation === 'TERMINAL_FAILED') {
      return 'terminal.failed';
    }
  }
  if (event.boundary === 'capability_invocation') {
    if (event.operation === 'CAPABILITY_SECURITY_FAILED') {
      return 'capability.security_failed';
    }
    if (event.operation === 'CAPABILITY_POLICY_BLOCKED') {
      return 'capability.policy_blocked';
    }
    if (event.operation === 'CAPABILITY_DENIED') {
      return 'capability.denied';
    }
  }
  if (event.boundary === 'model_invocation') {
    if (event.operation === 'MODEL_SECURITY_FAILED') {
      return 'model.security_failed';
    }
    if (event.operation === 'MODEL_CREDENTIAL_FAILED') {
      return 'model.credential_failed';
    }
    if (event.operation === 'MODEL_QUOTA_FAILED') {
      return 'model.quota_failed';
    }
  }
  if (event.boundary === 'gateway_call') {
    if (event.operation === 'GATEWAY_OWNER_BOUNDARY_FAILED') {
      return 'gateway.owner_boundary_failed';
    }
    if (event.operation === 'GATEWAY_CREDENTIAL_FAILED') {
      return 'gateway.credential_failed';
    }
  }
  if (event.boundary === 'system') {
    if (event.operation === 'CRON_TASK_CREATED') {
      return 'cron.task_created';
    }
    if (event.operation === 'CRON_TASK_DELETED') {
      return 'cron.task_deleted';
    }
    if (event.operation === 'CRON_TRIGGER_ACCEPTED') {
      return 'cron.trigger_accepted';
    }
    if (event.operation === 'HOOK_INVOKED') {
      return 'hook.invoked';
    }
    if (event.operation === 'HOOK_COMPLETED') {
      return 'hook.completed';
    }
    if (event.operation === 'HOOK_FAILED') {
      return 'hook.failed';
    }
    if (event.operation === 'POLICY_EVALUATED') {
      return 'policy.evaluated';
    }
    if (event.operation === 'POLICY_ALLOWED') {
      return 'policy.allowed';
    }
    if (event.operation === 'POLICY_DENIED') {
      return 'policy.denied';
    }
    if (event.operation === 'POLICY_FAILED') {
      return 'policy.failed';
    }
    if (event.operation === 'ATTACHMENT_ACCEPTED') {
      return 'attachment.accepted';
    }
    if (event.operation === 'ATTACHMENT_REJECTED') {
      return 'attachment.rejected';
    }
    if (event.operation === 'ROUTING_DECISION') {
      return 'routing.decision';
    }
    if (event.operation === 'SAFE_ERROR_EMITTED') {
      return 'safe_error.emitted';
    }
  }
  return undefined;
}

function diagnosticCandidateValue(event: ObservabilityObservationEvent, key: string): string | undefined {
  const value = event.diagnosticSnapshot?.diagnosticCandidates?.find((candidate) => candidate.key === key)?.value;
  return typeof value === 'string' ? value : undefined;
}

function toAuditAttributes(value: unknown): Record<string, AttributeValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const attributes: Record<string, AttributeValue> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (isAttributeValue(candidate)) {
      attributes[key] = candidate;
    }
  }
  return attributes;
}

function isAttributeValue(value: unknown): value is AttributeValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
}
