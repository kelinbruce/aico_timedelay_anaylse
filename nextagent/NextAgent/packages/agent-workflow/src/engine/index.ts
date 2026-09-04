import { AgentError, getLogger, type JsonObject, type JsonValue, type SafeError } from '@nextagent/agent-common';
import type {
  RecipeDefinition,
  WorkflowExecutionEvent,
  WorkflowExecutionObserver,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowExecutionService,
  WorkflowLoopContext,
  WorkflowVisibleDelta,
  WorkflowNodeDef,
  WorkflowNodeResult,
} from '@nextagent/agent-contracts/core';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { randomUUID } from 'node:crypto';
import {
  defaultWorkflowNodeCatalog,
  evaluateBranchCondition,
  redactSecretsFromValue,
  resolveNodeValue,
  resolveSecrets,
  resolveWorkflowBranchTransition,
  type WorkflowNodeCatalog,
  type WorkflowNodeHandlerResult,
  type WorkflowNodeTransition,
  type WorkflowRecipeAwareObserver,
} from '../nodes/index.js';
import {
  isRecord,
  parseResumeState as parseWorkflowResumeState,
  parsePendingInputRequest as parseWorkflowPendingInputRequest,
  pendingInputActivationToJson as workflowPendingInputActivationToJson,
  pendingInputRequestToJson as workflowPendingInputRequestToJson,
  type WorkflowExecutionResumeState,
  type WorkflowPendingInputActivation,
  type WorkflowPendingInputRequest,
} from '../pending-input-shared.js';
import { formatOutputValues, hasObjectOutputParserData, resolveSubRecipeAnswerNodeId, resolveWorkflowRetryPolicy } from '../nodes/shared.js';
import { CapabilityNodeExecutionError, isCapabilityNodeExecutionError } from './capability-node-error.js';

const workflowExecutionLogger = getLogger({ component: 'agent-workflow', source: 'workflow-execution-service' });

export interface WorkflowExecutionServiceFactoryOptions {
  readonly resolveRecipeDefinition: (request: WorkflowExecutionRequest) => RecipeDefinition;
  readonly nodeCatalog?: WorkflowNodeCatalog;
  readonly resolveSecretReference?: (reference: string) => Promise<string>;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}

export interface CreateWorkflowExecutionServiceOptions extends Partial<WorkflowExecutionServiceFactoryOptions> {
  readonly implementation?: WorkflowExecutionService;
  readonly nodeCatalog?: WorkflowNodeCatalog;
  readonly emitEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>;
  readonly now?: () => Date;
  readonly createExecutionId?: () => string;
  readonly createNodeExecutionId?: () => string;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly resolveSecretReference?: (reference: string) => Promise<string>;
}

interface WorkflowPathResult {
  readonly state: 'COMPLETED' | 'TERMINAL' | 'FAILED' | 'INTERRUPTED' | 'WAITING';
  readonly variables: JsonObject;
  readonly nextNodeId?: string;
  readonly pendingInput?: WorkflowPendingInputRequest;
  readonly predecessorNodeExecutionIds?: readonly string[];
}

interface WorkflowExecutionRuntime {
  readonly requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject>;
  readonly saveCheckpoint?: (input: { readonly resumeState: WorkflowExecutionResumeState }) => Promise<void>;
}

export function createWorkflowExecutionService(options: CreateWorkflowExecutionServiceOptions = {}): WorkflowExecutionService {
  if (options.implementation !== undefined) {
    return options.implementation;
  }
  return new InMemoryWorkflowExecutionService(options);
}

class InMemoryWorkflowExecutionService implements WorkflowExecutionService {
  private readonly resolveRecipeDefinition: WorkflowExecutionServiceFactoryOptions['resolveRecipeDefinition'];
  private readonly nodeCatalog: WorkflowNodeCatalog;
  private readonly emitEvent: NonNullable<CreateWorkflowExecutionServiceOptions['emitEvent']>;
  private readonly now: NonNullable<CreateWorkflowExecutionServiceOptions['now']>;
  private readonly createExecutionId: NonNullable<CreateWorkflowExecutionServiceOptions['createExecutionId']>;
  private readonly createNodeExecutionId: NonNullable<CreateWorkflowExecutionServiceOptions['createNodeExecutionId']>;
  private readonly resolveSecretReference: CreateWorkflowExecutionServiceOptions['resolveSecretReference'];
  private readonly executionCorrelation: CreateWorkflowExecutionServiceOptions['executionCorrelation'];
  constructor(options: CreateWorkflowExecutionServiceOptions) {
    this.resolveRecipeDefinition =
      options.resolveRecipeDefinition ??
      (() => {
        throw new AgentError({
          code: 'WORKFLOW_RECIPE_RESOLVER_MISSING',
          message: 'Workflow execution requires a trusted recipe resolver.',
          category: 'UNAVAILABLE',
          retryable: false,
          safeDetails: { reasonCode: 'WORKFLOW_RECIPE_RESOLVER_MISSING' },
        });
      });
    this.nodeCatalog =
      options.nodeCatalog === undefined
        ? defaultWorkflowNodeCatalog
        : {
            handlers: Object.freeze({
              ...defaultWorkflowNodeCatalog.handlers,
              ...options.nodeCatalog.handlers,
            }),
          };
    this.emitEvent = options.emitEvent ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.createExecutionId = options.createExecutionId ?? (() => `workflow-${randomUUID()}`);
    this.createNodeExecutionId = options.createNodeExecutionId ?? (() => `node-${randomUUID()}`);
    this.resolveSecretReference = options.resolveSecretReference;
    this.executionCorrelation = options.executionCorrelation;
  }

  async execute(
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    observer?: WorkflowExecutionObserver,
    runtime?: WorkflowExecutionRuntime,
  ): Promise<WorkflowExecutionResult> {
    const startedAt = this.now();
    const executionId = this.createExecutionId();
    const recipe = this.resolveRecipeDefinition(request);
    if (recipe.version !== request.recipeVersion) {
      throw new AgentError({
        code: 'WORKFLOW_RECIPE_VERSION_MISMATCH',
        message: 'Workflow recipe version does not match the accepted route binding.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_RECIPE_VERSION_MISMATCH', recipeName: request.recipeName },
      });
    }

    workflowExecutionLogger.info({
      event: 'workflow.execution.started',
      executionId,
      recipeName: recipe.recipeName,
      runId: request.runId,
      startedAtEpochMs: startedAt.getTime(),
    });

    const recipeObserver = observer as WorkflowRecipeAwareObserver | undefined;
    // Safe cast: WorkflowExecutionObserver (frozen contract) is widened to
    // WorkflowRecipeAwareObserver only when the caller provides one (e.g.
    // createTimelineObserver). registerExecutionRecipe is optional, so a
    // plain observer silently no-ops without breaking the contract.
    recipeObserver?.registerExecutionRecipe?.(executionId, recipe);

