import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, utimes } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import build from 'pino-roll';
import type { SonicBoom } from 'sonic-boom';
import type {
  LocalFileActiveIdentity,
  LocalFileAppendResult,
  LocalFileMaintenanceEvent,
  LocalFileRollHandle,
  LocalFileRollMaintenanceHandle,
  LocalFileRollPolicy,
} from './index.js';

const ARCHIVE_SCAN_INTERVAL_MS = 60_000;
const RETENTION_SCAN_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

interface ValidatedPolicy extends LocalFileRollPolicy {
  readonly directory: string;
  readonly sourcePattern: RegExp;
  readonly archivePattern: RegExp;
  readonly temporaryPattern: RegExp;
}

interface MaintenanceSummary {
  archiveCompleted: number;
  archiveFailed: number;
  retentionCompleted: number;
  retentionFailed: number;
}

interface LocalFileRollDependencies {
  readonly removeOwnedFile: (file: string) => Promise<'completed' | 'failed' | 'skipped'>;
}

interface MaintenanceController {
  readonly enqueue: (includeRetention: boolean, signal?: AbortSignal) => Promise<void>;
  readonly setEventListener: (listener: (event: LocalFileMaintenanceEvent) => void) => void;
  readonly stop: () => Promise<void>;
}

const defaultDependencies: LocalFileRollDependencies = { removeOwnedFile: removeRegularOwnedFile };

const maintenanceControls = new WeakMap<LocalFileRollHandle, (includeRetention: boolean, signal?: AbortSignal) => Promise<void>>();

async function buildDestination(validated: ValidatedPolicy): Promise<SonicBoom> {
  return build({
    file: join(validated.directory, validated.fileName),
    size: `${validated.maxFileSizeMiB}m`,
    frequency: 'daily',
    ...(validated.naming === 'date-sequence' ? { dateFormat: 'yyyy-MM-dd' } : {}),
    mkdir: true,
    sync: false,
    maxLength: validated.bufferCapacityBytes,
    symlink: false,
  });
}

export async function createLocalFileRoll(policy: LocalFileRollPolicy): Promise<LocalFileRollHandle> {
  return createLocalFileRollForTesting(policy, true, defaultDependencies);
}

export async function createLocalFileRollMaintenance(policy: LocalFileRollPolicy): Promise<LocalFileRollMaintenanceHandle> {
  const validated = validatePolicy(policy);
  const maintenance = createMaintenanceController(validated, () => undefined, true, defaultDependencies);
  let closePromise: Promise<void> | undefined;
  return {
    setMaintenanceEventListener(listener): void {
      maintenance.setEventListener(listener);
    },
    close(timeoutMs): Promise<void> {
      closePromise ??= withinTimeout(maintenance.stop(), timeoutMs).then(() => undefined);
      return closePromise;
    },
  };
}

