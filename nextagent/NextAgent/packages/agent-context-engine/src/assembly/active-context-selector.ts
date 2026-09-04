import {
  AgentError,
  type AgentId,
  type IdentityContext,
  type JsonObject,
  type MessageId,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';

/**
 * Active-context-view selection policy: this module reads a single
 * ActiveContextViewRecord snapshot and never queries the full session
 * transcript. The constants below make that boundary explicit so that the
 * selection implementation cannot quietly reintroduce a full scan.
 */
export const activeContextSelectionPolicy = { source: 'active-context-view', scansFullHistory: false } as const;

/**
 * Code surfaced when an active-context ref cannot be resolved. Matches the
 * `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE` code thrown by the engine's
 * `loadOwnerMessages` wrapper, so callers see one stable code regardless of
 * whether the failure is a thrown gateway error or a missing returned record.
 */
const CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE = 'CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE';

/**
 * Read-only input to history selection. The selector reads the active context
 * snapshot provided here and never queries the full session transcript.
 */
export interface HistorySelectionInput {
  readonly owner: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly runId?: RequestRunId;
  readonly currentRequestId: MessageId;
  readonly currentRunId?: RequestRunId;
  readonly activeContextItems: ReadonlyArray<{ readonly messageId: MessageId }>;
  readonly activeContextVersion: number;
  /** Batch-load every active-context item in one gateway call (replaces the per-id `loadMessage` N+1 loop). */
  readonly loadMessages: (messageIds: readonly MessageId[]) => Promise<readonly SessionMessageRecord[]>;
}

/**
 * Outcome of a single history selection pass. The output is the full valid
 * history candidate set. Final `ContextAssembly.selectedMessageRefs` truncation
 * and downstream policy live outside this module.
 */
export interface HistorySelectionOutcome {
  readonly currentRequestRecords: readonly SessionMessageRecord[];
  readonly priorTurnCandidates: readonly MessageId[];
  /**
   * Loaded records indexed by messageId. Includes both current-request records
   * and prior-turn records. Exposed so downstream stages (budget gate, prompt
   * shaping render) can read the record content without a second
   * messageStore round-trip.
   *
   * The same loadOwnerMessage path that strictly fails on missing refs has
   * already populated this map during selection. Every messageId reachable
   * via currentRequestRecords or priorTurnCandidates is guaranteed present.
   */
  readonly recordsByMessageId: ReadonlyMap<MessageId, SessionMessageRecord>;
  readonly excludedTurnCount: number;
  readonly activeContextVersion: number;
}

export async function selectHistoryCandidates(input: HistorySelectionInput): Promise<HistorySelectionOutcome> {
  // Single batch load — one gateway round-trip for every active-context item,
  // instead of a per-id `loadMessage` loop (N+1 fan-out). The batch gateway
  // does not guarantee ordering, so `ordered` is rebuilt from the input
  // sequence; any missing ref fails explicitly (no silent skip).
  const ids = input.activeContextItems.map((item) => item.messageId);
  const loaded = ids.length === 0 ? [] : await input.loadMessages(ids);
  const records = new Map<MessageId, SessionMessageRecord>();
  for (const record of loaded) {
    records.set(record.messageId, record);
  }
  const ordered: SessionMessageRecord[] = [];
  for (const messageId of ids) {
    const record = records.get(messageId);
    if (record === undefined) {
      throw new AgentError({
        code: CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE,
        message: `Session message ${messageId} could not be resolved.`,
        category: 'INTERNAL',
        retryable: false,
      });
    }
    ordered.push(record);
  }

  const currentRequestRecords: SessionMessageRecord[] = [];
  let currentRequestAnchor: SessionMessageRecord | undefined;
  for (const record of ordered) {
    if (record.messageId === input.currentRequestId) {
      currentRequestAnchor = record;
      break;
    }
  }
  if (currentRequestAnchor === undefined) {
    if (input.activeContextItems.length === 0) {
      return {
        currentRequestRecords: [],
        priorTurnCandidates: [],
        recordsByMessageId: records,
        excludedTurnCount: 0,
        activeContextVersion: input.activeContextVersion,
      };
    }
    throw new AgentError({
      code: 'CONTEXT_CURRENT_REQUEST_UNRESOLVABLE',
      message: `Current request ${input.currentRequestId} is not present in the ActiveContextView snapshot (${input.activeContextItems.length} items present).`,
      category: 'INTERNAL',
      retryable: false,
    });
  }
  currentRequestRecords.push(currentRequestAnchor);
  for (const record of ordered) {
    if (record.messageId === currentRequestAnchor.messageId) {
      continue;
    }
    if (!isProtocolRequiredForCurrentRequest(record, input)) {
      continue;
    }
    currentRequestRecords.push(record);
  }

  const priorUnits = groupPriorTurns(
    ordered,
    input.currentRequestId,
    currentRequestRecords.map((record) => record.messageId),
  );
  const priorTurnCandidates: MessageId[] = [];
  let excludedTurnCount = 0;
  for (const unit of priorUnits) {
    const replacedRunIds = new Set<RequestRunId>();
    for (const record of unit) {
      if (record.role !== 'USER' && record.runId !== undefined && isRetryReplaced(record)) {
        replacedRunIds.add(record.runId);
      }
    }
    const effectiveUnit = unit.filter((record) => {
      if (isRetryReplaced(record)) {
        return false;
      }
      return record.role === 'USER' || record.runId === undefined || !replacedRunIds.has(record.runId);
    });
    if (isCompleteVisibleTurn(effectiveUnit)) {
      for (const record of effectiveUnit) {
        priorTurnCandidates.push(record.messageId);
      }
    } else {
      excludedTurnCount += 1;
    }
  }

  return {
    currentRequestRecords,
    priorTurnCandidates,
    recordsByMessageId: records,
    excludedTurnCount,
    activeContextVersion: input.activeContextVersion,
  };
}

function isRetryReplaced(record: SessionMessageRecord): boolean {
  const visibility = record.metadata['visibility'];
  return isJsonObject(visibility) && visibility['reason'] === 'RETRY_REPLACED';
}

function isProtocolRequiredForCurrentRequest(record: SessionMessageRecord, input: HistorySelectionInput): boolean {
  // A SUMMARY is compressed prior history, never part of the current request.
  // Summary compression stamps the triggering request's id onto the SUMMARY,
  // so without this exclusion a prior SUMMARY whose requestId happens to match
  // the current request (same-run re-entry, #531) would be pulled into
  // `currentRequestRecords` — ordered AFTER the current USER anchor and
  // removed from the prior-turn candidates — producing the
  // `[newSummary, USER, oldSummary, ...]` misordering and starving
  // `coveredRefs`. SUMMARY must always route to prior history.
  if (record.role === 'SUMMARY') {
    return false;
  }
  if (record.requestId !== input.currentRequestId) {
    return false;
  }
  if (input.currentRunId !== undefined && record.runId !== undefined && record.runId !== input.currentRunId) {
    return false;
  }
  return record.role === 'USER' || record.role === 'ASSISTANT' || record.role === 'CAPABILITY_RESULT';
}

function groupPriorTurns(
  ordered: readonly SessionMessageRecord[],
  currentRequestId: MessageId,
  currentRequestIds: readonly MessageId[],
): ReadonlyArray<readonly SessionMessageRecord[]> {
  const currentSet = new Set<MessageId>(currentRequestIds);
  const units: SessionMessageRecord[][] = [];
  let current: SessionMessageRecord[] = [];
  let currentRequestKey: MessageId | undefined;
  for (const record of ordered) {
    // Skip current-request messages EXCEPT SUMMARY: a SUMMARY carries the
    // triggering request's id, so the `requestId === currentRequestId` guard
    // below would otherwise drop a prior SUMMARY on same-run re-entry (#531).
    // SUMMARY is prior compressed history and must always be grouped here.
    const isCurrentRequestNonSummary = record.requestId === currentRequestId && record.role !== 'SUMMARY';
    if (isCurrentRequestNonSummary || currentSet.has(record.messageId)) {
      continue;
    }
    if (currentRequestKey === undefined || record.requestId !== currentRequestKey) {
      if (current.length > 0) {
        units.push(current);
      }
      current = [record];
      currentRequestKey = record.requestId;
    } else {
      current.push(record);
    }
  }
  if (current.length > 0) {
    units.push(current);
  }
  return units;
}

function isCompleteVisibleTurn(unit: readonly SessionMessageRecord[]): boolean {
  if (unit.length === 0) {
    return false;
  }
  const first = unit[0]!;
  // A leading SUMMARY is a valid turn start: it represents an already-
  // compressed prior-history prefix committed by summary compression. Without
  // this, a prior SUMMARY at ordinal 0 of the active context forms a
  // standalone unit that is always rejected (the old `first.role !== "USER"`
  // check), so the summary is dropped from assembled history on non-compaction
  // turns and — worse — on the next compaction it is neither covered (re-
  // summarized) nor retained, so `commitCompaction`'s prefix replacement
  // deletes it. That silently loses cumulative conversation history every
  // time a second auto-summary fires. Accepting a SUMMARY-led unit keeps the
  // prior summary in `priorTurnCandidates` so it leads the assembled context
  // (right after the system prompt) and is folded into the next summary.
  if (isHiddenReplacement(first) || (first.role !== 'USER' && first.role !== 'SUMMARY')) {
    return false;
  }
  for (const record of unit) {
    if (record.role === 'ASSISTANT' && (record.metadata as Record<string, unknown> | undefined)?.kind === 'ASSISTANT_TOOL_USE') {
      continue;
    }
    if (isHiddenReplacement(record)) {
      return false;
    }
  }
  const last = unit[unit.length - 1]!;
  if (last.role !== 'ASSISTANT' && last.role !== 'SUMMARY') {
    return false;
  }
  const parsed = parseJsonObject(last.content);
  if (Array.isArray(parsed?.toolCalls) && parsed.toolCalls.length > 0) {
    return false;
  }
  return hasOrderedToolProtocol(unit);
}

function isHiddenReplacement(record: SessionMessageRecord): boolean {
  // A page-hidden message carrying `modelVisibility.included=true` (e.g. a
  // directed-Skill body persisted as a `visible:false` USER message) is
  // model-visible by design — the inverse of the `modelVisibility.excluded`
  // case below. It must NOT be classified as a hidden replacement, or the
  // prior turn that loaded the Skill would be dropped from model history in
  // every later round.
  const includedVisibility = record.metadata['modelVisibility'];
  if (isJsonObject(includedVisibility) && includedVisibility['included'] === true) {
    return false;
  }
  if (!record.visible) {
    return true;
  }
  if (isReadableCapabilityResultReplacement(record)) {
    return false;
  }
  const replacement = record.metadata['replacement'];
  if (isJsonObject(replacement) && typeof replacement['kind'] === 'string') {
    return true;
  }
  // Page-visible but model-excluded (e.g. input-guard-blocked round): the
  // `visible` field is true so the conversation route returns it for page
  // rendering, but `metadata.modelVisibility.excluded=true` directs context
  // assembly to keep it out of the model context.
  const modelVisibility = record.metadata['modelVisibility'];
  if (isJsonObject(modelVisibility) && modelVisibility['excluded'] === true) {
    return true;
  }
  return false;
}

function isReadableCapabilityResultReplacement(record: SessionMessageRecord): boolean {
  if (record.role !== 'CAPABILITY_RESULT') {
    return false;
  }
  const replacement = record.metadata['replacement'];
  if (!isJsonObject(replacement) || replacement['kind'] !== 'PERSISTED_PREVIEW') {
    return false;
  }
  const contentRef = replacement['contentRef'];
  return (
    isJsonObject(contentRef) &&
    contentRef['refType'] === 'CAPABILITY_RESULT' &&
    typeof contentRef['refId'] === 'string' &&
    (contentRef['refId'].startsWith('tool-results/') || contentRef['refId'].startsWith('fork-promoted:'))
  );
}

function hasOrderedToolProtocol(unit: readonly SessionMessageRecord[]): boolean {
  const expected: string[] = [];
  for (const record of unit) {
    if (record.role === 'ASSISTANT') {
      expected.push(...toolCallIds(record));
    } else if (record.role === 'CAPABILITY_RESULT') {
      const id = toolResultId(record);
      const next = expected[0];
      if (id === undefined || next === undefined || id !== next) {
        return false;
      }
      expected.shift();
    }
  }
  return expected.length === 0;
}

function toolCallIds(record: SessionMessageRecord): string[] {
  if (record.role !== 'ASSISTANT') {
    return [];
  }
  const parsed = parseJsonObject(record.content);
  return Array.isArray(parsed?.toolCalls) ? parsed.toolCalls.flatMap((toolCall) => (isModelToolCall(toolCall) ? [toolCall.toolCallId] : [])) : [];
}

function toolResultId(record: SessionMessageRecord): string | undefined {
  if (record.role !== 'CAPABILITY_RESULT') {
    return undefined;
  }
  const parsed = parseJsonObject(record.content);
  return typeof parsed?.toolCallId === 'string' ? parsed.toolCallId : undefined;
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isModelToolCall(value: unknown): value is { readonly toolCallId: string; readonly toolName: string; readonly arguments: JsonObject } {
  return isJsonObject(value) && typeof value.toolCallId === 'string' && typeof value.toolName === 'string' && isJsonObject(value.arguments);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
