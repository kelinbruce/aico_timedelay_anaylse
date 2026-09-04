/**
 * In-memory data store for the mock server.
 * It keeps session state, conversation snapshots, and replay buffers aligned.
 */

const now = new Date();
const { buildProcessHistoryStressFixture } = require('./process-history-stress');

const capabilities = [
  { name: 'networkDiagnostic', description: '网络设备诊断工具', category: 'network' },
  { name: 'bandwidthAnalysis', description: '带宽分析工具', category: 'network' },
  { name: 'configManagement', description: '配置文件管理', category: 'config' },
  { name: 'logAnalyzer', description: '日志分析工具', category: 'analysis' },
  { name: 'topologyDiscovery', description: '网络拓扑发现', category: 'network' },
  { name: 'firewallConfig', description: '\u9632\u706b\u5899\u914d\u7f6e\u5de5\u5177', category: 'security' },
  { name: 'vlanManager', description: 'VLAN 管理工具', category: 'network' },
  { name: 'ipPoolManager', description: 'IP \u5730\u5740\u6c60\u7ba1\u7406', category: 'network' },
];

const sseConnections = {};
const wsConnections = {};
const activeStreams = {};

const sessions = [];
const sessionDetails = {};
const conversations = {};
const conversationPreviews = {};
const runEventsBySession = {};
const sessionCounter = { value: 0 };
const sessionForkSources = {};
const sessionForkIdempotency = {};
const uploadedAttachmentsBySession = {};
const pendingInputRequests = {};

const streamSequenceCounters = {};
const conversationSequenceCounters = {};

const MAX_BUFFER_PER_SESSION = 1200;
const REPLAY_MAX_ITEMS = MAX_BUFFER_PER_SESSION;
const DEFAULT_SESSION_TITLE = '\u65b0\u4f1a\u8bdd';
const DEFAULT_TITLE_MAX_LENGTH = 50;
const replayBuffers = {};

function isCompletedProcessSnapshot(envelope) {
  const payload = envelope?.payload;
  const metadata = payload?.metadata;
  return Boolean(payload && typeof payload === 'object' && metadata && typeof metadata === 'object' && metadata.completed === true);
}

function shouldRecordRunHistoryEvent(envelope) {
  if (!envelope || typeof envelope.runId !== 'string' || envelope.runId.trim().length === 0) {
    return false;
  }
  if (envelope.eventType === 'CAPABILITY_STARTED' || envelope.eventType === 'CAPABILITY_COMPLETED') {
    return true;
  }
  if (envelope.eventType === 'LLM_THINKING_DELTA') {
    return isCompletedProcessSnapshot(envelope);
  }
  return (
    envelope.eventType === 'LLM_CONTENT_DELTA' &&
    isCompletedProcessSnapshot(envelope) &&
    typeof envelope.payload.stepId === 'string' &&
    envelope.payload.stepId.trim().length > 0 &&
    envelope.payload.final !== true
  );
}

function recordRunHistoryEvent(sessionId, envelope) {
  if (!shouldRecordRunHistoryEvent(envelope)) {
    return;
  }
  const runEvents = runEventsBySession[sessionId] ?? {};
  const events = runEvents[envelope.runId] ?? [];
  const existingIndex = events.findIndex((event) => event.eventId === envelope.eventId);
  if (existingIndex >= 0) {
    events[existingIndex] = envelope;
  } else {
    events.push(envelope);
  }
  events.sort((left, right) => left.sequence - right.sequence);
  runEvents[envelope.runId] = events;
  runEventsBySession[sessionId] = runEvents;
}

function hasReplayFilters(filters = {}) {
  return Boolean(filters.requestId || filters.runId);
}

function matchesReplayFilters(envelope, filters = {}) {
  if (filters.requestId && envelope.requestId !== filters.requestId) {
    return false;
  }
  if (filters.runId && envelope.runId !== filters.runId) {
    return false;
  }
  return true;
}

