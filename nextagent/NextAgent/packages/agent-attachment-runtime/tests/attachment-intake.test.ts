import { brand } from '@nextagent/agent-common';
import type { AttachmentStoreGateway, BlobStoreGateway, RequestAttachmentRecord } from '@nextagent/agent-contracts/gateway';
import { createAttachmentIntakeRuntime, attachmentIntakeLimits } from '../src/index.js';
import { describe, expect, it, vi } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-attachment-intake'),
  subjectId: brand<string, 'SubjectId'>('subject-attachment-intake'),
  displayName: 'Attachment Intake',
};

const baseRequest = {
  identityContext: identity,
  agentId: brand<string, 'AgentId'>('agent-attachment-intake'),
  reservationId: brand<string, 'AttachmentIntakeReservationId'>('reservation-attachment-intake'),
  sessionId: brand<string, 'SessionId'>('session-attachment-intake'),
  requestId: brand<string, 'MessageId'>('request-attachment-intake'),
  runId: brand<string, 'RequestRunId'>('run-attachment-intake'),
  requestContextId: brand<string, 'RequestContextId'>('context-attachment-intake'),
  action: 'SUBMIT_REQUEST' as const,
  idempotencyKey: brand<string, 'IdempotencyKey'>('idem-attachment-intake'),
};

