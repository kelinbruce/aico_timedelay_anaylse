import type { ModelInferenceOptions, ResolvedModelConfiguration } from '@nextagent/agent-contracts/model';

export function modelInferenceOptions(configuration: ResolvedModelConfiguration): ModelInferenceOptions {
  return {
    temperature: configuration.temperature,
    maxOutputTokens: configuration.maxOutputTokens,
    topP: configuration.topP,
    ...(configuration.toolChoice === undefined ? {} : { toolChoice: configuration.toolChoice }),
    ...(configuration.topK === undefined ? {} : { topK: configuration.topK }),
    ...(configuration.presencePenalty === undefined ? {} : { presencePenalty: configuration.presencePenalty }),
    ...(configuration.frequencyPenalty === undefined ? {} : { frequencyPenalty: configuration.frequencyPenalty }),
    ...(configuration.thinking === undefined ? {} : { thinking: configuration.thinking }),
  };
}
