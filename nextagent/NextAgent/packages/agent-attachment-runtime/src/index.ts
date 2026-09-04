import {
  AgentError,
  brand,
  getLogger,
  type AgentId,
  type AgentVersion,
  type AttachmentIntakeReservationId,
  type EpochMillis,
  type IdentityContext,
  type IdempotencyKey,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SafeError,
  type SessionId,
} from '@nextagent/agent-common';
import type {
  AttachmentIntakeReservationGateway,
  AttachmentStoreGateway,
  BlobStoreGateway,
  RequestAttachmentRecord,
} from '@nextagent/agent-contracts/gateway';
import { attachmentMediaTypeForExtension } from './attachment-media-type.js';
const logger = getLogger({ component: 'agent-attachment-runtime', source: 'intake' });
export * from './cleanup.js';
export * from './attachment-execution-runtime.js';
export * from './attachment-summary-resolver.js';
export * from './chat-upload-config.js';
export * from './file-content-validator.js';
export * from './upload-quota.js';
export * from './staged-upload-runtime.js';
export * from './upload-temp-cleanup-job.js';
export * from './file-download-runtime.js';
export * from './download-temp-cleanup-job.js';

export const attachmentIntakeLimits = {
  maxAttachmentsPerRequest: 3,
  maxAttachmentSizeBytes: 5 * 1024 * 1024,
  enabledMediaTypes: ['MARKDOWN'] as const,
};

export type AttachmentIntakeAction = 'SUBMIT_REQUEST' | 'EDIT_LATEST_REQUEST';

export type AttachmentIntakeFailureCode =
  | 'ATTACHMENT_VALIDATION_FAILED'
  | 'ATTACHMENT_AUTHORIZATION_FAILED'
  | 'ATTACHMENT_COUNT_EXCEEDED'
  | 'ATTACHMENT_EMPTY'
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_TYPE_UNSUPPORTED'
  | 'ATTACHMENT_TYPE_MISMATCH'
  | 'ATTACHMENT_READ_FAILED'
  | 'ATTACHMENT_STAGING_FAILED'
  | 'ATTACHMENT_INTAKE_TIMEOUT'
  | 'ATTACHMENT_BUDGET_EXCEEDED'
  | 'ATTACHMENT_DEPENDENCY_UNAVAILABLE';

export interface AttachmentIntakeInputFile {
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
}

export interface AttachmentIntakeRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly reservationId?: AttachmentIntakeReservationId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId?: RequestContextId;
  readonly action: AttachmentIntakeAction;
  readonly files?: readonly AttachmentIntakeInputFile[];
  readonly idempotencyKey: IdempotencyKey;
  readonly budget?: {
    readonly deadlineAt?: EpochMillis;
    readonly maxTotalBytes?: number;
  };
}

export interface AttachmentSafeSummary {
  readonly fileName: string;
  readonly mediaType?: RequestAttachmentRecord['mediaType'];
  readonly sizeBytes: number;
  readonly validationStatus: RequestAttachmentRecord['validationStatus'];
  readonly availabilityStatus?: RequestAttachmentRecord['availabilityStatus'];
  readonly reasonCode?: AttachmentIntakeFailureCode;
}

export interface AttachmentIntakeAccepted {
  readonly status: 'ACCEPTED';
  readonly attachmentId: RequestAttachmentRecord['attachmentId'];
  readonly safeSummary: AttachmentSafeSummary;
}

export interface AttachmentIntakeRejected {
  readonly status: 'REJECTED';
  readonly reasonCode: AttachmentIntakeFailureCode;
  readonly safeError: SafeError;
  readonly safeSummary?: AttachmentSafeSummary;
}

export interface AttachmentIntakeResult {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly attachmentIds: ReadonlyArray<RequestAttachmentRecord['attachmentId']>;
  readonly accepted: readonly AttachmentIntakeAccepted[];
  readonly rejected: readonly AttachmentIntakeRejected[];
  readonly safeError?: SafeError;
}