export async function createLocalFileRollForTesting(
  policy: LocalFileRollPolicy,
  scheduleMaintenance: boolean,
  dependencies: LocalFileRollDependencies = defaultDependencies,
): Promise<LocalFileRollHandle> {
  const validated = validatePolicy(policy);
  let destination = await buildDestination(validated);
  await waitForDestinationReady(destination);

  let closed = false;
  let closePromise: Promise<void> | undefined;
  let isRecoveryPending = false;
  let confirmedActiveFile: string | undefined;

  const recoverDestinationIfDeleted = async (): Promise<void> => {
    const activeFile = currentActiveFile(destination);
    if (activeFile === undefined) {
      return;
    }
    if ((await safeRegularFileStat(activeFile)) !== undefined) {
      return;
    }
    const previousDestination = destination;
    destination = await buildDestination(validated);
    await waitForDestinationReady(destination);
    await closeDestination(previousDestination);
  };

  const maintenance = createMaintenanceController(
    validated,
    () => currentActiveFile(destination),
    scheduleMaintenance,
    dependencies,
    recoverDestinationIfDeleted,
  );

  const handle: LocalFileRollHandle = {
    appendLine(line): LocalFileAppendResult {
      if (closed) {
        return { status: 'dropped', reason: 'closed' };
      }
      if (!isCompleteLine(line)) {
        return { status: 'dropped', reason: 'invalid_line' };
      }
      const activeFile = currentActiveFile(destination);
      if (activeFile !== undefined && activeFile === confirmedActiveFile && !existsSync(activeFile)) {
        if (!isRecoveryPending) {
          isRecoveryPending = true;
          void maintenance.enqueue(false).then(
            () => {
              isRecoveryPending = false;
            },
            () => {
              isRecoveryPending = false;
            },
          );
        }
        return { status: 'dropped', reason: 'buffer_full' };
      }
      let dropped = false;
      const onDrop = (): void => {
        dropped = true;
      };
      destination.once('drop', onDrop);
      try {
        destination.write(line);
        if (!dropped) {
          confirmedActiveFile = activeFile;
        }
        return dropped ? { status: 'dropped', reason: 'buffer_full' } : { status: 'accepted' };
      } catch {
        return { status: 'dropped', reason: 'buffer_full' };
      } finally {
        destination.off('drop', onDrop);
      }
    },
    activeIdentity(): LocalFileActiveIdentity | undefined {
      const file = currentActiveFile(destination);
      return file === undefined ? undefined : { file };
    },
    setMaintenanceEventListener(listener): void {
      maintenance.setEventListener(listener);
    },
    async flush(timeoutMs): Promise<void> {
      if (closed) {
        return;
      }
      await withinTimeout(flushDestination(destination), timeoutMs);
    },
    close(timeoutMs): Promise<void> {
      if (closePromise !== undefined) {
        return closePromise;
      }
      closed = true;
      closePromise = withinTimeout(
        maintenance.stop().then(() => closeDestination(destination)),
        timeoutMs,
      ).then(() => undefined);
      return closePromise;
    },
  };
  maintenanceControls.set(handle, maintenance.enqueue);
  return handle;
}

export async function runLocalFileRollMaintenanceForTesting(
  handle: LocalFileRollHandle,
  includeRetention = true,
  signal?: AbortSignal,
): Promise<void> {
  const maintain = maintenanceControls.get(handle);
  if (maintain === undefined) {
    throw new TypeError('unknown local file roll handle');
  }
  await maintain(includeRetention, signal);
}

function createMaintenanceController(
  policy: ValidatedPolicy,
  activeFile: () => string | undefined,
  scheduleMaintenance: boolean,
  dependencies: LocalFileRollDependencies,
  afterMaintenance?: () => Promise<void>,
): MaintenanceController {
  let maintenanceLane = Promise.resolve();
  let maintenanceListener: ((event: LocalFileMaintenanceEvent) => void) | undefined;
  const failedMaintenanceOperations = new Set<'archive' | 'retention'>();
  const maintenanceAbort = new AbortController();
  let stopPromise: Promise<void> | undefined;

  const enqueue = (includeRetention: boolean, signal = maintenanceAbort.signal): Promise<void> => {
    maintenanceLane = maintenanceLane.then(async () => {
      const includesRetentionMaintenance = includeRetention || policy.maxArchiveFiles !== undefined;
      try {
        const summary = await maintainOwnedFiles(policy, activeFile, includeRetention, signal, dependencies.removeOwnedFile);
        if (!signal.aborted) {
          await afterMaintenance?.();
        }
        emitMaintenanceSummary(summary, includesRetentionMaintenance, failedMaintenanceOperations, maintenanceListener);
      } catch {
        if (!failedMaintenanceOperations.has('archive')) {
          failedMaintenanceOperations.add('archive');
          emitMaintenanceEvent(maintenanceListener, { operation: 'archive', outcome: 'failed', affectedCount: 1 });
        }
        if (includesRetentionMaintenance && !failedMaintenanceOperations.has('retention')) {
          failedMaintenanceOperations.add('retention');
          emitMaintenanceEvent(maintenanceListener, { operation: 'retention', outcome: 'failed', affectedCount: 1 });
        }
      }
    });
    return maintenanceLane;
  };

  const archiveTimer = scheduleMaintenance
    ? setInterval(() => {
        void enqueue(false);
      }, ARCHIVE_SCAN_INTERVAL_MS)
    : undefined;
  const retentionTimer = scheduleMaintenance
    ? setInterval(() => {
        void enqueue(true);
      }, RETENTION_SCAN_INTERVAL_MS)
    : undefined;
  archiveTimer?.unref();
  retentionTimer?.unref();
  const startupMaintenance = scheduleMaintenance
    ? setImmediate(() => {
        void enqueue(true);
      })
    : undefined;

  return {
    enqueue,
    setEventListener(listener): void {
      maintenanceListener = listener;
    },
    stop(): Promise<void> {
      if (stopPromise !== undefined) {
        return stopPromise;
      }
      if (archiveTimer !== undefined) {
        clearInterval(archiveTimer);
      }
      if (retentionTimer !== undefined) {
        clearInterval(retentionTimer);
      }
      if (startupMaintenance !== undefined) {
        clearImmediate(startupMaintenance);
      }
      maintenanceAbort.abort();
      stopPromise = maintenanceLane;
      return stopPromise;
    },
  };
}

