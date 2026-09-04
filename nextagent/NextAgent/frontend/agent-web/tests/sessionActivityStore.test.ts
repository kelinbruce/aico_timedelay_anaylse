import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSessionActivityStore, type PublishedSessionActivityEntry } from '../src/state/sessionActivityStore.ts';

const RUNNING_ENTRY: PublishedSessionActivityEntry = {
  sessionId: 'session-running',
  status: 'RUNNING',
};

const WAITING_ENTRY: PublishedSessionActivityEntry = {
  sessionId: 'session-waiting',
  status: 'WAITING_FOR_INPUT',
  pendingInputKind: 'CONFIRMATION',
};

afterEach(() => {
  useSessionActivityStore.setState({
    entriesBySessionId: {},
    connectionGeneration: 0,
  });
  vi.restoreAllMocks();
});

describe('sessionActivityStore', () => {
  it('replaces the complete activity projection from the current generation snapshot', () => {
    useSessionActivityStore.setState({
      entriesBySessionId: {
        stale: { sessionId: 'stale', status: 'RUNNING' },
      },
    });

    const generation = useSessionActivityStore.getState().beginConnectionGeneration();
    expect(useSessionActivityStore.getState().replaceSnapshot(generation, [RUNNING_ENTRY, WAITING_ENTRY])).toBe(true);

    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
      'session-running': RUNNING_ENTRY,
      'session-waiting': WAITING_ENTRY,
    });
  });

  it('merges deltas by session and deletes NONE entries', () => {
    const generation = useSessionActivityStore.getState().beginConnectionGeneration();
    useSessionActivityStore.getState().replaceSnapshot(generation, [RUNNING_ENTRY, WAITING_ENTRY]);

    expect(
      useSessionActivityStore.getState().mergeDelta(generation, {
        sessionId: 'session-running',
        status: 'UNREAD_RESULT',
        activityId: 'activity-1',
      }),
    ).toBe(true);
    expect(
      useSessionActivityStore.getState().mergeDelta(generation, {
        sessionId: 'session-waiting',
        status: 'NONE',
      }),
    ).toBe(true);

    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
      'session-running': {
        sessionId: 'session-running',
        status: 'UNREAD_RESULT',
        activityId: 'activity-1',
      },
    });
  });

  it('ignores callbacks from stale connection generations', () => {
    const staleGeneration = useSessionActivityStore.getState().beginConnectionGeneration();
    const currentGeneration = useSessionActivityStore.getState().beginConnectionGeneration();
    useSessionActivityStore.getState().replaceSnapshot(currentGeneration, [WAITING_ENTRY]);

    expect(useSessionActivityStore.getState().replaceSnapshot(staleGeneration, [RUNNING_ENTRY])).toBe(false);
    expect(
      useSessionActivityStore.getState().mergeDelta(staleGeneration, {
        sessionId: 'session-waiting',
        status: 'NONE',
      }),
    ).toBe(false);
    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
      'session-waiting': WAITING_ENTRY,
    });
  });

  it('indexes session ids without inheriting object prototype values', () => {
    const generation = useSessionActivityStore.getState().beginConnectionGeneration();
    useSessionActivityStore.getState().replaceSnapshot(generation, [
      {
        sessionId: '__proto__',
        status: 'RUNNING',
      },
    ]);

    expect(useSessionActivityStore.getState().entriesBySessionId['__proto__']).toEqual({
      sessionId: '__proto__',
      status: 'RUNNING',
    });
    expect(useSessionActivityStore.getState().entriesBySessionId.toString).toBeUndefined();
  });

  it('does not persist activity entries or connection generations in browser storage', () => {
    const localStorageSet = vi.spyOn(Storage.prototype, 'setItem');
    const generation = useSessionActivityStore.getState().beginConnectionGeneration();
    useSessionActivityStore.getState().replaceSnapshot(generation, [RUNNING_ENTRY]);
    useSessionActivityStore.getState().mergeDelta(generation, {
      sessionId: 'session-running',
      status: 'NONE',
    });

    expect(localStorageSet).not.toHaveBeenCalled();
  });
});
