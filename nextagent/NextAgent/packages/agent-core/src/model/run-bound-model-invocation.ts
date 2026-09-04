import { AgentError, getLogger, type JsonObject } from '@nextagent/agent-common';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

import { isModelInvocationSafePayload } from '../projection/timeline-safe-payload-schemas.js';
import { boundedSafeNames } from '../projection/safe-structure-diagnostics.js';

const runtimeLogger = getLogger({ component: 'agent-core', source: 'run-bound-model-invocation' });

export class RunBoundModelInvocation {
  private terminalEventEmitted = false;

  constructor(
    private readonly model: ModelInvocationService,
    private readonly runState: AgentRunStatePort,
    private readonly run: RequestRun,
    private readonly context: RequestContext,
    private readonly request: ModelInvocationRequest,
    private readonly contextFacts: RunBoundModelInvocationContextFacts,
    private readonly beforeTerminal: (result?: ModelFinalResult) => Promise<void> = async () => undefined,
    private readonly executionCorrelation?: ExecutionCorrelationPort,
  ) {}

  async stream(signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>): Promise<ModelFinalResult> {
    await this.runState.emitEvent(this.run, this.context, {
      type: 'MODEL_INVOCATION_STARTED',
      inlinePayload: startedPayload(this.request, this.contextFacts),
    });
    const startedAt = performance.now();
    let firstContentLatencyMs: number | undefined;
    const onTimedDelta = async (delta: ModelStreamDelta): Promise<void> => {
      if (firstContentLatencyMs === undefined && hasModelFeedback(delta)) {
        firstContentLatencyMs = elapsedMs(startedAt);
      }
      await onDelta(delta);
    };
    const execute = async (): Promise<ModelFinalResult> => {
      this.logInput();
      try {
        const final = await this.model.stream(this.request, signal, onTimedDelta);
        const durationMs = elapsedMs(startedAt);
        if (firstContentLatencyMs === undefined && hasModelFeedback(final)) {
          firstContentLatencyMs = durationMs;
        }
        const timing = { durationMs, ...(firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs }) };
        this.logOutput(final);
        if (final.safeError === undefined) {
          await this.completed(final, timing);
        } else {
          await this.failed(final.safeError, final, timing);
        }
        return final;
      } catch (error) {
        this.logFailure(error);
        await this.failed(error, undefined, {
          durationMs: elapsedMs(startedAt),
          ...(firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs }),
        });
        throw error;
      }
    };
    return this.executionCorrelation === undefined
      ? execute()
      : this.executionCorrelation.withExecutionRef(
          {
            requestRunId: this.run.runId,
            kind: 'MODEL',
            executionId: this.request.invocationScope.operationId,
          },
          execute,
        );
  }

  async failed(error: unknown, result?: ModelFinalResult, timing?: ModelInvocationTiming): Promise<void> {
    const safeError = safeErrorFields(error);
    await this.emitTerminal(
      {
        type: 'MODEL_INVOCATION_FAILED',
        inlinePayload: failedPayload(this.request, safeError, result, timing),
      },
      result,
    );
  }

  private async completed(result: ModelFinalResult, timing: ModelInvocationTiming): Promise<void> {
    await this.emitTerminal(
      {
        type: 'MODEL_INVOCATION_COMPLETED',
        inlinePayload: completedPayload(this.request, result, timing),
      },
      result,
    );
  }

  private logInput(): void {
    runtimeLogger.info({
      ...this.logCorrelation(),
      event: 'model.payload.input_captured',
      modelInput: localModelInput(this.request),
    });
  }

  private logOutput(result: ModelFinalResult): void {
    runtimeLogger.info({
      ...this.logCorrelation(),
      event: 'model.payload.output_captured',
      modelOutput: localModelOutput(result),
    });
  }

  private logFailure(error: unknown): void {
    runtimeLogger.error({
      ...this.logCorrelation(),
      err: error,
      event: 'model.payload.failed',
    });
  }

  private logCorrelation(): object {
    return {
      agentId: this.run.agentId,
      agentVersion: this.run.agentVersion,
      sessionId: this.run.sessionId,
      requestId: this.run.requestId,
      runId: this.run.runId,
      stepId: this.request.invocationScope.operationId,
      modelId: this.request.modelId,
    };
  }

  private async emitTerminal(event: Parameters<AgentRunStatePort['emitEvent']>[2], result?: ModelFinalResult): Promise<void> {
    if (this.terminalEventEmitted) {
      return;
    }
    this.terminalEventEmitted = true;
    await this.beforeTerminal(result);
    await this.runState.emitEvent(this.run, this.context, event);
  }
}

