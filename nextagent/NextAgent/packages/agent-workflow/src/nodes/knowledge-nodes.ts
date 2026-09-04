import { AgentError, getLogger, type JsonObject } from '@nextagent/agent-common';
import type { ModelInferenceOptions, ModelInvocationRequest, ModelMessage, ModelFinalResult } from '@nextagent/agent-contracts/model';
import { renderTemplate } from '../template-engine/index.js';
import type {
  CreateWorkflowNodeCatalogOptions,
  WorkflowFreeInferRequest,
  WorkflowFreeInferResult,
  WorkflowKnowledgeIndex,
  WorkflowKnowledgeRetrievalResult,
  WorkflowNodeHandlerContext,
  WorkflowNodeHandlerResult,
  WorkflowNodeModelInvocationConfig,
  WorkflowModelInvocationHint,
} from './types.js';
import {
  coerceBoolean,
  coerceNumber,
  firstNonEmptyString,
  interpolateString,
  invalidNodeInput,
  isRecord,
  mergeModelInferenceOptions,
  modelParamsInferenceOptions,
  nodeTimeoutMs,
  projectNodeOutputs,
  removeThinkTags,
  requireModelInvocation,
  resolveNodeModelConfig,
  reservedPythonResultKeys,
  resolveNodeValue,
} from './shared.js';
import { executeBatch, readBatchConfig, type BatchExecutionConfig, type BatchElementResult, type BatchOutput } from './batch.js';
const logger = getLogger({ component: 'agent-workflow', source: 'knowledge-nodes' });

const defaultKnowledgeRankTopN = 1;
const defaultKnowledgeRecallTopN = 10;
const maxKnowledgeRankTopN = 10;
const maxKnowledgeRecallTopN = 20;

interface ChoiceToolDescriptor {
  capabilityId: string;
  name: string;
  description?: string;
  inputSchema: JsonObject;
}

export async function executeKnowledgeSearchNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const batchConfig = readBatchConfig(context);
  if (batchConfig !== undefined) {
    return executeKnowledgeSearchBatch(context, options, batchConfig);
  }
  validateKnowledgeSearchOutputs(context);
  const retrieval = await retrieveKnowledge(context, options, 'KNOWLEDGE');
  if (retrieval.recommends.length === 0) {
    throw new AgentError({
      code: 'WORKFLOW_KNOWLEDGE_SEARCH_EMPTY',
      message: 'Knowledge search returned no matching documents.',
      category: 'NOT_FOUND',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_KNOWLEDGE_SEARCH_EMPTY', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  return {
    outputVariables: projectNodeOutputs(context.node.outputs, knowledgeSearchBindings(retrieval, context), context.node),
  };
}

async function executeKnowledgeSearchBatch(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  config: BatchExecutionConfig,
): Promise<WorkflowNodeHandlerResult> {
  const processElement = async (element: unknown, _index: number, signal: AbortSignal): Promise<BatchElementResult> => {
    try {
      const elementContext: WorkflowNodeHandlerContext = {
        ...context,
        signal,
        variables: Object.freeze({ ...context.variables, [config.elementVariable]: element }) as JsonObject,
      };
      const retrieval = await retrieveKnowledge(elementContext, options, 'KNOWLEDGE');
      if (retrieval.recommends.length === 0) {
        return {
          failed: {
            code: 'WORKFLOW_KNOWLEDGE_SEARCH_EMPTY',
            message: 'Knowledge search returned no matching documents.',
          },
        };
      }
      return { result: knowledgeSearchBindings(retrieval, elementContext) };
    } catch (error) {
      if (error instanceof AgentError) {
        return { failed: { code: error.code, message: error.message } };
      }
      return { failed: { code: 'WORKFLOW_KNOWLEDGE_BATCH_ELEMENT_FAILED', message: 'Knowledge batch element failed.' } };
    }
  };

  const buildOutput = (output: BatchOutput): JsonObject => {
    return {
      batch_results: output.batchResults,
      failed_items: Object.freeze(output.failedItems),
    };
  };

  return executeBatch(config, context, processElement, buildOutput);
}

export async function executeKnowledgeQaNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const inputs = resolveKnowledgeInputs(context);
  const globalParams = resolveGlobalContextParams(inputs, context);

  // --- Free Infer shortcut ---
  if (shouldFreeInfer(inputs, context) && options.tryFreeInfer !== undefined) {
    const freeInferResult = await tryFreeInferAnswer(context, options, globalParams);
    if (freeInferResult !== undefined && freeInferResult.hit && freeInferResult.answer !== undefined) {
      return {
        outputVariables: projectNodeOutputs(
          context.node.outputs,
          {
            knowledge_qa_result: Object.freeze([freeInferResult.answer]) as unknown as JsonObject,
            knowledge_search_result: Object.freeze([freeInferResult.answer]) as unknown as JsonObject,
            llm_completion: freeInferResult.answer,
            recall_result: Object.freeze([]) as unknown as JsonObject,
            knowledge_diagnostic: Object.freeze({}) as JsonObject,
          } as unknown as JsonObject,
          context.node,
        ),
      };
    }
  }

  // --- Knowledge retrieval ---
  const retrieval = await retrieveKnowledge(context, options, 'KNOWLEDGE');
  const knowledgeItems = retrieval.recommends.flatMap((item): string[] => {
    const knowledge = (item as Record<string, unknown>).knowledge;
    return typeof knowledge === 'string' && knowledge.length > 0 ? [knowledge] : [];
  });

  const recallResult = Object.freeze(retrieval.recommends) as unknown as JsonObject;
  const knowledgeDiagnostic = Object.freeze({
    status: retrieval.status,
    ...(retrieval.diagnosticReason === undefined ? {} : { reason: retrieval.diagnosticReason }),
  }) as JsonObject;

  // Empty retrieval: output empty lists, no LLM call
  if (knowledgeItems.length === 0) {
    return {
      outputVariables: projectNodeOutputs(
        context.node.outputs,
        {
          knowledge_qa_result: Object.freeze([]) as unknown as JsonObject,
          knowledge_search_result: Object.freeze([]) as unknown as JsonObject,
          llm_completion: '',
          recall_result: recallResult,
          knowledge_diagnostic: knowledgeDiagnostic,
        } as unknown as JsonObject,
        context.node,
      ),
    };
  }

  // --- Per-knowledge LLM summarization ---
  const modelConfig = await requireWorkflowModelConfig(context, options, {
    capabilityId: 'KNOWLEDGE_SUMMARY',
    ...(typeof inputs.model === 'string' && inputs.model.length > 0 ? { modelId: inputs.model } : {}),
    ...(typeof inputs.modelGroup === 'string' && inputs.modelGroup.length > 0 ? { modelGroup: inputs.modelGroup } : {}),
  });
  const loopElementVariable = firstNonEmptyString(inputs.loop_element_variable) ?? 'knowledge';
  const { summaries, lastCompletion } = await summarizeKnowledgeItems(
    context,
    options,
    modelConfig,
    inputs,
    knowledgeItems,
    loopElementVariable,
    globalParams,
  );

  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        knowledge_qa_result: Object.freeze(summaries) as unknown as JsonObject,
        knowledge_search_result: Object.freeze(knowledgeItems) as unknown as JsonObject,
        llm_completion: lastCompletion,
        recall_result: recallResult,
        knowledge_diagnostic: knowledgeDiagnostic,
      } as unknown as JsonObject,
      context.node,
    ),
  };
}