function createReplayBuffer() {
  const buffer = [];
  return {
    append(envelope) {
      buffer.push(envelope);
      while (buffer.length > MAX_BUFFER_PER_SESSION) {
        buffer.shift();
      }
    },
    replay(lastSeenSequence, maxItems, filters = {}) {
      if (buffer.length === 0) {
        return {
          envelopes: [],
          continuityAvailable: true,
          gapRefreshRequired: false,
          firstAvailableSequence: null,
          nextSequence: Math.max(1, lastSeenSequence + 1),
        };
      }

      const sorted = [...buffer].sort((left, right) => left.sequence - right.sequence);
      const filtered = sorted.filter((envelope) => matchesReplayFilters(envelope, filters));
      const firstAvailable = filtered[0]?.sequence ?? null;
      const replayed = filtered.filter((envelope) => envelope.sequence > lastSeenSequence).slice(0, maxItems);

      if (replayed.length === 0) {
        return {
          envelopes: [],
          continuityAvailable: true,
          gapRefreshRequired: false,
          firstAvailableSequence: firstAvailable,
          nextSequence: sorted[sorted.length - 1].sequence + 1,
        };
      }

      const isInitialConnect = lastSeenSequence === 0;
      const continuity = hasReplayFilters(filters) || isInitialConnect || replayed[0].sequence === lastSeenSequence + 1;

      return {
        envelopes: replayed,
        continuityAvailable: continuity,
        gapRefreshRequired: !continuity,
        firstAvailableSequence: firstAvailable,
        nextSequence: replayed[replayed.length - 1].sequence + 1,
      };
    },
  };
}

const replayBuffer = {
  append(sessionId, envelope) {
    if (!replayBuffers[sessionId]) {
      replayBuffers[sessionId] = createReplayBuffer();
    }
    replayBuffers[sessionId].append(envelope);
    recordRunHistoryEvent(sessionId, envelope);
  },
  replay(sessionId, lastSeenSequence, maxItems, filters = {}) {
    if (!replayBuffers[sessionId]) {
      return {
        envelopes: [],
        continuityAvailable: true,
        gapRefreshRequired: false,
        firstAvailableSequence: null,
        nextSequence: Math.max(1, lastSeenSequence + 1),
      };
    }
    return replayBuffers[sessionId].replay(lastSeenSequence, maxItems, filters);
  },
};

function ensureSessionCounters(sessionId) {
  if (typeof streamSequenceCounters[sessionId] !== 'number') {
    streamSequenceCounters[sessionId] = 0;
  }
  if (typeof conversationSequenceCounters[sessionId] !== 'number') {
    const conversation = conversations[sessionId];
    const maxSequence = Array.isArray(conversation?.items) ? conversation.items.reduce((max, item) => Math.max(max, item.sequence || 0), 0) : 0;
    conversationSequenceCounters[sessionId] = maxSequence;
  }
}

