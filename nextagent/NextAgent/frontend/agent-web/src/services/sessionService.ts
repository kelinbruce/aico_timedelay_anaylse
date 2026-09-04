import { apiClient } from './apiClient.ts';
import { normalizeStreamEnvelope } from '../features/chat/utils/streamValidation.ts';
import type {
  ConversationPreviewPage,
  SessionHistoryPage,
  SessionConversationPage,
  SessionOpenRequest,
  SessionHandle,
  SessionRunEventHistoryPage,
  StreamEnvelope,
} from '../state/contracts.ts';

const DEFAULT_CONVERSATION_PREVIEW_LIMIT = 100;
// Remote memory deployments reject session-list limits above 100, and the
// web-channel search path rejects limits above 50. Every list request is capped
// at this boundary so callers can refresh an expanded history window without
// sending an unbounded limit to any supported backend.
const SESSION_LIST_MAX_REQUEST_LIMIT = 100;
const SESSION_SEARCH_MAX_REQUEST_LIMIT = 50;

function isSessionListSearchQuery(query: ListSessionsQuery): boolean {
  return Boolean(query.q?.trim()) || (query.createdFrom !== undefined && query.createdTo !== undefined);
}

function capSessionListRequestLimit(query: ListSessionsQuery): number {
  const maxLimit = isSessionListSearchQuery(query) ? SESSION_SEARCH_MAX_REQUEST_LIMIT : SESSION_LIST_MAX_REQUEST_LIMIT;
  return Math.min(query.limit, maxLimit);
}

export interface ListSessionsQuery {
  offset: number;
  limit: number;
  q?: string;
  createdFrom?: number;
  createdTo?: number;
}

export interface LoadConversationQuery {
  sessionId: string;
  cursor?: string | null;
  newerCursor?: string | null;
  anchorMessageId?: string | null;
  limit: number;
  includeCapabilityResults: boolean;
  signal?: AbortSignal;
}

export interface LoadConversationPreviewOptions {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface LoadRunEventsQuery {
  readonly sessionId: string;
  readonly runId: string;
  readonly afterSequence: number;
  readonly limit: 1000;
  readonly signal?: AbortSignal;
}

export interface SessionService {
  listSessions: (query: ListSessionsQuery) => Promise<SessionHistoryPage>;
  loadConversation: (query: LoadConversationQuery) => Promise<SessionConversationPage>;
  loadRunEvents: (query: LoadRunEventsQuery) => Promise<SessionRunEventHistoryPage>;
  loadConversationPreview: (sessionId: string, options?: LoadConversationPreviewOptions | AbortSignal) => Promise<ConversationPreviewPage>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  createSession: (request: SessionOpenRequest) => Promise<SessionHandle>;
  forkSessionFromMessage: (request: ForkSessionFromMessageRequest) => Promise<SessionHandle>;
  forkSessionFromRequest: (request: ForkSessionFromRequestRequest) => Promise<SessionHandle>;
}

export interface ForkSessionFromMessageRequest {
  readonly sessionId: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
}

export interface ForkSessionFromRequestRequest {
  readonly sessionId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === 'object' && value !== null && 'aborted' in value && 'addEventListener' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function parseSessionRunEventHistoryPage(value: unknown): SessionRunEventHistoryPage {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new Error('Invalid run event history page.');
  }

  if (value.availability === 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE') {
    if (!hasOnlyKeys(value, ['availability', 'events']) || value.events.length !== 0) {
      throw new Error('Invalid run event history page.');
    }
    return {
      availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
      events: [],
    };
  }

  if (value.availability !== 'AVAILABLE' || !hasOnlyKeys(value, ['availability', 'events', 'nextAfterSequence'])) {
    throw new Error('Invalid run event history page.');
  }
  const events: StreamEnvelope[] = [];
  for (const valueEvent of value.events) {
    const event = normalizeStreamEnvelope(valueEvent);
    if (!event) {
      throw new Error('Invalid run event history page.');
    }
    events.push(event);
  }