export async function executeApiChoiceNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const inputs = resolveKnowledgeInputs(context);
  const openApiRecall = coerceBoolean(inputs.open_api_recall);
  const openKnowledgeRecall = coerceBoolean(inputs.open_api_knowledge_recall);
  const ragIndexValue = inputs.rag_index ?? inputs.ragIndex;
  const hasRagIndex = Array.isArray(ragIndexValue) && ragIndexValue.length > 0;
  validateApiChoiceOutputs(context, openApiRecall === true || hasRagIndex);

  // D1: Path entry control
  if (openApiRecall !== true && !hasRagIndex) {
    // Path 1: Pure LLM N-select-1 with bounded candidates
    const candidates = parseCandidateApis(inputs.candidateApis ?? inputs.candidate_apis);
    if (candidates.length === 0) {
      throw new AgentError({
        code: 'WORKFLOW_API_CHOICE_NO_CANDIDATES',
        message: 'Neither RAG recall nor candidateApis provided for api-choice.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_API_CHOICE_NO_CANDIDATES', nodeId: context.nodeId, nodeType: context.node.type },
      });
    }
    const apiName = await selectApiFromCandidates(
      context,
      options,
      inputs,
      candidates,
      candidates.map((c) => ({
        capabilityId: c.apiName,
        name: c.apiName,
        ...(c.description === undefined ? {} : { description: c.description }),
        inputSchema: c.paramsSchema,
      })),
    );
    return { outputVariables: projectNodeOutputs(context.node.outputs, { api_name: apiName }, context.node) };
  }

  // Path 2: RAG recall + LLM TopN-select-1
  const allIndexes = parseKnowledgeIndexes(inputs.rag_index ?? inputs.ragIndex, context);
  const apiIndexes = allIndexes.filter((idx) => idx.indexType === undefined || idx.indexType === 'API');
  const knowledgeIndexes = allIndexes.filter((idx) => idx.indexType === 'KNOWLEDGE');

  // API recall
  const apiRetrieval =
    apiIndexes.length > 0
      ? await retrieveKnowledgeWithIndexes(context, options, apiIndexes, 'API')
      : await retrieveKnowledge(context, options, 'API');
  if (apiRetrieval.recommends.length === 0) {
    // Try candidateApis as fallback
    const candidates = parseCandidateApis(inputs.candidateApis ?? inputs.candidate_apis);
    if (candidates.length === 0) {
      throw new AgentError({
        code: 'WORKFLOW_API_CHOICE_NOT_FOUND',
        message: 'No matching API candidate found for the workflow query.',
        category: 'NOT_FOUND',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_API_CHOICE_NOT_FOUND', nodeId: context.nodeId, nodeType: context.node.type },
      });
    }
    const fallbackApiName = await selectApiFromCandidates(
      context,
      options,
      inputs,
      candidates,
      candidates.map((c) => ({
        capabilityId: c.apiName,
        name: c.apiName,
        ...(c.description === undefined ? {} : { description: c.description }),
        inputSchema: c.paramsSchema,
      })),
    );
    return { outputVariables: projectNodeOutputs(context.node.outputs, { api_name: fallbackApiName }, context.node) };
  }

  // D7: Emit rag_recall intermediate step event
  await emitStepEvent(context, 'rag_recall', { count: apiRetrieval.recommends.length });

  // D4: Single-result optimization
  let apiName: string;
  if (apiRetrieval.recommends.length === 1) {
    const record = apiRetrieval.recommends[0] as Record<string, unknown>;
    apiName = firstNonEmptyString(record.apiName, record.api_name, record.name, record.title, record.knowledge) ?? '';
  } else {
    const recalledCandidates = apiRetrieval.recommends.slice(0, 5).map(buildRecalledCandidate);
    // D7: Emit rating step event
    await emitStepEvent(context, 'rating', { candidates: recalledCandidates.map((c) => c.apiName) });
    apiName = await selectApiFromCandidates(
      context,
      options,
      inputs,
      recalledCandidates,
      recalledCandidates.map((candidate) => {
        const description = buildRecalledCandidateDescription(candidate);
        return {
          capabilityId: candidate.apiName,
          name: candidate.apiName,
          ...(description === undefined ? {} : { description }),
          inputSchema: candidate.paramsSchema,
        };
      }),
    );
    // D7: Emit llm_reasoning step event
    await emitStepEvent(context, 'llm_reasoning', { api_name: apiName });
  }

  // Build output variables
  const outputVars: Record<string, unknown> = { api_name: apiName };

  // D9: Add recall_result and knowledge_diagnostic (only projected when Recipe declares them)
  const recallResult = Object.freeze(apiRetrieval.recommends.slice(0, 5)) as unknown as JsonObject;
  outputVars.recall_result = recallResult;
  outputVars.knowledge_diagnostic = Object.freeze({
    status: apiRetrieval.status,
    ...(apiRetrieval.diagnosticReason === undefined ? {} : { reason: apiRetrieval.diagnosticReason }),
  }) as JsonObject;

  // D3: Knowledge recall (parallel with API recall result)
  if (openKnowledgeRecall === true && knowledgeIndexes.length > 0) {
    const knowledgeRetrieval = await retrieveKnowledgeWithIndexes(context, options, knowledgeIndexes, 'KNOWLEDGE');
    if (knowledgeRetrieval.recommends.length === 0) {
      throw new AgentError({
        code: 'WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY',
        message: 'Knowledge recall returned no results.',
        category: 'NOT_FOUND',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY', nodeId: context.nodeId, nodeType: context.node.type },
      });
    }
    const knowledgeContent = knowledgeRetrieval.recommends
      .map((item) => {
        const record = item as Record<string, unknown>;
        return firstNonEmptyString(record.knowledge, record.content, record.text) ?? JSON.stringify(item);
      })
      .join('\n');
    outputVars.knowledge = knowledgeContent;
  }

  return {
    outputVariables: projectNodeOutputs(context.node.outputs, outputVars as unknown as JsonObject, context.node),
  };
}

