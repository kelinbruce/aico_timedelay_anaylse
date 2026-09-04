import { isHttpUrl } from '@nextagent/agent-common';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelProviderProfile } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';

import type { CredentialResolver } from '../../credentials/credential-resolver.js';
import { validateModelInvocationPreconditions } from '../../invocation/preconditions.js';
import type { ModelProviderRuntimeRegistration } from '../../runtime/model-provider-runtime.js';
import { createSafeModelError } from '../shared/error-mapper.js';

export interface OpenAICompatibleRegistrationOptions {
  readonly credentialResolver: CredentialResolver;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly fetch?: typeof globalThis.fetch;
}

interface OpenAICompatibleImplementationModule {
  readonly createOpenAICompatibleModelInvocationService: (
    profile: ModelProviderProfile,
    options: OpenAICompatibleRegistrationOptions,
  ) => ModelInvocationService;
}

const implementationModuleSpecifier = './openai-compatible-provider.js';

export function createOpenAICompatibleModelProviderRegistration(options: OpenAICompatibleRegistrationOptions): ModelProviderRuntimeRegistration {
  return {
    providerId: 'openai-compatible',
    createRuntime(profile) {
      if (profile.providerId !== 'openai-compatible') {
        throw new Error('OpenAI-compatible provider access configuration is invalid.');
      }
      if (profile.baseUrl === undefined) {
        return { invocationService: createUnconfiguredModelInvocationService() };
      }
      if (!isHttpUrl(profile.baseUrl)) {
        throw new Error('OpenAI-compatible provider access configuration is invalid.');
      }
      return { invocationService: createLazyInvocationService(profile, options) };
    },
  };
}

function createLazyInvocationService(profile: ModelProviderProfile, options: OpenAICompatibleRegistrationOptions): ModelInvocationService {
  const loadService = async (): Promise<{ readonly service: ModelInvocationService } | { readonly result: ModelFinalResult }> => {
    let loaded: unknown;
    try {
      loaded = await import(implementationModuleSpecifier);
    } catch {
      return { result: implementationUnavailable() };
    }
    if (!isOpenAICompatibleImplementationModule(loaded)) {
      return { result: implementationUnavailable() };
    }
    return { service: loaded.createOpenAICompatibleModelInvocationService(profile, options) };
  };
  return {
    async complete(request, signal) {
      const preconditionFailure = validateModelInvocationPreconditions(request, signal);
      if (preconditionFailure !== undefined) {
        return preconditionFailure;
      }
      const loaded = await loadService();
      return 'service' in loaded ? await loaded.service.complete(request, signal) : loaded.result;
    },
    async stream(request, signal, onDelta) {
      const preconditionFailure = validateModelInvocationPreconditions(request, signal);
      if (preconditionFailure !== undefined) {
        return preconditionFailure;
      }
      const loaded = await loadService();
      return 'service' in loaded ? await loaded.service.stream(request, signal, onDelta) : loaded.result;
    },
  };
}

function isOpenAICompatibleImplementationModule(value: unknown): value is OpenAICompatibleImplementationModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as OpenAICompatibleImplementationModule).createOpenAICompatibleModelInvocationService === 'function'
  );
}

function implementationUnavailable(): ModelFinalResult {
  return {
    content: '',
    safeError: createSafeModelError(
      'MODEL_PROVIDER_IMPLEMENTATION_UNAVAILABLE',
      'OpenAI-compatible provider invocation implementation is unavailable.',
      'UNAVAILABLE',
    ),
  };
}

function createUnconfiguredModelInvocationService(): ModelInvocationService {
  const unavailable = () => ({
    content: '',
    safeError: createSafeModelError('MODEL_UNAVAILABLE', 'Selected model is unavailable.', 'UNAVAILABLE'),
  });
  return {
    async complete(request: ModelInvocationRequest, signal: AbortSignal) {
      return validateModelInvocationPreconditions(request, signal) ?? unavailable();
    },
    async stream(request: ModelInvocationRequest, signal: AbortSignal) {
      return validateModelInvocationPreconditions(request, signal) ?? unavailable();
    },
  };
}
