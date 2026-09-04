import type { JsonObject, SafeError } from '@nextagent/agent-common';
import { getLogger } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { CapabilityGeneratedMessage } from '@nextagent/agent-contracts/capability';
import type {
  RecipeDefinition,
  WorkflowExecutionEvent,
  WorkflowExecutionObserver,
  WorkflowExecutionRequest,
  WorkflowExecutionService,
} from '@nextagent/agent-contracts/core';
import type { WorkflowRecipeAwareObserver } from './nodes/types.js';
import { resolveSubRecipeAnswerNodeId } from './nodes/shared.js';
import { parsePendingInputRequest } from './pending-input-shared.js';

const logger = getLogger({ component: 'agent-workflow', source: 'workflow-tool-port' });

export interface WorkflowToolExecutionContext {
  readonly identityContext: WorkflowExecutionRequest['identityContext'];
  readonly agentId: WorkflowExecutionRequest['agentId'];
  readonly agentVersion: WorkflowExecutionRequest['agentVersion'];
  readonly sessionId: WorkflowExecutionRequest['sessionId'];
  readonly requestId: WorkflowExecutionRequest['requestId'];
  readonly runId: WorkflowExecutionRequest['runId'];
  readonly requestContextId: WorkflowExecutionRequest['requestContextId'];
  readonly emitResultDelta?: (payload: JsonObject) => Promise<void>;
}

export interface WorkflowExecutionToolPort {
  execute: (input: {
    readonly recipeName: string;
    readonly inputText?: string;
    readonly inputVariables: JsonObject;
    readonly context: WorkflowToolExecutionContext;
    readonly signal: AbortSignal;
  }) => Promise<CapabilityInvocationResult>;
}

export interface WorkflowToolPortOptions {
  readonly resolveRecipeDefinition: (request: {
    readonly agentId: WorkflowToolExecutionContext['agentId'];
    readonly recipeName: string;
  }) => RecipeDefinition;
  readonly workflowExecutionService: WorkflowExecutionService;
}

export function createWorkflowToolPort(options: WorkflowToolPortOptions): WorkflowExecutionToolPort {
  const { resolveRecipeDefinition, workflowExecutionService } = options;
  return {
    async execute(input): Promise<CapabilityInvocationResult> {
      const { recipeName, inputText, inputVariables, context, signal } = input;
      let recipe: RecipeDefinition;
      try {
        recipe = resolveRecipeDefinition({ agentId: context.agentId, recipeName });
      } catch {
        return failed('RECIPE_NOT_FOUND', 'Requested workflow recipe is not available in the current Agent scope.', 'VALIDATION');
      }
      const request: WorkflowExecutionRequest = {
        recipeName,
        recipeVersion: recipe.version,
        inputVariables,
        ...(inputText === undefined ? {} : { inputText }),
        identityContext: context.identityContext,
        agentId: context.agentId,
        agentVersion: context.agentVersion,
        sessionId: context.sessionId,
        requestId: context.requestId,
        runId: context.runId,
        requestContextId: context.requestContextId,
      };
      const observer = createTimelineObserver(recipe, context);
      try {
        const result = await workflowExecutionService.execute(request, signal, observer);
        return mapWorkflowResult(recipeName, recipe, result);
      } catch (error) {
        if (signal.aborted) {
          return failed('WORKFLOW_ABORTED', 'Workflow execution was aborted.', 'CANCELED');
        }
        logger.error(
          {
            event: 'workflow.tool.execution_error',
            reasonCode: 'WORKFLOW_EXECUTION_ERROR',
            recipeName,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack !== undefined ? { errorStack: error.stack } : {}),
          },
          'Workflow execution encountered an internal error.',
        );
        return failed('WORKFLOW_EXECUTION_ERROR', 'Workflow execution encountered an internal error.', 'INTERNAL');
      }
    },
  };
}

function createTimelineObserver(recipe: RecipeDefinition, context: WorkflowToolExecutionContext): WorkflowRecipeAwareObserver | undefined {
  if (context.emitResultDelta === undefined) {
    return undefined;
  }
  const emit = context.emitResultDelta;
  const recipeByExecutionId = new Map<string, RecipeDefinition>();
  return {
    registerExecutionRecipe(executionId: string, childRecipe: RecipeDefinition) {
      recipeByExecutionId.set(executionId, childRecipe);
    },
    async emitEvent(event: WorkflowExecutionEvent): Promise<void> {
      const eventRecipe = recipeByExecutionId.get(event.executionId) ?? recipe;
      await emit({
        workflowRecipe: serializeWorkflowProjectionRecipe(eventRecipe),
        workflowExecutionEvent: serializeWorkflowExecutionEvent(event),
      });
    },
  };
}

