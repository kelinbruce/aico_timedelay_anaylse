import type { AgentId, SafeError, SubjectId, TenantId } from '@nextagent/agent-common';
import type {
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemoryStoreGateway,
  LongTermMemorySummary,
  SearchItem,
} from '@nextagent/agent-contracts/gateway';

const l1Limit = 10;
const l1MinConfidence = 0.3;
const l2Concurrency = 3;
const characteristicsLimit = 10;

export interface UserQueryMemoryRecallRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly queryText: string;
}

export type UserQueryMemoryRecallResult =
  | {
      readonly status: 'SUCCESS';
      readonly l1Items: readonly SearchItem[];
      readonly l2Details: readonly LongTermMemoryRecord[];
    }
  | {
      readonly status: 'NO_CONTEXT';
      readonly reason: 'NO_MATCH' | 'L1_SEARCH_FAILED' | 'L1_SEARCH_CANCELED' | 'L2_DETAIL_FAILED' | 'L2_DETAIL_CANCELED';
      readonly candidateCount: number;
      readonly detailCount: 0;
    };

export type UserCharacteristicsRecallResult =
  | {
      readonly status: 'SUCCESS';
      readonly items: readonly LongTermMemorySummary[];
    }
  | {
      readonly status: 'NO_CONTEXT';
      readonly reason: 'NO_CHARACTERISTICS' | 'CHARACTERISTICS_LIST_FAILED' | 'CHARACTERISTICS_LIST_CANCELED';
      readonly itemCount: 0;
    };

export interface UserQueryMemoryRecallService {
  recall: (request: UserQueryMemoryRecallRequest, signal: AbortSignal) => Promise<UserQueryMemoryRecallResult>;
  recallUserCharacteristics: (request: UserQueryMemoryRecallRequest, signal: AbortSignal) => Promise<UserCharacteristicsRecallResult>;
}

export function createUserQueryMemoryRecallService(dependencies: {
  readonly retriever: LongTermMemoryRetrieverGateway;
  readonly store?: Pick<LongTermMemoryStoreGateway, 'listLongTermMemory'>;
}): UserQueryMemoryRecallService {
  return {
    async recall(request, signal): Promise<UserQueryMemoryRecallResult> {
      if (signal.aborted) {
        return noContext('L1_SEARCH_CANCELED');
      }

      let page: Awaited<ReturnType<LongTermMemoryRetrieverGateway['searchLongTermMemory']>>;
      try {
        page = await dependencies.retriever.searchLongTermMemory({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          queryText: request.queryText,
          minConfidence: l1MinConfidence,
          limit: l1Limit,
          offset: 0,
        });
      } catch {
        return noContext(signal.aborted ? 'L1_SEARCH_CANCELED' : 'L1_SEARCH_FAILED');
      }

      if (signal.aborted) {
        return noContext('L1_SEARCH_CANCELED');
      }
      if (isSafeError(page)) {
        return noContext('L1_SEARCH_FAILED');
      }
      if (page.items.length === 0) {
        return noContext('NO_MATCH');
      }

      const batch = await readAllDetails(dependencies.retriever, request, page.items, signal);
      if (batch.status !== 'SUCCESS') {
        return { ...batch, candidateCount: page.items.length, detailCount: 0 };
      }
      return {
        status: 'SUCCESS',
        l1Items: page.items,
        l2Details: batch.details,
      };
    },

    async recallUserCharacteristics(request, signal): Promise<UserCharacteristicsRecallResult> {
      const store = dependencies.store;
      if (store === undefined) {
        return noCharacteristics('CHARACTERISTICS_LIST_FAILED');
      }
      if (signal.aborted) {
        return noCharacteristics('CHARACTERISTICS_LIST_CANCELED');
      }
      let page: Awaited<ReturnType<LongTermMemoryStoreGateway['listLongTermMemory']>>;
      try {
        page = await store.listLongTermMemory({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          memoryType: 'USER_CHARACTERISTICS',
          state: 'ACTIVE',
          limit: characteristicsLimit,
          offset: 0,
        });
      } catch {
        return noCharacteristics(signal.aborted ? 'CHARACTERISTICS_LIST_CANCELED' : 'CHARACTERISTICS_LIST_FAILED');
      }
      if (signal.aborted) {
        return noCharacteristics('CHARACTERISTICS_LIST_CANCELED');
      }
      if (isSafeError(page)) {
        return noCharacteristics('CHARACTERISTICS_LIST_FAILED');
      }
      if (page.items.length === 0) {
        return noCharacteristics('NO_CHARACTERISTICS');
      }
      return { status: 'SUCCESS', items: page.items };
    },
  };
}

function noCharacteristics(
  reason: Extract<UserCharacteristicsRecallResult, { readonly status: 'NO_CONTEXT' }>['reason'],
): Extract<UserCharacteristicsRecallResult, { readonly status: 'NO_CONTEXT' }> {
  return { status: 'NO_CONTEXT', reason, itemCount: 0 };
}

async function readAllDetails(
  retriever: LongTermMemoryRetrieverGateway,
  request: UserQueryMemoryRecallRequest,
  items: readonly SearchItem[],
  signal: AbortSignal,
): Promise<
  | { readonly status: 'SUCCESS'; readonly details: readonly LongTermMemoryRecord[] }
  | Extract<UserQueryMemoryRecallResult, { readonly status: 'NO_CONTEXT' }>
> {
  const details = new Array<LongTermMemoryRecord>(items.length);
  let nextIndex = 0;
  let failed = false;
  let canceled = signal.aborted;
  const onAbort = (): void => {
    canceled = true;
  };
  signal.addEventListener('abort', onAbort, { once: true });

  const worker = async (): Promise<void> => {
    while (!failed && !canceled) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      try {
        const detail = await retriever.getLongTermMemoryDetail({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          memoryId: item.summary.memoryId,
        });
        if (canceled) {
          return;
        }
        if (isSafeError(detail) || !isExpectedDetail(detail, item, request)) {
          failed = true;
          return;
        }
        details[index] = detail;
      } catch {
        failed = true;
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(l2Concurrency, items.length) }, () => worker()));
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  if (canceled) {
    return noContext('L2_DETAIL_CANCELED');
  }
  if (failed || details.some((detail) => detail === undefined)) {
    return noContext('L2_DETAIL_FAILED');
  }
  return { status: 'SUCCESS', details };
}

function isExpectedDetail(detail: LongTermMemoryRecord, item: SearchItem, request: UserQueryMemoryRecallRequest): boolean {
  return (
    detail.tenantId === request.tenantId &&
    detail.subjectId === request.subjectId &&
    detail.agentId === request.agentId &&
    detail.memoryId === item.summary.memoryId &&
    detail.state === 'ACTIVE'
  );
}

function noContext(
  reason: Extract<UserQueryMemoryRecallResult, { readonly status: 'NO_CONTEXT' }>['reason'],
): Extract<UserQueryMemoryRecallResult, { readonly status: 'NO_CONTEXT' }> {
  return { status: 'NO_CONTEXT', reason, candidateCount: 0, detailCount: 0 };
}

function isSafeError(value: unknown): value is SafeError {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { readonly code?: unknown }).code === 'string' &&
    typeof (value as { readonly category?: unknown }).category === 'string'
  );
}
