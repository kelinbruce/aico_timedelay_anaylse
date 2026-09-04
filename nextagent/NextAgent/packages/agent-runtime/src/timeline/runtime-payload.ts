import { truncateUtf8, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type { RequestContext } from '@nextagent/agent-contracts/runtime';

export const maxTimelineInlinePayloadBytes = 49_000;

export function runtimeTimelinePayload(payload: JsonObject, context: Pick<RequestContext, 'propagationAttributes'>): JsonObject {
  const { trace: _untrustedTrace, attributes: rawAttributes, ...businessPayload } = payload;
  const attributes = withoutUntrustedEventId(rawAttributes);
  const taskEventId = context.propagationAttributes?.taskEventId;
  const runtimeAttributes = taskEventId === undefined ? attributes : { ...attributes, eventId: taskEventId };
  return Object.keys(runtimeAttributes).length === 0 ? businessPayload : { ...businessPayload, attributes: runtimeAttributes };
}

/**
 * Truncates a timeline inline payload to fit within {@link maxTimelineInlinePayloadBytes}.
 *
 * This guards the structured-delta persistence paths (`writeTimelineEventDirect`,
 * `flushPendingStructuredDeltas`) that bypass the size check in `emitEvent`. When the
 * serialised payload exceeds the limit, the `content` field is reduced without
 * changing its JSON container type and a `truncated: true` marker is added. The
 * event is still persisted so that history replay can display an explicit bounded
 * preview after a page refresh.
 *
 * Returns the original payload unchanged when it is already within the limit.
 */
export function truncateTimelineInlinePayload(payload: JsonObject): JsonObject {
  if (serializedBytes(payload) <= maxTimelineInlinePayloadBytes) {
    return payload;
  }
  const { content = null, truncated: _previousMarker, ...fullRest } = payload;
  const emptyContent = emptyContentShape(content, payload['toolMessageType']);
  const rest = fitsPayload(fullRest, emptyContent) ? fullRest : minimalStructuredDeltaShell(fullRest);
  const boundedContent = truncateJsonValue(content, payload['toolMessageType'], (candidate) => fitsPayload(rest, candidate));
  const result: JsonObject = { ...rest, content: boundedContent, truncated: true };
  if (serializedBytes(result) <= maxTimelineInlinePayloadBytes) {
    return result;
  }
  const minimal: JsonObject = { content: emptyContent, truncated: true };
  return serializedBytes(minimal) <= maxTimelineInlinePayloadBytes ? minimal : { content: null, truncated: true };
}

function truncateJsonValue(
  value: JsonValue,
  messageType: JsonValue | undefined,
  fits: (candidate: JsonValue) => boolean,
): JsonValue {
  if (typeof value === 'string') {
    return longestFittingString(value, fits);
  }
  if (Array.isArray(value)) {
    return value.slice(0, longestFittingPrefix(value.length, (length) => fits(value.slice(0, length))));
  }
  if (!isJsonObject(value)) {
    return value;
  }
  if (messageType === 'PIU') {
    return truncatePiuContent(value, fits);
  }
  if (messageType === 'STREAM_DSL' && value['type'] === 'dsl' && typeof value['content'] === 'string') {
    const { content: dslContent, ...rest } = value;
    const boundedDsl = longestFittingString(dslContent, (candidate) => fits({ ...rest, type: 'dsl', content: candidate }));
    return { ...rest, type: 'dsl', content: boundedDsl };
  }
  const entries = Object.entries(value) as [string, JsonValue][];
  const length = longestFittingPrefix(entries.length, (count) => fits(Object.fromEntries(entries.slice(0, count)) as JsonObject));
  return Object.fromEntries(entries.slice(0, length)) as JsonObject;
}

function truncatePiuContent(value: JsonObject, fits: (candidate: JsonValue) => boolean): JsonObject {
  const { data, ...rest } = value;
  const dataItems: readonly JsonValue[] = data === undefined ? [] : Array.isArray(data) ? data : [data];
  const retainedRest = fits({ ...rest, data: [] }) ? rest : pickJsonFields(rest, ['piuName', 'piuVersion', 'method', 'uuid']);
  if (!fits({ ...retainedRest, data: [] })) {
    return { data: [] };
  }
  const length = longestFittingPrefix(dataItems.length, (count) => fits({ ...retainedRest, data: dataItems.slice(0, count) }));
  return { ...retainedRest, data: dataItems.slice(0, length) };
}

function longestFittingString(value: string, fits: (candidate: JsonValue) => boolean): string {
  const maxBytes = Buffer.byteLength(value);
  let low = 0;
  let high = maxBytes;
  let result = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = truncateUtf8(value, middle);
    if (fits(candidate)) {
      result = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function longestFittingPrefix(length: number, fits: (length: number) => boolean): number {
  let low = 0;
  let high = length;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function emptyContentShape(value: JsonValue, messageType: JsonValue | undefined): JsonValue {
  if (typeof value === 'string') {
    return '';
  }
  if (Array.isArray(value)) {
    return [];
  }
  if (isJsonObject(value)) {
    if (messageType === 'PIU') {
      return { data: [] };
    }
    if (messageType === 'STREAM_DSL' && value['type'] === 'dsl') {
      return { type: 'dsl', content: '' };
    }
    return {};
  }
  return value;
}

function minimalStructuredDeltaShell(rest: JsonObject): JsonObject {
  return pickJsonFields(rest, [
    'capabilityId',
    'toolCallId',
    'toolEventType',
    'toolMessageType',
    'accumulated',
    'workflowEventType',
    'nodeId',
    'nodeType',
    'nodeExecutionId',
    'parentToolCallId',
  ]);
}

function pickJsonFields(source: JsonObject, keys: readonly string[]): JsonObject {
  const entries: [string, JsonValue][] = [];
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      entries.push([key, value]);
    }
  }
  return Object.fromEntries(entries);
}

function fitsPayload(rest: JsonObject, content: JsonValue): boolean {
  return serializedBytes({ ...rest, content, truncated: true }) <= maxTimelineInlinePayloadBytes;
}

function serializedBytes(value: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withoutUntrustedEventId(value?: JsonObject[string]): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const { eventId: _untrustedEventId, ...attributes } = value as JsonObject;
  return attributes;
}
