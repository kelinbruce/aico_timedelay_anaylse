// @vitest-environment jsdom
import { App as AntdApp } from 'antd';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { MemoryManagePage } from '../../src/pages/MemoryManagePage.tsx';

vi.mock('../../src/features/memory/memoryTransfer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/memory/memoryTransfer.ts')>();
  return {
    ...actual,
    downloadMemoryImportTemplate: vi.fn(),
    downloadMemoryExport: vi.fn(),
  };
});

vi.mock('../../src/services/memoryService.ts', () => ({
  memoryService: {
    getLongTermMemoryTabTotals: vi.fn().mockResolvedValue({ mine: 1, shared: 0, archived: 0 }),
    listLongTermMemory: vi.fn().mockResolvedValue({
      items: [
        {
          memoryId: 'mem-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          agentId: 'agent-1',
          memoryInstance: 'defaultInstance',
          memoryType: 'FACTUAL',
          knowledgeSourceType: 'CONFIGURED',
          state: 'ACTIVE',
          sharingState: 'PRIVATE',
          briefIndex: '测试记忆',
          content: '测试内容',
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
        },
      ],
      total: 1,
      offset: 0,
      limit: 10,
    }),
    listPublishedLongTermMemory: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 10 }),
    getLongTermMemory: vi.fn().mockResolvedValue({
      memoryId: 'mem-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
      memoryInstance: 'defaultInstance',
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      state: 'ACTIVE',
      sharingState: 'PRIVATE',
      briefIndex: '测试记忆',
      content: '测试内容',
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
    }),
    manualSaveLongTermMemory: vi.fn(),
    batchCreateLongTermMemory: vi.fn(),
    patchLongTermMemory: vi.fn(),
    deleteLongTermMemory: vi.fn(),
    publishLongTermMemory: vi.fn(),
    unpublishLongTermMemory: vi.fn(),
    copyPublishedMemory: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function isGated(element: HTMLElement): boolean {
  let el: HTMLElement | null = element;
  while (el && el.tagName !== 'BODY') {
    if (el.style.pointerEvents === 'none') {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function renderPage(ops: string[] | null) {
  if (ops === null) {
    render(
      <AppProviders mode="local">
        <AntdApp>
          <MemoryManagePage />
        </AntdApp>
      </AppProviders>,
    );
  } else {
    render(
      <AppProviders mode="immersive" site={{ user: { ops } }}>
        <AntdApp>
          <MemoryManagePage />
        </AntdApp>
      </AppProviders>,
    );
  }
}

async function waitForList() {
  return screen.findByText('测试记忆');
}

async function selectMemory() {
  const item = await screen.findByText('测试记忆');
  (item.closest('[class*="ltm-memory-row"]') as HTMLElement)?.click();
}

describe('MemoryManagePage permission control', () => {
  it('disables import button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await waitForList();
    const importBtn = screen.getByText('导入记忆').closest('button') as HTMLElement;
    expect(isGated(importBtn)).toBe(true);
  });

  it('disables create memory button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await waitForList();
    const createBtn = screen.getByText('＋ 新增记忆').closest('button') as HTMLElement;
    expect(isGated(createBtn)).toBe(true);
  });

  it('keeps export and template download buttons enabled when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await waitForList();
    const exportBtn = screen.getByText('导出我的记忆').closest('button') as HTMLElement;
    const templateBtn = screen.getByText('下载导入模板').closest('button') as HTMLElement;
    expect(isGated(exportBtn)).toBe(false);
    expect(isGated(templateBtn)).toBe(false);
  });

  it('keeps import and create buttons enabled when user has Write', async () => {
    renderPage(['AICOService.View', 'AICOService.Write']);
    await waitForList();
    const importBtn = screen.getByText('导入记忆').closest('button') as HTMLElement;
    const createBtn = screen.getByText('＋ 新增记忆').closest('button') as HTMLElement;
    expect(isGated(importBtn)).toBe(false);
    expect(isGated(createBtn)).toBe(false);
  });

  it('disables detail panel edit button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await selectMemory();
    const editBtn = await screen.findByText('编辑');
    expect(isGated(editBtn)).toBe(true);
  });

  it('disables detail panel delete button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await selectMemory();
    const deleteBtn = await screen.findByText('删除');
    expect(isGated(deleteBtn)).toBe(true);
  });

  it('disables detail panel archive button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await selectMemory();
    const archiveBtn = await screen.findByText('归档');
    expect(isGated(archiveBtn)).toBe(true);
  });

  it('disables detail panel pin button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await selectMemory();
    const pinBtn = await screen.findByText('设为保持不变');
    expect(isGated(pinBtn)).toBe(true);
  });

  it('disables detail panel publish button when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    await selectMemory();
    const publishBtn = await screen.findByText('共享到记忆库');
    expect(isGated(publishBtn)).toBe(true);
  });

  it('keeps detail panel buttons enabled when user has Write', async () => {
    renderPage(['AICOService.View', 'AICOService.Write']);
    await selectMemory();
    const editBtn = await screen.findByText('编辑');
    expect(isGated(editBtn)).toBe(false);
  });

  it('keeps memory list visible when user lacks Write', async () => {
    renderPage(['AICOService.View']);
    const item = await waitForList();
    expect(item).toBeTruthy();
  });

  it('renders all controls normally in local mode', async () => {
    renderPage(null);
    await waitForList();
    const importBtn = screen.getByText('导入记忆').closest('button') as HTMLElement;
    expect(isGated(importBtn)).toBe(false);
  });
});
