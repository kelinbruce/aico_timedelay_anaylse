import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand, noopRuntimeLogger } from '@nextagent/agent-common';
import type { GatewayProvider } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import {
  createLocalGatewayProvider,
  createLocalCronTaskScheduler,
  createLocalRagKnowledgeGovernance,
  createRestrictedLocalSandboxGateway,
  createSqliteCronTaskGateway,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { createInMemoryMetricsRegistry } from '@nextagent/agent-observability';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadBuiltInDefaultAgentDefinition } from '../src/assembly/agent-directory-loader.js';
import { runProductCompositionAsync, runProductCompositionSync } from '../src/composition/create-app.js';
import { createLocalConfiguredAuthChannelContribution } from '../src/composition/local-configured-auth-channel-contribution.js';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { createComposedApp, createComposedAppAsync } from '../src/testing.js';
import { createScriptedModelProviderFixture } from '../src/testing/scripted-model-provider-fixture.js';

describe('product composition runners', () => {
  it.each(['0.0.0.0', '::', '192.0.2.10'])('blocks local configured auth composition for non-loopback host %s', async (host) => {
    const fixture = await createRunnerFixture();
    try {
      let failure: unknown;
      try {
        runProductCompositionSync(
          { ...fixture.options, systemConfig: withLocalConfiguredAuthHost(fixture.options.systemConfig, host) },
          localConfiguredAuthSelection(),
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({ code: 'APP_CONFIG_BLOCKED' });
      expect(JSON.stringify(failure)).not.toContain(host);
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('applies the local configured auth host guard to async composition', async () => {
    const fixture = await createRunnerFixture();
    try {
      await expect(
        runProductCompositionAsync(
          { ...fixture.options, systemConfig: withLocalConfiguredAuthHost(fixture.options.systemConfig, '::') },
          localConfiguredAuthSelection(),
        ),
      ).rejects.toMatchObject({ code: 'APP_CONFIG_BLOCKED' });
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('accepts IPv6 loopback for local configured auth and does not restrict DEFAULT_WEB', async () => {
    const localFixture = await createRunnerFixture();
    const defaultFixture = await createRunnerFixture();
    try {
      const localOutcome = runProductCompositionSync(
        {
          ...localFixture.options,
          systemConfig: withLocalConfiguredAuthHost(localFixture.options.systemConfig, '::1'),
          cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        },
        localConfiguredAuthSelection(),
      );
      await localOutcome.app.close();
      const defaultOutcome = runProductCompositionSync(
        {
          ...defaultFixture.options,
          systemConfig: withChannelHost(defaultFixture.options.systemConfig, '::'),
          cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        },
        { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' },
      );
      await defaultOutcome.app.close();
    } finally {
      await rm(localFixture.tempDir, { recursive: true, force: true });
      await rm(defaultFixture.tempDir, { recursive: true, force: true });
    }
  });

  it('fails directory preparation after assembly validation and rolls back accepted resources', async () => {
    const fixture = await createRunnerFixture();
    const blockedRuntimeRoot = join(fixture.tempDir, 'blocked-runtime-root');
    await writeFile(blockedRuntimeRoot, 'not-a-directory', 'utf8');
    try {
      await expect(
        createComposedAppAsync(
          {
            ...fixture.options,
            systemConfig: {
              ...fixture.options.systemConfig,
              paths: {
                ...fixture.options.systemConfig.paths,
                runtimeWorkspaceRoot: blockedRuntimeRoot,
              },
            },
          },
          noopModel(),
        ),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
      expect(fixture.closeGatewayBindings).not.toHaveBeenCalled();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('rolls back accepted resources once and preserves the original sync failure', async () => {
    const fixture = await createRunnerFixture();
    const failure = new Error('extension registration failed');
    try {
      expect(() =>
        createComposedApp(
          {
            ...fixture.options,
            trustedLocalWebExtensionRegistration: () => {
              throw failure;
            },
          },
          noopModel(),
        ),
      ).toThrow(failure);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fixture.closeGatewayBindings).toHaveBeenCalledOnce();
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('awaits reverse rollback and preserves the original async failure', async () => {
    const fixture = await createRunnerFixture();
    const failure = new Error('extension registration failed');
    try {
      await expect(
        createComposedAppAsync(
          {
            ...fixture.options,
            trustedLocalWebExtensionRegistration: () => {
              throw failure;
            },
          },
          noopModel(),
        ),
      ).rejects.toBe(failure);
      expect(fixture.closeGatewayBindings).toHaveBeenCalledOnce();
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('keeps frontend finalization inside the uncommitted async failure scope', async () => {
    const fixture = await createRunnerFixture();
    const failure = new Error('frontend manifest unavailable');
    const scriptedModel = createScriptedModelProviderFixture(fixture.options.systemConfig, noopModel());
    try {
      await expect(
        runProductCompositionAsync(
          {
            ...fixture.options,
            systemConfig: scriptedModel.systemConfig,
            modelGatewayProviders: scriptedModel.modelGatewayProviders,
          },
          { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'WITH_FRONTEND' },
          {
            productVersion: '1.0.0',
            resolveFrontendHostingManifest: () => {
              throw failure;
            },
            useDefaultWorkbenchScripts: false,
          },
        ),
      ).rejects.toBe(failure);
      expect(fixture.closeGatewayBindings).toHaveBeenCalledOnce();
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('rolls back after channel registration when remote Cron credentials are missing', async () => {
    const fixture = await createRunnerFixture();
    try {
      await expect(
        createComposedAppAsync(
          {
            ...fixture.options,
            gatewayProviders: [...fixture.options.gatewayProviders, remoteCronGatewayProvider()],
            systemConfig: withRemoteCron(fixture.options.systemConfig),
          },
          noopModel(),
        ),
      ).rejects.toMatchObject({ code: 'CRON_CALLBACK_CREDENTIAL_REQUIRED' });
      expect(fixture.closeGatewayBindings).toHaveBeenCalledOnce();
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('fails at selected Cron gateway resolution before remote runtime prerequisites', async () => {
    const fixture = await createRunnerFixture();
    try {
      await expect(
        createComposedAppAsync(
          {
            ...fixture.options,
            systemConfig: withRemoteCron(fixture.options.systemConfig),
          },
          noopModel(),
        ),
      ).rejects.toMatchObject({ code: 'GATEWAY_PROVIDER_MISSING' });
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('validates remote Cron registration after its credential and rolls back once', async () => {
    const fixture = await createRunnerFixture();
    try {
      await expect(
        createComposedAppAsync(
          {
            ...fixture.options,
            gatewayProviders: [...fixture.options.gatewayProviders, remoteCronGatewayProvider()],
            systemConfig: withRemoteCron(fixture.options.systemConfig),
            cronTriggerCallbackCredentialRef: brand('env:NEXTAGENT_TEST_CRON_CALLBACK'),
          },
          noopModel(),
        ),
      ).rejects.toMatchObject({ code: 'CRON_CALLBACK_REGISTRATION_REQUIRED' });
      expect(fixture.closeGatewayBindings).toHaveBeenCalledOnce();
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('preserves a remote Cron route-registration failure and rolls back once', async () => {
    const fixture = await createRunnerFixture();
    const failure = new Error('callback route registration failed');
    try {
      await expect(
        createComposedAppAsync(
          {
            ...fixture.options,
            gatewayProviders: [...fixture.options.gatewayProviders, remoteCronGatewayProvider()],
            systemConfig: withRemoteCron(fixture.options.systemConfig),
            cronTriggerCallbackCredentialRef: brand('env:NEXTAGENT_TEST_CRON_CALLBACK'),
            cronTriggerCallbackRegistration: () => {
              throw failure;
            },
          },
          noopModel(),
        ),
      ).rejects.toBe(failure);
      expect(fixture.closeGatewayBindings).toHaveBeenCalledOnce();
      expect(fixture.closeOperationalWriter).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });
});

async function createRunnerFixture() {
  const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-composition-runner-'));
  const credentialResolver = createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    NEXTAGENT_TEST_LOCAL_AUTH: 'test-local-auth',
  });
  const systemConfig = resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver });
  const closeGatewayBindings = vi.fn(async () => undefined);
  const closeOperationalWriter = vi.fn(async () => undefined);
  const localProvider = createLocalGatewayProvider();
  const observedLocalProvider: GatewayProvider = {
    ...localProvider,
    create(input) {
      const bindings = localProvider.create(input);
      return {
        ...bindings,
        async close() {
          await closeGatewayBindings();
          await bindings.close?.();
        },
      };
    },
  };
  const operationalLogWriter: OperationalLogWriter = {
    getLogger: () => noopRuntimeLogger,
    getObservationLogger: () => noopRuntimeLogger,
    activeIdentity: () => undefined,
    flush: vi.fn(async () => undefined),
    close: closeOperationalWriter,
  };
  return {
    tempDir,
    closeGatewayBindings,
    closeOperationalWriter,
    options: {
      systemConfig,
      agentDefinition: loadBuiltInDefaultAgentDefinition(),
      credentialResolver,
      operationalLogWriter,
      metricsRegistry: createInMemoryMetricsRegistry(),
      gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), observedLocalProvider],
      cronTaskGatewayFactory: createSqliteCronTaskGateway,
      sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
      ragRetrievalFactory: createLocalRagKnowledgeGovernance,
    },
  };
}

function localConfiguredAuthSelection(): NonNullable<Parameters<typeof runProductCompositionSync>[1]> {
  return {
    channelAuthProfile: 'LOCAL_CONFIGURED_AUTH' as const,
    frontendHostingProfile: 'NONE' as const,
    localConfiguredAuthContribution: createLocalConfiguredAuthChannelContribution(),
  };
}

function withLocalConfiguredAuthHost(
  systemConfig: ReturnType<typeof resolveDefaultSystemConfig>,
  host: string,
): ReturnType<typeof resolveDefaultSystemConfig> {
  return {
    ...withChannelHost(systemConfig, host),
    auth: {
      ...systemConfig.auth,
      localAuth: {
        enabled: true,
        credentialRef: brand('env:NEXTAGENT_TEST_LOCAL_AUTH'),
        cookieTtlMs: 3_600_000,
      },
    },
  };
}

function withChannelHost(systemConfig: ReturnType<typeof resolveDefaultSystemConfig>, host: string): ReturnType<typeof resolveDefaultSystemConfig> {
  return {
    ...systemConfig,
    channel: {
      ...systemConfig.channel,
      host,
    },
  };
}

function noopModel(): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* () {
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function withRemoteCron(systemConfig: ReturnType<typeof resolveDefaultSystemConfig>) {
  return {
    ...systemConfig,
    gatewaySelection: {
      ...systemConfig.gatewaySelection,
      entries: systemConfig.gatewaySelection.entries.map((entry) =>
        entry.adapterKind === 'cron-tasks' ? { ...entry, deploymentMode: 'REMOTE' as const } : entry,
      ),
    },
  };
}

function remoteCronGatewayProvider(): GatewayProvider {
  return {
    providerId: 'remote-cron',
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: ['cron-tasks'],
    create(input) {
      const cronTasks = createSqliteCronTaskGateway(input.runtime.paths.sqliteFile);
      return {
        providerId: 'remote-cron',
        deploymentMode: 'REMOTE',
        readiness: {
          state: 'READY',
          evidenceRef: 'gateway-provider:remote-cron:ready',
          safeMessage: 'Remote Cron test gateway is ready.',
        },
        cronTasks,
        close: () => (cronTasks as { close?: () => Promise<void> | void }).close?.(),
      };
    },
  };
}