function localModelInput(request: ModelInvocationRequest): object {
  return {
    messages: request.messages.filter((message) => message.role !== 'SYSTEM'),
  };
}

function localModelOutput(result: ModelFinalResult): object {
  return {
    content: result.content,
    ...(result.toolCalls === undefined ? {} : { toolCalls: result.toolCalls }),
    ...(result.finishReason === undefined ? {} : { finishReason: result.finishReason }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.safeError === undefined ? {} : { safeError: result.safeError }),
  };
}

export interface RunBoundModelInvocationContextFacts {
  readonly promptTemplateRef?: string;
  readonly promptTemplateVersion?: string;
  readonly selectedMessageRefs: readonly string[];
}

interface ModelInvocationTiming {
  readonly durationMs: number;
  readonly firstContentLatencyMs?: number;
}

function startedPayload(request: ModelInvocationRequest, contextFacts: RunBoundModelInvocationContextFacts): JsonObject {
  const disclosedCapabilityNames = boundedSafeNames(request.tools.map((tool) => tool.name));
  const base = {
    stepId: request.invocationScope.operationId,
    modelId: request.modelId,
    messageCountBucket: countBucket(request.messages.length),
    timeoutMsBucket: timeoutBucket(request.timeoutMs),
    maxOutputTokensBucket: outputTokenBucket(request.maxOutputTokens),
    disclosedCapabilityNames: disclosedCapabilityNames.names,
    disclosedCapabilityNamesTruncated: disclosedCapabilityNames.truncated,
    modelOptionSummary: safeModelOptionSummary(request),
    providerOptionKeys: Object.keys(request.providerOptions ?? {})
      .sort()
      .slice(0, 20),
  };
  const payload = {
    ...base,
    ...(contextFacts.promptTemplateRef === undefined ? {} : { promptTemplateRef: contextFacts.promptTemplateRef }),
    ...(contextFacts.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: contextFacts.promptTemplateVersion }),
    selectedMessageRefs: contextFacts.selectedMessageRefs.slice(0, 100),
    disclosedCapabilityIds: request.tools.map((tool) => tool.capabilityId).slice(0, 100),
    modelMessageCount: request.messages.length,
  };
  if (isModelInvocationSafePayload('started', payload)) {
    return payload;
  }
  return {
    stepId: request.invocationScope.operationId,
    modelId: request.modelId,
    messageCountBucket: '0',
    timeoutMsBucket: 'unspecified',
    maxOutputTokensBucket: 'unspecified',
    disclosedCapabilityNames: [],
    disclosedCapabilityNamesTruncated: 'true',
    modelOptionSummary: { timeoutMs: 0, toolCount: 0 },
    providerOptionKeys: [],
    selectedMessageRefs: [],
    disclosedCapabilityIds: [],
    modelMessageCount: 0,
    projectionUnavailable: 'MODEL_INVOCATION_PAYLOAD_INVALID',
  };
}

function completedPayload(request: ModelInvocationRequest, result?: ModelFinalResult, timing?: ModelInvocationTiming): JsonObject {
  const disclosedNames = new Map(request.tools.map((tool) => [tool.name, tool.name]));
  const resolvedToolNames = boundedSafeNames(
    (result?.toolCalls ?? []).flatMap((toolCall) => {
      const trustedName = disclosedNames.get(toolCall.toolName);
      return trustedName === undefined ? [] : [trustedName];
    }),
  );
  const payload = {
    stepId: request.invocationScope.operationId,
    modelId: request.modelId,
    resolvedToolNames: resolvedToolNames.names,
    resolvedToolNamesTruncated: resolvedToolNames.truncated,
    ...(result?.finishReason === undefined ? {} : { finishReason: result.finishReason }),
    ...(result?.usage === undefined ? {} : { usage: safeModelUsage(result.usage) }),
    ...(timing === undefined ? {} : timing),
    toolCallCount: result?.toolCalls?.length ?? 0,
  };
  return isModelInvocationSafePayload('completed', payload)
    ? payload
    : {
        stepId: request.invocationScope.operationId,
        modelId: request.modelId,
        resolvedToolNames: [],
        resolvedToolNamesTruncated: 'true',
        toolCallCount: 0,
        projectionUnavailable: 'MODEL_INVOCATION_PAYLOAD_INVALID',
      };
}