  const nextAfterSequence = value.nextAfterSequence;
  if (nextAfterSequence !== undefined && (!Number.isSafeInteger(nextAfterSequence) || (nextAfterSequence as number) <= 0)) {
    throw new Error('Invalid run event history page.');
  }

  return {
    availability: 'AVAILABLE',
    events,
    ...(nextAfterSequence === undefined ? {} : { nextAfterSequence: nextAfterSequence as number }),
  };
}

export const sessionService: SessionService = {
  listSessions: (query) => {
    const params = new URLSearchParams({
      offset: String(query.offset),
      limit: String(capSessionListRequestLimit(query)),
    });
    if (query.q) {
      params.set('q', query.q);
    }
    if (query.createdFrom !== undefined && query.createdTo !== undefined) {
      params.set('createdFrom', String(query.createdFrom));
      params.set('createdTo', String(query.createdTo));
    }
    return apiClient.get<SessionHistoryPage>(`/api/v1/sessions?${params.toString()}`);
  },

  loadConversation: (query) => {
    const params = new URLSearchParams({
      limit: String(query.limit),
      includeCapabilityResults: String(query.includeCapabilityResults),
    });
    if (query.cursor) {
      params.set('cursor', query.cursor);
    }
    if (query.newerCursor) {
      params.set('newerCursor', query.newerCursor);
    }
    if (query.anchorMessageId) {
      params.set('anchorMessageId', query.anchorMessageId);
    }
    return apiClient.get<SessionConversationPage>(
      `/api/v1/sessions/${encodeURIComponent(query.sessionId)}/conversation?${params.toString()}`,
      query.signal ? { signal: query.signal } : undefined,
    );
  },

  loadRunEvents: async (query) => {
    const params = new URLSearchParams({
      afterSequence: String(query.afterSequence),
      limit: String(query.limit),
    });
    const page = await apiClient.get<unknown>(
      `/api/v1/sessions/${encodeURIComponent(query.sessionId)}/runs/${encodeURIComponent(query.runId)}/events?${params.toString()}`,
      query.signal ? { signal: query.signal } : undefined,
    );
    return parseSessionRunEventHistoryPage(page);
  },

  loadConversationPreview: (sessionId, options) => {
    const resolvedOptions = isAbortSignal(options) ? { signal: options } : (options ?? {});
    const params = new URLSearchParams({
      limit: String(resolvedOptions.limit ?? DEFAULT_CONVERSATION_PREVIEW_LIMIT),
    });
    if (resolvedOptions.offset !== undefined) {
      params.set('offset', String(resolvedOptions.offset));
    }
    return apiClient.get<ConversationPreviewPage>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/conversation/preview?${params.toString()}`,
      resolvedOptions.signal ? { signal: resolvedOptions.signal } : undefined,
    );
  },

  renameSession: async (sessionId, title) => {
    await apiClient.put<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/title`, { title });
  },

  deleteSession: async (sessionId) => {
    await apiClient.delete<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  },

  createSession: (request) => {
    const { idempotencyKey: _internalIdempotencyKey, ...publicRequest } = request;
    return apiClient.post<SessionHandle>('/api/v1/sessions', publicRequest);
  },

  forkSessionFromMessage: (request) => {
    return apiClient.post<SessionHandle>(
      `/api/v1/sessions/${encodeURIComponent(request.sessionId)}/messages/${encodeURIComponent(request.messageId)}/fork`,
      { idempotencyKey: request.idempotencyKey },
    );
  },

  forkSessionFromRequest: (request) => {
    return apiClient.post<SessionHandle>(
      `/api/v1/sessions/${encodeURIComponent(request.sessionId)}/requests/${encodeURIComponent(request.requestId)}/fork`,
      { idempotencyKey: request.idempotencyKey },
    );
  },
};