export async function executeRecipeChoiceNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const inputs = resolveKnowledgeInputs(context);
  const candidates = parseCandidateRecipes(inputs.candidateRecipes ?? inputs.candidate_recipes);
  if (candidates.length > 0) {
    // recipe-choice candidate path: select the first candidate directly
    // without an LLM call. The RAG path already takes the first recommend;
    // candidate path keeps the same deterministic behavior. recipe-choice
    // spec only requires recipe_name output, not LLM-generated mappedParams.
    const selected = candidates[0]!;
    return {
      outputVariables: projectNodeOutputs(
        context.node.outputs,
        {
          recipe_choice_result: Object.freeze({
            recipeName: selected.recipeName,
          }) as unknown as JsonObject,
          recipe_name: selected.recipeName,
          recipe_name_list: Object.freeze(candidates.map((candidate) => candidate.recipeName)) as unknown as JsonObject,
          recall_result: Object.freeze(
            candidates.map((candidate) => ({
              ref: candidate.recipeName,
              title: candidate.recipeName,
              excerpt: candidate.description ?? candidate.recipeName,
            })),
          ) as unknown as JsonObject,
        } as unknown as JsonObject,
        context.node,
      ),
    };
  }

  if (options.retrieveKnowledge === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_KNOWLEDGE_BOUNDARY_UNAVAILABLE',
      message: 'Workflow knowledge retrieval boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_KNOWLEDGE_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const indexes = parseKnowledgeIndexes(inputs.rag_index ?? inputs.ragIndex, context);
  const query = firstNonEmptyString(inputs.query, inputs.taskDescription, inputs.task_description);
  if (indexes.length === 0 || query === undefined) {
    throw invalidNodeInput(context.nodeId, context.node.type, indexes.length === 0 ? 'rag_index' : 'query');
  }
  const rankTopN = readBoundedInt(inputs.rank_topN ?? inputs.rankTopN, defaultKnowledgeRankTopN, maxKnowledgeRankTopN, 'rank_topN', context);
  const vsTopN = readBoundedInt(inputs.vs_topN ?? inputs.vsTopN, defaultKnowledgeRecallTopN, maxKnowledgeRecallTopN, 'vs_topN', context);
  const esTopN = readBoundedInt(inputs.es_topN ?? inputs.esTopN, defaultKnowledgeRecallTopN, maxKnowledgeRecallTopN, 'es_topN', context);
  // Step 3: parallel per-index retrieval; Step 4: aggregate, sort, filter, truncate
  const retrieval = await retrieveRecipeKnowledgePerIndex(context, options.retrieveKnowledge, indexes, query, inputs, vsTopN, esTopN);
  const recallCondition = inputs.recall_condition ?? inputs.recallCondition;
  const aggregated = aggregateAndSortRecipeResults(retrieval.perIndexResults, recallCondition, rankTopN);
  if (aggregated.length === 0) {
    throw new AgentError({
      code: 'WORKFLOW_RECIPE_NOT_FOUND',
      message: 'No matching recipe found for the workflow query.',
      category: 'NOT_FOUND',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_RECIPE_NOT_FOUND', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const recipeNames = aggregated.map(
    (item) => firstNonEmptyString((item as Record<string, unknown>).recipeName, (item as Record<string, unknown>).recipe_name) ?? '',
  );
  const topRecipeName = recipeNames[0]!;
  const recallResult = Object.freeze(aggregated) as unknown as JsonObject;
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        recipe_choice_result: Object.freeze({
          recipeName: topRecipeName,
          recallResult,
        }) as unknown as JsonObject,
        recipe_name: topRecipeName,
        recipe_name_list: Object.freeze(recipeNames) as unknown as JsonObject,
        recall_result: Object.freeze(recallResult) as unknown as JsonObject,
        knowledge_diagnostic: Object.freeze({
          status: retrieval.status,
          ...(retrieval.diagnosticReason === undefined ? {} : { reason: retrieval.diagnosticReason }),
        }) as JsonObject,
      } as unknown as JsonObject,
      context.node,
    ),
  };
}
interface RecipePerIndexResult {
  readonly recommends: readonly JsonObject[];
  readonly priority: number;
}