export interface AttachmentIntakeRuntime {
  intake: (request: AttachmentIntakeRequest, signal?: AbortSignal) => Promise<AttachmentIntakeResult>;
}

export interface AttachmentIntakeDependencies {
  readonly blobStore: BlobStoreGateway;
  readonly attachmentStore: AttachmentStoreGateway;
  readonly reservationGateway?: AttachmentIntakeReservationGateway;
  readonly uploadTempDir?: string;
  readonly clock?: () => EpochMillis;
  readonly idFactory?: (prefix: string) => string;
  readonly outcomeObserver?: (event: AttachmentIntakeOutcomeObservation) => void;
}

export interface AttachmentIntakeOutcomeObservation {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly tenantId: IdentityContext['tenantId'];
  readonly subjectId: IdentityContext['subjectId'];
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId?: RequestContextId;
  readonly reservationId?: AttachmentIntakeReservationId;
  readonly attachmentCount: number;
  readonly sizeBucket: 'none' | 'small' | 'medium' | 'large';
  readonly durationMs: number;
  readonly reasonCode?: AttachmentIntakeFailureCode;
}

export interface AttachmentObservationOwnerScope {
  readonly tenantId: IdentityContext['tenantId'];
  readonly subjectId: IdentityContext['subjectId'];
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
}

export interface AttachmentObservationInput {
  readonly boundary: 'system';
  readonly operation: string;
  readonly outcome: 'success' | 'failure' | 'degraded';
  readonly ownerScope: AttachmentObservationOwnerScope;
  readonly occurredAt: EpochMillis;
  readonly durationMs?: number;
  readonly safeSummary: string;
  readonly safeReasonCode?: string;
  readonly stableRefs: {
    readonly sessionId?: SessionId;
    readonly requestId?: MessageId;
    readonly requestRunId?: RequestRunId;
    readonly requestContextId?: RequestContextId;
    readonly auditEventId?: string;
  };
  readonly diagnosticSnapshot: {
    readonly tenantId: IdentityContext['tenantId'];
    readonly subjectId: IdentityContext['subjectId'];
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
    readonly diagnosticCandidates: ReadonlyArray<{
      readonly key: string;
      readonly value: string | number;
      readonly classification: 'LOW_CARDINALITY';
      readonly cardinality: 'LOW';
    }>;
  };
}

export interface AttachmentLifecycleDiagnosticsOptions<TObservation> {
  readonly createObservationEvent: (input: AttachmentObservationInput) => TObservation;
  readonly now?: () => EpochMillis;
}

export interface AttachmentLifecycleDiagnostics<TObservation> {
  createIntakeObservation: (event: AttachmentIntakeOutcomeObservation, ownerScope: AttachmentObservationOwnerScope) => TObservation;
  createCleanupObservation: (
    event: import('./cleanup.js').AttachmentCleanupOutcomeObservation,
    ownerScope: AttachmentObservationOwnerScope,
  ) => TObservation;
}

