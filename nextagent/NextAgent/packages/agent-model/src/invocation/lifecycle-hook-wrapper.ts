import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import { LifecycleHookInterruptionError, type HookBoundaryByStage, type LifecycleHookInvocationPort } from '@nextagent/agent-contracts/runtime';
import { validateModelInvocationPreconditions } from './preconditions.js';
import { emitModelStreamDelta, ModelStreamConsumerError, safeModelInvocationFailure } from './invocation-failure.js';
import { isModelStreamDelta, isModelFinalResult, normalizeModelTerminalResult } from './result-validation.js';

export function createLifecycleHookModelInvocationService(inner: ModelInvocationService, hook: LifecycleHookInvocationPort): ModelInvocationService {
  return {
    async complete(request, signal) {
      const invalid = validateModelInvocationPreconditions(request, signal);
      if (invalid !== undefined) {
        return invalid;
      }
      try {
        const effectiveRequest = await invokeBeforeModelHook(hook, request, signal);
        const modelStartedAt = performance.now();
        const result = normalizeModelTerminalResult(await inner.complete(effectiveRequest, signal));
        const modelE2ELatencyMs = durationMs(modelStartedAt);
        return normalizeModelTerminalResult(
          await invokeAfterModelHook(
            hook,
            effectiveRequest,
            result,
            {
              ...(containsModelFeedback(result) ? { firstContentLatencyMs: modelE2ELatencyMs } : {}),
              modelE2ELatencyMs,
            },
            signal,
          ),
        );
      } catch (error) {
        if (error instanceof LifecycleHookInterruptionError) {
          throw error;
        }
        return safeModelInvocationFailure(error, signal);
      }
    },
    async stream(request, signal, onDelta) {
      const invalid = validateModelInvocationPreconditions(request, signal);
      if (invalid !== undefined) {
        return invalid;
      }
      try {
        const effectiveRequest = await invokeBeforeModelHook(hook, request, signal);
        const modelStartedAt = performance.now();
        let firstContentLatencyMs: number | undefined;
        let invalidDelta = false;
        const result = await inner.stream(effectiveRequest, signal, async (delta) => {
          if (!isModelStreamDelta(delta)) {
            invalidDelta = true;
            return;
          }
          if (firstContentLatencyMs === undefined && containsModelFeedback(delta)) {
            firstContentLatencyMs = durationMs(modelStartedAt);
          }
          await emitModelStreamDelta(onDelta, delta);
        });
        if (invalidDelta || !isModelFinalResult(result)) {
          return invalidStreamTerminal();
        }
        const normalized = normalizeModelTerminalResult(result);
        if (firstContentLatencyMs === undefined && containsModelFeedback(normalized)) {
          firstContentLatencyMs = durationMs(modelStartedAt);
        }
        return normalizeModelTerminalResult(
          await invokeAfterModelHook(
            hook,
            effectiveRequest,
            normalized,
            {
              ...(firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs }),
              modelE2ELatencyMs: durationMs(modelStartedAt),
            },
            signal,
          ),
        );
      } catch (error) {
        if (error instanceof ModelStreamConsumerError) {
          throw error.cause;
        }
        if (error instanceof LifecycleHookInterruptionError) {
          throw error;
        }
        return safeModelInvocationFailure(error, signal);
      }
    },
  };
}

