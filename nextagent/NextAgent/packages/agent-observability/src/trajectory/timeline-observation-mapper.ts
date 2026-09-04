import {
  brand,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type JsonObject,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type { DiagnosticCandidate } from '../linking/context.js';
import { createObservationEvent, type ObservabilityObservationEvent } from '../linking/observation.js';
import { bindTimelineLogCorrelation } from '../logging/local-log-correlation.js';

export interface TimelineObservationRecord {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly eventId: string;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
  readonly requestId: MessageId;
  readonly requestContextId: RequestContextId;
  readonly type: string;
  readonly persistence?: 'PERSISTED' | 'LIVE_ONLY';
  readonly inlinePayload: JsonObject;
  readonly createdAt: EpochMillis;
}

export type TimelineObservationMapper = (record: TimelineObservationRecord) => readonly ObservabilityObservationEvent[];

export function createTimelineObservationMapper(): TimelineObservationMapper {
  const acceptedAtByRun = new Map<string, number>();
  const requestUsageByRun = new Map<string, RequestUsageAccumulator>();
  const modelStartedAtByInvocation = new Map<string, number>();
  const activeModelStepByRun = new Map<string, string>();
  const firstVisibleByInvocation = new Set<string>();
  const firstContentDeliveredByRun = new Set<string>();
  const mapRecord = (record: TimelineObservationRecord): readonly ObservabilityObservationEvent[] => {
    if (record.type === 'REQUEST_ACCEPTED') {
      acceptedAtByRun.set(record.runId, Number(record.createdAt));
      requestUsageByRun.set(record.runId, createRequestUsageAccumulator());
      return singleton(timelineObservationFromRecord(record));
    }
    if (record.type === 'MODEL_INVOCATION_STARTED') {
      const stepId = readAnyString(record.inlinePayload, 'stepId');
      const modelId = readAnyString(record.inlinePayload, 'modelId');
      if (stepId !== undefined && modelId !== undefined) {
        const key = modelInvocationKey(record.runId, stepId);
        modelStartedAtByInvocation.set(key, Number(record.createdAt));
        activeModelStepByRun.set(record.runId, stepId);
      }
      return singleton(timelineObservationFromRecord(record));
    }
    if (record.type === 'LLM_CONTENT_DELTA' || record.type === 'LLM_THINKING_DELTA') {
      const observations: ObservabilityObservationEvent[] = [];
      if (!firstContentDeliveredByRun.has(record.runId)) {
        const acceptedAt = acceptedAtByRun.get(record.runId);
        if (acceptedAt !== undefined) {
          firstContentDeliveredByRun.add(record.runId);
          observations.push(requestFirstContentDeliveredObservation(record, acceptedAt));
        }
      }
      if (record.type === 'LLM_CONTENT_DELTA') {
        const stepId = readAnyString(record.inlinePayload, 'stepId') ?? activeModelStepByRun.get(record.runId);
        if (stepId !== undefined) {
          const key = modelInvocationKey(record.runId, stepId);
          if (!firstVisibleByInvocation.has(key)) {
            firstVisibleByInvocation.add(key);
            observations.push(modelFirstVisibleObservation(record, modelStartedAtByInvocation.get(key)));
          }
        }
      }
      return observations;
    }
    if (record.type === 'MODEL_INVOCATION_COMPLETED' || record.type === 'MODEL_INVOCATION_FAILED') {
      accumulateRequestUsage(record, requestUsageByRun.get(record.runId));
      const stepId = readAnyString(record.inlinePayload, 'stepId');
      const modelId = readAnyString(record.inlinePayload, 'modelId');
      if (stepId !== undefined && modelId !== undefined) {
        const key = modelInvocationKey(record.runId, stepId);
        const startedAt = modelStartedAtByInvocation.get(key);
        modelStartedAtByInvocation.delete(key);
        firstVisibleByInvocation.delete(key);
        if (activeModelStepByRun.get(record.runId) === stepId) {
          activeModelStepByRun.delete(record.runId);
        }
        if (readNonNegativeNumber(record.inlinePayload, 'durationMs') === undefined && startedAt !== undefined) {
          return singleton(timelineObservationFromRecord(withDuration(record, startedAt)));
        }
      }
      return singleton(timelineObservationFromRecord(record));
    }
    if (isTerminal(record.type)) {
      const acceptedAt = acceptedAtByRun.get(record.runId);
      const requestUsage = completeRequestUsage(requestUsageByRun.get(record.runId));
      acceptedAtByRun.delete(record.runId);
      requestUsageByRun.delete(record.runId);
      clearRunState(record.runId, modelStartedAtByInvocation, activeModelStepByRun, firstVisibleByInvocation, firstContentDeliveredByRun);
      const terminalRecord =
        readNonNegativeNumber(record.inlinePayload, 'durationMs') === undefined && acceptedAt !== undefined
          ? withDuration(record, acceptedAt)
          : record;
      const terminalObservation = timelineObservationFromRecord(terminalRecord);
      return singleton(
        terminalObservation === undefined || requestUsage === undefined ? terminalObservation : { ...terminalObservation, usage: requestUsage },
      );
    }
    return singleton(timelineObservationFromRecord(record));
  };
  return (record) => mapRecord(record).map((observation) => bindTimelineLogCorrelation(observation, record.inlinePayload));
}

function singleton(observation?: ObservabilityObservationEvent): readonly ObservabilityObservationEvent[] {
  return observation === undefined ? [] : [observation];
}

export function timelineObservationFromRecord(record: TimelineObservationRecord): ObservabilityObservationEvent | undefined {
  if (record.type === 'REQUEST_ACCEPTED') {
    const status = readString(record.inlinePayload, 'status');
    return createObservationEvent({
      spanOwner: 'TIMELINE_LIFECYCLE',
      boundary: 'request_lifecycle',
      operation: 'REQUEST_ACCEPTED',
      outcome: 'success',
      ownerScope: ownerScope(record),
      occurredAt: record.createdAt,
      safeSummary: 'Request accepted and queued.',
      stableRefs: baseRefs(record),
      diagnosticSnapshot: {
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        agentVersion: record.agentVersion,
        sessionId: record.sessionId,
        requestRunId: record.runId,
        requestContextId: record.requestContextId,
        timelineEventId: record.eventId,
        diagnosticCandidates: [
          ...persistenceCandidate(record),
          ...(status === undefined
            ? []
            : [{ key: 'status', value: status, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const }]),
        ],
      },
    });
  }
  if (isTerminal(record.type)) {
    const durationMs = readNonNegativeNumber(record.inlinePayload, 'durationMs');
    return createObservationEvent({
      spanOwner: 'TIMELINE_LIFECYCLE',
      boundary: 'request_lifecycle',
      operation: 'TERMINAL_COMMITTED',
      outcome: terminalOutcome(record.type),
      ownerScope: ownerScope(record),
      occurredAt: record.createdAt,
      ...(durationMs === undefined ? {} : { durationMs }),
      safeSummary: 'Terminal outcome committed.',
      safeReasonCode: terminalReasonCode(record.type),
      stableRefs: baseRefs(record),
      diagnosticSnapshot: {
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        agentVersion: record.agentVersion,
        sessionId: record.sessionId,
        requestRunId: record.runId,
        requestContextId: record.requestContextId,
        timelineEventId: record.eventId,
        diagnosticCandidates: [
          ...persistenceCandidate(record),
          { key: 'terminalStatus', value: terminalStatus(record.type), classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ...renamedOptionalLowCandidate(record.inlinePayload, 'code', 'safeErrorCode'),
          ...renamedOptionalLowCandidate(record.inlinePayload, 'category', 'safeErrorCategory'),
        ],
      },
    });
  }
  if (record.type === 'MODEL_INVOCATION_STARTED' || record.type === 'MODEL_INVOCATION_COMPLETED' || record.type === 'MODEL_INVOCATION_FAILED') {
    return modelObservationFromTimeline(record);
  }
  if (record.type === 'CAPABILITY_STARTED') {
    return capabilityStartedObservationFromTimeline(record);
  }
  if (record.type === 'CAPABILITY_COMPLETED') {
    return capabilityObservationFromTimeline(record);
  }
  if (record.type === 'POLICY_APPLIED') {
    return policyObservationFromTimeline(record);
  }
  if (record.type === 'HOOK_INVOKED') {
    return hookObservationFromTimeline(record);
  }
  if (record.type === 'CONTEXT_COMPACTED') {
    return simpleTimelineObservation(
      record,
      'system',
      'CONTEXT_COMPACTED',
      'success',
      'Context compaction completed.',
      readAnyString(record.inlinePayload, 'code'),
    );
  }
  if (record.type === 'DEGRADATION_NOTICE') {
    return simpleTimelineObservation(
      record,
      'system',
      'DEGRADATION_NOTICE',
      'degraded',
      'Runtime degradation recorded.',
      readAnyString(record.inlinePayload, 'code') ?? readAnyString(record.inlinePayload, 'reasonCode'),
    );
  }
  if (
    record.type === 'USER_INPUT_REQUIRED' ||
    record.type === 'USER_INPUT_RECEIVED' ||
    record.type === 'USER_INPUT_TIMEOUT' ||
    record.type === 'USER_INPUT_CANCELED'
  ) {
    const outcome =
      record.type === 'USER_INPUT_RECEIVED'
        ? 'success'
        : record.type === 'USER_INPUT_REQUIRED'
          ? 'degraded'
          : record.type === 'USER_INPUT_TIMEOUT'
            ? 'timeout'
            : 'canceled';
    return simpleTimelineObservation(
      record,
      'request_lifecycle',
      record.type,
      outcome,
      'Pending input lifecycle changed.',
      readAnyString(record.inlinePayload, 'reasonCode'),
    );
  }
  if (record.type === 'BACKGROUND_TASK_STARTED' || record.type === 'BACKGROUND_TASK_COMPLETED' || record.type === 'BACKGROUND_TASK_FAILED') {
    return simpleTimelineObservation(
      record,
      'system',
      record.type,
      record.type === 'BACKGROUND_TASK_FAILED' ? 'failure' : 'success',
      'Background task lifecycle changed.',
      readAnyString(record.inlinePayload, 'reasonCode'),
    );
  }
  if (record.type === 'ATTACHMENT_ACCEPTED' || record.type === 'ATTACHMENT_REJECTED') {
    return simpleTimelineObservation(
      record,
      'system',
      record.type,
      record.type === 'ATTACHMENT_ACCEPTED' ? 'success' : 'denied',
      'Attachment intake lifecycle changed.',
      readAnyString(record.inlinePayload, 'reasonCode'),
    );
  }
  return undefined;
}

function modelObservationFromTimeline(record: TimelineObservationRecord): ObservabilityObservationEvent | undefined {
  const stepId = readAnyString(record.inlinePayload, 'stepId');
  const modelId = readAnyString(record.inlinePayload, 'modelId');
  if (stepId === undefined || modelId === undefined) {
    return undefined;
  }
  const durationMs = readNonNegativeNumber(record.inlinePayload, 'durationMs');
  const firstContentLatencyMs = readNonNegativeNumber(record.inlinePayload, 'firstContentLatencyMs');
  const safeErrorCode = readAnyString(record.inlinePayload, 'safeErrorCode');
  const safeErrorCategory = readAnyString(record.inlinePayload, 'safeErrorCategory');
  const failed = record.type === 'MODEL_INVOCATION_FAILED';
  const operation = failed ? modelFailureOperation(safeErrorCode, safeErrorCategory) : record.type;
  const outcome = failed ? modelFailureOutcome(safeErrorCategory) : 'success';
  const usage = readModelUsage(record.inlinePayload);
  return createObservationEvent({
    spanOwner: 'TIMELINE_LIFECYCLE',
    boundary: 'model_invocation',
    operation,
    outcome,
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs }),
    ...(usage === undefined ? {} : { usage }),
    safeSummary: failed
      ? 'Model invocation failed safely.'
      : record.type === 'MODEL_INVOCATION_STARTED'
        ? 'Model invocation started.'
        : 'Model invocation completed.',
    ...(safeErrorCode === undefined ? {} : { safeReasonCode: safeErrorCode }),
    stableRefs: baseRefs(record),
    diagnosticSnapshot: timelineDiagnosticSnapshot(record, [
      ...persistenceCandidate(record),
      ...optionalLowCandidate(record.inlinePayload, 'stepId'),
      ...optionalLowCandidate(record.inlinePayload, 'messageCountBucket'),
      ...optionalLowCandidate(record.inlinePayload, 'timeoutMsBucket'),
      ...optionalLowCandidate(record.inlinePayload, 'maxOutputTokensBucket'),
      ...optionalLowCandidate(record.inlinePayload, 'disclosedCapabilityNamesTruncated'),
      ...optionalLowCandidate(record.inlinePayload, 'resolvedToolNamesTruncated'),
      ...optionalSafeNameArrayCandidate(record.inlinePayload, 'disclosedCapabilityNames'),
      ...optionalSafeNameArrayCandidate(record.inlinePayload, 'resolvedToolNames'),
      ...optionalLowCandidate(record.inlinePayload, 'finishReason'),
      ...optionalLowCandidate(record.inlinePayload, 'safeErrorCategory'),
    ]),
  });
}

