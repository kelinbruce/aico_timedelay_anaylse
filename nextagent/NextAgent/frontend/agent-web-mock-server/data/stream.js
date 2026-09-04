/**
 * Shared stream delivery helpers for the mock server.
 * Events are appended to replay only when they are actually sent.
 */

const store = require('./store');
const { logInfo, logWarning } = require('../diagnostics');
const { sseConnections, wsConnections, activeStreams, replayBuffer } = store;

const CONTRACT_WEB_EVENT_TYPES = new Set([
  'REQUEST_ACCEPTED',
  'LLM_THINKING_DELTA',
  'LLM_CONTENT_DELTA',
  'TOOL_STRUCTURED_DELTA',
  'CAPABILITY_STARTED',
  'CAPABILITY_RESULT_DELTA',
  'CAPABILITY_COMPLETED',
  'USER_INPUT_REQUIRED',
  'USER_INPUT_RECEIVED',
  'USER_INPUT_TIMEOUT',
  'USER_INPUT_CANCELED',
  'DEGRADATION_NOTICE',
  'CONTEXT_COMPACTED',
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
]);

const PROCESS_DETAIL_DELTA_EVENT_TYPES = new Set(['LLM_THINKING_DELTA', 'CAPABILITY_RESULT_DELTA', 'TOOL_STRUCTURED_DELTA']);

function firstText(payload, fields) {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value !== 'string') {
      continue;
    }
    if (field === 'delta' ? value.length > 0 : value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function defaultEventText(eventType) {
  switch (eventType) {
    case 'REQUEST_COMPLETED':
      return 'Request completed';
    case 'REQUEST_FAILED':
      return 'Request failed';
    case 'REQUEST_CANCELED':
      return 'Request canceled';
    case 'REQUEST_SUPERSEDED':
      return 'Request superseded';
    case 'DEGRADATION_NOTICE':
      return 'Degradation notice';
    case 'CONTEXT_COMPACTED':
      return 'Context compacted';
    default:
      return eventType;
  }
}

function normalizeContractPayload(eventType, payload) {
  if (!CONTRACT_WEB_EVENT_TYPES.has(eventType)) {
    return payload;
  }
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? { ...payload.metadata } : {};
  if (typeof metadata.accumulated !== 'boolean') {
    metadata.accumulated = typeof payload.accumulated === 'boolean' ? payload.accumulated : true;
  }
  return {
    ...payload,
    text:
      firstText(payload, ['text', 'content', 'delta', 'progress', 'result', 'message', 'summary', 'reason', 'uiMessage']) ??
      defaultEventText(eventType),
    contentType: typeof payload.contentType === 'string' && payload.contentType.trim() ? payload.contentType : 'PLAIN_TEXT',
    metadata,
  };
}

function sendEvent(ws, event) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function matchesConnectionFilters(event, filters = {}) {
  if (filters.requestId && event.requestId !== filters.requestId) {
    return false;
  }
  if (filters.runId && event.runId !== filters.runId) {
    return false;
  }
  return true;
}

function toEpochMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function toPublicStreamEnvelope(event) {
  const { rootMessageId: _rootMessageId, createdAt, payload, ...rest } = event;
  const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : payload;
  if (normalizedPayload && typeof normalizedPayload === 'object') {
    delete normalizedPayload.rootMessageId;
  }
  return {
    ...rest,
    payload: normalizedPayload,
    createdAt: toEpochMillis(createdAt),
  };
}

function pushEvent(sessionId, event) {
  for (const connection of sseConnections[sessionId] ?? []) {
    if (!matchesConnectionFilters(event, connection.filters)) {
      continue;
    }
    connection.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  for (const connection of wsConnections[sessionId] ?? []) {
    if (!matchesConnectionFilters(event, connection.filters)) {
      continue;
    }
    sendEvent(connection.ws, event);
  }
}

function appendAndPushEvent(sessionId, event) {
  const publicEvent = toPublicStreamEnvelope(event);
  replayBuffer.append(sessionId, publicEvent);
  pushEvent(sessionId, publicEvent);
  return publicEvent;
}

function buildTerminalEvent(sessionId, requestId, eventType, payload) {
  const normalizedPayload = payload && typeof payload === 'object' ? { ...payload } : {};
  const rootMessageId = normalizedPayload.rootMessageId || requestId;
  const requestContextId = normalizedPayload.requestContextId || requestId;
  const runId = normalizedPayload.runId || rootMessageId;
  if (typeof normalizedPayload.text !== 'string' || !normalizedPayload.text.trim()) {
    const fallbackText = [normalizedPayload.message, normalizedPayload.summary, normalizedPayload.reason].find(
      (value) => typeof value === 'string' && value.trim(),
    );
    if (fallbackText) {
      normalizedPayload.text = fallbackText;
    }
  }
  return {
    eventId: `evt-${Date.now()}-terminal`,
    sessionId,
    requestId,
    runId,
    requestContextId,
    sequence: 0,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE', 'WS'],
    payload: normalizeContractPayload(eventType, {
      ...normalizedPayload,
      runId,
      rootMessageId,
      requestContextId,
    }),
    createdAt: Date.now(),
  };
}

function readPayloadText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text;
  }
  if (typeof payload.content === 'string' && payload.content.trim()) {
    return payload.content;
  }
  if (typeof payload.delta === 'string' && payload.delta.length > 0) {
    return payload.delta;
  }
  return '';
}

