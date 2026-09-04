import type { SafeError } from '@nextagent/agent-common';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';

import { createSafeModelError } from '../providers/shared/error-mapper.js';

export interface DeterministicModelStep {
  readonly content?: string;
  readonly contentChunks?: readonly string[];
  readonly reasoningChunks?: readonly string[];
  readonly toolCalls?: ModelFinalResult['toolCalls'];
  readonly safeError?: SafeError;
  readonly delayBeforeFinalMs?: number;
}

export class DeterministicModelInvocationService implements ModelInvocationService {
  readonly requests: ModelInvocationRequest[] = [];
  private index = 0;

  constructor(private readonly steps: readonly DeterministicModelStep[]) {}

  async complete(request: ModelInvocationRequest, signal: AbortSignal): Promise<ModelFinalResult> {
    return await this.invoke(request, signal, async () => undefined);
  }

  async stream(request: ModelInvocationRequest, signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>): Promise<ModelFinalResult> {
    return await this.invoke(request, signal, onDelta);
  }

  private async invoke(
    request: ModelInvocationRequest,
    signal: AbortSignal,
    onDelta: (delta: ModelStreamDelta) => Promise<void>,
  ): Promise<ModelFinalResult> {
    this.requests.push(request);
    if (signal.aborted) {
      return { content: '', safeError: createSafeModelError('MODEL_ABORTED', 'Model invocation was aborted.', 'CANCELED') };
    }
    const step = this.steps[Math.min(this.index, this.steps.length - 1)] ?? { content: '' };
    this.index += 1;
    for (const reasoning of step.reasoningChunks ?? []) {
      if (reasoning.length > 0) {
        await onDelta({ reasoning });
      }
    }
    let content = '';
    for (const chunk of step.contentChunks ?? (step.content === undefined ? [] : [step.content])) {
      if (chunk.length > 0) {
        content += chunk;
        await onDelta({ content: chunk });
      }
    }
    if (step.delayBeforeFinalMs !== undefined && step.delayBeforeFinalMs > 0) {
      const completedDelay = await waitForDelay(step.delayBeforeFinalMs, signal);
      if (!completedDelay) {
        return { content, safeError: createSafeModelError('MODEL_ABORTED', 'Model invocation was aborted.', 'CANCELED') };
      }
    }
    const finalContent = step.content ?? content;
    return {
      content: finalContent,
      finishReason: step.toolCalls === undefined || step.toolCalls.length === 0 ? 'stop' : 'tool-calls',
      ...(step.toolCalls === undefined ? {} : { toolCalls: step.toolCalls }),
      ...(step.safeError === undefined ? {} : { safeError: step.safeError }),
    };
  }
}

export function createDeterministicModelInvocationService(steps: readonly DeterministicModelStep[]): DeterministicModelInvocationService {
  return new DeterministicModelInvocationService(steps);
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
