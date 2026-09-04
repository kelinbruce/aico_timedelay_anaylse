import { create } from 'zustand';
import { sessionService } from '../services/sessionService.ts';
import { clearCapabilityPresentationResources } from './capabilityPresentationCoordinator.ts';
import { type SessionHistoryEntry } from '../state/contracts.ts';

export const RECENT_SESSION_LIMIT = 10;
export const SESSION_HISTORY_PAGE_LIMIT = 20;
export const PIU_HISTORY_INITIAL_LIMIT = 10;

export interface SessionHistorySearchQuery {
  readonly q?: string;
  readonly createdFrom?: number;
  readonly createdTo?: number;
}

interface SessionState {
  sessions: readonly SessionHistoryEntry[];
  hasMore: boolean;
  activeSessionId: string | null;
  isLoadingHistory: boolean;
  isOpeningSession: boolean;
  historyError: string | null;
  historyOffset: number;
  historyWindowLimit: number;
  historySearchQuery: SessionHistorySearchQuery;
}

interface SessionActions {
  setSessions: (entries: SessionHistoryEntry[], hasMore: boolean, offset: number) => void;
  appendSessions: (entries: SessionHistoryEntry[], hasMore: boolean, offset: number) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setLoadingHistory: (loading: boolean) => void;
  setOpeningSession: (opening: boolean) => void;
  setHistoryError: (error: string | null) => void;
  setHistoryWindowLimit: (limit: number) => void;
  setHistorySearchQuery: (query: SessionHistorySearchQuery) => void;
  clearHistorySearchQuery: () => void;
  loadSessions: (options?: LoadSessionsOptions) => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => void;
}

type SessionStore = SessionState & SessionActions;
interface LoadSessionsOptions {
  append?: boolean;
  limit?: number;
  query?: SessionHistorySearchQuery;
}

const EMPTY_HISTORY_SEARCH_QUERY: SessionHistorySearchQuery = {};
let sessionHistoryRequestVersion = 0;
let inFlightSessionHistoryRequest: { readonly key: string; readonly promise: Promise<void> } | null = null;

function mergeSessionHistoryEntries(
  previous: readonly SessionHistoryEntry[],
  incoming: readonly SessionHistoryEntry[],
): readonly SessionHistoryEntry[] {
  if (incoming.length === 0) {
    return previous;
  }
  const merged = [...previous];
  const indexBySessionId = new Map<string, number>();
  merged.forEach((entry, index) => {
    indexBySessionId.set(entry.sessionId, index);
  });
  for (const entry of incoming) {
    const existingIndex = indexBySessionId.get(entry.sessionId);
    if (existingIndex === undefined) {
      indexBySessionId.set(entry.sessionId, merged.length);
      merged.push(entry);
      continue;
    }
    merged[existingIndex] = entry;
  }
  return merged;
}

function normalizeHistoryWindowLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(Math.floor(limit), RECENT_SESSION_LIMIT) : RECENT_SESSION_LIMIT;
}

function buildSessionHistoryRequestKey(append: boolean, offset: number, limit: number, query: SessionHistorySearchQuery): string {
  return JSON.stringify({
    append,
    offset,
    limit,
    q: query.q ?? null,
    createdFrom: query.createdFrom ?? null,
    createdTo: query.createdTo ?? null,
  });
}

