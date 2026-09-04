import { sessionService, type LoadRunEventsQuery } from '../../../services/sessionService.ts';
import type {
  CapabilityStreamEnvelope,
  RunProcessHistoryState,
  RunStatus,
  SessionConversationMessage,
  SessionRunEventHistoryPage,
  StreamEnvelope,
  TurnBlock,
} from '../../../state/contracts.ts';
import { isCompletedThinkingEnvelope, readThinkingStepIdentity } from '../utils/thinkingStepIdentity.ts';
import { isCompletedProcessContentEvent, isCompletedWorkflowStructuredAnswerEvent } from '../utils/streamTextSemantics.ts';
import { buildInputSegmentByEnvelope } from '../utils/streamingHelpers.ts';

const RUN_EVENT_PAGE_LIMIT = 1000 as const;
export const MAX_CONCURRENT_RUN_LOADS = 4;

export interface VisibleProcessRunTarget {
  readonly sessionId: string;
  readonly rootMessageId: string;
  readonly runId: string;
}

const PROCESS_HISTORY_ELIGIBLE_RUN_STATUSES = new Set<RunStatus>(['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED']);

export function isProcessHistoryEligibleRunStatus(status: RunStatus): boolean {
  return PROCESS_HISTORY_ELIGIBLE_RUN_STATUSES.has(status);
}

export function composeTurnBlockProcessHistory(block: TurnBlock, processHistoryState?: RunProcessHistoryState, sessionId?: string): TurnBlock {
  if (processHistoryState?.status !== 'AVAILABLE' || block.displayRunId === undefined || sessionId === undefined) {
    return block;
  }
  return {
    ...block,
    aiEvents: composeTurnProcessHistory({
      baseEnvelopes: block.aiEvents,
      eventEnvelopes: processHistoryState.envelopes,
      sessionId,
      rootMessageId: block.rootMessageId,
      runId: block.displayRunId,
    }),
  };
}

function buildThinkingStepIdentity(
  envelope: StreamEnvelope,
  coordinates: {
    readonly sessionId: string;
    readonly rootMessageId: string;
    readonly runId: string;
  },
  inputSegmentByEnvelope: ReadonlyMap<StreamEnvelope, number>,
): string | null {
  const matchesRoot = envelope.rootMessageId === coordinates.rootMessageId || envelope.requestId === coordinates.rootMessageId;
  if (envelope.sessionId !== coordinates.sessionId || envelope.runId !== coordinates.runId || !matchesRoot) {
    return null;
  }
  const stepIdentity = readThinkingStepIdentity(envelope);
  return stepIdentity === null ? null : `${stepIdentity}\u0000${inputSegmentByEnvelope.get(envelope) ?? 0}`;
}

function buildProcessContentStepIdentity(
  envelope: StreamEnvelope,
  coordinates: {
    readonly sessionId: string;
    readonly rootMessageId: string;
    readonly runId: string;
  },
  inputSegmentByEnvelope: ReadonlyMap<StreamEnvelope, number>,
): string | null {
  const payload = envelope.payload as Record<string, unknown>;
  const stepId = payload.stepId;
  const matchesRoot = envelope.rootMessageId === coordinates.rootMessageId || envelope.requestId === coordinates.rootMessageId;
  if (
    envelope.eventType !== 'LLM_CONTENT_DELTA' ||
    envelope.sessionId !== coordinates.sessionId ||
    envelope.runId !== coordinates.runId ||
    !matchesRoot ||
    typeof stepId !== 'string' ||
    stepId.trim().length === 0
  ) {
    return null;
  }
  return `${envelope.sessionId}:${coordinates.rootMessageId}:${envelope.runId}:${stepId.trim()}\u0000${inputSegmentByEnvelope.get(envelope) ?? 0}`;
}

function readStructuredToolCallId(envelope: StreamEnvelope): string | null {
  if (envelope.eventType !== 'TOOL_STRUCTURED_DELTA') {
    return null;
  }
  const toolCallId = (envelope.payload as Record<string, unknown>).toolCallId;
  if (typeof toolCallId !== 'string') {
    return null;
  }
  const normalized = toolCallId.trim();
  return normalized.length > 0 ? normalized : null;
}

