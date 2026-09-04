import type { CapabilityId, CapabilityKind, JsonObject, MessageId } from '@nextagent/agent-common';
import { isCapabilityStartedTimelinePayload } from '../projection/capability-timeline-payload-schemas.js';

export interface CapabilityProcessIdentity {
  readonly capabilityKind: CapabilityKind;
  readonly capabilityId: CapabilityId;
  readonly targetCapabilityId?: string;
}

export interface CapabilityStartedPayloadInput {
  readonly processIdentity: CapabilityProcessIdentity;
  readonly toolCallId: string;
  readonly stepId: string;
  readonly messageId?: MessageId;
  readonly toolBatch?: {
    readonly executionMode: 'PARALLEL' | 'SERIAL';
    readonly ordinal: number;
    readonly size: number;
  };
}

export function capabilityStartedPayload(input: CapabilityStartedPayloadInput): JsonObject {
  const payload = {
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    ...input.processIdentity,
    toolCallId: input.toolCallId,
    stepId: input.stepId,
    ...(input.toolBatch === undefined
      ? {}
      : {
          toolBatchExecutionMode: input.toolBatch.executionMode,
          toolBatchOrdinal: input.toolBatch.ordinal,
          toolBatchSize: input.toolBatch.size,
        }),
  };
  return isCapabilityStartedTimelinePayload(payload)
    ? payload
    : {
        ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
        ...input.processIdentity,
        toolCallId: input.toolCallId,
        stepId: input.stepId,
        projectionUnavailable: 'CAPABILITY_PROJECTION_INVALID',
      };
}
