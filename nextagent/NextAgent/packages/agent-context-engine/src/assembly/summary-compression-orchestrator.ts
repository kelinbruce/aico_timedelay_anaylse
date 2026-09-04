import { brand, type EpochMillis, type IdempotencyKey, type MessageId, type RequestRunId, type SessionId } from '@nextagent/agent-common';
import { extractSafeErrorDetail } from '../internal/safe-error-projection.js';
import { getLogger } from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type {
  ContextAssemblyRequest,
  ContextCompressionEvidence,
  ContextEnginePort,
  TraceableSummaryDraft,
  TraceableSummaryGenerationPort,
  TraceableSummaryGenerationRequest,
} from '@nextagent/agent-contracts/context';
import type { ActiveContextViewRecord, VersionedUpdateResult } from '@nextagent/agent-contracts/gateway';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { LifecycleHookInterruptionError, type HookBoundaryByStage, type LifecycleHookInvocationPort } from '@nextagent/agent-contracts/runtime';

const logger = getLogger({ component: 'agent-context-engine', source: 'summary-compression' });

/**
 * Summary compression orchestrator (add-ts-context-compression §4).
 *
 * Owns the flow:
 *   1. Build a `TraceableSummaryGenerationRequest` from the dropped
 *      prior prefix (covered messages) + retained tail.
 *   2. Call the composed `TraceableSummaryGenerationPort.generate`.
 *   3. Validate the draft is non-empty and safe-to-persist.
 *   4. Build a domain `SessionMessage` (role = SUMMARY) with
 *      `metadata.kind = "CONTEXT_COMPRESSION_SUMMARY"` and
 *      `metadata.strategy = "PREFIX_COMPACT_RECENT_TAIL"`. The
 *      session-mapping boundary inside
 *      `ActiveContextStoreGateway.commitCompaction` will project
 *      this to a `SessionMessageRecord`.
 *   5. Call `commitCompaction`; on VERSION_CONFLICT or
 *      persistence failure, fall back to the existing budget
 *      omission path with the corresponding safe reason code.
 *   6. On success, reload the active context, re-run history
 *      selection, and surface a `ContextCompressionEvidence`.
 *
 * Reason vocabulary (per spec, compatible with the budget-
 * explainability reason codes archived before this change):
 *   - `SUMMARY_GENERATOR_UNCONFIGURED`: no port composed
 *   - `SUMMARY_GENERATION_FAILED`: port threw / aborted / auth /
 *     tool-call attempt / full-text failure
 *   - `SUMMARY_DRAFT_INVALID`: empty or unsafe draft
 *   - `ACTIVE_CONTEXT_VERSION_CONFLICT`: commit CAS mismatch
 *   - `ACTIVE_CONTEXT_PERSISTENCE_FAILED`: any other gateway
 *     failure (NOT_FOUND, INTERNAL, etc.)
 *   - `CONTEXT_COMPACTED_EVIDENCE`: successful commit (only
 *     appears on the evidence DTO, not as a fallback reason)
 */

export type CompressionFallbackReason =
  | 'SUMMARY_GENERATOR_UNCONFIGURED'
  | 'SUMMARY_GENERATION_FAILED'
  | 'SUMMARY_DRAFT_INVALID'
  | 'ACTIVE_CONTEXT_VERSION_CONFLICT'
  | 'ACTIVE_CONTEXT_PERSISTENCE_FAILED';

export const SUMMARY_METADATA_KIND = 'CONTEXT_COMPRESSION_SUMMARY';
export const SUMMARY_STRATEGY = 'PREFIX_COMPACT_RECENT_TAIL';
export const COMPRESSION_EDGE_LABEL = 'CONTEXT_COMPACTED_EVIDENCE';

export interface SummaryCompressionOutcome {
  readonly compressionEvidence: ContextCompressionEvidence;
  readonly newActiveContext: ActiveContextViewRecord;
  readonly newSelectionOutcome: import('./active-context-selector.js').HistorySelectionOutcome;
  readonly summaryMessageId: MessageId;
  readonly summaryMessageRecord: SessionMessageRecord;
  readonly retainedTailMessageIds: readonly MessageId[];
}

export interface SummaryCompressionFailure {
  readonly reason: CompressionFallbackReason;
  readonly detail: string;
}

export type CompressionResult =
  { readonly ok: true; readonly value: SummaryCompressionOutcome } | { readonly ok: false; readonly value: SummaryCompressionFailure };

type BeforeContextCompactBoundary = HookBoundaryByStage['BEFORE_CONTEXT_COMPACT'];
type AfterContextCompactBoundary = HookBoundaryByStage['AFTER_CONTEXT_COMPACT'];

