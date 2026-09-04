import { create } from 'zustand';
import { useSessionStore } from './sessionStore.ts';
import { sessionService } from '../services/sessionService.ts';
import { isApiError } from '../services/apiClient.ts';
import i18n from '../i18n/index.ts';
import { conversationPageToStreamEnvelopes, getConversationMessageRootMessageId } from '../features/chat/adapters/conversationAdapter.ts';
import { loadCompleteRunProcessHistory, selectVisibleProcessRunTargets } from '../features/chat/history/processHistory.ts';
import {
  createProcessHistoryAutomaticTargetSettler,
  createProcessHistoryScheduler,
  type ProcessHistoryAutomaticTargetSettler,
  type ProcessHistoryScheduler,
  type ProcessHistoryTarget,
} from '../features/chat/history/processHistoryScheduler.ts';
import {
  type StreamEnvelope,
  type ConversationPreviewMarker,
  type ConversationPreviewPage,
  type ForkNotice,
  type SessionConversationPage,
  type SessionConversationMessage,
  type StreamEventType,
  type RuntimeActiveRunSummary,
  type RunProcessHistoryState,
  type WireTimestamp,
} from '../state/contracts.ts';
import {
  buildEnvelopeIdentity,
  buildEnvelopeMergeIdentity,
  buildInputSegmentByEnvelope,
  envelopeMatchesIdentity,
  getEnvelopeAttemptId as readEnvelopeAttemptId,
  getEnvelopeRootMessageId as readEnvelopeRootMessageId,
  getEnvelopeRunId as readEnvelopeRunId,
} from '../features/chat/utils/streamingHelpers.ts';
import { compactLiveEnvelopes } from '../features/chat/utils/streamCompaction.ts';
import { readPayloadBooleanFlag } from '../features/chat/utils/streamTextSemantics.ts';

