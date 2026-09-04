import {
  STREAM_CONTENT_TYPES,
  STREAM_EVENT_TYPES,
  type StreamContentType,
  type StreamEnvelope,
  type StreamEventType,
} from '../../../state/contracts.ts';

const CAPABILITY_EVENT_TYPE_SET = new Set<StreamEventType>(['CAPABILITY_STARTED', 'CAPABILITY_RESULT_DELTA', 'CAPABILITY_COMPLETED']);
const RESULT_STREAM_EVENT_TYPE_SET = new Set<StreamEventType>(['LLM_THINKING_DELTA', 'LLM_CONTENT_DELTA', 'CAPABILITY_RESULT_DELTA']);
const CONTENT_TYPED_RESULT_EVENT_TYPE_SET = new Set<StreamEventType>(['LLM_CONTENT_DELTA', 'CAPABILITY_RESULT_DELTA']);
const CONTRACT_WEB_EVENT_TYPE_SET = new Set<StreamEventType>([
  'REQUEST_ACCEPTED',
  'LLM_THINKING_DELTA',
  'LLM_CONTENT_DELTA',
  'CAPABILITY_STARTED',
  'CAPABILITY_RESULT_DELTA',
  'CAPABILITY_COMPLETED',
  'ATTACHMENT_ACCEPTED',
  'ATTACHMENT_REJECTED',
  'DEGRADATION_NOTICE',
  'CONTEXT_COMPACTED',
  'HOOK_DEGRADED',
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
]);
const STREAM_EVENT_TYPE_SET = new Set<StreamEventType>(STREAM_EVENT_TYPES);
const STREAM_CONTENT_TYPE_SET = new Set<StreamContentType>(STREAM_CONTENT_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWireTimestamp(value: unknown): value is StreamEnvelope['createdAt'] {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNonEmptyStreamText(value: unknown, options: { readonly allowWhitespaceOnly?: boolean } = {}): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (options.allowWhitespaceOnly) {
    return value.length > 0 ? value : null;
  }
  return value.trim().length > 0 ? value : null;
}

function normalizeEventType(value: unknown): StreamEventType | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized || !STREAM_EVENT_TYPE_SET.has(normalized as StreamEventType)) {
    return null;
  }
  return normalized as StreamEventType;
}

function normalizeContentType(value: unknown): StreamContentType | null {
  const normalized = normalizeNonEmptyString(value)?.toUpperCase();
  if (!normalized || !STREAM_CONTENT_TYPE_SET.has(normalized as StreamContentType)) {
    return null;
  }
  return normalized as StreamContentType;
}

function normalizeMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.metadata)) {
    return { ...payload.metadata };
  }
  return {};
}

function readCapabilityCorrelationId(
  payload: Record<string, unknown>,
  options: { readonly allowToolCallIndexFallback?: boolean } = {},
): string | null {
  const metadata = normalizeMetadata(payload);
  const candidates = [payload.toolCallId, payload.invocationId, metadata.invocationId, payload.capabilityId];
  for (const candidate of candidates) {
    const normalized = normalizeNonEmptyString(candidate);
    if (normalized) {
      return normalized;
    }
  }
  if (options.allowToolCallIndexFallback) {
    const toolCallIndex = payload.toolCallIndex;
    if (typeof toolCallIndex === 'number' && Number.isInteger(toolCallIndex) && toolCallIndex >= 0) {
      return `tool-index:${toolCallIndex}`;
    }
    const normalizedToolCallIndex = normalizeNonEmptyString(toolCallIndex);
    if (normalizedToolCallIndex && /^\d+$/.test(normalizedToolCallIndex)) {
      return `tool-index:${normalizedToolCallIndex}`;
    }
  }
  return null;
}

function readResultStreamText(payload: Record<string, unknown>, options: { readonly allowWhitespaceOnly?: boolean } = {}): string | null {
  if (payload.complete === true) {
    return '';
  }
  // Allow empty delta for completion markers - some backends send LLM_CONTENT_DELTA
  // with empty text as a terminal signal when the stream is complete
  const hasDelta = payload.delta !== undefined;
  if (hasDelta && payload.delta === null) {
    return ''; // Empty string for null delta (completion marker)
  }
  return (
    normalizeNonEmptyStreamText(payload.text, options) ??
    (payload.text === '' ? '' : null) ?? // Allow empty text string
    normalizeNonEmptyStreamText(payload.content, options) ??
    (payload.content === '' ? '' : null) ?? // Allow empty content string
    normalizeNonEmptyStreamText(payload.delta, options) ??
    (payload.delta === '' ? '' : null) ?? // Allow empty delta frames
    normalizeNonEmptyStreamText(payload.progress, options) ??
    normalizeNonEmptyStreamText(payload.result, options)
  );
}

