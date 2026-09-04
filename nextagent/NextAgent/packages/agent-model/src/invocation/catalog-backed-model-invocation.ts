import type { JsonObject } from '@nextagent/agent-common';
import type {
  ModelCatalogQueryService,
  ModelFinalResult,
  ModelInvocationRequest,
  ModelInvocationService,
  ModelProfile,
  ResolvedModelConfiguration,
} from '@nextagent/agent-contracts/model';

import type { ModelRuntimeBinding, ModelRuntimeRegistry } from '../runtime/model-runtime-registry.js';
import { emitModelStreamDelta, ModelStreamConsumerError, safeModelInvocationFailure } from './invocation-failure.js';

export function createCatalogBackedModelInvocationService(bindings: ModelRuntimeRegistry, catalog: ModelCatalogQueryService): ModelInvocationService {
  const service: ModelInvocationService = {
    async complete(request, signal) {
      try {
        let binding = bindings.get(request.modelId);
        let usedFallback = false;
        if (binding === undefined) {
          binding = findFallbackBinding(bindings);
          usedFallback = true;
        }
        if (binding === undefined) {
          return unavailableResult('MODEL_NOT_CONFIGURED', 'Selected model is not configured.', false);
        }
        const catalogModelId = usedFallback ? binding.definition.modelId : request.modelId;
        const entry = await catalog.get(catalogModelId, signal);
        if (entry?.availability !== 'AVAILABLE') {
          return unavailableResult('MODEL_UNAVAILABLE', 'Selected model is unavailable.', true);
        }
        return await binding.runtime.invocationService.complete(effectiveRequest(request, binding.definition, entry.configuration), signal);
      } catch (error) {
        return safeModelInvocationFailure(error, signal);
      }
    },
    async stream(request, signal, onDelta) {
      try {
        let binding = bindings.get(request.modelId);
        let usedFallback = false;
        if (binding === undefined) {
          binding = findFallbackBinding(bindings);
          usedFallback = true;
        }
        if (binding === undefined) {
          return unavailableResult('MODEL_NOT_CONFIGURED', 'Selected model is not configured.', false);
        }
        const catalogModelId = usedFallback ? binding.definition.modelId : request.modelId;
        const entry = await catalog.get(catalogModelId, signal);
        if (entry?.availability !== 'AVAILABLE') {
          return unavailableResult('MODEL_UNAVAILABLE', 'Selected model is unavailable.', true);
        }
        return await binding.runtime.invocationService.stream(effectiveRequest(request, binding.definition, entry.configuration), signal, (delta) =>
          emitModelStreamDelta(onDelta, delta),
        );
      } catch (error) {
        if (error instanceof ModelStreamConsumerError) {
          throw error.cause;
        }
        return safeModelInvocationFailure(error, signal);
      }
    },
  };
  return Object.freeze(service);
}

function findFallbackBinding(bindings: ModelRuntimeRegistry): ModelRuntimeBinding | undefined {
  const all = bindings.list();
  return all.length > 0 ? all[0] : undefined;
}

function unavailableResult(code: string, message: string, retryable: boolean): ModelFinalResult {
  return {
    content: '',
    safeError: { code, message, category: 'UNAVAILABLE', retryable },
  };
}

function effectiveRequest(request: ModelInvocationRequest, profile: ModelProfile, configuration: ResolvedModelConfiguration): ModelInvocationRequest {
  const providerOptions = shallowMerge(profile.providerOptions, request.providerOptions);
  return {
    invocationScope: request.invocationScope,
    modelId: request.modelId,
    contextWindowTokens: configuration.contextWindowTokens,
    messages: request.messages,
    tools: request.tools,
    temperature: request.temperature ?? configuration.temperature,
    maxOutputTokens: request.maxOutputTokens ?? configuration.maxOutputTokens,
    topP: request.topP ?? configuration.topP,
    ...((request.topK ?? configuration.topK) === undefined ? {} : { topK: request.topK ?? configuration.topK }),
    ...((request.presencePenalty ?? configuration.presencePenalty) === undefined
      ? {}
      : { presencePenalty: request.presencePenalty ?? configuration.presencePenalty }),
    ...((request.frequencyPenalty ?? configuration.frequencyPenalty) === undefined
      ? {}
      : { frequencyPenalty: request.frequencyPenalty ?? configuration.frequencyPenalty }),
    ...((request.thinking ?? configuration.thinking) === undefined ? {} : { thinking: request.thinking ?? configuration.thinking }),
    ...((request.toolChoice ?? configuration.toolChoice) === undefined ? {} : { toolChoice: request.toolChoice ?? configuration.toolChoice }),
    ...(providerOptions === undefined ? {} : { providerOptions }),
    timeoutMs: request.timeoutMs ?? configuration.defaultTimeoutMs,
    maxRetries: request.maxRetries ?? configuration.defaultMaxRetries,
  };
}

function shallowMerge(base?: JsonObject, override?: JsonObject): JsonObject | undefined {
  if (base === undefined && override === undefined) {
    return undefined;
  }
  return { ...(base ?? {}), ...(override ?? {}) };
}
