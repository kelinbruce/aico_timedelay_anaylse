import { create } from 'zustand';

import type {
  PublishedSessionActivityEntry,
  SessionActivityEntry,
  SessionActivityMessage,
  SessionActivityPendingInputKind,
} from '../services/sessionActivityService.ts';

export type {
  PublishedSessionActivityEntry,
  SessionActivityEntry,
  SessionActivityMessage,
  SessionActivityPendingInputKind,
} from '../services/sessionActivityService.ts';

export interface SessionActivityState {
  readonly entriesBySessionId: Readonly<Record<string, PublishedSessionActivityEntry>>;
  readonly connectionGeneration: number;
}

interface SessionActivityActions {
  beginConnectionGeneration: () => number;
  replaceSnapshot: (generation: number, entries: readonly PublishedSessionActivityEntry[]) => boolean;
  mergeDelta: (generation: number, entry: SessionActivityEntry) => boolean;
}

type SessionActivityStore = SessionActivityState & SessionActivityActions;

function createEntryIndex(): Record<string, PublishedSessionActivityEntry> {
  return Object.create(null) as Record<string, PublishedSessionActivityEntry>;
}

function indexEntries(entries: readonly PublishedSessionActivityEntry[]): Readonly<Record<string, PublishedSessionActivityEntry>> {
  const entriesBySessionId = createEntryIndex();
  for (const entry of entries) {
    entriesBySessionId[entry.sessionId] = entry;
  }
  return entriesBySessionId;
}

function copyEntryIndex(entries: Readonly<Record<string, PublishedSessionActivityEntry>>): Record<string, PublishedSessionActivityEntry> {
  return Object.assign(createEntryIndex(), entries);
}

export const useSessionActivityStore = create<SessionActivityStore>((set, get) => ({
  entriesBySessionId: createEntryIndex(),
  connectionGeneration: 0,

  beginConnectionGeneration: () => {
    const generation = get().connectionGeneration + 1;
    set({ connectionGeneration: generation });
    return generation;
  },

  replaceSnapshot: (generation, entries) => {
    if (get().connectionGeneration !== generation) {
      return false;
    }
    set({ entriesBySessionId: indexEntries(entries) });
    return true;
  },

  mergeDelta: (generation, entry) => {
    if (get().connectionGeneration !== generation) {
      return false;
    }
    set((state) => {
      if (entry.status === 'NONE') {
        if (state.entriesBySessionId[entry.sessionId] === undefined) {
          return state;
        }
        const entriesBySessionId = copyEntryIndex(state.entriesBySessionId);
        delete entriesBySessionId[entry.sessionId];
        return { entriesBySessionId };
      }
      const entriesBySessionId = copyEntryIndex(state.entriesBySessionId);
      entriesBySessionId[entry.sessionId] = entry;
      return {
        entriesBySessionId,
      };
    });
    return true;
  },
}));
