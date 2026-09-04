import type { LocalFileRollHandle, LocalFileRollPolicy } from '@nextagent/agent-local-file-roll';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeveloperDiagnosticArtifactWriter, developerDiagnosticArtifactFilePolicy } from '../src/index.js';
import { createDeveloperDiagnosticArtifactWriterForTesting } from '../src/testing.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('developer diagnostic artifact writer', () => {
  it('keeps a zero-record lifecycle free of physical files', async () => {
    const directory = tempDirectory();
    const writer = createDeveloperDiagnosticArtifactWriter({ logDirectory: directory });

    await writer.start();
    expect(writer.status()).toEqual({ availability: 'AVAILABLE', droppedCount: 0 });
    await writer.flush(2_000);
    await writer.close();

    expect(readdirSync(directory)).toEqual([]);
  });

  it('maintains historical files without creating an active segment', async () => {
    const directory = tempDirectory();
    const source = join(directory, 'nextagent-plugin-diagnostic.2026-08-13.1.ndjson');
    writeFileSync(source, '{"historical":true}\n', 'utf8');
    const writer = createDeveloperDiagnosticArtifactWriter({ logDirectory: directory });

    await writer.start();
    await waitForPathExists(`${source}.gz`, 2_000);
    await writer.close();

    expect(readdirSync(directory)).toEqual(['nextagent-plugin-diagnostic.2026-08-13.1.ndjson.gz']);
  });

  it('writes a manifest-bound record to the independent fixed file family', async () => {
    const directory = tempDirectory();
    const writer = createDeveloperDiagnosticArtifactWriter({
      logDirectory: directory,
      now: () => new Date('2026-07-30T10:00:00.000Z'),
    });

    await expect(writer.emit(record())).resolves.toEqual({ status: 'ACCEPTED' });
    await writer.flush(2_000);

    const entries = readdirSync(directory);
    expect(entries).not.toContain('developer-diagnostics');
    const active = entries.find((name) => /^nextagent-plugin-diagnostic\.\d{4}-\d{2}-\d{2}\.\d+\.ndjson$/u.test(name));
    expect(active).toBeDefined();
    expect(JSON.parse(readFileSync(join(directory, active!), 'utf8').trim())).toEqual({
      schemaVersion: 1,
      recordedAt: '2026-07-30T10:00:00.000Z',
      pluginId: 'context-monitor',
      artifactType: 'context-evolution.terminal',
      sessionId: 'session-1',
      payload: { answer: 'raw developer evidence' },
    });
    expect(writer.status()).toEqual({ availability: 'AVAILABLE', droppedCount: 0 });
    await writer.close();
  });

  it('owns the fixed capacity and retention policy', () => {
    const directory = tempDirectory();
    expect(developerDiagnosticArtifactFilePolicy(directory)).toEqual({
      directory,
      fileName: 'nextagent-plugin-diagnostic.ndjson',
      naming: 'date-sequence',
      maxFileSizeMiB: 30,
      retentionDays: 3,
      maxArchiveFiles: 10,
      bufferCapacityBytes: 8 * 1024 * 1024,
    });
  });

  it('rejects invalid JSON and oversized records before enqueue', async () => {
    const directory = tempDirectory();
    const writer = createDeveloperDiagnosticArtifactWriter({ logDirectory: directory });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    await expect(writer.emit({ ...record(), payload: cyclic })).resolves.toEqual({
      status: 'DROPPED',
      reasonCode: 'INVALID_RECORD',
    });
    await expect(writer.emit({ ...record(), payload: 'x'.repeat(4 * 1024 * 1024) })).resolves.toEqual({
      status: 'DROPPED',
      reasonCode: 'RECORD_TOO_LARGE',
    });
    expect(readdirSync(directory)).toEqual([]);
    expect(writer.status()).toEqual({
      availability: 'DEGRADED',
      droppedCount: 2,
      lastFailureCode: 'RECORD_TOO_LARGE',
    });
  });

  it('writes concurrent first records through one active segment', async () => {
    const directory = tempDirectory();
    const writer = createDeveloperDiagnosticArtifactWriter({ logDirectory: directory });

    await writer.start();
    await expect(Promise.all([writer.emit(record()), writer.emit(record())])).resolves.toEqual([{ status: 'ACCEPTED' }, { status: 'ACCEPTED' }]);
    await writer.flush(2_000);
    const activeFiles = readdirSync(directory).filter((name) => name.endsWith('.ndjson'));
    expect(activeFiles).toHaveLength(1);
    expect(readFileSync(join(directory, activeFiles[0]!), 'utf8').trim().split('\n')).toHaveLength(2);
    await writer.close();
  });

  it('does not create files when emit follows close', async () => {
    const directory = tempDirectory();
    const writer = createDeveloperDiagnosticArtifactWriter({ logDirectory: directory });

    await writer.start();
    await writer.close();
    await expect(writer.emit(record())).resolves.toEqual({ status: 'DROPPED', reasonCode: 'OUTPUT_UNAVAILABLE' });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    await expect(writer.emit({ ...record(), payload: cyclic })).resolves.toEqual({
      status: 'DROPPED',
      reasonCode: 'OUTPUT_UNAVAILABLE',
    });
    expect(readdirSync(directory)).toEqual([]);
  });

  it('maps bounded queue overload and recovers availability on the next accepted enqueue', async () => {
    const appendLine = vi.fn().mockReturnValueOnce({ status: 'dropped', reason: 'buffer_full' }).mockReturnValueOnce({ status: 'accepted' });
    const writer = createDeveloperDiagnosticArtifactWriterForTesting({ logDirectory: tempDirectory() }, async () => testHandle({ appendLine }));

    await expect(writer.emit(record())).resolves.toEqual({ status: 'DROPPED', reasonCode: 'QUEUE_OVERLOADED' });
    expect(writer.status()).toEqual({
      availability: 'DEGRADED',
      droppedCount: 1,
      lastFailureCode: 'QUEUE_OVERLOADED',
    });
    await expect(writer.emit(record())).resolves.toEqual({ status: 'ACCEPTED' });
    expect(writer.status()).toEqual({
      availability: 'AVAILABLE',
      droppedCount: 1,
      lastFailureCode: 'QUEUE_OVERLOADED',
    });
  });

  it('contains malformed runtime coordinates and unexpected handle throws', async () => {
    const writer = createDeveloperDiagnosticArtifactWriterForTesting({ logDirectory: tempDirectory() }, async () =>
      testHandle({
        appendLine() {
          throw new Error('append-throw-canary');
        },
      }),
    );

    await expect(writer.emit({ ...record(), sessionId: 123 as never })).resolves.toEqual({
      status: 'DROPPED',
      reasonCode: 'INVALID_RECORD',
    });
    await expect(writer.emit(record())).resolves.toEqual({
      status: 'DROPPED',
      reasonCode: 'OUTPUT_UNAVAILABLE',
    });
  });

  it('contains unavailable destinations without throwing', async () => {
    const unavailable = createDeveloperDiagnosticArtifactWriterForTesting({ logDirectory: tempDirectory() }, async () => {
      throw new Error('forbidden-init-error-canary');
    });
    await unavailable.start();
    expect(await unavailable.emit(record())).toEqual({ status: 'DROPPED', reasonCode: 'OUTPUT_UNAVAILABLE' });
    expect(unavailable.status()).toEqual({
      availability: 'DEGRADED',
      droppedCount: 1,
      lastFailureCode: 'OUTPUT_UNAVAILABLE',
    });
  });

  it('degrades on maintenance failure and closes idempotently', async () => {
    let maintenanceListener: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] | undefined;
    const close = vi.fn(async () => undefined);
    const policies: LocalFileRollPolicy[] = [];
    const writer = createDeveloperDiagnosticArtifactWriterForTesting({ logDirectory: tempDirectory() }, async (policy) => {
      policies.push(policy);
      return testHandle({
        close,
        setMaintenanceEventListener(listener) {
          maintenanceListener = listener;
        },
      });
    });
    await expect(writer.emit(record())).resolves.toEqual({ status: 'ACCEPTED' });

    maintenanceListener?.({ operation: 'retention', outcome: 'failed', affectedCount: 1 });
    expect(writer.status()).toMatchObject({
      availability: 'DEGRADED',
      lastFailureCode: 'OUTPUT_UNAVAILABLE',
    });
    await Promise.all([writer.close(25), writer.close(25)]);
    expect(policies).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(25);
  });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nextagent-developer-diagnostic-'));
  directories.push(directory);
  return directory;
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

function record() {
  return {
    pluginId: 'context-monitor',
    artifactType: 'context-evolution.terminal',
    sessionId: 'session-1',
    payload: { answer: 'raw developer evidence' },
  };
}

function testHandle(overrides: Partial<LocalFileRollHandle>): LocalFileRollHandle {
  return {
    appendLine: () => ({ status: 'accepted' }),
    activeIdentity: () => undefined,
    setMaintenanceEventListener: () => undefined,
    flush: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}
