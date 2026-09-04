import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sessionService } from '../src/services/sessionService.ts';
import type { SessionHistoryPage, SessionConversationPage } from '../src/state/contracts.ts';

describe('sessionService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('listSessions', () => {
    it('should call GET /api/v1/sessions with correct query params', async () => {
      const mockPage: SessionHistoryPage = {
        entries: [],
        offset: 0,
        limit: 50,
        hasMore: false,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPage),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.listSessions({
        offset: 0,
        limit: 50,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions?'),
        expect.objectContaining({
          headers: {},
        }),
      );
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).not.toContain('subjectId=');
      expect(calledUrl).toContain('offset=0');
      expect(calledUrl).toContain('limit=50');
      expect(calledUrl).not.toContain('includeSuperseded=');
    });

    it('caps a non-search list limit at the maximum supported by remote memory backends', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [],
            offset: 0,
            limit: 100,
            hasMore: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.listSessions({
        offset: 0,
        limit: 170,
      });

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('limit=100');
      expect(calledUrl).not.toContain('limit=170');
    });

    it('caps a keyword-search list limit at the search maximum', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [],
            offset: 0,
            limit: 50,
            hasMore: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.listSessions({
        offset: 0,
        limit: 170,
        q: 'alarm',
      });

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('limit=50');
      expect(calledUrl).not.toContain('limit=170');
    });

    it('caps a created-range search list limit at the search maximum', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [],
            offset: 0,
            limit: 50,
            hasMore: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.listSessions({
        offset: 0,
        limit: 170,
        createdFrom: 1,
        createdTo: 2,
      });

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('limit=50');
      expect(calledUrl).not.toContain('limit=170');
    });

    it('keeps an in-range list limit unchanged', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [],
            offset: 20,
            limit: 20,
            hasMore: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.listSessions({
        offset: 20,
        limit: 20,
      });

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('limit=20');
    });

    it('should return session history page', async () => {
      const mockPage: SessionHistoryPage = {
        entries: [
          {
            sessionId: 'sess-1',
            displayTitle: 'Test Session',
            lastActivityAt: '2024-01-01T00:00:00Z',
          },
        ],
        offset: 0,
        limit: 50,
        hasMore: false,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockPage),
        }),
      );

      const result = await sessionService.listSessions({
        offset: 0,
        limit: 50,
      });

      expect(result).toEqual(mockPage);
    });
  });

  describe('loadConversation', () => {
    it('should call GET /api/v1/sessions/{id}/conversation with correct query params', async () => {
      const mockPage: SessionConversationPage = {
        sessionId: 'sess-1',
        items: [],
        nextCursor: null,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPage),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.loadConversation({
        sessionId: 'sess-1',
        limit: 120,
        includeCapabilityResults: true,
      });

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/api/v1/sessions/sess-1/conversation?');
      expect(calledUrl).not.toContain('subjectId=');
      expect(calledUrl).toContain('limit=120');
      expect(calledUrl).toContain('includeCapabilityResults=true');
      expect(calledUrl).not.toContain('includeHidden=');
    });

    it('should pass the conversation load abort signal to fetch', async () => {
      const mockPage: SessionConversationPage = {
        sessionId: 'sess-1',
        items: [],
        nextCursor: null,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPage),
      });
      vi.stubGlobal('fetch', fetchMock);
      const abortController = new AbortController();

      await sessionService.loadConversation({
        sessionId: 'sess-1',
        limit: 120,
        includeCapabilityResults: true,
        signal: abortController.signal,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/conversation?'),
        expect.objectContaining({
          signal: abortController.signal,
        }),
      );
    });

    it('should return conversation page', async () => {
      const mockPage: SessionConversationPage = {
        sessionId: 'sess-1',
        items: [],
        nextCursor: null,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockPage),
        }),
      );

      const result = await sessionService.loadConversation({
        sessionId: 'sess-1',
        limit: 120,
        includeCapabilityResults: true,
      });

      expect(result).toEqual(mockPage);
    });
  });

  describe('loadRunEvents', () => {
    const validEnvelope = {
      eventId: 'event-1',
      sessionId: 'session/1',
      requestId: 'request-1',
      runId: 'run/1',
      requestContextId: 'context-1',
      sequence: 7,
      eventType: 'REQUEST_COMPLETED',
      timelineEventRef: 'timeline-1',
      transportHints: ['history-load'],
      payload: { agentResponseRef: 'message-2', rootMessageId: 'message-1' },
      createdAt: '2026-07-22T00:00:00.000Z',
    } as const;

    it('requests one encoded run event page with the fixed page size and abort signal', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            availability: 'AVAILABLE',
            events: [validEnvelope],
            nextAfterSequence: 7,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const abortController = new AbortController();

      const query = {
        sessionId: 'session/1',
        runId: 'run/1',
        afterSequence: 3,
        limit: 1000,
        signal: abortController.signal,
        tenantId: 'untrusted-tenant',
        subjectId: 'untrusted-subject',
      } as const;

      await sessionService.loadRunEvents(query);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/session%2F1/runs/run%2F1/events?afterSequence=3&limit=1000'),
        expect.objectContaining({ signal: abortController.signal }),
      );
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).not.toContain('tenantId=');
      expect(calledUrl).not.toContain('subjectId=');
    });

    it('returns a validated AVAILABLE page', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              availability: 'AVAILABLE',
              events: [validEnvelope],
            }),
        }),
      );

      const page = await sessionService.loadRunEvents({
        sessionId: 'session-1',
        runId: 'run-1',
        afterSequence: 0,
        limit: 1000,
      });
      expect(page.availability).toBe('AVAILABLE');
      expect(page.events[0]).toMatchObject({
        eventId: validEnvelope.eventId,
        sessionId: validEnvelope.sessionId,
        requestId: validEnvelope.requestId,
        runId: validEnvelope.runId,
        rootMessageId: 'message-1',
        requestContextId: validEnvelope.requestContextId,
      });
      expect(page.events[0]?.payload).toMatchObject(validEnvelope.payload);
    });

    it('returns a validated legacy-unavailable page', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
              events: [],
            }),
        }),
      );

      await expect(
        sessionService.loadRunEvents({
          sessionId: 'session-1',
          runId: 'run-1',
          afterSequence: 0,
          limit: 1000,
        }),
      ).resolves.toEqual({
        availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
        events: [],
      });
    });

    it.each([
      ['unknown availability', { availability: 'UNKNOWN', events: [] }],
      ['missing events', { availability: 'AVAILABLE', items: [] }],
      ['unknown field', { availability: 'AVAILABLE', events: [], rawTimeline: [] }],
      ['non-array events', { availability: 'AVAILABLE', events: {} }],
      ['invalid envelope', { availability: 'AVAILABLE', events: [{ ...validEnvelope, eventId: 42 }] }],
      ['zero cursor', { availability: 'AVAILABLE', events: [], nextAfterSequence: 0 }],
      ['fractional cursor', { availability: 'AVAILABLE', events: [], nextAfterSequence: 1.5 }],
      ['legacy items', { availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [validEnvelope] }],
      ['legacy cursor', { availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [], nextAfterSequence: 7 }],
    ])('rejects an invalid event page: %s', async (_label, responseBody) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(responseBody),
        }),
      );

      await expect(
        sessionService.loadRunEvents({
          sessionId: 'session-1',
          runId: 'run-1',
          afterSequence: 0,
          limit: 1000,
        }),
      ).rejects.toThrow();
    });
  });

  describe('createSession', () => {
    it('should call POST /api/v1/sessions without internal idempotency metadata', async () => {
      const mockResponse = {
        sessionId: 'new-sess-id',
        displayTitle: '新会话',
        lastActivityAt: Date.parse('2026-05-30T00:00:00Z'),
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.createSession({
        locale: 'zh-CN',
        idempotencyKey: 'session-key',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locale: 'zh-CN',
          }),
        }),
      );
    });

    it('should return the public session create response', async () => {
      const mockResponse = {
        sessionId: 'new-sess-id',
        displayTitle: '新会话',
        lastActivityAt: Date.parse('2026-05-30T00:00:00Z'),
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        }),
      );

      const result = await sessionService.createSession({
        locale: 'zh-CN',
      });

      expect(result).toEqual({
        sessionId: 'new-sess-id',
        displayTitle: '新会话',
        lastActivityAt: Date.parse('2026-05-30T00:00:00Z'),
      });
    });
  });

  describe('forkSessionFromMessage', () => {
    it('should call the fork endpoint with only the idempotency key', async () => {
      const mockResponse = {
        sessionId: 'child-sess-id',
        displayTitle: 'Forked Session',
        lastActivityAt: Date.parse('2026-05-30T00:00:00Z'),
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.forkSessionFromMessage({
        sessionId: 'source/session',
        messageId: 'assistant/message',
        idempotencyKey: 'fork-key',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/source%2Fsession/messages/assistant%2Fmessage/fork'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: 'fork-key' }),
        }),
      );
    });
  });

  describe('forkSessionFromRequest', () => {
    it('should call the request fork endpoint with only the idempotency key', async () => {
      const mockResponse = {
        sessionId: 'child-sess-id',
        displayTitle: 'Forked Session',
        lastActivityAt: Date.parse('2026-05-30T00:00:00Z'),
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.forkSessionFromRequest({
        sessionId: 'source/session',
        requestId: 'root/request',
        idempotencyKey: 'fork-key',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/source%2Fsession/requests/root%2Frequest/fork'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: 'fork-key' }),
        }),
      );
    });
  });

  describe('renameSession', () => {
    it('should call PUT /api/v1/sessions/{id}/title with title body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.renameSession('sess-1', 'New Title');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/title'),
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Title' }),
        }),
      );
    });
  });

  describe('deleteSession', () => {
    it('should call DELETE /api/v1/sessions/{id} without a body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      });
      vi.stubGlobal('fetch', fetchMock);

      await sessionService.deleteSession('sess-1');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1'),
        expect.objectContaining({
          method: 'DELETE',
          headers: {},
        }),
      );
      expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
    });
  });
});
