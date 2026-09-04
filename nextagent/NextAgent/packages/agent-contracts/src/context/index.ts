import type {
  AgentId,
  AgentVersion,
  AttachmentId,
  EpochMillis,
  IdentityContext,
  JsonObject,
  MessageContentType,
  MessageId,
  RequestContextId,
  RequestLocale,
  RequestRunId,
  SessionId,
  SessionMessageRole,
  SubjectId,
  TenantId,
} from '@nextagent/agent-common';
import { Type } from '@sinclair/typebox';
import type { CapabilityContextPatch, CapabilityDescriptor, CapabilityGeneratedMessage } from '../capability/index.js';
import {
  ModelIdSchema,
  ModelInferenceOptionsSchema,
  ResolvedModelConfigurationSchema,
  type ModelInferenceOptions,
  type ModelMessage,
  type ModelToolDescriptor,
  type ResolvedModelConfiguration,
} from '../model/index.js';
import type { SessionMessage } from '../session/index.js';
import type { SystemReminder } from '../system-reminder/index.js';

const PromptPurposeSchema = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' });
const PromptScopeIdSchema = Type.String({ minLength: 1, maxLength: 256, pattern: '^(?=.*\\S)[^\\u0000-\\u001F\\u007F-\\u009F]+$' });
const PromptFlowVariableKeySchema = Type.String({ minLength: 1, maxLength: 128 });

export interface PromptTemplateResolveRequest {
  readonly purpose: string;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly locale?: RequestLocale;
  readonly flowVariables: Readonly<Record<string, string>>;
  readonly selectedModel: {
    readonly modelId: string;
  };
  readonly memoryEnabled?: boolean;
}

export interface PromptTemplateRenderedSection {
  readonly id: string;
  readonly content: string;
}

export type PromptTemplateResolveResult =
  | {
      readonly status: 'RESOLVED';
      readonly templateId: string;
      readonly templateRef: string;
      readonly sections: readonly PromptTemplateRenderedSection[];
      readonly renderedContent: string;
      readonly modelOptions?: ModelInferenceOptions;
    }
  | {
      readonly status: 'NOT_FOUND';
    };

export interface PromptTemplateResolverPort {
  resolve: (request: PromptTemplateResolveRequest, signal: AbortSignal) => Promise<PromptTemplateResolveResult>;
}

export const PromptTemplateResolveRequestSchema = Type.Object(
  {
    purpose: PromptPurposeSchema,
    agentId: PromptScopeIdSchema,
    agentVersion: PromptScopeIdSchema,
    locale: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: '^[^\\u0000-\\u001F\\u007F]+$' })),
    flowVariables: Type.Record(PromptFlowVariableKeySchema, Type.String()),
    selectedModel: Type.Object({ modelId: ModelIdSchema }, { additionalProperties: false }),
    memoryEnabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const PromptTemplateResolveResultSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal('RESOLVED'),
      templateId: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
      templateRef: Type.String({ minLength: 1, maxLength: 1024 }),
      sections: Type.Array(
        Type.Object(
          {
            id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
            content: Type.String(),
          },
          { additionalProperties: false },
        ),
      ),
      renderedContent: Type.String(),
      modelOptions: Type.Optional(ModelInferenceOptionsSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object({ status: Type.Literal('NOT_FOUND') }, { additionalProperties: false }),
]);

export type ModelSelectionMode = 'INITIAL' | 'FALLBACK';
export type ModelSelectionReason = 'EXPLICIT_MODEL_ID' | 'AGENT_DEFAULT' | 'FIRST_ELIGIBLE' | 'FALLBACK_NEXT_ELIGIBLE';
export type ModelSelectionFailureReason =
  'AGENT_ASSEMBLY_MISMATCH' | 'MODEL_ID_NOT_ELIGIBLE' | 'NO_AVAILABLE_MODEL' | 'FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED' | 'FALLBACK_EXHAUSTED';

export interface ModelSelectionRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly purpose: string;
  readonly flowVariables: Readonly<Record<string, string>>;
  readonly mode: ModelSelectionMode;
  readonly locale?: RequestLocale;
  readonly modelId?: string;
  readonly attemptedModelIds?: readonly string[];
}

export type ModelSelectionResult =
  | {
      readonly status: 'SELECTED';
      readonly reason: ModelSelectionReason;
      readonly configuration: ResolvedModelConfiguration;
    }
  | {
      readonly status: 'FAILED';
      readonly failureReason: ModelSelectionFailureReason;
    };

