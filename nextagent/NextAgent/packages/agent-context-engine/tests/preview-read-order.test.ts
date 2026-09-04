import { brand, type JsonValue } from '@nextagent/agent-common';
import type { BlobStoreGateway, OwnerScoped } from '@nextagent/agent-contracts/gateway';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { readPersistedPreview, renderPersistedPreviewBlock } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

const owner: OwnerScoped = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
};

/**
 * Spec anchor: add-ts-large-content-references §"Large content failures are
 * explicit and recoverable" + design decision 6 (5-step read order).
 * Each fixture corresponds to one of the 5 steps; the test asserts the
 * reader's response shape so the contract is locked.
 */
describe('readPersistedPreview — 5-step read order (task 3.1)', () => {
  // Step 1: identity (contentRef) missing → degraded marker, no leak.
  it('step 1: rejects when SessionMessage.metadata.replacement has no contentRef', async () => {
    const message = messageWithReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: null,
      originalSize: 1000,
      previewSize: 0,
      contentType: 'text/plain',
    });
    const gateway = inMemoryBlobStore({});

    const result = await readPersistedPreview({ owner, message }, gateway);

    expect(result.status).toBe('degraded');
    if (result.status === 'degraded') {
      expect(result.degradation.code).toBe('missing-content-ref');
      expect(result.content).toContain('persisted-content-unavailable');
    }
  });

  // Step 3: gateway unavailable (loadBlob throws) → degraded marker.
  it('step 3: rejects when BlobStoreGateway load throws', async () => {
    const message = messageWithReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'blob-1', refType: 'CAPABILITY_RESULT' },
      originalSize: 1000,
      previewSize: 100,
      contentType: 'text/plain',
    });
    const gateway: BlobStoreGateway = {
      async loadBlob() {
        throw new Error('sqlite-lock-failure');
      },
      async storeBlob() {
        throw new Error('unused');
      },
      async materializeBlob() {
        return false;
      },
      async blobExists() {
        return false;
      },
      async deleteBlob() {
        return false;
      },
      async copyBlob() {
        return { blobRef: 'copy-blob' as never, etag: 'copy-etag', lastModified: 0 as never };
      },
      async getBlobMetadata() {
        return undefined;
      },
      async listBlobs() {
        return { blobs: [], truncated: false };
      },
    };

    const result = await readPersistedPreview({ owner, message }, gateway);

    expect(result.status).toBe('degraded');
    if (result.status === 'degraded') {
      expect(result.degradation.code).toBe('gateway-unavailable');
      expect(result.degradation.message).toContain('sqlite-lock-failure');
    }
  });

  // Step 3/4: identity + gateway ok → bounded preview (default).
  it('step 4: returns bounded preview by default (previewSize cap)', async () => {
    const fullText = 'x'.repeat(3000);
    const message = messageWithReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'blob-1', refType: 'CAPABILITY_RESULT' },
      originalSize: 3000,
      previewSize: 2048,
      contentType: 'text/plain',
    });
    const gateway = inMemoryBlobStore({ 'blob-1': fullText });

    const result = await readPersistedPreview({ owner, message }, gateway);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.kind).toBe('preview');
      expect(result.content.length).toBe(2048);
      expect(result.content).toBe('x'.repeat(2048));
    }
  });

  // Step 4 alternative: authorized full read → entire content.
  it('step 4: returns the full content when authorizedFullRead is set', async () => {
    const fullText = 'authorized full content — owner-scoped blob';
    const message = messageWithReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'blob-2', refType: 'ARTIFACT' },
      originalSize: fullText.length,
      previewSize: 100,
      contentType: 'text/plain',
    });
    const gateway = inMemoryBlobStore({ 'blob-2': fullText });

    const result = await readPersistedPreview({ owner, message, authorizedFullRead: true }, gateway);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.kind).toBe('full');
      expect(result.content).toBe(fullText);
    }
  });

  // Step 5: any step failure → degradation marker, never a leak.
  it('step 5: returns a degradation marker when the gateway returns empty (no bytes)', async () => {
    const message = messageWithReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'blob-missing', refType: 'CAPABILITY_RESULT' },
      originalSize: 1000,
      previewSize: 100,
      contentType: 'text/plain',
    });
    const gateway = inMemoryBlobStore({});

    const result = await readPersistedPreview({ owner, message }, gateway);

    expect(result.status).toBe('degraded');
    if (result.status === 'degraded') {
      expect(result.degradation.code).toBe('gateway-returned-empty');
      // No raw bytes leak through; the marker is a tagged text block.
      expect(result.content).toContain('persisted-content-unavailable');
      expect(result.content).not.toContain('blob-missing');
    }
  });

  it('step 5 (variant): returns binary-content-not-text when the persisted content is not valid UTF-8', async () => {
    const message = messageWithReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'blob-binary', refType: 'ARTIFACT' },
      originalSize: 8,
      previewSize: 0,
      contentType: 'application/octet-stream',
    });
    // 0xff 0xfe 0xfd 0xfc — invalid UTF-8 lead bytes.
    const binaryBytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]);
    const gateway = inMemoryBlobStore({ 'blob-binary': binaryBytes });

    const result = await readPersistedPreview({ owner, message }, gateway);

    expect(result.status).toBe('degraded');
    if (result.status === 'degraded') {
      expect(result.degradation.code).toBe('binary-content-not-text');
      expect(result.content).toContain('specialized handler');
    }
  });

  it('renderPersistedPreviewBlock emits the design 4.2 default tagged text block', () => {
    const block = renderPersistedPreviewBlock({
      replacementReason: 'policy:oversized-single-result',
      contentRefId: 'blob-1',
      contentRefType: 'CAPABILITY_RESULT',
      originalSize: 1000,
      preview: 'first 200 chars of full content',
    });
    expect(block).toContain('<persisted-content>');
    expect(block).toContain('Reason: policy:oversized-single-result');
    expect(block).toContain('Full content ref: CAPABILITY_RESULT:blob-1');
    expect(block).toContain('Original size: 1000 chars');
    expect(block).toContain('first 200 chars of full content');
    expect(block).toContain('Access: Use the contentRef');
    expect(block).toContain('</persisted-content>');
  });

  it('renderPersistedPreviewBlock tells the model to page workspace-backed capability results with Read', () => {
    const block = renderPersistedPreviewBlock({
      replacementReason: 'policy:oversized-single-result',
      contentRefId: 'tool-results/result-1.txt',
      contentRefType: 'CAPABILITY_RESULT',
      originalSize: 20_000,
      preview: 'first 1024 chars',
    });
    expect(block).toContain('File path: tool-results/result-1.txt');
    expect(block).toContain('Read tool');
    expect(block).toContain('offset');
    expect(block).toContain('limit');
  });
});

