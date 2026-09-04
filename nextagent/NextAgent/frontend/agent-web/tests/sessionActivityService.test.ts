import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../src/services/apiClient.ts';
import { parseSessionActivityMessage, sessionActivityService } from '../src/services/sessionActivityService.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSessionActivityMessage', () => {
  it('accepts the strict snapshot and delta discriminated unions', () => {
    expect(
      parseSessionActivityMessage(
        JSON.stringify({
          type: 'SNAPSHOT',
          entries: [
            { sessionId: 's1', status: 'RUNNING' },
            { sessionId: 's2', status: 'WAITING_FOR_INPUT', pendingInputKind: 'HUMAN_HANDOFF' },
            { sessionId: 's3', status: 'UNREAD_FAILURE', activityId: 'activity-3' },
            { sessionId: 's4', status: 'UNREAD_RESULT', activityId: 'activity-4' },
          ],
        }),
      ),
    ).toEqual({
      type: 'SNAPSHOT',
      entries: [
        { sessionId: 's1', status: 'RUNNING' },
        { sessionId: 's2', status: 'WAITING_FOR_INPUT', pendingInputKind: 'HUMAN_HANDOFF' },
        { sessionId: 's3', status: 'UNREAD_FAILURE', activityId: 'activity-3' },
        { sessionId: 's4', status: 'UNREAD_RESULT', activityId: 'activity-4' },
      ],
    });

    expect(
      parseSessionActivityMessage(
        JSON.stringify({
          type: 'DELTA',
          entry: { sessionId: 's1', status: 'NONE' },
        }),
      ),
    ).toEqual({
      type: 'DELTA',
      entry: { sessionId: 's1', status: 'NONE' },
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['unknown message field', JSON.stringify({ type: 'SNAPSHOT', entries: [], unexpected: true })],
    [
      'unknown entry field',
      JSON.stringify({
        type: 'DELTA',
        entry: { sessionId: 's1', status: 'RUNNING', unexpected: true },
      }),
    ],
    [
      'conditional pending field',
      JSON.stringify({
        type: 'DELTA',
        entry: { sessionId: 's1', status: 'RUNNING', pendingInputKind: 'QUESTION' },
      }),
    ],
    [
      'conditional activity field',
      JSON.stringify({
        type: 'DELTA',
        entry: { sessionId: 's1', status: 'WAITING_FOR_INPUT', pendingInputKind: 'QUESTION', activityId: 'a1' },
      }),
    ],
    [
      'NONE inside a snapshot',
      JSON.stringify({
        type: 'SNAPSHOT',
        entries: [{ sessionId: 's1', status: 'NONE' }],
      }),
    ],
    [
      'activity id beyond the contract limit',
      JSON.stringify({
        type: 'DELTA',
        entry: { sessionId: 's1', status: 'UNREAD_RESULT', activityId: 'a'.repeat(257) },
      }),
    ],
  ])('rejects %s', (_caseName, raw) => {
    expect(() => parseSessionActivityMessage(raw)).toThrow('Invalid session activity message');
  });
});

describe('sessionActivityService.consume', () => {
  it('posts the strict consume body to the encoded session route', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined);

    await sessionActivityService.consume({
      sessionId: 'session/1',
      activityId: 'activity-1',
      observedRunId: 'run-1',
    });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/sessions/session%2F1/activity/consume',
      { activityId: 'activity-1', observedRunId: 'run-1' },
      undefined,
    );
  });

  it('deduplicates only the exact concurrent consume coordinates', async () => {
    const resolvePosts: Array<() => void> = [];
    const post = vi.spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePosts.push(resolve);
        }),
    );
    const command = {
      sessionId: 'session-1',
      activityId: 'activity-1',
      observedRunId: 'run-1',
    } as const;

    const first = sessionActivityService.consume(command);
    const duplicate = sessionActivityService.consume(command);
    const differentRun = sessionActivityService.consume({ ...command, observedRunId: 'run-current' });

    expect(first).toBe(duplicate);
    expect(differentRun).not.toBe(first);
    expect(post).toHaveBeenCalledTimes(2);
    for (const resolvePost of resolvePosts) {
      resolvePost();
    }
    await Promise.all([first, differentRun]);
  });

  it('starts a fresh consume after the matching in-flight request is aborted', async () => {
    const firstAbortController = new AbortController();
    const resolvePosts: Array<() => void> = [];
    const post = vi.spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePosts.push(resolve);
        }),
    );
    const command = {
      sessionId: 'session-1',
      activityId: 'activity-1',
      observedRunId: 'run-1',
    } as const;

    const first = sessionActivityService.consume({
      ...command,
      signal: firstAbortController.signal,
    });
    firstAbortController.abort();
    const retry = sessionActivityService.consume({
      ...command,
      signal: new AbortController().signal,
    });

    expect(retry).not.toBe(first);
    expect(post).toHaveBeenCalledTimes(2);
    for (const resolvePost of resolvePosts) {
      resolvePost();
    }
    await Promise.all([first, retry]);
  });

  it('retains no completed in-flight entry after success or failure', async () => {
    const post = vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const command = {
      sessionId: 'session-1',
      activityId: 'activity-1',
      observedRunId: 'run-1',
    } as const;

    await expect(sessionActivityService.consume(command)).rejects.toThrow('offline');
    await expect(sessionActivityService.consume(command)).resolves.toBeUndefined();

    expect(post).toHaveBeenCalledTimes(2);
  });
});
