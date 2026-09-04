import { AgentError, getLogger, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationRuntimeContext } from '@nextagent/agent-contracts/capability';
import type { WorkflowNodeHandlerContext, WorkflowNodeHandlerResult } from './types.js';
import type { CreateWorkflowNodeCatalogOptions } from './types.js';
import {
  asJsonObject,
  buildAgentPrompt,
  coerceBoolean,
  coerceNumber,
  buildCapabilityInvocationRequest,
  capabilityResultPayload,
  firstNonEmptyString,
  invalidNodeInput,
  isRecord,
  nodeTrace,
  omitKeys,
  nodeTimeoutMs,
  parseCandidateTools,
  projectNodeOutputs,
  readChildChatId,
  asNonNegativeInteger,
  requireCapabilityInvocation,
  createWorkflowCapabilityRuntimeContext,
  resolvePythonResult,
  toPythonLiteral,
  requireModelInvocation,
  resolveNodeValue,
  resolveSecrets,
} from './shared.js';
import { extractRestfulParameters } from './restful-param-extract.js';
import { resolveApiInputSchema } from './restful-param-extract.js';
import { convertTimeParameters } from './restful-time-param.js';

const logger = getLogger({ component: 'agent-workflow', source: 'capability-nodes' });

const RESTFUL_CONTROL_FIELDS: readonly string[] = [
  'api_name',
  'stream_type',
  'is_long_api',
  'fm_extract_parameter',
  'modelGroup',
  'param_extract_prompt_template',
  'param_extract_prompt_template_name',
  'open_reflection',
  'retry_times',
  'retry_wait_time',
  'poll_max_times',
  'poll_interval',
  'poll_timeout',
  'poll_single_timeout',
  'on_poll_error',
  'intervals',
  'overtime',
  'singleOvertime',
];

function readReflectionAnswer(context: WorkflowNodeHandlerContext): string | undefined {
  const rs = context.resumeState;
  if (rs === undefined || rs.nodeId !== context.nodeId || rs.nodeType !== context.node.type || rs.answers === undefined) {
    return undefined;
  }
  return rs.answers[0]?.[0];
}

async function createReflectionPendingInput(context: WorkflowNodeHandlerContext, followUpQuestion: string): Promise<WorkflowNodeHandlerResult> {
  const requestPendingInput = context.requestPendingInput;
  if (requestPendingInput === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE',
      message: 'Workflow interaction boundary is unavailable for parameter reflection.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const pendingInput = await requestPendingInput(
    {
      kind: 'QUESTION',
      questions: [{ prompt: followUpQuestion, options: [], custom: true }],
      resumeState: {
        executionId: context.executionId,
        recipeName: context.recipe.recipeName,
        nodeId: context.nodeId,
        nodeType: context.node.type,
        variables: context.variables,
      },
    },
    context.signal,
  );
  return { pendingInput, outputVariables: {} };
}

