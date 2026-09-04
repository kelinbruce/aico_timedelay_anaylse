import { brand } from '@nextagent/agent-common';
import { createLocalGatewayProvider, createSqliteLongTermMemoryGatewayProvider } from '@nextagent/agent-platform-gateway-local';
import type { BlobStoreGateway, GatewayProviderCreateInput, LoadBlobRequest } from '@nextagent/agent-contracts/gateway';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createLocalGatewayProvider blobStore injection', () => {
  it('uses the externally injected blobStore when provided', async () => {
    const injected = stubBlobStore();
    const bindings = createLocalGatewayProvider('local-gateway', { blobStore: injected }).create(createInput());

    await expect(bindings.sqliteStores?.blobs.blobExists(blobRequest())).resolves.toBe('injected');
    await bindings.close?.();
  });

  it('falls back to the local filesystem blob store without injection', async () => {
    const bindings = createLocalGatewayProvider().create(createInput());

    await expect(bindings.sqliteStores?.blobs.blobExists(blobRequest())).resolves.toBe(false);
    await bindings.close?.();
  });
});

describe('createLocalGatewayProvider sandbox API policy', () => {
  it('projects the trusted API list into the selected local sandbox binding', async () => {
    const input = createInput();
    const bindings = createLocalGatewayProvider('local-gateway', {
      allowedApis: ['https://api.example.internal/v1/'],
    }).create({
      ...input,
      selectedEntries: [{ gatewayId: 'local-sandbox', adapterKind: 'sandbox', deploymentMode: 'LOCAL' }],
      runtime: {
        ...input.runtime,
        sandbox: { enabled: true, allowedExecutables: ['curl'], deniedExecutables: [] },
      },
    });

    const result = await bindings.sandbox?.execute({
      executionId: 'sandbox-api-policy',
      requestRunId: brand<string, 'RequestRunId'>('run-sandbox-api-policy'),
      tenantId: brand<string, 'TenantId'>('tenant-sandbox-api-policy'),
      subjectId: brand<string, 'SubjectId'>('subject-sandbox-api-policy'),
      executable: 'bash',
      command: 'curl',
      args: ['https://untrusted.example/v1/'],
      filesystem: { defaultCwd: input.runtime.paths.workspaceRoot, roots: [] },
      environment: {},
      timeoutMs: 1000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
    });

    expect(result?.safeError?.safeDetails).toEqual({ reason: 'network-target-not-allowed' });
    await bindings.close?.();
  });
});

