import { brand } from '@nextagent/agent-common';
import { createModelProviderHealthProbe } from '@nextagent/agent-model';
import { describe, expect, it, vi } from 'vitest';

describe('createModelProviderHealthProbe', () => {
  it('queries the default activated model only when the explicit deep probe runs', async () => {
    const get = vi.fn(async () => ({
      availability: 'AVAILABLE' as const,
      fallbackEligible: false,
      configuration: {
        modelId: 'health-model',
        contextWindowTokens: 32_000,
        temperature: 0.55,
        maxOutputTokens: 32_000,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
    }));
    const probe = createModelProviderHealthProbe({
      defaultRouteAgentId: brand<string, 'AgentId'>('agent-health'),
      assemblyRegistry: {
        active: vi.fn(() => ({
          modelIds: ['fallback-model', 'health-model'],
          defaultModelId: 'health-model',
        })),
      },
      modelCatalog: { get, list: vi.fn() },
    });

    expect(get).not.toHaveBeenCalled();
    await expect(probe.run(new AbortController().signal)).resolves.toEqual({
      status: 'UP',
      reasonCode: 'MODEL_AVAILABLE',
      summary: 'Default-route Agent model is available.',
    });
    expect(get).toHaveBeenCalledWith('health-model', expect.any(AbortSignal));
  });

  it('projects only safe catalog unavailability', async () => {
    const probe = createModelProviderHealthProbe({
      defaultRouteAgentId: brand<string, 'AgentId'>('agent-health'),
      assemblyRegistry: {
        active: vi.fn(() => ({ modelIds: ['gateway-model'] })),
      },
      modelCatalog: {
        list: vi.fn(),
        get: vi.fn(async () => ({
          modelId: 'gateway-model',
          availability: 'UNAVAILABLE' as const,
          fallbackEligible: true,
          unavailableReason: 'MODEL_INFORMATION_UNAVAILABLE' as const,
        })),
      },
    });

    await expect(probe.run(new AbortController().signal)).resolves.toEqual({
      status: 'DOWN',
      reasonCode: 'MODEL_INFORMATION_UNAVAILABLE',
      summary: 'Default-route Agent model is unavailable.',
    });
  });
});