function isMessageDerivedStructuredPresentation(envelope: StreamEnvelope): boolean {
  if (envelope.timelineEventRef !== null || !envelope.transportHints.includes('history-load')) {
    return false;
  }
  const payload = envelope.payload as Record<string, unknown>;
  return (
    envelope.eventType === 'TOOL_STRUCTURED_DELTA' &&
    typeof payload.messageId === 'string' &&
    payload.messageId.trim().length > 0 &&
    payload.role === 'CAPABILITY_RESULT'
  );
}

export function composeTurnProcessHistory(options: {
  readonly baseEnvelopes: readonly StreamEnvelope[];
  readonly eventEnvelopes: readonly StreamEnvelope[];
  readonly sessionId: string;
  readonly rootMessageId: string;
  readonly runId: string;
}): readonly StreamEnvelope[] {
  const occurrenceOrderedEnvelopes = [...options.eventEnvelopes, ...options.baseEnvelopes].sort(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
  const inputSegmentByEnvelope = buildInputSegmentByEnvelope(occurrenceOrderedEnvelopes);
  const baseByEventId = new Map(options.baseEnvelopes.map((envelope) => [envelope.eventId, envelope] as const));
  const resultByToolCallId = new Map<string, CapabilityStreamEnvelope>();
  for (const envelope of options.baseEnvelopes) {
    if (envelope.eventType !== 'CAPABILITY_RESULT_DELTA') {
      continue;
    }
    const toolCallId = envelope.payload.toolCallId;
    if (typeof toolCallId === 'string' && toolCallId.length > 0) {
      resultByToolCallId.set(toolCallId, envelope);
    }
  }
  const matchedResultEventIds = new Set<string>();
  const persistedCompletedThinkingSteps = new Set<string>();
  const persistedCompletedProcessContentSteps = new Set<string>();
  const persistedStructuredToolCallIds = new Set<string>();
  const canonicalByEventId = new Map<string, StreamEnvelope>();
  for (const envelope of options.eventEnvelopes) {
    const structuredPayload = envelope.payload as Record<string, unknown>;
    const isExcludedHistoryAnswerFact =
      (envelope.eventType === 'LLM_CONTENT_DELTA' && !isCompletedProcessContentEvent(envelope)) ||
      (envelope.eventType === 'TOOL_STRUCTURED_DELTA' &&
        structuredPayload.toolEventType === 'ANSWER' &&
        !isCompletedWorkflowStructuredAnswerEvent(envelope));
    const matchesRoot = envelope.rootMessageId === options.rootMessageId || envelope.requestId === options.rootMessageId;
    if (envelope.sessionId !== options.sessionId || envelope.runId !== options.runId || !matchesRoot || isExcludedHistoryAnswerFact) {
      continue;
    }
    let persistedCompletedStepIdentity: string | null = null;
    if (isCompletedThinkingEnvelope(envelope)) {
      persistedCompletedStepIdentity = buildThinkingStepIdentity(envelope, options, inputSegmentByEnvelope);
      if (persistedCompletedStepIdentity !== null) {
        persistedCompletedThinkingSteps.add(persistedCompletedStepIdentity);
      }
    }
    let persistedCompletedProcessContentStep: string | null = null;
    if (isCompletedProcessContentEvent(envelope)) {
      persistedCompletedProcessContentStep = buildProcessContentStepIdentity(envelope, options, inputSegmentByEnvelope);
      if (persistedCompletedProcessContentStep !== null) {
        persistedCompletedProcessContentSteps.add(persistedCompletedProcessContentStep);
      }
    }
    const matchingBase = baseByEventId.get(envelope.eventId);
    const supersedesMatchingBase =
      matchingBase !== undefined &&
      ((persistedCompletedStepIdentity !== null &&
        buildThinkingStepIdentity(matchingBase, options, inputSegmentByEnvelope) === persistedCompletedStepIdentity) ||
        (persistedCompletedProcessContentStep !== null &&
          buildProcessContentStepIdentity(matchingBase, options, inputSegmentByEnvelope) === persistedCompletedProcessContentStep));
    const preservesPersistedInputBoundary = envelope.eventType === 'USER_INPUT_RECEIVED';
    if ((matchingBase !== undefined && !supersedesMatchingBase && !preservesPersistedInputBoundary) || canonicalByEventId.has(envelope.eventId)) {
      continue;
    }
    let canonicalEnvelope: StreamEnvelope = envelope;
    if (envelope.eventType === 'CAPABILITY_COMPLETED') {
      const toolCallId = envelope.payload.toolCallId;
      const resultEnvelope = typeof toolCallId === 'string' ? resultByToolCallId.get(toolCallId) : undefined;
      if (resultEnvelope) {
        matchedResultEventIds.add(resultEnvelope.eventId);
        const completionPayload = envelope.payload as Record<string, unknown>;
        const hasCanonicalProjection =
          completionPayload.contentUnavailable === true ||
          typeof completionPayload.safeResult === 'object' ||
          typeof completionPayload.safeSummary === 'string' ||
          (typeof completionPayload.content === 'string' && completionPayload.content.trim().length > 0) ||
          (typeof completionPayload.text === 'string' && completionPayload.text.trim().length > 0);
        if (!hasCanonicalProjection) {
          const resultPayload = resultEnvelope.payload;
          const resultContent = resultPayload.content;
          const resultText = resultPayload.text;
          canonicalEnvelope = {
            ...envelope,
            payload: {
              ...resultPayload,
              ...envelope.payload,
              ...(resultContent === undefined ? {} : { content: resultContent }),
              ...(resultText === undefined ? {} : { text: resultText }),
              ...('safeResult' in resultPayload ? { safeResult: resultPayload.safeResult } : {}),
              ...('safeSummary' in resultPayload ? { safeSummary: resultPayload.safeSummary } : {}),
            },
          };
        }
      }
    }
    canonicalByEventId.set(envelope.eventId, {
      ...canonicalEnvelope,
      transportHints: envelope.transportHints.includes('history-load') ? envelope.transportHints : [...envelope.transportHints, 'history-load'],
    });
    if (envelope.timelineEventRef !== null) {
      const structuredToolCallId = readStructuredToolCallId(envelope);
      if (structuredToolCallId !== null) {
        persistedStructuredToolCallIds.add(structuredToolCallId);
      }
    }
  }
  const canonical = [...canonicalByEventId.values()].sort(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
  const unmatchedBase = options.baseEnvelopes.filter((envelope) => {
    if (canonicalByEventId.has(envelope.eventId)) {
      return false;
    }
    if (matchedResultEventIds.has(envelope.eventId)) {
      return false;
    }
    const structuredToolCallId = readStructuredToolCallId(envelope);
    if (
      structuredToolCallId !== null &&
      persistedStructuredToolCallIds.has(structuredToolCallId) &&
      isMessageDerivedStructuredPresentation(envelope)
    ) {
      return false;
    }
    const stepIdentity = buildThinkingStepIdentity(envelope, options, inputSegmentByEnvelope);
    if (stepIdentity !== null && persistedCompletedThinkingSteps.has(stepIdentity)) {
      return false;
    }
    const processContentStepIdentity = buildProcessContentStepIdentity(envelope, options, inputSegmentByEnvelope);
    if (processContentStepIdentity !== null && persistedCompletedProcessContentSteps.has(processContentStepIdentity)) {
      return false;
    }
    return true;
  });
  return [...canonical, ...unmatchedBase];
}

export type CompleteRunProcessHistory =
  | {
      readonly availability: 'AVAILABLE';
      readonly items: readonly StreamEnvelope[];
    }
  | {
      readonly availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE';
      readonly items: readonly [];
    };

type RunEventPageLoader = (query: LoadRunEventsQuery) => Promise<SessionRunEventHistoryPage>;

function nonEmptyRunId(runId?: string | null): string | null {
  if (typeof runId !== 'string') {
    return null;
  }
  const normalized = runId.trim();
  return normalized.length > 0 ? normalized : null;
}

function findLastMessage(
  messages: readonly SessionConversationMessage[],
  predicate: (message: SessionConversationMessage) => boolean,
): SessionConversationMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && predicate(message)) {
      return message;
    }
  }
  return undefined;
}