    const nodeResults: WorkflowNodeResult[] = [];
    const resumeState = parseWorkflowResumeState(request.resumeState);
    if (resumeState !== undefined && resumeState.recipeName !== recipe.recipeName) {
      throw new AgentError({
        code: 'WORKFLOW_RESUME_RECIPE_MISMATCH',
        message: 'Workflow resume state recipeName does not match the resolved recipe.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_RESUME_RECIPE_MISMATCH', expected: recipe.recipeName, actual: resumeState.recipeName },
      });
    }
    const entryNodeId = resumeState?.nodeId ?? resolveEntryNodeId(recipe);
    const recipeTimeoutS = recipe.runtime?.timeout;
    const recipeSignal = createScopedAbortSignal(signal, recipeTimeoutS === undefined ? undefined : recipeTimeoutS * 1000);
    try {
      let path = await this.executePath({
        executionId,
        request,
        recipe,
        currentNodeId: entryNodeId,
        variables: resumeState?.variables ?? initializeVariables(request),
        nodeResults,
        signal: recipeSignal.signal,
        ...(runtime === undefined ? {} : { runtime }),
        ...(observer === undefined ? {} : { observer }),
        ...(resumeState === undefined ? {} : { resumeState }),
      });
      if (path.state === 'INTERRUPTED' && recipeSignal.signal.aborted) {
        workflowExecutionLogger.info({
          event: 'workflow.cancel_detected',
          executionId,
          recipeName: recipe.recipeName,
          reasonCode: 'WORKFLOW_CANCEL_SIGNAL_RECEIVED',
        });
        path = await this.applyCancelPolicy({
          recipe,
          variables: path.variables,
          nodeResults,
          executionId,
          request,
          ...(runtime === undefined ? {} : { runtime }),
          ...(observer === undefined ? {} : { observer }),
        });
      }
      return {
        executionId,
        status:
          path.state === 'FAILED' ? 'FAILED' : path.state === 'INTERRUPTED' ? 'INTERRUPTED' : path.state === 'WAITING' ? 'WAITING' : 'COMPLETED',
        outputVariables: path.variables,
        nodeResults,
        startedAt,
        completedAt: this.now(),
        ...(path.pendingInput === undefined ? {} : { pendingInput: workflowPendingInputRequestToJson(path.pendingInput) }),
      };
    } finally {
      recipeSignal.dispose();
    }
  }

  private async executePath(input: {
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly recipe: RecipeDefinition;
    readonly currentNodeId: string;
    readonly variables: JsonObject;
    readonly nodeResults: WorkflowNodeResult[];
    readonly signal: AbortSignal;
    readonly runtime?: WorkflowExecutionRuntime;
    readonly observer?: WorkflowExecutionObserver;
    readonly stopBeforeNodeId?: string;
    readonly resumeState?: WorkflowExecutionResumeState;
    readonly skipCheckpoint?: boolean;
    readonly rollbackMode?: boolean;
    readonly loopContext?: WorkflowLoopContext;
    readonly predecessorNodeExecutionIds?: readonly string[];
  }): Promise<WorkflowPathResult> {
    let currentNodeId: string | undefined = input.currentNodeId;
    let variables = input.variables;
    let predecessorNodeExecutionIds = input.predecessorNodeExecutionIds ?? [];
    while (currentNodeId !== undefined) {
      if (input.signal.aborted) {
        return { state: 'INTERRUPTED', variables };
      }
      if (input.stopBeforeNodeId !== undefined && currentNodeId === input.stopBeforeNodeId) {
        return { state: 'COMPLETED', variables, nextNodeId: currentNodeId, predecessorNodeExecutionIds };
      }
      const node = requireNode(input.recipe, currentNodeId);
      if (node.loopConfig !== undefined && node.loopConfig.loopEndNode === currentNodeId && input.loopContext === undefined) {
        const loopOutcome = await this.executeLoopPath({
          executionId: input.executionId,
          request: input.request,
          recipe: input.recipe,
          loopEndNode: node,
          loopEndNodeId: currentNodeId,
          variables,
          nodeResults: input.nodeResults,
          signal: input.signal,
          ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
          ...(input.observer === undefined ? {} : { observer: input.observer }),
          predecessorNodeExecutionIds,
        });
        if (loopOutcome.state === 'COMPLETED' && loopOutcome.nextNodeId !== undefined) {
          if (input.stopBeforeNodeId !== undefined && loopOutcome.nextNodeId === input.stopBeforeNodeId) {
            return {
              state: 'COMPLETED',
              variables: loopOutcome.variables,
              nextNodeId: loopOutcome.nextNodeId,
              ...(loopOutcome.predecessorNodeExecutionIds === undefined
                ? {}
                : { predecessorNodeExecutionIds: loopOutcome.predecessorNodeExecutionIds }),
            };
          }
          currentNodeId = loopOutcome.nextNodeId;
          variables = loopOutcome.variables;
          predecessorNodeExecutionIds = loopOutcome.predecessorNodeExecutionIds ?? predecessorNodeExecutionIds;
          continue;
        }
        return {
          state: loopOutcome.state,
          variables: loopOutcome.variables,
          ...(loopOutcome.predecessorNodeExecutionIds === undefined ? {} : { predecessorNodeExecutionIds: loopOutcome.predecessorNodeExecutionIds }),
        };
      }
      assertDependenciesSatisfied(input.recipe, currentNodeId, node, input.nodeResults);
      const execution = await this.executeNode({
        executionId: input.executionId,
        request: input.request,
        recipe: input.recipe,
        nodeId: currentNodeId,
        node,
        variables,
        signal: input.signal,
        ...(input.resumeState === undefined ? {} : { resumeState: input.resumeState }),
        ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
        ...(input.observer === undefined ? {} : { observer: input.observer }),
        predecessorNodeExecutionIds,
        ...(input.rollbackMode === true ? { rollbackMode: true } : {}),
      });
      input.nodeResults.push(execution.nodeResult);
      variables = mergeVariables(variables, execution.outputVariables);
      if (execution.nodeExecutionId !== undefined) {
        predecessorNodeExecutionIds = [execution.nodeExecutionId];
      }
      if (input.skipCheckpoint !== true) {
        await this.saveNodeCheckpoint({
          executionId: input.executionId,
          request: input.request,
          recipe: input.recipe,
          nodeId: currentNodeId,
          node,
          variables,
          ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
          ...(input.observer === undefined ? {} : { observer: input.observer }),
          ...(input.loopContext === undefined ? {} : { loopContext: input.loopContext }),
        });
      }
      if (execution.pendingInput !== undefined) {
        return { state: 'WAITING', variables, pendingInput: execution.pendingInput, predecessorNodeExecutionIds };
      }
      if (execution.terminalState !== undefined) {
        return { state: execution.terminalState, variables, predecessorNodeExecutionIds };
      }
      if (input.signal.aborted) {
        return { state: 'INTERRUPTED', variables };
      }
      const transition = execution.transition;
      const nextStep = await this.resolvePathTransition({
        ...input,
        variables,
        transition,
        predecessorNodeExecutionIds,
      });
      if (nextStep.pathResult !== undefined) {
        return nextStep.pathResult;
      }
      variables = nextStep.variables;
      currentNodeId = nextStep.nextNodeId;
      predecessorNodeExecutionIds = nextStep.predecessorNodeExecutionIds ?? predecessorNodeExecutionIds;
    }
    return { state: 'TERMINAL', variables, predecessorNodeExecutionIds };
  }

  private async resolvePathTransition(input: {
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly recipe: RecipeDefinition;
    readonly variables: JsonObject;
    readonly nodeResults: WorkflowNodeResult[];
    readonly signal: AbortSignal;
    readonly runtime?: {
      requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject>;
    };
    readonly observer?: WorkflowExecutionObserver;
    readonly stopBeforeNodeId?: string;
    readonly resumeState?: WorkflowExecutionResumeState;
    readonly transition: WorkflowNodeTransition;
    readonly predecessorNodeExecutionIds: readonly string[];
  }): Promise<{
    readonly variables: JsonObject;
    readonly nextNodeId?: string;
    readonly pathResult?: WorkflowPathResult;
    readonly predecessorNodeExecutionIds?: readonly string[];
  }> {
    const transition = input.transition;
    switch (transition.kind) {
      case 'TERMINAL':
        return { variables: input.variables, pathResult: { state: 'TERMINAL', variables: input.variables } };
      case 'CONTINUE':
      case 'BRANCH': {
        const linear = resolveLinearTransition(input.variables, transition.nextNodeId, input.stopBeforeNodeId);
        return {
          ...linear,
          ...(linear.pathResult === undefined
            ? {}
            : {
                pathResult: {
                  ...linear.pathResult,
                  predecessorNodeExecutionIds: input.predecessorNodeExecutionIds,
                },
              }),
          predecessorNodeExecutionIds: input.predecessorNodeExecutionIds,
        };
      }
      case 'FORK_JOIN': {
        const forkJoin = await this.executeConcurrentForkJoin({
          ...input,
          branchNodeIds: transition.branchNodeIds,
          joinNodeId: transition.joinNodeId,
          joinOnFailure: transition.joinOnFailure ?? 'wait',
          ...(transition.joinTimeout === undefined ? {} : { joinTimeout: transition.joinTimeout }),
        });
        if (forkJoin.state !== 'COMPLETED') {
          return { variables: forkJoin.variables, pathResult: forkJoin };
        }
        return forkJoin.nextNodeId === undefined
          ? {
              variables: forkJoin.variables,
              ...(forkJoin.predecessorNodeExecutionIds === undefined ? {} : { predecessorNodeExecutionIds: forkJoin.predecessorNodeExecutionIds }),
            }
          : {
              variables: forkJoin.variables,
              nextNodeId: forkJoin.nextNodeId,
              ...(forkJoin.predecessorNodeExecutionIds === undefined ? {} : { predecessorNodeExecutionIds: forkJoin.predecessorNodeExecutionIds }),
            };
      }
      default:
        return assertUnreachableTransition(transition);
    }
  }

  private async executeConcurrentForkJoin(input: {
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly recipe: RecipeDefinition;
    readonly variables: JsonObject;
    readonly nodeResults: WorkflowNodeResult[];
    readonly signal: AbortSignal;
    readonly branchNodeIds: readonly string[];
    readonly joinNodeId: string;
    readonly joinOnFailure: 'break' | 'wait';
    readonly joinTimeout?: number;
    readonly runtime?: WorkflowExecutionRuntime;
    readonly observer?: WorkflowExecutionObserver;
    readonly resumeState?: WorkflowExecutionResumeState;
    readonly predecessorNodeExecutionIds: readonly string[];
  }): Promise<WorkflowPathResult> {
    // Concurrent fan-out/fan-in: all selected branches start simultaneously with the same
    // input variables. Outputs are merged in branch-declaration order after all branches settle.
    const branchController = new AbortController();
    const onParentAbort = () => branchController.abort();
    input.signal.addEventListener('abort', onParentAbort, { once: true });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (input.joinTimeout !== undefined) {
      timeoutHandle = setTimeout(() => branchController.abort(), input.joinTimeout);
    }

    try {
      const branchResults: Array<WorkflowPathResult | null> = new Array(input.branchNodeIds.length).fill(null);
      let failureCount = 0;

      const branchPromises = input.branchNodeIds.map(async (branchNodeId, index) => {
        try {
          const result = await this.executePath({
            executionId: input.executionId,
            request: input.request,
            recipe: input.recipe,
            currentNodeId: branchNodeId,
            variables: input.variables,
            nodeResults: input.nodeResults,
            signal: branchController.signal,
            stopBeforeNodeId: input.joinNodeId,
            ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
            ...(input.observer === undefined ? {} : { observer: input.observer }),
            ...(input.resumeState === undefined ? {} : { resumeState: input.resumeState }),
            predecessorNodeExecutionIds: input.predecessorNodeExecutionIds,
          });
          branchResults[index] = result;
          if (result.state !== 'COMPLETED' || result.nextNodeId !== input.joinNodeId) {
            failureCount += 1;
            if (input.joinOnFailure === 'break') {
              branchController.abort();
            }
          }
        } catch {
          failureCount += 1;
          if (input.joinOnFailure === 'break') {
            branchController.abort();
          }
        }
      });

      await Promise.allSettled(branchPromises);

      let mergedVariables = input.variables;
      for (const result of branchResults) {
        if (result !== null) {
          mergedVariables = mergeVariables(mergedVariables, result.variables);
        }
      }
      // break: any branch failure aborts the rest and fails the whole fork/join.
      // wait: tolerate partial failure; the fork/join is COMPLETED when at least one branch
      // reached the join node, and only FAILED when every branch failed.
      if (failureCount > 0 && (input.joinOnFailure === 'break' || failureCount >= input.branchNodeIds.length)) {
        return { state: 'FAILED', variables: mergedVariables };
      }
      return {
        state: 'COMPLETED',
        variables: mergedVariables,
        nextNodeId: input.joinNodeId,
        predecessorNodeExecutionIds: branchResults.flatMap((result) => result?.predecessorNodeExecutionIds ?? []),
      };
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      input.signal.removeEventListener('abort', onParentAbort);
    }
  }

  private async executeNode(input: {
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly recipe: RecipeDefinition;
    readonly nodeId: string;
    readonly node: WorkflowNodeDef;
    readonly variables: JsonObject;
    readonly signal: AbortSignal;
    readonly runtime?: {
      requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject>;
    };
    readonly observer?: WorkflowExecutionObserver;
    readonly resumeState?: WorkflowExecutionResumeState;
    readonly predecessorNodeExecutionIds: readonly string[];
    readonly rollbackMode?: boolean;
  }): Promise<{
    readonly nodeResult: WorkflowNodeResult;
    readonly transition: WorkflowNodeTransition;
    readonly outputVariables: JsonObject;
    readonly pendingInput?: WorkflowPendingInputRequest;
    readonly terminalState?: 'FAILED' | 'INTERRUPTED';
    readonly nodeExecutionId?: string;
  }> {
    const gatewayNode = isGatewayNodeType(input.node.type);
    const retryPolicy = gatewayNode
      ? { maxRetries: 0 }
      : (resolveWorkflowRetryPolicy(input.node.retry, input.node.retryPolicy, input.recipe.runtime?.defaultRetry) ?? { maxRetries: 0 });
    let attempt = 0;
    let attemptPredecessors = input.predecessorNodeExecutionIds;
    let hasEmittedDelta = false;
    while (true) {
      attempt += 1;
      hasEmittedDelta = false;
      const startedAt = this.now();
      const nodeExecutionId = isWorkflowScaffold(input.node.type) ? undefined : this.createNodeExecutionId();
      const correlationFields = nodeExecutionId === undefined ? {} : { nodeExecutionId, predecessorNodeExecutionIds: attemptPredecessors };
      const safeInput = await this.resolveSafeNodeInput(input.node, input.variables);
      workflowExecutionLogger.debug(
        {
          event: 'workflow.node.started',
          executionId: input.executionId,
          nodeId: input.nodeId,
          nodeType: input.node.type,
          attempt,
          ...(safeInput === undefined ? {} : { inputKeys: Object.keys(safeInput) }),
        },
        'Workflow node started.',
      );
      if (input.node.type !== 'END') {
        await this.emitWorkflowEvent(
          {
            executionId: input.executionId,
            nodeId: input.nodeId,
            nodeType: input.node.type,
            eventType: 'NODE_STARTED',
            ...correlationFields,
            retryCount: attempt - 1,
            startedAt,
            ...(safeInput === undefined ? {} : { input: safeInput }),
          },
          input.observer,
        );
      }
      const nodeTimeoutS = gatewayNode ? undefined : input.node.timeout;
      const nodeSignal = createScopedAbortSignal(input.signal, nodeTimeoutS === undefined ? undefined : nodeTimeoutS * 1000);
      try {
        const handler = this.nodeCatalog.handlers[input.node.type];
        const invokeHandler = async () =>
          handler?.({
            executionId: input.executionId,
            request: input.request,
            recipe: input.recipe,
            nodeId: input.nodeId,
            ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
            node: input.node,
            variables: input.variables,
            attempt,
            signal: nodeSignal.signal,
            ...(input.observer === undefined ? {} : { observer: input.observer }),
            ...(input.resumeState === undefined ? {} : { resumeState: input.resumeState }),
            ...(input.runtime === undefined
              ? {}
              : {
                  requestPendingInput: async (request, activationSignal) => {
                    const pendingInput = parseWorkflowPendingInputRequest(
                      await input.runtime!.requestPendingInput(workflowPendingInputActivationToJson(request), activationSignal),
                    );
                    if (pendingInput === undefined) {
                      throw new AgentError({
                        code: 'WORKFLOW_PENDING_INPUT_BRIDGE_INVALID',
                        message: 'Workflow pending input bridge returned an invalid payload.',
                        category: 'INTERNAL',
                        retryable: false,
                        safeDetails: { reasonCode: 'WORKFLOW_PENDING_INPUT_BRIDGE_INVALID', nodeId: input.nodeId },
                      });
                    }
                    return pendingInput;
                  },
                }),
            emitOutputDelta: async (delta) => {
              hasEmittedDelta = true;
              const resolvedLevel = delta.level ?? (input.nodeId === resolveSubRecipeAnswerNodeId(input.recipe.flowGraph) ? 'ANSWER' : 'DETAIL');
              await this.emitNodeOutputDelta(input, startedAt, attempt - 1, { ...delta, level: resolvedLevel }, correlationFields);
            },
          });
        const outcome =
          nodeExecutionId === undefined || this.executionCorrelation === undefined
            ? await invokeHandler()
            : await this.executionCorrelation.withExecutionRef(
                {
                  requestRunId: input.request.runId,
                  kind: 'WORKFLOW_NODE',
                  executionId: nodeExecutionId,
                },
                invokeHandler,
              );
        const outputVariables = outcome?.outputVariables ?? {};
        if (
          !gatewayNode &&
          !hasEmittedDelta &&
          isRecord(outputVariables) &&
          Object.keys(outputVariables).length > 0 &&
          !hasObjectOutputParserData(outputVariables.output_parser)
        ) {
          const formatted = formatOutputValues(outputVariables);
          if (formatted.length > 0) {
            const resolvedLevel = input.nodeId === resolveSubRecipeAnswerNodeId(input.recipe.flowGraph) ? 'ANSWER' : 'DETAIL';
            await this.emitNodeOutputDelta(
              input,
              startedAt,
              attempt - 1,
              { channel: 'CONTENT', content: formatted, level: resolvedLevel },
              correlationFields,
            );
          }
        }
        const isWaiting = outcome?.pendingInput !== undefined;
        // A waiting node has not produced the user answer required by conditional
        // branches yet. Defer transition resolution until the resumed execution,
        // otherwise user-check nodes with approve/reject branches fail before the
        // frontend can render the pending-input controls.
        const transition: WorkflowNodeTransition = isWaiting
          ? { kind: 'CONTINUE' }
          : normalizeTransition(input.node, outcome, mergeVariables(input.variables, outputVariables));
        const status = outcome?.status ?? (isWaiting ? 'NODE_WAITING' : 'NODE_COMPLETED');
        // A node handler may signal a soft failure by returning
        // status 'NODE_FAILED' (e.g. batch abort). Treat this as a
        // terminal failure so the workflow path resolves to FAILED,
        // rather than continuing past the node as if it completed.
        if (status === 'NODE_FAILED') {
          const completedAt = this.now();
          const safeError = new AgentError({
            code: 'WORKFLOW_NODE_FAILED',
            message: 'Workflow node signalled failure.',
            category: 'INTERNAL',
            retryable: false,
            safeDetails: { reasonCode: 'WORKFLOW_NODE_FAILED', nodeId: input.nodeId, nodeType: input.node.type },
          });
          const nodeResult: WorkflowNodeResult = {
            nodeId: input.nodeId,
            nodeType: input.node.type,
            status,
            ...(!gatewayNode && !isEmptyObject(outputVariables) ? { output: outputVariables } : {}),
            retryCount: attempt - 1,
            startedAt,
            completedAt,
            safeError,
          };
          await this.emitWorkflowEvent(
            {
              executionId: input.executionId,
              nodeId: input.nodeId,
              nodeType: input.node.type,
              eventType: 'NODE_FAILED',
              ...correlationFields,
              safeError,
              retryCount: attempt - 1,
              startedAt,
              completedAt,
            },
            input.observer,
          );
          return {
            nodeResult,
            transition: { kind: 'TERMINAL' },
            outputVariables,
            ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
            terminalState: 'FAILED',
          };
        }
        workflowExecutionLogger.debug(
          {
            event: 'workflow.node.completed',
            executionId: input.executionId,
            nodeId: input.nodeId,
            nodeType: input.node.type,
            attempt,
            status,
            outputKeys: Object.keys(outputVariables),
          },
          'Workflow node completed.',
        );
        const diagnostic = outcome?.diagnostic;
        const completedAt = this.now();
        const nodeResult: WorkflowNodeResult = {
          nodeId: input.nodeId,
          nodeType: input.node.type,
          status,
          ...(!gatewayNode && !isEmptyObject(outputVariables) ? { output: outputVariables } : {}),
          retryCount: attempt - 1,
          startedAt,
          completedAt,
        };
        if (input.node.type !== 'START') {
          await this.emitWorkflowEvent(
            {
              executionId: input.executionId,
              nodeId: input.nodeId,
              nodeType: input.node.type,
              eventType: status === 'NODE_SKIPPED' ? 'NODE_SKIPPED' : status === 'NODE_WAITING' ? 'NODE_WAITING' : 'NODE_COMPLETED',
              ...correlationFields,
              ...(!gatewayNode && !isEmptyObject(outputVariables) ? { output: outputVariables } : {}),
              ...(diagnostic === undefined ? {} : { diagnostic }),
              retryCount: attempt - 1,
              startedAt,
              completedAt,
            },
            input.observer,
          );
        }
        return {
          nodeResult,
          transition,
          outputVariables,
          ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
          ...(outcome?.pendingInput === undefined ? {} : { pendingInput: outcome.pendingInput }),
        };
      } catch (error) {
        const safeError = toSafeError(
          error,
          nodeSignal.didTimeout ? 'Workflow node timed out safely.' : 'Workflow node failed safely.',
          nodeSignal.didTimeout,
        );
        const errorDescription = describeNodeError(error);
        workflowExecutionLogger.error(
          {
            event: 'workflow.node.failed',
            executionId: input.executionId,
            nodeId: input.nodeId,
            nodeType: input.node.type,
            attempt,
            didTimeout: nodeSignal.didTimeout,
            ...(safeInput === undefined ? {} : { inputKeys: Object.keys(safeInput) }),
            ...errorDescription,
          },
          'Workflow node failed.',
        );
        nodeSignal.dispose();
        const completedAt = this.now();
        await this.emitWorkflowEvent(
          {
            executionId: input.executionId,
            nodeId: input.nodeId,
            nodeType: input.node.type,
            eventType: 'NODE_FAILED',
            ...correlationFields,
            safeError,
            retryCount: attempt - 1,
            startedAt,
            completedAt,
          },
          input.observer,
        );
        const nodeResult: WorkflowNodeResult = {
          nodeId: input.nodeId,
          nodeType: input.node.type,
          status: 'NODE_FAILED',
          safeError,
          retryCount: attempt - 1,
          startedAt,
          completedAt,
        };
        if (isAbortError(error) && !nodeSignal.didTimeout) {
          return {
            nodeResult,
            transition: { kind: 'TERMINAL' },
            outputVariables: {},
            ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
            terminalState: 'INTERRUPTED',
          };
        }
        const isCapabilityFailure = isCapabilityNodeExecutionError(error);
        if (shouldRetry(error, attempt, retryPolicy, nodeSignal.didTimeout) && !isCapabilityFailure) {
          if (nodeExecutionId !== undefined) {
            attemptPredecessors = [nodeExecutionId];
          }
          await delay((retryPolicy.delay ?? 0) * 1000, input.signal);
          continue;
        }
        if (input.rollbackMode === true && isCapabilityFailure) {
          return {
            nodeResult,
            transition: { kind: 'TERMINAL' },
            outputVariables: {},
            ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
            terminalState: 'FAILED',
          };
        }
        const exceptionVariables = mapSafeErrorToVariables(input.variables, safeError);
        const exceptionTransition = resolveErrorTransition(input.node, exceptionVariables);
        if (exceptionTransition !== undefined) {
          return {
            nodeResult,
            transition: exceptionTransition,
            outputVariables: {},
            ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
          };
        }
        return {
          nodeResult,
          transition: { kind: 'TERMINAL' },
          outputVariables: {},
          ...(nodeExecutionId === undefined ? {} : { nodeExecutionId }),
          terminalState: 'FAILED',
        };
      } finally {
        nodeSignal.dispose();
      }
    }
  }

  private async emitNodeOutputDelta(
    input: {
      readonly executionId: string;
      readonly nodeId: string;
      readonly node: WorkflowNodeDef;
      readonly observer?: WorkflowExecutionObserver;
    },
    startedAt: Date,
    retryCount: number,
    delta: WorkflowVisibleDelta,
    correlationFields: {
      readonly nodeExecutionId?: string;
      readonly predecessorNodeExecutionIds?: readonly string[];
    },
  ): Promise<void> {
    if (delta.content.length === 0) {
      return;
    }
    await this.emitWorkflowEvent(
      {
        executionId: input.executionId,
        nodeId: input.nodeId,
        nodeType: input.node.type,
        eventType: 'NODE_OUTPUT_DELTA',
        ...correlationFields,
        visibleDelta: delta,
        retryCount,
        startedAt,
      },
      input.observer,
    );
  }

  private async executeLoopPath(input: {
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly recipe: RecipeDefinition;
    readonly loopEndNode: WorkflowNodeDef;
    readonly loopEndNodeId: string;
    readonly variables: JsonObject;
    readonly nodeResults: WorkflowNodeResult[];
    readonly signal: AbortSignal;
    readonly runtime?: WorkflowExecutionRuntime;
    readonly observer?: WorkflowExecutionObserver;
    readonly predecessorNodeExecutionIds: readonly string[];
  }): Promise<WorkflowPathResult> {
    const loopConfig = input.loopEndNode.loopConfig;
    if (loopConfig === undefined) {
      return { state: 'COMPLETED', variables: input.variables };
    }
    const loopStartNode = loopConfig.loopStartNode;
    if (loopStartNode === undefined) {
      return { state: 'FAILED', variables: input.variables };
    }
    let variables = input.variables;
    let predecessorNodeExecutionIds = input.predecessorNodeExecutionIds;
    const hasCondition = loopConfig.loopCompletionCondition !== undefined;
    const hasDataItem = loopConfig.loopInputDataItem !== undefined;
    const maxIterations = loopConfig.loopCardinality ?? (hasCondition || hasDataItem ? 1000 : 1);
    const dataItem = hasDataItem ? resolveNodeValue(loopConfig.loopInputDataItem, variables) : undefined;
    if (hasDataItem && !Array.isArray(dataItem)) {
      await this.emitWorkflowEvent(
        {
          executionId: input.executionId,
          nodeId: input.loopEndNodeId,
          nodeType: input.loopEndNode.type,
          eventType: 'NODE_FAILED',
          retryCount: 0,
          startedAt: this.now(),
          diagnostic: { reasonCode: 'WORKFLOW_LOOP_INPUT_NOT_ARRAY' },
        },
        input.observer,
      );
      return { state: 'FAILED', variables };
    }
    const dataArray = Array.isArray(dataItem) ? (dataItem as readonly unknown[]) : undefined;
    const effectiveMax = hasDataItem ? (dataArray?.length ?? 0) : maxIterations;
    const collectedResults: unknown[] = [];
    let iteration = 0;
    while (iteration < effectiveMax) {
      if (input.signal.aborted) {
        return { state: 'INTERRUPTED', variables };
      }
      const elementIndex = iteration;
      if (hasDataItem && dataArray !== undefined && loopConfig.loopElementVariable !== undefined) {
        variables = { ...variables, [loopConfig.loopElementVariable]: dataArray[elementIndex] } as JsonObject;
      }
      const loopContext: WorkflowLoopContext = {
        loopId: loopConfig.loopId ?? input.loopEndNodeId,
        iteration,
        elementIndex,
        collectedResults: collectedResults as readonly JsonValue[],
      };
      // When loopStartNode === loopEndNode (single-node self-loop), executeNode
      // is called directly instead of executePath. Otherwise executePath would
      // continue past the loop node into downstream nodes because there is no
      // stopBeforeNodeId to halt it (stopBeforeNodeId cannot equal the start
      // node, or executePath would return immediately without executing).
      if (loopStartNode === input.loopEndNodeId) {
        const loopNode = requireNode(input.recipe, loopStartNode);
        const nodeExecution = await this.executeNode({
          executionId: input.executionId,
          request: input.request,
          recipe: input.recipe,
          nodeId: loopStartNode,
          node: loopNode,
          variables,
          signal: input.signal,
          ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
          ...(input.observer === undefined ? {} : { observer: input.observer }),
          predecessorNodeExecutionIds,
        });
        input.nodeResults.push(nodeExecution.nodeResult);
        variables = mergeVariables(variables, nodeExecution.outputVariables);
        if (nodeExecution.nodeExecutionId !== undefined) {
          predecessorNodeExecutionIds = [nodeExecution.nodeExecutionId];
        }
        await this.saveNodeCheckpoint({
          executionId: input.executionId,
          request: input.request,
          recipe: input.recipe,
          nodeId: loopStartNode,
          node: loopNode,
          variables,
          ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
          ...(input.observer === undefined ? {} : { observer: input.observer }),
          loopContext,
        });
        if (nodeExecution.pendingInput !== undefined) {
          return { state: 'WAITING', variables, pendingInput: nodeExecution.pendingInput, predecessorNodeExecutionIds };
        }
        if (nodeExecution.terminalState !== undefined) {
          return { state: nodeExecution.terminalState, variables, predecessorNodeExecutionIds };
        }
        if (input.signal.aborted) {
          return { state: 'INTERRUPTED', variables };
        }
      } else {
        const loopBody = await this.executePath({
          executionId: input.executionId,
          request: input.request,
          recipe: input.recipe,
          currentNodeId: loopStartNode,
          variables,
          nodeResults: input.nodeResults,
          signal: input.signal,
          ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
          ...(input.observer === undefined ? {} : { observer: input.observer }),
          stopBeforeNodeId: input.loopEndNodeId,
          loopContext,
          predecessorNodeExecutionIds,
        });
        variables = loopBody.variables;
        predecessorNodeExecutionIds = loopBody.predecessorNodeExecutionIds ?? predecessorNodeExecutionIds;
        if (loopBody.state === 'FAILED' || loopBody.state === 'INTERRUPTED') {
          return { state: loopBody.state, variables };
        }
      }
      this.collectLoopResult(loopConfig, variables, collectedResults, dataArray, elementIndex);
      iteration += 1;
      if (hasCondition && loopConfig.loopCompletionCondition !== undefined) {
        try {
          if (evaluateBranchCondition(loopConfig.loopCompletionCondition, variables)) {
            break;
          }
        } catch {
          await this.emitWorkflowEvent(
            {
              executionId: input.executionId,
              nodeId: input.loopEndNodeId,
              nodeType: input.loopEndNode.type,
              eventType: 'NODE_FAILED',
              retryCount: 0,
              startedAt: this.now(),
              diagnostic: { reasonCode: 'WORKFLOW_LOOP_CONDITION_INVALID' },
            },
            input.observer,
          );
          return { state: 'FAILED', variables };
        }
      }
      if (loopConfig.loopTimeCycle !== undefined && loopConfig.loopTimeCycle > 0 && iteration < effectiveMax) {
        await delay(loopConfig.loopTimeCycle, input.signal);
        if (input.signal.aborted) {
          return { state: 'INTERRUPTED', variables };
        }
      }
    }
    if (loopConfig.loopResultVariable !== undefined) {
      const merged =
        loopConfig.loopResultType === 'Map'
          ? Object.fromEntries(
              collectedResults.map((entry) => {
                const e = entry as { key: string; value: unknown };
                return [String(e.key), e.value];
              }),
            )
          : collectedResults;
      variables = { ...variables, [loopConfig.loopResultVariable]: merged } as JsonObject;
    }
    const nextNodeId = resolveContinueNodeId(input.loopEndNode);
    if (nextNodeId === undefined) {
      return { state: 'TERMINAL', variables, predecessorNodeExecutionIds };
    }
    return { state: 'COMPLETED', variables, nextNodeId, predecessorNodeExecutionIds };
  }

  private collectLoopResult(
    loopConfig: NonNullable<WorkflowNodeDef['loopConfig']>,
    variables: JsonObject,
    collectedResults: unknown[],
    dataArray: readonly unknown[] | undefined,
    elementIndex: number,
  ): void {
    if (loopConfig.loopResultVariable === undefined) {
      return;
    }
    const resultValue = loopConfig.loopResultValue !== undefined ? resolveNodeValue(loopConfig.loopResultValue, variables) : variables;
    if (loopConfig.loopResultType === 'Map') {
      const elementVariable = loopConfig.loopElementVariable ?? 'item';
      const elementValue = dataArray !== undefined ? dataArray[elementIndex] : undefined;
      const key =
        loopConfig.loopResultKey !== undefined
          ? resolveNodeValue(loopConfig.loopResultKey, { ...variables, [elementVariable]: elementValue } as JsonObject)
          : String(elementIndex);
      collectedResults.push({ key, value: resultValue });
    } else {
      collectedResults.push(resultValue);
    }
  }

  private async applyCancelPolicy(input: {
    readonly recipe: RecipeDefinition;
    readonly variables: JsonObject;
    readonly nodeResults: WorkflowNodeResult[];
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly runtime?: WorkflowExecutionRuntime;
    readonly observer?: WorkflowExecutionObserver;
  }): Promise<WorkflowPathResult> {
    const controlPolicy = input.recipe.runtime?.controlPolicy;
    const cancel = controlPolicy?.cancel;
    const entries = cancel?.rollbackNode === undefined ? [] : Object.entries(cancel.rollbackNode);
    if (entries.length === 0) {
      workflowExecutionLogger.info({
        event: 'workflow.cancel_no_rollback',
        executionId: input.executionId,
        recipeName: input.recipe.recipeName,
        reasonCode: 'WORKFLOW_CANCEL_NO_ROLLBACK_NODE',
      });
      return { state: 'INTERRUPTED', variables: input.variables };
    }
    const rollbackNodeId = entries[0]![0];
    const cancelTimeoutS = controlPolicy?.cancelTimeout;
    const rollbackController = new AbortController();
    let rollbackTimeout: ReturnType<typeof setTimeout> | undefined;
    if (cancelTimeoutS !== undefined) {
      rollbackTimeout = setTimeout(() => rollbackController.abort(), cancelTimeoutS * 1000);
    }
    try {
      workflowExecutionLogger.info({
        event: 'workflow.cancel_rollback_started',
        executionId: input.executionId,
        recipeName: input.recipe.recipeName,
        rollbackNodeId,
        ...(cancelTimeoutS === undefined ? {} : { cancelTimeoutS }),
        reasonCode: 'WORKFLOW_CANCEL_ROLLBACK_ENTERING',
      });
      const rollbackResult = await this.executePath({
        executionId: input.executionId,
        request: input.request,
        recipe: input.recipe,
        currentNodeId: rollbackNodeId,
        variables: input.variables,
        nodeResults: input.nodeResults,
        signal: rollbackController.signal,
        ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
        ...(input.observer === undefined ? {} : { observer: input.observer }),
        skipCheckpoint: true,
        rollbackMode: true,
      });
      workflowExecutionLogger.info({
        event: 'workflow.cancel_rollback_completed',
        executionId: input.executionId,
        recipeName: input.recipe.recipeName,
        rollbackNodeId,
        rollbackPathState: rollbackResult.state,
        reasonCode: 'WORKFLOW_CANCEL_ROLLBACK_SUCCEEDED',
      });
      return { state: 'INTERRUPTED', variables: rollbackResult.variables };
    } catch {
      workflowExecutionLogger.warn({
        event: 'workflow.cancel_rollback_failed',
        executionId: input.executionId,
        recipeName: input.recipe.recipeName,
        rollbackNodeId,
        reasonCode: 'WORKFLOW_ROLLBACK_FAILED',
      });
      return { state: 'INTERRUPTED', variables: input.variables };
    } finally {
      if (rollbackTimeout !== undefined) {
        clearTimeout(rollbackTimeout);
      }
    }
  }

  private async saveNodeCheckpoint(input: {
    readonly executionId: string;
    readonly request: WorkflowExecutionRequest;
    readonly recipe: RecipeDefinition;
    readonly nodeId: string;
    readonly node: WorkflowNodeDef;
    readonly variables: JsonObject;
    readonly runtime?: WorkflowExecutionRuntime;
    readonly observer?: WorkflowExecutionObserver;
    readonly loopContext?: WorkflowLoopContext;
  }): Promise<void> {
    if (input.recipe.runtime?.persistence?.checkpoint !== true) {
      return;
    }
    if (input.runtime?.saveCheckpoint === undefined) {
      return;
    }
    if (isGatewayNodeType(input.node.type)) {
      return;
    }
    const resumeState: WorkflowExecutionResumeState = {
      executionId: input.executionId,
      recipeName: input.recipe.recipeName,
      nodeId: input.nodeId,
      nodeType: input.node.type,
      variables: input.variables,
      ...(input.loopContext === undefined ? {} : { loopContext: input.loopContext }),
    };
    try {
      await input.runtime.saveCheckpoint({ resumeState });
    } catch {
      await this.emitWorkflowEvent(
        {
          executionId: input.executionId,
          nodeId: input.nodeId,
          nodeType: input.node.type,
          eventType: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: this.now(),
          diagnostic: { reasonCode: 'WORKFLOW_CHECKPOINT_WRITE_FAILED' },
        },
        input.observer,
      );
    }
  }

  private async resolveSafeNodeInput(node: WorkflowNodeDef, variables: JsonObject): Promise<JsonObject | undefined> {
    const rawInputs = node.inputs;
    if (rawInputs === undefined || typeof rawInputs !== 'object' || Object.keys(rawInputs).length === 0) {
      return undefined;
    }
    try {
      const resolved = resolveNodeValue(rawInputs, variables);
      const resolvedSecretValues: string[] = [];
      const withSecrets = await resolveSecrets(resolved, this.resolveSecretReference, resolvedSecretValues);
      if (!isRecord(withSecrets)) {
        return undefined;
      }
      return redactSecretsFromValue(withSecrets as JsonObject, resolvedSecretValues);
    } catch {
      return undefined;
    }
  }

  private async emitWorkflowEvent(event: WorkflowExecutionEvent, observer?: WorkflowExecutionObserver): Promise<void> {
    await this.emitEvent(event);
    await observer?.emitEvent(event);
  }
}

