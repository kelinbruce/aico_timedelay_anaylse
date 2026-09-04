import type { RunStatus } from '@nextagent/agent-common';
import { AgentError } from '@nextagent/agent-common';
import type { JsonObject } from '@nextagent/agent-common';
import type { StreamEnvelope, StreamEventType } from '@nextagent/agent-contracts/channel';

export type TaskStatus =
  | 'TASK_ACCEPTED'
  | 'TASK_QUEUED'
  | 'TASK_PLANNING'
  | 'TASK_EXECUTING'
  | 'TASK_PENDING'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELED'
  | 'TASK_SUPERSEDED';

export type TaskEventType =
  | 'TASK_ACCEPTED'
  | 'THINKING_DELTA'
  | 'CONTENT_DELTA'
  | 'CAPABILITY_STARTED'
  | 'CAPABILITY_RESULT_DELTA'
  | 'CAPABILITY_COMPLETED'
  | 'TOOL_STRUCTURED_DELTA'
  | 'DEGRADATION_NOTICE'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELED'
  | 'TASK_SUPERSEDED'
  | 'USER_INPUT_REQUIRED'
  | 'USER_INPUT_RECEIVED'
  | 'USER_INPUT_TIMEOUT'
  | 'USER_INPUT_CANCELED'
  | 'ATTACHMENT_ACCEPTED'
  | 'ATTACHMENT_REJECTED'
  | 'CONTEXT_COMPACTED'
  | 'BACKGROUND_TASK_STARTED'
  | 'BACKGROUND_TASK_COMPLETED'
  | 'BACKGROUND_TASK_FAILED'
  | 'OUTPUT_GUARD_BLOCKED';

const taskStatusByRunStatus = {
  ACCEPTED: 'TASK_ACCEPTED',
  QUEUED: 'TASK_QUEUED',
  PLANNING: 'TASK_PLANNING',
  EXECUTING: 'TASK_EXECUTING',
  COMPLETED: 'TASK_COMPLETED',
  FAILED: 'TASK_FAILED',
  CANCELED: 'TASK_CANCELED',
  SUPERSEDED: 'TASK_SUPERSEDED',
} as const satisfies Record<RunStatus, TaskStatus>;

const taskEventTypeByStreamEventType = {
  REQUEST_ACCEPTED: 'TASK_ACCEPTED',
  LLM_THINKING_DELTA: 'THINKING_DELTA',
  LLM_CONTENT_DELTA: 'CONTENT_DELTA',
  CAPABILITY_STARTED: 'CAPABILITY_STARTED',
  CAPABILITY_RESULT_DELTA: 'CAPABILITY_RESULT_DELTA',
  CAPABILITY_COMPLETED: 'CAPABILITY_COMPLETED',
  TOOL_STRUCTURED_DELTA: 'TOOL_STRUCTURED_DELTA',
  DEGRADATION_NOTICE: 'DEGRADATION_NOTICE',
  REQUEST_COMPLETED: 'TASK_COMPLETED',
  REQUEST_FAILED: 'TASK_FAILED',
  REQUEST_CANCELED: 'TASK_CANCELED',
  REQUEST_SUPERSEDED: 'TASK_SUPERSEDED',
  USER_INPUT_REQUIRED: 'USER_INPUT_REQUIRED',
  USER_INPUT_RECEIVED: 'USER_INPUT_RECEIVED',
  USER_INPUT_TIMEOUT: 'USER_INPUT_TIMEOUT',
  USER_INPUT_CANCELED: 'USER_INPUT_CANCELED',
  ATTACHMENT_ACCEPTED: 'ATTACHMENT_ACCEPTED',
  ATTACHMENT_REJECTED: 'ATTACHMENT_REJECTED',
  CONTEXT_COMPACTED: 'CONTEXT_COMPACTED',
  BACKGROUND_TASK_STARTED: 'BACKGROUND_TASK_STARTED',
  BACKGROUND_TASK_COMPLETED: 'BACKGROUND_TASK_COMPLETED',
  BACKGROUND_TASK_FAILED: 'BACKGROUND_TASK_FAILED',
  OUTPUT_GUARD_BLOCKED: 'OUTPUT_GUARD_BLOCKED',
} as const satisfies Record<StreamEventType, TaskEventType>;

export function projectRunStatusToTaskStatus(status: RunStatus, hasActivePendingInput = false): TaskStatus {
  return hasActivePendingInput ? 'TASK_PENDING' : taskStatusByRunStatus[status];
}

export function projectStreamEventTypeToTaskEventType(eventType: StreamEventType): TaskEventType {
  return taskEventTypeByStreamEventType[eventType];
}

export interface TaskEvent {
  readonly eventId: string;
  readonly eventType: TaskEventType;
  readonly sessionId: string;
  readonly taskId: string;
  readonly sequence: number;
  readonly createdAt: number;
  readonly payload: JsonObject;
}

const terminalTaskEventTypes: ReadonlySet<TaskEventType> = new Set(['TASK_COMPLETED', 'TASK_FAILED', 'TASK_CANCELED', 'TASK_SUPERSEDED']);

const callbackOnlyEventTypes: ReadonlySet<TaskEventType> = new Set(['TASK_COMPLETED', 'TASK_FAILED', 'TASK_CANCELED', 'USER_INPUT_REQUIRED']);

export function isTerminalTaskEventType(eventType: TaskEventType): boolean {
  return terminalTaskEventTypes.has(eventType);
}

export function isCallbackEventType(eventType: TaskEventType): boolean {
  return callbackOnlyEventTypes.has(eventType);
}

export function projectStreamEnvelopeToTaskEvent(envelope: StreamEnvelope): TaskEvent {
  return {
    eventId: envelope.eventId,
    eventType: projectStreamEventTypeToTaskEventType(envelope.eventType),
    sessionId: String(envelope.sessionId),
    taskId: String(envelope.requestId),
    sequence: Number(envelope.sequence),
    createdAt: Number(envelope.createdAt),
    payload: envelope.payload,
  };
}

export async function* mapTaskStreamEnvelopes(envelopes: AsyncIterable<StreamEnvelope>): AsyncIterable<TaskEvent> {
  for await (const envelope of envelopes) {
    const event = projectStreamEnvelopeToTaskEvent(envelope);
    if (isFilteredTaskEventType(event.eventType)) {
      continue;
    }
    yield event;
  }
}

const filteredTaskEventTypes: ReadonlySet<TaskEventType> = new Set([
  'BACKGROUND_TASK_STARTED',
  'BACKGROUND_TASK_COMPLETED',
  'BACKGROUND_TASK_FAILED',
  'OUTPUT_GUARD_BLOCKED',
]);

export function isFilteredTaskEventType(eventType: TaskEventType): boolean {
  return filteredTaskEventTypes.has(eventType);
}

export function statusFor(error: AgentError): number {
  if (error.code === 'LOCAL_AUTH_REQUIRED') {
    return 401;
  }
  const category = error.category;
  if (category === 'UNAVAILABLE') {
    return 503;
  }
  if (category === 'NOT_FOUND') {
    return 404;
  }
  if (category === 'CONFLICT') {
    return 409;
  }
  if (category === 'AUTHORIZATION') {
    return 403;
  }
  return 400;
}
