import { Ajv } from 'ajv/dist/ajv.js';
import { AgentError, type JsonObject, type JsonValue, type WorkflowNodeType } from '@nextagent/agent-common';
import { renderTemplate } from '../template-engine/index.js';
import type { WorkflowExecutionDiagnostic, WorkflowNodeDef } from '@nextagent/agent-contracts/core';
import {
  type ModelFinalResult,
  type ModelInferenceOptions,
  type ModelInvocationRequest,
  type ModelMessage,
  type ModelStreamDelta,
} from '@nextagent/agent-contracts/model';
import type {
  CreateWorkflowNodeCatalogOptions,
  IntentMatchRule,
  WorkflowNodeHandlerContext,
  WorkflowNodeHandlerResult,
  WorkflowNodeLlmPrompt,
  WorkflowModelInvocationHint,
  WorkflowNodeModelInvocationConfig,
} from './types.js';
import {
  compressLlmPrompt,
  extractTelecomTerms,
  firstNonEmptyString,
  invalidLlmOutput,
  invalidNodeInput,
  isRecord,
  llmTrace,
  mergeDiagnostics,
  mergeModelInferenceOptions,
  modelParamsInferenceOptions,
  projectNodeOutputs,
  readWorkflowOutputSchema,
  requireModelInvocation,
  resolveNodeValue,
  sanitizeModelValue,
  stringifyPromptField,
  buildCapabilityInvocationRequest,
  capabilityResultPayload,
  nodeTimeoutMs,
  nodeTrace,
} from './shared.js';
import { executeBatch, readBatchConfig, type BatchExecutionConfig, type BatchElementResult, type BatchOutput } from './batch.js';

const workflowSchemaValidator = new Ajv({ allErrors: true, strict: false });

