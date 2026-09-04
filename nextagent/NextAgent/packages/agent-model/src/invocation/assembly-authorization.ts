import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelProviderProfile } from '@nextagent/agent-contracts/model';

import { validateModelInvocationPreconditions } from './preconditions.js';

export function createAssemblyAuthorizedModelInvocationService(
  inner: ModelInvocationService,
  assemblyRegistry: AgentAssemblyRegistry,
  modelProfiles?: readonly ModelProviderProfile[],
): ModelInvocationService {
  const isModelGateway = Array.isArray(modelProfiles) && modelProfiles.some((p) => p.providerId === 'model-gateway');
  return {
    async complete(request, signal) {
      const failure = await authorize(request, signal, assemblyRegistry, isModelGateway);
      return failure ?? inner.complete(request, signal);
    },
    async stream(request, signal, onDelta) {
      const failure = await authorize(request, signal, assemblyRegistry, isModelGateway);
      if (failure !== undefined) {
        return failure;
      }
      return await inner.stream(request, signal, onDelta);
    },
  };
}

async function authorize(
  request: ModelInvocationRequest,
  signal: AbortSignal,
  assemblyRegistry: AgentAssemblyRegistry,
  isModelGateway: boolean,
): Promise<ModelFinalResult | undefined> {
  const invalid = validateModelInvocationPreconditions(request, signal);
  if (invalid !== undefined) {
    return invalid;
  }
  try {
    const assembly = await assemblyRegistry.require(request.invocationScope.agentId, request.invocationScope.agentVersion);
    if (assembly.agentAssemblyRef !== request.invocationScope.agentAssemblyRef) {
      return authorizationFailure();
    }
    // When provider is model-gateway, skip modelId eligibility check
    if (isModelGateway && !assembly.modelIds.includes(request.modelId)) {
      return undefined;
    }
    if (!assembly.modelIds.includes(request.modelId)) {
      return authorizationFailure();
    }
    return undefined;
  } catch {
    return authorizationFailure();
  }
}

function authorizationFailure(): ModelFinalResult {
  return {
    content: '',
    safeError: {
      code: 'MODEL_NOT_ACTIVATED',
      message: 'Selected model is not activated for the accepted Agent assembly.',
      category: 'AUTHORIZATION',
      retryable: false,
    },
  };
}
