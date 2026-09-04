import { beforeEach, describe, expect, it } from 'vitest';
import { historicalChatReplayStore, type ReplayEntry } from '../src/piu/historicalChatReplayStore.ts';

function makeEntry(chatId: string, overrides: Partial<ReplayEntry> = {}): ReplayEntry {
  return {
    chatId,
    piuName: 'chart-piu',
    piuVersion: '1.0.0',
    method: 'renderChart',
    data: { type: 'bar' },
    extraPayload: {},
    ...overrides,
  };
}

describe('historicalChatReplayStore', () => {
  beforeEach(() => {
    historicalChatReplayStore.getState().clearAllReplays();
  });

  it('adds the first replay entry', () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A'));
    const state = historicalChatReplayStore.getState();
    expect(state.entries.size).toBe(1);
    expect(state.entries.get('chat-A')?.chatId).toBe('chat-A');
    expect(state.entryOrder).toEqual(['chat-A']);
  });

  it('does not duplicate entries with the same chatId', () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A'));
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A', { data: { type: 'line' } }));
    const state = historicalChatReplayStore.getState();
    expect(state.entries.size).toBe(1);
    expect(state.entryOrder).toEqual(['chat-A']);
    expect(state.entries.get('chat-A')?.data).toEqual({ type: 'bar' });
  });

  it('appends entries with different chatIds in insertion order', () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A'));
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-B'));
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-C'));
    const state = historicalChatReplayStore.getState();
    expect(state.entries.size).toBe(3);
    expect(state.entryOrder).toEqual(['chat-A', 'chat-B', 'chat-C']);
  });

  it('clears all entries via clearAllReplays', () => {
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-A'));
    historicalChatReplayStore.getState().startReplay(makeEntry('chat-B'));
    historicalChatReplayStore.getState().clearAllReplays();
    const state = historicalChatReplayStore.getState();
    expect(state.entries.size).toBe(0);
    expect(state.entryOrder).toEqual([]);
  });

  it('preserves entry data as given', () => {
    historicalChatReplayStore
      .getState()
      .startReplay(makeEntry('chat-A', { piuName: 'table-piu', piuVersion: '2.0', method: 'renderTable', data: undefined }));
    const entry = historicalChatReplayStore.getState().entries.get('chat-A');
    expect(entry).toMatchObject({
      chatId: 'chat-A',
      piuName: 'table-piu',
      piuVersion: '2.0',
      method: 'renderTable',
      data: undefined,
    });
  });
});
