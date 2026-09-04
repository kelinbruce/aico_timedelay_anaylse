import { describe, expect, it } from 'vitest';

const actions = ['FORK', 'RETRY', 'EDIT', 'SHARE', 'RELOAD', 'RESTART', 'REPLAY'] as const;
type Action = (typeof actions)[number];

const requiredGuardOutcomes = [
  'ACCEPTED',
  'ACTIVE',
  'TERMINAL_PENDING',
  'STALE',
  'NON_LATEST',
  'RETRY_LIMIT',
  'ATTACHMENT_UNAVAILABLE',
  'CROSS_SCOPE',
  'UNSAFE_REFERENCE',
] as const;
type GuardOutcome = (typeof requiredGuardOutcomes)[number];

const requiredSeeds = [
  ['RETRY', 'EDIT', 'FORK'],
  ['EDIT', 'RETRY', 'FORK'],
  ['FORK', 'RETRY', 'EDIT', 'FORK', 'RETRY'],
  ['FORK', 'EDIT', 'RETRY', 'FORK', 'EDIT'],
] as const satisfies ReadonlyArray<readonly Action[]>;

interface TraversalReport {
  readonly visitedStates: number;
  readonly attemptedTransitions: number;
  readonly acceptedTransitions: number;
  readonly rejectedTransitions: number;
  readonly actionCounts: Readonly<Record<Action, number>>;
  readonly guardOutcomeCounts: Readonly<Record<GuardOutcome, number>>;
  readonly completedSeeds: ReadonlyArray<readonly Action[]>;
  readonly stateCoverage?: {
    readonly origins: ReadonlyArray<SemanticState['origin']>;
    readonly latestKinds: ReadonlyArray<SemanticState['latest']>;
    readonly runStates: ReadonlyArray<SemanticState['runState']>;
    readonly retryCounts: ReadonlyArray<SemanticState['retryCount']>;
    readonly consecutiveEdits: ReadonlyArray<SemanticState['consecutiveEdits']>;
  };
  readonly shortestFailureSequence?: readonly Action[];
}

interface SemanticState {
  readonly origin: 'NATIVE' | 'FORK_1' | 'FORK_2';
  readonly latest: 'COPIED_ONLY' | 'REAL_ATTEMPT' | 'EDITED_REPLACEMENT';
  readonly runState: 'NONE' | 'ACTIVE' | 'TERMINAL_COMMITTED' | 'TERMINAL_PENDING';
  readonly retryCount: 0 | 1 | 5;
  readonly consecutiveEdits: 0 | 1 | 2;
  readonly sharePoint: 'NONE' | 'BEFORE_REPLACEMENT' | 'AFTER_RETRY' | 'AFTER_EDIT' | 'AFTER_FORK';
  readonly evolved: boolean;
  readonly target: 'LATEST' | 'STALE' | 'NON_LATEST';
  readonly attachment: 'AVAILABLE' | 'UNAVAILABLE';
  readonly scope: 'MATCH' | 'CROSS';
  readonly eventRefs: 'SAFE' | 'UNSAFE';
}

interface Transition {
  readonly outcome: GuardOutcome;
  readonly state: SemanticState;
}

interface TraversalNode {
  readonly state: SemanticState;
  readonly sequence: readonly Action[];
}

const initialState: SemanticState = {
  origin: 'NATIVE',
  latest: 'REAL_ATTEMPT',
  runState: 'TERMINAL_COMMITTED',
  retryCount: 0,
  consecutiveEdits: 0,
  sharePoint: 'NONE',
  evolved: false,
  target: 'LATEST',
  attachment: 'AVAILABLE',
  scope: 'MATCH',
  eventRefs: 'SAFE',
};

function replace(state: SemanticState, updates: Partial<SemanticState>): SemanticState {
  return { ...state, ...updates };
}