async function resolveRestfulArgs(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  capabilityId: string,
): Promise<{ args: Record<string, unknown>; handlerResult?: WorkflowNodeHandlerResult }> {
  const reflectionAnswer = readReflectionAnswer(context);
  if (context.resumeState !== undefined && context.resumeState.nodeId === context.nodeId && context.resumeState.answers === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_NODE_TIMEOUT',
      message: 'Workflow restful node timed out waiting for parameter reflection.',
      category: 'TIMEOUT',
      retryable: true,
      safeDetails: { reasonCode: 'WORKFLOW_NODE_TIMEOUT', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const inputSchema = await resolveApiInputSchema(context, options, capabilityId);
  let mergedResolved: Record<string, unknown> = { ...resolved };
  if (coerceBoolean(resolved.fm_extract_parameter) === true) {
    const outcome = await extractRestfulParameters(context, options, resolved, capabilityId, inputSchema, reflectionAnswer);
    if (outcome.kind === 'reflection') {
      const handlerResult = await createReflectionPendingInput(context, outcome.followUpQuestion);
      return { args: mergedResolved, handlerResult };
    }
    if (outcome.kind === 'extracted') {
      mergedResolved = outcome.params;
    }
  }
  if (inputSchema !== undefined) {
    convertTimeParameters(mergedResolved, { apiInputSchema: inputSchema });
  }
  return { args: omitKeys(mergedResolved, RESTFUL_CONTROL_FIELDS) };
}

import { aborted, executeBatch, readBatchConfig, type BatchOutput, type BatchExecutionConfig, type BatchElementResult } from './batch.js';

export async function executeRestfulNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
  const resolvedSecretValues: string[] = [];
  const resolved = await resolveSecrets(
    resolveNodeValue(context.node.inputs ?? {}, context.variables),
    options.resolveSecretReference,
    resolvedSecretValues,
  );
  if (!isRecord(resolved) || typeof resolved.api_name !== 'string' || resolved.api_name.length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'api_name');
  }
  const capabilityId = resolved.api_name;
  const trace = nodeTrace(context, capabilityId);
  const { args, handlerResult } = await resolveRestfulArgs(context, options, resolved, capabilityId);
  if (handlerResult !== undefined) {
    return handlerResult;
  }
  const batchConfig = readBatchConfig(context);
  const streamType = readRestfulStreamType(context, resolved.stream_type);
  if (streamType === 'sse') {
    if (batchConfig !== undefined) {
      throw invalidNodeInput(context.nodeId, context.node.type, 'stream_type + batchInputDataItem');
    }
    if (coerceBoolean(resolved.is_long_api) === true) {
      throw invalidNodeInput(context.nodeId, context.node.type, 'stream_type + is_long_api');
    }
    return executeRestfulSSE(context, options, args, capabilityId, trace, resolvedSecretValues);
  }
  if (batchConfig !== undefined) {
    return executeRestfulBatch(context, options, resolved, args, capabilityId, trace, resolvedSecretValues, batchConfig);
  }
  if (coerceBoolean(resolved.is_long_api) === true) {
    return executeRestfulLongTaskPolling(context, options, resolved, args, capabilityId, trace, resolvedSecretValues);
  }
  const result = await capabilityInvocation.invoke(
    buildCapabilityInvocationRequest(context, capabilityId, asJsonObject(args)),
    context.signal,
    createWorkflowCapabilityRuntimeContext(),
  );
  logger.debug({
    event: 'workflow.restful.result',
    executionId: context.executionId,
    nodeId: context.nodeId,
    nodeType: context.node.type,
    capabilityId,
    status: result.status,
  });
  const payload = capabilityResultPayload(result, trace, resolvedSecretValues);
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        api_response: payload,
        invocation_trace: trace,
      },
      context.node,
    ),
  };
}

function readRestfulStreamType(context: WorkflowNodeHandlerContext, value: unknown): 'sse' | undefined {
  if (value === undefined || (typeof value === 'string' && value.trim().length === 0)) {
    return undefined;
  }
  if (value === 'sse') {
    return 'sse';
  }
  throw invalidNodeInput(context.nodeId, context.node.type, 'stream_type');
}

// SSE 流式执行模式：复用 CLIP subscribe 原语，每个 SSE 事件通过
// emitResultDelta 透传为 NODE_OUTPUT_DELTA（DSL/DETAIL），invoke 返回时
// CLIP 层已聚合为 { events, completion } 完整结果，作为 api_response
// 传递给下游节点。
async function executeRestfulSSE(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  args: Record<string, unknown>,
  capabilityId: string,
  trace: JsonObject,
  resolvedSecretValues: readonly string[],
): Promise<WorkflowNodeHandlerResult> {
  const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
  const runtimeContext: CapabilityInvocationRuntimeContext = {
    emitPolicyApplied: async () => {},
    emitResultDelta: async (payload) => {
      const content = JSON.stringify(payload.structuredPayload);
      await context.emitOutputDelta({ channel: 'DSL', content: `${content}\n`, level: 'DETAIL' });
    },
  };
  const result = await capabilityInvocation.invoke(
    buildCapabilityInvocationRequest(context, capabilityId, asJsonObject(args)),
    context.signal,
    runtimeContext,
  );
  logger.debug({
    event: 'workflow.restful.sse.result',
    executionId: context.executionId,
    nodeId: context.nodeId,
    nodeType: context.node.type,
    capabilityId,
    status: result.status,
  });
  const payload = capabilityResultPayload(result, trace, resolvedSecretValues);
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        api_response: payload,
        invocation_trace: trace,
      },
      context.node,
    ),
  };
}

