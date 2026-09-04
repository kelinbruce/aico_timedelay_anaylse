import { brand, type EpochMillis, type SafeError } from '@nextagent/agent-common';
import type { TaskTrajectoryRecord } from '@nextagent/agent-contracts/gateway';
import { createTaskTrajectoryWorker, type TaskTrajectoryWorkerDiagnostic } from '../src/task-trajectory-worker.js';
import { describe, expect, it, vi } from 'vitest';

const scope = {
  tenantId: brand<string, 'TenantId'>('tenant-worker'),
  subjectId: brand<string, 'SubjectId'>('subject-worker'),
  agentId: brand<string, 'AgentId'>('agent-worker'),
  sessionId: brand<string, 'SessionId'>('session-worker'),
  requestId: brand<string, 'MessageId'>('request-worker'),
  requestRunId: brand<string, 'RequestRunId'>('run-worker'),
};
const now = (value: number): EpochMillis => brand<number, 'EpochMillis'>(value);

describe('TaskTrajectoryWorker observability', () => {
  it('emits safe diagnostics for build success without raw content', async () => {
    const diagnostics: TaskTrajectoryWorkerDiagnostic[] = [];
    const raw = 'raw prompt token=secret C:/private.txt';
    const record = trajectoryRecord(raw);
    const worker = createTaskTrajectoryWorker({
      builder: { build: vi.fn(async () => ({ status: 'BUILT', record }) as const) },
      store: { saveTaskTrajectory: vi.fn(async () => record) },
      query: { listTaskTrajectories: vi.fn(), listBuildCandidates: vi.fn(async () => ({ items: [] })) },
      diagnosticObserver: (event) => diagnostics.push(event),
      batchSize: 1,
      retryAttempts: 1,
    });

    worker.enqueue(scope);
    await worker.drainOnce();

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'ENQUEUED', reasonCode: 'TASK_TRAJECTORY_BUILD_ENQUEUED' }),
        expect.objectContaining({ status: 'BUILT', reasonCode: 'TASK_TRAJECTORY_BUILT', requestRunId: scope.requestRunId }),
      ]),
    );
    expect(JSON.stringify(diagnostics)).not.toContain(raw);
    await worker.stop();
  });

  it('emits safe diagnostics for build failure', async () => {
    const diagnostics: TaskTrajectoryWorkerDiagnostic[] = [];
    const safeError: SafeError = { code: 'TASK_TRAJECTORY_BUILD_FAILED', message: 'safe', category: 'UNAVAILABLE', retryable: true };
    const worker = createTaskTrajectoryWorker({
      builder: { build: vi.fn(async () => ({ status: 'FAILED', safeError }) as const) },
      store: { saveTaskTrajectory: vi.fn() },
      query: { listTaskTrajectories: vi.fn(), listBuildCandidates: vi.fn(async () => ({ items: [] })) },
      diagnosticObserver: (event) => diagnostics.push(event),
      batchSize: 1,
      retryAttempts: 1,
    });

    worker.enqueue(scope);
    await worker.drainOnce();

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        status: 'FAILED',
        reasonCode: 'TASK_TRAJECTORY_BUILD_FAILED',
        requestRunId: scope.requestRunId,
      }),
    );
    await worker.stop();
  });

  it('reconciles missed pending signals through build candidates', async () => {
    const diagnostics: TaskTrajectoryWorkerDiagnostic[] = [];
    const record = trajectoryRecord('safe summary');
    const save = vi.fn(async () => record);
    const worker = createTaskTrajectoryWorker({
      builder: { build: vi.fn(async () => ({ status: 'BUILT', record }) as const) },
      store: { saveTaskTrajectory: save },
      query: {
        listTaskTrajectories: vi.fn(),
        listBuildCandidates: vi.fn(async () => ({
          items: [
            {
              ...scope,
              terminalTimelineEventId: 'event-terminal',
              terminalTimelineSequence: brand<number, 'TimelineSequence'>(2),
              terminalStatus: 'COMPLETED' as const,
              terminalCommittedAt: now(2),
            },
          ],
        })),
      },
      catchUpScope: {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
      },
      diagnosticObserver: (event) => diagnostics.push(event),
      batchSize: 1,
      retryAttempts: 1,
    });

    await worker.drainOnce();

    expect(save).toHaveBeenCalledTimes(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        status: 'BUILT',
        reasonCode: 'TASK_TRAJECTORY_BUILT',
        requestRunId: scope.requestRunId,
      }),
    );
    await worker.stop();
  });

  it('scans all configured catch-up agent scopes', async () => {
    const secondaryScope = {
      ...scope,
      agentId: brand<string, 'AgentId'>('agent-worker-secondary'),
      sessionId: brand<string, 'SessionId'>('session-worker-secondary'),
      requestId: brand<string, 'MessageId'>('request-worker-secondary'),
      requestRunId: brand<string, 'RequestRunId'>('run-worker-secondary'),
    };
    const record = {
      ...trajectoryRecord('safe summary'),
      agentId: secondaryScope.agentId,
      sessionId: secondaryScope.sessionId,
      requestId: secondaryScope.requestId,
      requestRunId: secondaryScope.requestRunId,
    };
    const build = vi.fn(async (_ref: unknown) => ({ status: 'BUILT', record }) as const);
    const listBuildCandidates = vi.fn(async (query: { readonly agentId: typeof scope.agentId }) => ({
      items:
        query.agentId === secondaryScope.agentId
          ? [
              {
                ...secondaryScope,
                terminalTimelineEventId: 'event-terminal-secondary',
                terminalTimelineSequence: brand<number, 'TimelineSequence'>(2),
                terminalStatus: 'COMPLETED' as const,
                terminalCommittedAt: now(2),
              },
            ]
          : [],
    }));
    const worker = createTaskTrajectoryWorker({
      builder: { build },
      store: { saveTaskTrajectory: vi.fn(async () => record) },
      query: { listTaskTrajectories: vi.fn(), listBuildCandidates },
      catchUpScopes: [
        { tenantId: scope.tenantId, subjectId: scope.subjectId, agentId: scope.agentId },
        { tenantId: secondaryScope.tenantId, subjectId: secondaryScope.subjectId, agentId: secondaryScope.agentId },
      ],
      batchSize: 1,
      retryAttempts: 1,
    });

    await worker.drainOnce();

    expect(listBuildCandidates).toHaveBeenCalledTimes(2);
    const builtRef = build.mock.calls[0]?.[0];
    expect(builtRef).toMatchObject({
      agentId: secondaryScope.agentId,
      requestRunId: secondaryScope.requestRunId,
    });
    await worker.stop();
  });

  it('retries retryable build failures through the same worker path', async () => {
    const record = trajectoryRecord('safe retry summary');
    const safeError: SafeError = { code: 'TASK_TRAJECTORY_TEMPORARY_FAILURE', message: 'safe', category: 'UNAVAILABLE', retryable: true };
    const save = vi.fn(async () => record);
    const build = vi.fn(async () =>
      build.mock.calls.length === 1 ? ({ status: 'FAILED', safeError } as const) : ({ status: 'BUILT', record } as const),
    );
    const worker = createTaskTrajectoryWorker({
      builder: { build },
      store: { saveTaskTrajectory: save },
      query: {
        listTaskTrajectories: vi.fn(),
        listBuildCandidates: vi.fn(async () => ({
          items: [
            {
              ...scope,
              terminalTimelineEventId: 'event-terminal',
              terminalTimelineSequence: brand<number, 'TimelineSequence'>(2),
              terminalStatus: 'COMPLETED' as const,
              terminalCommittedAt: now(2),
            },
          ],
        })),
      },
      catchUpScope: {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
      },
      batchSize: 1,
      retryAttempts: 2,
      retryBackoffMs: 0,
    });

    await worker.drainOnce();
    await worker.drainOnce();

    expect(build).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('does not retry non-retryable build failures', async () => {
    const safeError: SafeError = { code: 'TASK_TRAJECTORY_INVALID_PROJECTION', message: 'safe', category: 'VALIDATION', retryable: false };
    const build = vi.fn(async () => ({ status: 'FAILED', safeError }) as const);
    const worker = createTaskTrajectoryWorker({
      builder: { build },
      store: { saveTaskTrajectory: vi.fn() },
      query: { listTaskTrajectories: vi.fn(), listBuildCandidates: vi.fn(async () => ({ items: [] })) },
      batchSize: 1,
      retryAttempts: 3,
      retryBackoffMs: 0,
    });

    worker.enqueue(scope);
    await worker.drainOnce();
    await worker.drainOnce();

    expect(build).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('drops new pending work at the configured pending limit', async () => {
    const diagnostics: TaskTrajectoryWorkerDiagnostic[] = [];
    const worker = createTaskTrajectoryWorker({
      builder: { build: vi.fn(async () => ({ status: 'SKIPPED', reasonCode: 'TASK_TRAJECTORY_NOT_APPLICABLE' }) as const) },
      store: { saveTaskTrajectory: vi.fn() },
      query: { listTaskTrajectories: vi.fn(), listBuildCandidates: vi.fn(async () => ({ items: [] })) },
      diagnosticObserver: (event) => diagnostics.push(event),
      maxPending: 1,
    });

    worker.enqueue(scope);
    worker.enqueue({ ...scope, requestRunId: brand<string, 'RequestRunId'>('run-worker-dropped') });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        status: 'DROPPED',
        reasonCode: 'TASK_TRAJECTORY_PENDING_LIMIT',
        requestRunId: brand<string, 'RequestRunId'>('run-worker-dropped'),
      }),
    );
    await worker.stop();
  });

  it('cancels an in-flight build during shutdown', async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let observedAbort = false;
    const worker = createTaskTrajectoryWorker({
      builder: {
        build: vi.fn(async (_ref, signal) => {
          markStarted();
          await new Promise<void>((resolve) => {
            if (signal?.aborted === true) {
              resolve();
              return;
            }
            signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          observedAbort = signal?.aborted === true;
          return { status: 'SKIPPED', reasonCode: 'TASK_TRAJECTORY_NOT_APPLICABLE' } as const;
        }),
      },
      store: { saveTaskTrajectory: vi.fn() },
      query: { listTaskTrajectories: vi.fn(), listBuildCandidates: vi.fn(async () => ({ items: [] })) },
      batchSize: 1,
    });

    worker.enqueue(scope);
    await started;
    await worker.stop();

    expect(observedAbort).toBe(true);
  });
});

function trajectoryRecord(rawSummary: string): TaskTrajectoryRecord {
  return {
    tenantId: scope.tenantId,
    subjectId: scope.subjectId,
    agentId: scope.agentId,
    taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-worker'),
    sessionId: scope.sessionId,
    requestId: scope.requestId,
    requestRunId: scope.requestRunId,
    taskKind: 'GENERAL_TASK',
    trajectoryBuildStatus: 'COMPLETED',
    taskOutcomeStatus: 'UNKNOWN',
    outcomeEvidenceLevel: 'MODEL_CLAIM',
    goalSummary: rawSummary,
    constraintSummaries: [],
    observations: [],
    actions: [],
    outcomeEvidenceRefs: [],
    sourceRefs: [],
    startedAt: now(1),
    completedAt: now(2),
    createdAt: now(3),
    updatedAt: now(3),
  };
}