interface ReplacementShape {
  readonly kind: 'PERSISTED_PREVIEW';
  readonly reason: string;
  readonly contentRef: { refId: string; refType: 'ATTACHMENT' | 'CAPABILITY_RESULT' | 'MODEL_SUMMARY' | 'ARTIFACT' } | null;
  readonly originalSize: number;
  readonly previewSize: number;
  readonly contentType: string;
  readonly [key: string]: unknown;
}

function messageWithReplacement(replacement: ReplacementShape): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>('msg-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    role: 'CAPABILITY_RESULT',
    content: 'preview text',
    contentType: 'PLAIN_TEXT',
    metadata: { replacement: replacement as unknown as JsonValue },
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(0),
  };
}

function inMemoryBlobStore(blobs: Readonly<Record<string, string | Uint8Array>>): BlobStoreGateway {
  return {
    async loadBlob(request) {
      const value = blobs[request.blobRef as unknown as string];
      if (value === undefined) {
        return undefined;
      }
      return typeof value === 'string' ? new TextEncoder().encode(value) : value;
    },
    async storeBlob() {
      throw new Error('unused');
    },
    async materializeBlob() {
      return false;
    },
    async blobExists(request) {
      return blobs[request.blobRef as unknown as string] !== undefined;
    },
    async deleteBlob() {
      return false;
    },
    async copyBlob() {
      return { blobRef: 'copy-blob' as never, etag: 'copy-etag', lastModified: 0 as never };
    },
    async getBlobMetadata() {
      return undefined;
    },
    async listBlobs() {
      return { blobs: [], truncated: false };
    },
  };
}
