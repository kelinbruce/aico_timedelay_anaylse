import { apiClient } from './apiClient.ts';
import type {
  BatchCreateLongTermMemoryReq,
  BatchCreateLongTermMemoryResult,
  CopyLongTermMemoryReq,
  CopyPublishedMemoryResp,
  DeleteLongTermMemoryResp,
  ListLongTermMemoryParams,
  ListSharedMemoryParams,
  LongTermMemoryRecord,
  LongTermMemorySummaryPage,
  ManualSaveLongTermMemoryReq,
  MemoryOwnerScope,
  PatchLongTermMemoryReq,
  PublishLongTermMemoryResp,
  SharingLongTermMemoryReq,
  SharedMemorySummaryPage,
  UnpublishLongTermMemoryResp,
  VersionedUpdateResult,
} from '../state/contracts.ts';

const BASE = '/api/v1/memory/long-term-mem';

interface RestResponse<T> {
  readonly errorCode: number;
  readonly errorMsg: string;
  readonly data: T;
}

export interface MemoryTabTotals {
  readonly mine?: number;
  readonly shared?: number;
  readonly archived?: number;
}

async function unwrap<T>(promise: Promise<RestResponse<T>>): Promise<T> {
  const resp = await promise;
  if (!resp || typeof resp !== 'object') {
    throw new Error('Memory API returned an invalid response.');
  }
  if (resp.errorCode !== 0) {
    throw new Error(resp.errorMsg || `Memory API error (code ${resp.errorCode})`);
  }
  return resp.data;
}

function isValidBatchResult(result: BatchCreateLongTermMemoryResult, expectedItems: number): boolean {
  return (
    Number.isInteger(result?.successCount) &&
    result.successCount >= 0 &&
    Number.isInteger(result.failCount) &&
    result.failCount >= 0 &&
    result.successCount + result.failCount === expectedItems &&
    Array.isArray(result.memoryIds) &&
    result.memoryIds.length === result.successCount &&
    result.memoryIds.every((memoryId) => typeof memoryId === 'string' && memoryId.length > 0)
  );
}

function scopeQuery(scope: MemoryOwnerScope): Record<string, string> {
  return {
    ...(scope.memoryInstance ? { memoryInstance: scope.memoryInstance } : {}),
  };
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) {
    return '';
  }
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const memoryService = {
  async getLongTermMemoryTabTotals(scope: MemoryOwnerScope): Promise<MemoryTabTotals> {
    const [mine, shared, archived] = await Promise.allSettled([
      unwrap(
        apiClient.get<RestResponse<LongTermMemorySummaryPage>>(BASE + buildQuery({ ...scopeQuery(scope), state: 'ACTIVE', limit: 1, offset: 0 })),
      ),
      unwrap(
        apiClient.get<RestResponse<SharedMemorySummaryPage>>(
          `${BASE}/shared` + buildQuery({ memoryInstance: scope.memoryInstance, limit: 1, offset: 0 }),
        ),
      ),
      unwrap(
        apiClient.get<RestResponse<LongTermMemorySummaryPage>>(BASE + buildQuery({ ...scopeQuery(scope), state: 'ARCHIVED', limit: 1, offset: 0 })),
      ),
    ]);
    return {
      ...(mine.status === 'fulfilled' ? { mine: mine.value.total } : {}),
      ...(shared.status === 'fulfilled' ? { shared: shared.value.total } : {}),
      ...(archived.status === 'fulfilled' ? { archived: archived.value.total } : {}),
    };
  },

  listLongTermMemory(params: ListLongTermMemoryParams): Promise<LongTermMemorySummaryPage> {
    return unwrap(
      apiClient.get<RestResponse<LongTermMemorySummaryPage>>(
        BASE +
          buildQuery({
            ...scopeQuery(params),
            queryText: params.queryText,
            memoryType: params.memoryType,
            knowledgeSourceType: params.knowledgeSourceType,
            state: params.state,
            isPinned: params.isPinned,
            sinceTime: params.sinceTime,
            untilTime: params.untilTime,
            maxLastAccessedAt: params.maxLastAccessedAt,
            labels: params.labels,
            limit: params.limit,
            offset: params.offset,
          }),
      ),
    );
  },

  getLongTermMemory(memoryId: string, scope: MemoryOwnerScope): Promise<LongTermMemoryRecord> {
    return unwrap(
      apiClient.get<RestResponse<LongTermMemoryRecord>>(`${BASE}/${encodeURIComponent(memoryId)}/record` + buildQuery(scopeQuery(scope))),
    );
  },

  manualSaveLongTermMemory(req: ManualSaveLongTermMemoryReq): Promise<LongTermMemoryRecord> {
    return unwrap(apiClient.post<RestResponse<LongTermMemoryRecord>>(`${BASE}/manual`, req));
  },

  async batchCreateLongTermMemory(req: BatchCreateLongTermMemoryReq): Promise<BatchCreateLongTermMemoryResult> {
    const result = await unwrap(apiClient.post<RestResponse<BatchCreateLongTermMemoryResult>>(`${BASE}/batch`, req));
    if (!isValidBatchResult(result, req.items.length)) {
      throw new Error('Memory batch API returned an invalid response.');
    }
    return result;
  },

  deleteLongTermMemory(memoryId: string, scope: MemoryOwnerScope, reasonCode?: string): Promise<DeleteLongTermMemoryResp> {
    return unwrap(
      apiClient.delete<RestResponse<DeleteLongTermMemoryResp>>(
        `${BASE}/${encodeURIComponent(memoryId)}` + buildQuery({ ...scopeQuery(scope), reasonCode }),
      ),
    );
  },

  patchLongTermMemory(memoryId: string, req: PatchLongTermMemoryReq): Promise<VersionedUpdateResult> {
    return unwrap(apiClient.patch<RestResponse<VersionedUpdateResult>>(`${BASE}/${encodeURIComponent(memoryId)}`, req));
  },

  listPublishedLongTermMemory(params: ListSharedMemoryParams): Promise<SharedMemorySummaryPage> {
    return unwrap(
      apiClient.get<RestResponse<SharedMemorySummaryPage>>(
        `${BASE}/shared` +
          buildQuery({
            memoryInstance: params.memoryInstance,
            queryText: params.queryText,
            memoryType: params.memoryType,
            knowledgeSourceType: params.knowledgeSourceType,
            labels: params.labels,
            limit: params.limit,
            offset: params.offset,
          }),
      ),
    );
  },

  publishLongTermMemory(memoryId: string, req: SharingLongTermMemoryReq): Promise<PublishLongTermMemoryResp> {
    return unwrap(apiClient.post<RestResponse<PublishLongTermMemoryResp>>(`${BASE}/${encodeURIComponent(memoryId)}/publish`, req));
  },

  unpublishLongTermMemory(memoryId: string, req: SharingLongTermMemoryReq): Promise<UnpublishLongTermMemoryResp> {
    return unwrap(apiClient.post<RestResponse<UnpublishLongTermMemoryResp>>(`${BASE}/${encodeURIComponent(memoryId)}/unpublish`, req));
  },

  copyPublishedMemory(req: CopyLongTermMemoryReq): Promise<CopyPublishedMemoryResp> {
    return unwrap(apiClient.post<RestResponse<CopyPublishedMemoryResp>>(`${BASE}/shared/copy`, req));
  },
};