function readAccumulatedFlag(payload) {
  if (!payload || typeof payload !== 'object') {
    return true;
  }
  if (typeof payload.accumulated === 'boolean') {
    return payload.accumulated;
  }
  if (payload.metadata && typeof payload.metadata === 'object' && typeof payload.metadata.accumulated === 'boolean') {
    return payload.metadata.accumulated;
  }
  return true;
}

function readCapabilityScope(payload, fallback) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : '';
  const invocationId =
    payload.metadata && typeof payload.metadata === 'object' && typeof payload.metadata.invocationId === 'string'
      ? payload.metadata.invocationId.trim()
      : '';
  if (toolCallId && invocationId) {
    return `${toolCallId}::${invocationId}`;
  }
  if (toolCallId) {
    return toolCallId;
  }
  if (invocationId) {
    return invocationId;
  }
  return fallback;
}

function applyDeltaUpdate(currentContent, lastSequence, nextSequence, accumulated, text) {
  if (!text) {
    return {
      content: currentContent,
      lastSequence,
    };
  }
  if (accumulated) {
    return {
      content: text,
      lastSequence: nextSequence,
    };
  }
  if (lastSequence === null && !currentContent) {
    return {
      content: text,
      lastSequence: nextSequence,
    };
  }
  if (lastSequence !== null && nextSequence === lastSequence + 1) {
    return {
      content: `${currentContent}${text}`,
      lastSequence: nextSequence,
    };
  }
  return {
    content: currentContent,
    lastSequence,
  };
}

