import { AgentError, brand, type JsonObject, type JsonValue, type WorkflowNodeType } from '@nextagent/agent-common';
import type {
  CapabilityInvocationPort,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityInvocationRuntimeContext,
} from '@nextagent/agent-contracts/capability';
import type { WorkflowExecutionDiagnostic, RecipeDefinition, WorkflowNodeDef, WorkflowNodeResult } from '@nextagent/agent-contracts/core';
import type { ModelInferenceOptions, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { CreateWorkflowNodeCatalogOptions, WorkflowNodeHandlerContext, WorkflowNodeModelInvocationConfig } from './types.js';
import { CapabilityNodeExecutionError } from '../engine/capability-node-error.js';

export function requireCapabilityInvocation(
  capabilityInvocation: CreateWorkflowNodeCatalogOptions['capabilityInvocation'],
): CapabilityInvocationPort {
  const resolved = typeof capabilityInvocation === 'function' ? capabilityInvocation() : capabilityInvocation;
  if (resolved !== undefined) {
    return resolved;
  }
  throw new AgentError({
    code: 'WORKFLOW_CAPABILITY_BOUNDARY_UNAVAILABLE',
    message: 'Workflow capability invocation boundary is unavailable.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_CAPABILITY_BOUNDARY_UNAVAILABLE' },
  });
}

export const reservedPythonResultKeys: ReadonlySet<string> = new Set(['exit_code', 'stdout', 'stderr', 'timed_out', '_trace']);

// Workflow capability nodes invoke capabilities without the full tool-loop
// runtime context. The risk policy gate in sandbox-execution-port requires
// emitPolicyApplied to be present (observabilityReady check). This factory
// provides a no-op implementation so the policy evaluation runs and its
// decision is enforced, while keeping workflow self-contained.
export function createWorkflowCapabilityRuntimeContext(): CapabilityInvocationRuntimeContext {
  return {
    emitPolicyApplied: async () => {},
  };
}

// Python tool returns { exit_code, stdout, stderr, timed_out } where stdout
// is a raw string. Workflow variable projection (${python_result.xxx}) is a
// code-level path resolver that only traverses object properties, not JSON
// strings. When stdout is a valid JSON object, expand its top-level fields
// into the payload so recipe DSL can reference them directly. Reserved keys
// (exit_code/stdout/stderr/timed_out/_trace) are never overwritten.
export function expandStdoutJsonFields(payload: JsonObject): JsonObject {
  const stdout = payload['stdout'];
  if (typeof stdout !== 'string' || stdout.trim().length === 0) {
    return payload;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return expandStdoutLines(payload, stdout);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return payload;
  }
  if (Array.isArray(parsed)) {
    const expanded: Record<string, unknown> = { ...payload };
    for (let i = 0; i < parsed.length; i++) {
      const key = String(i);
      if (!reservedPythonResultKeys.has(key)) {
        expanded[key] = parsed[i];
      }
    }
    return Object.freeze(expanded) as JsonObject;
  }
  const expanded: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!reservedPythonResultKeys.has(key)) {
      expanded[key] = value;
    }
  }
  return Object.freeze(expanded) as JsonObject;
}

function expandStdoutLines(payload: JsonObject, stdout: string): JsonObject {
  const lines = stdout.split('\n');
  if (lines.length <= 1) {
    return payload;
  }
  const expanded: Record<string, unknown> = { ...payload };
  let added = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) {
      continue;
    }
    const key = String(i);
    if (reservedPythonResultKeys.has(key)) {
      continue;
    }
    try {
      expanded[key] = JSON.parse(line);
    } catch {
      expanded[key] = line;
    }
    added = true;
  }
  return added ? (Object.freeze(expanded) as JsonObject) : payload;
}

// Resolve python sandbox stdout into the python_result value expected by
// the recipe DSL. First try parsing the entire stdout as a single JSON value;
// this handles print(json.dumps(...)) output where string values may contain
// \n characters that line-by-line splitting would fragment. If whole-stdout
// parsing fails, fall back to line-by-line: split by newline, filter the
// trailing empty line that Python's print appends, parse each line as JSON
// when valid (object/array/scalar), otherwise keep as a raw string.
// 0 lines -> null, 1 line -> the parsed value, N lines -> list of parsed values.
export function resolvePythonResult(payload: JsonObject): JsonValue {
  const stdout = payload['stdout'];
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return null;
  }
  // Try parsing the entire stdout as JSON first. When a Python script uses
  // print(json.dumps([...)) the output is a single JSON value that may
  // contain \n inside string values. Line-by-line splitting would fragment
  // such output and lose content. If the whole-stdout parse succeeds, return
  // it directly; otherwise fall back to line-by-line parsing.
  try {
    return JSON.parse(stdout) as JsonValue;
  } catch {
    // Not valid JSON, fall through to line-by-line parsing.
  }
  const lines = stdout.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return null;
  }
  const parsed = lines.map(parsePythonOutputLine);
  return parsed.length === 1 ? parsed[0]! : parsed;
}

