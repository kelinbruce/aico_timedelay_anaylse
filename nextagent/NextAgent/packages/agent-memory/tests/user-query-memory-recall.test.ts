import { brand, type AgentId, type EpochMillis, type LongTermMemoryId, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type {
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemoryStoreGateway,
  LongTermMemorySummary,
  SearchItem,
  SearchItemPage,
} from '@nextagent/agent-contracts/gateway';
import { createUserQueryMemoryRecallService } from '../src/user-query-memory-recall.js';
import { describe, expect, it, vi } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-recall');
const subjectId = brand<string, 'SubjectId'>('subject-recall');
const agentId = brand<string, 'AgentId'>('agent-recall');

describe('user query memory recall', () => {
  it('uses one broad L1 query and reads every candidate detail in ranked order', async () => {
    const items = [searchItem('memory-1', 0.9), searchItem('memory-2', 0.8)];
    const retriever = fakeRetriever(items);
    const service = createUserQueryMemoryRecallService({ retriever });

    const result = await service.recall({ tenantId, subjectId, agentId, queryText: '基站告警阈值' }, new AbortController().signal);

    expect(retriever.searchLongTermMemory).toHaveBeenCalledTimes(1);
    expect(retriever.searchLongTermMemory).toHaveBeenCalledWith({
      tenantId,
      subjectId,
      agentId,
      queryText: '基站告警阈值',
      minConfidence: 0.3,
      limit: 10,
      offset: 0,
    });
    expect(retriever.getLongTermMemoryDetail).toHaveBeenCalledTimes(2);
    expect(retriever.getLongTermMemoryDetail.mock.calls.map(([request]) => request)).toEqual([
      { tenantId, subjectId, agentId, memoryId: items[0]!.summary.memoryId },
      { tenantId, subjectId, agentId, memoryId: items[1]!.summary.memoryId },
    ]);
    expect(result).toMatchObject({ status: 'SUCCESS', l1Items: items });
    expect(result.status === 'SUCCESS' ? result.l2Details.map((detail) => detail.memoryId) : []).toEqual([
      items[0]!.summary.memoryId,
      items[1]!.summary.memoryId,
    ]);
  });

  it('limits L2 reads to three concurrent calls', async () => {
    const items = Array.from({ length: 8 }, (_, index) => searchItem(`memory-${index}`, 1 - index / 10));
    let active = 0;
    let maxActive = 0;
    const retriever = fakeRetriever(items);
    retriever.getLongTermMemoryDetail.mockImplementation(async (request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return memoryRecord(String(request.memoryId));
    });

    const result = await createUserQueryMemoryRecallService({ retriever }).recall(
      { tenantId, subjectId, agentId, queryText: '容量规划' },
      new AbortController().signal,
    );

    expect(result.status).toBe('SUCCESS');
    expect(maxActive).toBe(3);
    expect(retriever.getLongTermMemoryDetail).toHaveBeenCalledTimes(8);
  });

  it('does not read L2 when L1 has no matches', async () => {
    const retriever = fakeRetriever([]);

    const result = await createUserQueryMemoryRecallService({ retriever }).recall(
      { tenantId, subjectId, agentId, queryText: '不存在的配置' },
      new AbortController().signal,
    );

    expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'NO_MATCH', candidateCount: 0, detailCount: 0 });
    expect(retriever.getLongTermMemoryDetail).not.toHaveBeenCalled();
  });

  it('stops dispatching after one L2 failure and returns no partial details', async () => {
    const items = Array.from({ length: 8 }, (_, index) => searchItem(`memory-${index}`, 1 - index / 10));
    const retriever = fakeRetriever(items);
    retriever.getLongTermMemoryDetail.mockImplementation(async (request) => {
      if (String(request.memoryId) === 'memory-0') {
        throw new Error('detail unavailable');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return memoryRecord(String(request.memoryId));
    });

    const result = await createUserQueryMemoryRecallService({ retriever }).recall(
      { tenantId, subjectId, agentId, queryText: '故障历史' },
      new AbortController().signal,
    );

    expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'L2_DETAIL_FAILED', candidateCount: 8, detailCount: 0 });
    expect(retriever.getLongTermMemoryDetail.mock.calls.length).toBeLessThanOrEqual(3);
    expect(new Set(retriever.getLongTermMemoryDetail.mock.calls.map(([request]) => request.memoryId)).size).toBe(
      retriever.getLongTermMemoryDetail.mock.calls.length,
    );
  });

  it('stops dispatching and ignores completed details after parent cancellation', async () => {
    const items = Array.from({ length: 8 }, (_, index) => searchItem(`memory-${index}`, 1 - index / 10));
    const controller = new AbortController();
    const retriever = fakeRetriever(items);
    retriever.getLongTermMemoryDetail.mockImplementation(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return memoryRecord(String(request.memoryId));
    });
    const recall = createUserQueryMemoryRecallService({ retriever }).recall(
      { tenantId, subjectId, agentId, queryText: '取消查询' },
      controller.signal,
    );

    controller.abort();
    const result = await recall;

    expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'L1_SEARCH_CANCELED', candidateCount: 0, detailCount: 0 });
    expect(retriever.getLongTermMemoryDetail.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('reports L2 cancellation after a successful L1 query', async () => {
    const controller = new AbortController();
    const retriever = fakeRetriever([searchItem('memory-1', 0.9)]);
    let signalL2Started!: () => void;
    const l2Started = new Promise<void>((resolve) => {
      signalL2Started = resolve;
    });
    retriever.getLongTermMemoryDetail.mockImplementation(async (request) => {
      signalL2Started();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return memoryRecord(String(request.memoryId));
    });

    const recall = createUserQueryMemoryRecallService({ retriever }).recall(
      { tenantId, subjectId, agentId, queryText: 'cancel detail read' },
      controller.signal,
    );
    await l2Started;
    controller.abort();

    await expect(recall).resolves.toEqual({
      status: 'NO_CONTEXT',
      reason: 'L2_DETAIL_CANCELED',
      candidateCount: 1,
      detailCount: 0,
    });
  });

  it('reports an L1 failure without starting L2', async () => {
    const retriever = fakeRetriever([searchItem('memory-1', 0.9)]);
    retriever.searchLongTermMemory.mockRejectedValue(new Error('search unavailable'));

    const result = await createUserQueryMemoryRecallService({ retriever }).recall(
      { tenantId, subjectId, agentId, queryText: 'search failure' },
      new AbortController().signal,
    );

    expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'L1_SEARCH_FAILED', candidateCount: 0, detailCount: 0 });
    expect(retriever.getLongTermMemoryDetail).not.toHaveBeenCalled();
  });

  describe('recallUserCharacteristics', () => {
    it('lists active USER_CHARACTERISTICS entries via the store', async () => {
      const traits = [characteristicsSummary('trait-1'), characteristicsSummary('trait-2')];
      const store = fakeStore(traits);
      const service = createUserQueryMemoryRecallService({ retriever: fakeRetriever([]), store });

      const result = await service.recallUserCharacteristics({ tenantId, subjectId, agentId, queryText: '基站告警' }, new AbortController().signal);

      expect(store.listLongTermMemory).toHaveBeenCalledTimes(1);
      expect(store.listLongTermMemory).toHaveBeenCalledWith({
        tenantId,
        subjectId,
        agentId,
        memoryType: 'USER_CHARACTERISTICS',
        state: 'ACTIVE',
        limit: 10,
        offset: 0,
      });
      expect(result).toEqual({ status: 'SUCCESS', items: traits });
    });

    it('returns NO_CHARACTERISTICS when the store has no active traits', async () => {
      const store = fakeStore([]);
      const service = createUserQueryMemoryRecallService({ retriever: fakeRetriever([]), store });

      const result = await service.recallUserCharacteristics({ tenantId, subjectId, agentId, queryText: 'irrelevant' }, new AbortController().signal);

      expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'NO_CHARACTERISTICS', itemCount: 0 });
    });

    it('reports CHARACTERISTICS_LIST_FAILED when the store throws', async () => {
      const store = fakeStore([characteristicsSummary('trait-1')]);
      store.listLongTermMemory.mockRejectedValue(new Error('store unavailable'));
      const service = createUserQueryMemoryRecallService({ retriever: fakeRetriever([]), store });

      const result = await service.recallUserCharacteristics({ tenantId, subjectId, agentId, queryText: 'irrelevant' }, new AbortController().signal);

      expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'CHARACTERISTICS_LIST_FAILED', itemCount: 0 });
    });

    it('reports CHARACTERISTICS_LIST_CANCELED when aborted before the call', async () => {
      const store = fakeStore([characteristicsSummary('trait-1')]);
      const service = createUserQueryMemoryRecallService({ retriever: fakeRetriever([]), store });
      const controller = new AbortController();
      controller.abort();

      const result = await service.recallUserCharacteristics({ tenantId, subjectId, agentId, queryText: 'irrelevant' }, controller.signal);

      expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'CHARACTERISTICS_LIST_CANCELED', itemCount: 0 });
      expect(store.listLongTermMemory).not.toHaveBeenCalled();
    });

    it('returns CHARACTERISTICS_LIST_FAILED when no store is configured', async () => {
      const service = createUserQueryMemoryRecallService({ retriever: fakeRetriever([]) });

      const result = await service.recallUserCharacteristics({ tenantId, subjectId, agentId, queryText: 'irrelevant' }, new AbortController().signal);

      expect(result).toEqual({ status: 'NO_CONTEXT', reason: 'CHARACTERISTICS_LIST_FAILED', itemCount: 0 });
    });
  });
});

