import type {
  AttachmentAvailabilityStatus,
  AttachmentId,
  AttachmentMediaType,
  AttachmentValidationStatus,
  BlobRef,
  EpochMillis,
  MessageId,
  RequestRunId,
  SessionId,
} from '@nextagent/agent-common';

export type { AttachmentAvailabilityStatus, AttachmentMediaType, AttachmentValidationStatus } from '@nextagent/agent-common';

export interface RequestAttachment {
  readonly attachmentId: AttachmentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly fileName: string;
  readonly mediaType: AttachmentMediaType;
  readonly sizeBytes: number;
  readonly storageRef: BlobRef;
  readonly validationStatus: AttachmentValidationStatus;
  readonly availabilityStatus: AttachmentAvailabilityStatus;
  readonly createdAt: EpochMillis;
}
