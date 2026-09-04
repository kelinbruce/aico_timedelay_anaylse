import type { RunStatus, RuntimeActiveRunSummary, SessionConversationMessage, StreamEnvelope, TurnBlock } from '../../../state/contracts.ts';
import { conversationMessagesToHistoryEnvelopes, getConversationMessageRootMessageId } from '../adapters/conversationAdapter.ts';
import { getEnvelopeRootMessageId } from '../utils/streamingHelpers.ts';
import { buildHistoricalTurnBlocks, overlayLiveTurnBlocks, overlaySettledTurnBlocks } from '../utils/buildTurnBlocks.ts';

const IN_FLIGHT_RUN_STATUSES = new Set<RunStatus>(['ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING']);
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['COMPLETED', 'FAILED', 'CANCELED']);

export interface SessionProjection {
  readonly historyEnvelopes: readonly StreamEnvelope[];
  readonly settledEnvelopes: readonly StreamEnvelope[];
  readonly activeEnvelopes: readonly StreamEnvelope[];
  readonly historicalTurnBlocks: readonly TurnBlock[];
  readonly turnBlocks: readonly TurnBlock[];
}

export type SessionSettledProjection = Omit<SessionProjection, 'activeEnvelopes'>;

export type SessionHistoryProjection = Pick<SessionProjection, 'historyEnvelopes' | 'historicalTurnBlocks'> & {
  readonly hasVisibleHistoryMessages: boolean;
  readonly hiddenRootMessageIds: ReadonlySet<string>;
};

interface BuildSessionProjectionParams {
  readonly historyMessages: readonly SessionConversationMessage[];
  readonly historyEnvelopes: readonly StreamEnvelope[];
  readonly settledEnvelopes?: readonly StreamEnvelope[];
  readonly activeEnvelopes: readonly StreamEnvelope[];
  readonly includeLiveOnlyRoots?: boolean;
  readonly activeRun?: RuntimeActiveRunSummary | null;
  readonly latestPersistedRunStatus?: RunStatus | null;
  readonly displayRunByRoot?: Readonly<Record<string, string | undefined>>;
  readonly pendingRetryRootMessageId?: string | null;
}

type BuildSessionHistoryProjectionParams = Pick<BuildSessionProjectionParams, 'historyMessages' | 'historyEnvelopes' | 'displayRunByRoot'>;

type OverlaySessionLiveProjectionParams = Pick<
  BuildSessionProjectionParams,
  'settledEnvelopes' | 'activeEnvelopes' | 'includeLiveOnlyRoots' | 'activeRun' | 'latestPersistedRunStatus' | 'pendingRetryRootMessageId'
> & {
  readonly historyProjection: SessionHistoryProjection;
};

type BuildSessionSettledProjectionParams = Omit<OverlaySessionLiveProjectionParams, 'activeEnvelopes' | 'pendingRetryRootMessageId'>;

type OverlaySessionActiveProjectionParams = Pick<
  BuildSessionProjectionParams,
  'activeEnvelopes' | 'includeLiveOnlyRoots' | 'activeRun' | 'latestPersistedRunStatus' | 'pendingRetryRootMessageId'
> & {
  readonly historyProjection: SessionHistoryProjection;
  readonly settledProjection: SessionSettledProjection;
};

function attachDisplayRuns(blocks: readonly TurnBlock[], displayRunByRoot?: Readonly<Record<string, string | undefined>>): readonly TurnBlock[] {
  if (!displayRunByRoot) {
    return blocks;
  }
  let nextBlocks: TurnBlock[] | null = null;
  blocks.forEach((block, index) => {
    const displayRunId = displayRunByRoot[block.rootMessageId];
    if (!displayRunId || block.displayRunId === displayRunId) {
      return;
    }
    nextBlocks ??= [...blocks];
    nextBlocks[index] = { ...block, displayRunId };
  });
  return nextBlocks ?? blocks;
}

function overlayDerivedHistoryEnvelopes(
  baseHistoryEnvelopes: readonly StreamEnvelope[],
  overlayHistoryEnvelopes: readonly StreamEnvelope[],
): readonly StreamEnvelope[] {
  if (baseHistoryEnvelopes.length === 0) {
    return overlayHistoryEnvelopes;
  }
  if (overlayHistoryEnvelopes.length === 0) {
    return baseHistoryEnvelopes;
  }

  const overlayByEventId = new Map(overlayHistoryEnvelopes.map((envelope) => [envelope.eventId, envelope] as const));
  const mergedHistoryEnvelopes = baseHistoryEnvelopes.map((envelope) => overlayByEventId.get(envelope.eventId) ?? envelope);
  const knownEventIds = new Set(baseHistoryEnvelopes.map((envelope) => envelope.eventId));
  const overlayOnlyEnvelopes = overlayHistoryEnvelopes.filter((envelope) => !knownEventIds.has(envelope.eventId));
  return [...mergedHistoryEnvelopes, ...overlayOnlyEnvelopes];
}

