import { AgentError, type JsonObject, type SafeError, type ToolEventType, type WorkflowNodeType } from '@nextagent/agent-common';
import { TOOL_EVENT_TYPES } from '@nextagent/agent-common';
import type { WorkflowExecutionRequest, WorkflowVisibleDeltaChannel } from '@nextagent/agent-contracts/core';
import type {
  CreateWorkflowNodeCatalogOptions,
  WorkflowPendingInputActivation,
  WorkflowNodeHandlerContext,
  WorkflowNodeHandlerResult,
} from './types.js';
import {
  asJsonObject,
  buildNodeRecordInfo,
  coerceBoolean,
  coerceNumber,
  firstNonEmptyString,
  invalidNodeInput,
  isRecord,
  projectNodeOutputs,
  hasObjectOutputParserData,
  resolveSubRecipeAnswerNodeId,
  resolveNodeValue,
} from './shared.js';

// Only match known HTML tag names so that plain-text angle-bracket tokens like
// <Finished> are not misidentified as unsafe HTML.
const blockedHtmlPattern =
  /<\/?(?:a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|picture|pre|progress|q|rp|rt|ruby|s|samp|script|section|select|slot|small|source|span|strike|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)\b/iu;
const maxSubRecipeDepth = 3;

export async function executeDisplayContentNode(context: WorkflowNodeHandlerContext): Promise<WorkflowNodeHandlerResult> {
  const effectiveOutputParser = resolveDisplayOutputParser(context);
  const outputType = readDisplayOutputType(effectiveOutputParser);
  const displayChannel = resolveDisplayChannel(outputType);
  const rawOutputs = context.node.outputs;
  const resolvedOutputs: Record<string, unknown> = isRecord(rawOutputs)
    ? (resolveNodeValue(rawOutputs, context.variables) as Record<string, unknown>)
    : {};
  const resolvedInputs = resolveInteractionInputs(context);
  // output_parser is visibility/control config, not display data
  const displayOutputs = { ...resolvedOutputs };
  delete displayOutputs.output_parser;
  const hasObjectParserData = hasObjectOutputParserData(effectiveOutputParser);
  const inputContent = firstNonEmptyString(resolvedInputs.content, resolvedInputs.text, resolvedInputs.message, resolvedInputs.prompt);
  const parserData = effectiveOutputParser?.data;
  const fallbackContent = hasObjectParserData ? parserData : resolveDisplayContent(resolvedInputs, displayOutputs, outputType, context);
  const content = inputContent ?? fallbackContent;
  if (typeof content === 'string' && outputType !== 'OBJECT' && outputType !== 'FILE' && outputType !== 'OPERATOR' && outputType !== 'ACTION') {
    assertSafeDisplayContentForType(context, content as string, outputType);
  }
  const serializedContent = typeof content === 'string' ? content : JSON.stringify(content);
  const displayLevel = readDisplayLevel(effectiveOutputParser);
  const showContent = readDisplayShowContent(effectiveOutputParser);
  if (showContent && (!hasObjectParserData || typeof content === 'string')) {
    await context.emitOutputDelta({
      channel: displayChannel,
      content: serializedContent,
      ...(displayLevel === undefined ? {} : { level: displayLevel }),
    });
  }
  const displayContentResult = Object.freeze({
    content,
    projected: true,
    type: outputType,
  }) as JsonObject;
  const displayBindings = {
    ...context.variables,
    ...resolvedOutputs,
    ...(effectiveOutputParser === undefined ? {} : { output_parser: effectiveOutputParser }),
    display_content_result: displayContentResult,
    display_content: serializedContent,
  } as JsonObject;
  return {
    outputVariables: {
      ...projectNodeOutputs(rawOutputs, displayBindings, context.node),
      ...(effectiveOutputParser === undefined ? {} : { output_parser: effectiveOutputParser }),
      display_content_result: displayContentResult,
      display_content: serializedContent,
    } as JsonObject,
  };
}
export async function executeDelayNode(context: WorkflowNodeHandlerContext): Promise<WorkflowNodeHandlerResult> {
  const inputs = resolveInteractionInputs(context);
  const delayMs = readDelayMs(context, inputs);
  await wait(delayMs, context.signal);
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        delay_result: Object.freeze({ completed: true, delayMs }) as JsonObject,
        delayed: true,
        delay_ms: delayMs,
      },
      context.node,
    ),
  };
}

