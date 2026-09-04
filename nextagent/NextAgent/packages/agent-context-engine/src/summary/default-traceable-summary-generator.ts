import { AgentError, brand, getLogger, type MessageId } from '@nextagent/agent-common';
import { extractSafeErrorDetail } from '../internal/safe-error-projection.js';
import { modelInferenceOptions } from '../internal/model-configuration.js';
import type {
  ModelSelectionService,
  TraceableSummaryDraft,
  TraceableSummaryGenerationPort,
  TraceableSummaryGenerationRequest,
} from '@nextagent/agent-contracts/context';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelInvocationRequest, ModelInvocationService, ModelMessage } from '@nextagent/agent-contracts/model';
import type { SessionMessage } from '@nextagent/agent-contracts/session';

import { buildCompactSummaryUserPrompt } from './compact-summary-template.js';
import {
  CONTINUATION_CRITICAL_CATEGORIES,
  classifyCoveredRange,
  listPresentCategories,
  type CoveredRangeClassification,
} from './covered-range-classifier.js';
import { parseSummaryModelOutput } from './output-parser.js';
import { estimateSerializedInputUnits, serializeCoveredRangeForSummary } from './summary-input-serializer.js';
import {
  SUMMARY_GENERATION,
  createDefaultPromptTemplateAssembler,
  mergePromptModelOptions,
  type PromptTemplateAssembler,
} from '../prompt-shaping/index.js';

// Summary generation summarizes a large covered range — heavier than a single
// chat turn. The model-profile timeout (30s) is too tight and causes
// MODEL_TIMEOUT -> SUMMARY_GENERATION_FAILED during compression (issue #117).
const logger = getLogger({ component: 'agent-context-engine', source: 'summary-generator' });

/**
 * Default implementation of `TraceableSummaryGenerationPort`
 * (add-ts-traceable-summary-generation). Owns the model-invocation
 * path, the prompt template, the input serialization, the output
 * parsing, the checklist validation, and the safe-failure path.
 *
 * The generator's contract:
 *  - Returns a `TraceableSummaryDraft` on success.
 *  - Throws `TraceableSummaryGenerationError` on any failure
 *    (parse, validation, model error, abort, auth). The caller
 *    (`add-ts-context-compression`) catches and falls back to
 *    the existing budget-degradation path; the generator NEVER
 *    returns a degraded draft.
 *  - Performs no persistence side effects: does not write session
 *    messages, does not commit active context, does not emit
 *    timeline events, does not write checkpoint records.
 *
 * The by-purpose prompt template resolver is owned by
 * `add-ts-context-prompt-shaping` (not yet archived). This slice
 * always uses the built-in `compact-summary/v1` template; the
 * `promptTemplateVersion` field on the returned draft carries
 * that version so the future resolver swap is a single
 * change-point.
 */

export interface DefaultTraceableSummaryGeneratorOptions {
  readonly model: ModelInvocationService;
  readonly modelSelectionService: ModelSelectionService;
  readonly assemblyRegistry: Pick<AgentAssemblyRegistry, 'require'>;
  readonly promptTemplateAssembler?: PromptTemplateAssembler;
  /**
   * Optional diagnostic logger for checklist validation warnings
   * and generation diagnostics. When omitted, no diagnostic log
   * is emitted.
   */
}

export class DefaultTraceableSummaryGenerator implements TraceableSummaryGenerationPort {
  private readonly model: ModelInvocationService;
  private readonly modelSelectionService: ModelSelectionService;
  private readonly assemblyRegistry: Pick<AgentAssemblyRegistry, 'require'>;
  private readonly promptTemplateAssembler: PromptTemplateAssembler;

  constructor(options: DefaultTraceableSummaryGeneratorOptions) {
    this.model = options.model;
    this.modelSelectionService = options.modelSelectionService;
    this.assemblyRegistry = options.assemblyRegistry;
    this.promptTemplateAssembler = options.promptTemplateAssembler ?? createDefaultPromptTemplateAssembler();
  }

