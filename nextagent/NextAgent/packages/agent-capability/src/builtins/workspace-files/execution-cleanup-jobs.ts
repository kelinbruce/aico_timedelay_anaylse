import { lstat, opendir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { getLogger } from '@nextagent/agent-common';

const logger = getLogger({ component: 'agent-capability', source: 'execution-cleanup' });

const defaultProjectionRetentionMs = 7 * 24 * 60 * 60 * 1000;
const defaultTempRetentionMs = 24 * 60 * 60 * 1000;
const defaultCleanupCadenceMs = 60 * 60 * 1000;

/**
 * fs.rm retry tuning for transient Windows EPERM / EBUSY (antivirus scans,
 * lingering file handles from a just-finished sandbox process). Node's
 * `fs.rm` accepts `maxRetries` / `retryDelay` specifically for this; without
 * them a single locked directory throws, which previously aborted the entire
 * cleanup sweep (one bad entry blocked every other scope's temp dirs too).
 */
const defaultRmMaxRetries = 3;
const defaultRmRetryDelayMs = 200;

export interface ExecutionFilesystemCleanupJobOptions {
  readonly runtimeWorkspaceRoot: string;
  readonly projectionRetentionMs?: number;
  readonly tempRetentionMs?: number;
  readonly cadenceMs?: number;
}

export interface ExecutionFilesystemCleanupJob {
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

export function createExecutionFilesystemCleanupJobs(options: ExecutionFilesystemCleanupJobOptions): readonly ExecutionFilesystemCleanupJob[] {
  const runtimeWorkspaceRoot = resolve(options.runtimeWorkspaceRoot);
  const cadenceMs = options.cadenceMs ?? defaultCleanupCadenceMs;
  const projectionRetentionMs = options.projectionRetentionMs ?? defaultProjectionRetentionMs;
  const tempRetentionMs = options.tempRetentionMs ?? defaultTempRetentionMs;
  return [
    {
      jobId: 'agent-capability.skill-projection-cleanup',
      cadenceMs,
      retentionMs: projectionRetentionMs,
      overlapPolicy: 'SKIP',
      run: async (signal, now) => safeCleanup(() => cleanupSkillProjections(runtimeWorkspaceRoot, now.getTime() - projectionRetentionMs, signal)),
    },
    {
      jobId: 'agent-capability.local-temp-cleanup',
      cadenceMs,
      retentionMs: tempRetentionMs,
      overlapPolicy: 'SKIP',
      run: async (signal, now) => safeCleanup(() => cleanupLocalRunTemps(runtimeWorkspaceRoot, now.getTime() - tempRetentionMs, signal)),
    },
  ];
}

async function safeCleanup(operation: () => Promise<number>) {
  try {
    return { status: 'COMPLETED' as const, cleanedCount: await operation() };
  } catch (error) {
    logger.warn(
      {
        event: 'execution.cleanup.failed',
        safeReasonCode: 'CLEANUP_FAILED',
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      'execution filesystem cleanup pass failed',
    );
    return { status: 'FAILED' as const, safeReasonCode: 'CLEANUP_FAILED' };
  }
}

async function cleanupSkillProjections(runtimeWorkspaceRoot: string, cutoffMs: number, signal: AbortSignal): Promise<number> {
  let cleanedCount = 0;
  for await (const scopeRoot of listChildDirectories(runtimeWorkspaceRoot, signal)) {
    const skillsRoot = resolve(scopeRoot, '.nextagent', 'skills');
    if (!isContained(runtimeWorkspaceRoot, skillsRoot)) {
      continue;
    }
    cleanedCount += await cleanupChildrenOlderThan(resolve(skillsRoot, '.staging'), cutoffMs, signal);
    cleanedCount += await cleanupChildrenOlderThan(resolve(skillsRoot, '.locks'), cutoffMs, signal);
    for await (const child of listChildDirectories(skillsRoot, signal)) {
      const name = child.slice(resolve(skillsRoot).length + 1).replaceAll('\\', '/');
      if (name === '.staging' || name === '.locks' || name.startsWith('.')) {
        continue;
      }
      if (await removeIfOlderThan(child, cutoffMs, signal)) {
        cleanedCount += 1;
      }
    }
  }
  return cleanedCount;
}

async function cleanupLocalRunTemps(runtimeWorkspaceRoot: string, cutoffMs: number, signal: AbortSignal): Promise<number> {
  let cleanedCount = 0;
  for await (const scopeRoot of listChildDirectories(runtimeWorkspaceRoot, signal)) {
    const tempRoot = resolve(scopeRoot, 'temp');
    if (!isContained(runtimeWorkspaceRoot, tempRoot)) {
      continue;
    }
    cleanedCount += await cleanupChildrenOlderThan(tempRoot, cutoffMs, signal);
  }
  return cleanedCount;
}

async function cleanupChildrenOlderThan(root: string, cutoffMs: number, signal: AbortSignal): Promise<number> {
  let cleanedCount = 0;
  for await (const child of listChildDirectories(root, signal)) {
    if (await removeIfOlderThan(child, cutoffMs, signal)) {
      cleanedCount += 1;
    }
  }
  return cleanedCount;
}

async function removeIfOlderThan(path: string, cutoffMs: number, signal: AbortSignal): Promise<boolean> {
  throwIfAborted(signal);
  try {
    const item = await lstat(path);
    if (item.mtimeMs > cutoffMs) {
      return false;
    }
    await rm(path, { recursive: true, force: true, maxRetries: defaultRmMaxRetries, retryDelay: defaultRmRetryDelayMs });
    return true;
  } catch (error) {
    // An aborted signal must propagate so the scheduler can stop cleanly.
    // Any other failure (e.g. a locked directory on Windows even after the
    // retries above) is logged and skipped so one bad entry does not abort
    // the rest of the sweep — previously a single EPERM here propagated
    // through both for-await loops and skipped every remaining scope's temp
    // directories for the whole pass.
    if (signal.aborted) {
      throw error;
    }
    logger.warn(
      {
        event: 'execution.cleanup.entry_skipped',
        path,
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      'failed to remove stale execution directory; skipping',
    );
    return false;
  }
}

async function* listChildDirectories(root: string, signal: AbortSignal): AsyncGenerator<string> {
  throwIfAborted(signal);
  let directory;
  try {
    directory = await opendir(root);
  } catch {
    return;
  }
  try {
    for await (const entry of directory) {
      throwIfAborted(signal);
      if (!entry.isDirectory()) {
        continue;
      }
      const child = resolve(root, entry.name);
      if (isContained(root, child)) {
        yield child;
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}

function isContained(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const path = relative(normalizedRoot, normalizedCandidate);
  return path.length === 0 || (!path.startsWith('..') && !isAbsolute(path));
}