export async function executeUnavailableInteractionNode(context: WorkflowNodeHandlerContext, reasonCode: string): Promise<WorkflowNodeHandlerResult> {
  throw new AgentError({
    code: reasonCode,
    message: 'Workflow interaction node requires runtime workflow waiting or nested execution support.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: {
      reasonCode,
      nodeId: context.nodeId,
      nodeType: context.node.type,
    },
  });
}

export async function executeUserCheckNode(context: WorkflowNodeHandlerContext): Promise<WorkflowNodeHandlerResult> {
  const inputs = resolveInteractionInputs(context);
  const kind = readUserCheckKind(context, inputs.kind);
  if (kind === 'HUMAN_HANDOFF') {
    const tips = firstNonEmptyString(inputs.question, inputs.prompt, inputs.tips);
    if (tips === undefined) {
      throw invalidNodeInput(context.nodeId, context.node.type, 'tips');
    }
    await context.emitOutputDelta({ channel: 'CONTENT' as WorkflowVisibleDeltaChannel, content: tips });
    return { transition: { kind: 'TERMINAL' as const } };
  }
  const resumedAnswer = readWorkflowPendingAnswer(context, 'USER_CHECK');
  if (resumedAnswer !== undefined) {
    if (resumedAnswer.answers.length > 0 && resumedAnswer.answers[0]!.length === 0) {
      throwUserCheckTimeout(context, kind);
    }
    const actionType = readActionType(inputs.actionType ?? inputs.action_type);
    const answerValues = resumedAnswer.answers[0] ?? [];
    const selectedOption = answerValues[0];
    if (actionType === 'input' && Array.isArray(inputs.fields) && inputs.fields.length > 1) {
      const fields = inputs.fields as ReadonlyArray<Record<string, unknown>>;
      const result: Record<string, string> = {};
      for (let i = 0; i < fields.length && i < resumedAnswer.answers.length; i++) {
        const rawName = fields[i]!.name as unknown;
        const fieldName = typeof rawName === 'string' && rawName.length > 0 ? rawName : 'field_' + i;
        result[fieldName] = resumedAnswer.answers[i]?.[0] ?? '';
      }
      return {
        outputVariables: projectNodeOutputs(
          context.node.outputs,
          {
            user_check_result: Object.freeze(result) as JsonObject,
            answer_values: resumedAnswer.answers,
          },
          context.node,
        ),
      };
    }
    return {
      outputVariables: projectNodeOutputs(
        context.node.outputs,
        {
          ...(actionType === 'input'
            ? resumedAnswer.pendingAnswerSummary === undefined
              ? {}
              : { user_check_input: resumedAnswer.pendingAnswerSummary }
            : selectedOption === undefined
              ? {}
              : { user_check_result: selectedOption }),
          ...(selectedOption === undefined ? {} : { selectedOption }),
          answer_values: answerValues,
        },
        context.node,
      ),
    };
  }
  if (
    context.resumeState !== undefined &&
    context.resumeState.nodeId === context.nodeId &&
    context.resumeState.nodeType === 'USER_CHECK' &&
    context.resumeState.answers === undefined
  ) {
    throwUserCheckTimeout(context, kind);
  }
  const requestPendingInput = context.requestPendingInput;
  if (requestPendingInput === undefined) {
    throw unavailableWorkflowInteractionBoundary(context, 'WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE');
  }
  const question = firstNonEmptyString(inputs.question, inputs.prompt, inputs.tips);
  if (question === undefined) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'question');
  }
  const actionType = kind === 'QUESTION' ? readActionType(inputs.actionType ?? inputs.action_type) : undefined;
  if (kind === 'QUESTION' && actionType === undefined) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'action_type');
  }
  const questions = buildUserCheckQuestions(context, inputs, kind, question, actionType);
  const timeoutAt = buildUserCheckTimeoutAt(context, inputs);
  const pendingInput = await requestPendingInput(
    createWorkflowPendingInputActivation(context, {
      kind,
      questions,
      ...(timeoutAt === undefined ? {} : { timeoutAt }),
    }),
    context.signal,
  );
  return { pendingInput, outputVariables: {} };
}