function fakeRetriever(items: readonly SearchItem[]): {
  readonly searchLongTermMemory: ReturnType<typeof vi.fn<LongTermMemoryRetrieverGateway['searchLongTermMemory']>>;
  readonly getLongTermMemoryDetail: ReturnType<typeof vi.fn<LongTermMemoryRetrieverGateway['getLongTermMemoryDetail']>>;
} {
  return {
    searchLongTermMemory: vi.fn(async (query): Promise<SearchItemPage> => ({
      items,
      total: items.length,
      offset: query.offset,
      limit: query.limit,
    })),
    getLongTermMemoryDetail: vi.fn(async (request): Promise<LongTermMemoryRecord> => memoryRecord(String(request.memoryId))),
  };
}

function fakeStore(items: readonly LongTermMemorySummary[]): {
  readonly listLongTermMemory: ReturnType<typeof vi.fn<LongTermMemoryStoreGateway['listLongTermMemory']>>;
} {
  return {
    listLongTermMemory: vi.fn(async () => ({ items, total: items.length, offset: 0, limit: 10 })),
  };
}

function characteristicsSummary(traitId: string): LongTermMemorySummary {
  return {
    memoryId: brand<string, 'LongTermMemoryId'>(traitId),
    memoryType: 'USER_CHARACTERISTICS',
    knowledgeSourceType: 'LEARNED',
    state: 'ACTIVE',
    briefIndex: `偏好-${traitId}`,
    content: `trait-${traitId}`,
    labels: [],
    confidence: 0.9,
    isPinned: false,
    accessCount: 0,
    createTime: epoch(1),
    updateTime: epoch(1),
    version: 1,
  };
}

