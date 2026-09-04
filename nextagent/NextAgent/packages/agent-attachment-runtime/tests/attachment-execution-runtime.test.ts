import { brand } from '@nextagent/agent-common';
import type { BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAttachmentExecutionRuntime } from '../src/attachment-execution-runtime.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-execution'),
  subjectId: brand<string, 'SubjectId'>('subject-execution'),
  displayName: 'Execution test',
};

describe('attachment execution runtime', () => {
  it('materializes opaque blob references into the supplied execution view', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'attachment-execution-'));
    const blobStore = createBlobStore(
      new Map([
        ['blob-one', Buffer.from('first')],
        ['blob-two', Buffer.from('second')],
      ]),
    );
    const runtime = createAttachmentExecutionRuntime({ blobStore });
    const attachmentsDirectory = join(tempDir, 'attachments');

    const paths = await runtime.materialize({
      identityContext: identity,
      attachmentsDirectory,
      attachments: [
        {
          attachmentId: brand<string, 'AttachmentId'>('attachment-one'),
          fileName: 'report.md',
          storageRef: brand<string, 'BlobRef'>('blob-one'),
        },
        {
          attachmentId: brand<string, 'AttachmentId'>('attachment-two'),
          fileName: 'table.csv',
          storageRef: brand<string, 'BlobRef'>('blob-two'),
        },
      ],
    });

    expect(paths).toEqual([join(attachmentsDirectory, 'attachment-one', 'report.md'), join(attachmentsDirectory, 'attachment-two', 'table.csv')]);
    await expect(readFile(paths[0]!, 'utf-8')).resolves.toBe('first');
    await expect(readFile(paths[1]!, 'utf-8')).resolves.toBe('second');
  });

  it('removes a partial execution view when a blob cannot be materialized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'attachment-execution-'));
    const runtime = createAttachmentExecutionRuntime({ blobStore: createBlobStore(new Map([['blob-one', Buffer.from('first')]])) });
    const attachmentsDirectory = join(tempDir, 'attachments');

    await expect(
      runtime.materialize({
        identityContext: identity,
        attachmentsDirectory,
        attachments: [
          {
            attachmentId: brand<string, 'AttachmentId'>('attachment-one'),
            fileName: 'report.md',
            storageRef: brand<string, 'BlobRef'>('blob-one'),
          },
          {
            attachmentId: brand<string, 'AttachmentId'>('attachment-missing'),
            fileName: 'missing.md',
            storageRef: brand<string, 'BlobRef'>('missing'),
          },
        ],
      }),
    ).rejects.toThrow('Attachment blob is unavailable.');
    await expect(access(attachmentsDirectory)).rejects.toThrow();
  });

  it('cleans the execution attachment view', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'attachment-execution-'));
    const runtime = createAttachmentExecutionRuntime({ blobStore: createBlobStore(new Map()) });
    const attachmentsDirectory = join(tempDir, 'attachments');
    await mkdir(attachmentsDirectory);
    await writeFile(join(attachmentsDirectory, 'materialized.md'), 'remove');
    await writeFile(join(tempDir, 'placeholder'), 'keep');
    await runtime.cleanup({ attachmentsDirectory });

    await expect(access(attachmentsDirectory)).rejects.toThrow();
    await expect(readFile(join(tempDir, 'placeholder'), 'utf-8')).resolves.toBe('keep');
  });
});

function createBlobStore(blobs: ReadonlyMap<string, Buffer>): BlobStoreGateway {
  return {
    async storeBlob() {
      throw new Error('not used');
    },
    async loadBlob() {
      return undefined;
    },
    async materializeBlob(request) {
      const content = blobs.get(request.blobRef);
      if (content === undefined) {
        return false;
      }
      await writeFile(request.localFilePath, content);
      return true;
    },
    async blobExists() {
      return false;
    },
    async getBlobMetadata() {
      return undefined;
    },
    async copyBlob() {
      throw new Error('not used');
    },
    async deleteBlob() {
      return false;
    },
    async listBlobs() {
      return { blobs: [], truncated: false };
    },
  };
}
