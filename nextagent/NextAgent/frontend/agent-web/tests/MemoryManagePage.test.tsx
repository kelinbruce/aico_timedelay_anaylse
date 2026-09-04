// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { App as AntdApp } from 'antd';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/AppProviders.tsx';
import i18n from '../src/i18n/index.ts';
import { MemoryManagePage } from '../src/pages/MemoryManagePage.tsx';
import { memoryService } from '../src/services/memoryService.ts';
import { setSubjectId } from '../src/services/apiClient.ts';
import * as memoryTransfer from '../src/features/memory/memoryTransfer.ts';

vi.mock('../src/features/memory/memoryTransfer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/memory/memoryTransfer.ts')>();
  return {
    ...actual,
    downloadMemoryImportTemplate: vi.fn(),
    downloadMemoryExport: vi.fn(),
  };
});

vi.mock('../src/services/memoryService.ts', () => ({
  memoryService: {
    getLongTermMemoryTabTotals: vi.fn().mockResolvedValue({ mine: 0, shared: 0, archived: 0 }),
    listLongTermMemory: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 10 }),
    listPublishedLongTermMemory: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 10 }),
    getLongTermMemory: vi.fn(),
    manualSaveLongTermMemory: vi.fn(),
    batchCreateLongTermMemory: vi.fn(),
    patchLongTermMemory: vi.fn(),
    deleteLongTermMemory: vi.fn(),
    publishLongTermMemory: vi.fn(),
    unpublishLongTermMemory: vi.fn(),
    copyPublishedMemory: vi.fn(),
  },
}));

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.mocked(memoryService.batchCreateLongTermMemory).mockReset();
  vi.mocked(memoryService.getLongTermMemoryTabTotals).mockReset();
  vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValue({ mine: 0, shared: 0, archived: 0 });
  vi.mocked(memoryService.listLongTermMemory).mockReset();
  vi.mocked(memoryService.listLongTermMemory).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 10 });
  setSubjectId(null);
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  await i18n.changeLanguage('zh-CN');
  document.documentElement.setAttribute('data-theme', 'lightday');
});

function makeSummary(memoryId: string, briefIndex: string, state: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') {
  return {
    memoryId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    agentId: 'agent-1',
    memoryInstance: 'defaultInstance',
    memoryType: 'FACTUAL' as const,
    knowledgeSourceType: 'CONFIGURED' as const,
    state,
    sharingState: 'PRIVATE' as const,
    briefIndex,
    content: `${briefIndex} content`,
    labels: [],
    confidence: 0.8,
    isPinned: false,
    accessCount: 0,
    recallCount: 0,
    extractionCount: 0,
    archivedAt: state === 'ARCHIVED' ? 1 : 0,
    archiveReason: state === 'ARCHIVED' ? 'user_archive' : '',
    source: 'manual',
    createTime: 1,
    updateTime: 1,
    version: 1,
  };
}

function makeApiError(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), {
    status,
    code,
    error: message,
    kind: 'http' as const,
    retriable: false,
    authChallenge: null,
  });
}

function makeTransferFile(memories: ReadonlyArray<Record<string, unknown>>, name = 'memories.json'): File {
  return new File([JSON.stringify(memories)], name, { type: 'application/json' });
}

function makeTransferEntry(index: number, overrides: Record<string, unknown> = {}) {
  return {
    briefIndex: `BGP memory ${index}`,
    content: `Check BGP neighbor ${index}.`,
    ...overrides,
  };
}

function mockConfiguredCapacity(activeTotal: number, archivedTotal: number): void {
  vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => {
    const configuredTotal = params.state === 'ARCHIVED' ? archivedTotal : activeTotal;
    return {
      items: [],
      total: params.knowledgeSourceType === 'CONFIGURED' ? configuredTotal : 0,
      offset: params.offset ?? 0,
      limit: params.limit ?? 10,
    };
  });
}

