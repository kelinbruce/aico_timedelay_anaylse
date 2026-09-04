import {
  TOOL_EVENT_TYPES,
  TOOL_MESSAGE_TYPES,
  type JsonObject,
  type JsonValue,
  type ToolEventType,
  type ToolMessageType,
} from '@nextagent/agent-common';
import { hasSensitiveStructuredContent } from './structured-delta-safety.js';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

export interface StructuredDeltaData {
  readonly eventType: ToolEventType;
  readonly messageType: ToolMessageType;
  readonly content: JsonValue;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStructuredEvent(payload: unknown): payload is JsonObject {
  if (!isJsonObject(payload)) {
    return false;
  }
  const eventType = payload['eventType'];
  const messageType = payload['messageType'];
  const content = payload['content'];
  if (typeof eventType !== 'string' || !(TOOL_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return false;
  }
  if (typeof messageType !== 'string' || !(TOOL_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    return false;
  }
  return content !== undefined && content !== null;
}

// Parses a JSON string and returns it as a JsonObject, or undefined on failure.
function parseJsonObjectString(raw: string): JsonObject | undefined {
  try {
    const inner = JSON.parse(raw);
    return isJsonObject(inner) ? inner : undefined;
  } catch {
    return undefined;
  }
}

// Unwraps structured-delta envelopes and returns the parsed inner object, or undefined.
// Supported envelope shapes:
//   {"status":"ok","data":{"raw":"<json-string>"}}
//   {"code":200,"msg":"success","data":"<json-string>"}
function unwrapStructuredEnvelope(candidate: unknown): JsonObject | undefined {
  if (!isJsonObject(candidate)) {
    return undefined;
  }
  // Shape 1: {"status":"ok","data":{"raw":"<json-string>"}}
  if (candidate['status'] === 'ok') {
    const data = candidate['data'];
    if (isJsonObject(data)) {
      const raw = data['raw'];
      if (typeof raw === 'string') {
        return parseJsonObjectString(raw);
      }
    }
  }
  // Shape 2: {"code":200,"msg":"success","data":"<json-string>"}
  if (candidate['code'] === 200) {
    const data = candidate['data'];
    if (typeof data === 'string') {
      return parseJsonObjectString(data);
    }
  }
  return undefined;
}

// Tries direct shape then envelope shape, returns StructuredDeltaData or undefined.
export function identifyStructuredDelta(candidate: unknown): StructuredDeltaData | undefined {
  const event = isStructuredEvent(candidate) ? candidate : unwrapStructuredEnvelope(candidate);
  if (event === undefined || !isStructuredEvent(event)) {
    return undefined;
  }
  return {
    eventType: event['eventType'] as ToolEventType,
    messageType: event['messageType'] as ToolMessageType,
    content: event['content'] as JsonValue,
  };
}

// Emits TOOL_STRUCTURED_DELTA if candidate matches structured shape and passes safety check.
export async function tryEmitStructuredDelta(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  capabilityId: string,
  toolCallId: string,
  candidate: unknown,
  streaming?: boolean,
): Promise<boolean> {
  const structured = identifyStructuredDelta(candidate);
  return emitStructuredDeltaData(runState, run, context, capabilityId, toolCallId, structured, streaming);
}

// Emits TOOL_STRUCTURED_DELTA from pre-extracted StructuredDeltaData if safety check passes.
export async function emitStructuredDeltaData(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  capabilityId: string,
  toolCallId: string,
  structured?: StructuredDeltaData,
  streaming?: boolean,
): Promise<boolean> {
  if (structured === undefined) {
    return false;
  }
  if (hasSensitiveStructuredContent(structured.content)) {
    return false;
  }
  await runState.emitEvent(run, context, {
    type: 'TOOL_STRUCTURED_DELTA',
    inlinePayload: {
      capabilityId,
      toolCallId,
      toolEventType: structured.eventType,
      toolMessageType: structured.messageType,
      content: structured.content,
      ...(streaming === true ? { streaming: true } : {}),
    },
  });
  return true;
}
