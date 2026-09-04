import {
  AgentError,
  brand,
  getLogger,
  guardrailServiceUnavailableMessage,
  type EpochMillis,
  type IdentityContext,
  type MessageId,
  type RequestRunId,
  type SafeError,
  type SessionId,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';

import { projectTimelineEventsToStreamEnvelopes } from '../projections/stream-envelope.js';
import type { CapabilityResultPresentationPolicy } from '../projections/capability-result-presentation.js';
import { estimateTokens, extractAnswerIncrement, GUARD_ANSWER_TOKEN_THRESHOLD } from './answer-guard-segmenter.js';

const logger = getLogger({ component: 'agent-channel-common', source: 'web-stream-delivery' });

/**
 * Local structural view of the guardrail gateway port, limited to the
 * operations the web channel uses (input question check + output answer check).
 * The full `GuardrailGatewayPort` (in agent-contracts/gateway, which the web
 * channel is forbidden to import by the architecture boundary) is structurally
 * compatible with this interface, so composition can inject the real port.
 */
export interface WebGuardrailCheckQuestionInput {
  readonly questions: readonly string[];
  readonly ignoreItems?: readonly string[];
  readonly locale?: string;
}

export interface WebGuardrailCheckQuestionResult {
  readonly isLegal: boolean;
  readonly refusalMessage: string;
}

export interface WebGuardrailCheckAnswerInput {
  readonly answers: readonly string[];
  readonly locale?: string;
}

export interface WebGuardrailCheckAnswerResult {
  readonly isLegal: boolean;
  readonly refusalMessage: string;
}

export interface WebGuardrailPort {
  checkQuestion: (input: WebGuardrailCheckQuestionInput, signal?: AbortSignal) => Promise<WebGuardrailCheckQuestionResult>;
  checkAnswer: (input: WebGuardrailCheckAnswerInput, signal?: AbortSignal) => Promise<WebGuardrailCheckAnswerResult>;
}

/**
 * Local structural view of the watermark gateway port, limited to the
 * operations the web channel uses. The full WatermarkGatewayPort (in
 * agent-contracts/gateway, which the web channel is forbidden to import by
 * the architecture boundary) is structurally compatible with this interface
 * via a composition wrapper, so composition can inject the adapted port.
 */
export interface WebWatermarkPort {
  applyWatermark: (content: string, signal?: AbortSignal) => Promise<string>;
}

export interface WebStreamDeliveryRequest {
  readonly capabilityResultPresentationPolicy?: CapabilityResultPresentationPolicy;
  readonly sessions: RuntimeSessionPort;
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly lastSeenSequence?: TimelineSequence;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly signal?: AbortSignal;
  readonly timelineReadTimeoutMs?: number;
  readonly clock?: () => EpochMillis;
  readonly onDiagnostic?: (diagnostic: WebStreamDiagnostic) => void;
  readonly guardrail?: WebGuardrailPort;
  readonly guardrailEnabled?: boolean;
  readonly watermark?: WebWatermarkPort;
  readonly getWatermarkEnabled?: () => boolean;
  /**
   * Deployment `defaultLanguage` (BCP-47, e.g. "zh-CN" / "en-US") used to
   * localize the output guard's fail-closed refusal message when the guard
   * service itself is unavailable. Falls back to zh-CN when absent.
   */
  readonly guardLocale?: string;
  /**
   * Invoked when an OUTPUT_GUARD_BLOCKED terminal envelope is injected by the
   * output guard (checkAnswer returned isLegal=false), so the caller can hide
   * the blocked run's assistant message from subsequent model context.
   */
  readonly onOutputGuardBlocked?: (envelope: StreamEnvelope) => void;
}

export interface WebStreamDiagnostic {
  readonly kind: 'STREAM_OPEN' | 'STREAM_CLOSE' | 'TIMELINE_READ_FAILURE' | 'PROJECTION_FAILURE' | 'SERIALIZATION_FAILURE';
  readonly code: string;
  readonly transport?: 'SSE' | 'WEBSOCKET';
}

/**
 * Run an answer check on `answers` (pre-extracted fragments) via the guardrail
 * port. Returns `{ blocked, refusal }` (transport errors map to blocked so the
 * run is retracted rather than leaking unsafe content). The caller extracts
 * only the NEW increment of the answer (from the last checked sentence
 * boundary, aligned forward to complete sentences) so already-checked text is
 * never re-checked. The `checkAnswer` contract caps a call at 10 items / 2000
 * total chars; `extractAnswerIncrement` enforces those caps.
 */
async function checkAnswerFragments(
  guardrail: WebGuardrailPort,
  answers: readonly string[],
  locale?: string,
  signal?: AbortSignal,
): Promise<{ readonly blocked: boolean; readonly refusal: string }> {
  if (answers.length === 0) {
    return { blocked: false, refusal: '' };
  }
  try {
    const result = await guardrail.checkAnswer({ answers, ...(locale !== undefined ? { locale } : {}) }, signal);
    return { blocked: !result.isLegal, refusal: result.refusalMessage };
  } catch {
    return { blocked: true, refusal: guardrailServiceUnavailableMessage(locale) };
  }
}

export function parseLastSeenSequence(value?: string): TimelineSequence | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new AgentError({
      code: 'STREAM_REPLAY_ANCHOR_INVALID',
      message: 'Stream replay anchor must be a non-negative safe integer.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'STREAM_REPLAY_ANCHOR_INVALID' },
    });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AgentError({
      code: 'STREAM_REPLAY_ANCHOR_INVALID',
      message: 'Stream replay anchor must be a non-negative safe integer.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'STREAM_REPLAY_ANCHOR_INVALID' },
    });
  }
  return brand<number, 'TimelineSequence'>(parsed);
}