function createSession(sessionId, locale) {
  const detail = {
    sessionId,
    deploymentMode: 'LOCAL',
    channel: 'WEB',
    locale: locale || 'zh-CN',
    status: 'READY',
    activeRequestId: null,
    activeRequestContextId: null,
    lastCompletedRequestId: null,
    lastCompletedRequestContextId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const conversation = {
    sessionId,
    items: [],
    nextCursor: null,
  };

  sessions.unshift({
    sessionId,
    displayTitle: DEFAULT_SESSION_TITLE,
    lastMessagePreview: '',
    lastRunStatus: null,
    lastActivityAt: Date.now(),
    hasInFlightRequest: false,
  });

  sessionDetails[sessionId] = detail;
  conversations[sessionId] = conversation;
  uploadedAttachmentsBySession[sessionId] = new Map();
  streamSequenceCounters[sessionId] = 0;
  conversationSequenceCounters[sessionId] = 0;

  return { sessionId, displayTitle: DEFAULT_SESSION_TITLE, lastActivityAt: sessions[0].lastActivityAt };
}

function normalizeSessionQuery(offsetOrQuery = 0, limit = 20) {
  if (typeof offsetOrQuery === 'object' && offsetOrQuery !== null) {
    return {
      offset: Number.isInteger(offsetOrQuery.offset) ? Math.max(0, offsetOrQuery.offset) : 0,
      limit: Number.isInteger(offsetOrQuery.limit) && offsetOrQuery.limit > 0 ? offsetOrQuery.limit : 20,
      ...(typeof offsetOrQuery.q === 'string' && offsetOrQuery.q.trim() ? { q: offsetOrQuery.q.trim() } : {}),
      ...(Number.isInteger(offsetOrQuery.createdFrom) && Number.isInteger(offsetOrQuery.createdTo)
        ? { createdFrom: offsetOrQuery.createdFrom, createdTo: offsetOrQuery.createdTo }
        : {}),
    };
  }
  return {
    offset: Number.isInteger(offsetOrQuery) ? Math.max(0, offsetOrQuery) : 0,
    limit: Number.isInteger(limit) && limit > 0 ? limit : 20,
  };
}

function matchesLiteralSearchText(value, normalizedQuery) {
  return typeof value === 'string' && value.toLowerCase().includes(normalizedQuery);
}

function matchesSessionSearch(entry, normalizedQuery) {
  if (matchesLiteralSearchText(entry.displayTitle, normalizedQuery)) {
    return true;
  }
  const conversation = ensureConversation(entry.sessionId);
  return conversation.items.some((item) => item.role === 'USER' && item.visible !== false && matchesLiteralSearchText(item.content, normalizedQuery));
}

function getSessions(offsetOrQuery = 0, limit = 20) {
  const query = normalizeSessionQuery(offsetOrQuery, limit);
  const normalizedQuery = query.q?.toLowerCase();
  const filteredEntries = [...sessions]
    .filter((entry) => {
      if (normalizedQuery && !matchesSessionSearch(entry, normalizedQuery)) {
        return false;
      }
      if (query.createdFrom !== undefined && Number(entry.lastActivityAt) < query.createdFrom) {
        return false;
      }
      if (query.createdTo !== undefined && Number(entry.lastActivityAt) > query.createdTo) {
        return false;
      }
      return true;
    })
    .sort((left, right) => Number(right.lastActivityAt) - Number(left.lastActivityAt) || left.sessionId.localeCompare(right.sessionId));

  return {
    entries: filteredEntries.slice(query.offset, query.offset + query.limit).map((entry) => ({
      sessionId: entry.sessionId,
      displayTitle: entry.displayTitle,
      lastMessagePreview: entry.lastMessagePreview,
      ...(entry.lastRunStatus ? { lastRunStatus: entry.lastRunStatus } : {}),
      lastActivityAt: entry.lastActivityAt,
      hasInFlightRequest: Boolean(entry.hasInFlightRequest),
    })),
    offset: query.offset,
    limit: query.limit,
    hasMore: query.offset + query.limit < filteredEntries.length,
  };
}

function ensureConversation(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = { sessionId, items: [], nextCursor: null };
  }
  ensureSessionCounters(sessionId);
  return conversations[sessionId];
}

function getConversation(sessionId, options = {}) {
  if (!sessionDetails[sessionId]) {
    return null;
  }
  const includeHidden = options.includeHidden ?? false;
  const includeCapabilityResults = options.includeCapabilityResults ?? false;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 120;
  const conversation = ensureConversation(sessionId);
  const filteredItems = conversation.items.filter((item) => {
    if (!includeHidden && item.visible === false) {
      return false;
    }
    if (!includeCapabilityResults && item.role === 'CAPABILITY_RESULT') {
      return false;
    }
    return true;
  });
  const anchorIndex =
    typeof options.anchorMessageId === 'string' ? filteredItems.findIndex((item) => item.messageId === options.anchorMessageId) : -1;
  let start;
  if (anchorIndex >= 0) {
    start = Math.max(0, Math.min(anchorIndex - Math.floor(limit / 2), Math.max(0, filteredItems.length - limit)));
  } else if (typeof options.newerCursor === 'string') {
    start = parseConversationCursor(options.newerCursor, filteredItems.length);
  } else if (typeof options.cursor === 'string') {
    start = parseConversationCursor(options.cursor, filteredItems.length);
  } else if (Number.isInteger(options.offset)) {
    start = Math.max(0, Math.min(options.offset, filteredItems.length));
  } else {
    start = Math.max(0, filteredItems.length - limit);
  }
  const end = Math.min(filteredItems.length, start + limit);
  const items = filteredItems.slice(start, end);
  const nextCursor = start > 0 ? String(Math.max(0, start - limit)) : null;
  const newerCursor = (anchorIndex >= 0 || typeof options.newerCursor === 'string') && end < filteredItems.length ? String(end) : null;
  const forkSource = sessionForkSources[sessionId];
  const forkNotice =
    options.includeForkNotice && forkSource?.childAnchorMessageId && !hasUserMessageAfter(sessionId, forkSource.childAnchorMessageId)
      ? {
          sourceSessionId: forkSource.sourceSessionId,
          sourceSessionTitle: forkSource.sourceSessionTitle,
        }
      : undefined;
  return {
    sessionId: conversation.sessionId,
    items,
    nextCursor,
    ...(newerCursor === null ? {} : { newerCursor }),
    ...(forkNotice ? { forkNotice } : {}),
  };
}