describe('local long-term memory list search', () => {
  it('filters summary, content, and labels before pagination and treats LIKE wildcards literally', async () => {
    const input = createInput();
    const bindings = createSqliteLongTermMemoryGatewayProvider().create({
      ...input,
      selectedEntries: [{ gatewayId: 'local-long-term-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL' }],
    });
    const store = bindings.longTermMemory?.store;
    const retriever = bindings.longTermMemory?.retriever;
    if (store === undefined || retriever === undefined) {
      throw new Error('Long-term memory gateway is unavailable.');
    }
    const scope = {
      tenantId: brand<string, 'TenantId'>('tenant-search'),
      subjectId: brand<string, 'SubjectId'>('subject-search'),
      agentId: brand<string, 'AgentId'>('agent-search'),
    };
    const save = (briefIndex: string, content: string, labels: readonly string[] = []) =>
      store.manualSaveLongTermMemory({
        ...scope,
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'CONFIGURED',
        briefIndex,
        content,
        labels,
        confidence: 0.8,
      });

    const counted = await save('BGP neighbor alarm', 'Primary route diagnostic');
    if ('code' in counted) {
      throw new Error(counted.message);
    }
    await save('BGP neighbor recovery', 'Secondary route diagnostic');
    await save('Packet health', 'Packet-loss threshold exceeded');
    await save('Router inventory', 'Core device', ['edge_router']);
    await save('Literal marker 100%_safe', 'Wildcard verification');
    const archived = await save('BGP archived note', 'Historical route diagnostic');
    if ('code' in archived) {
      throw new Error(archived.message);
    }
    const mutation = await store.mutateLongTermMemory({
      ...scope,
      memoryId: archived.memoryId,
      targetState: 'ARCHIVED',
      archiveReason: 'USER_ARCHIVE',
    });
    if ('code' in mutation) {
      throw new Error(mutation.message);
    }

    const activeBpg = await store.listLongTermMemory({ ...scope, state: 'ACTIVE', queryText: 'BGP', limit: 1, offset: 0 });
    const archivedBpg = await store.listLongTermMemory({ ...scope, state: 'ARCHIVED', queryText: 'BGP', limit: 10, offset: 0 });
    const content = await store.listLongTermMemory({ ...scope, state: 'ACTIVE', queryText: 'packet-loss', limit: 10, offset: 0 });
    const labels = await store.listLongTermMemory({ ...scope, state: 'ACTIVE', queryText: 'edge_router', limit: 10, offset: 0 });
    const literalWildcard = await store.listLongTermMemory({ ...scope, state: 'ACTIVE', queryText: '%_', limit: 10, offset: 0 });
    const countedDetail = await retriever.getLongTermMemoryDetail({ ...scope, memoryId: counted.memoryId });
    if ('code' in countedDetail) {
      throw new Error(countedDetail.message);
    }
    const countedList = await store.listLongTermMemory({ ...scope, state: 'ACTIVE', queryText: 'Primary route diagnostic', limit: 10, offset: 0 });
    const countedAfterList = await store.getLongTermMemory({ ...scope, memoryId: counted.memoryId });
    if ('code' in countedAfterList) {
      throw new Error(countedAfterList.message);
    }

    expect(activeBpg).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect('items' in activeBpg ? activeBpg.items : []).toHaveLength(1);
    expect(archivedBpg).toMatchObject({ total: 1 });
    expect(content).toMatchObject({ total: 1 });
    expect(labels).toMatchObject({ total: 1 });
    expect(literalWildcard).toMatchObject({ total: 1 });
    expect(countedDetail.accessCount).toBe(1);
    expect('items' in countedList ? countedList.items[0]?.accessCount : undefined).toBe(1);
    expect(countedAfterList.accessCount).toBe(1);
    await bindings.close?.();
  });
});

describe('local long-term memory manual-save fields', () => {
  it('persists selected type and confidence on create and edit, and rejects invalid confidence', async () => {
    const input = createInput();
    const bindings = createSqliteLongTermMemoryGatewayProvider().create({
      ...input,
      selectedEntries: [{ gatewayId: 'local-long-term-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL' }],
    });
    const store = bindings.longTermMemory?.store;
    if (store === undefined) {
      throw new Error('Long-term memory gateway is unavailable.');
    }
    const scope = {
      tenantId: brand<string, 'TenantId'>('tenant-manual-fields'),
      subjectId: brand<string, 'SubjectId'>('subject-manual-fields'),
      agentId: brand<string, 'AgentId'>('agent-manual-fields'),
    };

    const created = await store.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Router model',
      content: 'The edge router is model X.',
      labels: [],
      confidence: 1,
    });
    if ('code' in created) {
      throw new Error(created.message);
    }
    expect(created).toMatchObject({ memoryType: 'FACTUAL', confidence: 1 });

    const edited = await store.manualSaveLongTermMemory({
      ...scope,
      memoryId: created.memoryId,
      memoryType: 'CONCEPTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Router role',
      content: 'The edge router provides access aggregation.',
      labels: [],
      confidence: 0.35,
    });
    expect(edited).toMatchObject({
      memoryId: created.memoryId,
      memoryType: 'CONCEPTUAL',
      confidence: 0.35,
    });

    await expect(
      store.manualSaveLongTermMemory({
        ...scope,
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'CONFIGURED',
        briefIndex: 'Invalid confidence',
        content: 'This write must be rejected.',
        labels: [],
        confidence: 1.01,
      }),
    ).resolves.toMatchObject({
      code: 'LTM_WRITE_INVALID',
      category: 'VALIDATION',
    });
    await bindings.close?.();
  });
});