async function retrieveRecipeKnowledgePerIndex(
  context: WorkflowNodeHandlerContext,
  retrieve: NonNullable<CreateWorkflowNodeCatalogOptions['retrieveKnowledge']>,
  indexes: readonly WorkflowKnowledgeIndex[],
  query: string,
  inputs: Record<string, unknown>,
  vsTopN: number,
  esTopN: number,
): Promise<{ readonly perIndexResults: readonly RecipePerIndexResult[]; readonly status: 'OK' | 'DEGRADED'; readonly diagnosticReason?: string }> {
  const sharedFilters = isRecord(inputs.filters) ? { filters: inputs.filters as JsonObject } : {};
  const sharedExtensions = Array.isArray(inputs.extensions)
    ? { extensions: inputs.extensions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) }
    : {};
  const settled = await Promise.allSettled(
    indexes.map(async (index): Promise<RecipePerIndexResult> => {
      const result = await retrieve(
        {
          query,
          indexes: [index],
          ...sharedFilters,
          ...sharedExtensions,
          rankTopN: maxKnowledgeRankTopN,
          vsTopN: index.vsTopN ?? vsTopN,
          esTopN: index.esTopN ?? esTopN,
          topK: maxKnowledgeRankTopN,
          defaultIndexType: 'RECIPE',
          request: context.request,
        },
        context.signal,
      );
      return { recommends: result.recommends, priority: index.priority ?? 0 };
    }),
  );
  const nonEmpty = settled
    .filter((r): r is PromiseFulfilledResult<RecipePerIndexResult> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r) => r.recommends.length > 0);
  if (nonEmpty.length === 0) {
    throw new AgentError({
      code: 'WORKFLOW_RECIPE_NOT_FOUND',
      message: 'No matching recipe found for the workflow query.',
      category: 'NOT_FOUND',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_RECIPE_NOT_FOUND', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const hasFailures = settled.some((r) => r.status === 'rejected');
  const failedCount = settled.length - nonEmpty.length;
  return {
    perIndexResults: nonEmpty,
    status: hasFailures ? 'DEGRADED' : 'OK',
    ...(hasFailures ? { diagnosticReason: `${failedCount} of ${settled.length} recipe index retrievals failed` } : {}),
  };
}

function parseScoreCondition(expr: string): ((score: number) => boolean) | undefined {
  const trimmed = expr.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const rangeMatch = /^(.+?)~(.+)$/u.exec(trimmed);
  if (rangeMatch !== null) {
    const low = Number.parseFloat(rangeMatch[1]!);
    const high = Number.parseFloat(rangeMatch[2]!);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return (score: number) => score >= low && score <= high;
    }
    return undefined;
  }
  const compMatch = /^([><=])(.+)$/u.exec(trimmed);
  if (compMatch !== null) {
    const threshold = Number.parseFloat(compMatch[2]!);
    if (Number.isFinite(threshold)) {
      const op = compMatch[1];
      if (op === '>') {
        return (score: number) => score > threshold;
      }
      if (op === '<') {
        return (score: number) => score < threshold;
      }
      if (op === '=') {
        return (score: number) => score === threshold;
      }
    }
  }
  return undefined;
}

function applyRecallCondition(recommends: readonly JsonObject[], recallCondition: unknown): readonly JsonObject[] {
  if (!isRecord(recallCondition)) {
    return recommends;
  }
  const vsExpr = firstNonEmptyString(recallCondition.vs_score, recallCondition.vsScore);
  const esExpr = firstNonEmptyString(recallCondition.es_score, recallCondition.esScore);
  const rerankExpr = firstNonEmptyString(recallCondition.rerank_score, recallCondition.rerankScore);
  const vsPredicate = vsExpr === undefined ? undefined : parseScoreCondition(vsExpr);
  const esPredicate = esExpr === undefined ? undefined : parseScoreCondition(esExpr);
  const rerankPredicate = rerankExpr === undefined ? undefined : parseScoreCondition(rerankExpr);
  if (vsPredicate === undefined && esPredicate === undefined && rerankPredicate === undefined) {
    return recommends;
  }
  return recommends.filter((item) => {
    const record = item as Record<string, unknown>;
    const vsScore = Number(record.vsScore ?? record.vs_score ?? 0);
    const esScore = Number(record.esScore ?? record.es_score ?? 0);
    const rerankScore = Number(record.rerankScore ?? record.rerank_score ?? 0);
    return (
      (vsPredicate === undefined || vsPredicate(vsScore)) &&
      (esPredicate === undefined || esPredicate(esScore)) &&
      (rerankPredicate === undefined || rerankPredicate(rerankScore))
    );
  });
}

function aggregateAndSortRecipeResults(
  perIndexResults: readonly RecipePerIndexResult[],
  recallCondition: unknown,
  rankTopN: number,
): readonly JsonObject[] {
  const flattened: JsonObject[] = [];
  for (const { recommends, priority } of perIndexResults) {
    for (const item of recommends) {
      flattened.push({ ...item, priority } as JsonObject);
    }
  }
  const sorted = [...flattened].sort((a, b) => {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const priorityDiff = Number(bRecord.priority ?? 0) - Number(aRecord.priority ?? 0);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    const aScore = Number(aRecord.rerankScore ?? aRecord.rerank_score ?? 0);
    const bScore = Number(bRecord.rerankScore ?? bRecord.rerank_score ?? 0);
    return bScore - aScore;
  });
  const filtered = applyRecallCondition(sorted, recallCondition);
  return filtered.slice(0, rankTopN);
}

async function retrieveKnowledge(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  defaultIndexType: 'API' | 'RECIPE' | 'KNOWLEDGE',
): Promise<WorkflowKnowledgeRetrievalResult> {
  if (options.retrieveKnowledge === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_KNOWLEDGE_BOUNDARY_UNAVAILABLE',
      message: 'Workflow knowledge retrieval boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_KNOWLEDGE_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const inputs = resolveKnowledgeInputs(context);
  const indexes = parseKnowledgeIndexes(inputs.rag_index ?? inputs.ragIndex, context);
  const query = firstNonEmptyString(inputs.query, inputs.taskDescription, inputs.task_description);
  if (indexes.length === 0 || query === undefined) {
    throw invalidNodeInput(context.nodeId, context.node.type, indexes.length === 0 ? 'rag_index' : 'query');
  }
  const rankTopN = readBoundedInt(inputs.rank_topN ?? inputs.rankTopN, defaultKnowledgeRankTopN, maxKnowledgeRankTopN, 'rank_topN', context);
  const vsTopN = readBoundedInt(inputs.vs_topN ?? inputs.vsTopN, defaultKnowledgeRecallTopN, maxKnowledgeRecallTopN, 'vs_topN', context);
  const esTopN = readBoundedInt(inputs.es_topN ?? inputs.esTopN, defaultKnowledgeRecallTopN, maxKnowledgeRecallTopN, 'es_topN', context);
  const topK = rankTopN;
  return await options.retrieveKnowledge(
    {
      query,
      indexes,
      ...(isRecord(inputs.filters) ? { filters: inputs.filters as JsonObject } : {}),
      ...(Array.isArray(inputs.extensions)
        ? { extensions: inputs.extensions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) }
        : {}),
      rankTopN,
      vsTopN,
      esTopN,
      topK,
      defaultIndexType,
      request: context.request,
    },
    context.signal,
  );
}

function resolveKnowledgeInputs(context: WorkflowNodeHandlerContext): Record<string, unknown> {
  const inputs = resolveNodeValue(context.node.inputs ?? {}, context.variables);
  if (!isRecord(inputs)) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'inputs');
  }
  return inputs;
}

const validIndexTypes = new Set(['API', 'RECIPE', 'KNOWLEDGE']);