export async function executeLlmNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const batchConfig = readBatchConfig(context);
  if (batchConfig !== undefined) {
    if (context.node.type !== 'LLM_ROUTER') {
      throw new AgentError({
        code: 'WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE',
        message: 'Workflow batch is only supported for LLM_ROUTER among LLM-family nodes.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE', nodeId: context.nodeId, nodeType: context.node.type },
      });
    }
    return executeLlmBatch(context, options, batchConfig);
  }
  const rawInputs = context.node.inputs;
  const rawPromptTemplate =
    isRecord(rawInputs) && typeof rawInputs.prompt_template === 'string' && rawInputs.prompt_template.length > 0
      ? rawInputs.prompt_template
      : undefined;
  const rawPromptTemplateName =
    isRecord(rawInputs) && typeof rawInputs.prompt_template_name === 'string' && rawInputs.prompt_template_name.length > 0
      ? rawInputs.prompt_template_name
      : undefined;
  const resolvedInputs = rawInputs === undefined ? {} : sanitizeInputs(context, rawInputs);

  if (context.node.type === 'DATA_ANALYSIS') {
    const dataValue = (resolvedInputs as Record<string, unknown>).data;
    if (dataValue === undefined) {
      throw new AgentError({
        code: 'WORKFLOW_DATA_ANALYSIS_INVALID_INPUT',
        message: 'Workflow data-analysis node requires serializable data input.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_DATA_ANALYSIS_INVALID_INPUT', nodeId: context.nodeId, nodeType: context.node.type },
      });
    }
    try {
      JSON.stringify(dataValue);
    } catch {
      throw new AgentError({
        code: 'WORKFLOW_DATA_ANALYSIS_INVALID_INPUT',
        message: 'Workflow data-analysis node data input is not serializable.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_DATA_ANALYSIS_INVALID_INPUT', nodeId: context.nodeId, nodeType: context.node.type },
      });
    }
  }

  const ruleResult = await tryIntentRuleMatch(context, options, resolvedInputs);
  if (ruleResult !== undefined) {
    return ruleResult;
  }

  const modelInvocation = requireModelInvocation(options.modelInvocation);
  if (options.resolveModelInvocationConfig === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE',
      message: 'Workflow model invocation boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }

  const modelConfig = await options.resolveModelInvocationConfig(context.request, context.signal, workflowModelHint(resolvedInputs));
  const promptPreparation = await prepareWorkflowLlmPrompt(context, options, modelConfig, resolvedInputs, rawPromptTemplate, rawPromptTemplateName);
  const promptBudget = applyWorkflowLlmBudget(context, modelConfig, promptPreparation);
  const invocationRequest = buildWorkflowModelInvocationRequest(context, modelConfig, promptBudget, resolvedInputs);
  const isStream = shouldUseStreamMode(resolvedInputs, context);
  let modelResult: ModelFinalResult;
  if (isStream) {
    let emittedContent = false;
    let emittedReasoning = false;
    modelResult = await modelInvocation.stream(invocationRequest, context.signal, async (delta) => {
      emittedContent = (await emitWorkflowModelDelta(context, delta, 'content', 'CONTENT', 'ANSWER')) || emittedContent;
      emittedReasoning = (await emitWorkflowModelDelta(context, delta, 'reasoning', 'THINKING', 'DETAIL')) || emittedReasoning;
    });
    if (!emittedContent) {
      await emitWorkflowModelDelta(context, modelResult, 'content', 'CONTENT', 'ANSWER');
    }
    if (!emittedReasoning) {
      await emitWorkflowModelDelta(context, modelResult, 'reasoning', 'THINKING', 'DETAIL');
    }
  } else {
    modelResult = await modelInvocation.complete(invocationRequest, context.signal);
  }
  if (modelResult.safeError !== undefined) {
    throw new AgentError({
      code: modelResult.safeError.code,
      message: modelResult.safeError.message ?? 'Workflow LLM node failed safely.',
      category: modelResult.safeError.category,
      retryable: modelResult.safeError.retryable,
      ...(modelResult.safeError.safeDetails === undefined ? {} : { safeDetails: modelResult.safeError.safeDetails }),
    });
  }
  const payload = parseWorkflowLlmPayload(context, resolvedInputs, modelResult.content);
  const finalPayload = await tryDataAnalysisSandbox(context, options, payload);

  const diagnostic = mergeDiagnostics(promptPreparation.diagnostic, promptBudget.diagnostic);
  const trace = llmTrace(context);
  const outputVariables = projectWorkflowLlmOutputs(context.node, context.node.type, finalPayload, trace, modelResult, resolvedInputs);
  return {
    outputVariables,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}

async function emitWorkflowModelDelta(
  context: WorkflowNodeHandlerContext,
  event: ModelStreamDelta | ModelFinalResult,
  field: 'content' | 'reasoning',
  channel: 'CONTENT' | 'THINKING',
  level: 'ANSWER' | 'DETAIL',
): Promise<boolean> {
  const content = event[field];
  if (typeof content !== 'string' || content.length === 0) {
    return false;
  }
  await context.emitOutputDelta({ channel, content, level });
  return true;
}

async function executeLlmBatch(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  config: BatchExecutionConfig,
): Promise<WorkflowNodeHandlerResult> {
  const rawInputs = context.node.inputs;
  const rawPromptTemplate =
    isRecord(rawInputs) && typeof rawInputs.prompt_template === 'string' && rawInputs.prompt_template.length > 0
      ? rawInputs.prompt_template
      : undefined;
  const rawPromptTemplateName =
    isRecord(rawInputs) && typeof rawInputs.prompt_template_name === 'string' && rawInputs.prompt_template_name.length > 0
      ? rawInputs.prompt_template_name
      : undefined;

  if (options.resolveModelInvocationConfig === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE',
      message: 'Workflow model invocation boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const modelInvocation = requireModelInvocation(options.modelInvocation);
  const batchResolvedInputs = rawInputs === undefined ? {} : sanitizeInputs(context, rawInputs);
  const modelConfig = await options.resolveModelInvocationConfig(context.request, context.signal, workflowModelHint(batchResolvedInputs));
  const trace = llmTrace(context);

  const processElement = async (element: unknown, index: number, signal: AbortSignal): Promise<BatchElementResult> => {
    try {
      const elementContext: WorkflowNodeHandlerContext = {
        ...context,
        variables: Object.freeze({ ...context.variables, [config.elementVariable]: element }) as JsonObject,
      };
      const resolvedInputs = rawInputs === undefined ? {} : sanitizeInputs(elementContext, rawInputs);

      const promptPreparation = await prepareWorkflowLlmPrompt(
        elementContext,
        options,
        modelConfig,
        resolvedInputs,
        rawPromptTemplate,
        rawPromptTemplateName,
      );
      const promptBudget = applyWorkflowLlmBudget(elementContext, modelConfig, promptPreparation);
      const invocationRequest = buildWorkflowModelInvocationRequest(elementContext, modelConfig, promptBudget, resolvedInputs);

      const modelResult = await modelInvocation.complete(invocationRequest, signal);
      if (modelResult.safeError !== undefined) {
        return {
          failed: {
            code: modelResult.safeError.code,
            message: modelResult.safeError.message ?? 'Workflow LLM node failed safely.',
          },
        };
      }
      const payload = parseWorkflowLlmPayload(elementContext, resolvedInputs, modelResult.content);
      const bindings = llmOutputBindings(context.node.type, payload, modelResult, resolvedInputs);
      return { result: bindings };
    } catch (error) {
      if (error instanceof AgentError) {
        return { failed: { code: error.code, message: error.message } };
      }
      return { failed: { code: 'WORKFLOW_LLM_BATCH_ELEMENT_FAILED', message: 'LLM batch element failed.' } };
    }
  };

  const buildOutput = (output: BatchOutput): JsonObject => {
    const lastResult = output.elementResults[config.items.length - 1];
    return {
      batch_results: filterBatchElementFields(output.batchResults, context.node.outputs) as unknown as JsonValue,
      failed_items: Object.freeze(output.failedItems),
      ...(lastResult === undefined ? {} : lastResult),
      invocation_trace: trace,
    };
  };

  return executeBatch(config, context, processElement, buildOutput);
}

async function tryIntentRuleMatch(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolvedInputs: Record<string, unknown>,
): Promise<WorkflowNodeHandlerResult | undefined> {
  if (context.node.type !== 'INTENT_RECOGNITION' || options.resolveIntentRules === undefined) {
    return undefined;
  }
  const rules = await options.resolveIntentRules(context.request);
  const matched = matchIntentRules(rules, resolvedInputs);
  if (matched === undefined) {
    return undefined;
  }
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        intent_recognition_result: Object.freeze({ intent: matched.intentName, confidence: matched.confidence, source: 'rule' }),
        intent: matched.intentName,
        confidence: matched.confidence,
      } as unknown as JsonObject,
      context.node,
    ),
  };
}

