import { brand, type AgentId, type AgentVersion, type EpochMillis, type RequestRunId, type SessionId } from '@nextagent/agent-common';
import type { HealthCheckResponse, HealthEvaluator } from '../health/health-evaluator.js';
import { createObservationEvent, type ObservationOutcome, type TrustedOwnerScope } from '../linking/observation.js';
import type { ObservabilityProjectorHost } from '../linking/projector-host.js';

export interface ObservationAgentScope {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
}

export interface CronObservationInput {
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly operation: 'CRON_TASK_CREATED' | 'CRON_TASK_DELETED' | 'CRON_TRIGGER_ACCEPTED';
  readonly taskId: string;
  readonly triggerId?: string;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly now?: () => EpochMillis;
}

export interface MemoryConfigurationObservationInput {
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: ObservationAgentScope;
  readonly status: string;
  readonly source: string;
  readonly issueCode: string;
  readonly safeMessage: string;
  readonly now?: () => EpochMillis;
}

export interface MemoryDescriptionOverrideObservationInput {
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: ObservationAgentScope;
  readonly outcome: ObservationOutcome;
  readonly issueCode: string;
  readonly safeMessage: string;
  readonly capabilityId?: string;
  readonly now?: () => EpochMillis;
}

export interface ModelConfigurationExclusionObservationInput {
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: ObservationAgentScope;
  readonly code: string;
  readonly now?: () => EpochMillis;
}

export interface AppLifecycleObservationInput {
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly operation: 'APP_START' | 'APP_SHUTDOWN';
  readonly safeReasonCode: 'APP_STARTED' | 'APP_SHUTDOWN';
  readonly now?: () => EpochMillis;
}

export function emitMemoryConfigurationObservation(input: MemoryConfigurationObservationInput): void {
  emitConfigurationObservation(input.projectorHost, {
    ownerScope: input.ownerScope,
    agentScope: input.agentScope,
    operation: 'MEMORY_CONFIG_EVALUATED',
    outcome: 'success',
    safeReasonCode: input.issueCode,
    safeSummary: input.safeMessage,
    ...(input.now === undefined ? {} : { now: input.now }),
    diagnosticCandidates: [
      { key: 'status', value: input.status },
      { key: 'source', value: input.source },
    ],
  });
}

