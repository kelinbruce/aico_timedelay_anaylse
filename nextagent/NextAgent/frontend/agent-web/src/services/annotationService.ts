import { apiClient } from './apiClient.ts';

export const FAVORITES_UPDATED_EVENT = 'nextagent:favorites-updated';
export const FAVORITE_LIMIT = 100;

export interface AnnotationView {
  readonly annotationId: string;
  readonly sessionId: string;
  readonly requestRunId: string;
  readonly sentiment: 'UP' | 'DOWN' | null;
  readonly isFavorited: boolean;
  readonly isQuestionFavorited: boolean;
  readonly createdAt: number;
}

export interface FavoriteTurnEntry {
  readonly sessionId: string;
  readonly requestRunId: string;
  readonly rootMessageId: string;
  readonly questionPreview: string;
  readonly questionTruncated: boolean;
  readonly sessionTitle?: string;
  readonly sessionUpdatedAt: number;
  readonly favoritedAt: number;
}

export interface FavoriteTurnPage {
  readonly entries: readonly FavoriteTurnEntry[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface FavoriteTurnFilter {
  readonly favoriteType?: 'ANSWER' | 'QUESTION';
  readonly keyword?: string;
  readonly favoritedFrom?: number;
  readonly favoritedTo?: number;
}

export interface UpsertAnnotationParams {
  readonly sessionId: string;
  readonly runId: string;
  readonly sentiment?: 'UP' | 'DOWN' | null;
  readonly isFavorited?: boolean;
  readonly isQuestionFavorited?: boolean;
}

interface AnnotationFallbackView {
  readonly sentiment: null;
  readonly isFavorited: boolean;
  readonly isQuestionFavorited: boolean;
}

function dispatchFavoritesUpdated(sessionId: string, isFavorited: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(FAVORITES_UPDATED_EVENT, {
      detail: {
        sessionId,
        isFavorited,
      },
    }),
  );
}

export const annotationService = {
  async upsertAnnotation(params: UpsertAnnotationParams): Promise<AnnotationView | AnnotationFallbackView> {
    const body: Record<string, unknown> = {};
    if (params.sentiment !== undefined) {
      body.sentiment = params.sentiment;
    }
    if (params.isFavorited !== undefined) {
      body.isFavorited = params.isFavorited;
    }
    if (params.isQuestionFavorited !== undefined) {
      body.isQuestionFavorited = params.isQuestionFavorited;
    }
    const result = await apiClient.post<AnnotationView | AnnotationFallbackView>(
      `/api/v1/sessions/${params.sessionId}/runs/${params.runId}/annotations`,
      body,
    );
    if (params.isFavorited !== undefined) {
      dispatchFavoritesUpdated(params.sessionId, result.isFavorited);
    } else if (params.isQuestionFavorited !== undefined) {
      dispatchFavoritesUpdated(params.sessionId, result.isQuestionFavorited);
    }
    return result;
  },

  async listSessionAnnotations(sessionId: string): Promise<readonly AnnotationView[]> {
    const result = await apiClient.get<{ annotations: readonly AnnotationView[] }>(`/api/v1/sessions/${sessionId}/annotations`);
    return result.annotations;
  },

  async listFavoriteTurns(offset = 0, limit = 50, filter?: FavoriteTurnFilter): Promise<FavoriteTurnPage> {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (filter?.favoriteType !== undefined) {
      query.set('favoriteType', filter.favoriteType);
    }
    if (filter?.keyword !== undefined) {
      query.set('keyword', filter.keyword);
    }
    if (filter?.favoritedFrom !== undefined) {
      query.set('favoritedFrom', String(filter.favoritedFrom));
    }
    if (filter?.favoritedTo !== undefined) {
      query.set('favoritedTo', String(filter.favoritedTo));
    }
    return apiClient.get(`/api/v1/favorites?${query.toString()}`);
  },
};
