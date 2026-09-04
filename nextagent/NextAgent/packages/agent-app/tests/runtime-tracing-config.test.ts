import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createAppCredentialResolver } from '../src/config/env.js';
import { parseBuiltInConfig } from '../src/config/system-config.js';
import { validateDefaultSystemConfig } from '../src/config/validation.js';

const credentialResolver = createAppCredentialResolver({
  OPENAI_API_KEY: 'test-key',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otel.example/v1/traces',
  OTEL_AUTH_PK: 'pk',
  OTEL_AUTH_SK: 'sk',
});

describe('runtime tracing configuration', () => {
  it.each([
    ['explicitly disabled with exporter', false, completeExporter(), false],
    ['explicitly enabled without exporter', true, {}, true],
    ['explicitly enabled with exporter', true, completeExporter(), true],
    ['legacy complete exporter', undefined, completeExporter(), true],
    ['absent exporter', undefined, {}, false],
  ] as const)('normalizes %s', (_name, enabled, exporter, expected) => {
    const raw = builtInConfig();
    raw.observability.tracing = {
      ...(enabled === undefined ? {} : { enabled }),
      ...exporter,
      serviceName: 'nextagent-test',
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), {
      credentialResolver,
    });

    expect(config.observability.tracing?.enabled).toBe(expected);
  });

  it('accepts endpoint-only exporter configuration without credentials', () => {
    const raw = builtInConfig();
    raw.observability.tracing = {
      enabled: true,
      endpoint: 'env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), {
      credentialResolver,
    });

    expect(config.observability.tracing?.enabled).toBe(true);
    expect(config.observability.tracing?.endpoint).toBe('env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
  });

  it('accepts endpoint with credentials configured (credentials ignored)', () => {
    const raw = builtInConfig();
    raw.observability.tracing = {
      enabled: true,
      endpoint: 'env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      authPkRef: 'env:OTEL_AUTH_PK',
      authSkRef: 'env:OTEL_AUTH_SK',
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), {
      credentialResolver,
    });

    expect(config.observability.tracing?.enabled).toBe(true);
  });

  it('ignores credentials without endpoint (no partial config error)', () => {
    const raw = builtInConfig();
    raw.observability.tracing = {
      enabled: true,
      authPkRef: 'env:OTEL_AUTH_PK',
      authSkRef: 'env:OTEL_AUTH_SK',
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), {
      credentialResolver,
    });

    expect(config.observability.tracing?.enabled).toBe(true);
  });

  it('ignores partial exporter fields when tracing is explicitly disabled', () => {
    const raw = builtInConfig();
    raw.observability.tracing = {
      enabled: false,
      endpoint: 'env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), {
      credentialResolver,
    });

    expect(config.observability.tracing?.enabled).toBe(false);
  });
});

interface MutableConfig extends Record<string, unknown> {
  observability: {
    tracing?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

function builtInConfig(): MutableConfig {
  const config = parseBuiltInConfig(
    readFileSync(join(process.cwd(), 'packages', 'agent-app', 'config', 'default-system.yaml'), 'utf8'),
  ) as MutableConfig;
  const profiles = config['modelProfiles'] as Array<Record<string, unknown>>;
  const models = profiles[0]?.['models'] as Array<Record<string, unknown>>;
  profiles[0] = {
    ...profiles[0],
    models: [{ ...models[0], modelId: 'test-model' }],
    baseUrl: 'https://example.invalid/v1',
  };
  return config;
}

function completeExporter() {
  return {
    endpoint: 'env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    authPkRef: 'env:OTEL_AUTH_PK',
    authSkRef: 'env:OTEL_AUTH_SK',
  } as const;
}

function temporaryConfigRoot(): string {
  return mkdtempSync(join(tmpdir(), 'nextagent-tracing-config-'));
}
