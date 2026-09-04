import { brand, type SafeError } from '@nextagent/agent-common';
import type {
  GuardrailGatewayPort,
  LongTermMemoryGatewayBindings,
  LongTermMemoryRecord,
  LongTermMemorySummary,
  UserQueryGateway,
} from '@nextagent/agent-contracts/gateway';
import { createLongTermMemoryManagementService } from '@nextagent/agent-memory';
import { describe, expect, it, vi } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  displayName: 'Trusted User',
};
const scope = {
  identityContext,
  agentId: brand<string, 'AgentId'>('agent-1'),
};
const gatewayScope = {
  tenantId: identityContext.tenantId,
  subjectId: identityContext.subjectId,
  agentId: scope.agentId,
};
const memoryId = brand<string, 'LongTermMemoryId'>('memory-1');
const sourceMemoryId = brand<string, 'LongTermMemoryId'>('source-memory-1');
const now = brand<number, 'EpochMillis'>(100);

const record: LongTermMemoryRecord = {
  ...gatewayScope,
  memoryId,
  memoryInstance: 'defaultInstance',
  memoryType: 'PROCEDURAL',
  knowledgeSourceType: 'LEARNED',
  sharingState: 'PRIVATE',
  state: 'ACTIVE',
  briefIndex: 'Inspect BGP neighbor state',
  content: 'Run the approved BGP diagnostic procedure.',
  labels: ['bgp', 'diagnostic'],
  confidence: 0.9,
  version: 3,
  accessCount: 2,
  recallCount: 4,
  extractionCount: 1,
  lastAccessedAt: now,
  archivedAt: brand<number, 'EpochMillis'>(0),
  archiveReason: '',
  isPinned: true,
  source: 'manual',
  createTime: now,
  updateTime: now,
};

const summary: LongTermMemorySummary = {
  memoryId,
  memoryType: record.memoryType,
  knowledgeSourceType: record.knowledgeSourceType,
  state: record.state,
  briefIndex: record.briefIndex,
  content: record.content,
  labels: record.labels,
  confidence: record.confidence,
  isPinned: record.isPinned,
  accessCount: record.accessCount,
  createTime: record.createTime,
  updateTime: record.updateTime,
  version: record.version,
};

