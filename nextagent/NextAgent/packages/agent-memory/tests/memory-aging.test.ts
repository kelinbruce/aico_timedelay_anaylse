import { brand, type EpochMillis, type SafeError } from '@nextagent/agent-common';
import type {
  LongTermMemoryRecord,
  LongTermMemoryStoreGateway,
  LongTermMemorySummaryPage,
  LongTermMemoryVersionedUpdateResult,
} from '@nextagent/agent-contracts/gateway';
import type { MemoryContentByCategory } from '../src/memory-data.js';
import {
  createMemoryAgingScheduler,
  getLongTermMemoryDetailWithAging,
  isMemoryAgingCronDue,
  runMemoryAgingCycle,
  type MemoryAgingAuditEvent,
  type MemoryAgingConfigSnapshot,
  type MemoryAgingCycleDiagnostic,
  type MemoryAgingScope,
} from '../src/memory-aging.js';
import { describe, expect, it, vi } from 'vitest';

const dayMs = 86_400_000;
const currentTime = 200 * dayMs;
const scope: MemoryAgingScope = {
  tenantId: brand<string, 'TenantId'>('tenant-aging'),
  subjectId: brand<string, 'SubjectId'>('subject-aging'),
  agentId: brand<string, 'AgentId'>('agent-aging'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('memory aging', () => {
  it('matches the scheduled minute independently of process startup second', () => {
    const scheduledAt = now(new Date(2026, 0, 1, 3, 0, 37).getTime());

    expect(isMemoryAgingCronDue('0 0 3 * * ?', scheduledAt)).toBe(true);
    expect(isMemoryAgingCronDue('0 0 3 * * ?', scheduledAt, now(Number(scheduledAt) - 20_000))).toBe(false);
  });

  it('runs the scheduled cycle after crossing into the target minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 37));
    const store = fakeAgingStore([]);
    const scheduler = createMemoryAgingScheduler({
      config: config(),
      scopes: [scope],
      store,
      now: () => now(Date.now()),
    });

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(store.listLongTermMemory).toHaveBeenCalled();
    } finally {
      await scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('returns an explicit skipped diagnostic when aging is disabled', async () => {
    const store = fakeAgingStore([memoryRecord({ id: 'stale', lastAccessedAt: currentTime - 40 * dayMs })]);

    const result = await runMemoryAgingCycle(
      {
        config: config({ agingEnabled: false }),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reasonCode: 'MEMORY_AGING_DISABLED',
      processedCount: 0,
    });
    expect(store.listLongTermMemory).not.toHaveBeenCalled();
  });

  it('processes stale ACTIVE decay, auto archive, and expired ARCHIVED delete in deterministic order', async () => {
    const decayed = memoryRecord({ id: 'decay', confidence: 0.6, lastAccessedAt: currentTime - 40 * dayMs });
    const archived = memoryRecord({ id: 'archive', confidence: 0.03, lastAccessedAt: currentTime - 40 * dayMs });
    const deleted = memoryRecord({ id: 'delete', state: 'ARCHIVED', archivedAt: currentTime - 100 * dayMs });
    const fresh = memoryRecord({ id: 'fresh', confidence: 0.9, lastAccessedAt: currentTime - 2 * dayMs });
    const crossScope = memoryRecord({ id: 'cross', tenantId: 'other-tenant', confidence: 0.03, lastAccessedAt: currentTime - 40 * dayMs });
    const auditEvents: MemoryAgingAuditEvent[] = [];
    const store = fakeAgingStore([decayed, archived, deleted, fresh, crossScope]);

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
        auditObserver: (event) => auditEvents.push(event),
      },
      'manual',
    );

    expect(result).toMatchObject({
      status: 'COMPLETED',
      processedCount: 3,
      decayedCount: 1,
      archivedCount: 1,
      deletedCount: 1,
      failureCount: 0,
    });
    expect(store.records.get('decay')).toMatchObject({ state: 'ACTIVE' });
    expect(store.records.get('decay')?.confidence).toBeCloseTo(0.55);
    expect(store.records.get('archive')).toMatchObject({ state: 'ARCHIVED', archiveReason: 'confidence_decayed' });
    expect(store.records.has('delete')).toBe(false);
    expect(store.records.get('fresh')).toMatchObject({ state: 'ACTIVE', confidence: 0.9 });
    expect(store.records.get('cross')).toMatchObject({ state: 'ACTIVE', confidence: 0.03 });
    expect(store.calls.indexOf('list:ACTIVE')).toBeLessThan(store.calls.indexOf('list:ARCHIVED'));
    expect(auditEvents.map((event) => event.operation).sort()).toEqual(['ARCHIVE', 'DECAY', 'DELETE']);
    expect(JSON.stringify(auditEvents)).not.toContain('secret');
  });

  it('leaves pinned stale records untouched through the public list filter', async () => {
    const pinned = memoryRecord({ id: 'pinned', confidence: 0.03, lastAccessedAt: currentTime - 40 * dayMs, isPinned: true });
    const store = fakeAgingStore([pinned]);

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result).toMatchObject({ status: 'COMPLETED', processedCount: 0, archivedCount: 0, deletedCount: 0 });
    expect(store.listLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'ACTIVE',
        isPinned: false,
        minConfidence: 0,
      }),
    );
    expect(store.records.get('pinned')).toMatchObject({ state: 'ACTIVE', confidence: 0.03, isPinned: true });
  });

  it('limits a cycle by batchLimit and reports a partial diagnostic', async () => {
    const store = fakeAgingStore([
      memoryRecord({ id: 'first', lastAccessedAt: currentTime - 40 * dayMs }),
      memoryRecord({ id: 'second', lastAccessedAt: currentTime - 40 * dayMs }),
    ]);

    const result = await runMemoryAgingCycle(
      {
        config: config({ batchLimit: 1 }),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result.status).toBe('PARTIAL');
    expect(result.processedCount).toBe(1);
    expect(result.reasonCodes).toContain('MEMORY_AGING_BATCH_LIMIT_REACHED');
  });

  it('skips an ACTIVE candidate that is no longer stale after list collection', async () => {
    const stale = memoryRecord({ id: 'recently-accessed', confidence: 0.6, lastAccessedAt: currentTime - 40 * dayMs });
    const store = fakeAgingStore([stale]);
    store.listLongTermMemory.mockImplementationOnce(async (query) => {
      store.records.set('recently-accessed', { ...stale, lastAccessedAt: now(currentTime - dayMs) });
      return {
        items: [listItem(stale)],
        total: 1,
        limit: query.limit ?? 100,
        offset: query.offset ?? 0,
      };
    });

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result).toMatchObject({
      status: 'COMPLETED',
      processedCount: 0,
      decayedCount: 0,
      archivedCount: 0,
      skippedCount: 1,
    });
    expect(store.mutateLongTermMemory).not.toHaveBeenCalled();
    expect(store.records.get('recently-accessed')?.confidence).toBe(0.6);
  });

  it('skips an ARCHIVED candidate that is no longer past retention after list collection', async () => {
    const expired = memoryRecord({ id: 'recently-archived', state: 'ARCHIVED', archivedAt: currentTime - 100 * dayMs });
    const store = fakeAgingStore([expired]);
    store.listLongTermMemory
      .mockImplementationOnce(async (query) => ({
        items: [],
        total: 0,
        limit: query.limit ?? 100,
        offset: query.offset ?? 0,
      }))
      .mockImplementationOnce(async (query) => {
        store.records.set('recently-archived', { ...expired, archivedAt: now(currentTime - dayMs) });
        return {
          items: [listItem(expired)],
          total: 1,
          limit: query.limit ?? 100,
          offset: query.offset ?? 0,
        };
      });

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result).toMatchObject({
      status: 'COMPLETED',
      processedCount: 0,
      deletedCount: 0,
      skippedCount: 1,
    });
    expect(store.deleteLongTermMemory).not.toHaveBeenCalled();
    expect(store.records.has('recently-archived')).toBe(true);
  });

  it('stops candidate paging when cancellation is raised during collection', async () => {
    const controller = new AbortController();
    let listCalls = 0;
    const items = Array.from({ length: 100 }, (_, index) =>
      listItem(memoryRecord({ id: `paged-${index}`, lastAccessedAt: currentTime - 40 * dayMs })),
    );
    const store = fakeAgingStore([], {
      listLongTermMemory: async (query) => {
        listCalls += 1;
        controller.abort();
        return {
          items,
          total: 200,
          limit: query.limit ?? 100,
          offset: query.offset ?? 0,
        };
      },
    });

    const result = await runMemoryAgingCycle(
      {
        config: config({ batchLimit: 200 }),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
      controller.signal,
    );

    expect(result.reasonCodes).toContain('MEMORY_AGING_CANCELED');
    expect(listCalls).toBe(1);
    expect(store.getLongTermMemory).not.toHaveBeenCalled();
  });

  it('reports storage unavailable without leaking raw storage details', async () => {
    const store = fakeAgingStore([], {
      listLongTermMemory: async () => safeError('LTM_STORAGE_UNAVAILABLE', 'UNAVAILABLE', true, { rawPath: 'C:\\secret\\memory.db' }),
    });

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      reasonCode: 'LTM_STORAGE_UNAVAILABLE',
      failureCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('memory.db');
  });

  it('counts update conflicts and continues with the same batch', async () => {
    const conflict = memoryRecord({ id: 'conflict', confidence: 0.03, lastAccessedAt: currentTime - 40 * dayMs });
    const decayed = memoryRecord({ id: 'after-conflict', confidence: 0.6, lastAccessedAt: currentTime - 40 * dayMs });
    const store = fakeAgingStore([conflict, decayed], { conflictIds: new Set(['conflict']) });

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
      },
      'manual',
    );

    expect(result).toMatchObject({
      status: 'PARTIAL',
      processedCount: 2,
      decayedCount: 1,
      archivedCount: 0,
      failureCount: 1,
    });
    expect(result.reasonCodes).toContain('MEMORY_AGING_UPDATE_CONFLICT');
    expect(store.records.get('after-conflict')?.confidence).toBeCloseTo(0.55);
  });

  it('does not run duplicate triggers concurrently in one process', async () => {
    let releaseList: ((value: LongTermMemorySummaryPage) => void) | undefined;
    let blocked = false;
    const store = fakeAgingStore([memoryRecord({ id: 'slow', lastAccessedAt: currentTime - 40 * dayMs })], {
      listLongTermMemory: async () => {
        if (!blocked) {
          blocked = true;
          return new Promise<LongTermMemorySummaryPage>((resolve) => {
            releaseList = resolve;
          });
        }
        return { items: [], total: 0, limit: 100, offset: 0 };
      },
    });
    const scheduler = createMemoryAgingScheduler({
      config: config(),
      scopes: [scope],
      store,
      now: () => now(currentTime),
    });

    const first = scheduler.triggerNow('manual');
    await waitFor(() => releaseList !== undefined);
    const second = await scheduler.triggerNow('manual');
    releaseList?.({ items: [], total: 0, limit: 100, offset: 0 });
    await first;

    expect(second).toMatchObject({
      status: 'SKIPPED',
      reasonCode: 'MEMORY_AGING_ALREADY_RUNNING',
    });
    await scheduler.stop();
  });

  it('revives archived memory only after owner-authorized L2 detail access', async () => {
    const archived = memoryRecord({ id: 'revive', state: 'ARCHIVED', confidence: 0.96, archivedAt: currentTime - 10 * dayMs, version: 2 });
    const store = fakeAgingStore([archived]);
    const diagnostics: MemoryAgingCycleDiagnostic[] = [];
    const auditEvents: MemoryAgingAuditEvent[] = [];
    const retriever = {
      getLongTermMemoryDetail: vi.fn(async () => store.records.get('revive') ?? safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false)),
    };

    const result = await getLongTermMemoryDetailWithAging({
      config: config(),
      retriever,
      store,
      request: {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        memoryId: brand<string, 'LongTermMemoryId'>('revive'),
      },
      now: () => now(currentTime),
      diagnosticObserver: (event) => diagnostics.push(event),
      auditObserver: (event) => auditEvents.push(event),
    });

    expect(result).toMatchObject({ state: 'ACTIVE', confidence: 1 });
    expect(store.mutateLongTermMemory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        targetState: 'ACTIVE',
      }),
      { expectedVersion: 2 },
    );
    expect(store.mutateLongTermMemory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        delta: 0.1,
      }),
      { expectedVersion: 3 },
    );
    expect(diagnostics[0]).toMatchObject({ triggerReason: 'detail_access', revivedCount: 1 });
    expect(auditEvents[0]).toMatchObject({ operation: 'REVIVE', reasonCode: 'detail_access_revived' });
  });

  it('does not revive not-found or non-owned detail access results', async () => {
    const store = fakeAgingStore([]);
    const retriever = {
      getLongTermMemoryDetail: vi.fn(async () => safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false)),
    };

    const result = await getLongTermMemoryDetailWithAging({
      config: config(),
      retriever,
      store,
      request: {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        memoryId: brand<string, 'LongTermMemoryId'>('missing'),
      },
      now: () => now(currentTime),
    });

    expect(result).toMatchObject({ code: 'LTM_ENTRY_NOT_FOUND' });
    expect(store.mutateLongTermMemory).not.toHaveBeenCalled();
  });

  it('stops before scanning when canceled and keeps diagnostics redacted', async () => {
    const controller = new AbortController();
    controller.abort();
    const diagnostics: MemoryAgingCycleDiagnostic[] = [];
    const store = fakeAgingStore([
      memoryRecord({
        id: 'unsafe',
        briefIndex: 'secret path C:\\Users\\admin\\token.txt',
        content: { category: 'FACTUAL', subject: 'password', claim: 'credential token' },
        lastAccessedAt: currentTime - 40 * dayMs,
      }),
    ]);

    const result = await runMemoryAgingCycle(
      {
        config: config(),
        scopes: [scope],
        store,
        now: () => now(currentTime),
        diagnosticObserver: (event) => diagnostics.push(event),
      },
      'manual',
      controller.signal,
    );

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reasonCode: 'MEMORY_AGING_CANCELED',
    });
    expect(store.listLongTermMemory).not.toHaveBeenCalled();
    expect(JSON.stringify(diagnostics)).not.toContain('credential token');
    expect(JSON.stringify(diagnostics)).not.toContain('C:\\Users');
  });
});

