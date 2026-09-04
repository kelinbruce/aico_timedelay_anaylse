import { brand } from '@nextagent/agent-common';
import type { BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileDownloadRuntime,
  DownloadConcurrencyLimiter,
  DownloadTempSizeGuard,
  extractLastSegment,
  sanitizeDownloadFileName,
  MAX_DOWNLOAD_CONCURRENCY,
  type DownloadAuditEvent,
  type FileDownloadRuntime,
} from '../src/file-download-runtime.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-download'),
  subjectId: brand<string, 'SubjectId'>('subject-download'),
  displayName: 'Download test',
};

describe('createFileDownloadRuntime', () => {
  it('materializes a HOFS object to a request-scoped temp file', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['aicoservice/answer/sess1/run1/result.xlsx', Buffer.from('excel-bytes')]]));
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
    });
    const result = await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-001'),
      sessionId: 'sess-001',
      objectName: 'aicoservice/answer/sess1/run1/result.xlsx',
      downloadId: 'dl-001',
    });
    expect(result.safeFileName).toBe('result.xlsx');
    expect(result.sizeBytes).toBe('excel-bytes'.length);
    await expect(readFile(result.localFilePath, 'utf-8')).resolves.toBe('excel-bytes');
  });

  it('cleans up the temp directory on cleanup', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['a/path/file.txt', Buffer.from('content')]]));
    const runtime = createFileDownloadRuntime({ blobStore, downloadTempDir: tempDir });
    const result = await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-001'),
      sessionId: 'sess-001',
      objectName: 'a/path/file.txt',
      downloadId: 'dl-002',
    });
    await expect(access(result.localFilePath)).resolves.toBeUndefined();
    await runtime.cleanup({ downloadId: 'dl-002' });
    await expect(access(result.localFilePath)).rejects.toThrow();
  });

  it('removes the temp directory when materialize fails', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map());
    const runtime = createFileDownloadRuntime({ blobStore, downloadTempDir: tempDir });
    await expect(
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'missing/file.txt',
        downloadId: 'dl-003',
      }),
    ).rejects.toThrow('Download blob is unavailable.');
    await expect(access(join(tempDir, 'dl-003'))).rejects.toThrow();
  });

  it('rejects a known oversized blob before materialization', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    let materializeCalls = 0;
    const blobStore = createBlobStore(new Map([['a/path/large.bin', Buffer.alloc(101)]]), () => {
      materializeCalls += 1;
    });
    const runtime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      sizeGuard: new DownloadTempSizeGuard(100),
    });

    await expect(
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'a/path/large.bin',
        downloadId: 'dl-capacity',
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TEMP_CAPACITY_EXCEEDED' });
    expect(materializeCalls).toBe(0);
  });

  it('allows only one concurrent materialization within the shared cap', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    let materializeCalls = 0;
    const blobStore = createBlobStore(new Map([['a/path/file.bin', Buffer.alloc(60)]]), () => {
      materializeCalls += 1;
    });
    const sizeGuard = new DownloadTempSizeGuard(100);
    const runtime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      sizeGuard,
    });

    const results = await Promise.allSettled([
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'a/path/file.bin',
        downloadId: 'dl-concurrent-1',
      }),
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'a/path/file.bin',
        downloadId: 'dl-concurrent-2',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(materializeCalls).toBe(1);
    expect(sizeGuard.currentSize).toBe(60);
    const fulfilled = results.find((result) => result.status === 'fulfilled');
    if (fulfilled?.status !== 'fulfilled') {
      throw new Error('Expected one materialized download.');
    }
    await runtime.cleanup({
      downloadId: fulfilled.value.localFilePath.includes('dl-concurrent-1') ? 'dl-concurrent-1' : 'dl-concurrent-2',
    });
    expect(sizeGuard.currentSize).toBe(0);
  });

  it('removes a materialized file when metadata is unavailable and actual size exceeds the cap', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    let materializeCalls = 0;
    const sizeGuard = new DownloadTempSizeGuard(100);
    const blobStore = createBlobStore(
      new Map([['a/path/unmetered.bin', Buffer.alloc(101)]]),
      () => {
        materializeCalls += 1;
      },
      false,
    );
    const runtime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      sizeGuard,
    });

    await expect(
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'a/path/unmetered.bin',
        downloadId: 'dl-unmetered',
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TEMP_CAPACITY_EXCEEDED' });
    expect(materializeCalls).toBe(1);
    expect(sizeGuard.currentSize).toBe(0);
    await expect(access(join(tempDir, 'dl-unmetered'))).rejects.toThrow();
  });
});