function parseKnowledgeIndexes(value: unknown, context: WorkflowNodeHandlerContext): WorkflowKnowledgeIndex[] {
  if (isRecord(value) && !Array.isArray(value)) {
    // Fix #8: When python_result whole-object reference contains metadata
    // keys (exit_code, stdout, etc.) from expandStdoutJsonFields, extract
    // the actual data before wrapping.
    const hasMetadata = Object.keys(value).some((k) => reservedPythonResultKeys.has(k));
    if (hasMetadata) {
      const numericEntries = Object.entries(value)
        .filter(([k]) => /^\d+$/u.test(k))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v);
      if (numericEntries.length > 0) {
        value = numericEntries;
      } else {
        // Strip metadata keys, wrap remaining data as single-element array
        const stripped = Object.fromEntries(Object.entries(value).filter(([k]) => !reservedPythonResultKeys.has(k)));
        value = Object.keys(stripped).length > 0 ? [stripped] : [];
      }
    } else {
      value = [value];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item): WorkflowKnowledgeIndex[] => {
      if (typeof item === 'string' && item.trim().length > 0) {
        return [{ indexName: item.trim() }];
      }
      if (!isRecord(item)) {
        return [];
      }
      const indexName = firstNonEmptyString(item.index_name, item.indexName, item.domain);
      if (indexName === undefined) {
        return [];
      }
      const domain = firstNonEmptyString(item.domain);
      const scene = firstNonEmptyString(item.scene);
      const indexType = firstNonEmptyString(item.index_type, item.indexType);
      if (indexType !== undefined && !validIndexTypes.has(indexType)) {
        throw invalidNodeInput(context.nodeId, context.node.type, 'index_type');
      }
      const priority = coerceNumber(item.priority);
      const vsTopN = parseOptionalBoundedInt(item.vs_topN ?? item.vsTopN, 1, maxKnowledgeRecallTopN, 'vs_topN', context);
      const esTopN = parseOptionalBoundedInt(item.es_topN ?? item.esTopN, 1, maxKnowledgeRecallTopN, 'es_topN', context);
      const filters = isRecord(item.filters) ? (item.filters as JsonObject) : undefined;
      return [
        {
          ...(domain === undefined ? {} : { domain }),
          ...(scene === undefined ? {} : { scene }),
          indexName,
          ...(indexType === undefined ? {} : { indexType: indexType as 'API' | 'RECIPE' | 'KNOWLEDGE' }),
          ...(priority === undefined ? {} : { priority }),
          ...(vsTopN === undefined ? {} : { vsTopN }),
          ...(esTopN === undefined ? {} : { esTopN }),
          ...(filters === undefined ? {} : { filters }),
        },
      ];
    })
    .slice(0, 5);
}

function readBoundedInt(value: unknown, fallback: number, max: number, field: string, context: WorkflowNodeHandlerContext): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw invalidNodeInput(context.nodeId, context.node.type, field);
  }
  return parsed;
}

function parseOptionalBoundedInt(value: unknown, min: number, max: number, field: string, context: WorkflowNodeHandlerContext): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw invalidNodeInput(context.nodeId, context.node.type, field);
  }
  return parsed;
}

const knowledgeSearchOutputBindings = new Set(['${knowledge_search_result}', '${recall_result}']);
const apiChoiceDirectOutputBindings = new Set(['${api_name}']);

const apiChoiceRagOutputBindings = new Set(['${api_name}', '${recall_result}', '${knowledge_diagnostic}', '${knowledge}']);

function validateApiChoiceOutputs(context: WorkflowNodeHandlerContext, usesRagRecall: boolean): void {
  const outputs = context.node.outputs;
  if (!isRecord(outputs) || Object.keys(outputs).length === 0) {
    return;
  }
  const allowedBindings = usesRagRecall ? apiChoiceRagOutputBindings : apiChoiceDirectOutputBindings;
  let hasApiName = false;
  for (const outputBinding of Object.values(outputs)) {
    if (typeof outputBinding !== 'string' || !allowedBindings.has(outputBinding)) {
      throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
    }
    if (outputBinding === '${api_name}') {
      hasApiName = true;
    }
  }
  if (!hasApiName) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
  }
}

function validateKnowledgeSearchOutputs(context: WorkflowNodeHandlerContext): void {
  const outputs = context.node.outputs;
  if (!isRecord(outputs) || Object.keys(outputs).length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
  }
  for (const outputBinding of Object.values(outputs)) {
    if (typeof outputBinding !== 'string' || !knowledgeSearchOutputBindings.has(outputBinding)) {
      throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
    }
  }
}

function knowledgeSearchBindings(retrieval: WorkflowKnowledgeRetrievalResult, context: WorkflowNodeHandlerContext): JsonObject {
  const knowledgeSearchResult = retrieval.recommends.flatMap((item): string[] => {
    const knowledge = (item as Record<string, unknown>).knowledge;
    if (typeof knowledge !== 'string') {
      throw invalidNodeInput(context.nodeId, context.node.type, 'knowledge');
    }
    return knowledge.length === 0 ? [] : [knowledge];
  });
  return {
    knowledge_search_result: Object.freeze(knowledgeSearchResult) as unknown as JsonObject,
    recall_result: Object.freeze(retrieval.recommends) as unknown as JsonObject,
  } as unknown as JsonObject;
}
async function requireWorkflowModelConfig(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  hint?: WorkflowModelInvocationHint,
): Promise<WorkflowNodeModelInvocationConfig> {
  if (options.resolveModelInvocationConfig === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE',
      message: 'Workflow model invocation boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  return await options.resolveModelInvocationConfig(context.request, context.signal, hint);
}
function buildKnowledgeModelInvocationRequest(
  context: WorkflowNodeHandlerContext,
  modelConfig: WorkflowNodeModelInvocationConfig,
  inferenceOptions: ModelInferenceOptions,
  messages: ModelMessage[],
): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: context.request.identityContext.tenantId,
      subjectId: context.request.identityContext.subjectId,
      agentId: context.request.agentId,
      agentVersion: context.request.agentVersion,
      agentAssemblyRef: context.request.agentAssemblyRef ?? `${context.request.agentId}:${context.request.agentVersion}`,
      operationId: `workflow:${context.nodeId}`,
      sessionId: context.request.sessionId,
      requestId: context.request.requestId,
      runId: context.request.runId,
    },
    modelId: modelConfig.modelId,
    messages,
    tools: [],
    ...inferenceOptions,
    timeoutMs: nodeTimeoutMs(context.node, modelConfig.timeoutMs),
    maxRetries: modelConfig.maxRetries,
  };
}

