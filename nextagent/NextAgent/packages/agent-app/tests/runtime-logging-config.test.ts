import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { parseBuiltInConfig } from '../src/config/system-config.js';
import { evaluateDefaultSystemConfig, validateDefaultSystemConfig } from '../src/config/validation.js';

const credentialResolver = createAppCredentialResolver({ OPENAI_API_KEY: 'test-key' });

describe('runtime logging frozen configuration', () => {
  it.each([
    ['development', true, false],
    ['local', false, true],
    ['test', false, false],
  ] as const)('applies %s entrypoint sink defaults', (profile, consoleEnabled, fileEnabled) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'nextagent-log-config-defaults-'));
    const raw = builtInConfig();
    delete ((raw.observability as Record<string, unknown>).logging as Record<string, unknown>).level;
    delete ((raw.observability as Record<string, unknown>).logging as Record<string, unknown>).console;
    delete ((raw.observability as Record<string, unknown>).logging as Record<string, unknown>).file;

    const config = validateDefaultSystemConfig(raw, baseDir, { credentialResolver, loggingProfile: profile });

    expect(config.observability.logging).toMatchObject({
      diagnosticDetail: 'normal',
      level: 'info',
      console: { enabled: consoleEnabled },
      file: {
        enabled: fileEnabled,
        directory: config.paths.logDirectory,
        name: 'nextagent-operational.log.jsonl',
        rotation: { maxFileSizeMiB: 30 },
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
  });

  it('accepts bounded operational overrides under the trusted log directory', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'nextagent-log-config-valid-'));
    const raw = builtInConfig();
    raw.observability = {
      logging: {
        diagnosticDetail: 'debug',
        level: 'debug',
        console: { enabled: true },
        file: {
          enabled: true,
          directory: 'diagnostics',
          name: 'network-operations.jsonl',
          rotation: { maxFileSizeMiB: 20 },
          retentionDays: 14,
          maxArchiveFiles: 5,
        },
      },
    };

    const config = validateDefaultSystemConfig(raw, baseDir, { credentialResolver });

    expect(config.observability.logging).toMatchObject({
      diagnosticDetail: 'debug',
      level: 'debug',
      console: { enabled: true },
      file: {
        enabled: true,
        directory: join(config.paths.logDirectory, 'diagnostics'),
        name: 'network-operations.jsonl',
        rotation: { maxFileSizeMiB: 20 },
        retentionDays: 14,
        maxArchiveFiles: 5,
      },
    });
  });

  it.each([{ artifacts: { enabled: true } }, { enabled: true }])(
    'rejects the removed developer diagnostics configuration',
    (developerDiagnostics) => {
      const raw = builtInConfig();
      raw.developerDiagnostics = developerDiagnostics;

      expect(evaluateDefaultSystemConfig(raw, process.cwd(), { credentialResolver }).status).toBe('BLOCKED');
    },
  );

  it.each([
    ['unknown level', { level: 'trace' }],
    ['non-boolean sink', { console: { enabled: 'yes' } }],
    ['unsafe name', { file: { name: '../runtime.jsonl' } }],
    ['audit collision', { file: { name: 'nextagent-audit.jsonl' } }],
    ['non-positive threshold', { file: { rotation: { maxFileSizeMiB: 0 } } }],
    ['threshold above maximum', { file: { rotation: { maxFileSizeMiB: 31 } } }],
    ['short retention', { file: { retentionDays: 6 } }],
    ['non-positive archive count', { file: { maxArchiveFiles: 0 } }],
    ['fractional archive count', { file: { maxArchiveFiles: 1.5 } }],
    ['archive count above maximum', { file: { maxArchiveFiles: 11 } }],
    ['frequency', { file: { frequency: 'hourly' } }],
    ['timezone', { file: { timezone: 'UTC' } }],
    ['compression', { file: { compression: false } }],
    ['count', { file: { count: 3 } }],
    ['watermark', { file: { storageWatermarkMiB: 10 } }],
    ['entry size', { entrySizeBytes: 1024 }],
    ['queue size', { queueSizeBytes: 1024 }],
    ['backpressure', { backpressure: 'wait' }],
  ])('rejects %s configuration', (_name, logging) => {
    const raw = builtInConfig();
    raw.observability = { logging: { diagnosticDetail: 'normal', ...logging } };

    const evaluation = evaluateDefaultSystemConfig(raw, process.cwd(), { credentialResolver });

    expect(evaluation.status).toBe('BLOCKED');
    expect(evaluation.evidenceInput.diagnostics[0]?.safeMessage).not.toContain('../runtime.jsonl');
  });

  it('rejects a directory outside the trusted log directory without exposing it', () => {
    const raw = builtInConfig();
    raw.observability = {
      logging: { diagnosticDetail: 'normal', file: { directory: join(tmpdir(), 'outside-nextagent-logs') } },
    };

    const evaluation = evaluateDefaultSystemConfig(raw, process.cwd(), { credentialResolver });

    expect(evaluation.status).toBe('BLOCKED');
    expect(JSON.stringify(evaluation.evidenceInput)).not.toContain('outside-nextagent-logs');
  });

  it.each([
    ['metrics mode', { metrics: { mode: 'file' } }],
    ['metrics endpoint', { metricsEndpoint: 'https://collector.invalid' }],
    ['metrics interval', { metricsExportIntervalMs: 1_000 }],
    ['metrics retention', { metricsRetentionDays: 30 }],
    ['audit path', { audit: { path: 'audit.ndjson' } }],
    ['audit query', { auditQueryEnabled: true }],
    ['audit retention', { auditRetentionDays: 30 }],
    ['audit fallback', { auditFallback: 'sqlite' }],
  ])('rejects user-controlled %s selection', (_name, forbidden) => {
    const raw = builtInConfig();
    raw.observability = { logging: { diagnosticDetail: 'normal' }, ...forbidden };

    expect(evaluateDefaultSystemConfig(raw, process.cwd(), { credentialResolver }).status).toBe('BLOCKED');
  });

  it.each([
    ['parallel runtime logging object', { logging: { diagnosticDetail: 'normal' }, runtimeLogging: { level: 'debug' } }],
    ['legacy redaction field', { logging: { redaction: 'debug' } }],
  ])('rejects %s without a compatibility path', (_name, observability) => {
    const raw = builtInConfig();
    raw.observability = observability;

    expect(evaluateDefaultSystemConfig(raw, process.cwd(), { credentialResolver }).status).toBe('BLOCKED');
  });
});

interface MutableConfig extends Record<string, unknown> {
  observability: Record<string, unknown>;
}

function builtInConfig(): MutableConfig {
  const config = parseBuiltInConfig(
    readFileSync(join(process.cwd(), 'packages', 'agent-app', 'config', 'default-system.yaml'), 'utf8'),
  ) as MutableConfig;
  const profiles = config.modelProfiles as Array<Record<string, unknown>>;
  const models = profiles[0]?.models as Array<Record<string, unknown>>;
  profiles[0] = {
    ...profiles[0],
    baseUrl: 'https://example.invalid/v1',
    models: [{ ...models[0], modelId: 'test-model' }, ...models.slice(1)],
  };
  return config;
}
