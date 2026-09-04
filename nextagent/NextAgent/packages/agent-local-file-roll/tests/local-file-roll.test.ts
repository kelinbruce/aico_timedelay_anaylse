import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalFileRoll, createLocalFileRollMaintenance, type LocalFileRollHandle } from '../src/index.js';
import { createLocalFileRollTestHarness } from '../src/testing.js';

const openHandles: LocalFileRollHandle[] = [];

afterEach(async () => {
  await Promise.allSettled(openHandles.splice(0).map((handle) => handle.close(2_000)));
});

describe('local file roll foundation', () => {
  it('maintains existing owned files without creating an active destination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-maintenance-only-'));
    const source = join(directory, 'nextagent-test.100.ndjson');
    writeFileSync(source, '{"historical":true}\n', 'utf8');

    const maintenance = await createLocalFileRollMaintenance(policy(directory));
    const archive = `${source}.gz`;
    await waitForPathExists(archive, 2_000);

    expect(existsSync(source)).toBe(false);
    expect(gunzipSync(readFileSync(archive)).toString('utf8')).toBe('{"historical":true}\n');
    expect(readdirSync(directory)).toEqual(['nextagent-test.100.ndjson.gz']);
    await maintenance.close(2_000);
  });

  it('validates safe mechanism-only policy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-policy-'));

    await expect(createLocalFileRoll(policy(directory, { fileName: '../audit.ndjson' }))).rejects.toThrow('safe base name');
    await expect(createLocalFileRoll(policy(directory, { maxFileSizeMiB: 0 }))).rejects.toThrow('positive');
    await expect(createLocalFileRoll(policy(directory, { retentionDays: 0 }))).rejects.toThrow('positive');
    await expect(createLocalFileRoll(policy(directory, { maxArchiveFiles: 0 }))).rejects.toThrow('positive');
    await expect(createLocalFileRoll(policy(directory, { bufferCapacityBytes: 0 }))).rejects.toThrow('positive');
  });

  it('enqueues complete lines without waiting and exposes the transport-owned active identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-append-'));
    const handle = await createLocalFileRoll(policy(directory));
    openHandles.push(handle);

    const startedAt = performance.now();
    expect(handle.appendLine('{"event":"ready"}\n')).toEqual({ status: 'accepted' });
    expect(performance.now() - startedAt).toBeLessThan(50);
    expect(handle.appendLine('not-a-complete-line')).toEqual({ status: 'dropped', reason: 'invalid_line' });
    const active = handle.activeIdentity();
    expect(active?.file).toMatch(/nextagent-test\.\d+\.ndjson$/u);

    await handle.flush(2_000);
    expect(readFileSync(active!.file, 'utf8')).toBe('{"event":"ready"}\n');
  });

  it('reconciles an owned closed source into an atomic gzip archive', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-reconcile-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);
    const source = join(directory, 'nextagent-test.100.ndjson');
    writeFileSync(source, '{"sequence":1}\n', 'utf8');
    const closedAt = new Date(Date.now() - 60_000);
    utimesSync(source, closedAt, closedAt);

    await harness.runMaintenance();

    const archive = `${source}.gz`;
    expect(existsSync(source)).toBe(false);
    expect(existsSync(`${archive}.tmp`)).toBe(false);
    expect(gunzipSync(readFileSync(archive)).toString('utf8')).toBe('{"sequence":1}\n');
    expect(Math.abs(statSync(archive).mtimeMs - closedAt.getTime())).toBeLessThan(2_000);
  });

  it('ages only expired owned archives and preserves unknown files and symlinks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-retention-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);
    const expired = join(directory, 'nextagent-test.100.ndjson.gz');
    const young = join(directory, 'nextagent-test.101.ndjson.gz');
    const unknown = join(directory, 'nextagent-audit.1.ndjson.gz');
    writeFileSync(expired, gzipSync('expired\n'));
    writeFileSync(young, gzipSync('young\n'));
    writeFileSync(unknown, gzipSync('unknown\n'));
    const expiredAt = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    utimesSync(expired, expiredAt, expiredAt);
    const symlink = join(directory, 'nextagent-test.102.ndjson.gz');
    let symlinkCreated = false;
    try {
      if (process.platform === 'win32') {
        symlinkSync(unknown, symlink, 'file');
      } else {
        symlinkSync(unknown, symlink);
      }
      symlinkCreated = true;
    } catch {
      // Windows may require developer mode for symlink creation.
    }

    await harness.runMaintenance();

    expect(existsSync(expired)).toBe(false);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(unknown)).toBe(true);
    if (symlinkCreated) {
      expect(readdirSync(directory)).toContain('nextagent-test.102.ndjson.gz');
    }
  });

  it('keeps only the configured number of committed owned archives using deterministic oldest-first ordering', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-archive-count-'));
    const harness = await createLocalFileRollTestHarness(policy(directory, { maxArchiveFiles: 10 }));
    openHandles.push(harness.handle);
    const sameClosedAt = new Date(Date.now() - 60_000);
    const ownedArchives = Array.from({ length: 11 }, (_, index) => join(directory, `nextagent-test.${String(100 + index)}.ndjson.gz`));
    for (const archive of ownedArchives) {
      writeFileSync(archive, gzipSync(`${archive}\n`));
      utimesSync(archive, sameClosedAt, sameClosedAt);
    }
    const crossFamilyArchive = join(directory, 'nextagent-audit.1.ndjson.gz');
    writeFileSync(crossFamilyArchive, gzipSync('audit\n'));
    utimesSync(crossFamilyArchive, sameClosedAt, sameClosedAt);
    const sourceWithCommittedArchive = join(directory, 'nextagent-test.110.ndjson');
    writeFileSync(sourceWithCommittedArchive, 'source copy\n', 'utf8');

    await harness.runMaintenance(false);

    expect(existsSync(ownedArchives[0]!)).toBe(false);
    expect(ownedArchives.slice(1).every((archive) => existsSync(archive))).toBe(true);
    expect(existsSync(sourceWithCommittedArchive)).toBe(true);
    expect(existsSync(crossFamilyArchive)).toBe(true);
  });

  it('applies elapsed retention and archive count as independent cleanup conditions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-combined-retention-'));
    const harness = await createLocalFileRollTestHarness(policy(directory, { maxArchiveFiles: 2 }));
    openHandles.push(harness.handle);
    const expired = join(directory, 'nextagent-test.100.ndjson.gz');
    const oldestYoung = join(directory, 'nextagent-test.101.ndjson.gz');
    const newestYoung = join(directory, 'nextagent-test.102.ndjson.gz');
    for (const archive of [expired, oldestYoung, newestYoung]) {
      writeFileSync(archive, gzipSync(`${archive}\n`));
    }
    const now = Date.now();
    utimesSync(expired, new Date(now - 8 * 24 * 60 * 60_000), new Date(now - 8 * 24 * 60 * 60_000));
    utimesSync(oldestYoung, new Date(now - 120_000), new Date(now - 120_000));
    utimesSync(newestYoung, new Date(now - 60_000), new Date(now - 60_000));

    await harness.runMaintenance(true);

    expect(existsSync(expired)).toBe(false);
    expect(existsSync(oldestYoung)).toBe(true);
    expect(existsSync(newestYoung)).toBe(true);
  });

  it('preserves an excess archive after count cleanup failure and retries it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-archive-count-failure-'));
    let deletionFails = true;
    const harness = await createLocalFileRollTestHarness(policy(directory, { maxArchiveFiles: 2 }), {
      removeOwnedFile: async (file) => {
        if (deletionFails) {
          return 'failed';
        }
        rmSync(file);
        return 'completed';
      },
    });
    openHandles.push(harness.handle);
    const archives = Array.from({ length: 3 }, (_, index) => join(directory, `nextagent-test.${100 + index}.ndjson.gz`));
    for (const [index, archive] of archives.entries()) {
      writeFileSync(archive, gzipSync(`${archive}\n`));
      const closedAt = new Date(Date.now() - (3 - index) * 60_000);
      utimesSync(archive, closedAt, closedAt);
    }
    const maintenanceEvents: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] extends (event: infer T) => void ? T[] : never = [];
    harness.handle.setMaintenanceEventListener((event) => maintenanceEvents.push(event));

    await harness.runMaintenance(false);
    expect(archives.every((archive) => existsSync(archive))).toBe(true);
    expect(maintenanceEvents).toEqual([{ operation: 'retention', outcome: 'failed', affectedCount: 1 }]);

    deletionFails = false;
    await harness.runMaintenance(false);
    expect(existsSync(archives[0]!)).toBe(false);
    expect(archives.slice(1).every((archive) => existsSync(archive))).toBe(true);
    expect(maintenanceEvents).toEqual([
      { operation: 'retention', outcome: 'failed', affectedCount: 1 },
      { operation: 'retention', outcome: 'completed', affectedCount: 1 },
    ]);
  });

  it('recreates the active log file when it is deleted at runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-recover-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);

    expect(handle.appendLine('{"event":"before"}\n')).toEqual({ status: 'accepted' });
    await handle.flush(2_000);
    const activeFile = handle.activeIdentity()!.file;
    expect(existsSync(activeFile)).toBe(true);

    try {
      rmSync(activeFile);
    } catch {
      // Windows may prevent deletion of an open file — skip this scenario.
      return;
    }
    expect(existsSync(activeFile)).toBe(false);

    await harness.runMaintenance(false);

    const recoveredFile = handle.activeIdentity()!.file;
    expect(existsSync(recoveredFile)).toBe(true);

    expect(handle.appendLine('{"event":"after"}\n')).toEqual({ status: 'accepted' });
    await handle.flush(2_000);
    expect(readFileSync(recoveredFile, 'utf8')).toBe('{"event":"after"}\n');
  });

  it('triggers recovery on the next appendLine without waiting for maintenance scan', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-write-recover-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);

    expect(handle.appendLine('{"event":"before"}\n')).toEqual({ status: 'accepted' });
    await handle.flush(2_000);
    const activeFile = handle.activeIdentity()!.file;

    try {
      rmSync(activeFile);
    } catch {
      return;
    }

    expect(handle.appendLine('{"event":"dropped"}\n')).toEqual({ status: 'dropped', reason: 'buffer_full' });

    const recoveredFile = await waitForActiveFileExists(handle, 2_000);
    expect(handle.appendLine('{"event":"after"}\n')).toEqual({ status: 'accepted' });
    await handle.flush(2_000);
    expect(readFileSync(recoveredFile, 'utf8')).toBe('{"event":"after"}\n');
  });

  it('uses date-sequence naming and closes idempotently', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-date-'));
    const handle = await createLocalFileRoll(policy(directory, { naming: 'date-sequence' }));
    openHandles.push(handle);

    expect(handle.activeIdentity()?.file).toMatch(/nextagent-test\.\d{4}-\d{2}-\d{2}\.\d+\.ndjson$/u);
    await expect(Promise.all([handle.close(2_000), handle.close(2_000)])).resolves.toEqual([undefined, undefined]);
    expect(handle.appendLine('{}\n')).toEqual({ status: 'dropped', reason: 'closed' });
  });

  it('rotates by size without waiting for archive maintenance', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-size-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);
    const firstActive = handle.activeIdentity()!.file;

    expect(handle.appendLine(`${'x'.repeat(1024 * 1024)}\n`)).toEqual({ status: 'accepted' });
    await handle.flush(5_000);
    const secondActive = await waitForActiveChange(handle, firstActive);

    expect(secondActive).not.toBe(firstActive);
    expect(handle.appendLine('{"after":"rotation"}\n')).toEqual({ status: 'accepted' });
    await handle.flush(5_000);
    await harness.runMaintenance(false);
    expect(existsSync(`${firstActive}.gz`)).toBe(true);
    expect(gunzipSync(readFileSync(`${firstActive}.gz`)).byteLength).toBeGreaterThan(1024 * 1024);
  });

  it('drops a new line when the SonicBoom buffer capacity is full', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-buffer-'));
    const handle = await createLocalFileRoll(policy(directory, { bufferCapacityBytes: 32 }));
    openHandles.push(handle);

    expect(handle.appendLine(`${'x'.repeat(64)}\n`)).toEqual({ status: 'dropped', reason: 'buffer_full' });
    await handle.close(1_000);
  });

  it('preserves the source when archive rename fails or maintenance is aborted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-archive-failure-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);
    const renameFailureSource = join(directory, 'nextagent-test.100.ndjson');
    const maintenanceEvents: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] extends (event: infer T) => void ? T[] : never = [];
    handle.setMaintenanceEventListener((event) => maintenanceEvents.push(event));
    writeFileSync(renameFailureSource, 'rename failure\n', 'utf8');
    mkdirSync(`${renameFailureSource}.gz`);

    await harness.runMaintenance(false);
    expect(existsSync(renameFailureSource)).toBe(true);
    expect(existsSync(`${renameFailureSource}.gz.tmp`)).toBe(false);
    expect(maintenanceEvents).toEqual([{ operation: 'archive', outcome: 'failed', affectedCount: 1 }]);

    rmSync(`${renameFailureSource}.gz`, { recursive: true });
    await harness.runMaintenance(false);
    expect(maintenanceEvents).toEqual([
      { operation: 'archive', outcome: 'failed', affectedCount: 1 },
      { operation: 'archive', outcome: 'completed', affectedCount: 1 },
    ]);

    const abortedSource = join(directory, 'nextagent-test.101.ndjson');
    writeFileSync(abortedSource, 'aborted\n', 'utf8');
    const controller = new AbortController();
    controller.abort();
    await harness.runMaintenance(false, controller.signal);
    expect(existsSync(abortedSource)).toBe(true);
    expect(existsSync(`${abortedSource}.gz`)).toBe(false);
  });

  it('reconciles stale temp idempotently and conservatively preserves source/archive coexistence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-idempotent-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    const handle = harness.handle;
    openHandles.push(handle);
    const staleTemp = join(directory, 'nextagent-test.100.ndjson.gz.tmp');
    writeFileSync(staleTemp, 'stale', 'utf8');
    const source = join(directory, 'nextagent-test.101.ndjson');
    const archive = `${source}.gz`;
    writeFileSync(source, 'source\n', 'utf8');
    writeFileSync(archive, gzipSync('archive\n'));

    await Promise.all(Array.from({ length: 5 }, () => harness.runMaintenance()));
    await harness.runMaintenance();

    expect(existsSync(staleTemp)).toBe(false);
    expect(existsSync(source)).toBe(true);
    expect(gunzipSync(readFileSync(archive)).toString('utf8')).toBe('archive\n');
  });

  it('preserves a closed source when temporary gzip output cannot be created', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-gzip-failure-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    openHandles.push(harness.handle);
    const source = join(directory, 'nextagent-test.103.ndjson');
    writeFileSync(source, 'first\nsecond\n', 'utf8');
    mkdirSync(`${source}.gz.tmp`);

    await harness.runMaintenance(false);

    expect(readFileSync(source, 'utf8')).toBe('first\nsecond\n');
    expect(existsSync(`${source}.gz`)).toBe(false);
  });

  it('isolates exact selectors and maintenance failure across three independent handles', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-three-handles-'));
    const operational = await createLocalFileRollTestHarness(policy(directory, { fileName: 'nextagent-operational.jsonl' }));
    const metrics = await createLocalFileRollTestHarness(policy(directory, { fileName: 'nextagent-metrics.ndjson', naming: 'date-sequence' }));
    const audit = await createLocalFileRollTestHarness(policy(directory, { fileName: 'nextagent-audit.ndjson', naming: 'date-sequence' }));
    openHandles.push(operational.handle, metrics.handle, audit.handle);
    const operationalSource = join(directory, 'nextagent-operational.100.jsonl');
    const metricsSource = join(directory, 'nextagent-metrics.2026-07-15.100.ndjson');
    const auditSource = join(directory, 'nextagent-audit.2026-07-15.100.ndjson');
    writeFileSync(operationalSource, 'operational\n', 'utf8');
    writeFileSync(metricsSource, 'metrics\n', 'utf8');
    writeFileSync(auditSource, 'audit\n', 'utf8');
    mkdirSync(`${auditSource}.gz`);

    await Promise.all([operational.runMaintenance(false), metrics.runMaintenance(false), audit.runMaintenance(false)]);

    expect(gunzipSync(readFileSync(`${operationalSource}.gz`)).toString('utf8')).toBe('operational\n');
    expect(gunzipSync(readFileSync(`${metricsSource}.gz`)).toString('utf8')).toBe('metrics\n');
    expect(readFileSync(auditSource, 'utf8')).toBe('audit\n');
    expect(existsSync(join(directory, 'nextagent-audit.100.ndjson.gz'))).toBe(false);
    expect(existsSync(join(directory, 'nextagent-metrics.100.ndjson.gz'))).toBe(false);
  });

  it('ages an expired closed source by elapsed time without touching another family', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-source-retention-'));
    const harness = await createLocalFileRollTestHarness(policy(directory));
    openHandles.push(harness.handle);
    const expiredSource = join(directory, 'nextagent-test.100.ndjson');
    const developerTrace = join(directory, 'nextagent-developer-trace.100.ndjson');
    writeFileSync(expiredSource, 'expired\n', 'utf8');
    writeFileSync(developerTrace, 'preserved\n', 'utf8');
    const expiredAt = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    utimesSync(expiredSource, expiredAt, expiredAt);
    utimesSync(developerTrace, expiredAt, expiredAt);

    await harness.runMaintenance(true);

    expect(existsSync(expiredSource)).toBe(false);
    expect(readFileSync(developerTrace, 'utf8')).toBe('preserved\n');
  });

  it('uses elapsed 24-hour retention across a daylight-saving calendar', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers();
    try {
      const now = new Date('2026-03-15T04:00:00.000Z');
      vi.setSystemTime(now);
      const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-dst-retention-'));
      const harness = await createLocalFileRollTestHarness(policy(directory));
      const handle = harness.handle;
      openHandles.push(handle);
      const archive = join(directory, 'nextagent-test.100.ndjson.gz');
      writeFileSync(archive, gzipSync('retained\n'));
      const notYetExpired = new Date(now.getTime() - 7 * 24 * 60 * 60_000 + 1);
      utimesSync(archive, notYetExpired, notYetExpired);

      await harness.runMaintenance();
      expect(existsSync(archive)).toBe(true);
      vi.setSystemTime(new Date(now.getTime() + 1));
      await harness.runMaintenance();
      expect(existsSync(archive)).toBe(false);
      await handle.close(1_000);
    } finally {
      vi.useRealTimers();
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it.each([
    ['23-hour spring day', '2026-03-08T05:00:00.000Z', 22 * 60 + 59, 2],
    ['25-hour autumn day', '2026-11-01T04:00:00.000Z', 24 * 60, 61],
  ] as const)('rotates at local midnight on a %s', async (_name, startIso, minutesBeforeBoundary, minutesAcrossBoundary) => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(startIso));
      const directory = mkdtempSync(join(tmpdir(), 'nextagent-roll-dst-daily-'));
      const harness = await createLocalFileRollTestHarness(policy(directory, { naming: 'date-sequence' }));
      const handle = harness.handle;
      openHandles.push(handle);
      const firstActive = handle.activeIdentity()!.file;

      await vi.advanceTimersByTimeAsync(minutesBeforeBoundary * 60_000);
      expect(handle.activeIdentity()!.file).toBe(firstActive);
      await vi.advanceTimersByTimeAsync(minutesAcrossBoundary * 60_000);
      expect(handle.activeIdentity()!.file).not.toBe(firstActive);

      const closing = handle.close(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await closing;
    } finally {
      vi.useRealTimers();
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });
});

function policy(directory: string, overrides: Partial<Parameters<typeof createLocalFileRoll>[0]> = {}): Parameters<typeof createLocalFileRoll>[0] {
  return {
    directory,
    fileName: 'nextagent-test.ndjson',
    naming: 'sequence',
    maxFileSizeMiB: 1,
    retentionDays: 7,
    bufferCapacityBytes: 4 * 1024 * 1024,
    ...overrides,
  };
}

async function waitForActiveChange(handle: LocalFileRollHandle, previous: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = handle.activeIdentity()?.file;
    if (current !== undefined && current !== previous) {
      return current;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('Local file did not rotate before the test deadline.');
}

async function waitForActiveFileExists(handle: LocalFileRollHandle, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = handle.activeIdentity()?.file;
    if (current !== undefined && existsSync(current)) {
      return current;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('Active file was not recreated before the test deadline.');
}

async function waitForPathExists(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`File did not appear before the test deadline: ${file}`);
}
