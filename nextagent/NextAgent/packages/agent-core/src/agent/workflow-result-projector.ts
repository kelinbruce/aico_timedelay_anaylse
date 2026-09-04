import { AgentError, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionResult } from '@nextagent/agent-contracts/core';
import { resolveAnswerNodeId } from './workflow-runtime-event-projector.js';

export interface WorkflowExecutionProjection {
  readonly terminalContent: string;
  readonly terminalError?: AgentError;
}

export function projectWorkflowExecutionResult(recipe: RecipeDefinition, result: WorkflowExecutionResult): WorkflowExecutionProjection {
  const safeError = latestWorkflowSafeError(result);
  const answerOutput = resolveAnswerNodeOutput(recipe, result);
  const preferredContent = pickPreferredWorkflowText(answerOutput);

  if (result.status === 'FAILED') {
    return {
      terminalContent: preferredContent ?? safeError?.message ?? `Workflow "${recipe.displayName}" failed safely.`,
      terminalError: workflowTerminalError(recipe, result.status, safeError),
    };
  }
  if (result.status === 'INTERRUPTED') {
    return {
      terminalContent: preferredContent ?? safeError?.message ?? `Workflow "${recipe.displayName}" was interrupted safely.`,
      terminalError: workflowTerminalError(recipe, result.status, safeError),
    };
  }
  if (result.status === 'WAITING') {
    return {
      terminalContent: preferredContent ?? `Workflow "${recipe.displayName}" is waiting for external input.`,
    };
  }

  return {
    terminalContent: preferredContent ?? '',
  };
}

// Resolve the answer node's output from nodeResults. Mirrors
// resolveSubRecipeAnswerNodeId in agent-workflow (agent-core cannot
// depend on agent-workflow). Falls back to the last non-gateway node
// with output when the answer node cannot be statically resolved
// (e.g. END has multiple predecessors in conditional converge recipes).
function resolveAnswerNodeOutput(recipe: RecipeDefinition, result: WorkflowExecutionResult): JsonObject {
  const answerNodeId = resolveAnswerNodeId(recipe.flowGraph);
  const results = result.nodeResults as ReadonlyArray<{ readonly nodeId?: string; readonly output?: unknown }>;
  if (answerNodeId !== undefined) {
    const answerResult = results.find((node) => node.nodeId === answerNodeId);
    if (answerResult?.output !== undefined && typeof answerResult.output === 'object' && answerResult.output !== null) {
      return stripOutputParser(answerResult.output as Record<string, unknown>);
    }
    // Answer node was resolved but has no output in nodeResults; do not
    // fall through to reverse scan (would pick up unrelated detail nodes).
    return result.outputVariables;
  }
  for (let i = results.length - 1; i >= 0; i--) {
    const node = results[i]!;
    if (node.output !== undefined && typeof node.output === 'object' && node.output !== null) {
      return stripOutputParser(node.output as Record<string, unknown>);
    }
  }
  return result.outputVariables;
}

function stripOutputParser(output: Record<string, unknown>): JsonObject {
  if (!('output_parser' in output)) {
    return output as JsonObject;
  }
  const { output_parser: _omitted, ...rest } = output;
  return rest as JsonObject;
}

function pickPreferredWorkflowText(outputVariables: JsonObject): string | undefined {
  for (const key of ['message', 'content', 'display_content', 'result', 'answer', 'summary'] as const) {
    const value = outputVariables[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return serializeWorkflowOutputFallback(outputVariables);
}

// When no known text field is present (e.g. RAG nodes that output
// recipe_name, apiName, knowledge_search_result), serialize the entire
// outputVariables as a JSON fallback so terminalContent is never empty.
// Truncated to stay well under the runtime terminal message limit.
const workflowTerminalFallbackCharLimit = 16_384;

function serializeWorkflowOutputFallback(outputVariables: JsonObject): string | undefined {
  const serialized = JSON.stringify(outputVariables);
  if (serialized === '{}') {
    return undefined;
  }
  return serialized.length > workflowTerminalFallbackCharLimit ? `${serialized.slice(0, workflowTerminalFallbackCharLimit)}...` : serialized;
}

function latestWorkflowSafeError(result: WorkflowExecutionResult): SafeError | undefined {
  // When the workflow FAILED, skip CANCELED-category safeErrors: they are collateral
  // interruptions from parallel branch abort (joinOnFailure: 'break'), not the root cause.
  // For INTERRUPTED status, CANCELED is the correct category and must be preserved.
  // If only CANCELED safeErrors remain, fall back to the most recent one rather than
  // losing the error context entirely.
  const skipCanceled = result.status === 'FAILED';
  let lastCanceled: SafeError | undefined;
  for (let index = result.nodeResults.length - 1; index >= 0; index -= 1) {
    const safeError = result.nodeResults[index]?.safeError;
    if (safeError === undefined) {
      continue;
    }
    if (!skipCanceled || safeError.category !== 'CANCELED') {
      return safeError;
    }
    if (lastCanceled === undefined) {
      lastCanceled = safeError;
    }
  }
  return lastCanceled;
}

function workflowTerminalError(recipe: RecipeDefinition, status: WorkflowExecutionResult['status'], safeError?: SafeError): AgentError {
  // Last line of defense: a CANCELED category must never leak into a FAILED terminal
  // state. If the only available safeError is a collateral abort (CANCELED), force the
  // terminal category to INTERNAL so the request resolves as failed, not cancelled.
  const leakedCanceled = status === 'FAILED' && safeError?.category === 'CANCELED';
  return new AgentError({
    code: safeError?.code ?? (status === 'FAILED' ? 'WORKFLOW_EXECUTION_FAILED' : 'WORKFLOW_EXECUTION_INTERRUPTED'),
    message: safeError?.message ?? workflowTerminalFallbackMessage(recipe, status),
    category: leakedCanceled ? 'INTERNAL' : (safeError?.category ?? (status === 'FAILED' ? 'INTERNAL' : 'CANCELED')),
    retryable: safeError?.retryable ?? false,
    ...(safeError?.safeDetails === undefined ? {} : { safeDetails: safeError.safeDetails }),
  });
}

function workflowTerminalFallbackMessage(recipe: RecipeDefinition, status: WorkflowExecutionResult['status']): string {
  return status === 'FAILED' ? `Workflow "${recipe.displayName}" failed safely.` : `Workflow "${recipe.displayName}" was interrupted safely.`;
}