/** Shared candidate selection: resolve prompt, call LLM, apply think-tag removal, check follow-up, find selected. */
async function selectApiFromCandidates(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  inputs: Record<string, unknown>,
  candidates: ReadonlyArray<{ readonly apiName: string; readonly paramsSchema: JsonObject }>,
  tools: readonly ChoiceToolDescriptor[],
): Promise<string> {
  const systemPrompt = await resolveApiChoicePrompt(context, options, inputs);
  const taskDescription = firstNonEmptyString(inputs.taskDescription, inputs.task_description, inputs.query, context.node.description) ?? '';
  const fullPrompt =
    coerceBoolean(inputs.open_reflection) === true
      ? `${systemPrompt}\n\nIf you need more information to make a selection, set "NEED_MORE_KEY" to the follow-up question for the user.`
      : systemPrompt;
  const payload = await chooseCandidateWithPrompt(
    context,
    options,
    'api_choice',
    fullPrompt,
    {
      taskDescription,
      candidateApis: Object.freeze(candidates) as unknown as JsonObject,
    },
    tools,
  );
  let selectedName = payload.selectedName;
  if (coerceBoolean(inputs.remove_think_tags) === true) {
    selectedName = removeThinkTags(selectedName);
  }
  checkNeedMoreKey(context, payload.rawContent, inputs);
  const selected = candidates.find((c) => c.apiName === selectedName);
  if (selected === undefined) {
    throw invalidSelection(context, 'WORKFLOW_API_CHOICE_INVALID_SELECTION');
  }
  return selected.apiName;
}
// D2: Resolve prompt for api-choice, reusing prepareLlmPrompt + renderTemplate
async function resolveApiChoicePrompt(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  inputs: Record<string, unknown>,
): Promise<string> {
  const top1Prompt = firstNonEmptyString(inputs.top1_choice_prompt);
  if (top1Prompt !== undefined) {
    return renderTemplate(top1Prompt, context.variables);
  }
  if (options.prepareLlmPrompt !== undefined) {
    const modelConfig = await requireWorkflowModelConfig(context, options);
    const templateName = firstNonEmptyString(inputs.api_choice_prompt_template_name);
    const prepared = await options.prepareLlmPrompt({
      request: context.request,
      nodeId: context.nodeId,
      node: context.node,
      resolvedInputs: inputs,
      variables: context.variables,
      modelConfig,
      defaultPurpose: templateName ?? 'API_CHOICE',
      defaultUserPrompt: '',
    });
    const prompt = prepared.systemPrompt ?? prepared.userPrompt;
    if (prompt !== undefined && prompt.length > 0) {
      return renderTemplate(prompt, context.variables);
    }
  }
  // If prepareLlmPrompt is available but returned nothing, error per spec
  if (options.prepareLlmPrompt !== undefined) {
    throw new AgentError({
      code: 'WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE',
      message: 'No prompt available for api-choice node.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  // prepareLlmPrompt not available: use built-in default (backward compat)
  return 'Select exactly one bounded candidate. Return one tool call only and keep arguments safe and minimal.';
}

function checkNeedMoreKey(context: WorkflowNodeHandlerContext, rawContent: string | undefined, inputs: Record<string, unknown>): void {
  if (coerceBoolean(inputs.open_reflection) !== true || rawContent === undefined) {
    return;
  }
  const match = /NEED_MORE_KEY(?::\s*(.+?))?[\s"}\]]/u.exec(rawContent);
  if (match !== null) {
    throw new AgentError({
      code: 'WORKFLOW_API_CHOICE_FOLLOW_UP',
      message: 'API choice requires user follow-up.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: {
        reasonCode: 'WORKFLOW_API_CHOICE_FOLLOW_UP',
        nodeId: context.nodeId,
        nodeType: context.node.type,
        followUpQuestion: match[1]?.trim() ?? 'Additional information required',
      },
    });
  }
}

async function emitStepEvent(context: WorkflowNodeHandlerContext, step: string, data: Record<string, unknown>): Promise<void> {
  if (context.emitOutputDelta === undefined) {
    return;
  }
  await context.emitOutputDelta({ channel: 'CONTENT', content: JSON.stringify({ step, ...data }), level: 'DETAIL' });
}

async function retrieveKnowledgeWithIndexes(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  indexes: WorkflowKnowledgeIndex[],
  defaultIndexType: 'API' | 'RECIPE' | 'KNOWLEDGE',
): Promise<WorkflowKnowledgeRetrievalResult> {
  if (options.retrieveKnowledge === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_KNOWLEDGE_BOUNDARY_UNAVAILABLE',
      message: 'Workflow knowledge retrieval boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_KNOWLEDGE_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const inputs = resolveKnowledgeInputs(context);
  const query = firstNonEmptyString(inputs.query, inputs.taskDescription, inputs.task_description);
  if (query === undefined) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'query');
  }
  const rankTopN = readBoundedInt(inputs.rank_topN ?? inputs.rankTopN, defaultKnowledgeRankTopN, maxKnowledgeRankTopN, 'rank_topN', context);
  const vsTopN = readBoundedInt(inputs.vs_topN ?? inputs.vsTopN, defaultKnowledgeRecallTopN, maxKnowledgeRecallTopN, 'vs_topN', context);
  const esTopN = readBoundedInt(inputs.es_topN ?? inputs.esTopN, defaultKnowledgeRecallTopN, maxKnowledgeRecallTopN, 'es_topN', context);
  return await options.retrieveKnowledge(
    {
      query,
      indexes,
      rankTopN,
      vsTopN,
      esTopN,
      topK: rankTopN,
      defaultIndexType,
      request: context.request,
      ...(isRecord(inputs.filters) ? { filters: inputs.filters as JsonObject } : {}),
      ...(Array.isArray(inputs.extensions)
        ? { extensions: inputs.extensions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) }
        : {}),
    },
    context.signal,
  );
}

function buildRecalledCandidate(item: JsonObject): RecalledApiCandidate {
  const record = item as Record<string, unknown>;
  const apiName = firstNonEmptyString(record.apiName, record.api_name, record.name, record.title, record.knowledge) ?? '';
  return {
    apiName,
    ...(() => {
      const v = firstNonEmptyString(record.description);
      return v === undefined ? {} : { description: v };
    })(),
    ...(() => {
      const v = parseQaExamples(record.qaExamples, record.qa_examples);
      return v === undefined ? {} : { qaExamples: v };
    })(),
    ...(() => {
      const v = parseExtensions(record.extensions);
      return v === undefined ? {} : { extensions: v };
    })(),
    paramsSchema: resolveRecalledParamsSchema(record),
  };
}

async function chooseCandidateWithPrompt(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  stepSuffix: string,
  systemPrompt: string,
  promptPayload: JsonObject,
  tools: readonly ChoiceToolDescriptor[],
): Promise<{ readonly selectedName: string; readonly rawContent: string }> {
  const inputs = resolveKnowledgeInputs(context);
  const modelConfig = await resolveNodeModelConfig(context, options, inputs);
  const inferenceOptions = mergeModelInferenceOptions(modelConfig.inferenceOptions, modelParamsInferenceOptions(inputs));
  const modelInvocation = requireModelInvocation(options.modelInvocation);
  const modelResult = await modelInvocation.complete(
    {
      invocationScope: {
        tenantId: context.request.identityContext.tenantId,
        subjectId: context.request.identityContext.subjectId,
        agentId: context.request.agentId,
        agentVersion: context.request.agentVersion,
        agentAssemblyRef: context.request.agentAssemblyRef ?? `${context.request.agentId}:${context.request.agentVersion}`,
        operationId: `workflow:${context.nodeId}:${stepSuffix}`,
        sessionId: context.request.sessionId,
        requestId: context.request.requestId,
        runId: context.request.runId,
      },
      modelId: modelConfig.modelId,
      messages: [
        { role: 'SYSTEM', content: [{ type: 'text', text: systemPrompt }] },
        { role: 'USER', content: [{ type: 'text', text: JSON.stringify(promptPayload) }] },
      ],
      tools: tools.map((tool) => ({
        capabilityId: tool.capabilityId,
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
      })),
      ...inferenceOptions,
      timeoutMs: nodeTimeoutMs(context.node, modelConfig.timeoutMs),
      maxRetries: modelConfig.maxRetries,
    },
    context.signal,
  );
  if (modelResult.safeError !== undefined) {
    throw new AgentError({
      code: modelResult.safeError.code,
      message: modelResult.safeError.message,
      category: modelResult.safeError.category,
      retryable: modelResult.safeError.retryable,
      ...(modelResult.safeError.safeDetails === undefined ? {} : { safeDetails: modelResult.safeError.safeDetails }),
    });
  }
  const selectedCall = modelResult.toolCalls?.[0];
  if (selectedCall === undefined) {
    throw invalidSelection(context, 'WORKFLOW_KNOWLEDGE_CHOICE_INVALID_SELECTION');
  }
  return { selectedName: selectedCall.toolName, rawContent: modelResult.content ?? '' };
}

function parseCandidateApis(value: unknown): Array<{ readonly apiName: string; readonly description?: string; readonly paramsSchema: JsonObject }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const apiName = firstNonEmptyString(item.apiName, item.api_name, item.name);
    if (apiName === undefined) {
      return [];
    }
    return [
      {
        apiName,
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        paramsSchema: isRecord(item.paramsSchema)
          ? (item.paramsSchema as JsonObject)
          : isRecord(item.params_schema)
            ? (item.params_schema as JsonObject)
            : {},
      },
    ];
  });
}

