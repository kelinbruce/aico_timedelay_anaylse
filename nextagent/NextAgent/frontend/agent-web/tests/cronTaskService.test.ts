import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cronTaskService } from '../src/services/cronTaskService.ts';

describe('cronTaskService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists cron tasks with only pagination query fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tasks: [], total: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cronTaskService.listCronTasks({ offset: 5, limit: 25 });

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/api/v1/cron-tasks?');
    expect(calledUrl).toContain('offset=5');
    expect(calledUrl).toContain('limit=25');
    expect(calledUrl).not.toContain('agentId=');
    expect(calledUrl).not.toContain('sessionId=');
  });

  it('creates cron tasks with only schedulable fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(task()),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cronTaskService.createCronTask({
      cron: '0 9 * * *',
      prompt: 'daily report',
      target: { kind: 'WORKFLOW', name: 'daily-report' },
      recurring: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/cron-tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cron: '0 9 * * *', prompt: 'daily report', target: { kind: 'WORKFLOW', name: 'daily-report' }, recurring: true }),
      }),
    );
  });

  it('updates cron tasks with only provided schedulable fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(task()),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cronTaskService.updateCronTask('cron/1', { prompt: 'changed', target: null });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/cron-tasks/cron%2F1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ prompt: 'changed', target: null }),
      }),
    );
  });

  it('deletes cron tasks without a request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await cronTaskService.deleteCronTask('cron-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/cron-tasks/cron-1',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('executes cron tasks without client-supplied scope fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(execution()),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cronTaskService.executeCronTask('cron/1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/cron-tasks/cron%2F1/runs',
      expect.objectContaining({
        method: 'POST',
        body: null,
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls[0]?.[1])).not.toContain('agentId');
  });

  it('lists task executions with only pagination query fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ executions: [], total: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cronTaskService.listCronTaskExecutions('cron-1', { offset: 0, limit: 50 });

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/api/v1/cron-tasks/cron-1/runs?');
    expect(calledUrl).toContain('offset=0');
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).not.toContain('runId=');
    expect(calledUrl).not.toContain('sessionId=');
  });
});

function task() {
  return {
    taskId: 'cron-1',
    cron: '0 9 * * *',
    humanSchedule: 'Every day at 09:00',
    prompt: 'daily report',
    recurring: true,
    status: 'ACTIVE',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    nextRunAt: '2026-07-23T01:00:00.000Z',
  };
}

function execution() {
  return {
    triggerId: 'trigger-1',
    taskId: 'cron-1',
    scheduledAt: '2026-07-22T00:00:00.000Z',
    triggerStatus: 'ACCEPTED',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}
