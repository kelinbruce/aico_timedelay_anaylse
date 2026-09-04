import {
  TOOL_EVENT_TYPES,
  TOOL_MESSAGE_TYPES,
  type CapabilityStreamPayload,
  type JsonValue,
  type SessionConversationMessage,
  type SessionConversationPage,
  type StreamEnvelope,
} from '../../../state/contracts.ts';
import { readSafeCapabilityResult } from '../utils/safeCapabilityResult.ts';
import { readFailureErrorCodeFromPayload } from '../utils/failureDetails.ts';

type JsonRecord = Record<string, JsonValue>;

interface StructuredDeltaData {
  readonly eventType: string;
  readonly messageType: string;
  readonly content: JsonValue;
}

interface ParsedCapabilityResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly payload: JsonRecord;
}
const USER_INPUT_EVENT_TYPES = new Set<string>(['USER_INPUT_REQUIRED', 'USER_INPUT_RECEIVED', 'USER_INPUT_TIMEOUT', 'USER_INPUT_CANCELED']);
const NON_COMPLETED_TERMINAL_EVENT_TYPES = new Set<StreamEnvelope['eventType']>([
  'REQUEST_CANCELED',
  'REQUEST_FAILED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);
const TERMINAL_ASSISTANT_MESSAGE_PREFIX = 'assistant-terminal-';

function toJsonRecord(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCapabilityResultContent(content: string): ParsedCapabilityResult | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    const toolCallId = record['toolCallId'];
    const toolName = record['toolName'];
    const payload = record['payload'];
    if (typeof toolCallId !== 'string' || typeof toolName !== 'string') {
      return undefined;
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined;
    }
    return { toolCallId, toolName, payload: payload as JsonRecord };
  } catch {
    return undefined;
  }
}

function isStructuredEvent(record: JsonRecord): boolean {
  const eventType = record['eventType'];
  const messageType = record['messageType'];
  const content = record['content'];
  if (typeof eventType !== 'string' || !TOOL_EVENT_TYPES.includes(eventType)) {
    return false;
  }
  if (typeof messageType !== 'string' || !TOOL_MESSAGE_TYPES.includes(messageType)) {
    return false;
  }
  return content !== undefined && content !== null;
}

function parseJsonObjectString(raw: string): JsonRecord | undefined {
  try {
    const inner: unknown = JSON.parse(raw);
    return inner !== null && typeof inner === 'object' && !Array.isArray(inner) ? (inner as JsonRecord) : undefined;
  } catch {
    return undefined;
  }
}

function unwrapStructuredEnvelope(candidate: unknown): JsonRecord | undefined {
  const record = toJsonRecord(candidate);
  if (record['status'] === 'ok') {
    const data = toJsonRecord(record['data']);
    const raw = data['raw'];
    if (typeof raw === 'string') {
      return parseJsonObjectString(raw);
    }
  }
  if (record['code'] === 200) {
    const data = record['data'];
    if (typeof data === 'string') {
      return parseJsonObjectString(data);
    }
  }
  return undefined;
}

function identifyStructuredDelta(candidate: unknown): StructuredDeltaData | undefined {
  const record = toJsonRecord(candidate);
  if (isStructuredEvent(record)) {
    return { eventType: record['eventType'] as string, messageType: record['messageType'] as string, content: record['content'] as JsonValue };
  }
  const unwrapped = unwrapStructuredEnvelope(candidate);
  if (unwrapped !== undefined && isStructuredEvent(unwrapped)) {
    return {
      eventType: unwrapped['eventType'] as string,
      messageType: unwrapped['messageType'] as string,
      content: unwrapped['content'] as JsonValue,
    };
  }
  return undefined;
}

function resolveStructuredDeltaEnvelope(
  message: SessionConversationMessage,
  metadata: JsonRecord,
  historyOrdinal: number,
  requestId: string,
  runId: string,
  rootMessageId: string,
  requestContextId: string,
): StreamEnvelope | null {
  const parsed = parseCapabilityResultContent(message.content);
  if (parsed === undefined) {
    return null;
  }
  const structured = identifyStructuredDelta(parsed.payload);
  if (structured === undefined) {
    return null;
  }
  const toolCallId = readString(metadata.toolCallId) ?? parsed.toolCallId;
  const capabilityId = readString(metadata.toolName) ?? parsed.toolName;
  return {
    eventId: `conv-${message.messageId}-${historyOrdinal}`,
    sessionId: message.sessionId,
    requestId,
    runId,
    rootMessageId,
    requestContextId,
    sequence: historyOrdinal,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: ['history-load'],
    payload: {
      toolEventType: structured.eventType,
      toolMessageType: structured.messageType,
      content: structured.content,
      capabilityId,
      toolCallId,
      messageId: message.messageId,
      runId,
      rootMessageId,
      requestContextId,
      visible: message.visible,
      role: message.role,
    },
    createdAt: message.createdAt,
  } as StreamEnvelope;
}

function resolvePendingInputAnswerProjection(message: SessionConversationMessage): CapabilityStreamPayload | null {
  const projection = message.pendingInputAnswer;
  if (
    projection?.capabilityId !== 'AskUserQuestion' ||
    readString(projection.toolCallId) === null ||
    readString(projection.pendingInputId) === null ||
    projection.kind !== 'QUESTION' ||
    projection.status !== 'RECEIVED' ||
    readString(projection.safeSummary) === null
  ) {
    return null;
  }
  const safeResult = readSafeCapabilityResult(projection.safeResult);
  if (safeResult?.kind !== 'pendingInputAnswer') {
    return null;
  }
  return {
    capabilityId: projection.capabilityId,
    toolCallId: projection.toolCallId,
    pendingInputId: projection.pendingInputId,
    kind: projection.kind,
    status: projection.status,
    safeSummary: projection.safeSummary,
    safeResult: {
      kind: 'pendingInputAnswer',
      answers: safeResult.answers,
      truncated: safeResult.truncated,
    },
  };
}

function resolveRequestId(message: SessionConversationMessage): string {
  return message.requestContextId ?? message.requestId ?? message.rootMessageId ?? message.messageId;
}

function normalizeTerminalStatus(value: unknown): StreamEnvelope['eventType'] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'COMPLETED') {
    return 'REQUEST_COMPLETED';
  }
  if (normalized === 'CANCELED') {
    return 'REQUEST_CANCELED';
  }
  if (normalized === 'FAILED') {
    return 'REQUEST_FAILED';
  }
  if (normalized === 'SUPERSEDED') {
    return 'REQUEST_SUPERSEDED';
  }
  return null;
}