async function executeRestfulLongTaskPolling(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  args: Record<string, unknown>,
  capabilityId: string,
  trace: JsonObject,
  resolvedSecretValues: readonly string[],
): Promise<WorkflowNodeHandlerResult> {
  const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
  const pollMaxTimes = asPositiveInteger(resolved.poll_max_times);
  if (pollMaxTimes === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'poll_max_times');
  }
  const pollIntervalMs = (coerceNumber(resolved.poll_interval) ?? coerceNumber(resolved.intervals) ?? 0) * 1000;
  const pollTimeoutMs = (coerceNumber(resolved.poll_timeout) ?? coerceNumber(resolved.overtime) ?? 0) * 1000;
  const pollSingleTimeoutMs = (coerceNumber(resolved.poll_single_timeout) ?? coerceNumber(resolved.singleOvertime) ?? 0) * 1000;
  const onPollError = resolved.on_poll_error === 'skip' ? 'skip' : 'terminate';
  const invocationArgs = asJsonObject(args);
  const pollResults: JsonObject[] = [];
  const deadline = pollTimeoutMs > 0 ? Date.now() + pollTimeoutMs : Number.POSITIVE_INFINITY;
  for (let attempt = 1; attempt <= pollMaxTimes; attempt += 1) {
    if (context.signal.aborted) {
      throw aborted();
    }
    if (attempt > 1 && Date.now() >= deadline) {
      break;
    }
    const request = buildCapabilityInvocationRequest(
      context,
      capabilityId,
      invocationArgs,
      pollSingleTimeoutMs > 0 ? pollSingleTimeoutMs : undefined,
      `poll:${attempt}`,
    );
    const result = await capabilityInvocation.invoke(request, context.signal, createWorkflowCapabilityRuntimeContext());
    if (Date.now() >= deadline) {
      break;
    }
    if (result.status === 'SUCCEEDED' || result.status === 'DEGRADED') {
      pollResults.push(capabilityResultPayload(result, trace, resolvedSecretValues));
    } else if (onPollError === 'skip') {
      pollResults.push(safeErrorSummary(result.safeError, trace));
    } else {
      capabilityResultPayload(result, trace, resolvedSecretValues);
    }
    if (attempt < pollMaxTimes && Date.now() < deadline) {
      await sleep(pollIntervalMs, context.signal);
    }
  }
  if (pollResults.length === 0) {
    throw new AgentError({
      code: 'WORKFLOW_RESTFUL_POLL_NO_RESULTS',
      message: 'Workflow restful long-task polling produced no results.',
      category: 'INTERNAL',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_RESTFUL_POLL_NO_RESULTS', nodeId: context.nodeId, nodeType: context.node.type, capabilityId },
    });
  }
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        poll_results: Object.freeze(pollResults),
        invocation_trace: trace,
      },
      context.node,
    ),
  };
}

async function executeRestfulBatch(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  args: Record<string, unknown>,
  capabilityId: string,
  trace: JsonObject,
  resolvedSecretValues: readonly string[],
  config: BatchExecutionConfig,
): Promise<WorkflowNodeHandlerResult> {
  const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
  const baseArgs = args;

  const processElement = async (element: unknown, index: number, signal: AbortSignal): Promise<BatchElementResult> => {
    const args = { ...baseArgs, [config.elementVariable]: element };
    const result = await capabilityInvocation.invoke(
      buildCapabilityInvocationRequest(context, capabilityId, asJsonObject(args), undefined, `batch:${index}`),
      signal,
      createWorkflowCapabilityRuntimeContext(),
    );
    if (result.status === 'FAILED' || result.status === 'TIMED_OUT') {
      return {
        failed: {
          code: result.safeError?.code ?? 'WORKFLOW_CAPABILITY_FAILED',
          message: result.safeError?.message ?? 'Capability invocation failed.',
        },
      };
    }
    return { result: capabilityResultPayload(result, trace, resolvedSecretValues) };
  };

  const buildOutput = (output: BatchOutput): JsonObject => {
    const lastResult = output.elementResults[config.items.length - 1];
    return {
      batch_results: output.batchResults,
      failed_items: Object.freeze(output.failedItems),
      ...(lastResult === undefined ? {} : { api_response: lastResult }),
      invocation_trace: trace,
    };
  };

  return executeBatch(config, context, processElement, buildOutput);
}

