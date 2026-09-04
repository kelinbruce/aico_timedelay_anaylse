import {
  brand,
  CLIP_STREAM_RESULT_PROJECTION_KIND,
  type EpochMillis,
  type JsonObject,
  type JsonValue,
  type MessageId,
  type RunStatus,
  type SafeError,
  type SessionId,
  type TimelineEventType,
  type TimelineSequence,
  workflowNodeTypes,
} from '@nextagent/agent-common';
import type { StreamEnvelope, StreamEventType } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEvent, RuntimeResolvedProcessMessage } from '@nextagent/agent-contracts/runtime';
import type { FastifyReply } from 'fastify';
import { projectAskUserQuestionAnswerResult } from './ask-user-question-answer.js';
import type { CapabilityResultPresentationLevel, CapabilityResultPresentationPolicy } from './capability-result-presentation.js';
import { buildSecurityResponseHeaders } from '../security-response-headers.js';
import { readTerminalHookResultSnapshot } from './terminal-hook-result-snapshot.js';

export interface StreamProjectionOptions {
  readonly fallbackSessionId?: SessionId;
  readonly fallbackRequestId?: MessageId;
  readonly initialSequence?: TimelineSequence;
  readonly clock?: () => EpochMillis;
  readonly processMessageAssociation?: ProcessMessageAssociation;
  readonly capabilityResultPresentationPolicy?: CapabilityResultPresentationPolicy;
}

export interface ProcessMessageAssociation {
  readonly message: RuntimeResolvedProcessMessage;
}

export function resolveLegacyProcessMessageAssociation(
  event: RunTimelineEvent,
  messages: readonly RuntimeResolvedProcessMessage[],
): ProcessMessageAssociation | undefined {
  const candidates = messages.filter((message) => {
    if (
      event.sessionId === undefined ||
      event.requestId === undefined ||
      event.runId === undefined ||
      message.sessionId !== event.sessionId ||
      message.requestId !== event.requestId ||
      message.runId !== event.runId
    ) {
      return false;
    }
    if (event.type === 'LLM_CONTENT_DELTA') {
      return event.inlinePayload.completed === true && readAssistantPublicContent(message) !== undefined;
    }
    if (event.type === 'CAPABILITY_STARTED') {
      return readReferencedToolCall(message, event.inlinePayload.toolCallId, event.inlinePayload.capabilityId) !== undefined;
    }
    if (event.type === 'CAPABILITY_COMPLETED') {
      return readReferencedCapabilityResult(message, event.inlinePayload.toolCallId, event.inlinePayload.capabilityId) !== undefined;
    }
    return false;
  });
  return candidates.length === 1 ? { message: candidates[0]! } : undefined;
}

export function requiresProcessMessageAssociation(event: RunTimelineEvent): boolean {
  if (isTerminalEvent(event)) {
    return true;
  }
  if (isMessageFreeWorkflowLifecycle(event)) {
    return false;
  }
  if (event.type === 'CAPABILITY_COMPLETED' && projectSafeCapabilityFailureProjection(event.inlinePayload) !== undefined) {
    return false;
  }
  return (
    (event.type === 'LLM_CONTENT_DELTA' && event.inlinePayload.completed === true) ||
    ((event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED') &&
      readString(event.inlinePayload.toolCallId) !== undefined &&
      readString(event.inlinePayload.capabilityId) !== undefined)
  );
}

export type ProcessMessageResolver = (event: RunTimelineEvent, messageId: MessageId) => Promise<RuntimeResolvedProcessMessage | undefined>;

interface LiveProcessSnapshot {
  readonly kind: 'LLM_CONTENT' | 'CAPABILITY_RESULT';
  readonly safePayload: JsonObject;
}

export interface SseStreamOptions<TEnvelope = SseEnvelope> {
  readonly streamBackpressureTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: SseStreamDiagnostic) => void;
  readonly eventName?: (envelope: TEnvelope) => string;
}

export interface SseStreamDiagnostic {
  readonly kind: 'BACKPRESSURE_TIMEOUT';
  readonly code: 'BACKPRESSURE_TIMEOUT';
  readonly transport: 'SSE';
}

export interface SseEnvelope {
  readonly eventType: string;
}

interface SafeCapabilityResultProjection {
  readonly safeResult: JsonObject;
  readonly summarySafeResult?: JsonObject;
  readonly summaryDescriptor?: SafeSummaryDescriptor;
  readonly safeSummary: string;
  readonly detailText: string;
}

interface SafeCapabilityFailureProjection {
  readonly safeErrorCode?: string;
  readonly safeErrorCategory?: string;
  readonly safeSummary?: string;
}

interface SafeSummaryDescriptor {
  readonly code: string;
  readonly args: JsonObject;
}

interface CapabilityResultWebProjection {
  readonly level: CapabilityResultPresentationLevel;
  readonly safeProjection?: SafeCapabilityResultProjection;
  readonly safeFailure?: SafeCapabilityFailureProjection;
}

export type StreamProjectionOutcome =
  | { readonly kind: 'ENVELOPE'; readonly envelope: StreamEnvelope }
  | { readonly kind: 'TIMELINE_ONLY'; readonly eventType: TimelineEventType }
  | { readonly kind: 'PROJECTION_FAILURE'; readonly eventType: string; readonly safeError: SafeError };

const resultTextPreviewMaxChars = 4_000;
const resultListPreviewMaxItems = 50;
const cronProjectionInlineTextMaxChars = 256;
const toolSearchIdentityMaxChars = 256;
const ragSourceFallbackContentMaxChars = 256;
const toolSearchDescriptionMaxChars = 1_000;

const streamVisibleTimelineEvents = [
  'REQUEST_ACCEPTED',
  'LLM_THINKING_DELTA',
  'LLM_CONTENT_DELTA',
  'CAPABILITY_STARTED',
  'CAPABILITY_RESULT_DELTA',
  'CAPABILITY_COMPLETED',
  'TOOL_STRUCTURED_DELTA',
  'DEGRADATION_NOTICE',
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'USER_INPUT_REQUIRED',
  'USER_INPUT_RECEIVED',
  'USER_INPUT_TIMEOUT',
  'USER_INPUT_CANCELED',
  'ATTACHMENT_ACCEPTED',
  'ATTACHMENT_REJECTED',
  'CONTEXT_COMPACTED',
  'BACKGROUND_TASK_STARTED',
  'BACKGROUND_TASK_COMPLETED',
  'BACKGROUND_TASK_FAILED',
] as const satisfies readonly StreamEventType[];

const deprecatedStreamEventNames = [
  'THINKING_SUMMARY',
  'CONTENT_DELTA',
  'CAPABILITY_PROGRESS',
  'CAPABILITY_FINISHED',
  'CAPABILITY_DISCOVERED',
] as const;

const defaultStreamBackpressureTimeoutMs = 15_000;
const sseOpenCommentFrame = Buffer.from(': stream-open\n\n', 'utf8');

