import { createAppCredentialResolver } from '../src/config/env.js';
import { createRuntimePaths } from '../src/config/paths.js';
import {
  builtInDefaultSystemConfigPath,
  evaluateDefaultSystemConfigSource,
  parseBuiltInConfig,
  resolveDefaultSystemConfig,
} from '../src/config/system-config.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('resolve default system config', () => {
  const originalConfigDir = process.env.NEXTAGENT_CONFIG_DIR;
  const modelEnv = {
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  } as const;

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.NEXTAGENT_CONFIG_DIR;
      return;
    }
    process.env.NEXTAGENT_CONFIG_DIR = originalConfigDir;
  });

  it('stores the bundled system configuration as YAML while preserving its values', () => {
    const content = readFileSync(builtInDefaultSystemConfigPath, 'utf8');

    expect(() => JSON.parse(content)).toThrow();
    expect(parseBuiltInConfig(content)).toMatchObject({
      deployment: { mode: 'LOCAL' },
      paths: {
        workspaceRoot: 'workspaces',
        logDirectory: 'logs',
        agentRoot: 'agents',
        skillRoot: 'skills',
      },
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          models: [
            {
              modelId: 'env:OPENAI_MODEL_NAME',
              temperature: 0.2,
              maxOutputTokens: 2_048,
              topP: 1,
              timeoutMs: 300_000,
            },
          ],
        },
      ],
    });
  });

  it('uses NEXTAGENT_CONFIG_DIR as the built-in config root when no user config file is provided', () => {
    const customConfigRoot = resolve('/tmp/nextagent-custom-config');
    process.env.NEXTAGENT_CONFIG_DIR = customConfigRoot;

    const config = resolveDefaultSystemConfig({
      cwd: '/tmp/ignored-cwd',
      credentialResolver: createAppCredentialResolver({
        OPENAI_API_KEY: 'test-only',
        OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
        OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
      }),
    });

    expect(config.paths.configRoot).toBe(customConfigRoot);
    expect(config.paths.workspaceRoot).toBe(resolve(customConfigRoot, 'workspaces'));
    expect(config.paths.sharedDataRoot).toBe(resolve(customConfigRoot, 'workspaces', 'shared-data'));
  });

  it("preserves the bundled model profile's explicit invocation settings after canonical migration", () => {
    const config = resolveDefaultSystemConfig({
      credentialResolver: createAppCredentialResolver({
        OPENAI_API_KEY: 'test-only',
        OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
        OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
      }),
    });

    expect(config.modelProfiles[0]).toMatchObject({
      providerId: 'openai-compatible',
      models: [
        {
          modelId: 'MiniMax-M2.7-highspeed',
          contextWindowTokens: 128_000,
          fallbackEligible: false,
          temperature: 0.2,
          maxOutputTokens: 2_048,
          topP: 1,
          timeoutMs: 300_000,
        },
      ],
    });
  });

  it('keeps the bundled unconfigured model provider degraded-ready without exposing access secrets', () => {
    const result = evaluateDefaultSystemConfigSource({
      credentialResolver: createAppCredentialResolver({
        OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      }),
    });

    expect(result.status).toBe('DEGRADED_READY');
    expect(result.config?.modelProfiles).toHaveLength(1);
    expect(result.config?.modelProfiles[0]).toMatchObject({
      providerId: 'openai-compatible',
    });
    expect(result.config?.modelProfiles[0]).not.toHaveProperty('baseUrl');
    expect(result.config?.modelProfiles[0]).not.toHaveProperty('credentialRef');
    const warning = result.evidenceInput.diagnostics.find((entry) => entry.issueCode === 'APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED');
    expect(warning).toMatchObject({
      severity: 'WARNING',
      affectsReadiness: false,
      safeMessage: 'OpenAI-compatible model provider is not configured.',
    });
    expect(JSON.stringify(result.evidenceInput.diagnostics)).not.toContain('test-only');
    expect(JSON.stringify(result.evidenceInput.diagnostics)).not.toContain('https://');
  });

  it('uses a safe placeholder model id when the model name environment variable is absent and the provider is unconfigured', () => {
    const result = evaluateDefaultSystemConfigSource({
      credentialResolver: createAppCredentialResolver({}),
    });

    expect(result.status).toBe('DEGRADED_READY');
    expect(result.config?.modelProfiles[0]?.models[0]?.modelId).toBe('default-model');
  });

  it('rejects an invalid OpenAI-compatible baseUrl while allowing an omitted baseUrl', () => {
    const invalid = evaluateModelProviderBaseUrl('not-a-url');
    const omitted = evaluateModelProviderBaseUrl(undefined);

    expect(invalid.status).toBe('BLOCKED');
    expect(invalid.evidenceInput.diagnostics.map((entry) => entry.issueCode)).toContain('APP_CONFIG_MODEL_BASE_URL_INVALID');
    expect(omitted.status).toBe('DEGRADED_READY');
    expect(omitted.config?.modelProfiles[0]?.models[0]?.modelId).toBe('configured-model');
  });

  it('rejects an invalid OpenAI-compatible credentialRef while allowing an omitted credentialRef', () => {
    const invalid = evaluateModelProviderCredentialRef('invalid-secret-ref');
    const omitted = evaluateModelProviderCredentialRef(undefined);

    expect(invalid.status).toBe('BLOCKED');
    expect(invalid.evidenceInput.diagnostics.map((entry) => entry.issueCode)).toContain('APP_CONFIG_SECRET_REF_INVALID');
    expect(omitted.status).toBe('READY');
  });

  it('preserves and freezes an OpenAI-compatible implicit reasoning text mode without synthesizing a default', () => {
    const implicit = evaluateModelReasoningTextMode('openai-compatible', 'IMPLICIT_OPEN_THINK_TAG');
    const omitted = evaluateModelReasoningTextMode('openai-compatible');

    expect(implicit.status).toBe('READY');
    expect(implicit.config?.modelProfiles[0]?.models[0]).toMatchObject({
      reasoningTextMode: 'IMPLICIT_OPEN_THINK_TAG',
    });
    expect(Object.isFrozen(implicit.config?.modelProfiles[0]?.models[0])).toBe(true);
    expect(omitted.status).toBe('READY');
    expect(omitted.config?.modelProfiles[0]?.models[0]).not.toHaveProperty('reasoningTextMode');
  });

  it.each([null, 'UNKNOWN', false] as const)('rejects invalid reasoning text mode %s before ready', (reasoningTextMode) => {
    const result = evaluateModelReasoningTextMode('openai-compatible', reasoningTextMode);

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((entry) => entry.issueCode)).toContain('APP_CONFIG_MODEL_REASONING_TEXT_MODE_INVALID');
  });

  it('rejects reasoning text mode on Model Gateway before ready', () => {
    const result = evaluateModelReasoningTextMode('model-gateway', 'IMPLICIT_OPEN_THINK_TAG');

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((entry) => entry.issueCode)).toContain('APP_CONFIG_MODEL_GATEWAY_REASONING_TEXT_MODE_FORBIDDEN');
  });

  it('applies channel host and port environment overrides independently after YAML merge', () => {
    const both = resolveDefaultSystemConfig({
      credentialResolver: createAppCredentialResolver({
        ...modelEnv,
        NEXTAGENT_CHANNEL_HOST: '::1',
        NEXTAGENT_CHANNEL_PORT: '3100',
      }),
    });
    const hostOnly = resolveDefaultSystemConfig({
      credentialResolver: createAppCredentialResolver({
        ...modelEnv,
        NEXTAGENT_CHANNEL_HOST: '::1',
      }),
    });
    const withoutOverrides = resolveDefaultSystemConfig({
      credentialResolver: createAppCredentialResolver(modelEnv),
    });

    expect(both.channel).toMatchObject({ host: '::1', port: 3100 });
    expect(hostOnly.channel).toMatchObject({ host: '::1', port: 3000 });
    expect(withoutOverrides.channel).toMatchObject({ host: '127.0.0.1', port: 3000 });
  });

  it.each([
    ['NEXTAGENT_CHANNEL_HOST', ''],
    ['NEXTAGENT_CHANNEL_PORT', ''],
    ['NEXTAGENT_CHANNEL_PORT', '0'],
    ['NEXTAGENT_CHANNEL_PORT', '65536'],
    ['NEXTAGENT_CHANNEL_PORT', '+3100'],
    ['NEXTAGENT_CHANNEL_PORT', ' 3100'],
    ['NEXTAGENT_CHANNEL_PORT', '3100 '],
    ['NEXTAGENT_CHANNEL_PORT', 'not-a-port'],
  ] as const)('rejects invalid channel environment override %s without exposing its value', (name, value) => {
    let failure: unknown;
    try {
      resolveDefaultSystemConfig({
        credentialResolver: createAppCredentialResolver({
          ...modelEnv,
          [name]: value,
        }),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify(failure)).not.toContain(value || name);
  });

  it('derives shared-data under workspaceRoot and rejects non-directory shared-data roots', () => {
    const configRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-config-'));
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-workspaces-'));
    try {
      const paths = createRuntimePaths(configRoot, { workspaceRoot });

      expect(paths.sharedDataRoot).toBe(resolve(workspaceRoot, 'shared-data'));
      expect(paths.workingMemorySqliteFile).toBe(resolve(workspaceRoot, 'data', 'system', 'working-memory.sqlite'));
      expect(paths.longTermMemorySqliteFile).toBe(resolve(workspaceRoot, 'data', 'system', 'long-term-memory.sqlite'));
      expect(paths.sqliteFile).toBe(resolve(workspaceRoot, 'data', 'system', 'nextagent.sqlite'));

      writeFileSync(paths.sharedDataRoot, 'not-a-directory', 'utf8');
      expect(() => createRuntimePaths(configRoot, { workspaceRoot })).toThrow('Shared data root must be a normal directory when it already exists.');
    } finally {
      rmSync(configRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('accepts non-existing shared-data under an existing symlinked workspace root', () => {
    const realRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-real-root-'));
    const linkParent = mkdtempSync(resolve(tmpdir(), 'nextagent-link-parent-'));
    const linkedRoot = resolve(linkParent, 'linked-root');
    try {
      symlinkSync(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
      mkdirSync(resolve(linkedRoot, 'workspaces'), { recursive: true });

      const paths = createRuntimePaths(linkedRoot, { workspaceRoot: 'workspaces' });

      expect(paths.sharedDataRoot).toBe(resolve(linkedRoot, 'workspaces', 'shared-data'));
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
      rmSync(realRoot, { recursive: true, force: true });
    }
  });
});

function evaluateModelReasoningTextMode(
  providerId: 'openai-compatible' | 'model-gateway',
  reasoningTextMode?: unknown,
): ReturnType<typeof evaluateDefaultSystemConfigSource> {
  const configRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-model-reasoning-config-'));
  const configFile = resolve(configRoot, 'system.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      modelProfiles: [
        {
          providerId,
          ...(providerId === 'openai-compatible' ? { baseUrl: 'https://provider.example/v1' } : {}),
          credentialRef: providerId === 'openai-compatible' ? 'env:OPENAI_API_KEY' : 'env:MODEL_GATEWAY_API_KEY',
          models: [
            {
              modelId: 'configured-model',
              ...(providerId === 'openai-compatible' ? { contextWindowTokens: 64_000 } : {}),
              fallbackEligible: false,
              ...(reasoningTextMode === undefined ? {} : { reasoningTextMode }),
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  try {
    return evaluateDefaultSystemConfigSource({
      configFile,
      credentialResolver: createAppCredentialResolver({
        OPENAI_API_KEY: 'test-only',
        MODEL_GATEWAY_API_KEY: 'test-only',
      }),
    });
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
}

function evaluateModelProviderBaseUrl(baseUrl: string | undefined): ReturnType<typeof evaluateDefaultSystemConfigSource> {
  const configRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-model-base-url-config-'));
  const configFile = resolve(configRoot, 'system.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          ...(baseUrl === undefined ? {} : { baseUrl }),
          models: [
            {
              modelId: 'configured-model',
              contextWindowTokens: 64_000,
              fallbackEligible: false,
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  try {
    return evaluateDefaultSystemConfigSource({
      configFile,
      credentialResolver: createAppCredentialResolver({}),
    });
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
}

function evaluateModelProviderCredentialRef(credentialRef: string | undefined): ReturnType<typeof evaluateDefaultSystemConfigSource> {
  const configRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-model-credential-ref-config-'));
  const configFile = resolve(configRoot, 'system.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://provider.example/v1',
          ...(credentialRef === undefined ? {} : { credentialRef }),
          models: [
            {
              modelId: 'configured-model',
              contextWindowTokens: 64_000,
              fallbackEligible: false,
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  try {
    return evaluateDefaultSystemConfigSource({
      configFile,
      credentialResolver: createAppCredentialResolver({}),
    });
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
}