function throwUserCheckTimeout(context: WorkflowNodeHandlerContext, kind: UserCheckKind): never {
  throw new AgentError({
    code: 'WORKFLOW_NODE_TIMEOUT',
    message: 'Workflow user-check timed out waiting for user response.',
    category: 'TIMEOUT',
    retryable: true,
    safeDetails: { reasonCode: 'WORKFLOW_NODE_TIMEOUT', nodeId: context.nodeId, kind },
  });
}

type UserCheckKind = 'QUESTION' | 'CONFIRMATION' | 'AUTHORIZATION' | 'HUMAN_HANDOFF';

function readUserCheckKind(context: WorkflowNodeHandlerContext, value: unknown): UserCheckKind {
  if (value === undefined) {
    return 'QUESTION';
  }
  if (value === 'QUESTION' || value === 'CONFIRMATION' || value === 'AUTHORIZATION' || value === 'HUMAN_HANDOFF') {
    return value;
  }
  throw invalidNodeInput(context.nodeId, context.node.type, 'kind');
}

function buildUserCheckQuestions(
  context: WorkflowNodeHandlerContext,
  inputs: Record<string, unknown>,
  kind: UserCheckKind,
  question: string,
  actionType?: 'choice' | 'input' | 'confirm',
): ReadonlyArray<{
  readonly prompt: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly multiple?: boolean;
  readonly custom?: boolean;
}> {
  if (kind === 'CONFIRMATION') {
    return [
      {
        prompt: question,
        options: [
          { label: 'approve', value: 'approve' },
          { label: 'reject', value: 'reject' },
        ],
        multiple: false,
        custom: false,
      },
    ];
  }
  if (kind === 'AUTHORIZATION') {
    return [
      {
        prompt: question,
        options: [
          { label: 'approve', value: 'approve' },
          { label: 'deny', value: 'deny' },
        ],
        multiple: false,
        custom: false,
      },
    ];
  }
  if (actionType === 'input' && Array.isArray(inputs.fields)) {
    return (inputs.fields as readonly unknown[]).map((field) => {
      if (!isRecord(field)) {
        throw invalidNodeInput(context.nodeId, context.node.type, 'fields');
      }
      const description =
        typeof field.description === 'string' && field.description.trim().length > 0
          ? field.description
          : typeof field.name === 'string' && field.name.length > 0
            ? field.name
            : 'input';
      return { prompt: description, options: [] as Array<{ label: string; value: string }>, custom: true };
    });
  }
  const options = actionType === 'choice' ? normalizePendingInputOptions(inputs.options) : [];
  if (actionType === 'choice' && options.length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'options');
  }
  const multiple = coerceBoolean(inputs.multiple);
  const custom = coerceBoolean(inputs.custom);
  return [
    {
      prompt: question,
      options,
      ...(multiple === undefined ? {} : { multiple }),
      ...(custom === undefined ? {} : { custom }),
      ...(actionType === 'input' ? { custom: true } : {}),
    },
  ];
}

