// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historicalChatReplayStore, type ReplayEntry } from '../src/piu/historicalChatReplayStore.ts';
import type { PIUInfoItem } from '../src/aico-config/types.ts';

let lastPiuInfo: PIUInfoItem | null = null;
let lastExtraPayload: Readonly<Record<string, unknown>> | undefined;

vi.mock('../src/aico-config/PiuRenderer.tsx', () => ({
  PiuRenderer: ({ piuInfo, extraPayload }: { readonly piuInfo: PIUInfoItem; readonly extraPayload?: Readonly<Record<string, unknown>> }) => {
    lastPiuInfo = piuInfo;
    lastExtraPayload = extraPayload;
    return <div data-testid="piu-renderer-mock" data-chatid={(piuInfo.data as Record<string, unknown>)?.chatId as string} />;
  },
}));

vi.mock('../src/features/chat/context/PiuContext.tsx', () => ({
  PiuContext: { Provider: ({ children }: { readonly children: React.ReactNode }) => children },
  usePiuContext: () => ({ piu: {} as unknown, site: { locale: 'zh-cn', theme: 'lightday' } }),
}));

function makeEntry(chatId: string, overrides: Partial<ReplayEntry> = {}): ReplayEntry {
  return {
    chatId,
    piuName: 'chart-piu',
    piuVersion: '1.0.0',
    method: 'renderChart',
    data: { type: 'bar', chatId },
    extraPayload: {},
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  historicalChatReplayStore.getState().clearAllReplays();
  lastPiuInfo = null;
  lastExtraPayload = undefined;
});

describe('HistoricalChatReplayView', () => {
  it('renders one PiuRenderer per store entry', async () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A'));
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-B'));
    const { HistoricalChatReplayView } = await import('../src/piu/HistoricalChatReplayView.tsx');
    render(<HistoricalChatReplayView />);
    const renderers = screen.getAllByTestId('piu-renderer-mock');
    expect(renderers).toHaveLength(2);
    expect(renderers[0]!.getAttribute('data-chatid')).toBe('chat-A');
    expect(renderers[1]!.getAttribute('data-chatid')).toBe('chat-B');
  });

  it('maps entry fields to PIUInfoItem correctly', async () => {
    historicalChatReplayStore.getState().startReplay(
      makeEntry('chat-A', {
        piuName: 'table-piu',
        piuVersion: '2.0.0',
        method: 'renderTable',
        data: { rows: 3 },
      }),
    );
    const { HistoricalChatReplayView } = await import('../src/piu/HistoricalChatReplayView.tsx');
    render(<HistoricalChatReplayView />);
    expect(lastPiuInfo).toMatchObject({
      piuName: 'table-piu',
      piuVersion: '2.0.0',
      renderFunc: 'renderTable',
      data: { rows: 3 },
    });
  });

  it('renders nothing when store is empty', async () => {
    const { HistoricalChatReplayView } = await import('../src/piu/HistoricalChatReplayView.tsx');
    render(<HistoricalChatReplayView />);
    const container = screen.getByTestId('historical-chat-replay-view');
    expect(container.children).toHaveLength(0);
  });

  it('preserves entry order across re-renders', async () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A'));
    const { HistoricalChatReplayView } = await import('../src/piu/HistoricalChatReplayView.tsx');
    const { rerender } = render(<HistoricalChatReplayView />);

    historicalChatReplayStore.getState().startReplay(makeEntry('chat-B'));
    rerender(<HistoricalChatReplayView />);

    const renderers = screen.getAllByTestId('piu-renderer-mock');
    expect(renderers).toHaveLength(2);
    expect(renderers[0]!.getAttribute('data-chatid')).toBe('chat-A');
    expect(renderers[1]!.getAttribute('data-chatid')).toBe('chat-B');
  });

  it('wraps array data as object for PiuRenderer', async () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-arr', { data: [1, 2, 3] }));
    const { HistoricalChatReplayView } = await import('../src/piu/HistoricalChatReplayView.tsx');
    render(<HistoricalChatReplayView />);
    expect(lastPiuInfo?.data).toEqual({ data: [1, 2, 3] });
  });

  it('passes extraPayload to PiuRenderer', async () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-extra', { extraPayload: { isHistory: true, chatId: 'chat-extra' } }));
    const { HistoricalChatReplayView } = await import('../src/piu/HistoricalChatReplayView.tsx');
    render(<HistoricalChatReplayView />);
    expect(lastExtraPayload).toEqual({ isHistory: true, chatId: 'chat-extra' });
  });
});