export interface ModelSelectionService {
  select: (request: ModelSelectionRequest, signal: AbortSignal) => Promise<ModelSelectionResult>;
}

export interface ContextAssemblyOptions {
  readonly mode: ModelSelectionMode;
  readonly attemptedModelIds?: readonly string[];
}

const ContextSafeStringSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: '^(?=.*\\S)[^\\u0000-\\u001F\\u007F-\\u009F]+$',
});

const IdentityContextSchema = Type.Object(
  {
    tenantId: ContextSafeStringSchema,
    subjectId: ContextSafeStringSchema,
    displayName: Type.Optional(ContextSafeStringSchema),
  },
  { additionalProperties: false },
);

export const ModelSelectionRequestSchema = Type.Object(
  {
    identityContext: IdentityContextSchema,
    agentId: ContextSafeStringSchema,
    agentVersion: ContextSafeStringSchema,
    agentAssemblyRef: ContextSafeStringSchema,
    purpose: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
    flowVariables: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.String()),
    mode: Type.Union([Type.Literal('INITIAL'), Type.Literal('FALLBACK')]),
    locale: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 64,
        pattern: '^[^\\u0000-\\u001F\\u007F]+$',
      }),
    ),
    modelId: Type.Optional(ModelIdSchema),
    attemptedModelIds: Type.Optional(Type.Array(ModelIdSchema, { minItems: 1, uniqueItems: true })),
  },
  {
    additionalProperties: false,
    allOf: [
      {
        if: { properties: { mode: { const: 'INITIAL' } }, required: ['mode'] },
        then: { not: { required: ['attemptedModelIds'] } },
      },
      {
        if: { properties: { mode: { const: 'FALLBACK' } }, required: ['mode'] },
        then: { required: ['attemptedModelIds'] },
      },
    ],
  },
);

export const ModelSelectionResultSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal('SELECTED'),
      reason: Type.Union([
        Type.Literal('EXPLICIT_MODEL_ID'),
        Type.Literal('AGENT_DEFAULT'),
        Type.Literal('FIRST_ELIGIBLE'),
        Type.Literal('FALLBACK_NEXT_ELIGIBLE'),
      ]),
      configuration: ResolvedModelConfigurationSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal('FAILED'),
      failureReason: Type.Union([
        Type.Literal('AGENT_ASSEMBLY_MISMATCH'),
        Type.Literal('MODEL_ID_NOT_ELIGIBLE'),
        Type.Literal('NO_AVAILABLE_MODEL'),
        Type.Literal('FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED'),
        Type.Literal('FALLBACK_EXHAUSTED'),
      ]),
    },
    { additionalProperties: false },
  ),
]);

export const ContextAssemblyOptionsSchema = Type.Object(
  {
    mode: Type.Union([Type.Literal('INITIAL'), Type.Literal('FALLBACK')]),
    attemptedModelIds: Type.Optional(Type.Array(ModelIdSchema, { minItems: 1, uniqueItems: true })),
  },
  {
    additionalProperties: false,
    allOf: [
      {
        if: { properties: { mode: { const: 'INITIAL' } }, required: ['mode'] },
        then: { not: { required: ['attemptedModelIds'] } },
      },
      {
        if: { properties: { mode: { const: 'FALLBACK' } }, required: ['mode'] },
        then: { required: ['attemptedModelIds'] },
      },
    ],
  },
);

export interface ContextAssemblyRequest {
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestContextId: RequestContextId;
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly runId: RequestRunId;
  readonly stepId: string;
  readonly locale: RequestLocale;
  readonly purpose: string;
  readonly flowVariables?: Readonly<Record<string, string>>;
  readonly capabilityGeneratedMessages?: readonly CapabilityGeneratedMessage[];
  readonly capabilityContextPatch?: CapabilityContextPatch;
  /**
   * System reminders collected during assembly for the renderer to wrap and
   * inject into `messages`. Turn-scoped transient input: the renderer wraps
   * each reminder in a `<system-reminder>` tag and inserts it before the last
   * USER message. When omitted or empty, the render pipeline is a no-op.
   * Producers that run after render (e.g. the BEFORE_MODEL_INVOKE memory-recall
   * trusted terminal hook) call `wrapInSystemReminder` directly instead of
   * going through this field; both paths share the same wrapping primitive.
   */
  readonly systemReminders?: readonly SystemReminder[];
}