async function tryDataAnalysisSandbox(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  payload: unknown,
): Promise<unknown> {
  if (context.node.type !== 'DATA_ANALYSIS' || !isRecord(payload)) {
    return payload;
  }
  const code = payload.analysisResult;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return payload;
  }
  const resolvedCapability = typeof options.capabilityInvocation === 'function' ? options.capabilityInvocation() : options.capabilityInvocation;
  if (resolvedCapability === undefined) {
    return payload;
  }
  const pythonTrace = nodeTrace(context, 'Python');
  const pythonResult = await resolvedCapability.invoke(buildCapabilityInvocationRequest(context, 'Python', { code, args: [] }), context.signal);
  const sandboxPayload = capabilityResultPayload(pythonResult, pythonTrace);
  return Object.freeze({
    analysis_result: sandboxPayload,
    python_result: sandboxPayload,
  }) as JsonObject;
}

function sanitizeInputs(context: WorkflowNodeHandlerContext, value: unknown): Record<string, unknown> {
  const resolvedInputs = resolveNodeValue(value, context.variables);
  if (!isRecord(resolvedInputs)) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'inputs');
  }
  return resolvedInputs;
}

function workflowModelHint(resolvedInputs: Record<string, unknown>): WorkflowModelInvocationHint | undefined {
  const modelId = firstNonEmptyString(resolvedInputs.model);
  const modelGroup = firstNonEmptyString(resolvedInputs.modelGroup);
  const capabilityId = firstNonEmptyString(resolvedInputs.capability);
  if (modelId === undefined && modelGroup === undefined && capabilityId === undefined) {
    return undefined;
  }
  return {
    ...(modelId === undefined ? {} : { modelId }),
    ...(modelGroup === undefined ? {} : { modelGroup }),
    ...(capabilityId === undefined ? {} : { capabilityId }),
  };
}

