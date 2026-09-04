import {
  AgentError,
  brand,
  type EpochMillis,
  type IdentityContext,
  type IdempotencyKey,
  type JsonObject,
  type MessageId,
} from '@nextagent/agent-common';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { ContextAssemblyOptionsSchema } from '@nextagent/agent-contracts/context';
import type {
  ContextAssembly,
  AttachmentContextEvidence,
  AttachmentDegradationEvidence,
  AttachmentContextDecision,
  ContextAssemblyRequest,
  ContextBudgetEvidence,
  ContextBudgetPolicyInput,
  ContextBudgetPolicyOutcome,
  ContextBudgetPolicyPort,
  ContextCompressionEvidence,
  ContextAssemblyOptions,
  ContextEnginePort,
  ModelSelectionService,
  SystemPrompt,
  ContextRoleEvidence,
  RenderedModelInput,
  TokenEstimator,
  TraceableSummaryGenerationPort,
} from '@nextagent/agent-contracts/context';
import type {
  ActiveContextStoreGateway,
  AttachmentStoreGateway,
  BlobStoreGateway,
  VersionedUpdateResult,
  ActiveContextViewRecord,
  SessionMessageStoreGateway,
  SessionForkStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { ModelInferenceOptions, ModelMessage, ModelToolCall, ResolvedModelConfiguration } from '@nextagent/agent-contracts/model';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { TextDecoder } from 'node:util';
import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv/dist/ajv.js';

import { getLogger } from '@nextagent/agent-common';
import { modelInferenceOptions } from '../internal/model-configuration.js';
import { buildBudgetEvaluationLogSummary, logBudgetEvaluation } from '../budget/budget-logging.js';
import { classifyReplacement } from '../large-content/classifier.js';
import { LARGE_CONTENT_THRESHOLDS } from '../large-content/thresholds.js';
import { assertBudgetPolicyOutcomeInvariants } from '../budget/budget-invariant-guard.js';
import { buildSourceCandidates } from '../budget/source-candidate-builder.js';
import { createDefaultTokenEstimator } from '../budget/default-token-estimator.js';
import { readPersistedPreview, renderPersistedPreviewBlock } from '../large-content/index.js';
import { DefaultModelInputRenderer } from '../prompt-shaping/model-input-renderer.js';
import {
  SYSTEM_PROMPT,
  createDefaultPromptTemplateAssembler,
  createDefaultPromptTemplateRegistry,
  mergePromptModelOptions,
  systemPromptFromAssemblyResult,
  type PromptAssemblyResult,
  type PromptModelCandidate,
  type PromptTemplateAssembler,
  type PromptTemplateRegistry,
} from '../prompt-shaping/index.js';
import type { InMemoryPromptShapingDiagnosticsSink, PromptShapingDiagnosticsSink } from '../prompt-shaping/diagnostics.js';
import type { SkillDisclosureMode, ToolDisclosureMode } from '../prompt-shaping/skill-disclosure-mode.js';
import { defaultBuiltinPromptRoot } from '../prompt-shaping/builtin-prompt-root.js';
import { applyCapabilityContextPatch, applyToolSearchDisclosurePolicy, uniqueCapabilities } from './capability-filter.js';
import {
  selectHistoryCandidates as selectActiveContextHistoryCandidates,
  type HistorySelectionInput,
  type HistorySelectionOutcome,
} from './active-context-selector.js';
import { projectRecordToSessionMessage, projectRecordsByIds } from './session-message-projection.js';
import { microcompactHistory, readMicroCompactState, replaceCompactableRecordContent } from '../micro-compact/index.js';
import { scanHistoricalRagCandidates } from '../micro-compact/candidate-scanner.js';
import { renderPreviousTurnRagPlaceholder } from '../micro-compact/content-replacer.js';
import type { LifecycleHookInvocationPort } from '@nextagent/agent-contracts/runtime';
import { runSummaryCompression } from './summary-compression-orchestrator.js';

export interface DefaultContextEngineDependencies {
  readonly activeContextStore: ActiveContextStoreGateway;
  readonly messageStore: SessionMessageStoreGateway;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly capabilityCatalog: CapabilityCatalog;
  /**
   * Optional attachment store gateway. The render stage uses it
   * to resolve attachment descriptor sequences for the
   * `selectedMessageRefs` and the current request (per
   * add-ts-context-prompt-shaping §5.4). When omitted, the
   * render stage treats the assembly as having no attachments
   * — backward compatible with callers that have not yet
   * composed the attachment gateway.
   */
  readonly attachmentStore?: import('@nextagent/agent-contracts/gateway').AttachmentStoreGateway;
  /**
   * Optional blob store gateway used to resolve controlled previews for
   * current-request Markdown attachments. The context engine only reads
   * through this gateway during synchronous context build and never
   * exposes raw refs.
   */
  readonly blobStore?: BlobStoreGateway;
  readonly forkPromotionContentStore?: Pick<SessionForkStoreGateway, 'loadCommittedForkPromotionContent'>;
  readonly modelSelectionService: ModelSelectionService;
  readonly promptTemplateRegistry?: PromptTemplateRegistry;
  readonly promptTemplateAssembler?: PromptTemplateAssembler;
  /**
   * Optional prompt-shaping diagnostics sink. When composed,
   * the engine emits structured `templateResolved` /
   * `templateRejected` / `templateResolutionFailed` /
   * `ambiguousProfileResolution` / `loaderChainFallback` /
   * `sectionOmitted` / `fragmentRenderFailed` /
   * `tokenEstimationCompleted` events and timeline
   * `renderStarted` / `renderCompleted` events. When omitted,
   * the engine runs silently — backward compatible for
   * callers that do not exercise the diagnostics path.
   */
  readonly promptShapingDiagnostics?: PromptShapingDiagnosticsSink;
  readonly toolDisclosureMode?: ToolDisclosureMode;
  readonly skillDisclosureMode?: SkillDisclosureMode;
  readonly maxGeneratedMessageChars?: number;
  /**
   * Capability id that gates the `memory` system section. When provided,
   * the section renders iff that capability is visible to the model for
   * the accepted Agent. Injected by app composition so the context engine
   * does not reference memory tool names directly. When omitted, the
   * `memory` section never renders.
   */
  readonly memoryToolCapabilityId?: string;
  /**
   * Pluggable budget decision gate per `add-ts-context-budget-explainability`.
   * Optional: when omitted, the budget gate is NOT executed and the returned
   * `ContextAssembly.budgetPlan` / `budgetEvidence` / `budgetRoleEvidence`
   * fields are all undefined (backward-compatible for callers and tests that
   * do not exercise the budget pipeline).
   */
  readonly budgetPolicy?: ContextBudgetPolicyPort;
  /**
   * Token estimator used to size source candidates for the budget gate.
   * Defaults to `createDefaultTokenEstimator()` when not provided. Only
   * consulted when `budgetPolicy` is also provided.
   */
  readonly tokenEstimator?: TokenEstimator;
  /**
   * Optional budget-log sink used to emit the `context.budget.evaluated`
   * structured log event after the budget gate runs (design D7). When
   * omitted, no budget log is emitted — backward-compatible for
   * callers and tests that do not exercise the budget pipeline. The
   * logger interface is structural (any pino-compatible logger
   * satisfies it), so the business module does not need to take a
   * direct dependency on the logging library (architecture firewall
   * `no-framework-leakage-into-business-packages`). The log is
   * non-throwing: a logging failure MUST NOT fail the main pipeline
   * (handled inside `logBudgetEvaluation`).
   */
  /**
   * Optional diagnostic logger for compression and pipeline diagnostic
   * projections. When omitted, no diagnostic log is emitted —
   * backward-compatible for callers and tests that do not exercise
   * the diagnostic pipeline. The logger interface is structural (any
   * pino-compatible logger satisfies it), so the business module does
   * not need to take a direct dependency on the logging library
   * (architecture firewall `no-framework-leakage-into-business-packages`).
   */
  /**
   * Optional summary-generation port composed from app composition
   * (per `add-ts-traceable-summary-generation`). When provided AND the
   * budget plan would drop prior active-context history, the engine
   * attempts summary compression before accepting the budget-driven
   * omission. When omitted, the engine falls back to the existing
   * omission path with `SUMMARY_GENERATOR_UNCONFIGURED` reason.
   */
  readonly summaryGenerator?: TraceableSummaryGenerationPort;
  readonly lifecycleHook?: LifecycleHookInvocationPort;
  /**
   * Optional commit hook for the summary compaction transaction.
   * The engine passes the domain `SessionMessage` to this hook and
   * expects a versioned result; the host application is responsible
   * for routing this to the local SQLite `commitCompaction`
   * implementation (or a remote equivalent) and for surfacing the
   * same idempotency key on the post-compaction checkpoint.
   */
  readonly commitCompaction?: (request: {
    readonly ownerScope: { readonly tenantId: string; readonly subjectId: string };
    readonly agentId: string;
    readonly sessionId: string;
    readonly expectedActiveContextVersion: number;
    readonly summaryMessage: SessionMessageRecord;
    readonly retainedTailMessageIds: readonly MessageId[];
    readonly idempotencyKey: IdempotencyKey;
  }) => Promise<VersionedUpdateResult<ActiveContextViewRecord>>;
  /**
   * Idempotency key factory for runtime-owned checkpoint / timeline
   * reconciliations downstream of the compression commit. The engine
   * uses this to derive the stable key it passes to `commitCompaction`;
   * the same key MUST be re-used by the runtime-owned
   * checkpoint-writer hook call (the in-memory gateway double still
   * matches the contract; the runtime hook is a port we hand to
   * app composition) so the CONTEXT_COMPACTED checkpoint is
   * recorded idempotently.
   */
  readonly idFactory?: (prefix: string) => string;
  /**
   * Clock for timestamps written into compression evidence /
   * summary message metadata. Defaults to `Date.now()`.
   */
  readonly clock?: () => EpochMillis;
  /**
   * Tool names whose results are never offloaded / truncated (Infinity tools).
   * Defaults to an empty set (no tool is infinity-exempt by default).
   */
  readonly infinityToolNames?: ReadonlySet<string>;
}

const defaultMaxGeneratedMessageChars = 70_000;
const logger = getLogger({ component: 'agent-context-engine', source: 'assembly' });

const DEFAULT_INFINITY_TOOL_NAMES: ReadonlySet<string> = new Set();
const EMPTY_FLOW_VARIABLES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Proactive auto-compact threshold headroom (tune-auto-compact-threshold).
 *
 * Summary compression is triggered when the estimated conversation input
 * units reach `availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS`
 * (≈ 90–92% of the effective context window on a 128K window). This is the
 * SOLE compression trigger; the previous reactive "prior_active_history
 * omitted" trigger has been removed. The value is a fixed constant and MUST
 * NOT be carried by `ContextAssemblyRequest`, client request body, model
 * output, or capability arguments. When `availableInputUnits <=` this
 * headroom (small window), the threshold does not fire.
 */
const DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000;

/**
 * Maximum messageIds per `loadMessages` gateway call (batch-chunk guard).
 *
 * The remote `loadMessages` implementation issues a single GET request with
 * the ids encoded as query parameters. GET URLs are bounded by gateway /
 * WAF limits (typically ~8KB); a long multi-turn session accumulates dozens
 * to hundreds of active-context refs before summary compression fires (and
 * `loadMessages` runs in Step 2, before the Step 3 compression that would
 * shrink the ref set), so one unbounded batch eventually exceeds the URL
 * limit and the remote returns HTTP 400.
 *
 * Chunking the id list into bounded slices keeps every request URL well
 * under the limit. 50 ids ≈ 2KB for a typical UUID id (with URL-encoding
 * overhead), leaving a comfortable safety margin, and aligns with the
 * default `maxContextMessages` ceiling so a normal session is a single
 * chunk. The remote fix (POST body) would make this unneeded, but this
 * guard is kept as a defensive bound for any GET-based implementation.
 */
const LOAD_MESSAGES_CHUNK_SIZE = 50;

/**
 * Codes surfaced by the engine. History-selection codes
 * (CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE / CONTEXT_CURRENT_REQUEST_UNRESOLVABLE)
 * now live in active-context-selector.ts, where history selection runs.
 */
const CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE = 'CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE';
const CONTEXT_ACTIVE_VIEW_UNRESOLVABLE = 'CONTEXT_ACTIVE_VIEW_UNRESOLVABLE';
const CONTEXT_RENDER_MESSAGE_UNRESOLVABLE = 'CONTEXT_RENDER_MESSAGE_UNRESOLVABLE';
const CONTEXT_INSUFFICIENT_BUDGET = 'CONTEXT_INSUFFICIENT_BUDGET';
const validateContextAssemblyOptions = new Ajv({
  allErrors: true,
  strict: false,
}).compile(ContextAssemblyOptionsSchema);

export class DefaultContextEngine implements ContextEnginePort {
  private readonly promptTemplateRegistry: PromptTemplateRegistry;
  private readonly promptTemplateAssembler: PromptTemplateAssembler;
  private readonly infinityToolNames: ReadonlySet<string>;
  /**
   * Run-ids that have already produced a successful summary compression.
   * Summary compression MUST fire at most once per agent run: a single run
   * re-enters `assemble()` once per tool iteration, and re-triggering
   * compression mid-run (after the first compaction has already digested the
   * prior turns) drives `coveredRefs` empty, producing "No prior conversation"
   * pseudo-summaries and injecting redundant USER messages (#531). The set is
   * keyed by `ContextAssemblyRequest.runId` (unique per run); it is bounded by
   * the session run count and never produces false positives across runs.
   */
  private readonly compressedRunIds = new Set<string>();

  constructor(private readonly deps: DefaultContextEngineDependencies) {
    this.promptTemplateRegistry = deps.promptTemplateRegistry ?? createDefaultPromptTemplateRegistry();
    this.promptTemplateAssembler = deps.promptTemplateAssembler ?? createDefaultPromptTemplateAssembler(this.promptTemplateRegistry);
    this.infinityToolNames = deps.infinityToolNames ?? DEFAULT_INFINITY_TOOL_NAMES;
  }

  async assemble(request: ContextAssemblyRequest, options: ContextAssemblyOptions | undefined, signal: AbortSignal): Promise<ContextAssembly> {
    if (signal.aborted) {
      throw signal.reason;
    }
    if (options !== undefined && !validateContextAssemblyOptions(options)) {
      throw new AgentError({
        code: 'CONTEXT_ASSEMBLY_OPTIONS_INVALID',
        message: 'Context assembly options are invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const owner = request.identityContext;

    // Step 1: Load context state (active context + assembly + capabilities + prompt)
    const active = await this.loadActiveContextOrEmpty(owner, request);
    const assembly = await this.deps.assemblyRegistry.require(request.agentId, request.agentVersion);
    const visibleCapabilities = await this.resolveCapabilities(owner, assembly, request);
    const modelSelection = await this.selectModel(assembly, request, options, signal);
    const promptAssembly = await this.assemblePrompt(assembly, request, visibleCapabilities, modelSelection);
    const systemPrompt = promptAssembly.systemPrompt;

    // Step 2: History selection (self-contained stage, no truncation)
    const selectionOutcome = await this.selectHistory(request, owner, active);
    const attachmentAssembly = await this.collectAttachmentEvidence(request, owner, selectionOutcome);

    // Step 2.3: Micro-compact (add-ts-context-micro-compact) — identify
    // old compactable tool results and replace their content with
    // lightweight placeholders BEFORE large-content truncation and
    // budget evaluation. Failures degrade safely.
    try {
      const microCompactResult = microcompactHistory({
        outcome: selectionOutcome,
        metadata: active?.metadata as Record<string, unknown> | undefined,
      });
      // Persist microCompactState to the active context store so
      // render() can read compactedIds across instances.
      if (active !== undefined && microCompactResult.evidence.newlyCompactedCount > 0) {
        await this.deps.activeContextStore
          .updateMetadata({
            tenantId: owner.tenantId,
            subjectId: owner.subjectId,
            agentId: request.agentId,
            sessionId: request.sessionId,
            expectedActiveContextVersion: active.state.activeContextVersion,
            metadata: microCompactResult.updatedMetadata as JsonObject,
          })
          .catch(() => {
            /* metadata persist failure does not block pipeline */
          });
      }
      logger.debug({
        event: 'context.microCompact.evaluated',
        decisionBranch: microCompactResult.evidence.path,
        newlyCompacted: microCompactResult.evidence.newlyCompactedCount,
        totalCompacted: microCompactResult.evidence.totalCompactedCount,
        retained: microCompactResult.evidence.retainedCount,
      });
    } catch (error) {
      // Safe degradation: micro-compact failure MUST NOT block the pipeline
      logger.error({
        err: error,
        event: 'context.microCompact.failed',
        failureStage: 'CONTEXT_MICRO_COMPACTION',
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        sessionId: request.sessionId,
        runId: request.runId,
      });
    }

    // Step 2.5: Large-content guard — replace oversized
    // CAPABILITY_RESULT content with bounded previews BEFORE budget
    // evaluation. This prevents MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET
    // errors when a single tool result exceeds the available input
    // budget. Original content is preserved in the message store.
    this.truncateLargeToolResults(selectionOutcome);

    // Step 3: Budget evaluation (gate + diagnostics + compression)
    const budgetEvaluation = this.evaluateBudget(
      request,
      selectionOutcome,
      visibleCapabilities,
      modelSelection,
      promptAssembly,
      systemPrompt,
      attachmentAssembly.attachmentEvidence,
    );
    const budgetOutcome = budgetEvaluation?.outcome;
    const compressionOutcome = await this.processBudgetOutcome(
      budgetOutcome,
      selectionOutcome,
      request,
      active,
      assembly,
      budgetEvaluation?.availableInputUnits ?? 0,
    );

    // Step 4: Build final assembly result
    return this.buildAssemblyResult(
      {
        request,
        systemPrompt,
        selectedMessageRefs: compressionOutcome.selectedMessageRefs,
        attachmentEvidence: attachmentAssembly.attachmentEvidence,
        attachmentContentBlocks: attachmentAssembly.attachmentContentBlocks,
        attachmentDegradationEvidence: attachmentAssembly.attachmentDegradationEvidence,
        promptTemplateRef: promptAssembly.templateRef,
        visibleCapabilities,
        modelConfiguration: modelSelection.configuration,
        modelOptions: mergeCapabilityModelOptions(
          mergePromptModelOptions(modelInferenceOptions(modelSelection.configuration), promptAssembly.modelOptions),
          request.capabilityContextPatch?.modelOptions,
        ),
        modelSelectionReason: modelSelection.reason,
      },
      budgetOutcome,
      compressionOutcome.compressionEvidence,
      attachmentAssembly.attachmentDegradationEvidence,
    );
  }

  async render(assembly: ContextAssembly): Promise<RenderedModelInput> {
    const owner = assembly.request.identityContext;
    // 5.3 — batch resolve all `selectedMessageRefs` in a single
    // gateway call. Per add-ts-context-prompt-shaping §5.3: the
    // render stage MUST NOT perform an N+1 fan-out. Missing or
    // no-longer-model-visible refs are surfaced as explicit
    // failures, not silently dropped, mirroring the prior single-
    // record behavior. The batch call returns at most one record
    // per distinct id; the engine compares the input id set to the
    // returned record set to detect missing refs.
    //
    // The id list is chunked (LOAD_MESSAGES_CHUNK_SIZE) for the same
    // reason as loadOwnerMessages: the remote implementation encodes
    // ids as GET query parameters, and a long multi-turn session
    // accumulates more refs than a single URL can carry. A failed
    // chunk surfaces as CONTEXT_RENDER_MESSAGE_UNRESOLVABLE (the
    // render-stage code), with the original error on cause.
    const renderChunks: MessageId[][] = [];
    for (let offset = 0; offset < assembly.selectedMessageRefs.length; offset += LOAD_MESSAGES_CHUNK_SIZE) {
      renderChunks.push(assembly.selectedMessageRefs.slice(offset, offset + LOAD_MESSAGES_CHUNK_SIZE));
    }
    const loadRenderChunk = (chunkIds: readonly MessageId[], chunkIndex: number): Promise<readonly SessionMessageRecord[]> =>
      this.deps.messageStore
        .loadMessages({
          tenantId: owner.tenantId,
          subjectId: owner.subjectId,
          agentId: assembly.request.agentId,
          messageIds: chunkIds,
        })
        .catch((error) => {
          throw new AgentError({
            code: CONTEXT_RENDER_MESSAGE_UNRESOLVABLE,
            message: `Selected message refs could not be batch-loaded at render time (chunk ${chunkIndex}, offset ${chunkIndex * LOAD_MESSAGES_CHUNK_SIZE}).`,
            category: 'INTERNAL',
            retryable: false,
            cause: error,
          });
        });
    let resolvedRecords: readonly SessionMessageRecord[];
    try {
      const chunkResults = await Promise.all(renderChunks.map((chunkIds, chunkIndex) => loadRenderChunk(chunkIds, chunkIndex)));
      resolvedRecords = chunkResults.flat();
    } catch (error) {
      // loadRenderChunk already wraps into an AgentError with the right code;
      // re-throw as-is. The try/catch is kept so the call site's control flow
      // matches the prior single-call shape (and a non-AgentError thrown from
      // Promise.all — e.g. an empty-chunks edge — is wrapped defensively).
      if (error instanceof AgentError) {
        throw error;
      }
      throw new AgentError({
        code: CONTEXT_RENDER_MESSAGE_UNRESOLVABLE,
        message: `Selected message refs could not be batch-loaded at render time.`,
        category: 'INTERNAL',
        retryable: false,
        cause: error,
      });
    }
    const recordsById = new Map<MessageId, SessionMessageRecord>();
    for (const record of resolvedRecords) {
      recordsById.set(record.messageId, record);
    }

    // Micro-compact replacement (add-ts-context-micro-compact): re-apply
    // placeholder replacement for compacted messageIds at render time.
    // Render loads fresh records from messageStore (original content),
    // so compacted results need to be replaced again. Uses the shared
    // replaceCompactableRecordContent function on SessionMessageRecord
    // (which has messageId) BEFORE projection to ModelMessage.
    const activeReload = await this.loadActiveContextOrEmpty(owner, assembly.request);
    const compactedIds = new Set<string>(readMicroCompactState(activeReload?.metadata as Record<string, unknown> | undefined).compactedIds);
    const historicalSelectedRefs = assembly.selectedMessageRefs.filter((messageId) => {
      const record = recordsById.get(messageId);
      return record !== undefined && record.requestId !== assembly.request.requestId;
    });
    for (const candidate of scanHistoricalRagCandidates(historicalSelectedRefs, recordsById)) {
      compactedIds.add(candidate.messageId);
    }
    if (compactedIds.size > 0) {
      for (const record of recordsById.values()) {
        replaceCompactableRecordContent(record, compactedIds);
      }
    }

    const selectedMessages: SessionMessage[] = [];
    for (const messageId of assembly.selectedMessageRefs) {
      const record = recordsById.get(messageId);
      if (record === undefined) {
        throw new AgentError({
          code: CONTEXT_RENDER_MESSAGE_UNRESOLVABLE,
          message: `Selected message ref ${messageId} is no longer present in the message store at render time.`,
          category: 'INTERNAL',
          retryable: false,
        });
      }
      if (!isModelVisibleMessage(record)) {
        throw new AgentError({
          code: CONTEXT_RENDER_MESSAGE_UNRESOLVABLE,
          message: `Selected message ref ${messageId} is no longer model-visible at render time.`,
          category: 'INTERNAL',
          retryable: false,
        });
      }
      selectedMessages.push(await this.hydrateForkPromotedContent(owner, assembly.request.agentId, projectRecordToSessionMessage(record)));
    }

    // 5.5 — current request user message resolution. The
    // accepted request's current request user message is
    // already in `selectedMessageRefs` (history selection places
    // it there per add-ts-context-history-selection), and the
    // batch `loadMessages` call above resolves it. The
    // current-request anchor is `ContextAssembly.requestId` —
    // render uses that id to identify the current turn inside
    // the batch, NOT a separate gateway call. This keeps
    // render single-round-trip and avoids the N+1 anti-pattern
    // the per-request `listCurrentRequestMessages` call would
    // reintroduce. If the current request message has been
    // deleted between assemble and render, the missing-id check
    // in the loop below throws CONTEXT_RENDER_MESSAGE_UNRESOLVABLE.

    // 5.4 — attachment descriptor sequence. The render stage
    // looks up the attachments referenced by the current
    // request (and any historical selected-message attachment
    // references) via the attachment store gateway. The
    // descriptor sequence is informational here: the renderer
    // today does not surface attachment text inside the system
    // message (attachments remain the caller's concern via
    // the model's `tools` / explicit content blocks), so we
    // simply project the descriptors to drive the diagnostics
    // path and to allow future render enhancements to inject
    // them. When no attachment store is composed the sequence
    // is empty.
    const rendered = await new DefaultModelInputRenderer(this.deps.promptShapingDiagnostics).render({
      assembly,
      selectedMessages,
      maxGeneratedMessageChars: this.deps.maxGeneratedMessageChars ?? defaultMaxGeneratedMessageChars,
    });

    enforceRenderedRagCompaction(rendered.messages, assembly.selectedMessageRefs, recordsById, compactedIds);

    // Large-content guard: also truncate at render time because
    // render loads fresh records from messageStore (which has the
    // original full content), not from the in-memory recordsByMessageId
    // that truncateLargeToolResults modified for budget evaluation.
    truncateRenderedToolResults(rendered.messages, this.infinityToolNames);

    return rendered;
  }

  private async hydrateForkPromotedContent(
    owner: IdentityContext,
    agentId: ContextAssemblyRequest['agentId'],
    message: SessionMessage,
  ): Promise<SessionMessage> {
    const contentRef = readForkPromotedContentRef(message);
    if (contentRef === undefined || this.deps.forkPromotionContentStore === undefined) {
      return message;
    }
    let content: Awaited<ReturnType<SessionForkStoreGateway['loadCommittedForkPromotionContent']>> | undefined;
    try {
      content = await this.deps.forkPromotionContentStore.loadCommittedForkPromotionContent({
        tenantId: owner.tenantId,
        subjectId: owner.subjectId,
        agentId,
        childSessionId: message.sessionId,
        childMessageId: message.messageId,
        promotedContentId: contentRef,
      });
    } catch {
      return message;
    }
    if (content === undefined || content.refType !== 'CAPABILITY_RESULT') {
      return message;
    }
    const text = decodeUtf8(content.bytes);
    if (text === undefined) {
      return message;
    }
    const hydratedContent = replaceForkPromotedCapabilityPayload(message.content, text);
    return hydratedContent === undefined ? message : { ...message, content: hydratedContent };
  }

  private async resolveCapabilities(
    owner: IdentityContext,
    assembly: AgentAssembly,
    request: ContextAssemblyRequest,
  ): Promise<readonly CapabilityDescriptor[]> {
    const modelInvocableCapabilities = await this.deps.capabilityCatalog
      .listAvailable({
        tenantId: owner.tenantId,
        subjectId: owner.subjectId,
        agentAssembly: assembly,
        includeUnavailable: false,
        modelInvocable: true,
      })
      .catch(() => [] as readonly CapabilityDescriptor[]);

    const allAvailableCapabilities =
      request.capabilityContextPatch?.allowedTools === undefined
        ? modelInvocableCapabilities
        : await this.deps.capabilityCatalog
            .listAvailable({
              tenantId: owner.tenantId,
              subjectId: owner.subjectId,
              agentAssembly: assembly,
              includeUnavailable: false,
            })
            .catch(() => [] as readonly CapabilityDescriptor[]);
    const allowedToolCapabilities =
      request.capabilityContextPatch?.allowedTools === undefined
        ? []
        : (
            await Promise.all(
              request.capabilityContextPatch.allowedTools.map((capabilityId) =>
                this.deps.capabilityCatalog
                  .resolve({
                    tenantId: owner.tenantId,
                    subjectId: owner.subjectId,
                    agentAssembly: assembly,
                    capabilityId,
                  })
                  .catch(() => undefined),
              ),
            )
          ).filter((capability): capability is CapabilityDescriptor => capability !== undefined);

    const defaultDisclosedCapabilities = applyToolSearchDisclosurePolicy(
      modelInvocableCapabilities,
      request.capabilityContextPatch,
      this.deps.toolDisclosureMode ?? 'list',
      this.deps.skillDisclosureMode ?? 'list',
    );

    return applyCapabilityContextPatch(
      defaultDisclosedCapabilities,
      request.capabilityContextPatch,
      uniqueCapabilities([...allAvailableCapabilities, ...allowedToolCapabilities]),
    );
  }

  private async assemblePrompt(
    assembly: AgentAssembly,
    request: ContextAssemblyRequest,
    visibleCapabilities: readonly CapabilityDescriptor[],
    modelSelection: {
      readonly configuration: ResolvedModelConfiguration;
      readonly reason: string;
    },
  ): Promise<PromptAssemblyResult & { readonly systemPrompt: SystemPrompt }> {
    // The memory guidance section renders iff the gating capability is visible
    // to the model for the accepted Agent. The capability id is injected by app
    // composition so this module stays agnostic of memory tool names.
    const memoryEnabled =
      this.deps.memoryToolCapabilityId !== undefined &&
      visibleCapabilities.some((capability) => capability.capabilityId === this.deps.memoryToolCapabilityId);
    const promptAssembly = await this.promptTemplateAssembler.assemble({
      purpose: SYSTEM_PROMPT,
      agentId: assembly.agentId,
      agentVersion: assembly.agentVersion,
      locale: request.locale,
      flowVariables: request.flowVariables ?? EMPTY_FLOW_VARIABLES,
      selectedModel: {
        modelId: modelSelection.configuration.modelId,
      },
      memoryEnabled,
      skillDisclosure: skillDisclosureProjection(visibleCapabilities, this.deps.skillDisclosureMode ?? 'list'),
    });
    return { ...promptAssembly, systemPrompt: systemPromptFromAssemblyResult(promptAssembly) };
  }

  /**
   * History selection wrapper that builds the HistorySelectionInput from
   * the active context snapshot and the request.
   */
  private selectHistory(request: ContextAssemblyRequest, owner: IdentityContext, active?: ActiveContextViewRecord): Promise<HistorySelectionOutcome> {
    return this.selectHistoryCandidates({
      owner,
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId: request.runId,
      currentRequestId: request.requestId,
      currentRunId: request.runId,
      activeContextItems: active?.items ?? [],
      activeContextVersion: active?.state.activeContextVersion ?? 0,
      loadMessages: (messageIds) => this.loadOwnerMessages(owner, request, messageIds),
    });
  }

  /**
   * Evaluate the budget gate. Returns undefined when no policy is
   * composed; otherwise emits diagnostics/logs and returns the outcome.
   * Throws CONTEXT_INSUFFICIENT_BUDGET on explicit_failure decisions.
   */
  private evaluateBudget(
    request: ContextAssemblyRequest,
    selectionOutcome: HistorySelectionOutcome,
    visibleCapabilities: readonly CapabilityDescriptor[],
    modelSelection: {
      readonly configuration: ResolvedModelConfiguration;
    },
    promptAssembly: PromptAssemblyResult,
    systemPrompt: SystemPrompt,
    attachmentEvidence: readonly AttachmentContextEvidence[],
  ): { readonly outcome: ContextBudgetPolicyOutcome; readonly availableInputUnits: number } | undefined {
    if (this.deps.budgetPolicy === undefined) {
      return undefined;
    }

    const { outcome: budgetOutcome, availableInputUnits } = this.runBudgetGate(
      this.deps.budgetPolicy,
      selectionOutcome,
      visibleCapabilities,
      attachmentEvidence,
      {
        configuration: modelSelection.configuration,
        modelOptions: mergeCapabilityModelOptions(
          mergePromptModelOptions(modelInferenceOptions(modelSelection.configuration), promptAssembly.modelOptions),
          request.capabilityContextPatch?.modelOptions,
        ),
      },
      systemPrompt,
    );

    // Diagnostics surface: tokenEstimationCompleted (presentation-safe)
    this.deps.promptShapingDiagnostics?.record({
      event: 'tokenEstimationCompleted',
      safeReason: `estimated_final_input_units=${budgetOutcome.plan.estimatedFinalInputUnits}`,
    });

    // D7: structured log event (non-throwing by contract)
    {
      logBudgetEvaluation(
        {
          agentId: selectionOutcome.currentRequestRecords[0]?.agentId ?? '',
          sessionId: selectionOutcome.currentRequestRecords[0]?.sessionId ?? '',
          requestId: selectionOutcome.currentRequestRecords[0]?.requestId ?? '',
          runId: selectionOutcome.currentRequestRecords[0]?.runId ?? '',
        },
        buildBudgetEvaluationLogSummary(budgetOutcome.plan, budgetOutcome.evidence, budgetOutcome.roleEvidence),
      );
    }

    if (budgetOutcome.plan.decision === 'explicit_failure') {
      throw new AgentError({
        code: CONTEXT_INSUFFICIENT_BUDGET,
        message: `Context assembly cannot proceed: ${budgetOutcome.plan.reasonCode}.`,
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: budgetOutcome.plan.reasonCode,
          pipelineStageStoppedAt: budgetOutcome.plan.pipelineStageStoppedAt,
          estimatedFinalInputUnits: budgetOutcome.plan.estimatedFinalInputUnits,
          omittedContextTypes: [...budgetOutcome.plan.omittedContextTypes],
        },
      });
    }

    return { outcome: budgetOutcome, availableInputUnits };
  }

  /**
   * Process budget outcome: attempt compression if eligible, truncate
   * candidates, and return the selected refs plus any compression evidence.
   */
  private async processBudgetOutcome(
    budgetOutcome: ContextBudgetPolicyOutcome | undefined,
    selectionOutcome: HistorySelectionOutcome,
    request: ContextAssemblyRequest,
    active: ActiveContextViewRecord | undefined,
    assembly: AgentAssembly,
    availableInputUnits: number,
  ): Promise<{
    readonly selectedMessageRefs: readonly MessageId[];
    readonly compressionEvidence?: ContextCompressionEvidence | undefined;
  }> {
    let compressionEvidence: ContextCompressionEvidence | undefined;
    let selectedMessageRefs = this.truncateCandidates(selectionOutcome, budgetOutcome?.evidence);

    // tune-auto-compact-threshold: summary compression has a SINGLE trigger —
    // the proactive context-window threshold. The previous reactive trigger
    // (prior_active_history omitted by the budget gate) has been removed.
    // Trigger when the estimated conversation input units reach
    // `availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS` (≈ 92% of
    // the effective window). `estimatedConversationInputUnits` reuses the
    // budget gate's per-candidate evidence (single estimation source). The
    // small-window guard (`availableInputUnits <= headroom`) prevents an
    // unconditional trigger loop. On failure, fall through to the
    // budget-degraded / omission result without faking success.
    const thresholdTrigger =
      budgetOutcome !== undefined &&
      availableInputUnits > DEFAULT_AUTO_COMPACT_HEADROOM_UNITS &&
      this.deps.summaryGenerator !== undefined &&
      this.deps.commitCompaction !== undefined &&
      this.deps.idFactory !== undefined &&
      !this.compressedRunIds.has(request.runId) &&
      sumEvidenceUnits(budgetOutcome.evidence) >= availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS;

    if (thresholdTrigger) {
      const { coveredRefs, retainedTailRefs } = splitPriorTurnCandidatesForCompression(selectionOutcome);

      // Empty-covered guard (#531): if there are no prior turns to compress
      // (e.g. the window is dominated by the current request / tool results,
      // or a prior compaction already digested every prior turn), summarizing
      // an empty covered range produces a "No prior conversation" pseudo-
      // summary that only inflates the context. Skip compression entirely and
      // fall through to the budget-degraded / omission result instead.
      if (coveredRefs.length === 0) {
        logger.info({
          event: 'context.compression.skipped.emptyCovered',
          runId: request.runId,
          sessionId: request.sessionId,
        });
        return { selectedMessageRefs, compressionEvidence };
      }

      const currentRefs = selectionOutcome.currentRequestRecords.map((r) => r.messageId);
      const retainedTailWithCurrentRefs = [...retainedTailRefs, ...currentRefs];

      const compressionResult = await runSummaryCompression(
        {
          request,
          stepId: 'assemble',
          agentId: request.agentId,
          agentVersion: request.agentVersion,
          agentAssemblyRef: assembly.agentAssemblyRef,
          sessionId: request.sessionId,
          sourceActiveContextVersion: active?.state.activeContextVersion ?? 0,
          coveredMessages: projectRecordsByIds(selectionOutcome, coveredRefs),
          coveredMessageRefs: coveredRefs,
          retainedTailMessages: projectRecordsByIds(selectionOutcome, retainedTailRefs),
          retainedTailMessageRefs: retainedTailRefs,
          commitRetainedMessageRefs: retainedTailWithCurrentRefs,
          targetBudgetUnits: budgetOutcome!.plan.estimatedFinalInputUnits,
          idFactory: this.deps.idFactory!,
          clock: this.deps.clock ?? (() => Date.now() as EpochMillis),
        },
        {
          summaryGenerator: this.deps.summaryGenerator!,
          commitCompaction: this.deps.commitCompaction!,
          reloadActiveContext: () => this.loadActiveContextOrEmpty(request.identityContext, request),
          reSelect: async () => selectionOutcome,
          ...(this.deps.lifecycleHook === undefined ? {} : { lifecycleHook: this.deps.lifecycleHook }),
        },
      );
      if (compressionResult.ok) {
        compressionEvidence = compressionResult.value.compressionEvidence;
        // Record this run as compressed so subsequent `assemble()` re-entries
        // within the same run (one per tool iteration) do not re-trigger
        // compression (#531 same-run cascade).
        this.compressedRunIds.add(request.runId);
        logger.info({
          event: 'context.compression.success',
          summaryMessageId: compressionResult.value.summaryMessageId,
          coveredMessageRefCount: compressionEvidence!.coveredMessageRefCount,
          retainedTailRefCount: compressionEvidence!.retainedTailRefCount,
        });
        // Build selectedMessageRefs from the retained tail + current
        // request records. truncateCandidates is not reused here because
        // the budget evidence may mark prior_active_history as "omitted" —
        // including the retained tail that compression chose to preserve.
        selectedMessageRefs = [compressionResult.value.summaryMessageId, ...retainedTailRefs, ...currentRefs];
      } else {
        logger.error({
          event: 'context.compression.failed',
          reason: compressionResult.value.reason,
          detail: compressionResult.value.detail,
        });
      }
    }

    return { selectedMessageRefs, compressionEvidence };
  }

  /**
   * Build the final ContextAssembly result. Conditionally attaches budget
   * and compression evidence fields using spread operators to respect
   * readonly properties.
   */
  private buildAssemblyResult(
    base: Omit<ContextAssembly, 'budgetPlan' | 'budgetEvidence' | 'budgetRoleEvidence' | 'compressionEvidence'>,
    budgetOutcome: ContextBudgetPolicyOutcome | undefined,
    compressionEvidence: ContextCompressionEvidence | undefined,
    attachmentDegradationEvidence: readonly AttachmentDegradationEvidence[],
  ): ContextAssembly {
    const budgetFields =
      budgetOutcome !== undefined
        ? {
            budgetPlan: budgetOutcome.plan,
            budgetEvidence: budgetOutcome.evidence,
            budgetRoleEvidence: budgetOutcome.roleEvidence,
          }
        : {};

    const compressionFields =
      compressionEvidence !== undefined
        ? {
            compressionEvidence,
          }
        : {};

    return {
      ...base,
      ...budgetFields,
      attachmentDegradationEvidence,
      ...compressionFields,
    };
  }

  /**
   * Walk the assembly's selected message refs and the current
   * request, looking up attachment descriptors via the
   * attachment store gateway. Returns the descriptors in the
   * order they are resolved (current-request attachments first,
   * then historical). When no attachment store is composed, the
   * function returns an empty array so callers can degrade
   * gracefully.
   *
   * Prior-turn attachment reads are gated by the message metadata:
   * only a USER message whose `metadata.attachmentIds` is non-empty
   * can have attachments, so plain-text turns are skipped without a
   * gateway call. This collapses the former N-queries-per-N-turns
   * fan-out (which triggered NAIE Memory 429 on long multi-turn
   * sessions) to one query per turn that actually uploaded files —
   * zero for plain-text sessions. Per-turn try/catch failure
   * isolation is preserved unchanged.
   */
  private async collectAttachmentEvidence(
    request: ContextAssemblyRequest,
    owner: IdentityContext,
    selectionOutcome: HistorySelectionOutcome,
  ): Promise<{
    readonly attachmentEvidence: readonly AttachmentContextEvidence[];
    readonly attachmentContentBlocks: readonly string[];
    readonly attachmentDegradationEvidence: readonly AttachmentDegradationEvidence[];
  }> {
    if (this.deps.attachmentStore === undefined) {
      return { attachmentEvidence: [], attachmentContentBlocks: [], attachmentDegradationEvidence: [] };
    }
    const attachmentEvidence: AttachmentContextEvidence[] = [];
    const attachmentDegradationEvidence: AttachmentDegradationEvidence[] = [];
    const seen = new Set<string>();
    const requestAttachments = await this.deps.attachmentStore.listAttachmentsByRequestId({
      tenantId: owner.tenantId,
      subjectId: owner.subjectId,
      agentId: request.agentId,
      requestId: request.requestId,
    });
    const requestMessage = selectionOutcome.currentRequestRecords.find((record) => record.messageId === request.requestId);
    const requestAttachmentIds = this.attachmentIdsFromMetadata(requestMessage?.metadata ?? {});
    for (const attachmentId of requestAttachmentIds) {
      const attachment = requestAttachments.find((record) => record.attachmentId === attachmentId);
      if (attachment === undefined || attachment.validationStatus !== 'ACCEPTED' || attachment.availabilityStatus !== 'AVAILABLE') {
        throw new AgentError({
          code: 'CONTEXT_INSUFFICIENT_BUDGET',
          message: 'Current request attachment context could not be assembled.',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: { reasonCode: 'ATTACHMENT_LATEST_REQUIRED_FAILED' },
        });
      }
      // Markdown-only enforcement removed — all file types accepted, model reads via Read tool
    }
    for (const attachment of requestAttachments) {
      if (seen.has(attachment.attachmentId)) {
        continue;
      }
      seen.add(attachment.attachmentId);
      const decision = this.classifyAttachmentDecision(attachment, requestAttachmentIds, requestMessage);
      // Markdown-only enforcement removed — all file types accepted
      attachmentEvidence.push(this.toAttachmentEvidence(attachment, decision, 'request'));
      if (decision !== 'latest-request-critical') {
        attachmentDegradationEvidence.push({
          safeReasonCode:
            decision === 'latest-request-optional'
              ? 'ATTACHMENT_LATEST_OPTIONAL_DEGRADED'
              : decision === 'historical'
                ? 'ATTACHMENT_HISTORICAL_DEGRADED'
                : 'ATTACHMENT_EXCLUDED',
          projectionKind: this.hasRetainedControlledReplacement(requestMessage, attachment.attachmentId) ? 'controlled-markdown' : 'metadata-only',
          readable: attachment.availabilityStatus === 'AVAILABLE',
          reason:
            decision === 'latest-request-optional'
              ? 'attachment requires explicit degradation'
              : decision === 'historical'
                ? 'historical attachment projected with bounded evidence'
                : 'attachment excluded from model-visible context',
        });
      }
    }
    // Prior turns — metadata-gated. Only a USER message whose
    // `metadata.attachmentIds` is non-empty can have attachments (see
    // rootUserMessageMetadata in agent-runtime/lifecycle/submit.ts, which
    // omits the key entirely when no attachments were uploaded). Plain-text
    // turns are skipped without a gateway call, eliminating the N-empty-
    // queries fan-out that drove NAIE Memory 429 on long sessions. A turn's
    // messages share a requestId, so the per-requestId dedup keeps one
    // lookup per attachment-bearing turn; per-turn try/catch isolation is
    // preserved so a single failed read degrades rather than fails closed.
    const processedPriorRequestIds = new Set<string>();
    for (const messageId of selectionOutcome.priorTurnCandidates) {
      const record = selectionOutcome.recordsByMessageId.get(messageId);
      if (record === undefined) {
        continue;
      }
      if (record.role !== 'USER') {
        continue;
      }
      if (this.attachmentIdsFromMetadata(record.metadata).length === 0) {
        continue;
      }
      const requestIdKey = record.requestId as string;
      if (processedPriorRequestIds.has(requestIdKey)) {
        continue;
      }
      processedPriorRequestIds.add(requestIdKey);
      let attachments: ReadonlyArray<import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord>;
      try {
        attachments = await this.deps.attachmentStore.listAttachmentsByRequestId({
          tenantId: owner.tenantId,
          subjectId: owner.subjectId,
          agentId: request.agentId,
          requestId: record.requestId,
        });
      } catch (error) {
        attachmentDegradationEvidence.push({
          safeReasonCode: 'ATTACHMENT_HISTORICAL_DEGRADED',
          projectionKind: 'failure',
          readable: false,
          reason: 'historical attachment records could not be re-read',
        });
        continue;
      }
      for (const attachment of attachments) {
        if (seen.has(attachment.attachmentId)) {
          continue;
        }
        seen.add(attachment.attachmentId);
        const evidence = this.toAttachmentEvidence(attachment, 'historical', 'history');
        attachmentEvidence.push(evidence);
        // Available historical attachments are materialized and exposed with a
        // modelPath (readable), so they are not a degradation. Only unavailable
        // historical attachments degrade to metadata-only.
        if (attachment.availabilityStatus !== 'AVAILABLE') {
          attachmentDegradationEvidence.push({
            safeReasonCode: evidence.reasonCode,
            projectionKind: 'metadata-only',
            readable: false,
            reason: 'historical attachment is no longer available',
          });
        }
      }
    }
    return { attachmentEvidence, attachmentContentBlocks: [], attachmentDegradationEvidence };
  }

  /**
   * Load the active context. NOT_FOUND is treated as a legitimate empty
   * state; any other failure throws an explicit safe failure so that
   * `loadActiveContext` errors cannot be silently swallowed into
   * current-request-only context.
   */
  private async loadActiveContextOrEmpty(owner: IdentityContext, request: ContextAssemblyRequest) {
    try {
      return await this.deps.activeContextStore.loadActiveContext({
        tenantId: owner.tenantId,
        subjectId: owner.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
      });
    } catch (error) {
      if (isActiveContextNotFound(error)) {
        return undefined;
      }
      throw new AgentError({
        code: CONTEXT_ACTIVE_VIEW_UNRESOLVABLE,
        message: 'Active context view could not be resolved against the active session.',
        category: 'INTERNAL',
        retryable: false,
        cause: error,
      });
    }
  }

  /**
   * Batch-load session messages for history selection. Wraps the
   * `messageStore.loadMessages` gateway call so a thrown gateway error
   * (transient DB failure, 429 throttling, etc.) surfaces as an explicit
   * `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE` rather than propagating raw —
   * preserving the prior per-ref `loadOwnerMessage` contract ("Unresolvable
   * active context references fail explicitly"). Missing-ref detection
   * (record absent from the returned batch) lives in `selectHistoryCandidates`.
   *
   * The id list is chunked into `LOAD_MESSAGES_CHUNK_SIZE`-sized slices and
   * the slices are dispatched concurrently. The remote implementation encodes
   * ids as GET query parameters, so an unbounded batch would exceed the
   * gateway URL limit on long multi-turn sessions (before Step 3 summary
   * compression can shrink the ref set) and fail with HTTP 400. Chunking
   * keeps every request URL bounded; a single chunk is issued when the
   * ref count is at or below the chunk size (the common case).
   */
  private async loadOwnerMessages(
    owner: IdentityContext,
    request: ContextAssemblyRequest,
    messageIds: readonly MessageId[],
  ): Promise<readonly SessionMessageRecord[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const chunks: MessageId[][] = [];
    for (let offset = 0; offset < messageIds.length; offset += LOAD_MESSAGES_CHUNK_SIZE) {
      chunks.push(messageIds.slice(offset, offset + LOAD_MESSAGES_CHUNK_SIZE));
    }
    const loadChunk = (chunkIds: readonly MessageId[], chunkIndex: number): Promise<readonly SessionMessageRecord[]> =>
      this.deps.messageStore
        .loadMessages({
          tenantId: owner.tenantId,
          subjectId: owner.subjectId,
          agentId: request.agentId,
          messageIds: chunkIds,
        })
        .catch((error) => {
          throw new AgentError({
            code: CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE,
            message: `Session messages (${messageIds.length} refs, chunk ${chunkIndex} offset ${chunkIndex * LOAD_MESSAGES_CHUNK_SIZE}) could not be resolved.`,
            category: 'INTERNAL',
            retryable: false,
            cause: error,
          });
        });
    const chunkResults = await Promise.all(chunks.map((chunkIds, chunkIndex) => loadChunk(chunkIds, chunkIndex)));
    // Flatten in chunk order; the caller (selectHistoryCandidates) re-indexes
    // by messageId and rebuilds ordering from the input snapshot, so the
    // concatenation order here does not affect selection output.
    return chunkResults.flat();
  }

  private attachmentIdsFromMetadata(metadata: SessionMessageRecord['metadata']): ReadonlyArray<import('@nextagent/agent-common').AttachmentId> {
    const value = metadata['attachmentIds'];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is import('@nextagent/agent-common').AttachmentId => typeof item === 'string' && item.length > 0);
  }

  private classifyAttachmentDecision(
    attachment: import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord,
    requestAttachmentIds: ReadonlyArray<import('@nextagent/agent-common').AttachmentId>,
    requestMessage?: SessionMessageRecord,
  ): AttachmentContextDecision {
    if (attachment.validationStatus !== 'ACCEPTED' || attachment.availabilityStatus !== 'AVAILABLE') {
      return 'excluded';
    }
    if (requestAttachmentIds.includes(attachment.attachmentId) && !this.hasRetainedControlledReplacement(requestMessage, attachment.attachmentId)) {
      return 'latest-request-critical';
    }
    if (requestAttachmentIds.includes(attachment.attachmentId)) {
      return 'latest-request-optional';
    }
    return 'historical';
  }

  private toAttachmentEvidence(
    record: import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord,
    decision: AttachmentContextDecision,
    source: 'request' | 'history',
  ): AttachmentContextEvidence {
    return {
      attachmentId: record.attachmentId,
      sourceRequestId: record.requestId,
      ...(record.runId === undefined ? {} : { sourceRunId: record.runId }),
      decision,
      reasonCode:
        decision === 'latest-request-critical'
          ? 'ATTACHMENT_LATEST_REQUIRED_FAILED'
          : decision === 'latest-request-optional'
            ? 'ATTACHMENT_LATEST_OPTIONAL_DEGRADED'
            : decision === 'historical'
              ? 'ATTACHMENT_HISTORICAL_DEGRADED'
              : 'ATTACHMENT_EXCLUDED',
      owningBoundary: source === 'request' ? 'agent-context-engine.attachment-request' : 'agent-context-engine.attachment-history',
      safeIdentifier: `attachment:${record.attachmentId}`,
      projectedInputUnits: estimateAttachmentMetadataTokens(record),
      contentType: record.mediaType,
      fileName: record.fileName,
      mediaType: record.mediaType,
      sizeBytes: record.sizeBytes,
      // Available attachments are materialized by the runtime into the run's
      // temp root at `temp/attachments/{attachmentId}/{fileName}` (see
      // attachment-execution-runtime + request-runtime-composition), regardless
      // of whether they belong to the current request or a prior turn. Expose
      // that logical path so the model can Read the file verbatim instead of
      // discovering a physical path (which carries a run-scoped segment that
      // the Read tool's logical-root remapping would double). Unavailable
      // attachments are not materialized, so no path is exposed.
      ...(record.availabilityStatus === 'AVAILABLE' ? { modelPath: `temp/attachments/${record.attachmentId}/${basename(record.fileName)}` } : {}),
    };
  }

  private hasRetainedControlledReplacement(
    requestMessage: SessionMessageRecord | undefined,
    attachmentId: import('@nextagent/agent-common').AttachmentId,
  ): boolean {
    const replacement = requestMessage?.metadata['replacement'];
    if (!isJsonObject(replacement)) {
      return false;
    }
    const lineage = replacement['lineage'];
    if (isJsonObject(lineage) && lineage['attachmentId'] === attachmentId) {
      return true;
    }
    return replacement['attachmentId'] === attachmentId;
  }

  /**
   * History selection. The invariants this function must keep:
   *
   *  1. Read a single active-context snapshot; do not call
   *     `loadMessages` outside the items in that snapshot.
   *  2. Resolve current-request records first (the root user message
   *     identified by `requestId`, plus the same `requestId`/`runId`
   *     protocol-required messages). If the current request anchor is
   *     unresolvable, fail explicitly.
   *  3. Group prior conversation by `requestId` (root user message
   *     identity) and keep only complete visible turns. A prior turn
   *     must contain a root user message, an ordered tool-use /
   *     capability-result sequence, and a terminal non-tool assistant
   *     response. Hidden replacement, pending tool fragments, and
   *     incomplete turns are excluded as a whole unit.
   *  4. Do not truncate here. The downstream policy owns
   *     `selectedMessageRefs` truncation.
   *  5. Every emitted ref anchors to the same
   *     `activeContextVersion`; refs drawn from different snapshots are
   *     forbidden.
   */
  private async selectHistoryCandidates(input: HistorySelectionInput): Promise<HistorySelectionOutcome> {
    return selectActiveContextHistoryCandidates(input);
  }

  /**
   * Filter prior-turn candidates based on budget evidence and combine
   * with current-request records. When budget evidence is provided,
   * only prior-turn candidates whose `prior_active_history` evidence
   * entry has `status: "omitted"` are filtered out — the rest are
   * preserved. Emits refs in chronological conversation order
   * (oldest prior first, current request last) so the render stage
   * produces a model-input sequence the model can interpret.
   */

  /**
   * Scan loaded history records for oversized CAPABILITY_RESULT content
   * and replace it with a bounded preview in-place. This runs BEFORE
   * budget evaluation so the token estimator sees the preview size
   * (~1KB) instead of the full content (potentially 30KB+), preventing
   * MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET errors. The original content
   * is preserved in the message store for UI/audit access.
   *
   * In-place mutation is required because `currentRequestRecords` and
   * `recordsByMessageId` share the same object references; the budget
   * evaluator iterates `currentRequestRecords` directly.
   */
  private truncateLargeToolResults(outcome: HistorySelectionOutcome): void {
    for (const [, record] of outcome.recordsByMessageId) {
      if (record.role !== 'CAPABILITY_RESULT') {
        continue;
      }
      if (hasReplacementMetadata(record) || isInfinityCapabilityResultRecord(record, this.infinityToolNames)) {
        continue;
      }
      const truncated = truncateToolResultContent(record.content);
      if (truncated !== null) {
        (record as Writable<SessionMessageRecord>).content = truncated;
      }
    }
  }

  private truncateCandidates(outcome: HistorySelectionOutcome, evidence?: readonly ContextBudgetEvidence[]): readonly MessageId[] {
    const current = outcome.currentRequestRecords.map((record) => record.messageId);

    // Build the set of messageIds that the budget policy explicitly omitted.
    // safeIdentifier format: "prior_active_history:{role}:{messageId}"
    const omittedIds = new Set<MessageId>();
    if (evidence !== undefined) {
      for (const entry of evidence) {
        if (entry.category === 'prior_active_history' && entry.status === 'omitted') {
          const parts = entry.safeIdentifier.split(':');
          if (parts.length >= 3) {
            omittedIds.add(parts.slice(2).join(':') as MessageId);
          }
        }
      }
    }

    // Filter prior candidates: remove budget-omitted ones, keep the rest.
    const budgetFilteredPrior = omittedIds.size === 0 ? outcome.priorTurnCandidates : outcome.priorTurnCandidates.filter((id) => !omittedIds.has(id));

    // Ensure tool-call / tool-result pairing integrity after budget
    // filtering. The budget policy omits individual messages, which can
    // break tool-use turns (ASSISTANT_TOOL_USE without its
    // CAPABILITY_RESULT, or vice versa). Remove orphans so the render
    // layer's assertToolPairing won't reject the assembly.
    const pairingFixedPrior = removeToolPairOrphans(budgetFilteredPrior, outcome.recordsByMessageId);

    // Chronological order: oldest prior first, then the
    // current-request records (which are themselves in ordinal order).
    return [...pairingFixedPrior, ...current];
  }

  /**
   * Budget decision gate orchestration (per design D0-D5). Delegates
   * candidate construction to `buildSourceCandidates`, then assembles
   * the policy input and delegates to the injected
   * `ContextBudgetPolicyPort`.
   */
  private runBudgetGate(
    policy: ContextBudgetPolicyPort,
    selectionOutcome: HistorySelectionOutcome,
    visibleCapabilities: readonly CapabilityDescriptor[],
    attachmentEvidence: readonly AttachmentContextEvidence[],
    modelSelection: {
      readonly configuration: ResolvedModelConfiguration;
      readonly modelOptions: ModelInferenceOptions;
    },
    systemPrompt: SystemPrompt,
  ): { readonly outcome: ContextBudgetPolicyOutcome; readonly availableInputUnits: number } {
    const estimator = this.deps.tokenEstimator ?? createDefaultTokenEstimator();
    const window = modelSelection.configuration.contextWindowTokens;
    const reservedOutput = modelSelection.modelOptions?.maxOutputTokens ?? 0;

    const { sourceCandidates, minimumSafeContextUnits } = buildSourceCandidates(
      attachmentEvidence,
      selectionOutcome,
      visibleCapabilities,
      systemPrompt,
      estimator,
      mapRoleToTokenEstimatorRole,
    );

    const availableInputUnits = Math.max(0, window - reservedOutput);
    const policyInput: ContextBudgetPolicyInput = {
      window,
      reservedOutput,
      availableInputUnits,
      minimumSafeContextUnits,
      sourceCandidates,
    };
    const policyOutcome = policy.evaluate(policyInput, new AbortController().signal);
    assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome);
    return { outcome: policyOutcome, availableInputUnits };
  }

  private async selectModel(
    assembly: AgentAssembly,
    request: ContextAssemblyRequest,
    options: ContextAssemblyOptions | undefined,
    signal: AbortSignal,
  ): Promise<{
    readonly configuration: ResolvedModelConfiguration;
    readonly reason: string;
  }> {
    const result = await this.deps.modelSelectionService.select(
      {
        identityContext: request.identityContext,
        agentId: assembly.agentId,
        agentVersion: assembly.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        purpose: SYSTEM_PROMPT,
        flowVariables: request.flowVariables ?? EMPTY_FLOW_VARIABLES,
        mode: options?.mode ?? 'INITIAL',
        ...(request.locale === undefined ? {} : { locale: request.locale }),
        ...(request.capabilityContextPatch?.modelId === undefined ? {} : { modelId: request.capabilityContextPatch.modelId }),
        ...(options?.attemptedModelIds === undefined ? {} : { attemptedModelIds: options.attemptedModelIds }),
      },
      signal,
    );
    if (result.status === 'FAILED') {
      throw new AgentError({
        code: result.failureReason,
        message: 'Model selection failed safely.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    return { configuration: result.configuration, reason: result.reason };
  }
}

function mergeCapabilityModelOptions(base: ModelInferenceOptions, patch?: ModelInferenceOptions): ModelInferenceOptions {
  return mergePromptModelOptions(base, patch);
}

/**
 * Governed Skill disclosure projection for the `skill_disclosure` system
 * section. Mirrors the renderer-era disclosure gates: the `Skill` tool
 * entry (and, in `tool-search` mode, the `ToolSearch` tool entry) must be
 * visible, and the list keeps only AVAILABLE model-invocable Skills with
 * DEFERRED/HIDDEN (list mode) or HIDDEN (tool-search mode) disclosure
 * excluded. Returns an empty list when the tool-entry gate fails, which
 * makes the section render filter omit the section entirely. The builtin
 * default `How to use skills` instruction body is read from the builtin
 * `SYSTEM_PROMPT` template directory markdown file matching the mode, so
 * the default prose is customized by editing markdown rather than code;
 * a missing body file projects an empty body (the section then renders
 * the governed list only).
 */
function skillDisclosureProjection(
  visibleCapabilities: readonly CapabilityDescriptor[],
  mode: SkillDisclosureMode,
): { mode: SkillDisclosureMode; skills: readonly CapabilityDescriptor[]; body: string } {
  const hasTool = (capabilityId: string): boolean =>
    visibleCapabilities.some(
      (capability) => capability.kind === 'TOOL' && capability.capabilityId === capabilityId && capability.availabilityStatus === 'AVAILABLE',
    );
  const body = builtinSkillDisclosureBody(mode);
  if (!hasTool('Skill') || (mode === 'tool-search' && !hasTool('ToolSearch'))) {
    return { mode, skills: [], body };
  }
  const skills = visibleCapabilities.filter(
    (capability) =>
      capability.kind === 'SKILL' &&
      capability.availabilityStatus === 'AVAILABLE' &&
      capability.modelInvocable === true &&
      (mode === 'tool-search' || capability.disclosurePolicy?.mode !== 'DEFERRED') &&
      capability.disclosurePolicy?.mode !== 'HIDDEN',
  );
  return { mode, skills, body };
}

function builtinSkillDisclosureBody(mode: SkillDisclosureMode): string {
  try {
    return readFileSync(join(defaultBuiltinPromptRoot(), 'SYSTEM_PROMPT', `skill-disclosure-${mode}.md`), 'utf8').trimEnd();
  } catch {
    return '';
  }
}

function isActiveContextNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'NOT_FOUND' || code === 'ACTIVE_CONTEXT_NOT_FOUND';
}

/**
 * Sum of every candidate's `estimatedInputUnits` from the budget gate's
 * per-source evidence (selected + omitted + degraded). This is the single
 * source for `estimatedConversationInputUnits` used by the proactive
 * auto-compact threshold; it reuses the budget gate's estimation and MUST
 * NOT be re-derived through a second estimator.
 */
function sumEvidenceUnits(evidence: readonly ContextBudgetEvidence[]): number {
  let sum = 0;
  for (const entry of evidence) {
    sum += entry.estimatedInputUnits;
  }
  return sum;
}

/**
 * Split prior turn candidates into a covered prefix (to be
 * summarized and dropped) and a retained tail (kept verbatim in
 * the active context for conversational continuity).
 *
 * When there are 2+ complete prior turns, the last turn is
 * retained and all preceding turns are covered. When there is
 * only one prior turn, all messages are covered and the
 * retained tail is empty — the summary alone provides continuity.
 */
function splitPriorTurnCandidatesForCompression(outcome: HistorySelectionOutcome): {
  readonly coveredRefs: readonly MessageId[];
  readonly retainedTailRefs: readonly MessageId[];
} {
  const allIds = outcome.priorTurnCandidates;
  if (allIds.length < 2) {
    return { coveredRefs: allIds, retainedTailRefs: [] };
  }

  const records = outcome.recordsByMessageId;
  const turns: MessageId[][] = [];
  let currentTurn: MessageId[] = [];
  let lastRequestId: string | undefined;

  for (const id of allIds) {
    const record = records.get(id);
    const reqId = record?.requestId;
    if (reqId !== undefined && reqId !== lastRequestId) {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [];
      lastRequestId = reqId;
    }
    currentTurn.push(id);
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  if (turns.length < 2) {
    return { coveredRefs: allIds, retainedTailRefs: [] };
  }

  const coveredRefs = turns.slice(0, -1).flat();
  const retainedTailRefs = turns[turns.length - 1]!;
  return { coveredRefs, retainedTailRefs: [...retainedTailRefs] };
}

/**
 * Remove orphaned tool-call / tool-result messages after budget
 * filtering. The budget policy omits individual messages, which can
 * break tool-use turns (an ASSISTANT tool-call without its
 * CAPABILITY_RESULT, or vice versa). Any such orphan is removed so the
 * render layer's `assertToolPairing` won't reject the assembly with
 * `CONTEXT_RENDER_TOOL_PAIRING_INVALID`.
 *
 * This is a fixpoint computation, NOT a single two-pass sweep. Removing
 * a producer can orphan its consumers, and removing a consumer can
 * orphan its producer (an ASSISTANT whose tool-call now has no result).
 * The earlier two-pass implementation computed the produced/consumed
 * ID sets once from the original list, then removed messages
 * independently — so a multi-tool-call ASSISTANT removed for a missing
 * result still left its *other* results in the list (their IDs were in
 * the stale produced set), producing orphan TOOL messages that crashed
 * the renderer. We now recompute the produced/consumed sets from the
 * surviving list each pass and repeat until no further message is
 * dropped. Terminates because each non-stable pass removes at least one
 * message from a finite list.
 */
function removeToolPairOrphans(ids: readonly MessageId[], records: ReadonlyMap<MessageId, SessionMessageRecord>): MessageId[] {
  let current: MessageId[] = [...ids];

  let changed = true;
  while (changed) {
    changed = false;

    // Recompute produced/consumed IDs from the SURVIVING set this pass.
    const producedToolCallIds = new Set<string>();
    const consumedToolCallIds = new Set<string>();
    for (const id of current) {
      const record = records.get(id);
      if (record === undefined) {
        continue;
      }
      if (record.role === 'ASSISTANT') {
        for (const tcId of toolCallIds(record)) {
          producedToolCallIds.add(tcId);
        }
      } else if (record.role === 'CAPABILITY_RESULT') {
        const tcId = toolResultId(record);
        if (tcId !== undefined) {
          consumedToolCallIds.add(tcId);
        }
      }
    }

    // Remove messages whose tool pairing is broken given the surviving set.
    const next: MessageId[] = [];
    for (const id of current) {
      const record = records.get(id);
      if (record === undefined) {
        next.push(id);
        continue;
      }

      if (record.role === 'ASSISTANT') {
        const callIds = toolCallIds(record);
        // Keep if no tool calls, or if ALL tool calls have matching results.
        if (callIds.length === 0 || callIds.every((tcId) => consumedToolCallIds.has(tcId))) {
          next.push(id);
        } else {
          changed = true; // orphan tool call — drop
        }
      } else if (record.role === 'CAPABILITY_RESULT') {
        const tcId = toolResultId(record);
        // Keep only if its producing tool-call still survives.
        if (tcId === undefined || producedToolCallIds.has(tcId)) {
          next.push(id);
        } else {
          changed = true; // orphan tool result — drop
        }
      } else {
        next.push(id);
      }
    }
    current = next;
  }

  return current;
}

/** Utility: strip readonly modifiers for in-place mutation of records. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Render a bounded preview for oversized content. Truncates to
 * `previewMaxChars` and wraps in a model-readable marker.
 */
function renderBoundedPreview(content: string): string {
  const maxChars = LARGE_CONTENT_THRESHOLDS.previewMaxChars;
  const head = content.length <= maxChars ? content : content.slice(0, maxChars);
  const truncated = content.length > maxChars;
  return [
    '<large-content-preview>',
    `Original size: ${content.length} chars`,
    head,
    truncated ? '\n… (truncated)' : '',
    '</large-content-preview>',
  ].join('\n');
}

/**
 * Truncate a CAPABILITY_RESULT record's content if it exceeds the
 * inline threshold. Preserves the JSON tool-result structure
 * (toolCallId / toolName) by replacing only the payload field.
 *
 * @returns the truncated content string, or `null` if no truncation needed.
 */
function truncateToolResultContent(rawContent: string): string | null {
  const decision = classifyReplacement({ content: rawContent, originalSize: rawContent.length });
  if (decision.kind !== 'PERSISTED_PREVIEW') {
    return null;
  }
  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.toolCallId === 'string') {
      const payloadStr = typeof parsed.payload === 'string' ? parsed.payload : JSON.stringify(parsed.payload);
      parsed.payload = { preview: renderBoundedPreview(payloadStr ?? rawContent) };
      return JSON.stringify(parsed);
    }
  } catch {
    /* not valid JSON — fall through to full content replacement */
  }
  return renderBoundedPreview(rawContent);
}

/**
 * Post-process rendered TOOL messages to replace oversized tool-result
 * outputs with bounded previews. Runs after the model-input renderer
 * because render loads fresh records from messageStore (original
 * content), not from the truncated in-memory recordsByMessageId.
 */
function truncateRenderedToolResults(messages: readonly ModelMessage[], infinityToolNames: ReadonlySet<string>): void {
  for (const message of messages) {
    if (message.role !== 'TOOL' || !Array.isArray(message.content)) {
      continue;
    }
    for (let i = 0; i < message.content.length; i++) {
      const part = message.content[i];
      if (part === undefined || part.type !== 'tool-result') {
        continue;
      }
      if (part.toolName !== undefined && infinityToolNames.has(part.toolName)) {
        continue;
      }
      const outputStr = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
      const decision = classifyReplacement({ content: outputStr, originalSize: outputStr.length });
      if (decision.kind !== 'PERSISTED_PREVIEW') {
        continue;
      }
      (message.content as Writable<ModelMessage['content']>)[i] = {
        ...part,
        output: { preview: renderBoundedPreview(outputStr) },
      };
    }
  }
}

function enforceRenderedRagCompaction(
  messages: readonly ModelMessage[],
  selectedMessageRefs: readonly MessageId[],
  recordsById: ReadonlyMap<MessageId, SessionMessageRecord>,
  compactedIds: ReadonlySet<string>,
): void {
  const remainingByToolCall = new Map<string, number>();
  for (const messageId of selectedMessageRefs) {
    if (!compactedIds.has(messageId)) {
      continue;
    }
    const record = recordsById.get(messageId);
    if (record?.role !== 'CAPABILITY_RESULT') {
      continue;
    }
    const parsed = parseJsonObject(record.content);
    const toolName = typeof record.metadata['toolName'] === 'string' ? record.metadata['toolName'] : parsed?.toolName;
    if (typeof toolName !== 'string' || toolName.toLowerCase() !== 'rag') {
      continue;
    }
    const toolCallId = typeof record.metadata['toolCallId'] === 'string' ? record.metadata['toolCallId'] : parsed?.toolCallId;
    if (typeof toolCallId !== 'string') {
      continue;
    }
    const key = `${toolName.toLowerCase()}\0${toolCallId}`;
    remainingByToolCall.set(key, (remainingByToolCall.get(key) ?? 0) + 1);
  }

  for (const message of messages) {
    if (message.role !== 'TOOL') {
      continue;
    }
    for (let index = 0; index < message.content.length; index += 1) {
      const part = message.content[index];
      if (part?.type !== 'tool-result') {
        continue;
      }
      const key = `${part.toolName.toLowerCase()}\0${part.toolCallId}`;
      const remaining = remainingByToolCall.get(key) ?? 0;
      if (remaining === 0) {
        continue;
      }
      (message.content as Writable<ModelMessage['content']>)[index] = {
        ...part,
        output: { compacted: renderPreviousTurnRagPlaceholder() },
      };
      if (remaining === 1) {
        remainingByToolCall.delete(key);
      } else {
        remainingByToolCall.set(key, remaining - 1);
      }
    }
  }
}

function isCompleteVisibleTurn(unit: readonly SessionMessageRecord[]): boolean {
  if (unit.length === 0) {
    return false;
  }
  const first = unit[0]!;
  // A leading SUMMARY is a valid turn start (see active-context-selector.ts
  // for the live copy): it represents an already-compressed prior-history
  // prefix and must stay in prior history instead of being dropped.
  if (isHiddenReplacement(first) || (first.role !== 'USER' && first.role !== 'SUMMARY')) {
    return false;
  }
  for (const record of unit) {
    // ASSISTANT_TOOL_USE messages carry visible=false as an
    // in-flight marker; the render layer explicitly allows
    // them via isModelVisibleMessage. History selection must
    // not reject them as "hidden replacements" — that would
    // silently drop complete tool turns from prior history.
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
  const hasOpenToolUse = Array.isArray(parsed?.toolCalls) && parsed.toolCalls.length > 0;
  if (hasOpenToolUse) {
    return false;
  }
  if (!hasOrderedToolProtocol(unit)) {
    return false;
  }
  return true;
}

function hasReplacementMetadata(record: SessionMessageRecord): boolean {
  return isJsonObject(record.metadata['replacement']);
}

function isInfinityCapabilityResultRecord(record: SessionMessageRecord, infinityToolNames: ReadonlySet<string>): boolean {
  const metadataToolName = record.metadata['toolName'];
  if (typeof metadataToolName === 'string' && infinityToolNames.has(metadataToolName)) {
    return true;
  }
  const parsed = parseJsonObject(record.content);
  return typeof parsed?.toolName === 'string' && infinityToolNames.has(parsed.toolName);
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

function readForkPromotedContentRef(message: SessionMessage): string | undefined {
  if (message.role !== 'CAPABILITY_RESULT') {
    return undefined;
  }
  const replacement = message.metadata['replacement'];
  if (!isJsonObject(replacement) || replacement['kind'] !== 'PERSISTED_PREVIEW') {
    return undefined;
  }
  const contentRef = replacement['contentRef'];
  if (!isJsonObject(contentRef) || contentRef['refType'] !== 'CAPABILITY_RESULT' || typeof contentRef['refId'] !== 'string') {
    return undefined;
  }
  return contentRef['refId'].startsWith('fork-promoted:') ? contentRef['refId'] : undefined;
}

function replaceForkPromotedCapabilityPayload(content: string, text: string): string | undefined {
  const parsed = parseJsonObject(content);
  if (typeof parsed?.toolCallId !== 'string' || typeof parsed.toolName !== 'string') {
    return undefined;
  }
  return JSON.stringify({
    ...parsed,
    payload: { content: text },
  });
}

function estimateAttachmentMetadataTokens(record: import('@nextagent/agent-contracts/gateway').RequestAttachmentRecord): number {
  const fileName = record.fileName ?? '';
  const mediaType = record.mediaType ?? '';
  const sizeBytes = record.sizeBytes ?? 0;
  const path = record.availabilityStatus === 'AVAILABLE' ? `temp/attachments/${record.attachmentId}/${fileName}` : '';
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  const text = `- ${fileName} (${mediaType}, ${sizeMB}MB)${path.length > 0 ? ` — read with the Read tool at path: ${path}` : ''}`;
  return Math.ceil(text.length / 4);
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function hasOrderedToolProtocol(unit: readonly SessionMessageRecord[]): boolean {
  const expected: string[] = [];
  for (const record of unit) {
    if (record.role === 'ASSISTANT') {
      const ids = toolCallIds(record);
      for (const id of ids) {
        expected.push(id);
      }
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

function isModelVisibleMessage(record: { readonly visible: boolean; readonly role: string; readonly metadata: JsonObject }): boolean {
  // Render-side visibility filter. `record.visible` is the default switch, but
  // in-flight tool-use ASSISTANT messages are written by the runtime with
  // `visible: false` and `metadata.kind = "ASSISTANT_TOOL_USE"` until the
  // surrounding turn finishes; they MUST still reach the model so the next
  // model call sees its own tool call alongside the matching capability_result.
  // This is a render-stage concern (not a history-selection concern): history
  // selection already keeps these messages as part of currentRequestRecords
  // (same requestId / runId, protocol-required role).
  // A page-hidden message carrying `metadata.modelVisibility.included=true`
  // (e.g. a directed-Skill body persisted as a `visible:false` USER message)
  // MUST also reach the model — `included` is the inverse of `excluded`,
  // admitting a page-hidden message into model context so the loaded Skill
  // instructions stay in place across rounds while staying off the conversation
  // page.
  const modelVisibility = record.metadata['modelVisibility'];
  return (
    record.visible ||
    (record.role === 'ASSISTANT' && record.metadata['kind'] === 'ASSISTANT_TOOL_USE') ||
    (isJsonObject(modelVisibility) && modelVisibility['included'] === true)
  );
}

export function createDefaultContextEngine(deps: DefaultContextEngineDependencies): DefaultContextEngine {
  return new DefaultContextEngine(deps);
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isModelToolCall(value: unknown): value is ModelToolCall {
  return isJsonObject(value) && typeof value.toolCallId === 'string' && typeof value.toolName === 'string' && isJsonObject(value.arguments);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapRoleToTokenEstimatorRole(role: string): 'system' | 'user' | 'assistant' | 'tool' {
  switch (role) {
    case 'USER':
      return 'user';
    case 'ASSISTANT':
      return 'assistant';
    case 'CAPABILITY_RESULT':
      return 'tool';
    case 'SUMMARY':
    default:
      return 'system';
  }
}