function readPayloadText(payload: Record<string, unknown>): string | null {
  return (
    readResultStreamText(payload) ??
    normalizeNonEmptyString(payload.message) ??
    normalizeNonEmptyString(payload.summary) ??
    normalizeNonEmptyString(payload.reason) ??
    normalizeNonEmptyString(payload.uiMessage)
  );
}

function readStringField(value: Record<string, unknown>, field: string): string | null {
  return normalizeNonEmptyString(value[field]);
}

function defaultTextForEvent(eventType: StreamEventType): string {
  switch (eventType) {
    case 'REQUEST_ACCEPTED':
      return 'Request accepted';
    case 'ATTACHMENT_ACCEPTED':
      return 'Attachment accepted';
    case 'ATTACHMENT_REJECTED':
      return 'Attachment rejected';
    case 'DEGRADATION_NOTICE':
      return 'Degradation notice';
    case 'CONTEXT_COMPACTED':
      return 'Context compacted';
    case 'HOOK_DEGRADED':
      return 'Hook degraded';
    case 'REQUEST_COMPLETED':
      return 'Request completed';
    case 'REQUEST_FAILED':
      return 'Request failed';
    case 'REQUEST_CANCELED':
      return 'Request canceled';
    case 'REQUEST_SUPERSEDED':
      return 'Request superseded';
    default:
      return eventType;
  }
}

