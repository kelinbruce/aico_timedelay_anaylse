/**
 * Request-related routes for the mock server.
 */

const express = require('express');
const router = express.Router();

const store = require('../data/store');
const { buildMockRequestPlan } = require('../data/events');
const { streamEvents, cancelStream, resolveUserInput, pushUserInputRequired, toPublicStreamEnvelope } = require('../data/stream');
const retryResponsesByIdempotency = new Map();
const retryAttemptsByRequest = new Map();
const editResponsesByIdempotency = new Map();
const { logError, logInfo } = require('../diagnostics');

function resolveExpectedLatestRequestId(requestBody, fallbackRequestId = null) {
  return requestBody?.expectedLatestRequestId || fallbackRequestId || null;
}

function nextRetryAttempt(sessionId, requestId) {
  const key = `${sessionId}:${requestId}`;
  const nextAttempt = (retryAttemptsByRequest.get(key) ?? 1) + 1;
  retryAttemptsByRequest.set(key, nextAttempt);
  return nextAttempt;
}

function normalizeIdempotencyKey(idempotencyKey) {
  return typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
}

function controlScope(kind, sessionId, idempotencyKey) {
  return `${kind}:${sessionId}:${idempotencyKey}`;
}

function normalizeMockControls(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const controls = {};
  if (
    value.requestMode === 'capability-presentation' ||
    value.requestMode === 'process-handoff' ||
    value.requestMode === 'piu-process-detail' ||
    value.requestMode === 'piu-answer'
  ) {
    controls.requestMode = value.requestMode;
  }
  if (value.answerDeltaMode === 'append-token' || value.answerDeltaMode === 'cumulative') {
    controls.answerDeltaMode = value.answerDeltaMode;
  }
  if (Number.isFinite(value.delayMs)) {
    controls.delayMs = Math.max(0, Math.min(200, Number(value.delayMs)));
  }
  if (Number.isFinite(value.terminalDelayMs)) {
    controls.terminalDelayMs = Math.max(0, Math.min(10000, Number(value.terminalDelayMs)));
  }
  if (Number.isFinite(value.pauseAfterAnswerDeltas)) {
    controls.pauseAfterAnswerDeltas = Math.max(1, Math.min(10000, Number(value.pauseAfterAnswerDeltas)));
  }
  if (Number.isFinite(value.pauseAfterProcessDeltas)) {
    controls.pauseAfterProcessDeltas = Math.max(1, Math.min(10000, Number(value.pauseAfterProcessDeltas)));
  } else if (Number.isFinite(value.pauseAfterProcessEvents)) {
    controls.pauseAfterProcessDeltas = Math.max(1, Math.min(10000, Number(value.pauseAfterProcessEvents)));
  }
  if (Number.isFinite(value.pauseMs)) {
    controls.pauseMs = Math.max(0, Math.min(10000, Number(value.pauseMs)));
  }
  return controls;
}

