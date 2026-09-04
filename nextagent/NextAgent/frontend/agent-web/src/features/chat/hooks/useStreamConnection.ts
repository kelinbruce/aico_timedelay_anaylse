import { useEffect, useRef, useState, useEffectEvent } from 'react';
import { connectStream, getStreamResumeFailureDetails, type StreamConnection } from '../transport/streamTransport.ts';
import { normalizeStreamEnvelope } from '../utils/streamValidation.ts';
import { buildApiUrl, runtimeConfig } from '../../../config/runtimeConfig.ts';
import i18n from '../../../i18n/index.ts';
import { probeAuthChallenge } from '../../../services/authProbe.ts';
import { isTimelineBackedCursorEnvelope } from '../streaming/sessionStreamCursor.ts';
import { parseStreamResumeGapNotice } from '../streaming/streamResumeRecovery.ts';
import type { RuntimeActiveRunSummary, StreamEnvelope, StreamEventType, StreamResumeRecoveryDetails } from '../../../state/contracts.ts';
import type { ConversationAppendResult, StreamConnectionState } from '../../../state/conversationStore.ts';
import { reportWarning } from '../../../utils/diagnostics.ts';

const FRAME_BATCHABLE_EVENT_TYPES = new Set<StreamEventType>([
  'LLM_CONTENT_DELTA',
  'LLM_THINKING_DELTA',
  'CAPABILITY_RESULT_DELTA',
  'TOOL_STRUCTURED_DELTA',
]);
const maxFastReconnectAttempts = 3;
const sustainedReconnectDelayMs = 5_000;

interface PendingEnvelopeAppend {
  readonly envelope: StreamEnvelope;
  readonly acceptedByAlternateConsumer: boolean;
}

function isConversationAppendResult(value: unknown): value is ConversationAppendResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ConversationAppendResult>;
  return Array.isArray(candidate.acceptedEnvelopes) && Array.isArray(candidate.rejectedEnvelopes) && Array.isArray(candidate.acceptedRunKeys);
}

export interface UseStreamConnectionParams {
  /** Current session ID. Connection closes if undefined. */
  readonly sessionId?: string | undefined;
  /** Whether the conversation stream should be available for this session. */
  readonly canOpenStream: boolean;
  /** Store action to append received envelopes. */
  readonly appendEnvelope: (sessionId: string, envelope: StreamEnvelope) => ConversationAppendResult | void;
  /** Store action to append several received envelopes in one state update. */
  readonly appendEnvelopes?: (sessionId: string, envelopes: readonly StreamEnvelope[]) => ConversationAppendResult | void;
  /** Store action to set streaming state. */
  readonly setStreaming: (streaming: boolean) => void;
  /** Callback when a terminal event is received. */
  readonly onTerminal?: (envelope: StreamEnvelope) => void;
  /** Callback when the backend publishes the canonical request identity. */
  readonly onRequestAccepted?: (envelope: StreamEnvelope) => void;
  /** Callback before a valid live envelope is appended to the conversation store. */
  readonly onLiveEnvelope?: (envelope: StreamEnvelope) => boolean | void;
  /** Callback when a degradation notice requests a history refresh. */
  readonly onRefreshRequired?: (details?: StreamResumeRecoveryDetails) => Promise<boolean> | boolean | void;
  /** Callback when a USER_INPUT_REQUIRED event is received. */
  readonly onUserInputRequired?: (envelope: StreamEnvelope) => void;
  /** Callback when USER_INPUT_RECEIVED / TIMEOUT / CANCELED is received. */
  readonly onUserInputResolved?: (envelope: StreamEnvelope) => void;
  /** Whether a request is currently being processed. */
  readonly isExecuting?: boolean;
  /** Server-projected non-terminal run for new-device bootstrap. */
  readonly activeRun?: RuntimeActiveRunSummary | null;
  /** Recently accepted run coordinates for bounded recovery while the session stream is unavailable. */
  readonly acceptedRun?: RuntimeActiveRunSummary | null;
  /** Callback when an omitted-cursor session live-tail boundary is established. */
  readonly onSessionLiveTailOpen?: () => void;
  /** Store action to update per-session connection state. */
  readonly setConnectionState?: (sessionId: string, state: StreamConnectionState) => void;
}

