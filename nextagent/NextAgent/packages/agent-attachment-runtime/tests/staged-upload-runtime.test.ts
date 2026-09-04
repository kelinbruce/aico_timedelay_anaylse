import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  createAttachmentStagedUploadRuntime,
  validateTempRunId,
  buildTempObjectName,
  buildFormalObjectName,
  matchFileExtension,
  type AttachmentStagedUploadRuntimeDependencies,
} from '../src/staged-upload-runtime.js';
import type { BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { ChatUploadFileConfig } from '../src/chat-upload-config.js';
import type { AttachmentStoreGateway } from '@nextagent/agent-contracts/gateway';
import { brand } from '@nextagent/agent-common';

let tempDir: string;

const defaultConfig: ChatUploadFileConfig = {
  hofsBucketName: '',
  chatUploadFileType: ['*.xlsx', '*.csv', '*.md'],
  chatUploadMaxFileNumber: 10,
  chatUploadMaxFileSize: 10,
  uploadFileIdleExpireTime: 5,
  uploadFileMaxExpireTime: 30,
};

function createMockBlobStoreGateway(): BlobStoreGateway {
  const files = new Map<string, Buffer>();
  return {
    async storeBlob(request: import('@nextagent/agent-contracts/gateway').StoreBlobRequest) {
      const content = await readFile(request.localFilePath);
      files.set(request.blobRef, content);
      return request.blobRef;
    },
    async loadBlob(request: import('@nextagent/agent-contracts/gateway').LoadBlobRequest) {
      const file = files.get(request.blobRef);
      if (file === undefined) {
        return undefined;
      }
      return file;
    },
    async materializeBlob() {
      return false;
    },
    async blobExists(request: import('@nextagent/agent-contracts/gateway').LoadBlobRequest) {
      return files.has(request.blobRef);
    },
    async getBlobMetadata(request: import('@nextagent/agent-contracts/gateway').BlobMetadataRequest) {
      const file = files.get(request.blobRef);
      if (file === undefined) {
        return undefined;
      }
      return {
        blobRef: request.blobRef,
        contentLength: file.length,
        lastModified: brand(Date.now()),
      };
    },
    async copyBlob(request: import('@nextagent/agent-contracts/gateway').CopyBlobRequest) {
      const source = files.get(request.sourceBlob);
      if (source === undefined) {
        throw new Error('Source file not found');
      }
      files.set(request.destinationBlob, source);
      return { blobRef: request.destinationBlob as never, etag: 'test-etag', lastModified: brand(Date.now()) };
    },
    async deleteBlob(request: import('@nextagent/agent-contracts/gateway').DeleteBlobRequest) {
      files.delete(request.blobRef);
      return true;
    },
    async listBlobs(request: import('@nextagent/agent-contracts/gateway').ListBlobsRequest) {
      const matching = Array.from(files.keys()).filter((key) => key.startsWith(request.prefix));
      return { blobs: [], truncated: false };
    },
  };
}

function createMockAttachmentStore(): AttachmentStoreGateway {
  const records: Array<import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord> = [];
  return {
    async saveAttachment(record: import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord) {
      records.push(record);
      return record as import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord;
    },
    async loadAttachment(request: import('@nextagent/agent-contracts/gateway').LoadAttachmentRequest) {
      return records.find((r) => r.attachmentId === request.attachmentId);
    },
    async listAttachmentsByRequestId(request: import('@nextagent/agent-contracts/gateway').ListAttachmentsByRequestIdRequest) {
      return records.filter((r) => r.requestId === request.requestId);
    },
    async listAttachmentsByRunId(request: import('@nextagent/agent-contracts/gateway').ListAttachmentsByRunIdRequest) {
      return records.filter((r) => r.runId === request.runId);
    },
    async listAttachmentsBySession(request: import('@nextagent/agent-contracts/gateway').ListAttachmentsBySessionRequest) {
      return records.filter((r) => r.sessionId === request.sessionId);
    },
    async updateAttachmentStatus(request: import('@nextagent/agent-contracts/gateway').UpdateAttachmentStatusRequest) {
      const record = records.find((r) => r.attachmentId === request.attachmentId);
      if (record !== undefined) {
      }
      return record as import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord;
    },
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'rus-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createService(): ReturnType<typeof createAttachmentStagedUploadRuntime> {
  const deps: AttachmentStagedUploadRuntimeDependencies = {
    blobStore: createMockBlobStoreGateway(),
    attachmentStore: createMockAttachmentStore(),
    uploadTempDir: tempDir,
  };
  return createAttachmentStagedUploadRuntime(deps);
}

function createReadableStream(content: string | Buffer): NodeJS.ReadableStream {
  return Readable.from(Buffer.from(content));
}

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant1'),
  subjectId: brand<string, 'SubjectId'>('user1'),
  displayName: 'Test User',
};

describe('validateTempRunId', () => {
  it('accepts UUID format', () => {
    expect(validateTempRunId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts alphanumeric identifiers', () => {
    expect(validateTempRunId('abc123_-xyz')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(validateTempRunId('../../etc/passwd')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateTempRunId('')).toBe(false);
  });
});

describe('buildTempObjectName', () => {
  it('builds correct temp path', () => {
    const result = buildTempObjectName('user1', 'abc12345-def', 'report.xlsx');
    expect(result).toBe('tmp/user1/abc12345-def/report.xlsx');
  });

  it('throws on path traversal in fileName', () => {
    expect(() => buildTempObjectName('user1', 'abc12345-def', '../passwd.xlsx')).toThrow();
  });

  it('throws on invalid tempRunId', () => {
    expect(() => buildTempObjectName('user1', '../../etc', 'file.xlsx')).toThrow();
  });
});

describe('buildFormalObjectName', () => {
  it('builds correct formal path', () => {
    const result = buildFormalObjectName('session1', 'run1', 'data.csv');
    expect(result).toBe('question/session1/run1/data.csv');
  });
});

describe('matchFileExtension', () => {
  it('matches xlsx', () => {
    expect(matchFileExtension('report.xlsx', ['*.xlsx', '*.csv'])).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(matchFileExtension('Report.XLSX', ['*.xlsx'])).toBe(true);
  });

  it('rejects non-matching extension', () => {
    expect(matchFileExtension('report.pdf', ['*.xlsx', '*.csv'])).toBe(false);
  });

  it('rejects files without extension', () => {
    expect(matchFileExtension('report', ['*.xlsx'])).toBe(false);
  });
});

describe('AttachmentStagedUploadRuntime uploadToTemp', () => {
  it('uploads a valid csv file to temp', async () => {
    const service = createService();
    const result = await service.uploadToTemp({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('default'),
      sessionId: brand<string, 'SessionId'>('session1'),
      tempRunId: 'abc-123-def',
      fileName: 'data.csv',
      config: defaultConfig,
      fileStream: createReadableStream('col1,col2\nval1,val2\n'),
      declaredSizeBytes: 20,
    });
    expect(result.tempRunId).toBe('abc-123-def');
    expect(result.fileName).toBe('data.csv');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('rejects unsupported file type', async () => {
    const service = createService();
    await expect(
      service.uploadToTemp({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        tempRunId: 'abc-123-def',
        fileName: 'report.pdf',
        config: defaultConfig,
        fileStream: createReadableStream('%PDF-1.7 test'),
        declaredSizeBytes: 12,
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid file name', async () => {
    const service = createService();
    await expect(
      service.uploadToTemp({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        tempRunId: 'abc-123-def',
        fileName: '../../etc/passwd.csv',
        config: defaultConfig,
        fileStream: createReadableStream('test'),
        declaredSizeBytes: 4,
      }),
    ).rejects.toThrow();
  });

  it('rejects oversized file', async () => {
    const service = createService();
    await expect(
      service.uploadToTemp({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        tempRunId: 'abc-123-def',
        fileName: 'big.csv',
        config: { ...defaultConfig, chatUploadMaxFileSize: 1 },
        fileStream: createReadableStream('x'.repeat(2 * 1024 * 1024)),
        declaredSizeBytes: 2 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });
});

describe('AttachmentStagedUploadRuntime markdown forced acceptance', () => {
  it('accepts .md file even when chatUploadFileType does not include markdown', async () => {
    const service = createService();
    const pcapOnlyConfig: ChatUploadFileConfig = {
      ...defaultConfig,
      chatUploadFileType: ['*.pcap'],
    };
    const result = await service.uploadToTemp({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('default'),
      sessionId: brand<string, 'SessionId'>('session1'),
      tempRunId: 'abc-123-def',
      fileName: 'notes.md',
      config: pcapOnlyConfig,
      fileStream: createReadableStream('# Hello\n\nThis is markdown.\n'),
      declaredSizeBytes: 30,
    });
    expect(result.fileName).toBe('notes.md');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('accepts .markdown file even when chatUploadFileType does not include markdown', async () => {
    const service = createService();
    const pcapOnlyConfig: ChatUploadFileConfig = {
      ...defaultConfig,
      chatUploadFileType: ['*.pcap'],
    };
    const result = await service.uploadToTemp({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('default'),
      sessionId: brand<string, 'SessionId'>('session1'),
      tempRunId: 'abc-123-def',
      fileName: 'notes.markdown',
      config: pcapOnlyConfig,
      fileStream: createReadableStream('# Hello\n\nThis is markdown.\n'),
      declaredSizeBytes: 30,
    });
    expect(result.fileName).toBe('notes.markdown');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('rejects non-markdown file not in chatUploadFileType', async () => {
    const service = createService();
    const mdOnlyConfig: ChatUploadFileConfig = {
      ...defaultConfig,
      chatUploadFileType: ['*.md', '*.markdown'],
    };
    await expect(
      service.uploadToTemp({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        tempRunId: 'abc-123-def',
        fileName: 'capture.pcap',
        config: mdOnlyConfig,
        fileStream: createReadableStream('\xd4\xc3\xb2\xa1\x02\x00\x04\x00'),
        declaredSizeBytes: 8,
      }),
    ).rejects.toThrow();
  });

  it('rejects .md file with mismatched magic bytes (PDF content)', async () => {
    const service = createService();
    await expect(
      service.uploadToTemp({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        tempRunId: 'abc-123-def',
        fileName: 'fake.md',
        config: defaultConfig,
        fileStream: createReadableStream('%PDF-1.7\nbinary content here'),
        declaredSizeBytes: 28,
      }),
    ).rejects.toThrow();
  });
});

describe('AttachmentStagedUploadRuntime moveToFormal', () => {
  it('moves temp files to formal paths', async () => {
    const service = createService();
    // Upload first
    await service.uploadToTemp({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('default'),
      sessionId: brand<string, 'SessionId'>('session1'),
      tempRunId: 'abc-123-def',
      fileName: 'data.csv',
      config: defaultConfig,
      fileStream: createReadableStream('col1,col2\nval1,val2\n'),
      declaredSizeBytes: 20,
    });
    // Move
    const result = await service.moveToFormal({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('default'),
      sessionId: brand<string, 'SessionId'>('session1'),
      requestId: brand<string, 'MessageId'>('req1'),
      runId: brand<string, 'RequestRunId'>('run1'),
      attachments: [{ tempRunId: 'abc-123-def', fileName: 'data.csv' }],
      config: defaultConfig,
    });
    expect(result.attachmentIds).toHaveLength(1);
    expect(result.attachmentRecords).toHaveLength(1);
    expect(result.attachmentRecords[0]!.mediaType).toBe('EXCEL');
    expect(result.attachmentRecords[0]!.storageRef).toContain('question/session1/run1/data.csv');
  });

  it('maps telecom capture extensions to their media types', async () => {
    const telecomConfig: ChatUploadFileConfig = {
      ...defaultConfig,
      chatUploadFileType: ['*.pcap', '*.pcapng', '*.cap', '*.tmf', '*.ptmf', '*.zip', '*.tar', '*.rar', '*.gz'],
    };
    const cases: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string }> = [
      { fileName: 'capture.pcap', mediaType: 'PCAP' },
      { fileName: 'capture.PCAP', mediaType: 'PCAP' },
      { fileName: 'capture.pcapng', mediaType: 'PCAPNG' },
      { fileName: 'capture.cap', mediaType: 'CAP' },
      { fileName: 'trace.tmf', mediaType: 'TMF' },
      { fileName: 'trace.ptmf', mediaType: 'PTMF' },
      { fileName: 'bundle.zip', mediaType: 'ZIP' },
      { fileName: 'bundle.tar', mediaType: 'TAR' },
      { fileName: 'bundle.rar', mediaType: 'RAR' },
      { fileName: 'bundle.gz', mediaType: 'GZ' },
      { fileName: 'bundle.tar.gz', mediaType: 'GZ' },
    ];
    for (const { fileName, mediaType } of cases) {
      const service = createService();
      const tempRunId = `run-${fileName.replaceAll('.', '-')}`;
      const zipContent = fileName.endsWith('.zip') ? 'PK\u0003\u0004 zip bytes' : 'telecom bytes';
      await service.uploadToTemp({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        tempRunId,
        fileName,
        config: telecomConfig,
        fileStream: createReadableStream(zipContent),
        declaredSizeBytes: zipContent.length,
      });
      const result = await service.moveToFormal({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        requestId: brand<string, 'MessageId'>('req1'),
        runId: brand<string, 'RequestRunId'>('run1'),
        attachments: [{ tempRunId, fileName }],
        config: telecomConfig,
      });
      expect(result.attachmentRecords).toHaveLength(1);
      expect(result.attachmentRecords[0]!.mediaType).toBe(mediaType);
    }
  });

  it('fails when temp file is expired', async () => {
    const service = createService();
    await expect(
      service.moveToFormal({
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default'),
        sessionId: brand<string, 'SessionId'>('session1'),
        requestId: brand<string, 'MessageId'>('req1'),
        runId: brand<string, 'RequestRunId'>('run1'),
        attachments: [{ tempRunId: 'nonexistent', fileName: 'missing.csv' }],
        config: defaultConfig,
      }),
    ).rejects.toThrow();
  });
});

describe('AttachmentStagedUploadRuntime deleteTemp', () => {
  it('deletes temp file (idempotent)', async () => {
    const service = createService();
    // Should not throw even if file doesn't exist
    await service.deleteTemp({
      identityContext: identity,
      sessionId: brand<string, 'SessionId'>('session1'),
      tempRunId: 'abc-123-def',
      fileName: 'data.csv',
    });
  });
});
