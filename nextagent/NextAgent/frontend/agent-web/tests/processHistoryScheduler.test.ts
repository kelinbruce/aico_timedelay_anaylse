import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProcessHistoryAutomaticTargetSettler,
  createProcessHistoryScheduler,
  type ProcessHistoryExplicitDemandRelease,
  type ProcessHistoryTarget,
} from '../src/features/chat/history/processHistoryScheduler.ts';
import type { CompleteRunProcessHistory } from '../src/features/chat/history/processHistory.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

function target(runId: string, priority: ProcessHistoryTarget['priority'], distanceFromViewportCenter = 0, generation = 1): ProcessHistoryTarget {
  return {
    sessionId: 'session-1',
    rootMessageId: `root-${runId}`,
    runId,
    priority,
    generation,
    distanceFromViewportCenter,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const availableResult: CompleteRunProcessHistory = {
  availability: 'AVAILABLE',
  items: [],
};

async function flushScheduler(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('processHistoryScheduler', () => {
  it('publishes only the latest automatic target snapshot after a 120 ms quiet window', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const settler = createProcessHistoryAutomaticTargetSettler({ publish });

    settler.update([target('run-1', 'VIEWPORT', 0, 1)]);
    vi.advanceTimersByTime(80);
    settler.update([target('run-2', 'VIEWPORT', 0, 2)]);
    vi.advanceTimersByTime(119);

    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith([target('run-2', 'VIEWPORT', 0, 2)]);
  });

  it('cancels automatic target work that has not reached the quiet window', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const settler = createProcessHistoryAutomaticTargetSettler({ publish });

    settler.update([target('run-stale', 'VIEWPORT')]);
    settler.clear();
    vi.advanceTimersByTime(120);

    expect(publish).not.toHaveBeenCalled();
  });

  it('coalesces 10,000 rapid navigation targets and starts at most four latest-window loads', () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: (current) => {
        started.push(current.runId);
        return new Promise<CompleteRunProcessHistory>(() => undefined);
      },
    });
    const settler = createProcessHistoryAutomaticTargetSettler({
      publish: (automatic) => scheduler.updateTargets({ automatic, explicit: [] }),
    });

    for (let index = 1; index <= 10_000; index += 1) {
      settler.update(Array.from({ length: 16 }, (_, offset) => target(`run-${index + offset}`, 'VIEWPORT', offset, index)));
    }
    vi.advanceTimersByTime(119);
    expect(started).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(started).toEqual(['run-10000', 'run-10001', 'run-10002', 'run-10003']);
    expect(Object.keys(scheduler.getSnapshot())).toHaveLength(16);
  });

  it('orders explicit, viewport, and preload targets and deduplicates the same run', async () => {
    const loads = new Map<string, ReturnType<typeof deferred<CompleteRunProcessHistory>>>();
    const started: string[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 1,
      load: (current) => {
        started.push(current.runId);
        const pending = deferred<CompleteRunProcessHistory>();
        loads.set(current.runId, pending);
        return pending.promise;
      },
    });

    scheduler.updateTargets({
      automatic: [target('run-preload', 'PRELOAD'), target('run-shared', 'PRELOAD'), target('run-viewport', 'VIEWPORT')],
      explicit: [target('run-shared', 'EXPLICIT')],
    });
    await flushScheduler();

    expect(started).toEqual(['run-shared']);
    loads.get('run-shared')?.resolve(availableResult);
    await flushScheduler();
    expect(started).toEqual(['run-shared', 'run-viewport']);

    loads.get('run-viewport')?.resolve(availableResult);
    await flushScheduler();
    expect(started).toEqual(['run-shared', 'run-viewport', 'run-preload']);
  });

  it('keeps at most sixteen nearest automatic targets', async () => {
    const started: string[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 20,
      load: (current) => {
        started.push(current.runId);
        return new Promise<CompleteRunProcessHistory>(() => undefined);
      },
    });

    scheduler.updateTargets({
      automatic: Array.from({ length: 20 }, (_, index) => target(`run-${index}`, 'VIEWPORT', index)),
      explicit: [],
    });
    await flushScheduler();

    expect(started).toEqual(Array.from({ length: 16 }, (_, index) => `run-${index}`));
  });

  it('never runs more than four requests concurrently', async () => {
    const pending: Array<ReturnType<typeof deferred<CompleteRunProcessHistory>>> = [];
    let active = 0;
    let peak = 0;
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: () => {
        active += 1;
        peak = Math.max(peak, active);
        const load = deferred<CompleteRunProcessHistory>();
        pending.push(load);
        return load.promise.finally(() => {
          active -= 1;
        });
      },
    });

    scheduler.updateTargets({
      automatic: Array.from({ length: 5 }, (_, index) => target(`run-${index}`, 'VIEWPORT', index)),
      explicit: [],
    });
    await flushScheduler();
    expect(active).toBe(4);

    pending[0]?.resolve(availableResult);
    await vi.waitFor(() => {
      expect(pending).toHaveLength(5);
    });
    expect(peak).toBe(4);
  });

  it('keeps every started source pinned to outcome while replacing obsolete queued work', async () => {
    const pending = deferred<CompleteRunProcessHistory>();
    const signals = new Map<string, AbortSignal>();
    const started: string[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 1,
      load: (current, signal) => {
        started.push(current.runId);
        signals.set(current.runId, signal);
        return current.runId === 'run-old-active' ? pending.promise : Promise.resolve(availableResult);
      },
    });

    scheduler.updateTargets({
      automatic: [target('run-old-active', 'VIEWPORT'), target('run-old-queued', 'PRELOAD')],
      explicit: [],
    });
    await flushScheduler();
    scheduler.updateTargets({
      automatic: [target('run-new', 'VIEWPORT', 0, 2)],
      explicit: [],
    });
    await flushScheduler();

    expect(signals.get('run-old-active')?.aborted).toBe(false);
    expect(started).toEqual(['run-old-active']);
    expect(scheduler.getSnapshot()['run-old-queued']).toBeUndefined();
    pending.resolve(availableResult);
    await vi.waitFor(() => expect(started).toEqual(['run-old-active', 'run-new']));
    expect(scheduler.getSnapshot()['run-old-active']?.status).toBe('AVAILABLE');
  });

  it.each([
    ['explicit expansion', 'EXPLICIT'],
    ['preview navigation', 'EXPLICIT'],
    ['viewport', 'VIEWPORT'],
    ['preload', 'PRELOAD'],
  ] as const)('keeps a started %s request alive until its outcome', async (_source, priority) => {
    const pending = deferred<CompleteRunProcessHistory>();
    let signal: AbortSignal | undefined;
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: (_current, currentSignal) => {
        signal = currentSignal;
        return pending.promise;
      },
    });
    const current = target(`run-${priority.toLowerCase()}`, priority);

    scheduler.updateTargets({
      automatic: priority === 'EXPLICIT' ? [] : [current],
      explicit: priority === 'EXPLICIT' ? [current] : [],
    });
    await flushScheduler();
    scheduler.updateTargets({ automatic: [], explicit: [] });

    expect(signal?.aborted).toBe(false);
    pending.resolve(availableResult);
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()[current.runId]?.status).toBe('AVAILABLE');
    });
  });

  it('commits an obsolete generation by active identity without restoring its old intent', async () => {
    const firstLoad = deferred<CompleteRunProcessHistory>();
    const load = vi.fn(() => firstLoad.promise);
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 1,
      load,
    });
    const revisitedTarget = target('run-revisited', 'VIEWPORT');

    scheduler.updateTargets({ automatic: [revisitedTarget], explicit: [] });
    await flushScheduler();
    scheduler.updateTargets({ automatic: [], explicit: [] });
    scheduler.updateTargets({
      automatic: [target('run-revisited', 'VIEWPORT', 0, 2)],
      explicit: [],
    });
    scheduler.updateTargets({ automatic: [], explicit: [] });
    firstLoad.resolve(availableResult);

    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
      expect(scheduler.getSnapshot()['run-revisited']?.status).toBe('AVAILABLE');
    });
    expect(scheduler.getSnapshot()['run-revisited']).toMatchObject({
      status: 'AVAILABLE',
      envelopes: [],
    });
  });

  it('permanently releases an older same-run generation without releasing the accepted latest generation', () => {
    const releases: Array<{ readonly scope: string; readonly runId: string; readonly generation?: number }> = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: () => new Promise<CompleteRunProcessHistory>(() => undefined),
      onExplicitDemandReleased: (release) => releases.push(release),
    });

    scheduler.updateTargets({
      automatic: [],
      explicit: [target('run-superseded', 'EXPLICIT', 0, 1), target('run-superseded', 'EXPLICIT', 0, 2)],
    });

    expect(releases).toEqual([
      {
        scope: 'GENERATION',
        runId: 'run-superseded',
        generation: 1,
      },
    ]);
    expect(scheduler.getSnapshot()['run-superseded']?.status).toBe('LOADING');
  });

  it.each([
    ['AVAILABLE', availableResult],
    ['FAILED', new Error('failed')],
    [
      'LEGACY_UNAVAILABLE',
      {
        availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
        items: [],
      } satisfies CompleteRunProcessHistory,
    ],
  ] as const)('lets an identity-matched generation one %s outcome satisfy coalesced generation two demand', async (_outcome, settlement) => {
    const pending = deferred<CompleteRunProcessHistory>();
    const load = vi.fn(() => pending.promise);
    const outcomes: ProcessHistoryTarget[] = [];
    const releases: Array<{ readonly scope: string; readonly runId: string }> = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load,
      onOutcome: (current) => outcomes.push(current),
      onExplicitDemandReleased: (release) => releases.push(release),
    });

    scheduler.updateTargets({
      automatic: [],
      explicit: [target('run-coalesced', 'EXPLICIT', 0, 1)],
    });
    await flushScheduler();
    scheduler.updateTargets({
      automatic: [],
      explicit: [target('run-coalesced', 'EXPLICIT', 0, 2)],
    });
    if (settlement instanceof Error) {
      pending.reject(settlement);
    } else {
      pending.resolve(settlement);
    }
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));

    expect(outcomes[0]?.generation).toBe(2);
    expect(releases).toEqual([
      {
        scope: 'GENERATION',
        runId: 'run-coalesced',
        generation: 2,
      },
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('requires the controlled retry entrypoint before a failed run can queue again', async () => {
    const secondLoad = deferred<CompleteRunProcessHistory>();
    const releases: Array<{ readonly scope: string; readonly runId: string }> = [];
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockImplementationOnce(() => secondLoad.promise);
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load,
      onExplicitDemandReleased: (release) => releases.push(release),
    });

    scheduler.updateTargets({
      automatic: [target('run-failed-controlled', 'VIEWPORT')],
      explicit: [],
    });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-failed-controlled']?.status).toBe('FAILED');
    });
    scheduler.updateTargets({
      automatic: [],
      explicit: [target('run-failed-controlled', 'EXPLICIT', 0, 2)],
    });
    await flushScheduler();
    expect(load).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot()['run-failed-controlled']?.status).toBe('FAILED');
    expect(releases).toEqual([
      {
        scope: 'GENERATION',
        runId: 'run-failed-controlled',
        generation: 2,
      },
    ]);

    scheduler.retry(target('run-failed-controlled', 'EXPLICIT', 0, 3));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    scheduler.retry(target('run-failed-controlled', 'EXPLICIT', 0, 4));
    expect(load).toHaveBeenCalledTimes(2);
    secondLoad.resolve(availableResult);
  });

  it('keeps a safe failure until an explicit retry succeeds', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('raw provider detail')).mockResolvedValueOnce(availableResult);
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load,
    });
    const failedTarget = target('run-failed', 'VIEWPORT');

    scheduler.updateTargets({ automatic: [failedTarget], explicit: [] });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-failed']).toEqual({
        status: 'FAILED',
        errorCode: 'PROCESS_HISTORY_LOAD_FAILED',
      });
    });

    scheduler.retry(target('run-failed', 'EXPLICIT', 0, 2));
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-failed']?.status).toBe('AVAILABLE');
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(scheduler.getSnapshot())).not.toContain('raw provider detail');
  });

  it('keeps only the latest sixteen explicit generations after four older requests start', async () => {
    const pendingByRun = new Map<string, ReturnType<typeof deferred<CompleteRunProcessHistory>>>();
    const started: string[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: (current) => {
        started.push(current.runId);
        const pending = deferred<CompleteRunProcessHistory>();
        pendingByRun.set(current.runId, pending);
        return pending.promise;
      },
    });

    for (let generation = 1; generation <= 20; generation += 1) {
      scheduler.updateTargets({
        automatic: [],
        explicit: Array.from({ length: generation }, (_, index) => target(`run-${index + 1}`, 'EXPLICIT', 0, index + 1)),
      });
    }
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(started).toEqual(['run-1', 'run-2', 'run-3', 'run-4']);

    while (started.length < 20) {
      const active = [...pendingByRun.entries()];
      const startedBeforeSettlement = started.length;
      pendingByRun.clear();
      active.forEach(([, pending]) => pending.resolve(availableResult));
      await vi.waitFor(() => expect(started.length).toBeGreaterThan(startedBeforeSettlement));
    }
    [...pendingByRun.values()].forEach((pending) => pending.resolve(availableResult));
    expect(started.slice(4)).toEqual([
      'run-20',
      'run-19',
      'run-18',
      'run-17',
      'run-16',
      'run-15',
      'run-14',
      'run-13',
      'run-12',
      'run-11',
      'run-10',
      'run-9',
      'run-8',
      'run-7',
      'run-6',
      'run-5',
    ]);
  });

  it('caps sixteen distinct runs while preserving same-run transient and retained sources', async () => {
    const releases: ProcessHistoryExplicitDemandRelease[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 0,
      load: () => new Promise<CompleteRunProcessHistory>(() => undefined),
      onExplicitDemandReleased: (release) => releases.push(release),
    });
    const sources = Array.from({ length: 16 }, (_, index) => {
      const runId = `run-cap-${index + 1}`;
      return [
        target(runId, 'EXPLICIT', 0, index * 2 + 1),
        {
          ...target(runId, 'EXPLICIT', 0, index * 2 + 2),
          retention: 'WHILE_TARGETED' as const,
        },
      ];
    }).flat();

    scheduler.updateTargets({ automatic: [], explicit: sources });

    expect(Object.keys(scheduler.getSnapshot())).toHaveLength(16);
    expect(releases).toEqual([]);

    const displacedPanel = target('run-displaced', 'EXPLICIT', 0, 33);
    const displacedPreview = {
      ...target('run-displaced', 'EXPLICIT', 0, 34),
      retention: 'WHILE_TARGETED' as const,
    };
    scheduler.updateTargets({
      automatic: [],
      explicit: [...sources, displacedPanel, displacedPreview],
    });

    expect(Object.keys(scheduler.getSnapshot())).toHaveLength(16);
    expect(scheduler.getSnapshot()['run-cap-1']).toBeUndefined();
    expect(scheduler.getSnapshot()['run-displaced']?.status).toBe('QUEUED');
    expect(releases).toEqual(
      expect.arrayContaining([
        { scope: 'GENERATION', runId: 'run-cap-1', generation: 1 },
        { scope: 'GENERATION', runId: 'run-cap-1', generation: 2 },
      ]),
    );
  });

  it('releases each terminal outcome, blocks legacy retry, and tears down late responses', async () => {
    const pendingByRun = new Map<string, ReturnType<typeof deferred<CompleteRunProcessHistory>>>();
    const signals = new Map<string, AbortSignal>();
    const load = vi.fn((current: ProcessHistoryTarget, signal: AbortSignal) => {
      signals.set(current.runId, signal);
      const pending = deferred<CompleteRunProcessHistory>();
      pendingByRun.set(current.runId, pending);
      return pending.promise;
    });
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 3,
      load,
    });

    scheduler.updateTargets({
      automatic: [
        target('run-available', 'VIEWPORT'),
        target('run-failed', 'VIEWPORT'),
        target('run-legacy', 'PRELOAD'),
        target('run-next', 'PRELOAD'),
      ],
      explicit: [],
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    pendingByRun.get('run-available')?.resolve(availableResult);
    pendingByRun.get('run-failed')?.reject(new Error('failure'));
    pendingByRun.get('run-legacy')?.resolve({
      availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
      items: [],
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4));
    expect(scheduler.getSnapshot()['run-available']?.status).toBe('AVAILABLE');
    expect(scheduler.getSnapshot()['run-failed']?.status).toBe('FAILED');
    expect(scheduler.getSnapshot()['run-legacy']?.status).toBe('LEGACY_UNAVAILABLE');

    scheduler.retry(target('run-legacy', 'EXPLICIT', 0, 2));
    expect(load).toHaveBeenCalledTimes(4);

    scheduler.clear();
    expect(signals.get('run-next')?.aborted).toBe(true);
    pendingByRun.get('run-next')?.resolve(availableResult);
    await flushScheduler();
    expect(scheduler.getSnapshot()).toEqual({});
  });

  it('keeps a recreated session scheduler isolated from an old identity late completion', async () => {
    const oldLoad = deferred<CompleteRunProcessHistory>();
    const oldSnapshots: unknown[] = [];
    const oldScheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: () => oldLoad.promise,
      onChange: (snapshot) => oldSnapshots.push(snapshot),
    });
    oldScheduler.updateTargets({
      automatic: [target('run-old-identity', 'VIEWPORT')],
      explicit: [],
    });
    await flushScheduler();
    oldScheduler.clear();
    oldScheduler.clear();
    const oldSnapshotCountAfterClear = oldSnapshots.length;

    const currentLoad = deferred<CompleteRunProcessHistory>();
    const currentStarted: string[] = [];
    const currentScheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxConcurrentLoads: 1,
      load: (current) => {
        currentStarted.push(current.runId);
        return current.runId === 'run-current-identity' ? currentLoad.promise : Promise.resolve(availableResult);
      },
    });
    currentScheduler.updateTargets({
      automatic: [target('run-current-identity', 'VIEWPORT'), target('run-current-next', 'PRELOAD')],
      explicit: [],
    });
    await vi.waitFor(() => expect(currentStarted).toEqual(['run-current-identity']));

    oldLoad.resolve(availableResult);
    await flushScheduler();
    expect(oldSnapshots).toHaveLength(oldSnapshotCountAfterClear);
    expect(currentStarted).toEqual(['run-current-identity']);
    expect(currentScheduler.getSnapshot()['run-current-identity']?.status).toBe('LOADING');

    currentLoad.resolve(availableResult);
    await vi.waitFor(() => {
      expect(currentStarted).toEqual(['run-current-identity', 'run-current-next']);
    });
  });

  it('touches recency only on AVAILABLE commit and absent-to-present cache reuse', async () => {
    let time = 10;
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      now: () => time,
      load: () => Promise.resolve(availableResult),
    });
    const visible = target('run-touch', 'VIEWPORT');

    scheduler.updateTargets({ automatic: [visible], explicit: [] });
    await vi.waitFor(() => expect(scheduler.getSnapshot()['run-touch']?.status).toBe('AVAILABLE'));
    const committed = scheduler.getSnapshot()['run-touch'];
    expect(committed?.status === 'AVAILABLE' ? committed.lastAccessSequence : 0).toBe(1);

    time = 20;
    scheduler.getSnapshot();
    scheduler.updateTargets({ automatic: [visible], explicit: [] });
    const duplicate = scheduler.getSnapshot()['run-touch'];
    expect(duplicate?.status === 'AVAILABLE' ? duplicate.lastAccessSequence : 0).toBe(1);

    scheduler.updateTargets({ automatic: [], explicit: [] });
    scheduler.updateTargets({
      automatic: [target('run-touch', 'VIEWPORT', 0, 2)],
      explicit: [],
    });
    const reused = scheduler.getSnapshot()['run-touch'];
    expect(reused).not.toBe(committed);
    expect(committed?.status === 'AVAILABLE' ? committed.lastAccessSequence : 0).toBe(1);
    expect(committed?.status === 'AVAILABLE' ? committed.lastAccessedAt : 0).toBe(10);
    expect(reused?.status === 'AVAILABLE' ? reused.lastAccessSequence : 0).toBe(2);
    expect(reused?.status === 'AVAILABLE' ? reused.lastAccessedAt : 0).toBe(20);
  });

  it('publishes one structurally shared snapshot when an available run re-enters demand', async () => {
    let time = 10;
    const snapshots: Array<ReturnType<ReturnType<typeof createProcessHistoryScheduler>['getSnapshot']>> = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      now: () => time,
      load: () => Promise.resolve(availableResult),
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    scheduler.updateTargets({
      automatic: [target('run-reused', 'VIEWPORT'), target('run-stable', 'VIEWPORT')],
      explicit: [],
    });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-reused']?.status).toBe('AVAILABLE');
      expect(scheduler.getSnapshot()['run-stable']?.status).toBe('AVAILABLE');
    });
    scheduler.updateTargets({ automatic: [], explicit: [] });
    const beforeReuse = snapshots.at(-1)!;
    const stableBeforeReuse = beforeReuse['run-stable'];
    const reusedBeforeReuse = beforeReuse['run-reused'];
    const snapshotCountBeforeReuse = snapshots.length;

    time = 20;
    scheduler.updateTargets({
      automatic: [target('run-reused', 'VIEWPORT', 0, 2)],
      explicit: [],
    });

    expect(snapshots).toHaveLength(snapshotCountBeforeReuse + 1);
    const afterReuse = snapshots.at(-1)!;
    expect(afterReuse['run-reused']).not.toBe(reusedBeforeReuse);
    expect(afterReuse['run-stable']).toBe(stableBeforeReuse);
    expect(afterReuse['run-reused']?.status === 'AVAILABLE' ? afterReuse['run-reused'].lastAccessedAt : 0).toBe(20);
  });

  it('evicts an oversized run whole when its final pin is released', async () => {
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxUnpinnedEnvelopes: 1,
      load: () =>
        Promise.resolve({
          availability: 'AVAILABLE',
          items: [{ eventId: 'one' }, { eventId: 'two' }] as unknown as readonly StreamEnvelope[],
        }),
    });

    scheduler.updateTargets({
      automatic: [target('run-oversized', 'VIEWPORT')],
      explicit: [],
    });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-oversized']?.status).toBe('AVAILABLE');
    });
    scheduler.updateTargets({ automatic: [], explicit: [] });

    expect(scheduler.getSnapshot()['run-oversized']).toBeUndefined();
  });

  it('pins the live run independently of viewport demand until the runtime releases it', async () => {
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      maxUnpinnedAvailableRuns: 0,
      load: () => Promise.resolve(availableResult),
    });

    scheduler.updateTargets({
      automatic: [target('run-live', 'VIEWPORT')],
      explicit: [],
      pinnedRunIds: ['run-live'],
    });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-live']?.status).toBe('AVAILABLE');
    });

    scheduler.updateTargets({
      automatic: [],
      explicit: [],
      pinnedRunIds: ['run-live'],
    });
    expect(scheduler.getSnapshot()['run-live']?.status).toBe('AVAILABLE');

    scheduler.updateTargets({ automatic: [], explicit: [], pinnedRunIds: [] });
    expect(scheduler.getSnapshot()['run-live']).toBeUndefined();
  });

  it('keeps only the current preview source pinned after a same-run panel outcome', async () => {
    const releases: ProcessHistoryExplicitDemandRelease[] = [];
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: async () => ({ availability: 'AVAILABLE', items: [] }),
      onExplicitDemandReleased: (release) => releases.push(release),
      maxUnpinnedAvailableRuns: 0,
    });
    const panelA = target('run-a', 'EXPLICIT', 0, 1);
    const previewA = {
      ...target('run-a', 'EXPLICIT', 0, 2),
      retention: 'WHILE_TARGETED',
    } as const;

    scheduler.updateTargets({ automatic: [], explicit: [panelA, previewA] });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-a']?.status).toBe('AVAILABLE');
    });

    expect(releases).toEqual([
      {
        scope: 'GENERATION',
        runId: 'run-a',
        generation: 1,
      },
    ]);
    expect(scheduler.getSnapshot()['run-a']?.status).toBe('AVAILABLE');

    const previewB = {
      ...target('run-b', 'EXPLICIT', 0, 3),
      retention: 'WHILE_TARGETED',
    } as const;
    scheduler.updateTargets({ automatic: [], explicit: [previewB] });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-b']?.status).toBe('AVAILABLE');
    });

    expect(scheduler.getSnapshot()['run-a']).toBeUndefined();
    expect(scheduler.getSnapshot()['run-b']?.status).toBe('AVAILABLE');
  });

  it('does not publish or replace available run references for target-only refreshes', async () => {
    const onChange = vi.fn();
    const scheduler = createProcessHistoryScheduler({
      sessionId: 'session-1',
      load: async () => availableResult,
      onChange,
    });
    scheduler.updateTargets({
      automatic: [target('run-stable', 'VIEWPORT', 10, 1)],
      explicit: [],
    });
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot()['run-stable']?.status).toBe('AVAILABLE');
    });
    const available = scheduler.getSnapshot()['run-stable'];
    onChange.mockClear();

    scheduler.updateTargets({
      automatic: [target('run-stable', 'VIEWPORT', 1, 2)],
      explicit: [],
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(scheduler.getSnapshot()['run-stable']).toBe(available);
  });
});
