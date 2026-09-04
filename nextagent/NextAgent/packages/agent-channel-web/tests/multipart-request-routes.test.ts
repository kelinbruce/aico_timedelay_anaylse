import { brand } from '@nextagent/agent-common';
import { createAttachmentStagedUploadRuntime } from '@nextagent/agent-attachment-runtime';
import { registerWebChannel, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import type { AttachmentStoreGateway, BlobStoreGateway, RequestAttachmentRecord } from '@nextagent/agent-contracts/gateway';
import type { RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('multipart request routes', () => {
  it('rejects unsupported multipart fields before runtime reserve', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(app, makeDependencies(runtime));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      headers: { 'content-type': 'multipart/form-data; boundary=BOUNDARY' },
      payload: multipart([field('inputText', 'hello'), field('idempotencyKey', 'idem-1'), field('tenantId', 'evil')]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(runtime.reserveSubmit).not.toHaveBeenCalled();
    expect(runtime.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects client agent/id fields in multipart edit before runtime reserve', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(app, makeDependencies(runtime));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/latest/edit',
      headers: { 'content-type': 'multipart/form-data; boundary=BOUNDARY' },
      payload: multipart([
        field('inputText', 'edited'),
        field('idempotencyKey', 'idem-2'),
        field('expectedLatestRequestId', 'req-1'),
        field('agentId', 'evil'),
      ]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(runtime.reserveSubmit).not.toHaveBeenCalled();
    expect(runtime.editLatest).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects non-empty JSON attachments before runtime submit', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(app, makeDependencies(runtime));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: {
        inputText: 'hello',
        idempotencyKey: 'idem-3',
        attachments: [{ attachmentId: 'client' }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(runtime.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it('finalizes staged attachments for both session and convenience JSON submit', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    const moveToFormal = vi.fn(async () => ({
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-1')],
      attachmentRecords: [],
    }));
    await registerWebChannel(
      app,
      makeDependencies(runtime, {
        stagedUploadRuntime: {
          uploadToTemp: vi.fn(async () => ({ tempRunId: 'temp', fileName: 'report.md', sizeBytes: 1 })),
          moveToFormal,
          deleteTemp: vi.fn(async () => undefined),
        },
        chatUploadFileConfig: {
          chatUploadFileType: ['*.md'],
          chatUploadMaxFileNumber: 10,
          chatUploadMaxFileSize: 10,
          uploadFileIdleExpireTime: 5,
          uploadFileMaxExpireTime: 30,
        },
      }),
    );

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests',
      payload: { inputText: 'session', idempotencyKey: 'idem-session', attachments: [{ tempRunId: 'temp-1', fileName: 'report.md' }] },
    });
    const convenienceResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'convenience', idempotencyKey: 'idem-convenience', attachments: [{ tempRunId: 'temp-2', fileName: 'report.md' }] },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(convenienceResponse.statusCode).toBe(200);
    expect(runtime.reserveSubmit).toHaveBeenCalledTimes(2);
    expect(moveToFormal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sessionId: 'S1', attachments: [{ tempRunId: 'temp-1', fileName: 'report.md' }] }),
    );
    expect(moveToFormal).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId: 'S1', attachments: [{ tempRunId: 'temp-2', fileName: 'report.md' }] }),
    );
    expect(runtime.submit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attachmentIds: ['attachment-1'], reservedRequest: expect.any(Object) }),
    );
    expect(runtime.submit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attachmentIds: ['attachment-1'], reservedRequest: expect.any(Object) }),
    );
    await app.close();
  });

  it('rejects staged attachments on edit without invoking the runtime', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(app, makeDependencies(runtime));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/latest/edit',
      payload: {
        expectedLatestRequestId: 'req-1',
        editedInputText: 'edited',
        idempotencyKey: 'idem-edit',
        attachments: [{ tempRunId: 'temp-1', fileName: 'report.md' }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(runtime.editLatest).not.toHaveBeenCalled();
    await app.close();
  });

  it('retries persisted attachments without invoking the staged upload runtime', async () => {
    const app = Fastify();
    const runtime = makeRuntime();
    const moveToFormal = vi.fn();
    await registerWebChannel(
      app,
      makeDependencies(runtime, {
        stagedUploadRuntime: {
          uploadToTemp: vi.fn(),
          moveToFormal,
          deleteTemp: vi.fn(),
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/retry',
      payload: { expectedLatestRequestId: 'req-1', idempotencyKey: 'idem-retry' },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.retryLatest).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLatestRequestId: 'req-1',
        action: 'RETRY_LATEST',
      }),
    );
    expect(moveToFormal).not.toHaveBeenCalled();
    await app.close();
  });

  it('runs phase 1 upload and JSON finalization through the same staged runtime without a bucket', async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), 'nextagent-staged-route-'));
    const files = new Map<string, Buffer>();
    const records: RequestAttachmentRecord[] = [];
    const blobStore: BlobStoreGateway = {
      storeBlob: async (request) => {
        files.set(request.blobRef, await readFile(request.localFilePath));
        return request.blobRef;
      },
      loadBlob: async (request) => files.get(request.blobRef),
      materializeBlob: async (request) => {
        const bytes = files.get(request.blobRef);
        if (bytes === undefined) {
          return false;
        }
        await writeFile(request.localFilePath, bytes);
        return true;
      },
      blobExists: async (request) => files.has(request.blobRef),
      getBlobMetadata: async (request) => {
        const bytes = files.get(request.blobRef);
        return bytes === undefined
          ? undefined
          : { blobRef: request.blobRef, contentLength: bytes.byteLength, lastModified: brand<number, 'EpochMillis'>(1) };
      },
      copyBlob: async (request) => {
        const bytes = files.get(request.sourceBlob);
        if (bytes === undefined) {
          throw new Error('missing staged blob');
        }
        const blobRef = brand<string, 'BlobRef'>(`blob-formal-${files.size}`);
        files.set(blobRef, bytes);
        return { blobRef, etag: 'etag', lastModified: brand<number, 'EpochMillis'>(1) };
      },
      deleteBlob: async (request) => files.delete(request.blobRef),
      listBlobs: async () => ({ blobs: [], truncated: false }),
    };
    const attachmentStore: AttachmentStoreGateway = {
      saveAttachment: async (record) => {
        records.push(record);
        return record;
      },
      loadAttachment: async (request) => records.find((record) => record.attachmentId === request.attachmentId),
      listAttachmentsByRequestId: async (request) => records.filter((record) => record.requestId === request.requestId),
      listAttachmentsByRunId: async (request) => records.filter((record) => record.runId === request.runId),
      listAttachmentsBySession: async (request) => records.filter((record) => record.sessionId === request.sessionId),
      updateAttachmentStatus: async () => undefined,
    };
    const stagedUploadRuntime = createAttachmentStagedUploadRuntime({ blobStore, attachmentStore, uploadTempDir });
    const app = Fastify();
    const runtime = makeRuntime();
    await registerWebChannel(
      app,
      makeDependencies(runtime, {
        stagedUploadRuntime,
        chatUploadFileConfig: {
          chatUploadFileType: ['*.md'],
          chatUploadMaxFileNumber: 10,
          chatUploadMaxFileSize: 10,
          uploadFileIdleExpireTime: 5,
          uploadFileMaxExpireTime: 30,
        },
      }),
    );

    try {
      const tempRunId = 'stage-route-1';
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/files/upload',
        headers: { 'content-type': 'multipart/form-data; boundary=BOUNDARY' },
        payload: multipart([field('tempRunId', tempRunId), file('file', 'report.md', 'network report')]),
      });
      expect(uploadResponse.statusCode).toBe(200);

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/S1/requests',
        payload: { inputText: 'analyze report', idempotencyKey: 'idem-staged-route', attachments: [{ tempRunId, fileName: 'report.md' }] },
      });
      expect(submitResponse.statusCode).toBe(200);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(expect.objectContaining({ fileName: 'report.md', storageRef: expect.stringMatching(/^blob-formal-/) }));
      expect(runtime.submit).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: [records[0]?.attachmentId] }));
    } finally {
      await app.close();
      await rm(uploadTempDir, { recursive: true, force: true });
    }
  });
});

