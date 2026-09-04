import type { StreamEnvelope } from '../../../state/contracts.ts';

const DEFAULT_STREAM_TEXT_FIELDS = ['text', 'content', 'delta', 'progress', 'result', 'message', 'reason'] as const;
const RESULT_STREAM_EVENT_TYPES = new Set(['LLM_CONTENT_DELTA', 'LLM_THINKING_DELTA', 'CAPABILITY_RESULT_DELTA']);
const REQUEST_TERMINAL_EVENT_TYPES = new Set([
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

export function readPayloadMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = payload.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
}

export function readPayloadBooleanFlag(payload: Record<string, unknown>, key: string): boolean | null {
  const directValue = payload[key];
  if (typeof directValue === 'boolean') {
    return directValue;
  }
  const metadataValue = readPayloadMetadata(payload)?.[key];
  return typeof metadataValue === 'boolean' ? metadataValue : null;
}

export function readCompletedProcessContentStepId(event: StreamEnvelope): string | null {
  if (event.eventType !== 'LLM_CONTENT_DELTA') {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const stepId = payload.stepId;
  if (typeof stepId !== 'string' || stepId.trim().length === 0 || readPayloadBooleanFlag(payload, 'completed') !== true || payload.final === true) {
    return null;
  }
  return stepId.trim();
}

export function readPendingProcessContentStepId(event: StreamEnvelope): string | null {
  if (event.eventType !== 'LLM_CONTENT_DELTA') {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const stepId = payload.stepId;
  if (
    typeof stepId !== 'string' ||
    stepId.trim().length === 0 ||
    readPayloadBooleanFlag(payload, 'completed') === true ||
    payload.final === true ||
    payload.role === 'CAPABILITY_RESULT'
  ) {
    return null;
  }
  return stepId.trim();
}

export function isCompletedProcessContentEvent(event: StreamEnvelope): boolean {
  return readCompletedProcessContentStepId(event) !== null;
}

export function isCompletedWorkflowStructuredAnswerEvent(event: StreamEnvelope): boolean {
  if (event.eventType !== 'TOOL_STRUCTURED_DELTA' || !isWorkflowProcessEvent(event)) {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return payload.toolEventType === 'ANSWER' && payload.workflowEventType === 'NODE_COMPLETED';
}

export function reconcileWorkflowProductFragments(events: readonly StreamEnvelope[]): readonly StreamEnvelope[] {
  const terminalRuns = new Set<string>();
  const completedProductSequences = new Map<string, number>();
  events.forEach((event) => {
    const runIdentity = workflowRunIdentity(event);
    if (runIdentity !== null && REQUEST_TERMINAL_EVENT_TYPES.has(event.eventType)) {
      terminalRuns.add(runIdentity);
    }
    const productIdentity = workflowProductIdentity(event);
    if (productIdentity === null || (event.payload as Record<string, unknown>).workflowEventType !== 'NODE_COMPLETED') {
      return;
    }
    completedProductSequences.set(productIdentity, Math.max(completedProductSequences.get(productIdentity) ?? -1, event.sequence));
  });

  return events.filter((event) => {
    const payload = event.payload as Record<string, unknown>;
    if (event.eventType !== 'TOOL_STRUCTURED_DELTA' || payload.workflowEventType !== 'NODE_OUTPUT_DELTA') {
      return true;
    }
    const runIdentity = workflowRunIdentity(event);
    const productIdentity = workflowProductIdentity(event);
    if (runIdentity === null || productIdentity === null) {
      return true;
    }
    if (terminalRuns.has(runIdentity)) {
      return false;
    }
    const completedSequence = completedProductSequences.get(productIdentity);
    return completedSequence === undefined || completedSequence < event.sequence;
  });
}

function workflowRunIdentity(event: StreamEnvelope): string | null {
  const runId = readNonBlankString(event.runId);
  return runId === null ? null : `${event.sessionId}:${runId}`;
}

export function readWorkflowOccurrenceCorrelationId(event: StreamEnvelope): string | null {
  if (!isWorkflowProcessEvent(event)) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const nodeExecutionId = readNonBlankString(payload.nodeExecutionId);
  const toolCallId = readNonBlankString(payload.toolCallId);
  if (nodeExecutionId === null || toolCallId === null) {
    return null;
  }
  return `${toolCallId}:node-execution:${nodeExecutionId}`;
}

function workflowProductIdentity(event: StreamEnvelope): string | null {
  if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const runIdentity = workflowRunIdentity(event);
  const nodeId = readNonBlankString(payload.nodeId);
  const nodeExecutionId = readNonBlankString(payload.nodeExecutionId) ?? readNonBlankString(payload.nodeId);
  const toolCallId = readNonBlankString(payload.toolCallId);
  const toolEventType = readNonBlankString(payload.toolEventType);
  const toolMessageType = readNonBlankString(payload.toolMessageType);
  if (
    runIdentity === null ||
    nodeId === null ||
    nodeExecutionId === null ||
    toolCallId === null ||
    !isWorkflowProcessEvent(event) ||
    toolEventType === null ||
    toolMessageType === null
  ) {
    return null;
  }
  return `${runIdentity}:${toolCallId}:occurrence:${nodeExecutionId}:${toolEventType}:${toolMessageType}`;
}

export function isWorkflowProcessEvent(event: StreamEnvelope): boolean {
  const payload = event.payload as Record<string, unknown>;
  const workflowEventType = readNonBlankString(payload.workflowEventType);
  const toolCallId = readNonBlankString(payload.toolCallId);
  return workflowEventType !== null && toolCallId?.startsWith('workflow:') === true;
}

function readNonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readStreamPayloadText(
  payload: Record<string, unknown>,
  fields: readonly string[] = DEFAULT_STREAM_TEXT_FIELDS,
  options: { readonly allowWhitespaceOnly?: boolean } = {},
): string {
  for (const field of fields) {
    const candidate = payload[field];
    if (typeof candidate !== 'string') {
      continue;
    }
    if (options.allowWhitespaceOnly ? candidate.length > 0 : candidate.trim().length > 0) {
      return candidate;
    }
  }
  return '';
}

export function readStreamText(event: StreamEnvelope, fields?: readonly string[], options: { readonly allowWhitespaceOnly?: boolean } = {}): string {
  return readStreamPayloadText(event.payload as Record<string, unknown>, fields, options);
}

export function isResultStreamEvent(event: StreamEnvelope): boolean {
  return RESULT_STREAM_EVENT_TYPES.has(event.eventType);
}

export function readStreamAccumulatedFlag(payload: Record<string, unknown>): boolean {
  return readPayloadBooleanFlag(payload, 'accumulated') !== false;
}

export function readCompactedEventCount(event: StreamEnvelope): number {
  const payload = event.payload as Record<string, unknown>;
  return readPositiveInteger(payload.compactedEventCount) ?? readPositiveInteger(readPayloadMetadata(payload)?.compactedEventCount) ?? 1;
}

function longestSuffixPrefixOverlap(current: string, next: string): number {
  const maxOverlap = Math.min(current.length, next.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (current.endsWith(next.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function isMeaningfulOverlap(current: string, next: string, overlapLength: number): boolean {
  if (overlapLength <= 0) {
    return false;
  }
  const smallerLength = Math.min(current.length, next.length);
  if (smallerLength <= 8) {
    return overlapLength >= 1;
  }
  return overlapLength >= Math.min(16, Math.max(3, Math.ceil(smallerLength * 0.25)));
}

function isRawDeltaFrame(payload: Record<string, unknown>, next: string): boolean {
  return typeof payload.delta === 'string' && payload.delta === next;
}

export function mergeStreamText(current: string, next: string, payload: Record<string, unknown>): string {
  if (next.length === 0) {
    return current;
  }
  if (!current) {
    return next;
  }

  const accumulated = readPayloadBooleanFlag(payload, 'accumulated');
  if (accumulated === false || isRawDeltaFrame(payload, next)) {
    return `${current}${next}`;
  }

  if (next === current || current.endsWith(next)) {
    return current;
  }
  if (next.startsWith(current)) {
    return next;
  }

  const overlapLength = longestSuffixPrefixOverlap(current, next);
  if (isMeaningfulOverlap(current, next, overlapLength)) {
    return `${current}${next.slice(overlapLength)}`;
  }

  return next;
}
