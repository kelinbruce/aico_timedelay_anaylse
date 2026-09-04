import {
  brand,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type LongTermMemoryId,
  type SafeError,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  GetLongTermMemoryDetailRequest,
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemorySummary,
  LongTermMemoryStoreGateway,
  LongTermMemoryVersionedUpdateResult,
} from '@nextagent/agent-contracts/gateway';
import { isMemoryCronDue } from './memory-cron.js';

export type MemoryAgingCycleStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
export type MemoryAgingTriggerReason = 'manual' | 'scheduled' | 'test' | 'detail_access';
export type MemoryAgingOperation = 'DECAY' | 'ARCHIVE' | 'DELETE' | 'REVIVE';

export interface MemoryAgingRuntimeConfig {
  readonly enabled: boolean;
  readonly schedule?: string;
  readonly decayStaleDays: number;
  readonly archiveRetentionDays: number;
  readonly decayFactor: number;
  readonly batchLimit: number;
  readonly timeoutMs: number;
  readonly reviveConfidenceBoost: number;
}

export interface MemoryAgingConfigSnapshot {
  readonly enabled: boolean;
  readonly status: 'VALID' | 'INVALID' | 'DISABLED';
  readonly aging: MemoryAgingRuntimeConfig;
}

export interface MemoryAgingScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion?: AgentVersion;
}

export interface MemoryAgingCycleDiagnostic {
  readonly status: MemoryAgingCycleStatus;
  readonly reasonCode: string;
  readonly cycleId: string;
  readonly triggerReason: MemoryAgingTriggerReason;
  readonly startedAt: EpochMillis;
  readonly completedAt: EpochMillis;
  readonly durationMs: number;
  readonly tenantId?: TenantId;
  readonly subjectId?: SubjectId;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly processedCount: number;
  readonly decayedCount: number;
  readonly archivedCount: number;
  readonly deletedCount: number;
  readonly revivedCount: number;
  readonly skippedCount: number;
  readonly failureCount: number;
  readonly reasonCodes: readonly string[];
}

export interface MemoryAgingAuditEvent {
  readonly eventType: 'MEMORY_AGING_LIFECYCLE';
  readonly operation: MemoryAgingOperation;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
  readonly reasonCode: string;
  readonly occurredAt: EpochMillis;
}

export interface MemoryAgingCycleOptions {
  readonly config: MemoryAgingConfigSnapshot;
  readonly scopes: readonly MemoryAgingScope[];
  readonly store: Pick<LongTermMemoryStoreGateway, 'listLongTermMemory' | 'getLongTermMemory' | 'mutateLongTermMemory' | 'deleteLongTermMemory'>;
  readonly now?: () => EpochMillis;
  readonly cycleId?: string;
  readonly diagnosticObserver?: (event: MemoryAgingCycleDiagnostic) => void;
  readonly auditObserver?: (event: MemoryAgingAuditEvent) => void;
}

export interface MemoryAgingSchedulerOptions extends MemoryAgingCycleOptions {
  readonly intervalMs?: number;
}

export interface MemoryAgingScheduler {
  start: () => void;
  stop: () => Promise<void>;
  triggerNow: (reason: Exclude<MemoryAgingTriggerReason, 'detail_access'>, signal?: AbortSignal) => Promise<MemoryAgingCycleDiagnostic>;
}

export interface LongTermMemoryDetailWithAgingOptions {
  readonly config: MemoryAgingConfigSnapshot;
  readonly retriever: Pick<LongTermMemoryRetrieverGateway, 'getLongTermMemoryDetail'>;
  readonly store: Pick<LongTermMemoryStoreGateway, 'mutateLongTermMemory'>;
  readonly request: GetLongTermMemoryDetailRequest;
  readonly now?: () => EpochMillis;
  readonly signal?: AbortSignal;
  readonly diagnosticObserver?: (event: MemoryAgingCycleDiagnostic) => void;
  readonly auditObserver?: (event: MemoryAgingAuditEvent) => void;
}

interface MutableAgingCounts {
  processedCount: number;
  decayedCount: number;
  archivedCount: number;
  deletedCount: number;
  revivedCount: number;
  skippedCount: number;
  failureCount: number;
  reasonCodes: string[];
}