function serializeWorkflowProjectionRecipe(recipe: RecipeDefinition): JsonObject {
  const nodes: Record<string, unknown> = {};
  for (const [nodeId, node] of Object.entries(recipe.flowGraph.nodes)) {
    nodes[nodeId] = {
      id: nodeId,
      type: node.type,
      ...(node.next === undefined ? {} : { next: node.next }),
      ...(node.description === undefined ? {} : { description: node.description }),
      ...(node.outputParser === undefined ? {} : { outputParser: node.outputParser }),
      ...(node.presentation?.outputParser === undefined ? {} : { presentation: { outputParser: node.presentation.outputParser } }),
      ...(node.inputs === undefined ? {} : { inputs: projectWorkflowNodeIdentityInputs(node.inputs) }),
    };
  }
  return {
    recipeName: recipe.recipeName,
    version: recipe.version,
    flowGraph: { nodes },
  } as JsonObject;
}

function projectWorkflowNodeIdentityInputs(inputs: RecipeDefinition['flowGraph']['nodes'][string]['inputs']): JsonObject {
  const projected: Record<string, unknown> = {};
  for (const key of ['tool_name', 'recipe_name', 'skill_name', 'name']) {
    const value = inputs?.[key];
    if (typeof value === 'string') {
      projected[key] = value;
    }
  }
  return projected as JsonObject;
}