export interface ContextAssembly {
  readonly request: ContextAssemblyRequest;
  readonly systemPrompt: SystemPrompt;
  readonly promptTemplateRef?: string;
  readonly promptTemplateVersion?: string;
  readonly selectedMessageRefs: readonly MessageId[];
  readonly visibleCapabilities: readonly CapabilityDescriptor[];
  readonly modelConfiguration: ResolvedModelConfiguration;
  readonly modelOptions: ModelInferenceOptions;
  readonly modelSelectionReason: string;
  readonly compressionEvidence?: ContextCompressionEvidence;
  readonly attachmentEvidence?: readonly AttachmentContextEvidence[];
  /**
   * Safe, model-visible controlled content projections for
   * current-request attachments. Each block is already presentation-safe
   * and must not contain blob refs or raw storage coordinates.
   */
  readonly attachmentContentBlocks?: readonly string[];
  readonly attachmentDegradationEvidence?: readonly AttachmentDegradationEvidence[];
  /**
   * Budget decision plan from the budget decision gate. Present when a
   * `ContextBudgetPolicyPort` is composed into the engine; absent otherwise
   * (backward-compatible default for callers / tests that do not exercise
   * the budget gate). Downstream consumers (compression, prompt-shaping
   * render, large-content handling, runtime degradation projection) MUST
   * act on `plan.decision` without re-deriving budget math.
   */
  readonly budgetPlan?: ContextCompactionPlan;
  /**
   * Per-source-category evidence emitted alongside `budgetPlan`. Always
   * carried together: either both fields are present or both absent.
   * Safe-to-publish content only (no raw prompt / message / tool /
   * attachment / path / credential / high-cardinality identifier).
   */
  readonly budgetEvidence?: readonly ContextBudgetEvidence[];
  /**
   * Per-role-group (system / user / assistant / tool) evidence, projected
   * from `budgetEvidence` by the policy. Useful for observability and
   * audit; downstream prompt assembly should still treat `budgetPlan`
   * as the controlling decision.
   */
  readonly budgetRoleEvidence?: readonly ContextRoleEvidence[];
}

export interface RenderedModelInput {
  readonly requestContextId: RequestContextId;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDescriptor[];
  readonly modelConfiguration: ResolvedModelConfiguration;
  readonly modelOptions: ModelInferenceOptions;
  readonly providerOptions?: JsonObject;
}

export interface ModelInputRenderRequest {
  readonly assembly: ContextAssembly;
  readonly selectedMessages: readonly SessionMessage[];
  readonly providerOptions?: JsonObject;
  readonly maxGeneratedMessageChars?: number;
}

export interface ModelInputRenderer {
  render: (request: ModelInputRenderRequest) => Promise<RenderedModelInput>;
}

export interface SystemPromptSectionMetadata {
  readonly overridable: boolean;
  // Legacy template-internal key. NOT a public section identifier: prompt
  // shaping must use the top-level `SystemPromptSection.sectionId` and never
  // treat `sectionKey` as a replacement for it.
  readonly sectionKey?: string;
  readonly order: number;
  readonly dependencies: readonly string[];
}

export interface SystemPromptSection {
  readonly sectionId: string;
  readonly heading: string;
  readonly content: string;
  readonly metadata: SystemPromptSectionMetadata;
}

export interface SystemPrompt {
  readonly sections: readonly SystemPromptSection[];
}

/**
 * Stable marker text that separates the stable section block from
 * the dynamic section block in the rendered system message. The
 * marker is a textual boundary, NOT a section in the taxonomy
 * (the section list is owned by the context-engine system policy).
 */
export const SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER = '---[CACHE_BOUNDARY]---';

export interface ContextEnginePort {
  assemble: (request: ContextAssemblyRequest, options: ContextAssemblyOptions | undefined, signal: AbortSignal) => Promise<ContextAssembly>;
  render: (assembly: ContextAssembly) => Promise<RenderedModelInput>;
}

export interface ForkActiveContextMessage {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly messageId: MessageId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId?: RequestRunId;
  readonly role: SessionMessageRole;
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly metadata: JsonObject;
  readonly visible: boolean;
  readonly createdAt: EpochMillis;
}

