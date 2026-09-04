import type { StreamEnvelope } from '../../../state/contracts.ts';
import { MAX_CONCURRENT_RUN_LOADS, type CompleteRunProcessHistory } from './processHistory.ts';

export type ProcessHistoryPriority = 'EXPLICIT' | 'VIEWPORT' | 'PRELOAD';

export interface ProcessHistoryTarget {
  readonly sessionId: string;
  readonly rootMessageId: string;
  readonly runId: string;
  readonly priority: ProcessHistoryPriority;
  readonly generation: number;
  readonly distanceFromViewportCenter: number;
  readonly retention?: 'UNTIL_OUTCOME' | 'WHILE_TARGETED';
}

export type ProcessHistorySchedulerRunState =
  | { readonly status: 'QUEUED' }
  | { readonly status: 'LOADING'; readonly startedAt: number }
  | {
      readonly status: 'AVAILABLE';
      readonly envelopes: readonly StreamEnvelope[];
      readonly lastAccessedAt: number;
      readonly lastAccessSequence: number;
    }
  | { readonly status: 'LEGACY_UNAVAILABLE' }
  | { readonly status: 'FAILED'; readonly errorCode: 'PROCESS_HISTORY_LOAD_FAILED' };

export interface ProcessHistoryTargetUpdate {
  readonly automatic: readonly ProcessHistoryTarget[];
  readonly explicit: readonly ProcessHistoryTarget[];
  readonly pinnedRunIds?: readonly string[];
}

export type ProcessHistoryExplicitDemandRelease =
  | {
      readonly scope: 'GENERATION';
      readonly runId: string;
      readonly generation: number;
    }
  | {
      readonly scope: 'RUN';
      readonly runId: string;
    };

export interface ProcessHistoryScheduler {
  readonly updateTargets: (targets: ProcessHistoryTargetUpdate) => void;
  readonly retry: (target: ProcessHistoryTarget) => boolean;
  readonly getSnapshot: () => Readonly<Record<string, ProcessHistorySchedulerRunState | undefined>>;
  readonly clear: (options?: { readonly notify?: boolean }) => void;
}

interface ProcessHistorySchedulerOptions {
  readonly sessionId: string;
  readonly load: (target: ProcessHistoryTarget, signal: AbortSignal) => Promise<CompleteRunProcessHistory>;
  readonly onChange?: (snapshot: Readonly<Record<string, ProcessHistorySchedulerRunState | undefined>>) => void;
  readonly onOutcome?: (target: ProcessHistoryTarget) => void;
  readonly onExplicitDemandReleased?: (release: ProcessHistoryExplicitDemandRelease) => void;
  readonly now?: () => number;
  readonly maxConcurrentLoads?: number;
  readonly maxAutomaticTargets?: number;
  readonly maxExplicitTargets?: number;
  readonly maxUnpinnedAvailableRuns?: number;
  readonly maxUnpinnedEnvelopes?: number;
}

interface QueuedRunState {
  readonly status: 'QUEUED';
  target: ProcessHistoryTarget;
}

interface LoadingRunState {
  readonly status: 'LOADING';
  readonly target: ProcessHistoryTarget;
  readonly startedAt: number;
  readonly requestIdentity: number;
  readonly controller: AbortController;
}

type InternalRunState =
  | QueuedRunState
  | LoadingRunState
  | {
      readonly status: 'AVAILABLE';
      readonly envelopes: readonly StreamEnvelope[];
      lastAccessedAt: number;
      lastAccessSequence: number;
    }
  | { readonly status: 'LEGACY_UNAVAILABLE' }
  | { readonly status: 'FAILED'; readonly errorCode: 'PROCESS_HISTORY_LOAD_FAILED' };

export const MAX_AUTOMATIC_PROCESS_HISTORY_TARGETS = 16;
export const MAX_EXPLICIT_PROCESS_HISTORY_TARGETS = 16;
export const PROCESS_HISTORY_AUTOMATIC_TARGET_SETTLE_MS = 120;
const DEFAULT_MAX_UNPINNED_AVAILABLE_RUNS = 64;
const DEFAULT_MAX_UNPINNED_ENVELOPES = 2_000;

