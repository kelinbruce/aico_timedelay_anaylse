/**
 * WebSocket transport endpoint.
 * Mirrors the SSE contract closely:
 * - replays buffered envelopes when available
 * - emits a degradation notice when replay continuity is lost
 * - does not synthesize any extra connect-time lifecycle event
 */

const { WebSocketServer } = require('ws');
const store = require('../data/store');
const { buildMockRequestPlan } = require('../data/events');
const { cancelStream, streamEvents, toPublicStreamEnvelope } = require('../data/stream');

const { wsConnections, sseConnections, replayBuffer, REPLAY_MAX_ITEMS } = store;
const { logError, logInfo, logWarning } = require('../diagnostics');

let wss;

function setupWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const pathParts = url.pathname.split('/').filter(Boolean);
    const sessionId = pathParts.length >= 4 ? pathParts[3] : url.searchParams.get('sessionId') || 'default';
    const lastSeenSequence = Number.parseInt(url.searchParams.get('lastSeenSequence') || '0', 10);
    const requestId = url.searchParams.get('requestId')?.trim() || null;
    const runId = url.searchParams.get('runId')?.trim() || null;
    const streamFilters = {
      ...(requestId ? { requestId } : {}),
      ...(runId ? { runId } : {}),
    };

    logInfo(`[WS] Client connected: ${sessionId}, lastSeenSequence: ${lastSeenSequence}, requestId: ${requestId || '-'}, runId: ${runId || '-'}`);

    const connection = { ws, filters: streamFilters };
    if (!Array.isArray(wsConnections[sessionId])) {
      wsConnections[sessionId] = [];
    }
    wsConnections[sessionId].push(connection);
    ws.locals = { sessionId, filters: streamFilters };

    const replayResult = replayBuffer.replay(sessionId, lastSeenSequence, REPLAY_MAX_ITEMS, streamFilters);
    logInfo(`[WS] Replay for ${sessionId}: ${replayResult.envelopes.length} events, continuity: ${replayResult.continuityAvailable}`);

    if (replayResult.envelopes.length > 0) {
      for (const envelope of replayResult.envelopes) {
        if (ws.readyState !== ws.OPEN) {
          return;
        }
        sendEvent(ws, envelope);
      }
    }

    if (replayResult.gapRefreshRequired && ws.readyState === ws.OPEN) {
      sendEvent(
        ws,
        toPublicStreamEnvelope({
          eventId: `gap-refresh-${Date.now()}`,
          sessionId,
          requestId: 'gap-refresh',
          runId: 'gap-refresh',
          requestContextId: 'gap-refresh',
          sequence: store.nextStreamSequence(sessionId),
          eventType: 'DEGRADATION_NOTICE',
          timelineEventRef: null,
          transportHints: ['WS', 'replayable'],
          payload: {
            runId: 'gap-refresh',
            rootMessageId: 'gap-refresh',
            requestContextId: 'gap-refresh',
            text: 'Replay gap requires conversation refresh',
            contentType: 'PLAIN_TEXT',
            reason: 'REPLAY_GAP_REFRESH_REQUIRED',
            refreshConversation: true,
            lastSeenSequence,
            firstAvailableSequence: replayResult.firstAvailableSequence,
            requestIdFilter: requestId,
            runIdFilter: runId,
            recentVisibleMessageIds: store.getRecentVisibleMessageIds(sessionId, 10),
            metadata: { accumulated: true },
          },
          createdAt: Date.now(),
        }),
      );
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        logInfo(`[WS] Received from ${sessionId}:`, message);
        if (message.action === 'CANCEL') {
          handleCancel(sessionId, message.requestId);
        } else if (message.action === 'RESPOND') {
          handleRespond(sessionId, message.inputRequestId, message.value);
        }
      } catch (err) {
        logError('[WS] Failed to parse message:', err);
      }
    });

    ws.on('close', () => {
      logInfo(`[WS] Client disconnected: ${sessionId}`);
      wsConnections[sessionId] = (wsConnections[sessionId] ?? []).filter((entry) => entry !== connection);
      if (wsConnections[sessionId].length === 0) {
        delete wsConnections[sessionId];
      }
    });

    ws.on('error', (err) => {
      logError(`[WS] Error for ${sessionId}:`, err);
    });
  });

  logInfo('[WS] WebSocket server initialized');
}

function handleCancel(sessionId, requestId) {
  logInfo(`[WS] Cancel stream for ${sessionId}, requestId: ${requestId}`);
  cancelStream(sessionId, requestId);
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

function handleRespond(sessionId, inputRequestId, value) {
  logInfo(`[WS] Respond pending input for ${sessionId}, inputRequestId: ${inputRequestId}`);

  const { resolveUserInput } = require('../data/stream');
  const pending = store.getPendingInputRequest(sessionId, inputRequestId);
  if (!pending) {
    logWarning(`[WS] No pending input request found for ${inputRequestId}`);
    return;
  }

  if (typeof value !== 'string' || !value.trim()) {
    logWarning(`[WS] Invalid value for ${inputRequestId}`);
    return;
  }

  resolveUserInput(sessionId, inputRequestId, { value: value.trim() });
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

function triggerStream(sessionId, requestId) {
  logInfo(`[Stream] Triggering stream for ${sessionId}, requestId: ${requestId}`);

  const plan = buildMockRequestPlan(sessionId, requestId, {
    inputText: 'websocket trigger',
    rootMessageId: requestId,
    requestContextId: requestId,
    runId: requestId,
  });
  store.allocateStreamSequences(sessionId, plan.events);
  streamEvents(sessionId, requestId, plan.events, {
    rootMessageId: requestId,
    requestContextId: requestId,
    runId: requestId,
    terminalEventType: plan.terminalEventType,
    terminalPayload: plan.terminalPayload,
    autoTerminal: plan.autoTerminal,
    delayMs: plan.delayMs,
    terminalDelayMs: plan.terminalDelayMs,
    pauseAfterAnswerDeltas: plan.pauseAfterAnswerDeltas,
    pauseAfterProcessDeltas: plan.pauseAfterProcessDeltas,
    pauseMs: plan.pauseMs,
  });
}

module.exports = { setupWebSocket, pushEvent, triggerStream, handleCancel };