interface CollectedCandidates {
  readonly status: 'OK';
  readonly items: readonly LongTermMemorySummary[];
  readonly hasMore: boolean;
}

interface CollectionFailure {
  readonly status: 'FAILED';
  readonly reasonCode: string;
}

const dayMs = 86_400_000;
const defaultIntervalMs = 60_000;
const maxCoreListLimit = 100;
const archiveReasonConfidenceDecayed = 'confidence_decayed';

export function createMemoryAgingScheduler(options: MemoryAgingSchedulerOptions): MemoryAgingScheduler {
  const intervalMs = boundedInteger(options.intervalMs, defaultIntervalMs, 3_600_000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<MemoryAgingCycleDiagnostic> | undefined;
  let lastScheduledAt: EpochMillis | undefined;
  let stopped = false;

  async function triggerNow(reason: Exclude<MemoryAgingTriggerReason, 'detail_access'>, signal?: AbortSignal): Promise<MemoryAgingCycleDiagnostic> {
    if (stopped) {
      return emitResult(options, skipped(options, 'MEMORY_AGING_STOPPED', reason, 0));
    }
    if (running !== undefined) {
      return emitResult(options, skipped(options, 'MEMORY_AGING_ALREADY_RUNNING', reason, 0));
    }
    const combinedSignal = combineSignals(controller.signal, signal);
    running = runMemoryAgingCycle(options, reason, combinedSignal);
    try {
      const result = await running;
      if (reason === 'scheduled' && result.status !== 'SKIPPED') {
        lastScheduledAt = currentEpoch(options);
      }
      return result;
    } finally {
      running = undefined;
    }
  }

  return {
    start() {
      if (timer !== undefined || stopped) {
        return;
      }
      if (options.config.status === 'INVALID') {
        options.diagnosticObserver?.(skipped(options, 'MEMORY_AGING_CONFIG_INVALID', 'scheduled', 0));
        return;
      }
      const schedule = options.config.aging.schedule;
      if (!options.config.enabled || !options.config.aging.enabled || schedule === undefined) {
        return;
      }
      timer = setInterval(() => {
        const now = currentEpoch(options);
        if (isMemoryAgingCronDue(schedule, now, lastScheduledAt)) {
          void triggerNow('scheduled', controller.signal);
        }
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
    },
    async stop() {
      stopped = true;
      controller.abort();
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await running;
    },
    triggerNow,
  };
}

export async function runMemoryAgingCycle(
  options: MemoryAgingCycleOptions,
  triggerReason: Exclude<MemoryAgingTriggerReason, 'detail_access'> = 'manual',
  signal?: AbortSignal,
): Promise<MemoryAgingCycleDiagnostic> {
  const wallStartedAt = Date.now();
  const startedAt = currentEpoch(options);
  const cycleId = options.cycleId ?? `memory-aging-${Number(startedAt)}`;
  if (options.config.status === 'INVALID') {
    return emitResult(options, skipped(options, 'MEMORY_AGING_CONFIG_INVALID', triggerReason, 0, cycleId, startedAt));
  }
  if (!options.config.enabled || options.config.status === 'DISABLED' || !options.config.aging.enabled) {
    return emitResult(options, skipped(options, 'MEMORY_AGING_DISABLED', triggerReason, 0, cycleId, startedAt));
  }
  if (options.scopes.length === 0) {
    return emitResult(options, skipped(options, 'MEMORY_AGING_SCOPE_MISSING', triggerReason, 0, cycleId, startedAt));
  }
  if (options.scopes.length > 1) {
    return emitResult(options, await runScopedMemoryAgingCycles({ ...options, cycleId }, triggerReason, wallStartedAt, startedAt, signal));
  }
  const scope = options.scopes[0];
  if (scope === undefined || !hasTrustedScope(scope)) {
    return emitResult(
      options,
      skipped(options, 'MEMORY_AGING_SCOPE_MISSING', triggerReason, Math.max(0, Date.now() - wallStartedAt), cycleId, startedAt),
    );
  }
  const result = await runSingleScopeMemoryAgingCycle(
    { ...options, cycleId, scopes: [scope] },
    scope,
    triggerReason,
    wallStartedAt,
    startedAt,
    signal,
  );
  return emitResult(options, result);
}

export async function getLongTermMemoryDetailWithAging(options: LongTermMemoryDetailWithAgingOptions): Promise<LongTermMemoryRecord | SafeError> {
  const detail = await options.retriever.getLongTermMemoryDetail(options.request);
  if (isSafeError(detail) || detail.state !== 'ARCHIVED') {
    return detail;
  }
  if (options.signal?.aborted === true || options.config.status !== 'VALID' || !options.config.enabled || !options.config.aging.enabled) {
    return detail;
  }
  const startedAt = currentEpoch(options);
  const wallStartedAt = Date.now();
  const cycleId = `memory-aging-revival-${Number(startedAt)}`;
  const transition = await options.store.mutateLongTermMemory(
    {
      tenantId: options.request.tenantId,
      subjectId: options.request.subjectId,
      agentId: options.request.agentId,
      memoryId: detail.memoryId,
      memoryInstance: detail.memoryInstance,
      targetState: 'ACTIVE',
    },
    { expectedVersion: detail.version },
  );
  if (isSafeError(transition) || transition.status !== 'UPDATED' || transition.record === undefined) {
    emitRevivalFailure(options, detail, transition, cycleId, startedAt, wallStartedAt);
    return detail;
  }
  const boosted = await options.store.mutateLongTermMemory(
    {
      tenantId: options.request.tenantId,
      subjectId: options.request.subjectId,
      agentId: options.request.agentId,
      memoryId: detail.memoryId,
      memoryInstance: detail.memoryInstance,
      delta: options.config.aging.reviveConfidenceBoost,
    },
    { expectedVersion: transition.record.version },
  );
  const revived = !isSafeError(boosted) && boosted.status === 'UPDATED' && boosted.record !== undefined ? boosted.record : transition.record;
  options.auditObserver?.({
    eventType: 'MEMORY_AGING_LIFECYCLE',
    operation: 'REVIVE',
    tenantId: options.request.tenantId,
    subjectId: options.request.subjectId,
    agentId: options.request.agentId,
    longTermMemoryId: detail.memoryId,
    reasonCode: 'detail_access_revived',
    occurredAt: currentEpoch(options),
  });
  options.diagnosticObserver?.(
    diagnostic({
      options: detailDiagnosticOptions(options),
      status: isSafeError(boosted) || boosted.status !== 'UPDATED' ? 'PARTIAL' : 'COMPLETED',
      reasonCode: isSafeError(boosted) || boosted.status !== 'UPDATED' ? reasonFromUpdateResult(boosted) : 'MEMORY_AGING_REVIVED',
      triggerReason: 'detail_access',
      startedAt,
      wallStartedAt,
      cycleId,
      scope: {
        tenantId: options.request.tenantId,
        subjectId: options.request.subjectId,
        agentId: options.request.agentId,
      },
      counts: {
        processedCount: 1,
        decayedCount: 0,
        archivedCount: 0,
        deletedCount: 0,
        revivedCount: 1,
        skippedCount: 0,
        failureCount: isSafeError(boosted) || boosted.status !== 'UPDATED' ? 1 : 0,
        reasonCodes: [isSafeError(boosted) || boosted.status !== 'UPDATED' ? reasonFromUpdateResult(boosted) : 'MEMORY_AGING_REVIVED'],
      },
    }),
  );
  return revived;
}

export function isMemoryAgingCronDue(schedule: string, now: EpochMillis, lastRunAt?: EpochMillis): boolean {
  return isMemoryCronDue(schedule, now, lastRunAt);
}

async function runScopedMemoryAgingCycles(
  options: MemoryAgingCycleOptions & { readonly cycleId: string },
  triggerReason: Exclude<MemoryAgingTriggerReason, 'detail_access'>,
  wallStartedAt: number,
  startedAt: EpochMillis,
  signal?: AbortSignal,
): Promise<MemoryAgingCycleDiagnostic> {
  const results: MemoryAgingCycleDiagnostic[] = [];
  for (const scope of options.scopes) {
    if (!hasTrustedScope(scope)) {
      results.push(
        skipped(
          { ...options, scopes: [scope] },
          'MEMORY_AGING_SCOPE_MISSING',
          triggerReason,
          Math.max(0, Date.now() - wallStartedAt),
          options.cycleId,
          startedAt,
        ),
      );
      continue;
    }
    if (signal?.aborted === true) {
      results.push(
        skipped(
          { ...options, scopes: [scope] },
          'MEMORY_AGING_CANCELED',
          triggerReason,
          Math.max(0, Date.now() - wallStartedAt),
          options.cycleId,
          startedAt,
        ),
      );
      break;
    }
    results.push(await runSingleScopeMemoryAgingCycle({ ...options, scopes: [scope] }, scope, triggerReason, wallStartedAt, startedAt, signal));
  }
  const counts = mergeCounts(results);
  const reasonCodes = uniqueStrings(results.flatMap((item) => item.reasonCodes));
  const status = results.every((item) => item.status === 'COMPLETED')
    ? 'COMPLETED'
    : results.every((item) => item.status === 'SKIPPED')
      ? 'SKIPPED'
      : results.some((item) => item.status === 'FAILED')
        ? 'PARTIAL'
        : 'PARTIAL';
  return diagnostic({
    options,
    status,
    reasonCode: reasonCodes[0] ?? 'MEMORY_AGING_COMPLETED',
    triggerReason,
    startedAt,
    wallStartedAt,
    cycleId: options.cycleId,
    counts: { ...counts, reasonCodes: [...reasonCodes] },
  });
}

async function runSingleScopeMemoryAgingCycle(
  options: MemoryAgingCycleOptions & { readonly cycleId: string; readonly scopes: readonly [MemoryAgingScope] },
  scope: MemoryAgingScope,
  triggerReason: Exclude<MemoryAgingTriggerReason, 'detail_access'>,
  wallStartedAt: number,
  startedAt: EpochMillis,
  signal?: AbortSignal,
): Promise<MemoryAgingCycleDiagnostic> {
  const counts = zeroCounts();
  const deadline = wallStartedAt + options.config.aging.timeoutMs;
  const decayCutoff = brand<number, 'EpochMillis'>(Math.max(0, Number(currentEpoch(options)) - options.config.aging.decayStaleDays * dayMs));
  const deleteCutoff = brand<number, 'EpochMillis'>(Math.max(0, Number(currentEpoch(options)) - options.config.aging.archiveRetentionDays * dayMs));

  const stopReason = stopReasonIfNeeded(signal, deadline);
  if (stopReason !== undefined) {
    counts.reasonCodes.push(stopReason);
    return diagnosticFromCounts(options, 'SKIPPED', stopReason, triggerReason, startedAt, wallStartedAt, counts);
  }

  const decayCandidates = await collectCandidates(
    options,
    {
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      state: 'ACTIVE',
      isPinned: false,
      minConfidence: 0,
      maxLastAccessedAt: decayCutoff,
    },
    options.config.aging.batchLimit,
    deadline,
    signal,
  );
  if (decayCandidates.status === 'FAILED') {
    counts.failureCount += 1;
    counts.reasonCodes.push(decayCandidates.reasonCode);
    const status =
      decayCandidates.reasonCode === 'MEMORY_AGING_CANCELED' || decayCandidates.reasonCode === 'MEMORY_AGING_TIMEOUT' ? 'PARTIAL' : 'FAILED';
    return diagnosticFromCounts(options, status, decayCandidates.reasonCode, triggerReason, startedAt, wallStartedAt, counts);
  }
  if (decayCandidates.hasMore) {
    counts.reasonCodes.push('MEMORY_AGING_BATCH_LIMIT_REACHED');
  }
  await processDecayCandidates(options, scope, decayCandidates.items, counts, decayCutoff, deadline, signal);

  const remaining = Math.max(0, options.config.aging.batchLimit - counts.processedCount);
  if (remaining === 0) {
    counts.reasonCodes.push('MEMORY_AGING_BATCH_LIMIT_REACHED');
  } else if (stopReasonIfNeeded(signal, deadline) === undefined) {
    const deleteCandidates = await collectCandidates(
      options,
      {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        state: 'ARCHIVED',
        isPinned: false,
        minConfidence: 0,
      },
      remaining,
      deadline,
      signal,
    );
    if (deleteCandidates.status === 'FAILED') {
      counts.failureCount += 1;
      counts.reasonCodes.push(deleteCandidates.reasonCode);
    } else {
      if (deleteCandidates.hasMore) {
        counts.reasonCodes.push('MEMORY_AGING_BATCH_LIMIT_REACHED');
      }
      await processDeleteCandidates(options, scope, deleteCandidates.items, counts, deleteCutoff, deadline, signal);
    }
  }

  const finalStopReason = stopReasonIfNeeded(signal, deadline);
  if (finalStopReason !== undefined) {
    counts.reasonCodes.push(finalStopReason);
  }
  const reasonCodes = uniqueStrings(counts.reasonCodes);
  const status = statusFromCounts(counts, reasonCodes);
  return diagnosticFromCounts(options, status, reasonCodes[0] ?? 'MEMORY_AGING_COMPLETED', triggerReason, startedAt, wallStartedAt, {
    ...counts,
    reasonCodes: [...reasonCodes],
  });
}

async function collectCandidates(
  options: MemoryAgingCycleOptions,
  baseQuery: Parameters<LongTermMemoryStoreGateway['listLongTermMemory']>[0],
  batchLimit: number,
  deadline: number,
  signal?: AbortSignal,
): Promise<CollectedCandidates | CollectionFailure> {
  const items: LongTermMemorySummary[] = [];
  let offset = 0;
  let hasMore = false;
  while (items.length < batchLimit) {
    const beforePageStopReason = stopReasonIfNeeded(signal, deadline);
    if (beforePageStopReason !== undefined) {
      return { status: 'FAILED', reasonCode: beforePageStopReason };
    }
    const limit = Math.min(maxCoreListLimit, batchLimit - items.length);
    if (limit <= 0) {
      break;
    }
    const page = await options.store.listLongTermMemory({ ...baseQuery, limit, offset });
    const afterPageStopReason = stopReasonIfNeeded(signal, deadline);
    if (afterPageStopReason !== undefined) {
      return { status: 'FAILED', reasonCode: afterPageStopReason };
    }
    if (isSafeError(page)) {
      return { status: 'FAILED', reasonCode: mapStoreError(page) };
    }
    items.push(...page.items);
    hasMore = offset + page.items.length < page.total;
    if (!hasMore || page.items.length === 0) {
      break;
    }
    offset += page.items.length;
  }
  return { status: 'OK', items, hasMore };
}

async function processDecayCandidates(
  options: MemoryAgingCycleOptions,
  scope: MemoryAgingScope,
  items: readonly LongTermMemorySummary[],
  counts: MutableAgingCounts,
  decayCutoff: EpochMillis,
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  for (const item of items) {
    const stopReason = stopReasonIfNeeded(signal, deadline);
    if (stopReason !== undefined) {
      counts.reasonCodes.push(stopReason);
      return;
    }
    const record = await options.store.getLongTermMemory({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryId: item.memoryId,
    });
    if (isSafeError(record)) {
      counts.failureCount += 1;
      counts.reasonCodes.push(mapStoreError(record));
      continue;
    }
    if (!recordMatchesScope(record, scope) || record.state !== 'ACTIVE' || record.isPinned === true) {
      counts.skippedCount += 1;
      counts.reasonCodes.push(record.isPinned === true ? 'MEMORY_AGING_PINNED_EXEMPT' : 'MEMORY_AGING_SCOPE_MISMATCH');
      continue;
    }
    if (Number(record.lastAccessedAt ?? record.createTime) > Number(decayCutoff)) {
      counts.skippedCount += 1;
      continue;
    }
    counts.processedCount += 1;
    const newConfidence = Math.max(0, record.confidence - options.config.aging.decayFactor);
    if (newConfidence <= 0) {
      const archived = await options.store.mutateLongTermMemory(
        {
          tenantId: scope.tenantId,
          subjectId: scope.subjectId,
          agentId: scope.agentId,
          memoryId: record.memoryId,
          memoryInstance: record.memoryInstance,
          targetState: 'ARCHIVED',
          archiveReason: archiveReasonConfidenceDecayed,
        },
        { expectedVersion: record.version },
      );
      if (recordUpdated(archived)) {
        counts.archivedCount += 1;
        emitAudit(options, scope, record.memoryId, 'ARCHIVE', archiveReasonConfidenceDecayed);
      } else {
        counts.failureCount += 1;
        counts.reasonCodes.push(reasonFromUpdateResult(archived));
      }
      continue;
    }
    const decayed = await options.store.mutateLongTermMemory(
      {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        memoryId: record.memoryId,
        memoryInstance: record.memoryInstance,
        delta: -options.config.aging.decayFactor,
      },
      { expectedVersion: record.version },
    );
    if (recordUpdated(decayed)) {
      counts.decayedCount += 1;
      emitAudit(options, scope, record.memoryId, 'DECAY', 'confidence_decay');
    } else {
      counts.failureCount += 1;
      counts.reasonCodes.push(reasonFromUpdateResult(decayed));
    }
  }
}

async function processDeleteCandidates(
  options: MemoryAgingCycleOptions,
  scope: MemoryAgingScope,
  items: readonly LongTermMemorySummary[],
  counts: MutableAgingCounts,
  deleteCutoff: EpochMillis,
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  for (const item of items) {
    const stopReason = stopReasonIfNeeded(signal, deadline);
    if (stopReason !== undefined) {
      counts.reasonCodes.push(stopReason);
      return;
    }
    const record = await options.store.getLongTermMemory({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryId: item.memoryId,
    });
    if (isSafeError(record)) {
      counts.failureCount += 1;
      counts.reasonCodes.push(mapStoreError(record));
      continue;
    }
    if (!recordMatchesScope(record, scope) || record.state !== 'ARCHIVED' || record.isPinned === true) {
      counts.skippedCount += 1;
      counts.reasonCodes.push(record.isPinned === true ? 'MEMORY_AGING_PINNED_EXEMPT' : 'MEMORY_AGING_SCOPE_MISMATCH');
      continue;
    }
    if (Number(record.archivedAt) === 0 || Number(record.archivedAt) > Number(deleteCutoff)) {
      counts.skippedCount += 1;
      continue;
    }
    counts.processedCount += 1;
    const deleted = await options.store.deleteLongTermMemory({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryId: record.memoryId,
      memoryInstance: record.memoryInstance,
      reasonCode: 'retention_expired',
    });
    if (!isSafeError(deleted)) {
      counts.deletedCount += 1;
      emitAudit(options, scope, record.memoryId, 'DELETE', 'retention_expired');
    } else {
      counts.failureCount += 1;
      counts.reasonCodes.push(mapStoreError(deleted));
    }
  }
}

function emitRevivalFailure(
  options: LongTermMemoryDetailWithAgingOptions,
  record: LongTermMemoryRecord,
  result: LongTermMemoryVersionedUpdateResult | SafeError,
  cycleId: string,
  startedAt: EpochMillis,
  wallStartedAt: number,
): void {
  const reasonCode = reasonFromUpdateResult(result);
  options.diagnosticObserver?.(
    diagnostic({
      options: detailDiagnosticOptions(options),
      status: 'PARTIAL',
      reasonCode,
      triggerReason: 'detail_access',
      startedAt,
      wallStartedAt,
      cycleId,
      scope: {
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
      },
      counts: {
        processedCount: 1,
        decayedCount: 0,
        archivedCount: 0,
        deletedCount: 0,
        revivedCount: 0,
        skippedCount: 0,
        failureCount: 1,
        reasonCodes: [reasonCode],
      },
    }),
  );
}

function detailDiagnosticOptions(options: LongTermMemoryDetailWithAgingOptions): Pick<MemoryAgingCycleOptions, 'now'> {
  return options.now === undefined ? {} : { now: options.now };
}

function statusFromCounts(counts: MutableAgingCounts, reasonCodes: readonly string[]): MemoryAgingCycleStatus {
  if (counts.failureCount > 0 && counts.processedCount === 0) {
    return 'FAILED';
  }
  if (
    counts.failureCount > 0 ||
    reasonCodes.includes('MEMORY_AGING_BATCH_LIMIT_REACHED') ||
    reasonCodes.includes('MEMORY_AGING_TIMEOUT') ||
    reasonCodes.includes('MEMORY_AGING_CANCELED')
  ) {
    return 'PARTIAL';
  }
  return 'COMPLETED';
}

function diagnosticFromCounts(
  options: MemoryAgingCycleOptions & { readonly cycleId: string; readonly scopes: readonly [MemoryAgingScope] },
  status: MemoryAgingCycleStatus,
  reasonCode: string,
  triggerReason: MemoryAgingTriggerReason,
  startedAt: EpochMillis,
  wallStartedAt: number,
  counts: MutableAgingCounts,
): MemoryAgingCycleDiagnostic {
  return diagnostic({
    options,
    status,
    reasonCode,
    triggerReason,
    startedAt,
    wallStartedAt,
    cycleId: options.cycleId,
    scope: options.scopes[0],
    counts: {
      ...counts,
      reasonCodes: [...uniqueStrings(counts.reasonCodes.length === 0 ? [reasonCode] : counts.reasonCodes)],
    },
  });
}

function diagnostic(input: {
  readonly options: Pick<MemoryAgingCycleOptions, 'now'>;
  readonly status: MemoryAgingCycleStatus;
  readonly reasonCode: string;
  readonly triggerReason: MemoryAgingTriggerReason;
  readonly startedAt: EpochMillis;
  readonly wallStartedAt: number;
  readonly cycleId: string;
  readonly scope?: MemoryAgingScope;
  readonly counts: MutableAgingCounts;
}): MemoryAgingCycleDiagnostic {
  return {
    status: input.status,
    reasonCode: input.reasonCode,
    cycleId: input.cycleId,
    triggerReason: input.triggerReason,
    startedAt: input.startedAt,
    completedAt: currentEpoch(input.options),
    durationMs: Math.max(0, Date.now() - input.wallStartedAt),
    ...(input.scope === undefined
      ? {}
      : {
          tenantId: input.scope.tenantId,
          subjectId: input.scope.subjectId,
          agentId: input.scope.agentId,
          ...(input.scope.agentVersion === undefined ? {} : { agentVersion: input.scope.agentVersion }),
        }),
    processedCount: input.counts.processedCount,
    decayedCount: input.counts.decayedCount,
    archivedCount: input.counts.archivedCount,
    deletedCount: input.counts.deletedCount,
    revivedCount: input.counts.revivedCount,
    skippedCount: input.counts.skippedCount,
    failureCount: input.counts.failureCount,
    reasonCodes: uniqueStrings(input.counts.reasonCodes.length === 0 ? [input.reasonCode] : input.counts.reasonCodes).slice(0, 20),
  };
}

function skipped(
  options: Pick<MemoryAgingCycleOptions, 'now' | 'scopes' | 'cycleId'>,
  reasonCode: string,
  triggerReason: MemoryAgingTriggerReason,
  durationMs: number,
  cycleId = options.cycleId ?? `memory-aging-${Number(currentEpoch(options))}`,
  startedAt = currentEpoch(options),
): MemoryAgingCycleDiagnostic {
  const scope = options.scopes[0];
  return {
    status: 'SKIPPED',
    reasonCode,
    cycleId,
    triggerReason,
    startedAt,
    completedAt: currentEpoch(options),
    durationMs,
    ...(scope === undefined
      ? {}
      : {
          tenantId: scope.tenantId,
          subjectId: scope.subjectId,
          agentId: scope.agentId,
          ...(scope.agentVersion === undefined ? {} : { agentVersion: scope.agentVersion }),
        }),
    processedCount: 0,
    decayedCount: 0,
    archivedCount: 0,
    deletedCount: 0,
    revivedCount: 0,
    skippedCount: 0,
    failureCount: 0,
    reasonCodes: [reasonCode],
  };
}

function emitResult(options: MemoryAgingCycleOptions, event: MemoryAgingCycleDiagnostic): MemoryAgingCycleDiagnostic {
  options.diagnosticObserver?.(event);
  return event;
}

function emitAudit(
  options: MemoryAgingCycleOptions,
  scope: MemoryAgingScope,
  longTermMemoryId: LongTermMemoryId,
  operation: MemoryAgingOperation,
  reasonCode: string,
): void {
  options.auditObserver?.({
    eventType: 'MEMORY_AGING_LIFECYCLE',
    operation,
    tenantId: scope.tenantId,
    subjectId: scope.subjectId,
    agentId: scope.agentId,
    longTermMemoryId,
    reasonCode,
    occurredAt: currentEpoch(options),
  });
}

function zeroCounts(): MutableAgingCounts {
  return {
    processedCount: 0,
    decayedCount: 0,
    archivedCount: 0,
    deletedCount: 0,
    revivedCount: 0,
    skippedCount: 0,
    failureCount: 0,
    reasonCodes: [],
  };
}

function mergeCounts(results: readonly MemoryAgingCycleDiagnostic[]): MutableAgingCounts {
  return {
    processedCount: sum(results, 'processedCount'),
    decayedCount: sum(results, 'decayedCount'),
    archivedCount: sum(results, 'archivedCount'),
    deletedCount: sum(results, 'deletedCount'),
    revivedCount: sum(results, 'revivedCount'),
    skippedCount: sum(results, 'skippedCount'),
    failureCount: sum(results, 'failureCount'),
    reasonCodes: uniqueStrings(results.flatMap((item) => item.reasonCodes)) as string[],
  };
}

function sum(
  items: readonly MemoryAgingCycleDiagnostic[],
  key: keyof Pick<
    MemoryAgingCycleDiagnostic,
    'processedCount' | 'decayedCount' | 'archivedCount' | 'deletedCount' | 'revivedCount' | 'skippedCount' | 'failureCount'
  >,
): number {
  return items.reduce((total, item) => total + item[key], 0);
}

function recordMatchesScope(record: LongTermMemoryRecord, scope: MemoryAgingScope): boolean {
  return record.tenantId === scope.tenantId && record.subjectId === scope.subjectId && record.agentId === scope.agentId;
}

function hasTrustedScope(scope: MemoryAgingScope): boolean {
  return nonEmptyString(scope.tenantId) && nonEmptyString(scope.subjectId) && nonEmptyString(scope.agentId);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function stopReasonIfNeeded(signal: AbortSignal | undefined, deadline: number): string | undefined {
  if (signal?.aborted === true) {
    return 'MEMORY_AGING_CANCELED';
  }
  if (Date.now() > deadline) {
    return 'MEMORY_AGING_TIMEOUT';
  }
  return undefined;
}

function recordUpdated(
  result: LongTermMemoryVersionedUpdateResult | SafeError,
): result is { readonly status: 'UPDATED'; readonly record: LongTermMemoryRecord } {
  return !isSafeError(result) && result.status === 'UPDATED' && result.record !== undefined;
}

function reasonFromUpdateResult(result: LongTermMemoryVersionedUpdateResult | SafeError): string {
  if (isSafeError(result)) {
    return mapStoreError(result);
  }
  if (result.status === 'VERSION_CONFLICT' || result.status === 'NOT_FOUND') {
    return 'MEMORY_AGING_UPDATE_CONFLICT';
  }
  return 'MEMORY_AGING_UPDATE_CONFLICT';
}

function mapStoreError(error: SafeError): string {
  if (error.code === 'LTM_DISABLED') {
    return 'LTM_DISABLED';
  }
  if (error.code === 'LTM_STORAGE_UNAVAILABLE') {
    return 'LTM_STORAGE_UNAVAILABLE';
  }
  return error.code;
}

function isSafeError(value: unknown): value is SafeError {
  return value !== null && typeof value === 'object' && 'code' in value && 'category' in value && 'retryable' in value;
}

function currentEpoch(options: Pick<MemoryAgingCycleOptions, 'now'>): EpochMillis {
  return options.now?.() ?? brand<number, 'EpochMillis'>(Date.now());
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function combineSignals(first: AbortSignal, second?: AbortSignal): AbortSignal {
  if (second === undefined) {
    return first;
  }
  if (first.aborted || second.aborted) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener('abort', abort, { once: true });
  second.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
