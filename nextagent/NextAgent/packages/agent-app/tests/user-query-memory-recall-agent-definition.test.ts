import { describe, expect, it } from 'vitest';
import { loadAgentDefinitionForSystemConfig } from '../src/assembly/agent-directory-loader.js';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';

describe('user query memory recall agent activation', () => {
  it('loads the active default agent with one BEFORE_MODEL_INVOKE activation', () => {
    const systemConfig = resolveDefaultSystemConfig({
      cwd: process.cwd(),
      credentialResolver: createAppCredentialResolver({
        OPENAI_MODEL_NAME: 'test-model',
        OPENAI_BASE_URL: 'https://model.example.test/v1',
        OPENAI_API_KEY: 'test-key',
      }),
      loggingProfile: 'test',
    });
    const definition = loadAgentDefinitionForSystemConfig(systemConfig);

    expect(systemConfig.activeAgentId).toBe('default-agent');
    expect(definition.agentId).toBe('default-agent');
    expect(definition.hooks).toEqual([
      {
        hookId: 'user-query-memory-recall',
        stages: ['BEFORE_MODEL_INVOKE'],
        enabled: true,
      },
    ]);
    expect(
      definition.capabilityBindings.filter((binding) => binding.capabilityId === 'search_memory' || binding.capabilityId === 'get_memory_detail'),
    ).toHaveLength(2);
  });
});
