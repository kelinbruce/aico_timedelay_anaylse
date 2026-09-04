import type { StreamEnvelope, TurnBlock, RunStatus, SyntheticUserMessage, StreamEventType } from '../../../state/contracts';
import { buildInputSegmentByEnvelope, getEnvelopeAttemptId, getEnvelopeRootMessageId } from './streamingHelpers';
import { toTimestampMillis } from '../../../utils/time.ts';
import { isAccumulatedThinkingEnvelope, isCompletedThinkingEnvelope, readThinkingStepIdentity } from './thinkingStepIdentity.ts';

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED']);
const LOCAL_OPTIMISTIC_HINT = 'local-optimistic';
const IN_FLIGHT_RUN_STATUSES = new Set<RunStatus>(['ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING']);

const TERMINAL_EVENTS: Set<StreamEventType> = new Set([
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);
const FORKABLE_ASSISTANT_EVENT_TYPES: Set<StreamEventType> = new Set(['LLM_CONTENT_DELTA', 'REQUEST_COMPLETED']);

const ORPHAN_ONLY_EVENT_TYPES: Set<StreamEventType> = new Set(['REQUEST_ACCEPTED', 'DEGRADATION_NOTICE', 'CONTEXT_COMPACTED', 'HOOK_DEGRADED']);

function isUserMessageEnvelope(env: StreamEnvelope): boolean {
  return (env.payload as any)?.role === 'USER';
}

function isLocalOptimisticEnvelope(env: StreamEnvelope): boolean {
  return env.transportHints.includes(LOCAL_OPTIMISTIC_HINT);
}

function shouldIgnoreTurnEnvelope(env: StreamEnvelope): boolean {
  if (!env.requestId) {
    return true;
  }
  if ((env.payload as any)?.visible === false) {
    return true;
  }
  return false;
}

function hasOnlyOrphanRuntimeEvents(events: readonly StreamEnvelope[]): boolean {
  return events.length > 0 && events.every((event) => ORPHAN_ONLY_EVENT_TYPES.has(event.eventType));
}

function getRootMessageId(env: StreamEnvelope): string {
  return getEnvelopeRootMessageId(env);
}

function compareEnvelopesChronologically(left: StreamEnvelope, right: StreamEnvelope): number {
  const leftCreatedAt = toTimestampMillis(left.createdAt);
  const rightCreatedAt = toTimestampMillis(right.createdAt);
  const leftHasCreatedAt = !Number.isNaN(leftCreatedAt);
  const rightHasCreatedAt = !Number.isNaN(rightCreatedAt);

  if (leftHasCreatedAt && rightHasCreatedAt && leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  if (leftHasCreatedAt !== rightHasCreatedAt) {
    return leftHasCreatedAt ? -1 : 1;
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.eventId.localeCompare(right.eventId);
}

function resolveUserEnvelopeStatus(userEnvelope?: StreamEnvelope): RunStatus | null {
  const rawStatus = (userEnvelope?.payload as any)?.status;
  if (typeof rawStatus !== 'string') {
    return null;
  }

  const normalizedStatus = rawStatus.trim().toUpperCase();
  if (normalizedStatus === 'COMPLETED' || normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELED' || normalizedStatus === 'SUPERSEDED') {
    return normalizedStatus;
  }
  if (normalizedStatus === 'ACCEPTED' || normalizedStatus === 'QUEUED' || normalizedStatus === 'PLANNING' || normalizedStatus === 'EXECUTING') {
    return normalizedStatus;
  }
  return null;
}

function resolveStatus(userEnvelope: StreamEnvelope | undefined, aiEvents: readonly StreamEnvelope[]): RunStatus {
  // OUTPUT_GUARD_BLOCKED takes priority over a coexisting runtime terminal.
  // The guard layer's block is a client-stream terminal signal that does NOT
  // replace the runtime terminal (see openspec `refine-stream-guard-blocked-event`
  // 决策 2): the run may keep running and emit REQUEST_COMPLETED/CANCELED AFTER
  // the block. Scanning only from the end would let that trailing runtime
  // terminal mask the block, so check for the block anywhere in the attempt.
  if (aiEvents.some((evt) => evt.eventType === 'OUTPUT_GUARD_BLOCKED')) {
    return 'CANCELED';
  }
  for (let i = aiEvents.length - 1; i >= 0; i--) {
    const evt = aiEvents[i];
    if (!evt) {
      continue;
    }
    if (TERMINAL_EVENTS.has(evt.eventType)) {
      if (evt.eventType === 'REQUEST_COMPLETED') {
        return 'COMPLETED';
      }
      if (evt.eventType === 'REQUEST_FAILED') {
        // Defensive: a cancel-category REQUEST_FAILED is treated as CANCELED.
        // The current backend commits cancel as REQUEST_CANCELED, but a future
        // DEGRADATION_NOTICE carrying category=CANCELED could produce this path.
        if ((evt.payload as { category?: string })?.category === 'CANCELED') {
          return 'CANCELED';
        }
        return 'FAILED';
      }
      if (evt.eventType === 'REQUEST_CANCELED') {
        return 'CANCELED';
      }
      if (evt.eventType === 'REQUEST_SUPERSEDED') {
        return 'SUPERSEDED';
      }
      if (evt.eventType === 'OUTPUT_GUARD_BLOCKED') {
        return 'CANCELED';
      }
    }
  }
  const userEnvelopeStatus = resolveUserEnvelopeStatus(userEnvelope);
  if (userEnvelopeStatus && (TERMINAL_RUN_STATUSES.has(userEnvelopeStatus) || IN_FLIGHT_RUN_STATUSES.has(userEnvelopeStatus))) {
    return userEnvelopeStatus;
  }
  if (aiEvents.length > 0) {
    return 'EXECUTING';
  }
  if (userEnvelope) {
    return 'EXECUTING';
  }
  return 'COMPLETED';
}

function buildSyntheticUserMessage(rootId: string, userMsgEnv?: StreamEnvelope, fallbackEnvelope?: StreamEnvelope): SyntheticUserMessage {
  const payload = userMsgEnv?.payload as
    | {
        content?: string;
        targetSkill?: string;
        metadata?: { targetSkill?: string; routingConstraints?: { targetSkill?: string } };
        attachments?: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>;
      }
    | undefined;
  const targetSkill = payload?.targetSkill ?? payload?.metadata?.targetSkill ?? payload?.metadata?.routingConstraints?.targetSkill;
  return {
    messageId: rootId,
    sessionId: userMsgEnv?.sessionId || fallbackEnvelope?.sessionId || '',
    content: payload?.content || '',
    createdAt: userMsgEnv?.createdAt || fallbackEnvelope?.createdAt || '',
    visible: true,
    ...(targetSkill === undefined ? {} : { targetSkill }),
    ...(payload?.attachments && payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Preserve the directive-derived targetSkill across live overlay rebuilds.
 * The backend user envelope carries the stripped (possibly empty) content but
 * not the targetSkill, so once the real envelope arrives we would lose the
 * placeholder anchor. Inherit it from the previous user message when the new
 * synthetic message does not carry one.
 */
function mergeTargetSkill(next: SyntheticUserMessage, previous: TurnBlock['userMessage']): SyntheticUserMessage {
  if (next.targetSkill !== undefined) {
    return next;
  }
  const inherited = (previous as { targetSkill?: string }).targetSkill;
  return inherited === undefined ? next : { ...next, targetSkill: inherited };
}

function readAssistantAnchorMessageId(aiEvents: readonly StreamEnvelope[]): string | undefined {
  for (let index = aiEvents.length - 1; index >= 0; index -= 1) {
    const event = aiEvents[index];
    if (!event || !FORKABLE_ASSISTANT_EVENT_TYPES.has(event.eventType) || !event.transportHints.includes('history-load')) {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (payload.role !== 'ASSISTANT' || payload.visible === false) {
      continue;
    }
    const messageId = readString(payload.messageId);
    const content = readString(payload.content) ?? readString(payload.text);
    if (messageId && content) {
      return messageId;
    }
  }
  return undefined;
}

function applyAssistantAnchor(block: TurnBlock, aiEvents: readonly StreamEnvelope[]): TurnBlock {
  const { assistantAnchorMessageId: _previousAnchor, ...withoutAnchor } = block;
  const assistantAnchorMessageId = readAssistantAnchorMessageId(aiEvents);
  return assistantAnchorMessageId ? { ...withoutAnchor, assistantAnchorMessageId } : withoutAnchor;
}

function deduplicateTurnEnvelopes(envelopes: readonly StreamEnvelope[]): StreamEnvelope[] {
  // Segment thinking envelopes by USER_INPUT_RECEIVED boundaries so that
  // pre-input and post-input thinking deltas sharing the same stepId are
  // not deduplicated against each other. This handles the resume scenario
  // where a WORKFLOW_NODE pending input (checkpointTrigger=STEP_STARTED)
  // causes the model to re-execute the same round, producing thinking
  // deltas with an identical stepId.
  const inputSegmentByEnvelope = buildInputSegmentByEnvelope(envelopes);

  const canonicalThinkingByStep = new Map<string, StreamEnvelope>();
  for (let i = 0; i < envelopes.length; i++) {
    const envelope = envelopes[i]!;
    const stepIdentity = readThinkingStepIdentity(envelope);
    if (stepIdentity === null || !isAccumulatedThinkingEnvelope(envelope)) {
      continue;
    }
    const segmentedIdentity = `${stepIdentity}\u0000${inputSegmentByEnvelope.get(envelope) ?? 0}`;
    const current = canonicalThinkingByStep.get(segmentedIdentity);
    if (current === undefined) {
      canonicalThinkingByStep.set(segmentedIdentity, envelope);
      continue;
    }
    if (isCompletedThinkingEnvelope(current)) {
      continue;
    }
    if (isCompletedThinkingEnvelope(envelope) || compareEnvelopesChronologically(current, envelope) <= 0) {
      canonicalThinkingByStep.set(segmentedIdentity, envelope);
    }
  }

  const seen = new Set<string>();
  const deduplicated: StreamEnvelope[] = [];
  for (let i = 0; i < envelopes.length; i++) {
    const envelope = envelopes[i]!;
    const stepIdentity = readThinkingStepIdentity(envelope);
    if (stepIdentity !== null) {
      const segmentedIdentity = `${stepIdentity}\u0000${inputSegmentByEnvelope.get(envelope) ?? 0}`;
      if (canonicalThinkingByStep.has(segmentedIdentity) && canonicalThinkingByStep.get(segmentedIdentity) !== envelope) {
        continue;
      }
    }
    const attemptId = getEnvelopeAttemptId(envelope);
    const key = envelope.eventId || `${attemptId}:${envelope.sequence}:${envelope.eventType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduplicated.push(envelope);
  }
  return deduplicated;
}

function getAttemptSelectionKey(envelope: StreamEnvelope): string {
  const payload = envelope.payload as Record<string, unknown>;
  const runId = readString(envelope.runId) ?? readString(payload.runId);
  return runId ? `run:${runId}` : `attempt:${getEnvelopeAttemptId(envelope)}`;
}

function selectLatestAttemptEvents(aiEvents: readonly StreamEnvelope[]): StreamEnvelope[] {
  if (aiEvents.length === 0) {
    return [];
  }

  const eventsByAttempt = new Map<string, StreamEnvelope[]>();
  const firstEventByAttempt = new Map<string, StreamEnvelope>();
  const startEventByAttempt = new Map<string, StreamEnvelope>();

  for (const event of aiEvents) {
    const attemptId = getAttemptSelectionKey(event);
    if (!eventsByAttempt.has(attemptId)) {
      eventsByAttempt.set(attemptId, []);
    }
    eventsByAttempt.get(attemptId)!.push(event);

    const firstEvent = firstEventByAttempt.get(attemptId);
    if (!firstEvent || compareEnvelopesChronologically(event, firstEvent) < 0) {
      firstEventByAttempt.set(attemptId, event);
    }

    if (event.eventType === 'REQUEST_ACCEPTED') {
      const currentStartEvent = startEventByAttempt.get(attemptId);
      if (!currentStartEvent || compareEnvelopesChronologically(currentStartEvent, event) <= 0) {
        startEventByAttempt.set(attemptId, event);
      }
    }
  }

  let latestAttemptId: string | null = null;
  let latestMarker: StreamEnvelope | null = null;
  const orderedAttempts: Array<{ attemptId: string; marker: StreamEnvelope }> = [];
  for (const [attemptId, firstMarker] of firstEventByAttempt.entries()) {
    const marker = startEventByAttempt.get(attemptId) ?? firstMarker;
    orderedAttempts.push({ attemptId, marker });
    if (!latestMarker || compareEnvelopesChronologically(latestMarker, marker) <= 0) {
      latestMarker = marker;
      latestAttemptId = attemptId;
    }
  }

  if (!latestAttemptId) {
    return deduplicateTurnEnvelopes(aiEvents);
  }

  return deduplicateTurnEnvelopes(eventsByAttempt.get(latestAttemptId) ?? []);
}

function settleNonLatestExecutingBlocks(blocks: readonly TurnBlock[]): TurnBlock[] {
  if (blocks.length < 2) {
    return [...blocks];
  }

  const lastIndex = blocks.length - 1;
  return blocks.map((block, index) => {
    if (index === lastIndex) {
      return block;
    }
    if (!IN_FLIGHT_RUN_STATUSES.has(block.status)) {
      return block;
    }
    // Don't fabricate COMPLETED for blocks with AI events but no terminal event.
    // The run might have FAILED; fabricating COMPLETED violates ts-run-status-visibility.
    if (block.aiEvents.length > 0) {
      return block;
    }
    return {
      ...block,
      status: 'COMPLETED',
    };
  });
}

function applyLatestBlockStatus(blocks: readonly TurnBlock[], latestPersistedRunStatus?: RunStatus | null): TurnBlock[] {
  if (blocks.length === 0) {
    return [];
  }

  const lastIndex = blocks.length - 1;
  const lastBlock = blocks[lastIndex]!;
  const latestStatus = TERMINAL_RUN_STATUSES.has(lastBlock.status)
    ? lastBlock.status
    : latestPersistedRunStatus && TERMINAL_RUN_STATUSES.has(latestPersistedRunStatus)
      ? latestPersistedRunStatus
      : lastBlock.status;
  return blocks.map((block, index) => {
    const isLatest = index === lastIndex;
    const status = isLatest ? latestStatus : block.status;
    if (block.isLatest === isLatest && block.status === status) {
      return block;
    }
    return {
      ...block,
      status,
      isLatest,
    };
  });
}

function collectRootOrderedEnvelopes(envelopes: readonly StreamEnvelope[]): {
  readonly rootSeedEnvelopes: readonly StreamEnvelope[];
  readonly envelopesByRoot: ReadonlyMap<string, readonly StreamEnvelope[]>;
  readonly localOptimisticRoots: ReadonlyMap<string, StreamEnvelope>;
} {
  const historyRoots = new Map<string, StreamEnvelope>();
  const localOptimisticRoots = new Map<string, StreamEnvelope>();
  const envelopesByRoot = new Map<string, StreamEnvelope[]>();
  const seenEnvelopeIds = new Set<string>();

  const addEnvelope = (
    env: StreamEnvelope,
    targetByRoot: Map<string, StreamEnvelope[]>,
    allowOptimisticRoot = false,
    rootSeeds?: Map<string, StreamEnvelope>,
  ) => {
    if (shouldIgnoreTurnEnvelope(env)) {
      return;
    }

    const root = getRootMessageId(env);
    if (!targetByRoot.has(root)) {
      targetByRoot.set(root, []);
    }
    targetByRoot.get(root)!.push(env);

    if (rootSeeds && !rootSeeds.has(root)) {
      rootSeeds.set(root, env);
    }

    if (allowOptimisticRoot && isLocalOptimisticEnvelope(env) && isUserMessageEnvelope(env) && !localOptimisticRoots.has(root)) {
      localOptimisticRoots.set(root, env);
    }
  };

  for (const env of envelopes) {
    const envelopeId = env.eventId || `${env.requestId}-${env.sequence}`;
    if (seenEnvelopeIds.has(envelopeId)) {
      continue;
    }
    seenEnvelopeIds.add(envelopeId);
    addEnvelope(env, envelopesByRoot, true, historyRoots);
  }

  const rootSeedEnvelopes = [
    ...historyRoots.values(),
    ...[...localOptimisticRoots.entries()].filter(([rootId]) => !historyRoots.has(rootId)).map(([, envelope]) => envelope),
  ].sort(compareEnvelopesChronologically);

  return {
    rootSeedEnvelopes,
    envelopesByRoot,
    localOptimisticRoots,
  };
}

export function buildHistoricalTurnBlocks(history: readonly StreamEnvelope[], latestPersistedRunStatus?: RunStatus | null): TurnBlock[] {
  const { rootSeedEnvelopes, envelopesByRoot } = collectRootOrderedEnvelopes(history);

  const blocks: TurnBlock[] = [];
  const seenRoots = new Set<string>();

  for (const seedEnvelope of rootSeedEnvelopes) {
    const rootId = getRootMessageId(seedEnvelope);
    if (seenRoots.has(rootId)) {
      continue;
    }
    seenRoots.add(rootId);

    const historyRootEnvs = [...(envelopesByRoot.get(rootId) ?? [])].sort(compareEnvelopesChronologically);
    const userMsgEnv = historyRootEnvs.find(isUserMessageEnvelope);
    const latestVisibleAiEvents = selectLatestAttemptEvents(historyRootEnvs.filter((event) => !isUserMessageEnvelope(event)));
    if (!userMsgEnv && hasOnlyOrphanRuntimeEvents(latestVisibleAiEvents)) {
      continue;
    }

    blocks.push(
      applyAssistantAnchor(
        {
          rootMessageId: rootId,
          userMessage: buildSyntheticUserMessage(rootId, userMsgEnv, historyRootEnvs[0]),
          aiEvents: latestVisibleAiEvents,
          status: resolveStatus(userMsgEnv, latestVisibleAiEvents),
          isLatest: false,
        },
        latestVisibleAiEvents,
      ),
    );
  }

  return applyLatestBlockStatus(settleNonLatestExecutingBlocks(blocks), latestPersistedRunStatus);
}

function buildLiveOnlyTurnBlocks(liveEnvelopes: readonly StreamEnvelope[], latestPersistedRunStatus?: RunStatus | null): TurnBlock[] {
  const { rootSeedEnvelopes, envelopesByRoot } = collectRootOrderedEnvelopes(liveEnvelopes);
  const blocks: TurnBlock[] = [];

  for (const seedEnvelope of rootSeedEnvelopes) {
    const rootId = getRootMessageId(seedEnvelope);
    const liveRootEnvs = [...(envelopesByRoot.get(rootId) ?? [])];
    const userMsgEnv = liveRootEnvs.find(isUserMessageEnvelope);
    if (!userMsgEnv) {
      continue;
    }
    const latestVisibleAiEvents = selectLatestAttemptEvents(liveRootEnvs.filter((event) => !isUserMessageEnvelope(event)));
    blocks.push(
      applyAssistantAnchor(
        {
          rootMessageId: rootId,
          userMessage: buildSyntheticUserMessage(rootId, userMsgEnv, liveRootEnvs[0]),
          aiEvents: latestVisibleAiEvents,
          status: resolveStatus(userMsgEnv, latestVisibleAiEvents),
          isLatest: false,
        },
        latestVisibleAiEvents,
      ),
    );
  }

  return applyLatestBlockStatus(blocks, latestPersistedRunStatus);
}

function isCanonicalAssistantAnswerEvent(event: StreamEnvelope): boolean {
  return event.eventType === 'LLM_CONTENT_DELTA' && (event.payload as Record<string, unknown>).role !== 'CAPABILITY_RESULT';
}

function readCapabilityResultLane(event: StreamEnvelope): string | null {
  if (event.eventType !== 'CAPABILITY_RESULT_DELTA') {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : null;
  for (const candidate of [payload.toolCallId, payload.invocationId, metadata?.invocationId, payload.capabilityId, payload.contentRef]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function isCanonicalCapabilityResultEvent(event: StreamEnvelope): boolean {
  return event.eventType === 'CAPABILITY_RESULT_DELTA' && (event.payload as Record<string, unknown>).role === 'CAPABILITY_RESULT';
}

function selectDisplayAttemptEvents(events: readonly StreamEnvelope[], displayRunId?: string): readonly StreamEnvelope[] {
  return displayRunId
    ? deduplicateTurnEnvelopes(
        events.filter((event) => getAttemptSelectionKey(event) === `run:${displayRunId}` || getEnvelopeAttemptId(event) === displayRunId),
      )
    : selectLatestAttemptEvents(events);
}

function mergeHistoricalBlockWithSettledProcess(block: TurnBlock, settledAiEvents: readonly StreamEnvelope[]): TurnBlock {
  const historicalAiEvents = selectDisplayAttemptEvents(block.aiEvents, block.displayRunId);
  const hasHistoricalAssistantAnswer = historicalAiEvents.some(isCanonicalAssistantAnswerEvent);
  const historicalCapabilityResultLanes = new Set(
    historicalAiEvents
      .filter(isCanonicalCapabilityResultEvent)
      .map(readCapabilityResultLane)
      .filter((lane): lane is string => lane !== null),
  );
  const hasUnkeyedHistoricalCapabilityResult = historicalAiEvents.some(
    (event) => isCanonicalCapabilityResultEvent(event) && readCapabilityResultLane(event) === null,
  );
  const settledProcessEvents = selectDisplayAttemptEvents(settledAiEvents, block.displayRunId).filter((event) => {
    if (isCanonicalAssistantAnswerEvent(event)) {
      return !hasHistoricalAssistantAnswer;
    }
    if (!isCanonicalCapabilityResultEvent(event)) {
      return true;
    }
    const lane = readCapabilityResultLane(event);
    return lane === null ? !hasUnkeyedHistoricalCapabilityResult : !historicalCapabilityResultLanes.has(lane);
  });
  const mergedAiEvents = deduplicateTurnEnvelopes([...historicalAiEvents, ...settledProcessEvents]).sort(compareEnvelopesChronologically);
  if (mergedAiEvents.length === block.aiEvents.length && mergedAiEvents.every((event, index) => event === block.aiEvents[index])) {
    return block;
  }
  return applyAssistantAnchor(
    {
      ...block,
      aiEvents: mergedAiEvents,
      status: resolveStatus(undefined, mergedAiEvents),
      isLatest: false,
    },
    mergedAiEvents,
  );
}

function readBlockCreatedAtMillis(block: TurnBlock): number {
  return toTimestampMillis(block.userMessage.createdAt);
}

/**
 * Merge two chronologically-sorted block lists by `userMessage.createdAt`.
 *
 * `baseBlocks` (history) and `liveOnlyBlocks` (e.g. an in-flight optimistic
 * turn, or a rehydrated input-guard-blocked turn) are each already sorted. We
 * must interleave them by creation time rather than blindly appending the
 * live-only blocks at the end: input-guard-blocked turns are never persisted by
 * the backend, so after a page refresh they re-enter the live layer with their
 * original (possibly older) `createdAt`. Appending them unconditionally would
 * surface an older blocked turn as the latest message on the page. On a tie (or
 * when a timestamp can't be parsed) the history block wins, preserving the
 * pre-existing order for genuinely-new optimistic turns (whose `createdAt` is
 * the newest, so they still land last).
 */
function mergeLiveOnlyBlocksChronologically(baseBlocks: readonly TurnBlock[], liveOnlyBlocks: readonly TurnBlock[]): TurnBlock[] {
  if (liveOnlyBlocks.length === 0) {
    return [...baseBlocks];
  }

  const merged: TurnBlock[] = [];
  let baseIndex = 0;
  let liveIndex = 0;
  while (baseIndex < baseBlocks.length || liveIndex < liveOnlyBlocks.length) {
    const baseBlock = baseBlocks[baseIndex];
    const liveBlock = liveOnlyBlocks[liveIndex];
    if (baseBlock === undefined) {
      merged.push(liveBlock!);
      liveIndex += 1;
      continue;
    }
    if (liveBlock === undefined) {
      merged.push(baseBlock);
      baseIndex += 1;
      continue;
    }
    const baseMillis = readBlockCreatedAtMillis(baseBlock);
    const liveMillis = readBlockCreatedAtMillis(liveBlock);
    const liveIsOlder = !Number.isNaN(liveMillis) && (Number.isNaN(baseMillis) || liveMillis < baseMillis);
    if (liveIsOlder) {
      merged.push(liveBlock);
      liveIndex += 1;
    } else {
      merged.push(baseBlock);
      baseIndex += 1;
    }
  }
  return merged;
}

function appendLiveOnlyBlocks(
  baseBlocks: readonly TurnBlock[],
  liveEnvelopes: readonly StreamEnvelope[],
  latestPersistedRunStatus?: RunStatus | null,
): TurnBlock[] {
  const knownRoots = new Set(baseBlocks.map((block) => block.rootMessageId));
  const liveOnlyBlocks = buildLiveOnlyTurnBlocks(liveEnvelopes).filter((block) => !knownRoots.has(block.rootMessageId));
  if (liveOnlyBlocks.length === 0) {
    return applyLatestBlockStatus(baseBlocks, latestPersistedRunStatus);
  }
  return applyLatestBlockStatus(
    settleNonLatestExecutingBlocks(mergeLiveOnlyBlocksChronologically(baseBlocks, liveOnlyBlocks)),
    latestPersistedRunStatus,
  );
}

export function overlaySettledTurnBlocks(
  historicalBlocks: readonly TurnBlock[],
  settledEnvelopes: readonly StreamEnvelope[],
  latestPersistedRunStatus?: RunStatus | null,
  includeLiveOnlyRoots = true,
): TurnBlock[] {
  if (settledEnvelopes.length === 0) {
    return applyLatestBlockStatus(historicalBlocks, latestPersistedRunStatus);
  }
  if (historicalBlocks.length === 0) {
    return includeLiveOnlyRoots ? buildLiveOnlyTurnBlocks(settledEnvelopes, latestPersistedRunStatus) : [];
  }

  const { envelopesByRoot } = collectRootOrderedEnvelopes(settledEnvelopes);
  const nextBlocks = historicalBlocks.map((block) => {
    const settledAiEvents = [...(envelopesByRoot.get(block.rootMessageId) ?? [])].filter((event) => !isUserMessageEnvelope(event));
    return settledAiEvents.length > 0 ? mergeHistoricalBlockWithSettledProcess(block, settledAiEvents) : block;
  });
  return includeLiveOnlyRoots
    ? appendLiveOnlyBlocks(nextBlocks, settledEnvelopes, latestPersistedRunStatus)
    : applyLatestBlockStatus(nextBlocks, latestPersistedRunStatus);
}

export function overlayLiveTurnBlocks(
  historicalBlocks: readonly TurnBlock[],
  liveEnvelopes: readonly StreamEnvelope[],
  latestPersistedRunStatus?: RunStatus | null,
  includeLiveOnlyRoots = true,
): TurnBlock[] {
  if (historicalBlocks.length === 0) {
    return includeLiveOnlyRoots ? buildLiveOnlyTurnBlocks(liveEnvelopes, latestPersistedRunStatus) : [];
  }

  if (liveEnvelopes.length === 0) {
    return applyLatestBlockStatus(historicalBlocks, latestPersistedRunStatus);
  }

  const { envelopesByRoot } = collectRootOrderedEnvelopes(liveEnvelopes);
  const nextBlocks = historicalBlocks.map((block) => {
    const liveRootEnvs = [...(envelopesByRoot.get(block.rootMessageId) ?? [])];
    if (liveRootEnvs.length === 0) {
      return block;
    }

    const liveAiEvents = liveRootEnvs.filter((event) => !isUserMessageEnvelope(event));
    const liveUserEnv = liveRootEnvs.find(isUserMessageEnvelope);
    const latestVisibleAiEvents = selectDisplayAttemptEvents([...block.aiEvents, ...liveAiEvents], block.displayRunId);
    const syntheticUserMessage = liveUserEnv
      ? mergeTargetSkill(buildSyntheticUserMessage(block.rootMessageId, liveUserEnv, liveRootEnvs[0]), block.userMessage)
      : block.userMessage;
    // When the live user envelope is a local-optimistic placeholder whose
    // createdAt came from the browser clock, prefer the history block's
    // server-clock createdAt if one is already available.
    const resolvedUserMessage =
      liveUserEnv && isLocalOptimisticEnvelope(liveUserEnv) && block.userMessage.createdAt
        ? { ...syntheticUserMessage, createdAt: block.userMessage.createdAt }
        : syntheticUserMessage;

    return applyAssistantAnchor(
      {
        ...block,
        userMessage: resolvedUserMessage,
        aiEvents: latestVisibleAiEvents,
        status: resolveStatus(liveUserEnv, latestVisibleAiEvents),
        isLatest: false,
      },
      latestVisibleAiEvents,
    );
  });

  return includeLiveOnlyRoots
    ? appendLiveOnlyBlocks(nextBlocks, liveEnvelopes, latestPersistedRunStatus)
    : applyLatestBlockStatus(nextBlocks, latestPersistedRunStatus);
}

export function buildTurnBlocks(
  history: readonly StreamEnvelope[],
  liveEnvelopes: readonly StreamEnvelope[],
  latestPersistedRunStatus?: RunStatus | null,
): TurnBlock[] {
  const historicalBlocks = buildHistoricalTurnBlocks(history, latestPersistedRunStatus);
  return overlayLiveTurnBlocks(historicalBlocks, liveEnvelopes, latestPersistedRunStatus);
}