function resolveStoredEventType(metadata: JsonRecord): string | null {
  const rawEventType = metadata.eventType;
  return typeof rawEventType === 'string' ? rawEventType : null;
}

function resolveTerminalHistoryEventType(message: SessionConversationMessage, metadata: JsonRecord): StreamEnvelope['eventType'] | null {
  if (message.role !== 'ASSISTANT') {
    return null;
  }

  // Input-guard-blocked rounds are persisted by the backend as a
  // visible=true ASSISTANT refusal message carrying
  // metadata.guardPhase='INPUT_GUARD' + modelVisibility.excluded=true
  // (recordInputGuardBlock). The round has no run and no runtime terminal
  // event, so without this projection the refusal would map to a plain
  // LLM_CONTENT_DELTA and buildTurnBlocks.resolveStatus would fall through to
  // 'EXECUTING' (problem: turn stuck on "executing"). Project it as
  // OUTPUT_GUARD_BLOCKED with phase=INPUT_GUARD so the existing guard-blocked
  // terminal path (resolveStatus → CANCELED, TurnBlock GuardBlockedNotice)
  // renders the round as "已拦截" on history rehydration.
  if (metadata.guardPhase === 'INPUT_GUARD') {
    return 'OUTPUT_GUARD_BLOCKED';
  }

  const storedEventType = resolveStoredEventType(metadata);
  if (storedEventType && NON_COMPLETED_TERMINAL_EVENT_TYPES.has(storedEventType as StreamEnvelope['eventType'])) {
    return storedEventType as StreamEnvelope['eventType'];
  }

  const terminalStatus = normalizeTerminalStatus(metadata.status);
  if (terminalStatus) {
    return terminalStatus;
  }

  if (!message.messageId.startsWith(TERMINAL_ASSISTANT_MESSAGE_PREFIX)) {
    return null;
  }

  const content = message.content.trim();
  if (content === 'Request canceled by user.' || content === 'Request canceled') {
    return 'REQUEST_CANCELED';
  }
  if (content === 'Request superseded by a newer request.' || content === 'Request superseded') {
    return 'REQUEST_SUPERSEDED';
  }
  if (content.startsWith('Request failed')) {
    return 'REQUEST_FAILED';
  }
  return null;
}

