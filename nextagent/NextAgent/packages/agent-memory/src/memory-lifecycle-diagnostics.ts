import {
  brand,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type { MemoryAgingAuditEvent, MemoryAgingCycleDiagnostic } from './memory-aging.js';
import type { MemoryExtractionAuditEvent, MemoryExtractionCycleDiagnostic } from './memory-extraction.js';
import type { TaskTrajectoryWorkerDiagnostic } from './task-trajectory-worker.js';

export interface MemoryDiagnosticAgentScope {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
}

export interface MemoryDiagnosticOwnerScope extends MemoryDiagnosticAgentScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
}

export type MemoryDiagnosticObservationOutcome = 'success' | 'degraded' | 'failure';

export interface MemoryDiagnosticObservationInput {
  readonly boundary: 'system';
  readonly operation:
    'MEMORY_AGING_CYCLE' | 'MEMORY_EXTRACTION_CYCLE' | 'TASK_TRAJECTORY_BUILD' | 'MEMORY_AGING_LIFECYCLE' | MemoryExtractionAuditEvent['eventType'];
  readonly outcome: MemoryDiagnosticObservationOutcome;
  readonly ownerScope: MemoryDiagnosticOwnerScope;
  readonly occurredAt: EpochMillis;
  readonly safeReasonCode: string;
  readonly stableRefs: {
    readonly sessionId?: SessionId;
    readonly requestRunId?: RequestRunId;
  };
  readonly diagnosticSnapshot: {
    readonly tenantId: TenantId;
    readonly subjectId: SubjectId;
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
    readonly sessionId?: SessionId;
    readonly requestRunId?: RequestRunId;
    readonly diagnosticCandidates: ReadonlyArray<{
      readonly key: string;
      readonly value: string | number;
      readonly classification: 'LOW_CARDINALITY' | 'HIGH_CARDINALITY';
      readonly cardinality: 'LOW' | 'HIGH';
    }>;
  };
}

export interface MemoryLifecycleDiagnosticsOptions<TObservation> {
  readonly createObservationEvent: (input: MemoryDiagnosticObservationInput) => TObservation;
  readonly now?: () => EpochMillis;
}

export interface MemoryLifecycleDiagnostics<TObservation> {
  createAgingDiagnosticObservation: (
    event: MemoryAgingCycleDiagnostic,
    ownerScope: MemoryDiagnosticOwnerScope,
    agentScope: MemoryDiagnosticAgentScope,
  ) => TObservation;
  createExtractionDiagnosticObservation: (
    event: MemoryExtractionCycleDiagnostic,
    ownerScope: MemoryDiagnosticOwnerScope,
    agentScope: MemoryDiagnosticAgentScope,
  ) => TObservation;
  createTaskTrajectoryDiagnosticObservation: (
    event: TaskTrajectoryWorkerDiagnostic,
    ownerScope: MemoryDiagnosticOwnerScope,
    agentScope: MemoryDiagnosticAgentScope,
  ) => TObservation;
  createAgingAuditObservation: (
    event: MemoryAgingAuditEvent,
    ownerScope: MemoryDiagnosticOwnerScope,
    agentScope: MemoryDiagnosticAgentScope,
  ) => TObservation;
  createExtractionAuditObservation: (
    event: MemoryExtractionAuditEvent,
    ownerScope: MemoryDiagnosticOwnerScope,
    agentScope: MemoryDiagnosticAgentScope,
  ) => TObservation;
}