function parseConversationCursor(cursor, maximum) {
  if (!/^\d+$/.test(cursor)) {
    return 0;
  }
  return Math.max(0, Math.min(Number.parseInt(cursor, 10), maximum));
}

function getConversationPreview(sessionId, options = {}) {
  const markers = conversationPreviews[sessionId];
  if (!markers) {
    return null;
  }
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const offset = Number.isInteger(options.offset) ? Math.max(0, Math.min(options.offset, markers.length)) : Math.max(0, markers.length - limit);
  return {
    sessionId,
    totalMarkers: markers.length,
    offset,
    limit,
    markers: markers.slice(offset, offset + limit),
  };
}

function getRunEvents(sessionId, runId, options = {}) {
  const events = runEventsBySession[sessionId]?.[runId];
  if (!events) {
    return null;
  }
  const afterSequence = Number.isInteger(options.afterSequence) ? Math.max(0, options.afterSequence) : 0;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 1000;
  const remaining = events.filter((event) => event.sequence > afterSequence);
  const page = remaining.slice(0, limit);
  const hasMore = remaining.length > page.length;
  return {
    availability: 'AVAILABLE',
    events: page,
    ...(hasMore && page.length > 0 ? { nextAfterSequence: page[page.length - 1].sequence } : {}),
  };
}