function toHistoryEnvelope(message: SessionConversationMessage, historyOrdinal: number): StreamEnvelope | null {
  const requestId = resolveRequestId(message);
  const metadata = toJsonRecord(message.metadata);
  const rootMessageId = getConversationMessageRootMessageId(message);
  const requestContextId = message.requestContextId ?? requestId;
  const runId = message.runId ?? (typeof metadata.runId === 'string' ? metadata.runId : rootMessageId);
  const streamMetadata: JsonRecord = {
    ...metadata,
    accumulated: typeof metadata.accumulated === 'boolean' ? metadata.accumulated : true,
  };
  const basePayload: JsonRecord = {
    ...metadata,
    metadata: streamMetadata,
    contentType: message.contentType,
    content: message.content,
    text: message.content,
    role: message.role,
    messageId: message.messageId,
    runId,
    rootMessageId,
    requestContextId,
    visible: message.visible,
    ...(message.attachments === undefined || message.attachments.length === 0 ? {} : { attachments: message.attachments as unknown as JsonValue }),
  };

  if (message.role === 'CAPABILITY_RESULT') {
    const pendingInputAnswer = resolvePendingInputAnswerProjection(message);
    if (pendingInputAnswer !== null) {
      return {
        eventId: `conv-${message.messageId}-${historyOrdinal}`,
        sessionId: message.sessionId,
        requestId,
        runId,
        rootMessageId,
        requestContextId,
        sequence: historyOrdinal,
        eventType: 'CAPABILITY_RESULT_DELTA',
        timelineEventRef: null,
        transportHints: ['history-load'],
        payload: {
          metadata: { accumulated: true },
          contentType: 'PLAIN_TEXT',
          content: '',
          text: '',
          role: message.role,
          messageId: message.messageId,
          runId,
          rootMessageId,
          requestContextId,
          visible: message.visible,
          ...pendingInputAnswer,
          toolCallId: pendingInputAnswer.toolCallId,
        },
        createdAt: message.createdAt,
      };
    }
    const structuredEnvelope = resolveStructuredDeltaEnvelope(message, metadata, historyOrdinal, requestId, runId, rootMessageId, requestContextId);
    if (structuredEnvelope !== null) {
      return structuredEnvelope;
    }
    return null;
  }

  const storedEventType = resolveStoredEventType(metadata);
  const terminalEventType = resolveTerminalHistoryEventType(message, metadata);
  if (terminalEventType === null && message.messageId.startsWith(TERMINAL_ASSISTANT_MESSAGE_PREFIX)) {
    return null;
  }
  const terminalFailureCode = terminalEventType === 'REQUEST_FAILED' ? readFailureErrorCodeFromPayload(basePayload) : null;
  const payload: JsonRecord =
    terminalEventType === 'REQUEST_FAILED' && terminalFailureCode
      ? {
          ...basePayload,
          code: terminalFailureCode,
          metadata: {
            ...streamMetadata,
            eventType: 'REQUEST_FAILED',
            status: 'FAILED',
            code: terminalFailureCode,
          },
        }
      : basePayload;
  const resolvedEventType =
    storedEventType && USER_INPUT_EVENT_TYPES.has(storedEventType)
      ? (storedEventType as StreamEnvelope['eventType'])
      : terminalEventType
        ? terminalEventType
        : message.role === 'USER'
          ? 'REQUEST_ACCEPTED'
          : 'LLM_CONTENT_DELTA';

  return {
    eventId: `conv-${message.messageId}-${historyOrdinal}`,
    sessionId: message.sessionId,
    requestId,
    runId,
    rootMessageId,
    requestContextId,
    sequence: historyOrdinal,
    eventType: resolvedEventType,
    timelineEventRef: null,
    transportHints: ['history-load'],
    payload,
    createdAt: message.createdAt,
  } as StreamEnvelope;
}

export function getConversationMessageRootMessageId(message: SessionConversationMessage): string {
  return message.rootMessageId ?? message.requestId ?? message.messageId;
}

export function conversationMessagesToHistoryEnvelopes(messages: readonly SessionConversationMessage[]): StreamEnvelope[] {
  return messages
    .filter((message) => message.role !== 'SUMMARY')
    .filter((message) => toJsonRecord(message.metadata).kind !== 'ASSISTANT_TOOL_USE')
    .map((message, index) => toHistoryEnvelope(message, index + 1))
    .filter((envelope): envelope is StreamEnvelope => envelope !== null);
}

export function conversationPageToStreamEnvelopes(page: SessionConversationPage): StreamEnvelope[] {
  return conversationMessagesToHistoryEnvelopes(page.items);
}