function resolveLinearTransition(
  variables: JsonObject,
  nextNodeId?: string,
  stopBeforeNodeId?: string,
): {
  readonly variables: JsonObject;
  readonly nextNodeId?: string;
  readonly pathResult?: WorkflowPathResult;
} {
  if (nextNodeId === undefined) {
    return { variables, pathResult: { state: 'TERMINAL', variables } };
  }
  if (stopBeforeNodeId !== undefined && nextNodeId === stopBeforeNodeId) {
    return { variables, pathResult: { state: 'COMPLETED', variables, nextNodeId } };
  }
  return { variables, nextNodeId };
}

function resolveEntryNodeId(recipe: RecipeDefinition): string {
  const candidates = Object.entries(recipe.flowGraph.nodes)
    .filter(([, node]) => node.type === 'START')
    .map(([nodeId]) => nodeId);
  if (candidates.length !== 1) {
    throw new AgentError({
      code: 'WORKFLOW_ENTRY_NODE_UNRESOLVED',
      message: 'Workflow recipe must expose exactly one start-event safely.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_ENTRY_NODE_UNRESOLVED', recipeName: recipe.recipeName },
    });
  }
  return candidates[0]!;
}

function resolveContinueNodeId(node: WorkflowNodeDef): string | undefined {
  const entries = Object.entries(node.next ?? {}) as ReadonlyArray<readonly [string, unknown]>;
  if (entries.length === 0) {
    return undefined;
  }
  const first = entries[0];
  return first === undefined ? undefined : first[0];
}

