import type { ModelFinalResult, ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

import { remainingDeadlineMs } from './routing-async-guard.js';
import { RoutingEvidenceRecorder } from './routing-evidence-recorder.js';

export class ModelFallbackOrchestrator {
  constructor(private readonly routingEvidence: RoutingEvidenceRecorder) {}

  async allowFallback(input: {
    readonly run: RequestRun;
    readonly context: RequestContext;
    readonly request: ModelInvocationRequest;
    readonly safeError: NonNullable<ModelFinalResult['safeError']>;
    readonly stepHasVisibleOutput: boolean;
    readonly attemptedModelIds: Set<string>;
    readonly signal: AbortSignal;
  }): Promise<boolean> {
    const { run, context, request, safeError, stepHasVisibleOutput, attemptedModelIds, signal } = input;
    attemptedModelIds.add(request.modelId);
    if (stepHasVisibleOutput) {
      return this.deny(run, context, 'VISIBLE_OUTPUT_REPLAY_BLOCKED');
    }
    if (signal.aborted) {
      return this.deny(run, context, 'ROUTING_ABORTED');
    }
    if (run.deadlineAt !== undefined && Number(run.deadlineAt) <= Date.now()) {
      return this.deny(run, context, 'ROUTING_DEADLINE_EXCEEDED');
    }
    const remainingMs = remainingDeadlineMs(run);
    if (remainingMs !== undefined && (remainingMs <= 0 || (request.timeoutMs !== undefined && remainingMs < request.timeoutMs))) {
      return this.deny(run, context, 'FALLBACK_BUDGET_INSUFFICIENT');
    }
    if (!fallbackEligibleFailure(safeError)) {
      return this.deny(run, context, 'SAFE_FAILURE_NOT_FALLBACK_ELIGIBLE');
    }
    return true;
  }

  async recordExhausted(run: RequestRun, context: RequestContext, reasonCode: string): Promise<void> {
    await this.routingEvidence.record(run, context, {
      policyDomain: 'MODEL_FALLBACK',
      outcome: 'fallback-exhausted',
      reasonCode,
    });
  }

  private async deny(run: RequestRun, context: RequestContext, reasonCode: string): Promise<false> {
    await this.routingEvidence.record(run, context, {
      policyDomain: 'MODEL_FALLBACK',
      outcome: 'fallback-denied',
      reasonCode,
    });
    return false;
  }
}

function fallbackEligibleFailure(error: NonNullable<ModelFinalResult['safeError']>): boolean {
  return error.retryable;
}
