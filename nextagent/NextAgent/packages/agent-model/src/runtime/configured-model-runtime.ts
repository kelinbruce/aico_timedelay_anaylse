import { AgentError } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelCatalogQueryService, ModelGatewayProvider, ModelInvocationService, ModelProviderProfile } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { LifecycleHookInvocationPort } from '@nextagent/agent-contracts/runtime';

import { createModelCatalog, type ModelCatalogSource } from '../catalog/model-catalog.js';
import type { CredentialResolver } from '../credentials/credential-resolver.js';
import { createAssemblyAuthorizedModelInvocationService } from '../invocation/assembly-authorization.js';
import { createCatalogBackedModelInvocationService } from '../invocation/catalog-backed-model-invocation.js';
import { createLifecycleHookModelInvocationService } from '../invocation/lifecycle-hook-wrapper.js';
import { createModelGatewayProviderRegistration } from '../providers/model-gateway/model-gateway-registration.js';
import type { ModelProviderRuntimeRegistration } from './model-provider-runtime.js';
import { createModelRuntimeRegistry, type ModelRuntimeBinding } from './model-runtime-registry.js';

export interface ConfiguredModelRuntimeOptions {
  readonly providers: PreparedConfiguredModelProviders;
  readonly credentialResolver: CredentialResolver;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly lifecycleHookInvocation: LifecycleHookInvocationPort;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly fetch?: typeof globalThis.fetch;
  readonly openAICompatibleProviderRegistration?: ModelProviderRuntimeRegistration;
}

export type PreparedConfiguredModelProviders =
  | {
      readonly kind: 'COMPATIBLE_ONLY';
      readonly profiles: readonly ModelProviderProfile[];
    }
  | {
      readonly kind: 'WITH_MODEL_GATEWAY';
      readonly profiles: readonly ModelProviderProfile[];
      readonly modelGatewayProvider: ModelGatewayProvider;
    };

export interface ConfiguredModelRuntime {
  readonly modelCatalog: ModelCatalogQueryService;
  readonly modelInvocationService: ModelInvocationService;
}

export function prepareConfiguredModelProviders(input: {
  readonly profiles: readonly ModelProviderProfile[];
  readonly modelGatewayProviders?: readonly ModelGatewayProvider[];
}): PreparedConfiguredModelProviders {
  if (!input.profiles.some((profile) => profile.providerId === 'model-gateway')) {
    return Object.freeze({
      kind: 'COMPATIBLE_ONLY',
      profiles: input.profiles,
    });
  }
  return Object.freeze({
    kind: 'WITH_MODEL_GATEWAY',
    profiles: input.profiles,
    modelGatewayProvider: requireSingleModelGatewayProvider(input.modelGatewayProviders),
  });
}

export function createConfiguredModelRuntime(options: ConfiguredModelRuntimeOptions): ConfiguredModelRuntime {
  const registrations = createProviderRegistrations(options);
  const registry = createModelRuntimeRegistry(options.providers.profiles, registrations);
  const modelCatalog = createModelCatalog(registry.list().map(toCatalogSource));
  const providerInvocation = createCatalogBackedModelInvocationService(registry, modelCatalog);
  const hookedInvocation = createLifecycleHookModelInvocationService(providerInvocation, options.lifecycleHookInvocation);
  return Object.freeze({
    modelCatalog,
    modelInvocationService: Object.freeze(
      createAssemblyAuthorizedModelInvocationService(hookedInvocation, options.assemblyRegistry, options.providers.profiles),
    ),
  });
}

function toCatalogSource(binding: ModelRuntimeBinding): ModelCatalogSource {
  const resolveModel = binding.runtime.resolveModel;
  return Object.freeze({
    definition: binding.definition,
    ...(binding.unavailableReason === undefined ? {} : { unavailableReason: binding.unavailableReason }),
    ...(resolveModel === undefined
      ? {}
      : {
          resolveModel: (signal: AbortSignal) => resolveModel(binding.definition, signal),
        }),
  });
}

function createProviderRegistrations(options: ConfiguredModelRuntimeOptions): readonly ModelProviderRuntimeRegistration[] {
  const registrations: ModelProviderRuntimeRegistration[] = [];
  if (options.providers.profiles.some((profile) => profile.providerId === 'openai-compatible')) {
    if (options.openAICompatibleProviderRegistration === undefined) {
      throw new AgentError({
        code: 'MODEL_PROVIDER_REGISTRATION_UNAVAILABLE',
        message: 'The configured model provider runtime registration is unavailable.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    registrations.push(options.openAICompatibleProviderRegistration);
  }
  if (options.providers.kind === 'WITH_MODEL_GATEWAY') {
    registrations.push(createModelGatewayProviderRegistration(options.providers.modelGatewayProvider));
  }
  return registrations;
}

function requireSingleModelGatewayProvider(providers?: readonly ModelGatewayProvider[]): ModelGatewayProvider {
  const candidates = providers ?? [];
  if (candidates.length !== 1) {
    throw modelGatewayProviderError(candidates.length);
  }
  const [provider] = candidates;
  if (provider === undefined) {
    throw modelGatewayProviderError(0);
  }
  return provider;
}

function modelGatewayProviderError(candidateCount: number): AgentError {
  return new AgentError({
    code: candidateCount === 0 ? 'MODEL_GATEWAY_PROVIDER_MISSING' : 'MODEL_GATEWAY_PROVIDER_AMBIGUOUS',
    message: 'Exactly one Model Gateway provider is required.',
    category: 'VALIDATION',
    retryable: false,
  });
}
