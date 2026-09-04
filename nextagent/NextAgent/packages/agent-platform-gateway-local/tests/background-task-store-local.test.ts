import { brand } from '@nextagent/agent-common';
import { createLocalBackgroundTaskStore } from '@nextagent/agent-platform-gateway-local';
import { describe, expect, it } from 'vitest';

describe('local background task store', () => {
  it('creates, gets, and lists tasks scoped by session', async () => {
    const store = createLocalBackgroundTaskStore();
    const record = taskRecord('task-1', 'session-a');

    await store.create(record);

    expect(await store.get('task-1')).toEqual(record);
    expect(await store.list(brand('session-a'))).toEqual([record]);
    expect(await store.list(brand('session-b'))).toEqual([]);
  });

  it('markCompleted records terminal status, exit code, and finishedAt', async () => {
    const store = createLocalBackgroundTaskStore();
    await store.create(taskRecord('task-2', 'session-a'));

    const completed = await store.markCompleted('task-2', { exitCode: 0, finishedAt: brand(200) });

    expect(completed).toMatchObject({ taskId: 'task-2', status: 'COMPLETED', exitCode: 0, finishedAt: 200 });
    const stored = await store.get('task-2');
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.exitCode).toBe(0);
  });

  it('markCompleted maps non-zero exit code to FAILED status', async () => {
    const store = createLocalBackgroundTaskStore();
    await store.create(taskRecord('task-3', 'session-a'));

    const failed = await store.markCompleted('task-3', { exitCode: 2, finishedAt: brand(300) });

    expect(failed?.status).toBe('FAILED');
    expect(failed?.exitCode).toBe(2);
  });

  it('markNotified wins exactly once (atomic CAS) so duplicate completion does not duplicate notification', async () => {
    const store = createLocalBackgroundTaskStore();
    await store.create(taskRecord('task-4', 'session-a'));

    expect(await store.markNotified('task-4')).toBe(true);
    // Second call (duplicate close / race with run-cancel) MUST NOT win.
    expect(await store.markNotified('task-4')).toBe(false);
    expect(await store.markNotified('task-4')).toBe(false);

    const stored = await store.get('task-4');
    expect(stored?.notified).toBe(true);
  });

  it('markNotified returns false for an unknown task', async () => {
    const store = createLocalBackgroundTaskStore();
    expect(await store.markNotified('unknown')).toBe(false);
  });

  it('markCompleted and markNotified are no-ops for an unknown task', async () => {
    const store = createLocalBackgroundTaskStore();
    expect(await store.markCompleted('unknown', { exitCode: 0, finishedAt: brand(1) })).toBeUndefined();
    expect(await store.get('unknown')).toBeUndefined();
  });

  it('updateStatus transitions status without losing notified flag', async () => {
    const store = createLocalBackgroundTaskStore();
    await store.create(taskRecord('task-5', 'session-a'));
    expect(await store.markNotified('task-5')).toBe(true);

    const updated = await store.updateStatus('task-5', 'KILLED');

    expect(updated?.status).toBe('KILLED');
    expect(updated?.notified).toBe(true);
  });

  it('markKilled sets status KILLED and finishedAt', async () => {
    const store = createLocalBackgroundTaskStore();
    await store.create(taskRecord('task-6', 'session-a'));

    const killed = await store.markKilled('task-6', { finishedAt: brand(500) });

    expect(killed).toMatchObject({ taskId: 'task-6', status: 'KILLED', finishedAt: 500 });
    const stored = await store.get('task-6');
    expect(stored?.status).toBe('KILLED');
    expect(stored?.finishedAt).toBe(500);
  });

  it('markKilled is a no-op for an unknown task', async () => {
    const store = createLocalBackgroundTaskStore();
    expect(await store.markKilled('unknown', { finishedAt: brand(1) })).toBeUndefined();
  });

  it('markCompleted is a sticky no-op when status is already KILLED (kill→close race)', async () => {
    const store = createLocalBackgroundTaskStore();
    await store.create(taskRecord('task-7', 'session-a'));
    await store.markKilled('task-7', { finishedAt: brand(500) });

    // The post-kill close event arrives and tries to mark the task FAILED.
    const result = await store.markCompleted('task-7', { exitCode: 1, finishedAt: brand(600) });

    expect(result).toBeUndefined();
    const stored = await store.get('task-7');
    // KILLED status is preserved; exitCode/finishedAt from the close are NOT applied.
    expect(stored?.status).toBe('KILLED');
    expect(stored?.finishedAt).toBe(500);
    expect(stored?.exitCode).toBeUndefined();
  });
});

function taskRecord(taskId: string, sessionId: string) {
  return {
    taskId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    runId: brand<string, 'RequestRunId'>('run-bg'),
    requestId: brand<string, 'MessageId'>('request-bg'),
    requestContextId: brand<string, 'RequestContextId'>('context-bg'),
    toolCallId: 'tool-call-1',
    commandName: 'npm',
    identityContext: { tenantId: brand<string, 'TenantId'>('tenant'), subjectId: brand<string, 'SubjectId'>('subject'), displayName: 'tester' },
    status: 'RUNNING' as const,
    stdoutRef: `tool-results/${taskId}.stdout.txt`,
    stderrRef: `tool-results/${taskId}.stderr.txt`,
    startedAt: brand<number, 'EpochMillis'>(100),
    notified: false,
  };
}