function modelFirstVisibleObservation(record: TimelineObservationRecord, startedAt?: number): ObservabilityObservationEvent {
  return createObservationEvent({
    spanOwner: 'TIMELINE_LIFECYCLE',
    boundary: 'model_invocation',
    operation: 'MODEL_STREAM_FIRST_VISIBLE_CONTENT',
    outcome: 'success',
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    ...(startedAt === undefined ? {} : { durationMs: Math.max(0, Number(record.createdAt) - startedAt) }),
    safeSummary: 'Model stream reached first visible content.',
    stableRefs: baseRefs(record),
    diagnosticSnapshot: timelineDiagnosticSnapshot(record, [
      ...persistenceCandidate(record),
      ...optionalLowCandidate(record.inlinePayload, 'stepId'),
    ]),
  });
}

function requestFirstContentDeliveredObservation(record: TimelineObservationRecord, acceptedAt: number): ObservabilityObservationEvent {
  return createObservationEvent({
    spanOwner: 'TIMELINE_LIFECYCLE',
    boundary: 'request_lifecycle',
    operation: 'REQUEST_FIRST_CONTENT_DELIVERED',
    outcome: 'success',
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    durationMs: Math.max(0, Number(record.createdAt) - acceptedAt),
    safeSummary: 'Request reached first content delivery.',
    stableRefs: baseRefs(record),
    diagnosticSnapshot: timelineDiagnosticSnapshot(record, [...persistenceCandidate(record)]),
  });
}