function safeErrorSummary(safeError: SafeError | undefined, trace: JsonObject): JsonObject {
  return Object.freeze({
    poll_failed: true,
    code: safeError?.code ?? 'WORKFLOW_CAPABILITY_FAILED',
    category: safeError?.category ?? 'INTERNAL',
    reasonCode: safeError?.safeDetails?.reasonCode ?? safeError?.code ?? 'WORKFLOW_CAPABILITY_FAILED',
    _trace: trace,
  });
}

function asPositiveInteger(value: unknown): number {
  const numeric = coerceNumber(value);
  return numeric !== undefined && Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executePythonNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const inputs = resolveNodeValue(context.node.inputs ?? {}, context.variables);
  if (!isRecord(inputs) || typeof inputs.script !== 'string' || inputs.script.trim().length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'script');
  }
  const useJsonString = coerceBoolean(inputs.param_to_json_str) ?? false;
  const variableInputs = omitKeys(inputs, ['script', 'param_to_json_str']);
  const declarations = Object.entries(variableInputs).map(([key, value]) =>
    useJsonString ? `${key}=r'''${JSON.stringify(value)}'''` : `${key}=${toPythonLiteral(value)}`,
  );
  const args: JsonObject = {
    code: inputs.script,
    ...(declarations.length > 0 ? { preamble: declarations.join('\n') } : {}),
    args: [],
  };
  const trace = nodeTrace(context, 'Python');
  logger.debug({
    event: 'workflow.python.execute',
    executionId: context.executionId,
    nodeId: context.nodeId,
    nodeType: context.node.type,
    scriptLength: inputs.script.length,
    variableCount: declarations.length,
    useJsonString,
  });
  let pythonResult;
  if (options.sandboxExecution !== undefined) {
    const fullCode = declarations.length > 0 ? declarations.join('\n') + '\n' + inputs.script : inputs.script;
    const output = await options.sandboxExecution.runPython(
      {
        code: fullCode,
        args: [],
        timeoutMs: nodeTimeoutMs(context.node, 30_000),
        stdoutLimitBytes: 1_000_000,
        stderrLimitBytes: 1_000_000,
      },
      {
        identityContext: context.request.identityContext,
        agentId: context.request.agentId,
        agentVersion: context.request.agentVersion,
        sessionId: context.request.sessionId,
        requestId: context.request.requestId,
        runId: context.request.runId,
        requestContextId: context.request.requestContextId,
        stepId: `workflow:${context.nodeId}`,
        toolCallId: `workflow:${context.executionId}:${context.nodeId}:${context.attempt}`,
        timeoutMs: nodeTimeoutMs(context.node, 30_000),
      },
      context.signal,
    );
    pythonResult = resolvePythonResult({ ...output, _trace: trace });
  } else {
    const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
    const result = await capabilityInvocation.invoke(
      buildCapabilityInvocationRequest(context, 'Python', args),
      context.signal,
      createWorkflowCapabilityRuntimeContext(),
    );
    pythonResult = resolvePythonResult(capabilityResultPayload(result, trace));
  }
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        python_result: pythonResult,
        invocation_trace: trace,
      },
      context.node,
    ),
  };
}

export async function executeAgentNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
  const inputs = resolveNodeValue(context.node.inputs ?? {}, context.variables);
  if (!isRecord(inputs) || typeof inputs.agent_name !== 'string' || inputs.agent_name.length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'agent_name');
  }
  const runtimeCapabilityResolver = options.runtimeCapabilityResolver?.(context.request);
  const prompt = buildAgentPrompt(inputs, context.variables);
  const trace = nodeTrace(context, 'Agent');
  const result = await capabilityInvocation.invoke(
    buildCapabilityInvocationRequest(context, 'Agent', {
      agentId: inputs.agent_name,
      prompt,
    }),
    context.signal,
    {
      ...createWorkflowCapabilityRuntimeContext(),
      ...(runtimeCapabilityResolver === undefined ? {} : { capabilityResolver: runtimeCapabilityResolver }),
    },
  );
  const payload = capabilityResultPayload(result, trace);
  const childChatId = readChildChatId(payload);
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        agent_result: payload,
        ...(childChatId === undefined ? {} : { child_chat_id: childChatId }),
        invocation_trace: trace,
      },
      context.node,
    ),
  };
}