describe('attachment intake runtime', () => {
  it('accepts Markdown only after validation and writes blob plus metadata with safe fields', async () => {
    const stores = createStores();
    const outcomeObserver = vi.fn();
    const runtime = createAttachmentIntakeRuntime({
      blobStore: stores.blobStore,
      uploadTempDir: testUploadTempDir,
      attachmentStore: stores.attachmentStore,
      clock: () => brand<number, 'EpochMillis'>(1),
      idFactory: (prefix) => `${prefix}-1`,
      outcomeObserver,
    });

    const result = await runtime.intake({
      ...baseRequest,
      files: [markdownFile('diag.md', '# alarm\n')],
    });

    expect(result.status).toBe('ACCEPTED');
    expect(result.attachmentIds).toEqual([brand<string, 'AttachmentId'>('attachment-1')]);
    expect(stores.storeBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        purpose: 'ATTACHMENT',
        diagnosticContext: expect.objectContaining({
          reservationId: baseRequest.reservationId,
          requestId: baseRequest.requestId,
          runId: baseRequest.runId,
          sessionId: baseRequest.sessionId,
          agentId: baseRequest.agentId,
        }),
      }),
    );
    expect(stores.savedAttachments[0]).toEqual(
      expect.objectContaining({
        attachmentId: brand<string, 'AttachmentId'>('attachment-1'),
        sessionId: baseRequest.sessionId,
        requestId: baseRequest.requestId,
        runId: baseRequest.runId,
        agentId: baseRequest.agentId,
        fileName: 'diag.md',
        mediaType: 'MARKDOWN',
        sizeBytes: Buffer.byteLength('# alarm\n'),
        validationStatus: 'ACCEPTED',
        availabilityStatus: 'AVAILABLE',
        storageRef: expect.any(String),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('BlobRef');
    expect(JSON.stringify(result)).not.toContain('# alarm');
    expect(outcomeObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACCEPTED',
        attachmentCount: 1,
        sizeBucket: 'small',
        sessionId: baseRequest.sessionId,
        requestId: baseRequest.requestId,
        runId: baseRequest.runId,
      }),
    );
    expect(JSON.stringify(outcomeObserver.mock.calls)).not.toContain('blob-1');
    expect(JSON.stringify(outcomeObserver.mock.calls)).not.toContain('# alarm');
  });

  it('collects deterministic validation failures before blob writes', async () => {
    const stores = createStores();
    const runtime = createAttachmentIntakeRuntime({
      blobStore: stores.blobStore,
      uploadTempDir: testUploadTempDir,
      attachmentStore: stores.attachmentStore,
    });

    const result = await runtime.intake({
      ...baseRequest,
      files: [markdownFile('empty.md', ''), markdownFile('bad.pdf', '%PDF-1.7', 'application/pdf')],
    });

    expect(result.status).toBe('REJECTED');
    expect(result.attachmentIds).toEqual([]);
    expect(result.rejected.map((item) => item.reasonCode)).toEqual(['ATTACHMENT_EMPTY', 'ATTACHMENT_TYPE_UNSUPPORTED']);
    expect(stores.storeBlob).not.toHaveBeenCalled();
    expect(stores.savedAttachments).toEqual([]);
  });

  it('enforces count, size, type and read boundaries', async () => {
    const runtime = createAttachmentIntakeRuntime(createStores());
    await expect(
      runtime.intake({
        ...baseRequest,
        files: [markdownFile('1.md', 'a'), markdownFile('2.md', 'b'), markdownFile('3.md', 'c'), markdownFile('4.md', 'd')],
      }),
    ).resolves.toMatchObject({ status: 'REJECTED', safeError: { code: 'ATTACHMENT_COUNT_EXCEEDED' } });

    await expect(
      runtime.intake({
        ...baseRequest,
        files: [
          {
            fileName: 'large.md',
            declaredMimeType: 'text/markdown',
            sizeBytes: attachmentIntakeLimits.maxAttachmentSizeBytes + 1,
            bytes: new Uint8Array(attachmentIntakeLimits.maxAttachmentSizeBytes + 1),
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'REJECTED', rejected: [expect.objectContaining({ reasonCode: 'ATTACHMENT_TOO_LARGE' })] });

    await expect(
      runtime.intake({
        ...baseRequest,
        files: [markdownFile('fake.md', '%PDF-1.7', 'text/markdown')],
      }),
    ).resolves.toMatchObject({ status: 'REJECTED', rejected: [expect.objectContaining({ reasonCode: 'ATTACHMENT_TYPE_MISMATCH' })] });

    await expect(
      runtime.intake({
        ...baseRequest,
        files: [{ fileName: 'nul.md', declaredMimeType: 'text/markdown', sizeBytes: 3, bytes: new Uint8Array([0x61, 0x00, 0x62]) }],
      }),
    ).resolves.toMatchObject({ status: 'REJECTED', rejected: [expect.objectContaining({ reasonCode: 'ATTACHMENT_READ_FAILED' })] });
  });

  it('fails closed on partial staging failure without outputting partial attachmentIds', async () => {
    const stores = createStores({ failSecondAttachmentSave: true, blobExists: true });
    const runtime = createAttachmentIntakeRuntime({
      blobStore: stores.blobStore,
      uploadTempDir: testUploadTempDir,
      attachmentStore: stores.attachmentStore,
      idFactory: (prefix) => `${prefix}-${stores.nextAttachmentId++}`,
    });

    const result = await runtime.intake({
      ...baseRequest,
      files: [markdownFile('one.md', 'one'), markdownFile('two.md', 'two')],
    });

    expect(result.status).toBe('REJECTED');
    expect(result.attachmentIds).toEqual([]);
    expect(result.safeError?.code).toBe('ATTACHMENT_STAGING_FAILED');
    expect(stores.savedAttachments).toHaveLength(1);
    expect(stores.deleteBlob).toHaveBeenCalledTimes(1);
  });
});

function markdownFile(fileName: string, text: string, declaredMimeType = 'text/markdown') {
  const bytes = Buffer.from(text);
  return { fileName, declaredMimeType, sizeBytes: bytes.byteLength, bytes: new Uint8Array(bytes) };
}

function createStores(options: { readonly failSecondAttachmentSave?: boolean; readonly blobExists?: boolean } = {}) {
  const savedAttachments: RequestAttachmentRecord[] = [];
  let nextBlobId = 1;
  const storeBlob = vi.fn(async () => brand<string, 'BlobRef'>(`blob-${nextBlobId++}`));
  const blobStore: BlobStoreGateway = {
    storeBlob,
    loadBlob: vi.fn(async () => undefined),
    materializeBlob: vi.fn(async () => false),
    blobExists: vi.fn(async () => options.blobExists ?? false),
    deleteBlob: vi.fn(async () => false),
    copyBlob: vi.fn(async () => ({
      blobRef: brand<string, 'BlobRef'>('copy-blob'),
      etag: 'test-etag',
      lastModified: brand<number, 'EpochMillis'>(1),
    })),
    getBlobMetadata: vi.fn(async () => undefined),
    listBlobs: vi.fn(async () => ({ blobs: [], truncated: false })),
  };
  const attachmentStore: AttachmentStoreGateway = {
    saveAttachment: vi.fn(async (record) => {
      if (options.failSecondAttachmentSave === true && savedAttachments.length === 1) {
        throw new Error('metadata unavailable');
      }
      savedAttachments.push(record);
      return record;
    }),
    loadAttachment: vi.fn(async () => undefined),
    listAttachmentsByRequestId: vi.fn(async () => []),
    listAttachmentsByRunId: vi.fn(async () => []),
    listAttachmentsBySession: vi.fn(async () => []),
    updateAttachmentStatus: vi.fn(async () => undefined),
  };
  const deleteBlob = vi.fn(async () => false);
  blobStore.deleteBlob = deleteBlob;
  return { blobStore, attachmentStore, storeBlob, deleteBlob, savedAttachments, nextAttachmentId: 1 };
}
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testUploadTempDir = mkdtempSync(join(tmpdir(), 'intake-test-'));