function capabilityStartedObservationFromTimeline(record: TimelineObservationRecord): ObservabilityObservationEvent | undefined {
  const toolCallId = readAnyString(record.inlinePayload, 'toolCallId');
  const capabilityId = readAnyString(record.inlinePayload, 'capabilityId');
  if (toolCallId === undefined || capabilityId === undefined) {
    return undefined;
  }
  return createObservationEvent({
    spanOwner: 'TIMELINE_LIFECYCLE',
    boundary: 'capability_invocation',
    operation: 'CAPABILITY_STARTED',
    outcome: 'success',
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    safeSummary: 'Capability invocation started.',
    stableRefs: { ...baseRefs(record), capabilityInvocationId: brand<string, 'CapabilityInvocationId'>(toolCallId) },
    diagnosticSnapshot: {
      ...timelineDiagnosticSnapshot(record, [
        ...persistenceCandidate(record),
        lowCandidate('capabilityId', capabilityId),
        lowCandidate('toolCallId', toolCallId),
        ...optionalLowCandidate(record.inlinePayload, 'toolBatchSizeBucket'),
        ...optionalLowCandidate(record.inlinePayload, 'toolBatchExecutionMode'),
      ]),
      capabilityInvocationId: brand<string, 'CapabilityInvocationId'>(toolCallId),
    },
  });
}