function streamEvents(sessionId, requestId, events, options = {}) {
  const rootMessageId = options.rootMessageId || requestId;
  const replaceRootAssistant = options.replaceRootAssistant === true;
  const responseRequestId = options.responseRequestId || requestId;
  const requestContextId = options.requestContextId || responseRequestId || requestId;
  const runId = options.runId || rootMessageId;
  const terminalEventType = options.terminalEventType || 'REQUEST_COMPLETED';
  const terminalPayload = options.terminalPayload && typeof options.terminalPayload === 'object' ? options.terminalPayload : {};
  const autoTerminal = options.autoTerminal !== false;
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Number(options.delayMs)) : 24;
  const terminalDelayMs = Number.isFinite(options.terminalDelayMs) ? Math.max(0, Number(options.terminalDelayMs)) : 0;
  const pauseAfterAnswerDeltas = Number.isFinite(options.pauseAfterAnswerDeltas) ? Math.max(1, Number(options.pauseAfterAnswerDeltas)) : null;
  const pauseAfterProcessDeltas = Number.isFinite(options.pauseAfterProcessDeltas) ? Math.max(1, Number(options.pauseAfterProcessDeltas)) : null;
  const pauseMs = Number.isFinite(options.pauseMs) ? Math.max(0, Number(options.pauseMs)) : 0;
  if (activeStreams[sessionId]) {
    clearTimeout(activeStreams[sessionId].timeout);
  }

  logInfo(`[Stream] Starting stream for ${sessionId}, requestId: ${requestId}, events: ${events.length}`);

  let index = 0;
  activeStreams[sessionId] = {
    timeout: null,
    requestId,
    requestContextId,
    runId,
    assistantContent: '',
    assistantLastSequence: null,
    assistantDeltaCount: 0,
    processDeltaCount: 0,
    didPauseAfterAnswer: false,
    didPauseAfterProcess: false,
    capabilityResults: new Map(),
  };

  function sendNext() {
    const activeStream = activeStreams[sessionId];
    if (!activeStream) {
      logInfo(`[Stream] Stream canceled for ${sessionId}`);
      return;
    }

    if (index >= events.length) {
      const combinedContent = activeStream.assistantContent.trim();
      const capabilityResults = [...activeStream.capabilityResults.values()].filter(
        (result) => result && typeof result.content === 'string' && result.content.trim().length > 0,
      );
      if (typeof options.onEventsDrained === 'function') {
        options.onEventsDrained({
          assistantContent: combinedContent,
          capabilityResults,
          requestContextId,
          runId,
          rootMessageId,
        });
      }
      if (!autoTerminal) {
        delete activeStreams[sessionId];
        logInfo(`[Stream] Stream paused without terminal event for ${sessionId}`);
        return;
      }
      const completeTerminal = () => {
        const terminalStream = activeStreams[sessionId];
        if (!terminalStream || terminalStream.requestId !== requestId) {
          return;
        }
        if (capabilityResults.length > 0) {
          store.recordCapabilityResults(sessionId, responseRequestId, capabilityResults, {
            rootMessageId,
            requestContextId,
            runId,
          });
        }
        if (combinedContent) {
          if (replaceRootAssistant) {
            store.recordRetryAssistantResponse(sessionId, responseRequestId, rootMessageId, combinedContent, undefined, requestContextId, runId);
          } else {
            store.recordAssistantResponse(sessionId, requestId, combinedContent, undefined, {
              rootMessageId,
              requestContextId,
              runId,
            });
          }
        }

        const terminalEvent = buildTerminalEvent(sessionId, requestId, terminalEventType, {
          runId,
          rootMessageId,
          requestContextId,
          message: terminalEventType === 'REQUEST_COMPLETED' ? 'Processing completed' : 'Processing failed',
          summary: terminalEventType === 'REQUEST_COMPLETED' ? 'Processing completed' : 'Processing failed',
          agentResponseRef: `resp-${requestId}`,
          ...terminalPayload,
        });
        terminalEvent.sequence = store.nextStreamSequence(sessionId);
        appendAndPushEvent(sessionId, terminalEvent);
        if (terminalEventType === 'REQUEST_FAILED' && typeof store.markRequestFailed === 'function') {
          store.markRequestFailed(sessionId, requestId, combinedContent || 'Processing failed', requestContextId);
        } else if (terminalEventType === 'REQUEST_CANCELED') {
          store.markRequestCanceled(sessionId, requestId, combinedContent || 'Request canceled', requestContextId);
        } else {
          store.completeRequest(sessionId, requestId, combinedContent || 'Processing completed', requestContextId);
        }
        delete activeStreams[sessionId];
        logInfo(`[Stream] Stream completed for ${sessionId}`);
      };

      if (terminalDelayMs > 0) {
        logInfo(`[Stream] Holding terminal event for ${sessionId} by ${terminalDelayMs}ms`);
        activeStream.timeout = setTimeout(completeTerminal, terminalDelayMs);
        return;
      }

      completeTerminal();
      return;
    }

    const event = events[index++];
    appendAndPushEvent(sessionId, event);

    if (PROCESS_DETAIL_DELTA_EVENT_TYPES.has(event.eventType)) {
      activeStream.processDeltaCount += 1;
    }

    if (event.eventType === 'CAPABILITY_RESULT_DELTA') {
      const scope = readCapabilityScope(event.payload, event.eventId);
      const previous = activeStream.capabilityResults.get(scope) ?? {
        content: '',
        toolCallId: event.payload?.toolCallId,
        toolName: event.payload?.toolName,
        status: 'RUNNING',
        lastSequence: null,
      };
      const text = readPayloadText(event.payload);
      const nextDeltaState = applyDeltaUpdate(previous.content, previous.lastSequence, event.sequence, readAccumulatedFlag(event.payload), text);
      activeStream.capabilityResults.set(scope, {
        ...previous,
        content: nextDeltaState.content,
        lastSequence: nextDeltaState.lastSequence,
        toolCallId: event.payload?.toolCallId ?? previous.toolCallId,
        toolName: event.payload?.toolName ?? previous.toolName,
      });
    }

    if (event.eventType === 'CAPABILITY_COMPLETED') {
      const scope = readCapabilityScope(event.payload, event.eventId);
      const previous = activeStream.capabilityResults.get(scope) ?? {
        content: '',
        toolCallId: event.payload?.toolCallId,
        toolName: event.payload?.toolName,
        lastSequence: null,
      };
      activeStream.capabilityResults.set(scope, {
        ...previous,
        toolCallId: event.payload?.toolCallId ?? previous.toolCallId,
        toolName: event.payload?.toolName ?? previous.toolName,
        status: 'COMPLETED',
      });
    }

    if (event.eventType === 'LLM_CONTENT_DELTA') {
      const text = readPayloadText(event.payload);
      const nextDeltaState = applyDeltaUpdate(
        activeStream.assistantContent,
        activeStream.assistantLastSequence,
        event.sequence,
        readAccumulatedFlag(event.payload),
        text,
      );
      activeStream.assistantContent = nextDeltaState.content;
      activeStream.assistantLastSequence = nextDeltaState.lastSequence;
      activeStream.assistantDeltaCount += 1;
    }

    const shouldPauseAfterAnswer =
      pauseMs > 0 &&
      pauseAfterAnswerDeltas !== null &&
      !activeStream.didPauseAfterAnswer &&
      event.eventType === 'LLM_CONTENT_DELTA' &&
      activeStream.assistantDeltaCount >= pauseAfterAnswerDeltas;
    if (shouldPauseAfterAnswer) {
      activeStream.didPauseAfterAnswer = true;
      logInfo(`[Stream] Holding stream for ${sessionId} after ${activeStream.assistantDeltaCount} answer deltas by ${pauseMs}ms`);
      activeStream.timeout = setTimeout(sendNext, pauseMs);
      return;
    }

    const shouldPauseAfterProcess =
      pauseMs > 0 &&
      pauseAfterProcessDeltas !== null &&
      !activeStream.didPauseAfterProcess &&
      PROCESS_DETAIL_DELTA_EVENT_TYPES.has(event.eventType) &&
      activeStream.processDeltaCount >= pauseAfterProcessDeltas;
    if (shouldPauseAfterProcess) {
      activeStream.didPauseAfterProcess = true;
      logInfo(`[Stream] Holding stream for ${sessionId} after ${activeStream.processDeltaCount} process deltas by ${pauseMs}ms`);
      activeStream.timeout = setTimeout(sendNext, pauseMs);
      return;
    }

    activeStream.timeout = setTimeout(sendNext, delayMs);
  }

  setTimeout(sendNext, 0);
}