function validatePolicy(policy: LocalFileRollPolicy): ValidatedPolicy {
  if (!isAbsolute(policy.directory)) {
    throw new TypeError('directory must be absolute');
  }
  const directory = resolve(policy.directory);
  if (basename(policy.fileName) !== policy.fileName || !/^[A-Za-z0-9._-]+$/u.test(policy.fileName)) {
    throw new TypeError('fileName must be a safe base name');
  }
  const extension = extname(policy.fileName);
  const stem = policy.fileName.slice(0, -extension.length);
  if (extension.length < 2 || stem.length === 0) {
    throw new TypeError('fileName must include an extension');
  }
  if (policy.naming !== 'sequence' && policy.naming !== 'date-sequence') {
    throw new TypeError('unsupported naming');
  }
  if (!Number.isInteger(policy.maxFileSizeMiB) || policy.maxFileSizeMiB <= 0) {
    throw new TypeError('maxFileSizeMiB must be positive');
  }
  if (!Number.isInteger(policy.retentionDays) || policy.retentionDays <= 0) {
    throw new TypeError('retentionDays must be positive');
  }
  if (policy.maxArchiveFiles !== undefined && (!Number.isInteger(policy.maxArchiveFiles) || policy.maxArchiveFiles <= 0)) {
    throw new TypeError('maxArchiveFiles must be positive');
  }
  if (!Number.isInteger(policy.bufferCapacityBytes) || policy.bufferCapacityBytes <= 0) {
    throw new TypeError('bufferCapacityBytes must be positive');
  }

  const escapedStem = escapeRegExp(stem);
  const escapedExtension = escapeRegExp(extension);
  const member =
    policy.naming === 'sequence'
      ? `${escapedStem}\\.(\\d+)${escapedExtension}`
      : `${escapedStem}\\.(\\d{4}-\\d{2}-\\d{2})\\.(\\d+)${escapedExtension}`;
  return {
    ...policy,
    directory,
    sourcePattern: new RegExp(`^${member}$`, 'u'),
    archivePattern: new RegExp(`^${member}\\.gz$`, 'u'),
    temporaryPattern: new RegExp(`^${member}\\.gz\\.tmp$`, 'u'),
  };
}