function simpleTimelineObservation(
  record: TimelineObservationRecord,
  boundary: ObservabilityObservationEvent['boundary'],
  operation: string,
  outcome: ObservabilityObservationEvent['outcome'],
  safeSummary: string,
  safeReasonCode?: string,
): ObservabilityObservationEvent {
  return createObservationEvent({
    boundary,
    operation,
    outcome,
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    safeSummary,
    ...(safeReasonCode === undefined ? {} : { safeReasonCode }),
    stableRefs: baseRefs(record),
    diagnosticSnapshot: timelineDiagnosticSnapshot(record, [
      ...persistenceCandidate(record),
      ...optionalLowCandidate(record.inlinePayload, 'status'),
      ...optionalLowCandidate(record.inlinePayload, 'decision'),
      ...optionalLowCandidate(record.inlinePayload, 'stage'),
      ...optionalLowCandidate(record.inlinePayload, 'kind'),
    ]),
  });
}

function capabilityObservationFromTimeline(record: TimelineObservationRecord): ObservabilityObservationEvent | undefined {
  const status = readString(record.inlinePayload, 'status');
  const toolCallId = readString(record.inlinePayload, 'toolCallId');
  const capabilityId = readString(record.inlinePayload, 'capabilityId');
  if (status === undefined || toolCallId === undefined || capabilityId === undefined) {
    return undefined;
  }
  const safeErrorCategory = readString(record.inlinePayload, 'safeErrorCategory');
  const safeErrorCode = readString(record.inlinePayload, 'safeErrorCode');
  const reasonCode = readString(record.inlinePayload, 'reasonCode');
  const toolSafeSummary = readOptionalSafeSummary(record.inlinePayload);
  const durationMs = readNonNegativeNumber(record.inlinePayload, 'durationMs');
  const terminal = capabilityTerminalClassification(status, safeErrorCode, safeErrorCategory);
  return createObservationEvent({
    spanOwner: 'TIMELINE_LIFECYCLE',
    boundary: 'capability_invocation',
    operation: terminal.operation,
    outcome: terminal.outcome,
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    ...(durationMs === undefined ? {} : { durationMs }),
    safeSummary: toolSafeSummary ?? (terminal.outcome === 'success' ? 'Capability invocation completed.' : 'Capability boundary failed.'),
    ...(safeErrorCode === undefined ? {} : { safeReasonCode: safeErrorCode }),
    stableRefs: {
      ...baseRefs(record),
      capabilityInvocationId: brand<string, 'CapabilityInvocationId'>(toolCallId),
    },
    diagnosticSnapshot: {
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      sessionId: record.sessionId,
      requestRunId: record.runId,
      requestContextId: record.requestContextId,
      timelineEventId: record.eventId,
      capabilityInvocationId: brand<string, 'CapabilityInvocationId'>(toolCallId),
      diagnosticCandidates: [
        ...persistenceCandidate(record),
        { key: 'capabilityId', value: capabilityId, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'toolCallId', value: toolCallId, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'status', value: status, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        ...optionalLowCandidate(record.inlinePayload, 'argumentProjectionStatus'),
        ...optionalLowCandidate(record.inlinePayload, 'resultProjectionStatus'),
        ...optionalLowCandidate(record.inlinePayload, 'validatedArgumentNamesTruncated'),
        ...optionalLowCandidate(record.inlinePayload, 'validatedResultFieldNamesTruncated'),
        ...optionalSafeNameArrayCandidate(record.inlinePayload, 'validatedArgumentNames'),
        ...optionalSafeNameArrayCandidate(record.inlinePayload, 'validatedResultFieldNames'),
        ...optionalSafeNameArrayCandidate(record.inlinePayload, 'generatedMessageKinds'),
        ...optionalSafeNameArrayCandidate(record.inlinePayload, 'contextPatchFields'),
        ...toolDiagnosticCandidates(record.inlinePayload),
        ...(reasonCode === undefined
          ? []
          : [{ key: 'reasonCode', value: reasonCode, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const }]),
        ...(safeErrorCategory === undefined
          ? []
          : [{ key: 'safeErrorCategory', value: safeErrorCategory, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const }]),
      ],
    },
  });
}

function policyObservationFromTimeline(record: TimelineObservationRecord): ObservabilityObservationEvent | undefined {
  const outcome = readPolicyOutcome(record.inlinePayload);
  const operationKind = readStringValue(record.inlinePayload, 'operationKind');
  const operationId = readStringValue(record.inlinePayload, 'operationId');
  const reasonCode = readStringValue(record.inlinePayload, 'reasonCode');
  const riskLevel = readStringValue(record.inlinePayload, 'riskLevel');
  if (outcome !== undefined && operationKind !== undefined && operationId !== undefined && reasonCode !== undefined && riskLevel !== undefined) {
    const operation =
      outcome === 'ALLOW' ? 'POLICY_ALLOWED' : outcome === 'DENY' || outcome === 'REQUIRE_AUTHORIZATION' ? 'POLICY_DENIED' : 'POLICY_FAILED';
    return createObservationEvent({
      boundary: 'system',
      operation,
      outcome: policyObservationOutcome(outcome),
      ownerScope: ownerScope(record),
      occurredAt: record.createdAt,
      safeSummary: 'Risk policy outcome applied.',
      safeReasonCode: reasonCode,
      stableRefs: baseRefs(record),
      diagnosticSnapshot: {
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        agentVersion: record.agentVersion,
        sessionId: record.sessionId,
        requestRunId: record.runId,
        requestContextId: record.requestContextId,
        timelineEventId: record.eventId,
        diagnosticCandidates: [
          ...persistenceCandidate(record),
          { key: 'operationKind', value: operationKind, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'operationId', value: operationId, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'riskLevel', value: riskLevel, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'policyOutcome', value: outcome, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ...optionalDiagnosticCandidate(record.inlinePayload, 'capabilityId'),
          ...optionalDiagnosticCandidate(record.inlinePayload, 'toolCallId'),
        ],
      },
    });
  }

  const policyDomain = readString(record.inlinePayload, 'policyDomain');
  const fallbackOutcome = readString(record.inlinePayload, 'outcome');
  const legacyReasonCode = readString(record.inlinePayload, 'reasonCode');
  if (policyDomain === undefined || fallbackOutcome === undefined || legacyReasonCode === undefined) {
    return undefined;
  }
  return createObservationEvent({
    boundary: 'request_lifecycle',
    operation: 'POLICY_APPLIED',
    outcome: policyObservationOutcome(fallbackOutcome),
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    safeSummary: 'Policy outcome recorded safely.',
    safeReasonCode: legacyReasonCode,
    stableRefs: baseRefs(record),
    diagnosticSnapshot: {
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      sessionId: record.sessionId,
      requestRunId: record.runId,
      requestContextId: record.requestContextId,
      timelineEventId: record.eventId,
      diagnosticCandidates: [
        ...persistenceCandidate(record),
        { key: 'policyDomain', value: policyDomain, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'outcome', value: fallbackOutcome, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
      ],
    },
  });
}

function hookObservationFromTimeline(record: TimelineObservationRecord): ObservabilityObservationEvent | undefined {
  const hookId = readStringValue(record.inlinePayload, 'hookId');
  const stage = readStringValue(record.inlinePayload, 'stage');
  const status = readStringValue(record.inlinePayload, 'status');
  const hookInvocationId = readStringValue(record.inlinePayload, 'hookInvocationId');
  if (hookId === undefined || stage === undefined || status === undefined || hookInvocationId === undefined) {
    return undefined;
  }
  const outcome = readStringValue(record.inlinePayload, 'outcome');
  const diagnosticCode = readStringValue(record.inlinePayload, 'diagnosticCode');
  const safeErrorCode = readStringValue(record.inlinePayload, 'safeErrorCode');
  const durationMs = readNonNegativeNumber(record.inlinePayload, 'durationMs');
  return createObservationEvent({
    boundary: 'system',
    operation: 'HOOK_INVOKED',
    outcome: hookObservationOutcome(status, outcome),
    ownerScope: ownerScope(record),
    occurredAt: record.createdAt,
    ...(durationMs === undefined ? {} : { durationMs }),
    safeSummary: status === 'SUCCESS' ? 'Lifecycle hook completed.' : 'Lifecycle hook failed.',
    ...(diagnosticCode !== undefined ? { safeReasonCode: diagnosticCode } : safeErrorCode !== undefined ? { safeReasonCode: safeErrorCode } : {}),
    stableRefs: {
      ...baseRefs(record),
      auditEventId: hookInvocationId,
    },
    diagnosticSnapshot: {
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      sessionId: record.sessionId,
      requestRunId: record.runId,
      requestContextId: record.requestContextId,
      timelineEventId: record.eventId,
      diagnosticCandidates: [
        ...persistenceCandidate(record),
        { key: 'hookId', value: hookId, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'stage', value: stage, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'status', value: status, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        ...optionalDiagnosticCandidate(record.inlinePayload, 'kind'),
        ...optionalDiagnosticCandidate(record.inlinePayload, 'executionStrategy'),
        ...optionalDiagnosticCandidate(record.inlinePayload, 'outcome'),
        ...optionalDiagnosticCandidate(record.inlinePayload, 'diagnosticCode'),
        ...optionalHookCountCandidate(record.inlinePayload, 'candidateCount'),
        ...optionalHookCountCandidate(record.inlinePayload, 'detailCount'),
        ...optionalHookContextDispositionCandidate(record.inlinePayload),
        ...optionalDiagnosticCandidate(record.inlinePayload, 'mutationSummary'),
      ],
    },
  });
}

function baseRefs(record: TimelineObservationRecord) {
  return {
    auditEventId: `audit:${record.eventId}`,
    sessionId: record.sessionId,
    requestRunId: record.runId,
    requestContextId: record.requestContextId,
    requestId: record.requestId,
    timelineEventId: record.eventId,
  };
}

function ownerScope(record: TimelineObservationRecord) {
  return {
    tenantId: record.tenantId,
    subjectId: record.subjectId,
    agentId: record.agentId,
    agentVersion: record.agentVersion,
  };
}

function persistenceCandidate(record: TimelineObservationRecord) {
  return record.persistence === undefined
    ? []
    : [{ key: 'persistence', value: record.persistence, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const }];
}

function toolDiagnosticCandidates(payload: JsonObject): readonly DiagnosticCandidate[] {
  const value = payload['toolDiagnostics'];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): DiagnosticCandidate[] => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const key = candidate['key'];
    const diagnosticValue = candidate['value'];
    if (typeof key !== 'string' || typeof diagnosticValue !== 'string') {
      return [];
    }
    if (!isAllowedToolDiagnosticKey(key) || !isSafeLowCardinalityToolDiagnosticValue(diagnosticValue)) {
      return [];
    }
    return [{ key, value: diagnosticValue, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }];
  });
}

function isAllowedToolDiagnosticKey(key: string): boolean {
  return (
    key === 'toolResultStatus' ||
    key === 'toolResultCountBucket' ||
    key === 'reasonCode' ||
    key === 'toolArgumentLoggingMode' ||
    key === 'grepOutputMode' ||
    key === 'ragIndexCountBucket' ||
    key === 'ragTopKBucket'
  );
}

function isSafeLowCardinalityToolDiagnosticValue(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.+-]+$/u.test(value);
}

