import { brand, type BlobRef, type EpochMillis } from '@nextagent/agent-common';
import type {
  BlobStoreGateway,
  CopyBlobRequest,
  CopyBlobResult,
  DeleteBlobRequest,
  ListBlobsRequest,
  ListBlobsResult,
  LoadBlobRequest,
  MaterializeBlobRequest,
  StoreBlobRequest,
} from '@nextagent/agent-contracts/gateway';
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export class LocalFilesystemBlobStore implements BlobStoreGateway {
  constructor(private readonly blobDataDir: string) {}

  async storeBlob(request: StoreBlobRequest): Promise<BlobRef> {
    const target = this.blobPath(request.tenantId, request.subjectId, request.blobRef);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(request.localFilePath, target);
    return request.blobRef;
  }

  async loadBlob(request: LoadBlobRequest): Promise<Uint8Array | undefined> {
    const bytes = await readFile(this.blobPath(request.tenantId, request.subjectId, request.blobRef)).catch(() => undefined);
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  async materializeBlob(request: MaterializeBlobRequest): Promise<boolean> {
    try {
      await mkdir(dirname(request.localFilePath), { recursive: true });
      await copyFile(this.blobPath(request.tenantId, request.subjectId, request.blobRef), request.localFilePath);
      return true;
    } catch {
      return false;
    }
  }

  async blobExists(request: LoadBlobRequest): Promise<boolean> {
    return stat(this.blobPath(request.tenantId, request.subjectId, request.blobRef)).then(
      () => true,
      () => false,
    );
  }

  async deleteBlob(request: DeleteBlobRequest): Promise<boolean> {
    const target = this.blobPath(request.tenantId, request.subjectId, request.blobRef);
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    await rm(target, { force: true }).catch(() => {});
    return exists;
  }

  async copyBlob(request: CopyBlobRequest): Promise<CopyBlobResult> {
    const source = await this.findBlobPath(request.sourceBlob);
    if (source === undefined) {
      throw new Error('Source blob not found.');
    }
    const blobRef = brand<string, 'BlobRef'>(`blob-${randomUUID()}`);
    const target = join(dirname(source), encodeBlobRef(blobRef));
    await copyFile(source, target);
    return { blobRef, etag: blobRef, lastModified: brand<number, 'EpochMillis'>(Date.now()) };
  }

  async getBlobMetadata(request: { readonly blobRef: BlobRef }) {
    const path = await this.findBlobPath(request.blobRef);
    if (path === undefined) {
      return undefined;
    }
    const details = await stat(path).catch(() => undefined);
    if (details === undefined) {
      return undefined;
    }
    return { blobRef: request.blobRef, contentLength: details.size, lastModified: brand<number, 'EpochMillis'>(details.mtimeMs) };
  }

  async listBlobs(request: ListBlobsRequest): Promise<ListBlobsResult> {
    const matches = await this.findBlobEntries()
      .then((entries) => entries.filter((entry) => entry.blobRef.startsWith(request.prefix)))
      .catch(() => []);
    const maxKeys = request.maxKeys ?? 100;
    return { blobs: matches.slice(0, maxKeys), truncated: matches.length > maxKeys };
  }

  private blobPath(tenantId: string, subjectId: string, blobRef: BlobRef): string {
    return join(this.blobDataDir, ownerDirectory(tenantId, subjectId), encodeBlobRef(blobRef));
  }

  private async findBlobPath(blobRef: BlobRef | string): Promise<string | undefined> {
    const encoded = encodeBlobRef(blobRef);
    const owners = await readdir(this.blobDataDir).catch(() => []);
    for (const owner of owners) {
      const candidate = join(this.blobDataDir, owner, encoded);
      if (
        await stat(candidate).then(
          () => true,
          () => false,
        )
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  private async findBlobEntries(): Promise<ReadonlyArray<{ readonly blobRef: BlobRef; readonly size: number }>> {
    const owners = await readdir(this.blobDataDir).catch(() => []);
    const entries: Array<{ blobRef: BlobRef; size: number }> = [];
    for (const owner of owners) {
      const files = await readdir(join(this.blobDataDir, owner)).catch(() => []);
      for (const file of files) {
        const details = await stat(join(this.blobDataDir, owner, file)).catch(() => undefined);
        if (details?.isFile()) {
          entries.push({ blobRef: brand<string, 'BlobRef'>(decodeBlobRef(file)), size: details.size });
        }
      }
    }
    return entries;
  }
}

export function createLocalFilesystemBlobStore(input: { readonly blobDataDir: string }): BlobStoreGateway {
  return new LocalFilesystemBlobStore(input.blobDataDir);
}

function ownerDirectory(tenantId: string, subjectId: string): string {
  return createHash('sha256').update(`${tenantId}:${subjectId}`).digest('hex');
}

function encodeBlobRef(blobRef: string): string {
  return Buffer.from(blobRef).toString('base64url');
}

function decodeBlobRef(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
