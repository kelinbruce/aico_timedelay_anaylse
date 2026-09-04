import { brand, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';

import { defineTool, type ToolExecuteOptions } from '../../tools/tool-spi.js';
import {
  workflowToolInputSchema,
  workflowToolInputTextMaxLength,
  workflowToolInputVariableCountMax,
  workflowToolOutputSchema,
  workflowToolRecipeNameMaxLength,
} from './workflow-schemas.js';

export const workflowToolCapabilityId = brand<string, 'CapabilityId'>('Workflow');

export const workflowToolDefinition = defineTool({
  name: workflowToolCapabilityId,
  description:
    'Execute a registered workflow recipe by name and return its result. ' +
    'Use Workflow when a skill or task instruction indicates a specific pre-configured multi-step workflow should run for the current request. ' +
    'The recipeName must be a registered workflow recipe in the current Agent scope. ' +
    'inputText carries the user question; inputVariables carries structured context parameters. ' +
    'The result includes the workflow status, output variables, and execution metadata. ' +
    'If the workflow is waiting for user input, use AskUserQuestion to relay the pending questions to the user.',
  inputSchema: workflowToolInputSchema,
  outputSchema: workflowToolOutputSchema,
  disclosurePolicy: { mode: 'EAGER' },
  requiredDependencies: ['workflowExecution'],
  replayPolicy: 'NON_IDEMPOTENT',
  returnsCapabilityResult: true,
  async execute(input, options) {
    return executeWorkflowTool(input, options);
  },
});

async function executeWorkflowTool(input: JsonObject, options?: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  if (options?.signal?.aborted) {
    return failed('ABORTED', 'Workflow tool invocation was aborted.', 'CANCELED');
  }
  const validation = validateInput(input);
  if (validation !== undefined) {
    return validation;
  }
  const context = options?.context;
  const workflowExecution = options?.deps?.workflowExecution;
  if (context === undefined || workflowExecution === undefined) {
    return failed(
      'EXECUTION_FAILED',
      'Workflow execution could not start because its governed runtime boundary or trusted context is unavailable. Use another available capability, continue without this workflow, or stop and report the unavailable boundary.',
      'UNAVAILABLE',
    );
  }
  const recipeName = input.recipeName as string;
  const inputText = typeof input.inputText === 'string' ? (input.inputText as string) : undefined;
  const inputVariables = (input.inputVariables ?? {}) as JsonObject;
  const recipeCapability = await context.capabilityResolver?.resolveCapability(
    { kind: 'WORKFLOW', capabilityId: brand<string, 'CapabilityId'>(recipeName) },
    options?.signal ?? new AbortController().signal,
  );
  if (recipeCapability === undefined) {
    return failed(
      'RECIPE_NOT_FOUND',
      'Requested workflow recipe is not available. Choose a registered recipe in the current Agent scope or continue without Workflow.',
      'NOT_FOUND',
    );
  }
  return workflowExecution.execute({
    recipeName,
    ...(inputText === undefined ? {} : { inputText }),
    inputVariables,
    context,
    signal: options?.signal ?? new AbortController().signal,
  });
}

function validateInput(input: JsonObject): CapabilityInvocationResult | undefined {
  if (typeof input.recipeName !== 'string' || input.recipeName.length === 0) {
    return failed(
      'INVALID_INPUT',
      'Workflow validation failed before execution: recipeName must be a non-empty string. Supply a registered recipe name and call again.',
      'VALIDATION',
    );
  }
  if (input.recipeName.length > workflowToolRecipeNameMaxLength) {
    return failed(
      'INVALID_INPUT',
      `Workflow validation failed before execution: recipeName must contain at most ${workflowToolRecipeNameMaxLength} characters. Use a valid registered recipe name and call again.`,
      'VALIDATION',
    );
  }
  if (input.inputText !== undefined) {
    if (typeof input.inputText !== 'string') {
      return failed(
        'INVALID_INPUT',
        'Workflow validation failed before execution: inputText must be a string when provided. Correct or omit inputText and call again.',
        'VALIDATION',
      );
    }
    if (Buffer.byteLength(input.inputText, 'utf8') > workflowToolInputTextMaxLength) {
      return failed(
        'INVALID_INPUT',
        `Workflow validation failed before execution: inputText must not exceed ${workflowToolInputTextMaxLength} UTF-8 bytes. Shorten or omit inputText and call again.`,
        'VALIDATION',
      );
    }
  }
  if (input.inputVariables !== undefined) {
    if (typeof input.inputVariables !== 'object' || input.inputVariables === null || Array.isArray(input.inputVariables)) {
      return failed(
        'INVALID_INPUT',
        'Workflow validation failed before execution: inputVariables must be a JSON object when provided. Correct or omit inputVariables and call again.',
        'VALIDATION',
      );
    }
    const keys = Object.keys(input.inputVariables as object);
    if (keys.length > workflowToolInputVariableCountMax) {
      return failed(
        'INVALID_INPUT',
        `Workflow validation failed before execution: inputVariables must contain at most ${workflowToolInputVariableCountMax} keys. Reduce the variables and call again.`,
        'VALIDATION',
      );
    }
  }
  for (const key of Object.keys(input)) {
    if (key !== 'recipeName' && key !== 'inputText' && key !== 'inputVariables') {
      return failed(
        'INVALID_INPUT',
        'Workflow validation failed before execution: input supports only recipeName, inputText, and inputVariables. Remove unsupported fields and call again.',
        'VALIDATION',
      );
    }
  }
  return undefined;
}

function failed(code: string, message: string, category: SafeError['category']): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable: false },
  };
}
