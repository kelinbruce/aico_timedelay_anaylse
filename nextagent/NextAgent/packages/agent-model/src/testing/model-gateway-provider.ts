import type { ModelGatewayModelInformation, ModelGatewayProvider, ModelInvocationService } from '@nextagent/agent-contracts/model';

export function createTestModelGatewayProvider(
  model: ModelInvocationService,
  modelInformation: readonly ModelGatewayModelInformation[],
): ModelGatewayProvider {
  const informationByModelId = new Map(modelInformation.map((information) => [information.modelId, Object.freeze({ ...information })]));
  return Object.freeze({
    providerId: 'scripted-test-model-gateway',
    createModelService() {
      return model;
    },
    createModelInformationService() {
      return Object.freeze({
        async get(modelId: string, signal: AbortSignal) {
          signal.throwIfAborted();
          const information = informationByModelId.get(modelId);
          return information === undefined ? { status: 'NOT_FOUND' as const } : { status: 'FOUND' as const, information };
        },
      });
    },
  });
}