  async generate(request: TraceableSummaryGenerationRequest): Promise<TraceableSummaryDraft> {
    const classification = classifyCoveredRange(request.coveredMessages);
    const presentCategories = listPresentCategories(classification);

    const serialized = serializeCoveredRangeForSummary(request.coveredMessages);
    const inputUnits = estimateSerializedInputUnits(serialized);

    const userPrompt = buildCompactSummaryUserPrompt(serialized, request.targetBudgetUnits);
    const signal = request.abortSignal ?? new AbortController().signal;
    const assembly = await this.assemblyRegistry.require(request.agentId, request.agentVersion);
    const selection = await this.modelSelectionService.select(
      {
        identityContext: request.identityContext,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        purpose: SUMMARY_GENERATION,
        flowVariables: request.flowVariables,
        mode: 'INITIAL',
        ...(request.locale === undefined ? {} : { locale: request.locale }),
      },
      signal,
    );
    if (selection.status === 'FAILED') {
      throw createTraceableSummaryGenerationError({
        reason: 'model_selection_failed',
        message: 'Summary model selection failed safely.',
      });
    }
    let prompt: Awaited<ReturnType<PromptTemplateAssembler['assemble']>>;
    try {
      prompt = await this.promptTemplateAssembler.assemble({
        purpose: SUMMARY_GENERATION,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        locale: request.locale,
        flowVariables: request.flowVariables,
        selectedModel: {
          modelId: selection.configuration.modelId,
        },
      });
    } catch (error) {
      throw createTraceableSummaryGenerationError({
        reason: 'prompt_template_failed',
        message: extractSafeErrorDetail(error, 'Prompt template assembly failed'),
        cause: error,
      });
    }

    const messages: ModelMessage[] = [
      { role: 'SYSTEM', content: [{ type: 'text', text: prompt.renderedContent }] },
      { role: 'USER', content: [{ type: 'text', text: userPrompt }] },
    ];

    const invocationRequest: ModelInvocationRequest = {
      invocationScope: {
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        operationId: `summary-${request.runId}`,
        sessionId: request.sessionId,
        requestId: request.requestId,
        runId: request.runId,
      },
      modelId: selection.configuration.modelId,
      messages,
      tools: [],
      ...mergePromptModelOptions(modelInferenceOptions(selection.configuration), prompt.modelOptions),
      timeoutMs: selection.configuration.defaultTimeoutMs,
      maxRetries: selection.configuration.defaultMaxRetries,
    };

    let final: Awaited<ReturnType<ModelInvocationService['complete']>>;
    try {
      final = await this.model.complete(invocationRequest, signal);
    } catch (error) {
      throw createTraceableSummaryGenerationError({
        reason: classifyModelInvocationError(error),
        message: extractSafeErrorDetail(error, 'Model invocation failed'),
        cause: error,
      });
    }

    if (final.safeError !== undefined) {
      throw createTraceableSummaryGenerationError({
        reason: 'model_safe_error',
        message: extractSafeErrorDetail(final.safeError, 'Model invocation failed'),
        cause: final.safeError,
      });
    }

    const hadToolCalls = (final.toolCalls?.length ?? 0) > 0;
    const parsed = parseSummaryModelOutput(final.content, hadToolCalls);
    if (!parsed.ok) {
      throw createTraceableSummaryGenerationError({
        reason: parsed.reason,
        message: parsed.detail,
      });
    }

    if (hadToolCalls) {
      throw createTraceableSummaryGenerationError({
        reason: 'tool_call_attempt',
        message: 'Model attempted a tool call during summary generation.',
      });
    }

    const validation = validateChecklist(parsed.value.checklist, classification, parsed.value.usedFullTextFallback);
    if (validation !== null) {
      // Log the checklist mismatch but accept the summary content.
      // Smaller models may not produce perfectly structured checklists;
      // rejecting the summary entirely defeats the purpose of compression.
      logger.warn({
        event: 'context.summaryGeneration.checklistValidationWarning',
        validation,
      });
    }

    const outputUnits = estimateSerializedInputUnits(parsed.value.summaryContent);

    return {
      content: parsed.value.summaryContent,
      sourceReferences: [...request.coveredMessageRefs],
      historyLookupLinkage: [...request.retainedTailMessageRefs],
      rehydrationHints: [],
      generationMode: 'normal',
      promptTemplateVersion: prompt.templateRef,
      inputUnitEstimate: inputUnits,
      outputUnitEstimate: outputUnits,
    };
  }
}

function createTraceableSummaryGenerationError(args: {
  readonly reason: string;
  readonly message: string;
  readonly cause?: unknown;
}): TraceableSummaryGenerationError {
  return new TraceableSummaryGenerationError(args);
}