describe('DownloadTempSizeGuard', () => {
  it('reserves capacity up to the configured limit', () => {
    const guard = new DownloadTempSizeGuard(1024);
    expect(guard.tryReserve(1024)).toBe(true);
    expect(guard.currentSize).toBe(1024);
  });

  it('rejects reservations that would exceed the limit', () => {
    const guard = new DownloadTempSizeGuard(100);
    expect(guard.tryReserve(80)).toBe(true);
    expect(guard.tryReserve(21)).toBe(false);
    expect(guard.currentSize).toBe(80);
    guard.recordCleaned(80);
    expect(guard.currentSize).toBe(0);
  });
});

describe('extractLastSegment', () => {
  it('extracts the last segment of a HOFS object name', () => {
    expect(extractLastSegment('aicoservice/answer/sess1/run1/result.xlsx')).toBe('result.xlsx');
    expect(extractLastSegment('simple.txt')).toBe('simple.txt');
  });

  it('handles backslash separators', () => {
    expect(extractLastSegment('a\\b\\c.txt')).toBe('c.txt');
  });

  it('returns a fallback for empty segments', () => {
    expect(extractLastSegment('a/b/')).toBe('file');
    expect(extractLastSegment('')).toBe('file');
  });
});

describe('sanitizeDownloadFileName', () => {
  it('removes null bytes', () => {
    expect(sanitizeDownloadFileName('file\0.txt')).toBe('file.txt');
  });
});

function createBlobStore(blobs: ReadonlyMap<string, Buffer>, onMaterialize?: () => void, provideMetadata = true): BlobStoreGateway {
  return {
    async storeBlob() {
      throw new Error('not used');
    },
    async loadBlob() {
      return undefined;
    },
    async materializeBlob(request) {
      onMaterialize?.();
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
    async getBlobMetadata(request) {
      if (!provideMetadata) {
        return undefined;
      }
      const content = blobs.get(request.blobRef);
      return content === undefined
        ? undefined
        : {
            blobRef: request.blobRef,
            contentLength: content.length,
            lastModified: brand<number, 'EpochMillis'>(0),
          };
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

describe('DownloadAuditEvent', () => {
  it('emits a SUCCESS audit event on successful materialize', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['a/path/report.csv', Buffer.from('hello')]]));
    const auditEvents: DownloadAuditEvent[] = [];
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      auditObserver: (event) => auditEvents.push(event),
    });
    const result = await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-001'),
      sessionId: 'sess-001',
      objectName: 'a/path/report.csv',
      downloadId: 'dl-audit-1',
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.result).toBe('SUCCESS');
    expect(auditEvents[0]!.userId).toBe('subject-download');
    expect(auditEvents[0]!.tenantId).toBe('tenant-download');
    expect(auditEvents[0]!.agentId).toBe('agent-001');
    expect(auditEvents[0]!.sessionId).toBe('sess-001');
    expect(auditEvents[0]!.objectName).toBe('a/path/report.csv');
    expect(auditEvents[0]!.sizeBytes).toBe(result.sizeBytes);
    expect(auditEvents[0]!.downloadId).toBe('dl-audit-1');
    expect(auditEvents[0]!.timestamp).toBeTypeOf('number');
  });

  it('emits a FAILURE audit event with reasonCode on failed materialize', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map());
    const auditEvents: DownloadAuditEvent[] = [];
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      auditObserver: (event) => auditEvents.push(event),
    });
    await expect(
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'missing/file.txt',
        downloadId: 'dl-audit-2',
      }),
    ).rejects.toThrow('Download blob is unavailable.');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.result).toBe('FAILURE');
    expect(auditEvents[0]!.reasonCode).toBe('DOWNLOAD_BLOB_UNAVAILABLE');
    expect(auditEvents[0]!.agentId).toBe('agent-001');
    expect(auditEvents[0]!.objectName).toBe('missing/file.txt');
    expect(auditEvents[0]!.downloadId).toBe('dl-audit-2');
  });

  it('emits a FAILURE audit event on capacity exceeded without materializing', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    let materializeCalls = 0;
    const blobStore = createBlobStore(new Map([['a/path/large.bin', Buffer.alloc(101)]]), () => {
      materializeCalls += 1;
    });
    const auditEvents: DownloadAuditEvent[] = [];
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      sizeGuard: new DownloadTempSizeGuard(100),
      auditObserver: (event) => auditEvents.push(event),
    });
    await expect(
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'a/path/large.bin',
        downloadId: 'dl-audit-3',
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TEMP_CAPACITY_EXCEEDED' });
    expect(materializeCalls).toBe(0);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.result).toBe('FAILURE');
    expect(auditEvents[0]!.reasonCode).toBe('DOWNLOAD_TEMP_CAPACITY_EXCEEDED');
  });

  it('does not include file content, local path, or credentials in the audit event', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['a/path/secret.csv', Buffer.from('password123')]]));
    const auditEvents: DownloadAuditEvent[] = [];
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      auditObserver: (event) => auditEvents.push(event),
    });
    await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-001'),
      sessionId: 'sess-001',
      objectName: 'a/path/secret.csv',
      downloadId: 'dl-audit-4',
    });
    const event = auditEvents[0]!;
    expect(event).toBeDefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('password123');
    expect(serialized).not.toContain(tempDir);
    expect('localFilePath' in event).toBe(false);
  });
});

