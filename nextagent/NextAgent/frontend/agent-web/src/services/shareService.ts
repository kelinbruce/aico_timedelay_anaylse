import { apiClient } from './apiClient.ts';
import type { SessionConversationMessage } from '../state/contracts.ts';

export type ShareExpiry = '24h' | '7d' | '30d' | 'permanent';

/**
 * Deterministic SHA-256 hash of an ops array.
 *
 * Deduplication + default lexicographic sort make the hash order-independent
 * and duplicate-stable, so the same permission set always yields the same hash
 * regardless of input ordering or repeated entries. The result is a 64-char
 * lowercase hex string.
 */
async function hashOps(ops: readonly string[]): Promise<string> {
  const normalized = [...new Set(ops)].sort();
  const data = new TextEncoder().encode(JSON.stringify(normalized));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CreateShareParams {
  readonly sessionId: string;
  readonly runIds: readonly string[];
  readonly originUrl: string;
  readonly expiresIn: ShareExpiry;
  readonly allowedOps: readonly string[] | null;
  readonly signal?: AbortSignal;
}

export interface ShareResult {
  readonly shareId: string;
  readonly shareUrl: string;
}

export type ShareErrorCode = 'SHARE_NOT_FOUND' | 'SHARE_EXPIRED' | 'SHARE_FORBIDDEN' | 'SHARE_CONTENT_DELETED';

export interface SharedConversationPage {
  readonly sessionId: string;
  readonly messages: readonly SessionConversationMessage[];
  readonly createdAt: number;
}

export interface ShareApiError {
  readonly status: number;
  readonly code: ShareErrorCode;
}

export const shareService = {
  async createShare(params: CreateShareParams): Promise<ShareResult> {
    const allowedOps = params.allowedOps === null ? null : [await hashOps(params.allowedOps)];
    return apiClient.post<ShareResult>(
      `/api/v1/sessions/${encodeURIComponent(params.sessionId)}/shares`,
      {
        runIds: params.runIds,
        originUrl: params.originUrl,
        expiresIn: params.expiresIn,
        allowedOps,
      },
      params.signal ? { signal: params.signal } : undefined,
    );
  },

  async loadSharedConversation(shareId: string, viewerOps?: readonly string[] | null): Promise<SharedConversationPage> {
    const headers: Record<string, string> = {};
    if (viewerOps && viewerOps.length > 0) {
      headers['X-Viewer-Ops'] = JSON.stringify([await hashOps(viewerOps)]);
    }
    return apiClient.get<SharedConversationPage>(`/api/v1/shares/${encodeURIComponent(shareId)}/conversation`, { headers });
  },
};
