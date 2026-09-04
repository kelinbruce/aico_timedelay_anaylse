import type { RuntimeLogger } from '@nextagent/agent-common';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import { createInMemoryMetricsRegistry, createMetricsInfrastructure } from '@nextagent/agent-observability';
import { describe, expect, it } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import {
  createAppOperationalLogWriter,
  preloadObservabilityCompositionAsync,
  preloadObservabilityCompositionSync,
} from '../src/composition/observability-composition.js';

describe('observability composition preload', () => {
  it('rejects missing or invalid deployment service versions before creating the writer', async () => {
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });

    await expect(createAppOperationalLogWriter(systemConfig, undefined as unknown as string)).rejects.toMatchObject({
      code: 'APP_SERVICE_VERSION_INVALID',
    });
    await expect(createAppOperationalLogWriter(systemConfig, 'invalid/service/version')).rejects.toMatchObject({
      code: 'APP_SERVICE_VERSION_INVALID',
    });
  });

  it('keeps injected registry precedence and returns the same sync/async output shape', async () => {
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const resolved = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const systemConfig = {
      ...resolved,
      observability: {
        ...resolved.observability,
        tracing: { enabled: false },
      },
    };
    const bootstrapRegistry = createInMemoryMetricsRegistry();
    const injectedRegistry = createInMemoryMetricsRegistry();
    const metricsInfrastructure = createMetricsInfrastructure({
      serviceName: 'nextagent-test',
      serviceVersion: '1.0.0',
      deploymentMode: 'LOCAL',
    });
    const syncWriter = captureOperationalLogWriter();
    const asyncWriter = captureOperationalLogWriter();

    const syncComposition = preloadObservabilityCompositionSync({
      systemConfig,
      bootstrapMetricsRegistry: bootstrapRegistry,
      operationalLogWriter: syncWriter,
      metricsRegistry: injectedRegistry,
      metricsInfrastructure,
    });
    syncComposition.runtimeLoggerProviderBinding?.unbind();
    const asyncComposition = await preloadObservabilityCompositionAsync({
      systemConfig,
      bootstrapMetricsRegistry: bootstrapRegistry,
      operationalLogWriter: asyncWriter,
      metricsRegistry: injectedRegistry,
      metricsInfrastructure,
      credentialResolver,
    });

    try {
      expect(Object.keys(syncComposition).sort()).toEqual(Object.keys(asyncComposition).sort());
      expect(syncComposition.metricsRegistry).toBe(injectedRegistry);
      expect(asyncComposition.metricsRegistry).toBe(injectedRegistry);
      expect(syncComposition.metricsInfrastructure).toBe(metricsInfrastructure);
      expect(asyncComposition.metricsInfrastructure).toBe(metricsInfrastructure);
      expect(syncComposition.operationalLogWriter).toBe(syncWriter);
      expect(asyncComposition.operationalLogWriter).toBe(asyncWriter);
    } finally {
      asyncComposition.runtimeLoggerProviderBinding?.unbind();
      await metricsInfrastructure.shutdown(1_000);
    }
  });

  it('initializes in-process tracing without an injected projector or exporter', async () => {
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const resolved = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const systemConfig = {
      ...resolved,
      observability: {
        ...resolved.observability,
        tracing: {
          enabled: true,
          serviceName: 'nextagent-composition-test',
        },
      },
    };
    const bootstrapRegistry = createInMemoryMetricsRegistry();
    const metricsInfrastructure = createMetricsInfrastructure({
      serviceName: 'nextagent-test',
      serviceVersion: '1.0.0',
      deploymentMode: 'LOCAL',
    });
    const entries: object[] = [];
    const composition = await preloadObservabilityCompositionAsync({
      systemConfig,
      bootstrapMetricsRegistry: bootstrapRegistry,
      operationalLogWriter: captureOperationalLogWriter(entries),
      metricsInfrastructure,
      credentialResolver,
    });

    try {
      expect(composition.traceEnabled).toBe(true);
      expect(composition.traceProjector).toBeDefined();
      expect(entries).toContainEqual(
        expect.objectContaining({
          event: 'otel.trace.init.completed',
        }),
      );
    } finally {
      composition.runtimeLoggerProviderBinding?.unbind();
      await metricsInfrastructure.shutdown(1_000);
    }
  });
});

function captureOperationalLogWriter(entries: object[] = []): OperationalLogWriter {
  const write = (fields: object): void => {
    entries.push(fields);
  };
  const logger: RuntimeLogger = { debug: write, info: write, warn: write, error: write };
  return {
    getLogger: () => logger,
    getObservationLogger: () => logger,
    activeIdentity: () => undefined,
    async flush() {},
    async close() {},
  };
}