export function createMemoryLifecycleDiagnostics<TObservation>(
  options: MemoryLifecycleDiagnosticsOptions<TObservation>,
): MemoryLifecycleDiagnostics<TObservation> {
  const now = options.now ?? (() => brand<number, 'EpochMillis'>(Date.now()));
  return {
    createAgingDiagnosticObservation(event, ownerScope, agentScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation: 'MEMORY_AGING_CYCLE',
        outcome: memoryAgingObservationOutcome(event.status),
        ownerScope,
        occurredAt: event.completedAt,
        safeReasonCode: event.reasonCode,
        stableRefs: {},
        diagnosticSnapshot: {
          tenantId: ownerScope.tenantId,
          subjectId: ownerScope.subjectId,
          agentId: agentScope.agentId,
          agentVersion: agentScope.agentVersion,
          diagnosticCandidates: [
            low('status', event.status),
            low('triggerReason', event.triggerReason),
            low('reasonCode', event.reasonCode),
            low('processedCount', String(event.processedCount)),
            low('decayedCount', String(event.decayedCount)),
            low('archivedCount', String(event.archivedCount)),
            low('deletedCount', String(event.deletedCount)),
            low('revivedCount', String(event.revivedCount)),
            low('failureCount', String(event.failureCount)),
            low('durationMs', String(event.durationMs)),
          ],
        },
      });
    },
    createExtractionDiagnosticObservation(event, ownerScope, agentScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation: 'MEMORY_EXTRACTION_CYCLE',
        outcome: memoryExtractionObservationOutcome(event.status),
        ownerScope,
        occurredAt: now(),
        safeReasonCode: event.reasonCode,
        stableRefs: {},
        diagnosticSnapshot: {
          tenantId: ownerScope.tenantId,
          subjectId: ownerScope.subjectId,
          agentId: agentScope.agentId,
          agentVersion: agentScope.agentVersion,
          diagnosticCandidates: [
            low('status', event.status),
            low('strategy', event.strategy),
            low('reasonCode', event.reasonCode),
            low('trajectoryCount', String(event.trajectoryCount)),
            low('acceptedCount', String(event.acceptedCount)),
            low('rejectedCount', String(event.rejectedCount)),
            low('writtenCount', String(event.writtenCount)),
            low('durationMs', String(event.durationMs)),
          ],
        },
      });
    },
    createTaskTrajectoryDiagnosticObservation(event, ownerScope, agentScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation: 'TASK_TRAJECTORY_BUILD',
        outcome: taskTrajectoryObservationOutcome(event.status),
        ownerScope,
        occurredAt: now(),
        safeReasonCode: event.reasonCode,
        stableRefs: {
          sessionId: event.sessionId,
          requestRunId: event.requestRunId,
        },
        diagnosticSnapshot: {
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: agentScope.agentId,
          agentVersion: agentScope.agentVersion,
          sessionId: event.sessionId,
          requestRunId: event.requestRunId,
          diagnosticCandidates: [low('status', event.status), low('reasonCode', event.reasonCode), low('durationMs', event.durationMs)],
        },
      });
    },
    createAgingAuditObservation(event, ownerScope, agentScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation: 'MEMORY_AGING_LIFECYCLE',
        outcome: 'success',
        ownerScope,
        occurredAt: event.occurredAt,
        safeReasonCode: event.reasonCode,
        stableRefs: {},
        diagnosticSnapshot: {
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: agentScope.agentId,
          agentVersion: agentScope.agentVersion,
          diagnosticCandidates: [
            low('operation', event.operation),
            low('reasonCode', event.reasonCode),
            high('longTermMemoryId', String(event.longTermMemoryId)),
          ],
        },
      });
    },
    createExtractionAuditObservation(event, ownerScope, agentScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation: event.eventType,
        outcome: event.eventType === 'MEMORY_EXTRACTION_WRITE' ? 'success' : 'degraded',
        ownerScope,
        occurredAt: event.occurredAt,
        safeReasonCode: event.eventType,
        stableRefs: {},
        diagnosticSnapshot: {
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: agentScope.agentId,
          agentVersion: agentScope.agentVersion,
          diagnosticCandidates: [
            low('eventType', event.eventType),
            low('category', event.category),
            low('sourceRefCount', event.sourceRefCount),
            ...(event.longTermMemoryId === undefined ? [] : [high('longTermMemoryId', String(event.longTermMemoryId))]),
          ],
        },
      });
    },
  };
}

function low(key: string, value: string | number) {
  return { key, value, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const };
}

function high(key: string, value: string | number) {
  return { key, value, classification: 'HIGH_CARDINALITY' as const, cardinality: 'HIGH' as const };
}

function memoryExtractionObservationOutcome(status: MemoryExtractionCycleDiagnostic['status']): MemoryDiagnosticObservationOutcome {
  if (status === 'COMPLETED' || status === 'STARTED') {
    return 'success';
  }
  if (status === 'SKIPPED' || status === 'PARTIAL') {
    return 'degraded';
  }
  return 'failure';
}

function memoryAgingObservationOutcome(status: MemoryAgingCycleDiagnostic['status']): MemoryDiagnosticObservationOutcome {
  if (status === 'COMPLETED') {
    return 'success';
  }
  if (status === 'SKIPPED' || status === 'PARTIAL') {
    return 'degraded';
  }
  return 'failure';
}

function taskTrajectoryObservationOutcome(status: TaskTrajectoryWorkerDiagnostic['status']): MemoryDiagnosticObservationOutcome {
  if (status === 'BUILT' || status === 'ENQUEUED') {
    return 'success';
  }
  if (status === 'SKIPPED' || status === 'DROPPED') {
    return 'degraded';
  }
  return 'failure';
}