function requireNode(recipe: RecipeDefinition, nodeId: string): WorkflowNodeDef {
  const node = recipe.flowGraph.nodes[nodeId];
  if (node === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_NODE_NOT_FOUND',
      message: 'Workflow graph references a missing node.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_NODE_NOT_FOUND', recipeName: recipe.recipeName, nodeId },
    });
  }
  return node;
}
function assertDependenciesSatisfied(
  recipe: RecipeDefinition,
  nodeId: string,
  node: WorkflowNodeDef,
  nodeResults: readonly WorkflowNodeResult[],
): void {
  const dependsOn = node.dependsOn;
  if (dependsOn === undefined || dependsOn.length === 0) {
    return;
  }
  for (const dependencyId of dependsOn) {
    const result = nodeResults.find((item) => item.nodeId === dependencyId);
    if (result === undefined || result.status !== 'NODE_COMPLETED') {
      throw new AgentError({
        code: 'WORKFLOW_DEPENDENCY_NOT_SATISFIED',
        message: 'Workflow node dependency has not completed.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_DEPENDENCY_NOT_SATISFIED', recipeName: recipe.recipeName, nodeId, dependencyId },
      });
    }
  }
}

function normalizeTransition(node: WorkflowNodeDef, outcome: WorkflowNodeHandlerResult | void, variables: JsonObject): WorkflowNodeTransition {
  return outcome?.transition ?? defaultTransition(node, variables);
}