describe('long-term memory management service', () => {
  it('delegates the six Store operations once and maps records without scope leakage', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const writeOptions = {
      idempotencyKey: brand<string, 'IdempotencyKey'>('save-memory-1'),
      expectedVersion: 2,
      idempotencySemantic: 'memory-save',
    };

    const saved = await service.saveLongTermMemory({
      ...scope,
      memoryId,
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'LEARNED',
      briefIndex: record.briefIndex,
      content: record.content,
      confidence: 0.9,
      source: 'manual',
      writeOptions,
    });
    const listed = await service.listLongTermMemory({ ...scope, queryText: 'BGP', state: 'ACTIVE', limit: 20, offset: 0 });
    await service.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'LEARNED',
      briefIndex: 'Configured maintenance window',
      content: 'Sunday 02:00',
      labels: ['maintenance'],
      confidence: 0.75,
    });
    await service.getLongTermMemory({ ...scope, memoryId });
    await service.deleteLongTermMemory({ ...scope, memoryId, reasonCode: 'USER_DELETE' });
    const mutated = await service.mutateLongTermMemory({
      ...scope,
      memoryId,
      targetState: 'ARCHIVED',
      archiveReason: 'STALE',
      writeOptions: { expectedVersion: 3 },
    });

    expect(gateways.store.saveLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.saveLongTermMemory).toHaveBeenCalledWith(expect.not.objectContaining({ writeOptions }), writeOptions);
    expect(gateways.store.listLongTermMemory).toHaveBeenCalledWith({ ...gatewayScope, queryText: 'BGP', state: 'ACTIVE', limit: 20, offset: 0 });
    expect(gateways.store.manualSaveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'LEARNED',
        confidence: 0.75,
      }),
    );
    expect(gateways.store.getLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.deleteLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.mutateLongTermMemory).toHaveBeenCalledWith(expect.not.objectContaining({ writeOptions: expect.anything() }), {
      expectedVersion: 3,
    });
    expect(saved).toMatchObject({ memoryId, briefIndex: record.briefIndex, content: record.content });
    expect(saved).not.toHaveProperty('tenantId');
    expect(saved).not.toHaveProperty('subjectId');
    expect(saved).not.toHaveProperty('agentId');
    expect(gateways.store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.not.objectContaining({ identityContext: expect.anything(), displayName: expect.anything() }),
      writeOptions,
    );
    expect(listed).toEqual({ items: [summary], total: 1, offset: 0, limit: 20 });
    expect(mutated).toMatchObject({ status: 'UPDATED', memoryId, currentVersion: 3, record: { memoryId } });
    expect(mutated).not.toHaveProperty('record.tenantId');
  });

  it('queries active and archived configured totals before create and shares the quota across memory types', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    vi.mocked(gateways.store.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 30, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 19, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 40, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 10, offset: 0, limit: 1 });

    const allowed = await service.manualSaveLongTermMemory({
      ...scope,
      memoryInstance: 'instance-1',
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Configured fact',
      content: 'The configured total becomes fifty.',
      labels: [],
      confidence: 1,
    });
    const rejected = await service.manualSaveLongTermMemory({
      ...scope,
      memoryInstance: 'instance-1',
      memoryType: 'CONCEPTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Configured concept',
      content: 'The configured total would exceed fifty.',
      labels: [],
      confidence: 1,
    });

    expect(allowed).toMatchObject({ memoryId });
    expect(rejected).toEqual({
      code: 'LTM_WRITE_INVALID',
      message: 'At most 50 configured long-term memories are allowed. Remove or consolidate an existing configured memory before adding another one.',
      category: 'VALIDATION',
      retryable: false,
    });
    expect(gateways.store.listLongTermMemory).toHaveBeenNthCalledWith(1, {
      ...gatewayScope,
      memoryInstance: 'instance-1',
      knowledgeSourceType: 'CONFIGURED',
      minConfidence: 0,
      state: 'ACTIVE',
      limit: 1,
      offset: 0,
    });
    expect(gateways.store.listLongTermMemory).toHaveBeenNthCalledWith(2, {
      ...gatewayScope,
      memoryInstance: 'instance-1',
      knowledgeSourceType: 'CONFIGURED',
      minConfidence: 0,
      state: 'ARCHIVED',
      limit: 1,
      offset: 0,
    });
    expect(gateways.store.manualSaveLongTermMemory).toHaveBeenCalledOnce();
  });

  it('skips configured capacity queries for edits and does not write when a count query fails', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);

    await service.manualSaveLongTermMemory({
      ...scope,
      memoryId,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Edited configured fact',
      content: 'Editing does not consume a new slot.',
      labels: [],
      confidence: 0.8,
    });
    expect(gateways.store.listLongTermMemory).not.toHaveBeenCalled();
    expect(gateways.store.manualSaveLongTermMemory).toHaveBeenCalledOnce();

    vi.mocked(gateways.store.manualSaveLongTermMemory).mockClear();
    const queryError: SafeError = {
      code: 'LTM_STORAGE_UNAVAILABLE',
      message: 'Long-term memory storage is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
    };
    vi.mocked(gateways.store.listLongTermMemory).mockResolvedValueOnce(queryError);
    const failed = await service.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Configured procedure',
      content: 'This write must not run after a failed count query.',
      labels: [],
      confidence: 1,
    });

    expect(failed).toBe(queryError);
    expect(gateways.store.manualSaveLongTermMemory).not.toHaveBeenCalled();
  });

  it('admits batch entries within the configured capacity and mirrors the manualSave count query shape', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    vi.mocked(gateways.store.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 30, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 1 });
    const admittedMemoryIds = Array.from({ length: 10 }, (_, index) => brand<string, 'LongTermMemoryId'>(`imported-memory-${index + 1}`));
    vi.mocked(gateways.store.batchCreateLongTermMemory).mockResolvedValueOnce({ successCount: 10, failCount: 0, memoryIds: admittedMemoryIds });
    const items = Array.from({ length: 10 }, (_, index) => configuredBatchItem(index + 1));

    const result = await service.batchCreateLongTermMemory({ ...scope, items });

    expect(gateways.store.listLongTermMemory).toHaveBeenNthCalledWith(1, {
      ...gatewayScope,
      memoryInstance: 'defaultInstance',
      knowledgeSourceType: 'CONFIGURED',
      minConfidence: 0,
      state: 'ACTIVE',
      limit: 1,
      offset: 0,
    });
    expect(gateways.store.listLongTermMemory).toHaveBeenNthCalledWith(2, {
      ...gatewayScope,
      memoryInstance: 'defaultInstance',
      knowledgeSourceType: 'CONFIGURED',
      minConfidence: 0,
      state: 'ARCHIVED',
      limit: 1,
      offset: 0,
    });
    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledWith({
      ...gatewayScope,
      items: items.map(mappedBatchItem),
    });
    expect(result).toEqual({ successCount: 10, failCount: 0, memoryIds: admittedMemoryIds });
  });

  it('admits configured batch entries in input order up to the remaining capacity', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    vi.mocked(gateways.store.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 40, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 7, offset: 0, limit: 1 });
    const admittedMemoryIds = [1, 2, 3].map((index) => brand<string, 'LongTermMemoryId'>(`imported-memory-${index}`));
    vi.mocked(gateways.store.batchCreateLongTermMemory).mockResolvedValueOnce({ successCount: 3, failCount: 0, memoryIds: admittedMemoryIds });

    const result = await service.batchCreateLongTermMemory({
      ...scope,
      items: Array.from({ length: 20 }, (_, index) => configuredBatchItem(index + 1)),
    });

    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledWith({
      ...gatewayScope,
      items: [configuredBatchItem(1), configuredBatchItem(2), configuredBatchItem(3)].map(mappedBatchItem),
    });
    expect(result).toEqual({ successCount: 3, failCount: 17, memoryIds: admittedMemoryIds });
  });

  it('still admits learned entries when configured batch entries exceed the remaining capacity', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    vi.mocked(gateways.store.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 48, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 1 });
    const admittedMemoryIds = [1, 2, 4, 5].map((index) => brand<string, 'LongTermMemoryId'>(`imported-memory-${index}`));
    vi.mocked(gateways.store.batchCreateLongTermMemory).mockResolvedValueOnce({ successCount: 4, failCount: 0, memoryIds: admittedMemoryIds });

    const result = await service.batchCreateLongTermMemory({
      ...scope,
      items: [configuredBatchItem(1), configuredBatchItem(2), configuredBatchItem(3), learnedBatchItem(4), learnedBatchItem(5)],
    });

    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledWith({
      ...gatewayScope,
      items: [configuredBatchItem(1), configuredBatchItem(2), learnedBatchItem(4), learnedBatchItem(5)].map(mappedBatchItem),
    });
    expect(result).toEqual({ successCount: 4, failCount: 1, memoryIds: admittedMemoryIds });
  });

  it('rejects every configured batch entry without persistence when the capacity is exhausted', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    vi.mocked(gateways.store.listLongTermMemory)
      .mockResolvedValueOnce({ items: [], total: 50, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 1 });

    const result = await service.batchCreateLongTermMemory({
      ...scope,
      items: Array.from({ length: 5 }, (_, index) => configuredBatchItem(index + 1)),
    });

    expect(result).toEqual({ successCount: 0, failCount: 5, memoryIds: [] });
    expect(gateways.store.batchCreateLongTermMemory).not.toHaveBeenCalled();
  });

  it('skips batch capacity queries when configured entries update existing memories', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const updateItem = { ...configuredBatchItem(1), memoryId };

    const result = await service.batchCreateLongTermMemory({ ...scope, items: [updateItem] });

    expect(gateways.store.listLongTermMemory).not.toHaveBeenCalled();
    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledWith({
      ...gatewayScope,
      items: [mappedBatchItem(updateItem)],
    });
    expect(result).toEqual({ successCount: 1, failCount: 0, memoryIds: [memoryId] });
  });

  it('fails the whole batch safely when a capacity count query fails', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const queryError: SafeError = {
      code: 'LTM_STORAGE_UNAVAILABLE',
      message: 'Long-term memory storage is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
    };
    vi.mocked(gateways.store.listLongTermMemory).mockResolvedValueOnce(queryError);

    const result = await service.batchCreateLongTermMemory({
      ...scope,
      items: [configuredBatchItem(1), learnedBatchItem(2)],
    });

    expect(result).toBe(queryError);
    expect(gateways.store.batchCreateLongTermMemory).not.toHaveBeenCalled();
  });

  it('skips batch capacity queries for learned-only batches', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const items = [learnedBatchItem(1), learnedBatchItem(2)];

    const result = await service.batchCreateLongTermMemory({ ...scope, items });

    expect(gateways.store.listLongTermMemory).not.toHaveBeenCalled();
    expect(gateways.store.batchCreateLongTermMemory).toHaveBeenCalledWith({
      ...gatewayScope,
      items: items.map(mappedBatchItem),
    });
    expect(result).toEqual({ successCount: 1, failCount: 0, memoryIds: [memoryId] });
  });

  it('delegates Retriever operations and preserves score and page coordinates', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const search = await service.searchLongTermMemory({
      ...scope,
      queryText: 'BGP neighbor',
      memoryType: 'PROCEDURAL',
      minConfidence: 0.5,
      labels: ['bgp'],
      limit: 10,
      offset: 0,
    });
    const detail = await service.getLongTermMemoryDetail({ ...scope, memoryId });

    expect(gateways.retriever.searchLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.retriever.searchLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({ ...gatewayScope, queryText: 'BGP neighbor', offset: 0 }),
    );
    expect(gateways.retriever.getLongTermMemoryDetail).toHaveBeenCalledWith({ ...gatewayScope, memoryId });
    expect(search).toEqual({
      items: [{ summary, score: 0.8, relevanceScore: 0.7 }],
      total: 1,
      offset: 0,
      limit: 10,
    });
    expect(detail).toMatchObject({ memoryId, source: 'manual' });
    expect(detail).not.toHaveProperty('tenantId');
  });

  it('delegates Sharing operations and preserves provenance in projected results', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const published = await service.publishLongTermMemory({ ...scope, memoryId, reasonCode: 'TEAM_SHARE' });
    const unpublished = await service.unpublishLongTermMemory({ ...scope, memoryId });
    const shared = await service.listPublishedLongTermMemory({ ...scope, queryText: 'BGP', limit: 10, offset: 0 });
    const copied = await service.copyPublishedMemory({ ...scope, memoryIds: [memoryId], reasonCode: 'COPY' });

    expect(gateways.sharing.publishLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.sharing.unpublishLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.sharing.listPublishedLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.sharing.copyPublishedMemory).toHaveBeenCalledOnce();
    expect(published).toMatchObject({ sourceMemoryId, ownerSubjectId: identityContext.subjectId, publishedMemory: { memoryId } });
    expect(published).not.toHaveProperty('publishedMemory.tenantId');
    expect(unpublished).toEqual({ memoryId });
    expect(shared).toMatchObject({ items: [{ memoryId, sourceMemoryId, ownerSubjectId: identityContext.subjectId }] });
    expect(copied).toMatchObject({ results: [{ memoryId, sourceMemoryId, copyStatus: 'COPIED', record: { memoryId } }] });
    expect(copied).not.toHaveProperty('results.0.record.subjectId');
  });

  it('resolves unique shared-memory owners with trusted scope and falls back per missing user', async () => {
    const gateways = createGateways();
    const ownerA = brand<string, 'SubjectId'>('owner-a');
    const ownerB = brand<string, 'SubjectId'>('owner-b');
    vi.mocked(gateways.sharing.listPublishedLongTermMemory).mockResolvedValueOnce({
      items: [
        { ...summary, sourceMemoryId, ownerSubjectId: ownerA },
        { ...summary, memoryId: brand<string, 'LongTermMemoryId'>('memory-2'), sourceMemoryId, ownerSubjectId: ownerA },
        { ...summary, memoryId: brand<string, 'LongTermMemoryId'>('memory-3'), sourceMemoryId, ownerSubjectId: ownerB },
      ],
      total: 3,
      offset: 0,
      limit: 10,
    });
    const queryUsers = vi.fn<UserQueryGateway['queryUsers']>(async () => ({
      users: [{ subjectId: ownerA, userName: 'Owner Alice' }],
    }));
    const service = createLongTermMemoryManagementService({ ...gateways, userQuery: { queryUsers } });
    const controller = new AbortController();

    const result = await service.listPublishedLongTermMemory({ ...scope, limit: 10, offset: 0 }, controller.signal);

    expect(queryUsers).toHaveBeenCalledWith(
      {
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        targetSubjectIds: [ownerA, ownerB],
      },
      controller.signal,
    );
    expect(result).toMatchObject({
      items: [
        { ownerSubjectId: ownerA, ownerUserName: 'Owner Alice' },
        { ownerSubjectId: ownerA, ownerUserName: 'Owner Alice' },
        { ownerSubjectId: ownerB },
      ],
    });
    if ('code' in result) {
      throw new Error(result.message);
    }
    expect(result.items[2]).not.toHaveProperty('ownerUserName');
  });

  it('keeps shared content on ordinary user-query failure but propagates cancellation', async () => {
    const gateways = createGateways();
    const failure: SafeError = { code: 'USER_QUERY_UNAVAILABLE', message: 'User query is unavailable.', category: 'UNAVAILABLE', retryable: true };
    const queryUsers = vi.fn<UserQueryGateway['queryUsers']>().mockResolvedValueOnce(failure).mockResolvedValueOnce({
      code: 'USER_QUERY_CANCELED',
      message: 'User query was canceled.',
      category: 'CANCELED',
      retryable: false,
    });
    const service = createLongTermMemoryManagementService({ ...gateways, userQuery: { queryUsers } });

    const degraded = await service.listPublishedLongTermMemory({ ...scope, limit: 10, offset: 0 });
    const canceled = await service.listPublishedLongTermMemory({ ...scope, limit: 10, offset: 0 });

    expect(degraded).toMatchObject({ items: [{ ownerSubjectId: identityContext.subjectId }] });
    if ('code' in degraded) {
      throw new Error(degraded.message);
    }
    expect(degraded.items[0]).not.toHaveProperty('ownerUserName');
    expect(canceled).toMatchObject({ code: 'LTM_OPERATION_CANCELED', category: 'CANCELED' });
  });

  it('does not query users for an empty shared-memory page', async () => {
    const gateways = createGateways();
    vi.mocked(gateways.sharing.listPublishedLongTermMemory).mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 10 });
    const queryUsers = vi.fn<UserQueryGateway['queryUsers']>();
    const service = createLongTermMemoryManagementService({ ...gateways, userQuery: { queryUsers } });

    await expect(service.listPublishedLongTermMemory({ ...scope, limit: 10, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
      offset: 0,
      limit: 10,
    });
    expect(queryUsers).not.toHaveBeenCalled();
  });

  it('short-circuits pre-aborted calls, preserves SafeError, and normalizes thrown failures', async () => {
    const gateways = createGateways();
    const service = createLongTermMemoryManagementService(gateways);
    const controller = new AbortController();
    controller.abort();

    await expect(service.getLongTermMemory({ ...scope, memoryId }, controller.signal)).resolves.toEqual({
      code: 'LTM_OPERATION_CANCELED',
      message: 'Long-term memory operation was canceled.',
      category: 'CANCELED',
      retryable: false,
    });
    expect(gateways.store.getLongTermMemory).not.toHaveBeenCalled();

    const safeError: SafeError = {
      code: 'LTM_MEMORY_NOT_FOUND',
      message: 'Long-term memory was not found.',
      category: 'NOT_FOUND',
      retryable: false,
    };
    vi.mocked(gateways.store.getLongTermMemory).mockResolvedValueOnce(safeError);
    await expect(service.getLongTermMemory({ ...scope, memoryId })).resolves.toBe(safeError);

    vi.mocked(gateways.store.getLongTermMemory).mockRejectedValueOnce(safeError);
    await expect(service.getLongTermMemory({ ...scope, memoryId })).resolves.toBe(safeError);

    vi.mocked(gateways.store.getLongTermMemory).mockRejectedValueOnce(
      new Error(`raw-provider-failure ${identityContext.tenantId} ${record.content}`),
    );
    const failure = await service.getLongTermMemory({ ...scope, memoryId });
    expect(failure).toEqual({
      code: 'LTM_STORAGE_UNAVAILABLE',
      message:
        'Long-term memory storage is temporarily unavailable. Use the current conversation context, try again later, or continue without memory.',
      category: 'UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain('raw-provider-failure');
    expect(JSON.stringify(failure)).not.toContain(String(identityContext.tenantId));
    expect(JSON.stringify(failure)).not.toContain(record.content);
  });

  it('routes save and manualSave through the shared knowledge admission coordinator', async () => {
    const { gateways, service, checkKnowledge } = createGuardedManagementService({ isLegal: true });

    await service.saveLongTermMemory({
      ...scope,
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'LEARNED',
      briefIndex: record.briefIndex,
      content: record.content,
      confidence: 0.9,
      source: 'manual',
    });
    await service.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Configured BGP maintenance window',
      content: 'BGP maintenance window is Sunday 02:00',
      labels: ['label-canary-must-not-be-checked'],
      confidence: 1,
    });

    expect(checkKnowledge).toHaveBeenCalledTimes(2);
    expect(checkKnowledge).toHaveBeenNthCalledWith(
      1,
      {
        texts: [`${record.briefIndex}\n${record.content}`],
        isPrivacy: true,
      },
      undefined,
    );
    expect(checkKnowledge).toHaveBeenNthCalledWith(
      2,
      {
        texts: ['Configured BGP maintenance window\nBGP maintenance window is Sunday 02:00'],
        isPrivacy: true,
      },
      undefined,
    );
    expect(JSON.stringify(checkKnowledge.mock.calls)).not.toContain('label-canary-must-not-be-checked');
    expect(gateways.store.saveLongTermMemory).toHaveBeenCalledOnce();
    expect(gateways.store.manualSaveLongTermMemory).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'blocked',
      guardResult: { isLegal: false } as const,
      code: 'LTM_CONTENT_GUARD_BLOCKED',
    },
    {
      name: 'unavailable',
      guardResult: {
        code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
        message: 'Knowledge guardrail is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      } as const,
      code: 'LTM_CONTENT_GUARD_UNAVAILABLE',
    },
    {
      name: 'canceled',
      guardResult: {
        code: 'GUARDRAIL_KNOWLEDGE_CANCELED',
        message: 'Knowledge guardrail was canceled.',
        category: 'CANCELED',
        retryable: false,
      } as const,
      code: 'LTM_CONTENT_GUARD_CANCELED',
    },
  ])('fails $name save and manualSave safely without persistence', async ({ guardResult, code }) => {
    const { gateways, service } = createGuardedManagementService(guardResult);
    const saveResult = await service.saveLongTermMemory({
      ...scope,
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'LEARNED',
      briefIndex: record.briefIndex,
      content: 'management-write-content-canary',
      confidence: 0.9,
      source: 'manual',
    });
    const manualResult = await service.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Configured BGP maintenance window',
      content: 'management-manual-content-canary',
      confidence: 1,
    });

    expect(saveResult).toMatchObject({ code });
    expect(manualResult).toMatchObject({ code });
    expect(JSON.stringify([saveResult, manualResult])).not.toContain('management-write-content-canary');
    expect(JSON.stringify([saveResult, manualResult])).not.toContain('management-manual-content-canary');
    expect(gateways.store.saveLongTermMemory).not.toHaveBeenCalled();
    expect(gateways.store.manualSaveLongTermMemory).not.toHaveBeenCalled();
  });

  it('does not run knowledge admission for non-text management operations', async () => {
    const { service, checkKnowledge } = createGuardedManagementService({ isLegal: true });

    await service.listLongTermMemory({ ...scope, limit: 20, offset: 0 });
    await service.getLongTermMemory({ ...scope, memoryId });
    await service.deleteLongTermMemory({ ...scope, memoryId, reasonCode: 'USER_DELETE' });
    await service.mutateLongTermMemory({ ...scope, memoryId, targetState: 'ARCHIVED' });
    await service.searchLongTermMemory({ ...scope, queryText: 'BGP', minConfidence: 0, limit: 10, offset: 0 });
    await service.getLongTermMemoryDetail({ ...scope, memoryId });
    await service.publishLongTermMemory({ ...scope, memoryId, reasonCode: 'TEAM_SHARE' });
    await service.unpublishLongTermMemory({ ...scope, memoryId });
    await service.listPublishedLongTermMemory({ ...scope, limit: 10, offset: 0 });
    await service.copyPublishedMemory({ ...scope, memoryIds: [memoryId], reasonCode: 'COPY' });

    expect(checkKnowledge).not.toHaveBeenCalled();
  });
});