export function selectVisibleProcessRunTargets(messages: readonly SessionConversationMessage[]): readonly VisibleProcessRunTarget[] {
  const messagesByRoot = new Map<string, SessionConversationMessage[]>();
  const sortedMessages = [...messages].filter((message) => message.visible).sort((left, right) => left.sequence - right.sequence);

  for (const message of sortedMessages) {
    const rootMessageId = message.rootMessageId?.trim() || message.requestId?.trim() || message.messageId;
    const grouped = messagesByRoot.get(rootMessageId);
    if (grouped) {
      grouped.push(message);
    } else {
      messagesByRoot.set(rootMessageId, [message]);
    }
  }

  const selected: VisibleProcessRunTarget[] = [];
  const selectedRunKeys = new Set<string>();
  for (const [rootMessageId, rootMessages] of messagesByRoot) {
    const assistant = findLastMessage(rootMessages, (message) => message.role === 'ASSISTANT' && nonEmptyRunId(message.runId) !== null);
    const fallback = findLastMessage(rootMessages, (message) => message.role !== 'SUMMARY' && nonEmptyRunId(message.runId) !== null);
    const displayMessage = assistant ?? fallback;
    const runId = nonEmptyRunId(displayMessage?.runId);
    if (!displayMessage || !runId) {
      continue;
    }

    const runKey = `${displayMessage.sessionId}\u0000${runId}`;
    if (selectedRunKeys.has(runKey)) {
      continue;
    }
    selectedRunKeys.add(runKey);
    selected.push({
      sessionId: displayMessage.sessionId,
      rootMessageId,
      runId,
    });
  }

  return selected;
}