async function prepareWorkflowLlmPrompt(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  modelConfig: WorkflowNodeModelInvocationConfig,
  resolvedInputs: Record<string, unknown>,
  rawPromptTemplate?: string,
  rawPromptTemplateName?: string,
): Promise<WorkflowNodeLlmPrompt> {
  const defaultUserPrompt = buildWorkflowLlmUserPrompt(context.node.type, resolvedInputs);
  const defaultPurpose = defaultWorkflowPromptPurpose(context.node.type, resolvedInputs);

  // Priority 1: prompt_template (raw from inputs, rendered through template engine)
  if (rawPromptTemplate !== undefined) {
    const systemPrompt = renderTemplate(rawPromptTemplate, context.variables);
    return { systemPrompt, userPrompt: defaultUserPrompt };
  }

  // Priority 2: prompt_template_name (raw name from inputs, assemble then render)
  if (rawPromptTemplateName !== undefined) {
    if (options.prepareLlmPrompt === undefined) {
      throw new AgentError({
        code: 'WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE',
        message: 'Workflow LLM prompt template could not be resolved: no prompt assembler configured.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE',
          nodeId: context.nodeId,
          nodeType: context.node.type,
          promptTemplateName: rawPromptTemplateName,
        },
      });
    }
    const prepared = await options.prepareLlmPrompt({
      request: context.request,
      nodeId: context.nodeId,
      node: context.node,
      resolvedInputs,
      variables: context.variables,
      modelConfig,
      defaultPurpose,
      defaultUserPrompt,
    });
    const systemPrompt = renderTemplate(prepared.systemPrompt ?? '', context.variables);
    return systemPrompt.length > 0
      ? { ...prepared, systemPrompt }
      : {
          userPrompt: prepared.userPrompt,
          ...(prepared.inferenceOptions === undefined ? {} : { inferenceOptions: prepared.inferenceOptions }),
          ...(prepared.diagnostic === undefined ? {} : { diagnostic: prepared.diagnostic }),
        };
  }

  // Priority 3: Both empty -> use query/question from variables as userPrompt, no systemPrompt
  const queryFromVariables = firstNonEmptyString(context.variables.query, context.variables.question);
  if (queryFromVariables !== undefined) {
    return { userPrompt: queryFromVariables };
  }

  const prepared = await options.prepareLlmPrompt?.({
    request: context.request,
    nodeId: context.nodeId,
    node: context.node,
    resolvedInputs,
    variables: context.variables,
    modelConfig,
    defaultPurpose,
    defaultUserPrompt,
  });
  if (prepared !== undefined) {
    return prepared;
  }
  return {
    ...(typeof resolvedInputs.prompt_template === 'string' && resolvedInputs.prompt_template.length > 0
      ? { systemPrompt: resolvedInputs.prompt_template }
      : {}),
    userPrompt: defaultUserPrompt,
  };
}

function buildWorkflowModelInvocationRequest(
  context: WorkflowNodeHandlerContext,
  modelConfig: WorkflowNodeModelInvocationConfig,
  prompt: WorkflowNodeLlmPrompt,
  resolvedInputs: Record<string, unknown>,
): ModelInvocationRequest {
  const messages: ModelMessage[] = [];
  if (typeof prompt.systemPrompt === 'string' && prompt.systemPrompt.trim().length > 0) {
    messages.push({ role: 'SYSTEM', content: [{ type: 'text', text: prompt.systemPrompt }] });
  }
  messages.push({ role: 'USER', content: [{ type: 'text', text: prompt.userPrompt }] });
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
    ...workflowLlmInferenceOptions(modelConfig.inferenceOptions, prompt.inferenceOptions, resolvedInputs),
    timeoutMs: nodeTimeoutMs(context.node, modelConfig.timeoutMs),
    maxRetries: modelConfig.maxRetries,
  };
}

function workflowLlmInferenceOptions(
  base: ModelInferenceOptions,
  promptOptions: ModelInferenceOptions | undefined,
  resolvedInputs: Record<string, unknown>,
): ModelInferenceOptions {
  return mergeModelInferenceOptions(mergeModelInferenceOptions(base, promptOptions), modelParamsInferenceOptions(resolvedInputs));
}

function applyWorkflowLlmBudget(
  context: WorkflowNodeHandlerContext,
  modelConfig: WorkflowNodeModelInvocationConfig,
  prompt: WorkflowNodeLlmPrompt,
): WorkflowNodeLlmPrompt {
  const budgetChars = modelConfig.contextWindowTokens === undefined ? undefined : Math.max(512, Math.floor(modelConfig.contextWindowTokens * 3));
  if (budgetChars === undefined) {
    return prompt;
  }
  const systemPrompt = prompt.systemPrompt ?? '';
  const totalChars = systemPrompt.length + prompt.userPrompt.length;
  if (totalChars <= budgetChars) {
    return prompt;
  }
  const availableUserChars = Math.max(160, budgetChars - systemPrompt.length);
  const compressedUserPrompt = compressLlmPrompt(prompt.userPrompt, availableUserChars);
  if (systemPrompt.length + compressedUserPrompt.length > budgetChars) {
    throw new AgentError({
      code: 'WORKFLOW_LLM_BUDGET_EXCEEDED',
      message: 'Workflow LLM node exceeded the safe model budget.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        reasonCode: 'WORKFLOW_LLM_BUDGET_EXCEEDED',
        nodeId: context.nodeId,
        nodeType: context.node.type,
      },
    });
  }
  const diagnostic = mergeDiagnostics(prompt.diagnostic, {
    reasonCode: 'WORKFLOW_LLM_PROMPT_COMPRESSED',
  });
  return {
    ...prompt,
    userPrompt: compressedUserPrompt,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}

