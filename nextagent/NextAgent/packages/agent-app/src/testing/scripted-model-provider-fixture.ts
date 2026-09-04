import type { ModelGatewayModelInformation, ModelInvocationService, ModelProfile, ModelProviderProfile } from '@nextagent/agent-contracts/model';
import { createTestModelGatewayProvider } from '@nextagent/agent-model/testing';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { CreateComposedAppOptions } from '../composition/composition-contracts.js';

export interface ScriptedModelProviderFixture {
  readonly systemConfig: DefaultSystemConfig;
  readonly modelGatewayProviders: NonNullable<CreateComposedAppOptions['modelGatewayProviders']>;
}

export function createScriptedModelProviderFixture(systemConfig: DefaultSystemConfig, model: ModelInvocationService): ScriptedModelProviderFixture {
  const configuredModels = systemConfig.modelProfiles.flatMap((profile) => profile.models);
  const information = configuredModels.map(toModelInformation);
  const gatewayProfile: ModelProviderProfile = Object.freeze({
    providerId: 'model-gateway',
    models: Object.freeze(configuredModels.map(toGatewayModelProfile)),
  });
  return Object.freeze({
    systemConfig: Object.freeze({
      ...systemConfig,
      modelProfiles: Object.freeze([gatewayProfile]),
    }),
    modelGatewayProviders: Object.freeze([createTestModelGatewayProvider(model, information)]),
  });
}

function toModelInformation(model: ModelProfile): ModelGatewayModelInformation {
  if (model.contextWindowTokens === undefined) {
    throw new Error(`Scripted test model "${model.modelId}" requires contextWindowTokens before Model Gateway projection.`);
  }
  return Object.freeze({
    modelId: model.modelId,
    contextWindowTokens: model.contextWindowTokens,
  });
}

function toGatewayModelProfile(model: ModelProfile): ModelProfile {
  const { contextWindowTokens: _contextWindowTokens, ...gatewayModel } = model;
  return Object.freeze(gatewayModel);
}
