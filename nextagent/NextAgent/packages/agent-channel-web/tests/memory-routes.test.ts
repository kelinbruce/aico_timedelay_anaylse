import { brand, type SafeError } from '@nextagent/agent-common';
import { registerMemoryRoutes } from '@nextagent/agent-channel-web';
import '../src/routes/fastify-oplog.js';
import type {
  LongTermMemoryManagementPort,
  LongTermMemoryManagementView,
  LongTermMemorySummaryManagementView,
} from '@nextagent/agent-contracts/channel';
import Fastify, { type FastifyRequest } from 'fastify';
import { request as httpRequest } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

const BASE = '/api/v1/memory/long-term-mem';
const trustedIdentity = {
  tenantId: brand<string, 'TenantId'>('trusted-tenant'),
  subjectId: brand<string, 'SubjectId'>('trusted-subject'),
  displayName: 'Trusted User',
};
const trustedScope = {
  identityContext: trustedIdentity,
  agentId: brand<string, 'AgentId'>('trusted-agent'),
};
const memoryId = brand<string, 'LongTermMemoryId'>('memory-1');
const sourceMemoryId = brand<string, 'LongTermMemoryId'>('source-memory-1');
const now = brand<number, 'EpochMillis'>(100);

const view: LongTermMemoryManagementView = {
  memoryId,
  memoryInstance: 'defaultInstance',
  memoryType: 'PROCEDURAL',
  knowledgeSourceType: 'LEARNED',
  sharingState: 'PRIVATE',
  state: 'ACTIVE',
  briefIndex: 'Inspect BGP neighbor state',
  content: 'Run the approved BGP diagnostic procedure.',
  labels: ['bgp'],
  confidence: 0.9,
  version: 2,
  accessCount: 1,
  recallCount: 3,
  extractionCount: 1,
  lastAccessedAt: now,
  archivedAt: brand<number, 'EpochMillis'>(0),
  archiveReason: '',
  isPinned: false,
  source: 'manual',
  createTime: now,
  updateTime: now,
};

const summary: LongTermMemorySummaryManagementView = {
  memoryId,
  memoryType: view.memoryType,
  knowledgeSourceType: view.knowledgeSourceType,
  state: view.state,
  briefIndex: view.briefIndex,
  content: view.content,
  labels: view.labels,
  confidence: view.confidence,
  isPinned: view.isPinned,
  accessCount: view.accessCount,
  createTime: view.createTime,
  updateTime: view.updateTime,
  version: view.version,
};