function parseWorkflowLlmPayload(context: WorkflowNodeHandlerContext, resolvedInputs: Record<string, unknown>, content: string): unknown {
  switch (context.node.type) {
    case 'INTENT_RECOGNITION':
      return validateIntentRecognitionResult(context, parseStructuredModelOutput(content, context, 'intent_recognition'));
    case 'QUESTION_REWRITING':
      return validateQuestionRewritingResult(context, resolvedInputs, parseStructuredModelOutput(content, context, 'question_rewriting'));
    case 'TRANSLATION':
      return validateTranslationResult(context, parseStructuredModelOutput(content, context, 'translation'));
    case 'DATA_ANALYSIS':
      return validateDataAnalysisResult(context, parseStructuredModelOutput(content, context, 'data_analysis'));
    case 'PARAM_EXTRACT':
      return validateParamExtractResult(context, resolvedInputs, parseStructuredModelOutput(content, context, 'param_extract'));
    case 'LLM':
    case 'LLM_ROUTER':
    default:
      return validateLlmRouterResult(context, resolvedInputs, content);
  }
}

function validateLlmRouterResult(context: WorkflowNodeHandlerContext, resolvedInputs: Record<string, unknown>, content: string): unknown {
  const outputSchema = readWorkflowOutputSchema(context.node, resolvedInputs);
  if (outputSchema !== undefined) {
    const parsed = parseJsonContent(content, context, 'llm_router');
    validateJsonSchema(outputSchema, parsed, context, 'outputSchema');
    return sanitizeModelValue(parsed);
  }
  return content.trim();
}

function validateIntentRecognitionResult(context: WorkflowNodeHandlerContext, candidate: unknown): JsonObject {
  if (!isRecord(candidate) || typeof candidate.intent !== 'string' || typeof candidate.confidence !== 'number') {
    throw invalidLlmOutput(context, 'intent_recognition');
  }
  if (candidate.confidence < 0 || candidate.confidence > 1) {
    throw invalidLlmOutput(context, 'confidence');
  }
  return Object.freeze({ intent: candidate.intent, confidence: candidate.confidence }) as JsonObject;
}

function validateQuestionRewritingResult(
  context: WorkflowNodeHandlerContext,
  resolvedInputs: Record<string, unknown>,
  candidate: unknown,
): JsonObject {
  if (!isRecord(candidate) || typeof candidate.rewrittenQuery !== 'string' || candidate.rewrittenQuery.trim().length === 0) {
    throw invalidLlmOutput(context, 'question_rewriting');
  }
  // Check askQuestion first: LLM indicates it needs user clarification
  const askQuestion = firstNonEmptyString(candidate.askQuestion, candidate.ask_question);
  if (askQuestion !== undefined) {
    throw new AgentError({
      code: 'WORKFLOW_QUESTION_REWRITING_ASK_QUESTION',
      message: 'Question rewriting requires user clarification.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        reasonCode: 'WORKFLOW_QUESTION_REWRITING_ASK_QUESTION',
        nodeId: context.nodeId,
        nodeType: context.node.type,
        askQuestion,
      },
    });
  }
  // Telecom term preservation: ensure critical network terms survive rewriting
  const sourceText =
    firstNonEmptyString(resolvedInputs.input_question, resolvedInputs.question, resolvedInputs.text, resolvedInputs.source_text) ?? '';
  if (sourceText.length > 0) {
    const criticalTerms = extractTelecomTerms(sourceText);
    for (const term of criticalTerms) {
      if (!candidate.rewrittenQuery.includes(term)) {
        throw invalidLlmOutput(context, 'telecom_term_preservation');
      }
    }
  }
  return Object.freeze({ rewrittenQuery: candidate.rewrittenQuery.trim() }) as JsonObject;
}

