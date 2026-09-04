import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { useStreamConnection } from './useStreamConnection.ts';
import { envelopeMatchesIdentity, getEnvelopeAttemptId, getEnvelopeRunId, getEnvelopeRootMessageId } from '../utils/streamingHelpers.ts';
import type {
  RuntimeActiveRunSummary,
  StreamEnvelope,
  StreamResumeRecoveryDetails,
  TurnBlock,
  UserInputKind,
  UserInputOption,
  UserInputQuestion,
} from '../../../state/contracts.ts';
import {
  type ConversationAppendResult,
  type LiveBucketsByRoot,
  type StreamConnectionState,
  useConversationStore,
} from '../../../state/conversationStore.ts';
import { useBackgroundTaskStore } from '../../../state/backgroundTaskStore.ts';
import { useUserInputStore } from '../../../state/userInputStore.ts';
import { toTimestampMillis } from '../../../utils/time.ts';
import i18n from '../../../i18n/index.ts';
import { useRequestStore } from '../../../state/requestStore.ts';

const TERMINAL_EVENT_TYPES = new Set<StreamEnvelope['eventType']>(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED', 'REQUEST_SUPERSEDED']);

/**
 * Computes a `performance.now()`-based `receivedAt` value that survives page
 * refreshes. On first receive, stores the browser wall-clock time in
 * sessionStorage. On replay (page refresh), retrieves the stored wall-clock
 * time, computes elapsed browser time, and adjusts `receivedAt` backwards so
 * the countdown formula `timeoutDurationMs - (performance.now() - receivedAt)`
 * reflects the true remaining time.
 *
 * This preserves the performance.now() monotonic-clock approach (no
 * server/browser clock mixing) while fixing the bug where a page refresh
 * reset the countdown to the full duration.
 */
export function computeReceivedAt(inputRequestId: string): number {
  const storageKey = `nextagent:userInput:receivedAt:${inputRequestId}`;
  const now = performance.now();
  const wallClockNow = Date.now();

  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored !== null) {
      const storedWallClock = Number(stored);
      if (Number.isFinite(storedWallClock)) {
        const elapsed = wallClockNow - storedWallClock;
        // Clamp to non-negative; a negative elapsed (clock moved backward)
        // would incorrectly extend the countdown beyond the original duration.
        return now - Math.max(0, elapsed);
      }
    }
    sessionStorage.setItem(storageKey, String(wallClockNow));
  } catch {
    // sessionStorage unavailable (e.g., private browsing); fall back to
    // original behavior where receivedAt resets on each page load.
  }
  return now;
}

export function clearReceivedAtTimestamp(inputRequestId: string): void {
  try {
    sessionStorage.removeItem(`nextagent:userInput:receivedAt:${inputRequestId}`);
  } catch {
    // sessionStorage unavailable; nothing to clean up.
  }
}

interface ConversationRefreshOptions {
  background?: boolean;
  merge?: boolean;
  force?: boolean;
  requiredRootMessageId?: string;
  preserveRequestId?: string;
}

interface UseChatSessionStreamParams {
  readonly sessionId: string | null;
  readonly canOpenStream: boolean;
  readonly isExecuting: boolean;
  readonly hasInFlightRequest: boolean;
  readonly activeRun: RuntimeActiveRunSummary | null;
  readonly acceptedRun: RuntimeActiveRunSummary | null;
  readonly hasLocalEnvelopes: boolean;
  readonly shouldDeferSnapshotLoad: boolean;
  readonly suppressAutomaticSnapshotRefresh?: boolean;
  readonly activeRequestRootMessageId: string | null;
  readonly activeLiveByRoot?: LiveBucketsByRoot;
  readonly settledLiveByRoot?: LiveBucketsByRoot;
  readonly turnBlocks: readonly TurnBlock[];
  readonly appendEnvelope: (sessionId: string, envelope: StreamEnvelope) => ConversationAppendResult | void;
  readonly appendEnvelopes: (sessionId: string, envelopes: readonly StreamEnvelope[]) => ConversationAppendResult | void;
  readonly setStreaming: (streaming: boolean) => void;
  readonly setStreamConnectionState: (sessionId: string, state: StreamConnectionState) => void;
  readonly loadConversation: (
    sessionId: string,
    options?: {
      background?: boolean;
      merge?: boolean;
      requiredRootMessageId?: string;
      preserveRequestId?: string;
    },
  ) => Promise<boolean>;
  readonly loadSessions: () => Promise<void>;
  readonly settleRequestFromTerminal: (
    eventOrEnvelope:
      Extract<StreamEnvelope['eventType'], 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED'> | StreamEnvelope,
    requestId?: string | null,
  ) => boolean;
  readonly acceptRequestFromStream: (envelope: StreamEnvelope) => boolean;
  readonly reconcilePendingRequestFromLiveEnvelope: (envelope: StreamEnvelope) => boolean;
  readonly onSessionEntrySnapshot?: ((sessionId: string) => void) | undefined;
}

