import { type StreamEnvelope } from '../../../state/contracts.ts';

export type EnvelopesBySession = Readonly<Record<string, readonly StreamEnvelope[]>>;

/** Maximum allowed sequence gap before triggering a background refresh. */
const MAX_SEQUENCE_GAP = 50;
const LOCAL_OPTIMISTIC_HINT = 'local-optimistic';
const HISTORY_LOAD_HINT = 'history-load';

function isLocalOptimisticEnvelope(envelope: StreamEnvelope): boolean {
  return envelope.transportHints.includes(LOCAL_OPTIMISTIC_HINT);
}

function isHistoryLoadedEnvelope(envelope: StreamEnvelope): boolean {
  return envelope.transportHints.includes(HISTORY_LOAD_HINT);
}

function participatesInLiveSequenceTracking(envelope: StreamEnvelope): boolean {
  return !isLocalOptimisticEnvelope(envelope) && !isHistoryLoadedEnvelope(envelope);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPayloadString(envelope: StreamEnvelope, field: string): string | null {
  return normalizeNonEmptyString((envelope.payload as Record<string, unknown> | undefined)?.[field]);
}

export function getEnvelopeRunId(envelope: StreamEnvelope): string {
  return normalizeNonEmptyString(envelope.runId) ?? readPayloadString(envelope, 'runId') ?? getEnvelopeRootMessageId(envelope);
}

export function getEnvelopeRootMessageId(envelope: StreamEnvelope): string {
  return (
    normalizeNonEmptyString(envelope.rootMessageId) ??
    readPayloadString(envelope, 'rootMessageId') ??
    readPayloadString(envelope, 'messageId') ??
    envelope.requestId
  );
}

export function getEnvelopeAttemptId(envelope: StreamEnvelope): string {
  return (
    normalizeNonEmptyString(envelope.requestContextId) ??
    readPayloadString(envelope, 'requestContextId') ??
    readPayloadString(envelope, 'attemptId') ??
    normalizeNonEmptyString(envelope.requestId) ??
    getEnvelopeRootMessageId(envelope)
  );
}

function buildInputSegmentScope(envelope: StreamEnvelope): string {
  return [envelope.sessionId, getEnvelopeRootMessageId(envelope), getEnvelopeAttemptId(envelope), getEnvelopeRunId(envelope)].join('\u0000');
}

export function buildInputSegmentByEnvelope(envelopes: readonly StreamEnvelope[]): ReadonlyMap<StreamEnvelope, number> {
  const segmentByEnvelope = new Map<StreamEnvelope, number>();
  const nextSegmentByScope = new Map<string, number>();
  const seenBoundaryIdentities = new Set<string>();
  for (const envelope of envelopes) {
    const scope = buildInputSegmentScope(envelope);
    const segment = nextSegmentByScope.get(scope) ?? 0;
    segmentByEnvelope.set(envelope, segment);
    const boundaryIdentity = buildEnvelopeIdentity(envelope);
    if (envelope.eventType === 'USER_INPUT_RECEIVED' && !seenBoundaryIdentities.has(boundaryIdentity)) {
      seenBoundaryIdentities.add(boundaryIdentity);
      nextSegmentByScope.set(scope, segment + 1);
    }
  }
  return segmentByEnvelope;
}

export function envelopeMatchesIdentity(envelope: StreamEnvelope, identity?: string | null): boolean {
  const normalizedIdentity = normalizeNonEmptyString(identity);
  if (!normalizedIdentity) {
    return false;
  }
  return (
    normalizedIdentity === envelope.requestId ||
    normalizedIdentity === getEnvelopeAttemptId(envelope) ||
    normalizedIdentity === getEnvelopeRootMessageId(envelope) ||
    normalizedIdentity === getEnvelopeRunId(envelope)
  );
}

export function buildEnvelopeIdentity(envelope: StreamEnvelope): string {
  const attemptId = getEnvelopeAttemptId(envelope);
  const normalizedEventId = envelope.eventId.trim();
  if (normalizedEventId.length > 0) {
    return `${attemptId}:${normalizedEventId}`;
  }
  return `${attemptId}:${envelope.sequence}:${envelope.eventType}`;
}

export function buildEnvelopeMergeIdentity(envelope: StreamEnvelope): string {
  const baseIdentity = `${getEnvelopeAttemptId(envelope)}:${envelope.eventType}:${envelope.sequence}`;
  if (envelope.eventType !== 'TOOL_STRUCTURED_DELTA') {
    return baseIdentity;
  }

  const payload = envelope.payload as Record<string, unknown>;
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : null;
  const correlationId = [payload.toolCallId, payload.invocationId, metadata?.invocationId, payload.capabilityId].find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  const toolEventType = normalizeNonEmptyString(payload.toolEventType) ?? 'UNKNOWN';
  return `${baseIdentity}:${toolEventType}:${typeof correlationId === 'string' ? correlationId.trim() : 'UNKNOWN'}`;
}

/**
 * Checks whether the incoming envelope has a sequence gap compared to the
 * latest known sequence for the same request. Returns the gap size if a
 * gap is detected, or 0 if sequences are contiguous.
 */
export function detectSequenceGap(sessionEnvelopes: readonly StreamEnvelope[], incomingEnvelope: StreamEnvelope): number {
  if (!participatesInLiveSequenceTracking(incomingEnvelope)) {
    return 0;
  }

  const incomingAttemptId = getEnvelopeAttemptId(incomingEnvelope);
  let maxKnownSequence = -1;
  for (const envelope of sessionEnvelopes) {
    if (!participatesInLiveSequenceTracking(envelope)) {
      continue;
    }
    if (getEnvelopeAttemptId(envelope) === incomingAttemptId && envelope.sequence > maxKnownSequence) {
      maxKnownSequence = envelope.sequence;
    }
  }
  if (maxKnownSequence < 0) {
    return 0;
  }
  return Math.max(0, incomingEnvelope.sequence - maxKnownSequence - 1);
}

/**
 * Returns true if the sequence gap exceeds the configured threshold,
 * indicating that a background conversation refresh should be triggered.
 */
export function hasSignificantSequenceGap(sessionEnvelopes: readonly StreamEnvelope[], incomingEnvelope: StreamEnvelope): boolean {
  return detectSequenceGap(sessionEnvelopes, incomingEnvelope) >= MAX_SEQUENCE_GAP;
}

export function appendEnvelope(previous: EnvelopesBySession, sessionId: string, nextEnvelope: StreamEnvelope): EnvelopesBySession {
  const current = previous[sessionId] ?? [];

  const nextIdentity = buildEnvelopeIdentity(nextEnvelope);
  const hasDuplicate = current.some((envelope) => buildEnvelopeIdentity(envelope) === nextIdentity);
  if (hasDuplicate) {
    return previous;
  }

  return {
    ...previous,
    [sessionId]: [...current, nextEnvelope],
  };
}