function buildUserCheckTimeoutAt(context: WorkflowNodeHandlerContext, inputs: Record<string, unknown>): number | undefined {
  const nodeTimeoutS = context.node.timeout;
  const timeoutAt = coerceNumber(inputs.timeoutAt);
  if (timeoutAt !== undefined) {
    return timeoutAt;
  }
  if (nodeTimeoutS !== undefined && nodeTimeoutS > 0) {
    return Date.now() + nodeTimeoutS * 1000;
  }
  return undefined;
}
export async function executeInterruptNode(context: WorkflowNodeHandlerContext): Promise<WorkflowNodeHandlerResult> {
  const resumedAnswer = readWorkflowPendingAnswer(context, 'INTERRUPT');
  if (resumedAnswer !== undefined) {
    return {
      outputVariables: projectNodeOutputs(
        context.node.outputs,
        {
          interrupt_result: Object.freeze({
            resumed: true,
            pendingInputId: resumedAnswer.pendingInputId,
            pendingAnswerSummary: resumedAnswer.pendingAnswerSummary,
          }) as JsonObject,
          resumed: true,
        },
        context.node,
      ),
    };
  }
  if (
    context.resumeState !== undefined &&
    context.resumeState.nodeId === context.nodeId &&
    context.resumeState.nodeType === 'INTERRUPT' &&
    context.resumeState.answers === undefined
  ) {
    throw new AgentError({
      code: 'WORKFLOW_NODE_TIMEOUT',
      message: 'Workflow interrupt node timed out waiting for external recovery.',
      category: 'TIMEOUT',
      retryable: true,
      safeDetails: { reasonCode: 'WORKFLOW_NODE_TIMEOUT', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const requestPendingInput = context.requestPendingInput;
  if (requestPendingInput === undefined) {
    throw unavailableWorkflowInteractionBoundary(context, 'WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE');
  }
  const inputs = resolveInteractionInputs(context);
  const interruptTimeoutS = context.node.timeout;
  const interruptTimeoutAt = interruptTimeoutS !== undefined && interruptTimeoutS > 0 ? Date.now() + interruptTimeoutS * 1000 : undefined;
  const pendingInput = await requestPendingInput(
    createWorkflowPendingInputActivation(context, {
      kind: 'QUESTION',
      questions: [],
      ...(interruptTimeoutAt === undefined ? {} : { timeoutAt: interruptTimeoutAt }),
    }),
    context.signal,
  );
  return { pendingInput, outputVariables: {} };
}

export async function executeGuardrailNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  if (options.evaluateGuardrail === undefined) {
    throw unavailableWorkflowInteractionBoundary(context, 'WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE');
  }
  const inputs = resolveInteractionInputs(context);
  const guardrailType = readGuardrailType(inputs.guardrailType ?? inputs.guardrail_type);
  const guardrailParams = (
    isRecord(inputs.guardrailParams) ? inputs.guardrailParams : isRecord(inputs.guardrail_params) ? inputs.guardrail_params : undefined
  ) as JsonObject | undefined;
  const policyId =
    firstNonEmptyString(inputs.policyId, inputs.policy_id) ?? (guardrailType !== undefined ? 'guardrail:' + guardrailType.toLowerCase() : undefined);
  const content = firstNonEmptyString(inputs.content, inputs.text, inputs.prompt, context.variables.content, context.variables.text);
  if (policyId === undefined || content === undefined) {
    throw invalidNodeInput(context.nodeId, context.node.type, policyId === undefined ? 'policyId' : 'content');
  }
  const guardrailResult = await options.evaluateGuardrail(
    {
      policyId,
      ...(guardrailType === undefined ? {} : { guardrailType }),
      ...(guardrailParams === undefined ? {} : { guardrailParams }),
      sessionId: context.request.sessionId,
      requestId: context.request.requestId,
      runId: context.request.runId,
      agentId: context.request.agentId,
      agentVersion: context.request.agentVersion,
      workflowNodeId: context.nodeId,
      workflowNodeType: context.node.type,
      content,
      safeContentSummary: summarizeGuardrailContent(content),
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
  const result = guardrailResult.decision === 'REJECT' ? 'block' : 'pass';
  const reason = guardrailResult.safeReason ?? (result === 'block' ? 'GUARDRAIL_REJECTED' : 'GUARDRAIL_APPROVED');
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        guardrail_result: guardrailResult.decision === 'PASS',
        guardrail_response: Object.freeze({
          decision: guardrailResult.decision,
          safeReason: guardrailResult.safeReason,
          policyId,
        }) as JsonObject,
        result,
        reason,
      },
      context.node,
    ),
  };
}

export async function executeSubRecipeNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const resolveRecipeDefinition = options.resolveRecipeDefinition;
  const executeSubRecipe = options.executeSubRecipe;
  if (resolveRecipeDefinition === undefined || executeSubRecipe === undefined) {
    throw unavailableWorkflowInteractionBoundary(context, 'WORKFLOW_SUB_RECIPE_BOUNDARY_UNAVAILABLE');
  }
  const rawInputs = context.node.inputs;
  if (!isRecord(rawInputs)) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'inputs');
  }
  const resolvedRecipeName = resolveNodeValue(rawInputs.recipe_name, context.variables);
  const recipeName = firstNonEmptyString(resolvedRecipeName);
  const rawInputMapping = rawInputs.inputMapping ?? rawInputs.input_mapping;
  // inputMapping is optional for 1.0 compat: 1.0 recipes pass parameters directly via inputs without an explicit mapping.
  const inputMapping = rawInputMapping === undefined ? {} : readMapping(rawInputMapping, 'inputMapping', context);
  const rawOutputMapping = rawInputs.outputMapping !== undefined ? rawInputs.outputMapping : rawInputs.output_mapping;
  // outputMapping is optional per OpenSpec; absent means no outputs are mapped back.
  const outputMapping = rawOutputMapping === undefined ? {} : readMapping(rawOutputMapping, 'outputMapping', context);
  if (recipeName === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_NODE_INPUT_INVALID',
      message: 'Workflow node input failed validation.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        reasonCode: 'WORKFLOW_NODE_INPUT_INVALID',
        nodeId: context.nodeId,
        nodeType: context.node.type,
        field: 'recipe_name',
        recipeNameTemplate: typeof rawInputs.recipe_name === 'string' ? rawInputs.recipe_name : typeof rawInputs.recipe_name,
        resolvedType: resolvedRecipeName === undefined ? 'undefined' : typeof resolvedRecipeName,
        availableVariableKeys: Object.keys(context.variables),
      },
    });
  }
  const recipe = resolveRecipeDefinition(context.request, recipeName);
  if (recipe === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_SUB_RECIPE_NOT_FOUND',
      message: 'Workflow sub-recipe is not registered for the current agent scope.',
      category: 'NOT_FOUND',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_SUB_RECIPE_NOT_FOUND', nodeId: context.nodeId, recipeName },
    });
  }
  const nextDepth = readSubRecipeDepth(context.request) + 1;
  if (nextDepth > maxSubRecipeDepth) {
    throw new AgentError({
      code: 'WORKFLOW_SUB_RECIPE_DEPTH_EXCEEDED',
      message: 'Workflow sub-recipe nesting depth exceeded the safe limit.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_SUB_RECIPE_DEPTH_EXCEEDED', nodeId: context.nodeId, maxDepth: maxSubRecipeDepth },
    });
  }
  const childInputVariables = asJsonObject(resolveMapping(inputMapping, context.variables));
  const childResult = await executeSubRecipe(
    {
      ...context.request,
      recipeName: recipe.recipeName,
      recipeVersion: recipe.version,
      inputVariables: childInputVariables,
      executionMetadata: {
        subRecipeDepth: nextDepth,
      },
    },
    context.signal,
    context.observer,
  );
  if (childResult.status === 'WAITING') {
    throw new AgentError({
      code: 'WORKFLOW_SUB_RECIPE_WAITING_UNSUPPORTED',
      message: 'Workflow sub-recipe entered a waiting state that cannot be resumed through the parent node.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_SUB_RECIPE_WAITING_UNSUPPORTED', nodeId: context.nodeId, recipeName },
    });
  }
  if (childResult.status === 'FAILED' || childResult.status === 'INTERRUPTED') {
    const safeError = latestWorkflowSafeError(childResult.nodeResults);
    throw new AgentError({
      code: safeError?.code ?? 'WORKFLOW_SUB_RECIPE_FAILED',
      message: safeError?.message ?? 'Workflow sub-recipe failed safely.',
      category: safeError?.category ?? (childResult.status === 'FAILED' ? 'INTERNAL' : 'CANCELED'),
      retryable: safeError?.retryable ?? false,
      ...(safeError?.safeDetails === undefined ? {} : { safeDetails: safeError.safeDetails }),
    });
  }
  const subRecipeResult = Object.freeze({
    recipe_name: recipe.recipeName,
    executionId: childResult.executionId,
    status: childResult.status,
  }) as JsonObject;
  const mappedOutputs = resolveMapping(outputMapping, {
    outputs: childResult.outputVariables,
    summary: subRecipeResult,
  });
  const includeRecipeResult = coerceBoolean(rawInputs.is_node_record_with_recipe_result) === true || options.scene === 'MAE-CN';
  const nodeRecordInfo = buildNodeRecordInfo(childResult.nodeResults, recipe.flowGraph, includeRecipeResult);
  // recipe_result binds to the sub-recipe answer node output (DSL spec: sub-recipe binds its last non-gateway node output as recipe_result).
  // The answer node is the END-adjacent last node, so fork/join earlier in the
  // child recipe does not change which output is bound. Middle-node outputs
  // remain reachable via explicit outputMapping from outputVariables.
  const answerNodeId = resolveSubRecipeAnswerNodeId(recipe.flowGraph);
  const answerNodeOutput = answerNodeId !== undefined ? childResult.nodeResults.find((node) => node.nodeId === answerNodeId)?.output : undefined;
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        sub_recipe_result: subRecipeResult,
        recipe_result: answerNodeOutput ?? {},
        node_record_info: nodeRecordInfo,
        ...mappedOutputs,
      } as JsonObject,
      context.node,
    ),
  };
}