export function emitCronObservation(input: CronObservationInput): void {
  try {
    input.projectorHost.acceptObservation(
      createObservationEvent({
        boundary: 'system',
        operation: input.operation,
        outcome: 'success',
        ownerScope: input.ownerScope,
        occurredAt: now(input.now),
        safeReasonCode: input.operation,
        safeSummary: cronSafeSummary(input.operation),
        stableRefs: {
          auditEventId: cronAuditEventId(input),
          sessionId: input.sessionId,
          requestRunId: input.requestRunId,
          cronTaskId: input.taskId,
          ...(input.triggerId === undefined ? {} : { cronTriggerId: input.triggerId }),
        },
        diagnosticSnapshot: {
          tenantId: input.ownerScope.tenantId,
          subjectId: input.ownerScope.subjectId,
          agentId: input.ownerScope.agentId,
          agentVersion: input.ownerScope.agentVersion,
          sessionId: input.sessionId,
          requestRunId: input.requestRunId,
          diagnosticCandidates: [{ key: 'cronOperation', value: input.operation, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
    );
  } catch {
    // Cron observations are advisory and must not change durable task or delivery results.
  }
}

function cronAuditEventId(input: CronObservationInput): string {
  const operation = input.operation.toLowerCase().replaceAll('_', '-');
  return `audit:cron:${operation}:${input.requestRunId}:${input.taskId}${input.triggerId === undefined ? '' : `:${input.triggerId}`}`;
}

function cronSafeSummary(operation: CronObservationInput['operation']): string {
  if (operation === 'CRON_TASK_CREATED') {
    return 'Cron task created durably.';
  }
  if (operation === 'CRON_TASK_DELETED') {
    return 'Cron task deleted durably.';
  }
  return 'Cron trigger accepted as a standard request run.';
}

export function emitMemoryDescriptionOverrideObservation(input: MemoryDescriptionOverrideObservationInput): void {
  emitConfigurationObservation(input.projectorHost, {
    ownerScope: input.ownerScope,
    agentScope: input.agentScope,
    operation: 'MEMORY_DESCRIPTION_OVERRIDE_EVALUATED',
    outcome: input.outcome,
    safeReasonCode: input.issueCode,
    safeSummary: input.safeMessage,
    ...(input.now === undefined ? {} : { now: input.now }),
    diagnosticCandidates: [
      { key: 'issueCode', value: input.issueCode },
      ...(input.capabilityId === undefined ? [] : [{ key: 'capabilityId', value: input.capabilityId }]),
    ],
  });
}

export function emitModelConfigurationExclusionObservation(input: ModelConfigurationExclusionObservationInput): void {
  try {
    input.projectorHost.acceptObservation(
      createObservationEvent({
        boundary: 'system',
        operation: 'MODEL_PROFILE_EXCLUDED',
        outcome: 'degraded',
        ownerScope: input.ownerScope,
        occurredAt: now(input.now),
        safeReasonCode: input.code,
        stableRefs: {},
        diagnosticSnapshot: {
          tenantId: input.ownerScope.tenantId,
          subjectId: input.ownerScope.subjectId,
          agentId: input.agentScope.agentId,
          agentVersion: input.agentScope.agentVersion,
          diagnosticCandidates: lowCardinalityCandidates([{ key: 'code', value: input.code }]),
        },
      }),
    );
  } catch {
    // Model profile exclusion observations are advisory.
  }
}

export function emitAppLifecycleObservation(input: AppLifecycleObservationInput): void {
  try {
    input.projectorHost.acceptObservation(
      createObservationEvent({
        boundary: 'system',
        operation: input.operation,
        outcome: 'success',
        ownerScope: input.ownerScope,
        occurredAt: now(input.now),
        safeReasonCode: input.safeReasonCode,
        stableRefs: {},
      }),
    );
  } catch {
    // App lifecycle observations are advisory and must not change app lifecycle results.
  }
}

export function createObservedHealthEvaluator(input: {
  readonly evaluator: HealthEvaluator;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: ObservationAgentScope;
  readonly now?: () => EpochMillis;
}): HealthEvaluator {
  const now = input.now ?? (() => brand<number, 'EpochMillis'>(Date.now()));
  async function observe(label: 'Health' | 'Deep health', result: HealthCheckResponse): Promise<HealthCheckResponse> {
    try {
      input.projectorHost.acceptObservation(
        createObservationEvent({
          boundary: 'health_probe',
          operation: 'HEALTH_EVALUATED',
          outcome: result.status === 'UP' ? 'success' : result.status === 'DEGRADED' ? 'degraded' : 'failure',
          ownerScope: input.ownerScope,
          occurredAt: now(),
          safeSummary: `${label} evaluation: ${result.status}`,
          safeReasonCode: result.status,
          stableRefs: {},
          diagnosticSnapshot: {
            agentId: input.agentScope.agentId,
            agentVersion: input.agentScope.agentVersion,
            diagnosticCandidates: result.components.map((component) => ({
              key: `probe_${component.name}`,
              value: `${component.status}:${component.reasonCode ?? 'N/A'}`,
              classification: 'LOW_CARDINALITY' as const,
              cardinality: 'LOW' as const,
            })),
          },
        }),
      );
    } catch {
      // Health observation is advisory and must not change readiness.
    }
    return result;
  }
  return {
    async primary(signal) {
      return observe('Health', await input.evaluator.primary(signal));
    },
    async deep(signal) {
      return observe('Deep health', await input.evaluator.deep(signal));
    },
  };
}

function emitConfigurationObservation(
  projectorHost: ObservabilityProjectorHost,
  input: {
    readonly ownerScope: TrustedOwnerScope;
    readonly agentScope: ObservationAgentScope;
    readonly operation: string;
    readonly outcome: ObservationOutcome;
    readonly safeReasonCode: string;
    readonly safeSummary: string;
    readonly diagnosticCandidates: ReadonlyArray<{ readonly key: string; readonly value: string }>;
    readonly now?: () => EpochMillis;
  },
): void {
  try {
    projectorHost.acceptObservation(
      createObservationEvent({
        boundary: 'system',
        operation: input.operation,
        outcome: input.outcome,
        ownerScope: input.ownerScope,
        occurredAt: now(input.now),
        safeReasonCode: input.safeReasonCode,
        safeSummary: input.safeSummary,
        stableRefs: {},
        diagnosticSnapshot: {
          agentId: input.agentScope.agentId,
          agentVersion: input.agentScope.agentVersion,
          diagnosticCandidates: lowCardinalityCandidates(input.diagnosticCandidates),
        },
      }),
    );
  } catch {
    // Configuration observations are advisory.
  }
}

function lowCardinalityCandidates(entries: ReadonlyArray<{ readonly key: string; readonly value: string | number | boolean }>) {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    classification: 'LOW_CARDINALITY' as const,
    cardinality: 'LOW' as const,
  }));
}

function now(factory?: () => EpochMillis): EpochMillis {
  return factory === undefined ? brand<number, 'EpochMillis'>(Date.now()) : factory();
}