function hasUserMessageAfter(sessionId, anchorMessageId) {
  const conversation = ensureConversation(sessionId);
  const anchor = conversation.items.find((item) => item.messageId === anchorMessageId);
  if (!anchor) {
    return false;
  }
  return conversation.items.some((item) => item.role === 'USER' && item.sequence > anchor.sequence);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readSessionTitle(sessionId) {
  const title = sessions.find((entry) => entry.sessionId === sessionId)?.displayTitle;
  return typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_SESSION_TITLE;
}

function forkSessionFromMessage(sourceSessionId, sourceAnchorMessageId, idempotencyKey) {
  if (!sessionDetails[sourceSessionId]) {
    return null;
  }
  const normalizedIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (!normalizedIdempotencyKey) {
    throw new Error('idempotencyKey is required');
  }
  const idempotencyScope = `${sourceSessionId}:${sourceAnchorMessageId}:${normalizedIdempotencyKey}`;
  const replayedChildSessionId = sessionForkIdempotency[idempotencyScope];
  if (replayedChildSessionId) {
    const replayed = sessions.find((entry) => entry.sessionId === replayedChildSessionId);
    return replayed ? { sessionId: replayed.sessionId, displayTitle: replayed.displayTitle, lastActivityAt: replayed.lastActivityAt } : null;
  }

  const sourceConversation = ensureConversation(sourceSessionId);
  const anchorIndex = sourceConversation.items.findIndex((item) => item.messageId === sourceAnchorMessageId);
  const anchor = anchorIndex >= 0 ? sourceConversation.items[anchorIndex] : null;
  if (!anchor || anchor.role !== 'ASSISTANT' || anchor.visible === false || !String(anchor.content || '').trim()) {
    return null;
  }

  const childSessionId = `session-${++sessionCounter.value}`;
  const sourceTitle = readSessionTitle(sourceSessionId);
  const childHandle = createSession(childSessionId, sessionDetails[sourceSessionId]?.locale);
  updateSessionTitle(childSessionId, sourceTitle);
  childHandle.displayTitle = sourceTitle;

  const childConversation = ensureConversation(childSessionId);
  childConversation.items = [];
  conversationSequenceCounters[childSessionId] = 0;

  const prefix = sourceConversation.items.slice(0, anchorIndex + 1);
  const messageIdMap = new Map(prefix.map((item, index) => [item.messageId, `fork-${childSessionId}-${index + 1}`]));
  let childAnchorMessageId = null;
  for (const item of prefix) {
    const childMessageId = messageIdMap.get(item.messageId);
    if (!childMessageId) {
      continue;
    }
    if (item.messageId === sourceAnchorMessageId) {
      childAnchorMessageId = childMessageId;
    }
    upsertConversationItem(childSessionId, {
      ...item,
      messageId: childMessageId,
      sessionId: childSessionId,
      requestId: item.requestId ? (messageIdMap.get(item.requestId) ?? item.requestId) : undefined,
      requestContextId: item.requestContextId ? (messageIdMap.get(item.requestContextId) ?? item.requestContextId) : null,
      rootMessageId: item.rootMessageId ? (messageIdMap.get(item.rootMessageId) ?? item.rootMessageId) : undefined,
      runId: undefined,
      sequence: nextConversationSequence(childSessionId),
      metadata: cloneJson(item.metadata) || {},
    });
  }

  sessionForkSources[childSessionId] = {
    sourceSessionId,
    sourceSessionTitle: sourceTitle,
    childAnchorMessageId,
  };
  sessionForkIdempotency[idempotencyScope] = childSessionId;
  updateSessionActivity(childSessionId, anchor.content || '', 'COMPLETED');

  const childEntry = sessions.find((entry) => entry.sessionId === childSessionId);
  return {
    sessionId: childSessionId,
    displayTitle: childEntry?.displayTitle ?? sourceTitle,
    lastActivityAt: childEntry?.lastActivityAt ?? Date.now(),
  };
}

function getRecentVisibleMessageIds(sessionId, limit = 10) {
  const conversation = getConversation(sessionId, {
    includeHidden: false,
    includeCapabilityResults: true,
    offset: 0,
    limit: Number.MAX_SAFE_INTEGER,
  });
  if (!conversation) {
    return [];
  }
  return conversation.items.slice(-limit).map((item) => item.messageId);
}

function getLatestRequestId(sessionId) {
  const detail = sessionDetails[sessionId];
  if (!detail) {
    return null;
  }
  return detail.activeRequestId || detail.lastCompletedRequestId || null;
}

function getLatestRequestContextId(sessionId) {
  const detail = sessionDetails[sessionId];
  if (!detail) {
    return null;
  }
  return detail.activeRequestContextId || detail.lastCompletedRequestContextId || null;
}

function getLatestRequestIdentityForClient(sessionId) {
  return getLatestRequestContextId(sessionId) || getLatestRequestId(sessionId);
}

function matchesLatestRequestIdentity(sessionId, identity) {
  if (!identity) {
    return false;
  }
  const latestRootMessageId = getLatestRequestId(sessionId);
  const latestRequestContextId = getLatestRequestContextId(sessionId);
  return identity === latestRootMessageId || identity === latestRequestContextId;
}

function nextConversationSequence(sessionId) {
  ensureSessionCounters(sessionId);
  conversationSequenceCounters[sessionId] += 1;
  return conversationSequenceCounters[sessionId];
}

function nextStreamSequence(sessionId) {
  ensureSessionCounters(sessionId);
  streamSequenceCounters[sessionId] += 1;
  return streamSequenceCounters[sessionId];
}

function allocateStreamSequences(sessionId, events) {
  for (const event of events) {
    event.sequence = nextStreamSequence(sessionId);
  }
  return events;
}

function upsertConversationItem(sessionId, item) {
  const conversation = ensureConversation(sessionId);
  const existingIndex = conversation.items.findIndex((candidate) => candidate.messageId === item.messageId);
  if (existingIndex >= 0) {
    conversation.items[existingIndex] = item;
  } else {
    conversation.items.push(item);
  }
  conversation.items.sort((left, right) => left.sequence - right.sequence);
}

function updateUserRequestStatus(sessionId, requestId, status, requestContextId = requestId) {
  if (!requestId || !status) {
    return;
  }
  const conversation = ensureConversation(sessionId);
  conversation.items = conversation.items.map((item) => {
    if (item.role !== 'USER') {
      return item;
    }
    const itemRootMessageId = item.rootMessageId || item.messageId;
    if (item.messageId !== requestId && itemRootMessageId !== requestId && item.requestContextId !== requestContextId) {
      return item;
    }
    return {
      ...item,
      requestContextId: item.requestContextId || requestContextId,
      metadata: {
        ...(item.metadata || {}),
        status,
        requestContextId,
      },
    };
  });
}

function inferAssistantContentType(content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return 'PLAIN_TEXT';
  }
  if (content.includes('## ') || content.includes('|') || content.includes('```') || content.includes('- ') || content.includes('1.')) {
    return 'MARKDOWN';
  }
  return 'PLAIN_TEXT';
}

function normalizeSessionTitle(inputText) {
  const normalized = typeof inputText === 'string' ? inputText.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return DEFAULT_SESSION_TITLE;
  }
  if (normalized.length <= DEFAULT_TITLE_MAX_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, DEFAULT_TITLE_MAX_LENGTH);
}