describe('local long-term memory shared-copy idempotency', () => {
  it('returns the existing fork on repeated copy without creating another memory', async () => {
    const input = createInput();
    const bindings = createSqliteLongTermMemoryGatewayProvider().create({
      ...input,
      selectedEntries: [{ gatewayId: 'local-long-term-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL' }],
    });
    const store = bindings.longTermMemory?.store;
    const sharing = bindings.longTermMemory?.sharing;
    if (store === undefined || sharing === undefined) {
      throw new Error('Long-term memory gateway is unavailable.');
    }
    const scope = {
      tenantId: brand<string, 'TenantId'>('tenant-copy'),
      subjectId: brand<string, 'SubjectId'>('subject-copy'),
      agentId: brand<string, 'AgentId'>('agent-copy'),
    };
    const source = await store.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Shared procedure',
      content: 'Use the approved procedure.',
      labels: ['shared'],
      confidence: 0.9,
    });
    if ('code' in source) {
      throw new Error(source.message);
    }
    const published = await sharing.publishLongTermMemory({ ...scope, memoryId: source.memoryId });
    if ('code' in published) {
      throw new Error(published.message);
    }

    const first = await sharing.copyPublishedMemory({
      ...scope,
      memoryIds: [published.publishedMemory.memoryId],
      memoryInstance: 'defaultInstance',
    });
    const repeated = await sharing.copyPublishedMemory({
      ...scope,
      memoryIds: [published.publishedMemory.memoryId],
      memoryInstance: 'defaultInstance',
    });
    if ('code' in first) {
      throw new Error(first.message);
    }
    if ('code' in repeated) {
      throw new Error(repeated.message);
    }

    expect(first.results).toHaveLength(1);
    expect(repeated.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({ copyStatus: 'COPIED' });
    expect(repeated.results[0]).toMatchObject({
      copyStatus: 'EXISTING',
      memoryId: first.results[0]?.memoryId,
      sourceMemoryId: published.publishedMemory.memoryId,
      record: {
        memoryId: first.results[0]?.memoryId,
        sharingState: 'FORK',
        sourceMemoryId: published.publishedMemory.memoryId,
      },
    });
    const archived = await store.mutateLongTermMemory({
      ...scope,
      memoryId: first.results[0]!.memoryId,
      targetState: 'ARCHIVED',
      archiveReason: 'USER_ARCHIVE',
    });
    if ('code' in archived) {
      throw new Error(archived.message);
    }
    const repeatedArchived = await sharing.copyPublishedMemory({
      ...scope,
      memoryIds: [published.publishedMemory.memoryId],
      memoryInstance: 'defaultInstance',
    });
    if ('code' in repeatedArchived) {
      throw new Error(repeatedArchived.message);
    }
    expect(repeatedArchived.results[0]).toMatchObject({
      copyStatus: 'EXISTING',
      memoryId: first.results[0]?.memoryId,
      record: { state: 'ARCHIVED' },
    });
    const active = await store.listLongTermMemory({ ...scope, state: 'ACTIVE', limit: 100, offset: 0 });
    const archivedForks = await store.listLongTermMemory({ ...scope, state: 'ARCHIVED', limit: 100, offset: 0 });
    expect(active).toMatchObject({ total: 1 });
    expect(archivedForks).toMatchObject({ total: 1 });
    expect('items' in archivedForks ? archivedForks.items.map((item) => item.memoryId) : []).toEqual([first.results[0]!.memoryId]);
    await bindings.close?.();
  });
});