/**
 * The inputs the orchestrator needs. The caller (the assemble
 * pipeline) pre-computes these so the orchestrator itself is a
 * pure function of the request, the dropped-prior prefix, the
 * retained tail, and the active-context version. No
 * process-local state is retained across reloads.
 */
export interface SummaryCompressionInputs {
  readonly request: ContextAssemblyRequest;
  readonly stepId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly agentAssemblyRef: string;
  readonly sessionId: string;
  readonly sourceActiveContextVersion: number;
  readonly coveredMessages: readonly SessionMessage[];
  readonly coveredMessageRefs: readonly MessageId[];
  readonly retainedTailMessages: readonly SessionMessage[];
  readonly retainedTailMessageRefs: readonly MessageId[];
  /**
   * Active-context refs that MUST remain after the prefix swap commits.
   * This is wider than `retainedTailMessageRefs`: the caller also carries
   * the current request anchor + protocol-required current-turn records so
   * the next assemble cycle can still resolve the current request from the
   * persisted ActiveContextView.
   */
  readonly commitRetainedMessageRefs: readonly MessageId[];
  readonly targetBudgetUnits: number;
  readonly abortSignal?: AbortSignal;
  readonly idFactory: (prefix: string) => string;
  readonly clock: () => EpochMillis;
}

export interface SummaryCompressionDeps {
  readonly summaryGenerator?: TraceableSummaryGenerationPort;
  readonly commitCompaction: (request: {
    readonly ownerScope: { readonly tenantId: string; readonly subjectId: string };
    readonly agentId: string;
    readonly sessionId: string;
    readonly expectedActiveContextVersion: number;
    readonly summaryMessage: SessionMessageRecord;
    readonly retainedTailMessageIds: readonly MessageId[];
    readonly idempotencyKey: IdempotencyKey;
  }) => Promise<VersionedUpdateResult<ActiveContextViewRecord>>;
  readonly reloadActiveContext: () => Promise<ActiveContextViewRecord | undefined>;
  readonly reSelect: () => Promise<import('./active-context-selector.js').HistorySelectionOutcome>;
  readonly lifecycleHook?: LifecycleHookInvocationPort;
}