export interface ForkActiveContextSelectionRequest {
  readonly childSessionId: SessionId;
  readonly childAnchorMessageId: MessageId;
  readonly copiedMessages: readonly ForkActiveContextMessage[];
}

export interface ForkActiveContextSelectionResult {
  readonly messageIds: readonly MessageId[];
}

export interface ForkActiveContextSelectionPort {
  select: (request: ForkActiveContextSelectionRequest) => Promise<ForkActiveContextSelectionResult>;
}

export interface TraceableSummaryGenerationRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly locale: RequestLocale;
  readonly purpose: string;
  readonly flowVariables: Readonly<Record<string, string>>;
  readonly coveredMessages: readonly SessionMessage[];
  readonly coveredMessageRefs: readonly MessageId[];
  readonly retainedTailMessageRefs: readonly MessageId[];
  readonly targetBudgetUnits: number;
  readonly abortSignal?: AbortSignal;
}

export type TraceableSummaryGenerationMode = 'normal';

export interface TraceableSummaryDraft {
  readonly content: string;
  readonly sourceReferences: readonly MessageId[];
  readonly historyLookupLinkage: readonly MessageId[];
  readonly rehydrationHints: readonly string[];
  readonly generationMode: TraceableSummaryGenerationMode;
  readonly promptTemplateVersion: string;
  readonly inputUnitEstimate: number;
  readonly outputUnitEstimate: number;
}

export interface TraceableSummaryGenerationPort {
  generate: (request: TraceableSummaryGenerationRequest) => Promise<TraceableSummaryDraft>;
}

export type AttachmentContextDecision = 'latest-request-critical' | 'latest-request-optional' | 'historical' | 'excluded';

export interface AttachmentContextEvidence {
  readonly attachmentId: AttachmentId;
  readonly sourceRequestId: MessageId;
  readonly sourceRunId?: RequestRunId;
  readonly decision: AttachmentContextDecision;
  readonly reasonCode: string;
  readonly owningBoundary: string;
  readonly safeIdentifier: string;
  readonly projectedInputUnits: number;
  readonly contentType?: string;
  readonly degradationEvidence?: AttachmentDegradationEvidence;
  readonly fileName?: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  /**
   * Model-visible logical workspace path the model can pass verbatim to the
   * Read tool to read this attachment's materialized content. Set for every
   * attachment materialized into the run's temp root (available current-request
   * and historical attachments); not set for attachments whose
   * `availabilityStatus` is not `AVAILABLE`. Carries no storage handle,
   * BlobRef, or absolute filesystem path.
   */
  readonly modelPath?: string;
}

export interface AttachmentDegradationEvidence {
  readonly safeReasonCode: string;
  readonly projectionKind: 'controlled-markdown' | 'metadata-only' | 'omitted' | 'failure';
  readonly budgetPressure?: number;
  readonly readable?: boolean;
  readonly reason?: string;
}

export interface ContextCompressionEvidence {
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly stepId: string;
  readonly sourceActiveContextVersion: number;
  readonly targetActiveContextVersion: number;
  readonly summaryMessageId: MessageId;
  readonly strategy: 'PREFIX_COMPACT_RECENT_TAIL';
  readonly coveredMessageRefCount: number;
  readonly retainedTailRefCount: number;
  readonly safeReason: string;
  readonly edgeLabel: 'CONTEXT_COMPACTED_EVIDENCE';
}

/**
 * Provider-neutral token estimator. Used by budget / prompt-shaping / memory /
 * capability consumers in the context-engine pipeline to size content against
 * `ModelProfile.contextWindowTokens`. The default implementation lives in
 * `agent-context-engine` and uses code-point-aware heuristic weighting; precise
 * provider-specific tokenizers can replace the implementation via app
 * composition without changing this interface shape.
 *
 * Contract invariants every implementation MUST keep:
 *   - empty input returns 0
 *   - non-empty input returns a positive integer (no fractional, no negative,
 *     no NaN)
 *   - estimateTokensBatch is semantically equivalent to summing the per-text
 *     estimates (implementations MAY internally optimize)
 *   - estimateToolMessageTokens overhead MUST be greater than or equal to
 *     estimateMessageTokens overhead for the same content (tool messages carry
 *     more protocol fields)
 */