function cancelStream(sessionId, requestId) {
  const activeStream = activeStreams[sessionId];
  if (activeStreams[sessionId]) {
    clearTimeout(activeStreams[sessionId].timeout);
    delete activeStreams[sessionId];
  }

  const cancelEnvelope = {
    eventId: `evt-${Date.now()}-cancel`,
    sessionId,
    requestId: requestId || null,
    runId: activeStream?.runId || requestId || null,
    requestContextId: activeStream?.requestContextId || requestId || null,
    sequence: store.nextStreamSequence(sessionId),
    eventType: 'REQUEST_CANCELED',
    timelineEventRef: null,
    transportHints: ['SSE', 'WS'],
    payload: normalizeContractPayload('REQUEST_CANCELED', {
      runId: activeStream?.runId || requestId || null,
      rootMessageId: requestId || null,
      requestContextId: activeStream?.requestContextId || requestId || null,
      text: 'Request canceled',
    }),
    createdAt: Date.now(),
  };

  appendAndPushEvent(sessionId, cancelEnvelope);
  const existingPreview = store.sessions.find((entry) => entry.sessionId === sessionId)?.lastMessagePreview || '';
  store.markRequestCanceled(sessionId, requestId, existingPreview, activeStream?.requestContextId || requestId);
}

function pushUserInputRequired(sessionId, requestId, inputConfig) {
  const {
    inputRequestId = `input-${Date.now()}`,
    inputKind = 'CONFIRMATION',
    prompt = '请确认操作',
    options = [
      { id: 'confirm', label: '确认' },
      { id: 'deny', label: '拒绝' },
    ],
    origin = null,
    originId = null,
    riskLevel = null,
    expiresAt = null,
  } = inputConfig || {};

  const envelope = {
    eventId: `evt-user-input-req-${inputRequestId}`,
    sessionId,
    requestId: requestId || null,
    runId: requestId || null,
    requestContextId: requestId || null,
    sequence: store.nextStreamSequence(sessionId),
    eventType: 'USER_INPUT_REQUIRED',
    timelineEventRef: null,
    transportHints: ['SSE', 'WS'],
    payload: normalizeContractPayload('USER_INPUT_REQUIRED', {
      inputRequestId,
      inputKind,
      prompt,
      options,
      origin,
      originId,
      riskLevel,
      expiresAt: expiresAt || new Date(Date.now() + 300_000).toISOString(),
      runId: requestId || null,
      rootMessageId: requestId || null,
      requestContextId: requestId || null,
    }),
    createdAt: Date.now(),
  };

  appendAndPushEvent(sessionId, envelope);

  store.recordPendingInputRequest(sessionId, inputRequestId, { ...inputConfig, requestId });
  return envelope;
}

function resolveUserInput(sessionId, inputRequestId, response) {
  const pending = store.getPendingInputRequest(sessionId, inputRequestId);
  if (!pending) {
    logWarning(`[Stream] No pending input request found for ${inputRequestId}`);
    return null;
  }

  store.removePendingInputRequest(sessionId, inputRequestId);

  const envelope = {
    eventId: `evt-user-input-res-${inputRequestId}`,
    sessionId,
    requestId: pending.requestId || null,
    runId: pending.requestId || null,
    requestContextId: pending.requestId || null,
    sequence: store.nextStreamSequence(sessionId),
    eventType: 'USER_INPUT_RECEIVED',
    timelineEventRef: null,
    transportHints: ['SSE', 'WS'],
    payload: normalizeContractPayload('USER_INPUT_RECEIVED', {
      inputRequestId,
      value: response?.value || '',
      runId: pending.requestId || null,
      rootMessageId: pending.requestId || null,
      requestContextId: pending.requestId || null,
    }),
    createdAt: Date.now(),
  };

  appendAndPushEvent(sessionId, envelope);
  return envelope;
}

module.exports = { pushEvent, streamEvents, cancelStream, buildTerminalEvent, pushUserInputRequired, resolveUserInput, toPublicStreamEnvelope };
