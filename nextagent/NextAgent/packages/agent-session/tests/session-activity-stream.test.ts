import { describe, expect, it, type Mock } from 'vitest';
import {
  agentId,
  coordinates,
  createSessionActivityFixture,
  identityContext,
  makePendingInput,
  makeRun,
  makeSessionId,
  nextMessage,
  sessionId,
} from './session-activity-helpers.js';

describe('SessionActivityService stream', () => {
  it('bootstraps the complete scope and emits one non-NONE snapshot first', async () => {
    const fixture = createSessionActivityFixture();
    for (let index = 0; index < 101; index += 1) {
      const currentSessionId = makeSessionId(`session-${index}`);
      const inFlight = index === 0 || index === 100;
      fixture.addSession(currentSessionId, inFlight);
      if (inFlight) {
        fixture.setLane(currentSessionId, makeRun(currentSessionId, `run-${index}`, 'EXECUTING', 'NOT_STARTED'));
      }
    }
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    const first = await nextMessage(iterator);

    expect(first).toEqual({
      type: 'SNAPSHOT',
      entries: [
        { sessionId: makeSessionId('session-0'), status: 'RUNNING' },
        { sessionId: makeSessionId('session-100'), status: 'RUNNING' },
      ],
    });
    expect(fixture.sessionStore.listSessions).toHaveBeenCalledTimes(2);
    abortController.abort();
    await iterator.return?.();
  });

  it('rescans bootstrap when a deletion shifts a later session across an offset boundary', async () => {
    const fixture = createSessionActivityFixture();
    const deletedSessionId = makeSessionId('session-0');
    const runningSessionId = makeSessionId('session-100');
    for (let index = 0; index < 101; index += 1) {
      const currentSessionId = makeSessionId(`session-${index}`);
      const inFlight = currentSessionId === runningSessionId;
      fixture.addSession(currentSessionId, inFlight);
      if (inFlight) {
        fixture.setLane(currentSessionId, makeRun(currentSessionId, 'run-100', 'EXECUTING', 'NOT_STARTED'));
      }
    }
    const listSessions = fixture.sessionStore.listSessions as Mock;
    const originalListSessions = listSessions.getMockImplementation();
    if (originalListSessions === undefined) {
      throw new Error('Expected the session activity fixture to provide a listSessions implementation.');
    }
    listSessions.mockImplementation(async (query) => {
      const page = await originalListSessions(query);
      if (listSessions.mock.calls.length === 1) {
        fixture.deleteSession(deletedSessionId);
        fixture.service.invalidateDeletedSession(coordinates(deletedSessionId));
      }
      return page;
    });
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    expect(await nextMessage(iterator)).toEqual({
      type: 'SNAPSHOT',
      entries: [{ sessionId: runningSessionId, status: 'RUNNING' }],
    });

    abortController.abort();
    await iterator.return?.();
  });

  it('does not seed durable terminal history after process restart', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId, false);
    fixture.setLane(sessionId, makeRun(sessionId, 'old-terminal', 'COMPLETED', 'COMMITTED'));
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    expect(await nextMessage(iterator)).toEqual({ type: 'SNAPSHOT', entries: [] });

    abortController.abort();
    await iterator.return?.();
  });

  it('reclaims an empty scope after its last subscriber disconnects', async () => {
    const fixture = createSessionActivityFixture();
    const firstAbortController = new AbortController();
    const first = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: firstAbortController.signal,
      })
      [Symbol.asyncIterator]();

    expect(await nextMessage(first)).toEqual({ type: 'SNAPSHOT', entries: [] });
    firstAbortController.abort();
    await first.return?.();

    const secondAbortController = new AbortController();
    const second = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: secondAbortController.signal,
      })
      [Symbol.asyncIterator]();

    expect(await nextMessage(second)).toEqual({ type: 'SNAPSHOT', entries: [] });
    expect(fixture.sessionStore.listSessions).toHaveBeenCalledTimes(2);
    secondAbortController.abort();
    await second.return?.();
  });

  it('keeps a connecting subscriber attached when the previous subscriber disconnects', async () => {
    const fixture = createSessionActivityFixture();
    const firstAbortController = new AbortController();
    const first = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: firstAbortController.signal,
      })
      [Symbol.asyncIterator]();
    expect(await nextMessage(first)).toEqual({ type: 'SNAPSHOT', entries: [] });
    const firstPending = first.next();

    fixture.addSession(sessionId);
    const loadLane = fixture.requestRuns.loadSessionLaneSnapshot as Mock;
    const originalLoadLane = loadLane.getMockImplementation();
    if (originalLoadLane === undefined) {
      throw new Error('Expected the session activity fixture to provide a lane implementation.');
    }
    let releaseLaneRead: (() => void) | undefined;
    const laneReadStarted = new Promise<void>((resolveStarted) => {
      loadLane.mockImplementationOnce(async (query) => {
        resolveStarted();
        await new Promise<void>((resolve) => {
          releaseLaneRead = resolve;
        });
        return originalLoadLane(query);
      });
    });
    fixture.service.invalidateSessionActivity(coordinates());
    await laneReadStarted;

    const secondAbortController = new AbortController();
    const second = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: secondAbortController.signal,
      })
      [Symbol.asyncIterator]();
    const secondSnapshot = second.next();

    firstAbortController.abort();
    await expect(firstPending).resolves.toMatchObject({ done: true });
    releaseLaneRead?.();
    await expect(secondSnapshot).resolves.toEqual({
      done: false,
      value: { type: 'SNAPSHOT', entries: [] },
    });

    fixture.setLane(sessionId, makeRun(sessionId, 'run-after-reconnect', 'EXECUTING', 'NOT_STARTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    expect(await nextMessage(second)).toEqual({
      type: 'DELTA',
      entry: { sessionId, status: 'RUNNING' },
    });

    secondAbortController.abort();
    await second.return?.();
  });

  it('publishes session-keyed deltas, NONE cleanup, and keeps activity without subscribers', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-1', 'EXECUTING', 'NOT_STARTED'));
    fixture.service.invalidateSessionActivity(coordinates());

    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    expect(await nextMessage(iterator)).toEqual({
      type: 'SNAPSHOT',
      entries: [{ sessionId, status: 'RUNNING' }],
    });

    fixture.setPending(sessionId, makePendingInput(sessionId, 'run-1', 'QUESTION'));
    fixture.service.invalidateSessionActivity(coordinates());
    expect(await nextMessage(iterator)).toEqual({
      type: 'DELTA',
      entry: { sessionId, status: 'WAITING_FOR_INPUT', pendingInputKind: 'QUESTION' },
    });

    fixture.setPending(sessionId, undefined);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-1', 'CANCELED', 'COMMITTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    expect(await nextMessage(iterator)).toEqual({
      type: 'DELTA',
      entry: { sessionId, status: 'NONE' },
    });

    abortController.abort();
    await iterator.return?.();
  });

  it('replaces waiting input with unread failure after canonical timeout terminal facts', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-timeout', 'EXECUTING', 'NOT_STARTED'));
    fixture.setPending(sessionId, makePendingInput(sessionId, 'run-timeout', 'QUESTION'));
    fixture.service.invalidateSessionActivity(coordinates());
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    expect(await nextMessage(iterator)).toEqual({
      type: 'SNAPSHOT',
      entries: [{ sessionId, status: 'WAITING_FOR_INPUT', pendingInputKind: 'QUESTION' }],
    });

    fixture.setPending(sessionId, undefined);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-timeout', 'FAILED', 'COMMITTED'));
    fixture.service.invalidateSessionActivity(coordinates());

    expect(await nextMessage(iterator)).toEqual({
      type: 'DELTA',
      entry: {
        sessionId,
        status: 'UNREAD_FAILURE',
        activityId: expect.any(String),
      },
    });

    abortController.abort();
    await iterator.return?.();
  });

  it('coalesces rapid invalidations and does not emit an equal-state delta', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-1', 'EXECUTING', 'NOT_STARTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    await nextMessage(iterator);

    fixture.service.invalidateSessionActivity(coordinates());
    const equalStateNext = iterator.next();
    expect(await Promise.race([equalStateNext.then(() => 'message'), new Promise<'idle'>((resolve) => setTimeout(() => resolve('idle'), 30))])).toBe(
      'idle',
    );

    fixture.setLane(sessionId, makeRun(sessionId, 'run-2', 'COMPLETED', 'COMMITTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    fixture.service.invalidateSessionActivity(coordinates());
    expect(await equalStateNext).toMatchObject({
      done: false,
      value: {
        type: 'DELTA',
        entry: { sessionId, status: 'UNREAD_RESULT' },
      },
    });

    abortController.abort();
    await iterator.return?.();
  });

  it('fails closed on bootstrap reads and retries from a fresh snapshot on the next connection', async () => {
    const fixture = createSessionActivityFixture();
    const listSessions = fixture.sessionStore.listSessions as Mock;
    listSessions.mockRejectedValueOnce(new Error('bootstrap unavailable'));
    const first = fixture.service
      .streamActivities({
        identityContext,
        agentId,
      })
      [Symbol.asyncIterator]();

    await expect(first.next()).rejects.toThrow('bootstrap unavailable');

    const abortController = new AbortController();
    const second = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    expect(await nextMessage(second)).toEqual({ type: 'SNAPSHOT', entries: [] });
    abortController.abort();
    await second.return?.();
  });

  it('closes live subscribers on rederive failure without publishing a fake NONE', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-1', 'EXECUTING', 'NOT_STARTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
      })
      [Symbol.asyncIterator]();
    await nextMessage(iterator);
    const loadLane = fixture.requestRuns.loadSessionLaneSnapshot as Mock;
    loadLane.mockRejectedValueOnce(new Error('lane unavailable'));

    fixture.service.invalidateSessionActivity(coordinates());

    await expect(iterator.next()).rejects.toThrow('lane unavailable');
    await iterator.return?.();
  });
});
