import { brand, getLogger, type JsonObject } from '@nextagent/agent-common';
import type {
  BackgroundCompletionCallback,
  BackgroundCompletionPayload,
  BackgroundTaskRecord,
  BackgroundTaskStoreGatewayPort,
} from '@nextagent/agent-contracts/gateway';
import type { SessionTimelineEventInput } from '@nextagent/agent-contracts/runtime';
import { CompositionDeferredBindingUnavailableError } from './deferred-composition-bindings.js';

export interface BackgroundCompletionDeps {
  readonly backgroundTaskStore: BackgroundTaskStoreGatewayPort;
  readonly emitSessionTimelineEvent: (input: SessionTimelineEventInput) => Promise<void>;
}

const logger = getLogger({ component: 'agent-app', source: 'background-completion' });

/**
 * Emit a BACKGROUND_TASK_STARTED timeline event for a newly created task.
 * Best-effort: errors are logged but never fail the task creation path.
 */
export async function emitBackgroundTaskStarted(record: BackgroundTaskRecord, deps: BackgroundCompletionDeps): Promise<void> {
  try {
    await deps.emitSessionTimelineEvent({
      identityContext: record.identityContext,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      sessionId: record.sessionId,
      runId: record.runId,
      requestId: record.requestId,
      requestContextId: record.requestContextId,
      type: 'BACKGROUND_TASK_STARTED',
      inlinePayload: backgroundTaskInlinePayload(record, 'BACKGROUND_TASK_STARTED'),
    });
  } catch (error) {
    if (error instanceof CompositionDeferredBindingUnavailableError) {
      throw error;
    }
    logger.warn({
      err: error,
      event: 'background.event.emit_failed',
      failureStage: 'BACKGROUND_START_EVENT_EMIT',
      eventName: 'BACKGROUND_TASK_STARTED',
      taskId: record.taskId,
      runId: record.runId,
    });
  }
}

/**
 * Emit a BACKGROUND_TASK_COMPLETED/FAILED timeline event. Best-effort.
 */
export async function emitBackgroundTaskTerminal(
  record: BackgroundTaskRecord,
  payload: BackgroundCompletionPayload,
  deps: BackgroundCompletionDeps,
): Promise<void> {
  const type = payload.exitCode === 0 ? 'BACKGROUND_TASK_COMPLETED' : 'BACKGROUND_TASK_FAILED';
  try {
    await deps.emitSessionTimelineEvent({
      identityContext: record.identityContext,
      agentId: record.agentId,
      agentVersion: record.agentVersion,
      sessionId: record.sessionId,
      runId: record.runId,
      requestId: record.requestId,
      requestContextId: record.requestContextId,
      type,
      inlinePayload: backgroundTaskInlinePayload(record, type, payload),
    });
  } catch (error) {
    if (error instanceof CompositionDeferredBindingUnavailableError) {
      throw error;
    }
    logger.warn({
      err: error,
      event: 'background.event.emit_failed',
      failureStage: 'BACKGROUND_TERMINAL_EVENT_EMIT',
      eventName: type,
      taskId: record.taskId,
      runId: record.runId,
    });
  }
}

function backgroundTaskInlinePayload(
  record: BackgroundTaskRecord,
  type: 'BACKGROUND_TASK_STARTED' | 'BACKGROUND_TASK_COMPLETED' | 'BACKGROUND_TASK_FAILED',
  payload?: BackgroundCompletionPayload,
): JsonObject {
  const status = type === 'BACKGROUND_TASK_STARTED' ? 'RUNNING' : (payload?.status ?? 'FAILED');
  return {
    taskId: record.taskId,
    commandName: record.commandName,
    status,
    startedAt: record.startedAt,
    stdoutRef: record.stdoutRef,
    stderrRef: record.stderrRef,
    ...(payload === undefined ? {} : { exitCode: payload.exitCode, finishedAt: payload.finishedAt }),
  };
}

/**
 * Build the completion callback invoked when a background shell process exits.
 *
 * Records the terminal status and emits the terminal timeline event. Completion
 * is silent w.r.t. the agent (no continuation run) — the kill path also no
 * longer notifies the agent; task status is shown only in the background-task
 * monitor panel. `markCompleted` returns undefined for unknown tasks and —
 * critically — for tasks already in KILLED status (sticky terminal), so the
 * post-kill close does not emit a misleading BACKGROUND_TASK_FAILED event.
 */
export function buildBackgroundCompletionCallback(deps: BackgroundCompletionDeps): BackgroundCompletionCallback {
  return async (payload) => {
    try {
      const stored = await deps.backgroundTaskStore.markCompleted(payload.taskId, {
        exitCode: payload.exitCode,
        finishedAt: brand<number, 'EpochMillis'>(payload.finishedAt),
      });
      if (stored !== undefined) {
        await emitBackgroundTaskTerminal(stored, payload, deps);
      }
    } catch (error) {
      if (error instanceof CompositionDeferredBindingUnavailableError) {
        throw error;
      }
      logger.warn({ err: error, event: 'background.completion.failed', failureStage: 'BACKGROUND_COMPLETION_RECORD', taskId: payload.taskId });
    }
  };
}