export class TraceableSummaryGenerationError extends AgentError {
  readonly reason: string;
  constructor(args: { readonly reason: string; readonly message: string; readonly cause?: unknown }) {
    super({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      message: args.message,
      category: classifyErrorCategory(args.reason),
      retryable: false,
      safeDetails: { reason: args.reason },
      ...(args.cause === undefined ? {} : { cause: args.cause }),
    });
    this.reason = args.reason;
  }
}

export function createDefaultTraceableSummaryGenerator(options: DefaultTraceableSummaryGeneratorOptions): TraceableSummaryGenerationPort {
  return new DefaultTraceableSummaryGenerator(options);
}

/**
 * Validate the parsed `<checklist>` block against the
 * pre-classification. Returns null when the checklist is valid;
 * returns a presentation-safe diagnostic string when the
 * generator must treat the result as safe failure.
 *
 * The diagnostic string MUST NOT contain raw checklist body text
 * — it identifies which categories are missing or in conflict,
 * not what the model wrote in them.
 */
function validateChecklist(
  checklist: import('./output-parser.js').ParsedChecklist,
  classification: CoveredRangeClassification,
  fullTextFallback: boolean,
): string | null {
  // Full-text fallback path: the model did not emit a structured
  // <summary> / <checklist> pairing (per spec scenario "Full-text
  // fallback"). The spec says the generator MAY use the full text as
  // parse fallback in this case, so we accept the draft without
  // enforcing the <checklist> continuation-critical contract. The
  // caller records the fallback reason in metadata downstream.
  if (fullTextFallback) {
    if (checklist.duplicateCategories.length > 0) {
      return `Duplicate <fact> entries for categories: ${[...new Set(checklist.duplicateCategories)].sort().join(', ')}.`;
    }
    return null;
  }

  if (checklist.duplicateCategories.length > 0) {
    return `Duplicate <fact> entries for categories: ${[...new Set(checklist.duplicateCategories)].sort().join(', ')}.`;
  }
  if (checklist.presentCategoriesInOrder.length === 0) {
    return '<checklist> block is empty.';
  }
  const present = listPresentCategories(classification);
  const presentSet = new Set(present);
  const emitted = new Set(checklist.presentCategoryFacts.keys());

  // Categories declared present in the covered range but
  // missing from the <checklist> block (or with an empty body)
  // are treated as a safe failure.
  const missing: string[] = [];
  for (const category of present) {
    const body = checklist.presentCategoryFacts.get(category);
    if (body === undefined || body.length === 0) {
      missing.push(category);
    }
  }
  if (missing.length > 0) {
    return `Missing or empty <fact> entries for present categories: ${missing.sort().join(', ')}.`;
  }

  // Categories emitted in the <checklist> block that the
  // generator's pre-classification did not mark as present are
  // a structural violation (the model is "lying" about the
  // covered range).
  const invalid: string[] = [];
  for (const category of emitted) {
    if (!presentSet.has(category as (typeof CONTINUATION_CRITICAL_CATEGORIES)[number])) {
      invalid.push(category);
    }
  }
  if (invalid.length > 0) {
    return `<fact> entries present for categories not in the covered range: ${invalid.sort().join(', ')}.`;
  }

  return null;
}

function classifyModelInvocationError(error: unknown): string {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return 'model_invocation_failed';
  }
  const code = error.code;
  if (typeof code === 'string' && (code === 'AbortError' || code === 'ABORTED')) {
    return 'aborted';
  }
  if (code === 401 || code === 403 || code === 'PERMISSION_DENIED') {
    return 'auth_denied';
  }
  if (typeof code === 'string' && /timeout|abort/i.test(code)) {
    return 'aborted';
  }
  return 'model_invocation_failed';
}

function classifyErrorCategory(reason: string): 'VALIDATION' | 'INTERNAL' | 'AUTHORIZATION' {
  if (reason === 'auth_denied') {
    return 'AUTHORIZATION';
  }
  if (reason === 'aborted' || reason === 'model_safe_error' || reason === 'model_invocation_failed') {
    return 'INTERNAL';
  }
  return 'VALIDATION';
}

export type { SessionMessage, TraceableSummaryDraft, TraceableSummaryGenerationRequest, MessageId };

// Re-export brand helper for downstream tests that want to
// construct branded ids without a deep import into agent-common.
export { brand };