function applyAction(state: SemanticState, action: Action): Transition {
  if (state.scope === 'CROSS') {
    return { outcome: 'CROSS_SCOPE', state };
  }
  if (action === 'FORK') {
    if (state.eventRefs === 'UNSAFE') {
      return { outcome: 'UNSAFE_REFERENCE', state };
    }
    return {
      outcome: 'ACCEPTED',
      state: replace(state, {
        origin: state.origin === 'NATIVE' ? 'FORK_1' : 'FORK_2',
        latest: 'COPIED_ONLY',
        runState: 'NONE',
        retryCount: 0,
        consecutiveEdits: 0,
        sharePoint: 'AFTER_FORK',
        evolved: false,
      }),
    };
  }
  if (action === 'RELOAD' || action === 'RESTART' || action === 'REPLAY') {
    return { outcome: 'ACCEPTED', state };
  }
  if (action === 'SHARE') {
    return {
      outcome: 'ACCEPTED',
      state: replace(state, {
        sharePoint: state.latest === 'EDITED_REPLACEMENT' ? 'AFTER_EDIT' : state.retryCount > 0 ? 'AFTER_RETRY' : 'BEFORE_REPLACEMENT',
      }),
    };
  }
  if (state.attachment === 'UNAVAILABLE') {
    return { outcome: 'ATTACHMENT_UNAVAILABLE', state };
  }
  if (state.runState === 'ACTIVE') {
    return { outcome: 'ACTIVE', state };
  }
  if (state.runState === 'TERMINAL_PENDING') {
    return { outcome: 'TERMINAL_PENDING', state };
  }
  if (state.target === 'STALE') {
    return { outcome: 'STALE', state };
  }
  if (state.target === 'NON_LATEST' || (state.latest === 'COPIED_ONLY' && state.evolved)) {
    return { outcome: 'NON_LATEST', state };
  }
  if (action === 'RETRY') {
    if (state.retryCount === 5) {
      return { outcome: 'RETRY_LIMIT', state };
    }
    return {
      outcome: 'ACCEPTED',
      state: replace(state, {
        latest: state.latest === 'COPIED_ONLY' ? 'REAL_ATTEMPT' : state.latest,
        runState: 'TERMINAL_COMMITTED',
        retryCount: state.retryCount === 0 ? 1 : 5,
        consecutiveEdits: 0,
        evolved: true,
      }),
    };
  }
  return {
    outcome: 'ACCEPTED',
    state: replace(state, {
      latest: 'EDITED_REPLACEMENT',
      runState: 'TERMINAL_COMMITTED',
      retryCount: 0,
      consecutiveEdits: state.consecutiveEdits === 0 ? 1 : 2,
      evolved: true,
    }),
  };
}

function semanticKey(state: SemanticState): string {
  return JSON.stringify(state);
}

function invariantViolation(state: SemanticState): boolean {
  return (
    (state.latest === 'COPIED_ONLY' && state.runState !== 'NONE') ||
    (state.latest !== 'COPIED_ONLY' && state.runState === 'NONE') ||
    (state.origin === 'NATIVE' && state.latest === 'COPIED_ONLY')
  );
}