export async function executeToolChoiceNode(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
): Promise<WorkflowNodeHandlerResult> {
  if (options.modelInvocation === undefined || options.resolveModelInvocationConfig === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE',
      message: 'Workflow model invocation boundary is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  const modelInvocation = requireModelInvocation(options.modelInvocation);
  const inputs = resolveNodeValue(context.node.inputs ?? {}, context.variables);
  if (!isRecord(inputs)) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'candidateTools');
  }
  const candidateTools = parseCandidateTools(inputs.candidateTools);
  if (candidateTools.length === 0) {
    throw invalidNodeInput(context.nodeId, context.node.type, 'candidateTools');
  }
  const taskDescription =
    typeof inputs.taskDescription === 'string'
      ? inputs.taskDescription
      : typeof inputs.query === 'string'
        ? inputs.query
        : typeof context.variables.input_question === 'string'
          ? context.variables.input_question
          : (context.node.description ?? 'Choose the safest tool for the current workflow step.');
  const config = await options.resolveModelInvocationConfig(context.request, context.signal);
  const result = await modelInvocation.complete(
    {
      invocationScope: {
        tenantId: context.request.identityContext.tenantId,
        subjectId: context.request.identityContext.subjectId,
        agentId: context.request.agentId,
        agentVersion: context.request.agentVersion,
        agentAssemblyRef: context.request.agentAssemblyRef ?? `${context.request.agentId}:${context.request.agentVersion}`,
        operationId: `workflow:${context.nodeId}:tool-choice`,
        sessionId: context.request.sessionId,
        requestId: context.request.requestId,
        runId: context.request.runId,
      },
      modelId: config.modelId,
      messages: [
        {
          role: 'SYSTEM',
          content: [
            {
              type: 'text',
              text: 'Select exactly one candidate tool. Return one tool call with safe mapped arguments only. Do not answer in plain text.',
            },
          ],
        },
        {
          role: 'USER',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                taskDescription,
                candidateTools: candidateTools.map((candidate) => ({
                  capabilityId: candidate.capabilityId,
                  description: candidate.description,
                  inputSchema: candidate.inputSchema,
                })),
                contextVariables: context.variables,
              }),
            },
          ],
        },
      ],
      tools: candidateTools.map((candidate) => ({
        capabilityId: candidate.capabilityId,
        name: candidate.capabilityId,
        ...(candidate.description === undefined ? {} : { description: candidate.description }),
        inputSchema: candidate.inputSchema,
      })),
      ...config.inferenceOptions,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    },
    context.signal,
  );
  if (result.safeError !== undefined) {
    throw new AgentError({
      code: result.safeError.code,
      message: result.safeError.message,
      category: result.safeError.category,
      retryable: result.safeError.retryable,
      ...(result.safeError.safeDetails === undefined ? {} : { safeDetails: result.safeError.safeDetails }),
    });
  }
  const selectedCall = result.toolCalls?.[0];
  if (selectedCall === undefined || !candidateTools.some((candidate) => candidate.capabilityId === selectedCall.toolName)) {
    throw new AgentError({
      code: 'WORKFLOW_TOOL_CHOICE_INVALID_SELECTION',
      message: 'Tool choice selected an invalid candidate safely.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_TOOL_CHOICE_INVALID_SELECTION', nodeId: context.nodeId, nodeType: context.node.type },
    });
  }
  return {
    outputVariables: projectNodeOutputs(
      context.node.outputs,
      {
        tool_choice_result: {
          selectedToolId: selectedCall.toolName,
          mappedArguments: selectedCall.arguments,
        },
        selectedToolId: selectedCall.toolName,
        mappedArguments: selectedCall.arguments,
      },
      context.node,
    ),
  };
}