function settleLatestHistoryBlockWhenNoActiveRun(
  blocks: readonly TurnBlock[],
  activeRun: RuntimeActiveRunSummary | null | undefined,
  hasVisibleHistoryMessages: boolean,
  hasLiveEnvelopes: boolean,
): readonly TurnBlock[] {
  if (activeRun !== null || !hasVisibleHistoryMessages || hasLiveEnvelopes || blocks.length === 0) {
    return blocks;
  }

  const latestBlock = blocks[blocks.length - 1]!;
  if (latestBlock.aiEvents.length === 0 || !IN_FLIGHT_RUN_STATUSES.has(latestBlock.status)) {
    return blocks;
  }

  // Do not fabricate COMPLETED when the terminal event is missing from history.
  // The run might have FAILED or been CANCELED; fabricating COMPLETED violates
  // ts-run-status-visibility ("MUST NOT output fake completed"). The block
  // stays in its current in-flight status; a conversation refresh or live
  // stream terminal event will eventually provide the correct status.
  return blocks;
}

function readHiddenRootMessageIds(
  historyMessages: readonly SessionConversationMessage[],
  historyEnvelopes: readonly StreamEnvelope[],
): ReadonlySet<string> {
  const hiddenRoots = new Set<string>();
  for (const message of historyMessages) {
    if (message.visible === false) {
      hiddenRoots.add(getConversationMessageRootMessageId(message));
    }
  }
  for (const envelope of historyEnvelopes) {
    if ((envelope.payload as Record<string, unknown>).visible === false) {
      hiddenRoots.add(getEnvelopeRootMessageId(envelope));
    }
  }
  return hiddenRoots;
}

export function buildSessionHistoryProjection({
  historyMessages,
  historyEnvelopes,
  displayRunByRoot,
}: BuildSessionHistoryProjectionParams): SessionHistoryProjection {
  const derivedHistoryEnvelopes = historyMessages.length > 0 ? conversationMessagesToHistoryEnvelopes(historyMessages) : [];
  const resolvedHistoryEnvelopes =
    derivedHistoryEnvelopes.length > 0 ? overlayDerivedHistoryEnvelopes(derivedHistoryEnvelopes, historyEnvelopes) : historyEnvelopes;
  const hiddenRootMessageIds = readHiddenRootMessageIds(historyMessages, resolvedHistoryEnvelopes);
  const forkInheritedRootIds = readForkInheritedRootMessageIds(historyMessages);
  const historicalTurnBlocks = attachDisplayRuns(buildHistoricalTurnBlocks(resolvedHistoryEnvelopes), displayRunByRoot).map((block) =>
    forkInheritedRootIds.has(block.rootMessageId) ? { ...block, forkInherited: true } : block,
  );

  return {
    historyEnvelopes: resolvedHistoryEnvelopes,
    historicalTurnBlocks,
    hasVisibleHistoryMessages: historyMessages.some((message) => message.visible !== false),
    hiddenRootMessageIds,
  };
}

function readForkInheritedRootMessageIds(historyMessages: readonly SessionConversationMessage[]): ReadonlySet<string> {
  const rootIds = new Set<string>();
  for (const message of historyMessages) {
    if (message.metadata?.['forkInherited'] === true) {
      rootIds.add(message.rootMessageId ?? message.requestId ?? message.messageId);
    }
  }
  return rootIds;
}

function applyLatestHistoryBlockStatus(blocks: readonly TurnBlock[], latestPersistedRunStatus?: RunStatus | null): readonly TurnBlock[] {
  const latestBlock = blocks[blocks.length - 1];
  if (!latestBlock) {
    return blocks;
  }

  const latestStatus = TERMINAL_RUN_STATUSES.has(latestBlock.status)
    ? latestBlock.status
    : latestPersistedRunStatus && TERMINAL_RUN_STATUSES.has(latestPersistedRunStatus)
      ? latestPersistedRunStatus
      : latestBlock.status;
  if (latestStatus === latestBlock.status) {
    return blocks;
  }

  return [
    ...blocks.slice(0, -1),
    {
      ...latestBlock,
      status: latestStatus,
    },
  ];
}

function suppressHiddenRoots(envelopes: readonly StreamEnvelope[], hiddenRootMessageIds: ReadonlySet<string>): readonly StreamEnvelope[] {
  if (hiddenRootMessageIds.size === 0) {
    return envelopes;
  }
  return envelopes.filter((envelope) => !hiddenRootMessageIds.has(getEnvelopeRootMessageId(envelope)));
}