async function invokeBeforeModelHook(
  hook: LifecycleHookInvocationPort,
  request: ModelInvocationRequest,
  signal: AbortSignal,
): Promise<ModelInvocationRequest> {
  const boundary = createReadonlyHookView<HookBoundaryByStage['BEFORE_MODEL_INVOKE']>({
    stepId: request.invocationScope.operationId,
    modelId: request.modelId,
    ...(request.contextWindowTokens === undefined ? {} : { contextWindowTokens: request.contextWindowTokens }),
    toolCount: request.tools.length,
    safeModelRequestSummary: `messages=${request.messages.length},tools=${request.tools.length}`,
    messages: request.messages,
    tools: request.tools,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    ...(request.topP === undefined ? {} : { topP: request.topP }),
    ...(request.topK === undefined ? {} : { topK: request.topK }),
    ...(request.presencePenalty === undefined ? {} : { presencePenalty: request.presencePenalty }),
    ...(request.frequencyPenalty === undefined ? {} : { frequencyPenalty: request.frequencyPenalty }),
    ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
    ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice }),
    ...(request.providerOptions === undefined ? {} : { providerOptions: request.providerOptions }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
  });
  const result = await hook.invoke(
    {
      stage: 'BEFORE_MODEL_INVOKE',
      coordinates: hookCoordinates(request, 'BEFORE_MODEL_INVOKE'),
      ownerScope: ownerScopeFromRequest(request),
      boundary,
    },
    signal,
  );
  if (result.status === 'INTERRUPT') {
    throw new LifecycleHookInterruptionError(result.interruption);
  }
  return {
    invocationScope: request.invocationScope,
    modelId: request.modelId,
    ...(request.contextWindowTokens === undefined ? {} : { contextWindowTokens: request.contextWindowTokens }),
    messages: result.boundary.messages === boundary.messages ? request.messages : (result.boundary.messages ?? request.messages),
    tools: result.boundary.tools === boundary.tools ? request.tools : (result.boundary.tools ?? request.tools),
    ...inferenceFields(result.boundary, boundary, request),
    ...((result.boundary.timeoutMs ?? request.timeoutMs) === undefined ? {} : { timeoutMs: result.boundary.timeoutMs ?? request.timeoutMs }),
    ...((result.boundary.maxRetries ?? request.maxRetries) === undefined ? {} : { maxRetries: result.boundary.maxRetries ?? request.maxRetries }),
  };
}

async function invokeAfterModelHook(
  hook: LifecycleHookInvocationPort,
  request: ModelInvocationRequest,
  result: ModelFinalResult,
  timing: ModelInvocationTiming,
  signal: AbortSignal,
): Promise<ModelFinalResult> {
  if (result.safeError !== undefined) {
    return result;
  }
  const boundary = createReadonlyHookView<HookBoundaryByStage['AFTER_MODEL_RESULT']>({
    stepId: request.invocationScope.operationId,
    modelId: request.modelId,
    toolCallCount: result.toolCalls?.length ?? 0,
    safeAssistantOutputSummary: `visible-text chars=${result.content.length} toolCalls=${result.toolCalls?.length ?? 0}`,
    ...(timing.firstContentLatencyMs === undefined ? {} : { firstContentLatencyMs: timing.firstContentLatencyMs }),
    modelE2ELatencyMs: timing.modelE2ELatencyMs,
    ...(result.usage === undefined ? {} : { usage: { ...result.usage } }),
    content: result.content,
    ...(result.reasoning === undefined ? {} : { reasoning: result.reasoning }),
    ...(result.toolCalls === undefined ? {} : { toolCalls: result.toolCalls }),
    ...(result.providerResponseId === undefined ? {} : { providerResponseId: result.providerResponseId }),
  });
  const hookResult = await hook.invoke(
    {
      stage: 'AFTER_MODEL_RESULT',
      coordinates: hookCoordinates(request, 'AFTER_MODEL_RESULT'),
      ownerScope: ownerScopeFromRequest(request),
      boundary,
    },
    signal,
  );
  if (hookResult.status === 'INTERRUPT') {
    throw new LifecycleHookInterruptionError(hookResult.interruption);
  }
  const toolCalls = hookResult.boundary.toolCalls === boundary.toolCalls ? result.toolCalls : hookResult.boundary.toolCalls;
  return {
    ...result,
    content: hookResult.boundary.content ?? result.content,
    ...(hookResult.boundary.reasoning === undefined ? {} : { reasoning: hookResult.boundary.reasoning }),
    ...(toolCalls === undefined ? {} : { toolCalls }),
  };
}

interface ModelInvocationTiming {
  readonly firstContentLatencyMs?: number;
  readonly modelE2ELatencyMs: number;
}

function containsModelFeedback(value: ModelStreamDelta | ModelFinalResult): boolean {
  return (
    (value.content?.length ?? 0) > 0 ||
    (value.reasoning?.length ?? 0) > 0 ||
    ('toolCall' in value && value.toolCall !== undefined) ||
    ('toolCalls' in value && (value.toolCalls?.length ?? 0) > 0)
  );
}

function durationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function inferenceFields(
  boundary: HookBoundaryByStage['BEFORE_MODEL_INVOKE'],
  originalBoundary: HookBoundaryByStage['BEFORE_MODEL_INVOKE'],
  request: ModelInvocationRequest,
): Pick<
  ModelInvocationRequest,
  'temperature' | 'maxOutputTokens' | 'topP' | 'topK' | 'presencePenalty' | 'frequencyPenalty' | 'thinking' | 'toolChoice' | 'providerOptions'
> {
  const thinking = boundary.thinking === originalBoundary.thinking ? request.thinking : boundary.thinking;
  const toolChoice = request.toolChoice === 'NONE' ? 'NONE' : boundary.toolChoice;
  const providerOptions = boundary.providerOptions === originalBoundary.providerOptions ? request.providerOptions : boundary.providerOptions;
  const effectiveProviderOptions =
    providerOptions === undefined
      ? undefined
      : providerOptions === request.providerOptions
        ? providerOptions
        : {
            ...request.providerOptions,
            ...providerOptions,
          };
  return {
    ...(boundary.temperature === undefined ? {} : { temperature: boundary.temperature }),
    ...(boundary.maxOutputTokens === undefined ? {} : { maxOutputTokens: boundary.maxOutputTokens }),
    ...(boundary.topP === undefined ? {} : { topP: boundary.topP }),
    ...(boundary.topK === undefined ? {} : { topK: boundary.topK }),
    ...(boundary.presencePenalty === undefined ? {} : { presencePenalty: boundary.presencePenalty }),
    ...(boundary.frequencyPenalty === undefined ? {} : { frequencyPenalty: boundary.frequencyPenalty }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(effectiveProviderOptions === undefined ? {} : { providerOptions: effectiveProviderOptions }),
  };
}

function createReadonlyHookView<T extends object>(source: T): T {
  const proxies = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    const existing = proxies.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const target = Array.isArray(value) ? [...value] : { ...(value as Record<PropertyKey, unknown>) };
    const proxy = new Proxy(target, {
      get(current, property, receiver) {
        return wrap(Reflect.get(current, property, receiver));
      },
      getOwnPropertyDescriptor(current, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
        if (descriptor === undefined || !('value' in descriptor)) {
          return descriptor;
        }
        return {
          ...descriptor,
          value: wrap(descriptor.value),
        };
      },
      set() {
        throw new TypeError('Lifecycle hook boundaries are immutable.');
      },
      deleteProperty() {
        throw new TypeError('Lifecycle hook boundaries are immutable.');
      },
      defineProperty() {
        throw new TypeError('Lifecycle hook boundaries are immutable.');
      },
      setPrototypeOf() {
        throw new TypeError('Lifecycle hook boundaries are immutable.');
      },
      preventExtensions() {
        throw new TypeError('Lifecycle hook boundaries are immutable.');
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };
  return wrap(source) as T;
}

function hookCoordinates(request: ModelInvocationRequest, stage: 'BEFORE_MODEL_INVOKE' | 'AFTER_MODEL_RESULT') {
  const scope = request.invocationScope;
  return {
    ...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }),
    ...(scope.requestId === undefined ? {} : { requestId: scope.requestId }),
    ...(scope.runId === undefined ? {} : { requestRunId: scope.runId }),
    agentId: scope.agentId,
    agentVersion: scope.agentVersion,
    agentAssemblyRef: scope.agentAssemblyRef,
    stageOccurrenceKey: `${scope.operationId}:${request.modelId}:${stage}`,
  };
}

function ownerScopeFromRequest(request: ModelInvocationRequest) {
  return {
    tenantId: request.invocationScope.tenantId,
    subjectId: request.invocationScope.subjectId,
  };
}

function invalidStreamTerminal(): ModelFinalResult {
  return {
    content: '',
    safeError: {
      code: 'MODEL_STREAM_TERMINAL_INVALID',
      message: 'Model stream did not produce a valid terminal result.',
      category: 'INTERNAL',
      retryable: false,
    },
  };
}
