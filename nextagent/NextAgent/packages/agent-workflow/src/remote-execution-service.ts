import { getLogger, type AgentErrorCategory, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type {
  WorkflowExecutionObserver,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowExecutionService,
  WorkflowRemoteExecutionFailureReasonCode,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import { parsePendingInputActivation, pendingInputActivationToJson } from './pending-input-shared.js';

export interface CreateRemoteWorkflowExecutionServiceOptions {
  readonly gateway: WorkflowRemoteExecutionGateway;
  readonly now?: () => Date;
}

const logger = getLogger({ component: 'agent-workflow', source: 'remote-execution-service' });

export function createRemoteWorkflowExecutionService(options: CreateRemoteWorkflowExecutionServiceOptions): WorkflowExecutionService {
  return new RemoteWorkflowExecutionService(options);
}

class RemoteWorkflowExecutionService implements WorkflowExecutionService {
  private readonly gateway: WorkflowRemoteExecutionGateway;
  private readonly now: () => Date;

  constructor(options: CreateRemoteWorkflowExecutionServiceOptions) {
    this.gateway = options.gateway;
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    observer?: WorkflowExecutionObserver,
    runtime?: {
      requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject>;
    },
  ): Promise<WorkflowExecutionResult> {
    const startedAt = this.now();

    if (signal.aborted) {
      logger.warn({ event: 'workflow.remote.aborted' });
      return interruptedResult(startedAt, this.now());
    }

    logger.info({
      event: 'workflow.remote.started',
      recipeName: request.recipeName,
      recipeVersion: request.recipeVersion,
      hasResumeState: request.resumeState !== undefined,
    });

    let stream: AsyncIterable<WorkflowRemoteExecutionStreamItem>;
    try {
      stream = this.gateway.execute(request, signal);
    } catch (error) {
      return this.handleGatewayStartFailure(startedAt, signal, error);
    }

    let terminalResult: WorkflowExecutionResult | undefined;

    try {
      for await (const item of stream) {
        if (item.kind === 'event') {
          if (observer !== undefined) {
            await observer.emitEvent(item.event);
          }
          continue;
        }

        if (item.kind === 'result') {
          terminalResult = await this.handleResult(item.result, runtime, signal, startedAt);
          break;
        }

        // kind: "failure"
        terminalResult = this.handleFailure(item, startedAt);
        break;
      }
    } catch (error) {
      if (signal.aborted) {
        logger.warn({ event: 'workflow.remote.aborted' });
        return interruptedResult(startedAt, this.now());
      }
      logger.error({
        err: error,
        event: 'workflow.remote.failed',
        failureStage: 'WORKFLOW_STREAM_CONSUME',
        recipeName: request.recipeName,
        safeReasonCode: 'WORKFLOW_REMOTE_INVALID_RESPONSE',
      });
      return failedResult(startedAt, this.now(), {
        code: 'WORKFLOW_REMOTE_INVALID_RESPONSE',
        message: 'Remote workflow execution failed safely.',
        category: 'INTERNAL',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_REMOTE_INVALID_RESPONSE' },
      });
    }

    if (terminalResult === undefined) {
      logger.error({
        event: 'workflow.remote.failed',
        failureStage: 'WORKFLOW_TERMINAL_VALIDATE',
        recipeName: request.recipeName,
        safeReasonCode: 'WORKFLOW_REMOTE_INVALID_RESPONSE',
      });
      return failedResult(startedAt, this.now(), {
        code: 'WORKFLOW_REMOTE_INVALID_RESPONSE',
        message: 'Remote workflow execution failed safely.',
        category: 'INTERNAL',
        retryable: false,
        safeDetails: { reasonCode: 'WORKFLOW_REMOTE_INVALID_RESPONSE' },
      });
    }

    return terminalResult;
  }

  private handleGatewayStartFailure(startedAt: Date, signal: AbortSignal, error: unknown): WorkflowExecutionResult {
    if (signal.aborted) {
      logger.warn({ event: 'workflow.remote.aborted' });
      return interruptedResult(startedAt, this.now());
    }
    logger.error({
      err: error,
      event: 'workflow.remote.failed',
      failureStage: 'WORKFLOW_GATEWAY_START',
      safeReasonCode: 'WORKFLOW_REMOTE_UNAVAILABLE',
    });
    return failedResult(startedAt, this.now(), {
      code: 'WORKFLOW_REMOTE_UNAVAILABLE',
      message: 'Remote workflow execution failed safely.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_REMOTE_UNAVAILABLE' },
    });
  }

  private async handleResult(
    result: WorkflowExecutionResult,
    runtime: { requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject> } | undefined,
    signal: AbortSignal,
    startedAt: Date,
  ): Promise<WorkflowExecutionResult> {
    if (result.status === 'WAITING') {
      if (runtime === undefined) {
        logger.error({
          event: 'workflow.remote.pending_input.missing_runtime',
          failureStage: 'WORKFLOW_PENDING_INPUT_BRIDGE',
          executionId: result.executionId,
        });
        const safeError: SafeError = {
          code: 'WORKFLOW_REMOTE_PENDING_INPUT_RUNTIME_MISSING',
          message: 'Remote workflow entered waiting state but no runtime callback is available.',
          category: 'INTERNAL',
          retryable: false,
          safeDetails: { reasonCode: 'WORKFLOW_REMOTE_PENDING_INPUT_RUNTIME_MISSING' },
        };
        const failed = failedResult(startedAt, this.now(), safeError);
        this.logResult(failed);
        return failed;
      }

      const bridged = await this.bridgePendingInput(result, runtime, signal);
      if (bridged === undefined) {
        const safeError: SafeError = {
          code: 'WORKFLOW_REMOTE_PENDING_INPUT_BRIDGE_INVALID',
          message: 'Remote workflow pending input payload could not be bridged safely.',
          category: 'INTERNAL',
          retryable: false,
          safeDetails: { reasonCode: 'WORKFLOW_REMOTE_PENDING_INPUT_BRIDGE_INVALID' },
        };
        const failed = failedResult(startedAt, this.now(), safeError);
        this.logResult(failed);
        return failed;
      }

      logger.info({ event: 'workflow.remote.pending_input.bridged', executionId: result.executionId, pendingInputKind: bridged.kind });
      const bridgedResult = preserveScope(result, bridged.pendingInput);
      this.logResult(bridgedResult);
      return bridgedResult;
    }

    const finalResult = preserveScope(result);
    this.logResult(finalResult);
    return finalResult;
  }

  private async bridgePendingInput(
    result: WorkflowExecutionResult,
    runtime: { requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject> },
    signal: AbortSignal,
  ): Promise<{ kind: string; pendingInput: JsonObject } | undefined> {
    const activation = parsePendingInputActivation(result.pendingInput);
    if (activation === undefined) {
      return undefined;
    }
    const activationJson = pendingInputActivationToJson(activation);
    const registered = await runtime.requestPendingInput(activationJson, signal);
    return {
      kind: activation.kind,
      pendingInput: registered,
    };
  }

  private handleFailure(item: Extract<WorkflowRemoteExecutionStreamItem, { kind: 'failure' }>, startedAt: Date): WorkflowExecutionResult {
    logger.error({ event: 'workflow.remote.failed', failureStage: 'WORKFLOW_REMOTE_RESULT', safeReasonCode: item.reasonCode });
    return failedResult(startedAt, this.now(), failureToSafeError(item.reasonCode));
  }

  private logResult(result: WorkflowExecutionResult): void {
    logger.info({ event: 'workflow.remote.result', executionId: result.executionId, status: result.status });
  }
}

function failureToSafeError(reasonCode: WorkflowRemoteExecutionFailureReasonCode): SafeError {
  const category: AgentErrorCategory =
    reasonCode === 'WORKFLOW_REMOTE_TIMEOUT' ? 'TIMEOUT' : reasonCode === 'WORKFLOW_REMOTE_UNAUTHORIZED' ? 'AUTHORIZATION' : 'UNAVAILABLE';
  return {
    code: reasonCode,
    message: 'Remote workflow execution failed safely.',
    category,
    retryable: reasonCode === 'WORKFLOW_REMOTE_TIMEOUT',
    safeDetails: { reasonCode },
  };
}

function preserveScope(result: WorkflowExecutionResult, pendingInputOverride?: JsonObject): WorkflowExecutionResult {
  return {
    executionId: result.executionId,
    status: result.status,
    outputVariables: result.outputVariables,
    nodeResults: result.nodeResults,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    ...(pendingInputOverride !== undefined
      ? { pendingInput: pendingInputOverride }
      : result.pendingInput !== undefined
        ? { pendingInput: result.pendingInput }
        : {}),
  };
}

function interruptedResult(startedAt: Date, completedAt: Date): WorkflowExecutionResult {
  return {
    executionId: `remote-interrupted-${startedAt.getTime()}`,
    status: 'INTERRUPTED',
    outputVariables: {},
    nodeResults: [],
    startedAt,
    completedAt,
  };
}

function failedResult(startedAt: Date, completedAt: Date, safeError: SafeError): WorkflowExecutionResult {
  return {
    executionId: `remote-failed-${startedAt.getTime()}`,
    status: 'FAILED',
    outputVariables: {},
    nodeResults: [
      {
        nodeId: 'remote',
        nodeType: 'START' as never,
        status: 'NODE_FAILED',
        safeError,
        retryCount: 0,
        startedAt,
        completedAt,
      },
    ],
    startedAt,
    completedAt,
  };
}