describe('DownloadConcurrencyLimiter', () => {
  it('allows up to 4 concurrent downloads', () => {
    const limiter = new DownloadConcurrencyLimiter();
    expect(limiter.acquire()).resolves.toBeUndefined();
    expect(limiter.acquire()).resolves.toBeUndefined();
    expect(limiter.acquire()).resolves.toBeUndefined();
    expect(limiter.acquire()).resolves.toBeUndefined();
    expect(limiter.activeCount).toBe(MAX_DOWNLOAD_CONCURRENCY);
  });

  it('waits when 4 slots are full', async () => {
    const limiter = new DownloadConcurrencyLimiter();
    for (let i = 0; i < MAX_DOWNLOAD_CONCURRENCY; i++) {
      await limiter.acquire();
    }
    let acquired = false;
    const promise = limiter.acquire().then(() => {
      acquired = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(acquired).toBe(false);
    limiter.release();
    await promise;
    expect(acquired).toBe(true);
  });

  it('releases correctly', async () => {
    const limiter = new DownloadConcurrencyLimiter();
    await limiter.acquire();
    expect(limiter.activeCount).toBe(1);
    limiter.release();
    expect(limiter.activeCount).toBe(0);
  });

  it('releases a slot after materialize completes (success)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['a/path/file.bin', Buffer.from('data')]]));
    const limiter = new DownloadConcurrencyLimiter();
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      concurrencyLimiter: limiter,
    });
    await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-001'),
      sessionId: 'sess-001',
      objectName: 'a/path/file.bin',
      downloadId: 'dl-conc-1',
    });
    expect(limiter.activeCount).toBe(0);
  });

  it('releases a slot after materialize completes (failure)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map());
    const limiter = new DownloadConcurrencyLimiter();
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      concurrencyLimiter: limiter,
    });
    await expect(
      runtime.materialize({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('agent-001'),
        sessionId: 'sess-001',
        objectName: 'missing/file.txt',
        downloadId: 'dl-conc-2',
      }),
    ).rejects.toThrow();
    expect(limiter.activeCount).toBe(0);
  });
});

describe('DownloadAuditEvent negative cases', () => {
  it('agentId in audit event comes from the request, not from objectName/path', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['agent-evil/secret/data.csv', Buffer.from('data')]]));
    const auditEvents: DownloadAuditEvent[] = [];
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      auditObserver: (event) => auditEvents.push(event),
    });
    await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-trusted'),
      sessionId: 'sess-001',
      objectName: 'agent-evil/secret/data.csv',
      downloadId: 'dl-path-1',
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.agentId).toBe('agent-trusted');
    expect(auditEvents[0]!.agentId).not.toBe('agent-evil');
    expect(auditEvents[0]!.objectName).toBe('agent-evil/secret/data.csv');
  });

  it('audit observer throwing does not affect download semantics', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-download-'));
    const blobStore = createBlobStore(new Map([['a/path/file.txt', Buffer.from('content')]]));
    const runtime: FileDownloadRuntime = createFileDownloadRuntime({
      blobStore,
      downloadTempDir: tempDir,
      auditObserver: () => {
        throw new Error('audit sink broken');
      },
    });
    const result = await runtime.materialize({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('agent-001'),
      sessionId: 'sess-001',
      objectName: 'a/path/file.txt',
      downloadId: 'dl-audit-throw',
    });
    expect(result.sizeBytes).toBe('content'.length);
  });
});

describe('DownloadConcurrencyLimiter timeout', () => {
  it('rejects with DOWNLOAD_CONCURRENCY_TIMEOUT after the timeout', async () => {
    const limiter = new DownloadConcurrencyLimiter();
    for (let i = 0; i < MAX_DOWNLOAD_CONCURRENCY; i++) {
      await limiter.acquire();
    }
    // Use fake timers to avoid real 30s wait
    const originalTimeout = setTimeout;
    let timeoutCallback: (() => void) | undefined;
    const fakeSetTimeout = ((callback: () => void, _ms: number) => {
      timeoutCallback = callback;
      return 0 as any;
    }) as any;
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = fakeSetTimeout;
    const promise = limiter.acquire();
    // Simulate timeout firing
    timeoutCallback?.();
    globalThis.setTimeout = originalSetTimeout;
    await expect(promise).rejects.toThrow('DOWNLOAD_CONCURRENCY_TIMEOUT');
  });
});