function defaultTransition(node: WorkflowNodeDef, variables: JsonObject): WorkflowNodeTransition {
  const nextNodeIds = Object.keys(node.next ?? {});
  if (nextNodeIds.length === 0) {
    return { kind: 'TERMINAL' };
  }
  if (nextNodeIds.length === 1) {
    const nextNodeId = nextNodeIds[0];
    return nextNodeId === undefined ? { kind: 'CONTINUE' } : { kind: 'CONTINUE', nextNodeId };
  }
  return resolveWorkflowBranchTransition(node.type, Object.entries(node.next ?? {}), variables);
}

function mergeVariables(base: JsonObject, patch: JsonObject): JsonObject {
  // output_parser is control config injected by projectNodeOutputs for the
  // projector; it must NOT leak into downstream node variables.
  const { output_parser: _stripped, ...rest } = patch;
  return Object.freeze({ ...base, ...rest });
}
// Bridges the contract-level inputText into execution variables so existing
// nodes can keep reading variables.input_question without change. resumeState
// already carries input_question when resuming, so injection only happens on
// fresh executions.
function initializeVariables(request: WorkflowExecutionRequest): JsonObject {
  return request.inputText === undefined || request.inputText.length === 0
    ? request.inputVariables
    : Object.freeze({ ...request.inputVariables, input_question: request.inputText });
}
function assertUnreachableTransition(transition: never): never {
  throw new Error(`Unexpected workflow transition: ${JSON.stringify(transition)}`);
}