async function maintainOwnedFiles(
  policy: ValidatedPolicy,
  activeFile: () => string | undefined,
  includeRetention: boolean,
  signal: AbortSignal,
  removeOwnedFile: LocalFileRollDependencies['removeOwnedFile'],
): Promise<MaintenanceSummary> {
  const summary: MaintenanceSummary = { archiveCompleted: 0, archiveFailed: 0, retentionCompleted: 0, retentionFailed: 0 };
  if (signal.aborted) {
    return summary;
  }
  await mkdir(policy.directory, { recursive: true });
  for (const entry of await readdir(policy.directory, { withFileTypes: true })) {
    if (signal.aborted) {
      return summary;
    }
    const file = join(policy.directory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || isActive(file, activeFile)) {
      continue;
    }
    if (policy.temporaryPattern.test(entry.name)) {
      recordResult(summary, 'archive', await removeOwnedFile(file));
      continue;
    }
    if (policy.sourcePattern.test(entry.name)) {
      if (includeRetention && (await isExpired(file, policy.retentionDays))) {
        recordResult(summary, 'retention', await removeOwnedFile(file));
      } else if (!isActive(file, activeFile)) {
        recordResult(summary, 'archive', await archiveSource(file, activeFile, signal));
      }
      continue;
    }
    if (includeRetention && policy.archivePattern.test(entry.name) && (await isExpired(file, policy.retentionDays))) {
      recordResult(summary, 'retention', await removeOwnedFile(file));
    }
  }
  if (policy.maxArchiveFiles !== undefined && !signal.aborted) {
    await enforceArchiveCount(policy, summary, signal, removeOwnedFile);
  }
  return summary;
}

async function enforceArchiveCount(
  policy: ValidatedPolicy,
  summary: MaintenanceSummary,
  signal: AbortSignal,
  removeOwnedFile: LocalFileRollDependencies['removeOwnedFile'],
): Promise<void> {
  const maxArchiveFiles = policy.maxArchiveFiles;
  if (maxArchiveFiles === undefined) {
    return;
  }
  const archives: Array<{ readonly file: string; readonly name: string; readonly mtimeMs: number }> = [];
  for (const entry of await readdir(policy.directory, { withFileTypes: true })) {
    if (signal.aborted) {
      return;
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !policy.archivePattern.test(entry.name)) {
      continue;
    }
    const file = join(policy.directory, entry.name);
    const fileStat = await safeRegularFileStat(file);
    if (fileStat !== undefined) {
      archives.push({ file, name: entry.name, mtimeMs: fileStat.mtimeMs });
    }
  }
  archives.sort((left, right) => left.mtimeMs - right.mtimeMs || compareNames(left.name, right.name));
  const excessCount = archives.length - maxArchiveFiles;
  for (const archive of archives.slice(0, Math.max(0, excessCount))) {
    if (signal.aborted) {
      return;
    }
    recordResult(summary, 'retention', await removeOwnedFile(archive.file));
  }
}

function compareNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

async function archiveSource(source: string, activeFile: () => string | undefined, signal: AbortSignal): Promise<'completed' | 'failed' | 'skipped'> {
  if (signal.aborted || isActive(source, activeFile)) {
    return 'skipped';
  }
  const sourceStat = await safeRegularFileStat(source);
  if (sourceStat === undefined || isActive(source, activeFile)) {
    return 'skipped';
  }
  const archive = `${source}.gz`;
  if ((await safeRegularFileStat(archive)) !== undefined) {
    return 'skipped';
  }
  const temporary = `${archive}.tmp`;
  try {
    await pipeline(createReadStream(source), createGzip(), createWriteStream(temporary, { flags: 'wx' }), { signal });
    if (isActive(source, activeFile)) {
      await rm(temporary, { force: true });
      return 'skipped';
    }
    await rename(temporary, archive);
    await utimes(archive, sourceStat.atime, sourceStat.mtime);
    await rm(source);
    return 'completed';
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    return 'failed';
  }
}

async function isExpired(file: string, retentionDays: number): Promise<boolean> {
  const fileStat = await safeRegularFileStat(file);
  return fileStat !== undefined && Date.now() >= fileStat.mtimeMs + retentionDays * DAY_MS;
}