function resolveInteractionInputs(context: WorkflowNodeHandlerContext): Record<string, unknown> {
  const inputs = resolveNodeValue(context.node.inputs ?? {}, context.variables);
  if (!isRecord(inputs)) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'inputs');
  }
  return inputs;
}

function resolveDisplayContent(
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
  outputType: string,
  context: WorkflowNodeHandlerContext,
): unknown {
  const inputContent = firstNonEmptyString(inputs.content, inputs.text, inputs.message, inputs.prompt);
  if (inputContent !== undefined) {
    return inputContent;
  }
  const entries = Object.entries(outputs);
  if (outputType === 'OBJECT' || outputType === 'PIU') {
    return Object.keys(outputs).length > 0 ? outputs : inputs;
  }
  if (entries.length === 0) {
    const variableFallback = context.variables.display_content ?? context.variables.text;
    if (typeof variableFallback === 'string' && variableFallback.trim().length > 0) {
      return variableFallback;
    }
    throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
  }
  if (entries.length === 1) {
    const value = entries[0]![1];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
  }
  const parts: string[] = [];
  for (const [, value] of entries) {
    if (typeof value === 'string' && value.trim().length > 0) {
      parts.push(value);
    }
  }
  if (parts.length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'outputs');
  }
  return parts.join('\n');
}

