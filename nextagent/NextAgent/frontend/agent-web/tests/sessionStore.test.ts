import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sessionService } from '../src/services/sessionService.ts';
import { RECENT_SESSION_LIMIT, SESSION_HISTORY_PAGE_LIMIT, useSessionStore } from '../src/state/sessionStore.ts';
import type { SessionHistoryEntry } from '../src/state/contracts.ts';

const mockSessions: SessionHistoryEntry[] = [
  {
    sessionId: 'session-1',
    displayTitle: 'Test Session 1',
    lastActivityAt: '2024-01-01T00:00:00Z',
  },
  {
    sessionId: 'session-2',
    displayTitle: 'Test Session 2',
    lastActivityAt: '2024-01-02T00:00:00Z',
  },
];

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      hasMore: false,
      activeSessionId: null,
      isLoadingHistory: false,
      isOpeningSession: false,
      historyError: null,
      historyOffset: 0,
      historyWindowLimit: RECENT_SESSION_LIMIT,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setSessions', () => {
    it('should replace sessions when not appending', () => {
      useSessionStore.getState().setSessions(mockSessions, false, 2);

      expect(useSessionStore.getState().sessions).toHaveLength(2);
      expect(useSessionStore.getState().sessions[0]!.sessionId).toBe('session-1');
      expect(useSessionStore.getState().hasMore).toBe(false);
      expect(useSessionStore.getState().historyOffset).toBe(2);
    });

    it('should append and merge sessions', () => {
      useSessionStore.getState().setSessions([mockSessions[0]!], false, 1);
      useSessionStore.getState().appendSessions([mockSessions[1]!], true, 2);

      expect(useSessionStore.getState().sessions).toHaveLength(2);
      expect(useSessionStore.getState().hasMore).toBe(true);
    });

    it('should deduplicate sessions by sessionId', () => {
      useSessionStore.getState().setSessions([mockSessions[0]!], false, 1);
      useSessionStore.getState().appendSessions(
        [
          {
            ...mockSessions[0]!,
            displayTitle: 'Updated Title',
          },
          mockSessions[1]!,
        ],
        true,
        2,
      );

      expect(useSessionStore.getState().sessions).toHaveLength(2);
      expect(useSessionStore.getState().sessions[0]!.displayTitle).toBe('Updated Title');
    });
  });

  describe('setActiveSessionId', () => {
    it('should update active session id', () => {
      useSessionStore.getState().setActiveSessionId('session-1');
      expect(useSessionStore.getState().activeSessionId).toBe('session-1');
    });

    it('should allow null active session id', () => {
      useSessionStore.getState().setActiveSessionId('session-1');
      useSessionStore.getState().setActiveSessionId(null);
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });
  });

  describe('setLoadingHistory', () => {
    it('should update loading state', () => {
      useSessionStore.getState().setLoadingHistory(true);
      expect(useSessionStore.getState().isLoadingHistory).toBe(true);
    });
  });

  describe('setOpeningSession', () => {
    it('should update opening state', () => {
      useSessionStore.getState().setOpeningSession(true);
      expect(useSessionStore.getState().isOpeningSession).toBe(true);
    });
  });

  describe('setHistoryError', () => {
    it('should update error state', () => {
      useSessionStore.getState().setHistoryError('Network error');
      expect(useSessionStore.getState().historyError).toBe('Network error');
    });

    it('should clear error when set to null', () => {
      useSessionStore.getState().setHistoryError('Network error');
      useSessionStore.getState().setHistoryError(null);
      expect(useSessionStore.getState().historyError).toBeNull();
    });
  });

  describe('loadMoreSessions', () => {
    it('should not load if already loading', () => {
      useSessionStore.getState().setLoadingHistory(true);
      useSessionStore.getState().setSessions(mockSessions, true, 2);

      useSessionStore.getState().loadMoreSessions();
      expect(useSessionStore.getState().isLoadingHistory).toBe(true);
    });

    it('should not load if no more sessions', () => {
      useSessionStore.getState().setSessions(mockSessions, false, 2);

      useSessionStore.getState().loadMoreSessions();
      expect(useSessionStore.getState().isLoadingHistory).toBe(false);
    });
  });

  describe('loadSessions', () => {
    it('deduplicates concurrent requests with the same list parameters', async () => {
      let resolveList: (page: { entries: SessionHistoryEntry[]; offset: number; limit: number; hasMore: boolean }) => void = () => {
        throw new Error('listSessions promise was not initialized');
      };
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );

      const firstLoad = useSessionStore.getState().loadSessions({ limit: RECENT_SESSION_LIMIT, query: {} });
      const secondLoad = useSessionStore.getState().loadSessions({ limit: RECENT_SESSION_LIMIT, query: {} });

      expect(listSessionsSpy).toHaveBeenCalledTimes(1);
      resolveList({
        entries: mockSessions,
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
        hasMore: false,
      });
      await Promise.all([firstLoad, secondLoad]);

      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    it('uses the current non-append history window when no explicit limit is provided', async () => {
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
        entries: mockSessions,
        offset: 0,
        limit: SESSION_HISTORY_PAGE_LIMIT,
        hasMore: false,
      });

      useSessionStore.getState().setHistoryWindowLimit(SESSION_HISTORY_PAGE_LIMIT);

      await useSessionStore.getState().loadSessions();

      expect(listSessionsSpy).toHaveBeenCalledWith({
        offset: 0,
        limit: SESSION_HISTORY_PAGE_LIMIT,
      });
      expect(useSessionStore.getState().historyWindowLimit).toBe(SESSION_HISTORY_PAGE_LIMIT);
    });

    it('returns bare refreshes to the recent-session window after the current window is collapsed', async () => {
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
        entries: mockSessions,
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
        hasMore: false,
      });

      useSessionStore.getState().setHistoryWindowLimit(SESSION_HISTORY_PAGE_LIMIT);
      useSessionStore.getState().setHistoryWindowLimit(RECENT_SESSION_LIMIT);

      await useSessionStore.getState().loadSessions();

      expect(listSessionsSpy).toHaveBeenCalledWith({
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
      });
      expect(useSessionStore.getState().historyWindowLimit).toBe(RECENT_SESSION_LIMIT);
    });

    it('preserves a larger loaded history window after appending more sessions', async () => {
      const moreSessions: SessionHistoryEntry[] = [
        {
          sessionId: 'session-3',
          displayTitle: 'Test Session 3',
          lastActivityAt: '2024-01-03T00:00:00Z',
        },
      ];
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
        entries: moreSessions,
        offset: 2,
        limit: SESSION_HISTORY_PAGE_LIMIT,
        hasMore: false,
      });

      useSessionStore.getState().setSessions(mockSessions, true, 2);
      useSessionStore.getState().setHistoryWindowLimit(SESSION_HISTORY_PAGE_LIMIT);

      await useSessionStore.getState().loadMoreSessions();

      expect(listSessionsSpy).toHaveBeenCalledWith({
        offset: 2,
        limit: SESSION_HISTORY_PAGE_LIMIT,
      });
      expect(useSessionStore.getState().historyWindowLimit).toBe(SESSION_HISTORY_PAGE_LIMIT);
    });
  });

  describe('renameSession', () => {
    it('updates the loaded entry locally without re-fetching the expanded history window', async () => {
      const renameSessionSpy = vi.spyOn(sessionService, 'renameSession').mockResolvedValue(undefined);
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions');

      useSessionStore.setState({
        sessions: mockSessions,
        historyWindowLimit: 170,
        historyOffset: mockSessions.length,
      });

      await useSessionStore.getState().renameSession('session-1', 'Renamed Session');

      expect(renameSessionSpy).toHaveBeenCalledWith('session-1', 'Renamed Session');
      expect(listSessionsSpy).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions[0]!.displayTitle).toBe('Renamed Session');
      expect(useSessionStore.getState().historyOffset).toBe(mockSessions.length);
    });
  });

  describe('deleteSession', () => {
    it('deletes the session, clears the active id, and removes it locally without a grown-limit refresh', async () => {
      const deleteSessionSpy = vi.spyOn(sessionService, 'deleteSession').mockResolvedValue(undefined);
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions');

      useSessionStore.setState({
        sessions: mockSessions,
        activeSessionId: 'session-1',
        historyWindowLimit: 170,
        historyOffset: mockSessions.length,
        historySearchQuery: { q: 'alarm' },
      });

      await useSessionStore.getState().deleteSession('session-1');

      expect(deleteSessionSpy).toHaveBeenCalledWith('session-1');
      expect(useSessionStore.getState().activeSessionId).toBeNull();
      expect(listSessionsSpy).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions).toEqual([mockSessions[1]!]);
      expect(useSessionStore.getState().historyOffset).toBe(mockSessions.length - 1);
    });

    it('keeps the append offset unchanged when the deleted session is outside the loaded window', async () => {
      const deleteSessionSpy = vi.spyOn(sessionService, 'deleteSession').mockResolvedValue(undefined);
      const listSessionsSpy = vi.spyOn(sessionService, 'listSessions');

      useSessionStore.setState({
        sessions: mockSessions,
        historyWindowLimit: 170,
        historyOffset: mockSessions.length,
      });

      await useSessionStore.getState().deleteSession('session-not-loaded');

      expect(deleteSessionSpy).toHaveBeenCalledWith('session-not-loaded');
      expect(listSessionsSpy).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions).toEqual(mockSessions);
      expect(useSessionStore.getState().historyOffset).toBe(mockSessions.length);
    });
  });
});