function validateTranslationResult(context: WorkflowNodeHandlerContext, candidate: unknown): JsonObject {
  if (!isRecord(candidate) || typeof candidate.translatedText !== 'string' || candidate.translatedText.trim().length === 0) {
    throw invalidLlmOutput(context, 'translation');
  }
  return Object.freeze({ translatedText: candidate.translatedText.trim() }) as JsonObject;
}

function validateDataAnalysisResult(context: WorkflowNodeHandlerContext, candidate: unknown): JsonObject {
  if (!isRecord(candidate) || candidate.analysisResult === undefined) {
    throw invalidLlmOutput(context, 'data_analysis');
  }
  return Object.freeze({ analysisResult: sanitizeModelValue(candidate.analysisResult) }) as JsonObject;
}

function validateParamExtractResult(context: WorkflowNodeHandlerContext, resolvedInputs: Record<string, unknown>, candidate: unknown): JsonObject {
  if (!isRecord(candidate) || !isRecord(candidate.extractedParams)) {
    throw invalidLlmOutput(context, 'param_extract');
  }
  const paramSchema = isRecord(resolvedInputs.paramSchema)
    ? resolvedInputs.paramSchema
    : isRecord(resolvedInputs.param_schema)
      ? resolvedInputs.param_schema
      : undefined;
  if (paramSchema !== undefined) {
    validateJsonSchema(paramSchema as JsonObject, candidate.extractedParams, context, 'paramSchema');
  }
  return Object.freeze({ extractedParams: sanitizeModelValue(candidate.extractedParams) }) as JsonObject;
}

function parseStructuredModelOutput(content: string, context: WorkflowNodeHandlerContext, outputKind: string): unknown {
  return sanitizeModelValue(parseJsonContent(content, context, outputKind));
}

function parseJsonContent(content: string, context: WorkflowNodeHandlerContext, outputKind: string): unknown {
  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    throw invalidLlmOutput(context, outputKind);
  }
}

function validateJsonSchema(schema: JsonObject, value: unknown, context: WorkflowNodeHandlerContext, outputKind: string): void {
  const validate = workflowSchemaValidator.compile(schema);
  if (!validate(value)) {
    throw invalidLlmOutput(context, outputKind);
  }
}

function llmOutputBindings(
  nodeType: WorkflowNodeType,
  safePayload: unknown,
  modelResult: ModelFinalResult,
  resolvedInputs: Record<string, unknown>,
): JsonObject {
  switch (nodeType) {
    case 'INTENT_RECOGNITION': {
      const payloadObject = isRecord(safePayload) ? safePayload : {};
      return Object.freeze({
        intent_recognition_result: Object.freeze(payloadObject),
        ...(payloadObject.intent === undefined ? {} : { intent: payloadObject.intent }),
        ...(payloadObject.confidence === undefined ? {} : { confidence: payloadObject.confidence }),
      }) as JsonObject;
    }
    case 'QUESTION_REWRITING': {
      const payloadObject = isRecord(safePayload) ? safePayload : {};
      return Object.freeze({
        question_rewriting_result: Object.freeze(payloadObject),
        ...(payloadObject.rewrittenQuery === undefined ? {} : { rewritten_input_question: payloadObject.rewrittenQuery }),
      }) as JsonObject;
    }
    case 'TRANSLATION': {
      const payloadObject = isRecord(safePayload) ? safePayload : {};
      return Object.freeze({
        translation_result: Object.freeze(payloadObject),
        ...(payloadObject.translatedText === undefined ? {} : { translated_text: payloadObject.translatedText }),
      }) as JsonObject;
    }
    case 'DATA_ANALYSIS': {
      // sandbox path: { analysis_result, python_result }; legacy path: { analysisResult }
      const payloadObject = isRecord(safePayload) ? safePayload : {};
      const result = payloadObject.analysis_result ?? payloadObject.analysisResult;
      return Object.freeze({
        data_analysis_result: Object.freeze(payloadObject),
        ...(result === undefined ? {} : { analysis_result: result }),
        ...(payloadObject.python_result === undefined ? {} : { python_result: payloadObject.python_result }),
      }) as JsonObject;
    }
    case 'PARAM_EXTRACT': {
      const payloadObject = isRecord(safePayload) ? safePayload : {};
      return Object.freeze({
        param_extract_result: Object.freeze(payloadObject),
        ...(payloadObject.extractedParams === undefined ? {} : { extracted_params: payloadObject.extractedParams }),
      }) as JsonObject;
    }
    case 'LLM':
    case 'LLM_ROUTER':
    default:
      return Object.freeze({
        llm_result: Object.freeze({
          content: safePayload,
          ...(typeof modelResult.reasoning === 'string' && modelResult.reasoning.length > 0 ? { reasoning: modelResult.reasoning } : {}),
          ...(modelResult.toolCalls !== undefined ? { toolCalls: modelResult.toolCalls } : {}),
          ...(modelResult.finishReason !== undefined ? { finishReason: modelResult.finishReason } : {}),
          ...(modelResult.usage !== undefined ? { usage: modelResult.usage } : {}),
        }),
        llm_completion: buildLlmCompletion(safePayload, modelResult, resolvedInputs),
      }) as unknown as JsonObject;
  }
}

