import type { StreamEnvelope, StreamEventType } from '../../../state/contracts.ts';
import { buildInputSegmentByEnvelope, getEnvelopeAttemptId, getEnvelopeRootMessageId } from './streamingHelpers.ts';
import { isResultStreamEvent, mergeStreamText, readCompactedEventCount, readPayloadMetadata, readStreamText } from './streamTextSemantics.ts';

export const FRONTEND_COMPACTED_HINT = 'frontend-compacted';

const COMPACTABLE_EVENT_TYPES = new Set<StreamEventType>(['LLM_CONTENT_DELTA', 'LLM_THINKING_DELTA', 'CAPABILITY_RESULT_DELTA']);

const MERGE_SAFE_CAPABILITY_PAYLOAD_KEYS = new Set([
  'rootMessageId',
  'requestId',
  'requestContextId',
  'runId',
  'toolCallId',
  'invocationId',
  'capabilityId',
  'contentRef',
  'toolCallIndex',
  'text',
  'content',
  'delta',
  'progress',
  'result',
  'message',
  'reason',
  'contentType',
  'accumulated',
  'compactedEventCount',
  'metadata',
]);

const MERGE_SAFE_CAPABILITY_METADATA_KEYS = new Set([
  'accumulated',
  'invocationId',
  'frontendCompacted',
  'compactedEventCount',
  'compactedFromSequence',
  'compactedThroughSequence',
]);

const CAPABILITY_TEXT_FIELDS = new Set(['text', 'content', 'delta', 'progress', 'result', 'message', 'reason']);

interface CompactionLane {
  readonly key: string;
  readonly eventType: StreamEventType;
  readonly first: StreamEnvelope;
  last: StreamEnvelope;
  text: string;
  compactedEventCount: number;
}

type CompactionOutputItem = { readonly kind: 'preserved'; readonly envelope: StreamEnvelope } | { readonly kind: 'lane'; readonly key: string };

function isAssistantAnswerEvent(event: StreamEnvelope): boolean {
  return event.eventType === 'LLM_CONTENT_DELTA' && (event.payload as Record<string, unknown>).role !== 'CAPABILITY_RESULT';
}

function hasOnlyMergeSafeCapabilityPayload(event: StreamEnvelope): boolean {
  if (event.eventType !== 'CAPABILITY_RESULT_DELTA') {
    return true;
  }

  const payload = event.payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(payload)) {
    if (!MERGE_SAFE_CAPABILITY_PAYLOAD_KEYS.has(key)) {
      return false;
    }
    if (CAPABILITY_TEXT_FIELDS.has(key) && typeof value !== 'string') {
      return false;
    }
  }

  const metadata = readPayloadMetadata(payload);
  return metadata === null || Object.keys(metadata).every((key) => MERGE_SAFE_CAPABILITY_METADATA_KEYS.has(key));
}

function isCompactableEvent(event: StreamEnvelope): boolean {
  return (
    COMPACTABLE_EVENT_TYPES.has(event.eventType) &&
    hasOnlyMergeSafeCapabilityPayload(event) &&
    readStreamText(event, undefined, { allowWhitespaceOnly: isResultStreamEvent(event) }).length > 0
  );
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readToolCallIndex(payload: Record<string, unknown>): string | null {
  const value = payload.toolCallIndex;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function hasCapabilityExecutionIdentity(payload: Record<string, unknown>): boolean {
  return Boolean(
    readPayloadString(payload, 'toolCallId') ??
    readPayloadString(payload, 'capabilityId') ??
    readPayloadString(payload, 'invocationId') ??
    readPayloadString(payload, 'contentRef') ??
    readPayloadString(readPayloadMetadata(payload) ?? {}, 'invocationId'),
  );
}

function readCapabilityCorrelationId(event: StreamEnvelope): string {
  const payload = event.payload as Record<string, unknown>;
  const metadata = readPayloadMetadata(payload);
  return (
    readPayloadString(payload, 'toolCallId') ??
    readPayloadString(payload, 'invocationId') ??
    readPayloadString(metadata ?? {}, 'invocationId') ??
    readPayloadString(payload, 'capabilityId') ??
    readPayloadString(payload, 'contentRef') ??
    event.eventId
  );
}

function readLaneBaseScope(event: StreamEnvelope): string {
  return `${getEnvelopeRootMessageId(event)}:${getEnvelopeAttemptId(event)}`;
}

function readBaseLaneKey(event: StreamEnvelope, inputSegment: number): string | null {
  const payload = event.payload as Record<string, unknown>;
  const scope = readLaneBaseScope(event);

  if (isAssistantAnswerEvent(event)) {
    const stepId = readPayloadString(payload, 'stepId');
    return stepId === null ? `answer:${scope}:input:${inputSegment}` : `answer:${scope}:step:${stepId}:input:${inputSegment}`;
  }
  if (event.eventType === 'LLM_THINKING_DELTA') {
    return `thinking:${scope}`;
  }
  if (event.eventType === 'CAPABILITY_RESULT_DELTA') {
    const toolCallIndex = readToolCallIndex(payload);
    if (toolCallIndex !== null && !hasCapabilityExecutionIdentity(payload)) {
      return `tool-args:${scope}:tool-index:${toolCallIndex}`;
    }
    return `capability:${scope}:${readCapabilityCorrelationId(event)}`;
  }
  return null;
}

function shouldSegmentOnSequenceGap(eventType: StreamEventType): boolean {
  return eventType === 'LLM_THINKING_DELTA' || eventType === 'CAPABILITY_RESULT_DELTA';
}

function readLaneKey(
  event: StreamEnvelope,
  inputSegment: number,
  lanes: Map<string, CompactionLane>,
  activeLaneKeyByBase: Map<string, string>,
): string | null {
  const baseKey = readBaseLaneKey(event, inputSegment);
  if (!baseKey) {
    return null;
  }
  if (!shouldSegmentOnSequenceGap(event.eventType)) {
    return baseKey;
  }
  const activeLaneKey = activeLaneKeyByBase.get(baseKey) ?? baseKey;
  const activeLane = lanes.get(activeLaneKey);
  if (!activeLane || event.sequence === activeLane.last.sequence + 1) {
    return activeLaneKey;
  }
  return `${baseKey}:seg:${event.sequence}`;
}

function sanitizeEventIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 96);
}