function parsePythonOutputLine(line: string): JsonValue {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return line;
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return line;
  }
}

// Map a parameter value to a Python native literal for script injection.
// null/undefined -> None, booleans -> True/False, numbers as-is,
// numeric strings as-is (without quotes), other types via JSON.stringify.
export function toPythonLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    // Numeric strings are emitted unquoted to preserve the 1.0 DSL convention
    // where numbers arrive as quoted strings.
    return /^-?\d+(\.\d+)?$/u.test(value) ? value : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(toPythonLiteral).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${JSON.stringify(k)}: ${toPythonLiteral(v)}`);
    return `{${entries.join(', ')}}`;
  }
  return 'None';
}

export function requireModelInvocation(modelInvocation: CreateWorkflowNodeCatalogOptions['modelInvocation']): ModelInvocationService {
  const resolved = typeof modelInvocation === 'function' ? modelInvocation() : modelInvocation;
  if (resolved !== undefined) {
    return resolved;
  }
  throw new AgentError({
    code: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE',
    message: 'Workflow model invocation boundary is unavailable.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE' },
  });
}

export function resolveVariablePath(root: JsonObject, path: string): unknown {
  let current: unknown = root;
  for (const segment of parsePathSegments(path)) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : typeof current === 'object' ? (current as JsonObject)[String(segment)] : undefined;
      continue;
    }
    current = typeof current === 'object' && !Array.isArray(current) ? (current as JsonObject)[segment] : undefined;
  }
  return current;
}

function parsePathSegments(path: string): Array<string | number> {
  const normalized = path.replace(/\[(\d+)\]/gu, '.$1').replace(/\[['"]([^'"]+)['"]\]/gu, '.$1');
  return normalized
    .split('.')
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^\d+$/u.test(segment) ? Number(segment) : segment));
}

export function resolveNodeValue(value: unknown, scope: JsonObject): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveNodeValue(item, scope));
  }
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolveNodeValue(nested, scope)])));
  }
  return value;
}

export function projectNodeOutputs(outputs: WorkflowNodeDef['outputs'], bindings: JsonObject, node?: WorkflowNodeDef): JsonObject {
  if ((!isRecord(outputs) || Object.keys(outputs).length === 0) && node?.outputParser === undefined) {
    return bindings;
  }
  const projected: Record<string, unknown> = {};
  if (isRecord(outputs)) {
    for (const [key, value] of Object.entries(outputs)) {
      const resolved = resolveNodeValue(value, bindings);
      if (resolved !== undefined) {
        projected[key] = resolved;
      }
    }
  }
  if (node?.outputParser !== undefined) {
    const resolvedParser = resolveNodeValue(node.outputParser, bindings);
    if (isRecord(resolvedParser)) {
      projected['output_parser'] = resolvedParser;
    }
  }
  return projected as JsonObject;
}

export function interpolateString(template: string, scope: JsonObject): unknown {
  const exact = /^\$\{([^}]+)\}$/u.exec(template.trim());
  if (exact !== null) {
    return resolveVariablePath(scope, exact[1]!.trim());
  }
  return template.replace(/\$\{([^}]+)\}/gu, (_, rawPath: string) => {
    const resolved = resolveVariablePath(scope, rawPath.trim());
    return resolved === undefined ? '' : stringifyScalar(resolved);
  });
}

export function stringifyScalar(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function omitKeys(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))));
}

export function asJsonObject(value: Record<string, unknown>): JsonObject {
  return Object.freeze(value) as JsonObject;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const gatewayNodeTypes = new Set<WorkflowNodeDef['type']>(['START', 'END', 'CONDITION', 'PARALLEL']);

export function formatOutputValues(output: Record<string, unknown>): string {
  const entries = Object.entries(output);
  if (entries.length === 0) {
    return '';
  }
  if (entries.length === 1) {
    return formatScalarValue(entries[0]![1]);
  }
  return entries.map(([, v]) => formatScalarValue(v)).join('\n');
}

function formatScalarValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function isGatewayNodeType(nodeType: WorkflowNodeDef['type']): boolean {
  return gatewayNodeTypes.has(nodeType);
}
export function hasObjectOutputParserData(parser: unknown): boolean {
  if (!isRecord(parser)) {
    return false;
  }
  const data = parser.data;
  return isRecord(data) && Object.keys(data).length > 0;
}

// Resolve the sub-recipe answer node: walk back from END along the
// single-predecessor chain and return the first non-gateway node.
// Mirrors resolveAnswerNodeId in agent-core (kept separate: agent-core
// cannot depend on agent-workflow; agent-contracts hosts no navigation).
export function resolveSubRecipeAnswerNodeId(flowGraph: RecipeDefinition['flowGraph']): string | undefined {
  const entries = Object.entries(flowGraph.nodes);
  const endEntry = entries.find(([, node]) => node.type === 'END');
  if (endEntry === undefined) {
    return undefined;
  }
  const predecessors = new Map<string, string[]>();
  for (const [id, node] of entries) {
    for (const nextId of Object.keys(node.next ?? {})) {
      const list = predecessors.get(nextId);
      if (list === undefined) {
        predecessors.set(nextId, [id]);
      } else {
        list.push(id);
      }
    }
  }
  const visited = new Set<string>();
  let currentId: string | undefined = endEntry[0];
  while (currentId !== undefined && !visited.has(currentId)) {
    visited.add(currentId);
    const node: WorkflowNodeDef | undefined = flowGraph.nodes[currentId];
    if (node === undefined) {
      break;
    }
    if (!isGatewayNodeType(node.type)) {
      return currentId;
    }
    const preds = predecessors.get(currentId);
    currentId = preds !== undefined && preds.length === 1 ? preds[0] : undefined;
  }
  return undefined;
}

export function invalidNodeInput(nodeId: string, nodeType: WorkflowNodeType, field: string): AgentError {
  return new AgentError({
    code: 'WORKFLOW_NODE_INPUT_INVALID',
    message: 'Workflow node input failed validation.',
    category: 'VALIDATION',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_NODE_INPUT_INVALID', nodeId, nodeType, field },
  });
}

// 1.0 DSL writes all parameter values as strings (numbers/bools quoted).
// These helpers coerce string literals to their typed equivalents for
// node input fields that are semantically numeric or boolean. They return
// undefined when the value cannot be coerced, so callers can decide whether
// to fall back, throw invalidNodeInput, or apply a default.
export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }
  return undefined;
}

// Convert a node timeout (DSL seconds) to milliseconds with a fallback when
// the node does not declare one.
export function nodeTimeoutMs(node: WorkflowNodeDef, fallbackMs: number): number {
  return node.timeout === undefined ? fallbackMs : node.timeout * 1000;
}

export function nodeTrace(context: WorkflowNodeHandlerContext, capabilityId: string): JsonObject {
  return {
    capabilityId,
    executionId: context.executionId,
    nodeId: context.nodeId,
    nodeType: context.node.type,
    retryCount: context.attempt - 1,
  };
}

export function llmTrace(context: WorkflowNodeHandlerContext): JsonObject {
  return {
    executionId: context.executionId,
    nodeId: context.nodeId,
    retryCount: context.attempt - 1,
  };
}

export function invalidLlmOutput(context: WorkflowNodeHandlerContext, outputKind: string): AgentError {
  return new AgentError({
    code: 'WORKFLOW_LLM_OUTPUT_INVALID',
    message: 'Workflow LLM output failed validation.',
    category: 'VALIDATION',
    retryable: false,
    safeDetails: {
      reasonCode: 'WORKFLOW_LLM_OUTPUT_INVALID',
      nodeId: context.nodeId,
      nodeType: context.node.type,
      outputKind,
    },
  });
}

export function buildCapabilityInvocationRequest(
  context: WorkflowNodeHandlerContext,
  capabilityId: string,
  args: JsonObject,
  singleTimeoutMs?: number,
  identityDiscriminator?: string,
): CapabilityInvocationRequest {
  const identitySuffix = identityDiscriminator === undefined ? '' : `:${identityDiscriminator}`;
  const retryPolicy = resolveWorkflowRetryPolicy(context.node.retry, context.node.retryPolicy, context.recipe.runtime?.defaultRetry);
  return {
    invocationId: `${context.executionId}:${context.nodeId}:${context.attempt}${identitySuffix}:${capabilityId}`,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    toolCallId: `workflow:${context.executionId}:${context.nodeId}:${context.attempt}${identitySuffix}`,
    arguments: args,
    sessionId: context.request.sessionId,
    requestId: context.request.requestId,
    runId: context.request.runId,
    requestContextId: context.request.requestContextId,
    stepId: `workflow:${context.nodeId}${identitySuffix}`,
    identityContext: context.request.identityContext,
    agentId: context.request.agentId,
    agentVersion: context.request.agentVersion,
    timeoutMs: singleTimeoutMs ?? nodeTimeoutMs(context.node, 30_000),
    ...(retryPolicy === undefined ? {} : { maxRetries: retryPolicy.maxRetries }),
  };
}

export function capabilityResultPayload(result: CapabilityInvocationResult, trace: JsonObject, redactedValues: readonly string[] = []): JsonObject {
  if (result.status === 'FAILED' || result.status === 'TIMED_OUT') {
    throw new CapabilityNodeExecutionError(result, {
      id: trace['nodeId'] === undefined ? 'unknown' : String(trace['nodeId']),
      type: trace['nodeType'] === undefined ? 'RESTFUL' : String(trace['nodeType']),
      capabilityId: trace['capabilityId'] === undefined ? 'unknown' : String(trace['capabilityId']),
    });
  }
  return {
    ...redactSecretsFromValue(result.structuredPayload, redactedValues),
    _trace: trace,
  };
}

export function buildAgentPrompt(inputs: Record<string, unknown>, variables: JsonObject): string {
  const question =
    typeof inputs.input_question === 'string' ? inputs.input_question : typeof variables.input_question === 'string' ? variables.input_question : '';
  const recipeName = typeof inputs.recipe_name === 'string' && inputs.recipe_name.length > 0 ? `Target recipe: ${inputs.recipe_name}\n\n` : '';
  return `${recipeName}${question}`.trim();
}

export function readChildChatId(payload: JsonObject): string | undefined {
  const childChatId = payload.child_chat_id;
  return typeof childChatId === 'string' && childChatId.length > 0 ? childChatId : undefined;
}

export function parseCandidateTools(
  value: unknown,
): Array<{ readonly capabilityId: string; readonly description?: string; readonly inputSchema: JsonObject }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const capabilityId =
      typeof item.capabilityId === 'string'
        ? item.capabilityId
        : typeof item.toolId === 'string'
          ? item.toolId
          : typeof item.name === 'string'
            ? item.name
            : undefined;
    if (capabilityId === undefined || capabilityId.length === 0) {
      return [];
    }
    return [
      {
        capabilityId,
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        inputSchema: isRecord(item.inputSchema) ? (item.inputSchema as JsonObject) : {},
      },
    ];
  });
}

export async function resolveSecrets(
  value: unknown,
  resolveSecretReference: CreateWorkflowNodeCatalogOptions['resolveSecretReference'],
  resolvedSecretValues: string[] = [],
): Promise<unknown> {
  if (typeof value === 'string' && /^(env|file):/u.test(value)) {
    if (resolveSecretReference === undefined) {
      throw new AgentError({
        code: 'WORKFLOW_SECRET_RESOLUTION_UNAVAILABLE',
        message: 'Workflow secret resolution is unavailable.',
        category: 'UNAVAILABLE',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_SECRET_RESOLUTION_UNAVAILABLE' },
      });
    }
    const resolved = await resolveSecretReference(value);
    if (typeof resolved !== 'string' || resolved.length === 0) {
      throw new AgentError({
        code: 'WORKFLOW_SECRET_RESOLUTION_FAILED',
        message: 'Workflow secret reference could not be resolved safely.',
        category: 'UNAVAILABLE',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_SECRET_RESOLUTION_FAILED' },
      });
    }
    resolvedSecretValues.push(resolved);
    return resolved;
  }
  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => resolveSecrets(item, resolveSecretReference, resolvedSecretValues)));
  }
  if (isRecord(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, nested]) => [key, await resolveSecrets(nested, resolveSecretReference, resolvedSecretValues)] as const),
    );
    return Object.freeze(Object.fromEntries(entries));
  }
  return value;
}

export function sanitizeModelValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return stripFencedJson(value).trim();
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => sanitizeModelValue(item)));
  }
  if (isRecord(value)) {
    const strippedEntries = Object.entries(value).filter(
      ([key]) => key !== 'rawPrompt' && key !== 'raw_prompt' && key !== 'rawModelOutput' && key !== 'raw_model_output',
    );
    return Object.freeze(Object.fromEntries(strippedEntries.map(([key, nested]) => [key, sanitizeModelValue(nested)])));
  }
  return value;
}

export function stripFencedJson(value: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(value.trim());
  return fenced?.[1] ?? value;
}

export function compressLlmPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const preservedTerms = extractTelecomTerms(value).slice(0, 12);
  const prefixBudget = Math.max(40, Math.floor(maxChars * 0.55));
  const suffixBudget = Math.max(24, maxChars - prefixBudget - 24);
  const compacted = `${value.slice(0, prefixBudget)}\n...\n${value.slice(Math.max(prefixBudget, value.length - suffixBudget))}`;
  if (preservedTerms.length === 0) {
    return compacted.slice(0, maxChars);
  }
  const suffix = `\nPreserve terms: ${preservedTerms.join(', ')}`;
  return `${compacted.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`.slice(0, maxChars);
}

export function extractTelecomTerms(value: string): readonly string[] {
  const matches = value.match(/\b(?:[A-Z]{2,}(?:[-_][A-Z0-9]+)*|[A-Za-z]+-\d+|\d{3,}|[A-Z]{2,}\d+)\b/gu) ?? [];
  return [...new Set(matches)];
}

export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function stringifyPromptField(value: unknown): string {
  const text = firstNonEmptyString(value);
  if (text !== undefined) {
    return text;
  }
  return value === undefined ? '' : JSON.stringify(value);
}

export function mergeDiagnostics(left?: WorkflowExecutionDiagnostic, right?: WorkflowExecutionDiagnostic): WorkflowExecutionDiagnostic | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return {
    ...left,
    ...right,
    reasonCode: right.reasonCode,
  };
}

export function readWorkflowOutputSchema(node: WorkflowNodeDef, resolvedInputs: Record<string, unknown>): JsonObject | undefined {
  const outputsParser = isRecord(node.outputs) ? (node.outputs as Record<string, unknown>).output_parser : undefined;
  const parser = node.outputParser ?? (isRecord(outputsParser) ? outputsParser : undefined);
  return isRecord(parser?.schema)
    ? asJsonObject(parser.schema)
    : isRecord(parser?.outputSchema)
      ? asJsonObject(parser.outputSchema)
      : isRecord(resolvedInputs.outputSchema)
        ? asJsonObject(resolvedInputs.outputSchema)
        : isRecord(resolvedInputs.output_schema)
          ? asJsonObject(resolvedInputs.output_schema)
          : undefined;
}

export function mergeModelInferenceOptions(base: ModelInferenceOptions, override?: ModelInferenceOptions): ModelInferenceOptions {
  if (override === undefined) {
    return base;
  }
  return {
    ...base,
    ...(override.temperature === undefined ? {} : { temperature: override.temperature }),
    ...(override.maxOutputTokens === undefined ? {} : { maxOutputTokens: override.maxOutputTokens }),
    ...(override.topP === undefined ? {} : { topP: override.topP }),
    ...(override.topK === undefined ? {} : { topK: override.topK }),
    ...(override.presencePenalty === undefined ? {} : { presencePenalty: override.presencePenalty }),
    ...(override.frequencyPenalty === undefined ? {} : { frequencyPenalty: override.frequencyPenalty }),
    ...(override.thinking === undefined ? {} : { thinking: override.thinking }),
    ...(base.providerOptions === undefined && override.providerOptions === undefined
      ? {}
      : { providerOptions: { ...(base.providerOptions ?? {}), ...override.providerOptions } }),
    ...(override.modelParams === undefined ? {} : { modelParams: override.modelParams }),
  };
}

// Strip enable_thinking from model_params and convert it to
// thinking.depth (true->HIGH, false->OFF). All remaining fields pass
// through opaquely as modelParams. Shared by llm-nodes and knowledge-nodes.
export function modelParamsInferenceOptions(resolvedInputs: Record<string, unknown>): ModelInferenceOptions | undefined {
  if (!isRecord(resolvedInputs.model_params)) {
    return undefined;
  }
  const params = resolvedInputs.model_params;
  const result: Record<string, unknown> = {};
  if (params.enable_thinking === true) {
    result.thinking = { depth: 'HIGH' };
  } else if (params.enable_thinking === false) {
    result.thinking = { depth: 'OFF' };
  }
  // All remaining fields pass through opaquely as modelParams.
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'enable_thinking') {
      passthrough[key] = value;
    }
  }
  if (Object.keys(passthrough).length > 0) {
    result.modelParams = passthrough;
  }
  return result as ModelInferenceOptions;
}

export function redactSecretsFromValue(value: JsonObject, redactedValues: readonly string[]): JsonObject {
  const secrets = redactedValues.filter((item) => item.length > 0);
  if (secrets.length === 0) {
    return value;
  }
  return sanitizeSecretValue(value, secrets) as JsonObject;
}

function sanitizeSecretValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    let sanitized = value;
    for (const secret of secrets) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
    return sanitized;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => sanitizeSecretValue(item, secrets)));
  }
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeSecretValue(nested, secrets)])));
  }
  return value;
}

const nodeRecordInputFields: ReadonlySet<string> = new Set(['api_name', 'prompt_template']);

// Build step records for sub-recipe node_record_info. Each child node result
// is classified into inputs (api_name, prompt_template) and outputs (all
// other fields). recipe_result is included in outputs only when
// includeRecipeResult is true. RESTFUL nodes get api_resp_define extracted
// as outputDefine and removed from outputs.
export function buildNodeRecordInfo(
  nodeResults: readonly WorkflowNodeResult[],
  flowGraph: RecipeDefinition['flowGraph'],
  includeRecipeResult: boolean,
): readonly JsonObject[] {
  return Object.freeze(
    nodeResults.map((nodeResult) => {
      const nodeDef = flowGraph.nodes[nodeResult.nodeId];
      const inputs: Record<string, unknown> = {};
      const outputs: Record<string, unknown> = {};
      if (isRecord(nodeResult.output)) {
        for (const [key, value] of Object.entries(nodeResult.output)) {
          if (nodeRecordInputFields.has(key)) {
            inputs[key] = value;
          } else if (key === 'recipe_result') {
            if (includeRecipeResult) {
              outputs[key] = value;
            }
          } else {
            outputs[key] = value;
          }
        }
      }
      let outputDefine: JsonObject | undefined;
      if (nodeResult.nodeType === 'RESTFUL' && outputs.api_resp_define !== undefined) {
        outputDefine = outputs.api_resp_define as JsonObject;
        delete outputs.api_resp_define;
      }
      return Object.freeze({
        name: nodeResult.nodeId,
        type: nodeResult.nodeType,
        ...(nodeDef?.description !== undefined ? { description: nodeDef.description } : {}),
        inputs: Object.freeze(inputs) as JsonObject,
        outputs: Object.freeze(outputs) as JsonObject,
        ...(outputDefine !== undefined ? { outputDefine } : {}),
      }) as JsonObject;
    }),
  );
}

export function removeThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gu, '').trim();
}

export function asNonNegativeInteger(value: unknown): number {
  const numeric = coerceNumber(value);
  return numeric !== undefined && Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

export interface ResolvedWorkflowRetryPolicy {
  readonly maxRetries: number;
  readonly delay?: number;
}

export function resolveWorkflowRetryPolicy(structured: unknown, legacy: unknown, defaultRetry: unknown): ResolvedWorkflowRetryPolicy | undefined {
  return (
    parseWorkflowRetryPolicyRecord(structured, true) ??
    parseWorkflowRetryPolicyRecord(legacy, false) ??
    parseWorkflowRetryPolicyRecord(defaultRetry, true)
  );
}

function parseWorkflowRetryPolicyRecord(value: unknown, structured: boolean): ResolvedWorkflowRetryPolicy | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rawMaxRetries = structured
    ? (record.maxAttempts ?? 0)
    : (record.maxRetries ?? (typeof record.maxAttempts === 'number' ? Math.max(0, record.maxAttempts - 1) : 0));
  return {
    maxRetries: asNonNegativeInteger(rawMaxRetries),
    ...(record.delay === undefined ? {} : { delay: asNonNegativeInteger(record.delay) }),
  };
}

export async function resolveNodeModelConfig(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  inputs: Record<string, unknown>,
): Promise<WorkflowNodeModelInvocationConfig> {
  const model = firstNonEmptyString(inputs.model);
  const modelGroup = firstNonEmptyString(inputs.modelGroup);
  if (options.resolveModelForParamExtract !== undefined && (model !== undefined || modelGroup !== undefined)) {
    const override = await options.resolveModelForParamExtract(context.request, context.signal, model, modelGroup);
    if (override !== undefined) {
      return override;
    }
  }
  if (options.resolveModelInvocationConfig === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE',
      message: 'Workflow model invocation boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  return await options.resolveModelInvocationConfig(context.request, context.signal);
}