export function createAttachmentLifecycleDiagnostics<TObservation>(
  options: AttachmentLifecycleDiagnosticsOptions<TObservation>,
): AttachmentLifecycleDiagnostics<TObservation> {
  const now = options.now ?? (() => brand<number, 'EpochMillis'>(Date.now()));
  return {
    createIntakeObservation(event, ownerScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation: event.status === 'ACCEPTED' ? 'ATTACHMENT_ACCEPTED' : 'ATTACHMENT_REJECTED',
        outcome: event.status === 'ACCEPTED' ? 'success' : 'failure',
        ownerScope: {
          ...ownerScope,
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: event.agentId,
        },
        occurredAt: now(),
        durationMs: event.durationMs,
        safeSummary: event.status === 'ACCEPTED' ? 'Attachment intake accepted safely.' : 'Attachment intake rejected safely.',
        ...(event.reasonCode === undefined ? {} : { safeReasonCode: event.reasonCode }),
        stableRefs: {
          sessionId: event.sessionId,
          requestId: event.requestId,
          requestRunId: event.runId,
          ...(event.requestContextId === undefined ? {} : { requestContextId: event.requestContextId }),
          auditEventId: `audit:attachment:${event.status.toLowerCase()}:${event.tenantId}:${event.subjectId}:${event.sessionId}:${event.requestId}`,
        },
        diagnosticSnapshot: {
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: event.agentId,
          agentVersion: ownerScope.agentVersion,
          diagnosticCandidates: [
            low('attachmentCount', event.attachmentCount),
            low('sizeBucket', event.sizeBucket),
            ...(event.reasonCode === undefined ? [] : [low('reasonCode', event.reasonCode)]),
          ],
        },
      });
    },
    createCleanupObservation(event, ownerScope) {
      return options.createObservationEvent({
        boundary: 'system',
        operation:
          event.outcome === 'FAILED'
            ? 'ATTACHMENT_CLEANUP_FAILED'
            : event.outcome === 'REJECTED' || event.outcome === 'NOT_FOUND'
              ? 'ATTACHMENT_CLEANUP_REJECTED'
              : 'ATTACHMENT_CLEANUP_COMPLETED',
        outcome: event.outcome === 'FAILED' ? 'failure' : event.outcome === 'REJECTED' ? 'degraded' : 'success',
        ownerScope: {
          ...ownerScope,
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: event.agentId,
        },
        occurredAt: now(),
        durationMs: event.durationMs,
        safeSummary: event.outcome === 'FAILED' ? 'Attachment cleanup failed safely.' : 'Attachment cleanup completed safely.',
        safeReasonCode: event.safeReasonCode,
        stableRefs: {
          ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
          ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
          ...(event.runId === undefined ? {} : { requestRunId: event.runId }),
          ...(event.requestContextId === undefined ? {} : { requestContextId: event.requestContextId }),
        },
        diagnosticSnapshot: {
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: event.agentId,
          agentVersion: ownerScope.agentVersion,
          diagnosticCandidates: [low('reasonCode', event.reasonCode), low('attachmentCount', event.attachmentCount)],
        },
      });
    },
  };
}

function low(key: string, value: string | number) {
  return { key, value, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const };
}

interface ValidatedAttachment {
  readonly file: AttachmentIntakeInputFile;
  readonly safeFileName: string;
}

export function createAttachmentIntakeRuntime(deps: AttachmentIntakeDependencies): AttachmentIntakeRuntime {
  return new DefaultAttachmentIntakeRuntime(deps);
}

class DefaultAttachmentIntakeRuntime implements AttachmentIntakeRuntime {
  constructor(private readonly deps: AttachmentIntakeDependencies) {}

  async intake(request: AttachmentIntakeRequest, signal?: AbortSignal): Promise<AttachmentIntakeResult> {
    const startedAt = performance.now();
    const files = request.files ?? [];
    if (files.length === 0) {
      return this.completeReservation(request, acceptedResult([]), startedAt, files);
    }
    const immediateFailure = this.validateRequestBudget(request, files, signal);
    if (immediateFailure !== undefined) {
      return this.completeReservation(request, rejectedResult(immediateFailure), startedAt, files);
    }
    const validated = this.validateAcceptedFiles(files);
    if ('result' in validated) {
      return this.completeReservation(request, validated.result, startedAt, files);
    }
    const staged = await this.stageAcceptedAttachments(request, validated.accepted, signal);
    return this.completeReservation(request, staged, startedAt, files);
  }

  private validateRequestBudget(
    request: AttachmentIntakeRequest,
    files: readonly AttachmentIntakeInputFile[],
    signal?: AbortSignal,
  ): AttachmentIntakeFailureCode | undefined {
    const budgetFailure = intakeBudgetFailure(request, signal);
    if (budgetFailure !== undefined) {
      return budgetFailure;
    }
    if (files.length > attachmentIntakeLimits.maxAttachmentsPerRequest) {
      return 'ATTACHMENT_COUNT_EXCEEDED';
    }
    if (request.budget?.maxTotalBytes !== undefined && totalSize(files) > request.budget.maxTotalBytes) {
      return 'ATTACHMENT_BUDGET_EXCEEDED';
    }
    return undefined;
  }

