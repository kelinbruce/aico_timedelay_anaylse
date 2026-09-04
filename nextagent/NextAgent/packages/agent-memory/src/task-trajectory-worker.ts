import { type EpochMillis, type SafeError } from '@nextagent/agent-common';
import type { TaskTrajectoryBuildCandidate, TaskTrajectoryQueryGateway, TaskTrajectoryStoreGateway } from '@nextagent/agent-contracts/gateway';
import {
  taskTrajectoryWriteOptions,
  type TaskTrajectoryBuilder,
  type TaskTrajectoryBuildRef,
  type TaskTrajectoryBuildResult,
} from './task-trajectory-builder.js';

export type TaskTrajectoryWorkerStatus = 'BUILT' | 'SKIPPED' | 'FAILED' | 'ENQUEUED' | 'DROPPED';

export interface TaskTrajectoryWorkerDiagnostic {
  readonly status: TaskTrajectoryWorkerStatus;
  readonly reasonCode: string;
  readonly tenantId: TaskTrajectoryBuildRef['tenantId'];
  readonly subjectId: TaskTrajectoryBuildRef['subjectId'];
  readonly agentId: TaskTrajectoryBuildRef['agentId'];
  readonly agentVersion?: TaskTrajectoryBuildRef['agentVersion'];
  readonly sessionId: TaskTrajectoryBuildRef['sessionId'];
  readonly requestRunId: TaskTrajectoryBuildRef['requestRunId'];
  readonly durationMs: number;
}

export interface TaskTrajectoryWorker {
  enqueue: (ref: TaskTrajectoryBuildRef) => void;
  drainOnce: (signal?: AbortSignal) => Promise<void>;
  start: () => void;
  stop: () => Promise<void>;
}

export interface TaskTrajectoryWorkerOptions {
  readonly builder: TaskTrajectoryBuilder;
  readonly store: TaskTrajectoryStoreGateway;
  readonly query: TaskTrajectoryQueryGateway;
  readonly catchUpScope?: Pick<TaskTrajectoryBuildRef, 'tenantId' | 'subjectId' | 'agentId'>;
  readonly catchUpScopes?: ReadonlyArray<Pick<TaskTrajectoryBuildRef, 'tenantId' | 'subjectId' | 'agentId'>>;
  readonly now?: () => EpochMillis;
  readonly diagnosticObserver?: (event: TaskTrajectoryWorkerDiagnostic) => void;
  readonly batchSize?: number;
  readonly concurrency?: number;
  readonly maxPending?: number;
  readonly retryAttempts?: number;
  readonly retryBackoffMs?: number;
  readonly catchUpIntervalMs?: number;
}

interface PendingBuild {
  readonly ref: TaskTrajectoryBuildRef;
  readonly attempts: number;
}

const defaultBatchSize = 10;
const defaultConcurrency = 2;
const defaultMaxPending = 1000;
const defaultRetryAttempts = 2;
const defaultRetryBackoffMs = 100;
const defaultCatchUpIntervalMs = 60_000;

