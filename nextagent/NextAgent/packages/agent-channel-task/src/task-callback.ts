import { brand, getLogger, type IdentityContext, type MessageId, type SessionId } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { deliverWebStream } from '@nextagent/agent-channel-common';

import {
  projectStreamEnvelopeToTaskEvent,
  isTerminalTaskEventType,
  isCallbackEventType,
  isFilteredTaskEventType,
  type TaskEvent,
} from './task-status.js';

export interface TaskCallbackTarget {
  readonly url: string;
}

export interface TaskCallbackDeliveryPortRequest {
  readonly target: TaskCallbackTarget;
  readonly events: readonly TaskEvent[];
}

export interface TaskCallbackDeliveryPort {
  validateTarget: (target: TaskCallbackTarget) => void;
  deliver: (request: TaskCallbackDeliveryPortRequest, signal: AbortSignal) => Promise<boolean>;
}

export interface TaskCallbackDeliveryOptions {
  readonly deliveryPort: TaskCallbackDeliveryPort;
  readonly target: TaskCallbackTarget;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export type ReportEvents = 'ALL' | 'TERMINAL' | readonly string[];

export interface TaskCallbackDeliveryRequest {
  readonly sessions: RuntimeSessionPort;
  readonly identityContext: IdentityContext;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly reportEvents: ReportEvents;
  readonly options: TaskCallbackDeliveryOptions;
}

const defaultCallbackTimeoutMs = 30_000;
const defaultMaxRetries = 3;
const logger = getLogger({ component: 'agent-channel-task', source: 'task-callback' });

export async function deliverTaskCallbacks(request: TaskCallbackDeliveryRequest): Promise<void> {
  const abortController = new AbortController();
  const timeoutMs = request.options.timeoutMs ?? defaultCallbackTimeoutMs;
  const maxRetries = request.options.maxRetries ?? defaultMaxRetries;

  try {
    for await (const envelope of deliverWebStream({
      sessions: request.sessions,
      identityContext: request.identityContext,
      sessionId: request.sessionId,
      requestId: request.requestId,
      lastSeenSequence: brand<number, 'TimelineSequence'>(0),
      signal: abortController.signal,
    })) {
      const event = projectStreamEnvelopeToTaskEvent(envelope);
      if (isFilteredTaskEventType(event.eventType)) {
        if (isTerminalTaskEventType(event.eventType) || event.eventType === 'USER_INPUT_REQUIRED') {
          return;
        }
        continue;
      }
      if (!shouldDeliverEvent(event.eventType, request.reportEvents)) {
        if (isTerminalTaskEventType(event.eventType) || event.eventType === 'USER_INPUT_REQUIRED') {
          return;
        }
        continue;
      }
      const delivered = await deliverCallbackWithRetry(request.options.deliveryPort, [event], request.options.target, timeoutMs, maxRetries);
      if (!delivered) {
        logger.warn({
          event: 'task.callback.delivery_abandoned',
          taskId: event.taskId,
          sequence: event.sequence,
          safeReasonCode: 'TASK_CALLBACK_DELIVERY_ABANDONED',
        });
        return;
      }
      if (isTerminalTaskEventType(event.eventType) || event.eventType === 'USER_INPUT_REQUIRED') {
        return;
      }
    }
  } catch {
    logger.warn({
      event: 'task.callback.stream_abandoned',
      sessionId: String(request.sessionId),
      taskId: String(request.requestId),
      safeReasonCode: 'TASK_CALLBACK_STREAM_ABANDONED',
    });
  } finally {
    abortController.abort();
  }
}

function shouldDeliverEvent(eventType: TaskEvent['eventType'], reportEvents: ReportEvents): boolean {
  if (reportEvents === 'ALL') {
    return true;
  }
  if (reportEvents === 'TERMINAL') {
    return isCallbackEventType(eventType);
  }
  return true;
}

async function deliverCallbackWithRetry(
  deliveryPort: TaskCallbackDeliveryPort,
  events: readonly TaskEvent[],
  target: TaskCallbackTarget,
  timeoutMs: number,
  maxRetries: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(exponentialBackoffMs(attempt));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (await deliveryPort.deliver({ target, events }, controller.signal)) {
        return true;
      }
    } catch {
      // Delivery is retried with the same stable event ids.
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

function exponentialBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