  private validateAcceptedFiles(
    files: readonly AttachmentIntakeInputFile[],
  ): { readonly accepted: readonly ValidatedAttachment[] } | { readonly result: AttachmentIntakeResult } {
    const validation = validateFiles(files);
    if (validation.rejected.length === 0) {
      return { accepted: validation.accepted };
    }
    const safeError = validation.rejected[0]?.safeError;
    return {
      result: {
        status: 'REJECTED',
        attachmentIds: [],
        accepted: [],
        rejected: validation.rejected,
        ...(safeError === undefined ? {} : { safeError }),
      },
    };
  }

  private async stageAcceptedAttachments(
    request: AttachmentIntakeRequest,
    acceptedFiles: readonly ValidatedAttachment[],
    signal?: AbortSignal,
  ): Promise<AttachmentIntakeResult> {
    const accepted: AttachmentIntakeAccepted[] = [];
    for (const [index, candidate] of acceptedFiles.entries()) {
      const failure = intakeBudgetFailure(request, signal);
      if (failure !== undefined) {
        return rejectedResult(failure);
      }
      const staged = await this.stageAcceptedAttachment(request, candidate, index);
      if ('result' in staged) {
        return staged.result;
      }
      accepted.push(staged.accepted);
    }
    return acceptedResult(accepted);
  }

  private async stageAcceptedAttachment(
    request: AttachmentIntakeRequest,
    candidate: ValidatedAttachment,
    index: number,
  ): Promise<{ readonly accepted: AttachmentIntakeAccepted } | { readonly result: AttachmentIntakeResult }> {
    const attachmentId = brand<string, 'AttachmentId'>(this.deps.idFactory?.('attachment') ?? `attachment-${crypto.randomUUID()}`);
    const storageRef = await this.stageBlob(request, candidate, index);
    if (storageRef === undefined) {
      return { result: rejectedResult('ATTACHMENT_STAGING_FAILED') };
    }
    const saved = await this.saveAttachmentRecord(request, candidate, attachmentId, storageRef);
    if (saved === undefined) {
      await this.rollbackStagedBlobIfNeeded(request, storageRef);
      return { result: rejectedResult('ATTACHMENT_STAGING_FAILED') };
    }
    return {
      accepted: {
        status: 'ACCEPTED',
        attachmentId: saved.attachmentId,
        safeSummary: {
          fileName: saved.fileName,
          mediaType: saved.mediaType,
          sizeBytes: saved.sizeBytes,
          validationStatus: saved.validationStatus,
          availabilityStatus: saved.availabilityStatus,
        },
      },
    };
  }

  private async stageBlob(
    request: AttachmentIntakeRequest,
    candidate: ValidatedAttachment,
    index: number,
  ): Promise<RequestAttachmentRecord['storageRef'] | undefined> {
    try {
      const tempDir = this.deps.uploadTempDir;
      if (tempDir === undefined) {
        throw new Error('uploadTempDir is required for BlobStoreGateway.storeBlob');
      }
      const tempFilePath = join(tempDir, `${randomUUID()}-${candidate.safeFileName}`);
      await writeFile(tempFilePath, candidate.file.bytes);
      try {
        return await this.deps.blobStore.storeBlob({
          tenantId: request.identityContext.tenantId,
          subjectId: request.identityContext.subjectId,
          purpose: 'ATTACHMENT',
          blobRef: brand<string, 'BlobRef'>(`attachments/${request.sessionId}/${request.requestId}/${candidate.safeFileName}`),
          localFilePath: tempFilePath,
          idempotencyKey: brand<string, 'IdempotencyKey'>(`${request.idempotencyKey}:attachment:${index}:blob`),
          diagnosticContext: diagnosticContext(request),
        });
      } finally {
        await rm(tempFilePath, { force: true }).catch(() => {});
      }
    } catch (error) {
      this.logStagingFailure(request, 'ATTACHMENT_STAGING_FAILED', error);
      return undefined;
    }
  }