function field(name: string, value: string): string {
  return ['--BOUNDARY', `Content-Disposition: form-data; name="${name}"`, '', value].join('\r\n');
}

function multipart(parts: readonly string[]): string {
  return `${parts.join('\r\n')}\r\n--BOUNDARY--\r\n`;
}

function makeRuntime(): RuntimeCommandPort {
  return {
    reserveSubmit: vi.fn(async () => ({
      reservationId: brand<string, 'AttachmentIntakeReservationId'>('reservation-1'),
      sessionId: brand<string, 'SessionId'>('S1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
      replay: false,
      intakeOutcome: { status: 'INTAKE_ACCEPTED' as const, attachmentIds: [] },
    })),
    submit: vi.fn(async (command) => ({
      sessionId: command.sessionId,
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      targetRequestId: brand<string, 'MessageId'>('req-1'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-2'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestId: brand<string, 'MessageId'>('req-2'),
      runId: brand<string, 'RequestRunId'>('run-2'),
      attempt: 1,
    })),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      pendingInputId: brand<string, 'PendingInputId'>('pi-1'),
      status: 'RECEIVED' as const,
    })),
  };
}

function makeDependencies(
  runtime: RuntimeCommandPort,
  overrides: Partial<Pick<WebChannelDependencies, 'stagedUploadRuntime' | 'chatUploadFileConfig'>> = {},
) {
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => session()),
    requireSession: vi.fn(async ({ sessionId }) => session(sessionId)),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: session(brand<string, 'SessionId'>('child-1')) })),
    forkFromRequest: vi.fn(async () => ({ childSession: session(brand<string, 'SessionId'>('child-1')) })),
    listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 50, markers: [] })),
    updateTitle: vi.fn(async ({ sessionId, title }) => ({ ...session(sessionId), title })),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  return {
    runtime,
    sessions,
    identityResolver: () => ({ tenantId: brand<string, 'TenantId'>('T1'), subjectId: brand<string, 'SubjectId'>('U1'), displayName: 'Test User' }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-1'),
    ...overrides,
  };
}

function file(name: string, fileName: string, content: string): string {
  return ['--BOUNDARY', `Content-Disposition: form-data; name="${name}"; filename="${fileName}"`, 'Content-Type: text/markdown', '', content].join(
    '\r\n',
  );
}

function session(sessionId = brand<string, 'SessionId'>('S1')) {
  return {
    tenantId: brand<string, 'TenantId'>('T1'),
    subjectId: brand<string, 'SubjectId'>('U1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    sessionId,
    title: 'Session',
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
    hasInFlightRequest: false,
  };
}
