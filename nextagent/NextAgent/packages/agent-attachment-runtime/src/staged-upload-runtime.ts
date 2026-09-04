import {
  brand,
  type AgentId,
  type AttachmentId,
  type EpochMillis,
  type IdentityContext,
  type MessageId,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type { BlobStoreGateway, RequestAttachmentRecord, AttachmentStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { ChatUploadFileConfig } from './chat-upload-config.js';
import { validateFileName, validateFileContent, extractExtension } from './file-content-validator.js';
import { attachmentMediaTypeForExtension } from './attachment-media-type.js';
import { UploadQuotaTracker, UploadConcurrencyLimiter } from './upload-quota.js';
import { AgentError } from '@nextagent/agent-common';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

export interface TempFileRef {
  readonly tempRunId: string;
  readonly fileName: string;
}

export interface Phase1UploadRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly tempRunId: string;
  readonly fileName: string;
  readonly config: ChatUploadFileConfig;
  readonly fileStream: NodeJS.ReadableStream;
  readonly declaredSizeBytes?: number;
}

export interface Phase1UploadResult {
  readonly tempRunId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
}

export interface Phase2MoveRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly attachments: readonly TempFileRef[];
  readonly config: ChatUploadFileConfig;
}

export interface Phase2MoveResult {
  readonly attachmentIds: readonly AttachmentId[];
  readonly attachmentRecords: readonly RequestAttachmentRecord[];
}

export interface DeleteTempRequest {
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly tempRunId: string;
  readonly fileName: string;
}

export interface AttachmentStagedUploadRuntimeDependencies {
  readonly blobStore: BlobStoreGateway;
  readonly attachmentStore: AttachmentStoreGateway;
  readonly uploadTempDir: string;
  readonly clock?: () => EpochMillis;
  readonly quotaTracker?: UploadQuotaTracker;
  readonly concurrencyLimiter?: UploadConcurrencyLimiter;
  readonly auditObserver?: (event: UploadAuditEvent) => void;
  readonly diagnosticLogger?: {
    warn: (entry: Record<string, unknown>, message: string) => void;
    info?: (entry: Record<string, unknown>, message: string) => void;
  };
}

export interface UploadAuditEvent {
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly operation: 'UPLOAD_TEMP' | 'MOVE_TO_FORMAL' | 'DELETE_TEMP';
  readonly result: 'SUCCESS' | 'FAILURE';
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly reasonCode?: string;
  readonly timestamp: EpochMillis;
  readonly tempRunId?: string;
}

