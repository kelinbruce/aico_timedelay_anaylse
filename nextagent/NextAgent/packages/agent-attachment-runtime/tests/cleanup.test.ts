import { brand } from '@nextagent/agent-common';
import type {
  AttachmentStoreGateway,
  BlobStoreGateway,
  RequestAttachmentRecord,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { createAttachmentCleanupRuntime } from '../src/index.js';
import { describe, expect, it, vi } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-cleanup'),
  subjectId: brand<string, 'SubjectId'>('subject-cleanup'),
  displayName: 'Cleanup',
};

describe('attachment cleanup runtime', () => {
  it('rejects cleanup without a trusted locator', async () => {
    const runtime = createAttachmentCleanupRuntime(createDeps());
    await expect(
      runtime.cleanup({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-cleanup'),
        reasonCode: 'EXPLICIT_UNAVAILABLE',
      }),
    ).resolves.toMatchObject({ outcome: 'REJECTED', safeReasonCode: 'ATTACHMENT_CLEANUP_VALIDATION_FAILED' });
  });

  it('marks an attachment unavailable without deleting metadata when the blob is missing', async () => {
    const stores = createStores({ blobExists: false });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')],
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(stores.attachmentStore.updateAttachmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: brand<string, 'AttachmentId'>('attachment-cleanup'),
        availabilityStatus: 'UNAVAILABLE',
      }),
    );
  });

  it('reports explicit unavailable cleanup through the cleanup runtime', async () => {
    const stores = createStores({ blobExists: true });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')],
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(stores.blobStore.deleteBlob).toHaveBeenCalledTimes(1);
  });

  it('can resolve cleanup targets from a trusted runId', async () => {
    const stores = createStores({ blobExists: true });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'ADMISSION_GAP_ORPHAN',
      runId: brand<string, 'RequestRunId'>('run-cleanup'),
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(stores.attachmentStore.listAttachmentsByRunId).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: brand<string, 'RequestRunId'>('run-cleanup'),
      }),
    );
  });

  it('rejects cleanup when a requested attachment id cannot be resolved from authoritative storage', async () => {
    const stores = createStores({ blobExists: true });
    stores.attachmentStore.loadAttachment = vi.fn<AttachmentStoreGateway['loadAttachment']>(async (_request) => undefined);
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [brand<string, 'AttachmentId'>('missing-attachment')],
    });

    expect(result.outcome).toBe('NOT_FOUND');
    expect(stores.blobStore.deleteBlob).not.toHaveBeenCalled();
    expect(stores.attachmentStore.updateAttachmentStatus).not.toHaveBeenCalled();
  });

  it('emits bounded evidence with stable refs and without blob ref leakage', async () => {
    const stores = createStores({ blobExists: true });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      sessionId: brand<string, 'SessionId'>('session-cleanup'),
      requestId: brand<string, 'MessageId'>('request-cleanup'),
      runId: brand<string, 'RequestRunId'>('run-cleanup'),
      requestContextId: brand<string, 'RequestContextId'>('rc-cleanup'),
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')],
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(JSON.stringify(result.evidence)).toContain('session-cleanup');
    expect(JSON.stringify(result.evidence)).toContain('request-cleanup');
    expect(JSON.stringify(result.evidence)).toContain('run-cleanup');
    expect(JSON.stringify(result.evidence)).not.toContain('blob-cleanup');
    expect(JSON.stringify(result.evidence)).not.toContain('BlobRef');
  });

  it('keeps referenced attachment metadata and only marks the blob unavailable', async () => {
    const stores = createStores({ blobExists: true });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
      messageStore: createMessageStore(),
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      sessionId: brand<string, 'SessionId'>('session-cleanup'),
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(stores.blobStore.deleteBlob).toHaveBeenCalledTimes(1);
    expect(stores.attachmentStore.updateAttachmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: brand<string, 'AttachmentId'>('attachment-cleanup'),
        availabilityStatus: 'UNAVAILABLE',
      }),
    );
  });

  it('fails explicitly when blob delete succeeds but metadata update fails', async () => {
    const stores = createStores({ blobExists: true });
    stores.attachmentStore.updateAttachmentStatus = vi.fn<AttachmentStoreGateway['updateAttachmentStatus']>(async (_request) => undefined);
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')],
    });

    expect(result.outcome).toBe('FAILED');
    expect(result.safeReasonCode).toBe('ATTACHMENT_CLEANUP_FAILED');
    expect(stores.blobStore.deleteBlob).toHaveBeenCalledTimes(1);
  });

  it('returns already unavailable when the blob is already gone and metadata is already unavailable', async () => {
    const stores = createStores({ blobExists: false, availabilityStatus: 'UNAVAILABLE' });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')],
    });

    expect(result.outcome).toBe('ALREADY_UNAVAILABLE');
    expect(result.safeReasonCode).toBe('ATTACHMENT_CLEANUP_ALREADY_UNAVAILABLE');
    expect(stores.attachmentStore.updateAttachmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        availabilityStatus: 'UNAVAILABLE',
      }),
    );
  });

  it('rejects cross-agent authoritative attachment mismatches', async () => {
    const stores = createStores({ blobExists: true });
    stores.attachmentStore.loadAttachment = vi.fn<AttachmentStoreGateway['loadAttachment']>(async (request) => {
      if (request.agentId !== brand<string, 'AgentId'>('agent-cleanup')) {
        return undefined;
      }
      return createAttachment();
    });
    const runtime = createAttachmentCleanupRuntime({
      attachmentStore: stores.attachmentStore,
      blobStore: stores.blobStore,
    });

    const result = await runtime.cleanup({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-other'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')],
    });

    expect(result.outcome).toBe('NOT_FOUND');
    expect(stores.blobStore.deleteBlob).not.toHaveBeenCalled();
    expect(stores.attachmentStore.updateAttachmentStatus).not.toHaveBeenCalled();
  });

  it('does not accept raw blob or path fields on cleanup requests', async () => {
    const runtime = createAttachmentCleanupRuntime(createDeps());
    const invalidRequest = {
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-cleanup'),
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-cleanup'),
    } as unknown as Parameters<typeof runtime.cleanup>[0];

    await expect(runtime.cleanup(invalidRequest)).resolves.toMatchObject({
      outcome: 'REJECTED',
      safeReasonCode: 'ATTACHMENT_CLEANUP_VALIDATION_FAILED',
    });
  });
});

