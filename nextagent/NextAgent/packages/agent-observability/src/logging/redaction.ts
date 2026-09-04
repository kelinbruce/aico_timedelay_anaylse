import type { JsonObject } from '@nextagent/agent-common';
import type { DiagnosticCandidate, ObservabilityContext } from '../linking/context.js';
import { createObservationEvent, type ObservabilityObservationEvent, type StableObservationRefs } from '../linking/observation.js';

export type SensitiveCategory =
  | 'SECRET'
  | 'RAW_PROMPT'
  | 'RAW_MODEL_OUTPUT'
  | 'THINKING'
  | 'TOOL_PAYLOAD'
  | 'ATTACHMENT_CONTENT'
  | 'PROVIDER_RAW_BODY'
  | 'PATH'
  | 'HIDDEN_HISTORY'
  | 'OWNER_EXISTENCE_DETAIL'
  | 'HIGH_CARDINALITY';

export type RedactionAction = 'SAFE_VALUE' | 'MASKED_VALUE' | 'SAFE_SUMMARY' | 'REF_ONLY' | 'REASON_CODE_ONLY' | 'OMITTED_BY_POLICY';

export interface RedactionEvidence {
  readonly key: string;
  readonly action: RedactionAction;
  readonly categories: readonly SensitiveCategory[];
}

const allowedRefKeys = new Set<keyof StableObservationRefs>([
  'sessionId',
  'requestRunId',
  'requestContextId',
  'requestId',
  'messageId',
  'timelineEventId',
  'capabilityInvocationId',
  'auditEventId',
]);

const bannedKeyPattern =
  /(?:rawPrompt|promptMessages|rawThinking|thinking|reasoning|rawModelOutput|modelDelta|toolArgs|toolResult|arguments|resultPayload|capabilityResult|attachmentBody|attachmentContent|fileContent|rawProvider|providerBody|rawBody|rawGatewayError|stack|localPath|remotePath|urlPath|path|sql|header|authorization|secret|accessToken|authToken|apiToken|refreshToken|credential|password|apiKey|cookie|hiddenHistory|freeTextReason|ownerPrivate|traceId|spanId|traceContext)/iu;
const lowCardinalityPattern = /^[A-Z0-9_.:-]{1,128}$/iu;
const safeNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const boundedArrayCandidateKeys = new Set([
  'disclosedCapabilityNames',
  'resolvedToolNames',
  'validatedArgumentNames',
  'validatedResultFieldNames',
  'generatedMessageKinds',
  'contextPatchFields',
]);

export function sanitizeObservation(event: ObservabilityObservationEvent): ObservabilityObservationEvent {
  const safe: ObservabilityObservationEvent = {
    ...(event.spanOwner === undefined ? {} : { spanOwner: event.spanOwner }),
    boundary: event.boundary,
    operation: sanitizeLowCardinality('operation', event.operation),
    outcome: event.outcome,
    ownerScope: event.ownerScope,
    occurredAt: event.occurredAt,
    ...(event.durationMs === undefined ? {} : { durationMs: sanitizeDuration(event.durationMs) }),
    ...(event.firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs: sanitizeDuration(event.firstContentLatencyMs) }),
    ...(event.usage === undefined ? {} : { usage: sanitizeUsage(event.usage) }),
    ...(event.safeSummary === undefined ? {} : { safeSummary: sanitizeSummary(event.safeSummary) }),
    ...(event.safeReasonCode === undefined ? {} : { safeReasonCode: sanitizeLowCardinality('safeReasonCode', event.safeReasonCode) }),
    ...(event.stableRefs === undefined ? {} : { stableRefs: sanitizeStableRefs(event.stableRefs) }),
    ...(event.diagnosticSnapshot === undefined ? {} : { diagnosticSnapshot: sanitizeDiagnosticSnapshot(event.diagnosticSnapshot) }),
  };
  return createObservationEvent(safe);
}

function sanitizeStableRefs(refs: StableObservationRefs): StableObservationRefs {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(refs)) {
    if (!allowedRefKeys.has(key as keyof StableObservationRefs) || typeof value !== 'string' || !isBoundedRef(value)) {
      continue;
    }
    safe[key] = value;
  }
  return safe as StableObservationRefs;
}

function sanitizeDiagnosticSnapshot(snapshot: ObservabilityContext): ObservabilityContext {
  return {
    ...(snapshot.tenantId === undefined ? {} : { tenantId: snapshot.tenantId }),
    ...(snapshot.subjectId === undefined ? {} : { subjectId: snapshot.subjectId }),
    ...(snapshot.agentId === undefined ? {} : { agentId: snapshot.agentId }),
    ...(snapshot.agentVersion === undefined ? {} : { agentVersion: snapshot.agentVersion }),
    ...(snapshot.sessionId === undefined ? {} : { sessionId: snapshot.sessionId }),
    ...(snapshot.requestRunId === undefined ? {} : { requestRunId: snapshot.requestRunId }),
    ...(snapshot.requestContextId === undefined ? {} : { requestContextId: snapshot.requestContextId }),
    ...(snapshot.messageId === undefined ? {} : { messageId: snapshot.messageId }),
    ...(snapshot.timelineEventId === undefined ? {} : { timelineEventId: snapshot.timelineEventId }),
    ...(snapshot.capabilityInvocationId === undefined ? {} : { capabilityInvocationId: snapshot.capabilityInvocationId }),
    ...(snapshot.diagnosticCandidates === undefined ? {} : { diagnosticCandidates: sanitizeCandidates(snapshot.diagnosticCandidates) }),
  };
}

