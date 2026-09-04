import { createInMemoryMetricsRegistry } from '@nextagent/agent-observability';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadAppCompositionConfiguration } from '../src/composition/configuration-composition.js';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { validateDefaultSystemConfig } from '../src/config/validation.js';

describe('app configuration composition', () => {
  it('uses an injected frozen config without consulting the config-file locator', () => {
    const credentialResolver = createAppCredentialResolver(testEnvironment({ CLIP_HOME: 'D:/trusted/clipc' }));
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const referenceValidation = {
      isCredentialReferenceResolvable: vi.fn(() => true),
      resolveLocalDirectoryPath: vi.fn((path: string) => path),
      isUrlResolvable: vi.fn(() => true),
    };

    const result = loadAppCompositionConfiguration({
      systemConfig,
      configFile: 'Z:/must-not-be-read/missing.yaml',
      credentialResolver,
      metricsRegistry: createInMemoryMetricsRegistry(),
      capabilityProviderReferenceValidation: referenceValidation,
    });

    expect(result.systemConfig).toBe(systemConfig);
    expect(result.capabilityProviderReferenceValidation).toBe(referenceValidation);
    expect(result.sandboxRuntimeInput).toEqual({
      allowedApis: systemConfig.sandbox.allowedApis,
      allowedExecutables: systemConfig.sandbox.allowedExecutables,
      clipcExecutableDirectory: 'D:/trusted/clipc',
      deniedExecutables: systemConfig.sandbox.deniedExecutables,
      enabled: systemConfig.sandbox.enabled,
    });
  });

  it('keeps an unavailable sandbox executable directory absent', () => {
    const credentialResolver = createAppCredentialResolver(testEnvironment());
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });

    const result = loadAppCompositionConfiguration({
      systemConfig,
      credentialResolver,
      metricsRegistry: createInMemoryMetricsRegistry(),
    });

    expect(result.sandboxRuntimeInput).toEqual({
      allowedApis: systemConfig.sandbox.allowedApis,
      allowedExecutables: systemConfig.sandbox.allowedExecutables,
      deniedExecutables: systemConfig.sandbox.deniedExecutables,
      enabled: systemConfig.sandbox.enabled,
    });
  });

  it('preserves an explicit sandbox executable allowlist through configuration composition', () => {
    const credentialResolver = createAppCredentialResolver(testEnvironment());
    const systemConfig = validateSandboxConfig({ allowedApis: ['https://api.example.internal/v1/'], allowedExecutables: [] });

    const result = loadAppCompositionConfiguration({
      systemConfig,
      credentialResolver,
      metricsRegistry: createInMemoryMetricsRegistry(),
    });

    expect(result.sandboxRuntimeInput).toEqual({
      allowedApis: ['https://api.example.internal/v1/'],
      allowedExecutables: [],
      deniedExecutables: systemConfig.sandbox.deniedExecutables,
      enabled: systemConfig.sandbox.enabled,
    });
  });

  it('validates sandbox executable allowlist entries and preserves explicit emptiness', () => {
    const config = validateSandboxConfig({ allowedExecutables: [] });

    expect(config.sandbox.allowedExecutables).toEqual([]);
    expect(validateSandboxConfig({}).sandbox.allowedExecutables).toBeUndefined();

    expect(() => validateSandboxConfig({ allowedExecutables: ['node', 'node'] })).toThrow('App configuration is blocked');
    expect(() => validateSandboxConfig({ allowedExecutables: [''] })).toThrow('App configuration is blocked');
  });

  it('validates and normalizes trusted sandbox API prefixes', () => {
    const config = validateSandboxConfig({ allowedApis: ['HTTPS://API.EXAMPLE.INTERNAL:443/v1/'] });

    expect(config.sandbox.allowedApis).toEqual(['https://api.example.internal/v1/']);
    expect(validateSandboxConfig({}).sandbox.allowedApis).toEqual([]);

    for (const allowedApis of [
      ['ftp://api.example.internal/v1/'],
      ['https://user:secret@api.example.internal/v1/'],
      ['https://api.example.internal/v1/?query=1'],
      ['https://api.example.internal/v1/?'],
      ['https://api.example.internal/v1/#fragment'],
      ['https://api.example.internal/v1/#'],
      ['https://api.example.internal/v1'],
      ['https://api.example.internal:443/v1/', 'https://API.EXAMPLE.INTERNAL/v1/'],
    ]) {
      expect(() => validateSandboxConfig({ allowedApis })).toThrow('App configuration is blocked');
    }
  });

  it('keeps config and sandbox environment reads out of downstream composition entries', () => {
    const rootSource = readFileSync(new URL('../src/composition/create-app.ts', import.meta.url), 'utf8');
    const gatewaySource = readFileSync(new URL('../src/composition/gateway-composition.ts', import.meta.url), 'utf8');

    expect(rootSource).not.toContain('evaluateDefaultSystemConfigSource');
    expect(rootSource).not.toContain('process.env');
    expect(gatewaySource).not.toContain('process.env');
  });

  it('injects one config-owned capability result presentation snapshot into all three Web paths', () => {
    const source = readFileSync(new URL('../src/composition/channel-composition.ts', import.meta.url), 'utf8');
    const exactSnapshotInjection = 'capabilityResultPresentationPolicy: context.systemConfig.capabilityResultPresentationPolicy';

    expect(source.split(exactSnapshotInjection)).toHaveLength(4);
  });
});

function testEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    ...overrides,
  };
}

function validateSandboxConfig(sandbox: { readonly allowedApis?: readonly string[]; readonly allowedExecutables?: readonly string[] }) {
  return validateDefaultSystemConfig(
    {
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
          credentialRef: 'env:OPENAI_API_KEY',
          models: [
            {
              modelId: 'MiniMax-M2.7-highspeed',
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
      sandbox,
      noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
    },
    mkdtempSync(join(tmpdir(), 'nextagent-sandbox-config-')),
    { credentialResolver: createAppCredentialResolver(testEnvironment()) },
  );
}
