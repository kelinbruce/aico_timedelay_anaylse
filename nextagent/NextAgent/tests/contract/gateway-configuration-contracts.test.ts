import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  createComposedAppAsync,
  evaluateDefaultSystemConfig,
  validateDefaultSystemConfig,
} from '@nextagent/agent-app/testing';
import type { SkillHubAccessFactory } from '@nextagent/agent-app/testing';
import { brand } from '@nextagent/agent-common';
import type { GatewayBindings, GatewayProvider, GatewayProviderRuntimeContext, FetchGateway } from '@nextagent/agent-contracts/gateway';
import {
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { createLocalNextAgentApp } from '@nextagent/agent-platform-gateway-local/entrypoints/local';
import { createRemoteGatewayProvider } from '@nextagent/agent-platform-gateway-remote';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('gateway-configuration contract', () => {
  it('applies a default local gateway when the gateway section is omitted', () => {
    const { gateway: _omit, ...configWithoutGateway } = rawSystemConfig();
    const config = validateDefaultSystemConfig(configWithoutGateway, process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(config.gateway.gatewayId).toBe('local-working-memory');
    expect(config.gatewaySelection.entries).toEqual([
      { gatewayId: 'local-working-memory', adapterKind: 'working-memory', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-long-term-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-cron', adapterKind: 'cron-tasks', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-rag', adapterKind: 'rag-knowledge', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-workflow', adapterKind: 'workflow-execution', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-api-call', adapterKind: 'api-call', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-user-query', adapterKind: 'user-query', deploymentMode: 'LOCAL', selectionState: 'enabled' },
    ]);
    expect(config.gatewaySelection.readinessState).toBe('READY');
  });

  it('accepts a remote user-query adapter for an externally registered provider', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [{ gatewayId: 'remote-user-query', gatewayKind: 'user-query', deploymentMode: 'REMOTE' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries).toEqual([
      { gatewayId: 'remote-user-query', adapterKind: 'user-query', deploymentMode: 'REMOTE', selectionState: 'enabled' },
    ]);
  });

  // 3.1 local gateway normal startup
  it('freezes a gateway selection snapshot for a valid local startup', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(config.gateway.gatewayId).toBe('local-sqlite');
    expect(config.gatewaySelection).toMatchObject({
      readinessState: 'READY',
      diagnosticRef: 'gateway',
    });
    expect(config.gatewaySelection.entries).toEqual([
      { gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL', selectionState: 'enabled' },
      { gatewayId: 'local-rag', adapterKind: 'rag-knowledge', deploymentMode: 'LOCAL', selectionState: 'enabled' },
    ]);
    expect(Object.isFrozen(config.gatewaySelection)).toBe(true);
    expect(Object.isFrozen(config.gatewaySelection.entries)).toBe(true);
    expect(config.paths.workingMemorySqliteFile).toBe(join(config.paths.workspaceRoot, 'data', 'system', 'working-memory.sqlite'));
    expect(config.paths.longTermMemorySqliteFile).toBe(join(config.paths.workspaceRoot, 'data', 'system', 'long-term-memory.sqlite'));
    expect(config.paths.sqliteFile).toBe(join(config.paths.workspaceRoot, 'data', 'system', 'nextagent.sqlite'));
  });

  it('preserves an explicit executable allowlist in the trusted sandbox gateway configuration', () => {
    const config = validateDefaultSystemConfig(
      { ...rawSystemConfig(), sandbox: { enabled: true, allowedExecutables: [], deniedExecutables: ['curl'] } },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(config.sandbox).toMatchObject({
      allowedExecutables: [],
      deniedExecutables: ['curl'],
      enabled: true,
    });
  });

  // 3.3 deployment mode is per entry, not a global branch filter
  it('keeps remote gateway entries enabled even when the product deployment mode is local', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [{ gatewayId: 'remote-skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries).toEqual([
      { gatewayId: 'remote-skillhub', adapterKind: 'skillhub', deploymentMode: 'REMOTE', selectionState: 'enabled' },
    ]);
  });

  it('allows remote workflow-execution without endpoint to support custom transport (UDS)', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [{ gatewayId: 'remote-workflow-uds', gatewayKind: 'workflow-execution', deploymentMode: 'REMOTE' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries).toEqual([
      { gatewayId: 'remote-workflow-uds', adapterKind: 'workflow-execution', deploymentMode: 'REMOTE', selectionState: 'enabled' },
    ]);
    expect(result.config?.gatewaySelection.entries[0]?.endpoint).toBeUndefined();
  });

  it('accepts remote workflow-execution with an http endpoint', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            {
              gatewayId: 'remote-workflow-http',
              gatewayKind: 'workflow-execution',
              deploymentMode: 'REMOTE',
              endpoint: 'https://workflow.example.invalid',
            },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries[0]?.endpoint).toBe('https://workflow.example.invalid');
  });

  it('freezes a remote gateway selection when deployment mode is REMOTE', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        gateway: {
          gateways: [{ gatewayId: 'remote-skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gateway.gatewayId).toBe('remote-skillhub');
    expect(result.config?.gatewaySelection.entries).toEqual([
      { gatewayId: 'remote-skillhub', adapterKind: 'skillhub', deploymentMode: 'REMOTE', selectionState: 'enabled' },
    ]);
  });

  // 3.4 duplicate gateway identifier blocks startup
  it('blocks startup when gateway identifiers are duplicated', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'local-sqlite', gatewayKind: 'sandbox', deploymentMode: 'LOCAL' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((issue) => issue.issueCode)).toContain('APP_CONFIG_GATEWAY_DUPLICATE_ID');
  });

  it('blocks startup when the same adapter kind appears more than once', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'primary-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'secondary-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((issue) => issue.issueCode)).toContain('APP_CONFIG_GATEWAY_DUPLICATE_ADAPTER_KIND');
  });

  it('blocks startup when local and remote Cron task adapters are both selected', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            { gatewayId: 'local-cron', gatewayKind: 'cron-tasks', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-cron', gatewayKind: 'cron-tasks', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((issue) => issue.issueCode)).toContain('APP_CONFIG_GATEWAY_DUPLICATE_ADAPTER_KIND');
  });

  // 3.5 all selected entries take effect
  it('accepts multiple gateway entries with distinct adapter kinds', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'local-sandbox', gatewayKind: 'sandbox', deploymentMode: 'LOCAL' },
            { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
            { gatewayId: 'scheduled-maint', gatewayKind: 'scheduled-maintenance', deploymentMode: 'LOCAL' },
            { gatewayId: 'skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries).toHaveLength(5);
    expect(result.config?.gatewaySelection.entries.map((entry) => entry.adapterKind)).toEqual([
      'sqlite',
      'sandbox',
      'rag-knowledge',
      'scheduled-maintenance',
      'skillhub',
    ]);
    expect(result.config?.gatewaySelection.entries.find((entry) => entry.gatewayId === 'skillhub')).toMatchObject({
      deploymentMode: 'REMOTE',
      selectionState: 'enabled',
    });
  });

  it('blocks startup at schema level when a gateway entry uses an unregistered adapter kind', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'future-gw', gatewayKind: 'future-adapter', deploymentMode: 'LOCAL' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((issue) => issue.issueCode)).toContain('APP_CONFIG_SCHEMA_INVALID');
  });

  it('allows a stable adapter kind to select REMOTE deploymentMode at config freeze', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [{ gatewayId: 'remote-sqlite', gatewayKind: 'sqlite', deploymentMode: 'REMOTE', sqliteFileRef: 'paths.sqliteFile' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries).toEqual([
      { gatewayId: 'remote-sqlite', adapterKind: 'sqlite', deploymentMode: 'REMOTE', selectionState: 'enabled' },
    ]);
  });

  it('allows a stable adapter kind to select LOCAL deploymentMode at config freeze', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'local-skillhub', gatewayKind: 'skillhub', deploymentMode: 'LOCAL' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('READY');
    expect(result.config?.gatewaySelection.entries.find((entry) => entry.gatewayId === 'local-skillhub')).toMatchObject({
      adapterKind: 'skillhub',
      deploymentMode: 'LOCAL',
      selectionState: 'enabled',
    });
  });

  it('exposes a local GatewayProvider SPI without private gateway implementation objects', async () => {
    const provider = createLocalGatewayProvider();
    const bindings = await provider.create({
      selectedEntries: [
        { gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-rag', adapterKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
      runtime: testGatewayRuntimeContext(),
    });

    expect(provider).toMatchObject({
      providerId: 'local-gateway',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sqlite', 'sandbox', 'scheduled-maintenance', 'cron-tasks', 'rag-knowledge', 'workflow-execution', 'user-query'],
    });
    expect(bindings).toMatchObject({
      providerId: 'local-gateway',
      deploymentMode: 'LOCAL',
      readiness: {
        state: 'READY',
        evidenceRef: 'gateway-provider:local-gateway:ready',
      },
    });
    expect(JSON.stringify(bindings)).not.toMatch(/sqliteFile|credential|endpoint|client|pool/iu);
    expect(bindings.fetch).toBeUndefined();
    bindings.close?.();
  });

  it('exposes an environment-neutral optional fetch gateway contract', async () => {
    let seenInput: Parameters<FetchGateway['fetch']> | undefined;
    const fetchGateway: FetchGateway = {
      async fetch(...input) {
        seenInput = input;
        return new Response(null, { status: 204 });
      },
    };
    const signal = new AbortController().signal;

    const response = await fetchGateway.fetch('https://service.example.invalid/v1/resources', {
      method: 'POST',
      signal,
    });

    expect(response.status).toBe(204);
    expect(seenInput).toEqual(['https://service.example.invalid/v1/resources', { method: 'POST', signal }]);
  });

  it('creates only sqlite stores when sqlite is the selected local binding', async () => {
    const bindings = await createLocalGatewayProvider().create({
      selectedEntries: [{ gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL' }],
      runtime: testGatewayRuntimeContext(),
    });

    expect(bindings.sqliteStores).toBeDefined();
    expect(bindings.sandbox).toBeUndefined();
    expect(bindings.scheduledMaintenance).toBeUndefined();
    bindings.close?.();
  });

  it('returns complete capability-specific persistence bindings', () => {
    const runtime = testGatewayRuntimeContext();
    const workingMemory = createSqliteWorkingMemoryGatewayProvider().create({
      selectedEntries: [{ gatewayId: 'local-working-memory', adapterKind: 'working-memory', deploymentMode: 'LOCAL' }],
      runtime,
    });
    const longTermMemory = createSqliteLongTermMemoryGatewayProvider().create({
      selectedEntries: [{ gatewayId: 'local-long-term-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL' }],
      runtime,
    });
    const sqlite = createLocalGatewayProvider().create({
      selectedEntries: [{ gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL' }],
      runtime,
    });

    expect(Object.keys(workingMemory.workingMemory ?? {}).sort()).toEqual([
      'activeContext',
      'attachments',
      'checkpoints',
      'conversationAnnotations',
      'conversationShares',
      'memoryRecallAttempts',
      'messages',
      'pendingInputs',
      'requestRuns',
      'sessionForks',
      'sessions',
      'timeline',
    ]);
    expect(Object.keys(longTermMemory.longTermMemory ?? {}).sort()).toEqual(['retriever', 'sharing', 'store']);
    expect(Object.keys(sqlite.sqliteStores ?? {}).sort()).toEqual([
      'attachmentReservations',
      'blobs',
      'taskTrajectoryQuery',
      'taskTrajectoryStore',
      'todoStateStore',
      'userQuestionActivity',
    ]);
    expect(sqlite.audit).toBeDefined();
    workingMemory.close?.();
    longTermMemory.close?.();
    sqlite.close?.();
    expect(() => workingMemory.close?.()).not.toThrow();
    expect(() => longTermMemory.close?.()).not.toThrow();
    expect(() => sqlite.close?.()).not.toThrow();
  });

  it('creates only sandbox and scheduled bindings when those adapters are selected', async () => {
    const bindings = await createLocalGatewayProvider().create({
      selectedEntries: [
        { gatewayId: 'local-sandbox', adapterKind: 'sandbox', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-scheduled', adapterKind: 'scheduled-maintenance', deploymentMode: 'LOCAL' },
      ],
      runtime: testGatewayRuntimeContext(),
    });

    expect(bindings.sqliteStores).toBeUndefined();
    expect(bindings.sandbox).toBeDefined();
    expect(bindings.scheduledMaintenance).toBeDefined();
  });

  it('blocks app composition when the selected deployment has no injected provider', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(() => createComposedApp({ systemConfig: config, gatewayProviders: [] }, noopModel())).toThrow(/Exactly one gateway provider/u);
  });

  it('blocks app composition when injected gateway provider identifiers are duplicated', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(() =>
      createComposedApp(
        {
          systemConfig: config,
          gatewayProviders: [createLocalGatewayProvider('dup-provider'), createLocalGatewayProvider('dup-provider')],
        },
        noopModel(),
      ),
    ).toThrow(/Gateway provider identifiers must be unique/u);
  });

  it('does not let retained sqlite replace missing working-memory providers', () => {
    const raw = rawSystemConfig();
    const config = validateDefaultSystemConfig(
      {
        ...raw,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(() =>
      createComposedApp(
        {
          systemConfig: config,
          gatewayProviders: [createLocalGatewayProvider()],
        },
        noopModel(),
      ),
    ).toThrow(/Exactly one gateway provider/u);
  });

  it('blocks app composition when two providers match the same selected adapter', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(() =>
      createComposedApp(
        {
          systemConfig: config,
          gatewayProviders: [createLocalGatewayProvider('sqlite-a'), createLocalGatewayProvider('sqlite-b')],
        },
        noopModel(),
      ),
    ).toThrow(/Exactly one gateway provider/u);
  });

  it('closes earlier provider bindings when a later provider fails to create', () => {
    const raw = rawSystemConfig();
    const config = validateDefaultSystemConfig(
      {
        ...raw,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const workingMemorySource = createSqliteWorkingMemoryGatewayProvider('working-memory-source');
    let closeCount = 0;
    const workingMemoryProvider: GatewayProvider = {
      ...workingMemorySource,
      create(input) {
        const binding = workingMemorySource.create(input);
        return {
          ...binding,
          close: () => {
            closeCount += 1;
            return binding.close?.();
          },
        };
      },
    };
    const failingLongTermMemoryProvider: GatewayProvider = {
      providerId: 'failing-long-term-memory',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['long-term-memory'],
      create() {
        throw new Error('provider-private failure');
      },
    };

    expect(() =>
      createComposedApp(
        {
          systemConfig: config,
          gatewayProviders: [workingMemoryProvider, failingLongTermMemoryProvider, createLocalGatewayProvider()],
        },
        noopModel(),
      ),
    ).toThrow(/failed to create bindings/u);
    expect(closeCount).toBe(1);
  });

  it('waits for asynchronous persistence provider shutdown', async () => {
    const raw = rawSystemConfig();
    const config = validateDefaultSystemConfig(
      {
        ...raw,
        modelProfiles: raw.modelProfiles,
        gateway: { gateways: [...workingMemoryGatewayEntries(), ...raw.gateway.gateways] },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const source = createSqliteWorkingMemoryGatewayProvider('delayed-working-memory');
    let releaseClose!: () => void;
    const closeReleased = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let reportCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      reportCloseStarted = resolve;
    });
    let closeCompleted = false;
    const delayedProvider: GatewayProvider = {
      ...source,
      create(input) {
        const bindings = source.create(input);
        return {
          ...bindings,
          close: async () => {
            reportCloseStarted();
            await closeReleased;
            await bindings.close?.();
            closeCompleted = true;
          },
        };
      },
    };
    const app = createComposedApp(
      {
        systemConfig: config,
        agentDefinition: gatewayOnlyAgentDefinition(),
        gatewayProviders: [delayedProvider, createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        sandboxGatewayFactory: () => testSandboxGateway(),
        ragRetrievalFactory: () => ({
          gateway: testRagRetrievalGateway(),
          workflowGateway: testWorkflowRagRetrievalGateway(),
          async build() {},
          async cleanup() {},
          close() {},
        }),
      },
      noopModel(),
    );

    const closing = app.close();
    await closeStarted;
    expect(closeCompleted).toBe(false);
    releaseClose();
    await closing;
    expect(closeCompleted).toBe(true);
  });

  it('blocks app composition when a provider returns an unselected binding', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });
    const provider: GatewayProvider = {
      providerId: 'sqlite-with-extra-binding',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sqlite', 'rag-knowledge'],
      create(input) {
        const sqlite = createLocalGatewayProvider('sqlite-source').create(input);
        const memory = createSqliteLongTermMemoryGatewayProvider('memory-source').create({
          ...input,
          selectedEntries: [{ gatewayId: 'unselected-memory', adapterKind: 'long-term-memory', deploymentMode: 'LOCAL' }],
        });
        if (memory.longTermMemory === undefined) {
          throw new Error('Test long-term-memory provider did not return its selected binding.');
        }
        return {
          ...sqlite,
          providerId: 'sqlite-with-extra-binding',
          longTermMemory: memory.longTermMemory,
          close: async () => {
            await sqlite.close?.();
            await memory.close?.();
          },
        };
      },
    };

    expect(() => createComposedApp({ systemConfig: config, gatewayProviders: [provider] }, noopModel())).toThrow(/unselected binding/u);
  });

  it.each(['workingMemorySqliteFile', 'longTermMemorySqliteFile', 'sqliteFile'] as const)('rejects user configuration of derived %s', (field) => {
    const raw = rawSystemConfig();
    const result = evaluateDefaultSystemConfig({ ...raw, paths: { ...raw.paths, [field]: 'user-controlled.sqlite' } }, process.cwd(), {
      credentialResolver: testCredentialResolver(),
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.some((issue) => issue.issueCode === 'APP_CONFIG_SCHEMA_INVALID')).toBe(true);
  });

  it('blocks app composition when the injected provider does not support the selected adapter kind', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });
    const provider: GatewayProvider = {
      providerId: 'local-incomplete',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sandbox'],
      create() {
        return {
          providerId: 'local-incomplete',
          deploymentMode: 'LOCAL',
          readiness: {
            state: 'READY',
            evidenceRef: 'gateway-provider:local-incomplete:ready',
            safeMessage: 'Test provider ready.',
          },
        };
      },
    };

    expect(() => createComposedApp({ systemConfig: config, gatewayProviders: [provider] }, noopModel())).toThrow(/Exactly one gateway provider/u);
  });

  it('allows the official local entrypoint to synchronously create bindings through the local gateway provider', async () => {
    const configFile = join(process.cwd(), `.nextagent-gateway-contract-${randomUUID()}.json`);
    const config = rawSystemConfig();
    writeFileSync(
      configFile,
      JSON.stringify({
        ...config,
        modelProfiles: config.modelProfiles,
        gateway: { gateways: [...workingMemoryGatewayEntries(), ...config.gateway.gateways] },
      }),
      'utf8',
    );
    try {
      const app = createLocalNextAgentApp({ credentialResolver: testCredentialResolver(), configFile });
      await app.close();
    } finally {
      rmSync(configFile, { force: true });
    }
  });

  it('starts and stops the local Cron scheduler when the local Cron adapter is selected', async () => {
    let started = 0;
    let stopped = 0;
    let callbackRegistrations = 0;
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        channel: { ...rawSystemConfig().channel, port: 32991 },
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'local-cron', gatewayKind: 'cron-tasks', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    expect(result.status).toBe('READY');
    const app = createComposedApp(
      {
        systemConfig: result.config!,
        agentDefinition: gatewayOnlyAgentDefinition(),
        gatewayProviders: localPersistenceProviders(),
        sandboxGatewayFactory: () => testSandboxGateway(),
        ragRetrievalFactory: () => ({
          gateway: testRagRetrievalGateway(),
          workflowGateway: testWorkflowRagRetrievalGateway(),
          async build() {},
          async cleanup() {},
          close() {},
        }),
        cronTaskSchedulerFactory() {
          return {
            start() {
              started += 1;
            },
            async stop() {
              stopped += 1;
            },
          };
        },
        cronTriggerCallbackRegistration() {
          callbackRegistrations += 1;
        },
      },
      noopModel(),
    );

    await app.start();
    await app.close();

    expect(started).toBe(1);
    expect(stopped).toBe(1);
    expect(callbackRegistrations).toBe(0);
  });

  it('does not create a local Cron scheduler when the remote Cron adapter is selected', async () => {
    let schedulerFactories = 0;
    let callbackRegistrations = 0;
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-cron', gatewayKind: 'cron-tasks', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const remoteProvider = createRemoteGatewayProvider({
      providerId: 'vendor-remote-cron',
      bindings: {
        sandbox: testSandboxGateway(),
        ragRetrieval: testRagRetrievalGateway(),
        cronTasks: testCronTaskGateway(),
      },
    });
    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          agentDefinition: gatewayOnlyAgentDefinition(),
          gatewayProviders: [...localPersistenceProviders(), remoteProvider],
          cronTriggerCallbackCredentialRef: brand<`env:${string}`, 'SecretReference'>('env:OPENAI_API_KEY'),
        },
        noopModel(),
      ),
    ).toThrow(/callback transport registration/u);
    const app = createComposedApp(
      {
        systemConfig: result.config!,
        agentDefinition: gatewayOnlyAgentDefinition(),
        gatewayProviders: [...localPersistenceProviders(), remoteProvider],
        cronTriggerCallbackCredentialRef: brand<`env:${string}`, 'SecretReference'>('env:OPENAI_API_KEY'),
        cronTriggerCallbackRegistration() {
          callbackRegistrations += 1;
        },
        cronTaskSchedulerFactory() {
          schedulerFactories += 1;
          return {
            start() {},
            async stop() {},
          };
        },
      },
      noopModel(),
    );

    await app.close();

    expect(schedulerFactories).toBe(0);
    expect(callbackRegistrations).toBe(1);
  });

  it('accepts a vendor-style remote provider injected by an external entrypoint', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        gateway: {
          gateways: [{ gatewayId: 'remote-skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const config = result.config!;
    const provider: GatewayProvider = {
      providerId: 'vendor-remote',
      deploymentMode: 'REMOTE',
      supportedAdapterKinds: ['skillhub'],
      create() {
        return {
          providerId: 'vendor-remote',
          deploymentMode: 'REMOTE',
          readiness: {
            state: 'READY',
            evidenceRef: 'gateway-provider:vendor-remote:ready',
            safeMessage: 'Vendor remote gateway provider is ready.',
          },
        };
      },
    };

    expect(() => createVendorRemoteNextAgentApp(config, provider)).toThrow(
      /Working Memory, Long-term Memory, and retained SQLite bindings are required/u,
    );
  });

  it('creates merged bindings from local and remote providers selected by gateway entries', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const remoteProvider = createRemoteProvider(['sandbox', 'rag-knowledge', 'skillhub']);

    const app = createComposedApp(
      {
        systemConfig: result.config!,
        agentDefinition: gatewayOnlyAgentDefinition(),
        gatewayProviders: [...localPersistenceProviders(), remoteProvider.provider],
        skillHubAccessFactory: failingSkillHubGatewayFactory(),
      },
      noopModel(),
    );

    expect(remoteProvider.selectedEntries).toEqual([
      { gatewayId: 'remote-sandbox', adapterKind: 'sandbox', deploymentMode: 'REMOTE' },
      { gatewayId: 'remote-rag', adapterKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
    ]);
    expect(app.gateway.gatewayKind).toBe('sqlite');
    await app.close();
  });

  it('allows a remote deployment entrypoint package to inject local and remote providers together', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    const deployment = createVendorDeploymentRemoteNextAgentApp(result.config!);

    expect(deployment.localSelectedEntries).toEqual([{ gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL' }]);
    expect(deployment.remoteSelectedEntries).toEqual([
      { gatewayId: 'remote-sandbox', adapterKind: 'sandbox', deploymentMode: 'REMOTE' },
      { gatewayId: 'remote-rag', adapterKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
    ]);
    expect(deployment.app.gateway.gatewayKind).toBe('sqlite');
    await deployment.app.close();
  });

  it('allows a vendor remote gateway package to own its entrypoint when it injects complete providers', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    const remotePackage = createVendorRemotePackageEntrypointNextAgentApp(result.config!);

    expect(remotePackage.localSelectedEntries).toEqual([{ gatewayId: 'local-sqlite', adapterKind: 'sqlite', deploymentMode: 'LOCAL' }]);
    expect(remotePackage.remoteSelectedEntries).toEqual([
      { gatewayId: 'remote-sandbox', adapterKind: 'sandbox', deploymentMode: 'REMOTE' },
      { gatewayId: 'remote-rag', adapterKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
    ]);
    expect(remotePackage.app.gateway.gatewayKind).toBe('sqlite');
    await remotePackage.app.close();
  });

  it('blocks a remote deployment entrypoint package when local bindings are selected but no local provider is injected', () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          gatewayProviders: [
            createRemoteGatewayProvider({
              providerId: 'vendor-remote',
              bindings: { sandbox: testSandboxGateway() },
            }),
          ],
        },
        noopModel(),
      ),
    ).toThrow(/Exactly one gateway provider/u);
  });

  it('blocks mixed provider composition when a selected remote binding is missing', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const remoteProvider = createRemoteProvider(['sandbox'], { includeSandbox: false });

    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          gatewayProviders: [...localPersistenceProviders(), remoteProvider.provider],
        },
        noopModel(),
      ),
    ).toThrow(/selected adapter binding/u);
  });

  it('blocks mixed provider composition when selected remote RAG binding is missing', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const remoteProvider = createRemoteProvider(['rag-knowledge'], { includeRag: false });

    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          gatewayProviders: [...localPersistenceProviders(), remoteProvider.provider],
        },
        noopModel(),
      ),
    ).toThrow(/selected adapter binding/u);
  });

  it('routes a selected remote Cron task adapter to the remote provider binding', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        modelProfiles: rawSystemConfig().modelProfiles,
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-cron', gatewayKind: 'cron-tasks', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    let remoteSelectedEntries: unknown[] = [];
    const remoteProvider = createRemoteGatewayProvider({
      providerId: 'vendor-remote-cron',
      bindings(input) {
        remoteSelectedEntries = [...input.selectedEntries];
        return { sandbox: testSandboxGateway(), ragRetrieval: testRagRetrievalGateway(), cronTasks: testCronTaskGateway() };
      },
    });

    const app = createComposedApp(
      {
        systemConfig: result.config!,
        agentDefinition: gatewayOnlyAgentDefinition(),
        gatewayProviders: [...localPersistenceProviders(), remoteProvider],
        cronTriggerCallbackCredentialRef: brand<`env:${string}`, 'SecretReference'>('env:OPENAI_API_KEY'),
        cronTriggerCallbackRegistration() {},
      },
      noopModel(),
    );

    expect(remoteSelectedEntries).toEqual([
      { gatewayId: 'remote-sandbox', adapterKind: 'sandbox', deploymentMode: 'REMOTE' },
      { gatewayId: 'remote-rag', adapterKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
      { gatewayId: 'remote-cron', adapterKind: 'cron-tasks', deploymentMode: 'REMOTE' },
    ]);
    await app.close();
  });

  it('blocks mixed provider composition when selected remote Cron binding is missing', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        gateway: {
          gateways: [
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
            { gatewayId: 'remote-cron', gatewayKind: 'cron-tasks', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const remoteProvider: GatewayProvider = {
      providerId: 'remote-cron-incomplete',
      deploymentMode: 'REMOTE',
      supportedAdapterKinds: ['sandbox', 'rag-knowledge', 'cron-tasks'],
      create() {
        return {
          providerId: 'remote-cron-incomplete',
          deploymentMode: 'REMOTE',
          readiness: {
            state: 'READY',
            evidenceRef: 'gateway-provider:remote-cron-incomplete:ready',
            safeMessage: 'Remote Cron gateway provider is ready.',
          },
          sandbox: testSandboxGateway(),
          ragRetrieval: testRagRetrievalGateway(),
        };
      },
    };

    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          gatewayProviders: [...localPersistenceProviders(), remoteProvider],
          cronTriggerCallbackCredentialRef: brand<`env:${string}`, 'SecretReference'>('env:OPENAI_API_KEY'),
          cronTriggerCallbackRegistration() {},
        },
        noopModel(),
      ),
    ).toThrow(/selected adapter binding/u);
  });

  it('blocks remote deployment when no remote provider is injected', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          gatewayProviders: localPersistenceProviders(),
        },
        noopModel(),
      ),
    ).toThrow(/Exactly one gateway provider/u);
  });

  it('blocks remote deployment when a local provider is injected for the remote selection', async () => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        deployment: { mode: 'REMOTE' },
        gateway: {
          gateways: [
            ...workingMemoryGatewayEntries(),
            { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
            { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
          ],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    const localSandboxProvider: GatewayProvider = {
      providerId: 'local-sandbox-only',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sandbox'],
      create: () => ({
        providerId: 'local-sandbox-only',
        deploymentMode: 'LOCAL',
        readiness: {
          state: 'READY',
          evidenceRef: 'gateway-provider:local-sandbox-only:ready',
          safeMessage: 'Local sandbox-only provider is ready.',
        },
        sandbox: testSandboxGateway(),
      }),
    };

    expect(() =>
      createComposedApp(
        {
          systemConfig: result.config!,
          gatewayProviders: [...localPersistenceProviders(), localSandboxProvider],
        },
        noopModel(),
      ),
    ).toThrow(/Exactly one gateway provider/u);
  });

  it('blocks sync app composition when provider create fails before ready', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });
    const provider: GatewayProvider = {
      providerId: 'local-failing',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sqlite', 'rag-knowledge'],
      create() {
        throw new Error('raw provider failure with private endpoint');
      },
    };

    expect(() => createComposedApp({ systemConfig: config, gatewayProviders: [provider] }, noopModel())).toThrow(/failed to create bindings/u);
  });

  it('blocks sync app composition when provider bindings are not ready', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });
    const provider: GatewayProvider = {
      providerId: 'local-blocked',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sqlite', 'rag-knowledge'],
      create() {
        return {
          providerId: 'local-blocked',
          deploymentMode: 'LOCAL',
          readiness: {
            state: 'BLOCKED',
            evidenceRef: 'gateway-provider:local-blocked:blocked',
            safeMessage: 'Gateway provider is unavailable.',
          },
        };
      },
    };

    expect(() => createComposedApp({ systemConfig: config, gatewayProviders: [provider] }, noopModel())).toThrow(/must be ready/u);
  });

  it('blocks sync app composition when provider bindings deployment mode does not match selection', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });
    const provider: GatewayProvider = {
      providerId: 'local-mismatch',
      deploymentMode: 'LOCAL',
      supportedAdapterKinds: ['sqlite', 'rag-knowledge'],
      create() {
        return {
          providerId: 'local-mismatch',
          deploymentMode: 'REMOTE',
          readiness: {
            state: 'READY',
            evidenceRef: 'gateway-provider:local-mismatch:ready',
            safeMessage: 'Gateway provider is ready.',
          },
        };
      },
    };

    expect(() => createComposedApp({ systemConfig: config, gatewayProviders: [provider] }, noopModel())).toThrow(/deployment mode must match/u);
  });
});