function createDeps() {
  return {
    attachmentStore: createStores().attachmentStore,
    blobStore: createStores().blobStore,
  };
}

function createMessageStore(): SessionMessageStoreGateway {
  return {
    listMessages: vi.fn(async () => ({
      items: [createMessageRecord()],
      limit: 100,
      hasMore: false,
    })),
    appendSessionMessage: vi.fn(async (record) => record),
    loadMessage: vi.fn(async () => undefined),
    loadMessages: vi.fn(async () => []),
    listConversationPreview: vi.fn(async () => ({ sessionId: createMessageRecord().sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    listCurrentRequestMessages: vi.fn(async () => ({ items: [], limit: 100, hasMore: false })),
    hideMessage: vi.fn(async () => undefined),
    hideRequestMessages: vi.fn(async () => 0),
  };
}

function createStores(options: { readonly blobExists?: boolean; readonly availabilityStatus?: RequestAttachmentRecord['availabilityStatus'] } = {}) {
  const attachment = createAttachment({
    availabilityStatus: options.availabilityStatus ?? 'AVAILABLE',
  });
  return {
    attachmentStore: {
      saveAttachment: vi.fn(async (record) => record),
      loadAttachment: vi.fn<AttachmentStoreGateway['loadAttachment']>(async () => attachment),
      listAttachmentsByRequestId: vi.fn(async () => [attachment]),
      listAttachmentsByRunId: vi.fn(async () => [attachment]),
      listAttachmentsBySession: vi.fn(async () => [attachment]),
      updateAttachmentStatus: vi.fn<AttachmentStoreGateway['updateAttachmentStatus']>(async (request) => ({
        ...attachment,
        validationStatus: request.validationStatus,
        availabilityStatus: request.availabilityStatus,
      })),
    } satisfies AttachmentStoreGateway,
    blobStore: {
      storeBlob: vi.fn(async () => brand<string, 'BlobRef'>('blob-cleanup')),
      loadBlob: vi.fn(async () => undefined),
      materializeBlob: vi.fn(async () => false),
      blobExists: vi.fn(async () => options.blobExists ?? true),
      deleteBlob: vi.fn(async () => true),
      copyBlob: vi.fn(async () => ({
        blobRef: brand<string, 'BlobRef'>('copy-blob'),
        etag: 'copy-etag',
        lastModified: brand<number, 'EpochMillis'>(0),
      })),
      getBlobMetadata: vi.fn(async () => undefined),
      listBlobs: vi.fn(async () => ({ blobs: [], truncated: false })),
    } satisfies BlobStoreGateway,
  };
}

function createAttachment(overrides: Partial<RequestAttachmentRecord> = {}): RequestAttachmentRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId: brand<string, 'AgentId'>('agent-cleanup'),
    attachmentId: brand<string, 'AttachmentId'>('attachment-cleanup'),
    sessionId: brand<string, 'SessionId'>('session-cleanup'),
    requestId: brand<string, 'MessageId'>('request-cleanup'),
    runId: brand<string, 'RequestRunId'>('run-cleanup'),
    fileName: 'diag.md',
    mediaType: 'MARKDOWN',
    sizeBytes: 4,
    validationStatus: 'ACCEPTED',
    availabilityStatus: 'AVAILABLE',
    storageRef: brand<string, 'BlobRef'>('blob-cleanup'),
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

function createMessageRecord(): SessionMessageRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId: brand<string, 'AgentId'>('agent-cleanup'),
    messageId: brand<string, 'MessageId'>('request-cleanup'),
    sessionId: brand<string, 'SessionId'>('session-cleanup'),
    requestId: brand<string, 'MessageId'>('request-cleanup'),
    runId: brand<string, 'RequestRunId'>('run-cleanup'),
    role: 'USER',
    content: 'request',
    contentType: 'PLAIN_TEXT',
    metadata: { attachmentIds: [brand<string, 'AttachmentId'>('attachment-cleanup')] },
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}