export function createTaskTrajectoryWorker(options: TaskTrajectoryWorkerOptions): TaskTrajectoryWorker {
  const pending = new Map<string, PendingBuild>();
  const batchSize = boundedPositive(options.batchSize, defaultBatchSize, 100);
  const concurrency = boundedPositive(options.concurrency, defaultConcurrency, 16);
  const maxPending = boundedPositive(options.maxPending, defaultMaxPending, 10_000);
  const retryAttempts = boundedPositive(options.retryAttempts, defaultRetryAttempts, 10);
  const retryBackoffMs = boundedPositive(options.retryBackoffMs, defaultRetryBackoffMs, 60_000);
  const catchUpIntervalMs = boundedPositive(options.catchUpIntervalMs, defaultCatchUpIntervalMs, 3_600_000);
  const catchUpScopes = normalizeCatchUpScopes(options);
  const controller = new AbortController();
  let running = false;
  let closed = false;
  let catchUpScopeIndex = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function enqueue(ref: TaskTrajectoryBuildRef): void {
    if (closed) {
      return;
    }
    const key = pendingKey(ref);
    if (!pending.has(key) && pending.size >= maxPending) {
      emit(options, ref, 'DROPPED', 'TASK_TRAJECTORY_PENDING_LIMIT', 0);
      return;
    }
    pending.set(key, { ref, attempts: pending.get(key)?.attempts ?? 0 });
    emit(options, ref, 'ENQUEUED', 'TASK_TRAJECTORY_BUILD_ENQUEUED', 0);
    queueMicrotask(() => {
      void drainOnce(controller.signal);
    });
  }

  async function drainOnce(signal?: AbortSignal): Promise<void> {
    if (running || closed || signal?.aborted === true) {
      return;
    }
    running = true;
    try {
      if (pending.size === 0) {
        await enqueueCatchUpCandidates(signal);
      }
      const batch = Array.from(pending.values()).slice(0, batchSize);
      for (const item of batch) {
        pending.delete(pendingKey(item.ref));
      }
      await runWithConcurrency(batch, concurrency, async (item) => processItem(item, signal));
    } finally {
      running = false;
    }
  }

  async function enqueueCatchUpCandidates(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true || pending.size >= batchSize) {
      return;
    }
    if (catchUpScopes.length === 0) {
      return;
    }
    for (let scanned = 0; scanned < catchUpScopes.length && pending.size < batchSize; scanned += 1) {
      const scope = catchUpScopes[catchUpScopeIndex % catchUpScopes.length];
      catchUpScopeIndex += 1;
      if (scope === undefined) {
        continue;
      }
      const result = await options.query.listBuildCandidates({
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        limit: Math.max(1, batchSize - pending.size),
      });
      if (isSafeError(result)) {
        continue;
      }
      for (const candidate of result.items) {
        enqueue(candidateToRef(candidate));
        if (pending.size >= batchSize) {
          break;
        }
      }
    }
  }

  async function processItem(item: PendingBuild, signal?: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    const result = await options.builder.build(item.ref, signal);
    if (result.status === 'BUILT') {
      const saved = await options.store.saveTaskTrajectory(result.record, taskTrajectoryWriteOptions(item.ref.requestRunId));
      if (isSafeError(saved)) {
        await retryOrReport(item, saved, startedAt, signal);
        return;
      }
      emit(options, item.ref, 'BUILT', 'TASK_TRAJECTORY_BUILT', elapsed(startedAt));
      return;
    }
    if (result.status === 'SKIPPED') {
      emit(options, item.ref, 'SKIPPED', result.reasonCode, elapsed(startedAt));
      return;
    }
    await retryOrReport(item, result.safeError, startedAt, signal);
  }

  async function retryOrReport(item: PendingBuild, safeError: SafeError, startedAt: number, signal?: AbortSignal): Promise<void> {
    if (safeError.retryable && item.attempts + 1 < retryAttempts && !isAborted(signal) && !closed) {
      await sleep(retryBackoffMs, signal);
      if (isAborted(signal) || closed) {
        return;
      }
      pending.set(pendingKey(item.ref), { ref: item.ref, attempts: item.attempts + 1 });
      return;
    }
    emit(options, item.ref, 'FAILED', safeError.code, elapsed(startedAt));
  }

  return {
    enqueue,
    drainOnce,
    start() {
      if (timer !== undefined || closed) {
        return;
      }
      timer = setInterval(() => {
        void drainOnce(controller.signal);
      }, catchUpIntervalMs);
      (timer as { unref?: () => void }).unref?.();
    },
    async stop() {
      closed = true;
      controller.abort();
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      while (running) {
        await sleep(5);
      }
    },
  };
}

function pendingKey(ref: TaskTrajectoryBuildRef): string {
  return `${ref.tenantId}:${ref.subjectId}:${ref.agentId}:${ref.sessionId}:${ref.requestRunId}`;
}

function candidateToRef(candidate: TaskTrajectoryBuildCandidate): TaskTrajectoryBuildRef {
  return {
    tenantId: candidate.tenantId,
    subjectId: candidate.subjectId,
    agentId: candidate.agentId,
    sessionId: candidate.sessionId,
    requestId: candidate.requestId,
    requestRunId: candidate.requestRunId,
    terminalTimelineEventId: candidate.terminalTimelineEventId,
    terminalTimelineSequence: candidate.terminalTimelineSequence,
    terminalCommittedAt: candidate.terminalCommittedAt,
  };
}

async function runWithConcurrency<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item !== undefined) {
        await work(item);
      }
    }
  });
  await Promise.all(workers);
}

function emit(
  options: TaskTrajectoryWorkerOptions,
  ref: TaskTrajectoryBuildRef,
  status: TaskTrajectoryWorkerStatus,
  reasonCode: string,
  durationMs: number,
): void {
  options.diagnosticObserver?.({
    status,
    reasonCode,
    tenantId: ref.tenantId,
    subjectId: ref.subjectId,
    agentId: ref.agentId,
    ...(ref.agentVersion === undefined ? {} : { agentVersion: ref.agentVersion }),
    sessionId: ref.sessionId,
    requestRunId: ref.requestRunId,
    durationMs,
  });
}

function normalizeCatchUpScopes(
  options: TaskTrajectoryWorkerOptions,
): ReadonlyArray<Pick<TaskTrajectoryBuildRef, 'tenantId' | 'subjectId' | 'agentId'>> {
  const scopes = options.catchUpScopes ?? (options.catchUpScope === undefined ? [] : [options.catchUpScope]);
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = `${scope.tenantId}:${scope.subjectId}:${scope.agentId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function boundedPositive(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function isSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
