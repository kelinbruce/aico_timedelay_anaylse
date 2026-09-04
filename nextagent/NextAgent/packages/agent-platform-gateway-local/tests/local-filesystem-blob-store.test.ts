import { brand } from '@nextagent/agent-common';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalFilesystemBlobStore } from '../src/blob/local-filesystem-blob-store.js';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('local filesystem blob store', () => {
  it('stores attachment bytes outside SQLite and materializes a Read-visible execution file', async () => {
    root = await mkdtemp(join(tmpdir(), 'nextagent-local-blob-'));
    const source = join(root, 'upload.md');
    const executionFile = join(root, 'execution', 'attachments', 'attachment-1', 'upload.md');
    await writeFile(source, 'local blob content');
    const blobs = createLocalFilesystemBlobStore({ blobDataDir: join(root, 'blobs') });
    const tenantId = brand<string, 'TenantId'>('tenant-1');
    const subjectId = brand<string, 'SubjectId'>('subject-1');
    const tempRef = brand<string, 'BlobRef'>('tmp/subject-1/run-1/upload.md');

    await blobs.storeBlob({
      tenantId,
      subjectId,
      purpose: 'ATTACHMENT',
      blobRef: tempRef,
      localFilePath: source,
      idempotencyKey: brand<string, 'IdempotencyKey'>('upload-1'),
    });
    const copied = await blobs.copyBlob({ sourceBlob: tempRef, destinationBlob: 'question/session-1/run-1/upload.md' });

    expect(copied.blobRef).toMatch(/^blob-/);
    expect(copied.blobRef).not.toContain('execution');
    await expect(blobs.listBlobs({ prefix: 'blob-' })).resolves.toEqual({
      blobs: [{ blobRef: copied.blobRef, size: 'local blob content'.length }],
      truncated: false,
    });
    await expect(blobs.materializeBlob({ tenantId, subjectId, blobRef: copied.blobRef, localFilePath: executionFile })).resolves.toBe(true);
    await expect(readFile(executionFile, 'utf8')).resolves.toBe('local blob content');
    await expect(blobs.deleteBlob({ tenantId, subjectId, blobRef: copied.blobRef })).resolves.toBe(true);
    await expect(blobs.materializeBlob({ tenantId, subjectId, blobRef: copied.blobRef, localFilePath: executionFile })).resolves.toBe(false);
  });
});