export function sendSse<TEnvelope extends SseEnvelope>(reply: FastifyReply, events: readonly TEnvelope[]): FastifyReply {
  reply.header('content-type', 'text/event-stream; charset=utf-8');
  return reply.send(events.map((event) => `event: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}

export function sendSseStream<TEnvelope extends SseEnvelope>(
  reply: FastifyReply,
  events: AsyncIterable<TEnvelope>,
  options?: SseStreamOptions<TEnvelope>,
): Promise<void>;
export function sendSseStream<TEnvelope>(
  reply: FastifyReply,
  events: AsyncIterable<TEnvelope>,
  options: SseStreamOptions<TEnvelope> & { readonly eventName: (envelope: TEnvelope) => string },
): Promise<void>;
export async function sendSseStream<TEnvelope>(
  reply: FastifyReply,
  events: AsyncIterable<TEnvelope>,
  options: SseStreamOptions<TEnvelope> = {},
): Promise<void> {
  reply.hijack();
  // SSE transport-layer headers that MUST be preserved: the content type, the
  // keep-alive connection directive, and `x-accel-buffering: no` (disables
  // nginx proxy buffering so events flush immediately). These are passed as
  // `existingHeaders` so buildSecurityResponseHeaders will not overwrite them.
  //
  // `cache-control` is intentionally NOT preserved: the stream previously set
  // `no-cache`, but the security default `no-cache, no-store, must-revalidate`
  // is stricter and correct for SSE (intermediate caches must not store the
  // stream). Because it is omitted from existingHeaders, the default wins.
  //
  // reply.hijack() bypasses Fastify's onSend hook, so the security header set
  // would otherwise be missing entirely from this response — re-apply it here.
  const sseTransportHeaders: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
  const securityHeaders = buildSecurityResponseHeaders({
    existingHeaders: sseTransportHeaders,
  });
  reply.raw.writeHead(200, { ...sseTransportHeaders, ...securityHeaders });

  try {
    const backpressureTimeoutMs = safeStreamBackpressureTimeoutMs(options.streamBackpressureTimeoutMs);
    const openAccepted = reply.raw.write(sseOpenCommentFrame);
    if (!openAccepted && !(await waitForDrain(reply.raw, backpressureTimeoutMs))) {
      options.onDiagnostic?.({ kind: 'BACKPRESSURE_TIMEOUT', code: 'BACKPRESSURE_TIMEOUT', transport: 'SSE' });
      return;
    }
    for await (const event of events) {
      if (reply.raw.destroyed) {
        return;
      }
      const eventName = options.eventName?.(event) ?? (event as SseEnvelope).eventType;
      const accepted = reply.raw.write(Buffer.from(`event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`, 'utf8'));
      if (!accepted && !(await waitForDrain(reply.raw, backpressureTimeoutMs))) {
        options.onDiagnostic?.({ kind: 'BACKPRESSURE_TIMEOUT', code: 'BACKPRESSURE_TIMEOUT', transport: 'SSE' });
        return;
      }
    }
  } finally {
    if (!reply.raw.destroyed) {
      reply.raw.end();
    }
  }
}

async function waitForDrain(stream: Pick<FastifyReply['raw'], 'destroyed' | 'once' | 'off'>, timeoutMs: number): Promise<boolean> {
  if (stream.destroyed) {
    return false;
  }
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (drained: boolean) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      stream.off('drain', onDrain);
      stream.off('close', onClose);
      resolve(drained);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    timeout = setTimeout(() => finish(false), timeoutMs);
    stream.once('drain', onDrain);
    stream.once('close', onClose);
  });
}

function safeStreamBackpressureTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return defaultStreamBackpressureTimeoutMs;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

export function isProjectedEvent(type: string): type is StreamEnvelope['eventType'] {
  return isStreamVisibleTimelineEvent(type);
}

export function projectRunStatus(status: RunStatus): RunStatus {
  return status;
}

export function isStreamVisibleTimelineEvent(type: string): type is StreamEventType {
  return (streamVisibleTimelineEvents as readonly string[]).includes(type);
}

export function projectTimelineEventToStreamEnvelope(event: RunTimelineEvent, options: StreamProjectionOptions = {}): StreamProjectionOutcome {
  if ((event.type as string) === 'CONTENT_DELTA') {
    return projectionFailure(event.type, 'DEPRECATED_STREAM_EVENT_NAME');
  }
  if (!isStreamVisibleTimelineEvent(event.type)) {
    if (isDeprecatedStreamEventName(event.type)) {
      return projectionFailure(event.type, 'DEPRECATED_STREAM_EVENT_NAME');
    }
    return { kind: 'TIMELINE_ONLY', eventType: event.type as TimelineEventType };
  }
  if (event.type === 'LLM_THINKING_DELTA' && !isValidThinkingTimelineEvent(event)) {
    return projectionFailure(event.type, 'STREAM_PROJECTION_THINKING_INVALID');
  }
  if (isTerminalEvent(event) && readTerminalHookResultSnapshot(event.inlinePayload) === undefined) {
    return projectionFailure(event.type, 'STREAM_PROJECTION_PAYLOAD_UNSAFE');
  }
  const sessionId = event.sessionId ?? options.fallbackSessionId;
  if (sessionId === undefined) {
    return projectionFailure(event.type, 'STREAM_PROJECTION_SESSION_MISSING');
  }

  const requestId = event.requestId ?? options.fallbackRequestId ?? brand<string, 'MessageId'>('unknown-request');
  const sequence = event.sequence ?? brand<number, 'TimelineSequence'>(0);
  const createdAt =
    event.createdAt instanceof Date
      ? brand<number, 'EpochMillis'>(event.createdAt.getTime())
      : (options.clock?.() ?? brand<number, 'EpochMillis'>(Date.now()));
  const payload = projectStreamPayload(event, requestId, options.processMessageAssociation, options.capabilityResultPresentationPolicy);
  if (!canSerialize(payload)) {
    return projectionFailure(event.type, 'STREAM_PROJECTION_PAYLOAD_UNSAFE');
  }

  return {
    kind: 'ENVELOPE',
    envelope: {
      eventId: buildStreamEventId(event, sequence),
      sessionId,
      requestId,
      sequence,
      eventType: event.type,
      transportHints: [],
      payload,
      createdAt,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.requestContextId === undefined ? {} : { requestContextId: event.requestContextId }),
      ...(event.eventId === undefined ? {} : { timelineEventRef: event.eventId }),
    },
  };
}

export async function* projectTimelineEventsToStreamEnvelopes(
  events: AsyncIterable<RunTimelineEvent>,
  options: StreamProjectionOptions = {},
  resolveProcessMessage?: ProcessMessageResolver,
): AsyncIterable<StreamEnvelope> {
  let lastSequence = Number(options.initialSequence ?? 0);
  const processMessageCache = new Map<MessageId, RuntimeResolvedProcessMessage>();
  const liveProcessSnapshotCache = new Map<string, LiveProcessSnapshot>();
  for await (const event of events) {
    const matchingLiveSnapshot = resolveMatchingLiveProcessSnapshot(event, liveProcessSnapshotCache);
    const referencedMessageId = requiresProcessMessageAssociation(event) ? readReferencedProcessMessageId(event) : undefined;
    let processMessageAssociation = options.processMessageAssociation;
    if (
      matchingLiveSnapshot === undefined &&
      referencedMessageId !== undefined &&
      processMessageAssociation === undefined &&
      resolveProcessMessage !== undefined
    ) {
      const messageId = brand<string, 'MessageId'>(referencedMessageId);
      let resolved = processMessageCache.get(messageId);
      if (resolved === undefined) {
        resolved = await resolveProcessMessage(event, messageId);
        if (resolved !== undefined) {
          processMessageCache.set(messageId, resolved);
          if (processMessageCache.size > 1_000) {
            const oldest = processMessageCache.keys().next().value;
            if (oldest !== undefined) {
              processMessageCache.delete(oldest);
            }
          }
        }
      }
      if (resolved !== undefined) {
        processMessageAssociation = { message: resolved };
      }
    }
    const outcome = projectTimelineEventToStreamEnvelope(event, {
      ...options,
      ...(processMessageAssociation === undefined ? {} : { processMessageAssociation }),
    });
    if (outcome.kind === 'ENVELOPE') {
      const projectedEnvelope =
        event.persistence === 'LIVE_ONLY' && event.sequence === undefined
          ? { ...outcome.envelope, sequence: brand<number, 'TimelineSequence'>(lastSequence) }
          : outcome.envelope;
      const envelope = matchingLiveSnapshot === undefined ? projectedEnvelope : mergeLiveProcessCompletion(projectedEnvelope, matchingLiveSnapshot);
      lastSequence = Math.max(lastSequence, Number(envelope.sequence));
      yield envelope;
      rememberLiveProcessSnapshot(event, envelope, liveProcessSnapshotCache);
      continue;
    }
    if (outcome.kind === 'PROJECTION_FAILURE') {
      yield projectProjectionFailure(event, outcome, options);
      return;
    }
  }
}

function resolveMatchingLiveProcessSnapshot(
  event: RunTimelineEvent,
  cache: ReadonlyMap<string, LiveProcessSnapshot>,
): LiveProcessSnapshot | undefined {
  const key = liveProcessSnapshotKey(event, true);
  return key === undefined ? undefined : cache.get(key);
}

function rememberLiveProcessSnapshot(event: RunTimelineEvent, envelope: StreamEnvelope, cache: Map<string, LiveProcessSnapshot>): void {
  const key = liveProcessSnapshotKey(event, false);
  if (key === undefined || !hasNonEmptyProcessContent(envelope.payload)) {
    return;
  }
  const kind = event.type === 'LLM_CONTENT_DELTA' ? 'LLM_CONTENT' : 'CAPABILITY_RESULT';
  cache.delete(key);
  cache.set(key, { kind, safePayload: envelope.payload });
  if (cache.size > 1_000) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

function liveProcessSnapshotKey(event: RunTimelineEvent, completion: boolean): string | undefined {
  const sessionId = readNonEmptyString(event.sessionId);
  const requestId = readNonEmptyString(event.requestId);
  const runId = readNonEmptyString(event.runId);
  if (sessionId === undefined || requestId === undefined || runId === undefined) {
    return undefined;
  }
  if (event.type === 'LLM_CONTENT_DELTA') {
    if ((event.inlinePayload.completed === true) !== completion) {
      return undefined;
    }
    const stepId = readNonEmptyString(event.inlinePayload.stepId);
    return stepId === undefined ? undefined : JSON.stringify(['LLM_CONTENT', sessionId, requestId, runId, requestId, stepId]);
  }
  if (event.type === (completion ? 'CAPABILITY_COMPLETED' : 'CAPABILITY_RESULT_DELTA')) {
    const capabilityId = readNonEmptyString(event.inlinePayload.capabilityId);
    const toolCallId = readNonEmptyString(event.inlinePayload.toolCallId);
    return capabilityId === undefined || toolCallId === undefined
      ? undefined
      : JSON.stringify(['CAPABILITY_RESULT', sessionId, requestId, runId, requestId, capabilityId, toolCallId]);
  }
  return undefined;
}

function hasNonEmptyProcessContent(payload: JsonObject): boolean {
  return readNonEmptyString(payload.content) !== undefined || readNonEmptyString(payload.text) !== undefined;
}

function mergeLiveProcessCompletion(envelope: StreamEnvelope, snapshot: LiveProcessSnapshot): StreamEnvelope {
  const payload: Record<string, JsonValue> = { ...snapshot.safePayload, ...envelope.payload };
  for (const key of ['content', 'text', 'contentType'] as const) {
    const value = snapshot.safePayload[key];
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  if (snapshot.kind === 'LLM_CONTENT') {
    const role = snapshot.safePayload.role;
    if (role !== undefined) {
      payload.role = role;
    }
    payload.metadata = { accumulated: true, completed: true };
  }
  delete payload.contentUnavailable;
  return { ...envelope, payload };
}

function isDeprecatedStreamEventName(type: string): type is (typeof deprecatedStreamEventNames)[number] {
  return (deprecatedStreamEventNames as readonly string[]).includes(type);
}

function projectStreamPayload(
  event: RunTimelineEvent,
  requestId: MessageId,
  processMessageAssociation?: ProcessMessageAssociation,
  capabilityResultPresentationPolicy?: CapabilityResultPresentationPolicy,
): JsonObject {
  const payload: Record<string, JsonValue> = {
    rootMessageId: requestId,
    requestId,
  };
  if (event.runId !== undefined) {
    payload.runId = event.runId;
  }
  if (event.requestContextId !== undefined) {
    payload.requestContextId = event.requestContextId;
  }

  if (event.type === 'LLM_CONTENT_DELTA') {
    const referencedMessage = resolveReferencedProcessMessage(event, processMessageAssociation);
    const content =
      event.inlinePayload.messageId === undefined
        ? (readString(event.inlinePayload.content) ?? readString(event.inlinePayload.text) ?? '')
        : readAssistantPublicContent(referencedMessage);
    if (event.inlinePayload.messageId !== undefined && content === undefined) {
      payload.content = '';
      payload.text = '';
      payload.contentType = 'MARKDOWN';
      payload.role = 'ASSISTANT';
      payload.contentUnavailable = true;
      payload.metadata = { accumulated: true, completed: true };
      copySafeFields(payload, event.inlinePayload, ['stepId', 'completed', 'final']);
      return payload as JsonObject;
    }
    payload.content = content ?? '';
    payload.text = content ?? '';
    payload.contentType = readString(event.inlinePayload.contentType) ?? 'MARKDOWN';
    payload.role = readString(event.inlinePayload.role) ?? 'ASSISTANT';
    payload.metadata = { accumulated: true };
    copySafeFields(payload, event.inlinePayload, ['stepId', 'completed', 'final']);
    return payload as JsonObject;
  }

  if (event.type === 'LLM_THINKING_DELTA') {
    const text = readString(event.inlinePayload.reasoning) ?? readString(event.inlinePayload.content) ?? readString(event.inlinePayload.text) ?? '';
    payload.reasoning = text;
    payload.content = text;
    payload.text = text;
    payload.contentType = 'PLAIN_TEXT';
    payload.stepId = event.inlinePayload.stepId as string;
    payload.metadata = event.inlinePayload.completed === true ? { accumulated: true, completed: true } : { accumulated: true };
    return payload as JsonObject;
  }

  if (event.type === 'CAPABILITY_RESULT_DELTA') {
    projectCapabilityResultPayload(payload, event.inlinePayload, capabilityResultPresentationPolicy);
    return payload as JsonObject;
  }

  if (event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED') {
    const workflowLifecycle = isMessageFreeWorkflowLifecycle(event);
    const safeFailure = event.type === 'CAPABILITY_COMPLETED' ? projectSafeCapabilityFailureProjection(event.inlinePayload) : undefined;
    if (event.inlinePayload.messageId !== undefined && safeFailure === undefined) {
      const referencedMessage = resolveReferencedProcessMessage(event, processMessageAssociation);
      if (event.type === 'CAPABILITY_STARTED') {
        const referencedToolCall = readReferencedToolCall(referencedMessage, event.inlinePayload.toolCallId, event.inlinePayload.capabilityId);
        if (referencedToolCall === undefined) {
          projectUnavailableCapabilityPayload(payload, event);
          return payload as JsonObject;
        }
        const capabilityTargetName = projectCapabilityTargetName(referencedToolCall);
        if (capabilityTargetName !== undefined) {
          payload.capabilityTargetName = capabilityTargetName;
        }
      } else {
        const result = readReferencedCapabilityResult(referencedMessage, event.inlinePayload.toolCallId, event.inlinePayload.capabilityId);
        if (result === undefined) {
          projectUnavailableCapabilityPayload(payload, event);
          return payload as JsonObject;
        }
        projectCapabilityResultPayload(
          payload,
          {
            capabilityId: result.toolName,
            toolCallId: result.toolCallId,
            result: readRecord(result.payload.result) ?? result.payload,
            ...(event.inlinePayload.status === undefined ? {} : { status: event.inlinePayload.status }),
            ...(event.inlinePayload.safeErrorCode === undefined ? {} : { safeErrorCode: event.inlinePayload.safeErrorCode }),
            ...(event.inlinePayload.safeErrorCategory === undefined ? {} : { safeErrorCategory: event.inlinePayload.safeErrorCategory }),
            ...(event.inlinePayload.resultProjectionKind === undefined ? {} : { resultProjectionKind: event.inlinePayload.resultProjectionKind }),
            ...(event.inlinePayload.safeSummary === undefined ? {} : { safeSummary: event.inlinePayload.safeSummary }),
          },
          capabilityResultPresentationPolicy,
        );
        copySafeFields(payload, event.inlinePayload, ['status', 'safeErrorCode', 'safeErrorCategory']);
        projectCapabilityPublicIdentity(payload, event.inlinePayload);
        return payload as JsonObject;
      }
    }
    payload.contentType = 'PLAIN_TEXT';
    payload.metadata = { accumulated: true };
    copySafeFields(payload, event.inlinePayload, ['capabilityId', 'toolCallId', 'status', 'safeErrorCode', 'safeErrorCategory']);
    projectCapabilityPublicIdentity(payload, event.inlinePayload);
    if (workflowLifecycle) {
      copySafeFields(payload, event.inlinePayload, [
        'workflowEventType',
        'nodeId',
        'nodeType',
        'nodeExecutionId',
        'predecessorNodeExecutionIds',
        'parentToolCallId',
        'retryCount',
        'durationMs',
        'reasonCode',
      ]);
    }
    copySafeCapabilityFailureFields(payload, safeFailure);
    if (safeFailure?.safeSummary !== undefined) {
      payload.safeSummary = safeFailure.safeSummary;
      payload.safeSummaryCode = safeFailureSummaryCode(safeFailure.safeErrorCode, safeFailure.safeErrorCategory);
      payload.safeSummaryArgs = {};
      payload.resultPresentationLevel = 'STATUS_ONLY';
    }
    return payload as JsonObject;
  }

  if (event.type === 'TOOL_STRUCTURED_DELTA') {
    payload.toolEventType = readString(event.inlinePayload.toolEventType) ?? 'ANSWER';
    payload.toolMessageType = readString(event.inlinePayload.toolMessageType) ?? 'TEXT';
    payload.content = (event.inlinePayload.content ?? '') as JsonValue;
    payload.contentType = 'PLAIN_TEXT';
    payload.metadata = { accumulated: readBoolean(event.inlinePayload.accumulated) ?? false };
    copySafeFields(payload, event.inlinePayload, ['capabilityId', 'toolCallId', 'workflowEventType']);
    if (event.inlinePayload.truncated === true) {
      payload.truncated = true;
    }
    copySafeFields(payload, event.inlinePayload, ['displayType', 'aigc', 'description', 'nodeId', 'nodeType', 'nodeExecutionId']);
    if (hasTrustedWorkflowStructuredParent(event.inlinePayload)) {
      copySafeFields(payload, event.inlinePayload, ['parentToolCallId']);
    }
    return payload as JsonObject;
  }

  if (isTerminalEvent(event)) {
    const referencedMessage = resolveReferencedProcessMessage(event, processMessageAssociation);
    const content = readTerminalAssistantContent(event, referencedMessage);
    payload.status = terminalStatusFromEventType(event.type);
    payload.content = content ?? '';
    payload.text = content ?? '';
    payload.contentType = content === undefined ? 'PLAIN_TEXT' : (referencedMessage?.contentType ?? 'PLAIN_TEXT');
    if (content === undefined) {
      payload.contentUnavailable = true;
    }
    payload.metadata = { accumulated: true };
    copySafeFields(payload, event.inlinePayload, ['status', 'code', 'message', 'category', 'retryable']);
    Object.assign(payload, readTerminalHookResultSnapshot(event.inlinePayload));
    return payload as JsonObject;
  }

  if (event.type === 'USER_INPUT_REQUIRED') {
    copySafeFields(payload, event.inlinePayload, ['pendingInputId', 'id', 'kind', 'timeoutAt', 'status']);
    const questions = safePendingInputQuestions(event.inlinePayload.questions);
    if (questions !== undefined) {
      payload.questions = questions;
    }
    payload.metadata = { accumulated: true };
    return payload as JsonObject;
  }

  if (event.type === 'USER_INPUT_RECEIVED' || event.type === 'USER_INPUT_TIMEOUT' || event.type === 'USER_INPUT_CANCELED') {
    copySafeFields(payload, event.inlinePayload, ['pendingInputId', 'id', 'kind', 'status', 'safeSummary']);
    payload.metadata = { accumulated: true };
    return payload as JsonObject;
  }

  if (event.type === 'DEGRADATION_NOTICE') {
    copySafeFields(payload, event.inlinePayload, ['code', 'message', 'category', 'retryable', 'reasonCode', 'safeSummary', 'status']);
    payload.text = readString(event.inlinePayload.message) ?? readString(event.inlinePayload.safeSummary) ?? 'Degradation notice';
    payload.content = payload.text;
    payload.contentType = 'PLAIN_TEXT';
    payload.metadata = { accumulated: true };
    return payload as JsonObject;
  }

  if (event.type === 'ATTACHMENT_ACCEPTED' || event.type === 'ATTACHMENT_REJECTED') {
    copySafeFields(payload, event.inlinePayload, ['attachmentId', 'status', 'mediaType', 'reasonCode', 'safeSummary']);
    payload.metadata = { accumulated: true };
    return payload as JsonObject;
  }

  if (event.type === 'CONTEXT_COMPACTED') {
    copySafeFields(payload, event.inlinePayload, ['contextVersion', 'summaryMessageId', 'safeSummary', 'tokenEstimate']);
    payload.metadata = { accumulated: true };
    return payload as JsonObject;
  }

  if (event.type === 'BACKGROUND_TASK_STARTED' || event.type === 'BACKGROUND_TASK_COMPLETED' || event.type === 'BACKGROUND_TASK_FAILED') {
    copySafeFields(payload, event.inlinePayload, [
      'taskId',
      'commandName',
      'commandLine',
      'status',
      'startedAt',
      'stdoutRef',
      'stderrRef',
      'exitCode',
      'finishedAt',
    ]);
    payload.metadata = { accumulated: true };
    return payload as JsonObject;
  }

  copySafeFields(payload, event.inlinePayload, ['attempt', 'agentId', 'agentVersion', 'status']);
  payload.metadata = { accumulated: true };
  return payload as JsonObject;
}

function isMessageFreeWorkflowLifecycle(event: RunTimelineEvent): boolean {
  const payload = event.inlinePayload;
  if (
    (event.type !== 'CAPABILITY_STARTED' && event.type !== 'CAPABILITY_COMPLETED') ||
    payload.messageId !== undefined ||
    !hasWorkflowProjectionIdentity(payload) ||
    typeof payload.workflowEventType !== 'string' ||
    hasWorkflowLifecycleBody(payload) ||
    !isOptionalNonBlankWorkflowIdentity(payload.nodeExecutionId) ||
    !isOptionalNonBlankWorkflowIdentity(payload.parentToolCallId) ||
    !isOptionalNonBlankWorkflowIdentityArray(payload.predecessorNodeExecutionIds) ||
    !isOptionalNonNegativeInteger(payload.retryCount) ||
    !hasMatchingWorkflowLifecycleStatus(payload)
  ) {
    return false;
  }
  return event.type === 'CAPABILITY_STARTED'
    ? payload.workflowEventType === 'NODE_STARTED'
    : ['NODE_COMPLETED', 'NODE_FAILED', 'NODE_SKIPPED', 'NODE_WAITING'].includes(payload.workflowEventType);
}

function hasTrustedWorkflowStructuredParent(payload: JsonObject): boolean {
  return (
    payload.messageId === undefined &&
    hasWorkflowProjectionIdentity(payload) &&
    (payload.workflowEventType === 'NODE_STARTED' ||
      payload.workflowEventType === 'NODE_OUTPUT_DELTA' ||
      payload.workflowEventType === 'NODE_COMPLETED') &&
    isNonBlankWorkflowIdentity(payload.parentToolCallId)
  );
}

function hasWorkflowProjectionIdentity(payload: JsonObject): boolean {
  const nodeId = payload.nodeId;
  return (
    isNonBlankWorkflowIdentity(nodeId) &&
    isWorkflowNodeType(payload.nodeType) &&
    isNonBlankWorkflowIdentity(payload.capabilityId) &&
    isNonBlankWorkflowIdentity(payload.toolCallId) &&
    payload.toolCallId.startsWith('workflow:') &&
    payload.toolCallId.endsWith(`:${nodeId}`)
  );
}

function hasMatchingWorkflowLifecycleStatus(payload: JsonObject): boolean {
  switch (payload.workflowEventType) {
    case 'NODE_STARTED':
      return payload.status === undefined;
    case 'NODE_COMPLETED':
      return payload.status === 'SUCCEEDED';
    case 'NODE_FAILED':
      return payload.status === 'FAILED' || payload.status === 'TIMED_OUT';
    case 'NODE_SKIPPED':
    case 'NODE_WAITING':
      return payload.status === 'DEGRADED';
    default:
      return false;
  }
}

function hasWorkflowLifecycleBody(payload: JsonObject): boolean {
  return ['content', 'text', 'reasoning', 'delta', 'description', 'arguments', 'input', 'output', 'result', 'safeResult', 'structuredPayload'].some(
    (key) => payload[key] !== undefined,
  );
}

function isNonBlankWorkflowIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isWorkflowNodeType(value: unknown): boolean {
  return isNonBlankWorkflowIdentity(value) && (workflowNodeTypes as readonly string[]).includes(value);
}

function isOptionalNonBlankWorkflowIdentity(value: unknown): boolean {
  return value === undefined || isNonBlankWorkflowIdentity(value);
}

function isOptionalNonBlankWorkflowIdentityArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isNonBlankWorkflowIdentity));
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function resolveReferencedProcessMessage(
  event: RunTimelineEvent,
  association?: ProcessMessageAssociation,
): RuntimeResolvedProcessMessage | undefined {
  const messageId = readReferencedProcessMessageId(event);
  const message = association?.message;
  if (
    messageId === undefined ||
    message === undefined ||
    message.messageId !== messageId ||
    event.sessionId === undefined ||
    message.sessionId !== event.sessionId ||
    event.requestId === undefined ||
    message.requestId !== event.requestId ||
    event.runId === undefined ||
    message.runId !== event.runId
  ) {
    return undefined;
  }
  return message;
}

function readReferencedProcessMessageId(event: RunTimelineEvent): string | undefined {
  return isTerminalEvent(event) ? readString(event.inlinePayload.terminalMessageId) : readString(event.inlinePayload.messageId);
}

function readTerminalAssistantContent(event: RunTimelineEvent, message?: RuntimeResolvedProcessMessage): string | undefined {
  if (
    !isTerminalEvent(event) ||
    message?.role !== 'ASSISTANT' ||
    message.visible !== true ||
    message.metadata['eventType'] !== event.type ||
    message.metadata['status'] !== terminalStatusFromEventType(event.type)
  ) {
    return undefined;
  }
  return readString(message.content);
}

function readAssistantPublicContent(message?: RuntimeResolvedProcessMessage): string | undefined {
  if (message?.role !== 'ASSISTANT' || message.metadata['kind'] !== 'ASSISTANT_TOOL_USE') {
    return undefined;
  }
  const content = readString(parseMessageContent(message.content)?.content);
  return content === undefined || content.trim().length === 0 ? undefined : content;
}

function readReferencedToolCall(
  message: RuntimeResolvedProcessMessage | undefined,
  expectedToolCallId: unknown,
  expectedCapabilityId: unknown,
): JsonObject | undefined {
  const toolCallId = readString(expectedToolCallId);
  const capabilityId = readString(expectedCapabilityId);
  const metadataToolCallIds = message?.metadata['toolCallIds'];
  if (
    message?.role !== 'ASSISTANT' ||
    message.metadata['kind'] !== 'ASSISTANT_TOOL_USE' ||
    toolCallId === undefined ||
    capabilityId === undefined ||
    !Array.isArray(metadataToolCallIds) ||
    !metadataToolCallIds.includes(toolCallId)
  ) {
    return undefined;
  }
  const toolCalls = parseMessageContent(message.content)?.toolCalls;
  if (!Array.isArray(toolCalls)) {
    return undefined;
  }
  const matchingToolCalls = toolCalls
    .map((value) => readRecord(value))
    .filter(
      (value): value is JsonObject =>
        value !== undefined &&
        readString(value.toolCallId) === toolCallId &&
        readString(value.toolName) === capabilityId &&
        readRecord(value.arguments) !== undefined,
    );
  return matchingToolCalls.length === 1 ? matchingToolCalls[0] : undefined;
}

const capabilityTargetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function projectCapabilityTargetName(toolCall: JsonObject): string | undefined {
  const toolName = readString(toolCall.toolName);
  let targetField: 'name' | 'agentId' | 'apiName';
  if (toolName === 'Skill') {
    targetField = 'name';
  } else if (toolName === 'Agent') {
    targetField = 'agentId';
  } else if (toolName === 'ApiCall') {
    targetField = 'apiName';
  } else {
    return undefined;
  }
  const targetName = readString(readRecord(toolCall.arguments)?.[targetField])?.trim();
  return targetName !== undefined && capabilityTargetNamePattern.test(targetName) ? targetName : undefined;
}

function readReferencedCapabilityResult(
  message: RuntimeResolvedProcessMessage | undefined,
  expectedToolCallId: unknown,
  expectedCapabilityId: unknown,
): { readonly toolCallId: string; readonly toolName: string; readonly payload: JsonObject } | undefined {
  const toolCallId = readString(expectedToolCallId);
  const capabilityId = readString(expectedCapabilityId);
  const parsed = parseMessageContent(message?.content);
  const resultPayload = readRecord(parsed?.payload);
  if (
    message?.role !== 'CAPABILITY_RESULT' ||
    message.metadata['kind'] !== 'CAPABILITY_RESULT' ||
    toolCallId === undefined ||
    capabilityId === undefined ||
    message.metadata['toolCallId'] !== toolCallId ||
    message.metadata['toolName'] !== capabilityId ||
    readString(parsed?.toolCallId) !== toolCallId ||
    readString(parsed?.toolName) !== capabilityId ||
    resultPayload === undefined
  ) {
    return undefined;
  }
  return { toolCallId, toolName: capabilityId, payload: resultPayload };
}

function parseMessageContent(content?: string): JsonObject | undefined {
  if (content === undefined) {
    return undefined;
  }
  try {
    return readRecord(JSON.parse(content));
  } catch {
    return undefined;
  }
}

function projectUnavailableCapabilityPayload(target: Record<string, JsonValue>, event: RunTimelineEvent): void {
  target.contentType = 'PLAIN_TEXT';
  target.metadata = { accumulated: true };
  target.contentUnavailable = true;
  copySafeFields(target, event.inlinePayload, ['capabilityId', 'toolCallId', 'status', 'safeErrorCode', 'safeErrorCategory']);
  projectCapabilityPublicIdentity(target, event.inlinePayload);
}

function projectCapabilityResultPayload(target: Record<string, JsonValue>, source: JsonObject, policy?: CapabilityResultPresentationPolicy): void {
  const projection = projectCapabilityResultWebProjection(source, policy);
  const detailText = projection.level === 'DETAIL' ? (projection.safeProjection?.detailText ?? '') : '';
  target.text = detailText;
  target.content = detailText;
  target.contentType = 'PLAIN_TEXT';
  target.metadata = { accumulated: true };
  target.resultPresentationLevel = projection.level;
  copySafeFields(target, source, ['capabilityId', 'toolCallId', 'status', 'safeErrorCode', 'safeErrorCategory']);
  const pendingInputAnswer =
    readString(source.capabilityId) === 'AskUserQuestion'
      ? projectAskUserQuestionAnswerResult(resolveAskUserQuestionProjectionSource(source))
      : undefined;
  if (pendingInputAnswer !== undefined) {
    copySafeFields(target, pendingInputAnswer, ['capabilityId', 'toolCallId', 'pendingInputId', 'kind', 'status', 'safeSummary', 'safeResult']);
    target.safeSummaryCode = 'CAPABILITY_RESULT_PENDING_INPUT_ANSWER_RECEIVED';
    target.safeSummaryArgs = {};
    return;
  }
  copySafeCapabilityFailureFields(target, projection.safeFailure);
  const safeSummary = projection.safeFailure?.safeSummary ?? projection.safeProjection?.safeSummary;
  if (projection.level !== 'STATUS_ONLY' && safeSummary !== undefined) {
    target.safeSummary = safeSummary;
  } else if (projection.safeFailure?.safeSummary !== undefined) {
    target.safeSummary = projection.safeFailure.safeSummary;
  }
  const safeResult = resultForPresentationLevel(projection);
  if (safeResult !== undefined) {
    target.safeResult = safeResult;
  }
  const safeSummaryDescriptor = projectSafeSummaryDescriptor(projection.safeProjection, projection.safeFailure);
  if (safeSummaryDescriptor !== undefined && (projection.level !== 'STATUS_ONLY' || projection.safeFailure !== undefined)) {
    target.safeSummaryCode = safeSummaryDescriptor.code;
    target.safeSummaryArgs = safeSummaryDescriptor.args;
  }
}

function resultForPresentationLevel(projection: CapabilityResultWebProjection): JsonObject | undefined {
  if (projection.safeProjection === undefined) {
    return undefined;
  }
  if (projection.level === 'DETAIL') {
    return projection.safeProjection.safeResult;
  }
  return projection.level === 'SUMMARY' ? projection.safeProjection.summarySafeResult : undefined;
}

function projectCapabilityResultWebProjection(source: JsonObject, policy?: CapabilityResultPresentationPolicy): CapabilityResultWebProjection {
  const safeFailure = projectSafeCapabilityFailureProjection(source);
  if (safeFailure !== undefined) {
    return { level: 'STATUS_ONLY', safeFailure };
  }

  const safeProjection = projectSafeCapabilityResultProjection(source);
  const platformMaximum: CapabilityResultPresentationLevel = safeProjection === undefined ? 'STATUS_ONLY' : 'DETAIL';
  const capabilityId = readString(source.capabilityId);
  const configuredLevel =
    capabilityId === undefined || policy === undefined ? 'STATUS_ONLY' : (policy.levelByCapabilityId.get(capabilityId) ?? policy.defaultLevel);
  const effectiveLevel = minimumPresentationLevel(platformMaximum, configuredLevel);
  return {
    level: effectiveLevel,
    ...(safeProjection === undefined ? {} : { safeProjection }),
  };
}

function minimumPresentationLevel(
  left: CapabilityResultPresentationLevel,
  right: CapabilityResultPresentationLevel,
): CapabilityResultPresentationLevel {
  const levels = ['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const;
  return levels[Math.min(levels.indexOf(left), levels.indexOf(right))]!;
}

function isValidThinkingTimelineEvent(event: RunTimelineEvent): boolean {
  const reasoning = event.inlinePayload.reasoning;
  const stepId = event.inlinePayload.stepId;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    return false;
  }
  if (typeof stepId !== 'string' || stepId.trim().length === 0) {
    return false;
  }
  if (
    event.inlinePayload.segmentId !== undefined ||
    event.inlinePayload.segmentOrdinal !== undefined ||
    event.inlinePayload.content !== undefined ||
    event.inlinePayload.text !== undefined
  ) {
    return false;
  }
  if (event.inlinePayload.completed === undefined) {
    return event.persistence === 'LIVE_ONLY';
  }
  return event.inlinePayload.completed === true && event.persistence === 'PERSISTED';
}

function copySafeFields(target: Record<string, JsonValue>, source: JsonObject, keys: readonly string[]): void {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && isJsonValue(value)) {
      target[key] = value;
    }
  }
}

function projectCapabilityPublicIdentity(target: Record<string, JsonValue>, source: JsonObject): void {
  const capabilityKind = source.capabilityKind;
  if (capabilityKind === 'TOOL' || capabilityKind === 'SKILL' || capabilityKind === 'AGENT' || capabilityKind === 'WORKFLOW') {
    target.capabilityKind = capabilityKind;
  }
  const targetCapabilityId = source.targetCapabilityId;
  if (
    (source.capabilityId === 'Agent' || source.capabilityId === 'Skill' || source.capabilityId === 'Workflow') &&
    typeof targetCapabilityId === 'string' &&
    targetCapabilityId.trim() === targetCapabilityId &&
    targetCapabilityId.length > 0 &&
    Array.from(targetCapabilityId).length <= 128 &&
    !/\p{Cc}/u.test(targetCapabilityId)
  ) {
    target.targetCapabilityId = targetCapabilityId;
  }
}

function copySafeCapabilityFailureFields(target: Record<string, JsonValue>, failure?: SafeCapabilityFailureProjection): void {
  if (failure?.safeErrorCode !== undefined) {
    target.safeErrorCode = failure.safeErrorCode;
  }
  if (failure?.safeErrorCategory !== undefined) {
    target.safeErrorCategory = failure.safeErrorCategory;
  }
}

function projectSafeCapabilityResultProjection(source: JsonObject): SafeCapabilityResultProjection | undefined {
  const capabilityId = readString(source.capabilityId);
  if (capabilityId === 'Skill' || capabilityId === undefined) {
    return undefined;
  }

  if (capabilityId === 'AskUserQuestion') {
    const pendingInputAnswer = projectAskUserQuestionAnswerResult(resolveAskUserQuestionProjectionSource(source));
    const safeResult = readRecord(pendingInputAnswer?.safeResult);
    if (pendingInputAnswer === undefined || safeResult === undefined) {
      return undefined;
    }
    return {
      safeSummary: readString(pendingInputAnswer.safeSummary) ?? 'User input was received.',
      detailText: '',
      safeResult,
    };
  }

  const result = readRecord(source.result);
  if (result !== undefined) {
    if (source.resultProjectionKind === CLIP_STREAM_RESULT_PROJECTION_KIND) {
      return projectClipStreamSafeResult(result);
    }
    if (capabilityId === 'TodoWrite') {
      return projectTodoWriteSafeResult(source, result);
    }
    if (capabilityId === 'Cron') {
      return projectCronSafeResult(result);
    }
    if (capabilityId === 'Workflow') {
      return projectWorkflowSafeResult(result) ?? projectRecognizedUpstreamSafeCapabilityResultProjection(source);
    }
    if (capabilityId === 'ToolSearch') {
      return projectToolSearchSafeResult(source, result);
    }
    if (capabilityId === 'Rag') {
      return projectRagRetrievalSafeResult(source, result);
    }
    if (capabilityId === 'Bash' || capabilityId === 'Python') {
      return projectCommandOutputSafeResult(result);
    }
    if (capabilityId === 'Read') {
      return projectFileReadSafeResult(result);
    }
    if (capabilityId === 'Grep') {
      return projectGrepSafeResult(result);
    }
    if (capabilityId === 'Glob') {
      return projectFileListSafeResult(result);
    }
    if (capabilityId === 'Write' || capabilityId === 'Edit') {
      return projectFileWriteSafeResult(result);
    }
  }

  return projectRecognizedUpstreamSafeCapabilityResultProjection(source);
}

function projectSafeSummaryDescriptor(
  projection?: SafeCapabilityResultProjection,
  failure?: SafeCapabilityFailureProjection,
): SafeSummaryDescriptor | undefined {
  if (failure !== undefined) {
    return {
      code: safeFailureSummaryCode(failure.safeErrorCode, failure.safeErrorCategory),
      args: {},
    };
  }
  if (projection?.summaryDescriptor !== undefined) {
    return projection.summaryDescriptor;
  }
  const safeResult = projection?.safeResult;
  const kind = readString(safeResult?.kind);
  if (safeResult === undefined || kind === undefined) {
    return undefined;
  }
  if (kind === 'fileRead') {
    const filePath = readString(safeResult.filePath);
    return filePath === undefined ? undefined : { code: 'CAPABILITY_RESULT_FILE_READ', args: { filePath } };
  }
  if (kind === 'fileList') {
    const totalCount = readNonNegativeInteger(safeResult.totalCount);
    return totalCount === undefined ? undefined : { code: 'CAPABILITY_RESULT_FILE_LIST', args: { totalCount } };
  }
  if (kind === 'fileWrite') {
    const operation = readString(safeResult.operation);
    const filePath = readString(safeResult.filePath);
    if ((operation !== 'create' && operation !== 'update') || filePath === undefined) {
      return undefined;
    }
    return {
      code: operation === 'create' ? 'CAPABILITY_RESULT_FILE_CREATED' : 'CAPABILITY_RESULT_FILE_UPDATED',
      args: { filePath },
    };
  }
  if (kind === 'commandOutput') {
    const exitCode = readNumber(safeResult.exitCode);
    if (exitCode === undefined) {
      return undefined;
    }
    const timedOut = readBoolean(safeResult.timedOut) === true;
    const hasStdout = (readString(safeResult.stdoutPreview)?.trim().length ?? 0) > 0;
    const hasStderr = (readString(safeResult.stderrPreview)?.trim().length ?? 0) > 0;
    const code = timedOut
      ? 'CAPABILITY_RESULT_COMMAND_TIMED_OUT'
      : exitCode === 0
        ? hasStdout || hasStderr
          ? 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT'
          : 'CAPABILITY_RESULT_COMMAND_SUCCEEDED'
        : hasStderr
          ? 'CAPABILITY_RESULT_COMMAND_FAILED_WITH_ERROR'
          : 'CAPABILITY_RESULT_COMMAND_FAILED';
    return { code, args: { exitCode } };
  }
  if (kind === 'toolSearch') {
    const totalCount = readNonNegativeInteger(safeResult.totalCount);
    return totalCount === undefined ? undefined : { code: 'CAPABILITY_RESULT_TOOL_SEARCH', args: { totalCount } };
  }
  if (kind === 'ragRetrieval') {
    const totalCount = readNonNegativeInteger(safeResult.totalCount);
    return totalCount === undefined ? undefined : { code: 'CAPABILITY_RESULT_RAG_RETRIEVAL', args: { totalCount } };
  }
  if (kind === 'todoList') {
    const totalCount = readNonNegativeInteger(safeResult.totalCount);
    return totalCount === undefined
      ? undefined
      : { code: totalCount === 0 ? 'CAPABILITY_RESULT_TODO_LIST_CLEAR' : 'CAPABILITY_RESULT_TODO_LIST', args: { totalCount } };
  }
  if (kind === 'cron') {
    const action = readString(safeResult.action);
    const totalCount = readNonNegativeInteger(safeResult.totalCount);
    if (action === 'create') {
      return { code: 'CAPABILITY_RESULT_CRON_CREATED', args: {} };
    }
    if (action === 'delete') {
      return { code: 'CAPABILITY_RESULT_CRON_DELETED', args: {} };
    }
    if (action === 'list' && totalCount !== undefined) {
      return { code: 'CAPABILITY_RESULT_CRON_LIST', args: { totalCount } };
    }
    return undefined;
  }
  if (kind === 'workflowResult') {
    const recipeName = readBoundedInlineText(safeResult.recipeName, toolSearchIdentityMaxChars);
    const status = readBoundedInlineText(safeResult.status, toolSearchIdentityMaxChars);
    return recipeName === undefined || status === undefined ? undefined : { code: 'CAPABILITY_RESULT_WORKFLOW', args: { recipeName, status } };
  }
  if (kind === 'workflowDelta') {
    const channel = readString(safeResult.channel);
    return channel === 'THINKING'
      ? { code: 'CAPABILITY_RESULT_WORKFLOW_THINKING', args: {} }
      : channel === 'CONTENT'
        ? { code: 'CAPABILITY_RESULT_WORKFLOW_CONTENT', args: {} }
        : undefined;
  }
  if (kind === 'clipStreamEvent') {
    return { code: 'CAPABILITY_RESULT_CLIP_EVENT', args: {} };
  }
  if (kind === 'clipStreamCompletion' || kind === 'clipStreamResult') {
    const eventCount = readNonNegativeInteger(safeResult.event_count);
    return {
      code: kind === 'clipStreamCompletion' ? 'CAPABILITY_RESULT_CLIP_COMPLETED' : 'CAPABILITY_RESULT_CLIP_RESULT',
      args: eventCount === undefined ? {} : { eventCount },
    };
  }
  if (kind === 'pendingInputAnswer') {
    return { code: 'CAPABILITY_RESULT_PENDING_INPUT_ANSWER_RECEIVED', args: {} };
  }
  return undefined;
}

function safeFailureSummaryCode(code?: string, category?: string): string {
  const codeSpecificSummary = auditedSafeFailureSummaryCode(code, category);
  if (codeSpecificSummary !== undefined) {
    return codeSpecificSummary;
  }
  switch (category) {
    case 'AUTHORIZATION':
    case 'POLICY_DENIED':
      return 'CAPABILITY_RESULT_FAILURE_POLICY_DENIED';
    case 'VALIDATION':
      return 'CAPABILITY_RESULT_FAILURE_VALIDATION';
    case 'NOT_FOUND':
      return 'CAPABILITY_RESULT_FAILURE_NOT_FOUND';
    case 'CONFLICT':
      return 'CAPABILITY_RESULT_FAILURE_CONFLICT';
    case 'UNAVAILABLE':
      return 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE';
    case 'TIMEOUT':
      return 'CAPABILITY_RESULT_FAILURE_TIMEOUT';
    case 'CANCELED':
      return 'CAPABILITY_RESULT_FAILURE_CANCELED';
    case 'INTERNAL':
      return 'CAPABILITY_RESULT_FAILURE_INTERNAL';
    default:
      return 'CAPABILITY_RESULT_FAILURE';
  }
}

function auditedSafeFailureSummaryCode(code?: string, category?: string): string | undefined {
  if (code === 'COMMAND_NOT_ALLOWED' && (category === undefined || category === 'AUTHORIZATION' || category === 'POLICY_DENIED')) {
    return 'CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED';
  }
  if ((code === 'CAPABILITY_INPUT_INVALID' || code === 'INVALID_INPUT') && (category === undefined || category === 'VALIDATION')) {
    return 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT';
  }
  if (code === 'CAPABILITY_PATH_REJECTED' && (category === 'AUTHORIZATION' || category === 'POLICY_DENIED')) {
    return 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED';
  }
  if ((code === 'CAPABILITY_RESULT_LIMIT_EXCEEDED' || code === 'RESOURCE_TOO_LARGE') && (category === undefined || category === 'VALIDATION')) {
    return 'CAPABILITY_RESULT_FAILURE_TOO_LARGE';
  }
  if ((code === 'WRITE_REQUIRES_FULL_READ' || code === 'EDIT_REQUIRES_FULL_READ') && (category === undefined || category === 'CONFLICT')) {
    return 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED';
  }
  if ((code === 'WRITE_TARGET_CHANGED' || code === 'EDIT_TARGET_CHANGED') && (category === undefined || category === 'CONFLICT')) {
    return 'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED';
  }
  if (code === 'PLATFORM_UNSUPPORTED' && (category === undefined || category === 'UNAVAILABLE')) {
    return 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED';
  }
  if ((code === 'INTERPRETER_UNAVAILABLE' || code === 'SANDBOX_UNAVAILABLE') && (category === undefined || category === 'UNAVAILABLE')) {
    return 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE';
  }
  return undefined;
}

function resolveAskUserQuestionProjectionSource(source: JsonObject): JsonObject {
  const result = readRecord(source.result);
  return result === undefined
    ? source
    : {
        ...result,
        capabilityId: 'AskUserQuestion',
        ...(source.toolCallId === undefined ? {} : { toolCallId: source.toolCallId }),
      };
}

function projectRecognizedUpstreamSafeCapabilityResultProjection(source: JsonObject): SafeCapabilityResultProjection | undefined {
  const safeResult = readRecord(source.safeResult);
  const kind = readString(safeResult?.kind);
  const detailPreview = projectBoundedUpstreamDetail(source.safeDetailText);
  if (safeResult === undefined || kind === undefined || detailPreview === undefined) {
    return undefined;
  }

  if (kind === 'workflowDelta' && readString(source.capabilityId) === 'Workflow') {
    const channel = readString(safeResult.channel);
    const truncated = readBoolean(safeResult.truncated);
    if ((channel !== 'THINKING' && channel !== 'CONTENT') || truncated === undefined) {
      return undefined;
    }
    return {
      safeSummary: channel === 'THINKING' ? 'Workflow is generating reasoning.' : 'Workflow is generating output.',
      detailText: detailPreview.text,
      safeResult: {
        kind,
        channel,
        truncated: truncated || detailPreview.truncated,
      },
    };
  }

  return undefined;
}

function projectClipStreamSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  const dataRaw = readString(result.data_raw);
  if (dataRaw !== undefined) {
    const dataRawPreview = previewText(dataRaw);
    const eventType = readBoundedInlineText(result.event, toolSearchIdentityMaxChars);
    return {
      safeSummary: 'CLIP stream event received.',
      detailText: dataRawPreview.text,
      safeResult: {
        kind: 'clipStreamEvent',
        ...(eventType === undefined ? {} : { eventType }),
        dataRawPreview: dataRawPreview.text,
        dataRawTruncated: dataRawPreview.truncated,
      },
    };
  }

  const legacyEvent = readRecord(result.event);
  if (legacyEvent !== undefined) {
    const eventType = readBoundedInlineText(legacyEvent.type, toolSearchIdentityMaxChars);
    const eventData = readRecord(legacyEvent.data);
    const chunk = readString(eventData?.chunk) ?? readString(eventData?.text) ?? readString(eventData?.content);
    if (eventType !== undefined || chunk !== undefined) {
      const chunkPreview = chunk === undefined ? undefined : previewText(chunk);
      return {
        safeSummary: 'CLIP stream event received.',
        detailText: chunkPreview?.text ?? '',
        safeResult: {
          kind: 'clipStreamEvent',
          ...(eventType === undefined ? {} : { eventType }),
          ...(chunkPreview === undefined ? {} : { chunk: chunkPreview.text }),
          ...(chunkPreview?.truncated === true ? { chunkTruncated: true } : {}),
        },
      };
    }
  }

  const completion = readRecord(result.completion);
  if (completion !== undefined) {
    const reason = readBoundedInlineText(completion.reason, toolSearchIdentityMaxChars);
    const eventCount = readNonNegativeInteger(completion.event_count) ?? readNonNegativeInteger(completion.eventCount);
    if (reason !== undefined || eventCount !== undefined) {
      return {
        safeSummary:
          eventCount === undefined ? 'CLIP stream completed.' : `CLIP stream completed with ${eventCount} event${eventCount === 1 ? '' : 's'}.`,
        detailText: '',
        safeResult: {
          kind: 'clipStreamCompletion',
          ...(reason === undefined ? {} : { reason }),
          ...(eventCount === undefined ? {} : { event_count: eventCount }),
        },
      };
    }
  }

  if (Array.isArray(result.events)) {
    return {
      safeSummary: `CLIP stream result contains ${result.events.length} event${result.events.length === 1 ? '' : 's'}.`,
      detailText: '',
      safeResult: { kind: 'clipStreamResult', event_count: result.events.length },
    };
  }
  return undefined;
}

function projectBoundedUpstreamDetail(value: unknown): { readonly text: string; readonly truncated: boolean } | undefined {
  if (value === undefined) {
    return { text: '', truncated: false };
  }
  return typeof value === 'string' ? previewText(value) : undefined;
}

function projectToolSearchSafeResult(source: JsonObject, result: JsonObject): SafeCapabilityResultProjection | undefined {
  if (readString(source.capabilityId) !== 'ToolSearch' || !Array.isArray(result.tools) || typeof result.truncated !== 'boolean') {
    return undefined;
  }

  const tools: JsonObject[] = [];
  let projectedTextWasTruncated = false;
  for (const item of result.tools) {
    const record = readRecord(item);
    const capabilityId = readBoundedInlineText(record?.capability_id, toolSearchIdentityMaxChars);
    const name = readBoundedInlineText(record?.name, toolSearchIdentityMaxChars);
    const kind = readString(record?.kind);
    if (capabilityId === undefined || name === undefined || (kind !== 'TOOL' && kind !== 'SKILL')) {
      return undefined;
    }

    const description = readString(record?.description);
    const descriptionPreview = description === undefined ? undefined : previewTextWithLimit(description, toolSearchDescriptionMaxChars);
    projectedTextWasTruncated ||= descriptionPreview?.truncated === true;
    tools.push({
      capability_id: capabilityId,
      name,
      kind,
      ...(descriptionPreview === undefined ? {} : { description: descriptionPreview.text }),
    });
  }

  const projectedTools = tools.slice(0, resultListPreviewMaxItems);
  const truncated = result.truncated || tools.length > projectedTools.length || projectedTextWasTruncated;
  const detailPreview = previewText(
    projectedTools
      .map((tool) => {
        const description = readString(tool.description);
        return `${String(tool.name)} (${String(tool.kind)} · ${String(tool.capability_id)})${description === undefined ? '' : `\n${description}`}`;
      })
      .join('\n\n'),
  );

  return {
    safeSummary: `ToolSearch found ${tools.length} governed ${tools.length === 1 ? 'capability' : 'capabilities'}.`,
    detailText: [detailPreview.text, truncated || detailPreview.truncated ? 'Result was truncated.' : null]
      .filter((line): line is string => Boolean(line && line.trim().length > 0))
      .join('\n\n'),
    safeResult: {
      kind: 'toolSearch',
      tools: projectedTools,
      totalCount: tools.length,
      truncated: truncated || detailPreview.truncated,
    },
  };
}

function projectRagRetrievalSafeResult(source: JsonObject, result: JsonObject): SafeCapabilityResultProjection | undefined {
  if (readString(source.capabilityId) !== 'Rag' || result.status !== 'OK' || !Array.isArray(result.results)) {
    return undefined;
  }

  const items: JsonObject[] = [];
  for (const resultItem of result.results) {
    const record = readRecord(resultItem);
    items.push({
      source: extractRagSafeSource(record),
      content: readString(record?.content) ?? '',
    });
  }

  const safeResult = {
    kind: 'ragRetrieval',
    totalCount: result.results.length,
    items: items.slice(0, resultListPreviewMaxItems),
  };
  return {
    safeSummary: `Retrieved ${result.results.length} RAG result(s).`,
    detailText: '',
    safeResult,
  };
}

function extractRagSafeSource(record: JsonObject | undefined): string {
  const rawSource = readString(record?.source)?.trim();
  const sourceSegment = rawSource === undefined || rawSource.length === 0 ? '' : (rawSource.split('|')[0]?.trim() ?? '');
  if (sourceSegment.length > 0) {
    return sourceSegment;
  }
  const title = readString(record?.title)?.trim();
  if (title !== undefined && title.length > 0) {
    return title;
  }
  const content = readString(record?.content)?.trim() ?? '';
  if (content.length <= ragSourceFallbackContentMaxChars) {
    return content;
  }
  return `${content.slice(0, ragSourceFallbackContentMaxChars)}...`;
}

function projectTodoWriteSafeResult(source: JsonObject, result: JsonObject): SafeCapabilityResultProjection | undefined {
  const capabilityId = readString(source.capabilityId);
  if (capabilityId !== 'TodoWrite') {
    return undefined;
  }
  const newTodos = readTodoItems(result.newTodos);
  if (newTodos === undefined) {
    return undefined;
  }
  const projectedTodos = newTodos.slice(0, resultListPreviewMaxItems);
  return {
    safeSummary: newTodos.length === 0 ? 'Todo list is clear.' : `Todo list has ${newTodos.length} item${newTodos.length === 1 ? '' : 's'}.`,
    detailText: '',
    safeResult: {
      kind: 'todoList',
      todos: projectedTodos,
      totalCount: newTodos.length,
    },
  };
}

function projectCronSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  const action = readString(result.action);
  if (action === 'create') {
    const id = readBoundedInlineText(result.id, cronProjectionInlineTextMaxChars);
    const humanSchedule = readBoundedInlineText(result.humanSchedule, cronProjectionInlineTextMaxChars);
    const recurring = readBoolean(result.recurring);
    if (id === undefined || humanSchedule === undefined || recurring === undefined) {
      return undefined;
    }
    const delay = readCronDelay(result.delay);
    if (result.delay !== undefined && delay === undefined) {
      return undefined;
    }
    return {
      safeSummary: 'Cron task was created.',
      detailText: `Task: ${id}\nSchedule: ${humanSchedule}`,
      safeResult: { kind: 'cron', action, id, humanSchedule, recurring, ...(delay === undefined ? {} : { delay }) },
    };
  }

  if (action === 'delete') {
    const id = readBoundedInlineText(result.id, cronProjectionInlineTextMaxChars);
    if (id === undefined) {
      return undefined;
    }
    return {
      safeSummary: 'Cron task was deleted.',
      detailText: `Task: ${id}`,
      safeResult: { kind: 'cron', action, id },
    };
  }

  if (action !== 'list') {
    return undefined;
  }
  const jobs = readCronSafeJobs(result.jobs);
  if (jobs === undefined) {
    return undefined;
  }
  const projectedJobs = jobs.slice(0, resultListPreviewMaxItems);
  const truncated = jobs.length > resultListPreviewMaxItems;
  const details = projectedJobs.map((job) => `${String(job.id)}: ${String(job.humanSchedule)} (${String(job.cron)})`);
  return {
    safeSummary: `Found ${jobs.length} Cron task${jobs.length === 1 ? '' : 's'}.`,
    detailText: [details.join('\n'), truncated ? 'Result was truncated.' : null]
      .filter((line): line is string => Boolean(line && line.trim().length > 0))
      .join('\n\n'),
    safeResult: {
      kind: 'cron',
      action,
      jobs: projectedJobs,
      totalCount: jobs.length,
      truncated,
    },
  };
}

function readCronDelay(value: unknown): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readRecord(value);
  if (record === undefined || Object.keys(record).some((key) => !['days', 'hours', 'minutes'].includes(key))) {
    return undefined;
  }
  const days = readDelayComponent(record, 'days');
  const hours = readDelayComponent(record, 'hours');
  const minutes = readDelayComponent(record, 'minutes');
  if (days === null || hours === null || minutes === null) {
    return undefined;
  }
  const delay: JsonObject = {
    ...(days === undefined ? {} : { days }),
    ...(hours === undefined ? {} : { hours }),
    ...(minutes === undefined ? {} : { minutes }),
  };
  return Object.keys(delay).length === 0 ? undefined : delay;
}

function readDelayComponent(record: JsonObject, key: string): number | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  const value = readNumber(record[key]);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readCronSafeJobs(value: unknown): readonly JsonObject[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const jobs: JsonObject[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const id = readBoundedInlineText(record?.id, cronProjectionInlineTextMaxChars);
    const cron = readBoundedInlineText(record?.cron, cronProjectionInlineTextMaxChars);
    const humanSchedule = readBoundedInlineText(record?.humanSchedule, cronProjectionInlineTextMaxChars);
    if (id === undefined || cron === undefined || humanSchedule === undefined) {
      return undefined;
    }
    jobs.push({
      id,
      cron,
      humanSchedule,
      recurring: readBoolean(record?.recurring) ?? false,
    });
  }
  return jobs;
}

function projectSafeCapabilityFailureProjection(source: JsonObject): SafeCapabilityFailureProjection | undefined {
  const safeError = readRecord(source.safeError);
  const result = readRecord(source.result);
  const resultSafeError = readRecord(result?.safeError);
  const safeErrorCode = readString(source.safeErrorCode) ?? readString(safeError?.code) ?? readString(resultSafeError?.code);
  const safeErrorCategory = readString(source.safeErrorCategory) ?? readString(safeError?.category) ?? readString(resultSafeError?.category);
  if (safeErrorCode === undefined && safeErrorCategory === undefined && readString(source.status) !== 'FAILED') {
    return undefined;
  }
  const summaryCode = safeFailureSummaryCode(safeErrorCode, safeErrorCategory);
  return {
    ...(safeErrorCode === undefined ? {} : { safeErrorCode }),
    ...(safeErrorCategory === undefined ? {} : { safeErrorCategory }),
    safeSummary: summarizeSafeCapabilityFailure(summaryCode),
  };
}

function summarizeSafeCapabilityFailure(summaryCode: string): string {
  switch (summaryCode) {
    case 'CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED':
      return 'Command was blocked by the security policy and was not executed.';
    case 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT':
      return 'Tool input is invalid, so the capability was not executed.';
    case 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED':
      return 'Path access was blocked by policy.';
    case 'CAPABILITY_RESULT_FAILURE_TOO_LARGE':
      return 'Capability result was too large to display safely.';
    case 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED':
      return 'The latest file content must be read completely before it can be modified.';
    case 'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED':
      return 'The file changed while it was being processed, so the modification was not applied.';
    case 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED':
      return 'The current runtime environment does not support this capability.';
    case 'CAPABILITY_RESULT_FAILURE_POLICY_DENIED':
      return 'Capability execution was blocked by policy.';
    case 'CAPABILITY_RESULT_FAILURE_VALIDATION':
      return 'Capability input could not be accepted safely.';
    case 'CAPABILITY_RESULT_FAILURE_NOT_FOUND':
      return 'The object required for this operation was not found.';
    case 'CAPABILITY_RESULT_FAILURE_CONFLICT':
      return 'The current state conflicts with the operation requirements.';
    case 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE':
      return 'Capability execution is unavailable.';
    case 'CAPABILITY_RESULT_FAILURE_TIMEOUT':
      return 'Capability execution timed out.';
    case 'CAPABILITY_RESULT_FAILURE_CANCELED':
      return 'Capability execution was canceled.';
    case 'CAPABILITY_RESULT_FAILURE_INTERNAL':
      return 'An internal error occurred while processing this capability.';
    default:
      return 'Capability execution failed safely.';
  }
}

function projectCommandOutputSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  const exitCode = readNumber(result.exitCode) ?? readNumber(result.exit_code);
  const stdout = readString(result.stdout);
  const stderr = readString(result.stderr);
  if (exitCode === undefined || (stdout === undefined && stderr === undefined)) {
    return undefined;
  }

  const stdoutPreview = previewText(stdout ?? '');
  const stderrPreview = previewText(stderr ?? '');
  const stdoutTruncated = (readBoolean(result.stdoutTruncated) ?? false) || stdoutPreview.truncated;
  const stderrTruncated = (readBoolean(result.stderrTruncated) ?? false) || stderrPreview.truncated;
  const hasStdout = stdoutPreview.text.trim().length > 0;
  const hasStderr = stderrPreview.text.trim().length > 0;
  const timedOut = readBoolean(result.timedOut) ?? readBoolean(result.timed_out) ?? false;
  const parsedStderr = hasStderr ? parseSafeErrorLine(stderrPreview.text) : undefined;
  const stderrDetailText = parsedStderr?.message ?? stderrPreview.text;
  const safeSummary = timedOut
    ? 'Command timed out and returned partial results.'
    : parsedStderr?.code === 'COMMAND_NOT_ALLOWED'
      ? 'Command was blocked by the security policy and was not executed.'
      : exitCode === 0
        ? hasStdout || hasStderr
          ? 'Command completed and returned output.'
          : 'Command completed.'
        : hasStderr
          ? 'Command failed and returned error information.'
          : 'Command failed.';
  const detailText = [
    `Exit code: ${exitCode}`,
    hasStdout ? `Output:\n${stdoutPreview.text}` : null,
    stdoutTruncated ? 'Output was truncated.' : null,
    parsedStderr ? `Error code: ${parsedStderr.code}` : null,
    hasStderr ? formatErrorInformationText(stderrDetailText) : null,
    stderrTruncated ? 'Error information was truncated.' : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  return {
    safeSummary,
    detailText,
    safeResult: {
      kind: 'commandOutput',
      exitCode,
      stdoutPreview: stdoutPreview.text,
      stderrPreview: stderrPreview.text,
      stdoutTruncated,
      stderrTruncated,
      ...(timedOut ? { timedOut: true } : {}),
    },
  };
}

function parseSafeErrorLine(text: string): { readonly code: string; readonly message: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const [firstLine = '', ...restLines] = trimmed.split(/\r?\n/u);
  const match = /^([A-Z][A-Z0-9_]{1,63}):\s+(.+)$/u.exec(firstLine.trim());
  if (!match) {
    return undefined;
  }
  return {
    code: match[1]!,
    message: [match[2]!, ...restLines].join('\n').trim(),
  };
}

function formatErrorInformationText(message: string): string {
  const trimmed = message.trim();
  return /\r?\n/u.test(trimmed) ? `Error information:\n${trimmed}` : `Error information: ${trimmed}`;
}

function projectFileReadSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  const filePath = projectSafeDisplayPath(result.file_path);
  const content = readString(result.content);
  const offset = readNumber(result.offset);
  const limit = readNumber(result.limit);
  const nextOffset = readNumber(result.nextOffset);
  const truncated = readBoolean(result.truncated);
  if (filePath === undefined || content === undefined || truncated === undefined) {
    return undefined;
  }

  const contentPreview = previewText(content);
  const readRangeText =
    offset === undefined || limit === undefined ? null : `This read starts at line ${offset + 1} and includes up to ${limit} lines.`;
  const truncationText =
    truncated || contentPreview.truncated
      ? nextOffset === undefined
        ? 'The returned content is long, so this detail shows only part of it.'
        : `The file has more content; this result does not include content from line ${nextOffset + 1} onward.`
      : null;
  const safeResult: JsonObject = {
    kind: 'fileRead',
    filePath,
    contentPreview: contentPreview.text,
    truncated: truncated || contentPreview.truncated,
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
    ...(nextOffset === undefined ? {} : { nextOffset }),
  };
  return {
    safeSummary: `Read ${filePath} and returned its content.`,
    detailText: [`File: ${filePath}`, readRangeText, `Content:\n${contentPreview.text}`, truncationText]
      .filter((line): line is string => Boolean(line))
      .join('\n\n'),
    safeResult,
  };
}

function projectFileListSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  if (!Array.isArray(result.filenames) || typeof result.truncated !== 'boolean') {
    return undefined;
  }
  const filenames = result.filenames.map(projectSafeDisplayPath).filter((entry): entry is string => entry !== undefined);
  const safeResult: JsonObject = {
    kind: 'fileList',
    filenames: filenames.slice(0, resultListPreviewMaxItems),
    totalCount: filenames.length,
    truncated: result.truncated || filenames.length > resultListPreviewMaxItems,
  };
  return {
    safeSummary: `Found ${filenames.length} matching files.`,
    detailText: [
      filenames.slice(0, resultListPreviewMaxItems).join('\n'),
      result.truncated || filenames.length > resultListPreviewMaxItems ? 'Result was truncated.' : null,
    ]
      .filter((line): line is string => Boolean(line && line.trim().length > 0))
      .join('\n\n'),
    safeResult,
  };
}

function projectGrepSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  if (!hasExactKeys(result, ['output_mode', 'filenames', 'matches', 'total_files_with_matches', 'total_matches', 'truncated'])) {
    return undefined;
  }
  const outputMode = readString(result.output_mode);
  const filenames = result.filenames;
  const matches = result.matches;
  const totalFilesWithMatches = readNonNegativeInteger(result.total_files_with_matches);
  const totalMatches = readNonNegativeInteger(result.total_matches);
  const canonicalTruncated = readBoolean(result.truncated);
  if (
    (outputMode !== 'files_with_matches' && outputMode !== 'content') ||
    !Array.isArray(filenames) ||
    !Array.isArray(matches) ||
    totalFilesWithMatches === undefined ||
    totalMatches === undefined ||
    canonicalTruncated === undefined
  ) {
    return undefined;
  }

  if (outputMode === 'files_with_matches') {
    if (matches.length !== 0 || filenames.length > totalFilesWithMatches) {
      return undefined;
    }
    const projectedFilenames = filenames.map(projectGrepLogicalPath);
    if (projectedFilenames.some((entry) => entry === undefined)) {
      return undefined;
    }
    const preview = projectedFilenames.slice(0, resultListPreviewMaxItems) as string[];
    const projectionTruncated = canonicalTruncated || projectedFilenames.length > preview.length;
    return {
      safeSummary: `Grep found matches in ${totalFilesWithMatches} files.`,
      detailText: [preview.join('\n'), projectionTruncated ? 'Result was truncated.' : null]
        .filter((line): line is string => Boolean(line && line.length > 0))
        .join('\n\n'),
      safeResult: {
        kind: 'grepResult',
        outputMode,
        totalFilesWithMatches,
        totalMatches,
        truncated: projectionTruncated,
        filenames: preview,
      },
      summaryDescriptor: {
        code: 'CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES',
        args: { totalFilesWithMatches, truncated: canonicalTruncated },
      },
    };
  }

  if (filenames.length !== 0 || matches.length > totalMatches) {
    return undefined;
  }
  const locations: JsonObject[] = [];
  for (const match of matches) {
    const record = readRecord(match);
    const matchedLine = readString(record?.line);
    if (
      record === undefined ||
      !hasExactKeys(record, ['file_path', 'line_number', 'line']) ||
      matchedLine === undefined ||
      matchedLine.length > 4096
    ) {
      return undefined;
    }
    const filePath = projectGrepLogicalPath(record.file_path);
    const lineNumber = readPositiveInteger(record.line_number);
    if (filePath === undefined || lineNumber === undefined) {
      return undefined;
    }
    locations.push({ filePath, lineNumber });
  }
  if (new Set(locations.map((location) => location.filePath)).size > totalFilesWithMatches) {
    return undefined;
  }
  const preview = locations.slice(0, resultListPreviewMaxItems);
  const projectionTruncated = canonicalTruncated || locations.length > preview.length;
  return {
    safeSummary: `Grep found ${totalMatches} matches in ${totalFilesWithMatches} files.`,
    detailText: [
      preview.map((location) => `${String(location.filePath)}:${String(location.lineNumber)}`).join('\n'),
      projectionTruncated ? 'Result was truncated.' : null,
    ]
      .filter((line): line is string => Boolean(line && line.length > 0))
      .join('\n\n'),
    safeResult: {
      kind: 'grepResult',
      outputMode,
      totalFilesWithMatches,
      totalMatches,
      truncated: projectionTruncated,
      locations: preview,
    },
    summaryDescriptor: {
      code: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
      args: { totalMatches, totalFilesWithMatches, truncated: canonicalTruncated },
    },
  };
}

function projectGrepLogicalPath(value: unknown): string | undefined {
  const path = readString(value);
  if (
    path === undefined ||
    path.length === 0 ||
    path.length > toolSearchIdentityMaxChars ||
    path !== path.trim() ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path)
  ) {
    return undefined;
  }
  const segments = path.split('/');
  return segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ? undefined : path;
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function projectFileWriteSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  const filePath = projectSafeDisplayPath(result.file_path);
  const operation = readString(result.type);
  if (filePath === undefined || (operation !== 'create' && operation !== 'update')) {
    return undefined;
  }
  const safeSummary = operation === 'create' ? `File was created: ${filePath}.` : `File was updated: ${filePath}.`;
  return {
    safeSummary,
    detailText: `File: ${filePath}`,
    safeResult: {
      kind: 'fileWrite',
      operation,
      filePath,
    },
  };
}

function projectSafeDisplayPath(value: unknown): string | undefined {
  const raw = readString(value)?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const normalized = raw.replace(/\0/gu, '').replace(/\\/gu, '/').replace(/\/+/gu, '/').trim();
  const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || /^[A-Za-z]:$/u.test(normalized);
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/^[A-Za-z]:$/u.test(segment));
  if (segments.length === 0) {
    return undefined;
  }
  const displaySegments = isAbsolute ? segments.slice(-3) : segments;
  const displayPath = `${isAbsolute ? '…/' : ''}${displaySegments.join('/')}`;
  return displayPath.length <= toolSearchIdentityMaxChars
    ? displayPath
    : `…/${displayPath.slice(Math.max(0, displayPath.length - toolSearchIdentityMaxChars + 2))}`;
}

function projectWorkflowSafeResult(result: JsonObject): SafeCapabilityResultProjection | undefined {
  const normalizedRecipeName = readString(result.recipeName)?.replace(/\s+/gu, ' ').trim();
  const recipeName = readBoundedInlineText(result.recipeName, toolSearchIdentityMaxChars);
  const status = readWorkflowResultStatus(result.status);
  if (recipeName === undefined || recipeName !== normalizedRecipeName || status === undefined) {
    return undefined;
  }
  const rawPreviews = Array.isArray(result.answerPreviews) ? result.answerPreviews : [];
  const answerPreviews = projectBoundedWorkflowAnswerPreviews(rawPreviews);

  const safeSummary = `Workflow "${recipeName}" ${mapWorkflowStatusSummary(status)}.`;
  const detailText = previewText(answerPreviews.join('\n\n---\n\n')).text;

  return {
    safeSummary,
    detailText,
    safeResult: {
      kind: 'workflowResult',
      recipeName,
      status,
      ...(answerPreviews.length === 0 ? {} : { answerPreviews }),
    },
  };
}

function projectBoundedWorkflowAnswerPreviews(values: readonly unknown[]): readonly string[] {
  const previews: string[] = [];
  let remainingChars = resultTextPreviewMaxChars;
  for (const value of values) {
    if (previews.length >= 10 || remainingChars === 0) {
      break;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }
    const preview = previewTextWithLimit(value, remainingChars).text;
    previews.push(preview);
    remainingChars = Math.max(0, remainingChars - preview.length);
  }
  return previews;
}

type WorkflowResultStatus = 'succeeded' | 'interrupted' | 'waiting' | 'failed';

function readWorkflowResultStatus(value: unknown): WorkflowResultStatus | undefined {
  const status = readString(value);
  return status === 'succeeded' || status === 'interrupted' || status === 'waiting' || status === 'failed' ? status : undefined;
}

function mapWorkflowStatusSummary(status: WorkflowResultStatus): string {
  switch (status) {
    case 'succeeded':
      return 'completed';
    case 'interrupted':
      return 'was interrupted';
    case 'waiting':
      return 'is waiting for user input';
    case 'failed':
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function previewText(text: string): { readonly text: string; readonly truncated: boolean } {
  return previewTextWithLimit(text, resultTextPreviewMaxChars);
}
function previewTextWithLimit(text: string, maxChars: number): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  if (maxChars <= 0) {
    return { text: '', truncated: true };
  }
  const truncationMarker = maxChars >= 4 ? '\n...' : '…';
  return {
    text: `${text.slice(0, maxChars - truncationMarker.length).trimEnd()}${truncationMarker}`,
    truncated: true,
  };
}

function readRecord(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value) ? (value as JsonObject) : undefined;
}

function isTerminalEvent(event: RunTimelineEvent): event is RunTimelineEvent & {
  readonly type: Extract<StreamEventType, 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED'>;
} {
  return (
    event.type === 'REQUEST_COMPLETED' || event.type === 'REQUEST_FAILED' || event.type === 'REQUEST_CANCELED' || event.type === 'REQUEST_SUPERSEDED'
  );
}

function readTodoItems(value: unknown): readonly JsonObject[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: JsonObject[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const content = readBoundedInlineText(record?.content, 500);
    const activeForm = readBoundedInlineText(record?.activeForm, 500);
    const status = readString(record?.status);
    if (content === undefined || activeForm === undefined || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
      return undefined;
    }
    items.push({ content, activeForm, status });
  }
  return items;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  const text = readString(value)?.trim();
  return text === undefined || text.length === 0 ? undefined : text;
}

function readBoundedInlineText(value: unknown, maxChars: number): string | undefined {
  const text = readString(value)?.replace(/\s+/gu, ' ').trim();
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const number = readNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  const number = readNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 1 ? number : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function safePendingInputQuestions(value: unknown): readonly JsonObject[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const questions: JsonObject[] = [];
  for (const item of value) {
    if (!isJsonRecord(item)) {
      return undefined;
    }
    const prompt = readString(item['prompt']);
    const rawOptions = item['options'];
    const options = rawOptions === undefined ? undefined : safePendingInputOptions(rawOptions);
    if (prompt === undefined || (rawOptions !== undefined && options === undefined)) {
      return undefined;
    }
    const question: Record<string, JsonValue> = { prompt };
    if (options !== undefined) {
      question['options'] = options;
    }
    const multiple = readBoolean(item['multiple']);
    const custom = readBoolean(item['custom']);
    if (options?.some((option) => option['requiresTextInput'] === true) && multiple === true) {
      return undefined;
    }
    if (multiple !== undefined) {
      question['multiple'] = multiple;
    }
    if (custom !== undefined) {
      question['custom'] = custom;
    }
    questions.push(question);
  }
  return questions;
}

function safePendingInputOptions(value: unknown): readonly JsonObject[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const options: JsonObject[] = [];
  for (const item of value) {
    if (!isJsonRecord(item)) {
      return undefined;
    }
    const label = readString(item['label']);
    const optionValue = readString(item['value']);
    if (label === undefined || optionValue === undefined) {
      return undefined;
    }
    const requiresTextInput = readBoolean(item['requiresTextInput']);
    const rawInputPlaceholder = item['inputPlaceholder'];
    const inputPlaceholder = rawInputPlaceholder === undefined ? undefined : readString(rawInputPlaceholder);
    if (rawInputPlaceholder !== undefined && (requiresTextInput !== true || inputPlaceholder === undefined || inputPlaceholder.length > 200)) {
      return undefined;
    }
    const option: Record<string, JsonValue> = { label, value: optionValue };
    if (requiresTextInput !== undefined) {
      option['requiresTextInput'] = requiresTextInput;
    }
    if (inputPlaceholder !== undefined) {
      option['inputPlaceholder'] = inputPlaceholder;
    }
    options.push(option);
  }
  return options;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value as number) || typeof value !== 'number';
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, seen));
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).every((item) => isJsonValue(item, seen));
}

function canSerialize(value: JsonValue): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function buildStreamEventId(event: RunTimelineEvent, sequence: TimelineSequence): string {
  return event.eventId === undefined
    ? `stream:${String(event.sessionId ?? 'unknown-session')}:${String(sequence)}:${event.type}`
    : `stream:${event.eventId}`;
}

function terminalStatusFromEventType(
  type: Extract<StreamEventType, 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED'>,
): 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED' {
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

function projectProjectionFailure(
  event: RunTimelineEvent,
  outcome: Extract<StreamProjectionOutcome, { kind: 'PROJECTION_FAILURE' }>,
  options: StreamProjectionOptions,
): StreamEnvelope {
  const sequence = event.sequence ?? brand<number, 'TimelineSequence'>(0);
  const requestId = event.requestId ?? options.fallbackRequestId ?? brand<string, 'MessageId'>('unknown-request');
  const createdAt =
    event.createdAt instanceof Date
      ? brand<number, 'EpochMillis'>(event.createdAt.getTime())
      : (options.clock?.() ?? brand<number, 'EpochMillis'>(Date.now()));
  return {
    eventId: `stream-projection-failure:${event.eventId ?? String(sequence)}`,
    sessionId: event.sessionId ?? options.fallbackSessionId ?? brand<string, 'SessionId'>('unknown-session'),
    requestId,
    sequence,
    eventType: 'DEGRADATION_NOTICE',
    transportHints: [],
    payload: {
      rootMessageId: requestId,
      requestId,
      code: outcome.safeError.code,
      message: outcome.safeError.message,
      category: outcome.safeError.category,
      retryable: outcome.safeError.retryable,
      eventType: outcome.eventType,
      metadata: { accumulated: true },
    },
    createdAt,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    ...(event.requestContextId === undefined ? {} : { requestContextId: event.requestContextId }),
    ...(event.eventId === undefined ? {} : { timelineEventRef: event.eventId }),
  };
}

function projectionFailure(eventType: string, code: string): StreamProjectionOutcome {
  return {
    kind: 'PROJECTION_FAILURE',
    eventType,
    safeError: {
      code,
      message: 'Timeline event cannot be projected to the public stream.',
      category: 'VALIDATION',
      retryable: false,
    },
  };
}