function buildTraversalReport(): TraversalReport {
  const seedStates: readonly SemanticState[] = [
    initialState,
    replace(initialState, { origin: 'FORK_1', latest: 'COPIED_ONLY', runState: 'NONE' }),
    replace(initialState, { runState: 'ACTIVE' }),
    replace(initialState, { runState: 'TERMINAL_PENDING' }),
    replace(initialState, { target: 'STALE' }),
    replace(initialState, { target: 'NON_LATEST' }),
    replace(initialState, { retryCount: 5 }),
    replace(initialState, { attachment: 'UNAVAILABLE' }),
    replace(initialState, { scope: 'CROSS' }),
    replace(initialState, { eventRefs: 'UNSAFE' }),
    replace(initialState, { origin: 'FORK_1', latest: 'COPIED_ONLY', runState: 'NONE', evolved: true }),
  ];
  const queue: TraversalNode[] = seedStates.map((state) => ({ state, sequence: [] }));
  const visited = new Set<string>();
  const actionCounts = Object.fromEntries(actions.map((action) => [action, 0])) as Record<Action, number>;
  const guardOutcomeCounts = Object.fromEntries(requiredGuardOutcomes.map((outcome) => [outcome, 0])) as Record<GuardOutcome, number>;
  const origins = new Set<SemanticState['origin']>();
  const latestKinds = new Set<SemanticState['latest']>();
  const runStates = new Set<SemanticState['runState']>();
  const retryCounts = new Set<SemanticState['retryCount']>();
  const consecutiveEdits = new Set<SemanticState['consecutiveEdits']>();
  let attemptedTransitions = 0;
  let acceptedTransitions = 0;
  let shortestFailureSequence: readonly Action[] | undefined;
  while (queue.length > 0) {
    const node = queue.shift()!;
    const key = semanticKey(node.state);
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    origins.add(node.state.origin);
    latestKinds.add(node.state.latest);
    runStates.add(node.state.runState);
    retryCounts.add(node.state.retryCount);
    consecutiveEdits.add(node.state.consecutiveEdits);
    if (invariantViolation(node.state)) {
      shortestFailureSequence ??= node.sequence;
      continue;
    }
    for (const action of actions) {
      attemptedTransitions += 1;
      actionCounts[action] += 1;
      const transition = applyAction(node.state, action);
      guardOutcomeCounts[transition.outcome] += 1;
      if (transition.outcome === 'ACCEPTED') {
        acceptedTransitions += 1;
        queue.push({ state: transition.state, sequence: [...node.sequence, action] });
      }
    }
  }
  const completedSeeds = requiredSeeds.filter((seed) => {
    let state = initialState;
    for (const action of seed) {
      const transition = applyAction(state, action);
      if (transition.outcome !== 'ACCEPTED' || invariantViolation(transition.state)) {
        return false;
      }
      state = transition.state;
    }
    return true;
  });
  return {
    visitedStates: visited.size,
    attemptedTransitions,
    acceptedTransitions,
    rejectedTransitions: attemptedTransitions - acceptedTransitions,
    actionCounts,
    guardOutcomeCounts,
    completedSeeds,
    stateCoverage: {
      origins: [...origins].sort(),
      latestKinds: [...latestKinds].sort(),
      runStates: [...runStates].sort(),
      retryCounts: [...retryCounts].sort((left, right) => left - right),
      consecutiveEdits: [...consecutiveEdits].sort((left, right) => left - right),
    },
    ...(shortestFailureSequence === undefined ? {} : { shortestFailureSequence }),
  };
}

describe('fork action deterministic state traversal', () => {
  it('attempts every action and covers every bounded guard outcome', () => {
    const report = buildTraversalReport();

    expect(report).toMatchObject({
      visitedStates: 130,
      attemptedTransitions: 910,
      acceptedTransitions: 799,
      rejectedTransitions: 111,
    });
    expect(report.attemptedTransitions).toBe(report.visitedStates * actions.length);
    for (const action of actions) {
      expect(report.actionCounts[action], action).toBe(report.visitedStates);
    }
    for (const outcome of requiredGuardOutcomes) {
      expect(report.guardOutcomeCounts[outcome], outcome).toBeGreaterThan(0);
    }
    expect(report.completedSeeds).toEqual(requiredSeeds);
    expect(report.stateCoverage).toEqual({
      origins: ['FORK_1', 'FORK_2', 'NATIVE'],
      latestKinds: ['COPIED_ONLY', 'EDITED_REPLACEMENT', 'REAL_ATTEMPT'],
      runStates: ['ACTIVE', 'NONE', 'TERMINAL_COMMITTED', 'TERMINAL_PENDING'],
      retryCounts: [0, 1, 5],
      consecutiveEdits: [0, 1, 2],
    });
    expect(report.shortestFailureSequence).toBeUndefined();
  });
});