function parseCandidateRecipes(value: unknown): Array<{ readonly recipeName: string; readonly description?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const recipeName = firstNonEmptyString(item.recipeName, item.recipe_name, item.name);
    if (recipeName === undefined) {
      return [];
    }
    return [
      {
        recipeName,
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
      },
    ];
  });
}
interface RecalledApiCandidate {
  readonly apiName: string;
  readonly description?: string;
  readonly qaExamples?: readonly string[];
  readonly extensions?: JsonObject;
  readonly paramsSchema: JsonObject;
}

function parseQaExamples(...values: unknown[]): readonly string[] | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const examples = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (examples.length > 0) {
        return Object.freeze(examples);
      }
    }
  }
  return undefined;
}

function parseExtensions(value: unknown): JsonObject | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.freeze(value) as JsonObject;
}

function resolveRecalledParamsSchema(record: Record<string, unknown>): JsonObject {
  if (isRecord(record.paramsSchema)) {
    return record.paramsSchema as JsonObject;
  }
  if (isRecord(record.params_schema)) {
    return record.params_schema as JsonObject;
  }
  // Fallback: construct a minimal schema from top-level properties when the
  // recommend record carries inline param fields but no explicit schema.
  const properties = isRecord(record.properties) ? record.properties : isRecord(record.params) ? record.params : undefined;
  if (properties === undefined) {
    return {};
  }
  return { type: 'object', properties: Object.freeze(properties) as JsonObject } as JsonObject;
}

function buildRecalledCandidateDescription(candidate: RecalledApiCandidate): string | undefined {
  const parts: string[] = [];
  if (candidate.description !== undefined) {
    parts.push(candidate.description);
  }
  if (candidate.qaExamples !== undefined && candidate.qaExamples.length > 0) {
    parts.push(`Example questions: ${candidate.qaExamples.join('; ')}`);
  }
  if (candidate.extensions !== undefined) {
    const extensions = candidate.extensions as Record<string, unknown>;
    const protocol = firstNonEmptyString(extensions.protocol, extensions.method);
    if (protocol !== undefined) {
      parts.push(`Protocol: ${protocol}`);
    }
  }
  return parts.length === 0 ? undefined : parts.join('. ');
}
function invalidSelection(context: WorkflowNodeHandlerContext, code: string): AgentError {
  return new AgentError({
    code,
    message: 'Workflow knowledge choice selected an invalid candidate safely.',
    category: 'VALIDATION',
    retryable: false,
    safeDetails: { reasonCode: code, nodeId: context.nodeId, nodeType: context.node.type },
  });
}
// --- Free Infer ---

function shouldFreeInfer(inputs: Record<string, unknown>, context: WorkflowNodeHandlerContext): boolean {
  if (inputs.openFreeInfer !== true) {
    return false;
  }
  const freeInferStatus = context.request.executionMetadata?.freeInferStatus;
  if (freeInferStatus === 'FORCE_CLOSE') {
    return false;
  }
  const nodeCount = Object.keys(context.recipe.flowGraph.nodes).length;
  return nodeCount === 3;
}