const DEFAULT_CONVERSATION_LIMIT = 120;
const ANCHORED_CONVERSATION_LIMIT = 50;
const ACTIVE_LIVE_COMPACTION_WATERMARK = 500;
const MAX_CACHED_SESSIONS = 10;
const LOCAL_OPTIMISTIC_HINT = 'local-optimistic';
const LOCAL_SUPERSEDED_HINT = 'local-superseded';
const HISTORY_LOAD_HINT = 'history-load';
const TERMINAL_EVENT_TYPES = new Set<StreamEventType>(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED', 'REQUEST_SUPERSEDED']);

export type HistoryEnvelopesBySession = Readonly<Record<string, readonly StreamEnvelope[]>>;
export interface LiveEnvelopeBucket {
  readonly rootMessageId: string;
  readonly attemptId: string;
  readonly firstSeenOrdinal: number;
  readonly envelopes: readonly StreamEnvelope[];
  readonly nextCompactionAt: number;
}
export type LiveBucketsByRoot = Readonly<Record<string, LiveEnvelopeBucket | undefined>>;
export type LiveBucketsBySession = Readonly<Record<string, LiveBucketsByRoot | undefined>>;
export type NextLiveOrdinalBySession = Readonly<Record<string, number | undefined>>;
export interface CanonicalLiveRunIdentity {
  readonly rootMessageId: string;
  readonly runId?: string;
  readonly requestContextId?: string;
  readonly previousRootMessageId?: string;
  readonly previousRunId?: string;
  readonly acceptedAt?: WireTimestamp;
}
export interface ConversationAppendResult {
  readonly acceptedEnvelopes: readonly StreamEnvelope[];
  readonly rejectedEnvelopes: readonly StreamEnvelope[];
  readonly highestAcceptedSequence: number | null;
  readonly acceptedRunKeys: readonly string[];
}
export type HistoryMessagesBySession = Readonly<Record<string, readonly SessionConversationMessage[]>>;
export type ForkNoticeBySession = Readonly<Record<string, ForkNotice | undefined>>;
export interface ConversationPreviewState {
  readonly totalMarkers: number;
  readonly markersByIndex: Readonly<Record<number, ConversationPreviewMarker | undefined>>;
}
export type ConversationPreviewBySession = Readonly<Record<string, ConversationPreviewState>>;
export type ProcessHistoryBySession = Readonly<Record<string, Readonly<Record<string, RunProcessHistoryState | undefined>> | undefined>>;
export type DisplayProcessRunByRootBySession = Readonly<Record<string, Readonly<Record<string, string | undefined>> | undefined>>;
type ConversationSnapshotLoadState = 'idle' | 'loading' | 'ready' | 'failed';
interface ConversationViewState {
  readonly mode: 'recent' | 'anchored';
  readonly activeAnchorMessageId: string | null;
  readonly newMessagesWhileAnchored: boolean;
}
interface ConversationPageInfo {
  nextCursor: string | null;
  newerCursor: string | null;
  isLoadingOlder: boolean;
  isLoadingNewer: boolean;
  olderLoadError: string | null;
  newerLoadError: string | null;
  hasLoadedOlder: boolean;
}
type ConversationPageInfoBySession = Readonly<Record<string, ConversationPageInfo>>;
type ConversationViewBySession = Readonly<Record<string, ConversationViewState>>;
export type StreamConnectionPhase = 'idle' | 'connected' | 'reconnecting' | 'resyncing' | 'disconnected';
export interface StreamConnectionState {
  phase: StreamConnectionPhase;
  message: string | null;
}
export interface SessionRuntimeState {
  activeRootMessageId: string | null;
  activeRun: RuntimeActiveRunSummary | null;
  continuityPhase: StreamConnectionPhase;
  continuityMessage: string | null;
}
export type RuntimeBySession = Readonly<Record<string, SessionRuntimeState>>;
interface ConversationLoadOptions {
  background?: boolean;
  merge?: boolean;
  requiredRootMessageId?: string;
  preserveRequestId?: string;
}
interface ConversationPreviewLoadOptions {
  offset?: number;
  limit?: number;
}
interface ClearAssistantEnvelopeOptions {
  preserveRunId?: string | null;
  displayRunId?: string | null;
}

interface ConversationState {
  historyEnvelopesBySession: HistoryEnvelopesBySession;
  activeLiveBySession: LiveBucketsBySession;
  settledLiveBySession: LiveBucketsBySession;
  nextLiveOrdinalBySession: NextLiveOrdinalBySession;
  historyMessagesBySession: HistoryMessagesBySession;
  processHistoryBySession: ProcessHistoryBySession;
  displayProcessRunByRootBySession: DisplayProcessRunByRootBySession;
  processHistoryLoadVersionBySession: Readonly<Record<string, number | undefined>>;
  forkNoticeBySession: ForkNoticeBySession;
  conversationPreviewBySession: ConversationPreviewBySession;
  conversationLoadStateBySession: Readonly<Record<string, ConversationSnapshotLoadState>>;
  conversationPageInfoBySession: ConversationPageInfoBySession;
  conversationViewBySession: ConversationViewBySession;
  runtimeBySession: RuntimeBySession;
  isStreaming: boolean;
  conversationError: string | null;
  conversationErrorCode: string | null;
  sessionAccessOrder: string[];
}

interface ConversationActions {
  setEnvelopes: (sessionId: string, envelopes: StreamEnvelope[], options?: { preserveRequestId?: string }) => void;
  setConversationPageInfo: (sessionId: string, patch: Partial<ConversationPageInfo>) => void;
  /**
   * Merges snapshot envelopes with any existing live envelopes for the same session.
   * Deduplicates equivalent projected events, keeping the later-enqueued entry.
   * Used after terminal events to combine persisted snapshot with remaining live content.
   */
  mergeEnvelopes: (sessionId: string, snapshotEnvelopes: StreamEnvelope[]) => void;
  appendEnvelope: (sessionId: string, envelope: StreamEnvelope) => ConversationAppendResult;
  appendEnvelopes: (sessionId: string, envelopes: readonly StreamEnvelope[]) => ConversationAppendResult;
  removeRequestEnvelopes: (sessionId: string, requestId: string) => void;
  reconcileOptimisticRequest: (sessionId: string, optimisticRequestId: string, acceptedIdentity: CanonicalLiveRunIdentity) => string | null;
  optimisticallyEditRoot: (sessionId: string, rootMessageId: string, nextContent: string, optimisticRequestId: string) => void;
  rollbackOptimisticEdit: (sessionId: string, rootMessageId: string, optimisticRequestId: string) => void;
  clearAssistantEnvelopesForRoot: (sessionId: string, rootMessageId: string, options?: ClearAssistantEnvelopeOptions) => void;
  selectRetryAttemptForRoot: (sessionId: string, rootMessageId: string, acceptedRunId: string) => void;
  setConversationLoadState: (sessionId: string, state: ConversationSnapshotLoadState) => void;
  setStreamConnectionState: (sessionId: string, state: StreamConnectionState) => void;
  setRuntimeState: (sessionId: string, patch: Partial<SessionRuntimeState>) => void;
  setStreaming: (streaming: boolean) => void;
  setConversationError: (error: string | null) => void;
  loadConversation: (sessionId: string, options?: ConversationLoadOptions) => Promise<boolean>;
  loadConversationPreview: (sessionId: string, options?: ConversationPreviewLoadOptions) => Promise<boolean>;
  loadAnchoredConversation: (sessionId: string, anchorMessageId: string) => Promise<boolean>;
  loadOlderConversation: (sessionId: string) => Promise<boolean>;
  loadNewerConversation: (sessionId: string) => Promise<boolean>;
  completeAnchoredConversation: (sessionId: string, expectedAnchorMessageId: string) => boolean;
  clearForkNotice: (sessionId: string) => void;
  updateAutomaticProcessHistoryTargets: (sessionId: string, targets: readonly ProcessHistoryTarget[]) => void;
  setExplicitProcessHistoryTarget: (sessionId: string, sourceKey: string, target: Omit<ProcessHistoryTarget, 'generation'> | null) => void;
  retryRunProcessHistory: (sessionId: string, runId: string) => void;
  clearConversation: (sessionId: string) => void;
}

type ConversationStore = ConversationState & ConversationActions;

function mergeConversationPreviewPage(current: ConversationPreviewState | undefined, page: ConversationPreviewPage): ConversationPreviewState {
  const markersByIndex: Record<number, ConversationPreviewMarker | undefined> = {};
  if (current !== undefined) {
    for (const [index, marker] of Object.entries(current.markersByIndex)) {
      const numericIndex = Number(index);
      if (marker !== undefined && Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < page.totalMarkers) {
        markersByIndex[numericIndex] = marker;
      }
    }
  }
  page.markers.forEach((marker, pageIndex) => {
    markersByIndex[page.offset + pageIndex] = marker;
  });
  return {
    totalMarkers: page.totalMarkers,
    markersByIndex,
  };
}

function defaultConversationPageInfo(): ConversationPageInfo {
  return {
    nextCursor: null,
    newerCursor: null,
    isLoadingOlder: false,
    isLoadingNewer: false,
    olderLoadError: null,
    newerLoadError: null,
    hasLoadedOlder: false,
  };
}

function hasSameConversationWindowIdentity(current?: ConversationViewState, expected?: ConversationViewState): boolean {
  return current?.mode === expected?.mode && current?.activeAnchorMessageId === expected?.activeAnchorMessageId;
}

function buildDefaultConversationQuery(
  sessionId: string,
  options?: {
    cursor?: string | null;
    newerCursor?: string | null;
    anchorMessageId?: string | null;
    limit?: number;
    signal?: AbortSignal;
  },
): Parameters<typeof sessionService.loadConversation>[0] {
  return {
    sessionId,
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(options?.newerCursor ? { newerCursor: options.newerCursor } : {}),
    ...(options?.anchorMessageId ? { anchorMessageId: options.anchorMessageId } : {}),
    limit: options?.limit ?? DEFAULT_CONVERSATION_LIMIT,
    includeCapabilityResults: false,
    ...(options?.signal ? { signal: options.signal } : {}),
  };
}

function defaultStreamConnectionState(): StreamConnectionState {
  return {
    phase: 'idle',
    message: null,
  };
}

function connectionStateFromRuntime(runtimeState?: SessionRuntimeState): StreamConnectionState {
  if (!runtimeState) {
    return defaultStreamConnectionState();
  }
  return {
    phase: runtimeState.continuityPhase,
    message: runtimeState.continuityMessage,
  };
}

export function defaultSessionRuntimeState(_sessionId?: string): SessionRuntimeState {
  return {
    activeRootMessageId: null,
    activeRun: null,
    continuityPhase: 'idle',
    continuityMessage: null,
  };
}

const EMPTY_ACTIVE_SESSION_HISTORY_ENVELOPES: readonly StreamEnvelope[] = [];
const EMPTY_ACTIVE_SESSION_HISTORY_MESSAGES: readonly SessionConversationMessage[] = [];
const DEFAULT_ACTIVE_SESSION_RUNTIME_STATE = defaultSessionRuntimeState();
const DEFAULT_ACTIVE_STREAM_CONNECTION_STATE = defaultStreamConnectionState();

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deduplicateEnvelopes(existing: readonly StreamEnvelope[], incoming: readonly StreamEnvelope[]): StreamEnvelope[] {
  // Keyed by requestContextId/attempt first; requestId is only a legacy fallback.
  const seen = new Map<string, StreamEnvelope>();
  for (const env of existing) {
    const key = buildEnvelopeMergeIdentity(env);
    seen.set(key, env);
  }
  for (const env of incoming) {
    const key = buildEnvelopeMergeIdentity(env);
    const existingEnv = seen.get(key);
    if (!existingEnv) {
      seen.set(key, env);
    } else {
      // Keep whichever was created later (live content more up-to-date)
      const existingTime = new Date(existingEnv.createdAt).getTime();
      const incomingTime = new Date(env.createdAt).getTime();
      if (incomingTime >= existingTime) {
        seen.set(key, env);
      }
    }
  }
  return [...seen.values()];
}

function dedupeOlderHistoryEnvelopes(older: readonly StreamEnvelope[], existing: readonly StreamEnvelope[]): StreamEnvelope[] {
  const seenKeys = new Set(existing.map(readHistoryEnvelopeIdentityKey));
  return older.filter((envelope) => {
    const key = readHistoryEnvelopeIdentityKey(envelope);
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
}

function readHistoryEnvelopeIdentityKey(envelope: StreamEnvelope): string {
  const payload = (envelope.payload as Record<string, unknown>) ?? {};
  const messageId = normalizeNonEmptyString(payload.messageId);
  return messageId ? `message:${messageId}` : `event:${envelope.eventId}`;
}

function prependOlderHistoryEnvelopes(existing: readonly StreamEnvelope[], older: readonly StreamEnvelope[]): StreamEnvelope[] {
  const uniqueOlder = dedupeOlderHistoryEnvelopes(older, existing);
  if (uniqueOlder.length === 0) {
    return [...existing];
  }
  return [...uniqueOlder, ...existing];
}

function isUserEnvelope(envelope: StreamEnvelope): boolean {
  return envelope.payload?.role === 'USER';
}

function isAccumulatedAssistantContentSnapshot(envelope: StreamEnvelope): boolean {
  if (envelope.eventType !== 'LLM_CONTENT_DELTA') {
    return false;
  }
  const payload = envelope.payload as Record<string, unknown>;
  if (payload.role === 'CAPABILITY_RESULT') {
    return false;
  }
  if (readPayloadBooleanFlag(payload, 'accumulated') !== true) {
    return false;
  }
  return typeof payload.content === 'string' || typeof payload.text === 'string';
}

function readAccumulatedAssistantContentLaneKey(envelope: StreamEnvelope, inputSegment: number): string {
  const payload = envelope.payload as Record<string, unknown>;
  const stepId = normalizeNonEmptyString(payload.stepId);
  return [
    envelope.sessionId,
    readEnvelopeRootMessageId(envelope),
    readEnvelopeAttemptId(envelope),
    envelope.eventType,
    `input:${inputSegment}`,
    ...(stepId === null ? [] : [`step:${stepId}`]),
  ].join(':');
}

function appendLiveEnvelopes(
  current: readonly StreamEnvelope[],
  envelopes: readonly StreamEnvelope[],
  preserveUnavailableActiveCompletion: boolean,
): readonly StreamEnvelope[] {
  const inputSegmentByEnvelope = buildInputSegmentByEnvelope([...current, ...envelopes]);
  const identities = new Set(current.map(buildEnvelopeIdentity));
  const accumulatedLaneIndexes = new Map<string, number>();
  for (let index = 0; index < current.length; index += 1) {
    const envelope = current[index];
    if (envelope && isAccumulatedAssistantContentSnapshot(envelope)) {
      accumulatedLaneIndexes.set(readAccumulatedAssistantContentLaneKey(envelope, inputSegmentByEnvelope.get(envelope) ?? 0), index);
    }
  }

  let next: StreamEnvelope[] | null = null;
  for (const envelope of envelopes) {
    const nextIdentity = buildEnvelopeIdentity(envelope);
    if (identities.has(nextIdentity)) {
      continue;
    }

    next ??= [...current];
    if (!isAccumulatedAssistantContentSnapshot(envelope)) {
      identities.add(nextIdentity);
      next.push(envelope);
      continue;
    }

    const laneKey = readAccumulatedAssistantContentLaneKey(envelope, inputSegmentByEnvelope.get(envelope) ?? 0);
    const replaceIndex = accumulatedLaneIndexes.get(laneKey);
    if (replaceIndex === undefined) {
      identities.add(nextIdentity);
      accumulatedLaneIndexes.set(laneKey, next.length);
      next.push(envelope);
      continue;
    }

    const replacedEnvelope = next[replaceIndex];
    if (replacedEnvelope) {
      identities.delete(buildEnvelopeIdentity(replacedEnvelope));
    }
    identities.add(nextIdentity);
    next[replaceIndex] =
      preserveUnavailableActiveCompletion && replacedEnvelope !== undefined
        ? preserveActiveContentOnUnavailableCompletion(replacedEnvelope, envelope)
        : envelope;
  }

  return next ?? current;
}

function preserveActiveContentOnUnavailableCompletion(previous: StreamEnvelope, incoming: StreamEnvelope): StreamEnvelope {
  const previousPayload = previous.payload as Record<string, unknown>;
  const incomingPayload = incoming.payload as Record<string, unknown>;
  const previousContent = normalizeNonEmptyString(previousPayload.content);
  const previousText = normalizeNonEmptyString(previousPayload.text);
  if (
    readPayloadBooleanFlag(incomingPayload, 'completed') !== true ||
    readPayloadBooleanFlag(incomingPayload, 'contentUnavailable') !== true ||
    normalizeNonEmptyString(incomingPayload.content) !== null ||
    normalizeNonEmptyString(incomingPayload.text) !== null ||
    (previousContent === null && previousText === null)
  ) {
    return incoming;
  }

  const payload: Record<string, unknown> = { ...incomingPayload };
  payload.content = previousContent ?? previousText ?? '';
  payload.text = previousText ?? previousContent ?? '';
  for (const key of ['contentType', 'role'] as const) {
    if (previousPayload[key] !== undefined) {
      payload[key] = previousPayload[key];
    }
  }
  delete payload.contentUnavailable;
  return { ...incoming, payload } as StreamEnvelope;
}

type SessionCachePatch = Partial<
  Pick<
    ConversationState,
    | 'historyEnvelopesBySession'
    | 'activeLiveBySession'
    | 'settledLiveBySession'
    | 'nextLiveOrdinalBySession'
    | 'historyMessagesBySession'
    | 'processHistoryBySession'
    | 'displayProcessRunByRootBySession'
    | 'processHistoryLoadVersionBySession'
    | 'forkNoticeBySession'
    | 'conversationPreviewBySession'
    | 'conversationLoadStateBySession'
    | 'conversationPageInfoBySession'
    | 'conversationViewBySession'
    | 'runtimeBySession'
  >
>;

function retainCachedSessions<T>(entries: Readonly<Record<string, T>>, retainedSessionIds: ReadonlySet<string>): Readonly<Record<string, T>> {
  let changed = false;
  const retainedEntries: Record<string, T> = {};
  for (const [sessionId, value] of Object.entries(entries)) {
    if (!retainedSessionIds.has(sessionId)) {
      changed = true;
      continue;
    }
    retainedEntries[sessionId] = value;
  }
  return changed ? retainedEntries : entries;
}

function withSessionCacheUpdate(state: ConversationState, sessionId: string, patch: SessionCachePatch) {
  const previousOrder = state.sessionAccessOrder;
  const withoutSession = previousOrder.filter((candidate) => candidate !== sessionId);
  const nextOrder = [...withoutSession, sessionId];
  const evictedSessionIds = nextOrder.length > MAX_CACHED_SESSIONS ? nextOrder.splice(0, nextOrder.length - MAX_CACHED_SESSIONS) : [];
  const stableOrder =
    evictedSessionIds.length === 0 &&
    previousOrder.length === nextOrder.length &&
    previousOrder.every((candidate, index) => candidate === nextOrder[index])
      ? previousOrder
      : nextOrder;
  if (evictedSessionIds.length === 0) {
    return {
      ...patch,
      sessionAccessOrder: stableOrder,
    };
  }

  const retainedSessionIds = new Set(nextOrder);
  return {
    historyEnvelopesBySession: retainCachedSessions(patch.historyEnvelopesBySession ?? state.historyEnvelopesBySession, retainedSessionIds),
    activeLiveBySession: retainCachedSessions(patch.activeLiveBySession ?? state.activeLiveBySession, retainedSessionIds),
    settledLiveBySession: retainCachedSessions(patch.settledLiveBySession ?? state.settledLiveBySession, retainedSessionIds),
    nextLiveOrdinalBySession: retainCachedSessions(patch.nextLiveOrdinalBySession ?? state.nextLiveOrdinalBySession, retainedSessionIds),
    historyMessagesBySession: retainCachedSessions(patch.historyMessagesBySession ?? state.historyMessagesBySession, retainedSessionIds),
    processHistoryBySession: retainCachedSessions(patch.processHistoryBySession ?? state.processHistoryBySession, retainedSessionIds),
    displayProcessRunByRootBySession: retainCachedSessions(
      patch.displayProcessRunByRootBySession ?? state.displayProcessRunByRootBySession,
      retainedSessionIds,
    ),
    processHistoryLoadVersionBySession: retainCachedSessions(
      patch.processHistoryLoadVersionBySession ?? state.processHistoryLoadVersionBySession,
      retainedSessionIds,
    ),
    forkNoticeBySession: retainCachedSessions(patch.forkNoticeBySession ?? state.forkNoticeBySession, retainedSessionIds),
    conversationPreviewBySession: retainCachedSessions(patch.conversationPreviewBySession ?? state.conversationPreviewBySession, retainedSessionIds),
    conversationLoadStateBySession: retainCachedSessions(
      patch.conversationLoadStateBySession ?? state.conversationLoadStateBySession,
      retainedSessionIds,
    ),
    conversationPageInfoBySession: retainCachedSessions(
      patch.conversationPageInfoBySession ?? state.conversationPageInfoBySession,
      retainedSessionIds,
    ),
    conversationViewBySession: retainCachedSessions(patch.conversationViewBySession ?? state.conversationViewBySession, retainedSessionIds),
    runtimeBySession: retainCachedSessions(patch.runtimeBySession ?? state.runtimeBySession, retainedSessionIds),
    sessionAccessOrder: stableOrder,
  };
}

function compactBucketEnvelopes(
  envelopes: readonly StreamEnvelope[],
  nextCompactionAt: number,
  force: boolean,
): { readonly envelopes: readonly StreamEnvelope[]; readonly nextCompactionAt: number } {
  if (!force && envelopes.length < nextCompactionAt) {
    return { envelopes, nextCompactionAt };
  }
  const compacted = compactLiveEnvelopes(envelopes, envelopes.length);
  return {
    envelopes: compacted,
    nextCompactionAt: compacted.length + ACTIVE_LIVE_COMPACTION_WATERMARK,
  };
}

function createLiveBucket(
  rootMessageId: string,
  attemptId: string,
  firstSeenOrdinal: number,
  envelopes: readonly StreamEnvelope[],
  settled: boolean,
): LiveEnvelopeBucket {
  const compacted = compactBucketEnvelopes(appendLiveEnvelopes([], envelopes, !settled), ACTIVE_LIVE_COMPACTION_WATERMARK, settled);
  return {
    rootMessageId,
    attemptId,
    firstSeenOrdinal,
    envelopes: compacted.envelopes,
    nextCompactionAt: compacted.nextCompactionAt,
  };
}

function appendToLiveBucket(bucket: LiveEnvelopeBucket, envelopes: readonly StreamEnvelope[], settled: boolean): LiveEnvelopeBucket {
  const appended = appendLiveEnvelopes(bucket.envelopes, envelopes, !settled);
  if (appended === bucket.envelopes) {
    return bucket;
  }
  const compacted = compactBucketEnvelopes(appended, bucket.nextCompactionAt, settled);
  return {
    ...bucket,
    envelopes: compacted.envelopes,
    nextCompactionAt: compacted.nextCompactionAt,
  };
}

function isTerminalEnvelope(envelope: StreamEnvelope): boolean {
  return TERMINAL_EVENT_TYPES.has(envelope.eventType);
}

function latestBucketSequence(...buckets: ReadonlyArray<LiveEnvelopeBucket | undefined>): number {
  let latestSequence = Number.NEGATIVE_INFINITY;
  for (const bucket of buckets) {
    for (const envelope of bucket?.envelopes ?? []) {
      latestSequence = Math.max(latestSequence, envelope.sequence);
    }
  }
  return latestSequence;
}

function readExactRunKey(envelope: StreamEnvelope): string | null {
  const requestId = envelope.requestId.trim();
  const runId = envelope.runId?.trim();
  return requestId && runId ? `${requestId}:${runId}` : null;
}

function toConversationAppendResult(
  acceptedEnvelopes: readonly StreamEnvelope[],
  rejectedEnvelopes: readonly StreamEnvelope[],
): ConversationAppendResult {
  let highestAcceptedSequence: number | null = null;
  const acceptedRunKeys = new Set<string>();
  for (const envelope of acceptedEnvelopes) {
    if (envelope.eventType !== 'DEGRADATION_NOTICE' && typeof envelope.timelineEventRef === 'string' && envelope.timelineEventRef.trim().length > 0) {
      highestAcceptedSequence = highestAcceptedSequence === null ? envelope.sequence : Math.max(highestAcceptedSequence, envelope.sequence);
    }
    const runKey = readExactRunKey(envelope);
    if (runKey) {
      acceptedRunKeys.add(runKey);
    }
  }
  return {
    acceptedEnvelopes,
    rejectedEnvelopes,
    highestAcceptedSequence,
    acceptedRunKeys: [...acceptedRunKeys],
  };
}

const EMPTY_APPEND_RESULT: ConversationAppendResult = {
  acceptedEnvelopes: [],
  rejectedEnvelopes: [],
  highestAcceptedSequence: null,
  acceptedRunKeys: [],
};

function carryLocalOptimisticUserAnchor(
  bucket: LiveEnvelopeBucket,
  acceptedRequestContextId: string,
  acceptedRunId?: string,
  acceptedAt?: WireTimestamp,
): LiveEnvelopeBucket {
  const userEnvelopes = bucket.envelopes
    .filter((envelope) => envelope.transportHints.includes(LOCAL_OPTIMISTIC_HINT) && isUserEnvelope(envelope))
    .map((envelope) => {
      return {
        ...envelope,
        ...(acceptedRunId ? { runId: acceptedRunId } : {}),
        ...(acceptedAt !== undefined ? { createdAt: acceptedAt } : {}),
        requestContextId: acceptedRequestContextId,
        payload: {
          ...(envelope.payload as Record<string, unknown>),
          ...(acceptedRunId ? { runId: acceptedRunId } : {}),
          requestContextId: acceptedRequestContextId,
        } as StreamEnvelope['payload'],
      } as StreamEnvelope;
    });
  return createLiveBucket(bucket.rootMessageId, acceptedRequestContextId, bucket.firstSeenOrdinal, userEnvelopes, false);
}

function applyAcceptedTimestampToBucket(bucket: LiveEnvelopeBucket, acceptedAt: WireTimestamp): LiveEnvelopeBucket | null {
  const needsUpdate = bucket.envelopes.some((env) => env.transportHints.includes(LOCAL_OPTIMISTIC_HINT) && env.createdAt !== acceptedAt);
  if (!needsUpdate) {
    return null;
  }
  const updatedEnvelopes = bucket.envelopes.map((env) =>
    env.transportHints.includes(LOCAL_OPTIMISTIC_HINT) ? { ...env, createdAt: acceptedAt } : env,
  );
  return { ...bucket, envelopes: updatedEnvelopes };
}

function applyLiveBucketBatch(
  activeByRoot: LiveBucketsByRoot | undefined,
  settledByRoot: LiveBucketsByRoot | undefined,
  nextOrdinal: number,
  envelopes: readonly StreamEnvelope[],
): {
  readonly activeByRoot: LiveBucketsByRoot;
  readonly settledByRoot: LiveBucketsByRoot;
  readonly nextOrdinal: number;
  readonly changed: boolean;
  readonly acceptedEnvelopes: readonly StreamEnvelope[];
  readonly rejectedEnvelopes: readonly StreamEnvelope[];
} {
  let nextActive = activeByRoot ?? {};
  let nextSettled = settledByRoot ?? {};
  let ordinal = nextOrdinal;
  let changed = false;
  const acceptedEnvelopes: StreamEnvelope[] = [];
  const rejectedEnvelopes: StreamEnvelope[] = [];

  for (const envelope of envelopes) {
    const rootMessageId = readEnvelopeRootMessageId(envelope);
    const attemptId = readEnvelopeAttemptId(envelope);
    if (!rootMessageId || !attemptId) {
      rejectedEnvelopes.push(envelope);
      continue;
    }

    const activeBucket = nextActive[rootMessageId];
    const settledBucket = nextSettled[rootMessageId];
    const matchesActive = activeBucket?.attemptId === attemptId;
    const matchesSettled = settledBucket?.attemptId === attemptId;
    const terminal = isTerminalEnvelope(envelope);
    const startsNewAttempt = Boolean(
      envelope.eventType === 'REQUEST_ACCEPTED' && envelope.sequence > latestBucketSequence(activeBucket, settledBucket),
    );

    if (matchesSettled && !matchesActive) {
      acceptedEnvelopes.push(envelope);
      const updated = appendToLiveBucket(settledBucket, [envelope], true);
      if (updated !== settledBucket) {
        nextSettled = { ...nextSettled, [rootMessageId]: updated };
        changed = true;
      }
      continue;
    }

    if (!matchesActive && (activeBucket || settledBucket)) {
      if (!startsNewAttempt) {
        if (terminal && activeBucket !== undefined) {
          const terminalUpdated = appendToLiveBucket(activeBucket, [envelope], true);
          const { [rootMessageId]: _terminalRemovedActive, ...terminalRemainingActive } = nextActive;
          nextActive = terminalRemainingActive;
          nextSettled = { ...nextSettled, [rootMessageId]: terminalUpdated };
          acceptedEnvelopes.push(envelope);
          changed = true;
          continue;
        }
        rejectedEnvelopes.push(envelope);
        continue;
      }
    }

    const firstSeenOrdinal = activeBucket?.firstSeenOrdinal ?? settledBucket?.firstSeenOrdinal ?? ordinal++;
    const optimisticUserSource = startsNewAttempt
      ? [activeBucket, settledBucket].find((bucket) =>
          bucket?.envelopes.some((candidate) => candidate.transportHints.includes(LOCAL_OPTIMISTIC_HINT) && isUserEnvelope(candidate)),
        )
      : undefined;
    const baseBucket = matchesActive
      ? activeBucket
      : optimisticUserSource
        ? carryLocalOptimisticUserAnchor(optimisticUserSource, attemptId)
        : createLiveBucket(rootMessageId, attemptId, firstSeenOrdinal, [], false);
    const updated = appendToLiveBucket(baseBucket, [envelope], terminal);
    if (matchesActive && updated === activeBucket) {
      acceptedEnvelopes.push(envelope);
      continue;
    }

    if (terminal) {
      const { [rootMessageId]: _removedActive, ...remainingActive } = nextActive;
      nextActive = remainingActive;
      nextSettled = { ...nextSettled, [rootMessageId]: updated };
    } else {
      nextActive = { ...nextActive, [rootMessageId]: updated };
      if (settledBucket && settledBucket.attemptId !== attemptId) {
        const { [rootMessageId]: _removedSettled, ...remainingSettled } = nextSettled;
        nextSettled = remainingSettled;
      }
    }
    acceptedEnvelopes.push(envelope);
    changed = true;
  }

  return {
    activeByRoot: nextActive,
    settledByRoot: nextSettled,
    nextOrdinal: ordinal,
    changed,
    acceptedEnvelopes,
    rejectedEnvelopes,
  };
}

function bucketMatchesExactRun(bucket: LiveEnvelopeBucket | undefined, rootMessageId: string, runId?: string): boolean {
  return Boolean(
    bucket &&
    runId &&
    bucket.envelopes.some((envelope) => readEnvelopeRootMessageId(envelope) === rootMessageId && readEnvelopeRunId(envelope) === runId),
  );
}

function isStableOptimisticUserAnchor(envelope: StreamEnvelope, optimisticRequestId: string): boolean {
  return envelope.eventId === `temp-${optimisticRequestId}` && envelope.transportHints.includes(LOCAL_OPTIMISTIC_HINT) && isUserEnvelope(envelope);
}

export function flattenLiveBuckets(buckets?: LiveBucketsByRoot): readonly StreamEnvelope[] {
  return Object.values(buckets ?? {})
    .filter((bucket): bucket is LiveEnvelopeBucket => bucket !== undefined)
    .sort((left, right) => left.firstSeenOrdinal - right.firstSeenOrdinal)
    .flatMap((bucket) => bucket.envelopes);
}

interface SessionLiveBucketState {
  readonly activeByRoot: LiveBucketsByRoot;
  readonly settledByRoot: LiveBucketsByRoot;
  readonly nextOrdinal: number;
}

function transformSessionLiveBuckets(
  activeByRoot: LiveBucketsByRoot | undefined,
  settledByRoot: LiveBucketsByRoot | undefined,
  nextOrdinal: number,
  transform: (envelope: StreamEnvelope) => StreamEnvelope | null,
): SessionLiveBucketState {
  const sourceBuckets = [...Object.values(activeByRoot ?? {}), ...Object.values(settledByRoot ?? {})]
    .filter((bucket): bucket is LiveEnvelopeBucket => bucket !== undefined)
    .sort((left, right) => left.firstSeenOrdinal - right.firstSeenOrdinal);

  const ordinalByRoot = new Map<string, number>();
  let rebuilt: SessionLiveBucketState = {
    activeByRoot: {},
    settledByRoot: {},
    nextOrdinal: 0,
  };
  for (const bucket of sourceBuckets) {
    const envelopes = bucket.envelopes.flatMap((envelope) => {
      const nextEnvelope = transform(envelope);
      return nextEnvelope ? [nextEnvelope] : [];
    });
    const firstEnvelope = envelopes[0];
    if (!firstEnvelope) {
      continue;
    }
    const transformedRootMessageId = getEnvelopeRootMessageId(firstEnvelope);
    const currentOrdinal = ordinalByRoot.get(transformedRootMessageId);
    ordinalByRoot.set(
      transformedRootMessageId,
      currentOrdinal === undefined ? bucket.firstSeenOrdinal : Math.min(currentOrdinal, bucket.firstSeenOrdinal),
    );
    rebuilt = applyLiveBucketBatch(rebuilt.activeByRoot, rebuilt.settledByRoot, rebuilt.nextOrdinal, envelopes);
  }
  const restoreFirstSeenOrdinals = (buckets: LiveBucketsByRoot): LiveBucketsByRoot =>
    Object.fromEntries(
      Object.entries(buckets).map(([rootMessageId, bucket]) => [
        rootMessageId,
        bucket && ordinalByRoot.has(rootMessageId) ? { ...bucket, firstSeenOrdinal: ordinalByRoot.get(rootMessageId)! } : bucket,
      ]),
    );
  return {
    activeByRoot: restoreFirstSeenOrdinals(rebuilt.activeByRoot),
    settledByRoot: restoreFirstSeenOrdinals(rebuilt.settledByRoot),
    nextOrdinal,
  };
}

function withSessionLiveBucketState(state: ConversationState, sessionId: string, bucketState: SessionLiveBucketState) {
  return {
    activeLiveBySession: {
      ...state.activeLiveBySession,
      [sessionId]: bucketState.activeByRoot,
    },
    settledLiveBySession: {
      ...state.settledLiveBySession,
      [sessionId]: bucketState.settledByRoot,
    },
    nextLiveOrdinalBySession: {
      ...state.nextLiveOrdinalBySession,
      [sessionId]: bucketState.nextOrdinal,
    },
  };
}

function markEnvelopesAsHistoryLoaded(envelopes: readonly StreamEnvelope[]): StreamEnvelope[] {
  return envelopes.map((envelope) =>
    envelope.transportHints.includes(HISTORY_LOAD_HINT)
      ? envelope
      : {
          ...envelope,
          transportHints: [...envelope.transportHints, HISTORY_LOAD_HINT],
        },
  );
}

function snapshotContainsSettledRootMessage(page: SessionConversationPage, requiredRootMessageId: string): boolean {
  const rootMessages = page.items.filter((message) => {
    const rootMessageId = getConversationMessageRootMessageId(message);
    if (rootMessageId !== requiredRootMessageId) {
      return false;
    }
    if (message.visible === false) {
      return false;
    }
    return message.content.trim().length > 0;
  });
  const hasAssistantResponse = rootMessages.some((message) => message.role === 'ASSISTANT');

  return hasAssistantResponse;
}

function getEnvelopeRootMessageId(envelope: StreamEnvelope): string {
  return readEnvelopeRootMessageId(envelope);
}

function getEnvelopeAttemptId(envelope: StreamEnvelope): string {
  return readEnvelopeAttemptId(envelope);
}

function snapshotContainsEnvelopeIdentity(snapshotEnvelopes: readonly StreamEnvelope[], envelope: StreamEnvelope): boolean {
  const identities = new Set(
    [
      normalizeNonEmptyString(envelope.requestId),
      normalizeNonEmptyString(envelope.requestContextId),
      getEnvelopeAttemptId(envelope),
      getEnvelopeRootMessageId(envelope),
    ].filter((identity): identity is string => Boolean(identity)),
  );

  return [...identities].some((identity) => snapshotEnvelopes.some((snapshotEnvelope) => envelopeMatchesIdentity(snapshotEnvelope, identity)));
}

function backgroundSnapshotMissesLocalOptimisticEnvelope(existing: readonly StreamEnvelope[], snapshotEnvelopes: readonly StreamEnvelope[]): boolean {
  return existing.some(
    (envelope) => envelope.transportHints.includes(LOCAL_OPTIMISTIC_HINT) && !snapshotContainsEnvelopeIdentity(snapshotEnvelopes, envelope),
  );
}

function readSupersededRootMappings(envelopes: readonly StreamEnvelope[]): Map<string, string> {
  const mappings = new Map<string, string>();

  for (const envelope of envelopes) {
    const payload = envelope.payload as Record<string, unknown>;
    if (payload.visible !== false) {
      continue;
    }
    const rootMessageId = getEnvelopeRootMessageId(envelope);
    const supersededByRootMessageId = normalizeNonEmptyString(payload.supersededByRootMessageId);
    if (!rootMessageId || !supersededByRootMessageId || rootMessageId === supersededByRootMessageId) {
      continue;
    }
    mappings.set(rootMessageId, supersededByRootMessageId);
  }

  return mappings;
}

function applySupersededRootVisibility(existing: readonly StreamEnvelope[], incoming: readonly StreamEnvelope[]): StreamEnvelope[] {
  const supersededRoots = readSupersededRootMappings(existing);
  if (supersededRoots.size === 0) {
    return [...incoming];
  }

  return incoming.map((envelope) => {
    const rootMessageId = getEnvelopeRootMessageId(envelope);
    const supersededByRootMessageId = supersededRoots.get(rootMessageId);
    if (!supersededByRootMessageId) {
      return envelope;
    }

    const payload = envelope.payload as Record<string, unknown>;
    return {
      ...envelope,
      transportHints: envelope.transportHints.includes(LOCAL_SUPERSEDED_HINT)
        ? envelope.transportHints
        : [...envelope.transportHints, LOCAL_SUPERSEDED_HINT],
      payload: {
        ...payload,
        visible: false,
        supersededByRootMessageId,
      } as StreamEnvelope['payload'],
    } as StreamEnvelope;
  });
}

function dedupeOlderHistoryMessages(
  older: readonly SessionConversationMessage[],
  existing: readonly SessionConversationMessage[],
): SessionConversationMessage[] {
  const existingMessageIds = new Set(existing.map((message) => message.messageId));
  return older.filter((message) => !existingMessageIds.has(message.messageId));
}

function prependOlderHistoryMessages(
  existing: readonly SessionConversationMessage[],
  older: readonly SessionConversationMessage[],
): SessionConversationMessage[] {
  const uniqueOlder = dedupeOlderHistoryMessages(older, existing);
  if (uniqueOlder.length === 0) {
    return [...existing];
  }
  return [...uniqueOlder, ...existing];
}

function appendNewerHistoryMessages(
  existing: readonly SessionConversationMessage[],
  newer: readonly SessionConversationMessage[],
): SessionConversationMessage[] {
  const existingMessageIds = new Set(existing.map((message) => message.messageId));
  const uniqueNewer = newer.filter((message) => !existingMessageIds.has(message.messageId));
  return uniqueNewer.length === 0 ? [...existing] : [...existing, ...uniqueNewer];
}

const activeConversationVersionRef = { current: 0 };
const conversationAbortControllerRef = { current: null as AbortController | null };
const olderConversationAbortControllers = new Map<string, AbortController>();
const processHistorySchedulers = new Map<string, ProcessHistoryScheduler>();
const automaticProcessHistoryTargetSettlers = new Map<string, ProcessHistoryAutomaticTargetSettler>();
const automaticProcessHistoryTargetsBySession = new Map<string, readonly ProcessHistoryTarget[]>();
const explicitProcessHistoryTargetsBySession = new Map<string, Map<string, ProcessHistoryTarget>>();
const processHistoryGenerationBySession = new Map<string, number>();

function disposeProcessHistorySession(sessionId: string): void {
  automaticProcessHistoryTargetSettlers.get(sessionId)?.clear();
  automaticProcessHistoryTargetSettlers.delete(sessionId);
  processHistorySchedulers.get(sessionId)?.clear({ notify: false });
  processHistorySchedulers.delete(sessionId);
  automaticProcessHistoryTargetsBySession.delete(sessionId);
  explicitProcessHistoryTargetsBySession.delete(sessionId);
  processHistoryGenerationBySession.delete(sessionId);
}

function getAutomaticProcessHistoryTargetSettler(sessionId: string): ProcessHistoryAutomaticTargetSettler {
  const existing = automaticProcessHistoryTargetSettlers.get(sessionId);
  if (existing) {
    return existing;
  }
  const settler = createProcessHistoryAutomaticTargetSettler({
    publish: (targets) => {
      automaticProcessHistoryTargetsBySession.set(sessionId, targets);
      publishProcessHistoryTargets(sessionId);
    },
  });
  automaticProcessHistoryTargetSettlers.set(sessionId, settler);
  return settler;
}

function nextProcessHistoryGeneration(sessionId: string): number {
  const generation = (processHistoryGenerationBySession.get(sessionId) ?? 0) + 1;
  processHistoryGenerationBySession.set(sessionId, generation);
  return generation;
}

function invalidateActiveConversationLoad(): void {
  activeConversationVersionRef.current += 1;
  conversationAbortControllerRef.current?.abort();
  conversationAbortControllerRef.current = null;
  for (const controller of olderConversationAbortControllers.values()) {
    controller.abort();
  }
  olderConversationAbortControllers.clear();
}

function getProcessHistoryScheduler(sessionId: string): ProcessHistoryScheduler {
  const existing = processHistorySchedulers.get(sessionId);
  if (existing) {
    return existing;
  }
  const scheduler = createProcessHistoryScheduler({
    sessionId,
    load: (target, signal) =>
      loadCompleteRunProcessHistory({
        sessionId: target.sessionId,
        runId: target.runId,
        signal,
      }),
    onChange: (snapshot) => {
      useConversationStore.setState((state) => ({
        processHistoryBySession: {
          ...state.processHistoryBySession,
          [sessionId]: snapshot,
        },
      }));
    },
    onExplicitDemandReleased: (release) => {
      const explicit = explicitProcessHistoryTargetsBySession.get(sessionId);
      if (!explicit) {
        return;
      }
      for (const [sourceKey, current] of explicit) {
        if (current.runId === release.runId && (release.scope === 'RUN' || current.generation === release.generation)) {
          explicit.delete(sourceKey);
        }
      }
      if (explicit.size === 0) {
        explicitProcessHistoryTargetsBySession.delete(sessionId);
      }
    },
  });
  processHistorySchedulers.set(sessionId, scheduler);
  return scheduler;
}

function publishProcessHistoryTargets(sessionId: string): void {
  const automatic = automaticProcessHistoryTargetsBySession.get(sessionId) ?? [];
  const explicit = [...(explicitProcessHistoryTargetsBySession.get(sessionId)?.values() ?? [])];
  const activeRunId = useConversationStore.getState().runtimeBySession[sessionId]?.activeRun?.runId;
  useConversationStore.setState((state) => {
    return {
      processHistoryLoadVersionBySession: {
        ...state.processHistoryLoadVersionBySession,
        [sessionId]: processHistoryGenerationBySession.get(sessionId) ?? 0,
      },
    };
  });
  getProcessHistoryScheduler(sessionId).updateTargets({
    automatic,
    explicit,
    pinnedRunIds: activeRunId ? [activeRunId] : [],
  });
}

function updateDisplayProcessRuns(sessionId: string, messages: readonly SessionConversationMessage[]): void {
  automaticProcessHistoryTargetSettlers.get(sessionId)?.clear();
  const selectedTargets = selectVisibleProcessRunTargets(messages);
  const displayRunByRoot = Object.fromEntries(selectedTargets.map((target) => [target.rootMessageId, target.runId]));
  useConversationStore.setState((state) => ({
    displayProcessRunByRootBySession: {
      ...state.displayProcessRunByRootBySession,
      [sessionId]: displayRunByRoot,
    },
  }));

  const automaticTargets = (automaticProcessHistoryTargetsBySession.get(sessionId) ?? []).filter(
    (target) => displayRunByRoot[target.rootMessageId] === target.runId,
  );
  automaticProcessHistoryTargetsBySession.set(sessionId, automaticTargets);
  const explicitTargets = new Map(
    [...(explicitProcessHistoryTargetsBySession.get(sessionId)?.entries() ?? [])].filter(
      ([, target]) => displayRunByRoot[target.rootMessageId] === target.runId,
    ),
  );
  if (explicitTargets.size === 0) {
    explicitProcessHistoryTargetsBySession.delete(sessionId);
  } else {
    explicitProcessHistoryTargetsBySession.set(sessionId, explicitTargets);
  }
  if (processHistorySchedulers.has(sessionId) || automaticTargets.length > 0 || explicitTargets.size > 0) {
    publishProcessHistoryTargets(sessionId);
  }
}
export const useConversationStore = create<ConversationStore>((set, get) => ({
  historyEnvelopesBySession: {},
  activeLiveBySession: {},
  settledLiveBySession: {},
  nextLiveOrdinalBySession: {},
  historyMessagesBySession: {},
  processHistoryBySession: {},
  displayProcessRunByRootBySession: {},
  processHistoryLoadVersionBySession: {},
  forkNoticeBySession: {},
  conversationPreviewBySession: {},
  conversationLoadStateBySession: {},
  conversationPageInfoBySession: {},
  conversationViewBySession: {},
  runtimeBySession: {},
  isStreaming: false,
  conversationError: null,
  conversationErrorCode: null,
  sessionAccessOrder: [],

  setEnvelopes: (sessionId, envelopes, options) => {
    set((state) => {
      void options;
      const existing = [
        ...(state.historyEnvelopesBySession[sessionId] ?? []),
        ...flattenLiveBuckets(state.settledLiveBySession[sessionId]),
        ...flattenLiveBuckets(state.activeLiveBySession[sessionId]),
      ];
      const historyEnvelopes = markEnvelopesAsHistoryLoaded(envelopes);
      const normalizedIncoming = applySupersededRootVisibility(existing, historyEnvelopes);
      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: normalizedIncoming,
        },
      });
    });
  },

  setConversationPageInfo: (sessionId, patch) => {
    set((state) => {
      const current = state.conversationPageInfoBySession[sessionId] ?? defaultConversationPageInfo();
      return {
        conversationPageInfoBySession: {
          ...state.conversationPageInfoBySession,
          [sessionId]: {
            ...current,
            ...patch,
          },
        },
      };
    });
  },

  mergeEnvelopes: (sessionId, snapshotEnvelopes) => {
    set((state) => {
      const existingHistory = state.historyEnvelopesBySession[sessionId] ?? [];
      const existing = [
        ...existingHistory,
        ...flattenLiveBuckets(state.settledLiveBySession[sessionId]),
        ...flattenLiveBuckets(state.activeLiveBySession[sessionId]),
      ];
      const historyEnvelopes = markEnvelopesAsHistoryLoaded(snapshotEnvelopes);
      const normalizedIncoming = applySupersededRootVisibility(existing, historyEnvelopes);
      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: deduplicateEnvelopes(existingHistory, normalizedIncoming),
        },
      });
    });
  },

  appendEnvelope: (sessionId, envelope) => {
    return get().appendEnvelopes(sessionId, [envelope]);
  },

  appendEnvelopes: (sessionId, envelopes) => {
    if (envelopes.length === 0) {
      return EMPTY_APPEND_RESULT;
    }
    let appendResult = EMPTY_APPEND_RESULT;
    set((state) => {
      const conversationView = state.conversationViewBySession[sessionId];
      const pageInfo = state.conversationPageInfoBySession[sessionId] ?? defaultConversationPageInfo();
      const bucketUpdate = applyLiveBucketBatch(
        state.activeLiveBySession[sessionId],
        state.settledLiveBySession[sessionId],
        state.nextLiveOrdinalBySession[sessionId] ?? 0,
        envelopes,
      );
      appendResult = toConversationAppendResult(bucketUpdate.acceptedEnvelopes, bucketUpdate.rejectedEnvelopes);
      const shouldMarkAnchoredUpdate = Boolean(
        conversationView?.mode === 'anchored' && pageInfo.newerCursor && !conversationView.newMessagesWhileAnchored,
      );
      if (!bucketUpdate.changed && !shouldMarkAnchoredUpdate) {
        return state;
      }
      return withSessionCacheUpdate(state, sessionId, {
        activeLiveBySession: {
          ...state.activeLiveBySession,
          [sessionId]: bucketUpdate.activeByRoot,
        },
        settledLiveBySession: {
          ...state.settledLiveBySession,
          [sessionId]: bucketUpdate.settledByRoot,
        },
        nextLiveOrdinalBySession: {
          ...state.nextLiveOrdinalBySession,
          [sessionId]: bucketUpdate.nextOrdinal,
        },
        ...(shouldMarkAnchoredUpdate && conversationView
          ? {
              conversationViewBySession: {
                ...state.conversationViewBySession,
                [sessionId]: {
                  ...conversationView,
                  newMessagesWhileAnchored: true,
                },
              },
            }
          : {}),
      });
    });
    return appendResult;
  },

  removeRequestEnvelopes: (sessionId, requestId) => {
    if (!requestId) {
      return;
    }
    set((state) => {
      const currentHistory = state.historyEnvelopesBySession[sessionId] ?? [];
      const currentLive = [...flattenLiveBuckets(state.activeLiveBySession[sessionId]), ...flattenLiveBuckets(state.settledLiveBySession[sessionId])];
      if (currentHistory.length === 0 && currentLive.length === 0) {
        return state;
      }

      const nextHistory = currentHistory.filter((envelope) => !envelopeMatchesIdentity(envelope, requestId));
      const hasMatchingLiveEnvelope = currentLive.some((envelope) => envelopeMatchesIdentity(envelope, requestId));
      const bucketState = transformSessionLiveBuckets(
        state.activeLiveBySession[sessionId],
        state.settledLiveBySession[sessionId],
        state.nextLiveOrdinalBySession[sessionId] ?? 0,
        (envelope) => (envelopeMatchesIdentity(envelope, requestId) ? null : envelope),
      );
      if (nextHistory.length === currentHistory.length && !hasMatchingLiveEnvelope) {
        return state;
      }

      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: nextHistory,
        },
        ...withSessionLiveBucketState(state, sessionId, bucketState),
      });
    });
  },

  reconcileOptimisticRequest: (sessionId, optimisticRequestId, acceptedIdentity) => {
    const acceptedRootMessageId = acceptedIdentity.rootMessageId.trim();
    const acceptedRunId = acceptedIdentity.runId?.trim();
    let acceptedRequestContextId = acceptedIdentity.requestContextId?.trim() || null;
    const previousRootMessageId = acceptedIdentity.previousRootMessageId?.trim() || null;
    const previousRunId = acceptedIdentity.previousRunId?.trim() || null;
    const acceptedAt = acceptedIdentity.acceptedAt;
    if (!optimisticRequestId || !acceptedRootMessageId) {
      return null;
    }
    set((state) => {
      const currentHistory = state.historyEnvelopesBySession[sessionId] ?? [];
      if (currentHistory.length === 0 && !state.activeLiveBySession[sessionId] && !state.settledLiveBySession[sessionId]) {
        return state;
      }

      const acceptedRootActiveBucket = state.activeLiveBySession[sessionId]?.[acceptedRootMessageId];
      const acceptedRootSettledBucket = state.settledLiveBySession[sessionId]?.[acceptedRootMessageId];
      const exactAcceptedRootBucket = [acceptedRootActiveBucket, acceptedRootSettledBucket].find((bucket) =>
        bucketMatchesExactRun(bucket, acceptedRootMessageId, acceptedRunId),
      );
      if (!acceptedRequestContextId && exactAcceptedRootBucket) {
        acceptedRequestContextId = exactAcceptedRootBucket.attemptId;
      }
      const acceptedRootBucket =
        (acceptedRequestContextId
          ? [acceptedRootActiveBucket, acceptedRootSettledBucket].find((bucket) => bucket?.attemptId === acceptedRequestContextId)
          : undefined) ??
        exactAcceptedRootBucket ??
        acceptedRootActiveBucket ??
        acceptedRootSettledBucket;
      const canRebindAcceptedRoot = Boolean(
        acceptedRequestContextId &&
        acceptedRootBucket &&
        (optimisticRequestId === acceptedRootMessageId ||
          acceptedRootBucket.envelopes.some((envelope) => envelope.transportHints.includes(LOCAL_OPTIMISTIC_HINT))),
      );
      if (acceptedRequestContextId && canRebindAcceptedRoot && acceptedRootBucket) {
        if (acceptedRootBucket.attemptId === acceptedRequestContextId) {
          if (!acceptedAt) {
            return state;
          }
          const timestampUpdatedBucket = applyAcceptedTimestampToBucket(acceptedRootBucket, acceptedAt);
          if (!timestampUpdatedBucket) {
            return state;
          }
          const activeBuckets = state.activeLiveBySession[sessionId] ?? {};
          const settledBuckets = state.settledLiveBySession[sessionId] ?? {};
          const bucketInActive = activeBuckets[acceptedRootMessageId] === acceptedRootBucket;
          return withSessionCacheUpdate(state, sessionId, {
            activeLiveBySession: bucketInActive
              ? { ...state.activeLiveBySession, [sessionId]: { ...activeBuckets, [acceptedRootMessageId]: timestampUpdatedBucket } }
              : state.activeLiveBySession,
            settledLiveBySession: !bucketInActive
              ? { ...state.settledLiveBySession, [sessionId]: { ...settledBuckets, [acceptedRootMessageId]: timestampUpdatedBucket } }
              : state.settledLiveBySession,
          });
        }
        const nextBucket = carryLocalOptimisticUserAnchor(acceptedRootBucket, acceptedRequestContextId, acceptedRunId, acceptedAt);
        const { [acceptedRootMessageId]: _removedSettled, ...remainingSettled } = state.settledLiveBySession[sessionId] ?? {};
        return withSessionCacheUpdate(state, sessionId, {
          activeLiveBySession: {
            ...state.activeLiveBySession,
            [sessionId]: {
              ...(state.activeLiveBySession[sessionId] ?? {}),
              [acceptedRootMessageId]: nextBucket,
            },
          },
          settledLiveBySession: {
            ...state.settledLiveBySession,
            [sessionId]: remainingSettled,
          },
        });
      }

      let updated = false;
      const reconcileLayer = (layer: readonly StreamEnvelope[], rekeyOptimisticIdentity: boolean) =>
        layer
          .map((envelope) => {
            const currentPayload = envelope.payload as Record<string, unknown>;
            const matchesOptimisticRequest =
              rekeyOptimisticIdentity &&
              (envelopeMatchesIdentity(envelope, optimisticRequestId) || isStableOptimisticUserAnchor(envelope, optimisticRequestId));
            const updatesSupersededRoot =
              currentPayload.supersededByRootMessageId === optimisticRequestId ||
              (previousRootMessageId !== null && currentPayload.supersededByRootMessageId === previousRootMessageId);
            const discardsConflictingSameRootCandidate = Boolean(
              previousRootMessageId === acceptedRootMessageId &&
              previousRunId &&
              previousRunId !== acceptedRunId &&
              !matchesOptimisticRequest &&
              readEnvelopeRootMessageId(envelope) === previousRootMessageId &&
              readEnvelopeRunId(envelope) === previousRunId,
            );
            if (discardsConflictingSameRootCandidate) {
              updated = true;
              return null;
            }
            if (!matchesOptimisticRequest && !updatesSupersededRoot) {
              return envelope;
            }

            const nextPayload = { ...currentPayload };
            let envelopeUpdated = false;

            if (updatesSupersededRoot) {
              nextPayload.supersededByRootMessageId = acceptedRootMessageId;
              envelopeUpdated = true;
            }

            if (!matchesOptimisticRequest) {
              if (!envelopeUpdated) {
                return envelope;
              }
              updated = true;
              return {
                ...envelope,
                payload: nextPayload as StreamEnvelope['payload'],
              } as StreamEnvelope;
            }

            updated = true;
            nextPayload.rootMessageId = acceptedRootMessageId;
            nextPayload.messageId = acceptedRootMessageId;
            nextPayload.requestId = acceptedRootMessageId;
            if (acceptedRunId) {
              nextPayload.runId = acceptedRunId;
            }
            const nextRequestContextId = acceptedRequestContextId ?? acceptedRootMessageId;
            if (nextRequestContextId) {
              nextPayload.requestContextId = nextRequestContextId;
            }
            return {
              ...envelope,
              requestId: acceptedRootMessageId,
              ...(acceptedRunId ? { runId: acceptedRunId } : {}),
              ...(acceptedAt ? { createdAt: acceptedAt } : {}),
              ...(nextRequestContextId ? { requestContextId: nextRequestContextId } : {}),
              rootMessageId: acceptedRootMessageId,
              payload: nextPayload as StreamEnvelope['payload'],
            } as StreamEnvelope;
          })
          .filter((envelope): envelope is StreamEnvelope => envelope !== null);

      const nextHistory = reconcileLayer(currentHistory, false);
      const bucketState = transformSessionLiveBuckets(
        state.activeLiveBySession[sessionId],
        state.settledLiveBySession[sessionId],
        state.nextLiveOrdinalBySession[sessionId] ?? 0,
        (envelope) => reconcileLayer([envelope], true)[0] ?? null,
      );

      if (!updated) {
        return state;
      }

      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: nextHistory,
        },
        ...withSessionLiveBucketState(state, sessionId, bucketState),
      });
    });
    return acceptedRequestContextId;
  },

  optimisticallyEditRoot: (sessionId, rootMessageId, nextContent, optimisticRequestId) => {
    if (!rootMessageId || !optimisticRequestId) {
      return;
    }

    set((state) => {
      const markSuperseded = (layer: readonly StreamEnvelope[]) =>
        layer.map((envelope) => {
          if (getEnvelopeRootMessageId(envelope) !== rootMessageId) {
            return envelope;
          }

          const nextPayload = {
            ...(envelope.payload as Record<string, unknown>),
            visible: false,
            supersededByRootMessageId: optimisticRequestId,
          };

          return {
            ...envelope,
            transportHints: envelope.transportHints.includes(LOCAL_SUPERSEDED_HINT)
              ? envelope.transportHints
              : [...envelope.transportHints, LOCAL_SUPERSEDED_HINT],
            payload: nextPayload as StreamEnvelope['payload'],
          } as StreamEnvelope;
        });

      const currentHistory = state.historyEnvelopesBySession[sessionId] ?? [];
      const currentHistoryMessages = state.historyMessagesBySession[sessionId] ?? [];
      const nextHistory = markSuperseded(currentHistory);
      const nextHistoryMessages = currentHistoryMessages.map((message) =>
        getConversationMessageRootMessageId(message) === rootMessageId && message.visible !== false ? { ...message, visible: false } : message,
      );
      const optimisticEditedRootEnvelope: StreamEnvelope = {
        eventId: `temp-${optimisticRequestId}`,
        sessionId,
        requestId: optimisticRequestId,
        sequence: 0,
        eventType: 'REQUEST_ACCEPTED',
        timelineEventRef: null,
        transportHints: [LOCAL_OPTIMISTIC_HINT],
        createdAt: '',
        payload: {
          content: nextContent,
          text: nextContent,
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: true },
          role: 'USER',
          messageId: optimisticRequestId,
          rootMessageId: optimisticRequestId,
          editedFromMessageId: rootMessageId,
          visible: true,
        },
      };
      const transformedBuckets = transformSessionLiveBuckets(
        state.activeLiveBySession[sessionId],
        state.settledLiveBySession[sessionId],
        state.nextLiveOrdinalBySession[sessionId] ?? 0,
        (envelope) => markSuperseded([envelope])[0] ?? null,
      );
      const bucketState = applyLiveBucketBatch(transformedBuckets.activeByRoot, transformedBuckets.settledByRoot, transformedBuckets.nextOrdinal, [
        optimisticEditedRootEnvelope,
      ]);

      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: nextHistory,
        },
        historyMessagesBySession: {
          ...state.historyMessagesBySession,
          [sessionId]: nextHistoryMessages,
        },
        ...withSessionLiveBucketState(state, sessionId, bucketState),
      });
    });
  },

  rollbackOptimisticEdit: (sessionId, rootMessageId, optimisticRequestId) => {
    if (!rootMessageId || !optimisticRequestId) {
      return;
    }

    set((state) => {
      const currentHistory = state.historyEnvelopesBySession[sessionId] ?? [];
      const currentHistoryMessages = state.historyMessagesBySession[sessionId] ?? [];
      if (
        currentHistory.length === 0 &&
        currentHistoryMessages.length === 0 &&
        !state.activeLiveBySession[sessionId] &&
        !state.settledLiveBySession[sessionId]
      ) {
        return state;
      }

      const restoreLayer = (layer: readonly StreamEnvelope[]) =>
        layer.flatMap((envelope) => {
          const envelopeRootMessageId = getEnvelopeRootMessageId(envelope);
          const nextPayload = { ...(envelope.payload as Record<string, unknown>) };

          if (envelopeMatchesIdentity(envelope, optimisticRequestId) && envelope.transportHints.includes(LOCAL_OPTIMISTIC_HINT)) {
            updated = true;
            return [];
          }

          if (envelopeRootMessageId === rootMessageId && nextPayload.supersededByRootMessageId === optimisticRequestId) {
            updated = true;
            delete nextPayload.visible;
            delete nextPayload.supersededByRootMessageId;
            return [
              {
                ...envelope,
                transportHints: envelope.transportHints.filter((hint) => hint !== LOCAL_SUPERSEDED_HINT),
                payload: nextPayload as StreamEnvelope['payload'],
              } as StreamEnvelope,
            ];
          }

          return [envelope];
        });

      let updated = false;
      const nextHistory = restoreLayer(currentHistory);
      const nextHistoryMessages = currentHistoryMessages.map((message) => {
        if (getConversationMessageRootMessageId(message) !== rootMessageId || message.visible !== false) {
          return message;
        }
        updated = true;
        return { ...message, visible: true };
      });
      const bucketState = transformSessionLiveBuckets(
        state.activeLiveBySession[sessionId],
        state.settledLiveBySession[sessionId],
        state.nextLiveOrdinalBySession[sessionId] ?? 0,
        (envelope) => restoreLayer([envelope])[0] ?? null,
      );

      if (!updated) {
        return state;
      }

      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: nextHistory,
        },
        historyMessagesBySession: {
          ...state.historyMessagesBySession,
          [sessionId]: nextHistoryMessages,
        },
        ...withSessionLiveBucketState(state, sessionId, bucketState),
      });
    });
  },

  clearAssistantEnvelopesForRoot: (sessionId, rootMessageId, options) => {
    if (!rootMessageId) {
      return;
    }
    invalidateActiveConversationLoad();
    const preserveRunId = options?.preserveRunId?.trim() || null;
    const displayRunId = options?.displayRunId?.trim() || null;
    const shouldPreserveEnvelope = (envelope: StreamEnvelope) => Boolean(preserveRunId && envelopeMatchesIdentity(envelope, preserveRunId));
    const shouldPreserveHistoryMessage = (message: SessionConversationMessage) =>
      Boolean(preserveRunId && (message.runId === preserveRunId || message.requestContextId === preserveRunId));
    set((state) => {
      const currentHistory = state.historyEnvelopesBySession[sessionId] ?? [];
      const currentLive = [...flattenLiveBuckets(state.activeLiveBySession[sessionId]), ...flattenLiveBuckets(state.settledLiveBySession[sessionId])];
      const currentHistoryMessages = state.historyMessagesBySession[sessionId] ?? [];
      const currentDisplayRunId = state.displayProcessRunByRootBySession[sessionId]?.[rootMessageId];
      if (
        currentHistory.length === 0 &&
        currentLive.length === 0 &&
        currentHistoryMessages.length === 0 &&
        (!displayRunId || currentDisplayRunId === displayRunId)
      ) {
        return state;
      }

      const filterLayer = (layer: readonly StreamEnvelope[]) =>
        layer.filter((envelope) => {
          const isUserEnvelope = envelope.payload?.role === 'USER';
          if (getEnvelopeRootMessageId(envelope) !== rootMessageId) {
            return true;
          }
          return isUserEnvelope || shouldPreserveEnvelope(envelope);
        });

      const nextHistory = filterLayer(currentHistory);
      const bucketState = transformSessionLiveBuckets(
        state.activeLiveBySession[sessionId],
        state.settledLiveBySession[sessionId],
        state.nextLiveOrdinalBySession[sessionId] ?? 0,
        (envelope) => filterLayer([envelope])[0] ?? null,
      );
      const nextHistoryMessages = currentHistoryMessages.filter((message) => {
        const messageRootId = getConversationMessageRootMessageId(message);
        if (messageRootId !== rootMessageId) {
          return true;
        }
        return message.role === 'USER' || shouldPreserveHistoryMessage(message);
      });

      if (
        nextHistory.length === currentHistory.length &&
        flattenLiveBuckets(bucketState.activeByRoot).length + flattenLiveBuckets(bucketState.settledByRoot).length === currentLive.length &&
        nextHistoryMessages.length === currentHistoryMessages.length &&
        (!displayRunId || currentDisplayRunId === displayRunId)
      ) {
        return state;
      }

      return withSessionCacheUpdate(state, sessionId, {
        historyEnvelopesBySession: {
          ...state.historyEnvelopesBySession,
          [sessionId]: nextHistory,
        },
        historyMessagesBySession: {
          ...state.historyMessagesBySession,
          [sessionId]: nextHistoryMessages,
        },
        ...(displayRunId
          ? {
              displayProcessRunByRootBySession: {
                ...state.displayProcessRunByRootBySession,
                [sessionId]: {
                  ...(state.displayProcessRunByRootBySession[sessionId] ?? {}),
                  [rootMessageId]: displayRunId,
                },
              },
            }
          : {}),
        ...withSessionLiveBucketState(state, sessionId, bucketState),
      });
    });
  },

  selectRetryAttemptForRoot: (sessionId, rootMessageId, acceptedRunId) => {
    const normalizedRunId = acceptedRunId.trim();
    if (!rootMessageId || !normalizedRunId) {
      return;
    }
    automaticProcessHistoryTargetSettlers
      .get(sessionId)
      ?.filter((target) => target.rootMessageId !== rootMessageId || target.runId === normalizedRunId);
    const automaticTargets = (automaticProcessHistoryTargetsBySession.get(sessionId) ?? []).filter(
      (target) => target.rootMessageId !== rootMessageId || target.runId === normalizedRunId,
    );
    automaticProcessHistoryTargetsBySession.set(sessionId, automaticTargets);
    const explicitTargets = new Map(
      [...(explicitProcessHistoryTargetsBySession.get(sessionId)?.entries() ?? [])].filter(
        ([, target]) => target.rootMessageId !== rootMessageId || target.runId === normalizedRunId,
      ),
    );
    if (explicitTargets.size === 0) {
      explicitProcessHistoryTargetsBySession.delete(sessionId);
    } else {
      explicitProcessHistoryTargetsBySession.set(sessionId, explicitTargets);
    }
    get().clearAssistantEnvelopesForRoot(sessionId, rootMessageId, {
      preserveRunId: normalizedRunId,
      displayRunId: normalizedRunId,
    });
    if (processHistorySchedulers.has(sessionId) || automaticTargets.length > 0 || explicitTargets.size > 0) {
      publishProcessHistoryTargets(sessionId);
    }
  },

  setConversationLoadState: (sessionId, state) => {
    set((s) => ({
      conversationLoadStateBySession: { ...s.conversationLoadStateBySession, [sessionId]: state },
    }));
  },

  setStreamConnectionState: (sessionId, connectionState) => {
    set((state) => ({
      runtimeBySession: {
        ...state.runtimeBySession,
        [sessionId]: {
          ...(state.runtimeBySession[sessionId] ?? defaultSessionRuntimeState(sessionId)),
          continuityPhase: connectionState.phase,
          continuityMessage: connectionState.message,
        },
      },
    }));
  },

  setRuntimeState: (sessionId, patch) => {
    set((state) => {
      const currentRuntime = state.runtimeBySession[sessionId] ?? defaultSessionRuntimeState(sessionId);
      const nextRuntime: SessionRuntimeState = {
        ...currentRuntime,
        ...patch,
      };

      if (
        nextRuntime.activeRootMessageId === currentRuntime.activeRootMessageId &&
        nextRuntime.activeRun?.requestId === currentRuntime.activeRun?.requestId &&
        nextRuntime.activeRun?.runId === currentRuntime.activeRun?.runId &&
        nextRuntime.activeRun?.status === currentRuntime.activeRun?.status &&
        nextRuntime.continuityPhase === currentRuntime.continuityPhase &&
        nextRuntime.continuityMessage === currentRuntime.continuityMessage
      ) {
        return state;
      }

      return {
        runtimeBySession: {
          ...state.runtimeBySession,
          [sessionId]: nextRuntime,
        },
      };
    });
    if (processHistorySchedulers.has(sessionId)) {
      publishProcessHistoryTargets(sessionId);
    }
  },

  setStreaming: (streaming) => {
    set({ isStreaming: streaming });
  },

  setConversationError: (error) => {
    set({ conversationError: error });
  },

  loadConversation: async (sessionId, options) => {
    const background = options?.background ?? false;
    const merge = options?.merge ?? false;
    const requiredRootMessageId = options?.requiredRootMessageId?.trim() || null;
    const preserveRequestId = options?.preserveRequestId?.trim() || null;
    const callVersion = ++activeConversationVersionRef.current;

    conversationAbortControllerRef.current?.abort();
    conversationAbortControllerRef.current = new AbortController();

    if (!background) {
      set({ conversationError: null, conversationErrorCode: null });
      get().setConversationLoadState(sessionId, 'loading');
    }

    try {
      const page = await sessionService.loadConversation(
        buildDefaultConversationQuery(sessionId, {
          signal: conversationAbortControllerRef.current.signal,
        }),
      );

      if (callVersion !== activeConversationVersionRef.current) {
        return false;
      }

      if (background && get().conversationViewBySession[sessionId]?.mode === 'anchored') {
        return false;
      }

      const currentState = get();
      const existing = [
        ...(currentState.historyEnvelopesBySession[sessionId] ?? []),
        ...flattenLiveBuckets(currentState.settledLiveBySession[sessionId]),
        ...flattenLiveBuckets(currentState.activeLiveBySession[sessionId]),
      ];
      get().setConversationLoadState(sessionId, 'ready');
      get().setRuntimeState(sessionId, {
        activeRun: page.activeRun ?? null,
      });

      if (requiredRootMessageId && !snapshotContainsSettledRootMessage(page, requiredRootMessageId)) {
        return false;
      }

      const envelopes = conversationPageToStreamEnvelopes(page);
      const normalizedHistoryMessages = [...page.items].sort((left, right) => left.sequence - right.sequence);
      const hasLiveEnvelopes = existing.some((envelope) => !envelope.transportHints.includes(HISTORY_LOAD_HINT));

      // Keep currently rendered live content when the snapshot races behind the local/streamed state.
      if (background && !merge && backgroundSnapshotMissesLocalOptimisticEnvelope(existing, envelopes)) {
        return false;
      }
      if (!merge && envelopes.length === 0 && ((background && existing.length > 0) || hasLiveEnvelopes)) {
        return false;
      }

      // After terminal event, merge snapshot with existing live envelopes to avoid
      // overwriting content that arrived just before the snapshot was captured.
      if (merge) {
        get().mergeEnvelopes(sessionId, envelopes);
        set((state) => ({
          historyMessagesBySession: {
            ...state.historyMessagesBySession,
            [sessionId]: normalizedHistoryMessages,
          },
        }));
      } else {
        get().setEnvelopes(sessionId, envelopes, preserveRequestId ? { preserveRequestId } : undefined);
        set((state) => ({
          historyMessagesBySession: {
            ...state.historyMessagesBySession,
            [sessionId]: normalizedHistoryMessages,
          },
        }));
      }
      // Input-guard-blocked rounds are now persisted by the backend as
      // visible=false safe marker messages (recordInputGuardBlock), so they
      // arrive as ordinary history envelopes — no frontend rehydration needed.
      get().setConversationPageInfo(sessionId, {
        nextCursor: page.nextCursor,
        newerCursor: page.newerCursor ?? null,
        isLoadingOlder: false,
        isLoadingNewer: false,
        olderLoadError: null,
        newerLoadError: null,
        hasLoadedOlder: false,
      });
      set((state) => ({
        forkNoticeBySession: {
          ...state.forkNoticeBySession,
          [sessionId]: page.forkNotice,
        },
        conversationViewBySession: {
          ...state.conversationViewBySession,
          [sessionId]: { mode: 'recent', activeAnchorMessageId: null, newMessagesWhileAnchored: false },
        },
      }));
      updateDisplayProcessRuns(sessionId, normalizedHistoryMessages);
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return false;
      }
      const message =
        isApiError(error) && error.code === 'SESSION_NOT_FOUND'
          ? i18n.t('requestNotices.sessionNotFound')
          : error instanceof Error
            ? error.message
            : 'Failed to load conversation.';
      set({ conversationError: message, conversationErrorCode: isApiError(error) && error.code ? error.code : null });
      get().setConversationLoadState(sessionId, 'failed');
      return false;
    }
  },

  loadConversationPreview: async (sessionId, options = {}) => {
    try {
      const page = await sessionService.loadConversationPreview(sessionId, options);
      set((state) => ({
        conversationPreviewBySession: {
          ...state.conversationPreviewBySession,
          [sessionId]: mergeConversationPreviewPage(state.conversationPreviewBySession[sessionId], page),
        },
      }));
      return true;
    } catch {
      return false;
    }
  },

  loadAnchoredConversation: async (sessionId, anchorMessageId) => {
    const callVersion = ++activeConversationVersionRef.current;
    conversationAbortControllerRef.current?.abort();
    conversationAbortControllerRef.current = new AbortController();
    set({ conversationError: null, conversationErrorCode: null });
    get().setConversationLoadState(sessionId, 'loading');
    try {
      const page = await sessionService.loadConversation(
        buildDefaultConversationQuery(sessionId, {
          anchorMessageId,
          limit: ANCHORED_CONVERSATION_LIMIT,
          signal: conversationAbortControllerRef.current.signal,
        }),
      );
      if (callVersion !== activeConversationVersionRef.current) {
        return false;
      }
      const envelopes = conversationPageToStreamEnvelopes(page);
      const normalizedHistoryMessages = [...page.items].sort((left, right) => left.sequence - right.sequence);
      get().setRuntimeState(sessionId, { activeRun: page.activeRun ?? null });
      set((state) => ({
        conversationViewBySession: {
          ...state.conversationViewBySession,
          [sessionId]: { mode: 'anchored', activeAnchorMessageId: anchorMessageId, newMessagesWhileAnchored: false },
        },
      }));
      get().setEnvelopes(sessionId, envelopes);
      set((state) => ({
        historyMessagesBySession: {
          ...state.historyMessagesBySession,
          [sessionId]: normalizedHistoryMessages,
        },
      }));
      get().setConversationPageInfo(sessionId, {
        nextCursor: page.nextCursor,
        newerCursor: page.newerCursor ?? null,
        isLoadingOlder: false,
        isLoadingNewer: false,
        olderLoadError: null,
        newerLoadError: null,
        hasLoadedOlder: false,
      });
      get().setConversationLoadState(sessionId, 'ready');
      updateDisplayProcessRuns(sessionId, normalizedHistoryMessages);
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return false;
      }
      const message = error instanceof Error ? error.message : 'Failed to load conversation.';
      set({ conversationError: message });
      get().setConversationLoadState(sessionId, 'failed');
      return false;
    }
  },

  loadOlderConversation: async (sessionId) => {
    const pageInfo = get().conversationPageInfoBySession[sessionId] ?? defaultConversationPageInfo();
    const cursor = pageInfo.nextCursor;
    const callVersion = activeConversationVersionRef.current;
    const originatingView = get().conversationViewBySession[sessionId];

    if (!cursor) {
      return false;
    }

    get().setConversationPageInfo(sessionId, {
      isLoadingOlder: true,
      olderLoadError: null,
    });

    olderConversationAbortControllers.get(sessionId)?.abort();
    const olderAbortController = new AbortController();
    olderConversationAbortControllers.set(sessionId, olderAbortController);

    try {
      const page = await sessionService.loadConversation(
        buildDefaultConversationQuery(sessionId, {
          cursor,
          signal: olderAbortController.signal,
        }),
      );
      const currentState = get();
      const hasSameWindow = hasSameConversationWindowIdentity(currentState.conversationViewBySession[sessionId], originatingView);
      const hasSameCursor = currentState.conversationPageInfoBySession[sessionId]?.nextCursor === cursor;
      if (
        olderConversationAbortControllers.get(sessionId) !== olderAbortController ||
        callVersion !== activeConversationVersionRef.current ||
        !hasSameWindow ||
        !hasSameCursor
      ) {
        if (olderConversationAbortControllers.get(sessionId) === olderAbortController) {
          olderConversationAbortControllers.delete(sessionId);
        }
        return false;
      }
      olderConversationAbortControllers.delete(sessionId);

      const olderEnvelopes = conversationPageToStreamEnvelopes(page);
      const olderMessages = [...page.items].sort((left, right) => left.sequence - right.sequence);

      set((state) => {
        const existingHistory = state.historyEnvelopesBySession[sessionId] ?? [];
        const nextHistoryEnvelopes = prependOlderHistoryEnvelopes(existingHistory, olderEnvelopes);
        const existingHistoryMessages = state.historyMessagesBySession[sessionId] ?? [];
        const nextHistoryMessages = prependOlderHistoryMessages(existingHistoryMessages, olderMessages);
        return withSessionCacheUpdate(state, sessionId, {
          historyEnvelopesBySession: {
            ...state.historyEnvelopesBySession,
            [sessionId]: markEnvelopesAsHistoryLoaded(nextHistoryEnvelopes),
          },
          historyMessagesBySession: {
            ...state.historyMessagesBySession,
            [sessionId]: nextHistoryMessages,
          },
        });
      });

      get().setConversationPageInfo(sessionId, {
        nextCursor: page.nextCursor,
        isLoadingOlder: false,
        olderLoadError: null,
        hasLoadedOlder: true,
      });

      updateDisplayProcessRuns(sessionId, get().historyMessagesBySession[sessionId] ?? []);

      return olderEnvelopes.length > 0;
    } catch (error) {
      const isCurrentOlderLoad = olderConversationAbortControllers.get(sessionId) === olderAbortController;
      const currentState = get();
      const hasSameWindow = hasSameConversationWindowIdentity(currentState.conversationViewBySession[sessionId], originatingView);
      const hasSameCursor = currentState.conversationPageInfoBySession[sessionId]?.nextCursor === cursor;
      if (isCurrentOlderLoad) {
        olderConversationAbortControllers.delete(sessionId);
      }
      if (error instanceof Error && error.name === 'AbortError') {
        if (isCurrentOlderLoad && hasSameWindow && hasSameCursor) {
          get().setConversationPageInfo(sessionId, {
            isLoadingOlder: false,
          });
        }
        return false;
      }
      if (!isCurrentOlderLoad || callVersion !== activeConversationVersionRef.current || !hasSameWindow || !hasSameCursor) {
        return false;
      }
      const message = error instanceof Error ? error.message : 'Failed to load older messages.';
      get().setConversationPageInfo(sessionId, {
        isLoadingOlder: false,
        olderLoadError: message,
      });
      return false;
    }
  },

  loadNewerConversation: async (sessionId) => {
    const pageInfo = get().conversationPageInfoBySession[sessionId] ?? defaultConversationPageInfo();
    const cursor = pageInfo.newerCursor;
    const callVersion = activeConversationVersionRef.current;
    const originatingView = get().conversationViewBySession[sessionId];
    if (!cursor || pageInfo.isLoadingNewer) {
      return false;
    }
    get().setConversationPageInfo(sessionId, {
      isLoadingNewer: true,
      newerLoadError: null,
    });
    try {
      const page = await sessionService.loadConversation(buildDefaultConversationQuery(sessionId, { newerCursor: cursor }));
      const currentState = get();
      const hasSameWindow = hasSameConversationWindowIdentity(currentState.conversationViewBySession[sessionId], originatingView);
      const hasSameCursor = currentState.conversationPageInfoBySession[sessionId]?.newerCursor === cursor;
      if (callVersion !== activeConversationVersionRef.current || !hasSameWindow || !hasSameCursor) {
        return false;
      }
      const newerEnvelopes = conversationPageToStreamEnvelopes(page);
      const newerMessages = [...page.items].sort((left, right) => left.sequence - right.sequence);
      set((state) => {
        const existingHistory = state.historyEnvelopesBySession[sessionId] ?? [];
        const nextHistoryEnvelopes = deduplicateEnvelopes(existingHistory, markEnvelopesAsHistoryLoaded(newerEnvelopes));
        const existingHistoryMessages = state.historyMessagesBySession[sessionId] ?? [];
        const nextHistoryMessages = appendNewerHistoryMessages(existingHistoryMessages, newerMessages);
        return withSessionCacheUpdate(state, sessionId, {
          historyEnvelopesBySession: {
            ...state.historyEnvelopesBySession,
            [sessionId]: nextHistoryEnvelopes,
          },
          historyMessagesBySession: {
            ...state.historyMessagesBySession,
            [sessionId]: nextHistoryMessages,
          },
        });
      });
      get().setConversationPageInfo(sessionId, {
        newerCursor: page.newerCursor ?? null,
        isLoadingNewer: false,
        newerLoadError: null,
      });
      updateDisplayProcessRuns(sessionId, get().historyMessagesBySession[sessionId] ?? []);
      return newerEnvelopes.length > 0;
    } catch (error) {
      const currentState = get();
      const hasSameWindow = hasSameConversationWindowIdentity(currentState.conversationViewBySession[sessionId], originatingView);
      const hasSameCursor = currentState.conversationPageInfoBySession[sessionId]?.newerCursor === cursor;
      if (callVersion !== activeConversationVersionRef.current || !hasSameWindow || !hasSameCursor) {
        return false;
      }
      const message = error instanceof Error ? error.message : 'Failed to load newer messages.';
      get().setConversationPageInfo(sessionId, {
        isLoadingNewer: false,
        newerLoadError: message,
      });
      return false;
    }
  },

  completeAnchoredConversation: (sessionId, expectedAnchorMessageId) => {
    const olderAbortController = olderConversationAbortControllers.get(sessionId);
    let completed = false;
    set((state) => {
      const currentView = state.conversationViewBySession[sessionId];
      const pageInfo = state.conversationPageInfoBySession[sessionId];
      if (currentView?.mode !== 'anchored' || currentView.activeAnchorMessageId !== expectedAnchorMessageId || pageInfo?.newerCursor !== null) {
        return state;
      }
      completed = true;
      return {
        conversationViewBySession: {
          ...state.conversationViewBySession,
          [sessionId]: {
            mode: 'recent',
            activeAnchorMessageId: null,
            newMessagesWhileAnchored: false,
          },
        },
        ...(olderAbortController
          ? {
              conversationPageInfoBySession: {
                ...state.conversationPageInfoBySession,
                [sessionId]: {
                  ...pageInfo,
                  isLoadingOlder: false,
                },
              },
            }
          : {}),
      };
    });
    if (completed && olderAbortController && olderConversationAbortControllers.get(sessionId) === olderAbortController) {
      olderConversationAbortControllers.delete(sessionId);
      olderAbortController.abort();
    }
    return completed;
  },

  clearForkNotice: (sessionId) => {
    set((state) => {
      if (state.forkNoticeBySession[sessionId] === undefined) {
        return state;
      }
      const { [sessionId]: _forkNotice, ...remainingForkNotices } = state.forkNoticeBySession;
      return { forkNoticeBySession: remainingForkNotices };
    });
  },

  updateAutomaticProcessHistoryTargets: (sessionId, targets) => {
    getAutomaticProcessHistoryTargetSettler(sessionId).update(targets);
  },

  setExplicitProcessHistoryTarget: (sessionId, sourceKey, target) => {
    const current = new Map(explicitProcessHistoryTargetsBySession.get(sessionId) ?? []);
    if (target === null) {
      current.delete(sourceKey);
    } else {
      const generation = nextProcessHistoryGeneration(sessionId);
      current.set(sourceKey, { ...target, generation });
      set((state) => ({
        processHistoryLoadVersionBySession: {
          ...state.processHistoryLoadVersionBySession,
          [sessionId]: generation,
        },
      }));
    }
    if (current.size === 0) {
      explicitProcessHistoryTargetsBySession.delete(sessionId);
    } else {
      explicitProcessHistoryTargetsBySession.set(sessionId, current);
    }
    publishProcessHistoryTargets(sessionId);
  },

  retryRunProcessHistory: (sessionId, runId) => {
    const state = get();
    if (state.processHistoryBySession[sessionId]?.[runId]?.status !== 'FAILED') {
      return;
    }
    const rootMessageId = Object.entries(state.displayProcessRunByRootBySession[sessionId] ?? {}).find(
      ([, displayRunId]) => displayRunId === runId,
    )?.[0];
    if (!rootMessageId) {
      return;
    }
    const generation = nextProcessHistoryGeneration(sessionId);
    const explicit = new Map(explicitProcessHistoryTargetsBySession.get(sessionId) ?? []);
    const sourceKey = `retry:${runId}`;
    const target: ProcessHistoryTarget = {
      sessionId,
      rootMessageId,
      runId,
      priority: 'EXPLICIT',
      generation,
      distanceFromViewportCenter: 0,
    };
    explicit.set(sourceKey, target);
    explicitProcessHistoryTargetsBySession.set(sessionId, explicit);
    set((current) => ({
      processHistoryLoadVersionBySession: {
        ...current.processHistoryLoadVersionBySession,
        [sessionId]: generation,
      },
    }));
    if (!getProcessHistoryScheduler(sessionId).retry(target)) {
      explicit.delete(sourceKey);
      if (explicit.size === 0) {
        explicitProcessHistoryTargetsBySession.delete(sessionId);
      }
    }
  },

  clearConversation: (sessionId) => {
    olderConversationAbortControllers.get(sessionId)?.abort();
    olderConversationAbortControllers.delete(sessionId);
    processHistorySchedulers.get(sessionId)?.clear();
    processHistorySchedulers.delete(sessionId);
    automaticProcessHistoryTargetsBySession.delete(sessionId);
    explicitProcessHistoryTargetsBySession.delete(sessionId);
    processHistoryGenerationBySession.delete(sessionId);
    set((state) => {
      const { [sessionId]: _history, ...remainingHistory } = state.historyEnvelopesBySession;
      const { [sessionId]: _activeLive, ...remainingActiveLive } = state.activeLiveBySession;
      const { [sessionId]: _settledLive, ...remainingSettledLive } = state.settledLiveBySession;
      const { [sessionId]: _nextLiveOrdinal, ...remainingNextLiveOrdinal } = state.nextLiveOrdinalBySession;
      const { [sessionId]: _historyMessages, ...remainingHistoryMessages } = state.historyMessagesBySession;
      const { [sessionId]: _processHistory, ...remainingProcessHistory } = state.processHistoryBySession;
      const { [sessionId]: _displayProcessRuns, ...remainingDisplayProcessRuns } = state.displayProcessRunByRootBySession;
      const { [sessionId]: _processVersion, ...remainingProcessVersions } = state.processHistoryLoadVersionBySession;
      const { [sessionId]: _forkNotice, ...remainingForkNotices } = state.forkNoticeBySession;
      const { [sessionId]: _preview, ...remainingPreview } = state.conversationPreviewBySession;
      const { [sessionId]: __, ...remainingLoadState } = state.conversationLoadStateBySession;
      const { [sessionId]: ___, ...remainingPageInfo } = state.conversationPageInfoBySession;
      const { [sessionId]: ____, ...remainingRuntime } = state.runtimeBySession;
      const { [sessionId]: _____, ...remainingView } = state.conversationViewBySession;
      return {
        historyEnvelopesBySession: remainingHistory,
        activeLiveBySession: remainingActiveLive,
        settledLiveBySession: remainingSettledLive,
        nextLiveOrdinalBySession: remainingNextLiveOrdinal,
        historyMessagesBySession: remainingHistoryMessages,
        processHistoryBySession: remainingProcessHistory,
        displayProcessRunByRootBySession: remainingDisplayProcessRuns,
        processHistoryLoadVersionBySession: remainingProcessVersions,
        forkNoticeBySession: remainingForkNotices,
        conversationPreviewBySession: remainingPreview,
        conversationLoadStateBySession: remainingLoadState,
        conversationPageInfoBySession: remainingPageInfo,
        conversationViewBySession: remainingView,
        runtimeBySession: remainingRuntime,
        sessionAccessOrder: state.sessionAccessOrder.filter((id) => id !== sessionId),
      };
    });
  },
}));