  private async saveAttachmentRecord(
    request: AttachmentIntakeRequest,
    candidate: ValidatedAttachment,
    attachmentId: RequestAttachmentRecord['attachmentId'],
    storageRef: RequestAttachmentRecord['storageRef'],
  ): Promise<RequestAttachmentRecord | undefined> {
    const record: RequestAttachmentRecord = {
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      attachmentId,
      sessionId: request.sessionId,
      requestId: request.requestId,
      runId: request.runId,
      fileName: candidate.safeFileName,
      mediaType: attachmentMediaTypeForExtension(extensionOf(candidate.safeFileName)) ?? 'MARKDOWN',
      sizeBytes: candidate.file.sizeBytes,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef,
      createdAt: this.now(),
    };
    try {
      return await this.deps.attachmentStore.saveAttachment(record);
    } catch (error) {
      this.logStagingFailure(request, 'ATTACHMENT_STAGING_FAILED', error);
      return undefined;
    }
  }

  private async rollbackStagedBlobIfNeeded(request: AttachmentIntakeRequest, storageRef: RequestAttachmentRecord['storageRef']): Promise<void> {
    const existed = await this.deps.blobStore
      .blobExists({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        blobRef: storageRef,
      })
      .catch(() => undefined);
    if (existed !== true) {
      return;
    }
    await this.deps.blobStore
      .deleteBlob({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        blobRef: storageRef,
      })
      .catch(() => undefined);
  }

  private async completeReservation(
    request: AttachmentIntakeRequest,
    result: AttachmentIntakeResult,
    startedAt: number,
    files: readonly AttachmentIntakeInputFile[],
  ): Promise<AttachmentIntakeResult> {
    if (request.reservationId === undefined || this.deps.reservationGateway === undefined) {
      this.observeOutcome(request, result, startedAt, files);
      return result;
    }
    await this.deps.reservationGateway.completeAttachmentIntakeReservation({
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      reservationId: request.reservationId,
      status: result.status === 'ACCEPTED' ? 'INTAKE_ACCEPTED' : 'INTAKE_REJECTED',
      attachmentIds: result.attachmentIds,
      ...(result.rejected[0]?.reasonCode === undefined ? {} : { rejectionReasonCode: result.rejected[0].reasonCode }),
      ...(result.safeError === undefined ? {} : { safeError: result.safeError }),
      updatedAt: this.now(),
    });
    this.observeOutcome(request, result, startedAt, files);
    return result;
  }

  private observeOutcome(
    request: AttachmentIntakeRequest,
    result: AttachmentIntakeResult,
    startedAt: number,
    files: readonly AttachmentIntakeInputFile[],
  ): void {
    try {
      this.deps.outcomeObserver?.({
        status: result.status,
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        requestId: request.requestId,
        runId: request.runId,
        ...(request.requestContextId === undefined ? {} : { requestContextId: request.requestContextId }),
        ...(request.reservationId === undefined ? {} : { reservationId: request.reservationId }),
        attachmentCount: result.status === 'ACCEPTED' ? result.attachmentIds.length : files.length,
        sizeBucket: sizeBucket(totalSize(files)),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(result.rejected[0]?.reasonCode === undefined ? {} : { reasonCode: result.rejected[0].reasonCode }),
      });
    } catch {
      // Observability must not affect attachment intake semantics.
    }
  }

  private now(): EpochMillis {
    return this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
  }

