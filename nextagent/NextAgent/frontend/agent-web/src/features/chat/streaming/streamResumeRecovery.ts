import {
  STREAM_RESUME_FAILURE_REASONS,
  STREAM_RESUME_GAP_REASONS,
  type StreamResumeFailureDetails,
  type StreamResumeGapNotice,
} from '../../../state/contracts.ts';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readSafeSequence(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isGapReason(value: unknown): value is StreamResumeGapNotice['reason'] {
  return typeof value === 'string' && STREAM_RESUME_GAP_REASONS.includes(value as StreamResumeGapNotice['reason']);
}

function isFailureReason(value: unknown): value is StreamResumeFailureDetails['reason'] {
  return typeof value === 'string' && STREAM_RESUME_FAILURE_REASONS.includes(value as StreamResumeFailureDetails['reason']);
}

export function parseStreamResumeGapNotice(value: unknown): StreamResumeGapNotice | null {
  const payload = readRecord(value);
  if (!payload || payload.kind !== 'STREAM_RESUME_GAP' || !isGapReason(payload.reason)) {
    return null;
  }
  const resumeAfterSequence = readSafeSequence(payload.resumeAfterSequence);
  if (resumeAfterSequence === null || payload.retryable !== true || payload.refreshConversation !== true) {
    return null;
  }
  return {
    kind: 'STREAM_RESUME_GAP',
    reason: payload.reason,
    retryable: true,
    refreshConversation: true,
    resumeAfterSequence,
  };
}

export function parseStreamResumeFailureDetails(value: unknown): StreamResumeFailureDetails | null {
  const details = readRecord(value);
  if (!details || details.kind !== 'STREAM_RESUME_FAILURE' || !isFailureReason(details.reason)) {
    return null;
  }
  const resumeAfterSequence = details.resumeAfterSequence === null ? null : readSafeSequence(details.resumeAfterSequence);
  if (
    typeof details.retryable !== 'boolean' ||
    typeof details.refreshConversation !== 'boolean' ||
    (resumeAfterSequence === null && details.resumeAfterSequence !== null)
  ) {
    return null;
  }
  return {
    kind: 'STREAM_RESUME_FAILURE',
    reason: details.reason,
    retryable: details.retryable,
    refreshConversation: details.refreshConversation,
    resumeAfterSequence,
  };
}
