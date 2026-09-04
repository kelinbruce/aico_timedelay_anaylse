import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type { ResolvedModelConfiguration } from '@nextagent/agent-contracts/model';

const DEFAULT_TEST_MODEL: ResolvedModelConfiguration = {
  modelId: 'test-model',
  contextWindowTokens: 128_000,
  temperature: 0.55,
  maxOutputTokens: 32_000,
  topP: 1,
  toolChoice: 'AUTO' as const,
  defaultTimeoutMs: 30_000,
  defaultMaxRetries: 2,
};

export function createTestModelSelectionService(overrides: Partial<ResolvedModelConfiguration> = {}): ModelSelectionService {
  const configuration = { ...DEFAULT_TEST_MODEL, ...overrides };
  return {
    async select(_request, signal) {
      if (signal.aborted) {
        throw signal.reason;
      }
      return {
        status: 'SELECTED',
        reason: 'AGENT_DEFAULT',
        configuration,
      };
    },
  };
}