function isEmptyObject(value: JsonObject): boolean {
  return Object.keys(value).length === 0;
}

function isGatewayNodeType(nodeType: WorkflowNodeDef['type']): boolean {
  return nodeType === 'START' || nodeType === 'END' || nodeType === 'CONDITION' || nodeType === 'PARALLEL';
}

function isWorkflowScaffold(nodeType: WorkflowNodeDef['type']): boolean {
  return nodeType === 'START' || nodeType === 'END';
}

function toSafeError(error: unknown, fallbackMessage: string, didTimeout = false): SafeError {
  if (didTimeout) {
    return {
      code: 'WORKFLOW_NODE_TIMEOUT',
      message: fallbackMessage,
      category: 'TIMEOUT',
      retryable: true,
      safeDetails: { reasonCode: 'WORKFLOW_NODE_TIMEOUT' },
    };
  }
  if (error instanceof CapabilityNodeExecutionError) {
    return {
      code: error.safeError.code,
      message: error.safeError.message,
      category: error.safeError.category,
      retryable: error.safeError.retryable,
      ...(error.safeError.safeDetails === undefined ? {} : { safeDetails: error.safeError.safeDetails }),
    };
  }
  if (error instanceof AgentError) {
    return {
      code: error.code,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
    };
  }
  if (isAbortError(error)) {
    return {
      code: 'WORKFLOW_INTERRUPTED',
      message: 'Workflow execution was interrupted safely.',
      category: 'CANCELED',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_INTERRUPTED' },
    };
  }
  return {
    code: 'WORKFLOW_NODE_FAILED',
    message: fallbackMessage,
    category: 'INTERNAL',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_NODE_FAILED' },
  };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof CapabilityNodeExecutionError) {
    return error.safeError.category === 'CANCELED';
  }
  return error instanceof AgentError
    ? error.category === 'CANCELED'
    : error instanceof DOMException
      ? error.name === 'AbortError'
      : error instanceof Error && error.name === 'AbortError';
}

