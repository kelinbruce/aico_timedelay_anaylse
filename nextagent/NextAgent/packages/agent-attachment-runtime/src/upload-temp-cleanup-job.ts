import { opendir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const defaultUploadTempRetentionMs = 60 * 60 * 1000; // 1 hour
const defaultCleanupCadenceMs = 60 * 60 * 1000; // 1 hour

export interface UploadTempCleanupJobOptions {
  readonly uploadTempDir: string;
  readonly retentionMs?: number;
  readonly cadenceMs?: number;
}

export interface UploadTempCleanupJob {
  readonly jobId: string;
  readonly cadenceMs: number;
  readonly retentionMs?: number;
  readonly overlapPolicy: 'SKIP';
  run: (
    signal: AbortSignal,
    now: Date,
  ) => Promise<{
    readonly status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
    readonly safeReasonCode?: string;
    readonly cleanedCount?: number;
  }>;
}

export function createUploadTempCleanupJob(options: UploadTempCleanupJobOptions): UploadTempCleanupJob {
  const retentionMs = options.retentionMs ?? defaultUploadTempRetentionMs;
  const cadenceMs = options.cadenceMs ?? defaultCleanupCadenceMs;
  return {
    jobId: 'agent-attachment-runtime.upload-temp-cleanup',
    cadenceMs,
    retentionMs,
    overlapPolicy: 'SKIP',
    async run(signal, now) {
      try {
        const cutoff = now.getTime() - retentionMs;
        const cleanedCount = await cleanupExpiredFiles(options.uploadTempDir, cutoff, signal);
        return { status: 'COMPLETED' as const, cleanedCount };
      } catch {
        return { status: 'FAILED' as const, safeReasonCode: 'UPLOAD_TEMP_CLEANUP_FAILED' };
      }
    },
  };
}

export async function cleanupUploadTempAtStartup(uploadTempDir: string): Promise<number> {
  return cleanupExpiredFiles(uploadTempDir, Date.now(), new AbortController().signal);
}

async function cleanupExpiredFiles(rootDir: string, cutoffMs: number, signal: AbortSignal): Promise<number> {
  let cleanedCount = 0;
  try {
    const dir = await opendir(rootDir);
    for await (const entry of dir) {
      if (signal.aborted) {
        break;
      }
      const entryPath = join(rootDir, entry.name);
      const entryStat = await stat(entryPath).catch(() => undefined);
      if (entryStat === undefined) {
        continue;
      }
      if (entryStat.mtimeMs < cutoffMs) {
        await rm(entryPath, { recursive: true, force: true }).catch(() => {});
        cleanedCount++;
      }
    }
  } catch {
    // Directory doesn't exist or not accessible — nothing to clean
  }
  return cleanedCount;
}