function recordUserRequest(sessionId, requestId, inputText, submittedAt = new Date().toISOString(), options = {}) {
  const nextTitle = normalizeSessionTitle(inputText);
  const session = sessions.find((entry) => entry.sessionId === sessionId);
  if (session && (!session.displayTitle || session.displayTitle === DEFAULT_SESSION_TITLE)) {
    session.displayTitle = nextTitle;
  }

  upsertConversationItem(sessionId, {
    messageId: requestId,
    sessionId,
    requestId,
    requestContextId: options.requestContextId ?? null,
    rootMessageId: requestId,
    runId: options.runId ?? options.requestContextId ?? requestId,
    role: 'USER',
    sequence: nextConversationSequence(sessionId),
    content: inputText,
    contentType: 'PLAIN_TEXT',
    metadata: {
      status: 'EXECUTING',
      requestContextId: options.requestContextId ?? requestId,
    },
    createdAt: submittedAt,
    visible: true,
  });
  updateSessionActivity(sessionId, inputText || '', 'EXECUTING');
}

function recordAssistantResponse(sessionId, requestId, content, createdAt = new Date().toISOString(), options = {}) {
  if (!content || !String(content).trim()) {
    return;
  }

  upsertConversationItem(sessionId, {
    messageId: `assistant-${requestId}`,
    sessionId,
    requestId,
    requestContextId: options.requestContextId ?? requestId,
    rootMessageId: options.rootMessageId ?? requestId,
    runId: options.runId ?? options.requestContextId ?? requestId,
    role: 'ASSISTANT',
    sequence: nextConversationSequence(sessionId),
    content: String(content),
    contentType: inferAssistantContentType(String(content)),
    metadata: {},
    createdAt,
    visible: true,
  });
}

function recordCapabilityResults(sessionId, requestId, capabilityResults, options = {}) {
  if (!Array.isArray(capabilityResults) || capabilityResults.length === 0) {
    return;
  }

  const rootMessageId = options.rootMessageId || requestId;
  const requestContextId = options.requestContextId || rootMessageId;
  const createdAt = options.createdAt || new Date().toISOString();

  capabilityResults.forEach((result, index) => {
    if (!result || !String(result.content || '').trim()) {
      return;
    }
    upsertConversationItem(sessionId, {
      messageId: `capability-${requestId}-${index + 1}`,
      sessionId,
      requestId,
      requestContextId,
      rootMessageId,
      runId: options.runId ?? requestContextId,
      role: 'CAPABILITY_RESULT',
      sequence: nextConversationSequence(sessionId),
      content: String(result.content),
      contentType: inferAssistantContentType(String(result.content)),
      metadata: {
        toolCallId: result.toolCallId || null,
        capabilityName: result.toolName || null,
        status: result.status || 'COMPLETED',
      },
      createdAt,
      visible: true,
    });
  });
}

function getUserMessageByRoot(sessionId, rootMessageId, options = {}) {
  if (!rootMessageId) {
    return null;
  }
  const visibleOnly = options.visibleOnly ?? true;
  const conversation = ensureConversation(sessionId);
  let latestUserMessage = null;
  for (const item of conversation.items) {
    if (item.role !== 'USER') {
      continue;
    }
    if (visibleOnly && item.visible === false) {
      continue;
    }
    const itemRootMessageId = item.rootMessageId || item.messageId;
    if (itemRootMessageId !== rootMessageId && item.messageId !== rootMessageId) {
      continue;
    }
    if (!latestUserMessage || item.sequence >= latestUserMessage.sequence) {
      latestUserMessage = item;
    }
  }
  return latestUserMessage;
}

function getVisibleUserMessageByRoot(sessionId, rootMessageId) {
  return getUserMessageByRoot(sessionId, rootMessageId, { visibleOnly: true });
}

function getLatestVisibleUserRootMessageId(sessionId) {
  const conversation = ensureConversation(sessionId);
  let latestVisibleUserMessage = null;
  for (const item of conversation.items) {
    if (item.role !== 'USER' || item.visible === false) {
      continue;
    }
    if (!latestVisibleUserMessage || item.sequence >= latestVisibleUserMessage.sequence) {
      latestVisibleUserMessage = item;
    }
  }
  if (!latestVisibleUserMessage) {
    return null;
  }
  return latestVisibleUserMessage.rootMessageId || latestVisibleUserMessage.messageId;
}