export interface TokenEstimator {
  estimateTokens: (text: string) => number;
  estimateMessageTokens: (role: 'system' | 'user' | 'assistant' | 'tool', content: string) => number;
  estimateToolMessageTokens: (toolCallId: string, toolName: string, content: string) => number;
  estimateTokensBatch: (texts: readonly string[]) => number;
}

// =============================================================================
// Budget explainability contracts
//
// Defined per `add-ts-context-budget-explainability` spec (capabilities:
// `context-engine`, `query-policy`, `ts-run-status-visibility`). The decision
// gate is owned by `agent-context-engine`; the policy port allows app
// composition to inject a replacement implementation while a fixed set of
// invariants survives policy replacement.
//
// All evidence and plan fields MUST be presentation-safe — no raw prompt text,
// no raw message content, no raw tool args / results, no attachment content,
// no local paths, no credentials, no high-cardinality identifiers.
// =============================================================================

/**
 * Source-category vocabulary for budget accounting and evidence.
 * Stable enum: extending requires a contract refinement change so that
 * downstream consumers (Query Policy, observability, runtime degradation
 * projection, audit) keep a single source of truth.
 */
export type ContextSourceCategory =
  | 'current_request'
  | 'prior_active_history'
  | 'summary_replacement'
  | 'attachment_projection'
  | 'capability_disclosure'
  | 'large_capability_result'
  | 'runtime_context'
  | 'project_instruction'
  | 'memory_disclosure'
  | 'system_reminder';

/**
 * Per-source disposition status. Used in `ContextBudgetEvidence.status`.
 */
export type ContextSourceStatus = 'selected' | 'omitted' | 'degraded';

/**
 * Role-level disposition status. Used in `ContextRoleEvidence.status`.
 * Richer than source status because role-level decisions can express compression
 * and excerpting outcomes.
 */
export type ContextRoleStatus = 'selected' | 'protected' | 'compressed' | 'summarized' | 'excerpted' | 'referenced' | 'omitted' | 'rejected';

/**
 * Safe reason-code vocabulary. Replacement policies MAY add new codes but MUST
 * preserve the semantics of the codes already listed here so downstream
 * consumers can match them stably.
 */
export type BudgetReasonCode =
  | 'WITHIN_BUDGET'
  | 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET'
  | 'HISTORY_DEGRADED_TO_BUDGET'
  | 'HISTORY_OMITTED_TO_BUDGET'
  | 'LARGE_CAPABILITY_RESULT_DEGRADED'
  | 'SUMMARY_REPLACED'
  | 'ATTACHMENT_LATEST_REQUIRED_FAILED'
  | 'ATTACHMENT_LATEST_OPTIONAL_DEGRADED'
  | 'ATTACHMENT_HISTORICAL_DEGRADED'
  | 'ATTACHMENT_EXCLUDED'
  | 'PRE_SEND_CHECK_REQUIRED'
  | 'INSUFFICIENT_CONTEXT';

/**
 * Compression handoff mode for the compression sibling change. `none` is the
 * baseline; richer modes are added by `add-ts-context-compression` /
 * `add-ts-traceable-summary-generation` consumers.
 */
export type CompressionMode = 'none' | 'summary_prefix_compact' | 'summary_full';

/**
 * Degradation flags carried on `ContextCompactionPlan.degradationMode`.
 * Multi-valued set semantics: an empty array means no degradation. Common
 * combination: `["PRE_SEND_CHECK_REQUIRED"]` when residual pressure passes the
 * pre-send threshold.
 */
export type DegradationFlag = 'PRE_SEND_CHECK_REQUIRED' | 'OUTPUT_WINDOW_CONTINUATION' | 'OUTPUT_WINDOW_PARTIAL_RESULT' | 'OUTPUT_WINDOW_FAILURE';

/**
 * Stable decision discriminator on the compaction plan. Downstream consumers
 * MUST be able to act on this enum without re-deriving budget math.
 *   - `continue`: no overflow, send as-is
 *   - `compact_degrade`: history degraded / omitted but result still fits
 *   - `pre_send_check_required`: residual pressure passes the pre-send threshold
 *   - `explicit_failure`: minimum safe context cannot fit; insufficient-context
 *     outcome required
 */
export type ContextCompactionDecision = 'continue' | 'compact_degrade' | 'pre_send_check_required' | 'explicit_failure';