function buildWorkflowLlmUserPrompt(nodeType: WorkflowNodeType, inputs: Record<string, unknown>): string {
  switch (nodeType) {
    case 'INTENT_RECOGNITION':
      return [
        'Classify the workflow request into one candidate telecom intent.',
        `Candidates: ${JSON.stringify(inputs.candidate_intents ?? inputs.candidateIntents ?? [])}`,
        `Input: ${firstNonEmptyString(inputs.query_text, inputs.question, inputs.text, inputs.source_text) ?? ''}`,
        'Return JSON with keys intent and confidence.',
      ].join('\n');
    case 'QUESTION_REWRITING':
      return [
        'Rewrite the telecom workflow request for downstream retrieval or reasoning.',
        'Preserve network element names, alarm codes, KPI names, and other telecom terms.',
        `History summary: ${stringifyPromptField(inputs.history_summary)}`,
        `Domain context: ${stringifyPromptField(inputs.domain_context)}`,
        `Original question: ${firstNonEmptyString(inputs.input_question, inputs.question, inputs.text, inputs.source_text) ?? ''}`,
        'Return JSON with key rewrittenQuery.',
      ].join('\n');
    case 'TRANSLATION':
      return [
        `Translate from ${String(inputs.sourceLang ?? inputs.source_lang ?? 'auto')} to ${String(inputs.targetLang ?? inputs.target_lang ?? 'ZH')}.`,
        `Text: ${firstNonEmptyString(inputs.text, inputs.source_text, inputs.input_text) ?? ''}`,
        'Return JSON with key translatedText.',
      ].join('\n');
    case 'DATA_ANALYSIS':
      return [
        'Analyze the provided structured telecom data safely.',
        `Analysis prompt: ${stringifyPromptField(inputs.analysisPrompt ?? inputs.analysis_prompt)}`,
        `Data: ${JSON.stringify(inputs.data)}`,
        'Return JSON with key analysisResult.',
      ].join('\n');
    case 'PARAM_EXTRACT':
      return [
        'Extract structured parameters for the workflow node.',
        `Source text: ${firstNonEmptyString(inputs.text, inputs.source_text, inputs.question, inputs.input_text) ?? ''}`,
        `Parameter schema: ${JSON.stringify(inputs.paramSchema ?? inputs.param_schema ?? {})}`,
        'Return JSON with key extractedParams.',
      ].join('\n');
    case 'LLM':
    case 'LLM_ROUTER':
    default:
      return firstNonEmptyString(inputs.prompt, inputs.user_prompt, inputs.source_text, inputs.question, inputs.text, inputs.taskDescription) ?? '';
  }
}

function defaultWorkflowPromptPurpose(nodeType: WorkflowNodeType, inputs: Record<string, unknown>): string {
  const configured = firstNonEmptyString(inputs.prompt_template_name, inputs.promptPurpose, inputs.prompt_purpose);
  if (configured !== undefined) {
    return configured;
  }
  switch (nodeType) {
    case 'INTENT_RECOGNITION':
      return 'workflow.intent-recognition';
    case 'QUESTION_REWRITING':
      return 'workflow.question-rewriting';
    case 'TRANSLATION':
      return 'workflow.translation';
    case 'DATA_ANALYSIS':
      return 'workflow.data-analysis';
    case 'PARAM_EXTRACT':
      return 'workflow.param-extract';
    case 'LLM':
    case 'LLM_ROUTER':
    default:
      return 'workflow.llm-router';
  }
}

