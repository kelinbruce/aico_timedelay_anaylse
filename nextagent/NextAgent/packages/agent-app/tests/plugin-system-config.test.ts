import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { validateDefaultSystemConfig } from '../src/config/validation.js';

describe('plugin system config', () => {
  it('normalizes declared local plugin directories and defaults required to true', () => {
    const config = validateDefaultSystemConfig(
      rawConfig([{ pluginId: 'telecom-routing', path: 'plugins/telecom-routing' }]),
      mkdtempSync(join(tmpdir(), 'nextagent-plugin-config-')),
      { credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }) },
    );

    expect(config.pluginSystem.plugins).toEqual([{ pluginId: 'telecom-routing', path: 'plugins/telecom-routing', required: true }]);
  });

  it('rejects more than 8 plugin entries and duplicate plugin ids', () => {
    expect(() =>
      validate(
        rawConfig(
          Array.from({ length: 9 }, (_, index) => ({
            pluginId: `plugin-${index}`,
            path: `plugins/plugin-${index}`,
          })),
        ),
      ),
    ).toThrow('App configuration is blocked');

    expect(() =>
      validate(
        rawConfig([
          { pluginId: 'telecom', path: 'plugins/telecom-a' },
          { pluginId: 'telecom', path: 'plugins/telecom-b' },
        ]),
      ),
    ).toThrow('App configuration is blocked');
  });

  it.each([
    'https://example.test/plugin',
    'C:/plugins/telecom',
    '/plugins/telecom',
    '../plugins/telecom',
    'plugins/*',
    'plugins/$(whoami)',
    'plugins/telecom.zip',
    'plugins/telecom.tgz',
    'plugins/index.js',
  ])('rejects unsafe plugin path %s', (path) => {
    expect(() => validate(rawConfig([{ pluginId: 'telecom', path }]))).toThrow('App configuration is blocked');
  });
});

function validate(input: unknown) {
  return validateDefaultSystemConfig(input, mkdtempSync(join(tmpdir(), 'nextagent-plugin-config-')), {
    credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
  });
}

function rawConfig(plugins: ReadonlyArray<{ readonly pluginId: string; readonly path: string; readonly required?: boolean }>) {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
    },
    channel: { transport: 'fastify', host: '127.0.0.1' },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:NEXTAGENT_TEST_ONLY',
        models: [
          {
            modelId: 'MiniMax-M2.7',
            timeoutMs: 30_000,
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
    nextAgent: { system: { plugins } },
  };
}
