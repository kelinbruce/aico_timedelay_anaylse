import { AgentError } from '@nextagent/agent-common';
import type { ContextAssembly } from '@nextagent/agent-contracts/context';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

import {
  calculateEscalatedMaxOutputTokens,
  maxOutputTokenRecoveryContinuations,
  withEscalatedOutputLimit,
  withOutputContinuation,
  withReasoningOnlyCorrection,
} from './model-output-recovery.js';
import { maxModelVisibleChars, truncateModelVisibleContent } from './output-guard.js';
import { RunBoundModelInvocation } from './run-bound-model-invocation.js';

export interface ModelRouteExecutionInput {
  readonly model: ModelInvocationService;
  readonly runState: AgentRunStatePort;
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly signal: AbortSignal;
  readonly assembly: ContextAssembly;
  readonly request: ModelInvocationRequest;
  readonly reasoningCorrectionAvailable: boolean;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}

interface ModelRouteResultBase {
  readonly content: string;
  readonly stepHasVisibleOutput: boolean;
  readonly reasoningCorrectionAttempted: boolean;
}

export type ModelRouteExecutionResult =
  | (ModelRouteResultBase & {
      readonly status: 'FINAL';
      readonly final: ModelFinalResult;
      readonly isEmptyOutputSynthesized: boolean;
    })
  | (ModelRouteResultBase & {
      readonly status: 'OUTPUT_TRUNCATED';
    });

export async function executeModelRoute(input: ModelRouteExecutionInput): Promise<ModelRouteExecutionResult> {
  return new ModelRouteExecution(input).execute();
}

type InvocationAttemptResult =
  { readonly status: 'FINAL'; readonly final: ModelFinalResult; readonly streamedReasoning: string } | { readonly status: 'OUTPUT_TRUNCATED' };

class ModelRouteExecution {
  private request: ModelInvocationRequest;
  private visibleContent: string;
  private confirmedContent = '';
  private stepHasVisibleOutput = false;
  private escalationAttempted = false;
  private regeneratingTruncatedToolCall = false;
  private continuationCount = 0;
  private reasoningCorrectionAttempted = false;
  private boundedOverflowContent?: string;

  constructor(private readonly input: ModelRouteExecutionInput) {
    this.request = input.request;
    this.visibleContent = '';
  }

  async execute(): Promise<ModelRouteExecutionResult> {
    while (true) {
      const attempt = await this.invokeOnce();
      if (attempt.status === 'OUTPUT_TRUNCATED') {
        return this.truncatedResult();
      }

      let final = attempt.final;
      if (this.shouldCorrectReasoningOnly(final, attempt.streamedReasoning)) {
        this.reasoningCorrectionAttempted = true;
        this.request = withReasoningOnlyCorrection(this.request);
        this.visibleContent = '';
        continue;
      }

      if (this.shouldFailReasoningOnlyOutputExhaustion(final, attempt.streamedReasoning)) {
        return this.finalResult(reasoningOnlyEmptyOutputFailure(final));
      }

      if (final.safeError !== undefined || final.incompleteOutputReason === undefined) {
        if (this.continuationCount > 0 && (final.toolCalls?.length ?? 0) > 0) {
          await this.failRecovery('MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL', 'Model returned tool calls after output continuation.');
        }
        final = this.withConfirmedContent(final);
        const isEmptyOutputSynthesized = isEmptyModelOutput(final);
        return this.finalResult(ensureVisibleOutputOrTool(final), isEmptyOutputSynthesized);
      }

      const recoveryResult = await this.continueAfterIncompleteOutput(final);
      if (recoveryResult !== undefined) {
        return recoveryResult;
      }
    }
  }

  private async invokeOnce(): Promise<InvocationAttemptResult> {
    let invocationContent = '';
    let streamedReasoning = '';
    const invocation = new RunBoundModelInvocation(
      this.input.model,
      this.input.runState,
      this.input.run,
      this.input.context,
      this.request,
      {
        ...(this.input.assembly.promptTemplateRef === undefined ? {} : { promptTemplateRef: this.input.assembly.promptTemplateRef }),
        ...(this.input.assembly.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: this.input.assembly.promptTemplateVersion }),
        selectedMessageRefs: this.input.assembly.selectedMessageRefs,
      },
      async (final) => {
        const completedReasoning = final?.reasoning ?? streamedReasoning;
        if (!hasVisibleReasoning(completedReasoning)) {
          return;
        }
        await this.input.runState.emitEvent(this.input.run, this.input.context, {
          type: 'LLM_THINKING_DELTA',
          persistence: 'PERSISTED',
          inlinePayload: {
            reasoning: completedReasoning,
            stepId: this.request.invocationScope.operationId,
            completed: true,
          },
        });
      },
      this.input.executionCorrelation,
    );

