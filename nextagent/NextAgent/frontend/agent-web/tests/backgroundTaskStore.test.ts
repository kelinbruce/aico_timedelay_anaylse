import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundTaskStore } from '../src/state/backgroundTaskStore.ts';
import type { BackgroundTaskView, StreamEnvelope } from '../src/state/contracts.ts';

function task(overrides: Partial<BackgroundTaskView> = {}): BackgroundTaskView {
  return {
    taskId: 'task-1',
    commandName: 'sleep',
    status: 'RUNNING',
    startedAt: 1_000,
    stdoutRef: 'out.txt',
    stderrRef: 'err.txt',
    ...overrides,
  };
}

function envelope(sessionId: string, eventType: StreamEnvelope['eventType'], payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId: `${sessionId}-${eventType}`,
    sessionId,
    requestId: 'request-old-attempt',
    runId: 'run-old-attempt',
    rootMessageId: 'root-old-attempt',
    requestContextId: 'attempt-old',
    sequence: 1,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload,
    createdAt: '2026-07-22T00:00:00.000Z',
  } as StreamEnvelope;
}

describe('backgroundTaskStore', () => {
  beforeEach(() => {
    useBackgroundTaskStore.setState({ tasksBySession: {} });
  });

  it('does not publish state for ordinary conversation envelopes', () => {
    const before = useBackgroundTaskStore.getState();
    const subscriber = vi.fn();
    const unsubscribe = useBackgroundTaskStore.subscribe(subscriber);

    useBackgroundTaskStore.getState().applyStreamEnvelope(envelope('session-1', 'LLM_CONTENT_DELTA', { content: 'delta' }));

    expect(useBackgroundTaskStore.getState()).toBe(before);
    expect(subscriber).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('merges a late seed without reverting a newer live terminal', () => {
    const store = useBackgroundTaskStore.getState();
    store.applyStreamEnvelope(
      envelope('session-1', 'BACKGROUND_TASK_STARTED', {
        taskId: 'task-1',
        commandName: 'sleep',
        status: 'RUNNING',
        startedAt: 1_000,
        stdoutRef: 'out.txt',
        stderrRef: 'err.txt',
      }),
    );
    store.seedTasks('session-1', [task({ commandLine: 'sleep 30' })]);
    store.applyStreamEnvelope(
      envelope('session-1', 'BACKGROUND_TASK_COMPLETED', {
        taskId: 'task-1',
        commandName: 'sleep',
        status: 'COMPLETED',
        startedAt: 1_000,
        finishedAt: 2_000,
        exitCode: 0,
        stdoutRef: 'out.txt',
        stderrRef: 'err.txt',
      }),
    );

    store.seedTasks('session-1', [task({ commandLine: 'sleep 30', status: 'RUNNING' })]);

    expect(useBackgroundTaskStore.getState().tasksBySession['session-1']).toEqual([
      task({ commandLine: 'sleep 30', status: 'COMPLETED', finishedAt: 2_000, exitCode: 0 }),
    ]);
  });

  it('keeps tasks session-scoped and applies terminal events when STARTED was missed', () => {
    useBackgroundTaskStore.getState().seedTasks('session-2', [task({ taskId: 'task-other' })]);
    useBackgroundTaskStore.getState().applyStreamEnvelope(
      envelope('session-1', 'BACKGROUND_TASK_FAILED', {
        taskId: 'task-old-attempt',
        commandName: 'bash',
        status: 'FAILED',
        startedAt: 3_000,
        finishedAt: 4_000,
        exitCode: 1,
        stdoutRef: 'old.out',
        stderrRef: 'old.err',
      }),
    );

    expect(useBackgroundTaskStore.getState().tasksBySession['session-1']?.[0]).toMatchObject({
      taskId: 'task-old-attempt',
      status: 'FAILED',
      finishedAt: 4_000,
    });
    expect(useBackgroundTaskStore.getState().tasksBySession['session-2']?.[0]?.taskId).toBe('task-other');
  });

  it('does not let seed or live delivery overwrite a local KILLED state', () => {
    const store = useBackgroundTaskStore.getState();
    store.seedTasks('session-1', [task()]);
    store.markTaskKilled('session-1', 'task-1', 2_000);
    store.applyStreamEnvelope(
      envelope('session-1', 'BACKGROUND_TASK_FAILED', {
        taskId: 'task-1',
        commandName: 'sleep',
        status: 'FAILED',
        startedAt: 1_000,
        finishedAt: 3_000,
        exitCode: 143,
        stdoutRef: 'out.txt',
        stderrRef: 'err.txt',
      }),
    );
    store.seedTasks('session-1', [task({ status: 'RUNNING' })]);

    expect(useBackgroundTaskStore.getState().tasksBySession['session-1']?.[0]).toMatchObject({
      status: 'KILLED',
      finishedAt: 2_000,
    });
  });
});
