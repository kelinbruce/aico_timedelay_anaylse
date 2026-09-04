import { bindRuntimeLoggerProvider, brand, type EpochMillis, type IdempotencyKey } from '@nextagent/agent-common';
import type { LongTermMemoryRecord, SaveLongTermMemoryRequest } from '@nextagent/agent-contracts/gateway';
import { createSqliteGatewayStores, type LocalGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function scope(suffix: string, subject = `subject-${suffix}`) {
  return {
    tenantId: brand<string, 'TenantId'>(`tenant-${suffix}`),
    subjectId: brand<string, 'SubjectId'>(subject),
    agentId: brand<string, 'AgentId'>(`agent-${suffix}`),
  };
}

function saveRequest(owner: ReturnType<typeof scope>, overrides: Partial<SaveLongTermMemoryRequest> = {}): SaveLongTermMemoryRequest {
  return {
    ...owner,
    memoryType: 'FACTUAL',
    knowledgeSourceType: 'LEARNED',
    briefIndex: 'BGP peer state',
    content: JSON.stringify({ category: 'FACTUAL', subject: 'BGP peer', claim: 'Peer is Established' }),
    labels: ['bgp', 'network'],
    confidence: 0.8,
    source: JSON.stringify({ sessionId: 'session-memory-contract' }),
    ...overrides,
  };
}

function expectRecord(result: LongTermMemoryRecord | { readonly code: string }): LongTermMemoryRecord {
  if ('code' in result) {
    throw new Error(result.code);
  }
  return result;
}

function at(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}

describe('long-term memory YAML-aligned gateway contracts', () => {
  it('implements save, get, list, manual save, and physical delete with canonical YAML fields', async () => {
    const gateway = createTestGatewayStores();
    const owner = scope('store');
    const idempotencyKey = brand<string, 'IdempotencyKey'>('ltm-store-idempotency') as IdempotencyKey;
    const request = saveRequest(owner);

    const saved = expectRecord(await gateway.longTermMemoryStore.saveLongTermMemory(request, { idempotencyKey }));
    const replayed = await gateway.longTermMemoryStore.saveLongTermMemory(request, { idempotencyKey });
    expect(replayed).toEqual(saved);
    expect(saved).toMatchObject({
      ...owner,
      memoryInstance: 'defaultInstance',
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'LEARNED',
      sharingState: 'PRIVATE',
      state: 'ACTIVE',
      briefIndex: request.briefIndex,
      content: request.content,
      labels: request.labels,
      confidence: 0.8,
      version: 1,
      accessCount: 0,
      recallCount: 0,
      extractionCount: 0,
      archivedAt: 0,
      archiveReason: '',
      isPinned: false,
      source: request.source,
    });
    expect(Object.keys(saved).sort()).toEqual([
      'accessCount',
      'agentId',
      'archiveReason',
      'archivedAt',
      'briefIndex',
      'confidence',
      'content',
      'createTime',
      'extractionCount',
      'isPinned',
      'knowledgeSourceType',
      'labels',
      'memoryId',
      'memoryInstance',
      'memoryType',
      'recallCount',
      'sharingState',
      'source',
      'state',
      'subjectId',
      'tenantId',
      'updateTime',
      'version',
    ]);

    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...owner, memoryId: saved.memoryId })).resolves.toEqual(saved);
    await expect(
      gateway.longTermMemoryStore.getLongTermMemory({
        ...owner,
        subjectId: brand<string, 'SubjectId'>('other-subject'),
        memoryId: saved.memoryId,
      }),
    ).resolves.toMatchObject({ code: 'LTM_MEMORY_NOT_FOUND', category: 'NOT_FOUND' });

    const page = await gateway.longTermMemoryStore.listLongTermMemory({
      ...owner,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'LEARNED',
      state: 'ACTIVE',
      labels: 'bgp',
      minConfidence: 0.5,
      limit: 10,
      offset: 0,
    });
    expect(page).toMatchObject({ total: 1, limit: 10, offset: 0, items: [{ memoryId: saved.memoryId }] });

    const manual = expectRecord(
      await gateway.longTermMemoryStore.manualSaveLongTermMemory({
        ...owner,
        memoryType: 'PROCEDURAL',
        knowledgeSourceType: 'CONFIGURED',
        briefIndex: 'Check BGP neighbor',
        content: JSON.stringify({ category: 'PROCEDURAL', procedureName: 'BGP check', procedureText: 'Inspect neighbor state' }),
        labels: ['manual'],
        confidence: 0.85,
      }),
    );
    expect(manual).toMatchObject({ confidence: 0.85, source: 'MANUAL', memoryType: 'PROCEDURAL' });

    await expect(
      gateway.longTermMemoryStore.deleteLongTermMemory({ ...owner, memoryId: manual.memoryId, reasonCode: 'user_delete' }),
    ).resolves.toEqual({ memoryId: manual.memoryId });
    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...owner, memoryId: manual.memoryId })).resolves.toMatchObject({
      code: 'LTM_MEMORY_NOT_FOUND',
    });
  });

  it('supports partial batch create, archived input, capacity, and idempotent replay', async () => {
    const gateway = createTestGatewayStores();
    const owner = scope('batch');
    const idempotencyKey = brand<string, 'IdempotencyKey'>('batch-item-1');
    const first = await gateway.longTermMemoryStore.batchCreateLongTermMemory({
      ...owner,
      items: [
        {
          memoryType: 'USER_CHARACTERISTICS',
          knowledgeSourceType: 'CONFIGURED',
          briefIndex: 'Preferred maintenance window',
          content: 'Use the approved night window.',
          state: 'ARCHIVED',
          archiveReason: 'imported_archive',
          writeOptions: { idempotencyKey },
        },
        {
          memoryType: 'FACTUAL',
          knowledgeSourceType: 'CONFIGURED',
          briefIndex: '',
          content: 'Invalid empty summary',
        },
      ],
    });
    expect(first).toMatchObject({ successCount: 1, failCount: 1, memoryIds: [expect.any(String)] });
    if ('code' in first) {
      throw new Error(first.code);
    }
    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...owner, memoryId: first.memoryIds[0]! })).resolves.toMatchObject({
      confidence: 1,
      source: '',
      state: 'ARCHIVED',
      archiveReason: 'imported_archive',
    });

    const replay = await gateway.longTermMemoryStore.batchCreateLongTermMemory({
      ...owner,
      items: [
        {
          memoryType: 'USER_CHARACTERISTICS',
          knowledgeSourceType: 'CONFIGURED',
          briefIndex: 'Preferred maintenance window',
          content: 'Use the approved night window.',
          state: 'ARCHIVED',
          archiveReason: 'imported_archive',
          writeOptions: { idempotencyKey },
        },
      ],
    });
    expect(replay).toEqual({ successCount: 1, failCount: 0, memoryIds: first.memoryIds });

    await expect(gateway.longTermMemoryStore.batchCreateLongTermMemory({ ...owner, items: [] })).resolves.toMatchObject({
      code: 'LTM_WRITE_INVALID',
    });
    await expect(
      gateway.longTermMemoryStore.batchCreateLongTermMemory({
        ...owner,
        items: Array.from({ length: 101 }, (_, index) => ({
          memoryType: 'FACTUAL' as const,
          knowledgeSourceType: 'LEARNED' as const,
          briefIndex: `item-${index}`,
          content: 'content',
        })),
      }),
    ).resolves.toMatchObject({ code: 'LTM_WRITE_INVALID' });

    const capacityOwner = scope('batch-capacity');
    await expect(
      gateway.longTermMemoryStore.batchCreateLongTermMemory({
        ...capacityOwner,
        items: Array.from({ length: 51 }, (_, index) => ({
          memoryType: 'USER_CHARACTERISTICS' as const,
          knowledgeSourceType: 'CONFIGURED' as const,
          briefIndex: `Configured preference ${index}`,
          content: `Configured preference content ${index}`,
          state: index === 0 ? ('ARCHIVED' as const) : ('ACTIVE' as const),
          ...(index === 0 ? { writeOptions: { idempotencyKey: brand<string, 'IdempotencyKey'>('capacity-item-0') } } : {}),
        })),
      }),
    ).resolves.toMatchObject({ successCount: 50, failCount: 1 });
    await expect(
      gateway.longTermMemoryStore.batchCreateLongTermMemory({
        ...capacityOwner,
        items: [
          {
            memoryType: 'USER_CHARACTERISTICS',
            knowledgeSourceType: 'CONFIGURED',
            briefIndex: 'Configured preference 0',
            content: 'Configured preference content 0',
            state: 'ARCHIVED',
            writeOptions: { idempotencyKey: brand<string, 'IdempotencyKey'>('capacity-item-0') },
          },
        ],
      }),
    ).resolves.toMatchObject({ successCount: 1, failCount: 0 });
  });

  it('accepts exactly one flat mutation branch and keeps CAS in write options', async () => {
    const gateway = createTestGatewayStores();
    const owner = scope('mutation');
    const saved = expectRecord(await gateway.longTermMemoryStore.saveLongTermMemory(saveRequest(owner, { confidence: 0.4 })));

    const archived = await gateway.longTermMemoryStore.mutateLongTermMemory(
      {
        ...owner,
        memoryId: saved.memoryId,
        targetState: 'ARCHIVED',
        archiveReason: 'aging_policy',
      },
      { expectedVersion: 1 },
    );
    expect(archived).toMatchObject({ status: 'UPDATED', currentVersion: 2, record: { state: 'ARCHIVED', archiveReason: 'aging_policy' } });

    const revived = await gateway.longTermMemoryStore.mutateLongTermMemory(
      {
        ...owner,
        memoryId: saved.memoryId,
        targetState: 'ACTIVE',
        archiveReason: '',
      },
      { expectedVersion: 2 },
    );
    expect(revived).toMatchObject({ status: 'UPDATED', currentVersion: 3, record: { state: 'ACTIVE', archivedAt: 0, archiveReason: '' } });

    const adjusted = await gateway.longTermMemoryStore.mutateLongTermMemory(
      {
        ...owner,
        memoryId: saved.memoryId,
        delta: 0.6,
      },
      { expectedVersion: 3 },
    );
    expect(adjusted).toMatchObject({ status: 'UPDATED', currentVersion: 4, record: { confidence: 1 } });

    const accessed = await gateway.longTermMemoryStore.mutateLongTermMemory(
      {
        ...owner,
        memoryId: saved.memoryId,
        lastAccessTime: at(1234),
      },
      { expectedVersion: 4 },
    );
    expect(accessed).toMatchObject({ status: 'UPDATED', currentVersion: 5, record: { lastAccessedAt: 1234 } });

    const pinned = await gateway.longTermMemoryStore.mutateLongTermMemory(
      {
        ...owner,
        memoryId: saved.memoryId,
        isPinned: true,
      },
      { expectedVersion: 5 },
    );
    expect(pinned).toMatchObject({ status: 'UPDATED', currentVersion: 6, record: { isPinned: true } });

    await expect(
      gateway.longTermMemoryStore.mutateLongTermMemory(
        {
          ...owner,
          memoryId: saved.memoryId,
          isPinned: false,
        },
        { expectedVersion: 5 },
      ),
    ).resolves.toMatchObject({ status: 'VERSION_CONFLICT', currentVersion: 6 });
    await expect(
      gateway.longTermMemoryStore.mutateLongTermMemory({
        ...owner,
        memoryId: brand<string, 'LongTermMemoryId'>('missing-memory'),
        isPinned: true,
      }),
    ).resolves.toMatchObject({ status: 'NOT_FOUND' });

    for (const invalid of [
      { ...owner, memoryId: saved.memoryId },
      { ...owner, memoryId: saved.memoryId, delta: 0.1, isPinned: true },
      { ...owner, memoryId: saved.memoryId, archiveReason: 'orphan' },
      { ...owner, memoryId: saved.memoryId, targetState: 'ACTIVE', archiveReason: 'not_archived' },
      { ...owner, memoryId: saved.memoryId, delta: 1.1 },
      { ...owner, memoryId: saved.memoryId, lastAccessTime: -1 },
    ]) {
      await expect(gateway.longTermMemoryStore.mutateLongTermMemory(invalid as never)).resolves.toMatchObject({ category: 'VALIDATION' });
    }
    await expect(
      gateway.longTermMemoryStore.mutateLongTermMemory(
        {
          ...owner,
          memoryId: saved.memoryId,
          delta: 0.1,
        },
        { idempotencyKey: 'unsupported-mutation-key' } as never,
      ),
    ).resolves.toMatchObject({ code: 'LTM_WRITE_INVALID' });
  });

  it('isolates identical memory ids and FTS rows by memory instance', async () => {
    const gateway = createTestGatewayStores();
    const owner = scope('instance');
    const memoryId = brand<string, 'LongTermMemoryId'>('shared-id-across-instances');

    const first = expectRecord(
      await gateway.longTermMemoryStore.saveLongTermMemory(
        saveRequest(owner, {
          memoryId,
          memoryInstance: 'instance-a',
          briefIndex: 'Instance A BGP timer',
          content: 'instance-a unique value',
        }),
      ),
    );
    const second = expectRecord(
      await gateway.longTermMemoryStore.saveLongTermMemory(
        saveRequest(owner, {
          memoryId,
          memoryInstance: 'instance-b',
          briefIndex: 'Instance B BGP timer',
          content: 'instance-b unique value',
        }),
      ),
    );

    expect(first.memoryId).toBe(second.memoryId);
    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...owner, memoryId, memoryInstance: 'instance-a' })).resolves.toMatchObject({
      memoryInstance: 'instance-a',
      content: 'instance-a unique value',
    });
    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...owner, memoryId, memoryInstance: 'instance-b' })).resolves.toMatchObject({
      memoryInstance: 'instance-b',
      content: 'instance-b unique value',
    });

    const searchA = await gateway.longTermMemoryRetriever.searchLongTermMemory({
      ...owner,
      memoryInstance: 'instance-a',
      queryText: 'unique value',
      minConfidence: 0,
      limit: 10,
      offset: 0,
    });
    const searchB = await gateway.longTermMemoryRetriever.searchLongTermMemory({
      ...owner,
      memoryInstance: 'instance-b',
      queryText: 'unique value',
      minConfidence: 0,
      limit: 10,
      offset: 0,
    });
    expect(searchA).toMatchObject({ total: 1, items: [{ summary: { content: 'instance-a unique value' } }] });
    expect(searchB).toMatchObject({ total: 1, items: [{ summary: { content: 'instance-b unique value' } }] });
  });

  it('implements L1 search and L2 detail with YAML page shape and documented side effects', async () => {
    const gateway = createTestGatewayStores();
    const owner = scope('retriever');
    const saved = expectRecord(
      await gateway.longTermMemoryStore.saveLongTermMemory(
        saveRequest(owner, {
          briefIndex: 'BGP hold timer',
          content: 'BGP hold timer is 90 seconds',
          confidence: 0.9,
        }),
      ),
    );

    const result = await gateway.longTermMemoryRetriever.searchLongTermMemory({
      ...owner,
      queryText: 'hold timer',
      memoryType: 'FACTUAL',
      minConfidence: 0.3,
      labels: ['bgp'],
      limit: 10,
      offset: 0,
    });
    expect(result).toMatchObject({
      total: 1,
      limit: 10,
      offset: 0,
      items: [
        {
          summary: { memoryId: saved.memoryId, content: 'BGP hold timer is 90 seconds' },
          score: expect.any(Number),
          relevanceScore: expect.any(Number),
        },
      ],
    });
    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...owner, memoryId: saved.memoryId })).resolves.toMatchObject({
      recallCount: 1,
      accessCount: 0,
      version: 1,
    });

    const detail = await gateway.longTermMemoryRetriever.getLongTermMemoryDetail({ ...owner, memoryId: saved.memoryId });
    expect(detail).toMatchObject({ memoryId: saved.memoryId, recallCount: 1, accessCount: 1, version: 2, lastAccessedAt: expect.any(Number) });
    await expect(
      gateway.longTermMemoryRetriever.searchLongTermMemory({
        ...owner,
        queryText: 'hold timer',
        minConfidence: 0,
        limit: 10,
        offset: 1,
      }),
    ).resolves.toMatchObject({ code: 'LTM_QUERY_INVALID' });
  });

  it('implements publish, cross-owner shared list, copy, and unpublish without owner-scope leakage', async () => {
    const gateway = createTestGatewayStores();
    const publisher = scope('sharing', 'publisher');
    const consumer = { ...publisher, subjectId: brand<string, 'SubjectId'>('consumer') };
    const source = expectRecord(
      await gateway.longTermMemoryStore.saveLongTermMemory(
        saveRequest(publisher, {
          briefIndex: 'Shared BGP procedure',
          memoryType: 'PROCEDURAL',
          content: 'Inspect BGP neighbor state',
        }),
      ),
    );

    const published = await gateway.longTermMemorySharing.publishLongTermMemory({ ...publisher, memoryId: source.memoryId });
    expect(published).toMatchObject({
      sourceMemoryId: source.memoryId,
      ownerSubjectId: publisher.subjectId,
      publishedMemory: { sharingState: 'SHARED', sourceMemoryId: source.memoryId, subjectId: publisher.subjectId },
    });
    if ('code' in published) {
      throw new Error(published.code);
    }
    const replayed = await gateway.longTermMemorySharing.publishLongTermMemory({ ...publisher, memoryId: source.memoryId });
    expect(replayed).toEqual(published);
    const secondSource = expectRecord(
      await gateway.longTermMemoryStore.saveLongTermMemory(
        saveRequest(publisher, {
          briefIndex: 'Shared OSPF procedure',
          memoryType: 'PROCEDURAL',
          content: 'Inspect OSPF neighbor state',
          labels: ['ospf', 'network'],
        }),
      ),
    );
    const secondPublished = await gateway.longTermMemorySharing.publishLongTermMemory({ ...publisher, memoryId: secondSource.memoryId });
    if ('code' in secondPublished) {
      throw new Error(secondPublished.code);
    }

    const sharedPage = await gateway.longTermMemorySharing.listPublishedLongTermMemory({
      ...consumer,
      queryText: 'BGP',
      memoryType: 'PROCEDURAL',
      limit: 10,
      offset: 0,
    });
    expect(sharedPage).toMatchObject({
      total: 1,
      items: [{ memoryId: published.publishedMemory.memoryId, sourceMemoryId: source.memoryId, ownerSubjectId: publisher.subjectId }],
    });
    await expect(
      gateway.longTermMemorySharing.listPublishedLongTermMemory({
        ...consumer,
        tenantId: brand<string, 'TenantId'>('other-tenant'),
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({ total: 0, items: [] });
    await expect(
      gateway.longTermMemorySharing.listPublishedLongTermMemory({
        ...consumer,
        agentId: brand<string, 'AgentId'>('other-agent'),
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({ total: 0, items: [] });

    await expect(
      gateway.longTermMemoryStore.mutateLongTermMemory({
        ...publisher,
        memoryId: published.publishedMemory.memoryId,
        isPinned: true,
      }),
    ).resolves.toMatchObject({ status: 'NOT_FOUND' });
    await expect(
      gateway.longTermMemoryStore.deleteLongTermMemory({
        ...publisher,
        memoryId: published.publishedMemory.memoryId,
      }),
    ).resolves.toMatchObject({ code: 'LTM_MEMORY_NOT_FOUND' });

    const copied = await gateway.longTermMemorySharing.copyPublishedMemory({
      ...consumer,
      memoryIds: [secondPublished.publishedMemory.memoryId, published.publishedMemory.memoryId],
    });
    expect(copied).toMatchObject({
      results: [
        { sourceMemoryId: secondPublished.publishedMemory.memoryId, record: { sharingState: 'FORK', subjectId: consumer.subjectId } },
        { sourceMemoryId: published.publishedMemory.memoryId, record: { sharingState: 'FORK', subjectId: consumer.subjectId } },
      ],
    });
    if ('code' in copied) {
      throw new Error(copied.code);
    }
    const forkId = copied.results[1]!.memoryId;

    const beforeFailedCopy = await gateway.longTermMemoryStore.listLongTermMemory({ ...consumer, state: 'ACTIVE', limit: 100, offset: 0 });
    await expect(
      gateway.longTermMemorySharing.copyPublishedMemory({
        ...consumer,
        memoryIds: [published.publishedMemory.memoryId, brand<string, 'LongTermMemoryId'>('missing-shared')],
      }),
    ).resolves.toMatchObject({ code: 'LTM_MEMORY_NOT_FOUND' });
    await expect(
      gateway.longTermMemorySharing.copyPublishedMemory({
        ...consumer,
        memoryIds: [source.memoryId],
      }),
    ).resolves.toMatchObject({ code: 'LTM_MEMORY_NOT_FOUND' });
    await expect(
      gateway.longTermMemorySharing.copyPublishedMemory({
        ...consumer,
        tenantId: brand<string, 'TenantId'>('other-tenant'),
        memoryIds: [published.publishedMemory.memoryId],
      }),
    ).resolves.toMatchObject({ code: 'LTM_MEMORY_NOT_FOUND' });
    await expect(
      gateway.longTermMemorySharing.copyPublishedMemory({
        ...consumer,
        memoryIds: Array.from({ length: 101 }, () => published.publishedMemory.memoryId),
      }),
    ).resolves.toMatchObject({ code: 'LTM_WRITE_INVALID' });
    const afterFailedCopy = await gateway.longTermMemoryStore.listLongTermMemory({ ...consumer, state: 'ACTIVE', limit: 100, offset: 0 });
    expect(afterFailedCopy).toEqual(beforeFailedCopy);

    await expect(
      gateway.longTermMemorySharing.unpublishLongTermMemory({
        ...consumer,
        memoryId: published.publishedMemory.memoryId,
      }),
    ).resolves.toMatchObject({ code: 'LTM_MEMORY_NOT_FOUND' });
    await expect(
      gateway.longTermMemorySharing.unpublishLongTermMemory({
        ...publisher,
        memoryId: published.publishedMemory.memoryId,
      }),
    ).resolves.toEqual({ memoryId: published.publishedMemory.memoryId });
    await expect(gateway.longTermMemoryStore.getLongTermMemory({ ...consumer, memoryId: forkId })).resolves.toMatchObject({
      sharingState: 'FORK',
      sourceMemoryId: published.publishedMemory.memoryId,
    });
  });

  it('falls back to literal search when FTS is unavailable and rebuilds the projection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nextagent-ltm-v2-fts-'));
    const sqliteFile = join(dir, 'memory.sqlite');
    const diagnostics: object[] = [];
    const loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        error() {},
        warn(fields: object) {
          diagnostics.push(fields);
        },
        info() {},
        debug() {},
      }),
    });
    const gateway = createSqliteGatewayStores({ sqliteFile });
    const owner = scope('fts');
    try {
      await gateway.longTermMemoryStore.saveLongTermMemory(
        saveRequest(owner, {
          briefIndex: 'Literal fallback BGP memory',
          content: 'literal fallback remains available',
        }),
      );
      const db = new DatabaseSync(sqliteFile);
      db.exec('DROP TABLE long_term_memory_fts;');
      db.close();
      const query = { ...owner, queryText: 'fallback', minConfidence: 0, limit: 10, offset: 0 };

      await expect(gateway.longTermMemoryRetriever.searchLongTermMemory(query)).resolves.toMatchObject({
        total: 1,
        items: [{ summary: { content: 'literal fallback remains available' } }],
      });
      expect(diagnostics).toEqual([expect.objectContaining({ reasonCode: 'LTM_FTS_UNAVAILABLE', degradedMode: 'literal_match' })]);
      await expect(gateway.longTermMemoryRetriever.searchLongTermMemory(query)).resolves.toMatchObject({
        total: 1,
        items: [{ summary: { content: 'literal fallback remains available' } }],
      });
      expect(diagnostics).toHaveLength(1);
    } finally {
      gateway.close();
      loggerBinding.unbind();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps closed SQLite failures to safe storage errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nextagent-ltm-v2-storage-error-'));
    const gateway = createSqliteGatewayStores({ sqliteFile: join(dir, 'memory.sqlite') });
    const owner = scope('storage-error');
    gateway.close();

    try {
      await expect(gateway.longTermMemoryStore.saveLongTermMemory(saveRequest(owner))).resolves.toMatchObject({
        code: 'LTM_STORAGE_UNAVAILABLE',
        category: 'UNAVAILABLE',
        retryable: true,
      });
      await expect(gateway.longTermMemoryStore.listLongTermMemory({ ...owner, limit: 10, offset: 0 })).resolves.toMatchObject({
        code: 'LTM_STORAGE_UNAVAILABLE',
        category: 'UNAVAILABLE',
        retryable: true,
      });
      await expect(
        gateway.longTermMemoryRetriever.searchLongTermMemory({
          ...owner,
          queryText: 'BGP',
          minConfidence: 0,
          limit: 10,
          offset: 0,
        }),
      ).resolves.toMatchObject({ code: 'LTM_STORAGE_UNAVAILABLE', category: 'UNAVAILABLE', retryable: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates the pre-v2 SQLite table and applies canonical defaults to retained rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nextagent-ltm-v2-migration-'));
    const sqliteFile = join(dir, 'memory.sqlite');
    const legacy = new DatabaseSync(sqliteFile);
    legacy.exec(`
      CREATE TABLE long_term_memory (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        long_term_memory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        category TEXT NOT NULL,
        confidence REAL NOT NULL,
        state TEXT NOT NULL,
        brief_index TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        access_count INTEGER NOT NULL,
        recall_count INTEGER NOT NULL,
        extraction_count INTEGER NOT NULL,
        last_accessed_at INTEGER,
        archived_at INTEGER,
        archive_reason TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        source_trace_session_id TEXT NOT NULL,
        source_trace_request_id TEXT,
        source_trace_extraction_cycle_id TEXT,
        source_trace_json TEXT NOT NULL,
        content_json TEXT NOT NULL,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, long_term_memory_id)
      );
      CREATE INDEX idx_ltm_list
        ON long_term_memory(tenant_id, subject_id, agent_id, state, created_at DESC, long_term_memory_id ASC);
      CREATE INDEX idx_ltm_state
        ON long_term_memory(tenant_id, subject_id, agent_id, state, confidence DESC);
      CREATE UNIQUE INDEX idx_ltm_idempotency
        ON long_term_memory(tenant_id, subject_id, agent_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      INSERT INTO long_term_memory VALUES (
        'tenant-migration', 'subject-migration', 'agent-migration', 'memory-migration',
        1, 'FACTUAL', 0.8, 'ACTIVE', 'Migrated BGP fact', '["migration"]',
        0, 0, 0, NULL, NULL, NULL, 0,
        'session-migration', NULL, NULL, '{"sessionId":"session-migration"}',
        '{"category":"FACTUAL","subject":"BGP","claim":"Migrated"}', NULL, 100, 100
      );
    `);
    legacy.close();

    let migrated: LocalGatewayStores | undefined;
    try {
      migrated = createSqliteGatewayStores({ sqliteFile });
      await expect(
        migrated.longTermMemoryStore.getLongTermMemory({
          tenantId: brand<string, 'TenantId'>('tenant-migration'),
          subjectId: brand<string, 'SubjectId'>('subject-migration'),
          agentId: brand<string, 'AgentId'>('agent-migration'),
          memoryId: brand<string, 'LongTermMemoryId'>('memory-migration'),
        }),
      ).resolves.toMatchObject({
        memoryInstance: 'defaultInstance',
        knowledgeSourceType: 'LEARNED',
        sharingState: 'PRIVATE',
        memoryType: 'FACTUAL',
        content: '{"category":"FACTUAL","subject":"BGP","claim":"Migrated"}',
      });
      const migratedOwner = scope('migration');
      const migratedMemoryId = brand<string, 'LongTermMemoryId'>('memory-migration');
      await expect(
        migrated.longTermMemoryStore.saveLongTermMemory(
          saveRequest(migratedOwner, {
            memoryId: migratedMemoryId,
            memoryInstance: 'secondary',
            content: 'secondary instance',
          }),
        ),
      ).resolves.toMatchObject({ memoryInstance: 'secondary', content: 'secondary instance' });
      await expect(
        migrated.longTermMemoryStore.getLongTermMemory({
          ...migratedOwner,
          memoryId: migratedMemoryId,
        }),
      ).resolves.toMatchObject({ memoryInstance: 'defaultInstance', briefIndex: 'Migrated BGP fact' });
    } finally {
      migrated?.close?.();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported legacy request members at the runtime boundary', async () => {
    const gateway = createTestGatewayStores();
    const owner = scope('legacy');

    await expect(
      gateway.longTermMemoryStore.saveLongTermMemory({
        ...saveRequest(owner),
        category: 'FACTUAL',
      } as never),
    ).resolves.toMatchObject({ code: 'LTM_WRITE_INVALID' });
    await expect(
      gateway.longTermMemoryStore.mutateLongTermMemory({
        ...owner,
        memoryId: brand<string, 'LongTermMemoryId'>('legacy-memory'),
        mutation: { kind: 'PIN', isPinned: true },
      } as never),
    ).resolves.toMatchObject({ code: 'LTM_WRITE_INVALID' });
    await expect(
      gateway.longTermMemoryStore.getLongTermMemory({
        ...owner,
        memoryId: brand<string, 'LongTermMemoryId'>('legacy-memory'),
        userId: 'untrusted-user',
      } as never),
    ).resolves.toMatchObject({ code: 'LTM_QUERY_INVALID' });
    await expect(
      gateway.longTermMemoryRetriever.searchLongTermMemory({
        ...owner,
        queryText: 'BGP',
        offset: 0,
      } as never),
    ).resolves.toMatchObject({ code: 'LTM_QUERY_INVALID' });
    await expect(
      gateway.longTermMemoryStore.saveLongTermMemory(saveRequest(owner), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('x'.repeat(129)),
      }),
    ).resolves.toMatchObject({ code: 'LTM_WRITE_INVALID' });
    await expect(
      gateway.longTermMemoryStore.listLongTermMemory({
        ...owner,
        agentId: brand<string, 'AgentId'>('invalid agent id'),
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({ code: 'LTM_QUERY_INVALID' });
    await expect(gateway.longTermMemoryStore.listLongTermMemory({ ...owner, limit: 101, offset: 0 })).resolves.toMatchObject({
      code: 'LTM_QUERY_INVALID',
    });
    await expect(gateway.longTermMemoryStore.listLongTermMemory({ ...owner, minConfidence: -0.1, limit: 10, offset: 0 })).resolves.toMatchObject({
      code: 'LTM_QUERY_INVALID',
    });
  });
});
