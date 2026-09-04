import { opendir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const defaultDownloadTempRetentionMs = 60 * 60 * 1000; // 1 hour
const defaultDownloadCleanupCadenceMs = 60 * 60 * 1000; // 1 hour

export interface DownloadTempCleanupJobOptions {
  readonly downloadTempDir: string;
  readonly retentionMs?: number;
  readonly cadenceMs?: number;
}

export interface DownloadTempCleanupJob {
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

export function createDownloadTempCleanupJob(options: DownloadTempCleanupJobOptions): DownloadTempCleanupJob {
  const retentionMs = options.retentionMs ?? defaultDownloadTempRetentionMs;
  const cadenceMs = options.cadenceMs ?? defaultDownloadCleanupCadenceMs;
  return {
    jobId: 'agent-attachment-runtime.download-temp-cleanup',
    cadenceMs,
    retentionMs,
    overlapPolicy: 'SKIP',
    async run(signal, now) {
      try {
        const cutoff = now.getTime() - retentionMs;
        const cleanedCount = await cleanupExpiredDownloadFiles(options.downloadTempDir, cutoff, signal);
        return { status: 'COMPLETED' as const, cleanedCount };
      } catch {
        return { status: 'FAILED' as const, safeReasonCode: 'DOWNLOAD_TEMP_CLEANUP_FAILED' };
      }
    },
  };
}

export async function cleanupDownloadTempAtStartup(downloadTempDir: string): Promise<number> {
  return cleanupExpiredDownloadFiles(downloadTempDir, Date.now(), new AbortController().signal);
}

async function cleanupExpiredDownloadFiles(rootDir: string, cutoffMs: number, signal: AbortSignal): Promise<number> {
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
    // Directory doesn't exist or not accessible — nothing to clean.
  }
  return cleanedCount;
}
