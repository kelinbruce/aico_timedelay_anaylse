import {
  brand,
  getLogger,
  type AgentId,
  type EpochMillis,
  type IdentityContext,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type {
  AttachmentStoreGateway,
  BlobStoreGateway,
  RequestAttachmentRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';

const logger = getLogger({ component: 'agent-attachment-runtime', source: 'cleanup' });

export type AttachmentCleanupReasonCode = 'ADMISSION_GAP_ORPHAN' | 'PARTIAL_STAGING_ORPHAN' | 'EXPLICIT_UNAVAILABLE' | 'FAILED_ADMISSION_DETACH';

export type AttachmentCleanupOutcome = 'COMPLETED' | 'ALREADY_UNAVAILABLE' | 'NOT_FOUND' | 'REJECTED' | 'FAILED';

const cleanupAuditEvents: Readonly<Record<AttachmentCleanupOutcome, string>> = {
  COMPLETED: 'attachment.cleanup.completed',
  ALREADY_UNAVAILABLE: 'attachment.cleanup.already_unavailable',
  NOT_FOUND: 'attachment.cleanup.not_found',
  REJECTED: 'attachment.cleanup.rejected',
  FAILED: 'attachment.cleanup.failed',
};

export interface AttachmentCleanupRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly reasonCode: AttachmentCleanupReasonCode;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly attachmentIds?: ReadonlyArray<RequestAttachmentRecord['attachmentId']>;
  readonly requestContextId?: RequestContextId;
}

export interface AttachmentCleanupEvidence {
  readonly tenantId: IdentityContext['tenantId'];
  readonly subjectId: IdentityContext['subjectId'];
  readonly agentId: AgentId;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly requestContextId?: RequestContextId;
  readonly attachmentId?: RequestAttachmentRecord['attachmentId'];
  readonly reasonCode: AttachmentCleanupReasonCode;
  readonly referenced: boolean;
  readonly blobExisted?: boolean;
  readonly blobDeleteAttempted: boolean;
  readonly blobDeleted?: boolean;
  readonly metadataUpdated?: boolean;
  readonly occurredAt: EpochMillis;
  readonly durationMs: number;
  readonly safeReasonCode: string;
}

export interface AttachmentCleanupTargetResult {
  readonly attachment?: RequestAttachmentRecord;
  readonly outcome: AttachmentCleanupOutcome;
  readonly evidence: AttachmentCleanupEvidence;
}

export interface AttachmentCleanupResult {
  readonly outcome: AttachmentCleanupOutcome;
  readonly safeReasonCode: string;
  readonly updatedAttachments: readonly RequestAttachmentRecord[];
  readonly targetResults: readonly AttachmentCleanupTargetResult[];
  readonly evidence: readonly AttachmentCleanupEvidence[];
}

export interface AttachmentCleanupRuntime {
  cleanup: (request: AttachmentCleanupRequest, signal?: AbortSignal) => Promise<AttachmentCleanupResult>;
}

export interface AttachmentCleanupDependencies {
  readonly attachmentStore: AttachmentStoreGateway;
  readonly blobStore: BlobStoreGateway;
  readonly messageStore?: SessionMessageStoreGateway;
  readonly clock?: () => EpochMillis;
  readonly outcomeObserver?: (event: AttachmentCleanupOutcomeObservation) => void;
  readonly onRollbackFailure?: (event: AttachmentCleanupRollbackFailure) => void;
}

export interface AttachmentCleanupRollbackFailure {
  readonly tenantId: IdentityContext['tenantId'];
  readonly subjectId: IdentityContext['subjectId'];
  readonly agentId: AgentId;
  readonly requestId?: MessageId;
  readonly sessionId?: SessionId;
  readonly runId?: RequestRunId;
  readonly reasonCode: AttachmentCleanupReasonCode;
  readonly safeReasonCode: string;
}

export interface AttachmentCleanupOutcomeObservation {
  readonly outcome: AttachmentCleanupOutcome;
  readonly tenantId: IdentityContext['tenantId'];
  readonly subjectId: IdentityContext['subjectId'];
  readonly agentId: AgentId;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly requestContextId?: RequestContextId;
  readonly reasonCode: AttachmentCleanupReasonCode;
  readonly attachmentCount: number;
  readonly durationMs: number;
  readonly safeReasonCode: string;
}

export function createAttachmentCleanupRuntime(deps: AttachmentCleanupDependencies): AttachmentCleanupRuntime {
  return new DefaultAttachmentCleanupRuntime(deps);
}

class DefaultAttachmentCleanupRuntime implements AttachmentCleanupRuntime {
  constructor(private readonly deps: AttachmentCleanupDependencies) {}

  async cleanup(request: AttachmentCleanupRequest, signal?: AbortSignal): Promise<AttachmentCleanupResult> {
    const startedAt = this.now();
    if (signal?.aborted === true) {
      return this.finish(request, [], 'FAILED', 'ATTACHMENT_CLEANUP_TIMEOUT', startedAt);
    }

    if (!this.hasTrustedLocator(request)) {
      return this.finish(request, [], 'REJECTED', 'ATTACHMENT_CLEANUP_VALIDATION_FAILED', startedAt);
    }

    const targets = await this.resolveTargets(request);
    if (targets === undefined) {
      return this.finish(request, [], 'NOT_FOUND', 'ATTACHMENT_CLEANUP_NOT_FOUND', startedAt);
    }
    if (targets.length === 0) {
      return this.finish(request, [], 'NOT_FOUND', 'ATTACHMENT_CLEANUP_NOT_FOUND', startedAt);
    }

    const targetResults = await this.cleanupTargets(request, targets, startedAt, signal);
    const updatedAttachments = targetResults
      .filter((result) => result.attachment !== undefined && (result.outcome === 'COMPLETED' || result.outcome === 'ALREADY_UNAVAILABLE'))
      .map((result) => result.attachment!);
    const outcome = this.summarizeOutcome(targetResults);
    return this.finish(request, targetResults, outcome, cleanupOutcomeReasonCode(outcome), startedAt, updatedAttachments);
  }

  private async resolveTargets(request: AttachmentCleanupRequest): Promise<readonly RequestAttachmentRecord[] | undefined> {
    if (request.attachmentIds !== undefined && request.attachmentIds.length > 0) {
      return this.resolveAttachmentsByIds(request.identityContext, request.agentId, request.attachmentIds);
    }

    if (request.requestId !== undefined) {
      return this.resolveAttachmentsByRequestId(request);
    }

    if (request.runId !== undefined) {
      return this.resolveAttachmentsByRunId(request);
    }

    if (request.sessionId !== undefined && this.deps.messageStore !== undefined) {
      return this.resolveAttachmentsBySession(request.sessionId, request.identityContext, request.agentId);
    }

    return [];
  }

  private async resolveAttachmentsByIds(
    identityContext: IdentityContext,
    agentId: AgentId,
    attachmentIds: ReadonlyArray<RequestAttachmentRecord['attachmentId']>,
  ): Promise<readonly RequestAttachmentRecord[] | undefined> {
    const resolved = await Promise.all(
      attachmentIds.map(async (attachmentId) =>
        this.deps.attachmentStore
          .loadAttachment({
            tenantId: identityContext.tenantId,
            subjectId: identityContext.subjectId,
            agentId,
            attachmentId,
          })
          .catch(() => undefined),
      ),
    );
    return resolved.every((record) => record !== undefined) ? resolved : undefined;
  }

  private async resolveAttachmentsByRequestId(request: AttachmentCleanupRequest): Promise<readonly RequestAttachmentRecord[]> {
    if (request.requestId === undefined) {
      return [];
    }
    const attachments = await this.deps.attachmentStore
      .listAttachmentsByRequestId({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentId: request.agentId,
        requestId: request.requestId,
      })
      .catch(() => []);
    return attachments.length === 0 ? [] : attachments;
  }

  private async resolveAttachmentsByRunId(request: AttachmentCleanupRequest): Promise<readonly RequestAttachmentRecord[]> {
    if (request.runId === undefined) {
      return [];
    }
    const attachments = await this.deps.attachmentStore
      .listAttachmentsByRunId({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentId: request.agentId,
        runId: request.runId,
      })
      .catch(() => []);
    return attachments.length === 0 ? [] : attachments;
  }

  private async resolveAttachmentsBySession(
    sessionId: SessionId,
    identityContext: IdentityContext,
    agentId: AgentId,
  ): Promise<readonly RequestAttachmentRecord[] | undefined> {
    const attachmentIds = await this.scanSessionAttachmentIds(sessionId, identityContext, agentId);
    if (attachmentIds.length === 0) {
      return [];
    }
    return this.resolveAttachmentsByIds(identityContext, agentId, attachmentIds);
  }

  private async cleanupTargets(
    request: AttachmentCleanupRequest,
    targets: readonly RequestAttachmentRecord[],
    startedAt: EpochMillis,
    signal?: AbortSignal,
  ): Promise<readonly AttachmentCleanupTargetResult[]> {
    const targetResults: AttachmentCleanupTargetResult[] = [];
    for (const target of targets) {
      if (signal?.aborted) {
        targetResults.push(this.rejectedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_TIMEOUT'));
        continue;
      }
      targetResults.push(await this.cleanupTarget(request, target, startedAt));
    }
    return targetResults;
  }

  private summarizeOutcome(targetResults: readonly AttachmentCleanupTargetResult[]): AttachmentCleanupOutcome {
    let sawCompleted = false;
    let sawAlreadyUnavailable = false;
    let sawNotFound = false;
    let sawRejected = false;
    let sawFailed = false;
    for (const result of targetResults) {
      if (result.outcome === 'COMPLETED') {
        sawCompleted = true;
      } else if (result.outcome === 'ALREADY_UNAVAILABLE') {
        sawAlreadyUnavailable = true;
      } else if (result.outcome === 'NOT_FOUND') {
        sawNotFound = true;
      } else if (result.outcome === 'REJECTED') {
        sawRejected = true;
      } else {
        sawFailed = true;
      }
    }
    return sawFailed
      ? 'FAILED'
      : sawRejected
        ? 'REJECTED'
        : sawCompleted
          ? 'COMPLETED'
          : sawAlreadyUnavailable
            ? 'ALREADY_UNAVAILABLE'
            : sawNotFound
              ? 'NOT_FOUND'
              : 'FAILED';
  }

  private async cleanupTarget(
    request: AttachmentCleanupRequest,
    target: RequestAttachmentRecord,
    startedAt: EpochMillis,
  ): Promise<AttachmentCleanupTargetResult> {
    const referenced = await this.isReferenced(request, target);
    if (!this.canDeleteTarget(request.reasonCode, referenced)) {
      return this.rejectedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_REFERENCE_PROTECTED', referenced);
    }

    const blobExists = await this.deps.blobStore
      .blobExists({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        blobRef: target.storageRef,
      })
      .catch(() => undefined);
    if (blobExists === undefined) {
      return this.rejectedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_DEPENDENCY_MISSING', referenced);
    }

    if (blobExists !== true) {
      const updated = await this.updateUnavailable(request, target);
      if (updated === undefined) {
        return this.failedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_METADATA_UPDATE_FAILED', referenced, false, blobExists);
      }
      const alreadyUnavailable = target.availabilityStatus === 'UNAVAILABLE';
      const targetOutcome: AttachmentCleanupOutcome = alreadyUnavailable ? 'ALREADY_UNAVAILABLE' : 'COMPLETED';
      return {
        attachment: updated,
        outcome: targetOutcome,
        evidence: this.evidence(request, target, startedAt, referenced, false, false, true, blobExists, cleanupOutcomeReasonCode(targetOutcome)),
      };
    }

    const deleted = await this.deps.blobStore
      .deleteBlob({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        blobRef: target.storageRef,
      })
      .catch(() => undefined);
    if (deleted === undefined) {
      return this.rejectedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_DEPENDENCY_MISSING', referenced, true, blobExists);
    }

    if (deleted !== true) {
      const updated = await this.updateUnavailable(request, target);
      if (updated === undefined) {
        return this.failedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_METADATA_UPDATE_FAILED', referenced, true, blobExists, false);
      }
      const alreadyUnavailable = target.availabilityStatus === 'UNAVAILABLE';
      const targetOutcome: AttachmentCleanupOutcome = alreadyUnavailable ? 'ALREADY_UNAVAILABLE' : 'COMPLETED';
      return {
        attachment: updated,
        outcome: targetOutcome,
        evidence: this.evidence(request, target, startedAt, referenced, true, false, true, blobExists, cleanupOutcomeReasonCode(targetOutcome)),
      };
    }

    const updated = await this.updateUnavailable(request, target);
    if (updated === undefined) {
      return this.failedTarget(request, target, startedAt, 'ATTACHMENT_CLEANUP_METADATA_UPDATE_FAILED', referenced, true, blobExists, true);
    }
    return {
      attachment: updated,
      outcome: 'COMPLETED',
      evidence: this.evidence(request, target, startedAt, referenced, true, true, true, blobExists, cleanupOutcomeReasonCode('COMPLETED')),
    };
  }

  private hasTrustedLocator(request: AttachmentCleanupRequest): boolean {
    return (
      (request.attachmentIds !== undefined && request.attachmentIds.length > 0) ||
      request.sessionId !== undefined ||
      request.requestId !== undefined ||
      request.runId !== undefined
    );
  }

  private async updateUnavailable(request: AttachmentCleanupRequest, target: RequestAttachmentRecord): Promise<RequestAttachmentRecord | undefined> {
    return await this.deps.attachmentStore
      .updateAttachmentStatus({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentId: request.agentId,
        attachmentId: target.attachmentId,
        validationStatus: target.validationStatus,
        availabilityStatus: 'UNAVAILABLE',
      })
      .catch(() => undefined);
  }

  private async isReferenced(request: AttachmentCleanupRequest, target: RequestAttachmentRecord): Promise<boolean> {
    if (this.deps.messageStore === undefined) {
      return false;
    }
    if (request.sessionId !== undefined) {
      const attachmentIds = await this.scanSessionAttachmentIds(request.sessionId, request.identityContext, request.agentId);
      return attachmentIds.includes(target.attachmentId);
    }
    const attachmentIds = await this.scanSessionAttachmentIds(target.sessionId, request.identityContext, request.agentId);
    return attachmentIds.includes(target.attachmentId);
  }

  private canDeleteTarget(reasonCode: AttachmentCleanupReasonCode, referenced: boolean): boolean {
    const availabilityOnlyReason = reasonCode === 'EXPLICIT_UNAVAILABLE';
    const orphanReason = reasonCode === 'ADMISSION_GAP_ORPHAN' || reasonCode === 'PARTIAL_STAGING_ORPHAN' || reasonCode === 'FAILED_ADMISSION_DETACH';
    return availabilityOnlyReason || orphanReason || !referenced;
  }

  private async scanSessionAttachmentIds(
    sessionId: SessionId,
    identityContext: IdentityContext,
    agentId: AgentId,
  ): Promise<ReadonlyArray<RequestAttachmentRecord['attachmentId']>> {
    const messageStore = this.deps.messageStore;
    if (messageStore === undefined) {
      return [];
    }
    const attachmentIds: Array<RequestAttachmentRecord['attachmentId']> = [];
    let beforeCursor: string | undefined;
    for (;;) {
      const page = await messageStore
        .listMessages({
          tenantId: identityContext.tenantId,
          subjectId: identityContext.subjectId,
          agentId,
          sessionId,
          includeHidden: true,
          includeCapabilityResults: true,
          limit: 100,
          ...(beforeCursor === undefined ? {} : { beforeCursor }),
        })
        .catch(() => undefined);
      if (page === undefined) {
        return [];
      }
      for (const message of page.items) {
        attachmentIds.push(...attachmentIdsFromMetadata(message.metadata));
      }
      if (page.hasMore !== true || page.nextBeforeCursor === undefined) {
        return attachmentIds;
      }
      beforeCursor = page.nextBeforeCursor;
    }
  }

  private targetEvidence(
    request: AttachmentCleanupRequest,
    target: RequestAttachmentRecord,
    startedAt: EpochMillis,
    referenced: boolean,
    blobDeleteAttempted: boolean,
    blobDeleted: boolean | undefined,
    metadataUpdated: boolean,
    blobExisted?: boolean,
    safeReasonCode: string = cleanupOutcomeReasonCode(metadataUpdated ? 'COMPLETED' : 'FAILED'),
  ): AttachmentCleanupEvidence {
    return {
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      sessionId: target.sessionId,
      requestId: target.requestId,
      ...(target.runId === undefined ? {} : { runId: target.runId }),
      ...(request.requestContextId === undefined ? {} : { requestContextId: request.requestContextId }),
      attachmentId: target.attachmentId,
      reasonCode: request.reasonCode,
      referenced,
      ...(blobExisted === undefined ? {} : { blobExisted }),
      blobDeleteAttempted,
      ...(blobDeleted === undefined ? {} : { blobDeleted }),
      metadataUpdated,
      occurredAt: this.now(),
      durationMs: Math.max(0, Number(this.now()) - Number(startedAt)),
      safeReasonCode,
    };
  }

  private evidence(
    request: AttachmentCleanupRequest,
    target: RequestAttachmentRecord,
    startedAt: EpochMillis,
    referenced: boolean,
    blobDeleteAttempted: boolean,
    blobDeleted: boolean | undefined,
    metadataUpdated: boolean,
    blobExisted?: boolean,
    safeReasonCode: string = cleanupOutcomeReasonCode(metadataUpdated ? 'COMPLETED' : 'FAILED'),
  ): AttachmentCleanupEvidence {
    return this.targetEvidence(
      request,
      target,
      startedAt,
      referenced,
      blobDeleteAttempted,
      blobDeleted,
      metadataUpdated,
      blobExisted,
      safeReasonCode,
    );
  }

  private rejectedTarget(
    request: AttachmentCleanupRequest,
    target: RequestAttachmentRecord,
    startedAt: EpochMillis,
    safeReasonCode: string,
    referenced = false,
    blobDeleteAttempted = false,
    blobExisted?: boolean,
  ): AttachmentCleanupTargetResult {
    return {
      attachment: target,
      outcome: 'REJECTED',
      evidence: this.targetEvidence(request, target, startedAt, referenced, blobDeleteAttempted, undefined, false, blobExisted, safeReasonCode),
    };
  }

  private failedTarget(
    request: AttachmentCleanupRequest,
    target: RequestAttachmentRecord,
    startedAt: EpochMillis,
    safeReasonCode: string,
    referenced: boolean,
    blobDeleteAttempted: boolean,
    blobExisted?: boolean,
    blobDeleted?: boolean,
  ): AttachmentCleanupTargetResult {
    return {
      attachment: target,
      outcome: 'FAILED',
      evidence: this.targetEvidence(request, target, startedAt, referenced, blobDeleteAttempted, blobDeleted, false, blobExisted, safeReasonCode),
    };
  }

  private finish(
    request: AttachmentCleanupRequest,
    targetResults: readonly AttachmentCleanupTargetResult[],
    outcome: AttachmentCleanupOutcome,
    safeReasonCode: string,
    startedAt: EpochMillis,
    updatedAttachments: RequestAttachmentRecord[] = [],
  ): AttachmentCleanupResult {
    this.observeOutcome(request, targetResults, outcome, safeReasonCode, startedAt);
    this.auditOutcome(request, targetResults, outcome, safeReasonCode, startedAt, updatedAttachments);
    return {
      outcome,
      safeReasonCode,
      updatedAttachments,
      targetResults,
      evidence: targetResults.map((result) => result.evidence),
    };
  }

  private observeOutcome(
    request: AttachmentCleanupRequest,
    targetResults: readonly AttachmentCleanupTargetResult[],
    outcome: AttachmentCleanupOutcome,
    safeReasonCode: string,
    startedAt: EpochMillis,
  ): void {
    try {
      this.deps.outcomeObserver?.({
        outcome,
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentId: request.agentId,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        ...(request.runId === undefined ? {} : { runId: request.runId }),
        ...(request.requestContextId === undefined ? {} : { requestContextId: request.requestContextId }),
        reasonCode: request.reasonCode,
        attachmentCount: targetResults.length,
        durationMs: Math.max(0, Number(this.now()) - Number(startedAt)),
        safeReasonCode,
      });
    } catch {
      logger.warn({
        event: 'attachment.cleanup.observation_failed',
        agentId: request.agentId,
        safeReasonCode: 'ATTACHMENT_CLEANUP_OBSERVATION_FAILED',
      });
    }
  }

  private auditOutcome(
    request: AttachmentCleanupRequest,
    targetResults: readonly AttachmentCleanupTargetResult[],
    outcome: AttachmentCleanupOutcome,
    safeReasonCode: string,
    startedAt: EpochMillis,
    updatedAttachments: readonly RequestAttachmentRecord[],
  ): void {
    const entry = {
      event: cleanupAuditEvents[outcome],
      agentId: request.agentId,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.runId === undefined ? {} : { runId: request.runId }),
      attachmentIds: targetResults.flatMap((result) => (result.attachment === undefined ? [] : [result.attachment.attachmentId])),
      safeReasonCode,
      attachmentCount: targetResults.length,
      updatedCount: updatedAttachments.length,
      durationMs: Math.max(0, Number(this.now()) - Number(startedAt)),
      results: targetResults.map((result) => ({
        outcome: result.outcome,
        attachmentId: result.attachment?.attachmentId,
        referenced: result.evidence.referenced,
        safeReasonCode: result.evidence.safeReasonCode,
        blobExisted: result.evidence.blobExisted,
        blobDeleteAttempted: result.evidence.blobDeleteAttempted,
        blobDeleted: result.evidence.blobDeleted,
        metadataUpdated: result.evidence.metadataUpdated,
      })),
    };
    try {
      if (outcome === 'FAILED') {
        logger.warn(entry);
      } else if (outcome === 'REJECTED' || outcome === 'NOT_FOUND') {
        logger.warn(entry);
      } else {
        logger.info(entry);
      }
    } catch {
      logger.warn({
        event: 'attachment.cleanup.audit_failed',
        agentId: request.agentId,
        safeReasonCode,
      });
    }
  }

  private now(): EpochMillis {
    return this.deps.clock?.() ?? brand<number, 'EpochMillis'>(Date.now());
  }
}

function attachmentIdsFromMetadata(metadata: Record<string, unknown>): ReadonlyArray<RequestAttachmentRecord['attachmentId']> {
  const value = metadata['attachmentIds'];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is RequestAttachmentRecord['attachmentId'] => typeof item === 'string' && item.length > 0);
}

