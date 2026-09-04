import { brand } from '@nextagent/agent-common';
import type { BackgroundCompletionPayload, BackgroundTaskRecord, BackgroundTaskStoreGatewayPort } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it, vi } from 'vitest';
import { buildBackgroundCompletionCallback } from '../src/composition/background-completion.js';

describe('background completion callback (silent — no agent notification)', () => {
  it('records completion and emits a terminal event without notifying the agent', async () => {
    const store = createInMemoryStore();
    const record = taskRecord('task-bg-1');
    await store.create(record);
    const emit = vi.fn(async () => {});
    const callback = buildBackgroundCompletionCallback({
      backgroundTaskStore: store,
      emitSessionTimelineEvent: emit,
    });

    await callback(payload('task-bg-1', 0, 'COMPLETED'));

    // Completion is recorded in the store...
    expect(await store.get('task-bg-1')).toMatchObject({ status: 'COMPLETED', exitCode: 0 });
    // ...a terminal timeline event is emitted...
    expect(emit).toHaveBeenCalledTimes(1);
    // ...and the agent is NOT notified (silent completion; only kill notifies).
  });

  it('records a failed completion with its exit code', async () => {
    const store = createInMemoryStore();
    await store.create(taskRecord('task-bg-2'));
    const callback = buildBackgroundCompletionCallback({
      backgroundTaskStore: store,
      emitSessionTimelineEvent: vi.fn(async () => {}),
    });

    await callback(payload('task-bg-2', 2, 'FAILED'));

    expect(await store.get('task-bg-2')).toMatchObject({ status: 'FAILED', exitCode: 2 });
  });

  it('does not emit a terminal event when the task was already KILLED (kill→close race)', async () => {
    const store = createInMemoryStore();
    await store.create(taskRecord('task-bg-kill'));
    await store.markKilled('task-bg-kill', { finishedAt: brand<number, 'EpochMillis'>(500) });
    const emit = vi.fn(async () => {});
    const callback = buildBackgroundCompletionCallback({
      backgroundTaskStore: store,
      emitSessionTimelineEvent: emit,
    });

    // The post-kill close event arrives with a non-zero exit code.
    await callback(payload('task-bg-kill', 1, 'FAILED'));

    // No misleading BACKGROUND_TASK_FAILED event is emitted...
    expect(emit).not.toHaveBeenCalled();
    // ...and the KILLED status is preserved.
    expect(await store.get('task-bg-kill')).toMatchObject({ status: 'KILLED' });
  });
});

function payload(taskId: string, exitCode: number, status: 'COMPLETED' | 'FAILED'): BackgroundCompletionPayload {
  return { taskId, exitCode, status, finishedAt: brand<number, 'EpochMillis'>(999) };
}

function taskRecord(taskId: string): BackgroundTaskRecord {
  return {
    taskId,
    sessionId: brand<string, 'SessionId'>('session-bg'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    runId: brand<string, 'RequestRunId'>('run-bg'),
    requestId: brand<string, 'MessageId'>('request-bg'),
    requestContextId: brand<string, 'RequestContextId'>('context-bg'),
    toolCallId: 'tool-call-bg',
    commandName: 'npm',
    identityContext: { tenantId: brand<string, 'TenantId'>('tenant'), subjectId: brand<string, 'SubjectId'>('subject'), displayName: 'tester' },
    status: 'RUNNING',
    stdoutRef: `tool-results/${taskId}.stdout.txt`,
    stderrRef: `tool-results/${taskId}.stderr.txt`,
    startedAt: brand<number, 'EpochMillis'>(100),
    notified: false,
  };
}

function createInMemoryStore(): BackgroundTaskStoreGatewayPort {
  const tasks = new Map<string, BackgroundTaskRecord>();
  return {
    async create(record) {
      tasks.set(record.taskId, record);
      return record;
    },
    async get(taskId) {
      return tasks.get(taskId);
    },
    async list() {
      return [];
    },
    async markCompleted(taskId, result) {
      const record = tasks.get(taskId);
      if (record === undefined) {
        return undefined;
      }
      // Mirror the real store's sticky KILLED guard so the kill→close race
      // can be exercised through this in-memory mock.
      if (record.status === 'KILLED') {
        return undefined;
      }
      const updated = {
        ...record,
        status: result.exitCode === 0 ? ('COMPLETED' as const) : ('FAILED' as const),
        exitCode: result.exitCode,
        finishedAt: result.finishedAt,
      };
      tasks.set(taskId, updated);
      return updated;
    },
    async markNotified(taskId) {
      const record = tasks.get(taskId);
      if (record === undefined || record.notified) {
        return false;
      }
      tasks.set(taskId, { ...record, notified: true });
      return true;
    },
    async markKilled(taskId, result) {
      const record = tasks.get(taskId);
      if (record === undefined) {
        return undefined;
      }
      const updated = { ...record, status: 'KILLED' as const, finishedAt: result.finishedAt };
      tasks.set(taskId, updated);
      return updated;
    },
    async updateStatus(taskId, status) {
      const record = tasks.get(taskId);
      if (record === undefined) {
        return undefined;
      }
      const updated = { ...record, status };
      tasks.set(taskId, updated);
      return updated;
    },
    async remove(taskId) {
      return tasks.delete(taskId);
    },
  };
}
