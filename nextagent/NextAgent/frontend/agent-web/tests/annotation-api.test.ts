import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FAVORITES_UPDATED_EVENT, annotationService } from '../src/services/annotationService.ts';

describe('annotationService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('upsertAnnotation', () => {
    it('posts sentiment to the annotation upsert endpoint', async () => {
      const mockView = {
        annotationId: 'annotation-1',
        sessionId: 'sess-1',
        requestRunId: 'run-1',
        sentiment: 'UP' as const,
        isFavorited: false,
        createdAt: 1000,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockView),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await annotationService.upsertAnnotation({
        sessionId: 'sess-1',
        runId: 'run-1',
        sentiment: 'UP',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/runs/run-1/annotations'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sentiment: 'UP' }),
        }),
      );
      expect(result).toEqual(mockView);
    });

    it('posts isFavorited to the annotation upsert endpoint', async () => {
      const mockView = {
        annotationId: 'annotation-1',
        sessionId: 'sess-1',
        requestRunId: 'run-1',
        sentiment: null,
        isFavorited: true,
        createdAt: 1000,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockView),
      });
      vi.stubGlobal('fetch', fetchMock);

      await annotationService.upsertAnnotation({
        sessionId: 'sess-1',
        runId: 'run-1',
        isFavorited: true,
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init?.body).toBe(JSON.stringify({ isFavorited: true }));
    });

    it('dispatches a favorites update event when isFavorited changes', async () => {
      const mockView = {
        annotationId: 'annotation-1',
        sessionId: 'sess-1',
        requestRunId: 'run-1',
        sentiment: null,
        isFavorited: true,
        createdAt: 1000,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockView),
      });
      const eventHandler = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      window.addEventListener(FAVORITES_UPDATED_EVENT, eventHandler);

      await annotationService.upsertAnnotation({
        sessionId: 'sess-1',
        runId: 'run-1',
        isFavorited: true,
      });

      expect(eventHandler).toHaveBeenCalledTimes(1);
      const event = eventHandler.mock.calls[0]?.[0] as CustomEvent<{ readonly sessionId: string; readonly isFavorited: boolean }>;
      expect(event.detail).toEqual({ sessionId: 'sess-1', isFavorited: true });
      window.removeEventListener(FAVORITES_UPDATED_EVENT, eventHandler);
    });

    it('dispatches the persisted question favorite state returned by the server', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            annotationId: 'annotation-1',
            sessionId: 'sess-1',
            requestRunId: 'run-1',
            sentiment: null,
            isFavorited: false,
            isQuestionFavorited: true,
            createdAt: 1000,
          }),
      });
      const eventHandler = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      window.addEventListener(FAVORITES_UPDATED_EVENT, eventHandler);

      await annotationService.upsertAnnotation({
        sessionId: 'sess-1',
        runId: 'run-1',
        isQuestionFavorited: false,
      });

      const event = eventHandler.mock.calls[0]?.[0] as CustomEvent<{ readonly sessionId: string; readonly isFavorited: boolean }>;
      expect(event.detail).toEqual({ sessionId: 'sess-1', isFavorited: true });
      window.removeEventListener(FAVORITES_UPDATED_EVENT, eventHandler);
    });

    it('posts null sentiment to toggle off', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sentiment: null, isFavorited: false }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await annotationService.upsertAnnotation({
        sessionId: 'sess-1',
        runId: 'run-1',
        sentiment: null,
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init?.body).toBe(JSON.stringify({ sentiment: null }));
    });

    it('sends empty body when no fields are provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sentiment: null, isFavorited: false }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await annotationService.upsertAnnotation({
        sessionId: 'sess-1',
        runId: 'run-1',
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init?.body).toBe(JSON.stringify({}));
    });
  });

  describe('listSessionAnnotations', () => {
    it('calls GET and unwraps the annotations array', async () => {
      const mockAnnotations = [
        {
          annotationId: 'annotation-1',
          sessionId: 'sess-1',
          requestRunId: 'run-1',
          sentiment: 'UP' as const,
          isFavorited: false,
          createdAt: 1000,
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ annotations: mockAnnotations }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await annotationService.listSessionAnnotations('sess-1');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/annotations'),
        expect.objectContaining({
          credentials: 'include',
          headers: {},
        }),
      );
      expect(result).toEqual(mockAnnotations);
    });

    it('returns empty array when response has no annotations', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ annotations: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await annotationService.listSessionAnnotations('sess-1');

      expect(result).toEqual([]);
    });
  });

  describe('listFavoriteTurns', () => {
    it('calls GET /api/v1/favorites with offset and limit', async () => {
      const mockPage = {
        entries: [
          {
            sessionId: 'sess-1',
            requestRunId: 'run-1',
            rootMessageId: 'msg-1',
            questionPreview: 'My question',
            questionTruncated: false,
            sessionTitle: 'My Session',
            sessionUpdatedAt: 2000,
            favoritedAt: 2000,
          },
        ],
        offset: 0,
        limit: 50,
        hasMore: false,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPage),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await annotationService.listFavoriteTurns(0, 50);

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/api/v1/favorites');
      expect(calledUrl).toContain('offset=0');
      expect(calledUrl).toContain('limit=50');
      expect(result).toEqual(mockPage);
    });

    it('uses default offset and limit when not provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: [], offset: 0, limit: 50, hasMore: false }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await annotationService.listFavoriteTurns();

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('offset=0');
      expect(calledUrl).toContain('limit=50');
    });

    it('sends keyword and favorite time filters to the favorites API', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: [], offset: 20, limit: 10, hasMore: false }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await annotationService.listFavoriteTurns(20, 10, {
        favoriteType: 'QUESTION',
        keyword: 'ABCF 接通率',
        favoritedFrom: 1_754_000_000_000,
        favoritedTo: 1_754_086_399_999,
      });

      const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string, 'http://nextagent.test');
      expect(calledUrl.pathname).toBe('/api/v1/favorites');
      expect(Object.fromEntries(calledUrl.searchParams)).toEqual({
        offset: '20',
        limit: '10',
        favoriteType: 'QUESTION',
        keyword: 'ABCF 接通率',
        favoritedFrom: '1754000000000',
        favoritedTo: '1754086399999',
      });
    });
  });
});
