import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../src/services/apiClient.ts';
import { memoryService } from '../src/services/memoryService.ts';

vi.mock('../src/services/apiClient.ts', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  isApiError: vi.fn(() => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('memoryService', () => {
  it('loads all three unfiltered tab totals with lightweight list requests', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ errorCode: 0, errorMsg: '', data: { items: [], total: 12, limit: 1, offset: 0 } })
      .mockResolvedValueOnce({ errorCode: 0, errorMsg: '', data: { items: [], total: 7, limit: 1, offset: 0 } })
      .mockResolvedValueOnce({ errorCode: 0, errorMsg: '', data: { items: [], total: 3, limit: 1, offset: 0 } });

    await expect(memoryService.getLongTermMemoryTabTotals({ memoryInstance: 'defaultInstance' })).resolves.toEqual({
      mine: 12,
      shared: 7,
      archived: 3,
    });
    expect(vi.mocked(apiClient.get).mock.calls).toEqual([
      ['/api/v1/memory/long-term-mem?memoryInstance=defaultInstance&state=ACTIVE&limit=1&offset=0'],
      ['/api/v1/memory/long-term-mem/shared?memoryInstance=defaultInstance&limit=1&offset=0'],
      ['/api/v1/memory/long-term-mem?memoryInstance=defaultInstance&state=ARCHIVED&limit=1&offset=0'],
    ]);
  });

  it('preserves successful tab totals when one lightweight request fails', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ errorCode: 0, errorMsg: '', data: { items: [], total: 12, limit: 1, offset: 0 } })
      .mockRejectedValueOnce(new Error('shared unavailable'))
      .mockResolvedValueOnce({ errorCode: 0, errorMsg: '', data: { items: [], total: 3, limit: 1, offset: 0 } });

    await expect(memoryService.getLongTermMemoryTabTotals({ memoryInstance: 'defaultInstance' })).resolves.toEqual({ mine: 12, archived: 3 });
  });

  it('loads management details through the non-recording endpoint', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ errorCode: 0, errorMsg: '', data: { memoryId: 'memory-1' } });

    await memoryService.getLongTermMemory('memory-1', { memoryInstance: 'defaultInstance' });

    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/memory/long-term-mem/memory-1/record?memoryInstance=defaultInstance');
  });

  it('sends shared-memory search as queryText with server pagination', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      errorCode: 0,
      errorMsg: '',
      data: { items: [], total: 0, limit: 10, offset: 20 },
    });

    await memoryService.listPublishedLongTermMemory({
      memoryInstance: 'defaultInstance',
      queryText: 'BGP 邻居',
      limit: 10,
      offset: 20,
    });

    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/v1/memory/long-term-mem/shared?memoryInstance=defaultInstance&queryText=BGP%20%E9%82%BB%E5%B1%85&limit=10&offset=20',
    );
  });

  it('sends private-memory search as queryText with server pagination', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      errorCode: 0,
      errorMsg: '',
      data: { items: [], total: 0, limit: 10, offset: 0 },
    });

    await memoryService.listLongTermMemory({
      memoryInstance: 'defaultInstance',
      queryText: 'BGP 邻居',
      state: 'ACTIVE',
      limit: 10,
      offset: 0,
    });

    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/v1/memory/long-term-mem?memoryInstance=defaultInstance&queryText=BGP%20%E9%82%BB%E5%B1%85&state=ACTIVE&limit=10&offset=0',
    );
  });

  it('unwraps the shared-copy result array without a results wrapper', async () => {
    const copied = [
      {
        memoryId: 'fork-1',
        sourceMemoryId: 'shared-1',
        copyStatus: 'COPIED' as const,
        record: { memoryId: 'fork-1' },
      },
    ];
    vi.mocked(apiClient.post).mockResolvedValueOnce({ errorCode: 0, errorMsg: 'SUCCESS', data: copied });

    await expect(memoryService.copyPublishedMemory({ memoryIds: ['shared-1'] })).resolves.toBe(copied);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/memory/long-term-mem/shared/copy', { memoryIds: ['shared-1'] });
  });

  it('posts batch memory creation and validates aggregate counts', async () => {
    const req = {
      memoryInstance: 'defaultInstance',
      items: [
        {
          memoryType: 'FACTUAL' as const,
          knowledgeSourceType: 'CONFIGURED' as const,
          briefIndex: 'BGP policy',
          content: 'Check route policy.',
          idempotencyKey: 'import-key-1',
        },
      ],
    };
    const result = { successCount: 1, failCount: 0, memoryIds: ['memory-1'] };
    vi.mocked(apiClient.post).mockResolvedValueOnce({ errorCode: 0, errorMsg: 'SUCCESS', data: result });

    await expect(memoryService.batchCreateLongTermMemory(req)).resolves.toBe(result);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/memory/long-term-mem/batch', req);
  });

  it.each([
    { successCount: -1, failCount: 2, memoryIds: [] },
    { successCount: 0.5, failCount: 0.5, memoryIds: [] },
    { successCount: 1, failCount: 1, memoryIds: ['memory-1'] },
    { successCount: 1, failCount: 0, memoryIds: [] },
    { successCount: 1, failCount: 0, memoryIds: [3] },
  ])('rejects malformed batch result %#', async (data) => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ errorCode: 0, errorMsg: 'SUCCESS', data });

    await expect(
      memoryService.batchCreateLongTermMemory({
        items: [
          {
            memoryType: 'FACTUAL',
            knowledgeSourceType: 'CONFIGURED',
            briefIndex: 'BGP policy',
            content: 'Check route policy.',
          },
        ],
      }),
    ).rejects.toThrow('Memory batch API returned an invalid response.');
  });
});