function registerUploadedAttachments(sessionId, attachments) {
  if (!sessionDetails[sessionId]) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const registry = uploadedAttachmentsBySession[sessionId] || new Map();
  for (const attachment of attachments || []) {
    if (!attachment?.attachmentId) {
      continue;
    }
    registry.set(attachment.attachmentId, attachment);
  }
  uploadedAttachmentsBySession[sessionId] = registry;
}

function firstUnavailableAttachmentReason(sessionId, attachments) {
  if (!attachments || attachments.length === 0) {
    return null;
  }
  if (attachments.length > 3) {
    return 'attachments must not exceed 3 items';
  }
  const registry = uploadedAttachmentsBySession[sessionId] || new Map();
  for (const attachment of attachments) {
    if (!attachment?.attachmentId) {
      return 'attachmentId is required';
    }
    if (!registry.has(attachment.attachmentId)) {
      return `attachment ${attachment.attachmentId} is unavailable`;
    }
  }
  return null;
}

function hideMessagesForRoot(sessionId, rootMessageId, options = { hideUser: true, hideAssistant: true, hideCapability: true }) {
  const conversation = ensureConversation(sessionId);
  const hideUser = options.hideUser !== false;
  const hideAssistant = options.hideAssistant !== false;
  const hideCapability = options.hideCapability !== false;
  conversation.items = conversation.items.map((item) => {
    if (item.visible === false) {
      return item;
    }
    const itemRootMessageId = item.rootMessageId || item.messageId;
    if (itemRootMessageId !== rootMessageId && item.messageId !== rootMessageId) {
      return item;
    }
    if (item.role === 'USER' && !hideUser) {
      return item;
    }
    if (item.role === 'ASSISTANT' && !hideAssistant) {
      return item;
    }
    if (item.role === 'CAPABILITY_RESULT' && !hideCapability) {
      return item;
    }
    return {
      ...item,
      visible: false,
    };
  });
}

function hideAssistantMessagesForRoot(sessionId, rootMessageId) {
  hideMessagesForRoot(sessionId, rootMessageId, {
    hideUser: false,
    hideAssistant: true,
    hideCapability: true,
  });
}

function recordRetryAssistantResponse(
  sessionId,
  requestId,
  rootMessageId,
  content,
  createdAt = new Date().toISOString(),
  requestContextId = requestId,
  runId = requestContextId,
) {
  if (!content || !String(content).trim()) {
    return;
  }

  upsertConversationItem(sessionId, {
    messageId: `assistant-${requestId}`,
    sessionId,
    requestId,
    requestContextId,
    rootMessageId,
    runId,
    role: 'ASSISTANT',
    sequence: nextConversationSequence(sessionId),
    content: String(content),
    contentType: inferAssistantContentType(String(content)),
    metadata: {},
    createdAt,
    visible: true,
  });
}

function updateSessionTitle(sessionId, title) {
  const session = sessions.find((entry) => entry.sessionId === sessionId);
  if (session) {
    session.displayTitle = title;
  }
}

function updateSessionActivity(sessionId, preview, status) {
  const session = sessions.find((entry) => entry.sessionId === sessionId);
  if (session) {
    session.lastMessagePreview = preview;
    session.lastRunStatus = status;
    session.lastActivityAt = Date.now();
    session.hasInFlightRequest = status === 'EXECUTING' || status === 'ACCEPTED';
  }
}

function updateSessionStatus(sessionId, status) {
  const detail = sessionDetails[sessionId];
  if (detail) {
    detail.status = status;
    detail.updatedAt = new Date().toISOString();
    if (status !== 'STREAMING') {
      detail.activeRequestId = null;
      detail.activeRequestContextId = null;
    }
  }
  const preview = sessions.find((entry) => entry.sessionId === sessionId)?.lastMessagePreview || '';
  updateSessionActivity(sessionId, preview, status);
}

function completeRequest(sessionId, requestId, preview = '', requestContextId = requestId) {
  const detail = sessionDetails[sessionId];
  if (detail) {
    detail.activeRequestId = null;
    detail.activeRequestContextId = null;
    detail.lastCompletedRequestId = requestId;
    detail.lastCompletedRequestContextId = requestContextId;
    detail.status = 'COMPLETED';
    detail.updatedAt = new Date().toISOString();
  }
  updateUserRequestStatus(sessionId, requestId, 'COMPLETED', requestContextId);
  updateSessionActivity(sessionId, preview, 'COMPLETED');
}

