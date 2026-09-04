/**
 * Session-related REST routes for the mock server.
 */

const express = require('express');
const router = express.Router();

const store = require('../data/store');
const SESSION_LIST_DEFAULT_LIMIT = 50;
const SESSION_SEARCH_DEFAULT_LIMIT = 20;
const SESSION_SEARCH_MAX_LIMIT = 50;
const SESSION_SEARCH_MAX_KEYWORD_CODE_POINTS = 200;
const MAX_SESSION_CREATED_RANGE_MS = 90 * 24 * 60 * 60 * 1000 - 1;

router.get('/', (req, res) => {
  if (Object.prototype.hasOwnProperty.call(req.query, 'includeSuperseded')) {
    return res.status(400).json({ error: 'includeSuperseded is not part of the public session list contract' });
  }
  try {
    const query = parseSessionListQuery(req.query ?? {});
    return res.json(store.getSessions(query));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'invalid session list query' });
  }
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const allowedFields = new Set(['locale']);
  const unsupportedFields = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    return res.status(400).json({
      error: 'create session body contains unsupported fields',
      unsupportedFields,
    });
  }

  if (body.locale !== undefined && typeof body.locale !== 'string') {
    return res.status(400).json({ error: 'locale must be a string when provided' });
  }

  const sessionId = `session-${++store.sessionCounter.value}`;
  const handle = store.createSession(sessionId, body.locale);

  return res.status(201).json(handle);
});

router.post('/:sessionId/messages/:messageId/fork', (req, res) => {
  const { sessionId, messageId } = req.params;
  const body = req.body ?? {};
  const allowedFields = new Set(['idempotencyKey']);
  const unsupportedFields = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    return res.status(400).json({
      error: 'fork body contains unsupported fields',
      unsupportedFields,
    });
  }
  if (typeof body.idempotencyKey !== 'string') {
    return res.status(400).json({ error: 'idempotencyKey is required' });
  }
  const idempotencyKey = body.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return res.status(400).json({ error: 'idempotencyKey length is invalid' });
  }

  try {
    const handle = store.forkSessionFromMessage(sessionId, messageId, idempotencyKey);
    if (!handle) {
      return res.status(404).json({ error: 'Fork source message not found' });
    }
    return res.status(201).json(handle);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'fork failed' });
  }
});

router.get('/:sessionId/conversation', (req, res) => {
  const { sessionId } = req.params;
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const newerCursor = typeof req.query.newerCursor === 'string' ? req.query.newerCursor : null;
  const anchorMessageId = typeof req.query.anchorMessageId === 'string' ? req.query.anchorMessageId : null;
  const limitRaw = req.query.limit ?? '120';
  const limit = Number.parseInt(String(limitRaw), 10);
  if (cursor !== null && !/^\d+$/.test(cursor)) {
    return res.status(400).json({ error: 'cursor must be a numeric offset' });
  }
  if (newerCursor !== null && !/^\d+$/.test(newerCursor)) {
    return res.status(400).json({ error: 'newerCursor must be a numeric offset' });
  }
  if (Number.isNaN(limit) || limit < 1) {
    return res.status(400).json({ error: 'limit must be positive' });
  }
  if (Object.prototype.hasOwnProperty.call(req.query, 'includeHidden')) {
    return res.status(400).json({ error: 'includeHidden is not part of the public conversation contract' });
  }
  const includeCapabilityResults = String(req.query.includeCapabilityResults ?? 'false') === 'true';
  const isDefaultLatestRead =
    !Object.prototype.hasOwnProperty.call(req.query, 'cursor') &&
    !Object.prototype.hasOwnProperty.call(req.query, 'newerCursor') &&
    !Object.prototype.hasOwnProperty.call(req.query, 'anchorMessageId');
  const conversation = store.getConversation(sessionId, {
    includeHidden: false,
    includeCapabilityResults,
    limit,
    ...(cursor === null ? {} : { cursor }),
    ...(newerCursor === null ? {} : { newerCursor }),
    ...(anchorMessageId === null ? {} : { anchorMessageId }),
    includeForkNotice: isDefaultLatestRead,
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Session not found' });
  }

  return res.json(conversation);
});

router.get('/:sessionId/conversation/preview', (req, res) => {
  const offset = req.query.offset === undefined ? undefined : Number.parseInt(String(req.query.offset), 10);
  const limit = Number.parseInt(String(req.query.limit ?? '100'), 10);
  if ((offset !== undefined && (!Number.isInteger(offset) || offset < 0)) || !Number.isInteger(limit) || limit < 1) {
    return res.status(400).json({ error: 'preview pagination is invalid' });
  }
  const page = store.getConversationPreview(req.params.sessionId, {
    ...(offset === undefined ? {} : { offset }),
    limit,
  });
  return page ? res.json(page) : res.status(404).json({ error: 'Session preview not found' });
});

router.get('/:sessionId/runs/:runId/events', async (req, res) => {
  const afterSequence = Number.parseInt(String(req.query.afterSequence ?? '0'), 10);
  const limit = Number.parseInt(String(req.query.limit ?? '1000'), 10);
  if (!Number.isInteger(afterSequence) || afterSequence < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return res.status(400).json({ error: 'run event pagination is invalid' });
  }
  const page = store.getRunEvents(req.params.sessionId, req.params.runId, {
    afterSequence,
    limit,
  });
  if (!page) {
    return res.status(404).json({ error: 'Run events not found' });
  }
  await new Promise((resolve) => setTimeout(resolve, 40));
  return res.json(page);
});

router.put('/:sessionId/title', (req, res) => {
  const { sessionId } = req.params;
  const { title } = req.body ?? {};
  if (!store.sessionDetails[sessionId]) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required and must not be blank' });
  }
  if (title.length > 100) {
    return res.status(400).json({ error: 'title must not exceed 100 characters' });
  }
  const trimmedTitle = title.trim();
  store.updateSessionTitle(sessionId, trimmedTitle);
  return res.json({ sessionId, title: trimmedTitle });
});

