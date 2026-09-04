import { createAppCredentialResolver, evaluateDefaultSystemConfig, validateDefaultSystemConfig } from '@nextagent/agent-app/testing';
import { describe, expect, it } from 'vitest';

describe('model provider configuration contract', () => {
  it('accepts a Model Gateway profile without resolving its context window at startup', () => {
    const systemConfig = validateDefaultSystemConfig(rawSystemConfig('model-gateway'), process.cwd(), {
      credentialResolver: testCredentialResolver(),
    });
    expect(systemConfig.modelProfiles).toEqual([
      {
        providerId: 'model-gateway',
        credentialRef: 'env:MODEL_GATEWAY_API_KEY',
        models: [
          {
            modelId: 'selected-model-gateway',
            fallbackEligible: false,
            temperature: 0.1,
            maxOutputTokens: 128,
            timeoutMs: 45_000,
          },
        ],
      },
    ]);
    expect(systemConfig.modelProfiles[0]?.models[0]).not.toHaveProperty('contextWindowTokens');
    expect(Object.isFrozen(systemConfig.modelProfiles)).toBe(true);
    expect(Object.isFrozen(systemConfig.modelProfiles[0]?.models)).toBe(true);
    expect(Object.isFrozen(systemConfig.modelProfiles[0]?.models[0])).toBe(true);
  });

  it('rejects provider ids outside the exact product allowlist before ready', () => {
    const result = evaluateDefaultSystemConfig(rawSystemConfig('custom'), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((issue) => issue.issueCode)).toContain('APP_CONFIG_MODEL_PROVIDER_UNSUPPORTED');
  });
});

function rawSystemConfig(providerId: 'model-gateway' | 'custom') {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
    auth: {
      mode: 'local',
      localIdentity: {
        tenantId: 'local-tenant',
        subjectId: 'local-subject',
        displayName: 'Local developer',
      },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId,
        credentialRef: 'env:MODEL_GATEWAY_API_KEY',
        models: [
          {
            modelId: 'selected-model-gateway',
            timeoutMs: 45_000,
            temperature: 0.1,
            maxOutputTokens: 128,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        {
          gatewayId: 'local-sqlite',
          gatewayKind: 'sqlite',
          deploymentMode: 'LOCAL',
          sqliteFileRef: 'paths.sqliteFile',
        },
        {
          gatewayId: 'local-rag',
          gatewayKind: 'rag-knowledge',
          deploymentMode: 'LOCAL',
        },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function testCredentialResolver() {
  return createAppCredentialResolver({ MODEL_GATEWAY_API_KEY: 'test-only' });
}