    try {
      const final = await invocation.stream(this.input.signal, async (delta) => {
        if (delta.content !== undefined && delta.content.length > 0) {
          invocationContent += delta.content;
          await this.projectVisibleContent(invocationContent);
        }
        if (delta.reasoning !== undefined && delta.reasoning.length > 0) {
          streamedReasoning += delta.reasoning;
          await this.projectLiveReasoning(streamedReasoning);
        }
      });

      if (final.safeError === undefined) {
        const finalVisibleContent = this.combineVisibleContent(final.content);
        if (finalVisibleContent.length > maxModelVisibleChars) {
          await this.projectTruncatedContent(finalVisibleContent);
          return { status: 'OUTPUT_TRUNCATED' };
        }
        this.visibleContent = finalVisibleContent;
      }
      return { status: 'FINAL', final, streamedReasoning };
    } catch (error) {
      if (isModelTextLimitError(error) && this.boundedOverflowContent !== undefined) {
        await this.finishTruncatedProjection(this.boundedOverflowContent);
        return { status: 'OUTPUT_TRUNCATED' };
      }
      throw error;
    }
  }

  private async projectVisibleContent(invocationContent: string): Promise<void> {
    const visibleContent = this.combineVisibleContent(invocationContent);
    if (visibleContent.length > maxModelVisibleChars) {
      this.boundedOverflowContent = truncateModelVisibleContent(visibleContent);
      throw modelTextLimitError();
    }

    this.visibleContent = visibleContent;
    this.stepHasVisibleOutput = true;
    await this.emitVisibleContent();
  }

  private async projectLiveReasoning(reasoning: string): Promise<void> {
    if (!hasVisibleReasoning(reasoning)) {
      return;
    }
    await this.input.runState.emitEvent(this.input.run, this.input.context, {
      type: 'LLM_THINKING_DELTA',
      persistence: 'LIVE_ONLY',
      inlinePayload: { reasoning, stepId: this.request.invocationScope.operationId },
    });
  }

  private shouldCorrectReasoningOnly(final: ModelFinalResult, streamedReasoning: string): boolean {
    return (
      this.input.reasoningCorrectionAvailable &&
      !this.reasoningCorrectionAttempted &&
      !this.stepHasVisibleOutput &&
      (final.finishReason !== 'length' || final.incompleteOutputReason === 'output-limit') &&
      isReasoningOnlyStop(final, streamedReasoning)
    );
  }

  private shouldFailReasoningOnlyOutputExhaustion(final: ModelFinalResult, streamedReasoning: string): boolean {
    return (
      (!this.input.reasoningCorrectionAvailable || this.reasoningCorrectionAttempted) &&
      final.incompleteOutputReason === 'output-limit' &&
      isReasoningOnlyStop(final, streamedReasoning)
    );
  }

  private async continueAfterIncompleteOutput(final: ModelFinalResult): Promise<ModelRouteExecutionResult | undefined> {
    if (!this.escalationAttempted) {
      this.escalationAttempted = true;
      const escalatedLimit = calculateEscalatedMaxOutputTokens({
        contextWindowTokens: this.input.assembly.modelConfiguration.contextWindowTokens,
        ...(this.request.maxOutputTokens === undefined ? {} : { currentMaxOutputTokens: this.request.maxOutputTokens }),
        ...(final.usage?.inputTokens === undefined ? {} : { providerInputTokens: final.usage.inputTokens }),
        ...(this.input.assembly.budgetPlan?.estimatedFinalInputUnits === undefined
          ? {}
          : { estimatedInputTokens: this.input.assembly.budgetPlan.estimatedFinalInputUnits }),
      });
      if (escalatedLimit !== undefined) {
        this.regeneratingTruncatedToolCall = final.incompleteOutputReason === 'truncated-tool-call';
        this.request = withEscalatedOutputLimit(this.request, escalatedLimit);
        this.visibleContent = '';
        return undefined;
      }
    }

    if (this.regeneratingTruncatedToolCall || final.incompleteOutputReason === 'truncated-tool-call') {
      await this.failRecovery('MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL', 'Model output ended with an incomplete tool call.');
    }

    if ((final.toolCalls?.length ?? 0) > 0) {
      await this.failRecovery('MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL', 'Model output ended with incomplete tool calls.');
    }
    if (this.continuationCount >= maxOutputTokenRecoveryContinuations) {
      await this.failRecovery('MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED', 'Model output remained incomplete after recovery attempts.');
    }

    const segment = final.content;
    this.confirmedContent += segment;
    const confirmedVisibleContent = this.combineVisibleContent('');
    if (confirmedVisibleContent.length > maxModelVisibleChars) {
      await this.projectTruncatedContent(confirmedVisibleContent);
      return this.truncatedResult();
    }

    this.continuationCount += 1;
    this.request = withOutputContinuation(this.request, segment);
    this.visibleContent = confirmedVisibleContent;
    if (segment.length > 0) {
      this.stepHasVisibleOutput = true;
      await this.emitVisibleContent();
    }
    return undefined;
  }

  private withConfirmedContent(final: ModelFinalResult): ModelFinalResult {
    if (final.safeError !== undefined || this.confirmedContent.length === 0) {
      return final;
    }
    return { ...final, content: this.confirmedContent + final.content };
  }

  private async projectTruncatedContent(content: string): Promise<void> {
    await this.finishTruncatedProjection(truncateModelVisibleContent(content));
  }

  private async finishTruncatedProjection(content: string): Promise<void> {
    this.visibleContent = content;
    this.stepHasVisibleOutput = true;
    await this.input.runState.emitEvent(this.input.run, this.input.context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: 'MODEL_TEXT_LIMIT_EXCEEDED' },
    });
    await this.emitVisibleContent();
  }

  private async emitVisibleContent(): Promise<void> {
    await this.input.runState.emitEvent(this.input.run, this.input.context, {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: {
        content: this.visibleContent,
        stepId: this.request.invocationScope.operationId,
      },
    });
  }

  private combineVisibleContent(invocationContent: string): string {
    return this.confirmedContent + invocationContent;
  }

  private finalResult(final: ModelFinalResult, isEmptyOutputSynthesized = false): ModelRouteExecutionResult {
    return {
      status: 'FINAL',
      final,
      isEmptyOutputSynthesized,
      ...this.resultFacts(),
    };
  }

  private truncatedResult(): ModelRouteExecutionResult {
    return {
      status: 'OUTPUT_TRUNCATED',
      ...this.resultFacts(),
    };
  }

  private resultFacts(): ModelRouteResultBase {
    return {
      content: this.visibleContent,
      stepHasVisibleOutput: this.stepHasVisibleOutput,
      reasoningCorrectionAttempted: this.reasoningCorrectionAttempted,
    };
  }

  private async failRecovery(
    code: 'MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED' | 'MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL',
    message: string,
  ): Promise<never> {
    await this.input.runState.emitEvent(this.input.run, this.input.context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code },
    });
    throw new AgentError({ code, message, category: 'UNAVAILABLE', retryable: false });
  }
}

