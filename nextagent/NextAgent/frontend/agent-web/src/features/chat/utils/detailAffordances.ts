import type { StreamEnvelope } from '../../../state/contracts';

const TERMINAL_EVENTS = new Set<StreamEnvelope['eventType']>(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED', 'REQUEST_SUPERSEDED']);

export interface TurnDetailAffordances {
  readonly showExecutionSummary: boolean;
  readonly showFullProcessTimeline: boolean;
}

function isTimelineBackedHistoryEvent(event: StreamEnvelope): boolean {
  return !event.transportHints.includes('history-load') || (typeof event.timelineEventRef === 'string' && event.timelineEventRef.trim().length > 0);
}

export function hasProcessTimelineDetail(aiEvents: readonly StreamEnvelope[]): boolean {
  return aiEvents.some((event) => {
    if (event.eventType === 'LLM_THINKING_DELTA' || event.eventType === 'CAPABILITY_STARTED') {
      return isTimelineBackedHistoryEvent(event);
    }
    if (event.eventType === 'CAPABILITY_RESULT_DELTA' || event.eventType === 'CAPABILITY_COMPLETED') {
      return isTimelineBackedHistoryEvent(event);
    }
    return false;
  });
}

/**
 * Execution details may be shown for both persisted historical results and live turns.
 * The richer full-process timeline is reserved for turns backed by live process events.
 */
export function resolveTurnDetailAffordances(params: {
  readonly aiEvents: readonly StreamEnvelope[];
  readonly processEntryCount: number;
  readonly processTimelineEntryCount: number;
  readonly isStreaming: boolean;
}): TurnDetailAffordances {
  const { aiEvents, processEntryCount, processTimelineEntryCount, isStreaming } = params;
  const processTimelineDetail = hasProcessTimelineDetail(aiEvents);
  const terminalDetail = aiEvents.some((event) => TERMINAL_EVENTS.has(event.eventType));

  return {
    showExecutionSummary: processEntryCount > 0 || isStreaming || terminalDetail,
    showFullProcessTimeline: processTimelineEntryCount > 0 && processTimelineDetail,
  };
}