function createVendorRemoteNextAgentApp(systemConfig: ReturnType<typeof validateDefaultSystemConfig>, provider: GatewayProvider) {
  return createComposedApp({ systemConfig, gatewayProviders: [provider] }, noopModel());
}

function createVendorDeploymentRemoteNextAgentApp(systemConfig: ReturnType<typeof validateDefaultSystemConfig>) {
  const entrypoint = createMixedRemoteEntrypoint(systemConfig);
  return entrypoint;
}

function createVendorRemotePackageEntrypointNextAgentApp(systemConfig: ReturnType<typeof validateDefaultSystemConfig>) {
  const entrypoint = createMixedRemoteEntrypoint(systemConfig);
  return entrypoint;
}

function createMixedRemoteEntrypoint(systemConfig: ReturnType<typeof validateDefaultSystemConfig>) {
  let localSelectedEntries: unknown[] = [];
  let remoteSelectedEntries: unknown[] = [];
  const localProvider = createLocalGatewayProvider();
  const capturingLocalProvider: GatewayProvider = {
    ...localProvider,
    create(input) {
      localSelectedEntries = [...input.selectedEntries];
      return localProvider.create(input);
    },
  };
  const remoteProvider = createRemoteGatewayProvider({
    providerId: 'vendor-remote',
    bindings(input) {
      remoteSelectedEntries = [...input.selectedEntries];
      return {
        sandbox: testSandboxGateway(),
        ragRetrieval: testRagRetrievalGateway(),
      };
    },
  });
  const app = createComposedApp(
    {
      systemConfig,
      agentDefinition: gatewayOnlyAgentDefinition(),
      gatewayProviders: [
        createSqliteWorkingMemoryGatewayProvider(),
        createSqliteLongTermMemoryGatewayProvider(),
        capturingLocalProvider,
        remoteProvider,
      ],
    },
    noopModel(),
  );
  return {
    app,
    get localSelectedEntries() {
      return localSelectedEntries;
    },
    get remoteSelectedEntries() {
      return remoteSelectedEntries;
    },
  };
}