export async function* deliverWebStream(request: WebStreamDeliveryRequest): AsyncIterable<StreamEnvelope> {
  request.onDiagnostic?.({ kind: 'STREAM_OPEN', code: 'STREAM_OPEN' });
  const runtimeAbortController = new AbortController();
  const abortRuntimeStream = () => runtimeAbortController.abort();
  if (request.signal?.aborted === true) {
    runtimeAbortController.abort();
  } else {
    request.signal?.addEventListener('abort', abortRuntimeStream, { once: true });
  }
  let lastSequence = request.lastSeenSequence === undefined ? 0 : Number(request.lastSeenSequence);
  const guardActive = request.guardrail !== undefined && request.guardrailEnabled === true;

  // Watermark state. LLM_CONTENT_DELTA carries accumulated snapshots, so we
  // track the latest assistant answer delta and flush a watermark delta when
  // the stepId changes (multi-step transition) or REQUEST_COMPLETED arrives.
  // The watermark delta is a shallow copy of the last delta envelope with
  // content replaced, preserving all identity fields (runId, requestContextId,
  // rootMessageId, stepId, final, sequence) so the frontend accepts it as an
  // accumulated snapshot replacement in the same lane.
  const watermarkActive = request.watermark !== undefined && request.getWatermarkEnabled?.() === true;
  let watermarkStepId: string | undefined;
  let watermarkEnvelope: StreamEnvelope | undefined;

  // Flush the pending LLM_CONTENT_DELTA watermark. Returns a shallow copy of
  // the last delta envelope with content replaced by the watermarked text, or
  // undefined when content is too short or the service fails. Resets the
  // accumulator regardless of success or failure.
  const flushPendingWatermark = async (): Promise<StreamEnvelope | undefined> => {
    if (watermarkEnvelope === undefined) {
      watermarkStepId = undefined;
      watermarkEnvelope = undefined;
      return undefined;
    }
    const stepId = watermarkStepId;
    const source = watermarkEnvelope;
    watermarkStepId = undefined;
    watermarkEnvelope = undefined;
    const sourcePayload = source.payload as Record<string, unknown>;
    const content = sourcePayload.content;
    if (typeof content !== 'string' || content.length <= 500) {
      return undefined;
    }
    try {
      const watermarked = await request.watermark!.applyWatermark(content, request.signal);
      return {
        ...source,
        eventId: `${source.eventId}:watermark`,
        payload: {
          ...sourcePayload,
          content: watermarked,
          text: watermarked,
          metadata: { ...((sourcePayload.metadata ?? {}) as Record<string, unknown>), watermarked: true },
        },
      };
    } catch (error) {
      logger.warn({ event: 'watermark.call.failed', path: 'stream-llm-flush', stepId, reason: error instanceof Error ? error.message : 'unknown' });
      return undefined;
    }
  };

  // Output guard state. Each LLM_CONTENT_DELTA carries the ACCUMULATED full
  // answer so far, so guardContentBuffer is REPLACED per event (never appended)
  // and checks run on the real answer text — not a concatenation of overlapping
  // snapshots. Checks fire INCREMENTALLY: once the new tail (from
  // guardLastCheckedOffset) has grown by another GUARD_ANSWER_TOKEN_THRESHOLD
  // tokens, only that new increment (aligned forward to complete sentences) is
  // sent to checkAnswer — already-checked text is never re-checked.
  // guardLastCheckedOffset ALWAYS lands on a sentence boundary, so each
  // increment starts at a sentence start. A settled-blocked check retracts ASAP
  // at the top of the loop; the terminal path awaits any in-flight check plus a
  // final tail check of the remaining unchecked increment (NOT the full text)
  // so the end-of-run marker never leaves before detection settles.
  let guardContentBuffer = '';
  let guardLastCheckedOffset = 0;
  let guardCheckPromise: Promise<{ readonly blocked: boolean; readonly refusal: string }> | null = null;
  let guardPendingBlock: { readonly refusal: string } | undefined;
  let guardBlockedRunId: string | undefined;
  let guardLastContentEnvelope: StreamEnvelope | undefined;

  // Flush the in-flight chunk check (if any) and run a final tail check on the
  // remaining unchecked increment (force=true: check whatever non-empty new text
  // remains, even if below the token threshold — this is the stream-end flush).
  // Sets guardPendingBlock if a violation is found. Awaited on stream-end and
  // before the terminal marker.
  const flushPendingGuardCheck = async (): Promise<void> => {
    if (guardCheckPromise !== null) {
      await guardCheckPromise;
    }
    if (guardPendingBlock === undefined && guardLastCheckedOffset < guardContentBuffer.length) {
      const increment = extractAnswerIncrement(guardContentBuffer, guardLastCheckedOffset, GUARD_ANSWER_TOKEN_THRESHOLD, true);
      guardLastCheckedOffset = increment.nextOffset;
      const tailResult = await checkAnswerFragments(request.guardrail!, increment.fragments, request.guardLocale);
      if (tailResult.blocked) {
        guardPendingBlock = { refusal: tailResult.refusal };
      }
    }
  };

  // Emit OUTPUT_GUARD_BLOCKED for a pending block (if not already emitted for
  // this run). Returns the blocked envelope, or undefined when there is no
  // pending block or it was already emitted.
  const emitPendingGuardBlock = (trigger: StreamEnvelope): StreamEnvelope | undefined => {
    if (guardPendingBlock === undefined || guardBlockedRunId !== undefined) {
      return undefined;
    }
    guardBlockedRunId = trigger.runId;
    return createOutputGuardBlockedEnvelope(trigger, guardPendingBlock.refusal, request);
  };
  let iterator: AsyncIterator<StreamEnvelope> | undefined;

  try {
    // Always use direct stream from runtime (no proxy).
    const runtimeEvents = request.sessions.streamEvents({
      identityContext: request.identityContext,
      sessionId: request.sessionId,
      ...(request.lastSeenSequence === undefined ? {} : { lastSeenSequence: request.lastSeenSequence }),
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.runId === undefined ? {} : { runId: request.runId }),
      signal: runtimeAbortController.signal,
    });
    const projected = projectTimelineEventsToStreamEnvelopes(
      runtimeEvents,
      {
        fallbackSessionId: request.sessionId,
        ...(request.capabilityResultPresentationPolicy === undefined
          ? {}
          : { capabilityResultPresentationPolicy: request.capabilityResultPresentationPolicy }),
        ...(request.lastSeenSequence === undefined ? {} : { initialSequence: request.lastSeenSequence }),
        ...(request.clock === undefined ? {} : { clock: request.clock }),
      },
      async (event, messageId) => {
        if (request.sessions.resolveProcessMessages === undefined || event.requestId === undefined || event.runId === undefined) {
          return undefined;
        }
        try {
          const [message] = await request.sessions.resolveProcessMessages({
            identityContext: request.identityContext,
            sessionId: request.sessionId,
            requestId: event.requestId,
            runId: event.runId,
            messageIds: [messageId],
            signal: runtimeAbortController.signal,
          });
          return message;
        } catch (error) {
          if (runtimeAbortController.signal.aborted) {
            throw error;
          }
          return undefined;
        }
      },
    );
    iterator = projected[Symbol.asyncIterator]();

    while (true) {
      const read = await readNextEnvelope(iterator, safeTimelineReadTimeoutMs(request.timelineReadTimeoutMs));

      // A background chunk check settled blocked? Retract ASAP (non-blocking detection).
      if (guardPendingBlock !== undefined && guardBlockedRunId === undefined && guardLastContentEnvelope !== undefined) {
        const blockedEnvelope = emitPendingGuardBlock(guardLastContentEnvelope);
        if (blockedEnvelope !== undefined) {
          yield blockedEnvelope;
          try {
            request.onOutputGuardBlocked?.(blockedEnvelope);
          } catch {
            /* non-blocking */
          }
          if (isTerminalForSubscription(blockedEnvelope, request)) {
            return;
          }
        }
      }

      if (read.kind === 'TIMEOUT') {
        runtimeAbortController.abort();
        request.onDiagnostic?.({ kind: 'TIMELINE_READ_FAILURE', code: 'TIMELINE_READ_TIMEOUT' });
        void iterator.return?.();
        yield safeFailureEnvelope(
          request,
          {
            code: 'TIMELINE_READ_TIMEOUT',
            message: 'Timeline stream read timed out safely.',
            category: 'UNAVAILABLE',
            retryable: true,
          },
          lastSequence,
        );
        return;
      }
      if (read.result.done === true) {
        // Stream ended — flush in-flight chunk check + final tail check, then retract if blocked.
        if (guardActive) {
          await flushPendingGuardCheck();
          if (guardPendingBlock !== undefined && guardLastContentEnvelope !== undefined) {
            const blockedEnvelope = emitPendingGuardBlock(guardLastContentEnvelope);
            if (blockedEnvelope !== undefined) {
              yield blockedEnvelope;
              try {
                request.onOutputGuardBlocked?.(blockedEnvelope);
              } catch {
                /* non-blocking */
              }
            }
          }
        }
        return;
      }
      const envelope = withNonAdvancingProjectionFailureSequence(read.result.value, lastSequence);
      const nextSequence = Number(envelope.sequence);
      if (nextSequence < lastSequence) {
        request.onDiagnostic?.({ kind: 'PROJECTION_FAILURE', code: 'STREAM_SEQUENCE_REGRESSED' });
        yield safeFailureEnvelope(
          request,
          {
            code: 'STREAM_SEQUENCE_REGRESSED',
            message: 'Timeline stream sequence regressed.',
            category: 'INTERNAL',
            retryable: true,
          },
          lastSequence,
        );
        return;
      }
      lastSequence = Math.max(lastSequence, nextSequence);

      // Reset guard state when a new run starts.
      if (guardActive && envelope.eventType === 'REQUEST_ACCEPTED') {
        guardContentBuffer = '';
        guardLastCheckedOffset = 0;
        guardCheckPromise = null;
        guardPendingBlock = undefined;
        guardBlockedRunId = undefined;
        guardLastContentEnvelope = undefined;
      }

      // Output guard: replace the buffer with the latest accumulated snapshot
      // (each LLM_CONTENT_DELTA is the full answer so far) and start a background
      // check on the NEW increment once it has grown by another
      // GUARD_ANSWER_TOKEN_THRESHOLD tokens. Only the new text (from the last
      // checked sentence boundary, aligned forward to complete sentences) is
      // sent — already-checked text is never re-checked. Non-blocking; the
      // result is consumed at the top of the loop or at terminal flush.
      if (guardActive && envelope.eventType === 'LLM_CONTENT_DELTA') {
        const content = (envelope.payload as Record<string, unknown>)?.content;
        if (typeof content === 'string') {
          guardContentBuffer = content;
          guardLastContentEnvelope = envelope;
          const newTailTokens = estimateTokens(content.slice(guardLastCheckedOffset));
          if (guardCheckPromise === null && guardPendingBlock === undefined && newTailTokens >= GUARD_ANSWER_TOKEN_THRESHOLD) {
            const increment = extractAnswerIncrement(content, guardLastCheckedOffset, GUARD_ANSWER_TOKEN_THRESHOLD, false);
            if (increment.fragments.length > 0) {
              guardCheckPromise = checkAnswerFragments(request.guardrail!, increment.fragments, request.guardLocale).then((result) => {
                guardLastCheckedOffset = increment.nextOffset;
                guardCheckPromise = null;
                if (result.blocked && guardPendingBlock === undefined) {
                  guardPendingBlock = { refusal: result.refusal };
                }
                return result;
              });
            }
          }
        }
      }

      // Watermark: track the latest assistant answer LLM_CONTENT_DELTA. When
      // stepId changes (both defined and different), flush the previous
      // invocation's watermark delta. Deltas without stepId (e.g. final answer
      // snapshots) are also tracked so the watermark inherits their `final`
      // flag and is not filtered as a pending process-content step by the
      // frontend.
      if (watermarkActive && envelope.eventType === 'LLM_CONTENT_DELTA') {
        const payload = envelope.payload as Record<string, unknown>;
        const stepId = typeof payload.stepId === 'string' ? payload.stepId : undefined;
        const content = typeof payload.content === 'string' ? payload.content : undefined;
        const role = typeof payload.role === 'string' ? payload.role : undefined;
        if (content !== undefined && role !== 'CAPABILITY_RESULT') {
          if (watermarkStepId !== undefined && stepId !== undefined && watermarkStepId !== stepId) {
            const watermarkDelta = await flushPendingWatermark();
            if (watermarkDelta !== undefined) {
              yield watermarkDelta;
            }
          }
          watermarkStepId = stepId;
          watermarkEnvelope = envelope;
        }
      }

      // Watermark: inline transform TOOL_STRUCTURED_DELTA content for workflow
      // DETAIL/ANSWER+TEXT events with content > 500 chars.
      if (watermarkActive && envelope.eventType === 'TOOL_STRUCTURED_DELTA') {
        const payload = envelope.payload as Record<string, unknown>;
        if (
          typeof payload.content === 'string' &&
          payload.content.length > 500 &&
          (payload.toolEventType === 'DETAIL' || payload.toolEventType === 'ANSWER') &&
          payload.toolMessageType === 'TEXT' &&
          payload.workflowEventType !== undefined
        ) {
          try {
            payload.content = await request.watermark!.applyWatermark(payload.content, request.signal);
          } catch (error) {
            logger.warn({
              event: 'watermark.call.failed',
              path: 'stream-tool-structured',
              toolEventType: payload.toolEventType,
              reason: error instanceof Error ? error.message : 'unknown',
            });
          }
        }
      }

      // Skip further content events for a blocked run (terminal events still pass through).
      if (guardBlockedRunId !== undefined && envelope.runId === guardBlockedRunId && isContentEvent(envelope)) {
        continue;
      }

      // Terminal event: flush in-flight chunk check + final tail check before
      // yielding the end-of-run marker, so the marker never leaves before the
      // guard has settled. If blocked, emit OUTPUT_GUARD_BLOCKED (which is itself
      // terminal for the subscription) and skip the runtime terminal.
      if (guardActive && isTerminalStreamEvent(envelope.eventType) && envelope.eventType !== 'OUTPUT_GUARD_BLOCKED') {
        await flushPendingGuardCheck();
        if (guardPendingBlock !== undefined) {
          const blockedEnvelope = emitPendingGuardBlock(envelope);
          if (blockedEnvelope !== undefined) {
            yield blockedEnvelope;
            try {
              request.onOutputGuardBlocked?.(blockedEnvelope);
            } catch {
              /* non-blocking */
            }
            if (isTerminalForSubscription(blockedEnvelope, request)) {
              return;
            }
            continue;
          }
        }
      }

      // Watermark: on REQUEST_COMPLETED, flush pending LLM_CONTENT_DELTA
      // watermark delta then inline-transform the terminal content.
      // CANCELED/FAILED/SUPERSEDED do not execute watermark.
      if (watermarkActive && envelope.eventType === 'REQUEST_COMPLETED') {
        const watermarkDelta = await flushPendingWatermark();
        if (watermarkDelta !== undefined) {
          yield watermarkDelta;
        }
        const payload = envelope.payload as Record<string, unknown>;
        if (typeof payload.content === 'string' && payload.content.length > 500) {
          try {
            payload.content = await request.watermark!.applyWatermark(payload.content, request.signal);
          } catch (error) {
            logger.warn({
              event: 'watermark.call.failed',
              path: 'stream-request-completed',
              reason: error instanceof Error ? error.message : 'unknown',
            });
          }
        }
      }

      yield envelope;
      if (isTerminalForSubscription(envelope, request)) {
        return;
      }
    }
  } catch (error) {
    const safeError = toStreamSafeError(error);
    request.onDiagnostic?.({ kind: 'TIMELINE_READ_FAILURE', code: safeError.code });
    yield safeFailureEnvelope(request, safeError, lastSequence);
  } finally {
    request.signal?.removeEventListener('abort', abortRuntimeStream);
    runtimeAbortController.abort();
    void iterator?.return?.();
    request.onDiagnostic?.({ kind: 'STREAM_CLOSE', code: 'STREAM_CLOSE' });
  }
}