function resolveDisplayOutputParser(context: WorkflowNodeHandlerContext): Record<string, unknown> | undefined {
  const presentationParser = context.node.presentation?.outputParser;
  const nodeParser = context.node.outputParser;
  const outputsParser = isRecord(context.node.outputs) ? context.node.outputs.output_parser : undefined;
  const rawOutputParser = isRecord(presentationParser)
    ? presentationParser
    : isRecord(nodeParser)
      ? nodeParser
      : isRecord(outputsParser)
        ? outputsParser
        : undefined;
  if (rawOutputParser === undefined) {
    return undefined;
  }
  const resolvedOutputParser = resolveNodeValue(rawOutputParser, context.variables);
  return isRecord(resolvedOutputParser) ? resolvedOutputParser : undefined;
}

function readDisplayShowContent(outputParser: Record<string, unknown> | undefined): boolean {
  if (outputParser === undefined) {
    return true;
  }
  return outputParser.show_content !== false && outputParser.showContent !== false;
}

function readDisplayOutputType(outputParser: Record<string, unknown> | undefined): string {
  if (outputParser === undefined) {
    return 'TEXT';
  }
  const rawType = typeof outputParser.type === 'string' ? outputParser.type.trim().toUpperCase() : 'TEXT';
  const validTypes: readonly string[] = Object.freeze([
    'TEXT',
    'OBJECT',
    'HTML',
    'CHART',
    'CHART_PRO',
    'TABLE',
    'PIU',
    'DSL',
    'FILE',
    'OPERATOR',
    'ACTION',
  ]);
  return validTypes.includes(rawType) ? rawType : 'TEXT';
}