interface UseChatSessionStreamResult {
  readonly requestConversationRefresh: (options?: ConversationRefreshOptions) => Promise<boolean>;
  readonly handleReloadConversation: () => void;
  readonly onUserInputRequired: (envelope: StreamEnvelope) => void;
  readonly onUserInputResolved: (envelope: StreamEnvelope) => void;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeInputKind(value: unknown): UserInputKind {
  const kind = readString(value)?.toUpperCase();
  if (
    kind === 'CLARIFICATION' ||
    kind === 'CONFIRMATION' ||
    kind === 'APPROVAL' ||
    kind === 'SELECTION' ||
    kind === 'QUESTION' ||
    kind === 'AUTHORIZATION' ||
    kind === 'HUMAN_HANDOFF'
  ) {
    return kind;
  }
  return 'CLARIFICATION';
}

function normalizeOptions(value: unknown): readonly UserInputOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const options = value.flatMap((item): UserInputOption[] => {
    const option = readRecord(item);
    if (!option) {
      return [];
    }
    const id = readString(option.id) ?? readString(option.value);
    const label = readString(option.label) ?? id;
    const requiresTextInput = typeof option.requiresTextInput === 'boolean' ? option.requiresTextInput : undefined;
    const inputPlaceholder = requiresTextInput === true ? (readString(option.inputPlaceholder) ?? undefined) : undefined;
    return id && label
      ? [
          {
            id,
            label,
            ...(requiresTextInput === undefined ? {} : { requiresTextInput }),
            ...(inputPlaceholder === undefined ? {} : { inputPlaceholder }),
          },
        ]
      : [];
  });
  return options.length > 0 ? options : undefined;
}

function normalizeQuestions(payload: Record<string, unknown>): readonly UserInputQuestion[] | undefined {
  if (Array.isArray(payload.questions)) {
    const questions = payload.questions.flatMap((item): UserInputQuestion[] => {
      const question = readRecord(item);
      const prompt = readString(question?.prompt);
      if (!question || !prompt) {
        return [];
      }
      const options = normalizeOptions(question.options);
      return [
        {
          prompt,
          ...(options ? { options } : {}),
          ...(typeof question.multiple === 'boolean' ? { multiple: question.multiple } : {}),
          ...(typeof question.custom === 'boolean' ? { custom: question.custom } : {}),
        },
      ];
    });
    return questions.length > 0 ? questions : undefined;
  }

  const prompt = readString(payload.prompt);
  if (!prompt) {
    return undefined;
  }
  const options = normalizeOptions(payload.options);
  return [
    {
      prompt,
      ...(options ? { options } : {}),
    },
  ];
}

