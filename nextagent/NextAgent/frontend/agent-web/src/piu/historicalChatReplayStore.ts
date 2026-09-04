import { create } from 'zustand';

export interface ReplayEntry {
  readonly chatId: string;
  readonly piuName: string;
  readonly piuVersion: string;
  readonly method: string;
  readonly data: unknown;
  readonly extraPayload: Readonly<Record<string, unknown>>;
}

export interface HistoricalChatReplayState {
  readonly entries: ReadonlyMap<string, ReplayEntry>;
  readonly entryOrder: readonly string[];
  readonly startReplay: (entry: ReplayEntry) => void;
  readonly clearAllReplays: () => void;
}

export const historicalChatReplayStore = create<HistoricalChatReplayState>((set) => ({
  entries: new Map<string, ReplayEntry>(),
  entryOrder: [],
  startReplay: (entry) =>
    set((state) => {
      if (state.entries.has(entry.chatId)) {
        return state;
      }
      const nextEntries = new Map(state.entries);
      nextEntries.set(entry.chatId, entry);
      return {
        entries: nextEntries,
        entryOrder: [...state.entryOrder, entry.chatId],
      };
    }),
  clearAllReplays: () =>
    set({
      entries: new Map<string, ReplayEntry>(),
      entryOrder: [],
    }),
}));
