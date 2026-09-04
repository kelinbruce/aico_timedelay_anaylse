import type { ModelProfile, ModelProviderId, ModelProviderProfile, ModelUnavailableReason } from '@nextagent/agent-contracts/model';
import { deepFreeze } from '@nextagent/agent-common';

import type { ModelProviderRuntime, ModelProviderRuntimeRegistration } from './model-provider-runtime.js';

export interface ModelRuntimeBinding {
  readonly definition: ModelProfile;
  readonly unavailableReason?: ModelUnavailableReason;
  readonly runtime: ModelProviderRuntime;
}

export interface ModelRuntimeBindingLookup {
  get: (modelId: string) => ModelRuntimeBinding | undefined;
}

export interface ModelRuntimeRegistry extends ModelRuntimeBindingLookup {
  list: () => readonly ModelRuntimeBinding[];
}

export function createModelRuntimeRegistry(
  profiles: readonly ModelProviderProfile[],
  registrations: readonly ModelProviderRuntimeRegistration[],
): ModelRuntimeRegistry {
  const registrationsById = indexRegistrations(registrations);
  const bindingsByModelId = new Map<string, ModelRuntimeBinding>();
  const orderedBindings: ModelRuntimeBinding[] = [];

  for (const providerProfile of profiles) {
    const registration = registrationsById.get(providerProfile.providerId);
    if (registration === undefined) {
      throw new Error(`Model provider registration is unavailable: ${providerProfile.providerId}.`);
    }
    const runtime = registration.createRuntime(providerProfile);
    for (const definition of providerProfile.models) {
      if (bindingsByModelId.has(definition.modelId)) {
        throw new Error(`Duplicate model id: ${definition.modelId}.`);
      }
      const binding = Object.freeze({
        definition: deepFreeze(definition),
        ...(providerProfile.providerId === 'openai-compatible' && providerProfile.baseUrl === undefined
          ? { unavailableReason: 'MODEL_PROVIDER_NOT_CONFIGURED' as const }
          : {}),
        runtime,
      });
      bindingsByModelId.set(definition.modelId, binding);
      orderedBindings.push(binding);
    }
  }
  if (orderedBindings.length === 0) {
    throw new Error('At least one configured model is required.');
  }

  const bindings = Object.freeze(orderedBindings);
  return Object.freeze({
    list: () => bindings,
    get: (modelId: string) => bindingsByModelId.get(modelId),
  });
}

function indexRegistrations(
  registrations: readonly ModelProviderRuntimeRegistration[],
): ReadonlyMap<ModelProviderId, ModelProviderRuntimeRegistration> {
  const indexed = new Map<ModelProviderId, ModelProviderRuntimeRegistration>();
  for (const registration of registrations) {
    if (indexed.has(registration.providerId)) {
      throw new Error(`Duplicate model provider registration: ${registration.providerId}.`);
    }
    indexed.set(registration.providerId, registration);
  }
  return indexed;
}