function sanitizeCandidates(candidates: readonly DiagnosticCandidate[]): readonly DiagnosticCandidate[] {
  const safe: DiagnosticCandidate[] = [];
  for (const candidate of candidates) {
    if (!isSafeCandidateKey(candidate.key) || candidate.classification === 'SENSITIVE') {
      continue;
    }
    const value = sanitizeCandidateValue(candidate);
    if (value === undefined) {
      continue;
    }
    safe.push({ ...candidate, value });
  }
  return safe;
}

function sanitizeCandidateValue(candidate: DiagnosticCandidate): DiagnosticCandidate['value'] | undefined {
  const value = candidate.value;
  if (Array.isArray(value)) {
    if (
      !boundedArrayCandidateKeys.has(candidate.key) ||
      value.length > 100 ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 4_096 ||
      value.some((item) => typeof item !== 'string' || !safeNamePattern.test(item))
    ) {
      return undefined;
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('Diagnostic candidate value has an unsupported runtime type.');
  }
  if (candidate.classification === 'HIGH_CARDINALITY' || candidate.cardinality === 'HIGH') {
    return isBoundedRef(value) && !containsBannedValue(value) ? value : undefined;
  }
  if (candidate.key === 'route') {
    return /^\/[A-Za-z0-9_/:.-]{1,160}$/u.test(value) ? value : undefined;
  }
  if (candidate.classification === 'LOW_CARDINALITY' || candidate.cardinality === 'LOW') {
    return lowCardinalityPattern.test(value) ? value : undefined;
  }
  if (containsBannedValue(value)) {
    return undefined;
  }
  return value.length <= 256 ? value : value.slice(0, 256);
}

function sanitizeUsage(usage: ObservabilityObservationEvent['usage']): NonNullable<ObservabilityObservationEvent['usage']> {
  const safe: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  if (usage?.inputTokens !== undefined && isNonNegativeInteger(usage.inputTokens)) {
    safe.inputTokens = usage.inputTokens;
  }
  if (usage?.outputTokens !== undefined && isNonNegativeInteger(usage.outputTokens)) {
    safe.outputTokens = usage.outputTokens;
  }
  if (usage?.totalTokens !== undefined && isNonNegativeInteger(usage.totalTokens)) {
    safe.totalTokens = usage.totalTokens;
  }
  return safe;
}

function sanitizeDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('Observation duration must be a non-negative finite number.');
  }
  return durationMs;
}

function sanitizeSummary(value: string): string {
  if (lowCardinalityPattern.test(value)) {
    return value;
  }
  if (containsBannedValue(value) && !looksMaskedSummary(value)) {
    return 'REDACTED_BY_POLICY';
  }
  return value.length <= 512 ? value : value.slice(0, 512);
}

function sanitizeLowCardinality(field: string, value: string): string {
  if (!lowCardinalityPattern.test(value)) {
    throw new Error(`Observation ${field} must be a stable low-cardinality token.`);
  }
  return value;
}

function isSafeCandidateKey(key: string): boolean {
  return lowCardinalityPattern.test(key) && !bannedKeyPattern.test(key);
}

function isBoundedRef(value: string): boolean {
  return /^[A-Z0-9_.:-]{1,160}$/iu.test(value);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function containsBannedValue(value: string): boolean {
  return bannedKeyPattern.test(value) || /([A-Za-z]:\\|\/[^\s]+\/|Bearer\s+|env:[A-Z0-9_]+)/u.test(value);
}

function looksMaskedSummary(value: string): boolean {
  return value.includes('****') && !/[\r\n\t]/u.test(value) && value.length <= 512;
}

export function assertSanitizedObservation(event: ObservabilityObservationEvent): void {
  assertNoRawPayload(event as unknown as JsonObject, '');
}

function assertNoRawPayload(value: JsonObject, parentKey: string): void {
  for (const [key, candidate] of Object.entries(value)) {
    if (bannedKeyPattern.test(key)) {
      throw new Error('Sanitized observation cannot carry raw or dynamic payload fields.');
    }
    if (typeof candidate === 'string') {
      if (
        lowCardinalityPattern.test(candidate) ||
        parentKey === 'safeReasonCode' ||
        parentKey === 'operation' ||
        key === 'safeReasonCode' ||
        key === 'operation'
      ) {
        continue;
      }
      if (containsBannedValue(candidate) && !looksMaskedSummary(candidate)) {
        throw new Error('Sanitized observation cannot carry raw or dynamic payload fields.');
      }
      continue;
    }
    if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
      assertNoRawPayload(candidate as JsonObject, key);
    }
  }
}