function isContentEvent(envelope: StreamEnvelope): boolean {
  return envelope.eventType === 'LLM_CONTENT_DELTA' || envelope.eventType === 'TOOL_STRUCTURED_DELTA';
}

function createOutputGuardBlockedEnvelope(trigger: StreamEnvelope, refusalMessage: string, request: WebStreamDeliveryRequest): StreamEnvelope {
  const requestId = trigger.requestId;
  const runId = trigger.runId;
  const requestContextId = trigger.requestContextId;
  return {
    eventId: `output-guard-blocked:${runId ?? requestId}`,
    sessionId: trigger.sessionId,
    requestId,
    sequence: trigger.sequence,
    ...(runId === undefined ? {} : { runId }),
    ...(requestContextId === undefined ? {} : { requestContextId }),
    eventType: 'OUTPUT_GUARD_BLOCKED',
    transportHints: [],
    payload: {
      rootMessageId: requestId,
      requestId,
      ...(runId === undefined ? {} : { runId }),
      ...(requestContextId === undefined ? {} : { requestContextId }),
      guardReason: 'OUTPUT_VIOLATION',
      phase: 'OUTPUT_GUARD',
      refusalMessage,
    },
    createdAt: request.clock?.() ?? brand<number, 'EpochMillis'>(Date.now()),
  };
}