export interface ProcessHistoryAutomaticTargetSettler {
  readonly update: (targets: readonly ProcessHistoryTarget[]) => void;
  readonly filter: (predicate: (target: ProcessHistoryTarget) => boolean) => void;
  readonly clear: () => void;
}

export function createProcessHistoryAutomaticTargetSettler(options: {
  readonly publish: (targets: readonly ProcessHistoryTarget[]) => void;
  readonly settleMs?: number;
}): ProcessHistoryAutomaticTargetSettler {
  const settleMs = options.settleMs ?? PROCESS_HISTORY_AUTOMATIC_TARGET_SETTLE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestTargets: readonly ProcessHistoryTarget[] = [];

  return {
    update: (targets) => {
      latestTargets = targets;
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        options.publish(latestTargets);
      }, settleMs);
    },
    filter: (predicate) => {
      latestTargets = latestTargets.filter(predicate);
    },
    clear: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      latestTargets = [];
    },
  };
}

const PRIORITY_RANK: Readonly<Record<ProcessHistoryPriority, number>> = {
  EXPLICIT: 0,
  VIEWPORT: 1,
  PRELOAD: 2,
};

function compareTargets(left: ProcessHistoryTarget, right: ProcessHistoryTarget): number {
  const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priority !== 0) {
    return priority;
  }
  if (left.priority === 'EXPLICIT') {
    return right.generation - left.generation || left.runId.localeCompare(right.runId);
  }
  return (
    left.distanceFromViewportCenter - right.distanceFromViewportCenter || right.generation - left.generation || left.runId.localeCompare(right.runId)
  );
}

function selectLatestByRun(targets: readonly ProcessHistoryTarget[]): readonly ProcessHistoryTarget[] {
  const latestByRun = new Map<string, ProcessHistoryTarget>();
  for (const target of targets) {
    const current = latestByRun.get(target.runId);
    if (!current || target.generation > current.generation) {
      latestByRun.set(target.runId, target);
    }
  }
  return [...latestByRun.values()];
}