function suppressPendingRetryAttempt(blocks: readonly TurnBlock[], pendingRetryRootMessageId?: string | null): readonly TurnBlock[] {
  if (!pendingRetryRootMessageId) {
    return blocks;
  }
  return blocks.map((block) => (block.rootMessageId === pendingRetryRootMessageId && block.aiEvents.length > 0 ? { ...block, aiEvents: [] } : block));
}

export function buildSessionSettledProjection({
  historyProjection,
  settledEnvelopes = [],
  includeLiveOnlyRoots = true,
  activeRun,
  latestPersistedRunStatus,
}: BuildSessionSettledProjectionParams): SessionSettledProjection {
  const visibleSettledEnvelopes = suppressHiddenRoots(settledEnvelopes, historyProjection.hiddenRootMessageIds);
  const latestRunStatus = activeRun?.status ?? latestPersistedRunStatus;
  const historicalTurnBlocks = settleLatestHistoryBlockWhenNoActiveRun(
    applyLatestHistoryBlockStatus(historyProjection.historicalTurnBlocks, latestRunStatus),
    activeRun,
    historyProjection.hasVisibleHistoryMessages,
    visibleSettledEnvelopes.length > 0,
  );

  return {
    historyEnvelopes: historyProjection.historyEnvelopes,
    settledEnvelopes: visibleSettledEnvelopes,
    historicalTurnBlocks,
    turnBlocks: overlaySettledTurnBlocks(historicalTurnBlocks, visibleSettledEnvelopes, latestRunStatus, includeLiveOnlyRoots),
  };
}

export function overlaySessionActiveProjection({
  historyProjection,
  settledProjection,
  activeEnvelopes,
  includeLiveOnlyRoots = true,
  activeRun,
  latestPersistedRunStatus,
  pendingRetryRootMessageId,
}: OverlaySessionActiveProjectionParams): SessionProjection {
  const visibleActiveEnvelopes = suppressHiddenRoots(activeEnvelopes, historyProjection.hiddenRootMessageIds);
  const turnBlocks = overlayLiveTurnBlocks(
    suppressPendingRetryAttempt(settledProjection.turnBlocks, pendingRetryRootMessageId),
    visibleActiveEnvelopes,
    activeRun?.status ?? latestPersistedRunStatus,
    includeLiveOnlyRoots,
  );
  return {
    ...settledProjection,
    activeEnvelopes: visibleActiveEnvelopes,
    turnBlocks,
  };
}

export function overlaySessionLiveProjection(params: OverlaySessionLiveProjectionParams): SessionProjection {
  const settledProjection = buildSessionSettledProjection({
    historyProjection: params.historyProjection,
    settledEnvelopes: params.settledEnvelopes ?? [],
    ...(params.includeLiveOnlyRoots !== undefined ? { includeLiveOnlyRoots: params.includeLiveOnlyRoots } : {}),
    ...(params.activeRun !== undefined ? { activeRun: params.activeRun } : {}),
    ...(params.latestPersistedRunStatus !== undefined ? { latestPersistedRunStatus: params.latestPersistedRunStatus } : {}),
  });
  return overlaySessionActiveProjection({
    historyProjection: params.historyProjection,
    settledProjection,
    activeEnvelopes: params.activeEnvelopes,
    ...(params.includeLiveOnlyRoots !== undefined ? { includeLiveOnlyRoots: params.includeLiveOnlyRoots } : {}),
    ...(params.activeRun !== undefined ? { activeRun: params.activeRun } : {}),
    ...(params.latestPersistedRunStatus !== undefined ? { latestPersistedRunStatus: params.latestPersistedRunStatus } : {}),
    ...(params.pendingRetryRootMessageId !== undefined ? { pendingRetryRootMessageId: params.pendingRetryRootMessageId } : {}),
  });
}

export function buildSessionProjection(params: BuildSessionProjectionParams): SessionProjection {
  const historyProjection = buildSessionHistoryProjection({
    historyMessages: params.historyMessages,
    historyEnvelopes: params.historyEnvelopes,
    ...(params.displayRunByRoot !== undefined ? { displayRunByRoot: params.displayRunByRoot } : {}),
  });
  return overlaySessionLiveProjection({
    historyProjection,
    settledEnvelopes: params.settledEnvelopes ?? [],
    activeEnvelopes: params.activeEnvelopes,
    ...(params.includeLiveOnlyRoots !== undefined ? { includeLiveOnlyRoots: params.includeLiveOnlyRoots } : {}),
    ...(params.activeRun !== undefined ? { activeRun: params.activeRun } : {}),
    ...(params.latestPersistedRunStatus !== undefined ? { latestPersistedRunStatus: params.latestPersistedRunStatus } : {}),
    ...(params.pendingRetryRootMessageId !== undefined ? { pendingRetryRootMessageId: params.pendingRetryRootMessageId } : {}),
  });
}
