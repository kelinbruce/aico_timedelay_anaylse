import { AgentError, type JsonObject } from '@nextagent/agent-common';
import { brand } from '@nextagent/agent-common';
import type {
  CapabilityInvocationPort,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { WorkflowNodeHandlerContext } from './types.js';
import type { CreateWorkflowNodeCatalogOptions } from './types.js';
import {
  asJsonObject,
  coerceBoolean,
  firstNonEmptyString,
  invalidNodeInput,
  isRecord,
  requireModelInvocation,
  resolveNodeModelConfig,
  resolveNodeValue,
  resolveWorkflowRetryPolicy,
} from './shared.js';
import { CapabilityNodeExecutionError } from '../engine/capability-node-error.js';

/** Default prompt for parameter extraction when no custom template is provided. */
const DEFAULT_PARAM_EXTRACT_SYSTEM_PROMPT = `Extract missing parameters for the API call based on the provided parameter schema and context variables.
Return a JSON object with a single key "extractedParams" containing the extracted parameter values.
Only include parameters that are missing from the already-provided inputs.
If a parameter cannot be determined, omit it from the result.
If you need more information from the user, include a key "NEED_MORE_KEY" with the follow-up question.`;

/** Capability ID for the dynamic prompt-splicing API. */
const PROMPT_SPLICING_CAPABILITY_ID = 'PROMPT_SPLICING_FOR_PARAMETER_EXTRACTION';

export type ParamExtractOutcome =
  | { readonly kind: 'skipped' }
  | { readonly kind: 'extracted'; readonly params: Record<string, unknown> }
  | { readonly kind: 'reflection'; readonly followUpQuestion: string };

export async function extractRestfulParameters(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  capabilityId: string,
  inputSchema?: JsonObject,
  reflectionAnswer?: string,
): Promise<ParamExtractOutcome> {
  if (inputSchema === undefined) {
    return { kind: 'skipped' };
  }
  // 2. Filter missing parameters
  const missingParams = findMissingParameters(inputSchema, resolved);
  if (missingParams.length === 0) {
    return { kind: 'skipped' };
  }

  // 3. Check chatType for PARAM_APPEND mode (skip extraction in append mode)
  const chatType = context.request.executionMetadata?.chatType ?? context.request.executionMetadata?.chat_type;
  if (chatType === 'PARAM_APPEND') {
    return { kind: 'skipped' };
  }

  // 4. Resolve model invocation config (with node-level model/modelGroup override)
  const modelConfig = await resolveNodeModelConfig(context, options, resolved);

  // 5. Build system prompt
  const systemPrompt = await resolveParamExtractPrompt(context, options, resolved, inputSchema, missingParams);

  // 6. Build user prompt
  const userQuestion =
    firstNonEmptyString(resolved.input_question, resolved.input_question, context.variables.input_question, context.variables.text) ?? '';
  const userPrompt = buildParamExtractUserPrompt(inputSchema, missingParams, userQuestion, context.variables, reflectionAnswer);

  // 7. Call model
  const modelInvocation = requireModelInvocation(options.modelInvocation);
  const modelResult = await modelInvocation.complete(
    {
      invocationScope: {
        tenantId: context.request.identityContext.tenantId,
        subjectId: context.request.identityContext.subjectId,
        agentId: context.request.agentId,
        agentVersion: context.request.agentVersion,
        agentAssemblyRef: context.request.agentAssemblyRef ?? `${context.request.agentId}:${context.request.agentVersion}`,
        operationId: `workflow:${context.nodeId}:param-extract`,
        sessionId: context.request.sessionId,
        requestId: context.request.requestId,
        runId: context.request.runId,
      },
      modelId: modelConfig.modelId,
      messages: [
        { role: 'SYSTEM', content: [{ type: 'text', text: systemPrompt }] },
        { role: 'USER', content: [{ type: 'text', text: userPrompt }] },
      ],
      tools: [],
      ...modelConfig.inferenceOptions,
      timeoutMs: modelConfig.timeoutMs,
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

  // 8. Parse model output
  const content = typeof modelResult.content === 'string' ? modelResult.content : JSON.stringify(modelResult.content);
  const extractedParams = parseExtractedParams(content, context);
  if (extractedParams === undefined) {
    return { kind: 'skipped' };
  }

  // 9. Handle reflection (NEED_MORE_KEY)
  const openReflection = coerceBoolean(resolved.open_reflection);
  if (openReflection === true && isRecord(extractedParams) && extractedParams.NEED_MORE_KEY !== undefined) {
    const followUpQuestion =
      typeof extractedParams.NEED_MORE_KEY === 'string' ? extractedParams.NEED_MORE_KEY : String(extractedParams.NEED_MORE_KEY);
    if (followUpQuestion.length > 0) {
      return { kind: 'reflection', followUpQuestion };
    }
  }

  // 10. Merge extracted params (DSL-declared inputs take precedence)
  const merged = { ...resolved };
  if (isRecord(extractedParams)) {
    for (const [key, value] of Object.entries(extractedParams)) {
      if (key === 'NEED_MORE_KEY') {
        continue;
      }
      if (merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }

  return { kind: 'extracted', params: merged };
}

export async function resolveApiInputSchema(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  capabilityId: string,
): Promise<JsonObject | undefined> {
  const resolver = options.runtimeCapabilityResolver?.(context.request);
  if (resolver === undefined) {
    return undefined;
  }
  try {
    const descriptor = await resolver.resolveCapability({ kind: 'TOOL', capabilityId: brand<string, 'CapabilityId'>(capabilityId) }, context.signal);
    return descriptor?.inputSchema;
  } catch {
    return undefined;
  }
}

function findMissingParameters(inputSchema: JsonObject, resolved: Record<string, unknown>): string[] {
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : undefined;
  if (properties === undefined) {
    return [];
  }
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const missing: string[] = [];
  for (const key of Object.keys(properties)) {
    if (resolved[key] === undefined || resolved[key] === null || resolved[key] === '') {
      if (required.includes(key)) {
        missing.push(key);
      }
    }
  }
  return missing;
}
async function resolveParamExtractPrompt(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  inputSchema: JsonObject,
  missingParams: string[],
): Promise<string> {
  // Priority 1: Custom inline prompt template
  const inlineTemplate = firstNonEmptyString(resolved.param_extract_prompt_template);
  if (inlineTemplate !== undefined) {
    return inlineTemplate;
  }

  // Priority 2: Template name → query via prepareLlmPrompt
  const templateName = firstNonEmptyString(resolved.param_extract_prompt_template_name);
  if (templateName !== undefined && options.prepareLlmPrompt !== undefined) {
    try {
      const modelConfig = await resolveNodeModelConfig(context, options, resolved);
      const promptResult = await options.prepareLlmPrompt({
        request: context.request,
        nodeId: context.nodeId,
        node: context.node,
        resolvedInputs: resolved,
        variables: context.variables,
        modelConfig,
        defaultPurpose: `param-extract:${templateName}`,
        defaultUserPrompt: '',
      });
      if (typeof promptResult.systemPrompt === 'string' && promptResult.systemPrompt.length > 0) {
        return promptResult.systemPrompt;
      }
    } catch {
      // Template resolution failed, fall through to dynamic/default
    }
  }

  // Priority 3: Dynamic API prompt (PROMPT_SPLICING_FOR_PARAMETER_EXTRACTION)
  if (options.capabilityInvocation !== undefined) {
    const dynamicPrompt = await tryInvokePromptSplicingApi(context, options, resolved, inputSchema, missingParams);
    if (dynamicPrompt !== undefined) {
      return dynamicPrompt;
    }
  }

  // Priority 4: Default prompt
  const openReflection = coerceBoolean(resolved.open_reflection);
  if (openReflection === true) {
    return (
      DEFAULT_PARAM_EXTRACT_SYSTEM_PROMPT +
      `\n\nIf you need more information to fill required parameters, set "NEED_MORE_KEY" to the follow-up question for the user.`
    );
  }
  return DEFAULT_PARAM_EXTRACT_SYSTEM_PROMPT;
}

async function tryInvokePromptSplicingApi(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  inputSchema: JsonObject,
  missingParams: string[],
): Promise<string | undefined> {
  const capabilityInvocation = typeof options.capabilityInvocation === 'function' ? options.capabilityInvocation() : options.capabilityInvocation;
  if (capabilityInvocation === undefined) {
    return undefined;
  }
  const retryPolicy = resolveWorkflowRetryPolicy(context.node.retry, context.node.retryPolicy, context.recipe.runtime?.defaultRetry);
  const result = await capabilityInvocation.invoke(
    {
      invocationId: `param-extract-prompt:${context.executionId}:${context.nodeId}`,
      capabilityId: brand<string, 'CapabilityId'>(PROMPT_SPLICING_CAPABILITY_ID),
      arguments: {
        apiParameterDefinitions: inputSchema,
        userInputQuestion: firstNonEmptyString(resolved.input_question, context.variables.input_question) ?? '',
        nodeMetadata: { nodeId: context.nodeId, nodeType: context.node.type },
      } as JsonObject,
      sessionId: context.request.sessionId,
      requestId: context.request.requestId,
      runId: context.request.runId,
      requestContextId: context.request.requestContextId,
      stepId: `workflow:${context.nodeId}:prompt-splicing`,
      identityContext: context.request.identityContext,
      agentId: context.request.agentId,
      agentVersion: context.request.agentVersion,
      timeoutMs: 30_000,
      ...(retryPolicy === undefined ? {} : { maxRetries: retryPolicy.maxRetries }),
    } as CapabilityInvocationRequest,
    context.signal,
  );
  if (result.status === 'SUCCEEDED' || result.status === 'DEGRADED') {
    const prompt = result.structuredPayload.prompt ?? result.structuredPayload.content;
    if (typeof prompt === 'string' && prompt.length > 0) {
      return prompt;
    }
  }
  if (result.status === 'FAILED' || result.status === 'TIMED_OUT') {
    throw new CapabilityNodeExecutionError(result, {
      id: context.nodeId,
      type: context.node.type,
      capabilityId: PROMPT_SPLICING_CAPABILITY_ID,
    });
  }
  return undefined;
}

function buildParamExtractUserPrompt(
  inputSchema: JsonObject,
  missingParams: string[],
  userQuestion: string,
  variables: JsonObject,
  reflectionAnswer?: string,
): string {
  const paramList = missingParams.join(', ');
  const lines = [
    `Missing parameters: ${paramList}`,
    `Parameter schema: ${JSON.stringify(inputSchema)}`,
    `User question: ${userQuestion}`,
    `Context variables: ${JSON.stringify(variables)}`,
  ];
  if (reflectionAnswer !== undefined && reflectionAnswer.length > 0) {
    lines.push(`User follow-up answer: ${reflectionAnswer}`);
  }
  return lines.join('\n');
}

function parseExtractedParams(content: string, context: WorkflowNodeHandlerContext): Record<string, unknown> | undefined {
  // Strip markdown JSON fences
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '');
  try {
    const parsed = JSON.parse(stripped);
    if (!isRecord(parsed)) {
      return undefined;
    }
    // Accept both { extractedParams: {...} } and direct { param: value } forms
    if (isRecord(parsed.extractedParams)) {
      return parsed.extractedParams as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