function publicState(state: InternalRunState): ProcessHistorySchedulerRunState {
  switch (state.status) {
    case 'QUEUED':
      return { status: 'QUEUED' };
    case 'LOADING':
      return { status: 'LOADING', startedAt: state.startedAt };
    case 'AVAILABLE':
      return {
        status: 'AVAILABLE',
        envelopes: state.envelopes,
        lastAccessedAt: state.lastAccessedAt,
        lastAccessSequence: state.lastAccessSequence,
      };
    case 'LEGACY_UNAVAILABLE':
      return { status: 'LEGACY_UNAVAILABLE' };
    case 'FAILED':
      return { status: 'FAILED', errorCode: state.errorCode };
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export function createProcessHistoryScheduler(options: ProcessHistorySchedulerOptions): ProcessHistoryScheduler {
  const now = options.now ?? Date.now;
  const maxConcurrentLoads = options.maxConcurrentLoads ?? MAX_CONCURRENT_RUN_LOADS;
  const maxAutomaticTargets = options.maxAutomaticTargets ?? MAX_AUTOMATIC_PROCESS_HISTORY_TARGETS;
  const maxExplicitTargets = options.maxExplicitTargets ?? MAX_EXPLICIT_PROCESS_HISTORY_TARGETS;
  const maxUnpinnedAvailableRuns = options.maxUnpinnedAvailableRuns ?? DEFAULT_MAX_UNPINNED_AVAILABLE_RUNS;
  const maxUnpinnedEnvelopes = options.maxUnpinnedEnvelopes ?? DEFAULT_MAX_UNPINNED_ENVELOPES;
  const states = new Map<string, InternalRunState>();
  let automaticTargets = new Map<string, ProcessHistoryTarget>();
  let explicitTargets = new Map<string, ProcessHistoryTarget>();
  let retainedExplicitTargets = new Map<string, ProcessHistoryTarget>();
  let pinnedRunIds = new Set<string>();
  const activeRequestIdentities = new Set<number>();
  let nextRequestIdentity = 0;
  let nextAccessSequence = 0;
  let cleared = false;
  let snapshot: Readonly<Record<string, ProcessHistorySchedulerRunState | undefined>> = {};
  const publicStateCache = new Map<
    string,
    {
      readonly internal: InternalRunState;
      readonly value: ProcessHistorySchedulerRunState;
    }
  >();

  const rebuildSnapshot = (): boolean => {
    const nextEntries = [...states.entries()].map(([runId, state]) => {
      const cached = publicStateCache.get(runId);
      if (cached?.internal === state) {
        return [runId, cached.value] as const;
      }
      const value = publicState(state);
      publicStateCache.set(runId, { internal: state, value });
      return [runId, value] as const;
    });
    const nextRunIds = new Set(nextEntries.map(([runId]) => runId));
    for (const runId of publicStateCache.keys()) {
      if (!nextRunIds.has(runId)) {
        publicStateCache.delete(runId);
      }
    }
    const next = Object.fromEntries(nextEntries);
    const changed = Object.keys(snapshot).length !== nextEntries.length || nextEntries.some(([runId, value]) => snapshot[runId] !== value);
    if (changed) {
      snapshot = next;
    }
    return changed;
  };

  const getSnapshot = (): Readonly<Record<string, ProcessHistorySchedulerRunState | undefined>> => {
    rebuildSnapshot();
    return snapshot;
  };

  const notify = (): void => {
    if (rebuildSnapshot()) {
      options.onChange?.(snapshot);
    }
  };

  const effectiveTarget = (runId: string): ProcessHistoryTarget | undefined => {
    const explicit = explicitTargets.get(runId);
    const retainedExplicit = retainedExplicitTargets.get(runId);
    const automatic = automaticTargets.get(runId);
    return [explicit, retainedExplicit, automatic].filter((target): target is ProcessHistoryTarget => target !== undefined).sort(compareTargets)[0];
  };

  const allEffectiveTargets = (): readonly ProcessHistoryTarget[] => {
    const runIds = new Set([...automaticTargets.keys(), ...explicitTargets.keys(), ...retainedExplicitTargets.keys()]);
    return [...runIds].map((runId) => effectiveTarget(runId)).filter((target): target is ProcessHistoryTarget => target !== undefined);
  };

  const effectiveDemandRunIds = (): ReadonlySet<string> =>
    new Set([...automaticTargets.keys(), ...explicitTargets.keys(), ...retainedExplicitTargets.keys()]);

  const touchAvailable = (runId: string, state: Extract<InternalRunState, { status: 'AVAILABLE' }>): void => {
    states.set(runId, {
      ...state,
      lastAccessedAt: now(),
      lastAccessSequence: ++nextAccessSequence,
    });
  };

  const isPinned = (runId: string): boolean =>
    automaticTargets.has(runId) ||
    explicitTargets.has(runId) ||
    retainedExplicitTargets.has(runId) ||
    pinnedRunIds.has(runId) ||
    states.get(runId)?.status === 'LOADING';

  const enforceCacheCapacity = (): void => {
    const candidates = [...states.entries()]
      .filter(
        (entry): entry is [string, Extract<InternalRunState, { status: 'AVAILABLE' }>] => entry[1].status === 'AVAILABLE' && !isPinned(entry[0]),
      )
      .sort(
        (left, right) =>
          left[1].lastAccessedAt - right[1].lastAccessedAt ||
          left[1].lastAccessSequence - right[1].lastAccessSequence ||
          left[0].localeCompare(right[0]),
      );
    let availableRuns = candidates.length;
    let envelopeCount = candidates.reduce((total, [, state]) => total + state.envelopes.length, 0);
    for (const [runId, state] of candidates) {
      if (availableRuns <= maxUnpinnedAvailableRuns && envelopeCount <= maxUnpinnedEnvelopes) {
        break;
      }
      states.delete(runId);
      availableRuns -= 1;
      envelopeCount -= state.envelopes.length;
    }
  };

  const releaseExplicitDemand = (runId: string): ProcessHistoryTarget | undefined => {
    const explicit = explicitTargets.get(runId);
    if (!explicit) {
      return undefined;
    }
    explicitTargets.delete(runId);
    options.onExplicitDemandReleased?.({
      scope: 'GENERATION',
      runId,
      generation: explicit.generation,
    });
    return explicit;
  };

  const completeOutcome = (target: ProcessHistoryTarget): void => {
    const satisfiedTarget = releaseExplicitDemand(target.runId) ?? target;
    options.onOutcome?.(satisfiedTarget);
  };

  const acceptExplicitTargets = (requested: readonly ProcessHistoryTarget[]): void => {
    const validRequested = requested.filter((target) => target.sessionId === options.sessionId);
    const sourcesByRun = new Map<string, ProcessHistoryTarget[]>();
    for (const target of validRequested) {
      const sources = sourcesByRun.get(target.runId);
      if (sources) {
        sources.push(target);
      } else {
        sourcesByRun.set(target.runId, [target]);
      }
    }
    const acceptedRuns = [...sourcesByRun.entries()]
      .map(([runId, sources]) => ({
        runId,
        sources,
        latest: [...sources].sort(compareTargets)[0]!,
      }))
      .sort((left, right) => compareTargets(left.latest, right.latest))
      .slice(0, maxExplicitTargets);
    const accepted = acceptedRuns.flatMap(({ sources }) => {
      const transient = [...sources].filter((target) => target.retention !== 'WHILE_TARGETED').sort(compareTargets)[0];
      const retained = [...sources].filter((target) => target.retention === 'WHILE_TARGETED').sort(compareTargets)[0];
      return [transient, retained].filter((target): target is ProcessHistoryTarget => target !== undefined);
    });
    explicitTargets = new Map(
      [...selectLatestByRun(accepted.filter((target) => target.retention !== 'WHILE_TARGETED'))]
        .sort(compareTargets)
        .map((target) => [target.runId, target]),
    );
    retainedExplicitTargets = new Map(
      [...selectLatestByRun(accepted.filter((target) => target.retention === 'WHILE_TARGETED'))]
        .sort(compareTargets)
        .map((target) => [target.runId, target]),
    );
    const acceptedCoordinates = new Set(
      [...explicitTargets.values(), ...retainedExplicitTargets.values()].map((target) => `${target.runId}\u0000${target.generation}`),
    );
    const releasedGenerations = new Set<string>();
    for (const target of validRequested) {
      if (acceptedCoordinates.has(`${target.runId}\u0000${target.generation}`)) {
        continue;
      }
      const releaseKey = `${target.runId}\u0000${target.generation}`;
      if (!releasedGenerations.has(releaseKey)) {
        releasedGenerations.add(releaseKey);
        options.onExplicitDemandReleased?.({
          scope: 'GENERATION',
          runId: target.runId,
          generation: target.generation,
        });
      }
    }
  };

  const schedule = (): void => {
    if (cleared) {
      return;
    }
    const queued = [...states.values()]
      .filter((state): state is QueuedRunState => state.status === 'QUEUED')
      .sort((left, right) => compareTargets(left.target, right.target));

    while (activeRequestIdentities.size < maxConcurrentLoads) {
      const queuedState = queued.shift();
      if (!queuedState) {
        break;
      }
      const target = effectiveTarget(queuedState.target.runId);
      if (!target) {
        states.delete(queuedState.target.runId);
        continue;
      }

      const controller = new AbortController();
      const requestIdentity = ++nextRequestIdentity;
      const loadingState: LoadingRunState = {
        status: 'LOADING',
        target,
        startedAt: now(),
        requestIdentity,
        controller,
      };
      states.set(target.runId, loadingState);
      activeRequestIdentities.add(requestIdentity);
      notify();

      void options
        .load(target, controller.signal)
        .then((result) => {
          const current = states.get(target.runId);
          if (cleared || controller.signal.aborted || current?.status !== 'LOADING' || current.requestIdentity !== requestIdentity) {
            return;
          }
          states.set(
            target.runId,
            result.availability === 'AVAILABLE'
              ? {
                  status: 'AVAILABLE',
                  envelopes: result.items,
                  lastAccessedAt: now(),
                  lastAccessSequence: ++nextAccessSequence,
                }
              : { status: 'LEGACY_UNAVAILABLE' },
          );
          completeOutcome(target);
        })
        .catch((error: unknown) => {
          const current = states.get(target.runId);
          if (
            cleared ||
            controller.signal.aborted ||
            isAbortError(error) ||
            current?.status !== 'LOADING' ||
            current.requestIdentity !== requestIdentity
          ) {
            return;
          }
          states.set(target.runId, {
            status: 'FAILED',
            errorCode: 'PROCESS_HISTORY_LOAD_FAILED',
          });
          completeOutcome(target);
        })
        .finally(() => {
          const releasedOwnIdentity = activeRequestIdentities.delete(requestIdentity);
          if (!releasedOwnIdentity || cleared) {
            return;
          }
          enforceCacheCapacity();
          notify();
          schedule();
        });
    }
  };

  const synchronizeQueuedStates = (): void => {
    for (const [runId, state] of states) {
      const target = effectiveTarget(runId);
      if (state.status === 'QUEUED' && !target) {
        states.delete(runId);
      } else if (state.status === 'QUEUED' && target) {
        state.target = target;
      }
    }
    for (const target of allEffectiveTargets()) {
      const state = states.get(target.runId);
      const explicit = explicitTargets.get(target.runId);
      if (
        explicit &&
        explicit.generation === target.generation &&
        (state?.status === 'AVAILABLE' || state?.status === 'FAILED' || state?.status === 'LEGACY_UNAVAILABLE')
      ) {
        releaseExplicitDemand(explicit.runId);
        continue;
      }
      if (!state) {
        states.set(target.runId, { status: 'QUEUED', target });
      }
    }
  };

  const updateTargets = (update: ProcessHistoryTargetUpdate): void => {
    if (cleared) {
      return;
    }
    const previousDemandRunIds = effectiveDemandRunIds();
    automaticTargets = new Map(
      selectLatestByRun(update.automatic)
        .filter((target) => target.sessionId === options.sessionId)
        .sort(compareTargets)
        .slice(0, maxAutomaticTargets)
        .map((target) => [target.runId, target]),
    );
    pinnedRunIds = new Set(update.pinnedRunIds ?? []);
    acceptExplicitTargets(update.explicit);
    for (const runId of effectiveDemandRunIds()) {
      const state = states.get(runId);
      if (!previousDemandRunIds.has(runId) && state?.status === 'AVAILABLE') {
        touchAvailable(runId, state);
      }
    }
    synchronizeQueuedStates();
    enforceCacheCapacity();
    notify();
    schedule();
  };

  return {
    updateTargets,
    retry: (target) => {
      if (cleared || target.sessionId !== options.sessionId || states.get(target.runId)?.status === 'LEGACY_UNAVAILABLE') {
        return false;
      }
      const current = states.get(target.runId);
      if (current?.status !== 'FAILED') {
        return false;
      }
      const retryTarget = { ...target, priority: 'EXPLICIT' } as const;
      acceptExplicitTargets([...explicitTargets.values(), ...retainedExplicitTargets.values(), retryTarget]);
      if (!explicitTargets.has(target.runId)) {
        return false;
      }
      states.set(target.runId, { status: 'QUEUED', target: retryTarget });
      notify();
      schedule();
      return true;
    },
    getSnapshot,
    clear: (clearOptions) => {
      if (cleared) {
        return;
      }
      cleared = true;
      automaticTargets.clear();
      explicitTargets.clear();
      retainedExplicitTargets.clear();
      pinnedRunIds.clear();
      for (const state of states.values()) {
        if (state.status === 'LOADING') {
          state.controller.abort();
        }
      }
      activeRequestIdentities.clear();
      states.clear();
      if (clearOptions?.notify === false) {
        snapshot = {};
        publicStateCache.clear();
      } else {
        notify();
      }
    },
  };
}