type AgingStore = Pick<LongTermMemoryStoreGateway, 'listLongTermMemory' | 'getLongTermMemory' | 'mutateLongTermMemory' | 'deleteLongTermMemory'> & {
  readonly records: Map<string, LongTermMemoryRecord>;
  readonly calls: string[];
  readonly listLongTermMemory: ReturnType<typeof vi.fn>;
  readonly getLongTermMemory: ReturnType<typeof vi.fn>;
  readonly mutateLongTermMemory: ReturnType<typeof vi.fn>;
  readonly deleteLongTermMemory: ReturnType<typeof vi.fn>;
};

type ListLongTermMemoryOverride = (
  query: Parameters<LongTermMemoryStoreGateway['listLongTermMemory']>[0],
) => LongTermMemorySummaryPage | SafeError | Promise<LongTermMemorySummaryPage | SafeError>;

function fakeAgingStore(
  initial: readonly LongTermMemoryRecord[],
  overrides: { readonly listLongTermMemory?: ListLongTermMemoryOverride; readonly conflictIds?: ReadonlySet<string> } = {},
): AgingStore {
  const records = new Map(initial.map((record) => [String(record.memoryId), record]));
  const calls: string[] = [];
  const store: AgingStore = {
    records,
    calls,
    listLongTermMemory: vi.fn(async (query) => {
      calls.push(`list:${query.state ?? 'ACTIVE'}`);
      if (overrides.listLongTermMemory !== undefined) {
        return overrides.listLongTermMemory(query);
      }
      const filtered = [...records.values()]
        .filter((record) => record.tenantId === query.tenantId && record.subjectId === query.subjectId && record.agentId === query.agentId)
        .filter((record) => query.state === undefined || record.state === query.state)
        .filter((record) => query.isPinned === undefined || (record.isPinned === true) === query.isPinned)
        .filter((record) => record.confidence >= (query.minConfidence ?? 0.3))
        .filter(
          (record) => query.maxLastAccessedAt === undefined || Number(record.lastAccessedAt ?? record.createTime) <= Number(query.maxLastAccessedAt),
        )
        .sort((left, right) => Number(right.createTime) - Number(left.createTime) || String(left.memoryId).localeCompare(String(right.memoryId)));
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 20;
      const page = filtered.slice(offset, offset + limit);
      return {
        items: page.map((record) => ({
          memoryId: record.memoryId,
          memoryType: record.memoryType,
          knowledgeSourceType: record.knowledgeSourceType,
          state: record.state,
          confidence: record.confidence,
          labels: record.labels,
          briefIndex: record.briefIndex,
          content: record.content,
          isPinned: record.isPinned,
          accessCount: record.accessCount,
          createTime: record.createTime,
          updateTime: record.updateTime,
          version: record.version,
        })),
        total: filtered.length,
        limit,
        offset,
      };
    }),
    getLongTermMemory: vi.fn(async (request) => {
      calls.push(`get:${String(request.memoryId)}`);
      const record = records.get(String(request.memoryId));
      return record !== undefined &&
        record.tenantId === request.tenantId &&
        record.subjectId === request.subjectId &&
        record.agentId === request.agentId
        ? record
        : safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false);
    }),
    mutateLongTermMemory: vi.fn(async (request, options): Promise<LongTermMemoryVersionedUpdateResult | SafeError> => {
      const operation =
        request.targetState !== undefined
          ? 'STATE'
          : request.delta !== undefined
            ? 'CONFIDENCE'
            : request.lastAccessTime !== undefined
              ? 'ACCESS'
              : 'PIN';
      calls.push(`mutate:${operation}`);
      const current = records.get(String(request.memoryId));
      if (current === undefined) {
        return { status: 'NOT_FOUND' };
      }
      if (overrides.conflictIds?.has(String(request.memoryId)) === true) {
        return { status: 'VERSION_CONFLICT', record: current };
      }
      if (options?.expectedVersion !== undefined && current.version !== options.expectedVersion) {
        return { status: 'VERSION_CONFLICT', record: current };
      }
      let updated: LongTermMemoryRecord;
      if (request.targetState !== undefined) {
        updated =
          request.targetState === 'ARCHIVED'
            ? {
                ...current,
                state: request.targetState,
                version: current.version + 1,
                updateTime: now(currentTime),
                archivedAt: now(currentTime),
                archiveReason: request.archiveReason ?? '',
              }
            : {
                ...current,
                state: request.targetState,
                version: current.version + 1,
                updateTime: now(currentTime),
                archivedAt: now(0),
                archiveReason: '',
              };
      } else if (request.delta !== undefined) {
        updated = {
          ...current,
          confidence: Math.max(0, Math.min(1, current.confidence + request.delta)),
          version: current.version + 1,
          updateTime: now(currentTime),
        };
      } else {
        return { status: 'NOT_FOUND' };
      }
      records.set(String(updated.memoryId), updated);
      return { status: 'UPDATED', record: updated };
    }),
    deleteLongTermMemory: vi.fn(async (request) => {
      calls.push('delete');
      const current = records.get(String(request.memoryId));
      if (
        current === undefined ||
        current.tenantId !== request.tenantId ||
        current.subjectId !== request.subjectId ||
        current.agentId !== request.agentId
      ) {
        return safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false);
      }
      records.delete(String(request.memoryId));
      return { memoryId: request.memoryId };
    }),
  };
  return store;
}

