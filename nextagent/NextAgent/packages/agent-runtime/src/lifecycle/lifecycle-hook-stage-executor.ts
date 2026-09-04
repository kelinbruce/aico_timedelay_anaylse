import {
  AgentError,
  brand,
  type CapabilityId,
  type CheckpointTriggerReason,
  type EpochMillis,
  type JsonObject,
  type MessageId,
  type PendingInputId,
  type RequestContextId,
  type RequestRunId,
  type SafeError,
  type SessionId,
  type SubjectId,
  type TenantId,
  type ToolCallId,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry, AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import type { CheckpointStoreGateway, PendingInputRecord, PendingInputStoreGateway } from '@nextagent/agent-contracts/gateway';
import type {
  AgentRunStatePort,
  CapabilityResultBoundary,
  HookBoundary,
  HookEffect,
  HookFailureMode,
  HookInput,
  HookInvocationStatus,
  HookOutcome,
  HookResult,
  LifecycleHookControlInterruption,
  LifecycleHookDefinition,
  LifecycleHookInvocationCoordinates,
  LifecycleHookInvocationPort,
  LifecycleHookInvocationRequest,
  LifecycleHookInvocationResult,
  LifecycleStage,
  ModelInvokeBoundary,
  PendingInputIntent,
  PendingInputRequest,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import { LifecycleHookInterruptionError, runtimeLifecycleStages } from '@nextagent/agent-contracts/runtime';
import { maxTimelineInlinePayloadBytes } from '../timeline/runtime-payload.js';
import type { RuntimeLifecycleHookExecutor, TrustedTerminalLifecycleHookExecutor, TrustedTerminalLifecycleHookResult } from './lifecycle-hooks.js';

export interface LifecycleHookStageExecution {
  readonly definition: LifecycleHookDefinition;
  readonly activation?: AgentHookActivation;
  readonly declarationOrdinal: number;
}

export type LifecycleHookExecution = LifecycleHookStageExecution;

export interface AgentHookSnapshot {
  readonly agentAssemblyRef: string;
  readonly byStage: ReadonlyMap<LifecycleStage, readonly LifecycleHookExecution[]>;
}

export interface HookExecutionScope {
  readonly coordinates: LifecycleHookInvocationCoordinates;
  readonly ownerScope: { readonly tenantId: TenantId; readonly subjectId: SubjectId };
  readonly requestContextId: RequestContextId;
  readonly backgroundModelInvocation?: boolean;
}

export interface LifecycleHookStageExecutorDependencies {
  readonly snapshots?: ReadonlyMap<string, AgentHookSnapshot> | undefined;
  readonly hookExecutor?: RuntimeLifecycleHookExecutor | undefined;
  readonly trustedTerminalHookExecutor?: TrustedTerminalLifecycleHookExecutor;
  readonly runState: AgentRunStatePort;
  readonly pendingInputStore?: PendingInputStoreGateway | undefined;
  readonly onPendingInputCreated?: (timeoutAt: EpochMillis) => void;
  readonly checkpointStore: CheckpointStoreGateway;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly lifecycleHookDefinitions: readonly LifecycleHookDefinition[];
  readonly clock: () => EpochMillis;
  readonly idFactory: (prefix: string) => string;
  readonly isBackgroundModelInvocation: (coordinates: LifecycleHookInvocationCoordinates) => boolean;
}

interface HookInvokedEventInput {
  readonly hookInvocationId: string;
  readonly hookId: string;
  readonly kind: string;
  readonly effects: readonly HookEffect[];
  readonly executionStrategy: string;
  readonly status: HookInvocationStatus;
  readonly failureMode: HookFailureMode;
  readonly idempotencyKey: string;
  readonly startedAt: EpochMillis;
  readonly finishedAt: EpochMillis;
  readonly outcome?: HookOutcome;
  readonly safeReason?: string;
  readonly diagnosticCode?: string;
  readonly candidateCount?: number;
  readonly detailCount?: number;
  readonly contextDisposition?: 'L2_CONTEXT' | 'L1_CONTEXT' | 'NO_CONTEXT';
  readonly safeError?: SafeError;
  readonly mutation?: JsonObject;
  readonly resultSummary?: JsonObject;
}

export class LifecycleHookStageExecutor implements LifecycleHookInvocationPort {
  constructor(private readonly deps: LifecycleHookStageExecutorDependencies) {}

  async invokeStage<TBoundary extends HookBoundary>(
    scope: HookExecutionScope,
    stage: LifecycleStage,
    boundary: TBoundary,
    signal?: AbortSignal,
  ): Promise<{ readonly boundary: TBoundary; readonly outcome: Exclude<HookOutcome, 'PEND'> | 'PASS' }> {
    const executions = await this.resolveExecutions(scope, stage);
    const trustedExecutions = executions.filter(
      (execution) => this.deps.trustedTerminalHookExecutor?.isRegistered(execution.definition.hookId) === true,
    );
    const ordinaryExecutions = executions.filter((execution) => !trustedExecutions.includes(execution));
    const observeExecutions = ordinaryExecutions.filter((execution) => isObserveOnly(execution.definition.effects));
    const impactExecutions = ordinaryExecutions.filter((execution) => !isObserveOnly(execution.definition.effects));
    const observeSettled = Promise.allSettled(observeExecutions.map((execution) => this.invokeSingle(scope, execution, stage, boundary, signal)));
    let effectiveBoundary = boundary;
    try {
      for (const execution of impactExecutions) {
        const invocation = await this.invokeSingle(scope, execution, stage, effectiveBoundary, signal);
        const result = invocation.result;
        const outcome = result.outcome;
        const mutation = hookMutation(result);
        if (mutation !== undefined && outcome !== 'DENY' && outcome !== 'BLOCK' && outcome !== 'PEND') {
          effectiveBoundary = this.applyMutation(stage, effectiveBoundary, mutation);
        }
        if (outcome === 'DENY' || outcome === 'BLOCK') {
          const safeReason = result.safeReason ?? 'Lifecycle hook rejected the request.';
          throw new LifecycleHookInterruptionError({
            stage,
            hookInvocationId: invocation.hookInvocationId,
            outcome,
            safeReason,
            safeError: {
              code: outcome === 'DENY' ? 'LIFECYCLE_HOOK_DENIED' : 'LIFECYCLE_HOOK_BLOCKED',
              message: safeReason,
              category: outcome === 'DENY' ? 'POLICY_DENIED' : 'VALIDATION',
              retryable: false,
            },
          });
        }
        if (outcome === 'PEND') {
          if (scope.backgroundModelInvocation === true) {
            throw this.lifecycleHookFailure('LIFECYCLE_HOOK_PENDING_UNAVAILABLE', 'Background model invocation cannot enter pending input.');
          }
          const pendingStage = stage as Extract<LifecycleStage, 'BEFORE_MODEL_INVOKE' | 'BEFORE_CAPABILITY_INVOKE' | 'BEFORE_AGENT_TERMINAL'>;
          const pendingInput = await this.createPendingInput(scope, pendingStage, execution, result, effectiveBoundary);
          throw new LifecycleHookInterruptionError({
            stage,
            hookInvocationId: invocation.hookInvocationId,
            outcome: 'PEND',
            pendingInput,
            safeReason: 'LIFECYCLE_HOOK_PENDING',
          });
        }
      }
    } catch (error) {
      await observeSettled;
      throw error;
    }
    await observeSettled;
    for (const execution of trustedExecutions) {
      const result = await this.invokeTrustedTerminal(scope, execution, stage, effectiveBoundary, signal);
      if (result.outcome === 'PASS' && result.mutation !== undefined) {
        effectiveBoundary = this.applyMutation(stage, effectiveBoundary, result.mutation as unknown as JsonObject);
      }
    }
    return { boundary: effectiveBoundary, outcome: 'PASS' };
  }

  async invoke<S extends LifecycleStage>(
    request: LifecycleHookInvocationRequest<S>,
    signal?: AbortSignal,
  ): Promise<LifecycleHookInvocationResult<S>> {
    const scope: HookExecutionScope = {
      coordinates: request.coordinates,
      ownerScope: request.ownerScope,
      requestContextId: brand<string, 'RequestContextId'>(`hk-${shortHash(request.coordinates.stageOccurrenceKey)}`),
      ...((request.stage === 'BEFORE_MODEL_INVOKE' || request.stage === 'AFTER_MODEL_RESULT') &&
      this.deps.isBackgroundModelInvocation(request.coordinates)
        ? { backgroundModelInvocation: true }
        : {}),
    };
    try {
      const result = await this.invokeStage(scope, request.stage, request.boundary, signal);
      return { status: 'CONTINUE', boundary: result.boundary };
    } catch (error) {
      if (error instanceof LifecycleHookInterruptionError) {
        return { status: 'INTERRUPT', interruption: error.interruption };
      }
      throw error;
    }
  }

  private async resolveExecutions(scope: HookExecutionScope, stage: LifecycleStage): Promise<readonly LifecycleHookStageExecution[]> {
    const snapshot = this.deps.snapshots?.get(scope.coordinates.agentAssemblyRef);
    if (snapshot !== undefined) {
      return snapshot.byStage.get(stage) ?? [];
    }
    const assembly = await this.deps.assemblyRegistry.require(scope.coordinates.agentId, scope.coordinates.agentVersion);
    return materializeLifecycleHookStageExecutions(assembly, this.deps.lifecycleHookDefinitions, stage, lifecycleHookMaterializationFailure);
  }

  private async invokeSingle<TBoundary extends HookBoundary>(
    scope: HookExecutionScope,
    execution: { readonly definition: LifecycleHookDefinition; readonly activation?: AgentHookActivation },
    stage: LifecycleStage,
    boundary: TBoundary,
    ownerSignal?: AbortSignal,
  ): Promise<{ readonly result: HookResult; readonly hookInvocationId: string }> {
    const hookInvocationId = brand<string, 'AuditEventId'>(this.deps.idFactory('hook'));
    const startedAt = this.deps.clock();
    const idempotencyKey = lifecycleHookIdempotencyKey(scope.coordinates, execution.definition.hookId);
    const input: HookInput = {
      hookId: execution.definition.hookId,
      ...(scope.coordinates.sessionId === undefined ? {} : { sessionId: scope.coordinates.sessionId }),
      ...(scope.coordinates.requestId === undefined ? {} : { requestId: scope.coordinates.requestId }),
      ...(scope.coordinates.requestRunId === undefined ? {} : { requestRunId: scope.coordinates.requestRunId }),
      agentId: scope.coordinates.agentId,
      agentVersion: scope.coordinates.agentVersion,
      agentAssemblyRef: scope.coordinates.agentAssemblyRef,
      stage,
      boundary: detachCapabilityResultArguments(stage, boundary) as unknown as HookInput['boundary'],
      idempotencyKey,
      hookInvocationId,
    };
    const timeoutMs = execution.activation?.timeoutMs ?? execution.definition.timeoutMs ?? 5_000;
    const hookAbort = createLifecycleHookAbort(timeoutMs, ownerSignal);
    try {
      const invocation =
        this.deps.hookExecutor?.invoke(input, hookAbort.signal) ??
        Promise.reject(this.lifecycleHookFailure('LIFECYCLE_HOOK_UNAVAILABLE', 'Lifecycle hook executor is unavailable.'));
      const result = await Promise.race([invocation, hookAbort.aborted]);
      this.assertCanonicalHookOutcome(result);
      const resultSummary = detachHookResultSummary(result, (code, message) => this.lifecycleHookFailure(code, message));
      const diagnosticCode = observeOnlyLifecycleHookDiagnosticCode(execution.definition.effects, result);
      if (!isObserveOnly(execution.definition.effects)) {
        this.assertValidHookResult(stage, result, execution.definition.effects);
      }
      const finishedAt = this.deps.clock();
      const event = {
        hookInvocationId,
        hookId: execution.definition.hookId,
        kind: execution.definition.kind,
        effects: execution.definition.effects,
        executionStrategy: execution.definition.executionStrategy,
        status: 'SUCCESS',
        failureMode: execution.definition.failureMode,
        idempotencyKey,
        startedAt,
        finishedAt,
        outcome: normalizeHookOutcome(result),
        ...(resultSummary === undefined ? {} : { resultSummary }),
        ...(result.safeReason === undefined ? {} : { safeReason: result.safeReason }),
        ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
        ...(!isObserveOnly(execution.definition.effects) && hookMutation(result) !== undefined ? { mutation: hookMutation(result)! } : {}),
      } as const;
      if (scope.backgroundModelInvocation !== true) {
        this.assertHookInvokedPayloadWithinLimit(stage, event);
      }
      await this.emitHookInvoked(scope, stage, event);
      return { result, hookInvocationId };
    } catch (error) {
      if (isLifecycleHookAbort(error)) {
        throw error;
      }
      const safeError = lifecycleHookSafeError(error);
      const safeReason = lifecycleHookSafeReason(error);
      await this.emitHookInvoked(scope, stage, {
        hookInvocationId,
        hookId: execution.definition.hookId,
        kind: execution.definition.kind,
        effects: execution.definition.effects,
        executionStrategy: execution.definition.executionStrategy,
        status: lifecycleHookInvocationStatus(error),
        failureMode: execution.definition.failureMode,
        idempotencyKey,
        startedAt,
        finishedAt: this.deps.clock(),
        ...(safeReason === undefined ? {} : { safeReason }),
        ...(safeError === undefined ? {} : { safeError }),
      });
      if (isObserveOnly(execution.definition.effects) || execution.definition.failureMode === 'CONTINUE') {
        return { result: { outcome: 'PASS', safeReason }, hookInvocationId };
      }
      throw error;
    } finally {
      hookAbort.dispose();
    }
  }

  private async invokeTrustedTerminal<TBoundary extends HookBoundary>(
    scope: HookExecutionScope,
    execution: { readonly definition: LifecycleHookDefinition; readonly activation?: AgentHookActivation },
    stage: LifecycleStage,
    boundary: TBoundary,
    ownerSignal?: AbortSignal,
  ): Promise<TrustedTerminalLifecycleHookResult> {
    const hookInvocationId = brand<string, 'AuditEventId'>(this.deps.idFactory('hook'));
    const startedAt = this.deps.clock();
    const idempotencyKey = lifecycleHookIdempotencyKey(scope.coordinates, execution.definition.hookId);
    const timeoutMs = execution.activation?.timeoutMs ?? execution.definition.timeoutMs ?? 5_000;
    const hookAbort = createLifecycleHookAbort(timeoutMs, ownerSignal);
    try {
      if (stage !== 'BEFORE_MODEL_INVOKE') {
        throw this.lifecycleHookFailure('LIFECYCLE_HOOK_STAGE_UNSUPPORTED', 'Trusted terminal hooks only support BEFORE_MODEL_INVOKE.');
      }
      const invocation =
        this.deps.trustedTerminalHookExecutor?.invoke(
          {
            hookId: execution.definition.hookId,
            coordinates: scope.coordinates,
            ownerScope: scope.ownerScope,
            boundary: boundary as unknown as ModelInvokeBoundary,
          },
          hookAbort.signal,
        ) ?? Promise.reject(this.lifecycleHookFailure('LIFECYCLE_HOOK_UNAVAILABLE', 'Trusted terminal lifecycle hook executor is unavailable.'));
      const result = await Promise.race([invocation, hookAbort.aborted]);
      this.assertValidTrustedTerminalResult(result);
      const trustedResult = result as TrustedTerminalLifecycleHookResult;
      await this.emitHookInvoked(scope, stage, {
        hookInvocationId,
        hookId: execution.definition.hookId,
        kind: execution.definition.kind,
        effects: execution.definition.effects,
        executionStrategy: execution.definition.executionStrategy,
        status: 'SUCCESS',
        failureMode: execution.definition.failureMode,
        idempotencyKey,
        startedAt,
        finishedAt: this.deps.clock(),
        outcome: trustedResult.outcome,
        ...(trustedResult.diagnostic === undefined ? {} : trustedResult.diagnostic),
      });
      return trustedResult;
    } catch (error) {
      if (isLifecycleHookAbort(error)) {
        throw error;
      }
      const safeError = trustedLifecycleHookSafeError(error);
      await this.emitHookInvoked(scope, stage, {
        hookInvocationId,
        hookId: execution.definition.hookId,
        kind: execution.definition.kind,
        effects: execution.definition.effects,
        executionStrategy: execution.definition.executionStrategy,
        status: lifecycleHookInvocationStatus(error),
        failureMode: execution.definition.failureMode,
        idempotencyKey,
        startedAt,
        finishedAt: this.deps.clock(),
        safeReason: safeError.code,
        safeError,
      });
      if (execution.definition.failureMode === 'CONTINUE') {
        return { outcome: 'PASS' };
      }
      throw error;
    } finally {
      hookAbort.dispose();
    }
  }

  private assertValidTrustedTerminalResult(result: unknown): asserts result is TrustedTerminalLifecycleHookResult {
    if (typeof result !== 'object' || result === null || !('outcome' in result)) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Trusted terminal hook must return PASS or SKIP.');
    }
    const candidate = result as Record<string, unknown>;
    if (candidate['outcome'] === 'SKIP') {
      if (
        Object.keys(candidate).some((key) => key !== 'outcome' && key !== 'diagnostic') ||
        !isTrustedTerminalHookDiagnostic(candidate['diagnostic'])
      ) {
        throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Trusted terminal hook returned invalid SKIP fields.');
      }
      return;
    }
    if (candidate['outcome'] !== 'PASS') {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Trusted terminal hook must return PASS or SKIP.');
    }
    if (!isTrustedTerminalHookDiagnostic(candidate['diagnostic'])) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Trusted terminal hook returned an invalid diagnostic summary.');
    }
    const mutation = candidate['mutation'];
    if (mutation === undefined) {
      return;
    }
    if (
      typeof mutation !== 'object' ||
      mutation === null ||
      Array.isArray(mutation) ||
      Object.keys(mutation).some((key) => key !== 'messages') ||
      !('messages' in mutation) ||
      !Array.isArray(mutation.messages)
    ) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Trusted terminal hook returned an invalid messages mutation.');
    }
  }

  private assertCanonicalHookOutcome(result: unknown): asserts result is HookResult {
    if (
      typeof result !== 'object' ||
      result === null ||
      !('outcome' in result) ||
      (result.outcome !== 'PASS' && result.outcome !== 'SKIP' && result.outcome !== 'DENY' && result.outcome !== 'BLOCK' && result.outcome !== 'PEND')
    ) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook result must declare a canonical outcome.');
    }
  }

  private assertValidHookResult(stage: LifecycleStage, result: HookResult, effects: readonly HookEffect[]): void {
    const outcome = normalizeHookOutcome(result);
    const hasControl = effects.includes('CONTROL');
    const hasTransform = effects.includes('TRANSFORM');
    if ((outcome === 'DENY' || outcome === 'BLOCK' || outcome === 'PEND') && !hasControl) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned ${outcome} without CONTROL effect.`);
    }
    if (outcome === 'PEND') {
      if (stage !== 'BEFORE_MODEL_INVOKE' && stage !== 'BEFORE_CAPABILITY_INVOKE' && stage !== 'BEFORE_AGENT_TERMINAL') {
        throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook stage ${stage} does not support pending.`);
      }
      if (hookPendingInputIntent(result) === undefined) {
        throw this.lifecycleHookFailure(
          'LIFECYCLE_HOOK_RESULT_INVALID',
          `Lifecycle hook stage ${stage} returned pending without a pending input intent.`,
        );
      }
      return;
    }
    const mutation = hookMutation(result);
    if (mutation === undefined) {
      return;
    }
    if (!hasTransform) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook returned mutation without TRANSFORM effect.');
    }
    if (outcome === 'SKIP') {
      throw this.lifecycleHookFailure(
        'LIFECYCLE_HOOK_RESULT_INVALID',
        'Lifecycle hook returned SKIP with a mutation; SKIP must not include mutation.',
      );
    }
    this.assertKnownLifecycleMutation(stage, mutation);
  }

  private assertKnownLifecycleMutation(stage: LifecycleStage, mutation: JsonObject): void {
    const allowedFieldsByStage: Record<LifecycleStage, readonly string[]> = {
      BEFORE_REQUEST_ACCEPT: [],
      BEFORE_PLANNING: ['flowVariables', 'capabilityGeneratedMessages', 'capabilityContextPatch'],
      BEFORE_MODEL_INVOKE: [
        'messages',
        'tools',
        'temperature',
        'maxOutputTokens',
        'topP',
        'topK',
        'presencePenalty',
        'frequencyPenalty',
        'thinking',
        'toolChoice',
        'providerOptions',
        'timeoutMs',
        'maxRetries',
      ],
      AFTER_MODEL_RESULT: ['content', 'reasoning', 'toolCalls'],
      BEFORE_CAPABILITY_INVOKE: ['arguments', 'timeoutMs'],
      AFTER_CAPABILITY_RESULT: ['structuredPayload', 'generatedMessages', 'contextPatch'],
      BEFORE_CONTEXT_COMPACT: ['targetBudgetUnits'],
      AFTER_CONTEXT_COMPACT: ['content'],
      BEFORE_AGENT_TERMINAL: ['finalContent', 'toolCalls'],
    };
    const allowed = new Set(allowedFieldsByStage[stage]);
    if (allowed.size === 0 || Object.keys(mutation).some((key) => !allowed.has(key))) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an unsupported mutation for stage ${stage}.`);
    }
  }

  private applyMutation<TBoundary extends HookBoundary>(stage: LifecycleStage, boundary: TBoundary, mutation: JsonObject): TBoundary {
    const replacement = canonicalizeLifecycleMutation(stage, mutation, (code, message) => this.lifecycleHookFailure(code, message));
    return { ...boundary, ...replacement } as TBoundary;
  }

  private async emitHookInvoked(scope: HookExecutionScope, stage: LifecycleStage, event: HookInvokedEventInput): Promise<void> {
    if (scope.backgroundModelInvocation === true) {
      return;
    }
    try {
      const { run, context } = this.toRunContext(scope, stage);
      await this.deps.runState.emitEvent(run, context, {
        type: 'HOOK_INVOKED',
        inlinePayload: hookInvokedInlinePayload(stage, event),
      });
    } catch {
      // Observability sink failure MUST NOT rewrite hook truth or disrupt hook execution.
    }
  }

  private assertHookInvokedPayloadWithinLimit(stage: LifecycleStage, event: HookInvokedEventInput): void {
    if (Buffer.byteLength(JSON.stringify(hookInvokedInlinePayload(stage, event))) > maxTimelineInlinePayloadBytes) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook result exceeds the timeline inline payload limit.');
    }
  }

  private async createPendingInput(
    scope: HookExecutionScope,
    stage: Extract<LifecycleStage, 'BEFORE_MODEL_INVOKE' | 'BEFORE_CAPABILITY_INVOKE' | 'BEFORE_AGENT_TERMINAL'>,
    execution: { readonly definition: LifecycleHookDefinition; readonly activation?: AgentHookActivation },
    result: HookResult,
    boundary: HookBoundary,
  ): Promise<PendingInputRequest> {
    const pendingInputIntent = hookPendingInputIntent(result);
    if (this.deps.pendingInputStore === undefined || pendingInputIntent === undefined) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_PENDING_UNAVAILABLE', 'Lifecycle hook pending input infrastructure is unavailable.');
    }
    const { run, context } = this.toRunContext(scope, stage);
    const checkpoint = await this.deps.checkpointStore.loadCheckpoint({
      tenantId: scope.ownerScope.tenantId,
      subjectId: scope.ownerScope.subjectId,
      agentId: scope.coordinates.agentId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
    });
    if (checkpoint === undefined) {
      throw this.lifecycleHookFailure('LIFECYCLE_HOOK_PENDING_CHECKPOINT_MISSING', 'Lifecycle hook pending resume checkpoint is missing.');
    }
    const pendingInputId = brand<string, 'PendingInputId'>(this.deps.idFactory('pending'));
    const now = this.deps.clock();
    const created = await this.deps.pendingInputStore.createPendingInput({
      tenantId: scope.ownerScope.tenantId,
      subjectId: scope.ownerScope.subjectId,
      record: {
        tenantId: scope.ownerScope.tenantId,
        subjectId: scope.ownerScope.subjectId,
        agentId: scope.coordinates.agentId,
        pendingInputId,
        requestRunId: run.runId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        requestContextId: scope.requestContextId,
        checkpointId: checkpoint.checkpointId,
        kind: pendingInputIntent.kind,
        producerRef: lifecycleHookPendingProducerRef(stage, boundary),
        request: {
          id: pendingInputId,
          sessionId: run.sessionId,
          kind: pendingInputIntent.kind,
          questions: pendingInputIntent.questions,
          ...(pendingInputIntent.timeoutAt === undefined ? {} : { timeoutAt: pendingInputIntent.timeoutAt }),
        },
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
    });
    try {
      await this.deps.runState.emitEvent(run, context, {
        type: 'USER_INPUT_REQUIRED',
        inlinePayload: {
          pendingInputId: created.pendingInputId,
          id: created.pendingInputId,
          kind: created.kind,
          questions: JSON.parse(JSON.stringify(created.request.questions)) as JsonObject[keyof JsonObject],
          ...(created.request.timeoutAt === undefined ? {} : { timeoutAt: created.request.timeoutAt }),
          status: created.status,
        },
      });
    } finally {
      if (created.request.timeoutAt !== undefined) {
        this.deps.onPendingInputCreated?.(created.request.timeoutAt);
      }
    }
    return created.request;
  }

  private toRunContext(scope: HookExecutionScope, stage: LifecycleStage): { run: RequestRun; context: RequestContext } {
    const runId = scope.coordinates.requestRunId ?? brand<string, 'RequestRunId'>(`preaccept-${scope.coordinates.stageOccurrenceKey}`);
    const sessionId = scope.coordinates.sessionId ?? brand<string, 'SessionId'>(`preaccept-${scope.coordinates.stageOccurrenceKey}`);
    const requestId = scope.coordinates.requestId ?? brand<string, 'MessageId'>(`preaccept-${scope.coordinates.stageOccurrenceKey}`);
    const now = this.deps.clock();
    return {
      run: {
        runId,
        sessionId,
        requestId,
        agentId: scope.coordinates.agentId,
        agentVersion: scope.coordinates.agentVersion,
        agentAssemblyRef: scope.coordinates.agentAssemblyRef,
        attempt: 1,
        status: 'EXECUTING',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: now,
        updatedAt: now,
      },
      context: {
        requestContextId: scope.requestContextId,
        sessionId,
        requestId,
        runId,
        identityContext: {
          tenantId: scope.ownerScope.tenantId,
          subjectId: scope.ownerScope.subjectId,
          displayName: 'Lifecycle hook',
        },
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        agentId: scope.coordinates.agentId,
        agentVersion: scope.coordinates.agentVersion,
        agentAssemblyRef: scope.coordinates.agentAssemblyRef,
        agentTurnIndex: 0,
        activeStepId: scope.coordinates.stageOccurrenceKey,
        nextLifecycleStage: stage,
        toolCallStates: [],
        flowVariables: {},
      },
    };
  }

  private lifecycleHookFailure(code: string, message: string): AgentError {
    return new AgentError({ code, message, category: 'VALIDATION', retryable: false });
  }
}

function hookInvokedInlinePayload(stage: LifecycleStage, event: HookInvokedEventInput): JsonObject {
  return {
    hookInvocationId: event.hookInvocationId,
    hookId: event.hookId,
    stage,
    kind: event.kind,
    effects: [...event.effects],
    executionStrategy: event.executionStrategy,
    status: event.status,
    failureMode: event.failureMode,
    durationMs: Math.max(0, Number(event.finishedAt) - Number(event.startedAt)),
    idempotencyKey: event.idempotencyKey,
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    ...(event.resultSummary === undefined ? {} : { resultSummary: event.resultSummary }),
    ...(event.safeReason === undefined ? {} : { safeReason: event.safeReason }),
    ...(event.diagnosticCode === undefined ? {} : { diagnosticCode: event.diagnosticCode }),
    ...(event.candidateCount === undefined ? {} : { candidateCount: event.candidateCount }),
    ...(event.detailCount === undefined ? {} : { detailCount: event.detailCount }),
    ...(event.contextDisposition === undefined ? {} : { contextDisposition: event.contextDisposition }),
    ...(event.safeError === undefined ? {} : { safeErrorCode: event.safeError.code, safeErrorCategory: event.safeError.category }),
    ...(event.mutation === undefined ? {} : { mutationSummary: lifecycleMutationSummary(stage, event.mutation) }),
  };
}

export function materializeAgentHookSnapshots(
  assemblies: readonly AgentAssembly[],
  definitions: readonly LifecycleHookDefinition[],
): ReadonlyMap<string, AgentHookSnapshot> {
  const snapshots = new Map<string, AgentHookSnapshot>();
  for (const assembly of assemblies) {
    const byStage = new Map<LifecycleStage, readonly LifecycleHookExecution[]>();
    for (const stage of runtimeLifecycleStages) {
      byStage.set(stage, Object.freeze(materializeLifecycleHookStageExecutions(assembly, definitions, stage, lifecycleHookMaterializationFailure)));
    }
    snapshots.set(
      assembly.agentAssemblyRef,
      Object.freeze({
        agentAssemblyRef: assembly.agentAssemblyRef,
        byStage,
      }),
    );
  }
  return snapshots;
}

function materializeLifecycleHookStageExecutions(
  assembly: AgentAssembly,
  definitions: readonly LifecycleHookDefinition[],
  stage: LifecycleStage,
  failure: (code: string, message: string) => Error,
): readonly LifecycleHookExecution[] {
  const activationByHookId = new Map((assembly.hooks ?? []).map((activation, index) => [activation.hookId, { activation, index }] as const));
  const executions = definitions
    .filter((definition) => definition.supportedStages.includes(stage))
    .flatMap((definition) => {
      if (definition.kind === 'SYSTEM' && definition.order === undefined) {
        throw failure('LIFECYCLE_HOOK_DEFINITION_INVALID', `SYSTEM lifecycle hook is missing framework order: ${definition.hookId}.`);
      }
      const entry = activationByHookId.get(definition.hookId);
      const activation = entry?.activation;
      if (definition.kind === 'CUSTOM' && activation === undefined) {
        return [];
      }
      if (activation?.disabled === true || activation?.enabled === false) {
        return [];
      }
      if (activation?.stages !== undefined && !activation.stages.includes(stage)) {
        return [];
      }
      return [Object.freeze({ definition, ...(activation === undefined ? {} : { activation }), declarationOrdinal: entry?.index ?? 0 })];
    });
  assertNoCrossEffectGroupOrderTargets(executions, activationByHookId, failure);
  const systemExecutions = executions
    .filter((execution) => execution.definition.kind === 'SYSTEM')
    .sort((left, right) => {
      const orderDelta = left.definition.order! - right.definition.order!;
      return orderDelta === 0 ? left.definition.hookId.localeCompare(right.definition.hookId) : orderDelta;
    });
  const customImpactExecutions = executions.filter(
    (execution) => execution.definition.kind === 'CUSTOM' && !isObserveOnly(execution.definition.effects),
  );
  const customObserveExecutions = executions.filter(
    (execution) => execution.definition.kind === 'CUSTOM' && isObserveOnly(execution.definition.effects),
  );
  return [...systemExecutions, ...sortCustomLifecycleHookExecutions(customImpactExecutions, activationByHookId, failure), ...customObserveExecutions];
}

function assertNoCrossEffectGroupOrderTargets(
  executions: readonly LifecycleHookExecution[],
  activationByHookId: ReadonlyMap<string, { readonly activation: AgentHookActivation; readonly index: number }>,
  failure: (code: string, message: string) => Error,
): void {
  const definitionsByHookId = new Map(executions.map((execution) => [execution.definition.hookId, execution.definition] as const));
  const observeOnlyIds = new Set(
    executions.filter((execution) => isObserveOnly(execution.definition.effects)).map((execution) => execution.definition.hookId),
  );
  for (const execution of executions) {
    const sourceIsObserve = isObserveOnly(execution.definition.effects);
    const targets = [...hookOrderTargets(execution.activation?.order?.before), ...hookOrderTargets(execution.activation?.order?.after)];
    for (const target of targets) {
      if (target === execution.definition.hookId) {
        throw failure('LIFECYCLE_HOOK_ORDER_CYCLE', `Lifecycle hook order target references itself: ${target}.`);
      }
      const targetDefinition = definitionsByHookId.get(target);
      if (targetDefinition === undefined) {
        if (isActivationDisabled(activationByHookId.get(target)?.activation)) {
          throw failure('LIFECYCLE_HOOK_ORDER_TARGET_DISABLED', `Lifecycle hook order target is disabled: ${target}.`);
        }
        throw failure('LIFECYCLE_HOOK_ORDER_TARGET_UNKNOWN', `Lifecycle hook order target is not effective in this stage: ${target}.`);
      }
      if (targetDefinition.kind !== execution.definition.kind) {
        throw failure('LIFECYCLE_HOOK_ORDER_CROSS_KIND', `Lifecycle hook order target ${target} is in a different kind group.`);
      }
      const targetIsObserve = observeOnlyIds.has(target);
      if (sourceIsObserve !== targetIsObserve) {
        throw failure('LIFECYCLE_HOOK_ORDER_CROSS_EFFECT_GROUP', `Lifecycle hook order target ${target} is in a different effect group.`);
      }
    }
  }
}

function sortCustomLifecycleHookExecutions(
  executions: readonly LifecycleHookExecution[],
  activationByHookId: ReadonlyMap<string, { readonly activation: AgentHookActivation; readonly index: number }>,
  failure: (code: string, message: string) => Error,
): readonly LifecycleHookExecution[] {
  const byHookId = new Map(executions.map((execution) => [execution.definition.hookId, execution] as const));
  const outgoing = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();
  for (const execution of executions) {
    outgoing.set(execution.definition.hookId, new Set());
    incomingCount.set(execution.definition.hookId, 0);
  }
  const addEdge = (from: string, to: string): void => {
    if (from === to) {
      throw failure('LIFECYCLE_HOOK_ORDER_CYCLE', `Lifecycle hook order target references itself: ${from}.`);
    }
    if (!byHookId.has(from) || !byHookId.has(to)) {
      const missingHookId = byHookId.has(from) ? to : from;
      if (isActivationDisabled(activationByHookId.get(missingHookId)?.activation)) {
        throw failure('LIFECYCLE_HOOK_ORDER_TARGET_DISABLED', `Lifecycle hook order target is disabled: ${missingHookId}.`);
      }
      throw failure('LIFECYCLE_HOOK_ORDER_TARGET_UNKNOWN', `Lifecycle hook order target is not effective in this impact group.`);
    }
    const targets = outgoing.get(from)!;
    if (!targets.has(to)) {
      targets.add(to);
      incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);
    }
  };
  for (const execution of executions) {
    const hookId = execution.definition.hookId;
    for (const target of hookOrderTargets(execution.activation?.order?.before)) {
      addEdge(hookId, target);
    }
    for (const target of hookOrderTargets(execution.activation?.order?.after)) {
      addEdge(target, hookId);
    }
  }
  const compare = (left: LifecycleHookExecution, right: LifecycleHookExecution): number => {
    const leftOrder = left.activation?.order?.priority ?? left.declarationOrdinal;
    const rightOrder = right.activation?.order?.priority ?? right.declarationOrdinal;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.declarationOrdinal !== right.declarationOrdinal) {
      return left.declarationOrdinal - right.declarationOrdinal;
    }
    return left.definition.hookId.localeCompare(right.definition.hookId);
  };
  const ready = executions.filter((execution) => (incomingCount.get(execution.definition.hookId) ?? 0) === 0).sort(compare);
  const sorted: LifecycleHookExecution[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    sorted.push(current);
    for (const target of outgoing.get(current.definition.hookId) ?? []) {
      const nextCount = (incomingCount.get(target) ?? 0) - 1;
      incomingCount.set(target, nextCount);
      if (nextCount === 0) {
        ready.push(byHookId.get(target)!);
        ready.sort(compare);
      }
    }
  }
  if (sorted.length !== executions.length) {
    throw failure('LIFECYCLE_HOOK_ORDER_CYCLE', 'Lifecycle hook order contains a cycle.');
  }
  return sorted;
}

function isActivationDisabled(activation?: AgentHookActivation): boolean {
  return activation?.disabled === true || activation?.enabled === false;
}

function lifecycleHookMaterializationFailure(code: string, message: string): AgentError {
  return new AgentError({ code, message, category: 'VALIDATION', retryable: false });
}

function normalizeHookOutcome(result: HookResult): HookOutcome {
  return result.outcome;
}

function hookMutation(result: HookResult): JsonObject | undefined {
  return 'mutation' in result ? (result.mutation as unknown as JsonObject | undefined) : undefined;
}

function hookPendingInputIntent(result: HookResult): PendingInputIntent | undefined {
  return 'pendingInputIntent' in result ? result.pendingInputIntent : undefined;
}

function detachCapabilityResultArguments<TBoundary extends HookBoundary>(stage: LifecycleStage, boundary: TBoundary): TBoundary {
  if (stage !== 'AFTER_CAPABILITY_RESULT') {
    return boundary;
  }
  const capabilityResultBoundary = boundary as unknown as CapabilityResultBoundary;
  const detachedArguments = JSON.parse(JSON.stringify(capabilityResultBoundary.arguments)) as JsonObject;
  return {
    ...boundary,
    arguments: detachedArguments,
  } as TBoundary;
}

function detachHookResultSummary(result: HookResult, failure: (code: string, message: string) => AgentError): JsonObject | undefined {
  if (result.resultSummary === undefined) {
    return undefined;
  }
  try {
    if (!isCanonicalJsonObject(result.resultSummary)) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook returned an invalid resultSummary.');
    }
    const detached = JSON.parse(JSON.stringify(result.resultSummary)) as unknown;
    if (!isCanonicalJsonObject(detached)) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook returned an invalid resultSummary.');
    }
    return detached;
  } catch {
    throw failure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook returned an invalid resultSummary.');
  }
}

function isCanonicalJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isCanonicalJsonValue(value);
}

function isCanonicalJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    if (
      Reflect.ownKeys(value).some(
        (key) => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || !isEnumerableDataProperty(value, key)),
      ) ||
      Object.keys(value).length !== value.length
    ) {
      return false;
    }
  } else if (!isPlainObject(value) || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !isEnumerableDataProperty(value, key))) {
    return false;
  }
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isCanonicalJsonValue(item, ancestors))
    : Object.values(value).every((item) => isCanonicalJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEnumerableDataProperty(value: object, key: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, 'value');
}

function isObserveOnly(effects: readonly HookEffect[]): boolean {
  return effects.length === 1 && effects[0] === 'OBSERVE';
}

function observeOnlyLifecycleHookDiagnosticCode(effects: readonly HookEffect[], result: HookResult): string | undefined {
  if (!isObserveOnly(effects)) {
    return undefined;
  }
  if (hookMutation(result) !== undefined) {
    return 'OBSERVE_CONTROL_IGNORED';
  }
  if (result.outcome === 'DENY' || result.outcome === 'BLOCK' || result.outcome === 'PEND') {
    return 'OBSERVE_CONTROL_IGNORED';
  }
  return undefined;
}

function lifecycleMutationSummary(stage: LifecycleStage, mutation: JsonObject): string {
  const fields = Object.keys(mutation).sort();
  const kind = lifecycleMutationKindByStage(stage) ?? 'unknown';
  return fields.length === 0 ? `${kind}:NO_FIELDS` : `${kind}:REPLACE:${fields.join(',')}`;
}

function lifecycleMutationKindByStage(stage: LifecycleStage): string | undefined {
  switch (stage) {
    case 'BEFORE_PLANNING':
      return 'planning';
    case 'BEFORE_MODEL_INVOKE':
      return 'model.invoke';
    case 'AFTER_MODEL_RESULT':
      return 'model.result';
    case 'BEFORE_CAPABILITY_INVOKE':
      return 'capability.invoke';
    case 'AFTER_CAPABILITY_RESULT':
      return 'capability.result';
    case 'BEFORE_CONTEXT_COMPACT':
      return 'context.compact.before';
    case 'AFTER_CONTEXT_COMPACT':
      return 'context.compact.after';
    case 'BEFORE_AGENT_TERMINAL':
      return 'agent.terminal';
    case 'BEFORE_REQUEST_ACCEPT':
      return undefined;
    default: {
      const exhaustive: never = stage;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function hookOrderTargets(targets?: string | readonly string[]): readonly string[] {
  return targets === undefined ? [] : typeof targets === 'string' ? [targets] : [...targets];
}

function lifecycleHookPendingProducerRef(stage: LifecycleStage, boundary: HookBoundary): PendingInputRecord['producerRef'] {
  if (stage !== 'BEFORE_CAPABILITY_INVOKE') {
    return { kind: 'LIFECYCLE_HOOK', stage };
  }
  const candidate = boundary as Record<string, unknown>;
  const capabilityId = candidate['capabilityId'];
  const toolCallId = candidate['toolCallId'];
  const args = candidate['arguments'];
  if (typeof capabilityId !== 'string' || typeof toolCallId !== 'string' || args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { kind: 'LIFECYCLE_HOOK', stage };
  }
  return {
    kind: 'LIFECYCLE_HOOK',
    stage,
    toolCall: {
      capabilityId: capabilityId as CapabilityId,
      toolCallId: toolCallId as ToolCallId,
      arguments: args as JsonObject,
    },
  };
}

function lifecycleHookIdempotencyKey(coordinates: LifecycleHookInvocationCoordinates, hookId: string): string {
  return `${coordinates.stageOccurrenceKey}:${hookId}`;
}

function lifecycleHookSafeReason(error: unknown): string {
  if (error instanceof AgentError) {
    return error.code;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'LIFECYCLE_HOOK_FAILED';
}

function lifecycleHookSafeError(error: unknown): SafeError {
  if (error instanceof AgentError) {
    return {
      code: error.code,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
    };
  }
  if (error instanceof Error) {
    return {
      code: 'LIFECYCLE_HOOK_FAILED',
      message: error.message,
      category: 'INTERNAL',
      retryable: false,
    };
  }
  return {
    code: 'LIFECYCLE_HOOK_FAILED',
    message: 'Lifecycle hook failed.',
    category: 'INTERNAL',
    retryable: false,
  };
}

function trustedLifecycleHookSafeError(error: unknown): SafeError {
  if (error instanceof AgentError && error.code.startsWith('LIFECYCLE_HOOK_')) {
    return {
      code: error.code,
      message: 'Trusted terminal lifecycle hook failed.',
      category: error.category,
      retryable: false,
    };
  }
  return {
    code: 'LIFECYCLE_HOOK_FAILED',
    message: 'Trusted terminal lifecycle hook failed.',
    category: 'INTERNAL',
    retryable: false,
  };
}

function isTrustedTerminalHookDiagnostic(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const diagnostic = value as Record<string, unknown>;
  if (
    Object.keys(diagnostic).some(
      (key) =>
        key !== 'diagnosticCode' &&
        key !== 'candidateCount' &&
        key !== 'detailCount' &&
        key !== 'contextDisposition' &&
        key !== 'characteristicsDisposition' &&
        key !== 'characteristicsDiagnosticCode',
    ) ||
    typeof diagnostic['diagnosticCode'] !== 'string' ||
    !/^[A-Z][A-Z0-9_]{0,95}$/u.test(diagnostic['diagnosticCode'])
  ) {
    return false;
  }
  if (!isTrustedTerminalHookCount(diagnostic['candidateCount']) || !isTrustedTerminalHookCount(diagnostic['detailCount'])) {
    return false;
  }
  const disposition = diagnostic['contextDisposition'];
  if (disposition !== undefined && disposition !== 'L2_CONTEXT' && disposition !== 'L1_CONTEXT' && disposition !== 'NO_CONTEXT') {
    return false;
  }
  const characteristicsDisposition = diagnostic['characteristicsDisposition'];
  if (
    characteristicsDisposition !== undefined &&
    characteristicsDisposition !== 'CHARACTERISTICS_CONTEXT' &&
    characteristicsDisposition !== 'NO_CONTEXT'
  ) {
    return false;
  }
  const characteristicsDiagnosticCode = diagnostic['characteristicsDiagnosticCode'];
  return (
    characteristicsDiagnosticCode === undefined ||
    (typeof characteristicsDiagnosticCode === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(characteristicsDiagnosticCode))
  );
}

function isTrustedTerminalHookCount(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10);
}

function lifecycleHookInvocationStatus(error: unknown): HookInvocationStatus {
  if (error instanceof AgentError && error.code === 'LIFECYCLE_HOOK_TIMEOUT') {
    return 'TIMEOUT';
  }
  if (error instanceof AgentError && error.code === 'LIFECYCLE_HOOK_RESULT_INVALID') {
    return 'INVALID_RESULT';
  }
  return 'FAILED';
}

function lifecycleHookAbortError(): AgentError {
  return new AgentError({
    code: 'LIFECYCLE_HOOK_ABORTED',
    message: 'Lifecycle hook invocation was canceled.',
    category: 'CANCELED',
    retryable: false,
  });
}

function lifecycleHookTimeoutError(): AgentError {
  return new AgentError({
    code: 'LIFECYCLE_HOOK_TIMEOUT',
    message: 'Lifecycle hook timed out.',
    category: 'TIMEOUT',
    retryable: false,
  });
}

function isLifecycleHookAbort(error: unknown): boolean {
  return error instanceof AgentError && error.code === 'LIFECYCLE_HOOK_ABORTED';
}

function canonicalizeLifecycleMutation(
  stage: LifecycleStage,
  mutation: JsonObject,
  failure: (code: string, message: string) => AgentError,
): JsonObject {
  const output: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(mutation)) {
    if (value === undefined) {
      continue;
    }
    output[field] = canonicalizeLifecycleMutationField(stage, field, value, failure);
  }
  return output as JsonObject;
}

function canonicalizeLifecycleMutationField(
  stage: LifecycleStage,
  field: string,
  value: unknown,
  failure: (code: string, message: string) => AgentError,
): unknown {
  if (field === 'content' || field === 'reasoning' || field === 'finalContent') {
    if (typeof value !== 'string') {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
    }
    return value;
  }
  if (field === 'timeoutMs' || field === 'targetBudgetUnits' || field === 'maxOutputTokens' || field === 'topK') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
    }
    return value;
  }
  if (field === 'maxRetries') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
    }
    return value;
  }
  if (field === 'temperature' || field === 'topP' || field === 'presencePenalty' || field === 'frequencyPenalty') {
    const minimum = field === 'temperature' || field === 'topP' ? 0 : -2;
    const maximum = field === 'topP' ? 1 : 2;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
    }
    return value;
  }
  if (field === 'thinking') {
    if (
      !isJsonObjectValue(value) ||
      Object.keys(value).some((key) => key !== 'depth') ||
      (value['depth'] !== 'OFF' && value['depth'] !== 'LOW' && value['depth'] !== 'MEDIUM' && value['depth'] !== 'HIGH')
    ) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook returned an invalid thinking mutation.');
    }
    return detachJsonValue(value, field, failure);
  }
  if (field === 'toolChoice') {
    if (value !== 'AUTO' && value !== 'NONE' && value !== 'REQUIRED') {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', 'Lifecycle hook returned an invalid toolChoice mutation.');
    }
    return value;
  }
  if (
    field === 'messages' ||
    field === 'tools' ||
    field === 'toolCalls' ||
    field === 'generatedMessages' ||
    field === 'capabilityGeneratedMessages'
  ) {
    if (!Array.isArray(value)) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
    }
    return detachJsonValue(value, field, failure);
  }
  if (
    field === 'providerOptions' ||
    field === 'arguments' ||
    field === 'structuredPayload' ||
    field === 'contextPatch' ||
    field === 'flowVariables' ||
    field === 'capabilityContextPatch'
  ) {
    if (!isJsonObjectValue(value)) {
      throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
    }
    return detachJsonValue(value, field, failure);
  }
  return detachJsonValue(value, field, failure);
}

function detachJsonValue(value: unknown, field: string, failure: (code: string, message: string) => AgentError): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned a non-canonical ${field} mutation.`);
  }
  if (serialized === undefined || serialized.length > 1_000_000) {
    throw failure('LIFECYCLE_HOOK_RESULT_INVALID', `Lifecycle hook returned an invalid ${field} mutation.`);
  }
  return JSON.parse(serialized) as unknown;
}

function isJsonObjectValue(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createLifecycleHookAbort(
  timeoutMs: number,
  ownerSignal?: AbortSignal,
): {
  readonly signal: AbortSignal;
  readonly aborted: Promise<never>;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let parentAbortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const abortWith = (error: AgentError): void => {
      if (!controller.signal.aborted) {
        controller.abort(error);
      }
      reject(error);
    };
    if (ownerSignal?.aborted === true) {
      abortWith(lifecycleHookAbortError());
      return;
    }
    parentAbortListener = () => abortWith(lifecycleHookAbortError());
    ownerSignal?.addEventListener('abort', parentAbortListener, { once: true });
    timer = setTimeout(() => abortWith(lifecycleHookTimeoutError()), timeoutMs);
  });
  return {
    signal: controller.signal,
    aborted,
    dispose() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (parentAbortListener !== undefined) {
        ownerSignal?.removeEventListener('abort', parentAbortListener);
      }
    },
  };
}

function shortHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