describe('long-term memory Web routes', () => {
  it('declares operation logs for memory writes and attaches the trusted identity', async () => {
    const management = createManagementPort();
    const operationLogs: Array<{
      readonly prefix: string;
      readonly level: 'MINOR' | 'RISK';
      readonly detailParams?: string[];
      readonly identity?: typeof trustedIdentity | undefined;
    }> = [];
    const app = Fastify();
    app.addHook('onResponse', async (request) => {
      const opLog = request.routeOptions.config.opLog;
      if (opLog !== undefined) {
        operationLogs.push({
          ...opLog,
          identity: (request as FastifyRequest & { opLogIdentity?: typeof trustedIdentity }).opLogIdentity,
        });
      }
    });
    registerMemoryRoutes(app, {
      management,
      identityResolver: () => trustedIdentity,
      defaultAgentId: trustedScope.agentId,
    });
    await app.ready();

    await Promise.all([
      app.inject({ method: 'POST', url: BASE, payload: savePayload() }),
      app.inject({ method: 'POST', url: `${BASE}/batch`, payload: { items: [savePayload()] } }),
      app.inject({ method: 'POST', url: `${BASE}/manual`, payload: { ...savePayload(), source: undefined } }),
      app.inject({ method: 'POST', url: `${BASE}/shared/copy`, payload: { memoryIds: [memoryId] } }),
      app.inject({ method: 'DELETE', url: `${BASE}/${memoryId}` }),
      app.inject({ method: 'PATCH', url: `${BASE}/${memoryId}`, payload: { isPinned: true } }),
      app.inject({ method: 'POST', url: `${BASE}/${memoryId}/publish`, payload: {} }),
      app.inject({ method: 'POST', url: `${BASE}/${memoryId}/unpublish`, payload: {} }),
    ]);

    expect(operationLogs).toEqual(
      expect.arrayContaining([
        { prefix: 'MemoryController.saveLongTermMemory', level: 'MINOR', identity: trustedIdentity },
        { prefix: 'MemoryController.batchCreateLongTermMemory', level: 'MINOR', identity: trustedIdentity },
        { prefix: 'MemoryController.manualSaveLongTermMemory', level: 'MINOR', identity: trustedIdentity },
        { prefix: 'MemoryController.copyPublishedMemory', level: 'MINOR', identity: trustedIdentity },
        {
          prefix: 'MemoryController.deleteLongTermMemory',
          level: 'RISK',
          detailParams: ['params.memoryId'],
          identity: trustedIdentity,
        },
        {
          prefix: 'MemoryController.mutateLongTermMemory',
          level: 'MINOR',
          detailParams: ['params.memoryId'],
          identity: trustedIdentity,
        },
        {
          prefix: 'MemoryController.publishLongTermMemory',
          level: 'MINOR',
          detailParams: ['params.memoryId'],
          identity: trustedIdentity,
        },
        {
          prefix: 'MemoryController.unpublishLongTermMemory',
          level: 'MINOR',
          detailParams: ['params.memoryId'],
          identity: trustedIdentity,
        },
      ]),
    );
    expect(operationLogs).toHaveLength(8);
    await app.close();
  });

  it('delegates all 13 routes through the management port and preserves REST projection', async () => {
    const management = createManagementPort();
    const app = await createApp(management);

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: `${BASE}?queryText=BGP&limit=20&offset=0` }),
      app.inject({ method: 'POST', url: BASE, payload: savePayload() }),
      app.inject({ method: 'POST', url: `${BASE}/batch`, payload: { items: [savePayload()] } }),
      app.inject({ method: 'POST', url: `${BASE}/manual`, payload: { ...savePayload(), source: undefined } }),
      app.inject({ method: 'POST', url: `${BASE}/search`, payload: { queryText: 'BGP', minConfidence: 0.2, limit: 10, offset: 0 } }),
      app.inject({ method: 'GET', url: `${BASE}/shared?queryText=BGP&limit=10&offset=0` }),
      app.inject({ method: 'POST', url: `${BASE}/shared/copy`, payload: { memoryIds: [memoryId], reasonCode: 'COPY' } }),
      app.inject({ method: 'GET', url: `${BASE}/${memoryId}/record` }),
      app.inject({ method: 'GET', url: `${BASE}/${memoryId}` }),
      app.inject({ method: 'DELETE', url: `${BASE}/${memoryId}?reasonCode=USER_DELETE` }),
      app.inject({ method: 'PATCH', url: `${BASE}/${memoryId}`, payload: { targetState: 'ARCHIVED', archiveReason: 'STALE', expectedVersion: 2 } }),
      app.inject({ method: 'POST', url: `${BASE}/${memoryId}/publish`, payload: { reasonCode: 'TEAM_SHARE' } }),
      app.inject({ method: 'POST', url: `${BASE}/${memoryId}/unpublish`, payload: {} }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual(Array.from({ length: 13 }, () => 200));
    expect(responses.map((response) => response.json().errorMsg)).toEqual(Array.from({ length: 13 }, () => 'SUCCESS'));
    for (const method of Object.values(management)) {
      expect(method).toHaveBeenCalledOnce();
      expect(method).toHaveBeenCalledWith(expect.objectContaining(trustedScope), expect.any(AbortSignal));
    }

    const saved = responses[1]!.json().data;
    expect(saved).toMatchObject({
      memoryId,
      tenantId: trustedIdentity.tenantId,
      userId: trustedIdentity.subjectId,
      agentId: trustedScope.agentId,
      content: view.content,
    });
    expect(saved).not.toHaveProperty('subjectId');
    expect(saved).not.toHaveProperty('displayName');
    expect(responses[0]!.json().data.items[0]).toMatchObject({ accessCount: 1 });
    expect(responses[6]!.json().data[0].record).toMatchObject({
      tenantId: trustedIdentity.tenantId,
      userId: trustedIdentity.subjectId,
      agentId: trustedScope.agentId,
    });
    expect(responses[6]!.json().data[0].copyStatus).toBe('COPIED');
    expect(Array.isArray(responses[6]!.json().data)).toBe(true);
    expect(responses[5]!.json().data.items[0]).toMatchObject({ ownerUserId: 'publisher-subject', ownerUserName: 'Publisher Alice' });
    expect(management.mutateLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({ writeOptions: { expectedVersion: 2 } }),
      expect.any(AbortSignal),
    );
    expect(management.listLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({ queryText: 'BGP', limit: 20, offset: 0 }),
      expect.any(AbortSignal),
    );
    expect(management.listPublishedLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({ queryText: 'BGP', limit: 10, offset: 0 }),
      expect.any(AbortSignal),
    );
    await app.close();
  });

  it('uses the shared Web request identity resolver for memory publishing', async () => {
    const management = createManagementPort();
    const hostIdentity = {
      tenantId: brand<string, 'TenantId'>('host-tenant-7'),
      subjectId: brand<string, 'SubjectId'>('host-user-42'),
      displayName: '真实宿主用户',
    };
    const identityResolver = vi.fn(() => hostIdentity);
    const app = await createApp(management, identityResolver);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${memoryId}/publish`,
      payload: { memoryInstance: 'defaultInstance', reasonCode: 'user_publish' },
    });

    expect(response.statusCode).toBe(200);
    expect(identityResolver).toHaveBeenCalledOnce();
    expect(management.publishLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext: hostIdentity,
        agentId: trustedScope.agentId,
        memoryId,
        memoryInstance: 'defaultInstance',
        reasonCode: 'user_publish',
      }),
      expect.any(AbortSignal),
    );
    const command = vi.mocked(management.publishLongTermMemory).mock.calls[0]?.[0];
    expect(command).not.toHaveProperty('tenantId');
    expect(command).not.toHaveProperty('userId');
    expect(command).not.toHaveProperty('subjectId');
    expect(command).not.toHaveProperty('displayName');
    await app.close();
  });

  it('accepts empty labels and rejects invalid manual-save bounds as 400 before invoking the port', async () => {
    const management = createManagementPort();
    const app = await createApp(management);
    const valid = {
      memoryType: 'PROCEDURAL',
      knowledgeSourceType: 'CONFIGURED',
      briefIndex: 'BGP maintenance procedure',
      content: 'Use the approved maintenance workflow.',
      labels: [] as string[],
      confidence: 0.8,
    };

    const accepted = await app.inject({ method: 'POST', url: `${BASE}/manual`, payload: valid });
    expect(accepted.statusCode).toBe(200);
    expect(management.manualSaveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({ memoryType: 'PROCEDURAL', labels: [], confidence: 0.8 }),
      expect.any(AbortSignal),
    );

    vi.mocked(management.manualSaveLongTermMemory).mockClear();
    const invalidPayloads = [
      { ...valid, labels: Array.from({ length: 11 }, (_, index) => `label-${index}`) },
      { ...valid, briefIndex: '' },
      { ...valid, briefIndex: 'a'.repeat(2049) },
      { ...valid, content: '' },
      { ...valid, content: 'a'.repeat(4001) },
      { ...valid, labels: ['a'.repeat(257)] },
      { ...valid, confidence: -0.01 },
      { ...valid, confidence: 1.01 },
      { ...valid, confidence: undefined },
    ];

    for (const [index, payload] of invalidPayloads.entries()) {
      const response = await app.inject({ method: 'POST', url: `${BASE}/manual`, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'LTM_QUERY_INVALID', retryable: false });
      if (index === 0) {
        expect(response.json().message).toBe('At most 10 labels are allowed.');
      }
    }
    expect(management.manualSaveLongTermMemory).not.toHaveBeenCalled();
    await app.close();
  });

  it('restores an archived memory without an archive reason', async () => {
    const management = createManagementPort();
    const app = await createApp(management);

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${memoryId}`,
      payload: { targetState: 'ACTIVE', expectedVersion: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(management.mutateLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'ACTIVE',
        writeOptions: { expectedVersion: 2 },
      }),
      expect.any(AbortSignal),
    );
    expect(vi.mocked(management.mutateLongTermMemory).mock.calls[0]?.[0]).not.toHaveProperty('archiveReason');
    await app.close();
  });

  it('accepts 128-code-point memory queries and rejects longer queries before invoking the port', async () => {
    const management = createManagementPort();
    const app = await createApp(management);
    const acceptedQuery = '😀'.repeat(128);
    const rejectedQuery = `${acceptedQuery}x`;
    const encodedAcceptedQuery = encodeURIComponent(acceptedQuery);
    const encodedRejectedQuery = encodeURIComponent(rejectedQuery);

    const acceptedResponses = await Promise.all([
      app.inject({ method: 'GET', url: `${BASE}?queryText=${encodedAcceptedQuery}` }),
      app.inject({ method: 'POST', url: `${BASE}/search`, payload: { queryText: acceptedQuery } }),
      app.inject({ method: 'GET', url: `${BASE}/shared?queryText=${encodedAcceptedQuery}` }),
    ]);
    expect(acceptedResponses.map((response) => response.statusCode)).toEqual([200, 200, 200]);

    vi.mocked(management.listLongTermMemory).mockClear();
    vi.mocked(management.searchLongTermMemory).mockClear();
    vi.mocked(management.listPublishedLongTermMemory).mockClear();

    const rejectedResponses = await Promise.all([
      app.inject({ method: 'GET', url: `${BASE}?queryText=${encodedRejectedQuery}` }),
      app.inject({ method: 'POST', url: `${BASE}/search`, payload: { queryText: rejectedQuery } }),
      app.inject({ method: 'GET', url: `${BASE}/shared?queryText=${encodedRejectedQuery}` }),
    ]);
    for (const response of rejectedResponses) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'LTM_QUERY_INVALID',
        message: expect.stringContaining('queryText must not exceed 128 characters.'),
        retryable: false,
      });
    }
    expect(management.listLongTermMemory).not.toHaveBeenCalled();
    expect(management.searchLongTermMemory).not.toHaveBeenCalled();
    expect(management.listPublishedLongTermMemory).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps the user characteristic capacity error to HTTP 400', async () => {
    const management = createManagementPort();
    vi.mocked(management.manualSaveLongTermMemory).mockResolvedValue({
      code: 'LTM_WRITE_INVALID',
      message: 'At most 50 configured long-term memories are allowed.',
      category: 'VALIDATION',
      retryable: false,
    });
    const app = await createApp(management);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/manual`,
      payload: {
        memoryType: 'USER_CHARACTERISTICS',
        knowledgeSourceType: 'CONFIGURED',
        briefIndex: 'User preference',
        content: 'Prefer concise answers.',
        labels: [],
        confidence: 1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'LTM_WRITE_INVALID',
      message: 'At most 50 configured long-term memories are allowed.',
      retryable: false,
    });
    await app.close();
  });

  it('rejects authority and unknown body or query fields before invoking the port', async () => {
    const management = createManagementPort();
    const app = await createApp(management);
    const rejectedFields = ['tenantId', 'subjectId', 'userId', 'displayName', 'agentId', 'unknownField'];

    for (const field of rejectedFields) {
      const bodyResponse = await app.inject({
        method: 'POST',
        url: BASE,
        payload: { ...savePayload(), [field]: 'untrusted' },
      });
      expect(bodyResponse.statusCode, field).toBe(400);
      expect(bodyResponse.json()).toMatchObject({ code: 'LTM_QUERY_INVALID', retryable: false });

      const queryResponse = await app.inject({ method: 'GET', url: `${BASE}?${field}=untrusted` });
      expect(queryResponse.statusCode, field).toBe(400);
      expect(queryResponse.json()).toMatchObject({ code: 'LTM_QUERY_INVALID', retryable: false });
    }

    const invalidShape = await app.inject({
      method: 'POST',
      url: BASE,
      payload: { ...savePayload(), memoryType: 'UNKNOWN', labels: 'bgp' },
    });
    expect(invalidShape.statusCode).toBe(400);
    expect(invalidShape.json()).toMatchObject({ code: 'LTM_QUERY_INVALID', retryable: false });

    expect(management.saveLongTermMemory).not.toHaveBeenCalled();
    expect(management.listLongTermMemory).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps SafeError and thrown failures without exposing raw error details', async () => {
    const management = createManagementPort();
    const notFound: SafeError = {
      code: 'LTM_MEMORY_NOT_FOUND',
      message: 'Long-term memory was not found.',
      category: 'NOT_FOUND',
      retryable: false,
    };
    vi.mocked(management.getLongTermMemory)
      .mockResolvedValueOnce(notFound)
      .mockRejectedValueOnce(new Error(`raw-provider-failure ${view.content} secret-token`));
    const app = await createApp(management);

    const safe = await app.inject({ method: 'GET', url: `${BASE}/${memoryId}/record` });
    expect(safe.statusCode).toBe(404);
    expect(safe.json()).toEqual({ code: notFound.code, message: notFound.message, retryable: false });

    const unexpected = await app.inject({ method: 'GET', url: `${BASE}/${memoryId}/record` });
    expect(unexpected.statusCode).toBe(500);
    expect(unexpected.json()).toEqual({
      code: 'LTM_STORAGE_UNAVAILABLE',
      message: 'Long-term memory is temporarily unavailable.',
      retryable: true,
    });
    expect(unexpected.body).not.toContain('raw-provider-failure');
    expect(unexpected.body).not.toContain(view.content);
    expect(unexpected.body).not.toContain('secret-token');
    await app.close();
  });

  it('aborts the management signal when the HTTP client disconnects', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveInvocation: (() => void) | undefined;
    const invoked = new Promise<void>((resolve) => {
      resolveInvocation = resolve;
    });
    const management = createManagementPort();
    vi.mocked(management.getLongTermMemory).mockImplementation(async (_query, signal) => {
      capturedSignal = signal;
      resolveInvocation?.();
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      return {
        code: 'LTM_OPERATION_CANCELED',
        message: 'Long-term memory operation was canceled.',
        category: 'CANCELED',
        retryable: false,
      };
    });
    const app = await createApp(management);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const target = new URL(address);
    const request = httpRequest({
      host: target.hostname,
      port: Number(target.port),
      path: `${BASE}/${memoryId}/record`,
      method: 'GET',
    });
    request.on('error', () => undefined);
    request.end();

    await invoked;
    request.destroy();
    await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await app.close();
  });
});

async function createApp(management: LongTermMemoryManagementPort, identityResolver = () => trustedIdentity) {
  const app = Fastify();
  registerMemoryRoutes(app, {
    management,
    identityResolver,
    defaultAgentId: trustedScope.agentId,
  });
  await app.ready();
  return app;
}

function createManagementPort(): LongTermMemoryManagementPort {
  return {
    saveLongTermMemory: vi.fn(async () => view),
    listLongTermMemory: vi.fn(async () => ({ items: [summary], total: 1, offset: 0, limit: 20 })),
    batchCreateLongTermMemory: vi.fn(async () => ({ successCount: 1, failCount: 0, memoryIds: [memoryId] })),
    manualSaveLongTermMemory: vi.fn(async () => view),
    getLongTermMemory: vi.fn(async () => view),
    deleteLongTermMemory: vi.fn(async () => ({ memoryId })),
    mutateLongTermMemory: vi.fn(async () => ({ status: 'UPDATED' as const, memoryId, currentVersion: 3, record: view })),
    searchLongTermMemory: vi.fn(async () => ({
      items: [{ summary, score: 0.8, relevanceScore: 0.7 }],
      total: 1,
      offset: 0,
      limit: 10,
    })),
    getLongTermMemoryDetail: vi.fn(async () => view),
    publishLongTermMemory: vi.fn(async () => ({
      publishedMemory: view,
      sourceMemoryId,
      ownerSubjectId: brand<string, 'SubjectId'>('publisher-subject'),
    })),
    unpublishLongTermMemory: vi.fn(async () => ({ memoryId })),
    listPublishedLongTermMemory: vi.fn(async () => ({
      items: [
        {
          ...summary,
          sourceMemoryId,
          ownerSubjectId: brand<string, 'SubjectId'>('publisher-subject'),
          ownerUserName: 'Publisher Alice',
        },
      ],
      total: 1,
      offset: 0,
      limit: 10,
    })),
    copyPublishedMemory: vi.fn(async () => ({
      results: [{ memoryId, record: view, sourceMemoryId, copyStatus: 'COPIED' as const }],
    })),
  };
}

function savePayload() {
  return {
    memoryId,
    memoryType: 'PROCEDURAL',
    knowledgeSourceType: 'LEARNED',
    briefIndex: view.briefIndex,
    content: view.content,
    labels: ['bgp'],
    confidence: 0.9,
    source: 'manual',
  };
}
