import { brand, type PendingInputKind } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { deriveSessionActivityState, type SessionActivityInternalState } from '../src/services/session-activity-service.js';
import { makePendingInput, makeRun, sessionId } from './session-activity-helpers.js';

const pendingKinds: readonly PendingInputKind[] = ['QUESTION', 'CONFIRMATION', 'AUTHORIZATION', 'HUMAN_HANDOFF'];

describe('SessionActivityService derivation', () => {
  it.each(pendingKinds)('surfaces WAITING_FOR_INPUT for %s pending inputs on the latest run', (kind) => {
    const outcome = derive({
      latestRun: makeRun(sessionId, 'run-pending', 'EXECUTING', 'NOT_STARTED'),
      activePendingInput: makePendingInput(sessionId, 'run-pending', kind),
    });

    expect(outcome.publicEntry).toEqual({
      sessionId,
      status: 'WAITING_FOR_INPUT',
      pendingInputKind: kind,
    });
  });

  it.each([
    ['ACCEPTED', 'NOT_STARTED'],
    ['QUEUED', 'NOT_STARTED'],
    ['PLANNING', 'NOT_STARTED'],
    ['EXECUTING', 'NOT_STARTED'],
    ['COMPLETED', 'PENDING'],
    ['FAILED', 'RETRYING'],
  ] as const)('treats %s/%s as RUNNING', (status, terminalCommitState) => {
    const outcome = derive({
      latestRun: makeRun(sessionId, 'run-running', status, terminalCommitState),
    });

    expect(outcome.publicEntry).toEqual({ sessionId, status: 'RUNNING' });
  });

  it('surfaces only committed failures and results as unread terminal activities', () => {
    expect(
      derive({
        latestRun: makeRun(sessionId, 'run-failure', 'FAILED', 'COMMITTED'),
      }).publicEntry,
    ).toMatchObject({ sessionId, status: 'UNREAD_FAILURE' });
    expect(
      derive({
        latestRun: makeRun(sessionId, 'run-result', 'COMPLETED', 'COMMITTED'),
      }).publicEntry,
    ).toMatchObject({ sessionId, status: 'UNREAD_RESULT' });
  });

  it('does not surface canceled or superseded runs', () => {
    for (const status of ['CANCELED', 'SUPERSEDED'] as const) {
      expect(
        derive({
          latestRun: makeRun(sessionId, `run-${status}`, status, 'COMMITTED'),
        }),
      ).toEqual({
        publicEntry: { sessionId, status: 'NONE' },
      });
    }
  });

  it('uses latest R2 and ignores a pending input belonging to still-executing R1', () => {
    const outcome = derive({
      latestRun: makeRun(sessionId, 'run-r2', 'QUEUED', 'NOT_STARTED'),
      activePendingInput: makePendingInput(sessionId, 'run-r1', 'QUESTION'),
    });

    expect(outcome.publicEntry).toEqual({ sessionId, status: 'RUNNING' });
  });

  it('reuses the activity id for repeated terminal derivation from the same run', () => {
    const first = derive({
      latestRun: makeRun(sessionId, 'run-terminal', 'COMPLETED', 'COMMITTED'),
    });
    const second = derive({
      latestRun: makeRun(sessionId, 'run-terminal', 'COMPLETED', 'COMMITTED'),
      previousState: first.internalState,
    });

    expect(second).toEqual(first);
  });

  it('lets a newer accepted run replace older unread terminal state', () => {
    const first = derive({
      latestRun: makeRun(sessionId, 'run-r1', 'COMPLETED', 'COMMITTED'),
    });
    const second = derive({
      latestRun: makeRun(sessionId, 'run-r2', 'ACCEPTED', 'NOT_STARTED'),
      previousState: first.internalState,
    });

    expect(second.publicEntry).toEqual({ sessionId, status: 'RUNNING' });
  });

  it('keeps a consumed terminal run hidden but lets a newer terminal run become unread', () => {
    const consumed = {
      kind: 'CONSUMED_TERMINAL',
      sourceRunId: brand<string, 'RequestRunId'>('run-r1'),
    } satisfies SessionActivityInternalState;
    const sameRun = derive({
      latestRun: makeRun(sessionId, 'run-r1', 'COMPLETED', 'COMMITTED'),
      previousState: consumed,
    });
    const newRun = derive({
      latestRun: makeRun(sessionId, 'run-r2', 'COMPLETED', 'COMMITTED'),
      previousState: sameRun.internalState,
    });

    expect(sameRun).toEqual({
      publicEntry: { sessionId, status: 'NONE' },
      internalState: consumed,
    });
    expect(newRun.publicEntry).toMatchObject({ sessionId, status: 'UNREAD_RESULT' });
  });
});

function derive(input: {
  readonly latestRun?: ReturnType<typeof makeRun>;
  readonly activePendingInput?: ReturnType<typeof makePendingInput>;
  readonly previousState?: SessionActivityInternalState | undefined;
}) {
  return deriveSessionActivityState({
    sessionId,
    ...(input.latestRun === undefined ? {} : { latestRun: input.latestRun }),
    ...(input.activePendingInput === undefined ? {} : { activePendingInput: input.activePendingInput }),
    ...(input.previousState === undefined ? {} : { previousState: input.previousState }),
    createActivityId: () => 'activity-test',
  });
}
