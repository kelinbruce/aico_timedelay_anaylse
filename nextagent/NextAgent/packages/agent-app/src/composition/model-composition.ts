import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import { AgentError } from '@nextagent/agent-common';
import type { FetchGateway } from '@nextagent/agent-contracts/gateway';
import type { ModelGatewayProvider } from '@nextagent/agent-contracts/model';
import { createOpenAICompatibleModelProviderRegistration } from '@nextagent/agent-model/providers/openai-compatible';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { LifecycleHookInvocationPort } from '@nextagent/agent-contracts/runtime';
import {
  createConfiguredModelRuntime,
  prepareConfiguredModelProviders,
  type PreparedConfiguredModelProviders,
  type ConfiguredModelRuntime,
} from '@nextagent/agent-model';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AppCredentialResolver } from '../config/env.js';
import type { ModelProviderBuildProfile } from './composition-contracts.js';

export interface PreparedModelComposition {
  readonly providers: PreparedConfiguredModelProviders;
  readonly modelProviderProfile: ModelProviderBuildProfile;
}

export function assertModelProviderProfileSupportsProviderIds(modelProviderProfile: ModelProviderBuildProfile, providerIds: readonly string[]): void {
  if (modelProviderProfile === 'MODEL_GATEWAY_ONLY' && providerIds.includes('openai-compatible')) {
    throw new AgentError({
      code: 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE',
      message: 'OpenAI-compatible provider is not supported by model-gateway-only package.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

export function prepareModelComposition(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly modelGatewayProviders?: readonly ModelGatewayProvider[];
  readonly modelProviderProfile?: ModelProviderBuildProfile;
}): PreparedModelComposition {
  assertModelProviderProfileSupportsProviderIds(
    input.modelProviderProfile ?? 'DEFAULT',
    input.systemConfig.modelProfiles.map((profile) => profile.providerId),
  );
  return {
    providers: prepareConfiguredModelProviders({
      profiles: input.systemConfig.modelProfiles,
      ...(input.modelGatewayProviders === undefined ? {} : { modelGatewayProviders: input.modelGatewayProviders }),
    }),
    modelProviderProfile: input.modelProviderProfile ?? 'DEFAULT',
  };
}

export function composeModelRuntime(input: {
  readonly composition: PreparedModelComposition;
  readonly credentialResolver: AppCredentialResolver;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly lifecycleHookInvocation: LifecycleHookInvocationPort;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly fetchGateway?: FetchGateway;
}): ConfiguredModelRuntime {
  const fetchGateway = input.fetchGateway;
  const openAICompatibleProviderRegistration =
    input.composition.modelProviderProfile === 'MODEL_GATEWAY_ONLY'
      ? undefined
      : createOpenAICompatibleModelProviderRegistration({
          credentialResolver: input.credentialResolver,
          ...(input.executionCorrelation === undefined ? {} : { executionCorrelation: input.executionCorrelation }),
          ...(fetchGateway === undefined ? {} : { fetch: (fetchInput, init) => fetchGateway.fetch(fetchInput, init) }),
        });
  return createConfiguredModelRuntime({
    providers: input.composition.providers,
    credentialResolver: input.credentialResolver,
    assemblyRegistry: input.assemblyRegistry,
    lifecycleHookInvocation: input.lifecycleHookInvocation,
    ...(input.executionCorrelation === undefined ? {} : { executionCorrelation: input.executionCorrelation }),
    ...(fetchGateway === undefined ? {} : { fetch: (fetchInput, init) => fetchGateway.fetch(fetchInput, init) }),
    ...(openAICompatibleProviderRegistration === undefined ? {} : { openAICompatibleProviderRegistration }),
  });
}
