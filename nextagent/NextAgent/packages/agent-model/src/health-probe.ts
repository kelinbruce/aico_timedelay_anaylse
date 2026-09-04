import type { AgentId } from '@nextagent/agent-common';
import type { ModelCatalogQueryService } from '@nextagent/agent-contracts/model';

export interface ModelHealthProbeResult {
  readonly status: 'UP' | 'DOWN';
  readonly reasonCode: string;
  readonly summary: string;
}

export interface ModelHealthProbe {
  readonly name: 'model_provider';
  readonly critical: true;
  readonly timeoutMs: number;
  run: (signal: AbortSignal) => Promise<ModelHealthProbeResult>;
}

export interface ModelHealthProbeOptions<
  TAssembly extends {
    readonly modelIds: readonly string[];
    readonly defaultModelId?: string;
  },
> {
  readonly defaultRouteAgentId: AgentId;
  readonly assemblyRegistry: {
    active: (agentId: AgentId) => Promise<TAssembly> | TAssembly;
  };
  readonly modelCatalog: ModelCatalogQueryService;
}

export function createModelProviderHealthProbe<
  TAssembly extends {
    readonly modelIds: readonly string[];
    readonly defaultModelId?: string;
  },
>(input: ModelHealthProbeOptions<TAssembly>): ModelHealthProbe {
  return {
    name: 'model_provider',
    critical: true,
    timeoutMs: 1000,
    async run(signal) {
      const assembly = await input.assemblyRegistry.active(input.defaultRouteAgentId);
      const modelId = assembly.defaultModelId ?? assembly.modelIds[0];
      if (modelId === undefined) {
        return {
          status: 'DOWN',
          reasonCode: 'MODEL_ACTIVATION_EMPTY',
          summary: 'Default-route Agent does not activate a model.',
        };
      }
      const entry = await input.modelCatalog.get(modelId, signal);
      if (entry?.availability === 'AVAILABLE') {
        return {
          status: 'UP',
          reasonCode: 'MODEL_AVAILABLE',
          summary: 'Default-route Agent model is available.',
        };
      }
      return {
        status: 'DOWN',
        reasonCode: entry?.unavailableReason ?? 'MODEL_NOT_CONFIGURED',
        summary: 'Default-route Agent model is unavailable.',
      };
    },
  };
}