function readDisplayLevel(outputParser: Record<string, unknown> | undefined): ToolEventType | undefined {
  const rawLevel = outputParser?.level;
  if (typeof rawLevel !== 'string') {
    return undefined;
  }
  const upper = rawLevel.trim().toUpperCase();
  return (TOOL_EVENT_TYPES as readonly string[]).includes(upper) ? (upper as ToolEventType) : undefined;
}

function resolveDisplayChannel(outputType: string): WorkflowVisibleDeltaChannel {
  switch (outputType) {
    case 'CHART':
      return 'CHART' as WorkflowVisibleDeltaChannel;
    case 'TABLE':
      return 'TABLE' as WorkflowVisibleDeltaChannel;
    case 'DSL':
      return 'DSL' as WorkflowVisibleDeltaChannel;
    default:
      return 'CONTENT' as WorkflowVisibleDeltaChannel;
  }
}

function assertSafeDisplayContentForType(context: WorkflowNodeHandlerContext, content: string, outputType: string): void {
  if (outputType === 'HTML') {
    const dangerousPattern = /<\/?(?:script|style|iframe|object|embed|link|meta)\b/iu;
    if (dangerousPattern.test(content)) {
      throw new AgentError({
        code: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
        message: 'Workflow display content contains unsafe HTML.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
          nodeId: context.nodeId,
          nodeType: context.node.type,
        },
      });
    }
  } else {
    if (blockedHtmlPattern.test(content)) {
      throw new AgentError({
        code: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
        message: 'Workflow display content contains unsafe HTML.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
          nodeId: context.nodeId,
          nodeType: context.node.type,
        },
      });
    }
  }
}

function readDelayMs(context: WorkflowNodeHandlerContext, inputs: Record<string, unknown>): number {
  const candidate = inputs.delay_time;
  // 1.0 DSL delay_time is seconds (string-quoted per 1.0 DSL spec).
  const numeric = coerceNumber(candidate);
  if (numeric === undefined || !Number.isInteger(numeric) || numeric < 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'delayMs');
  }
  return numeric * 1000;
}

function normalizePendingInputOptions(value: unknown): Array<{ readonly label: string; readonly value: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return [{ label: entry.trim(), value: entry.trim() }];
    }
    if (!isRecord(entry)) {
      return [];
    }
    const label = typeof entry.label === 'string' && entry.label.trim().length > 0 ? entry.label.trim() : undefined;
    const optionValue = typeof entry.value === 'string' && entry.value.trim().length > 0 ? entry.value.trim() : label;
    if (label === undefined || optionValue === undefined) {
      return [];
    }
    return [{ label, value: optionValue }];
  });
}