type EnvelopeIterator = AsyncIterator<StreamEnvelope>;
type EnvelopeReadResult = { readonly kind: 'ENVELOPE'; readonly result: IteratorResult<StreamEnvelope> } | { readonly kind: 'TIMEOUT' };

async function readNextEnvelope(iterator: EnvelopeIterator, timeoutMs?: number): Promise<EnvelopeReadResult> {
  if (timeoutMs === undefined) {
    return { kind: 'ENVELOPE', result: await iterator.next() };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutResult = new Promise<EnvelopeReadResult>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'TIMEOUT' }), timeoutMs);
    });
    return await Promise.race([iterator.next().then((result): EnvelopeReadResult => ({ kind: 'ENVELOPE', result })), timeoutResult]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function safeTimelineReadTimeoutMs(timeoutMs?: number): number | undefined {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return undefined;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

export function isTerminalStreamEvent(eventType: StreamEnvelope['eventType']): boolean {
  return (
    eventType === 'REQUEST_COMPLETED' ||
    eventType === 'REQUEST_FAILED' ||
    eventType === 'REQUEST_CANCELED' ||
    eventType === 'REQUEST_SUPERSEDED' ||
    eventType === 'OUTPUT_GUARD_BLOCKED'
  );
}

function isTerminalForSubscription(envelope: StreamEnvelope, request: WebStreamDeliveryRequest): boolean {
  if (!isTerminalStreamEvent(envelope.eventType)) {
    return false;
  }
  if (request.requestId === undefined && request.runId === undefined) {
    return false;
  }
  if (request.requestId !== undefined && envelope.requestId !== request.requestId) {
    return false;
  }
  if (request.runId !== undefined && envelope.runId !== request.runId) {
    return false;
  }
  return true;
}

function safeFailureEnvelope(request: WebStreamDeliveryRequest, safeError: SafeError, sequence: number): StreamEnvelope {
  const requestId = request.requestId ?? brand<string, 'MessageId'>('unknown-request');
  const safeDetails = safeError.safeDetails ?? {};
  const refreshConversation = typeof safeDetails.refreshConversation === 'boolean' ? safeDetails.refreshConversation : true;
  return {
    eventId: `stream-transport-failure:${safeError.code}:${sequence}`,
    sessionId: request.sessionId,
    requestId,
    sequence: brand<number, 'TimelineSequence'>(sequence),
    eventType: 'DEGRADATION_NOTICE',
    transportHints: [],
    payload: {
      ...safeDetails,
      rootMessageId: requestId,
      requestId,
      code: safeError.code,
      message: safeError.message,
      category: safeError.category,
      retryable: safeError.retryable,
      refreshConversation,
      metadata: { accumulated: true },
    },
    createdAt: request.clock?.() ?? brand<number, 'EpochMillis'>(Date.now()),
    ...(request.runId === undefined ? {} : { runId: request.runId }),
  };
}

function withNonAdvancingProjectionFailureSequence(envelope: StreamEnvelope, lastSequence: number): StreamEnvelope {
  if (!isProjectionFailureNotice(envelope)) {
    return envelope;
  }
  return { ...envelope, sequence: brand<number, 'TimelineSequence'>(lastSequence) };
}

function isProjectionFailureNotice(envelope: StreamEnvelope): boolean {
  return envelope.eventType === 'DEGRADATION_NOTICE' && typeof envelope.payload.eventType === 'string';
}

function toStreamSafeError(error: unknown): SafeError {
  if (error instanceof AgentError) {
    return {
      code: error.code,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
    };
  }
  return {
    code: 'TIMELINE_STREAM_READ_FAILED',
    message: 'Timeline stream failed safely.',
    category: 'UNAVAILABLE',
    retryable: true,
  };
}
