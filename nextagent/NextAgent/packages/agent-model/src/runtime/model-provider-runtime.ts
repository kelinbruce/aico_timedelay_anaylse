import type {
  ModelGatewayModelInformationResult,
  ModelInvocationService,
  ModelProfile,
  ModelProviderId,
  ModelProviderProfile,
} from '@nextagent/agent-contracts/model';

export interface ModelProviderRuntime {
  readonly invocationService: ModelInvocationService;
  resolveModel?: (profile: ModelProfile, signal: AbortSignal) => Promise<ModelGatewayModelInformationResult>;
}

export interface ModelProviderRuntimeRegistration {
  readonly providerId: ModelProviderId;
  createRuntime: (profile: ModelProviderProfile) => ModelProviderRuntime;
}