export function normalizeStreamEnvelope(value: unknown): StreamEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventType = normalizeEventType(value.eventType);
  const timelineEventRef = value.timelineEventRef;
  const payload = value.payload;
  const payloadRecord = isRecord(payload) ? payload : null;
  const requestIdCandidate = normalizeNonEmptyString(value.requestId) ?? (payloadRecord ? readStringField(payloadRecord, 'requestId') : null);
  const runIdCandidate = normalizeNonEmptyString(value.runId) ?? (payloadRecord ? readStringField(payloadRecord, 'runId') : null);
  const rootMessageIdCandidate =
    normalizeNonEmptyString(value.rootMessageId) ?? (payloadRecord ? readStringField(payloadRecord, 'rootMessageId') : null);
  const requestContextIdCandidate =
    normalizeNonEmptyString(value.requestContextId) ??
    normalizeNonEmptyString(value.attemptId) ??
    (payloadRecord ? readStringField(payloadRecord, 'requestContextId') : null) ??
    (payloadRecord ? readStringField(payloadRecord, 'attemptId') : null);
  const requestId = requestIdCandidate ?? requestContextIdCandidate ?? rootMessageIdCandidate ?? runIdCandidate;
  const requestContextId = requestContextIdCandidate ?? requestId;
  const rootMessageId = rootMessageIdCandidate ?? requestId;
  const runId = runIdCandidate ?? rootMessageId ?? requestId;
  const baseValid =
    typeof value.eventId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof requestId === 'string' &&
    typeof value.sequence === 'number' &&
    eventType !== null &&
    (typeof timelineEventRef === 'string' || timelineEventRef === null || timelineEventRef === undefined) &&
    Array.isArray(value.transportHints) &&
    value.transportHints.every((hint) => typeof hint === 'string') &&
    payloadRecord !== null &&
    isWireTimestamp(value.createdAt);
  if (!baseValid) {
    return null;
  }
  const eventId = value.eventId as string;
  const sessionId = value.sessionId as string;
  const sequence = value.sequence as number;
  const transportHints = value.transportHints as string[];
  const createdAt = value.createdAt as StreamEnvelope['createdAt'];
  const normalizedEventType = eventType as StreamEventType;

  const normalizedPayload: Record<string, unknown> = { ...payloadRecord };
  const normalizedMetadata = normalizeMetadata(normalizedPayload);

  normalizedPayload.runId = runId;
  normalizedPayload.rootMessageId = rootMessageId;
  normalizedPayload.requestContextId = requestContextId;

  if (RESULT_STREAM_EVENT_TYPE_SET.has(normalizedEventType)) {
    const allowWhitespaceOnly =
      normalizedEventType === 'LLM_THINKING_DELTA' ||
      normalizedEventType === 'LLM_CONTENT_DELTA' ||
      normalizedEventType === 'CAPABILITY_RESULT_DELTA';
    const usesDeltaText =
      normalizeNonEmptyString(normalizedPayload.text) === null &&
      normalizeNonEmptyString(normalizedPayload.content) === null &&
      normalizeNonEmptyStreamText(normalizedPayload.delta, { allowWhitespaceOnly }) !== null;
    const text = readResultStreamText(normalizedPayload, {
      allowWhitespaceOnly,
    });
    // Allow empty text for completion markers (delta events with empty content)
    // This supports backends that send LLM_CONTENT_DELTA with empty text as terminal signals
    if (text === null) {
      return null;
    }
    normalizedPayload.text = text;

    if (normalizedEventType === 'LLM_THINKING_DELTA') {
      normalizedPayload.contentType = normalizeContentType(normalizedPayload.contentType) ?? 'PLAIN_TEXT';
    }

    if (CONTENT_TYPED_RESULT_EVENT_TYPE_SET.has(normalizedEventType)) {
      const contentType =
        normalizeContentType(normalizedPayload.contentType) ??
        (usesDeltaText ? 'PLAIN_TEXT' : normalizedEventType === 'LLM_CONTENT_DELTA' ? 'MARKDOWN' : null);
      // Allow empty contentType for completion markers (text === "")
      if (!contentType && text !== '') {
        return null;
      }
      normalizedPayload.contentType = contentType ?? 'PLAIN_TEXT';
    }

    const directAccumulated = normalizedPayload.accumulated;
    const metadataAccumulated = normalizedMetadata.accumulated;
    const accumulated =
      typeof metadataAccumulated === 'boolean' ? metadataAccumulated : typeof directAccumulated === 'boolean' ? directAccumulated : !usesDeltaText;
    normalizedMetadata.accumulated = accumulated;
    normalizedPayload.metadata = normalizedMetadata;
  }

  if (CONTRACT_WEB_EVENT_TYPE_SET.has(normalizedEventType) && !RESULT_STREAM_EVENT_TYPE_SET.has(normalizedEventType)) {
    const payloadText = readPayloadText(normalizedPayload);
    if (normalizedEventType === 'CAPABILITY_STARTED') {
      delete normalizedPayload.text;
    } else if (payloadText !== null) {
      normalizedPayload.text = payloadText;
    } else if (!CAPABILITY_EVENT_TYPE_SET.has(normalizedEventType)) {
      normalizedPayload.text = defaultTextForEvent(normalizedEventType);
    } else {
      delete normalizedPayload.text;
    }
    normalizedPayload.contentType = normalizeContentType(normalizedPayload.contentType) ?? 'PLAIN_TEXT';
    normalizedMetadata.accumulated =
      typeof normalizedMetadata.accumulated === 'boolean'
        ? normalizedMetadata.accumulated
        : typeof normalizedPayload.accumulated === 'boolean'
          ? normalizedPayload.accumulated
          : true;
    normalizedPayload.metadata = normalizedMetadata;
  }

  if (
    CAPABILITY_EVENT_TYPE_SET.has(normalizedEventType) &&
    !readCapabilityCorrelationId(normalizedPayload, {
      allowToolCallIndexFallback: normalizedEventType === 'CAPABILITY_RESULT_DELTA',
    })
  ) {
    return null;
  }

  return {
    eventId,
    sessionId,
    requestId,
    runId,
    rootMessageId,
    requestContextId,
    sequence,
    eventType: normalizedEventType,
    timelineEventRef: typeof timelineEventRef === 'string' ? timelineEventRef : null,
    transportHints: [...transportHints],
    payload: normalizedPayload as StreamEnvelope['payload'],
    createdAt,
  } as StreamEnvelope;
}

export function isStreamEnvelope(value: unknown): value is StreamEnvelope {
  return normalizeStreamEnvelope(value) !== null;
}