export async function runSummaryCompression(inputs: SummaryCompressionInputs, deps: SummaryCompressionDeps): Promise<CompressionResult> {
  // Defense-in-depth for the empty-covered case (#531): when there are no
  // covered messages to summarize, the summary generator would receive an
  // empty covered range and emit a "No prior conversation" pseudo-summary,
  // which only inflates the context. The assemble pipeline guards this before
  // calling, but the orchestrator rejects it too so the invariant holds for
  // every caller.
  if (inputs.coveredMessageRefs.length === 0) {
    return {
      ok: false,
      value: {
        reason: 'SUMMARY_DRAFT_INVALID',
        detail: 'No covered messages to summarize (coveredMessageRefs is empty).',
      },
    };
  }
  if (deps.summaryGenerator === undefined) {
    return {
      ok: false,
      value: {
        reason: 'SUMMARY_GENERATOR_UNCONFIGURED',
        detail: 'TraceableSummaryGenerationPort is not composed into the context engine.',
      },
    };
  }

  // Build the generation request. The covered messages and the
  // retained tail refs are the same as what the budget plan sees.
  // We construct the optional properties via a plain mutable
  // shape and assert the contract type at the end because
  // `TraceableSummaryGenerationRequest` uses
  // `exactOptionalPropertyTypes` (rejects `undefined` for an
  // optional property).
  // Build the generation request. locale is required, abortSignal is optional
  const beforeBoundary = await invokeContextCompactBeforeHook(inputs, deps);
  const generationRequest: TraceableSummaryGenerationRequest = {
    identityContext: inputs.request.identityContext,
    agentId: brand<string, 'AgentId'>(inputs.agentId),
    agentVersion: brand<string, 'AgentVersion'>(inputs.agentVersion),
    sessionId: brand<string, 'SessionId'>(inputs.sessionId),
    requestId: inputs.request.requestId,
    runId: inputs.request.runId,
    locale: inputs.request.locale,
    purpose: 'SUMMARY_GENERATION',
    flowVariables: inputs.request.flowVariables ?? {},
    coveredMessages: inputs.coveredMessages,
    coveredMessageRefs: inputs.coveredMessageRefs,
    retainedTailMessageRefs: inputs.retainedTailMessageRefs,
    targetBudgetUnits: beforeBoundary.targetBudgetUnits ?? inputs.targetBudgetUnits,
    ...(inputs.abortSignal !== undefined && { abortSignal: inputs.abortSignal }),
  };

  let draft: TraceableSummaryDraft;
  try {
    draft = await deps.summaryGenerator.generate(generationRequest);
  } catch (error) {
    logger.error({
      err: error,
      event: 'context.compression.summaryGenerationError',
      failureStage: 'CONTEXT_SUMMARY_GENERATION',
      agentId: inputs.agentId,
      agentVersion: inputs.agentVersion,
      sessionId: inputs.sessionId,
      runId: inputs.request.runId,
    });
    return {
      ok: false,
      value: {
        reason: 'SUMMARY_GENERATION_FAILED',
        detail: extractSafeErrorDetail(error, 'Summary generation failed'),
      },
    };
  }

  if (typeof draft.content !== 'string' || draft.content.trim().length === 0) {
    return {
      ok: false,
      value: {
        reason: 'SUMMARY_DRAFT_INVALID',
        detail: 'TraceableSummaryDraft.content is empty or whitespace-only.',
      },
    };
  }
  draft = await invokeContextCompactAfterHook(inputs, deps, draft);

  // Build the domain SessionMessage (role = SUMMARY). The
  // session-mapping boundary inside commitCompaction will
  // project this to a SessionMessageRecord.
  const summaryMessageId = brand<string, 'MessageId'>(inputs.idFactory('summary'));
  const summaryMessage: SessionMessage = {
    messageId: summaryMessageId,
    sessionId: brand<string, 'SessionId'>(inputs.sessionId),
    requestId: inputs.request.requestId,
    role: 'SUMMARY',
    content: draft.content,
    contentType: 'PLAIN_TEXT',
    metadata: {
      kind: SUMMARY_METADATA_KIND,
      strategy: SUMMARY_STRATEGY,
      // presentation-safe trace metadata. The session-mapping
      // boundary inside commitCompaction will project this
      // metadata into a SessionMessageRecord alongside the
      // content.
      promptTemplateVersion: draft.promptTemplateVersion,
      inputUnitEstimate: draft.inputUnitEstimate,
      outputUnitEstimate: draft.outputUnitEstimate,
      sourceActiveContextVersion: inputs.sourceActiveContextVersion,
      // The original requestId is preserved on the summary
      // message metadata. retainedTailMessageRefs preserve
      // their original requestId because the orchestrator never
      // mutates retained messages.
      ...(inputs.coveredMessageRefs.length > 0 ? { coveredMessageRefCount: inputs.coveredMessageRefs.length } : {}),
      ...(inputs.retainedTailMessageRefs.length > 0 ? { retainedTailRefCount: inputs.retainedTailMessageRefs.length } : {}),
    },
    sequence: 0,
    visible: true,
    createdAt: inputs.clock(),
  };

  // Project the domain SessionMessage to a SessionMessageRecord
  // shape (the session mapping boundary inside the gateway
  // would do this in a real implementation; here we project
  // inline because the in-memory gateway test double expects a
  // concrete record). This projection is owned by the same
  // session → gateway mapping convention used elsewhere.
  const summaryMessageRecord: SessionMessageRecord = {
    tenantId: inputs.request.identityContext.tenantId,
    subjectId: inputs.request.identityContext.subjectId,
    agentId: brand<string, 'AgentId'>(inputs.agentId),
    messageId: summaryMessageId,
    sessionId: brand<string, 'SessionId'>(inputs.sessionId),
    requestId: inputs.request.requestId,
    runId: inputs.request.runId,
    role: 'SUMMARY',
    content: summaryMessage.content,
    contentType: 'PLAIN_TEXT',
    metadata: summaryMessage.metadata,
    visible: true,
    createdAt: inputs.clock(),
  };

  const idempotencyKey = brand<string, 'IdempotencyKey'>(
    `${inputs.sessionId}:${inputs.request.runId}:commitCompaction:${inputs.sourceActiveContextVersion}:${summaryMessageId}`,
  );

  const commitResult = await deps.commitCompaction({
    ownerScope: {
      tenantId: inputs.request.identityContext.tenantId,
      subjectId: inputs.request.identityContext.subjectId,
    },
    agentId: inputs.agentId,
    sessionId: inputs.sessionId,
    expectedActiveContextVersion: inputs.sourceActiveContextVersion,
    summaryMessage: summaryMessageRecord,
    retainedTailMessageIds: inputs.commitRetainedMessageRefs,
    idempotencyKey,
  });

  if (commitResult.status === 'VERSION_CONFLICT') {
    return {
      ok: false,
      value: {
        reason: 'ACTIVE_CONTEXT_VERSION_CONFLICT',
        detail: `commitCompaction reported VERSION_CONFLICT for expectedActiveContextVersion=${inputs.sourceActiveContextVersion}.`,
      },
    };
  }
  if (commitResult.status !== 'UPDATED' || commitResult.record === undefined) {
    return {
      ok: false,
      value: {
        reason: 'ACTIVE_CONTEXT_PERSISTENCE_FAILED',
        detail: `commitCompaction reported status=${commitResult.status} with no record.`,
      },
    };
  }

  const newActiveContext = commitResult.record;
  // Micro-compact coordination: the new ActiveContextView replaces
  // the old prefix with summary + retained tail. The gateway creates
  // a fresh view without the old microCompactState. The next assemble()
  // call will scan the retained tail afresh via scanCompactableCandidates.
  const newSelectionOutcome = await deps.reSelect();

  const compressionEvidence: ContextCompressionEvidence = {
    sessionId: brand<string, 'SessionId'>(inputs.sessionId),
    requestId: inputs.request.requestId,
    runId: inputs.request.runId,
    stepId: inputs.stepId,
    sourceActiveContextVersion: inputs.sourceActiveContextVersion,
    targetActiveContextVersion: newActiveContext.state.activeContextVersion,
    summaryMessageId,
    strategy: 'PREFIX_COMPACT_RECENT_TAIL',
    coveredMessageRefCount: inputs.coveredMessageRefs.length,
    retainedTailRefCount: inputs.retainedTailMessageRefs.length,
    safeReason: SUMMARY_METADATA_KIND,
    edgeLabel: 'CONTEXT_COMPACTED_EVIDENCE',
  };

  return {
    ok: true,
    value: {
      compressionEvidence,
      newActiveContext,
      newSelectionOutcome,
      summaryMessageId,
      summaryMessageRecord,
      retainedTailMessageIds: inputs.commitRetainedMessageRefs,
    },
  };
}