router.patch('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { displayTitle } = req.body;
  const detail = store.sessionDetails[sessionId];
  if (!detail) {
    return res.status(404).json({ error: 'Session not found' });
  }
  store.updateSessionTitle(sessionId, displayTitle || '');
  return res.json({ success: true });
});

router.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const detail = store.sessionDetails[sessionId];

  if (!detail) {
    return res.status(404).json({ error: 'Session not found' });
  }

  return res.json(detail);
});

module.exports = router;

function parseSessionListQuery(query) {
  const offset = parseStrictInteger(query.offset, 0, 'offset');
  if (offset < 0) {
    throw new Error('offset must be a non-negative integer.');
  }

  const questionSearchText = parseQuestionSearchText(query.q);
  const hasCreatedFrom = query.createdFrom !== undefined;
  const hasCreatedTo = query.createdTo !== undefined;
  if (hasCreatedFrom !== hasCreatedTo) {
    throw new Error('createdFrom and createdTo must be provided together.');
  }
  const createdRange = hasCreatedFrom && hasCreatedTo ? parseCreatedRange(query.createdFrom, query.createdTo) : undefined;
  const isSearchQuery = questionSearchText !== undefined || createdRange !== undefined;
  const limit = parseStrictInteger(query.limit, isSearchQuery ? SESSION_SEARCH_DEFAULT_LIMIT : SESSION_LIST_DEFAULT_LIMIT, 'limit');
  if (limit < 1) {
    throw new Error('limit must be a positive integer.');
  }
  if (isSearchQuery && limit > SESSION_SEARCH_MAX_LIMIT) {
    throw new Error('search limit must not exceed 50.');
  }

  return {
    offset,
    limit,
    ...(questionSearchText === undefined ? {} : { q: questionSearchText }),
    ...(createdRange === undefined ? {} : { createdFrom: createdRange.from, createdTo: createdRange.to }),
  };
}

function parseQuestionSearchText(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return undefined;
  }
  if (Array.from(trimmed).length > SESSION_SEARCH_MAX_KEYWORD_CODE_POINTS) {
    throw new Error('q length is invalid.');
  }
  return trimmed;
}

function parseCreatedRange(createdFrom, createdTo) {
  const from = parseStrictInteger(createdFrom, undefined, 'createdFrom');
  const to = parseStrictInteger(createdTo, undefined, 'createdTo');
  if (from > to) {
    throw new Error('createdFrom must be less than or equal to createdTo.');
  }
  if (to - from > MAX_SESSION_CREATED_RANGE_MS) {
    throw new Error('created time range must not exceed 90 days.');
  }
  return { from, to };
}

function parseStrictInteger(value, fallback, name) {
  if (value === undefined) {
    if (fallback === undefined) {
      throw new Error(`${name} must be provided.`);
    }
    return fallback;
  }
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer.`);
  }
  return parsed;
}