  private logStagingFailure(request: AttachmentIntakeRequest, reasonCode: AttachmentIntakeFailureCode, error: unknown): void {
    logger.warn({
      err: error,
      event: 'attachment.intake.staging_failed',
      failureStage: 'ATTACHMENT_STAGING',
      safeReasonCode: reasonCode,
      agentId: request.agentId,
      sessionId: request.sessionId,
      requestId: request.requestId,
      runId: request.runId,
      ...(request.reservationId === undefined ? {} : { reservationId: request.reservationId }),
    });
  }
}

function validateFiles(files: readonly AttachmentIntakeInputFile[]): {
  readonly accepted: readonly ValidatedAttachment[];
  readonly rejected: readonly AttachmentIntakeRejected[];
} {
  const accepted: ValidatedAttachment[] = [];
  const rejected: AttachmentIntakeRejected[] = [];
  for (const file of files) {
    const reasonCode = validateInputFile(file);
    if (reasonCode === undefined) {
      accepted.push({ file, safeFileName: sanitizeFileName(file.fileName) });
    } else {
      rejected.push({
        status: 'REJECTED',
        reasonCode,
        safeError: toAttachmentSafeError(reasonCode),
        safeSummary: safeSummary(file, 'REJECTED', undefined, reasonCode),
      });
    }
  }
  return { accepted, rejected };
}

function acceptedResult(accepted: readonly AttachmentIntakeAccepted[]): AttachmentIntakeResult {
  return {
    status: 'ACCEPTED',
    attachmentIds: accepted.map((item) => item.attachmentId),
    accepted,
    rejected: [],
  };
}

function rejectedResult(reasonCode: AttachmentIntakeFailureCode): AttachmentIntakeResult {
  const safeError = toAttachmentSafeError(reasonCode);
  return {
    status: 'REJECTED',
    attachmentIds: [],
    accepted: [],
    rejected: [{ status: 'REJECTED', reasonCode, safeError }],
    safeError,
  };
}

export function toAttachmentSafeError(reasonCode: AttachmentIntakeFailureCode, cause?: unknown): SafeError {
  const error = new AgentError({
    code: reasonCode,
    message: messageFor(reasonCode),
    category: categoryFor(reasonCode),
    retryable: retryableFor(reasonCode),
    safeDetails: safeDetailsFor(reasonCode),
    ...(cause === undefined ? {} : { cause }),
  });
  return {
    code: error.code,
    message: error.message,
    category: error.category,
    retryable: error.retryable,
    ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
  };
}

function validateInputFile(file: AttachmentIntakeInputFile): AttachmentIntakeFailureCode | undefined {
  if (
    typeof file.fileName !== 'string' ||
    file.fileName.trim().length === 0 ||
    typeof file.declaredMimeType !== 'string' ||
    file.declaredMimeType.trim().length === 0 ||
    !(file.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(file.sizeBytes)
  ) {
    return 'ATTACHMENT_VALIDATION_FAILED';
  }
  if (file.sizeBytes <= 0 || file.bytes.byteLength <= 0) {
    return 'ATTACHMENT_EMPTY';
  }
  if (file.sizeBytes !== file.bytes.byteLength) {
    return 'ATTACHMENT_VALIDATION_FAILED';
  }
  if (file.sizeBytes > attachmentIntakeLimits.maxAttachmentSizeBytes) {
    return 'ATTACHMENT_TOO_LARGE';
  }
  const declared = normalizeMime(file.declaredMimeType);
  const extension = extensionOf(file.fileName);
  const declaredMarkdown = declared === 'text/markdown' || declared === 'text/plain';
  const markdownExtension = extension === '.md' || extension === '.markdown';
  const binaryMagic = matchesKnownBinaryMagic(file.bytes);
  if (!declaredMarkdown && !markdownExtension) {
    return 'ATTACHMENT_TYPE_UNSUPPORTED';
  }
  if (!declaredMarkdown || !markdownExtension || binaryMagic) {
    return 'ATTACHMENT_TYPE_MISMATCH';
  }
  if (!isReadableUtf8Text(file.bytes)) {
    return 'ATTACHMENT_READ_FAILED';
  }
  return undefined;
}

function isReadableUtf8Text(bytes: Uint8Array): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return !decoder.decode(bytes).includes('\u0000');
  } catch {
    return false;
  }
}