function localPersistenceProviders(): GatewayProvider[] {
  return [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()];
}

function workingMemoryGatewayEntries() {
  return [
    { gatewayId: 'local-working-memory', gatewayKind: 'working-memory' as const, deploymentMode: 'LOCAL' as const },
    { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory' as const, deploymentMode: 'LOCAL' as const },
  ];
}

function createRemoteProvider(
  supportedAdapterKinds: GatewayProvider['supportedAdapterKinds'],
  options: { readonly includeSandbox?: boolean; readonly includeRag?: boolean } = {},
): { readonly provider: GatewayProvider; selectedEntries: unknown[] } {
  const providerState: { selectedEntries: unknown[] } = { selectedEntries: [] };
  return {
    get selectedEntries() {
      return providerState.selectedEntries;
    },
    provider: {
      providerId: 'remote-full',
      deploymentMode: 'REMOTE',
      supportedAdapterKinds,
      create(input) {
        providerState.selectedEntries = [...input.selectedEntries];
        return {
          providerId: 'remote-full',
          deploymentMode: 'REMOTE',
          readiness: {
            state: 'READY',
            evidenceRef: 'gateway-provider:remote-full:ready',
            safeMessage: 'Remote gateway provider is ready.',
          },
          ...(options.includeSandbox === false
            ? {}
            : {
                sandbox: {
                  async execute(request) {
                    return {
                      executionId: request.executionId,
                      exitCode: 0,
                      stdout: '',
                      stderr: '',
                      stdoutTruncated: false,
                      stderrTruncated: false,
                      timedOut: false,
                      durationMs: 0,
                    };
                  },
                },
              }),
          ...(options.includeRag === false
            ? {}
            : {
                ragRetrieval: {
                  async retrieve() {
                    return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
                  },
                },
              }),
        };
      },
    },
  };
}

function testCredentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}