function failedPayload(
  request: ModelInvocationRequest,
  safeError: { readonly code: string; readonly category: string },
  result?: ModelFinalResult,
  timing?: ModelInvocationTiming,
): JsonObject {
  const payload = {
    stepId: request.invocationScope.operationId,
    modelId: request.modelId,
    safeErrorCode: safeError.code,
    safeErrorCategory: safeError.category,
    ...(result?.usage === undefined ? {} : { usage: safeModelUsage(result.usage) }),
    ...(timing === undefined ? {} : timing),
  };
  return isModelInvocationSafePayload('failed', payload)
    ? payload
    : {
        stepId: request.invocationScope.operationId,
        modelId: request.modelId,
        safeErrorCode: 'MODEL_INVOCATION_PROJECTION_INVALID',
        safeErrorCategory: 'INTERNAL',
        projectionUnavailable: 'MODEL_INVOCATION_PAYLOAD_INVALID',
      };
}

function hasModelFeedback(value: ModelStreamDelta | ModelFinalResult): boolean {
  return (
    (typeof value.content === 'string' && value.content.length > 0) ||
    (typeof value.reasoning === 'string' && value.reasoning.length > 0) ||
    ('toolCall' in value && value.toolCall !== undefined) ||
    ('toolCalls' in value && value.toolCalls !== undefined && value.toolCalls.length > 0)
  );
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function safeErrorFields(error: unknown): { readonly code: string; readonly category: string } {
  if (error instanceof AgentError) {
    return { code: error.code, category: error.category };
  }
  if (error !== null && typeof error === 'object') {
    if ('code' in error && 'category' in error && typeof error.code === 'string' && typeof error.category === 'string') {
      return { code: error.code, category: error.category };
    }
  }
  return { code: 'UNEXPECTED_ERROR', category: 'INTERNAL' };
}

function safeModelOptionSummary(request: ModelInvocationRequest): JsonObject {
  return {
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    ...(request.topP === undefined ? {} : { topP: request.topP }),
    ...(request.thinking === undefined ? {} : { thinkingDepth: request.thinking.depth }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    toolCount: request.tools.length,
  };
}

function safeModelUsage(usage: NonNullable<ModelFinalResult['usage']>): JsonObject {
  return {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  };
}

function countBucket(count: number): '0' | '1' | '2-10' | '11-100' | '101+' {
  if (count === 0) {
    return '0';
  }
  if (count === 1) {
    return '1';
  }
  if (count <= 10) {
    return '2-10';
  }
  if (count <= 100) {
    return '11-100';
  }
  return '101+';
}

function timeoutBucket(timeoutMs?: number): 'unspecified' | '1-1000' | '1001-5000' | '5001-30000' | '30001-120000' | '120001+' {
  if (timeoutMs === undefined) {
    return 'unspecified';
  }
  if (timeoutMs <= 1_000) {
    return '1-1000';
  }
  if (timeoutMs <= 5_000) {
    return '1001-5000';
  }
  if (timeoutMs <= 30_000) {
    return '5001-30000';
  }
  if (timeoutMs <= 120_000) {
    return '30001-120000';
  }
  return '120001+';
}

function outputTokenBucket(value?: number): 'unspecified' | '1-1024' | '1025-4096' | '4097-16384' | '16385+' {
  if (value === undefined) {
    return 'unspecified';
  }
  if (value <= 1_024) {
    return '1-1024';
  }
  if (value <= 4_096) {
    return '1025-4096';
  }
  if (value <= 16_384) {
    return '4097-16384';
  }
  return '16385+';
}
