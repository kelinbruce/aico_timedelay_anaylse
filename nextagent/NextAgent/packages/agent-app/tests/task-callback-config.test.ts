import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createAppCredentialResolver } from '../src/config/env.js';
import { parseBuiltInConfig } from '../src/config/system-config.js';
import { evaluateDefaultSystemConfig, validateDefaultSystemConfig } from '../src/config/validation.js';

const credentialResolver = createAppCredentialResolver({ OPENAI_API_KEY: 'test-key' });

describe('task callback trusted configuration', () => {
  it('defaults to disabled origins and bounded delivery limits', () => {
    const config = validateDefaultSystemConfig(builtInConfig(), temporaryConfigRoot(), { credentialResolver });

    expect(config.taskCallback).toEqual({ allowedOrigins: [], timeoutMs: 30_000, maxRetries: 3 });
  });

  it('accepts an explicit origin allowlist and bounded delivery limits', () => {
    const raw = builtInConfig();
    raw.taskCallback = {
      allowedOrigins: ['https://ir.example'],
      timeoutMs: 5_000,
      maxRetries: 2,
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });

    expect(config.taskCallback).toEqual({
      allowedOrigins: ['https://ir.example'],
      timeoutMs: 5_000,
      maxRetries: 2,
    });
  });

  it('accepts a socketPath for UDS callback delivery', () => {
    const raw = builtInConfig();
    raw.taskCallback = {
      allowedOrigins: ['http://localhost'],
      socketPath: '/var/run/nextagent/callback.sock',
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });

    expect(config.taskCallback.socketPath).toBe('/var/run/nextagent/callback.sock');
  });

  it.each([{ timeoutMs: 99 }, { timeoutMs: 120_001 }, { maxRetries: 0 }, { maxRetries: 11 }])(
    'rejects out-of-bound transport limits %#',
    (taskCallback) => {
      const raw = builtInConfig();
      raw.taskCallback = taskCallback;

      expect(evaluateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver }).status).toBe('BLOCKED');
    },
  );

  it.each(['file:///callback', 'https://ir.example/path', 'https://user:secret@ir.example'])(
    'rejects a non-origin allowlist entry without exposing it: %s',
    (origin) => {
      const raw = builtInConfig();
      raw.taskCallback = { allowedOrigins: [origin] };

      const evaluation = evaluateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });
      expect(evaluation.status).toBe('BLOCKED');
      expect(JSON.stringify(evaluation.evidenceInput)).not.toContain(origin);
    },
  );
});

interface MutableConfig extends Record<string, unknown> {
  taskCallback?: Record<string, unknown>;
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

function temporaryConfigRoot(): string {
  return mkdtempSync(join(tmpdir(), 'nextagent-task-callback-config-'));
}