function markRequestCanceled(sessionId, requestId, preview = '', requestContextId = requestId) {
  const detail = sessionDetails[sessionId];
  if (detail) {
    detail.activeRequestId = null;
    detail.activeRequestContextId = null;
    detail.lastCompletedRequestId = requestId;
    detail.lastCompletedRequestContextId = requestContextId;
    detail.status = 'COMPLETED';
    detail.updatedAt = new Date().toISOString();
  }
  updateUserRequestStatus(sessionId, requestId, 'CANCELED', requestContextId);
  updateSessionActivity(sessionId, preview, 'CANCELED');
}

function markRequestFailed(sessionId, requestId, preview = '', requestContextId = requestId) {
  const detail = sessionDetails[sessionId];
  if (detail) {
    detail.activeRequestId = null;
    detail.activeRequestContextId = null;
    detail.lastCompletedRequestId = requestId;
    detail.lastCompletedRequestContextId = requestContextId;
    detail.status = 'FAILED';
    detail.updatedAt = new Date().toISOString();
  }
  updateUserRequestStatus(sessionId, requestId, 'FAILED', requestContextId);
  updateSessionActivity(sessionId, preview, 'FAILED');
}

function acceptRequest(sessionId, requestId, requestContextId = requestId) {
  if (!sessionDetails[sessionId]) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const detail = sessionDetails[sessionId];
  if (!['READY', 'COMPLETED', 'EXECUTING', 'STREAMING'].includes(detail.status)) {
    throw new Error(`Session is not in a valid state to accept requests: ${detail.status}`);
  }

  detail.activeRequestId = requestId;
  detail.activeRequestContextId = requestContextId;
  detail.status = 'STREAMING';
  detail.updatedAt = new Date().toISOString();
  updateSessionActivity(sessionId, '', 'EXECUTING');

  return {
    sessionId,
    requestId,
  };
}

function recordPendingInputRequest(sessionId, inputRequestId, inputConfig) {
  if (!pendingInputRequests[sessionId]) {
    pendingInputRequests[sessionId] = new Map();
  }
  pendingInputRequests[sessionId].set(inputRequestId, {
    inputRequestId,
    ...inputConfig,
    createdAt: new Date().toISOString(),
  });
}

function getPendingInputRequest(sessionId, inputRequestId) {
  return pendingInputRequests[sessionId]?.get(inputRequestId) ?? null;
}

function removePendingInputRequest(sessionId, inputRequestId) {
  pendingInputRequests[sessionId]?.delete(inputRequestId);
}

function seedProcessHistoryStressFixture() {
  const fixture = buildProcessHistoryStressFixture();
  sessions.push(fixture.session);
  sessionDetails[fixture.session.sessionId] = fixture.detail;
  conversations[fixture.session.sessionId] = fixture.conversation;
  conversationPreviews[fixture.session.sessionId] = fixture.previewMarkers;
  runEventsBySession[fixture.session.sessionId] = fixture.eventsByRun;
  uploadedAttachmentsBySession[fixture.session.sessionId] = new Map();
  ensureSessionCounters(fixture.session.sessionId);
}

seedProcessHistoryStressFixture();

module.exports = {
  sessions,
  sessionDetails,
  conversations,
  sessionForkSources,
  capabilities,
  sseConnections,
  wsConnections,
  activeStreams,
  replayBuffer,
  REPLAY_MAX_ITEMS,
  pendingInputRequests,
  sessionCounter,
  createSession,
  forkSessionFromMessage,
  getSessions,
  getConversation,
  getConversationPreview,
  getRunEvents,
  ensureConversation,
  allocateStreamSequences,
  recordUserRequest,
  recordAssistantResponse,
  recordCapabilityResults,
  recordRetryAssistantResponse,
  hideAssistantMessagesForRoot,
  hideMessagesForRoot,
  getLatestRequestId,
  getLatestRequestContextId,
  getLatestRequestIdentityForClient,
  matchesLatestRequestIdentity,
  getUserMessageByRoot,
  getVisibleUserMessageByRoot,
  getLatestVisibleUserRootMessageId,
  getRecentVisibleMessageIds,
  registerUploadedAttachments,
  firstUnavailableAttachmentReason,
  completeRequest,
  markRequestCanceled,
  markRequestFailed,
  nextStreamSequence,
  updateSessionTitle,
  updateSessionActivity,
  updateSessionStatus,
  acceptRequest,
  recordPendingInputRequest,
  getPendingInputRequest,
  removePendingInputRequest,
  now,
};