function parseInlineMockControls(inputText) {
  const controls = {};
  let sawDirective = false;
  const cleanedInputText = inputText
    .replace(/\[\s*mock:([^\]]+)\]/gi, (_match, rawDirective) => {
      sawDirective = true;
      const parts = String(rawDirective)
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        const [rawKey, rawValue] = part.split('=');
        const key = rawKey.toLowerCase();
        const value = rawValue?.trim();
        if (key === 'capability-presentation') {
          controls.requestMode = 'capability-presentation';
          continue;
        }
        if (key === 'process-handoff') {
          controls.requestMode = 'process-handoff';
          continue;
        }
        if (key === 'piu-process-detail') {
          controls.requestMode = 'piu-process-detail';
          continue;
        }
        if (key === 'piu-answer') {
          controls.requestMode = 'piu-answer';
          continue;
        }
        if (key === 'append-token' || key === 'append-tokens' || key === 'append') {
          controls.answerDeltaMode = 'append-token';
          continue;
        }
        if (key === 'cumulative' || key === 'contract') {
          controls.answerDeltaMode = 'cumulative';
          continue;
        }
        if (key === 'delay' || key === 'delay-ms' || key === 'delayms') {
          const delayMs = Number(value);
          if (Number.isFinite(delayMs)) {
            controls.delayMs = Math.max(0, Math.min(200, delayMs));
          }
          continue;
        }
        if (
          key === 'terminal-delay' ||
          key === 'terminal-delay-ms' ||
          key === 'terminaldelayms' ||
          key === 'idle-pause' ||
          key === 'idle-pause-ms' ||
          key === 'idlepausems'
        ) {
          const terminalDelayMs = Number(value);
          if (Number.isFinite(terminalDelayMs)) {
            controls.terminalDelayMs = Math.max(0, Math.min(10000, terminalDelayMs));
          }
          continue;
        }
        if (key === 'pause-after-answer' || key === 'pause-after-answer-deltas' || key === 'pauseafteranswer' || key === 'pauseafteranswerdeltas') {
          const pauseAfterAnswerDeltas = Number(value);
          if (Number.isFinite(pauseAfterAnswerDeltas)) {
            controls.pauseAfterAnswerDeltas = Math.max(1, Math.min(10000, pauseAfterAnswerDeltas));
          }
          continue;
        }
        if (
          key === 'pause-after-process' ||
          key === 'pause-after-process-deltas' ||
          key === 'pause-after-process-events' ||
          key === 'pauseafterprocess' ||
          key === 'pauseafterprocessdeltas' ||
          key === 'pauseafterprocessevents'
        ) {
          const pauseAfterProcessDeltas = Number(value);
          if (Number.isFinite(pauseAfterProcessDeltas)) {
            controls.pauseAfterProcessDeltas = Math.max(1, Math.min(10000, pauseAfterProcessDeltas));
          }
          continue;
        }
        if (key === 'pause' || key === 'pause-ms' || key === 'pausems') {
          const pauseMs = Number(value);
          if (Number.isFinite(pauseMs)) {
            controls.pauseMs = Math.max(0, Math.min(10000, pauseMs));
          }
        }
      }
      return '';
    })
    .trim();

  return {
    inputText: cleanedInputText || (sawDirective ? 'mock stream verification' : ''),
    controls,
  };
}

function startMockStream(sessionId, requestId, planOptions, streamOptions = {}) {
  const plan = buildMockRequestPlan(sessionId, requestId, planOptions);
  store.allocateStreamSequences(sessionId, plan.events);
  streamEvents(sessionId, requestId, plan.events, {
    ...streamOptions,
    terminalEventType: plan.terminalEventType,
    terminalPayload: plan.terminalPayload,
    autoTerminal: plan.autoTerminal,
    delayMs: plan.delayMs,
    terminalDelayMs: plan.terminalDelayMs,
    pauseAfterAnswerDeltas: plan.pauseAfterAnswerDeltas,
    pauseAfterProcessDeltas: plan.pauseAfterProcessDeltas,
    pauseMs: plan.pauseMs,
    onEventsDrained: plan.pendingInput
      ? () => {
          pushUserInputRequired(sessionId, requestId, {
            inputRequestId: `input-${requestId}`,
            ...plan.pendingInput,
          });
        }
      : undefined,
  });
  return plan;
}