function cleanupOutcomeReasonCode(outcome: AttachmentCleanupOutcome): string {
  switch (outcome) {
    case 'COMPLETED':
      return 'ATTACHMENT_CLEANUP_COMPLETED';
    case 'ALREADY_UNAVAILABLE':
      return 'ATTACHMENT_CLEANUP_ALREADY_UNAVAILABLE';
    case 'NOT_FOUND':
      return 'ATTACHMENT_CLEANUP_NOT_FOUND';
    case 'REJECTED':
      return 'ATTACHMENT_CLEANUP_REJECTED';
    case 'FAILED':
      return 'ATTACHMENT_CLEANUP_FAILED';
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

export async function cleanupAttachmentBlobRollback(
  deps: Pick<AttachmentCleanupDependencies, 'blobStore' | 'onRollbackFailure' | 'clock'>,
  request: {
    readonly identityContext: IdentityContext;
    readonly agentId: AgentId;
    readonly requestId?: MessageId;
    readonly sessionId?: SessionId;
    readonly runId?: RequestRunId;
    readonly storageRef: RequestAttachmentRecord['storageRef'];
    readonly reasonCode: AttachmentCleanupReasonCode;
  },
): Promise<boolean> {
  const existed = await deps.blobStore
    .blobExists({
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      blobRef: request.storageRef,
    })
    .catch(() => undefined);
  if (existed !== true) {
    deps.onRollbackFailure?.({
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      ...(request.runId === undefined ? {} : { runId: request.runId }),
      reasonCode: request.reasonCode,
      safeReasonCode: 'ATTACHMENT_CLEANUP_ROLLBACK_NOT_FOUND',
    });
    return false;
  }
  const deleted = await deps.blobStore
    .deleteBlob({
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      blobRef: request.storageRef,
    })
    .catch(() => undefined);
  if (deleted !== true) {
    deps.onRollbackFailure?.({
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      ...(request.runId === undefined ? {} : { runId: request.runId }),
      reasonCode: request.reasonCode,
      safeReasonCode: 'ATTACHMENT_CLEANUP_ROLLBACK_DELETE_FAILED',
    });
    logger.warn({
      event: 'attachment.cleanup.rollback_failed',
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      reasonCode: request.reasonCode,
    });
    return false;
  }
  return true;
}
