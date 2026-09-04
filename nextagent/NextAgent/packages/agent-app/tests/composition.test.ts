import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand } from '@nextagent/agent-common';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { LongTermMemoryManagementPort } from '@nextagent/agent-contracts/channel';
import type { GatewayProvider } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import {
  createLocalCronTaskScheduler,
  createLocalGatewayProvider,
  createLocalRagKnowledgeGovernance,
  createRestrictedLocalSandboxGateway,
  createSqliteCronTaskGateway,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBuiltInDefaultAgentDefinition } from '../src/assembly/agent-directory-loader.js';
import {
  createComposedApp,
  createComposedAppAsync,
  createProviderConfiguredComposedApp,
  createProviderConfiguredComposedAppAsync,
} from '../src/testing.js';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { reportModelDiagnostics } from '../src/composition/model-diagnostics.js';
import { createPluginFixture, pluginWithProvidersSource } from './plugin-test-helpers.js';

describe('app composition', () => {
  it('initializes tracing before async task-channel composition without an injected projector', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-trace-composition-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const resolved = resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver });
    let taskChannelTraceEnabled: boolean | undefined;
    const app = await createComposedAppAsync(
      {
        systemConfig: {
          ...resolved,
          observability: {
            ...resolved.observability,
            tracing: {
              enabled: true,
              serviceName: 'nextagent-composition-test',
            },
          },
        },
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        taskChannelRegistration(context) {
          taskChannelTraceEnabled = context.traceEnabled;
        },
      },
      noopModel(),
    );

    try {
      expect(taskChannelTraceEnabled).toBe(true);
    } finally {
      await app.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('injects the memory management port only when memory is enabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-management-composition-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver });
    let enabledManagement: LongTermMemoryManagementPort | undefined;
    let enabledUserQueryBinding = false;
    let legacyBindingsExposed = false;
    const enabledApp = createComposedApp(
      {
        systemConfig,
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        webChannelRegistration(context) {
          enabledManagement = context.longTermMemoryManagement;
          enabledUserQueryBinding = context.gatewayBindings?.userQuery !== undefined;
          legacyBindingsExposed = Object.hasOwn(context, 'longTermMemoryStores');
        },
      },
      noopModel(),
    );

    try {
      expect(enabledManagement).toBeDefined();
      expect(systemConfig.gatewaySelection.entries.map((entry) => entry.adapterKind)).toContain('user-query');
      expect(enabledUserQueryBinding).toBe(true);
      expect(legacyBindingsExposed).toBe(false);
      const managementScope = {
        identityContext: {
          tenantId: brand<string, 'TenantId'>(systemConfig.auth.localIdentity.tenantId),
          subjectId: brand<string, 'SubjectId'>(systemConfig.auth.localIdentity.subjectId),
          displayName: systemConfig.auth.localIdentity.displayName ?? systemConfig.auth.localIdentity.subjectId,
        },
        agentId: systemConfig.activeAgentId,
      };
      const saved = await enabledManagement!.manualSaveLongTermMemory({
        ...managementScope,
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'CONFIGURED',
        briefIndex: 'Local publisher name',
        content: 'Verify the local user-query binding.',
        labels: [],
        confidence: 1,
      });
      if ('code' in saved) {
        throw new Error(saved.message);
      }
      const published = await enabledManagement!.publishLongTermMemory({ ...managementScope, memoryId: saved.memoryId });
      if ('code' in published) {
        throw new Error(published.message);
      }
      await expect(enabledManagement!.listPublishedLongTermMemory({ ...managementScope, limit: 10, offset: 0 })).resolves.toMatchObject({
        items: [
          {
            ownerSubjectId: managementScope.identityContext.subjectId,
            ownerUserName: `${managementScope.identityContext.subjectId}-name`,
          },
        ],
      });
    } finally {
      await enabledApp.close().catch(() => undefined);
    }

    let disabledManagement: LongTermMemoryManagementPort | undefined;
    const disabledApp = createComposedApp(
      {
        systemConfig: {
          ...systemConfig,
          memory: {
            ...systemConfig.memory,
            enabled: false,
            status: 'DISABLED',
            extraction: { ...systemConfig.memory.extraction, enabled: false },
            aging: { ...systemConfig.memory.aging, enabled: false },
          },
        },
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        webChannelRegistration(context) {
          disabledManagement = context.longTermMemoryManagement;
        },
      },
      noopModel(),
    );

    try {
      expect(disabledManagement).toBeUndefined();
    } finally {
      await disabledApp.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads configured plugins during synchronous startup composition', async () => {
    const fixture = createPluginFixture({
      source: pluginWithProvidersSource('telecom', ['telecom.tools']),
    });
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: fixture.root, credentialResolver });
    const app = createComposedApp(
      {
        systemConfig: { ...systemConfig, pluginSystem: { plugins: [fixture.entry] } },
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
      },
      noopModel(),
    );

    try {
      expect(await app.assemblyRegistry.active(brand<string, 'AgentId'>('default-agent'))).toMatchObject({
        agentId: 'default-agent',
      });
    } finally {
      await app.close().catch(() => undefined);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails closed through the plugin loader during synchronous startup composition', async () => {
    const fixture = createPluginFixture({ source: `export default "not-a-plugin";` });
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: fixture.root, credentialResolver });

    try {
      expect(() =>
        createComposedApp(
          {
            systemConfig: { ...systemConfig, pluginSystem: { plugins: [fixture.entry] } },
            agentDefinition: loadBuiltInDefaultAgentDefinition(),
            credentialResolver,
            gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
            cronTaskGatewayFactory: createSqliteCronTaskGateway,
            cronTaskSchedulerFactory: createLocalCronTaskScheduler,
            ragRetrievalFactory: createLocalRagKnowledgeGovernance,
            sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
          },
          noopModel(),
        ),
      ).toThrow('Required plugin failed');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('uses a preloaded plugin registry snapshot without reading configured plugin directories', async () => {
    const fixture = createPluginFixture({ source: `throw new Error("configured plugin must not be evaluated");` });
    await rm(fixture.pluginDir, { recursive: true, force: true });
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: fixture.root, credentialResolver });
    const pluginRegistrySnapshot = Object.freeze({
      plugins: Object.freeze([]),
      providers: Object.freeze([]),
      policies: Object.freeze([]),
      hooks: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
    const options = {
      systemConfig: { ...systemConfig, pluginSystem: { plugins: [fixture.entry] } },
      agentDefinition: loadBuiltInDefaultAgentDefinition(),
      credentialResolver,
      pluginRegistrySnapshot,
      gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
      cronTaskGatewayFactory: createSqliteCronTaskGateway,
      cronTaskSchedulerFactory: createLocalCronTaskScheduler,
      ragRetrievalFactory: createLocalRagKnowledgeGovernance,
      sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
    };
    const syncApp = createComposedApp(options, noopModel());
    const asyncApp = await createComposedAppAsync(options, noopModel());

    try {
      expect(syncApp.capabilityProviders.providers).toEqual([]);
      expect(asyncApp.capabilityProviders.providers).toEqual([]);
    } finally {
      await syncApp.close().catch(() => undefined);
      await asyncApp.close().catch(() => undefined);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(['LOCAL', 'REMOTE'] as const)(
    'keeps synchronous and asynchronous app projections equivalent for the same frozen %s inputs',
    async (deploymentMode) => {
      const tempDir = await mkdtemp(join(tmpdir(), `nextagent-composition-equivalence-${deploymentMode.toLowerCase()}-`));
      const credentialResolver = createAppCredentialResolver({
        OPENAI_API_KEY: 'test-only',
        OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
        OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
      });
      const baseSystemConfig = resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver });
      const systemConfig = {
        ...baseSystemConfig,
        deployment: {
          ...baseSystemConfig.deployment,
          mode: deploymentMode,
        },
      };
      const pluginRegistrySnapshot = Object.freeze({
        plugins: Object.freeze([]),
        providers: Object.freeze([]),
        policies: Object.freeze([]),
        hooks: Object.freeze([]),
        diagnostics: Object.freeze([]),
      });
      const developerDiagnosticWriterInputs: Array<{ readonly logDirectory: string }> = [];
      const options = {
        systemConfig,
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        pluginRegistrySnapshot,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        developerDiagnosticArtifactWriterFactory(input: { readonly logDirectory: string }) {
          developerDiagnosticWriterInputs.push(input);
          return {
            async start() {},
            async emit() {
              return { status: 'ACCEPTED' as const };
            },
            async close() {},
            status() {
              return { availability: 'AVAILABLE' as const, droppedCount: 0 };
            },
          };
        },
      };
      const syncApp = createProviderConfiguredComposedApp(options);
      const asyncApp = await createProviderConfiguredComposedAppAsync(options);

      try {
        const expectedProjection = [
          'server',
          'runtime',
          'sessions',
          'gateway',
          'assemblyRegistry',
          'auditWriter',
          'metricsRegistry',
          'metricsReadiness',
          'health',
          'capabilityProviders',
          'systemConfig',
          'start',
          'close',
        ];
        expect(Object.keys(syncApp).sort()).toEqual(expectedProjection.filter((key) => key !== 'auditWriter' || 'auditWriter' in syncApp).sort());
        expect(Object.keys(asyncApp).sort()).toEqual(expectedProjection.filter((key) => key !== 'auditWriter' || 'auditWriter' in asyncApp).sort());
        expect(Object.keys(syncApp).sort()).toEqual(Object.keys(asyncApp).sort());
        expect(syncApp).not.toBe(asyncApp);
        expect(syncApp.server).not.toBe(asyncApp.server);
        expect(syncApp.systemConfig).toBe(systemConfig);
        expect(asyncApp.systemConfig).toBe(systemConfig);
        expect(syncApp).not.toHaveProperty('productModel' + 'ProviderKind');
        expect(asyncApp).not.toHaveProperty('productModel' + 'ProviderKind');
        expect(syncApp).not.toHaveProperty('modelProfile' + 'Registry');
        expect(asyncApp).not.toHaveProperty('modelProfile' + 'Registry');
        expect(syncApp.capabilityProviders).toEqual(asyncApp.capabilityProviders);
        expect(syncApp.systemConfig.modelProfiles).toBe(asyncApp.systemConfig.modelProfiles);
        expect(syncApp.metricsReadiness()).toEqual(asyncApp.metricsReadiness());
        expect((await syncApp.health.primary()).status).toBe((await asyncApp.health.primary()).status);
        expect(Object.isFrozen(pluginRegistrySnapshot)).toBe(true);
        expect(developerDiagnosticWriterInputs).toEqual([
          { logDirectory: systemConfig.paths.logDirectory },
          { logDirectory: systemConfig.paths.logDirectory },
        ]);
      } finally {
        await syncApp.close().catch(() => undefined);
        await asyncApp.close().catch(() => undefined);
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );

  it('injects default bundled Tool dependencies including eager Cron', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-composition-todowrite-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    let catalog: CapabilityCatalog | undefined;
    const systemConfig = resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver });
    expect(systemConfig.gatewaySelection.entries).toContainEqual({
      gatewayId: 'local-cron',
      adapterKind: 'cron-tasks',
      deploymentMode: 'LOCAL',
      selectionState: 'enabled',
    });
    const app = createComposedApp(
      {
        systemConfig,
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        webChannelRegistration(context) {
          catalog = context.catalog;
        },
      },
      noopModel(),
    );

    try {
      expect(catalog).toBeDefined();
      const descriptors = await catalog!.listAvailable({
        tenantId: brand<string, 'TenantId'>('tenant-todo-composition'),
        subjectId: brand<string, 'SubjectId'>('subject-todo-composition'),
        agentAssembly: await app.assemblyRegistry.active(brand<string, 'AgentId'>('default-agent')),
        includeUnavailable: false,
        modelInvocable: true,
      });
      const assembly = await app.assemblyRegistry.active(brand<string, 'AgentId'>('default-agent'));

      expect(assembly.workspacePolicy.roots).toContainEqual({ kind: 'sharedData', logicalPath: 'shared-data', access: 'read' });
      expect(descriptors.find((descriptor) => descriptor.capabilityId === 'TodoWrite')).toMatchObject({
        capabilityId: 'TodoWrite',
        displayName: 'TodoWrite',
        availabilityStatus: 'AVAILABLE',
        replayPolicy: 'IDEMPOTENT',
      });
      expect(descriptors.find((descriptor) => descriptor.capabilityId === 'Cron')).toMatchObject({
        capabilityId: 'Cron',
        displayName: 'Cron',
        availabilityStatus: 'AVAILABLE',
        disclosurePolicy: { mode: 'EAGER' },
      });
    } finally {
      await app.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps custom Web authoritative and registers task then Cron without invoking the trusted extension', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-channel-custom-precedence-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const order: string[] = [];
    let customReceivedActivityPort = false;
    let customInheritedBuiltinActivityRoutes = false;
    const app = createComposedApp(
      {
        systemConfig: resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver }),
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory(input) {
          order.push('cron');
          return createLocalCronTaskScheduler(input);
        },
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        webChannelRegistration(context) {
          customReceivedActivityPort = typeof context.sessionActivities.streamSessionActivities === 'function';
          customInheritedBuiltinActivityRoutes = context.server.hasRoute({
            method: 'GET',
            url: '/api/v1/session-activities/stream',
          });
          order.push('custom-web');
        },
        trustedLocalWebExtensionRegistration() {
          order.push('extension');
        },
        taskChannelRegistration() {
          order.push('task');
        },
      },
      noopModel(),
    );

    try {
      expect(order).toEqual(['custom-web', 'task', 'cron']);
      expect(customReceivedActivityPort).toBe(true);
      expect(customInheritedBuiltinActivityRoutes).toBe(false);
    } finally {
      await app.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('registers builtin Web before the trusted extension and then registers task and Cron', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-channel-default-precedence-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const order: string[] = [];
    let builtinWebRegistered = false;
    let builtinActivityRoutesRegistered = false;
    const app = createComposedApp(
      {
        systemConfig: resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver }),
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory(input) {
          order.push('cron');
          return createLocalCronTaskScheduler(input);
        },
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        trustedLocalWebExtensionRegistration(context) {
          builtinWebRegistered = context.server.hasRoute({ method: 'POST', url: '/api/v1/requests' });
          builtinActivityRoutesRegistered =
            context.server.hasRoute({ method: 'GET', url: '/api/v1/session-activities/stream' }) &&
            context.server.hasRoute({ method: 'POST', url: '/api/v1/sessions/:sessionId/activity/consume' }) &&
            context.server.server.listenerCount('upgrade') === 1;
          order.push('extension');
        },
        taskChannelRegistration() {
          order.push('task');
        },
      },
      noopModel(),
    );

    try {
      expect(builtinWebRegistered).toBe(true);
      expect(builtinActivityRoutesRegistered).toBe(true);
      expect(order).toEqual(['extension', 'task', 'cron']);
    } finally {
      await app.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves SkillHub installDir from workspaceRoot without moving credential file refs', async () => {
    const configRoot = await mkdtemp(join(tmpdir(), 'nextagent-composition-config-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: configRoot, credentialResolver });
    mkdirSync(join(configRoot, 'secrets'), { recursive: true });
    writeFileSync(join(configRoot, 'secrets', 'mcp-token.txt'), 'test-token', 'utf8');
    let skillHubExecutionCorrelation: unknown;
    let gatewayExecutionCorrelation: unknown;
    const localGatewayProvider = createLocalGatewayProvider();
    const observedLocalGatewayProvider: GatewayProvider = {
      ...localGatewayProvider,
      create(input) {
        gatewayExecutionCorrelation = input.executionCorrelation;
        return localGatewayProvider.create(input);
      },
    };
    const app = createComposedApp(
      {
        systemConfig: {
          ...systemConfig,
          userCapabilityProviders: [
            {
              id: 'hub-local',
              type: 'skill-hub',
              gatewayId: 'skillhub-main',
              installDir: 'skillhub-managed',
            },
            {
              id: 'mcp-config-secret',
              type: 'mcp-server',
              url: 'https://mcp.example.test',
              credential: brand<'file:secrets/mcp-token.txt', 'SecretReference'>('file:secrets/mcp-token.txt'),
            },
          ],
        },
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver,
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), observedLocalGatewayProvider],
        cronTaskGatewayFactory: createSqliteCronTaskGateway,
        cronTaskSchedulerFactory: createLocalCronTaskScheduler,
        ragRetrievalFactory: createLocalRagKnowledgeGovernance,
        sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
        skillHubAccessFactory(config, executionCorrelation) {
          skillHubExecutionCorrelation = executionCorrelation;
          return failingSkillHubGatewayFactory();
        },
      },
      noopModel(),
    );

    try {
      expect(app.capabilityProviders.providers).toContainEqual(
        expect.objectContaining({
          provider: { providerId: 'hub-local', providerKind: 'SKILL_HUB' },
          options: {
            gatewayId: 'skillhub-main',
            managedInstallRef: join(systemConfig.paths.workspaceRoot, 'skillhub-managed'),
          },
        }),
      );
      expect(app.capabilityProviders.diagnostics).not.toContainEqual(
        expect.objectContaining({
          providerId: 'mcp-config-secret',
          reasonCode: 'INVALID_CREDENTIAL_REFERENCE',
        }),
      );
      expect(app.capabilityProviders.diagnostics).toContainEqual(
        expect.objectContaining({
          providerId: 'mcp-config-secret',
          reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED',
        }),
      );
      expect(skillHubExecutionCorrelation).toBeDefined();
      expect(gatewayExecutionCorrelation).toBe(skillHubExecutionCorrelation);
    } finally {
      await app.close().catch(() => undefined);
      await rm(configRoot, { recursive: true, force: true });
    }
  });

  it('keeps gateway composition responsible for cancellable RAG build wiring', () => {
    const source = compositionSource('gateway-composition.ts');

    expect(source).toContain('ensureRagKnowledgeBuilt(signal?: AbortSignal)');
    expect(source).toContain('ragRetrieval.build(signal)');
    expect(source).toContain('createMemoryConfiguredGateway');
    expect(source).toContain('createGatewayTodoState');
  });

  it('keeps capability composition responsible for capability subsystem wiring', () => {
    const source = compositionSource('capability-composition.ts');

    expect(source).toContain('createCapabilitySubsystem');
    expect(source).toContain('createWorkflowRuntimeAdapters');
    expect(source).toContain('createWorkflowToolPort');
    expect(source).toContain('subsystem.maintenanceJobs');
  });

  it('keeps request runtime composition timeline-first without generic internal observation', () => {
    const source = compositionSource('request-runtime-composition.ts');

    expect(source).toContain('createTimelineObservationMapper');
    expect(source).toContain('createObservedRuntimeCommandPort');
    expect(source).not.toContain('createRuntimeInternalObserver');
    expect(source).not.toContain('diagnosticCandidates');
    expect(source).not.toContain('createObservationEvent');
  });

  it('keeps memory telemetry composition on observability adapters instead of event shaping', () => {
    const source = compositionSource('memory-config-telemetry.ts');
    const ownerSource = readFileSync(new URL('../../agent-observability/src/runtime/app-observation-adapters.ts', import.meta.url), 'utf8');
    const memoryOwnerSource = readFileSync(new URL('../../agent-memory/src/memory-gateway.ts', import.meta.url), 'utf8');

    expect(source).toContain('emitMemoryConfigurationObservation');
    expect(source).toContain('emitDisabledLongTermMemoryInvocationLog');
    expect(source).not.toContain('createObservationEvent');
    expect(source).not.toContain('diagnosticCandidates');
    expect(source).not.toContain('StructuredLogEntry');
    expect(ownerSource).toContain('MEMORY_CONFIG_EVALUATED');
    expect(ownerSource).toContain('MEMORY_DESCRIPTION_OVERRIDE_EVALUATED');
    expect(source).not.toContain('safeReasonCode: "LTM_DISABLED"');
    expect(memoryOwnerSource).toMatch(/readonly safeReasonCode: ['"]LTM_DISABLED['"]/u);
  });

  it('injects guardrail dependencies without exposing the memory write coordinator', () => {
    const memorySource = compositionSource('memory-maintenance-composition.ts');
    const appSource = compositionSource('create-app.ts');
    const channelSource = compositionSource('channel-composition.ts');

    expect(memorySource).not.toContain('LongTermMemoryWriteCoordinator');
    expect(memorySource).not.toContain('writeCoordinator');
    expect(memorySource).toContain('{ guardrail: input.guardrail }');
    expect(appSource).toContain('{ guardrail: gatewayBindings.guardrail }');
    expect(appSource).not.toContain('longTermMemoryWriteCoordinator');
    expect(channelSource).not.toContain('LongTermMemoryWriteCoordinator');
    expect(channelSource).toContain('{ guardrail: input.context.gatewayBindings.guardrail }');
  });

  it('keeps model diagnostics composition on observability adapters instead of event shaping', () => {
    const source = compositionSource('model-diagnostics.ts');
    const ownerSource = readFileSync(new URL('../../agent-observability/src/runtime/app-observation-adapters.ts', import.meta.url), 'utf8');

    expect(source).toContain('emitModelConfigurationExclusionObservation');
    expect(source).not.toContain('createObservationEvent');
    expect(source).not.toContain('diagnosticCandidates');
    expect(ownerSource).toContain('MODEL_PROFILE_EXCLUDED');
  });

  it('reports model validation evidence with the same safe code and without its message', () => {
    const agentId = brand<string, 'AgentId'>('agent-diagnostics');
    const agentVersion = brand<string, 'AgentVersion'>('v1');
    const observations: unknown[] = [];

    reportModelDiagnostics({
      validationEvidence: [
        {
          modelId: 'excluded-model',
          code: 'APP_CONFIG_SECRET_REF_INVALID',
          message: 'raw validation detail must not be projected',
        },
      ],
      projectorHost: { acceptObservation: (event) => observations.push(event) },
      ownerScope: {
        tenantId: brand<string, 'TenantId'>('tenant-diagnostics'),
        subjectId: brand<string, 'SubjectId'>('subject-diagnostics'),
        agentId,
        agentVersion,
      },
      agentScope: { agentId, agentVersion },
    });

    expect(observations).toEqual([
      expect.objectContaining({
        operation: 'MODEL_PROFILE_EXCLUDED',
        outcome: 'degraded',
        safeReasonCode: 'APP_CONFIG_SECRET_REF_INVALID',
      }),
    ]);
    expect(JSON.stringify(observations)).not.toContain('raw validation detail');
  });

  it('keeps context engine composition responsible for context owner factories', () => {
    const source = compositionSource('context-engine-composition.ts');

    expect(source).toContain('createDefaultLargeContentExternalizer');
    expect(source).toContain('createDefaultForkPromotionContentResolver');
    expect(source).toContain('createDefaultContextEngine');
    expect(source).toContain('commitCompaction');
  });

  it('keeps health composition responsible for probes and observed evaluator', () => {
    const source = compositionSource('health-composition.ts');

    expect(source).toContain('createSessionGatewayReadHealthProbe');
    expect(source).toContain('createModelProviderHealthProbe');
    expect(source).toContain('createCapabilityCatalogHealthProbe');
    expect(source).toContain('createObservedHealthEvaluator');
  });

  it('keeps app lifecycle composition responsible for startup and close wiring', () => {
    const source = compositionSource('app-lifecycle-composition.ts');

    expect(source).toMatch(/await runStartupStage\(['"]RAG_KNOWLEDGE_BUILD['"], \(\) => input\.ensureRagKnowledgeBuilt\(\)\)/u);
    expect(source).toMatch(/event: ['"]app\.start\.degraded['"]/u);
    expect(source).toContain('void recoverRuntimeBestEffort(input);');
    expect(compositionSource('request-runtime-composition.ts')).toContain('recoveryAgentId: input.systemConfig.activeAgentId');
    expect(compositionSource('request-runtime-composition.ts')).toContain('recoveryLockedBy: `runtime-recovery-${randomUUID()}`');
    expect(source).toMatch(/await finalize\(\(\) => input\.runtime\.close\?\.\(\), ['"]runtime['"]\)/u);
    expect(source).toMatch(/await finalize\(\(\) => input\.gatewayBindings\.close\?\.\(\), ['"]gateway-audit-and-stores['"]\)/u);
  });
});

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

function failingSkillHubGatewayFactory() {
  return {
    async listCandidates() {
      return { status: 'failed' as const, reasonCode: 'unavailable' as const };
    },
    async fetchContent() {
      return { status: 'failed' as const, reasonCode: 'unavailable' as const };
    },
  };
}

function compositionSource(fileName: string): string {
  return readFileSync(new URL(`../src/composition/${fileName}`, import.meta.url), 'utf8');
}