export async function loadCompleteRunProcessHistory(options: {
  readonly sessionId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly loadPage?: RunEventPageLoader;
}): Promise<CompleteRunProcessHistory> {
  const loadPage = options.loadPage ?? sessionService.loadRunEvents;
  const eventsById = new Map<string, StreamEnvelope>();
  let afterSequence = 0;

  while (true) {
    const page = await loadPage({
      sessionId: options.sessionId,
      runId: options.runId,
      afterSequence,
      limit: RUN_EVENT_PAGE_LIMIT,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (page.availability === 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE') {
      return { availability: page.availability, items: [] };
    }

    for (const envelope of page.events) {
      if (envelope.sessionId !== options.sessionId || envelope.runId !== options.runId) {
        throw new Error('Run event history envelope coordinate mismatch.');
      }
      if (!eventsById.has(envelope.eventId)) {
        eventsById.set(envelope.eventId, envelope);
      }
    }

    const nextAfterSequence = page.nextAfterSequence;
    if (nextAfterSequence === undefined) {
      return {
        availability: 'AVAILABLE',
        items: [...eventsById.values()].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)),
      };
    }
    if (nextAfterSequence <= afterSequence) {
      throw new Error('Run event history cursor must advance.');
    }
    afterSequence = nextAfterSequence;
  }
}

export async function runProcessHistoryQueue<T>(items: readonly T[], worker: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let nextIndex = 0;

  const takeNext = (): T | undefined => {
    if (signal?.aborted || nextIndex >= items.length) {
      return undefined;
    }
    const item = items[nextIndex];
    nextIndex += 1;
    return item;
  };

  const runWorker = async (): Promise<void> => {
    while (true) {
      const item = takeNext();
      if (item === undefined) {
        return;
      }
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_RUN_LOADS, items.length) }, () => runWorker()));
}