export function hasSessionHistorySearchQuery(query: SessionHistorySearchQuery): boolean {
  return Boolean(query.q?.trim()) || (query.createdFrom !== undefined && query.createdTo !== undefined);
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  hasMore: false,
  activeSessionId: null,
  isLoadingHistory: false,
  isOpeningSession: false,
  historyError: null,
  historyOffset: 0,
  historyWindowLimit: RECENT_SESSION_LIMIT,
  historySearchQuery: EMPTY_HISTORY_SEARCH_QUERY,

  setSessions: (entries, hasMore, offset) => {
    set({ sessions: entries, hasMore, historyOffset: offset });
  },

  appendSessions: (entries, hasMore, offset) => {
    set((state) => ({
      sessions: mergeSessionHistoryEntries(state.sessions, entries),
      hasMore,
      historyOffset: offset,
      historyWindowLimit: Math.max(normalizeHistoryWindowLimit(state.historyWindowLimit), offset),
    }));
  },

  setActiveSessionId: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  setLoadingHistory: (loading) => {
    set({ isLoadingHistory: loading });
  },

  setOpeningSession: (opening) => {
    set({ isOpeningSession: opening });
  },

  setHistoryError: (error) => {
    set({ historyError: error });
  },

  setHistoryWindowLimit: (limit) => {
    set({ historyWindowLimit: normalizeHistoryWindowLimit(limit) });
  },

  setHistorySearchQuery: (query) => {
    set({ historySearchQuery: query });
  },

  clearHistorySearchQuery: () => {
    set({ historySearchQuery: EMPTY_HISTORY_SEARCH_QUERY });
  },

  loadSessions: async (options) => {
    const append = options?.append ?? false;
    const state = get();
    const query = append ? state.historySearchQuery : (options?.query ?? state.historySearchQuery);
    const isSearch = hasSessionHistorySearchQuery(query);
    const offset = append ? state.historyOffset : 0;
    const limit = normalizeHistoryWindowLimit(options?.limit ?? (append || isSearch ? SESSION_HISTORY_PAGE_LIMIT : state.historyWindowLimit));
    const requestKey = buildSessionHistoryRequestKey(append, offset, limit, query);
    if (inFlightSessionHistoryRequest?.key === requestKey) {
      return inFlightSessionHistoryRequest.promise;
    }
    const requestVersion = ++sessionHistoryRequestVersion;

    set({
      isLoadingHistory: true,
      historyError: null,
      ...(append ? {} : { historySearchQuery: query }),
    });
    const promise = (async () => {
      try {
        const page = await sessionService.listSessions({
          offset,
          limit,
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.createdFrom === undefined || query.createdTo === undefined ? {} : { createdFrom: query.createdFrom, createdTo: query.createdTo }),
        });
        if (requestVersion !== sessionHistoryRequestVersion) {
          return;
        }
        const entries = Array.isArray(page.entries) ? page.entries : [];
        const newOffset = page.offset + entries.length;

        if (append) {
          get().appendSessions(entries, Boolean(page.hasMore), newOffset);
        } else {
          get().setSessions(entries, Boolean(page.hasMore), newOffset);
          set({ historyWindowLimit: limit });
        }
      } catch (error) {
        if (requestVersion !== sessionHistoryRequestVersion) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load sessions.';
        set({ historyError: message });
      } finally {
        if (inFlightSessionHistoryRequest?.key === requestKey) {
          inFlightSessionHistoryRequest = null;
        }
        if (requestVersion === sessionHistoryRequestVersion) {
          set({ isLoadingHistory: false });
        }
      }
    })();
    inFlightSessionHistoryRequest = { key: requestKey, promise };
    return promise;
  },

  loadMoreSessions: () => {
    const state = get();
    if (state.isLoadingHistory || !state.hasMore) {
      return Promise.resolve();
    }
    return get().loadSessions({ append: true });
  },

  renameSession: async (sessionId: string, title: string) => {
    await sessionService.renameSession(sessionId, title);
    // Update the loaded entry locally. Re-fetching the expanded window would grow
    // the request limit with the window size and exceed backend list limits.
    get().updateSessionTitle(sessionId, title);
  },

  deleteSession: async (sessionId: string) => {
    await sessionService.deleteSession(sessionId);
    clearCapabilityPresentationResources(sessionId);
    const state = get();
    if (state.activeSessionId === sessionId) {
      set({ activeSessionId: null });
    }
    const wasLoaded = state.sessions.some((entry) => entry.sessionId === sessionId);
    set((current) => ({
      sessions: current.sessions.filter((entry) => entry.sessionId !== sessionId),
      // Removing a loaded entry shrinks the loaded window by one, so keep the
      // append offset aligned instead of re-fetching a window whose size can
      // exceed backend list limits.
      historyOffset: wasLoaded ? Math.max(0, current.historyOffset - 1) : current.historyOffset,
    }));
  },

  updateSessionTitle: (sessionId: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map((entry) => (entry.sessionId === sessionId ? { ...entry, displayTitle: title } : entry)),
    }));
  },
}));

export const useActiveSessionId = () => useSessionStore((s) => s.activeSessionId);
export const useSessions = () => useSessionStore((s) => s.sessions);
export const useHasMoreSessions = () => useSessionStore((s) => s.hasMore);
export const useIsLoadingHistory = () => useSessionStore((s) => s.isLoadingHistory);
export const useIsOpeningSession = () => useSessionStore((s) => s.isOpeningSession);
export const useHistoryError = () => useSessionStore((s) => s.historyError);