describe('MemoryManagePage shell content layout', () => {
  it('shows a localized deleted-record message and refreshes stale detail state', async () => {
    const stale = makeSummary('memory-stale', 'Deleted elsewhere');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [stale], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockRejectedValueOnce(makeApiError('LTM_MEMORY_NOT_FOUND', 'identifier value must be non-empty', 404));

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    expect(await screen.findByText('该记录已被删除')).toBeTruthy();
    expect(screen.queryByText('identifier value must be non-empty')).toBeNull();
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(memoryService.getLongTermMemoryTabTotals).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('没有匹配的记忆')).toBeTruthy();
  });

  it('uses the same deleted-record recovery for stale record operations', async () => {
    const stale = makeSummary('memory-stale-operation', 'Stale operation');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [stale], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(stale);
    vi.mocked(memoryService.patchLongTermMemory).mockRejectedValueOnce(
      makeApiError('LTM_MEMORY_NOT_FOUND', 'identifier value must be non-empty', 404),
    );

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '设为保持不变' }));
    expect(await screen.findByText('该记录已被删除')).toBeTruthy();
    expect(screen.queryByText('identifier value must be non-empty')).toBeNull();
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(memoryService.getLongTermMemoryTabTotals).toHaveBeenCalledTimes(2));
  });

  it('treats INVALID_BRAND_VALUE from remote backends as a deleted record on detail load', async () => {
    const stale = makeSummary('memory-stale-remote', 'Deleted remotely');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [stale], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockRejectedValueOnce(makeApiError('INVALID_BRAND_VALUE', 'Identifier value must be non-empty.', 400));

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    expect(await screen.findByText('该记录已被删除')).toBeTruthy();
    expect(screen.queryByText('Identifier value must be non-empty.')).toBeNull();
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(memoryService.getLongTermMemoryTabTotals).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('没有匹配的记忆')).toBeTruthy();
  });

  it('treats INVALID_BRAND_VALUE from remote backends as a deleted record on record operations', async () => {
    const stale = makeSummary('memory-stale-remote-op', 'Stale remote operation');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [stale], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(stale);
    vi.mocked(memoryService.patchLongTermMemory).mockRejectedValueOnce(
      makeApiError('INVALID_BRAND_VALUE', 'Identifier value must be non-empty.', 400),
    );

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '设为保持不变' }));
    expect(await screen.findByText('该记录已被删除')).toBeTruthy();
    expect(screen.queryByText('Identifier value must be non-empty.')).toBeNull();
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(memoryService.getLongTermMemoryTabTotals).toHaveBeenCalledTimes(2));
  });

  it('localizes deleted-record recovery in English', async () => {
    await i18n.changeLanguage('en-US');
    const stale = makeSummary('memory-stale-en', 'Deleted in another page');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [stale], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockRejectedValueOnce(makeApiError('LTM_MEMORY_NOT_FOUND', 'identifier value must be non-empty', 404));

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    expect(await screen.findByText('This record has been deleted')).toBeTruthy();
    expect(screen.queryByText('identifier value must be non-empty')).toBeNull();
  });

  it('matches the Chat header structure without a standalone icon, subtitle, or metric cards', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 7, shared: 0, archived: 0 });
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [], total: 7, offset: 0, limit: 10 });
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    expect(screen.getByTestId('memory-manage-page')).toBeTruthy();
    expect(container.querySelector('.ltm-topbar')).toBeTruthy();
    expect(container.querySelector('.ltm-main')).toBeTruthy();
    expect(container.querySelector('.ltm-workspace')).toBeTruthy();
    expect(container.querySelector('nav')).toBeNull();
    expect(screen.getByRole('heading', { name: '记忆管理', level: 1 })).toBeTruthy();
    expect(container.querySelector('.ltm-mark')).toBeNull();
    expect(container.querySelector('.ltm-subtitle')).toBeNull();
    expect(container.querySelector('.ltm-metrics')).toBeNull();
    expect(container.querySelector('.ltm-metric')).toBeNull();
    expect(screen.getByRole('option', { name: '用户设定' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '智能沉淀' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '系统默认' })).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('没有匹配的记忆')).toBeTruthy();
      expect(container.querySelector('.ltm-tab-count')?.textContent).toBe('7');
      expect(memoryService.getLongTermMemory).not.toHaveBeenCalled();
    });
  });

  it('uses backend queryText search without replacing the unfiltered active-memory count', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 7, shared: 0, archived: 0 });
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 7, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [makeSummary('memory-bgp', 'BGP neighbor')], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 7, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(makeSummary('memory-bgp', 'BGP neighbor'));
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await waitFor(() => expect(container.querySelector('.ltm-tab-count')?.textContent).toBe('7'));
    fireEvent.change(screen.getByPlaceholderText('搜索摘要或正文'), { target: { value: 'BGP' } });

    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryText: 'BGP', state: 'ACTIVE', limit: 10, offset: 0 }),
      ),
    );
    await waitFor(() => expect(container.querySelector('.ltm-tab-count')?.textContent).toBe('7'));
    expect(screen.getAllByText('BGP neighbor')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect((screen.getByPlaceholderText('搜索摘要或正文') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(3));
    expect(vi.mocked(memoryService.listLongTermMemory).mock.calls.at(-1)?.[0]).not.toHaveProperty('queryText');
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull();
  });

  it('shows a localized validation error and suppresses queryText when search exceeds 128 Unicode code points', async () => {
    const acceptedQuery = '😀'.repeat(128);
    const rejectedQuery = `${acceptedQuery}BGP`;
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const search = screen.getByPlaceholderText('搜索摘要或正文') as HTMLInputElement;
    expect(search.title).toBe('最多输入 128 个字符');

    fireEvent.change(search, { target: { value: rejectedQuery } });

    expect(search.value).toBe(rejectedQuery);
    expect(search.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('搜索内容最多 128 个字符，当前 131/128');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(vi.mocked(memoryService.listLongTermMemory).mock.calls.some(([query]) => query.queryText === rejectedQuery)).toBe(false);

    await act(async () => {
      await i18n.changeLanguage('en-US');
    });
    expect(screen.getByRole('alert').textContent).toBe('Search text is limited to 128 characters (131/128)');

    fireEvent.change(search, { target: { value: acceptedQuery } });

    expect(search.value).toBe(acceptedQuery);
    expect(search.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ queryText: acceptedQuery })));
  });

  it('automatically selects the first private memory and preserves a valid user selection after refresh', async () => {
    const first = makeSummary('memory-first', 'first memory');
    const second = makeSummary('memory-second', 'second memory');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [first, second], total: 2, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [first, second], total: 2, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockImplementation(async (memoryId) => (memoryId === second.memoryId ? second : first));

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await waitFor(() => expect(memoryService.getLongTermMemory).toHaveBeenCalledWith(first.memoryId, expect.anything()));
    expect(container.querySelector('.ltm-memory-row.active .ltm-row-title')?.textContent).toBe(first.briefIndex);

    const secondRow = [...container.querySelectorAll<HTMLElement>('.ltm-memory-row')].find((row) => row.textContent?.includes(second.briefIndex));
    expect(secondRow).toBeTruthy();
    fireEvent.click(secondRow!);
    await waitFor(() => expect(memoryService.getLongTermMemory).toHaveBeenCalledWith(second.memoryId, expect.anything()));

    fireEvent.change(screen.getByPlaceholderText('搜索摘要或正文'), { target: { value: 'memory' } });
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2));
    expect(container.querySelector('.ltm-memory-row.active .ltm-row-title')?.textContent).toBe(second.briefIndex);
  });

  it('does not show accessCount in the list while keeping it in management details', async () => {
    const listed = { ...makeSummary('memory-counted', 'counted memory'), accessCount: 7 };
    const detailed = { ...listed, accessCount: 7 };
    let resolveDetail!: (value: typeof detailed) => void;
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [listed], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    expect(container.querySelector('.ltm-list-head')?.textContent).not.toContain('使用次数');
    await waitFor(() => expect(container.querySelector('.ltm-memory-row')?.children).toHaveLength(5));
    expect(container.querySelector('.ltm-memory-row')?.children[4]?.textContent).not.toBe('7');
    await waitFor(() => expect(memoryService.getLongTermMemory).toHaveBeenCalledWith(listed.memoryId, expect.anything()));

    await act(async () => resolveDetail(detailed));
    await waitFor(() => expect(screen.getByText('使用次数')).toBeTruthy());
    expect(container.querySelector('dl.ltm-property-list')?.textContent).toContain('7');
  });

  it('automatically selects the first archived memory after switching tabs', async () => {
    const firstArchived = makeSummary('archived-first', 'first archived memory', 'ARCHIVED');
    const secondArchived = makeSummary('archived-second', 'second archived memory', 'ARCHIVED');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [firstArchived, secondArchived], total: 2, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(firstArchived);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '已归档' }));

    await waitFor(() => expect(memoryService.getLongTermMemory).toHaveBeenCalledWith(firstArchived.memoryId, expect.anything()));
    expect(container.querySelector('.ltm-memory-row.active .ltm-row-title')?.textContent).toBe(firstArchived.briefIndex);
    expect(container.querySelector('.ltm-list-head')?.children.length).toBe(container.querySelector('.ltm-memory-row')?.children.length);
    expect(await screen.findByRole('button', { name: '撤销归档' })).toBeTruthy();
    expect(screen.queryByText('失效时间')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('搜索摘要或正文'), { target: { value: 'BGP' } });
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryText: 'BGP', state: 'ARCHIVED', limit: 10, offset: 0 }),
      ),
    );
  });

  it('keeps the active-memory count in the tab when shared data loads', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 5, shared: 99, archived: 0 });
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [], total: 5, offset: 0, limit: 10 });
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [], total: 99, offset: 0, limit: 10 });
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await waitFor(() => expect(container.querySelector('.ltm-tab-count')?.textContent).toBe('5'));
    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));
    await waitFor(() => expect(memoryService.listPublishedLongTermMemory).toHaveBeenCalled());
    expect(container.querySelector('.ltm-tab-count')?.textContent).toBe('5');
  });

  it('shows unfiltered totals for mine, shared, and archived tabs', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 12, shared: 7, archived: 3 });
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => ({
      items: [],
      total: params.state === 'ARCHIVED' ? 3 : 12,
      offset: params.offset ?? 0,
      limit: params.limit ?? 10,
    }));
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValue({ items: [], total: 7, offset: 0, limit: 1 });

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await waitFor(() => {
      expect(Array.from(container.querySelectorAll('.ltm-tab-count')).map((node) => node.textContent)).toEqual(['12', '7', '3']);
    });
    expect(memoryService.getLongTermMemoryTabTotals).toHaveBeenCalledWith({ memoryInstance: 'defaultInstance' });
  });

  it('uses the same confidence color threshold in shared and archived lists', async () => {
    const sharedLow = {
      ...makeSummary('shared-low', 'shared low'),
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-low',
      ownerUserId: 'owner-1',
      confidence: 0.59,
    };
    const sharedHigh = { ...sharedLow, memoryId: 'shared-high', briefIndex: 'shared high', confidence: 0.6 };
    const archivedLow = { ...makeSummary('archived-low', 'archived low', 'ARCHIVED'), confidence: 0.59 };
    const archivedHigh = { ...makeSummary('archived-high', 'archived high', 'ARCHIVED'), confidence: 0.6 };
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [archivedLow, archivedHigh], total: 2, offset: 0, limit: 10 });
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [sharedLow, sharedHigh], total: 2, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockImplementation(async (memoryId) =>
      memoryId === archivedHigh.memoryId ? archivedHigh : archivedLow,
    );
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));
    await waitFor(() => expect(container.querySelectorAll('.ltm-row-shared')).toHaveLength(2));
    let rows = container.querySelectorAll('.ltm-row-shared');
    expect(rows[0]?.querySelector('.ltm-bar')?.classList.contains('low')).toBe(true);
    expect(rows[1]?.querySelector('.ltm-bar')?.classList.contains('low')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '已归档' }));
    await waitFor(() => expect(container.querySelectorAll('.ltm-row-expiring')).toHaveLength(2));
    rows = container.querySelectorAll('.ltm-row-expiring');
    expect(rows[0]?.querySelector('.ltm-bar')?.classList.contains('low')).toBe(true);
    expect(rows[1]?.querySelector('.ltm-bar')?.classList.contains('low')).toBe(false);
  });

  it('blocks saving when the form contains more than ten labels', async () => {
    const saved = {
      ...makeSummary('saved-memory', 'saved memory'),
      memoryType: 'PROCEDURAL' as const,
      confidence: 0.5,
      isPinned: true,
    };
    vi.mocked(memoryService.manualSaveLongTermMemory).mockResolvedValueOnce(saved);

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '＋ 新增记忆' }));
    const labelsInput = screen.getByPlaceholderText('用顿号或逗号分隔，最多 10 个');
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;

    fireEvent.change(labelsInput, { target: { value: '一，二，三，四，五，六，七，八，九，十，十一' } });
    expect((await screen.findByRole('alert')).textContent).toBe('最多只能输入 10 个标签，当前 11 个');
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    expect(memoryService.manualSaveLongTermMemory).not.toHaveBeenCalled();

    fireEvent.change(labelsInput, { target: { value: '一，二，三，四，五，六，七，八，九，十' } });
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'BGP 维护窗口' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '周日凌晨执行维护' } });
    expect(screen.getByText('10/10 个标签')).toBeTruthy();
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(memoryService.manualSaveLongTermMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'],
        }),
      ),
    );
  });

  it('uses Chat theme variables, parent sizing, and container queries', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/pages/MemoryManagePage.css'), 'utf8');

    expect(css).toContain('height: 100%;');
    expect(css).toContain('container-type: inline-size;');
    expect(css).toContain('container-name: ltm-app;');
    expect(css).toContain('height: 54px;');
    expect(css).toContain('.ltm-topbar::after');
    expect(css).toContain('font-family: var(--font-family-app);');
    expect(css).not.toContain('--ltm-font-sm');
    expect(css).not.toContain('13px');
    expect(css).toContain('--ltm-bg: var(--color-bg-primary);');
    expect(css).toContain('--ltm-text: var(--color-text-primary);');
    expect(css).toContain('@container ltm-app (max-width: 1160px)');
    expect(css).toMatch(/@container ltm-app \(max-width: 1160px\)\s*\{[^}]*\.ltm-main\s*\{[^}]*grid-template-rows: max-content;/);
    expect(css).toMatch(
      /@container ltm-app \(max-width: 1160px\)\s*\{[\s\S]*?\.ltm-workspace\s*\{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible;[^}]*grid-template-columns: 1fr;[^}]*grid-template-rows: max-content max-content;/,
    );
    expect(css).toMatch(/\.ltm-main\s*\{[\s\S]*?overflow-y: auto;/);
    expect(css).toMatch(/\.ltm-workspace\s*\{[^}]*height: 100%;[^}]*max-height: 100%;[^}]*overflow: visible;/);
    expect(css).toMatch(
      /\.ltm-list-panel\s*\{[\s\S]*?grid-template-rows: auto auto auto minmax\(0, 1fr\) auto;[\s\S]*?align-content: stretch;[\s\S]*?height: 100%;[\s\S]*?min-height: 0;/,
    );
    expect(css).toMatch(/\.ltm-pagination\s*\{[^}]*align-self:\s*end;/);
    expect(css).toMatch(/\.ltm-pagination\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*flex-end;/);
    expect(css).toMatch(/\.ltm-pagination-pages\s*\{[^}]*justify-content:\s*flex-end;/);
    expect(css).toMatch(/\.ltm-tab\s*\{[^}]*height: 34px;[^}]*min-height: 34px;/);
    expect(css).toMatch(/\.ltm-filters\s*\{[^}]*align-items: start;/);
    expect(css).toMatch(/\.ltm-control\s*\{[^}]*height: 32px;[^}]*min-height: 32px;/);
    expect(css).toMatch(/\.ltm-rows\s*\{[^}]*min-height: 0;[^}]*overflow-x: hidden;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
    expect(css).toMatch(/@container ltm-app \(max-width: 1160px\)\s*\{[\s\S]*?\.ltm-rows\s*\{[^}]*overflow: visible;/);
    expect(css).toMatch(/\.ltm-memory-row\s*\{[\s\S]*?min-height: 52px;[\s\S]*?padding: 4px 14px;/);
    expect(css).not.toContain('calc(100vh - 64px)');
    expect(css).toMatch(/\.ltm-memory-row > :first-child\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow: hidden;/);
    expect(css).toMatch(
      /\.ltm-brief\s*\{[^}]*min-width: 0;\s*max-width: 100%;[^}]*overflow: hidden;\s*text-overflow: ellipsis;\s*white-space: nowrap;/,
    );
    expect(css).not.toMatch(/\.ltm-brief\s*\{[^}]*-webkit-line-clamp:/);
    expect(css).not.toContain('scrollbar-width: none');
    expect(css).toMatch(/\.ltm-list-head > span,\s*[\s\S]*?justify-self: center;\s*text-align: center;/);
    expect(css).toContain('container-name: ltm-list;');
    expect(css).toMatch(/\.ltm-search-control\s*\{[^}]*position: relative;[^}]*min-width: 0;[^}]*width: 100%;/);
    expect(css).toMatch(/\.ltm-search-clear\s*\{[^}]*position: absolute;[^}]*width: 22px;\s*height: 22px;/);
    expect(css).toContain('grid-template-columns: minmax(180px, 1fr) repeat(2, minmax(128px, 156px)) minmax(136px, 156px);');
    expect(css).not.toContain('repeat(5, minmax(96px, 116px))');
    expect(css).toContain('@container ltm-list (max-width: 720px)');
    expect(css).toContain('@container ltm-list (max-width: 480px)');
    expect(css).toMatch(/\.ltm-control\s*\{[^}]*width: 100%;[^}]*max-width: 100%;/);
    expect(css).toMatch(/\.ltm-update-mode\s*\{[^}]*min-width: 136px;[^}]*padding-right: 32px;/);
    expect(css).toMatch(/\.ltm-detail-toolbar\s*\{[\s\S]*?flex-wrap: nowrap;/);
    expect(css).toMatch(/\.ltm-detail-actions\s*\{[^}]*flex-wrap: nowrap;/);
    expect(css).toMatch(
      /\.ltm-detail-toolbar \.ltm-btn,\s*\.ltm-form-actions \.ltm-btn\s*\{[^}]*min-width: 0;[^}]*height: 30px;[^}]*min-height: 30px;[^}]*padding: 0 6px;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*font-size: var\(--ltm-font-xs\);[^}]*line-height: 1;/,
    );
    expect(css).toMatch(/\.ltm-form-actions\s*\{[^}]*flex: 0 0 auto;[^}]*padding: 0;/);
    expect(css).toMatch(
      /\.ltm-detail-head\.ltm-form-head\s*\{[^}]*gap: 6px;[^}]*padding: 10px 16px 8px;[^}]*align-content: start;[^}]*grid-auto-rows: max-content;/,
    );
    expect(css).toMatch(
      /\.ltm-form-heading-row\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*justify-content: space-between;[^}]*gap: 8px;[^}]*min-width: 0;/,
    );
    expect(css).toMatch(/\.ltm-form-heading-row \.ltm-detail-title\s*\{[^}]*line-height: 1\.2;/);
    expect(css).not.toMatch(/\.ltm-detail-danger-actions\s*\{[^}]*width: 100%/);
    expect(css).toMatch(/\.ltm-chip\s*\{[\s\S]*?min-width: 0;[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/);
    expect(css).toMatch(/\.ltm-type-chip\s*\{[^}]*white-space: nowrap;[^}]*overflow-wrap: normal;/);
    expect(css).toMatch(/\.ltm-workspace\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 480px;/);
    expect(css).toMatch(/\.ltm-detail-identity\s*\{[^}]*gap: 8px 6px;[^}]*flex-wrap: nowrap;/);
    expect(css).toMatch(/\.ltm-detail-identity > \.ltm-chips\s*\{[^}]*gap: 4px;[^}]*flex-wrap: nowrap;/);
    expect(css).toMatch(
      /\.ltm-detail-identity > \.ltm-chips > \.ltm-chip\s*\{[^}]*flex: 0 0 auto;[^}]*padding-inline: 6px;[^}]*white-space: nowrap;[^}]*overflow-wrap: normal;/,
    );
    expect(css).toMatch(/\.ltm-detail-confidence\s*\{[^}]*flex: 0 0 auto;/);
    expect(css).toMatch(/\.ltm-detail-confidence\s*\{[^}]*gap: 4px;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.ltm-detail-confidence \.ltm-bar\s*\{[^}]*width: 36px;/);
    expect(css).toMatch(
      /@container ltm-app \(max-width: 520px\)\s*\{[\s\S]*?\.ltm-detail-identity,\s*\.ltm-detail-identity > \.ltm-chips\s*\{[^}]*flex-wrap: wrap;/,
    );
    expect(css).toMatch(/\.ltm-bar\s*\{[^}]*width: 72px;/);
    expect(css).toMatch(/\.ltm-head-mine,\s*\.ltm-row-mine\s*\{\s*grid-template-columns: minmax\(120px, 1fr\) 112px 88px 150px 84px;/);
    expect(css).toMatch(/\.ltm-head-shared,\s*\.ltm-row-shared\s*\{\s*grid-template-columns: minmax\(84px, 1fr\) 106px 86px 104px 106px 78px;/);
    expect(css).toMatch(/\.ltm-head-expiring,\s*\.ltm-row-expiring\s*\{\s*grid-template-columns: minmax\(120px, 1fr\) 112px 88px 88px 150px;/);
    expect(css).toMatch(/\.ltm-memory-row > \.ltm-muted-text\s*\{[^}]*width: 100%;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.ltm-detail\s*\{[^}]*min-width: 0;[^}]*grid-template-rows: auto auto;[^}]*align-content: start;/);
    expect(css).toMatch(/\.ltm-detail-head\s*\{[^}]*min-width: 0;/);
    expect(css).toMatch(
      /\.ltm-detail-panel\s*\{[^}]*height: 100%;[^}]*max-height: 100%;[^}]*overflow-x: hidden;[^}]*overflow-y: auto;[^}]*align-self: stretch;[^}]*overscroll-behavior: contain;/,
    );
    expect(css).toMatch(/\.ltm-detail-panel > \.ltm-detail\s*\{[^}]*height: auto;[^}]*min-height: 100%;[^}]*overflow: visible;/);
    expect(css).toMatch(/\.ltm-detail-body\s*\{[^}]*min-height: 0;[^}]*overflow: visible;[^}]*display: grid;[^}]*align-content: start;/);
    expect(css).toMatch(
      /@container ltm-app \(max-width: 1160px\)\s*\{[\s\S]*?\.ltm-detail-panel\s*\{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible;[^}]*align-self: start;/,
    );
    expect(css).toMatch(/\.ltm-summary-block\.collapsed \.ltm-detail-title\s*\{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.ltm-collapsible-content\.collapsed\s*\{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible;/);
    expect(css).toMatch(
      /\.ltm-collapsible-content\.collapsed \.ltm-markdown-content\s*\{[^}]*display: -webkit-box;[^}]*-webkit-box-orient: vertical;[^}]*-webkit-line-clamp: 6;[^}]*overflow: hidden;/,
    );
    expect(css).toMatch(/\.ltm-markdown-content\s*\{[^}]*display: block;[^}]*min-width: 0;/);
    expect(css).not.toContain('height: calc(5 * 1.65em + 26px)');
    expect(css).toMatch(/\.ltm-form-body\s*\{[^}]*padding: 16px;/);
    expect(css).toMatch(
      /\.ltm-field\s*\{[^}]*display: grid;[^}]*gap: 6px;[^}]*min-width: 0;[^}]*align-content: start;[^}]*grid-auto-rows: max-content;/,
    );
    expect(css).toMatch(/\.ltm-form-primary-control\s*\{[^}]*height: 34px;[^}]*box-sizing: border-box;[^}]*align-self: start;/);
    expect(css).toMatch(/\.ltm-select\.ltm-form-primary-control\s*\{[^}]*padding-block: 5px;/);
    expect(css).toMatch(/\.ltm-markdown\s*\{[\s\S]*?width: 100%;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: break-word;/);
    expect(css).toMatch(/\.ltm-json\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?white-space: pre-wrap;/);
    expect(css).not.toMatch(/\.ltm-json\s*\{[\s\S]*?overflow:\s*auto;/);
    expect(css).not.toContain('.ltm-mark {');
    expect(css).not.toContain('.ltm-metrics');
    expect(css).not.toContain('height: 100vh');
    expect(css).not.toContain('@media (max-width:');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    expect(css).toContain('box-shadow: var(--shadow-sm);');
    expect(css).toContain('color: var(--color-text-inverse);');
  });

  it('follows immersive host locale and theme changes without resetting page state', async () => {
    const renderPage = (locale: 'zh-cn' | 'en-us', theme: 'lightday' | 'evening') => (
      <AppProviders mode="immersive" site={{ locale, theme }}>
        <AntdApp>
          <MemoryManagePage />
        </AntdApp>
      </AppProviders>
    );
    const { rerender } = render(renderPage('en-us', 'evening'));

    expect(await screen.findByRole('heading', { name: 'Memory Management', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Add Memory' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^My Memories/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Any update' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Keep fixed' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Auto-update' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Any confidence' })).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('evening');

    const search = screen.getByPlaceholderText('Search summaries or content') as HTMLInputElement;
    expect(search.title).toBe('Enter up to 128 characters');
    fireEvent.change(search, { target: { value: 'router' } });
    expect(search.value).toBe('router');

    rerender(renderPage('zh-cn', 'lightday'));

    expect(await screen.findByRole('heading', { name: '记忆管理', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 新增记忆' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^我的记忆/ })).toBeTruthy();
    expect((screen.getByPlaceholderText('搜索摘要或正文') as HTMLInputElement).value).toBe('router');
    expect((screen.getByPlaceholderText('搜索摘要或正文') as HTMLInputElement).title).toBe('最多输入 128 个字符');
    expect(document.documentElement.getAttribute('data-theme')).toBe('lightday');
  });

  it('keeps English type chips and detail actions within the detail card', async () => {
    const summary = {
      ...makeSummary('english-memory', 'English memory'),
      memoryType: 'USER_CHARACTERISTICS' as const,
    };
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [summary], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(summary);
    await i18n.changeLanguage('en-US');

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    expect(await screen.findByRole('toolbar', { name: 'Memory actions' })).toBeTruthy();
    expect(screen.getAllByText('User preference').length).toBeGreaterThan(0);
    expect(container.querySelector('.ltm-memory-row .ltm-type-chip')?.textContent).toBe('User preference');
    expect(container.querySelector('.ltm-detail-head .ltm-type-chip')?.textContent).toBe('User preference');
    expect(screen.getAllByText('Usage count').length).toBeGreaterThan(0);
    expect(screen.getByText('Last used')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep fixed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(container.textContent).not.toContain('User characteristics');

    fireEvent.click(screen.getByRole('button', { name: '+ Add Memory' }));
    const labelsInput = screen.getByPlaceholderText('Separate with commas or spaces, up to 10');
    expect(labelsInput.closest('.ltm-field')?.classList.contains('wide')).toBe(true);
  });

  it('keeps the widest English shared-memory identity combination in one detail row', async () => {
    const shared = {
      ...makeSummary('english-shared-memory', 'English shared memory'),
      memoryType: 'USER_CHARACTERISTICS' as const,
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-memory',
      ownerUserId: 'owner-1',
      confidence: 1,
    };
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({
      items: [shared],
      total: 1,
      offset: 0,
      limit: 10,
    });
    await i18n.changeLanguage('en-US');

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Shared Memories/ }));
    const identity = await screen.findByLabelText('Shared memory attributes');
    expect(Array.from(identity.querySelectorAll('.ltm-chip')).map((chip) => chip.textContent)).toEqual([
      'User preference',
      'Active',
      'Shared memory',
    ]);
    expect(container.querySelector('.ltm-detail-identity')?.contains(identity)).toBe(true);
    expect(screen.getByLabelText('Confidence 100%')).toBeTruthy();
  });

  it.each([
    {
      name: 'JSON object',
      content: '{"category":"FACTUAL","nested":{"enabled":true}}',
      expected: '{\n  "category": "FACTUAL",\n  "nested": {\n    "enabled": true\n  }\n}',
      json: true,
    },
    {
      name: 'JSON array',
      content: '[{"step":1},{"step":2}]',
      expected: '[\n  {\n    "step": 1\n  },\n  {\n    "step": 2\n  }\n]',
      json: true,
    },
    {
      name: 'invalid JSON',
      content: '{"broken":',
      expected: '{"broken":',
      json: false,
    },
    {
      name: 'plain text',
      content: '保持原始正文，不进行转换。',
      expected: '保持原始正文，不进行转换。',
      json: false,
    },
    {
      name: 'JSON scalar',
      content: '"scalar"',
      expected: '"scalar"',
      json: false,
    },
  ])('formats $name detail content without changing the source text', async ({ name, content, expected, json }) => {
    const summary = {
      memoryId: `memory-${name}`,
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
      memoryInstance: 'defaultInstance',
      memoryType: 'FACTUAL' as const,
      knowledgeSourceType: 'CONFIGURED' as const,
      state: 'ACTIVE' as const,
      sharingState: 'PRIVATE' as const,
      briefIndex: `${name} memory`,
      content,
      labels: [],
      confidence: 0.8,
      isPinned: false,
      accessCount: 0,
      recallCount: 0,
      extractionCount: 0,
      archivedAt: 0,
      archiveReason: '',
      source: 'manual',
      createTime: 1,
      updateTime: 1,
      version: 1,
    };
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [summary], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(summary);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const contentElement = await screen.findByTestId(json ? 'memory-json-content' : 'memory-text-content');
    expect(contentElement.textContent).toBe(expected);
    expect(summary.content).toBe(content);
    if (name === 'JSON object') {
      expect(screen.getByRole('toolbar', { name: '记忆操作' })).toBeTruthy();
      expect(screen.getByLabelText('记忆属性')).toBeTruthy();
      expect(container.querySelectorAll('.ltm-detail-section')).toHaveLength(3);
      expect(container.querySelector('.ltm-detail-danger-actions')?.textContent).toContain('删除');
      expect(container.querySelector('dl.ltm-property-list')).toBeTruthy();
      expect(container.querySelector('.ltm-meta-grid')).toBeNull();
      expect(screen.queryByText('失效时间')).toBeNull();
      expect(screen.getAllByText('使用次数').length).toBeGreaterThan(0);
      expect(screen.getByText('最近使用时间')).toBeTruthy();
      expect(screen.queryByText('属性')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '编辑' }));
      expect(container.querySelector('.ltm-detail-body.ltm-form-body')).toBeTruthy();
      expect(container.querySelector('.ltm-detail-head.ltm-form-head')).toBeTruthy();
      expect(container.querySelector('.ltm-form-heading-row + .ltm-form-actions')).toBeTruthy();
      expect(container.querySelector('.ltm-form-heading-row .ltm-form-actions')).toBeNull();
      expect(container.querySelector('.ltm-detail-actions.ltm-form-actions')?.textContent).toContain('保存修改');
    }
  });

  it('collapses summaries and content beyond half of their limits and supports expanding them', async () => {
    const longSummary = '摘'.repeat(1025);
    const longContent = '正'.repeat(2001);
    const record = {
      ...makeSummary('long-memory', longSummary),
      content: longContent,
    };
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [record], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(record);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const expandSummary = await screen.findByRole('button', { name: '展开摘要' });
    const expandContent = screen.getByRole('button', { name: '展开正文' });
    expect(expandSummary.getAttribute('aria-expanded')).toBe('false');
    expect(expandContent.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.ltm-summary-block.collapsed')).toBeTruthy();
    expect(container.querySelector('.ltm-collapsible-content.collapsed')).toBeTruthy();

    fireEvent.click(expandSummary);
    fireEvent.click(expandContent);

    expect(screen.getByRole('button', { name: '收起摘要' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '收起正文' }).getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.ltm-summary-block.collapsed')).toBeNull();
    expect(container.querySelector('.ltm-collapsible-content.collapsed')).toBeNull();
  });

  it('uses the same identity, action, content, tags, and property hierarchy for shared knowledge', async () => {
    const shared = {
      memoryId: 'shared-memory',
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
      memoryInstance: 'defaultInstance',
      memoryType: 'FACTUAL' as const,
      knowledgeSourceType: 'CONFIGURED' as const,
      state: 'ACTIVE' as const,
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-memory',
      ownerUserId: 'owner-1',
      ownerUserName: 'Publisher Alice',
      briefIndex: '共'.repeat(1025),
      content: '享'.repeat(2001),
      labels: ['shared'],
      confidence: 0.9,
      isPinned: false,
      accessCount: 0,
      recallCount: 0,
      extractionCount: 0,
      archivedAt: 0,
      archiveReason: '',
      source: 'manual',
      createTime: 1,
      updateTime: 1,
      version: 1,
    };
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [shared], total: 1, offset: 0, limit: 10 });
    setSubjectId('owner-1');
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));

    expect(await screen.findByRole('toolbar', { name: '共享记忆操作' })).toBeTruthy();
    expect(container.querySelector('.ltm-memory-row.active .ltm-row-title')?.textContent).toBe(shared.briefIndex);
    expect(container.querySelector('.ltm-list-head')?.children.length).toBe(container.querySelector('.ltm-memory-row')?.children.length);
    expect(container.querySelector('.ltm-list-head')?.children).toHaveLength(6);
    expect(screen.getByLabelText('共享记忆属性')).toBeTruthy();
    expect(container.querySelectorAll('.ltm-detail-section')).toHaveLength(3);
    expect(container.querySelector('.ltm-detail-danger-actions')?.textContent).toContain('取消共享');
    expect(container.querySelector('dl.ltm-property-list')).toBeTruthy();
    expect(screen.getAllByText('发布者').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Publisher Alice').length).toBeGreaterThan(0);
    expect(screen.queryByText('订阅')).toBeNull();
    expect(screen.queryByText('复制人数')).toBeNull();
    expect(screen.getByRole('button', { name: '展开摘要' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '展开正文' })).toBeTruthy();
    expect(container.querySelector('.ltm-summary-block.collapsed')).toBeTruthy();
    expect(container.querySelector('.ltm-collapsible-content.collapsed')).toBeTruthy();
  });

  it('hides unpublish button for non-owner shared memories', async () => {
    const shared = {
      memoryId: 'shared-memory-other',
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
      memoryInstance: 'defaultInstance',
      memoryType: 'FACTUAL' as const,
      knowledgeSourceType: 'CONFIGURED' as const,
      state: 'ACTIVE' as const,
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-memory',
      ownerUserId: 'owner-1',
      ownerUserName: 'Publisher Alice',
      briefIndex: '他人共享记忆',
      content: '内容',
      labels: [],
      confidence: 0.9,
      isPinned: false,
      accessCount: 0,
      recallCount: 0,
      extractionCount: 0,
      archivedAt: 0,
      archiveReason: '',
      source: 'manual',
      createTime: 1,
      updateTime: 1,
      version: 1,
    };
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [shared], total: 1, offset: 0, limit: 10 });
    setSubjectId('current-user');
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));

    expect(await screen.findByRole('toolbar', { name: '共享记忆操作' })).toBeTruthy();
    expect(container.querySelector('.ltm-detail-danger-actions')).toBeNull();
    expect(container.querySelector('.ltm-detail-actions')?.textContent).toContain('复制到我的记忆');
  });

  it('opens the first page of My Memories after creating a shared-memory copy', async () => {
    const shared = {
      ...makeSummary('shared-new-copy', 'shared new copy'),
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-new-copy',
      ownerUserId: 'owner-1',
      ownerUserName: 'Publisher Alice',
    };
    const fork = { ...makeSummary('fork-new-copy', 'fork new copy'), sharingState: 'FORK' as const, sourceMemoryId: shared.memoryId };
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [shared], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.copyPublishedMemory).mockResolvedValueOnce([
      { memoryId: fork.memoryId, record: fork, sourceMemoryId: shared.memoryId, copyStatus: 'COPIED' },
    ]);

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));
    fireEvent.click(await screen.findByRole('button', { name: '复制到我的记忆' }));

    expect(await screen.findByText('已复制，副本已加入我的记忆')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('我的记忆').closest('button')?.className).toContain('active'));
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ACTIVE', limit: 10, offset: 0 })),
    );
  });

  it.each([
    ['ACTIVE' as const, '“我的记忆”中已存在相同记忆，请勿重复复制。'],
    ['ARCHIVED' as const, '“已归档”中已存在相同记忆，请勿重复复制。'],
  ])('only warns when the shared-memory copy already exists in state %s', async (state, expectedMessage) => {
    const shared = {
      ...makeSummary(`shared-existing-${state}`, 'shared existing'),
      sharingState: 'SHARED' as const,
      sourceMemoryId: `source-existing-${state}`,
      ownerUserId: 'owner-1',
      ownerUserName: 'Publisher Alice',
    };
    const fork = {
      ...makeSummary(`fork-existing-${state}`, 'fork existing', state),
      sharingState: 'FORK' as const,
      sourceMemoryId: shared.memoryId,
    };
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [shared], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.copyPublishedMemory).mockResolvedValueOnce([
      { memoryId: fork.memoryId, record: fork, sourceMemoryId: shared.memoryId, copyStatus: 'EXISTING' },
    ]);

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /共享记忆库/ }).className).toContain('active'));
    const mineCallsBeforeCopy = vi.mocked(memoryService.listLongTermMemory).mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: '复制到我的记忆' }));

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(screen.getByRole('button', { name: /共享记忆库/ }).className).toContain('active');
    expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(mineCallsBeforeCopy);
  });

  it('describes archive retention without hard-coding the default duration', async () => {
    const summary = makeSummary('memory-archive-copy', 'archive copy');
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [summary], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(summary);

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '归档' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('归档后，记忆将移入“已归档”。达到系统配置的归档保留期限后，系统会自动删除。')).toBeTruthy();
    expect(within(dialog).queryByText(/90\s*天/)).toBeNull();
  });

  it('keeps the current page after pinning or unpublishing from a later page', async () => {
    const secondPageMemory = makeSummary('memory-pin-10', 'later page memory');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [makeSummary('memory-0', 'first page memory')], total: 12, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [secondPageMemory], total: 12, offset: 10, limit: 10 })
      .mockResolvedValueOnce({ items: [secondPageMemory], total: 12, offset: 10, limit: 10 })
      .mockResolvedValueOnce({ items: [secondPageMemory], total: 12, offset: 10, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValue(secondPageMemory);
    vi.mocked(memoryService.patchLongTermMemory).mockResolvedValue({
      memoryId: secondPageMemory.memoryId,
      currentVersion: 1,
      record: secondPageMemory,
    });
    vi.mocked(memoryService.publishLongTermMemory).mockResolvedValue({
      publishedMemory: { ...secondPageMemory, memoryId: 'published-copy', sharingState: 'SHARED' },
      sourceMemoryId: secondPageMemory.memoryId,
      ownerUserId: 'real-subject',
    });
    vi.mocked(memoryService.unpublishLongTermMemory).mockResolvedValue({
      memoryId: 'published-copy',
    });

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const pagination = await waitFor(() => {
      const element = container.querySelector('.ant-pagination');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.click(within(pagination).getByText('2'));
    await screen.findAllByText('later page memory');

    fireEvent.click(screen.getByRole('button', { name: '设为保持不变' }));
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 10 })));

    expect(within(pagination).getByText('2').closest('.ant-pagination-item')?.classList.contains('ant-pagination-item-active')).toBe(true);
  });

  it('keeps the current page after unpublishing a shared memory from the shared tab', async () => {
    const secondPageShared = {
      ...makeSummary('shared-unpublish-10', 'later shared memory'),
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-unpublish',
      ownerUserId: 'owner-1',
    };
    setSubjectId('owner-1');
    vi.mocked(memoryService.listPublishedLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 12, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [secondPageShared], total: 12, offset: 10, limit: 10 })
      .mockResolvedValueOnce({ items: [secondPageShared], total: 12, offset: 10, limit: 10 });
    vi.mocked(memoryService.unpublishLongTermMemory).mockResolvedValue({
      memoryId: secondPageShared.memoryId,
    });

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /共享记忆库/ }));
    const pagination = await waitFor(() => {
      const element = container.querySelector('.ant-pagination');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.click(within(pagination).getByText('2'));
    await screen.findAllByText('later shared memory');

    fireEvent.click(screen.getByRole('button', { name: '取消共享' }));
    await waitFor(() => expect(memoryService.unpublishLongTermMemory).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(memoryService.listPublishedLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 10 })),
    );

    expect(within(pagination).getByText('2').closest('.ant-pagination-item')?.classList.contains('ant-pagination-item-active')).toBe(true);
  });

  it('switches to the shared tab on page one after publishing a memory', async () => {
    const minePageMemory = makeSummary('memory-publish-0', 'publishable memory');
    const publishedCopy = {
      ...minePageMemory,
      memoryId: 'published-copy',
      sharingState: 'SHARED' as const,
      sourceMemoryId: minePageMemory.memoryId,
      ownerUserId: 'real-subject',
    };
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValue({
      items: [minePageMemory],
      total: 1,
      offset: 0,
      limit: 10,
    });
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValue({
      items: [publishedCopy],
      total: 1,
      offset: 0,
      limit: 10,
    });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValue(minePageMemory);
    vi.mocked(memoryService.publishLongTermMemory).mockResolvedValue({
      publishedMemory: publishedCopy,
      sourceMemoryId: minePageMemory.memoryId,
      ownerUserId: 'real-subject',
    });

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '共享到记忆库' }));
    await waitFor(() => expect(memoryService.publishLongTermMemory).toHaveBeenCalledTimes(1));

    expect(await screen.findByRole('button', { name: /共享记忆库/ })).toBeTruthy();
    await waitFor(() =>
      expect(memoryService.listPublishedLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 0 })),
    );
    expect(screen.getByRole('button', { name: /共享记忆库/ }).className).toContain('active');
    expect(container.querySelector('.ltm-row-shared .ltm-row-title')?.textContent).toBe(minePageMemory.briefIndex);
  });

  it('returns to page one after creating a memory from a later page', async () => {
    const created = makeSummary('memory-created', 'created memory');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [makeSummary('memory-10', 'later page source')], total: 12, offset: 10, limit: 10 })
      .mockResolvedValueOnce({ items: [makeSummary('memory-10', 'later page source')], total: 12, offset: 10, limit: 10 })
      .mockResolvedValueOnce({ items: [created], total: 13, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValue(created);
    vi.mocked(memoryService.manualSaveLongTermMemory).mockResolvedValueOnce(created);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const pagination = await waitFor(() => {
      const element = container.querySelector('.ant-pagination');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(1));
    fireEvent.click(within(pagination).getByText('2'));
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2));
    // 初始渲染与翻页各消耗一次 mock 后，翻页后无详情选中（第 2 页首条会选中并请求详情）
    await screen.findByRole('button', { name: '＋ 新增记忆' });
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增记忆' }));
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'created memory' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'created content' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 0 })));
    await waitFor(() => expect(screen.getAllByText('created memory').length).toBeGreaterThan(0));
    expect(within(pagination).getByText('1').closest('.ant-pagination-item')?.classList.contains('ant-pagination-item-active')).toBe(true);
  });

  it('uses Ant Design pagination controls and shared queryText search', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => makeSummary(`memory-${index}`, `memory ${index}`));
    const lastPage = [makeSummary('memory-20', 'memory 20')];
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: firstPage, total: 21, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: lastPage, total: 21, offset: 20, limit: 10 })
      .mockResolvedValueOnce({ items: firstPage, total: 21, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockImplementation(async (memoryId) => (memoryId === 'memory-20' ? lastPage[0]! : firstPage[0]!));

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    const pagination = await waitFor(() => {
      const element = container.querySelector('.ant-pagination');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(screen.getByText('共 21 条')).toBeTruthy();
    expect(screen.getByRole('button', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '尾页' })).toBeTruthy();
    expect(pagination.querySelector('.ant-pagination-options-quick-jumper input')).toBeTruthy();
    expect(pagination.querySelector('.ant-select')).toBeTruthy();
    fireEvent.click(within(pagination).getByText('3'));
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 20 })));
    fireEvent.click(within(pagination).getByText('1'));
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 0 })));

    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 10 });
    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));
    fireEvent.change(screen.getByPlaceholderText('搜索摘要或正文'), { target: { value: 'BGP' } });
    await waitFor(() =>
      expect(memoryService.listPublishedLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ queryText: 'BGP', limit: 10, offset: 0 })),
    );
  });

  it('uses the same numbered pagination in shared and archived tabs', async () => {
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 21, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 21, offset: 20, limit: 10 });
    vi.mocked(memoryService.listPublishedLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 21, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [], total: 21, offset: 20, limit: 10 });

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '共享记忆库' }));
    await waitFor(() =>
      expect(memoryService.listPublishedLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 0 })),
    );
    fireEvent.click(within(container.querySelector('.ant-pagination') as HTMLElement).getByText('3'));
    await waitFor(() =>
      expect(memoryService.listPublishedLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 20 })),
    );

    fireEvent.click(screen.getByRole('button', { name: '已归档' }));
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ARCHIVED', limit: 10, offset: 0 })),
    );
    fireEvent.click(within(container.querySelector('.ant-pagination') as HTMLElement).getByText('3'));
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ARCHIVED', limit: 10, offset: 20 })),
    );
    fireEvent.click(within(container.querySelector('.ant-pagination') as HTMLElement).getByText('1'));
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ARCHIVED', limit: 10, offset: 0 })),
    );
  });

  it('jumps directly to a numbered page', async () => {
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => ({
      items: [makeSummary(`memory-${params.offset ?? 0}`, `memory ${params.offset ?? 0}`)],
      total: 60,
      offset: params.offset ?? 0,
      limit: params.limit ?? 10,
    }));
    vi.mocked(memoryService.getLongTermMemory).mockImplementation(async (memoryId) => makeSummary(memoryId, memoryId));

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const pagination = await waitFor(() => {
      const element = container.querySelector('.ant-pagination');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.click(within(pagination).getByText('6'));
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenCalledWith(expect.objectContaining({ state: 'ACTIVE', limit: 10, offset: 50 })),
    );
    expect(within(pagination).getByText('6').closest('.ant-pagination-item')?.classList.contains('ant-pagination-item-active')).toBe(true);
  });

  it('keeps the current page after deleting a memory from a later page', async () => {
    const firstPageMemory = makeSummary('memory-0', 'first page memory');
    const secondPageMemory = makeSummary('memory-10', 'second page memory');
    const remainingSecondPageMemory = makeSummary('memory-11', 'remaining second page memory');
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [firstPageMemory], total: 12, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [secondPageMemory], total: 12, offset: 10, limit: 10 })
      .mockResolvedValueOnce({ items: [remainingSecondPageMemory], total: 11, offset: 10, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory)
      .mockResolvedValueOnce(firstPageMemory)
      .mockResolvedValueOnce(secondPageMemory)
      .mockResolvedValueOnce(remainingSecondPageMemory);
    vi.mocked(memoryService.deleteLongTermMemory).mockResolvedValueOnce({ memoryId: secondPageMemory.memoryId });

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const pagination = await waitFor(() => {
      const element = container.querySelector('.ant-pagination');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.click(within(pagination).getByText('2'));
    await screen.findByText('second page memory');
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    await screen.findByText('remaining second page memory');
    expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 10 }));
    expect(within(pagination).getByText('2').closest('.ant-pagination-item')?.classList.contains('ant-pagination-item-active')).toBe(true);
  });

  it('jumps to the first and last page and resets to page one when page size changes', async () => {
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => ({
      items: [makeSummary(`memory-${params.offset ?? 0}`, `memory ${params.offset ?? 0}`)],
      total: 95,
      offset: params.offset ?? 0,
      limit: params.limit ?? 10,
    }));
    vi.mocked(memoryService.getLongTermMemory).mockImplementation(async (memoryId) => makeSummary(memoryId, memoryId));

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await waitFor(() => expect(container.querySelector('.ant-pagination')).toBeTruthy());
    const firstPage = screen.getByRole('button', { name: '首页' }) as HTMLButtonElement;
    const lastPage = screen.getByRole('button', { name: '尾页' }) as HTMLButtonElement;
    expect(firstPage.disabled).toBe(true);

    fireEvent.click(lastPage);
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 90 })));
    expect(lastPage.disabled).toBe(true);

    fireEvent.click(firstPage);
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 0 })));

    const pagination = container.querySelector('.ant-pagination') as HTMLElement;
    const quickJump = pagination.querySelector('.ant-pagination-options-quick-jumper input') as HTMLInputElement;
    fireEvent.change(quickJump, { target: { value: '6' } });
    fireEvent.keyUp(quickJump, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 50 })));

    fireEvent.mouseDown(pagination.querySelector('.ant-select-selector') as HTMLElement);
    const pageSize20 = await screen.findByRole('option', { name: /20/ });
    fireEvent.click(pageSize20);
    await waitFor(() => expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20, offset: 0 })));
  });

  it('defaults manual memory type and confidence while keeping empty labels valid', async () => {
    vi.mocked(memoryService.manualSaveLongTermMemory).mockResolvedValueOnce(makeSummary('saved', 'valid summary'));
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增记忆' }));

    expect(screen.queryByLabelText('记忆更新方式')).toBeNull();
    const typeControl = screen.getByLabelText('记忆类型') as HTMLSelectElement;
    const confidenceControl = screen.getByLabelText('置信度') as HTMLInputElement;
    expect(typeControl.value).toBe('USER_CHARACTERISTICS');
    expect(confidenceControl.value).toBe('1');
    expect(typeControl.classList.contains('ltm-form-primary-control')).toBe(true);
    expect(confidenceControl.classList.contains('ltm-form-primary-control')).toBe(true);
    expect(screen.getByText('个性化配置', { selector: '.ltm-chip' })).toBeTruthy();
    expect(Array.from(typeControl.options).some((option) => option.text === '个性化配置')).toBe(true);
    expect(screen.getByText('摘要必填，最多 2048 个字符')).toBeTruthy();
    expect(screen.getByText('正文必填，最多 4000 个字符')).toBeTruthy();
    expect(screen.getByText('0/2048')).toBeTruthy();
    expect(screen.getByText('0/4000')).toBeTruthy();
    expect(screen.getByText('标签可为空，最多 10 个；单个标签最多 256 个字符')).toBeTruthy();

    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'valid summary' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'valid content' } });
    expect(screen.getByText(`${Array.from('valid summary').length}/2048`)).toBeTruthy();
    expect(screen.getByText(`${Array.from('valid content').length}/4000`)).toBeTruthy();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(memoryService.manualSaveLongTermMemory).toHaveBeenCalledWith(
        expect.objectContaining({ memoryType: 'USER_CHARACTERISTICS', confidence: 1, labels: [] }),
      ),
    );
    expect(memoryService.patchLongTermMemory).not.toHaveBeenCalled();
  });

  it.each([
    {
      locale: 'zh-CN',
      addButton: '＋ 新增记忆',
      summary: '摘要',
      content: '正文',
      save: '保存',
      expected: '个人设定记忆最多只能创建 50 条，请删除不再需要的记忆后重试。',
    },
    {
      locale: 'en-US',
      addButton: '+ Add Memory',
      summary: 'Summary',
      content: 'Content',
      save: 'Save',
      expected: 'You can create up to 50 user-configured memories. Delete an unused memory and try again.',
    },
  ])('localizes the configured-memory capacity error in $locale', async ({ locale, addButton, summary, content, save, expected }) => {
    const serverMessage = 'At most 50 configured long-term memories are allowed.';
    await i18n.changeLanguage(locale);
    vi.mocked(memoryService.manualSaveLongTermMemory).mockRejectedValueOnce(makeApiError('LTM_WRITE_INVALID', serverMessage));
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: addButton }));
    fireEvent.change(screen.getByLabelText(summary), { target: { value: 'valid summary' } });
    fireEvent.change(screen.getByLabelText(content), { target: { value: 'valid content' } });
    fireEvent.click(screen.getByRole('button', { name: save }));

    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.queryByText(serverMessage)).toBeNull();
  });

  it('keeps other LTM_WRITE_INVALID messages unchanged', async () => {
    const validationMessage = 'Manual long-term memory request is invalid.';
    vi.mocked(memoryService.manualSaveLongTermMemory).mockRejectedValueOnce(makeApiError('LTM_WRITE_INVALID', validationMessage));
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '＋ 新增记忆' }));
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'valid summary' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'valid content' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText(validationMessage)).toBeTruthy();
  });

  it.each([
    {
      locale: 'zh-CN',
      action: 'create',
      open: '＋ 新增记忆',
      save: '保存',
      formTitle: '新增长期记忆',
      summaryLabel: '摘要',
      contentLabel: '正文',
      expectedMessage: '记忆内容未通过安全审核，请修改摘要、正文或标签后重试。',
    },
    {
      locale: 'en-US',
      action: 'create',
      open: '+ Add Memory',
      save: 'Save',
      formTitle: 'Add Long-term Memory',
      summaryLabel: 'Summary',
      contentLabel: 'Content',
      expectedMessage: 'Memory content did not pass the security review. Revise the summary, content, or tags and try again.',
    },
    {
      locale: 'zh-CN',
      action: 'edit',
      open: '编辑',
      save: '保存修改',
      formTitle: '编辑记忆',
      summaryLabel: '摘要',
      contentLabel: '正文',
      expectedMessage: '记忆内容未通过安全审核，请修改摘要、正文或标签后重试。',
    },
    {
      locale: 'en-US',
      action: 'edit',
      open: 'Edit',
      save: 'Save Changes',
      formTitle: 'Edit Memory',
      summaryLabel: 'Summary',
      contentLabel: 'Content',
      expectedMessage: 'Memory content did not pass the security review. Revise the summary, content, or tags and try again.',
    },
  ])(
    'localizes a guardrail-blocked $action in $locale and retains the form',
    async ({ locale, action, open, save, formTitle, summaryLabel, contentLabel, expectedMessage }) => {
      const serverMessage = 'Long-term memory content was blocked by the security guardrail.';
      const attemptedSummary = `${action} guarded summary`;
      const attemptedContent = `${action} guarded content`;
      await i18n.changeLanguage(locale);
      if (action === 'edit') {
        const existing = makeSummary('guarded-memory', 'existing summary');
        vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({
          items: [existing],
          total: 1,
          offset: 0,
          limit: 10,
        });
        vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(existing);
      }
      vi.mocked(memoryService.manualSaveLongTermMemory).mockRejectedValueOnce(makeApiError('LTM_CONTENT_GUARD_BLOCKED', serverMessage));
      render(
        <AntdApp>
          <MemoryManagePage />
        </AntdApp>,
      );

      fireEvent.click(await screen.findByRole('button', { name: open }));
      fireEvent.change(screen.getByLabelText(summaryLabel), { target: { value: attemptedSummary } });
      fireEvent.change(screen.getByLabelText(contentLabel), { target: { value: attemptedContent } });
      fireEvent.click(screen.getByRole('button', { name: save }));

      expect(await screen.findByText(expectedMessage)).toBeTruthy();
      expect(screen.queryByText(serverMessage)).toBeNull();
      expect(screen.getByRole('heading', { name: formTitle })).toBeTruthy();
      expect((screen.getByLabelText(summaryLabel) as HTMLTextAreaElement).value).toBe(attemptedSummary);
      expect((screen.getByLabelText(contentLabel) as HTMLTextAreaElement).value).toBe(attemptedContent);
    },
  );

  it.each([
    ['LTM_CONTENT_GUARD_UNAVAILABLE', 'Memory content security review is unavailable.'],
    ['LTM_CONTENT_GUARD_CANCELED', 'Memory content security review was canceled.'],
  ])('does not remap %s as a blocked-content rejection', async (code, serverMessage) => {
    vi.mocked(memoryService.manualSaveLongTermMemory).mockRejectedValueOnce(makeApiError(code, serverMessage));
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '＋ 新增记忆' }));
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'valid summary' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'valid content' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText(serverMessage)).toBeTruthy();
    expect(screen.queryByText('记忆内容未通过安全审核，请修改摘要、正文或标签后重试。')).toBeNull();
  });

  it('edits learned memory type and confidence while preserving its source, then reloads the persisted detail', async () => {
    const beforeSave = {
      ...makeSummary('memory-refresh', 'before save'),
      knowledgeSourceType: 'LEARNED' as const,
    };
    const afterSave = {
      ...beforeSave,
      memoryType: 'CONCEPTUAL' as const,
      confidence: 0.35,
      briefIndex: 'after save',
      content: 'persisted content',
      version: 2,
    };
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [beforeSave], total: 1, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [afterSave], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(beforeSave).mockResolvedValueOnce(afterSave);
    vi.mocked(memoryService.manualSaveLongTermMemory).mockResolvedValueOnce(afterSave);

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    await screen.findByRole('button', { name: '编辑' });
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('记忆类型') as HTMLSelectElement).value).toBe(beforeSave.memoryType);
    expect((screen.getByLabelText('置信度') as HTMLInputElement).value).toBe(String(beforeSave.confidence));
    expect(screen.getAllByText('事实记忆', { selector: '.ltm-chip' }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('记忆类型'), { target: { value: 'CONCEPTUAL' } });
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '0.35' } });
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'after save' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(memoryService.manualSaveLongTermMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: beforeSave.memoryId,
          memoryType: 'CONCEPTUAL',
          knowledgeSourceType: 'LEARNED',
          confidence: 0.35,
        }),
      ),
    );
    await waitFor(() => expect(memoryService.getLongTermMemory).toHaveBeenLastCalledWith(beforeSave.memoryId, expect.anything()));
    await waitFor(() => expect(screen.getAllByText('after save')).not.toHaveLength(0));
    expect(memoryService.listLongTermMemory).toHaveBeenCalledTimes(2);
  });

  it('rejects confidence outside the inclusive zero-to-one range or with more than two decimal places', () => {
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增记忆' }));
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'valid summary' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'valid content' } });

    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '1.01' } });
    expect(save.disabled).toBe(true);
    expect(screen.getByText('请输入 0 到 1 之间的数值').className).toContain('error');
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '1.0000000000000000000000000009' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '0.123' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '1e-1' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '0.35' } });
    expect(save.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('置信度'), { target: { value: '0' } });
    expect(save.disabled).toBe(false);
  });

  it('omits archiveReason when restoring an archived memory', async () => {
    const archived = makeSummary('archived-restore', 'restore me', 'ARCHIVED');
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => ({
      items: params.state === 'ARCHIVED' && params.limit === 10 ? [archived] : [],
      total: params.state === 'ARCHIVED' ? 1 : 0,
      offset: params.offset ?? 0,
      limit: params.limit ?? 10,
    }));
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValue(archived);
    vi.mocked(memoryService.patchLongTermMemory).mockResolvedValue({ memoryId: archived.memoryId, currentVersion: 1, record: archived });

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole('button', { name: '已归档' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销归档' }));

    await waitFor(() =>
      expect(memoryService.patchLongTermMemory).toHaveBeenCalledWith('archived-restore', {
        memoryInstance: 'defaultInstance',
        targetState: 'ACTIVE',
        expectedVersion: 1,
      }),
    );
  });

  it('keeps identity fields out of the shared publish request body', async () => {
    const record = makeSummary('publish-source', 'publish me');
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValue({ items: [record], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValue(record);
    vi.mocked(memoryService.publishLongTermMemory).mockResolvedValue({
      publishedMemory: { ...record, memoryId: 'published-copy', sharingState: 'SHARED' },
      sourceMemoryId: record.memoryId,
      ownerUserId: 'real-subject',
    });

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '共享到记忆库' }));

    await waitFor(() =>
      expect(memoryService.publishLongTermMemory).toHaveBeenCalledWith('publish-source', {
        memoryInstance: 'defaultInstance',
        reasonCode: 'user_publish',
      }),
    );
  });

  it('shows the fork sharing restriction from the disabled button title and keeps list headers aligned with rows', async () => {
    const fork = { ...makeSummary('fork-1', 'fork memory'), sharingState: 'FORK' as const, sourceMemoryId: 'shared-1' };
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [fork], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(fork);
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const share = (await screen.findByRole('button', { name: '共享到记忆库' })) as HTMLButtonElement;
    expect(share.disabled).toBe(true);
    expect(share.title).toBe('复制副本不能再次共享');
    expect(screen.queryByText('复制副本不能再次共享')).toBeNull();
    expect(container.querySelector('.ltm-list-head')?.children.length).toBe(container.querySelector('.ltm-memory-row')?.children.length);
    await i18n.changeLanguage('en-US');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share' }).title).toBe('Copied memories cannot be shared again'));
    expect(screen.queryByText('Copied memories cannot be shared again')).toBeNull();
  });

  it.each([
    { name: 'success', rejected: false, feedback: '正文已复制' },
    { name: 'failure', rejected: true, feedback: '复制正文失败' },
  ])('reports clipboard $name and copies the original JSON content', async ({ rejected, feedback }) => {
    const content = '{"category":"FACTUAL","nested":{"enabled":true}}';
    const summary = {
      memoryId: `memory-copy-${rejected ? 'failure' : 'success'}`,
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
      memoryInstance: 'defaultInstance',
      memoryType: 'FACTUAL' as const,
      knowledgeSourceType: 'CONFIGURED' as const,
      state: 'ACTIVE' as const,
      sharingState: 'PRIVATE' as const,
      briefIndex: 'copy memory',
      content,
      labels: [],
      confidence: 0.8,
      isPinned: false,
      accessCount: 0,
      recallCount: 0,
      extractionCount: 0,
      archivedAt: 0,
      archiveReason: '',
      source: 'manual',
      createTime: 1,
      updateTime: 1,
      version: 1,
    };
    const writeText = rejected ? vi.fn().mockRejectedValue(new Error('clipboard denied')) : vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [summary], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(summary);

    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '复制正文' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(content));
    expect(await screen.findByText(feedback)).toBeTruthy();
  });

  it('redacts absolute paths in private list, detail, and clipboard projections while preserving edit values', async () => {
    const rawSummaryPath = '/opt/nextagent/config.json';
    const rawContentPath = 'C:\\Users\\operator\\alarm.log';
    const briefIndex = `Config at ${rawSummaryPath}`;
    const content = `Inspect ${rawContentPath}\nkeep https://example.com/a/b and ./logs/alarm.log`;
    const record = {
      ...makeSummary('memory-redacted-private', briefIndex),
      content,
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [record], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(record);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await screen.findByTestId('memory-text-content');
    expect(container.textContent).not.toContain(rawSummaryPath);
    expect(container.textContent).not.toContain(rawContentPath);
    expect(container.textContent).toContain('[REDACTED_PATH]');
    expect(container.textContent).toContain('https://example.com/a/b');
    expect(container.textContent).toContain('./logs/alarm.log');

    fireEvent.click(screen.getByRole('button', { name: '复制正文' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Inspect [REDACTED_PATH]\nkeep https://example.com/a/b and ./logs/alarm.log'));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('摘要') as HTMLInputElement).value).toBe(briefIndex);
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe(content);
  });

  it('normalizes Markdown-escaped redaction placeholders for viewing and copying while preserving edit values', async () => {
    const escapedPlaceholder = '[REDACTED\\_PATH]';
    const briefIndex = `Config at ${escapedPlaceholder}`;
    const content = `Inspect ${escapedPlaceholder}`;
    const record = {
      ...makeSummary('memory-escaped-redaction-placeholder', briefIndex),
      content,
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [record], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(record);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await screen.findByTestId('memory-text-content');
    expect(container.textContent).toContain('[REDACTED_PATH]');
    expect(container.textContent).not.toContain(escapedPlaceholder);

    fireEvent.click(screen.getByRole('button', { name: '复制正文' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Inspect [REDACTED_PATH]'));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('摘要') as HTMLInputElement).value).toBe(briefIndex);
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe(content);
  });

  it('redacts Chat-sensitive content categories for viewing and copying while preserving IP and edit values', async () => {
    const briefIndex = 'password=hunter2 phone 13800138000';
    const content = [
      'Bearer abcdefghijk',
      'sk-abcdefghijk',
      '/opt/nextagent/config.json',
      '-----BEGIN PRIVATE KEY-----',
      'key-material',
      '-----END PRIVATE KEY-----',
      'IPv4 10.0.0.1 IPv6 2001:db8::1',
    ].join('\n');
    const record = {
      ...makeSummary('memory-sensitive-display-policy', briefIndex),
      content,
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [record], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(record);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    await screen.findByTestId('memory-text-content');
    expect(container.textContent).toContain('[REDACTED_SECRET]');
    expect(container.textContent).toContain('[REDACTED_TOKEN]');
    expect(container.textContent).toContain('[REDACTED_PHONE]');
    expect(container.textContent).toContain('[REDACTED_PATH]');
    expect(container.textContent).toContain('10.0.0.1');
    expect(container.textContent).toContain('2001:db8::1');
    expect(container.textContent).not.toContain('hunter2');
    expect(container.textContent).not.toContain('abcdefghijk');
    expect(container.textContent).not.toContain('13800138000');
    expect(container.textContent).not.toContain('key-material');
    expect(container.textContent).not.toContain('BEGIN PRIVATE KEY');

    fireEvent.click(screen.getByRole('button', { name: '复制正文' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        ['Bearer [REDACTED_TOKEN]', '[REDACTED_TOKEN]', '[REDACTED_PATH]', '[REDACTED_SECRET]', 'IPv4 10.0.0.1 IPv6 2001:db8::1'].join('\n'),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('摘要') as HTMLInputElement).value).toBe(briefIndex);
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe(content);
  });

  it('redacts absolute paths in shared and archived list and detail projections', async () => {
    const sharedPath = '/srv/nextagent/shared.json';
    const archivedPath = 'D:\\nextagent\\archive.log';
    const shared = {
      ...makeSummary('memory-redacted-shared', `Shared ${sharedPath}`),
      sharingState: 'SHARED' as const,
      sourceMemoryId: 'source-redacted-shared',
      ownerUserId: 'owner-1',
      content: `Shared content ${sharedPath}`,
    };
    const archived = {
      ...makeSummary('memory-redacted-archived', `Archived ${archivedPath}`, 'ARCHIVED'),
      content: `Archived content ${archivedPath}`,
    };
    vi.mocked(memoryService.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 })
      .mockResolvedValueOnce({ items: [archived], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [shared], total: 1, offset: 0, limit: 10 });
    vi.mocked(memoryService.getLongTermMemory).mockResolvedValueOnce(archived);

    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));
    await screen.findByRole('toolbar', { name: '共享记忆操作' });
    expect(container.textContent).not.toContain(sharedPath);
    expect(container.textContent).toContain('[REDACTED_PATH]');

    fireEvent.click(screen.getByRole('button', { name: '已归档' }));
    await screen.findByRole('button', { name: '撤销归档' });
    expect(container.textContent).not.toContain(archivedPath);
    expect(container.textContent).toContain('[REDACTED_PATH]');
  });
});

describe('MemoryManagePage JSON memory transfer', () => {
  it('downloads the fixed template and only accepts JSON without calling the memory API', async () => {
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    const input = screen.getByLabelText('导入记忆') as HTMLInputElement;
    expect(input.accept).toContain('.json');
    expect(input.accept).not.toContain('.csv');
    expect(input.accept).not.toContain('.xlsx');

    fireEvent.click(screen.getByRole('button', { name: '下载导入模板' }));

    expect(memoryTransfer.downloadMemoryImportTemplate).toHaveBeenCalledTimes(1);
    expect(memoryService.batchCreateLongTermMemory).not.toHaveBeenCalled();
  });

  it('previews, removes, capacity-checks, and confirms one batch with original indexes', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals)
      .mockResolvedValueOnce({ mine: 0, shared: 0, archived: 0 })
      .mockResolvedValueOnce({ mine: 2, shared: 0, archived: 0 });
    mockConfiguredCapacity(40, 8);
    vi.mocked(memoryService.batchCreateLongTermMemory).mockResolvedValueOnce({
      successCount: 2,
      failCount: 0,
      memoryIds: ['imported-1', 'imported-2'],
    });
    const { container } = render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: {
        files: [
          makeTransferFile([
            { briefIndex: 'name', content: 'zhang san' },
            { briefIndex: 'age', content: '28' },
            { briefIndex: 'skill', content: 'NodeJs' },
          ]),
        ],
      },
    });

    expect(await screen.findByRole('dialog', { name: '确认导入记忆' })).toBeTruthy();
    expect(screen.getByText('name')).toBeTruthy();
    expect(screen.getByText('28')).toBeTruthy();
    expect(memoryService.batchCreateLongTermMemory).not.toHaveBeenCalled();
    expect(await screen.findByText('个人导入记忆限制50条，已有 48 条，可导入2条。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除 age' }));
    expect(screen.queryByText('28')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    await waitFor(() => expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(1));
    const request = vi.mocked(memoryService.batchCreateLongTermMemory).mock.calls[0]?.[0];
    expect(request?.items).toHaveLength(2);
    expect(request?.items.map((item) => item.idempotencyKey)).toEqual([
      expect.stringMatching(/^ltm-import-json-v2-[0-9a-f-]{36}-0$/),
      expect.stringMatching(/^ltm-import-json-v2-[0-9a-f-]{36}-2$/),
    ]);
    expect(request?.items[0]).toMatchObject({
      memoryType: 'USER_CHARACTERISTICS',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'name',
      content: 'zhang san',
      labels: [],
      confidence: 1,
      state: 'ACTIVE',
    });
    expect(request?.items[0]).not.toHaveProperty('tenantId');
    expect(request?.items[0]).not.toHaveProperty('agentId');
    expect(await screen.findByText('已成功处理 2 条记忆。')).toBeTruthy();
    await waitFor(() => expect(memoryService.getLongTermMemoryTabTotals).toHaveBeenCalledTimes(2));
    expect(container.querySelector('.ltm-tab-count')?.textContent).toBe('2');
  });

  it('allows first confirmation even when existing memories plus pending items exceed 50', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 0, shared: 0, archived: 0 });
    mockConfiguredCapacity(40, 8);
    vi.mocked(memoryService.batchCreateLongTermMemory).mockResolvedValueOnce({
      successCount: 3,
      failCount: 0,
      memoryIds: ['imported-1', 'imported-2', 'imported-3'],
    });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [makeTransferFile([makeTransferEntry(1), makeTransferEntry(2), makeTransferEntry(3)])] },
    });

    expect(await screen.findByText('个人导入记忆限制50条，已有 48 条，可导入2条。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    await waitFor(() => expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(1));
    expect(vi.mocked(memoryService.batchCreateLongTermMemory).mock.calls[0]?.[0]?.items).toHaveLength(3);
  });

  it('counts only configured active and archived memories for import capacity', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 80, shared: 0, archived: 20 });
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => {
      const isArchived = params.state === 'ARCHIVED';
      const configuredTotal = isArchived ? 4 : 34;
      const unfilteredTotal = isArchived ? 20 : 80;
      return {
        items: [],
        total: params.knowledgeSourceType === 'CONFIGURED' ? configuredTotal : unfilteredTotal,
        offset: params.offset ?? 0,
        limit: params.limit ?? 10,
      };
    });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [makeTransferFile([makeTransferEntry(1)])] },
    });

    expect(await screen.findByText('个人导入记忆限制50条，已有 38 条，可导入12条。')).toBeTruthy();
    expect(memoryService.listLongTermMemory).toHaveBeenCalledWith({
      memoryInstance: 'defaultInstance',
      knowledgeSourceType: 'CONFIGURED',
      state: 'ACTIVE',
      limit: 1,
      offset: 0,
    });
    expect(memoryService.listLongTermMemory).toHaveBeenCalledWith({
      memoryInstance: 'defaultInstance',
      knowledgeSourceType: 'CONFIGURED',
      state: 'ARCHIVED',
      limit: 1,
      offset: 0,
    });
  });

  it('keeps deletion transient, disables an empty preview, and cancels without writing', async () => {
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [makeTransferFile([makeTransferEntry(1)])] },
    });
    const dialog = await screen.findByRole('dialog', { name: '确认导入记忆' });
    await within(dialog).findByText('个人导入记忆限制50条，已有 0 条，可导入50条。');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除 BGP memory 1' }));

    expect(within(dialog).getByText('暂无待导入记忆，可继续选择 JSON 文件。')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '重新选择文件' })).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '导入记忆' }) as HTMLButtonElement).disabled).toBe(false));
    expect(memoryService.batchCreateLongTermMemory).not.toHaveBeenCalled();
  });

  it('shows a capacity load failure but still allows confirmation', async () => {
    vi.mocked(memoryService.getLongTermMemoryTabTotals).mockResolvedValueOnce({ mine: 0, shared: 0, archived: 0 });
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (params) => {
      if (params.knowledgeSourceType === 'CONFIGURED' && params.state === 'ACTIVE') {
        throw new Error('unavailable');
      }
      return { items: [], total: 0, offset: params.offset ?? 0, limit: params.limit ?? 10 };
    });
    vi.mocked(memoryService.batchCreateLongTermMemory).mockResolvedValueOnce({
      successCount: 1,
      failCount: 0,
      memoryIds: ['imported-1'],
    });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [makeTransferFile([makeTransferEntry(1)])] },
    });

    expect(await screen.findByText('无法检查个人设定记忆容量，请稍后重试。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    await waitFor(() => expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(1));
  });

  it('keeps an unknown batch for an exact idempotent retry', async () => {
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    vi.mocked(memoryService.batchCreateLongTermMemory)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ successCount: 1, failCount: 0, memoryIds: ['imported-1'] });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [makeTransferFile([makeTransferEntry(1)])] },
    });
    await screen.findByText('个人导入记忆限制50条，已有 0 条，可导入50条。');
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    expect(await screen.findByText('导入请求结果未知，当前 1 条记录可能已写入。请保留列表并重试以安全确认。')).toBeTruthy();
    const firstRequest = vi.mocked(memoryService.batchCreateLongTermMemory).mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole('button', { name: '重试导入' }));
    await waitFor(() => expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(memoryService.batchCreateLongTermMemory).mock.calls[1]?.[0]).toEqual(firstRequest);
  });

  it('uses a new idempotency batch when the same file is selected again', async () => {
    vi.mocked(memoryService.batchCreateLongTermMemory)
      .mockResolvedValueOnce({ successCount: 1, failCount: 0, memoryIds: ['imported-1'] })
      .mockResolvedValueOnce({ successCount: 1, failCount: 0, memoryIds: ['imported-2'] });
    const file = makeTransferFile([makeTransferEntry(1)]);
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), { target: { files: [file] } });
    await screen.findByText('个人导入记忆限制50条，已有 0 条，可导入50条。');
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认导入' })).toBeNull());

    fireEvent.change(screen.getByLabelText('导入记忆'), { target: { files: [file] } });
    await screen.findByText('个人导入记忆限制50条，已有 0 条，可导入50条。');
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(2));

    const firstKey = vi.mocked(memoryService.batchCreateLongTermMemory).mock.calls[0]?.[0]?.items[0]?.idempotencyKey;
    const secondKey = vi.mocked(memoryService.batchCreateLongTermMemory).mock.calls[1]?.[0]?.items[0]?.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it('locks file, template, export, create, confirm, and delete actions while batch import is pending', async () => {
    vi.mocked(memoryService.listLongTermMemory).mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    let resolveBatch!: (value: { successCount: number; failCount: number; memoryIds: string[] }) => void;
    vi.mocked(memoryService.batchCreateLongTermMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve;
        }),
    );
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [makeTransferFile([makeTransferEntry(1)])] },
    });
    await screen.findByText('个人导入记忆限制50条，已有 0 条，可导入50条。');
    const confirm = screen.getByRole('button', { name: '确认导入' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    const importing = await screen.findAllByRole('button', { name: '正在导入…' });

    expect(memoryService.batchCreateLongTermMemory).toHaveBeenCalledTimes(1);
    expect(importing.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole('button', { name: '下载导入模板' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '导出我的记忆' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '＋ 新增记忆' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '删除 BGP memory 1' }) as HTMLButtonElement).disabled).toBe(true);

    resolveBatch({ successCount: 1, failCount: 0, memoryIds: ['imported-1'] });
    await waitFor(() => expect((screen.getByRole('button', { name: '导入记忆' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('rejects unsupported and oversized files before reading or submitting', async () => {
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText('导入记忆'), {
      target: { files: [new File(['[]'], 'memories.csv', { type: 'text/csv' })] },
    });
    expect(await screen.findByText('仅支持 UTF-8 .json 文件。')).toBeTruthy();

    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'oversized.json', { type: 'application/json' });
    const arrayBuffer = vi.spyOn(oversized, 'arrayBuffer');
    fireEvent.change(screen.getByLabelText('导入记忆'), { target: { files: [oversized] } });
    expect(await screen.findByText('导入文件不能超过 5 MiB。')).toBeTruthy();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(memoryService.batchCreateLongTermMemory).not.toHaveBeenCalled();
  });

  it('exports the complete current personal-memory filter from offset zero', async () => {
    const filtered = makeSummary('active-filtered', 'BGP filtered memory');
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (query) => ({
      items: query.limit === 100 ? [filtered] : [],
      total: query.limit === 100 ? 1 : 0,
      offset: query.offset ?? 0,
      limit: query.limit ?? 10,
    }));
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.change(screen.getByPlaceholderText('搜索摘要或正文'), { target: { value: 'BGP' } });
    fireEvent.change(screen.getByDisplayValue('全部类型'), { target: { value: 'FACTUAL' } });
    fireEvent.change(screen.getByDisplayValue('全部来源'), { target: { value: 'CONFIGURED' } });
    fireEvent.change(screen.getByDisplayValue('全部更新方式'), { target: { value: 'pinned' } });
    await waitFor(() =>
      expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryText: 'BGP',
          memoryType: 'FACTUAL',
          knowledgeSourceType: 'CONFIGURED',
          isPinned: true,
          state: 'ACTIVE',
          limit: 10,
          offset: 0,
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '导出我的记忆' }));

    await waitFor(() => expect(memoryTransfer.downloadMemoryExport).toHaveBeenCalledTimes(1));
    expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith({
      memoryInstance: 'defaultInstance',
      queryText: 'BGP',
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      isPinned: true,
      state: 'ACTIVE',
      limit: 100,
      offset: 0,
    });
    const content = vi.mocked(memoryTransfer.downloadMemoryExport).mock.calls[0]?.[0] ?? '';
    expect(content).toContain('记忆类型,摘要,正文,置信度,记忆来源,状态,更新时间,标签1');
    expect(content).toContain('BGP filtered memory');
    expect(memoryService.listPublishedLongTermMemory).not.toHaveBeenCalled();
  });

  it('hides the export button in the shared-memory tab', async () => {
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '共享记忆库' }));

    expect(screen.queryByRole('button', { name: '导出我的记忆' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出归档的记忆' })).toBeNull();
    expect(memoryService.listPublishedLongTermMemory).toHaveBeenCalled();
  });

  it('reads every page of the current filtered export before downloading', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => makeSummary(`active-${index}`, `filtered memory ${index}`));
    const finalMemory = makeSummary('active-100', 'filtered memory 100');
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (query) => {
      if (query.limit !== 100) {
        return { items: [], total: 0, offset: query.offset ?? 0, limit: query.limit ?? 10 };
      }
      return query.offset === 0
        ? { items: firstPage, total: 101, offset: 0, limit: 100 }
        : { items: [finalMemory], total: 101, offset: 100, limit: 100 };
    });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出我的记忆' }));

    await waitFor(() => expect(memoryTransfer.downloadMemoryExport).toHaveBeenCalledTimes(1));
    expect(memoryService.listLongTermMemory).toHaveBeenCalledWith(expect.objectContaining({ state: 'ACTIVE', limit: 100, offset: 100 }));
    expect(vi.mocked(memoryTransfer.downloadMemoryExport).mock.calls[0]?.[0]).toContain('filtered memory 100');
  });

  it('exports only the complete archived-tab filter', async () => {
    const archived = makeSummary('archived-filtered', 'archived filtered memory', 'ARCHIVED');
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (query) => ({
      items: query.limit === 100 && query.state === 'ARCHIVED' ? [archived] : [],
      total: query.limit === 100 && query.state === 'ARCHIVED' ? 1 : 0,
      offset: query.offset ?? 0,
      limit: query.limit ?? 10,
    }));
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: /已归档/ }));
    fireEvent.click(screen.getByRole('button', { name: '导出归档的记忆' }));

    await waitFor(() => expect(memoryTransfer.downloadMemoryExport).toHaveBeenCalledTimes(1));
    expect(memoryService.listLongTermMemory).toHaveBeenLastCalledWith({
      memoryInstance: 'defaultInstance',
      state: 'ARCHIVED',
      limit: 100,
      offset: 0,
    });
    expect(vi.mocked(memoryTransfer.downloadMemoryExport).mock.calls[0]?.[0]).toContain('archived filtered memory');
    expect(await screen.findByText('已导出 1 条已归档的记忆。')).toBeTruthy();
  });

  it('does not download a partial export when a later filtered page fails', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => makeSummary(`active-${index}`, `filtered memory ${index}`));
    vi.mocked(memoryService.listLongTermMemory).mockImplementation(async (query) => {
      if (query.limit !== 100) {
        return { items: [], total: 0, offset: query.offset ?? 0, limit: query.limit ?? 10 };
      }
      if (query.offset === 0) {
        return { items: firstPage, total: 101, offset: 0, limit: 100 };
      }
      throw new Error('page unavailable');
    });
    render(
      <AntdApp>
        <MemoryManagePage />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出我的记忆' }));

    expect(await screen.findByText('导出失败，未生成文件。')).toBeTruthy();
    expect(memoryTransfer.downloadMemoryExport).not.toHaveBeenCalled();
  });
});