export function useChatSessionStream({
  sessionId,
  canOpenStream,
  isExecuting,
  hasInFlightRequest,
  activeRun,
  acceptedRun,
  hasLocalEnvelopes,
  shouldDeferSnapshotLoad,
  suppressAutomaticSnapshotRefresh = false,
  activeRequestRootMessageId,
  activeLiveByRoot,
  settledLiveByRoot,
  turnBlocks,
  appendEnvelope,
  appendEnvelopes,
  setStreaming,
  setStreamConnectionState,
  loadConversation,
  loadSessions,
  settleRequestFromTerminal,
  acceptRequestFromStream,
  reconcilePendingRequestFromLiveEnvelope,
  onSessionEntrySnapshot,
}: UseChatSessionStreamParams): UseChatSessionStreamResult {
  const conversationRefreshRef = useRef<Promise<boolean> | null>(null);
  const openingReconcileSessionRef = useRef<string | null>(null);
  const deferredSnapshotLoadSessionRef = useRef<string | null>(null);
  const suppressedSnapshotRefreshSessionRef = useRef<string | null>(null);

  const requestConversationRefresh = useEffectEvent((options: ConversationRefreshOptions = {}) => {
    if (!sessionId) {
      return Promise.resolve(false);
    }

    if (!options.force && conversationRefreshRef.current) {
      return conversationRefreshRef.current;
    }

    const refreshPromise = loadConversation(sessionId, {
      background: options.background ?? false,
      merge: options.merge ?? false,
      ...(options.requiredRootMessageId ? { requiredRootMessageId: options.requiredRootMessageId } : {}),
      ...(options.preserveRequestId ? { preserveRequestId: options.preserveRequestId } : {}),
    }).finally(() => {
      if (conversationRefreshRef.current === refreshPromise) {
        conversationRefreshRef.current = null;
      }
    });

    conversationRefreshRef.current = refreshPromise;
    return refreshPromise;
  });

  const matchingSettledBucket = activeRequestRootMessageId ? settledLiveByRoot?.[activeRequestRootMessageId] : undefined;
  const settledRequestEnvelopes = matchingSettledBucket?.envelopes ?? [];

  const terminalForActiveRequest = (() => {
    if (!activeRequestRootMessageId) {
      return null;
    }
    let latest: StreamEnvelope | null = null;
    for (const envelope of settledRequestEnvelopes) {
      if (
        TERMINAL_EVENT_TYPES.has(envelope.eventType) &&
        envelopeMatchesIdentity(envelope, activeRequestRootMessageId) &&
        (!latest || envelope.sequence >= latest.sequence)
      ) {
        latest = envelope;
      }
    }
    return latest;
  })();
  const confirmedAcceptedRunId = acceptedRun?.runId ?? null;

  const resolveRootMessageIdForRequest = useEffectEvent((requestId?: string | null) => {
    if (!requestId) {
      return null;
    }

    const activeTurn = turnBlocks.find((candidate) => candidate.rootMessageId === requestId);
    if (activeTurn) {
      return activeTurn.rootMessageId;
    }

    const matchingBucket = activeLiveByRoot?.[requestId] ?? settledLiveByRoot?.[requestId];
    const matchingEnvelope = matchingBucket?.envelopes.find(
      (envelope) => typeof envelope.payload?.rootMessageId === 'string' && envelope.payload.rootMessageId.trim().length > 0,
    );
    return matchingEnvelope ? getEnvelopeRootMessageId(matchingEnvelope) : null;
  });

  const handleTerminalEvent = useEffectEvent((envelope: StreamEnvelope) => {
    const terminalAttemptId = getEnvelopeAttemptId(envelope);
    const payloadRootMessageId =
      typeof envelope.payload?.rootMessageId === 'string' && envelope.payload.rootMessageId.trim().length > 0 ? envelope.payload.rootMessageId : null;
    const explicitRootMessageId =
      typeof envelope.rootMessageId === 'string' && envelope.rootMessageId.trim().length > 0 ? envelope.rootMessageId : payloadRootMessageId;
    const terminalRootMessageId = explicitRootMessageId ?? resolveRootMessageIdForRequest(terminalAttemptId) ?? getEnvelopeRootMessageId(envelope);
    const terminalRunId = getEnvelopeRunId(envelope);

    const matchesTerminalRequest = (requestIdentity?: string | null): boolean =>
      Boolean(
        requestIdentity &&
        (requestIdentity === terminalAttemptId ||
          requestIdentity === terminalRootMessageId ||
          requestIdentity === envelope.requestId ||
          requestIdentity === terminalRunId),
      );
    const matchesRuntimeRun = (run?: RuntimeActiveRunSummary | null): boolean =>
      Boolean(
        run && terminalRunId && run.runId === terminalRunId && (run.requestId === terminalRootMessageId || run.requestId === envelope.requestId),
      );
    const matchesActiveRequest = matchesTerminalRequest(activeRequestRootMessageId);
    const matchesActiveRuntimeRun = matchesRuntimeRun(activeRun);
    const matchesAcceptedRun = matchesRuntimeRun(acceptedRun);

    if (
      (matchesActiveRequest || matchesActiveRuntimeRun || matchesAcceptedRun) &&
      (envelope.eventType === 'REQUEST_COMPLETED' ||
        envelope.eventType === 'REQUEST_FAILED' ||
        envelope.eventType === 'REQUEST_CANCELED' ||
        envelope.eventType === 'REQUEST_SUPERSEDED' ||
        envelope.eventType === 'OUTPUT_GUARD_BLOCKED')
    ) {
      const settled = settleRequestFromTerminal(envelope);
      if (settled) {
        setStreaming(false);
        useUserInputStore.getState().clear();
      }
      if (sessionId && (matchesActiveRuntimeRun || matchesAcceptedRun || settled)) {
        useConversationStore.getState().setRuntimeState(sessionId, { activeRun: null });
        setStreaming(false);
        // When the terminal matches the active/accepted run but
        // settleRequestFromTerminal returned false (identity field
        // mismatch), force-settle so the UI returns to idle instead
        // of staying stuck in the accepted state.
        if (!settled) {
          useRequestStore.getState().settleStaleSessionRequest(sessionId);
          useUserInputStore.getState().clear();
        }
      }
    }
    // Safety net: when REQUEST_CANCELED arrives, read live store state
    // (not React props which may be stale in useEffectEvent) and clear
    // the executing state if the request is still active. Same-session
    // has only one active request at a time, so any cancel must be ours.
    // Set requestStatus to 'canceled' (not 'idle') so ChatPage can map it
    // to latestPersistedRunStatus for TurnBlock status resolution.
    const liveRequestStatus = useRequestStore.getState().requestStatus;
    const liveHasInFlight = Boolean(useConversationStore.getState().runtimeBySession[sessionId ?? '']?.activeRun);
    const isRequestActive = liveRequestStatus === 'accepted' || liveRequestStatus === 'submitting' || liveRequestStatus === 'canceling';
    // Identity guard: a late REQUEST_CANCELED from a previous request must
    // not clear the current request's pendingRequest. Only fire when the
    // envelope identity matches the current active request root.
    const cancelRootMessageId = useRequestStore.getState().activeRequestRootMessageId;
    const cancelBelongsToCurrentRequest = cancelRootMessageId !== null && envelopeMatchesIdentity(envelope, cancelRootMessageId);
    if (envelope.eventType === 'REQUEST_CANCELED' && cancelBelongsToCurrentRequest && (isRequestActive || liveHasInFlight) && sessionId) {
      useRequestStore.setState({
        isSubmittingRequest: false,
        requestStatus: 'canceled',
        activeRequestSessionId: null,
        pendingRequest: null,
      });
      setStreaming(false);
      useUserInputStore.getState().clear();
      useConversationStore.getState().setRuntimeState(sessionId, { activeRun: null });
    }
    const shouldRefreshTerminalSessionList =
      matchesActiveRequest || matchesActiveRuntimeRun || matchesAcceptedRun || isExecuting || hasInFlightRequest;
    if (!shouldRefreshTerminalSessionList) {
      return;
    }
    void loadSessions();
  });

  useEffect(() => {
    if (!sessionId || !isExecuting || !terminalForActiveRequest) {
      return;
    }
    const settled = settleRequestFromTerminal(terminalForActiveRequest);
    if (!settled) {
      // The terminal is in the settled bucket but identity fields
      // don't match the pending request. Force-settle to avoid a
      // stuck UI where the request stays in the accepted state.
      useRequestStore.getState().settleStaleSessionRequest(sessionId);
      setStreaming(false);
      useUserInputStore.getState().clear();
      useConversationStore.getState().setRuntimeState(sessionId, { activeRun: null });
      return;
    }
    setStreaming(false);
    useUserInputStore.getState().clear();
    useConversationStore.getState().setRuntimeState(sessionId, { activeRun: null });
  }, [sessionId, isExecuting, terminalForActiveRequest, confirmedAcceptedRunId, settleRequestFromTerminal, setStreaming]);

  const handleRequestAcceptedEvent = useEffectEvent((envelope: StreamEnvelope) => {
    acceptRequestFromStream(envelope);
  });

  const handleRefreshRequiredEvent = useEffectEvent((details?: StreamResumeRecoveryDetails) => {
    if (sessionId) {
      return requestConversationRefresh({
        background: true,
        merge: false,
        force: Boolean(details),
        ...(activeRequestRootMessageId ? { preserveRequestId: activeRequestRootMessageId } : {}),
      }).then((refreshed) => {
        if (!details) {
          setStreamConnectionState(sessionId, { phase: 'connected', message: null });
        }
        return refreshed;
      });
    }
    return false;
  });

  const handleLiveEnvelope = useEffectEvent((envelope: StreamEnvelope) => {
    const acceptedByBackgroundTaskStore = useBackgroundTaskStore.getState().applyStreamEnvelope(envelope);
    if (envelope.eventType === 'REQUEST_ACCEPTED') {
      acceptRequestFromStream(envelope);
    } else {
      reconcilePendingRequestFromLiveEnvelope(envelope);
    }
    return acceptedByBackgroundTaskStore;
  });

  const handleUserInputRequired = useEffectEvent((envelope: StreamEnvelope) => {
    const payload = envelope.payload as Record<string, unknown>;
    const questions = normalizeQuestions(payload);
    const firstQuestion = questions?.[0];
    const inputRequestId = readString(payload.inputRequestId) ?? readString(payload.pendingInputId) ?? readString(payload.id) ?? '';
    if (!inputRequestId) {
      return;
    }
    const options = firstQuestion?.options ?? normalizeOptions(payload.options);
    const expiresAt = payload.expiresAt ?? payload.timeoutAt;
    const hasExpiresAt = typeof expiresAt === 'string' || typeof expiresAt === 'number';
    const expiresAtMillis = hasExpiresAt ? toTimestampMillis(expiresAt) : Number.NaN;
    const createdAtMillis = toTimestampMillis(envelope.createdAt);
    const timeoutDurationMs = Number.isFinite(expiresAtMillis) && Number.isFinite(createdAtMillis) ? expiresAtMillis - createdAtMillis : null;
    useUserInputStore.getState().activateInputRequest({
      inputRequestId,
      inputKind: normalizeInputKind(payload.inputKind ?? payload.kind),
      prompt: readString(payload.prompt) ?? firstQuestion?.prompt ?? '',
      ...(options ? { options } : {}),
      ...(questions ? { questions } : {}),
      origin: typeof payload.origin === 'string' ? payload.origin : null,
      originId: typeof payload.originId === 'string' ? payload.originId : null,
      riskLevel: typeof payload.riskLevel === 'string' ? payload.riskLevel : null,
      expiresAt: hasExpiresAt ? expiresAt : null,
      ...(timeoutDurationMs !== null ? { timeoutDurationMs } : {}),
      receivedAt: computeReceivedAt(inputRequestId),
      requestId: envelope.requestId,
    });
  });

  const handleUserInputResolved = useEffectEvent((envelope: StreamEnvelope) => {
    const activeInput = useUserInputStore.getState().activeInput;
    // Only resolve the active input if the event belongs to it.
    // A late USER_INPUT_CANCELED from a previous request must not
    // dismiss the current request's askUser dialog.
    if (!activeInput || activeInput.requestId === envelope.requestId || envelopeMatchesIdentity(envelope, activeInput.requestId)) {
      if (activeInput?.inputRequestId) {
        clearReceivedAtTimestamp(activeInput.inputRequestId);
      }
      useUserInputStore.getState().resolveInputRequest(envelope.eventType);
    }
    if (envelope.eventType === 'USER_INPUT_TIMEOUT' || envelope.eventType === 'USER_INPUT_CANCELED') {
      if (sessionId) {
        // Identity guard: only settle if the event belongs to the current
        // request. A late USER_INPUT_CANCELED from a previous request must
        // not clear the current request's pendingRequest.
        const currentRootMessageId = useRequestStore.getState().activeRequestRootMessageId;
        if (currentRootMessageId === null || !envelopeMatchesIdentity(envelope, currentRootMessageId)) {
          return;
        }
        useRequestStore.getState().settleStaleSessionRequest(sessionId);
        setStreaming(false);
        useConversationStore.getState().setRuntimeState(sessionId, { activeRun: null });
      }
    }
  });

  // Client-side safety net: when the pending input expires, proactively
  // settle the request and stop streaming. The backend timeout event may
  // not arrive in time if the stream connection has dropped.
  //
  // The delay is computed from a server-side duration (expiresAt - createdAt,
  // both server timestamps) minus browser-elapsed time (performance.now() -
  // receivedAt, both monotonic timestamps). This avoids mixing server and
  // browser clocks, which would cause the timer to fire at the wrong time when
  // the two clocks are out of sync, and uses performance.now() so that manual
  // clock adjustments or NTP corrections do not corrupt the elapsed-time
  // measurement.
  const activeInput = useUserInputStore((s) => s.activeInput);
  const activeInputKey = activeInput?.inputRequestId ?? null;
  const activeInputTimeoutDuration = activeInput?.timeoutDurationMs ?? null;
  const activeInputReceivedAt = activeInput?.receivedAt ?? null;
  useEffect(() => {
    if (!activeInputTimeoutDuration || !activeInputReceivedAt || !sessionId || !activeInputKey) {
      return undefined;
    }
    const delay = activeInputTimeoutDuration - (performance.now() - activeInputReceivedAt);
    if (delay <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => {
      const currentInput = useUserInputStore.getState().activeInput;
      if (currentInput?.inputRequestId !== activeInputKey) {
        return;
      }
      clearReceivedAtTimestamp(activeInputKey);
      useUserInputStore.getState().clear();
      useRequestStore.getState().settleStaleSessionRequest(sessionId);
      setStreaming(false);
      useConversationStore.getState().setRuntimeState(sessionId, { activeRun: null });
    }, delay);
    return () => clearTimeout(timer);
  }, [activeInputTimeoutDuration, activeInputReceivedAt, activeInputKey, sessionId, setStreaming]);

  useEffect(() => {
    openingReconcileSessionRef.current = null;
    deferredSnapshotLoadSessionRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      suppressedSnapshotRefreshSessionRef.current = null;
      return;
    }
    if (suppressAutomaticSnapshotRefresh) {
      suppressedSnapshotRefreshSessionRef.current = sessionId;
      return;
    }
    if (suppressedSnapshotRefreshSessionRef.current === sessionId) {
      suppressedSnapshotRefreshSessionRef.current = null;
      return;
    }
    suppressedSnapshotRefreshSessionRef.current = null;
    if (shouldDeferSnapshotLoad) {
      deferredSnapshotLoadSessionRef.current = sessionId;
      return;
    }
    if (deferredSnapshotLoadSessionRef.current === sessionId && hasLocalEnvelopes) {
      return;
    }
    deferredSnapshotLoadSessionRef.current = null;
    void requestConversationRefresh({
      background: hasLocalEnvelopes,
      merge: false,
    }).then((refreshed) => {
      if (refreshed) {
        onSessionEntrySnapshot?.(sessionId);
      }
    });
  }, [sessionId, shouldDeferSnapshotLoad, hasLocalEnvelopes, suppressAutomaticSnapshotRefresh]);

  const handleSessionLiveTailOpen = useEffectEvent(() => {
    if (!sessionId || suppressAutomaticSnapshotRefresh || openingReconcileSessionRef.current === sessionId) {
      return;
    }
    openingReconcileSessionRef.current = sessionId;
    void requestConversationRefresh({
      background: true,
      merge: false,
      force: true,
    }).then((refreshed) => {
      if (refreshed) {
        onSessionEntrySnapshot?.(sessionId);
      }
    });
  });

  useStreamConnection({
    sessionId: sessionId ?? undefined,
    canOpenStream,
    appendEnvelope,
    appendEnvelopes,
    setStreaming,
    setConnectionState: setStreamConnectionState,
    onTerminal: handleTerminalEvent,
    onLiveEnvelope: handleLiveEnvelope,
    onRequestAccepted: handleRequestAcceptedEvent,
    onRefreshRequired: handleRefreshRequiredEvent,
    onUserInputRequired: handleUserInputRequired,
    onUserInputResolved: handleUserInputResolved,
    isExecuting,
    activeRun,
    acceptedRun,
    onSessionLiveTailOpen: handleSessionLiveTailOpen,
  });

  const handleReloadConversation = useCallback(() => {
    if (sessionId) {
      void requestConversationRefresh({ force: true });
    }
  }, [sessionId, requestConversationRefresh]);

  return {
    requestConversationRefresh,
    handleReloadConversation,
    onUserInputRequired: handleUserInputRequired,
    onUserInputResolved: handleUserInputResolved,
  };
}