function buildTransportHints(event: StreamEnvelope): string[] {
  return event.transportHints.includes(FRONTEND_COMPACTED_HINT) ? [...event.transportHints] : [...event.transportHints, FRONTEND_COMPACTED_HINT];
}

function buildCompactedPayload(lane: CompactionLane): StreamEnvelope['payload'] {
  const payload = { ...(lane.last.payload as Record<string, unknown>) };
  const metadata = {
    ...(readPayloadMetadata(payload) ?? {}),
    accumulated: true,
    frontendCompacted: true,
    compactedEventCount: lane.compactedEventCount,
    compactedFromSequence: lane.first.sequence,
    compactedThroughSequence: lane.last.sequence,
  };

  payload.text = lane.text;
  payload.accumulated = true;
  payload.compactedEventCount = lane.compactedEventCount;
  payload.metadata = metadata;
  delete payload.delta;
  delete payload.progress;
  delete payload.result;

  if (!payload.contentType) {
    payload.contentType = lane.eventType === 'LLM_CONTENT_DELTA' ? 'MARKDOWN' : 'PLAIN_TEXT';
  }
  if (lane.eventType === 'LLM_CONTENT_DELTA' && !payload.role) {
    payload.role = 'ASSISTANT';
  }

  return payload as StreamEnvelope['payload'];
}

function toCompactedEnvelope(lane: CompactionLane): StreamEnvelope {
  return {
    ...lane.last,
    eventId: `frontend-compact:${sanitizeEventIdPart(lane.key)}:${lane.first.sequence}-${lane.last.sequence}`,
    sequence: lane.last.sequence,
    eventType: lane.eventType,
    timelineEventRef: lane.last.timelineEventRef ?? null,
    transportHints: buildTransportHints(lane.last),
    payload: buildCompactedPayload(lane),
    createdAt: lane.last.createdAt,
  } as StreamEnvelope;
}

function compactEnvelopePrefix(envelopes: readonly StreamEnvelope[]): StreamEnvelope[] {
  const inputSegmentByEnvelope = buildInputSegmentByEnvelope(envelopes);
  const lanes = new Map<string, CompactionLane>();
  const activeLaneKeyByBase = new Map<string, string>();
  const outputItems: CompactionOutputItem[] = [];

  for (const envelope of envelopes) {
    if (!isCompactableEvent(envelope)) {
      outputItems.push({ kind: 'preserved', envelope });
      continue;
    }

    const inputSegment = inputSegmentByEnvelope.get(envelope) ?? 0;
    const baseLaneKey = readBaseLaneKey(envelope, inputSegment);
    const laneKey = readLaneKey(envelope, inputSegment, lanes, activeLaneKeyByBase);
    if (!laneKey) {
      outputItems.push({ kind: 'preserved', envelope });
      continue;
    }
    if (baseLaneKey) {
      activeLaneKeyByBase.set(baseLaneKey, laneKey);
    }

    const payload = envelope.payload as Record<string, unknown>;
    const text = readStreamText(envelope, undefined, { allowWhitespaceOnly: isResultStreamEvent(envelope) });
    const existingLane = lanes.get(laneKey);
    if (!existingLane) {
      outputItems.push({ kind: 'lane', key: laneKey });
      lanes.set(laneKey, {
        key: laneKey,
        eventType: envelope.eventType,
        first: envelope,
        last: envelope,
        text,
        compactedEventCount: readCompactedEventCount(envelope),
      });
      continue;
    }

    existingLane.text = mergeStreamText(existingLane.text, text, payload);
    existingLane.last = envelope;
    existingLane.compactedEventCount += readCompactedEventCount(envelope);
  }

  return outputItems.map((item) => {
    if (item.kind === 'preserved') {
      return item.envelope;
    }
    const lane = lanes.get(item.key)!;
    return lane.first === lane.last ? lane.first : toCompactedEnvelope(lane);
  });
}

function deduplicateByEventId(envelopes: readonly StreamEnvelope[]): StreamEnvelope[] {
  const seen = new Set<string>();
  const deduplicated: StreamEnvelope[] = [];
  for (const envelope of envelopes) {
    if (seen.has(envelope.eventId)) {
      continue;
    }
    seen.add(envelope.eventId);
    deduplicated.push(envelope);
  }
  return deduplicated;
}

export function compactLiveEnvelopes(envelopes: readonly StreamEnvelope[], watermark: number): StreamEnvelope[] {
  if (watermark <= 0 || envelopes.length < watermark) {
    return [...envelopes];
  }

  return deduplicateByEventId(compactEnvelopePrefix(envelopes));
}