function searchItem(memoryId: string, score: number): SearchItem {
  return {
    summary: {
      memoryId: brand<string, 'LongTermMemoryId'>(memoryId),
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'LEARNED',
      state: 'ACTIVE',
      briefIndex: `summary-${memoryId}`,
      content: `l1-${memoryId}`,
      labels: [],
      confidence: score,
      isPinned: false,
      accessCount: 0,
      createTime: epoch(1),
      updateTime: epoch(1),
      version: 1,
    },
    score,
    relevanceScore: score,
  };
}

function memoryRecord(memoryId: string): LongTermMemoryRecord {
  return {
    tenantId: tenantId as TenantId,
    subjectId: subjectId as SubjectId,
    agentId: agentId as AgentId,
    memoryId: brand<string, 'LongTermMemoryId'>(memoryId) as LongTermMemoryId,
    memoryInstance: 'defaultInstance',
    memoryType: 'FACTUAL',
    knowledgeSourceType: 'LEARNED',
    sharingState: 'PRIVATE',
    state: 'ACTIVE',
    briefIndex: `summary-${memoryId}`,
    content: `detail-${memoryId}`,
    labels: [],
    confidence: 0.9,
    version: 1,
    accessCount: 0,
    recallCount: 0,
    extractionCount: 0,
    archivedAt: epoch(0),
    archiveReason: '',
    isPinned: false,
    source: 'test',
    createTime: epoch(1),
    updateTime: epoch(1),
  };
}

function epoch(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}