function readMapping(value: unknown, field: string, context: WorkflowNodeHandlerContext): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidNodeInput(context.nodeId, context.node.type, field);
  }
  return value;
}

function resolveMapping(mapping: Record<string, unknown>, scope: JsonObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mapping)
      .map(([key, template]) => [key, resolveNodeValue(template, scope)] as const)
      .filter(([, resolved]) => resolved !== undefined),
  );
}

function createWorkflowPendingInputActivation(
  context: WorkflowNodeHandlerContext,
  request: Omit<WorkflowPendingInputActivation, 'resumeState'>,
): WorkflowPendingInputActivation {
  return {
    ...request,
    resumeState: {
      executionId: context.executionId,
      recipeName: context.recipe.recipeName,
      nodeId: context.nodeId,
      nodeType: context.node.type,
      variables: context.variables,
    },
  };
}

function readWorkflowPendingAnswer(
  context: WorkflowNodeHandlerContext,
  expectedNodeType: Extract<WorkflowNodeType, 'USER_CHECK' | 'INTERRUPT'>,
): { readonly pendingInputId?: string; readonly answers: ReadonlyArray<readonly string[]>; readonly pendingAnswerSummary?: string } | undefined {
  const resumeState = context.resumeState;
  if (
    resumeState === undefined ||
    resumeState.nodeId !== context.nodeId ||
    resumeState.nodeType !== expectedNodeType ||
    resumeState.answers === undefined
  ) {
    return undefined;
  }
  return {
    ...(resumeState.pendingInputId === undefined ? {} : { pendingInputId: resumeState.pendingInputId }),
    answers: resumeState.answers,
    ...(resumeState.pendingAnswerSummary === undefined ? {} : { pendingAnswerSummary: resumeState.pendingAnswerSummary }),
  };
}

function unavailableWorkflowInteractionBoundary(context: WorkflowNodeHandlerContext, reasonCode: string): AgentError {
  return new AgentError({
    code: reasonCode,
    message: 'Workflow interaction boundary is unavailable.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: {
      reasonCode,
      nodeId: context.nodeId,
      nodeType: context.node.type,
    },
  });
}
function readActionType(value: unknown): 'choice' | 'input' | 'confirm' | undefined {
  if (value === 'choice' || value === 'input' || value === 'confirm') {
    return value;
  }
  return undefined;
}

function readSubRecipeDepth(request: WorkflowExecutionRequest): number {
  const value = request.executionMetadata?.subRecipeDepth;
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function summarizeGuardrailContent(content: string): string {
  return content.length <= 160 ? content : `${content.slice(0, 157)}...`;
}

function latestWorkflowSafeError(nodeResults: ReadonlyArray<{ readonly safeError?: SafeError }>): SafeError | undefined {
  for (let index = nodeResults.length - 1; index >= 0; index -= 1) {
    const safeError = nodeResults[index]?.safeError;
    if (safeError !== undefined) {
      return safeError;
    }
  }
  return undefined;
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0) {
    if (signal.aborted) {
      throw abortedWorkflowNode();
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedWorkflowNode());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function readGuardrailType(value: unknown): 'QUESTION' | 'TOPIC' | 'ANSWER' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const upper = value.trim().toUpperCase();
  if (upper === 'QUESTION' || upper === 'TOPIC' || upper === 'ANSWER') {
    return upper as 'QUESTION' | 'TOPIC' | 'ANSWER';
  }
  return undefined;
}
function abortedWorkflowNode(): AgentError {
  return new AgentError({
    code: 'WORKFLOW_INTERRUPTED',
    message: 'Workflow execution was interrupted safely.',
    category: 'CANCELED',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_INTERRUPTED' },
  });
}