router.post('/:sessionId/requests', (req, res) => {
  const { sessionId } = req.params;
  const { inputText, attachments, idempotencyKey, subjectId, locale, mockControls } = req.body ?? {};
  const normalizedInputText = typeof inputText === 'string' ? inputText.trim() : '';
  const parsedMockControls = parseInlineMockControls(normalizedInputText);
  const effectiveMockControls = {
    ...parsedMockControls.controls,
    ...normalizeMockControls(mockControls),
  };
  const effectiveInputText = parsedMockControls.inputText;
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  logInfo(`[Request] New request for ${sessionId}:`, {
    inputText: effectiveInputText,
    attachments: attachments ?? [],
    idempotencyKey: normalizedIdempotencyKey,
    subjectId: subjectId || 'default-subject',
    locale: locale || 'zh-CN',
    mockControls: effectiveMockControls,
  });

  if (!effectiveInputText) {
    return res.status(400).json({
      error: 'inputText must not be empty',
      code: 'INPUT_TEXT_EMPTY',
    });
  }
  if (!normalizedIdempotencyKey) {
    return res.status(400).json({
      error: 'idempotencyKey is required',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }
  let result;
  try {
    result = store.acceptRequest(sessionId, `req-${sessionId}-${Date.now()}`);
  } catch (error) {
    logError(`[Request] Failed to accept request: ${error.message}`);
    return res.status(404).json({ error: error.message, code: 'SESSION_NOT_FOUND' });
  }

  store.recordUserRequest(sessionId, result.requestId, effectiveInputText, new Date().toISOString(), {
    requestContextId: result.requestId,
    runId: result.requestId,
  });

  startMockStream(
    sessionId,
    result.requestId,
    {
      inputText: effectiveInputText,
      attachments,
      rootMessageId: result.requestId,
      requestContextId: result.requestId,
      runId: result.requestId,
      mockControls: effectiveMockControls,
    },
    {
      rootMessageId: result.requestId,
      requestContextId: result.requestId,
      runId: result.requestId,
    },
  );

  return res.status(202).json({
    sessionId: result.sessionId,
    requestId: result.requestId,
    runId: result.requestId,
    attempt: 1,
  });
});

function handleCancel(req, res, fallbackRequestId = null) {
  const { sessionId } = req.params;
  const expectedIdentity = resolveExpectedLatestRequestId(req.body, fallbackRequestId);
  const { idempotencyKey } = req.body ?? {};
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  logInfo(`[Request] Cancel request ${expectedIdentity} for session ${sessionId}`);

  if (!normalizedIdempotencyKey) {
    return res.status(400).json({
      error: 'idempotencyKey is required',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  const latestRootMessageId = store.getLatestRequestId(sessionId);
  if (!latestRootMessageId || !store.matchesLatestRequestIdentity(sessionId, expectedIdentity)) {
    return res.status(409).json({
      error: 'Expected latest request does not match runtime latest request',
      code: 'REQUEST_NOT_LATEST',
      expectedLatestRequestId: store.getLatestRequestIdentityForClient(sessionId),
    });
  }

  cancelStream(sessionId, latestRootMessageId);

  return res.status(202).json({
    sessionId,
    targetRequestId: latestRootMessageId,
    action: 'CANCEL_LATEST',
    idempotencyKey: normalizedIdempotencyKey,
  });
}

function handleRetry(req, res, fallbackRequestId = null) {
  const { sessionId } = req.params;
  const expectedIdentity = resolveExpectedLatestRequestId(req.body, fallbackRequestId);
  const { idempotencyKey } = req.body ?? {};
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  logInfo(`[Request] Retry request ${expectedIdentity} for session ${sessionId}`);

  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({ error: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' });
  }
  if (!expectedIdentity) {
    return res.status(409).json({
      error: 'Expected latest request does not match runtime latest request',
      code: 'REQUEST_NOT_LATEST',
      expectedLatestRequestId: store.getLatestRequestIdentityForClient(sessionId),
    });
  }
  const latestRequestId = store.getLatestRequestId(sessionId);
  if (!latestRequestId) {
    return res.status(409).json({
      error: 'No request attempt exists for session',
      code: 'NO_REQUEST_ATTEMPT',
    });
  }
  if (!store.matchesLatestRequestIdentity(sessionId, expectedIdentity)) {
    return res.status(409).json({
      error: 'Expected latest request does not match runtime latest request',
      code: 'REQUEST_NOT_LATEST',
      expectedLatestRequestId: store.getLatestRequestIdentityForClient(sessionId),
    });
  }
  if (store.sessionDetails[sessionId].activeRequestId) {
    return res.status(409).json({
      error: 'Retry requires the latest request to be terminal',
      code: 'REQUEST_NOT_TERMINAL',
      expectedLatestRequestId: latestRequestId,
    });
  }
  if (!normalizedIdempotencyKey) {
    return res.status(400).json({
      error: 'idempotencyKey is required',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }
  const retryScope = controlScope('retry', sessionId, normalizedIdempotencyKey);
  const cachedResponse = retryResponsesByIdempotency.get(retryScope);
  if (cachedResponse) {
    return res.status(202).json(cachedResponse);
  }

  const retryRunId = `retry-${Date.now()}`;
  const retryRequestContextId = retryRunId;
  const attempt = nextRetryAttempt(sessionId, latestRequestId);
  let result;
  try {
    result = store.acceptRequest(sessionId, latestRequestId, retryRequestContextId);
  } catch (error) {
    logError(`[Request] Retry failed: ${error.message}`);
    return res.status(404).json({ error: error.message, code: 'SESSION_NOT_FOUND' });
  }

  store.hideAssistantMessagesForRoot(sessionId, latestRequestId);
  startMockStream(
    sessionId,
    latestRequestId,
    {
      inputText: 'retry latest request',
      attachments: null,
      rootMessageId: latestRequestId,
      requestContextId: retryRequestContextId,
      runId: retryRunId,
    },
    {
      rootMessageId: latestRequestId,
      replaceRootAssistant: true,
      responseRequestId: retryRunId,
      requestContextId: retryRequestContextId,
      runId: retryRunId,
    },
  );

  const response = {
    sessionId: result.sessionId,
    requestId: latestRequestId,
    runId: retryRunId,
    attempt,
  };
  retryResponsesByIdempotency.set(retryScope, response);
  return res.status(202).json(response);
}

function handleEdit(req, res, fallbackRequestId = null) {
  const { sessionId } = req.params;
  const expectedIdentity = resolveExpectedLatestRequestId(req.body, fallbackRequestId);
  const { editedInputText, attachments, idempotencyKey } = req.body;
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const normalizedEditedInput = typeof editedInputText === 'string' ? editedInputText.trim() : '';

  logInfo(`[Request] Edit request ${expectedIdentity} for session ${sessionId}`);

  if (!expectedIdentity) {
    return res.status(400).json({
      error: 'expectedLatestRequestId is required for edit.',
      code: 'LATEST_REQUEST_REQUIRED',
    });
  }
  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({
      error: `Session not found: ${sessionId}`,
      code: 'SESSION_NOT_FOUND',
    });
  }
  const latestRequestId = store.getLatestRequestId(sessionId);
  if (!latestRequestId) {
    return res.status(409).json({
      error: 'No request attempt exists for session',
      code: 'NO_REQUEST_ATTEMPT',
    });
  }
  if (!store.matchesLatestRequestIdentity(sessionId, expectedIdentity)) {
    return res.status(409).json({
      error: 'Expected latest request does not match runtime latest request',
      code: 'REQUEST_NOT_LATEST',
      expectedLatestRequestId: store.getLatestRequestIdentityForClient(sessionId),
    });
  }
  if (store.sessionDetails[sessionId].activeRequestId) {
    return res.status(409).json({
      error: 'Edit-latest requires the latest request to be terminal',
      code: 'REQUEST_NOT_TERMINAL',
      expectedLatestRequestId: latestRequestId,
    });
  }

  if (!normalizedEditedInput) {
    return res.status(400).json({
      error: 'editedInputText must not be empty.',
      code: 'EDIT_INPUT_EMPTY',
    });
  }
  if (!normalizedIdempotencyKey) {
    return res.status(400).json({
      error: 'idempotencyKey is required',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }
  const editScope = controlScope('edit', sessionId, normalizedIdempotencyKey);
  const cachedResponse = editResponsesByIdempotency.get(editScope);
  if (cachedResponse) {
    return res.status(202).json(cachedResponse);
  }

  const latestUserMessage = store.getUserMessageByRoot(sessionId, latestRequestId, { visibleOnly: false });
  if (!latestUserMessage) {
    return res.status(404).json({
      error: 'Editable request not found.',
      code: 'REQUEST_NOT_FOUND',
    });
  }
  const previousInput = String(latestUserMessage.content || '');
  if (previousInput === editedInputText) {
    return res.status(409).json({
      error: 'Edited input is unchanged.',
      code: 'EDIT_INPUT_UNCHANGED',
    });
  }
  const unavailableAttachmentReason = store.firstUnavailableAttachmentReason(sessionId, attachments ?? []);
  if (unavailableAttachmentReason) {
    return res.status(409).json({
      error: `Edited attachments are not available: ${unavailableAttachmentReason}`,
      code: 'EDIT_ATTACHMENTS_UNAVAILABLE',
    });
  }

  const newRequestId = `edit-${Date.now()}`;
  let result;
  try {
    result = store.acceptRequest(sessionId, newRequestId);
  } catch (error) {
    logError(`[Request] Edit failed: ${error.message}`);
    return res.status(404).json({ error: error.message, code: 'SESSION_NOT_FOUND' });
  }

  store.hideMessagesForRoot(sessionId, latestRequestId, {
    hideUser: true,
    hideAssistant: true,
    hideCapability: true,
  });
  store.recordUserRequest(sessionId, result.requestId, editedInputText || '', new Date().toISOString(), {
    requestContextId: result.requestId,
    runId: result.requestId,
  });

  startMockStream(
    sessionId,
    result.requestId,
    {
      inputText: normalizedEditedInput,
      attachments,
      rootMessageId: result.requestId,
      requestContextId: result.requestId,
      runId: result.requestId,
    },
    {
      requestContextId: result.requestId,
      runId: result.requestId,
    },
  );

  const response = {
    sessionId: result.sessionId,
    requestId: result.requestId,
    runId: result.requestId,
    attempt: 1,
  };
  editResponsesByIdempotency.set(editScope, response);
  return res.status(202).json(response);
}

router.post('/:sessionId/cancel', (req, res) => handleCancel(req, res));
router.post('/:sessionId/requests/latest/cancel', (req, res) => handleCancel(req, res));
router.post('/:sessionId/requests/:runId/cancel', (req, res) => handleCancel(req, res, req.params.runId));
router.post('/:sessionId/retry', (req, res) => handleRetry(req, res));
router.post('/:sessionId/requests/latest/retry', (req, res) => handleRetry(req, res));
router.post('/:sessionId/requests/:runId/retry', (req, res) => handleRetry(req, res, req.params.runId));
router.post('/:sessionId/requests/latest/edit', (req, res) => handleEdit(req, res));
router.post('/:sessionId/requests/:runId/edit', (req, res) => handleEdit(req, res, req.params.runId));

router.post('/:sessionId/attachments', (req, res) => {
  const { sessionId } = req.params;

  logInfo(`[Request] Upload attachments for session ${sessionId}`);

  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({ error: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' });
  }

  const uploaded = [
    {
      attachmentId: `att-${Date.now()}`,
      fileName: 'document.pdf',
      mediaType: 'PDF',
      sizeBytes: 1024 * 50,
    },
  ];
  store.registerUploadedAttachments(sessionId, uploaded);
  return res.json(uploaded);
});

// Pending input response submission
router.post('/:sessionId/input-requests/:inputRequestId/respond', (req, res) => {
  const { sessionId, inputRequestId } = req.params;
  const { value } = req.body ?? {};

  logInfo(`[Request] Pending input response for ${sessionId}, inputRequestId: ${inputRequestId}`);

  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({ error: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' });
  }

  const pending = store.getPendingInputRequest(sessionId, inputRequestId);
  if (!pending) {
    return res.status(404).json({ error: 'Input request not found or already resolved', code: 'INPUT_REQUEST_NOT_FOUND' });
  }

  if (typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'value must not be empty', code: 'INPUT_VALUE_EMPTY' });
  }

  resolveUserInput(sessionId, inputRequestId, { value: value.trim() });
  return res.status(200).json({ acknowledged: true, inputRequestId });
});

// Pending input request cancellation
router.post('/:sessionId/input-requests/:inputRequestId/cancel', (req, res) => {
  const { sessionId, inputRequestId } = req.params;

  logInfo(`[Request] Cancel pending input for ${sessionId}, inputRequestId: ${inputRequestId}`);

  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({ error: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' });
  }

  const pending = store.getPendingInputRequest(sessionId, inputRequestId);
  if (!pending) {
    return res.status(404).json({ error: 'Input request not found or already resolved', code: 'INPUT_REQUEST_NOT_FOUND' });
  }

  store.removePendingInputRequest(sessionId, inputRequestId);

  const cancelEnvelope = {
    eventId: `evt-user-input-cancel-${inputRequestId}`,
    sessionId,
    requestId: pending.requestId || null,
    runId: pending.requestId || null,
    requestContextId: pending.requestId || null,
    sequence: store.nextStreamSequence(sessionId),
    eventType: 'USER_INPUT_CANCELED',
    timelineEventRef: null,
    transportHints: ['SSE', 'WS'],
    payload: {
      inputRequestId,
      runId: pending.requestId || null,
      rootMessageId: pending.requestId || null,
      requestContextId: pending.requestId || null,
      text: 'User input canceled',
      contentType: 'PLAIN_TEXT',
      metadata: { accumulated: true },
    },
    createdAt: Date.now(),
  };

  const { replayBuffer: replayBuf } = require('../data/store');
  const { pushEvent } = require('../data/stream');
  const publicEnvelope = toPublicStreamEnvelope(cancelEnvelope);
  replayBuf.append(sessionId, publicEnvelope);
  pushEvent(sessionId, publicEnvelope);

  return res.status(200).json({ acknowledged: true, inputRequestId });
});

// Test helper: trigger a USER_INPUT_REQUIRED event for a session
router.post('/:sessionId/test/trigger-user-input', (req, res) => {
  const { sessionId } = req.params;
  const { inputKind = 'CONFIRMATION', prompt = '确认执行此操作？', options, riskLevel, expiresInSeconds = 300 } = req.body ?? {};

  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({ error: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' });
  }

  const requestId = store.getLatestRequestId(sessionId) || `test-${Date.now()}`;
  const inputRequestId = `input-${Date.now()}`;

  const envelope = pushUserInputRequired(sessionId, requestId, {
    inputRequestId,
    inputKind,
    prompt,
    options: options ?? undefined,
    riskLevel: riskLevel ?? null,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  });

  return res.status(201).json({ triggered: true, inputRequestId, envelope });
});

module.exports = router;
module.exports.parseInlineMockControls = parseInlineMockControls;