async function removeRegularOwnedFile(file: string): Promise<'completed' | 'failed' | 'skipped'> {
  if ((await safeRegularFileStat(file)) === undefined) {
    return 'skipped';
  }
  try {
    await rm(file);
    return 'completed';
  } catch {
    return 'failed';
  }
}

function recordResult(summary: MaintenanceSummary, operation: 'archive' | 'retention', result: 'completed' | 'failed' | 'skipped'): void {
  if (result === 'skipped') {
    return;
  }
  const key = `${operation}${result === 'completed' ? 'Completed' : 'Failed'}` as const;
  summary[key]++;
}

function emitMaintenanceSummary(
  summary: MaintenanceSummary,
  includeRetention: boolean,
  failedOperations: Set<'archive' | 'retention'>,
  listener?: (event: LocalFileMaintenanceEvent) => void,
): void {
  for (const operation of ['archive', 'retention'] as const) {
    if (operation === 'retention' && !includeRetention) {
      continue;
    }
    const completed = summary[`${operation}Completed`];
    const failed = summary[`${operation}Failed`];
    if (failed > 0) {
      if (!failedOperations.has(operation)) {
        failedOperations.add(operation);
        emitMaintenanceEvent(listener, { operation, outcome: 'failed', affectedCount: failed });
      }
    } else if (completed > 0 || failedOperations.delete(operation)) {
      emitMaintenanceEvent(listener, { operation, outcome: 'completed', affectedCount: completed });
    }
  }
}

function emitMaintenanceEvent(listener: ((event: LocalFileMaintenanceEvent) => void) | undefined, event: LocalFileMaintenanceEvent): void {
  if (listener === undefined) {
    return;
  }
  queueMicrotask(() => {
    try {
      listener(event);
    } catch {
      // Mechanism evidence must never affect maintenance or callers.
    }
  });
}

async function safeRegularFileStat(file: string) {
  try {
    const fileStat = await lstat(file);
    return fileStat.isFile() && !fileStat.isSymbolicLink() ? fileStat : undefined;
  } catch {
    return undefined;
  }
}

function isActive(file: string, activeFile: () => string | undefined): boolean {
  const active = activeFile();
  return active !== undefined && resolve(file) === active;
}

function currentActiveFile(destination: SonicBoom): string | undefined {
  const file = (destination as SonicBoom & { file?: unknown }).file;
  return typeof file === 'string' ? resolve(file) : undefined;
}

function waitForDestinationReady(destination: SonicBoom): Promise<void> {
  if (currentActiveFile(destination) !== undefined) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    const onReady = (): void => {
      destination.off('error', onError);
      resolvePromise();
    };
    const onError = (error: unknown): void => {
      destination.off('ready', onReady);
      reject(error);
    };
    destination.once('ready', onReady);
    destination.once('error', onError);
  });
}

function isCompleteLine(line: string): boolean {
  return line.length > 1 && line.endsWith('\n') && !line.slice(0, -1).includes('\n');
}

async function flushDestination(destination: SonicBoom): Promise<void> {
  const state = destination as SonicBoom & { _len?: number; _writing?: boolean };
  if ((state._len ?? 0) === 0 && state._writing !== true) {
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
    const onDrain = (): void => {
      destination.off('error', onError);
      resolvePromise();
    };
    const onError = (error: unknown): void => {
      destination.off('drain', onDrain);
      reject(error);
    };
    destination.once('drain', onDrain);
    destination.once('error', onError);
    try {
      destination.flush();
    } catch (error) {
      destination.off('drain', onDrain);
      destination.off('error', onError);
      reject(error);
    }
  });
}

function closeDestination(destination: SonicBoom): Promise<void> {
  return new Promise((resolvePromise) => {
    if ((destination as SonicBoom & { destroyed?: boolean }).destroyed === true) {
      return resolvePromise();
    }
    destination.once('close', resolvePromise);
    destination.end();
    return undefined;
  });
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  const boundedTimeout = Number.isFinite(timeoutMs) ? Math.max(0, Math.trunc(timeoutMs)) : 0;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(undefined), boundedTimeout);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