function config(
  overrides: {
    readonly memoryEnabled?: boolean;
    readonly agingEnabled?: boolean;
    readonly batchLimit?: number;
  } = {},
): MemoryAgingConfigSnapshot {
  const memoryEnabled = overrides.memoryEnabled ?? true;
  return {
    enabled: memoryEnabled,
    status: memoryEnabled ? 'VALID' : 'DISABLED',
    aging: {
      enabled: overrides.agingEnabled ?? true,
      schedule: '0 0 0 * * ?',
      decayStaleDays: 30,
      archiveRetentionDays: 90,
      decayFactor: 0.05,
      batchLimit: overrides.batchLimit ?? 1_000,
      timeoutMs: 30_000,
      reviveConfidenceBoost: 0.1,
    },
  };
}

function memoryRecord(input: {
  readonly id: string;
  readonly tenantId?: string;
  readonly subjectId?: string;
  readonly agentId?: string;
  readonly version?: number;
  readonly state?: LongTermMemoryRecord['state'];
  readonly confidence?: number;
  readonly lastAccessedAt?: number;
  readonly archivedAt?: number;
  readonly briefIndex?: string;
  readonly content?: MemoryContentByCategory;
  readonly isPinned?: boolean;
}): LongTermMemoryRecord {
  const content = input.content ?? { category: 'FACTUAL', subject: 'BGP peer', claim: 'Peer stays Established' };
  return {
    tenantId: brand<string, 'TenantId'>(input.tenantId ?? String(scope.tenantId)),
    subjectId: brand<string, 'SubjectId'>(input.subjectId ?? String(scope.subjectId)),
    agentId: brand<string, 'AgentId'>(input.agentId ?? String(scope.agentId)),
    memoryId: brand<string, 'LongTermMemoryId'>(input.id),
    memoryInstance: 'default',
    version: input.version ?? 1,
    memoryType: content.category,
    knowledgeSourceType: 'LEARNED',
    sharingState: 'PRIVATE',
    confidence: input.confidence ?? 0.8,
    state: input.state ?? 'ACTIVE',
    labels: ['network'],
    briefIndex: input.briefIndex ?? 'BGP peer remains Established',
    content: JSON.stringify(content),
    source: JSON.stringify({ sessionId: brand<string, 'SessionId'>('session-aging') }),
    accessCount: 0,
    recallCount: 0,
    extractionCount: 0,
    isPinned: input.isPinned ?? false,
    ...(input.lastAccessedAt === undefined ? {} : { lastAccessedAt: now(input.lastAccessedAt) }),
    archivedAt: now(input.archivedAt ?? 0),
    archiveReason: input.archivedAt === undefined ? '' : 'previous_policy',
    createTime: now(currentTime - 120 * dayMs),
    updateTime: now(currentTime - 120 * dayMs),
  };
}

function listItem(record: LongTermMemoryRecord): LongTermMemorySummaryPage['items'][number] {
  return {
    memoryId: record.memoryId,
    memoryType: record.memoryType,
    knowledgeSourceType: record.knowledgeSourceType,
    state: record.state,
    confidence: record.confidence,
    labels: record.labels,
    briefIndex: record.briefIndex,
    content: record.content,
    isPinned: record.isPinned,
    accessCount: record.accessCount,
    createTime: record.createTime,
    updateTime: record.updateTime,
    version: record.version,
  };
}

function now(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}

function safeError(code: string, category: SafeError['category'], retryable: boolean, safeDetails?: SafeError['safeDetails']): SafeError {
  return { code, category, retryable, message: `${code} safe error.`, ...(safeDetails === undefined ? {} : { safeDetails }) };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(await assertion()).toBe(true);
}