function readString(
  payload: JsonObject,
  key: 'status' | 'toolCallId' | 'capabilityId' | 'safeErrorCategory' | 'safeErrorCode' | 'policyDomain' | 'outcome' | 'reasonCode',
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringValue(
  payload: JsonObject,
  key:
    | 'operationKind'
    | 'operationId'
    | 'reasonCode'
    | 'riskLevel'
    | 'capabilityId'
    | 'toolCallId'
    | 'hookId'
    | 'stage'
    | 'status'
    | 'hookInvocationId'
    | 'kind'
    | 'executionStrategy'
    | 'outcome'
    | 'diagnosticCode'
    | 'mutationSummary'
    | 'safeErrorCode',
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalSafeSummary(payload: JsonObject): string | undefined {
  const value = payload['toolSafeSummary'];
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
}

function readPolicyOutcome(payload: JsonObject): 'ALLOW' | 'DENY' | 'REQUIRE_AUTHORIZATION' | 'DEGRADED' | 'POLICY_FAILED' | undefined {
  const value = payload['outcome'];
  return value === 'ALLOW' || value === 'DENY' || value === 'REQUIRE_AUTHORIZATION' || value === 'DEGRADED' || value === 'POLICY_FAILED'
    ? value
    : undefined;
}

function readNonNegativeNumber(payload: JsonObject, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readAnyString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

function optionalLowCandidate(payload: JsonObject, key: string): readonly DiagnosticCandidate[] {
  const value = readAnyString(payload, key);
  return value === undefined ? [] : [lowCandidate(key, value)];
}

function renamedOptionalLowCandidate(payload: JsonObject, sourceKey: string, targetKey: string): readonly DiagnosticCandidate[] {
  const value = readAnyString(payload, sourceKey);
  return value === undefined ? [] : [lowCandidate(targetKey, value)];
}

const SAFE_NAME_ARRAY_KEYS = new Set([
  'disclosedCapabilityNames',
  'resolvedToolNames',
  'validatedArgumentNames',
  'validatedResultFieldNames',
  'generatedMessageKinds',
  'contextPatchFields',
]);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function optionalSafeNameArrayCandidate(payload: JsonObject, key: string): readonly DiagnosticCandidate[] {
  if (!SAFE_NAME_ARRAY_KEYS.has(key)) {
    return [];
  }
  const value = payload[key];
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > 4_096 ||
    value.some((item) => typeof item !== 'string' || !SAFE_NAME.test(item))
  ) {
    return [];
  }
  return [{ key, value, classification: 'SAFE', cardinality: 'LOW' }];
}

function lowCandidate(key: string, value: string | number | boolean): DiagnosticCandidate {
  return { key, value, classification: 'LOW_CARDINALITY', cardinality: 'LOW' };
}

function timelineDiagnosticSnapshot(record: TimelineObservationRecord, diagnosticCandidates: readonly DiagnosticCandidate[]) {
  return {
    tenantId: record.tenantId,
    subjectId: record.subjectId,
    agentId: record.agentId,
    agentVersion: record.agentVersion,
    sessionId: record.sessionId,
    requestRunId: record.runId,
    requestContextId: record.requestContextId,
    timelineEventId: record.eventId,
    diagnosticCandidates,
  };
}

function readModelUsage(payload: JsonObject): ObservabilityObservationEvent['usage'] | undefined {
  const value = payload['usage'];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const usage = {
    ...readUsageValue(source, 'inputTokens'),
    ...readUsageValue(source, 'outputTokens'),
    ...readUsageValue(source, 'totalTokens'),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
}

interface RequestUsageAccumulator {
  terminalModelCount: number;
  inputTokens: number;
  outputTokens: number;
  inputComplete: boolean;
  outputComplete: boolean;
  readonly terminalEventIds: Set<string>;
}

function createRequestUsageAccumulator(): RequestUsageAccumulator {
  return {
    terminalModelCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    inputComplete: true,
    outputComplete: true,
    terminalEventIds: new Set(),
  };
}

function accumulateRequestUsage(record: TimelineObservationRecord, accumulator?: RequestUsageAccumulator): void {
  if (accumulator === undefined || accumulator.terminalEventIds.has(record.eventId)) {
    return;
  }
  const stepId = readAnyString(record.inlinePayload, 'stepId');
  const modelId = readAnyString(record.inlinePayload, 'modelId');
  if (stepId === undefined || modelId === undefined) {
    return;
  }
  accumulator.terminalEventIds.add(record.eventId);
  accumulator.terminalModelCount += 1;
  const usage = readModelUsage(record.inlinePayload);
  accumulateTokenField(accumulator, 'input', usage?.inputTokens);
  accumulateTokenField(accumulator, 'output', usage?.outputTokens);
}

function accumulateTokenField(accumulator: RequestUsageAccumulator, tokenType: 'input' | 'output', value?: number): void {
  const completeKey = tokenType === 'input' ? 'inputComplete' : 'outputComplete';
  const totalKey = tokenType === 'input' ? 'inputTokens' : 'outputTokens';
  if (!accumulator[completeKey]) {
    return;
  }
  if (value === undefined || !Number.isSafeInteger(accumulator[totalKey] + value)) {
    accumulator[completeKey] = false;
    return;
  }
  accumulator[totalKey] += value;
}

function completeRequestUsage(accumulator?: RequestUsageAccumulator): ObservabilityObservationEvent['usage'] | undefined {
  if (accumulator === undefined || accumulator.terminalModelCount === 0) {
    return undefined;
  }
  const usage = {
    ...(accumulator.inputComplete ? { inputTokens: accumulator.inputTokens } : {}),
    ...(accumulator.outputComplete ? { outputTokens: accumulator.outputTokens } : {}),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function readUsageValue(source: Record<string, unknown>, key: 'inputTokens' | 'outputTokens' | 'totalTokens') {
  const value = source[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? { [key]: value } : {};
}

function modelFailureOperation(code?: string, category?: string): string {
  if (code?.includes('CREDENTIAL') === true) {
    return 'MODEL_CREDENTIAL_FAILED';
  }
  if (code?.includes('QUOTA') === true) {
    return 'MODEL_QUOTA_FAILED';
  }
  if (category === 'AUTHORIZATION' || category === 'POLICY_DENIED' || code?.includes('SECURITY') === true) {
    return 'MODEL_SECURITY_FAILED';
  }
  return 'MODEL_INVOCATION_FAILED';
}

function modelFailureOutcome(category?: string): 'failure' | 'timeout' | 'canceled' {
  if (category === 'TIMEOUT') {
    return 'timeout';
  }
  if (category === 'CANCELED') {
    return 'canceled';
  }
  return 'failure';
}

function capabilityTerminalClassification(
  status: string,
  code?: string,
  category?: string,
): {
  readonly operation: string;
  readonly outcome: ObservabilityObservationEvent['outcome'];
} {
  if (status === 'TIMED_OUT' || category === 'TIMEOUT') {
    return { operation: 'CAPABILITY_TIMED_OUT', outcome: 'timeout' };
  }
  if (category === 'CANCELED') {
    return { operation: 'CAPABILITY_CANCELED', outcome: 'canceled' };
  }
  if (category === 'POLICY_DENIED') {
    return { operation: 'CAPABILITY_POLICY_BLOCKED', outcome: 'denied' };
  }
  if (category === 'AUTHORIZATION') {
    return { operation: 'CAPABILITY_DENIED', outcome: 'denied' };
  }
  if (code?.includes('SECURITY') === true) {
    return { operation: 'CAPABILITY_SECURITY_FAILED', outcome: 'failure' };
  }
  if (status === 'FAILED') {
    return { operation: 'CAPABILITY_FAILED', outcome: 'failure' };
  }
  if (status === 'DEGRADED') {
    return { operation: 'CAPABILITY_COMPLETED', outcome: 'degraded' };
  }
  return { operation: 'CAPABILITY_COMPLETED', outcome: 'success' };
}

function modelInvocationKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`;
}

function withDuration(record: TimelineObservationRecord, startedAt: number): TimelineObservationRecord {
  return {
    ...record,
    inlinePayload: {
      ...record.inlinePayload,
      durationMs: Math.max(0, Number(record.createdAt) - startedAt),
    },
  };
}

function clearRunState(
  runId: string,
  started: Map<string, number>,
  active: Map<string, string>,
  firstVisible: Set<string>,
  firstContentDelivered: Set<string>,
): void {
  active.delete(runId);
  firstContentDelivered.delete(runId);
  const prefix = `${runId}:`;
  for (const key of started.keys()) {
    if (key.startsWith(prefix)) {
      started.delete(key);
    }
  }
  for (const key of firstVisible) {
    if (key.startsWith(prefix)) {
      firstVisible.delete(key);
    }
  }
}

function isTerminal(type: string): boolean {
  return type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED';
}

function terminalOutcome(type: string): 'success' | 'failure' | 'canceled' {
  if (type === 'REQUEST_COMPLETED') {
    return 'success';
  }
  if (type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED') {
    return 'canceled';
  }
  return 'failure';
}

function terminalStatus(type: string): string {
  if (type === 'REQUEST_COMPLETED') {
    return 'COMPLETED';
  }
  if (type === 'REQUEST_CANCELED') {
    return 'CANCELED';
  }
  if (type === 'REQUEST_SUPERSEDED') {
    return 'SUPERSEDED';
  }
  return 'FAILED';
}

function terminalReasonCode(type: string): string {
  return `TERMINAL_${terminalStatus(type)}`;
}

function policyObservationOutcome(outcome: string): ObservabilityObservationEvent['outcome'] {
  if (outcome === 'ALLOW') {
    return 'success';
  }
  if (outcome === 'DENY' || outcome === 'REQUIRE_AUTHORIZATION') {
    return 'denied';
  }
  if (outcome === 'DEGRADED') {
    return 'degraded';
  }
  if (outcome === 'degraded') {
    return 'degraded';
  }
  if (outcome === 'rejected' || outcome === 'constraint-rejected' || outcome === 'fallback-denied') {
    return 'denied';
  }
  return outcome === 'POLICY_FAILED' ? 'failure' : 'success';
}

function hookObservationOutcome(status: string, outcome?: string): 'success' | 'failure' | 'timeout' | 'denied' {
  if (status === 'TIMEOUT') {
    return 'timeout';
  }
  if (status !== 'SUCCESS') {
    return 'failure';
  }
  if (outcome === 'DENY' || outcome === 'BLOCK' || outcome === 'PEND') {
    return 'denied';
  }
  return 'success';
}

function optionalDiagnosticCandidate(
  payload: JsonObject,
  key: 'capabilityId' | 'toolCallId' | 'kind' | 'executionStrategy' | 'outcome' | 'diagnosticCode' | 'mutationSummary',
) {
  const value = readStringValue(payload, key);
  return value === undefined ? [] : [{ key, value, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const }];
}

function optionalHookCountCandidate(payload: JsonObject, key: 'candidateCount' | 'detailCount'): readonly DiagnosticCandidate[] {
  const value = payload[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10 ? [lowCandidate(key, value)] : [];
}

function optionalHookContextDispositionCandidate(payload: JsonObject): readonly DiagnosticCandidate[] {
  const value = payload['contextDisposition'];
  return value === 'L2_CONTEXT' || value === 'L1_CONTEXT' || value === 'NO_CONTEXT' ? [lowCandidate('contextDisposition', value)] : [];
}
