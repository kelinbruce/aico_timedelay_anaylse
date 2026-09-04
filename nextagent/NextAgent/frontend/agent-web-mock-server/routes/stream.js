/**
 * SSE stream endpoint.
 * Mirrors the real backend shape closely:
 * - replays buffered envelopes when available
 * - emits a degradation notice when replay continuity is lost
 * - does not synthesize any extra connect-time lifecycle event
 */

const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { toPublicStreamEnvelope } = require('../data/stream');

const { sseConnections, replayBuffer, REPLAY_MAX_ITEMS } = store;
const { logInfo } = require('../diagnostics');

router.get('/:sessionId/stream', (req, res) => {
  const { sessionId } = req.params;
  const lastSeenSequence = Number.parseInt(String(req.query.lastSeenSequence ?? '0'), 10);
  const requestId = typeof req.query.requestId === 'string' && req.query.requestId.trim() ? req.query.requestId.trim() : null;
  const runId = typeof req.query.runId === 'string' && req.query.runId.trim() ? req.query.runId.trim() : null;
  const streamFilters = {
    ...(requestId ? { requestId } : {}),
    ...(runId ? { runId } : {}),
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  logInfo(`[SSE] Client connected: ${sessionId}, lastSeenSequence: ${lastSeenSequence}, requestId: ${requestId || '-'}, runId: ${runId || '-'}`);

  const connection = { res, filters: streamFilters };
  if (!Array.isArray(sseConnections[sessionId])) {
    sseConnections[sessionId] = [];
  }
  sseConnections[sessionId].push(connection);
  res.locals.connected = true;
  res.locals.sessionId = sessionId;

  const replayResult = replayBuffer.replay(sessionId, lastSeenSequence, REPLAY_MAX_ITEMS, streamFilters);
  logInfo(`[SSE] Replay for ${sessionId}: ${replayResult.envelopes.length} events, continuity: ${replayResult.continuityAvailable}`);

  if (replayResult.envelopes.length > 0) {
    for (const envelope of replayResult.envelopes) {
      if (!res.locals.connected) {
        return;
      }
      res.write(`data: ${JSON.stringify(envelope)}\n\n`);
    }
  }

  if (replayResult.gapRefreshRequired) {
    const recentVisibleMessageIds = store.getRecentVisibleMessageIds(sessionId, 10);
    const gapNotice = {
      eventId: `gap-refresh-${Date.now()}`,
      sessionId,
      requestId: 'gap-refresh',
      runId: 'gap-refresh',
      requestContextId: 'gap-refresh',
      sequence: store.nextStreamSequence(sessionId),
      eventType: 'DEGRADATION_NOTICE',
      timelineEventRef: null,
      transportHints: ['replayable'],
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
        recentVisibleMessageIds,
        metadata: { accumulated: true },
      },
      createdAt: Date.now(),
    };
    if (res.locals.connected) {
      res.write(`data: ${JSON.stringify(toPublicStreamEnvelope(gapNotice))}\n\n`);
    }
  }

  req.on('close', () => {
    logInfo(`[SSE] Client disconnected: ${sessionId}`);
    res.locals.connected = false;
    sseConnections[sessionId] = (sseConnections[sessionId] ?? []).filter((entry) => entry !== connection);
    if (sseConnections[sessionId].length === 0) {
      delete sseConnections[sessionId];
    }
  });
});

module.exports = router;
