import { AgentError, brand, type AgentId, type EpochMillis, type IdentityContext } from '@nextagent/agent-common';
import type { BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileDownloadMaterializeRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: string;
  readonly objectName: string;
  readonly downloadId: string;
}

export interface FileDownloadMaterializeResult {
  readonly localFilePath: string;
  readonly safeFileName: string;
  readonly sizeBytes: number;
}

export interface DownloadAuditEvent {
  readonly userId: string;
  readonly tenantId: string;
  readonly agentId: AgentId;
  readonly sessionId: string;
  readonly objectName: string;
  readonly sizeBytes: number;
  readonly result: 'SUCCESS' | 'FAILURE';
  readonly reasonCode?: string;
  readonly downloadId: string;
  readonly timestamp: EpochMillis;
}

export interface FileDownloadRuntime {
  materialize: (request: FileDownloadMaterializeRequest) => Promise<FileDownloadMaterializeResult>;
  cleanup: (request: { readonly downloadId: string }) => Promise<void>;
}

export const GLOBAL_DOWNLOAD_TMP_LIMIT = 2048 * 1024 * 1024; // 2048 MB

// =============================================================================
// Global download concurrency limiter (mirrors UploadConcurrencyLimiter)
// =============================================================================

export const MAX_DOWNLOAD_CONCURRENCY = 4;
export const DOWNLOAD_CONCURRENCY_TIMEOUT_MS = 30_000;

export class DownloadConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  async acquire(): Promise<void> {
    if (this.active < MAX_DOWNLOAD_CONCURRENCY) {
      this.active++;
      return undefined;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.resolve === resolve);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error('DOWNLOAD_CONCURRENCY_TIMEOUT'));
      }, DOWNLOAD_CONCURRENCY_TIMEOUT_MS);

      this.waiters.push({ resolve, reject, timer });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next !== undefined) {
      clearTimeout(next.timer);
      this.active++;
      next.resolve();
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }
}

export class DownloadTempSizeGuard {
  private currentBytes = 0;
  constructor(private readonly limit: number = GLOBAL_DOWNLOAD_TMP_LIMIT) {}

  get currentSize(): number {
    return this.currentBytes;
  }

  tryReserve(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.currentBytes + bytes > this.limit) {
      return false;
    }
    this.currentBytes += bytes;
    return true;
  }

  recordCleaned(bytes: number): void {
    this.currentBytes = Math.max(0, this.currentBytes - bytes);
  }
}

export function extractLastSegment(objectName: string): string {
  const normalized = objectName.replaceAll('\\', '/');
  const leaf = normalized.split('/').pop()?.trim() ?? '';
  return leaf.length === 0 ? 'file' : leaf.slice(0, 255);
}

export function sanitizeDownloadFileName(fileName: string): string {
  return fileName.replaceAll('\0', '');
}

export function createFileDownloadRuntime(input: {
  readonly blobStore: BlobStoreGateway;
  readonly downloadTempDir: string;
  readonly sizeGuard?: DownloadTempSizeGuard;
  readonly concurrencyLimiter?: DownloadConcurrencyLimiter;
  readonly auditObserver?: (event: DownloadAuditEvent) => void;
  readonly clock?: () => EpochMillis;
}): FileDownloadRuntime {
  const sizeGuard = input.sizeGuard ?? new DownloadTempSizeGuard();
  const concurrencyLimiter = input.concurrencyLimiter ?? new DownloadConcurrencyLimiter();
  const clock = input.clock ?? (() => brand<number, 'EpochMillis'>(Date.now()));
  const auditObserver = input.auditObserver;

  function audit(event: Omit<DownloadAuditEvent, 'timestamp'>): void {
    try {
      auditObserver?.({ ...event, timestamp: clock() });
    } catch {
      // Audit must not affect download semantics
    }
  }

  return {
    async materialize(request) {
      await concurrencyLimiter.acquire();
      let reservedBytes = 0;
      let sizeBytes = 0;
      try {
        const safeFileName = sanitizeDownloadFileName(extractLastSegment(request.objectName));
        const downloadDir = join(input.downloadTempDir, request.downloadId);
        const localFilePath = join(downloadDir, safeFileName);
        const blobRef = brand<string, 'BlobRef'>(request.objectName);
        const metadata = await input.blobStore.getBlobMetadata({ blobRef }).catch(() => undefined);
        const knownContentLength =
          metadata !== undefined && Number.isSafeInteger(metadata.contentLength) && metadata.contentLength >= 0 ? metadata.contentLength : undefined;
        if (knownContentLength !== undefined) {
          if (!sizeGuard.tryReserve(knownContentLength)) {
            throwDownloadCapacityExceeded();
          }
          reservedBytes = knownContentLength;
        }
        try {
          await mkdir(downloadDir, { recursive: true });
          const materialized = await input.blobStore.materializeBlob({
            tenantId: request.identityContext.tenantId,
            subjectId: request.identityContext.subjectId,
            blobRef,
            localFilePath,
          });
          if (materialized !== true) {
            throwDownloadBlobUnavailable();
          }
          const fileStat = await stat(localFilePath);
          const additionalBytes = fileStat.size - reservedBytes;
          if (additionalBytes > 0 && !sizeGuard.tryReserve(additionalBytes)) {
            throwDownloadCapacityExceeded();
          }
          if (additionalBytes < 0) {
            sizeGuard.recordCleaned(-additionalBytes);
          }
          reservedBytes = fileStat.size;
          sizeBytes = fileStat.size;
          audit({
            userId: request.identityContext.subjectId,
            tenantId: request.identityContext.tenantId,
            agentId: request.agentId,
            sessionId: request.sessionId,
            objectName: request.objectName,
            sizeBytes,
            result: 'SUCCESS',
            downloadId: request.downloadId,
          });
          return { localFilePath, safeFileName, sizeBytes };
        } catch (error) {
          sizeGuard.recordCleaned(reservedBytes);
          await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
      } catch (error) {
        const reasonCode = error instanceof AgentError ? error.code : 'DOWNLOAD_INTERNAL_ERROR';
        audit({
          userId: request.identityContext.subjectId,
          tenantId: request.identityContext.tenantId,
          agentId: request.agentId,
          sessionId: request.sessionId,
          objectName: request.objectName,
          sizeBytes,
          result: 'FAILURE',
          ...(reasonCode === undefined ? {} : { reasonCode }),
          downloadId: request.downloadId,
        });
        throw error;
      } finally {
        concurrencyLimiter.release();
      }
    },
    async cleanup(request) {
      const downloadDir = join(input.downloadTempDir, request.downloadId);
      try {
        const entries = await readdir(downloadDir);
        let totalSize = 0;
        for (const entry of entries) {
          const entryStat = await stat(join(downloadDir, entry)).catch(() => undefined);
          if (entryStat?.isFile() === true) {
            totalSize += entryStat.size;
          }
        }
        sizeGuard.recordCleaned(totalSize);
      } catch {
        // Directory doesn't exist — nothing to account for.
      }
      await rm(downloadDir, { recursive: true, force: true });
    },
  };
}

function throwDownloadCapacityExceeded(): never {
  throw new AgentError({
    code: 'DOWNLOAD_TEMP_CAPACITY_EXCEEDED',
    message: 'Download temporary storage is at capacity.',
    category: 'UNAVAILABLE',
    retryable: true,
  });
}

function throwDownloadBlobUnavailable(): never {
  throw new AgentError({
    code: 'DOWNLOAD_BLOB_UNAVAILABLE',
    message: 'Download blob is unavailable.',
    category: 'UNAVAILABLE',
    retryable: true,
  });
}