describe('local long-term memory manual-save capacity', () => {
  it('shares configured quota across memory types, keeps it occupied after archive, and still permits edits', async () => {
    const input = createInput();
    const bindings = createSqliteLongTermMemoryGatewayProvider().create({
      ...input,
      selectedEntries: [{ gatewayId: 'local-long-term-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL' }],
    });
    const store = bindings.longTermMemory?.store;
    if (store === undefined) {
      throw new Error('Long-term memory gateway is unavailable.');
    }
    const scope = {
      tenantId: brand<string, 'TenantId'>('tenant-capacity'),
      subjectId: brand<string, 'SubjectId'>('subject-capacity'),
      agentId: brand<string, 'AgentId'>('agent-capacity'),
    };

    const saved = [];
    const configuredTypes = ['USER_CHARACTERISTICS', 'FACTUAL', 'CONCEPTUAL', 'PROCEDURAL'] as const;
    for (let index = 1; index <= 50; index += 1) {
      const result = await store.manualSaveLongTermMemory({
        ...scope,
        memoryType: configuredTypes[(index - 1) % configuredTypes.length]!,
        knowledgeSourceType: 'CONFIGURED',
        briefIndex: `Configured memory ${index}`,
        content: `Configured content ${index}`,
        labels: [],
        confidence: 1,
      });
      expect(result).not.toHaveProperty('code');
      if (!('code' in result)) {
        saved.push(result);
      }
    }

    const overflow = await store.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'CONCEPTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Configured memory 51',
      content: 'Configured content 51',
      labels: [],
      confidence: 1,
    });
    expect(overflow).toMatchObject({ code: 'LTM_WRITE_INVALID', category: 'VALIDATION' });

    const first = saved[0];
    if (first === undefined) {
      throw new Error('Expected the first configured memory.');
    }
    const edited = await store.manualSaveLongTermMemory({
      ...scope,
      memoryId: first.memoryId,
      memoryType: first.memoryType,
      knowledgeSourceType: first.knowledgeSourceType,
      briefIndex: 'Updated user characteristic',
      content: first.content,
      labels: first.labels,
      confidence: 0.4,
    });
    expect(edited).toMatchObject({
      memoryId: first.memoryId,
      briefIndex: 'Updated user characteristic',
      confidence: 0.4,
    });

    const archived = await store.mutateLongTermMemory({
      ...scope,
      memoryId: first.memoryId,
      targetState: 'ARCHIVED',
      archiveReason: 'USER_ARCHIVE',
    });
    expect(archived).not.toHaveProperty('code');
    const replacement = await store.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Replacement configured memory',
      content: 'Replacement configured content',
      labels: [],
      confidence: 1,
    });
    expect(replacement).toMatchObject({ code: 'LTM_WRITE_INVALID', category: 'VALIDATION' });

    const restored = await store.mutateLongTermMemory({
      ...scope,
      memoryId: first.memoryId,
      targetState: 'ACTIVE',
    });
    expect(restored).not.toHaveProperty('code');

    const learned = await store.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'USER_CHARACTERISTICS',
      knowledgeSourceType: 'LEARNED',
      briefIndex: 'Learned user characteristic',
      content: 'Learned preference',
      labels: [],
      confidence: 0.7,
    });
    expect(learned).not.toHaveProperty('code');

    const deleted = await store.deleteLongTermMemory({
      ...scope,
      memoryId: first.memoryId,
    });
    expect(deleted).toMatchObject({ memoryId: first.memoryId });
    const replacementAfterDelete = await store.manualSaveLongTermMemory({
      ...scope,
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'Replacement configured memory',
      content: 'Replacement configured content',
      labels: [],
      confidence: 1,
    });
    expect(replacementAfterDelete).not.toHaveProperty('code');

    const listed = await store.listLongTermMemory({
      ...scope,
      knowledgeSourceType: 'CONFIGURED',
      state: 'ACTIVE',
      limit: 100,
      offset: 0,
    });
    expect(listed).toMatchObject({ total: 50 });
    await bindings.close?.();
  });
});

function stubBlobStore(): BlobStoreGateway {
  return { blobExists: async () => 'injected' } as unknown as BlobStoreGateway;
}

function blobRequest(): LoadBlobRequest {
  return { tenantId: 'tenant', subjectId: 'subject', blobRef: 'blob-missing' } as LoadBlobRequest;
}

function createInput(): GatewayProviderCreateInput {
  const root = mkdtempSync(join(tmpdir(), 'local-gateway-provider-'));
  roots.push(root);
  return {
    selectedEntries: [{ gatewayId: 'local', adapterKind: 'sqlite', deploymentMode: 'LOCAL' }],
    runtime: {
      paths: {
        workingMemorySqliteFile: join(root, 'working-memory.sqlite'),
        longTermMemorySqliteFile: join(root, 'long-term-memory.sqlite'),
        sqliteFile: join(root, 'app.sqlite'),
        workspaceRoot: join(root, 'workspace'),
        logDirectory: join(root, 'logs'),
        runtimeWorkspaceRoot: join(root, 'runtime-workspace'),
      },
      sandbox: { enabled: false, deniedExecutables: [] },
    },
  };
}