/**
 * Input candidate for the policy port. Each candidate represents one
 * source-category contribution to the assembly. The `priority` field is the
 * decisive invariant: `required` candidates MUST be selected (no policy can
 * omit them); `optional` candidates compete for the prior-history budget.
 *
 * `safeIdentifier` MUST be a low-cardinality safe label (e.g.,
 * `"prior_active_history:5_turns"`), not a high-cardinality id or raw content.
 */
export interface ContextSourceCandidate {
  readonly category: ContextSourceCategory;
  readonly estimatedInputUnits: number;
  readonly safeIdentifier: string;
  readonly owningBoundary: string;
  readonly priority: 'required' | 'optional';
}

/**
 * Per-source-category evidence emitted by the policy port.
 */
export interface ContextBudgetEvidence {
  readonly category: ContextSourceCategory;
  readonly estimatedInputUnits: number;
  readonly status: ContextSourceStatus;
  readonly reasonCode: BudgetReasonCode;
  readonly owningBoundary: string;
  readonly safeIdentifier: string;
}

/**
 * Per-role-group evidence. Roles map to prompt assembly groups:
 *   - `system`: system prompt sections
 *   - `user`: current request + selected prior user messages
 *   - `assistant`: assistant responses (including tool_use)
 *   - `tool`: capability results
 */
export interface ContextRoleEvidence {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly status: ContextRoleStatus;
  readonly reasonCode: BudgetReasonCode;
}

/**
 * The decision contract the policy port produces. Downstream consumers
 * (compression, prompt-shaping render, large-content) consume the plan and
 * MUST NOT re-derive budget math themselves.
 */
export interface ContextCompactionPlan {
  readonly decision: ContextCompactionDecision;
  readonly reasonCode: BudgetReasonCode;
  readonly compressionMode: CompressionMode;
  readonly degradationMode: readonly DegradationFlag[];
  readonly pipelineStageStoppedAt: string;
  readonly estimatedFinalInputUnits: number;
  readonly omittedContextTypes: readonly ContextSourceCategory[];
}

/**
 * Input to the budget decision gate's policy port. The gate (owned by
 * Context Engine `assemble()`) is responsible for assembling this input;
 * the policy is a pure function from input to outcome.
 *
 * `window` is the model context window size in tokens (from
 * `ModelProfile.contextWindowTokens`). `reservedOutput` is the configured
 * output budget (from `ModelInferenceOptions.maxOutputTokens`).
 * `availableInputUnits = window - reservedOutput - fixed-prompt-slots`.
 *
 * `minimumSafeContextUnits` is the hard baseline (root user message +
 * current-request protocol-required messages + latest-request-required
 * attachment) that any policy MUST NOT drop or place under the
 * prior-history cap.
 */
export interface ContextBudgetPolicyInput {
  readonly availableInputUnits: number;
  readonly minimumSafeContextUnits: number;
  readonly sourceCandidates: readonly ContextSourceCandidate[];
  readonly window: number;
  readonly reservedOutput: number;
}

/**
 * Outcome of the policy port. Carries the compaction plan, per-source
 * evidence, and per-role evidence in one object.
 */
export interface ContextBudgetPolicyOutcome {
  readonly plan: ContextCompactionPlan;
  readonly evidence: readonly ContextBudgetEvidence[];
  readonly roleEvidence: readonly ContextRoleEvidence[];
}

/**
 * Pluggable policy port for context budget allocation and degradation.
 * Injected once by app composition per process; replacement policies MAY
 * redefine budget ratios, degradation priorities, and thresholds but MUST
 * preserve the decision-gate invariants:
 *   1. Minimum safe current-request context is a hard baseline; no policy
 *      MAY place it inside the history budget or omit it for space.
 *   2. When the baseline alone exceeds `availableInputUnits`, the policy
 *      MUST emit a plan with `decision: "explicit_failure"` and
 *      `reasonCode: "MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET"`.
 *   3. The policy MUST emit safe, complete source-category and role-level
 *      explainability evidence, free of raw prompt / message / tool /
 *      attachment content, paths, credentials, or high-cardinality
 *      identifiers.
 *   4. The plan MUST converge into one of the four
 *      `ContextCompactionDecision` values.
 *
 * `evaluate` is synchronous; `signal` is present for forward compatibility
 * with policies that need cancellation (e.g., remote policy services).
 */
export interface ContextBudgetPolicyPort {
  evaluate: (input: ContextBudgetPolicyInput, signal: AbortSignal) => ContextBudgetPolicyOutcome;
}
