import type { ModelGatewayProvider } from '@nextagent/agent-contracts/model';
import type { ModelProviderRuntimeRegistration } from '../../runtime/model-provider-runtime.js';

export function createModelGatewayProviderRegistration(provider: ModelGatewayProvider): ModelProviderRuntimeRegistration {
  return {
    providerId: 'model-gateway',
    createRuntime(profile) {
      if (profile.providerId !== 'model-gateway' || profile.baseUrl !== undefined) {
        throw new Error('Model Gateway access configuration is invalid.');
      }
      const informationService = provider.createModelInformationService();
      return {
        invocationService: provider.createModelService(undefined, profile.credentialRef),
        resolveModel(modelProfile, signal) {
          return informationService.get(modelProfile.modelId, signal).then((result) => {
            if (result.status === 'UNAVAILABLE') {
              return {
                status: 'FOUND' as const,
                information: {
                  modelId: modelProfile.modelId,
                  contextWindowTokens: 128000,
                },
              };
            }
            return result;
          });
        },
      };
    },
  };
}