async function tryFreeInferAnswer(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  globalParams: GlobalContextParams,
): Promise<WorkflowFreeInferResult | undefined> {
  if (options.tryFreeInfer === undefined) {
    return undefined;
  }
  const request: WorkflowFreeInferRequest = {
    question: globalParams.inputQuestion,
    chatId: globalParams.chatId,
    ...(globalParams.conversationId === undefined ? {} : { conversationId: globalParams.conversationId }),
    agentName: globalParams.agentName,
    request: context.request,
  };
  try {
    return await options.tryFreeInfer(request, context.signal);
  } catch (error) {
    logger.warn({ event: 'knowledge-qa.free-infer.failed', error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

// --- Global context params ---

interface GlobalContextParams {
  readonly inputQuestion: string;
  readonly agentName: string;
  readonly chatId: string;
  readonly conversationId?: string | undefined;
}

function resolveGlobalContextParams(inputs: Record<string, unknown>, context: WorkflowNodeHandlerContext): GlobalContextParams {
  const inputQuestion = firstNonEmptyString(inputs.input_question, context.variables.input_question) ?? '';
  const agentName = context.request.agentId;
  const chatId = context.request.sessionId;
  const conversationId = firstNonEmptyString(context.request.executionMetadata?.conversation_id, context.variables.conversation_id);
  return { inputQuestion, agentName, chatId, conversationId };
}

// --- Per-knowledge LLM summarization ---

async function summarizeKnowledgeItems(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  modelConfig: WorkflowNodeModelInvocationConfig,
  inputs: Record<string, unknown>,
  knowledgeItems: readonly string[],
  loopElementVariable: string,
  globalParams: GlobalContextParams,
): Promise<{ readonly summaries: string[]; readonly lastCompletion: string }> {
  if (knowledgeItems.length === 0) {
    return { summaries: [], lastCompletion: '' };
  }

  const modelInvocation = requireModelInvocation(options.modelInvocation);
  // Read raw prompt template from node inputs (not from interpolated inputs)
  // because resolveKnowledgeInputs already interpolates ${knowledge} at resolution time.
  const rawInputs = context.node.inputs;
  const rawSummaryPrompt = isRecord(rawInputs) ? firstNonEmptyString(rawInputs.llm_summery_prompt, rawInputs.llm_summary_prompt) : undefined;
  const defaultSummaryTemplate = 'Please summarize the following knowledge content, extracting key information.';

  const summaries: string[] = [];
  let lastCompletion = '';

  for (const knowledgeItem of knowledgeItems) {
    const templateScope = Object.freeze({
      ...context.variables,
      ...globalParams,
      [loopElementVariable]: knowledgeItem,
    });

    let systemPrompt: string;
    if (rawSummaryPrompt !== undefined) {
      systemPrompt = interpolateString(rawSummaryPrompt, templateScope as unknown as JsonObject) as string;
    } else if (options.prepareLlmPrompt !== undefined) {
      const prepared = await options.prepareLlmPrompt({
        request: context.request,
        ...(context.enableQueryRewrite === undefined ? {} : { enableQueryRewrite: context.enableQueryRewrite }),
        nodeId: context.nodeId,
        node: context.node,
        resolvedInputs: inputs,
        variables: context.variables,
        modelConfig,
        defaultPurpose: 'KNOWLEDGE_SUMMARY',
        defaultUserPrompt: knowledgeItem,
      });
      systemPrompt = firstNonEmptyString(prepared.systemPrompt) ?? defaultSummaryTemplate;
    } else {
      systemPrompt = defaultSummaryTemplate;
    }

    const inferenceOptions = mergeModelInferenceOptions(modelConfig.inferenceOptions, modelParamsInferenceOptions(inputs));

    let modelResult: ModelFinalResult;
    try {
      modelResult = await modelInvocation.complete(
        buildKnowledgeModelInvocationRequest(context, modelConfig, inferenceOptions, [
          {
            role: 'SYSTEM',
            content: [{ type: 'text', text: systemPrompt }],
          },
          {
            role: 'USER',
            content: [{ type: 'text', text: knowledgeItem }],
          },
        ]),
        context.signal,
      );
    } catch (error) {
      if (error instanceof AgentError && error.category === 'POLICY_DENIED') {
        throw error;
      }
      logger.warn({ event: 'knowledge-qa.summary.failed', nodeId: context.nodeId, error: error instanceof Error ? error.message : String(error) });
      summaries.push('');
      continue;
    }

    if (modelResult.safeError !== undefined) {
      if (modelResult.safeError.category === 'POLICY_DENIED') {
        throw new AgentError({
          code: modelResult.safeError.code,
          message: modelResult.safeError.message,
          category: modelResult.safeError.category,
          retryable: modelResult.safeError.retryable,
          ...(modelResult.safeError.safeDetails === undefined ? {} : { safeDetails: modelResult.safeError.safeDetails }),
        });
      }
      logger.warn({ event: 'knowledge-qa.summary.model-error', nodeId: context.nodeId, code: modelResult.safeError.code });
      summaries.push('');
      continue;
    }

    // Content safety guardrail inline
    await applyGuardrailIfNeeded(context, options, inputs, modelResult.content);

    lastCompletion = modelResult.content;
    summaries.push(modelResult.content);
  }

  return { summaries, lastCompletion };
}

// --- Content safety guardrail ---

async function applyGuardrailIfNeeded(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  inputs: Record<string, unknown>,
  content: string,
): Promise<void> {
  const guardrailEnabled = inputs.open_guardrail === true || inputs.open_guardrail === 'true';
  if (!guardrailEnabled) {
    return;
  }
  if (options.evaluateGuardrail === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE',
      message: 'Workflow guardrail boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const guardrailResult = await options.evaluateGuardrail(
    {
      policyId: 'workflow:knowledge-qa',
      guardrailType: 'ANSWER',
      content,
      safeContentSummary: content.length <= 200 ? content : content.slice(0, 200),
      sessionId: context.request.sessionId,
      requestId: context.request.requestId,
      runId: context.request.runId,
      agentId: context.request.agentId,
      agentVersion: context.request.agentVersion,
      workflowNodeId: context.nodeId,
      workflowNodeType: context.node.type,
    },
    context.signal,
  );
  if (guardrailResult.safeError !== undefined) {
    throw new AgentError({
      code: guardrailResult.safeError.code,
      message: guardrailResult.safeError.message,
      category: guardrailResult.safeError.category,
      retryable: guardrailResult.safeError.retryable,
      ...(guardrailResult.safeError.safeDetails === undefined ? {} : { safeDetails: guardrailResult.safeError.safeDetails }),
    });
  }
  if (guardrailResult.decision === 'REJECT') {
    throw new AgentError({
      code: 'UN_SAFE',
      message: 'Content safety guardrail rejected the response.',
      category: 'POLICY_DENIED',
      retryable: false,
      safeDetails: { reasonCode: 'UN_SAFE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
}

// --- Model config with capability hint ---