function describeNodeError(error: unknown): {
  readonly errorName: string;
  readonly errorMessage: string;
  readonly hasStack: boolean;
  readonly errorFields: Readonly<Record<string, unknown>>;
} {
  if (error instanceof AgentError) {
    return {
      errorName: 'AgentError',
      errorMessage: error.message.slice(0, 500),
      hasStack: error.stack !== undefined,
      errorFields: {
        code: error.code,
        category: error.category,
        retryable: error.retryable,
        ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
      },
    };
  }
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 500),
      hasStack: error.stack !== undefined,
      errorFields: {},
    };
  }
  return {
    errorName: typeof error,
    errorMessage: String(error).slice(0, 200),
    hasStack: false,
    errorFields: {},
  };
}

function mapSafeErrorToVariables(variables: JsonObject, safeError: SafeError): JsonObject {
  return Object.freeze({
    ...variables,
    error: Object.freeze({
      code: safeError.code,
      message: safeError.message,
      ...(safeError.category === 'TIMEOUT' ? { category: 'TIMEOUT' } : {}),
    }),
  });
}

function resolveErrorTransition(node: WorkflowNodeDef, variables: JsonObject): WorkflowNodeTransition | undefined {
  const exception = node.exception;
  if (exception === undefined) {
    return undefined;
  }
  const entries = Object.entries(exception) as ReadonlyArray<readonly [string, { readonly condition?: string }]>;
  if (entries.length === 0) {
    return undefined;
  }
  try {
    return resolveWorkflowBranchTransition(node.type, entries, variables);
  } catch {
    return undefined;
  }
}

function shouldRetry(error: unknown, attempt: number, retryPolicy: { readonly maxRetries: number }, didTimeout: boolean): boolean {
  if (attempt > retryPolicy.maxRetries) {
    return false;
  }
  return didTimeout || !isAbortError(error);
}
function createScopedAbortSignal(
  parent: AbortSignal,
  timeoutMs?: number,
): {
  readonly signal: AbortSignal;
  readonly didTimeout: boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromParent = () => controller.abort();
  if (parent.aborted) {
    controller.abort();
  } else {
    parent.addEventListener('abort', abortFromParent, { once: true });
  }
  let timeout: NodeJS.Timeout | undefined;
  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    get didTimeout() {
      return didTimeout;
    },
    dispose() {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      parent.removeEventListener('abort', abortFromParent);
    },
  };
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
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
      reject(
        new AgentError({
          code: 'WORKFLOW_INTERRUPTED',
          message: 'Workflow execution was interrupted safely.',
          category: 'CANCELED',
          retryable: false,
          safeDetails: { reasonCode: 'WORKFLOW_INTERRUPTED' },
        }),
      );
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