async function invokeContextCompactBeforeHook(inputs: SummaryCompressionInputs, deps: SummaryCompressionDeps): Promise<BeforeContextCompactBoundary> {
  const boundary: BeforeContextCompactBoundary = {
    stepId: inputs.stepId,
    contextItemCount: inputs.coveredMessages.length + inputs.retainedTailMessages.length,
    safeBudgetSummary: 'summary-compression',
    targetBudgetUnits: inputs.targetBudgetUnits,
  };
  if (deps.lifecycleHook === undefined) {
    return boundary;
  }
  const result = await deps.lifecycleHook.invoke(
    {
      stage: 'BEFORE_CONTEXT_COMPACT',
      coordinates: contextHookCoordinates(inputs, 'BEFORE_CONTEXT_COMPACT'),
      ownerScope: {
        tenantId: inputs.request.identityContext.tenantId,
        subjectId: inputs.request.identityContext.subjectId,
      },
      boundary,
    },
    inputs.abortSignal,
  );
  if (result.status === 'INTERRUPT') {
    throw new LifecycleHookInterruptionError(result.interruption);
  }
  return result.boundary;
}

async function invokeContextCompactAfterHook(
  inputs: SummaryCompressionInputs,
  deps: SummaryCompressionDeps,
  draft: TraceableSummaryDraft,
): Promise<TraceableSummaryDraft> {
  if (deps.lifecycleHook === undefined) {
    return draft;
  }
  const boundary: AfterContextCompactBoundary = {
    stepId: inputs.stepId,
    safeBudgetSummary: 'summary-draft-valid',
    content: draft.content,
  };
  const result = await deps.lifecycleHook.invoke(
    {
      stage: 'AFTER_CONTEXT_COMPACT',
      coordinates: contextHookCoordinates(inputs, 'AFTER_CONTEXT_COMPACT'),
      ownerScope: {
        tenantId: inputs.request.identityContext.tenantId,
        subjectId: inputs.request.identityContext.subjectId,
      },
      boundary,
    },
    inputs.abortSignal,
  );
  if (result.status === 'INTERRUPT') {
    throw new LifecycleHookInterruptionError(result.interruption);
  }
  return {
    ...draft,
    content: result.boundary.content ?? draft.content,
  };
}

function contextHookCoordinates(inputs: SummaryCompressionInputs, stage: 'BEFORE_CONTEXT_COMPACT' | 'AFTER_CONTEXT_COMPACT') {
  return {
    sessionId: inputs.request.sessionId,
    requestId: inputs.request.requestId,
    requestRunId: inputs.request.runId,
    agentId: brand<string, 'AgentId'>(inputs.agentId),
    agentVersion: brand<string, 'AgentVersion'>(inputs.agentVersion),
    agentAssemblyRef: inputs.agentAssemblyRef,
    stageOccurrenceKey: `${inputs.stepId}:${inputs.sourceActiveContextVersion}:${stage}`,
  };
}