function createGuardedManagementService(guardResult: Awaited<ReturnType<GuardrailGatewayPort['checkKnowledge']>>) {
  const gateways = createGateways();
  const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => guardResult);
  const guardrail: GuardrailGatewayPort = {
    checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkNl2Python: vi.fn(async () => ({ status: true, errorMsg: [] })),
    checkKnowledge,
  };
  return {
    gateways,
    checkKnowledge,
    service: createLongTermMemoryManagementService({ ...gateways, guardrail }),
  };
}

function configuredBatchItem(index: number) {
  return {
    memoryType: 'FACTUAL' as const,
    knowledgeSourceType: 'CONFIGURED' as const,
    briefIndex: `Imported fact ${index}`,
    content: `Imported content ${index}`,
    labels: [],
    confidence: 1,
    idempotencyKey: brand<string, 'IdempotencyKey'>(`batch-import-${index}`),
  };
}

function learnedBatchItem(index: number) {
  return { ...configuredBatchItem(index), knowledgeSourceType: 'LEARNED' as const };
}

function mappedBatchItem<T extends { readonly idempotencyKey: string }>(item: T) {
  const { idempotencyKey, ...rest } = item;
  return { ...rest, writeOptions: { idempotencyKey } };
}

function createGateways(): LongTermMemoryGatewayBindings {
  return {
    store: {
      getLongTermMemory: vi.fn(async () => record),
      saveLongTermMemory: vi.fn(async () => record),
      batchCreateLongTermMemory: vi.fn(async () => ({ successCount: 1, failCount: 0, memoryIds: [memoryId] })),
      manualSaveLongTermMemory: vi.fn(async () => record),
      deleteLongTermMemory: vi.fn(async () => ({ memoryId })),
      listLongTermMemory: vi.fn(async () => ({ items: [summary], total: 1, offset: 0, limit: 20 })),
      mutateLongTermMemory: vi.fn(async () => ({ status: 'UPDATED' as const, memoryId, currentVersion: record.version, record })),
    },
    retriever: {
      searchLongTermMemory: vi.fn(async () => ({
        items: [{ summary, score: 0.8, relevanceScore: 0.7 }],
        total: 1,
        offset: 0,
        limit: 10,
      })),
      getLongTermMemoryDetail: vi.fn(async () => record),
    },
    sharing: {
      publishLongTermMemory: vi.fn(async () => ({ publishedMemory: record, sourceMemoryId, ownerSubjectId: identityContext.subjectId })),
      unpublishLongTermMemory: vi.fn(async () => ({ memoryId })),
      listPublishedLongTermMemory: vi.fn(async () => ({
        items: [{ ...summary, sourceMemoryId, ownerSubjectId: identityContext.subjectId }],
        total: 1,
        offset: 0,
        limit: 10,
      })),
      copyPublishedMemory: vi.fn(async () => ({
        results: [{ memoryId, record, sourceMemoryId, copyStatus: 'COPIED' as const }],
      })),
    },
  };
}