function matchesKnownBinaryMagic(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) ||
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) ||
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(bytes, [0xff, 0xd8, 0xff])
  );
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function safeSummary(
  file: AttachmentIntakeInputFile,
  validationStatus: RequestAttachmentRecord['validationStatus'],
  mediaType?: RequestAttachmentRecord['mediaType'],
  reasonCode?: AttachmentIntakeFailureCode,
): AttachmentSafeSummary {
  return {
    fileName: sanitizeFileName(file.fileName),
    ...(mediaType === undefined ? {} : { mediaType }),
    sizeBytes: Number.isSafeInteger(file.sizeBytes) ? file.sizeBytes : 0,
    validationStatus,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

function safeDetailsFor(reasonCode: AttachmentIntakeFailureCode): NonNullable<SafeError['safeDetails']> {
  return {
    reasonCode,
    ...(reasonCode === 'ATTACHMENT_TYPE_UNSUPPORTED' || reasonCode === 'ATTACHMENT_TYPE_MISMATCH' ? { supportedMediaTypes: ['MARKDOWN'] } : {}),
    ...(retryableFor(reasonCode) ? { retryable: true } : {}),
  };
}

function messageFor(reasonCode: AttachmentIntakeFailureCode): string {
  switch (reasonCode) {
    case 'ATTACHMENT_VALIDATION_FAILED':
      return 'Attachment intake input is invalid.';
    case 'ATTACHMENT_AUTHORIZATION_FAILED':
      return 'Attachment intake is not authorized.';
    case 'ATTACHMENT_COUNT_EXCEEDED':
      return 'At most 3 attachments are supported per request.';
    case 'ATTACHMENT_EMPTY':
      return 'Attachment must not be empty.';
    case 'ATTACHMENT_TOO_LARGE':
      return 'Attachment exceeds the 5 MiB limit.';
    case 'ATTACHMENT_TYPE_UNSUPPORTED':
      return 'This attachment type is not supported. The first release only supports Markdown.';
    case 'ATTACHMENT_TYPE_MISMATCH':
      return 'Attachment declared type does not match its filename or content boundary.';
    case 'ATTACHMENT_READ_FAILED':
      return 'Markdown attachment could not be read safely.';
    case 'ATTACHMENT_STAGING_FAILED':
      return 'Attachment could not be staged safely.';
    case 'ATTACHMENT_INTAKE_TIMEOUT':
      return 'Attachment intake timed out before request acceptance.';
    case 'ATTACHMENT_BUDGET_EXCEEDED':
      return 'Attachment intake exceeded the request admission budget.';
    case 'ATTACHMENT_DEPENDENCY_UNAVAILABLE':
      return 'Attachment intake dependency is unavailable.';
    default: {
      const exhaustive: never = reasonCode;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function categoryFor(reasonCode: AttachmentIntakeFailureCode): AgentError['category'] {
  switch (reasonCode) {
    case 'ATTACHMENT_AUTHORIZATION_FAILED':
      return 'AUTHORIZATION';
    case 'ATTACHMENT_STAGING_FAILED':
    case 'ATTACHMENT_DEPENDENCY_UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'ATTACHMENT_INTAKE_TIMEOUT':
      return 'TIMEOUT';
    default:
      return 'VALIDATION';
  }
}

function retryableFor(reasonCode: AttachmentIntakeFailureCode): boolean {
  return (
    reasonCode === 'ATTACHMENT_STAGING_FAILED' || reasonCode === 'ATTACHMENT_INTAKE_TIMEOUT' || reasonCode === 'ATTACHMENT_DEPENDENCY_UNAVAILABLE'
  );
}

function totalSize(files: readonly AttachmentIntakeInputFile[]): number {
  return files.reduce((sum, file) => sum + (Number.isSafeInteger(file.sizeBytes) ? file.sizeBytes : 0), 0);
}

function sizeBucket(sizeBytes: number): AttachmentIntakeOutcomeObservation['sizeBucket'] {
  if (sizeBytes <= 0) {
    return 'none';
  }
  if (sizeBytes <= 64 * 1024) {
    return 'small';
  }
  if (sizeBytes <= 1024 * 1024) {
    return 'medium';
  }
  return 'large';
}

function intakeBudgetFailure(request: AttachmentIntakeRequest, signal?: AbortSignal): AttachmentIntakeFailureCode | undefined {
  if (signal?.aborted === true || (request.budget?.deadlineAt !== undefined && Date.now() > Number(request.budget.deadlineAt))) {
    return 'ATTACHMENT_INTAKE_TIMEOUT';
  }
  return undefined;
}

function diagnosticContext(request: AttachmentIntakeRequest): Record<string, string> {
  return {
    ...(request.reservationId === undefined ? {} : { reservationId: request.reservationId }),
    requestId: request.requestId,
    runId: request.runId,
    sessionId: request.sessionId,
    agentId: request.agentId,
    tenantId: request.identityContext.tenantId,
    subjectId: request.identityContext.subjectId,
    intakeAttemptId: `${request.idempotencyKey}:intake`,
  };
}

function normalizeMime(value: string): string {
  return value.trim().split(';')[0]?.toLowerCase() ?? '';
}

function extensionOf(fileName: string): string {
  const safe = sanitizeFileName(fileName).toLowerCase();
  const index = safe.lastIndexOf('.');
  return index < 0 ? '' : safe.slice(index);
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/');
  const leaf = normalized.split('/').pop()?.trim() ?? '';
  return leaf.length === 0 ? 'attachment' : leaf.slice(0, 255);
}

export interface RetrySourceAttachmentValidationRequest {
  readonly tenantId: RequestAttachmentRecord['tenantId'];
  readonly subjectId: RequestAttachmentRecord['subjectId'];
  readonly agentId: RequestAttachmentRecord['agentId'];
  readonly source: {
    readonly sessionId: RequestAttachmentRecord['sessionId'];
    readonly requestId: RequestAttachmentRecord['requestId'];
    readonly runId: NonNullable<RequestAttachmentRecord['runId']>;
  };
  readonly attachmentIds: ReadonlyArray<RequestAttachmentRecord['attachmentId']>;
}

export interface RetrySourceAttachmentValidationResult {
  readonly status: 'VALID' | 'UNAVAILABLE';
}

export interface RetrySourceAttachmentValidator {
  validateRetrySourceAttachments: (request: RetrySourceAttachmentValidationRequest) => Promise<RetrySourceAttachmentValidationResult>;
}

export function createRetrySourceAttachmentValidator(attachmentStore: AttachmentStoreGateway): RetrySourceAttachmentValidator {
  return {
    async validateRetrySourceAttachments(request) {
      for (const attachmentId of request.attachmentIds) {
        const attachment = await attachmentStore
          .loadAttachment({
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            agentId: request.agentId,
            attachmentId,
          })
          .catch(() => undefined);
        if (!isRetrySourceAttachmentAvailable(attachment, request)) {
          return { status: 'UNAVAILABLE' };
        }
      }
      return { status: 'VALID' };
    },
  };
}

function isRetrySourceAttachmentAvailable(
  attachment: RequestAttachmentRecord | undefined,
  request: RetrySourceAttachmentValidationRequest,
): attachment is RequestAttachmentRecord {
  return (
    attachment !== undefined &&
    attachment.sessionId === request.source.sessionId &&
    attachment.requestId === request.source.requestId &&
    (attachment.runId === undefined || attachment.runId === request.source.runId) &&
    attachment.validationStatus === 'ACCEPTED' &&
    attachment.availabilityStatus === 'AVAILABLE'
  );
}
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