useConversationStore.subscribe((state, previous) => {
  const retained = new Set(state.sessionAccessOrder);
  for (const sessionId of previous.sessionAccessOrder) {
    if (!retained.has(sessionId)) {
      disposeProcessHistorySession(sessionId);
    }
  }
});

export const useActiveSessionHistoryEnvelopes = () => {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  return useConversationStore((s) =>
    activeSessionId
      ? (s.historyEnvelopesBySession[activeSessionId] ?? EMPTY_ACTIVE_SESSION_HISTORY_ENVELOPES)
      : EMPTY_ACTIVE_SESSION_HISTORY_ENVELOPES,
  );
};

export const useActiveSessionHistoryMessages = () => {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  return useConversationStore((s) =>
    activeSessionId ? (s.historyMessagesBySession[activeSessionId] ?? EMPTY_ACTIVE_SESSION_HISTORY_MESSAGES) : EMPTY_ACTIVE_SESSION_HISTORY_MESSAGES,
  );
};

export const useActiveSessionRuntimeState = () => {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  return useConversationStore((s) =>
    activeSessionId ? (s.runtimeBySession[activeSessionId] ?? DEFAULT_ACTIVE_SESSION_RUNTIME_STATE) : DEFAULT_ACTIVE_SESSION_RUNTIME_STATE,
  );
};

export const useIsStreaming = () => useConversationStore((s) => s.isStreaming);
export const useConversationError = () => useConversationStore((s) => s.conversationError);
export const useActiveStreamConnectionState = () => {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  const runtimeState = useConversationStore((s) => (activeSessionId ? s.runtimeBySession[activeSessionId] : undefined));
  return runtimeState ? connectionStateFromRuntime(runtimeState) : DEFAULT_ACTIVE_STREAM_CONNECTION_STATE;
};

export const useActiveConversationLoadState = () => {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  return useConversationStore((s) => (activeSessionId ? (s.conversationLoadStateBySession[activeSessionId] ?? 'idle') : 'idle'));
};

export const getActiveConversationLoadState = () => {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  if (!activeSessionId) {
    return 'idle';
  }
  return useConversationStore.getState().conversationLoadStateBySession[activeSessionId] ?? 'idle';
};