function projectWorkflowLlmOutputs(
  node: WorkflowNodeDef,
  nodeType: WorkflowNodeType,
  payload: unknown,
  trace: JsonObject,
  modelResult: ModelFinalResult,
  resolvedInputs: Record<string, unknown>,
): JsonObject {
  return projectNodeOutputs(
    node.outputs,
    {
      ...llmOutputBindings(nodeType, payload, modelResult, resolvedInputs),
      invocation_trace: trace,
    },
    node,
  );
}

function shouldUseStreamMode(resolvedInputs: Record<string, unknown>, context: WorkflowNodeHandlerContext): boolean {
  // Explicit is_stream takes precedence (string comparison)
  if (typeof resolvedInputs.is_stream === 'string') {
    return resolvedInputs.is_stream === 'true';
  }
  if (typeof resolvedInputs.isStream === 'string') {
    return resolvedInputs.isStream === 'true';
  }
  // Default stream: main recipe (subRecipeDepth undefined or 0) + node next points to END
  const subRecipeDepth = (context.request.executionMetadata as Record<string, unknown> | undefined)?.subRecipeDepth;
  if (subRecipeDepth !== undefined && subRecipeDepth !== 0) {
    return false;
  }
  const endNodeId = Object.entries(context.recipe.flowGraph.nodes).find(([, n]) => n.type === 'END')?.[0];
  if (endNodeId === undefined) {
    return false;
  }
  const nextIds = Object.keys(context.node.next ?? {});
  return nextIds.includes(endNodeId);
}

function buildLlmCompletion(safePayload: unknown, modelResult: ModelFinalResult, resolvedInputs: Record<string, unknown>): unknown {
  const parsedContent = tryParseJsonContent(safePayload);
  // result_with_think="true" explicitly: include { content, reasoning } when reasoning exists
  if (resolvedInputs.result_with_think === 'true' && typeof modelResult.reasoning === 'string' && modelResult.reasoning.length > 0) {
    return Object.freeze({ content: parsedContent, reasoning: modelResult.reasoning });
  }
  // default or result_with_think="false": only content
  return parsedContent;
}

function filterBatchElementFields(
  batchResults: readonly unknown[] | Record<string, unknown> | undefined,
  outputs: WorkflowNodeDef['outputs'],
): unknown {
  if (batchResults === undefined || !Array.isArray(batchResults)) {
    return batchResults;
  }
  if (!isRecord(outputs) || Object.keys(outputs).length === 0) {
    return batchResults;
  }
  const elementKeys = collectElementBindingRefs(outputs);
  if (elementKeys.size === 0) {
    return batchResults;
  }
  return batchResults.map((element) => {
    if (!isRecord(element)) {
      return element;
    }
    const filtered: Record<string, unknown> = {};
    for (const key of elementKeys) {
      if (key in element) {
        filtered[key] = element[key];
      }
    }
    return Object.freeze(filtered);
  });
}

function collectElementBindingRefs(outputs: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const pattern = /\$\{(llm_result|llm_completion)[.}]/gu;
  for (const value of Object.values(outputs)) {
    if (typeof value === 'string') {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null) {
        keys.add(match[1]!);
      }
    }
  }
  return keys;
}

function tryParseJsonContent(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const stripped = stripJsonFence(value).trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return value;
  }
}

function stripJsonFence(value: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(value.trim());
  return fenced?.[1] ?? value;
}

function matchIntentRules(
  rules: readonly IntentMatchRule[],
  resolvedInputs: Record<string, unknown>,
): { readonly intentName: string; readonly confidence: number } | undefined {
  const queryText = firstNonEmptyString(resolvedInputs.query_text, resolvedInputs.question, resolvedInputs.text, resolvedInputs.source_text);
  if (queryText === undefined || rules.length === 0) {
    return undefined;
  }
  const lowerQuery = queryText.toLowerCase();
  for (const rule of rules) {
    if (rule.patterns.length === 0) {
      continue;
    }
    let matched = false;
    switch (rule.matchMode) {
      case 'ANY':
        matched = rule.patterns.some((pattern) => lowerQuery.includes(pattern.toLowerCase()));
        break;
      case 'MUST':
        matched = rule.patterns.every((pattern) => lowerQuery.includes(pattern.toLowerCase()));
        break;
      case 'NOT':
        matched = !rule.patterns.some((pattern) => lowerQuery.includes(pattern.toLowerCase()));
        break;
    }
    if (matched) {
      return { intentName: rule.intentName, confidence: 0.95 };
    }
  }
  return undefined;
}