function serializeWorkflowExecutionEvent(event: WorkflowExecutionEvent): JsonObject {
  const payload: Record<string, unknown> = {
    executionId: event.executionId,
    nodeId: event.nodeId,
    nodeType: event.nodeType,
    eventType: event.eventType,
    retryCount: event.retryCount,
    startedAtEpochMs: event.startedAt.getTime(),
    ...(event.nodeExecutionId === undefined ? {} : { nodeExecutionId: event.nodeExecutionId }),
    ...(event.predecessorNodeExecutionIds === undefined ? {} : { predecessorNodeExecutionIds: event.predecessorNodeExecutionIds }),
    ...(event.completedAt === undefined ? {} : { completedAtEpochMs: event.completedAt.getTime() }),
    ...(event.visibleDelta === undefined ? {} : { visibleDelta: event.visibleDelta }),
    ...(event.output === undefined ? {} : { output: event.output }),
    ...(event.input === undefined ? {} : { input: event.input }),
    ...(event.diagnostic === undefined ? {} : { diagnostic: event.diagnostic }),
    ...(event.safeError === undefined ? {} : { safeError: event.safeError }),
  };
  return payload as JsonObject;
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

export interface WorkflowResultView {
  readonly executionId?: string;
  readonly status: 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'WAITING';
  readonly outputVariables: JsonObject;
  readonly nodeResults?: readonly unknown[];
  readonly pendingInput?: JsonObject;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export function mapWorkflowResult(recipeName: string, recipe: RecipeDefinition, result: WorkflowResultView): CapabilityInvocationResult {
  const nodeResults = result.nodeResults ?? [];
  const metadata = workflowResultMetadata(result.executionId, result.nodeResults?.length);
  const answerOutput = resolveAnswerNodeOutput(recipe, nodeResults);
  const answerPreviews = extractAnswerPreviews(answerOutput);
  logger.debug({
    event: 'workflow.result.mapped',
    recipeName,
    status: result.status,
    answerPreviewCount: answerPreviews.length,
    nodeResultCount: nodeResults.length,
    durationMs: result.completedAt.getTime() - result.startedAt.getTime(),
  });
  if (result.status === 'COMPLETED') {
    return {
      status: 'SUCCEEDED',
      structuredPayload: { recipeName, status: 'succeeded', outputVariables: safeFilterOutputVariables(answerOutput), answerPreviews },
      generatedMessages: extractAnswerGeneratedMessages(answerOutput),
      artifactRefs: [],
      ...(metadata === undefined ? {} : { metadata }),
    };
  }
  if (result.status === 'INTERRUPTED') {
    return {
      status: 'FAILED',
      structuredPayload: { recipeName, status: 'interrupted', answerPreviews },
      generatedMessages: extractAnswerGeneratedMessages(answerOutput),
      artifactRefs: [],
      safeError: { code: 'WORKFLOW_INTERRUPTED', message: 'Workflow execution was interrupted.', category: 'CANCELED', retryable: false },
      ...(metadata === undefined ? {} : { metadata }),
    };
  }
  if (result.status === 'WAITING') {
    const pendingInput = extractPendingInputSummary(result.pendingInput);
    const waitingAnswerOutput = answerPreviews.length === 0 ? resolveMarkedAnswerOutput(nodeResults) : answerOutput;
    const waitingAnswerPreviews = extractAnswerPreviews(waitingAnswerOutput);
    if (pendingInput === undefined && waitingAnswerPreviews.length === 0) {
      return failed(
        'CAPABILITY_EXECUTION_FAILED',
        'Workflow returned WAITING without usable pending input or answer previews. Stop this workflow action and report the error.',
        'INTERNAL',
      );
    }
    return {
      status: 'SUCCEEDED',
      structuredPayload: {
        recipeName,
        status: 'waiting',
        ...(pendingInput === undefined ? {} : { pendingInput }),
        answerPreviews: waitingAnswerPreviews,
      },
      generatedMessages: extractAnswerGeneratedMessages(waitingAnswerOutput),
      artifactRefs: [],
      ...(metadata === undefined ? {} : { metadata }),
    };
  }
  const lastFailedNode = [...(nodeResults as ReadonlyArray<{ readonly safeError?: SafeError }>)]
    .reverse()
    .find((node) => node.safeError !== undefined);
  return {
    status: 'FAILED',
    structuredPayload: { recipeName, status: 'failed', answerPreviews },
    generatedMessages: extractAnswerGeneratedMessages(answerOutput),
    artifactRefs: [],
    safeError: lastFailedNode?.safeError ?? {
      code: 'WORKFLOW_FAILED',
      message: 'Workflow execution failed.',
      category: 'INTERNAL',
      retryable: false,
    },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function workflowResultMetadata(executionId?: string, nodeResultCount?: number): JsonObject | undefined {
  const metadata = {
    ...(executionId === undefined ? {} : { executionId }),
    ...(nodeResultCount === undefined ? {} : { nodeResultCount }),
  };
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}

const secretKeywordPattern = /(?:secret|password|credential|token|api[_-]?key|private[_-]?key|access[_-]?key)/iu;

const answerPreviewMaxChars = 4_000;

const answerContentKeys = ['message', 'content', 'display_content', 'result', 'answer', 'summary'] as const;

// Resolve the answer node output from nodeResults. Uses
// resolveSubRecipeAnswerNodeId to find the answer node, then extracts
// its output (stripped of output_parser). Falls back to the last
// non-gateway node with output if the answer node cannot be statically
// resolved (e.g. END has multiple predecessors in conditional converge
// recipes).
function resolveAnswerNodeOutput(recipe: RecipeDefinition, nodeResults: readonly unknown[]): JsonObject {
  const answerNodeId = resolveSubRecipeAnswerNodeId(recipe.flowGraph);
  const results = nodeResults as ReadonlyArray<{ readonly nodeId?: string; readonly output?: unknown }>;
  if (answerNodeId !== undefined) {
    const answerResult = results.find((node) => node.nodeId === answerNodeId);
    if (answerResult?.output !== undefined && typeof answerResult.output === 'object' && answerResult.output !== null) {
      return stripOutputParserFromOutput(answerResult.output as Record<string, unknown>);
    }
    // Answer node was resolved but has no output in nodeResults; do not
    // fall through to reverse scan (would pick up unrelated detail nodes).
    return {};
  }
  for (let i = results.length - 1; i >= 0; i--) {
    const node = results[i]!;
    if (node.output !== undefined && typeof node.output === 'object' && node.output !== null) {
      return stripOutputParserFromOutput(node.output as Record<string, unknown>);
    }
  }
  return {};
}

function stripOutputParserFromOutput(output: Record<string, unknown>): JsonObject {
  if (!('output_parser' in output)) {
    return output as JsonObject;
  }
  const { output_parser: _omitted, ...rest } = output;
  return rest as JsonObject;
}

function resolveMarkedAnswerOutput(nodeResults: readonly unknown[]): JsonObject {
  for (const node of nodeResults) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    const output = (node as { readonly output?: unknown }).output;
    if (typeof output !== 'object' || output === null) {
      continue;
    }
    const record = output as Record<string, unknown>;
    if (typeof record.level === 'string' && record.level.toUpperCase() === 'ANSWER') {
      return stripOutputParserFromOutput(record);
    }
  }
  return {};
}

function extractAnswerPreviews(answerOutput: JsonObject): readonly string[] {
  for (const key of answerContentKeys) {
    const value = answerOutput[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return [value.length <= answerPreviewMaxChars ? value : `${value.slice(0, answerPreviewMaxChars).trimEnd()}\n...`];
    }
  }
  return [];
}

function extractAnswerGeneratedMessages(answerOutput: JsonObject): readonly CapabilityGeneratedMessage[] {
  for (const key of answerContentKeys) {
    const value = answerOutput[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return [{ role: 'USER', content: value }];
    }
  }
  return [];
}

function safeFilterOutputVariables(output: JsonObject): JsonObject {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (!secretKeywordPattern.test(key)) {
      filtered[key] = value;
    }
  }
  return filtered as JsonObject;
}

function extractPendingInputSummary(pendingInput?: JsonObject): JsonObject | undefined {
  if (pendingInput === undefined) {
    return undefined;
  }
  const parsed = parsePendingInputRequest(pendingInput);
  if (parsed === undefined || parsed.questions.length === 0) {
    return undefined;
  }
  return {
    kind: parsed.kind,
    questions: parsed.questions.slice(0, 10).map((question) => ({
      prompt: question.prompt,
      options: question.options.slice(0, 10).map((option) => ({ label: option.label })),
    })),
  };
}