function ensureVisibleOutputOrTool(final: ModelFinalResult): ModelFinalResult {
  if (!isEmptyModelOutput(final)) {
    return final;
  }
  return withEmptyOutputFailure(final);
}

function withEmptyOutputFailure(final: ModelFinalResult): ModelFinalResult {
  return {
    ...final,
    safeError: {
      code: 'MODEL_EMPTY_OUTPUT',
      message: 'Model returned an empty response.',
      category: 'UNAVAILABLE',
      retryable: true,
    },
  };
}

function reasoningOnlyEmptyOutputFailure(final: ModelFinalResult): ModelFinalResult {
  const { incompleteOutputReason: _incompleteOutputReason, reasoning: _reasoning, toolCalls: _toolCalls, ...safeFinal } = final;
  return withEmptyOutputFailure({
    ...safeFinal,
    content: '',
  });
}

function isEmptyModelOutput(final: ModelFinalResult): boolean {
  return final.safeError === undefined && (final.toolCalls?.length ?? 0) === 0 && final.content.trim().length === 0;
}

function isReasoningOnlyStop(final: ModelFinalResult, streamedReasoning: string): boolean {
  return (
    final.safeError === undefined &&
    (final.finishReason === 'stop' || final.finishReason === 'length') &&
    (final.toolCalls?.length ?? 0) === 0 &&
    final.content.trim().length === 0 &&
    hasVisibleReasoning(`${streamedReasoning}${final.reasoning ?? ''}`)
  );
}

function hasVisibleReasoning(reasoning: string): boolean {
  return reasoning.trim().length > 0;
}

function modelTextLimitError(): AgentError {
  return new AgentError({
    code: 'MODEL_TEXT_LIMIT_EXCEEDED',
    message: 'Model output exceeded the safe limit.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function isModelTextLimitError(error: unknown): boolean {
  return error instanceof AgentError && error.code === 'MODEL_TEXT_LIMIT_EXCEEDED';
}
