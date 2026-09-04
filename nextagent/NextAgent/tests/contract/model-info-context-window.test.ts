import type { ModelCatalogEntry, ModelGatewayModelInformationResult, ResolvedModelConfiguration } from '@nextagent/agent-contracts/model';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('resolved model context window contract', () => {
  it('requires a positive context window on every available resolved configuration', () => {
    const configuration: ResolvedModelConfiguration = {
      modelId: 'telecom-model',
      contextWindowTokens: 128_000,
      temperature: 0.55,
      maxOutputTokens: 32_000,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    };
    const entry: Extract<ModelCatalogEntry, { availability: 'AVAILABLE' }> = {
      availability: 'AVAILABLE',
      fallbackEligible: false,
      configuration,
    };

    expectTypeOf(configuration.contextWindowTokens).toEqualTypeOf<number>();
    expect(entry.configuration).toBe(configuration);
    expect(configuration.contextWindowTokens).toBe(128_000);
  });

  it('keeps lazy Model Gateway information provider-private until catalog resolution', () => {
    const result: ModelGatewayModelInformationResult = {
      status: 'FOUND',
      information: {
        modelId: 'gateway-model',
        contextWindowTokens: 64_000,
      },
    };

    expect(result).toEqual({
      status: 'FOUND',
      information: { modelId: 'gateway-model', contextWindowTokens: 64_000 },
    });
  });
});