// =============================================================================
// Path validation (D30)
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{5}-[0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateTempRunId(tempRunId: string): boolean {
  return UUID_REGEX.test(tempRunId) || /^[a-zA-Z0-9_-]{8,128}$/.test(tempRunId);
}

export function buildTempObjectName(userId: string, tempRunId: string, fileName: string): string {
  if (!validateTempRunId(tempRunId)) {
    throw new AgentError({
      code: 'UPLOAD_TEMP_RUN_ID_INVALID',
      message: 'tempRunId must be a valid UUID or alphanumeric identifier.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const sanitized = fileName.replace(/[/\\]/g, '');
  if (sanitized !== fileName) {
    throw new AgentError({
      code: 'UPLOAD_FILE_NAME_INVALID',
      message: 'File name contains path separators.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const objectName = `tmp/${userId}/${tempRunId}/${sanitized}`;
  const resolved = posix.resolve('/', objectName);
  if (!resolved.startsWith('/tmp/')) {
    throw new AgentError({
      code: 'UPLOAD_PATH_TRAVERSAL',
      message: 'Path traversal detected.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return objectName;
}

export function buildFormalObjectName(sessionId: string, runId: string, fileName: string): string {
  const sanitized = fileName.replace(/[/\\]/g, '');
  if (sanitized !== fileName) {
    throw new AgentError({
      code: 'UPLOAD_FILE_NAME_INVALID',
      message: 'File name contains path separators.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const objectName = `question/${sessionId}/${runId}/${sanitized}`;
  const resolved = posix.resolve('/', objectName);
  if (!resolved.startsWith('/question/')) {
    throw new AgentError({
      code: 'UPLOAD_PATH_TRAVERSAL',
      message: 'Path traversal detected in formal path.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return objectName;
}

// =============================================================================
// Glob pattern matching (D20)
// =============================================================================

export function matchFileExtension(fileName: string, patterns: readonly string[]): boolean {
  const ext = extractExtension(fileName).toLowerCase();
  if (ext.length === 0) {
    return false;
  }
  for (const pattern of patterns) {
    const trimmed = pattern.trim().toLowerCase();
    if (trimmed.startsWith('*.')) {
      const patternExt = trimmed.slice(1);
      if (ext === patternExt) {
        return true;
      }
    } else if (trimmed === ext) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Attachment staged-upload runtime
// =============================================================================

export class AttachmentStagedUploadRuntime {
  private readonly quotaTracker: UploadQuotaTracker;
  private readonly concurrencyLimiter: UploadConcurrencyLimiter;

  constructor(private readonly deps: AttachmentStagedUploadRuntimeDependencies) {
    this.quotaTracker = deps.quotaTracker ?? new UploadQuotaTracker(deps.clock);
    this.concurrencyLimiter = deps.concurrencyLimiter ?? new UploadConcurrencyLimiter();
  }

  // ===== Phase 1: Upload to temp =====

  async uploadToTemp(request: Phase1UploadRequest): Promise<Phase1UploadResult> {
    const userId = request.identityContext.subjectId;
    const sessionId = request.sessionId;
    const fileName = request.fileName;
    const tempRunId = request.tempRunId;
    const config = request.config;

    // 0. Global concurrency limit
    await this.concurrencyLimiter.acquire();

    let localTempPath: string | undefined;
    let remoteTempWritten = false;
    let sizeBytes = 0;

    try {
      // 1. File name regex validation
      const nameResult = validateFileName(fileName);
      if (!nameResult.valid) {
        throw this.toUploadError(nameResult.reasonCode ?? 'FILE_NAME_INVALID', 'File name validation failed.');
      }

      // 2. Extension match against config
      const ext = extractExtension(fileName).toLowerCase();
      const isMarkdown = ext === '.md' || ext === '.markdown';
      if (!isMarkdown && !matchFileExtension(fileName, config.chatUploadFileType)) {
        throw this.toUploadError('FILE_TYPE_UNSUPPORTED', 'File type is not in the allowed list.');
      }
      if (attachmentMediaTypeForExtension(extractExtension(fileName)) === undefined) {
        throw this.toUploadError('FILE_TYPE_UNSUPPORTED', 'File type has no attachment media type.');
      }

      // 3. tempRunId validation (D30)
      if (!validateTempRunId(tempRunId)) {
        throw this.toUploadError('UPLOAD_TEMP_RUN_ID_INVALID', 'tempRunId is invalid.');
      }

      // 4. Single file size check (preliminary from declared size)
      const maxBytes = config.chatUploadMaxFileSize * 1024 * 1024;
      if (request.declaredSizeBytes !== undefined && request.declaredSizeBytes > maxBytes) {
        throw this.toUploadError('FILE_TOO_LARGE', `File exceeds the ${config.chatUploadMaxFileSize}MB limit.`);
      }

      // 5. Upload frequency check (per-user)
      const freqCheck = this.quotaTracker.checkFrequency(userId);
      if (!freqCheck.allowed) {
        throw this.toUploadError(freqCheck.reasonCode ?? 'QUOTA_FREQUENCY_EXCEEDED', 'Upload frequency limit reached.');
      }

      // 6. Per-session file count check
      const sessionCheck = this.quotaTracker.checkSessionFileCount(sessionId, config.chatUploadMaxFileNumber);
      if (!sessionCheck.allowed) {
        throw this.toUploadError(sessionCheck.reasonCode ?? 'QUOTA_SESSION_FILE_COUNT_EXCEEDED', 'Session file count limit reached.');
      }

      // 7. Per-user cumulative checks
      const userCountCheck = this.quotaTracker.checkUserFileCount(userId);
      if (!userCountCheck.allowed) {
        throw this.toUploadError(userCountCheck.reasonCode ?? 'QUOTA_USER_FILE_COUNT_EXCEEDED', 'User file count limit reached.');
      }
      const userSizeCheck = this.quotaTracker.checkUserFileSize(userId, request.declaredSizeBytes ?? maxBytes);
      if (!userSizeCheck.allowed) {
        throw this.toUploadError(userSizeCheck.reasonCode ?? 'QUOTA_USER_FILE_SIZE_EXCEEDED', 'User total file size limit reached.');
      }

      // 8. User tmp quota check
      const tmpCheck = this.quotaTracker.checkUserTmpQuota(userId, request.declaredSizeBytes ?? maxBytes);
      if (!tmpCheck.allowed) {
        throw this.toUploadError(tmpCheck.reasonCode ?? 'QUOTA_USER_TMP_SIZE_EXCEEDED', 'Temp storage quota reached.');
      }

      // 9. Global upload-tmp check
      const globalTmpCheck = this.quotaTracker.checkGlobalTmp(request.declaredSizeBytes ?? maxBytes);
      if (!globalTmpCheck.allowed) {
        throw this.toUploadError(globalTmpCheck.reasonCode ?? 'QUOTA_GLOBAL_TMP_EXCEEDED', 'Server upload storage is full.');
      }

      // 10. Stream to local temp file with real-time size check
      const localTempDir = join(this.deps.uploadTempDir, userId, tempRunId);
      await mkdir(localTempDir, { recursive: true });
      localTempPath = join(localTempDir, fileName);

      sizeBytes = await this.streamToLocalTemp(request.fileStream, localTempPath, maxBytes);
      // Re-check per-user total file size with actual bytes (not just declared)
      const actualUserSizeCheck = this.quotaTracker.checkUserFileSize(userId, sizeBytes);
      if (!actualUserSizeCheck.allowed) {
        throw this.toUploadError(actualUserSizeCheck.reasonCode ?? 'QUOTA_USER_FILE_SIZE_EXCEEDED', 'User total file size limit reached.');
      }

      // 11. Content security validation (magic bytes + zip slip + zip bomb)
      const contentResult = await validateFileContent(localTempPath, fileName);
      if (!contentResult.valid) {
        throw this.toUploadError(contentResult.reasonCode ?? 'FILE_CONTENT_INVALID', 'File content validation failed.');
      }

      // 12. Upload to BlobStoreGateway
      const tempObjectName = buildTempObjectName(userId, tempRunId, fileName);
      await this.deps.blobStore.storeBlob({
        tenantId: request.identityContext.tenantId,
        subjectId: userId,
        purpose: 'ATTACHMENT',
        blobRef: brand<string, 'BlobRef'>(tempObjectName),
        localFilePath: localTempPath,
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${tempRunId}:${fileName}`),
      });
      remoteTempWritten = true;

      // 13. Update quota counters
      this.quotaTracker.recordTempUpload(userId, sizeBytes);

      // 14. Audit log
      this.audit({
        userId,
        tenantId: request.identityContext.tenantId,
        sessionId,
        operation: 'UPLOAD_TEMP',
        result: 'SUCCESS',
        fileName,
        sizeBytes,
        tempRunId,
      });

      return { tempRunId, fileName, sizeBytes };
    } catch (error) {
      // Cleanup on failure
      if (remoteTempWritten) {
        const tempObjectName = buildTempObjectName(userId, tempRunId, fileName);
        await this.deps.blobStore
          .deleteBlob({ tenantId: request.identityContext.tenantId, subjectId: userId, blobRef: brand<string, 'BlobRef'>(tempObjectName) })
          .catch(() => {});
      }
      // Map error to audit
      const reasonCode = error instanceof AgentError ? error.code : 'UPLOAD_INTERNAL_ERROR';
      this.audit({
        userId,
        tenantId: request.identityContext.tenantId,
        sessionId,
        operation: 'UPLOAD_TEMP',
        result: 'FAILURE',
        fileName,
        sizeBytes,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        tempRunId,
      });
      throw error;
    } finally {
      // Delete local temp file
      if (localTempPath !== undefined) {
        await rm(localTempPath, { force: true }).catch(() => {});
      }
      this.concurrencyLimiter.release();
    }
  }

  // ===== Phase 2: Move temp → formal =====

  async moveToFormal(request: Phase2MoveRequest): Promise<Phase2MoveResult> {
    const userId = request.identityContext.subjectId;
    const sessionId = request.sessionId;
    const requestId = request.requestId;
    const runId = request.runId;

    const records: RequestAttachmentRecord[] = [];
    const attachmentIds: AttachmentId[] = [];
    let totalSize = 0;

    try {
      for (const tempFile of request.attachments) {
        const tempObjectName = buildTempObjectName(userId, tempFile.tempRunId, tempFile.fileName);
        const formalObjectName = buildFormalObjectName(sessionId, runId, tempFile.fileName);

        // Check temp file exists
        const metadata = await this.deps.blobStore.getBlobMetadata({ blobRef: brand<string, 'BlobRef'>(tempObjectName) });
        if (metadata === undefined) {
          throw this.toUploadError('TEMP_FILE_EXPIRED', `Temp file ${tempFile.fileName} has expired. Please re-upload.`);
        }

        // Copy temp → formal
        const copied = await this.deps.blobStore.copyBlob({
          sourceBlob: tempObjectName,
          destinationBlob: formalObjectName,
        });

        // Delete temp (failure here is non-blocking, orphan cleaned by TTL)
        await this.deps.blobStore
          .deleteBlob({ tenantId: request.identityContext.tenantId, subjectId: userId, blobRef: brand<string, 'BlobRef'>(tempObjectName) })
          .catch(() => {});

        // Create attachment record
        const attachmentId = brand<string, 'AttachmentId'>(`attachment-${randomUUID()}`);
        const mediaType = attachmentMediaTypeForExtension(extractExtension(tempFile.fileName));
        if (mediaType === undefined) {
          throw this.toUploadError('FILE_TYPE_UNSUPPORTED', 'File type has no attachment media type.');
        }
        const record: RequestAttachmentRecord = {
          tenantId: request.identityContext.tenantId,
          subjectId: userId,
          agentId: request.agentId,
          attachmentId,
          sessionId,
          requestId,
          runId,
          fileName: tempFile.fileName,
          mediaType,
          sizeBytes: metadata.contentLength,
          validationStatus: 'ACCEPTED',
          availabilityStatus: 'AVAILABLE',
          storageRef: copied.blobRef,
          createdAt: this.now(),
        };
        await this.deps.attachmentStore.saveAttachment(record);
        records.push(record);
        attachmentIds.push(attachmentId);
        totalSize += metadata.contentLength;

        this.audit({
          userId,
          tenantId: request.identityContext.tenantId,
          sessionId,
          operation: 'MOVE_TO_FORMAL',
          result: 'SUCCESS',
          fileName: tempFile.fileName,
          sizeBytes: metadata.contentLength,
          tempRunId: tempFile.tempRunId,
        });
      }

      // Update quota counters
      this.quotaTracker.recordFormalUpload(userId, sessionId, request.attachments.length, totalSize, request.config.chatUploadMaxFileNumber);

      return { attachmentIds, attachmentRecords: records };
    } catch (error) {
      // Fail-closed: no rollback of already-moved files (D21)
      // Orphan formal files left for HOFS TTL cleanup
      const reasonCode = error instanceof AgentError ? error.code : 'MOVE_INTERNAL_ERROR';
      this.audit({
        userId,
        tenantId: request.identityContext.tenantId,
        sessionId,
        operation: 'MOVE_TO_FORMAL',
        result: 'FAILURE',
        fileName: '',
        sizeBytes: 0,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      });
      throw error;
    }
  }

  // ===== Delete temp file =====

  async deleteTemp(request: DeleteTempRequest): Promise<void> {
    const userId = request.identityContext.subjectId;
    const tempObjectName = buildTempObjectName(userId, request.tempRunId, request.fileName);

    // Get file metadata to know the size for quota deduction
    const metadata = await this.deps.blobStore.getBlobMetadata({ blobRef: brand<string, 'BlobRef'>(tempObjectName) }).catch(() => undefined);
    const sizeBytes = metadata?.contentLength ?? 0;

    // Delete from BlobStoreGateway (idempotent)
    await this.deps.blobStore
      .deleteBlob({ tenantId: request.identityContext.tenantId, subjectId: userId, blobRef: brand<string, 'BlobRef'>(tempObjectName) })
      .catch(() => {});

    // Update quota counters (deduct 1 timestamp + tmp size)
    this.quotaTracker.recordTempDelete(userId, sizeBytes);

    this.audit({
      userId,
      tenantId: request.identityContext.tenantId,
      sessionId: request.sessionId,
      operation: 'DELETE_TEMP',
      result: 'SUCCESS',
      fileName: request.fileName,
      sizeBytes,
      tempRunId: request.tempRunId,
    });
  }

  // ===== Startup cleanup (D33 layer 2) =====

  async cleanupLocalTempDir(): Promise<void> {
    try {
      const entries = await readdir(this.deps.uploadTempDir).catch(() => []);
      for (const entry of entries) {
        await rm(join(this.deps.uploadTempDir, entry), { recursive: true, force: true }).catch(() => {});
      }
      this.deps.diagnosticLogger?.info?.(
        { event: 'upload_temp.cleanup_startup', cleanedCount: entries.length },
        'Cleaned upload temp directory on startup.',
      );
    } catch {
      // Non-blocking
    }
  }

  // ===== Private helpers =====

  private async streamToLocalTemp(stream: NodeJS.ReadableStream, filePath: string, maxBytes: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      let totalBytes = 0;
      let aborted = false;

      const onData = (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          aborted = true;
          stream.pause();
          writeStream.destroy();
          (stream as { destroy?: () => void }).destroy?.();
          reject(this.toUploadError('FILE_TOO_LARGE', `File exceeds the maximum size limit during streaming.`));
          return;
        }
        const canContinue = writeStream.write(chunk);
        if (!canContinue) {
          stream.pause();
          writeStream.once('drain', () => {
            if (!aborted) {
              stream.resume();
            }
          });
        }
      };

      stream.on('data', onData);
      stream.on('error', (error) => {
        if (!aborted) {
          writeStream.destroy();
          reject(error);
        }
      });
      stream.on('end', () => {
        if (!aborted) {
          writeStream.end();
        }
      });
      writeStream.on('error', (error) => {
        if (!aborted) {
          if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            reject(this.toUploadError('DISK_SPACE_FULL', 'Server storage space is insufficient.'));
          } else {
            reject(error);
          }
        }
      });
      writeStream.on('finish', () => {
        if (!aborted) {
          resolve(totalBytes);
        }
      });
    });
  }

  private toUploadError(code: string, message: string): AgentError {
    return new AgentError({
      code,
      message,
      category: 'VALIDATION',
      retryable: false,
    });
  }

  private audit(event: Omit<UploadAuditEvent, 'timestamp'>): void {
    try {
      this.deps.auditObserver?.({ ...event, timestamp: this.now() });
    } catch {
      // Audit must not affect upload semantics
    }
  }

  private now(): EpochMillis {
    return this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
  }
}

export function createAttachmentStagedUploadRuntime(deps: AttachmentStagedUploadRuntimeDependencies): AttachmentStagedUploadRuntime {
  return new AttachmentStagedUploadRuntime(deps);
}
