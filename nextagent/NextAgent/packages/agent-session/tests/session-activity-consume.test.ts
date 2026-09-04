import { brand } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { agentId, coordinates, createSessionActivityFixture, identityContext, makeRun, nextMessage, sessionId } from './session-activity-helpers.js';

describe('SessionActivityService terminal consume', () => {
  it('consumes only the matching activity and observed run, then suppresses the same terminal fact', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-terminal', 'COMPLETED', 'COMMITTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    const snapshot = await nextMessage(iterator);
    const terminal = snapshot.type === 'SNAPSHOT' ? snapshot.entries[0] : undefined;
    if (terminal?.status !== 'UNREAD_RESULT') {
      throw new Error('Expected terminal unread activity.');
    }

    await fixture.service.consumeTerminalActivity({
      identityContext,
      agentId,
      sessionId,
      activityId: terminal.activityId,
      observedRunId: brand('run-terminal'),
    });

    expect(await nextMessage(iterator)).toEqual({
      type: 'DELTA',
      entry: { sessionId, status: 'NONE' },
    });
    fixture.service.invalidateSessionActivity(coordinates());
    const repeated = iterator.next();
    expect(await Promise.race([repeated.then(() => 'message'), new Promise<'idle'>((resolve) => setTimeout(() => resolve('idle'), 30))])).toBe(
      'idle',
    );

    abortController.abort();
    await expect(repeated).resolves.toEqual({ done: true, value: undefined });
    await iterator.return?.();
  });

  it('treats stale, repeated, and run-mismatched consumes as no-op', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);
    fixture.setLane(sessionId, makeRun(sessionId, 'run-terminal', 'FAILED', 'COMMITTED'));
    fixture.service.invalidateSessionActivity(coordinates());
    const abortController = new AbortController();
    const iterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    const snapshot = await nextMessage(iterator);
    const terminal = snapshot.type === 'SNAPSHOT' ? snapshot.entries[0] : undefined;
    if (terminal?.status !== 'UNREAD_FAILURE') {
      throw new Error('Expected terminal unread activity.');
    }

    await fixture.service.consumeTerminalActivity({
      identityContext,
      agentId,
      sessionId,
      activityId: 'stale-activity',
      observedRunId: brand('run-terminal'),
    });
    await fixture.service.consumeTerminalActivity({
      identityContext,
      agentId,
      sessionId,
      activityId: terminal.activityId,
      observedRunId: brand('other-run'),
    });

    abortController.abort();
    await iterator.return?.();

    const nextAbortController = new AbortController();
    const nextIterator = fixture.service
      .streamActivities({
        identityContext,
        agentId,
        signal: nextAbortController.signal,
      })
      [Symbol.asyncIterator]();
    expect(await nextMessage(nextIterator)).toEqual({
      type: 'SNAPSHOT',
      entries: [terminal],
    });
    nextAbortController.abort();
    await nextIterator.return?.();
  });

  it('rejects cross-scope consume before inspecting opaque activity identifiers', async () => {
    const fixture = createSessionActivityFixture();
    fixture.addSession(sessionId);

    await expect(
      fixture.service.consumeTerminalActivity({
        identityContext: {
          ...identityContext,
          tenantId: brand('other-tenant'),
        },
        agentId,
        sessionId,
        activityId: 'opaque',
        observedRunId: brand('run-terminal'),
      }),
    ).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
      category: 'NOT_FOUND',
    });
  });
});