function rawSystemConfig() {
  return {
    deployment: { mode: 'LOCAL' },
    paths: {
      workspaceRoot: join(tmpdir(), `nextagent-gateway-contract-${randomUUID()}`),
      logDirectory: 'logs',
    },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [
          {
            modelId: 'MiniMax-M2.7',
            timeoutMs: 45_000,
            temperature: 0.1,
            maxOutputTokens: 128,
            providerOptions: { parallelToolCalls: false },
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
  };
}

function testGatewayRuntimeContext(): GatewayProviderRuntimeContext {
  const root = tmpdir();
  return {
    paths: {
      workingMemorySqliteFile: join(root, `working-memory-${randomUUID()}.sqlite`),
      longTermMemorySqliteFile: join(root, `long-term-memory-${randomUUID()}.sqlite`),
      sqliteFile: join(root, `nextagent-gateway-${randomUUID()}.sqlite`),
      workspaceRoot: root,
      logDirectory: root,
      runtimeWorkspaceRoot: root,
    },
    sandbox: {
      enabled: true,
      deniedExecutables: [],
    },
  };
}

function closeBoundStores(stores: unknown): void {
  if (typeof stores === 'object' && stores !== null && 'close' in stores && typeof stores.close === 'function') {
    stores.close();
  }
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

function gatewayOnlyAgentDefinition() {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Gateway contract agent',
    description: 'Gateway contract composition fixture.',
    workspaceDir: 'default-agent',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 1_800_000,
    },
    resources: [],
  };
}

function failingSkillHubGatewayFactory(): SkillHubAccessFactory {
  return () => ({
    async listCandidates() {
      return { status: 'failed', reasonCode: 'unavailable', message: 'SkillHub unavailable.' };
    },
    async fetchContent() {
      return { status: 'failed', reasonCode: 'download-failed', message: 'Package unavailable.' };
    },
  });
}

function testSandboxGateway(): NonNullable<GatewayBindings['sandbox']> {
  return {
    async execute(request) {
      return {
        executionId: request.executionId,
        exitCode: 0,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 0,
      };
    },
  };
}

function testRagRetrievalGateway(): NonNullable<GatewayBindings['ragRetrieval']> {
  return {
    async retrieve() {
      return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
    },
  };
}

function testWorkflowRagRetrievalGateway(): NonNullable<GatewayBindings['workflowRagRetrieval']> {
  return {
    async retrieve() {
      return { status: 'UNAVAILABLE', recommends: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
    },
  };
}

function testCronTaskGateway(): NonNullable<GatewayBindings['cronTasks']> {
  return {
    async createTask() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async loadTask() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async loadTaskForAgent() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async listTasks() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async listTasksForAgent() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async countTasksForAgent() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async countActiveTasksForAgent() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async updateTask() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async deleteTask() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async listDueTasks() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async listClaimedTriggers() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async loadTrigger() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async loadTriggerDelivery() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async listTriggersForTask() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async countTriggersForTask() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async claimCronTrigger() {
      throw new Error('test Cron task gateway should not be invoked');
    },
    async bindCronTriggerRun() {
      throw new Error('test Cron task gateway should not be invoked');
    },
  };
}