export function useStreamConnection({
  sessionId,
  canOpenStream,
  appendEnvelope,
  appendEnvelopes,
  setStreaming,
  onTerminal,
  onRequestAccepted,
  onLiveEnvelope,
  onRefreshRequired,
  isExecuting,
  activeRun,
  acceptedRun,
  onSessionLiveTailOpen,
  setConnectionState,
  onUserInputRequired,
  onUserInputResolved,
}: UseStreamConnectionParams) {
  const streamConnectionRef = useRef<StreamConnection | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);
  const streamCursorRef = useRef<number | null>(null);
  const liveTailBoundaryEstablishedRef = useRef(false);
  const terminalRunKeysRef = useRef(new Set<string>());
  const coveredRunKeysRef = useRef(new Set<string>());
  const activeRunRef = useRef<RuntimeActiveRunSummary | null | undefined>(activeRun);
  const acceptedRunRef = useRef<RuntimeActiveRunSummary | null | undefined>(acceptedRun);
  const acceptedRunRecoveryKeyRef = useRef<string | null>(null);
  const activeBoundedReplayKeyRef = useRef<string | null>(null);
  const terminalBoundedReplayKeyRef = useRef<string | null>(null);
  const ignoreNextBoundedReplayDisconnectRef = useRef(false);
  const pendingAppendSessionIdRef = useRef<string | null>(null);
  const pendingAppendEnvelopesRef = useRef<PendingEnvelopeAppend[]>([]);
  const appendFrameRef = useRef<number | null>(null);
  const appendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const immediateAppendLaneKeysRef = useRef(new Set<string>());
  const suppressNextDisconnectRef = useRef(false);
  const preserveConnectionNoticeOnReconnectRef = useRef(false);
  const [streamReconnectTrigger, setStreamReconnectTrigger] = useState(0);
  const [activeRunBootstrapTrigger, setActiveRunBootstrapTrigger] = useState(0);
  const [acceptedRunRecoveryTrigger, setAcceptedRunRecoveryTrigger] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const transportKind = runtimeConfig.transportKind;
  const shouldConnectStream = Boolean(sessionId && canOpenStream);
  activeRunRef.current = activeRun;
  acceptedRunRef.current = acceptedRun;

  const isTerminalEnvelope = (envelope: StreamEnvelope): boolean =>
    envelope.eventType === 'REQUEST_COMPLETED' ||
    envelope.eventType === 'REQUEST_FAILED' ||
    envelope.eventType === 'REQUEST_CANCELED' ||
    envelope.eventType === 'REQUEST_SUPERSEDED' ||
    envelope.eventType === 'OUTPUT_GUARD_BLOCKED';

  const readRunKey = (run?: Pick<RuntimeActiveRunSummary, 'requestId' | 'runId'> | null): string | null => {
    if (!run?.requestId || !run.runId) {
      return null;
    }
    return `${run.requestId}:${run.runId}`;
  };

  const readEnvelopeRunKey = (envelope: StreamEnvelope): string | null => {
    if (!envelope.requestId || !envelope.runId) {
      return null;
    }
    return `${envelope.requestId}:${envelope.runId}`;
  };

  useEffect(() => {
    sessionIdRef.current = sessionId;
    streamCursorRef.current = null;
    liveTailBoundaryEstablishedRef.current = false;
    terminalRunKeysRef.current.clear();
    coveredRunKeysRef.current.clear();
    acceptedRunRecoveryKeyRef.current = null;
    activeBoundedReplayKeyRef.current = null;
    terminalBoundedReplayKeyRef.current = null;
    ignoreNextBoundedReplayDisconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    immediateAppendLaneKeysRef.current.clear();
  }, [sessionId]);

  const syncStreamingState = useEffectEvent((streaming: boolean) => {
    setStreaming(streaming);
  });

  const syncConnectionState = useEffectEvent((state: StreamConnectionState) => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId || !setConnectionState) {
      return;
    }
    setConnectionState(currentSessionId, state);
  });

  useEffect(() => {
    syncStreamingState(Boolean(sessionId && canOpenStream && isExecuting));
  }, [sessionId, canOpenStream, isExecuting]);

  const handleTerminalEvent = useEffectEvent((envelope: StreamEnvelope) => {
    onTerminal?.(envelope);
  });

  const handleRequestAcceptedEvent = useEffectEvent((envelope: StreamEnvelope) => {
    onRequestAccepted?.(envelope);
  });

  const handleRefreshRequiredEvent = useEffectEvent((details?: StreamResumeRecoveryDetails) => {
    return onRefreshRequired?.(details);
  });

  const reconnectAfterExpectedBoundedReplayClose = useEffectEvent(() => {
    activeBoundedReplayKeyRef.current = null;
    terminalBoundedReplayKeyRef.current = null;
    ignoreNextBoundedReplayDisconnectRef.current = true;
    liveTailBoundaryEstablishedRef.current = false;
    setIsConnected(false);
    preserveConnectionNoticeOnReconnectRef.current = true;
    setStreamReconnectTrigger((count) => count + 1);
  });

  const stopStreamForRecovery = useEffectEvent(() => {
    suppressNextDisconnectRef.current = true;
    const connection = streamConnectionRef.current;
    if (connection) {
      streamConnectionRef.current = null;
      connection.close();
    }
    suppressNextDisconnectRef.current = false;
    setIsConnected(false);
  });

  const handleResumeRecovery = useEffectEvent((details: StreamResumeRecoveryDetails) => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      return;
    }

    stopStreamForRecovery();

    if (!details.refreshConversation) {
      syncConnectionState({
        phase: 'disconnected',
        message: i18n.t('streamConnection.disconnected'),
      });
      return;
    }

    syncConnectionState({
      phase: 'resyncing',
      message: i18n.t('streamConnection.restoredSyncing'),
    });

    void Promise.resolve(handleRefreshRequiredEvent(details))
      .then((refreshed) => {
        if (!refreshed || !details.retryable) {
          syncConnectionState({
            phase: 'disconnected',
            message: i18n.t('streamConnection.disconnected'),
          });
          return;
        }
        if (details.resumeAfterSequence !== null) {
          streamCursorRef.current = details.resumeAfterSequence;
        }
        liveTailBoundaryEstablishedRef.current = false;
        preserveConnectionNoticeOnReconnectRef.current = true;
        setStreamReconnectTrigger((count) => count + 1);
      })
      .catch(() => {
        syncConnectionState({
          phase: 'disconnected',
          message: i18n.t('streamConnection.disconnected'),
        });
      });
  });

  const cancelPendingAppendFlush = useEffectEvent(() => {
    if (appendFrameRef.current !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(appendFrameRef.current);
    }
    appendFrameRef.current = null;
    if (appendTimeoutRef.current !== null) {
      clearTimeout(appendTimeoutRef.current);
      appendTimeoutRef.current = null;
    }
  });

  const reconnectAfterBoundedReplayTerminal = useEffectEvent((terminalRunKey: string) => {
    if (activeBoundedReplayKeyRef.current !== terminalRunKey) {
      return;
    }
    reconnectAfterExpectedBoundedReplayClose();
  });

  const commitAcceptedResumeState = useEffectEvent(
    (batch: readonly PendingEnvelopeAppend[], appendResult: ConversationAppendResult): ReadonlySet<StreamEnvelope> => {
      const acceptedByConversationStore = new Set(appendResult.acceptedEnvelopes);
      const acceptedEnvelopes = new Set<StreamEnvelope>();
      for (const pendingAppend of batch) {
        const envelope = pendingAppend.envelope;
        if (!pendingAppend.acceptedByAlternateConsumer && !acceptedByConversationStore.has(envelope)) {
          continue;
        }
        acceptedEnvelopes.add(envelope);
        if (isTimelineBackedCursorEnvelope(envelope) && (streamCursorRef.current === null || envelope.sequence > streamCursorRef.current)) {
          streamCursorRef.current = envelope.sequence;
        }
        const runKey = readEnvelopeRunKey(envelope);
        if (runKey) {
          coveredRunKeysRef.current.add(runKey);
        }
        if (!isTerminalEnvelope(envelope) || !runKey) {
          continue;
        }
        terminalRunKeysRef.current.add(runKey);
        if (runKey === activeBoundedReplayKeyRef.current) {
          terminalBoundedReplayKeyRef.current = runKey;
        }
      }
      return acceptedEnvelopes;
    },
  );

  const appendEnvelopeBatch = useEffectEvent((targetSessionId: string, batch: readonly PendingEnvelopeAppend[]): ReadonlySet<StreamEnvelope> => {
    if (batch.length === 0) {
      return new Set();
    }
    const envelopes = batch.map((pendingAppend) => pendingAppend.envelope);
    let appendResult: ConversationAppendResult | void;
    if (appendEnvelopes) {
      appendResult = appendEnvelopes(targetSessionId, envelopes);
    } else {
      const acceptedEnvelopes: StreamEnvelope[] = [];
      const rejectedEnvelopes: StreamEnvelope[] = [];
      const acceptedRunKeys = new Set<string>();
      let highestAcceptedSequence: number | null = null;
      for (const envelope of envelopes) {
        const itemResult = appendEnvelope(targetSessionId, envelope);
        if (!isConversationAppendResult(itemResult)) {
          acceptedEnvelopes.push(envelope);
          continue;
        }
        acceptedEnvelopes.push(...itemResult.acceptedEnvelopes);
        rejectedEnvelopes.push(...itemResult.rejectedEnvelopes);
        for (const runKey of itemResult.acceptedRunKeys) {
          acceptedRunKeys.add(runKey);
        }
        if (itemResult.highestAcceptedSequence !== null) {
          highestAcceptedSequence =
            highestAcceptedSequence === null
              ? itemResult.highestAcceptedSequence
              : Math.max(highestAcceptedSequence, itemResult.highestAcceptedSequence);
        }
      }
      appendResult = {
        acceptedEnvelopes,
        rejectedEnvelopes,
        highestAcceptedSequence,
        acceptedRunKeys: [...acceptedRunKeys],
      };
    }
    const normalizedResult = isConversationAppendResult(appendResult)
      ? appendResult
      : {
          acceptedEnvelopes: envelopes,
          rejectedEnvelopes: [],
          highestAcceptedSequence: null,
          acceptedRunKeys: [],
        };
    return commitAcceptedResumeState(batch, normalizedResult);
  });

  const flushPendingEnvelopes = useEffectEvent(() => {
    const targetSessionId = pendingAppendSessionIdRef.current;
    const batch = pendingAppendEnvelopesRef.current;
    if (!targetSessionId || batch.length === 0) {
      cancelPendingAppendFlush();
      return;
    }

    pendingAppendSessionIdRef.current = null;
    pendingAppendEnvelopesRef.current = [];
    cancelPendingAppendFlush();
    appendEnvelopeBatch(targetSessionId, batch);
  });

  const schedulePendingAppendFlush = useEffectEvent(() => {
    if (appendFrameRef.current !== null || appendTimeoutRef.current !== null) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      appendFrameRef.current = globalThis.requestAnimationFrame(() => {
        appendFrameRef.current = null;
        flushPendingEnvelopes();
      });
      return;
    }
    appendTimeoutRef.current = setTimeout(() => {
      appendTimeoutRef.current = null;
      flushPendingEnvelopes();
    }, 16);
  });

  const readAppendLaneKey = useEffectEvent((envelope: StreamEnvelope): string => {
    const payload = envelope.payload as Record<string, unknown>;
    const metadata =
      payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? (payload.metadata as Record<string, unknown>)
        : {};
    const toolIdentity = payload.toolCallId ?? payload.invocationId ?? metadata.invocationId ?? payload.capabilityId ?? payload.contentRef ?? '';
    return [
      envelope.sessionId,
      envelope.requestContextId ?? envelope.requestId,
      envelope.rootMessageId ?? '',
      envelope.eventType,
      typeof toolIdentity === 'string' ? toolIdentity : String(toolIdentity),
    ].join(':');
  });

  const enqueueEnvelopeAppend = useEffectEvent((targetSessionId: string, envelope: StreamEnvelope, acceptedByAlternateConsumer: boolean): boolean => {
    const pendingAppend = { envelope, acceptedByAlternateConsumer };
    if (!appendEnvelopes || !FRAME_BATCHABLE_EVENT_TYPES.has(envelope.eventType)) {
      flushPendingEnvelopes();
      return appendEnvelopeBatch(targetSessionId, [pendingAppend]).has(envelope);
    }

    const laneKey = readAppendLaneKey(envelope);
    if (!immediateAppendLaneKeysRef.current.has(laneKey)) {
      immediateAppendLaneKeysRef.current.add(laneKey);
      return appendEnvelopeBatch(targetSessionId, [pendingAppend]).has(envelope);
    }

    if (pendingAppendSessionIdRef.current && pendingAppendSessionIdRef.current !== targetSessionId) {
      flushPendingEnvelopes();
    }
    pendingAppendSessionIdRef.current = targetSessionId;
    pendingAppendEnvelopesRef.current.push(pendingAppend);
    schedulePendingAppendFlush();
    return false;
  });

  const handleEnvelopeEvent = useEffectEvent((parsed: unknown) => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      return;
    }

    const envelope = normalizeStreamEnvelope(parsed);
    if (!envelope) {
      reportWarning('[Stream] Ignored invalid envelope', parsed);
      return;
    }
    if (envelope.sessionId !== currentSessionId) {
      reportWarning('[Stream] Ignored envelope for a different session', {
        currentSessionId,
        envelopeSessionId: envelope.sessionId,
        eventId: envelope.eventId,
      });
      return;
    }
    const acceptedByAlternateConsumer = onLiveEnvelope?.(envelope) === true;
    const acceptedByOwningConsumer = enqueueEnvelopeAppend(currentSessionId, envelope, acceptedByAlternateConsumer);

    if (envelope.eventType === 'REQUEST_ACCEPTED') {
      if (acceptedByOwningConsumer) {
        handleRequestAcceptedEvent(envelope);
      }
      return;
    }

    if (isTerminalEnvelope(envelope)) {
      const terminalRunKey = readEnvelopeRunKey(envelope);
      // Terminal events always notify the terminal handler, even if the
      // conversation store rejected the envelope (identity mismatch). This
      // ensures the executing state is cleared on cancel/complete/fail.
      // Replay filtering: skip if already seen (stream reconnection replay).
      if (!acceptedByOwningConsumer && terminalRunKey && terminalRunKeysRef.current.has(terminalRunKey)) {
        return;
      }
      handleTerminalEvent(envelope);
      if (terminalRunKey && terminalRunKey === terminalBoundedReplayKeyRef.current) {
        reconnectAfterBoundedReplayTerminal(terminalRunKey);
      }
      return;
    }

    if (envelope.eventType === 'USER_INPUT_REQUIRED') {
      if (acceptedByOwningConsumer) {
        onUserInputRequired?.(envelope);
      }
      return;
    }

    if (envelope.eventType === 'USER_INPUT_RECEIVED' || envelope.eventType === 'USER_INPUT_TIMEOUT' || envelope.eventType === 'USER_INPUT_CANCELED') {
      if (acceptedByOwningConsumer) {
        onUserInputResolved?.(envelope);
      }
      return;
    }

    if (envelope.eventType === 'DEGRADATION_NOTICE') {
      const resumeGap = parseStreamResumeGapNotice(envelope.payload);
      if (resumeGap) {
        handleResumeRecovery(resumeGap);
        return;
      }
      const payload = envelope.payload as { refreshConversation?: boolean };
      if (payload.refreshConversation) {
        reportWarning('[Stream] Degradation notice received, triggering refresh...');
        syncConnectionState({
          phase: 'resyncing',
          message: i18n.t('streamConnection.restoredSyncing'),
        });
        handleRefreshRequiredEvent();
      }
    }
  });

  useEffect(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (!sessionId || !canOpenStream || !shouldConnectStream) {
      flushPendingEnvelopes();
      if (streamConnectionRef.current) {
        streamConnectionRef.current.close();
        streamConnectionRef.current = null;
      }
      setIsConnected(false);
      liveTailBoundaryEstablishedRef.current = false;
      syncStreamingState(false);
      if (sessionId && setConnectionState) {
        setConnectionState(sessionId, { phase: 'idle', message: null });
      }
      return undefined;
    }

    if (streamConnectionRef.current) {
      streamConnectionRef.current.close();
      streamConnectionRef.current = null;
    }

    const streamPath = buildApiUrl(`/api/v1/sessions/${encodeURIComponent(sessionId)}/stream`);
    const websocketPath = buildApiUrl(`/api/v1/sessions/${encodeURIComponent(sessionId)}/ws`);
    const observedCursor = streamCursorRef.current;
    const latestActiveRun = activeRunRef.current;
    const activeRunKey = readRunKey(latestActiveRun);
    const latestAcceptedRun = acceptedRunRef.current;
    const acceptedRunKey = readRunKey(latestAcceptedRun);
    const activeRunCoveredByLiveTail = liveTailBoundaryEstablishedRef.current && activeRunKey !== null && activeRunKey === acceptedRunKey;
    const activeRunBootstrap =
      latestActiveRun &&
      activeRunKey &&
      !activeRunCoveredByLiveTail &&
      !coveredRunKeysRef.current.has(activeRunKey) &&
      !terminalRunKeysRef.current.has(activeRunKey)
        ? {
            requestId: latestActiveRun.requestId,
            runId: latestActiveRun.runId,
          }
        : null;
    const acceptedRunRecovery =
      !activeRunBootstrap &&
      latestAcceptedRun &&
      acceptedRunKey &&
      !coveredRunKeysRef.current.has(acceptedRunKey) &&
      !terminalRunKeysRef.current.has(acceptedRunKey)
        ? {
            requestId: latestAcceptedRun.requestId,
            runId: latestAcceptedRun.runId,
          }
        : null;
    const boundedReplay = activeRunBootstrap ?? acceptedRunRecovery;
    const boundedReplayKey = readRunKey(boundedReplay);
    activeBoundedReplayKeyRef.current = boundedReplayKey;
    terminalBoundedReplayKeyRef.current = null;
    ignoreNextBoundedReplayDisconnectRef.current = false;
    if (
      latestAcceptedRun &&
      acceptedRunKey &&
      boundedReplay?.requestId === latestAcceptedRun.requestId &&
      boundedReplay.runId === latestAcceptedRun.runId
    ) {
      acceptedRunRecoveryKeyRef.current = acceptedRunKey;
    }
    const lastSeenSequence = boundedReplay ? 0 : (observedCursor ?? undefined);
    let connection: StreamConnection | null = null;
    let closedByOwner = false;
    let disconnectHandled = false;

    const handleDisconnectInternal = () => {
      if (suppressNextDisconnectRef.current) {
        suppressNextDisconnectRef.current = false;
        return;
      }
      if (closedByOwner || disconnectHandled || !connection || streamConnectionRef.current !== connection) {
        return;
      }
      disconnectHandled = true;
      if (ignoreNextBoundedReplayDisconnectRef.current) {
        ignoreNextBoundedReplayDisconnectRef.current = false;
        return;
      }
      const expectedBoundedReplayClose =
        activeBoundedReplayKeyRef.current !== null && terminalBoundedReplayKeyRef.current === activeBoundedReplayKeyRef.current;
      if (expectedBoundedReplayClose) {
        reconnectAfterExpectedBoundedReplayClose();
        return;
      }
      setIsConnected(false);
      liveTailBoundaryEstablishedRef.current = false;
      void probeAuthChallenge();

      reconnectAttemptsRef.current += 1;
      const attempts = reconnectAttemptsRef.current;
      const fastReconnectsExhausted = attempts > maxFastReconnectAttempts;

      syncConnectionState({
        phase: fastReconnectsExhausted ? 'disconnected' : 'reconnecting',
        message: i18n.t(fastReconnectsExhausted ? 'streamConnection.disconnected' : 'streamConnection.reconnecting'),
      });

      const delayMs = fastReconnectsExhausted ? sustainedReconnectDelayMs : Math.min(500 * 2 ** (attempts - 1), 8_000);
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        preserveConnectionNoticeOnReconnectRef.current = true;
        setStreamReconnectTrigger((count) => count + 1);
      }, delayMs);
    };

    connection = connectStream({
      kind: transportKind,
      sessionId,
      streamPath,
      websocketPath,
      lastSeenSequence,
      requestId: boundedReplay?.requestId ?? null,
      runId: boundedReplay?.runId ?? null,
      headers: { 'x-non-renewal-session': 'true' },
      onOpen: () => {
        if (!connection || streamConnectionRef.current !== connection) {
          return;
        }
        reconnectAttemptsRef.current = 0;
        setIsConnected(true);
        if (boundedReplay === null && lastSeenSequence === undefined) {
          liveTailBoundaryEstablishedRef.current = true;
          onSessionLiveTailOpen?.();
        }
        syncConnectionState({ phase: 'connected', message: null });
      },
      onEnvelope: (parsed: unknown) => {
        if (!connection || streamConnectionRef.current !== connection) {
          return;
        }
        handleEnvelopeEvent(parsed);
      },
      onError: (error) => {
        const resumeFailure = getStreamResumeFailureDetails(error);
        if (resumeFailure) {
          handleResumeRecovery(resumeFailure);
          return;
        }
        handleDisconnectInternal();
      },
      onClose: () => {
        handleDisconnectInternal();
      },
    });

    streamConnectionRef.current = connection;

    return () => {
      const preserveConnectionNotice = preserveConnectionNoticeOnReconnectRef.current && sessionIdRef.current === sessionId;
      preserveConnectionNoticeOnReconnectRef.current = false;
      closedByOwner = true;
      flushPendingEnvelopes();
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (connection) {
        connection.close();
      }
      if (streamConnectionRef.current === connection) {
        streamConnectionRef.current = null;
      }
      setIsConnected(false);
      if (!preserveConnectionNotice && sessionIdRef.current && setConnectionState) {
        setConnectionState(sessionIdRef.current, { phase: 'idle', message: null });
      }
    };
  }, [sessionId, canOpenStream, shouldConnectStream, streamReconnectTrigger, activeRunBootstrapTrigger, acceptedRunRecoveryTrigger, transportKind]);

  useEffect(() => {
    const activeRunKey = readRunKey(activeRun);
    const acceptedRunKey = readRunKey(acceptedRun);
    if (!sessionId || !canOpenStream || !activeRun || activeRunKey === null) {
      return;
    }
    if (
      activeBoundedReplayKeyRef.current === activeRunKey ||
      coveredRunKeysRef.current.has(activeRunKey) ||
      terminalRunKeysRef.current.has(activeRunKey)
    ) {
      return;
    }
    if (liveTailBoundaryEstablishedRef.current && activeRunKey === acceptedRunKey) {
      return;
    }
    preserveConnectionNoticeOnReconnectRef.current = true;
    setActiveRunBootstrapTrigger((count) => count + 1);
  }, [sessionId, canOpenStream, activeRun?.requestId, activeRun?.runId, acceptedRun?.requestId, acceptedRun?.runId]);

  useEffect(() => {
    const acceptedRunKey = readRunKey(acceptedRun);
    if (!sessionId || !canOpenStream || !acceptedRun || acceptedRunKey === null) {
      return;
    }
    if (
      acceptedRunRecoveryKeyRef.current === acceptedRunKey ||
      coveredRunKeysRef.current.has(acceptedRunKey) ||
      terminalRunKeysRef.current.has(acceptedRunKey)
    ) {
      return;
    }
    preserveConnectionNoticeOnReconnectRef.current = true;
    setAcceptedRunRecoveryTrigger((count) => count + 1);
  }, [sessionId, canOpenStream, acceptedRun?.requestId, acceptedRun?.runId]);

  return { isStreaming: isConnected };
}
