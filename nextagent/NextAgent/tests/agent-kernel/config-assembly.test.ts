import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createComposedApp,
  createProviderConfiguredComposedApp,
  createAppCredentialResolver,
  createDefaultAgentTestAssemblyRegistry,
  createStartupAgentAssemblyCompiler,
  createStartupResourceProviderRegistry,
  evaluateDefaultSystemConfig,
  loadAgentDefinitionFile,
  loadAgentDefinitionForSystemConfig,
  loadBuiltInDefaultAgentDefinition,
  parseAgentDefinitionForTesting,
  resolveDefaultSystemConfig,
  readCapturedMetricSamples,
  validateDefaultSystemConfig,
  validateStartupAgentAssemblyGraph,
  type AgentDefinition,
  type DefaultSystemConfig,
  type SkillHubAccessFactory,
} from '@nextagent/agent-platform-gateway-local/testing';
import {
  builtinAgentsProvider,
  builtinSkillsProvider,
  builtinToolsProvider,
  createWorkspaceFilePort,
  localAgentsProvider,
  localSkillsAgentOwnedProvider,
  localSkillsSystemProvider,
  localSubagentsProvider,
  type ToolExecutionContext,
} from '@nextagent/agent-capability';
import { brand, type RuntimeLogger, type RuntimeLogLevel } from '@nextagent/agent-common';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import { memoryToolsProvider } from '@nextagent/agent-memory';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RiskPolicyEvaluator } from '@nextagent/agent-contracts/runtime';
import { createInMemoryMetricsRegistry, type StructuredLogEntry } from '@nextagent/agent-observability';
import type { RestrictedLocalSandboxGatewayPort } from '@nextagent/agent-platform-gateway-local';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  displayName: 'Tester',
};
const builtinExecutableIt = process.platform === 'win32' || process.platform === 'linux' ? it : it.skip;
const defaultBuiltinModelToolNames = [
  'Read',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'Python',
  'Edit',
  'Skill',
  'AskUserQuestion',
  'Agent',
  'TodoWrite',
  'Workflow',
];
const defaultBuiltinModelToolNamesWithRag = [
  'Read',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'Python',
  'Edit',
  'Rag',
  'Skill',
  'AskUserQuestion',
  'Agent',
  'TodoWrite',
  'Workflow',
];
const toolSearchBuiltinModelToolNames = [...defaultBuiltinModelToolNames, 'ToolSearch'];
const explicitBindingToolSearchBuiltinModelToolNames = [
  ...defaultBuiltinModelToolNamesWithRag.slice(0, -2),
  'ToolSearch',
  'TodoWrite',
  'Workflow',
  'alarm-check',
];
async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function waitForRunTerminal(gateway: ReturnType<typeof createComposedApp>['gateway'], runId: string, timeoutMs = 5_000): Promise<void> {
  await waitFor(async () => {
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    return run?.terminalCommitState === 'COMMITTED';
  }, timeoutMs);
}

async function waitForPendingInput(app: ReturnType<typeof createComposedApp>, sessionId: string, runId: string, timeoutMs = 5_000) {
  let pendingInputId: string | undefined;
  await waitFor(async () => {
    const events = await app.gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
      runId: brand<string, 'RequestRunId'>(runId),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    const event = events.find((record) => record.type === 'USER_INPUT_REQUIRED');
    const candidate = event?.inlinePayload['pendingInputId'];
    pendingInputId = typeof candidate === 'string' ? candidate : undefined;
    return pendingInputId !== undefined;
  }, timeoutMs);
  return brand<string, 'PendingInputId'>(pendingInputId!);
}

describe('target-state app configuration and assembly compilation', () => {
  it('loads built-in default system and default agent config through app-owned loaders', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-config-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const credentialResolver = testCredentialResolver();
      const systemConfig = resolveDefaultSystemConfig({ cwd: tempDir, credentialResolver });
      const agentDefinition = loadBuiltInDefaultAgentDefinition();
      app = createComposedApp(
        { systemConfig, agentDefinition, credentialResolver, skillHubAccessFactory: failingSkillHubGatewayFactory() },
        captureModel([]),
      );

      expect(systemConfig.activeAgentId).toBe(agentId);
      expect(systemConfig.paths.configRoot).toBe(tempDir);
      expect(systemConfig.paths.logDirectory).toBe(join(tempDir, 'logs'));
      expect(systemConfig.observability.logging.diagnosticDetail).toBe('normal');
      expect(systemConfig.paths.sqliteFile).toBe(join(tempDir, 'workspaces', 'data', 'system', 'nextagent.sqlite'));
      expect(systemConfig.paths.workspaceRoot).toContain('workspaces');
      expect(systemConfig.modelProfiles[0]).toMatchObject({
        providerId: 'openai-compatible',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [expect.objectContaining({ modelId: 'MiniMax-M2.7-highspeed' })],
      });
      expect(systemConfig.rag.indexes).toEqual(['local']);
      expect(agentDefinition).toMatchObject({
        agentId,
        capabilityBindings: [
          { capabilityId: 'network-explorer', capabilityType: 'AGENT', providerId: 'builtin-agents', enabled: true },
          { capabilityId: 'search_memory', capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true },
          { capabilityId: 'get_memory_detail', capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true },
          { capabilityId: 'add_memory', capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true },
          { capabilityId: 'Rag', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true },
        ],
      });
      expect(agentDefinition).not.toHaveProperty('modelIds');
      expect(agentDefinition.workspaceDir).toBeUndefined();
      expect(agentDefinition.workspaceFiles).toBeUndefined();
      expect(app.gateway.gatewayKind).toBe('sqlite');
      expect(systemConfig.configEvaluation.readinessState).toBe('READY');
      expect(systemConfig.sandbox.clipcExecutableDirectoryEnv).toBe('CLIP_HOME');
      expect(systemConfig.sandbox.enabled).toBe(true);
      expect(systemConfig.sandbox.allowedExecutables).toEqual(['clipc', 'curl', 'python']);
      expect(systemConfig.modelProfiles[0]).toMatchObject({
        providerId: 'openai-compatible',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [expect.objectContaining({ modelId: 'MiniMax-M2.7-highspeed' })],
      });
      expect(app).not.toHaveProperty('appConfigSnapshot');
      expect(app).not.toHaveProperty('configValidationResult');
      const assembly = await app.assemblyRegistry.active(agentId);
      expect(assembly.agentId).toBe(agentId);
      expect(assembly.agentVersion).toBe(agentVersion);
      expect(assembly.workspacePolicy).toMatchObject({
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
          { kind: 'generatedSkills', logicalPath: 'generated-skills', access: 'readWrite' },
          { kind: 'sharedData', logicalPath: 'shared-data', access: 'read' },
        ],
      });
      await app.close();
      app = undefined;
    } finally {
      if (app !== undefined) {
        await app.close().catch(() => undefined);
      }
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 15_000);

  it('keeps builtin network-explorer and memory tools bound in the fallback default assembly', async () => {
    const assembly = await createDefaultAgentTestAssemblyRegistry('deterministic-test-model').active(agentId);

    expect(assembly.capabilityBindings).toEqual([
      { capabilityId: 'network-explorer', capabilityType: 'AGENT', providerId: 'builtin-agents', enabled: true },
      { capabilityId: 'search_memory', capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true },
      { capabilityId: 'get_memory_detail', capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true },
      { capabilityId: 'add_memory', capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true },
      { capabilityId: 'Rag', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true },
    ]);
  });

  it('overlays application config on built-in default system config and derives roots from the application directory', async () => {
    const configRoot = await mkdtemp(join(tmpdir(), 'nextagent-application-config-'));
    try {
      const applicationFile = join(configRoot, 'application.yaml');
      await writeFile(
        applicationFile,
        JSON.stringify({
          paths: {
            workspaceRoot: '../runtime',
            logDirectory: '../runtime-logs',
            agentRoot: '../configured-agents',
            skillRoot: '../configured-skills',
          },
          observability: { logging: { diagnosticDetail: 'debug' } },
          rag: { indexes: 'env:RAG_INDEXES' },
          channel: { port: 3131 },
          hostedAgent: { activeAgentId: 'default-agent' },
        }),
        'utf8',
      );

      const systemConfig = resolveDefaultSystemConfig({
        cwd: process.cwd(),
        configFile: applicationFile,
        credentialResolver: testCredentialResolver(),
      });

      expect(systemConfig.paths.configRoot).toBe(configRoot);
      expect(systemConfig.paths.systemSkillsRoot).toBe(join(configRoot, '..', 'configured-skills'));
      expect(systemConfig.paths.agentsRoot).toBe(join(configRoot, '..', 'configured-agents'));
      expect(systemConfig.paths.workspaceRoot).toBe(join(configRoot, '..', 'runtime'));
      expect(systemConfig.paths.logDirectory).toBe(join(configRoot, '..', 'runtime-logs'));
      expect(systemConfig.observability.logging.diagnosticDetail).toBe('debug');
      expect(systemConfig.paths.sqliteFile).toBe(join(configRoot, '..', 'runtime', 'data', 'system', 'nextagent.sqlite'));
      expect(systemConfig.channel.port).toBe(3131);
      expect(systemConfig.rag.indexes).toEqual(['local', 'remote-netops']);
      expect(systemConfig.modelProfiles[0]).toMatchObject({
        providerId: 'openai-compatible',
        models: [expect.objectContaining({ modelId: 'MiniMax-M2.7-highspeed' })],
      });
    } finally {
      await rm(configRoot, { recursive: true, force: true });
    }
  });

  it('keeps default rag indexes when an env overlay is not configured', async () => {
    const configRoot = await mkdtemp(join(tmpdir(), 'nextagent-rag-env-config-'));
    try {
      const applicationFile = join(configRoot, 'application.yaml');
      await writeFile(
        applicationFile,
        JSON.stringify({
          rag: { indexes: 'env:RAG_INDEXES' },
          hostedAgent: { activeAgentId: 'default-agent' },
        }),
        'utf8',
      );

      expect(
        resolveDefaultSystemConfig({
          cwd: process.cwd(),
          configFile: applicationFile,
          credentialResolver: createAppCredentialResolver({
            OPENAI_API_KEY: 'test-only',
            OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
            OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
          }),
        }).rag.indexes,
      ).toEqual(['local']);
    } finally {
      await rm(configRoot, { recursive: true, force: true });
    }
  });

  it('parses trusted capability disclosure modes from application config with list defaults', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-skill-disclosure-config-'));
    try {
      const defaultConfig = validateDefaultSystemConfig(rawSystemConfig('skill-disclosure-default.sqlite'), tempDir, {
        credentialResolver: testCredentialResolver(),
      });
      const toolSearchConfig = validateDefaultSystemConfig(
        {
          ...rawSystemConfig('skill-disclosure-search.sqlite'),
          nextAgent: {
            system: {
              'capability-disclosure': {
                'tool-disclosure-mode': 'tool-search',
                'skill-disclosure-mode': 'tool-search',
                'clipc-disclosure-mode': 'tool-search',
              },
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );

      expect(defaultConfig.capabilityDisclosure.toolDisclosureMode).toBe('list');
      expect(defaultConfig.capabilityDisclosure.skillDisclosureMode).toBe('list');
      expect(defaultConfig.capabilityDisclosure.clipcDisclosureMode).toBe('list');
      expect(toolSearchConfig.capabilityDisclosure.toolDisclosureMode).toBe('tool-search');
      expect(toolSearchConfig.capabilityDisclosure.skillDisclosureMode).toBe('tool-search');
      expect(toolSearchConfig.capabilityDisclosure.clipcDisclosureMode).toBe('tool-search');
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('loads user AgentDefinition from configRoot agents before falling back to the built-in default agent', async () => {
    const configRoot = await mkdtemp(join(tmpdir(), 'nextagent-agent-config-'));
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig('agent-config.sqlite'), configRoot, {
        credentialResolver: testCredentialResolver(),
      });
      await mkdir(join(configRoot, 'agents', 'default-agent'), { recursive: true });
      await writeFile(
        join(configRoot, 'agents', 'default-agent', 'agent.yaml'),
        JSON.stringify({
          ...rawAgentDefinition(),
          displayName: 'Customer configured agent',
          runtimeSettings: { ...rawAgentDefinition().runtimeSettings, maxTurns: 7, maxToolCallsPerTurn: 30 },
        }),
        'utf8',
      );

      expect(loadAgentDefinitionForSystemConfig(systemConfig)).toMatchObject({
        displayName: 'Customer configured agent',
        capabilityBindings: [],
        runtimeSettings: expect.objectContaining({ maxTurns: 7, maxToolCallsPerTurn: 30 }),
      });

      await rm(join(configRoot, 'agents'), { recursive: true, force: true });
      expect(loadAgentDefinitionForSystemConfig(systemConfig)).toMatchObject({
        displayName: 'NextAgent telecom agent',
      });

      const rawBuiltinExplorer = rawSystemConfig('builtin-agent.sqlite');
      const builtinExplorer = validateDefaultSystemConfig(
        {
          ...rawBuiltinExplorer,
          hostedAgent: { activeAgentId: 'network-explorer' },
        },
        configRoot,
        { credentialResolver: testCredentialResolver() },
      );
      const invokedOnlyDefinition = loadAgentDefinitionForSystemConfig(builtinExplorer);
      expect(invokedOnlyDefinition).toMatchObject({
        agentId: 'network-explorer',
        userInvocable: false,
      });
      const invokedOnlyAssembly = createStartupAgentAssemblyCompiler().compile({
        systemConfig: builtinExplorer,
        agentDefinition: invokedOnlyDefinition,
        resourceReferences: createInventory(builtinExplorer),
      }).assembly;
      expect(() =>
        validateStartupAgentAssemblyGraph({
          systemConfig: builtinExplorer,
          assemblies: [invokedOnlyAssembly],
          resourceReferences: createInventory(builtinExplorer),
        }),
      ).toThrow('User-invocable assembly is unavailable.');
      expect(() =>
        createComposedApp(
          { systemConfig: builtinExplorer, agentDefinition: invokedOnlyDefinition, credentialResolver: testCredentialResolver() },
          captureModel([]),
        ),
      ).toThrow('User-invocable assembly is unavailable.');

      const nonDefault = validateDefaultSystemConfig(
        { ...rawSystemConfig('missing-agent.sqlite'), hostedAgent: { activeAgentId: 'customer-agent' } },
        configRoot,
        { credentialResolver: testCredentialResolver() },
      );
      expect(() => loadAgentDefinitionForSystemConfig(nonDefault)).toThrow('Active AgentDefinition is unavailable.');
    } finally {
      await rm(configRoot, { recursive: true, force: true });
    }
  });

  it('allows multiple registered OpenAI-compatible models but selects only the accepted assembly default model', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-config-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const systemConfig = createSystemConfig(tempDir);
      const app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ defaultModelId: 'selected-openai', capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel(captured),
      );

      expect(app.systemConfig.modelProfiles).toHaveLength(1);
      expect(app.systemConfig.modelProfiles[0]?.models.map((model) => model.modelId)).toEqual(['unselected-openai', 'selected-openai']);
      const defaultRouteAssembly = await app.assemblyRegistry.active(app.systemConfig.activeAgentId);
      expect(defaultRouteAssembly.defaultModelId).toBe('selected-openai');
      expect(
        app.systemConfig.modelProfiles.flatMap((provider) => provider.models).find((model) => model.modelId === defaultRouteAssembly.defaultModelId),
      ).toMatchObject({ modelId: 'selected-openai' });
      expect(app.systemConfig.modelProfiles.flatMap((provider) => provider.models).map((model) => model.modelId)).toEqual([
        'unselected-openai',
        'selected-openai',
      ]);
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'diagnose selected model profile', idempotencyKey: 'idem-config-selected-profile' },
        });
        expect(accepted.statusCode).toBe(200);
        const acceptedBody = accepted.json<{ runId: string }>();
        await waitForRunTerminal(app.gateway, acceptedBody.runId);
        expect(captured).toHaveLength(1);
        expect(captured[0]?.modelId).toBe('selected-openai');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('registers Agent package prompts during app composition and uses them on the request path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-agent-prompts-'));
    try {
      await writeAgentSystemPrompt(
        tempDir,
        [
          'schemaVersion: nextagent.prompt-template/v1',
          'content:',
          '  - id: identity',
          '    inline: Agent package system prompt identity.',
          '  - id: workspace',
          '    inline: Agent package workspace policy.',
        ].join('\n'),
      );
      const captured: ModelInvocationRequest[] = [];
      const app = createComposedApp(
        {
          systemConfig: createSystemConfig(tempDir),
          agentDefinition: createAgentDefinition({ defaultModelId: 'selected-openai', capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'use registered agent prompt', idempotencyKey: 'idem-agent-prompt-registration' },
        });

        expect(accepted.statusCode).toBe(200);
        const acceptedBody = accepted.json<{ runId: string }>();
        await waitForRunTerminal(app.gateway, acceptedBody.runId);
        const systemText = String(captured[0]?.messages[0]?.content[0]?.type === 'text' ? captured[0].messages[0].content[0].text : '');
        expect(systemText).toContain('Agent package system prompt identity.');
        expect(systemText).toContain('Agent package workspace policy.');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed during app composition when Agent package prompt manifests are invalid', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-invalid-agent-prompts-'));
    try {
      await writeAgentSystemPrompt(tempDir, ['schemaVersion: nextagent.prompt-template/v1', 'content: invalid system string'].join('\n'));

      expect(() =>
        createComposedApp(
          {
            systemConfig: createSystemConfig(tempDir),
            agentDefinition: createAgentDefinition({ defaultModelId: 'selected-openai', capabilityBindings: [] }),
            credentialResolver: testCredentialResolver(),
          },
          captureModel([]),
        ),
      ).toThrow('SYSTEM_PROMPT content must be a section array.');
    } finally {
      await removeInvalidPromptTempDir(tempDir);
    }
  });

  it('resolves capability providers at startup and does not revalidate them on requests', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-capability-source-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const raw = rawSystemConfig(join('data', 'system', 'capability-source.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'mcp-source',
                  type: 'mcp-server',
                  url: 'http://localhost:3010',
                },
                {
                  id: 'local-source',
                  type: 'local-directory',
                  path: './capabilities',
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      let urlValidationCount = 0;
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
          capabilityProviderReferenceValidation: {
            isCredentialReferenceResolvable: () => true,
            resolveLocalDirectoryPath: (path) => path,
            isUrlResolvable: () => {
              urlValidationCount += 1;
              return true;
            },
          },
        },
        captureModel([]),
      );

      expect(app.capabilityProviders.providers).toEqual([]);
      expect(app.capabilityProviders.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerId: 'mcp-source', reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED' }),
          expect.objectContaining({ providerId: 'local-source', reasonCode: 'UNSUPPORTED_PROVIDER_TYPE' }),
        ]),
      );
      expect(urlValidationCount).toBe(1);

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check frozen source', idempotencyKey: 'idem-frozen-source' },
      });
      expect(response.statusCode).toBe(200);
      const acceptedBody = response.json<{ runId: string }>();
      await waitForRunTerminal(app.gateway, acceptedBody.runId);
      expect(urlValidationCount).toBe(1);
      await app.close();
      app = undefined;
    } finally {
      await app?.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it('registers SkillHub when a remote access factory is injected', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-default-adapter-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const raw = rawSystemConfig(join('data', 'system', 'skillhub-default-adapter.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'hub-a',
                  type: 'skill-hub',
                  gatewayId: 'skillhub',
                  installDir: './skillhub',
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
          skillHubAccessFactory: failingSkillHubGatewayFactory(),
          capabilityProviderReferenceValidation: {
            isCredentialReferenceResolvable: () => true,
            resolveLocalDirectoryPath: (path) => path,
            isUrlResolvable: () => true,
          },
        },
        captureModel([]),
      );

      expect(app.capabilityProviders.diagnostics).toEqual([]);
      expect(app.capabilityProviders.providers.map((provider) => provider.provider.providerId)).toEqual(['hub-a']);
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads SkillHub through request-time catalog synchronization before the governed Skill Tool loads its body', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-app-flow-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const raw = rawSystemConfig(join('data', 'system', 'skillhub-app-flow.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'hub-a',
                  type: 'skill-hub',
                  gatewayId: 'skillhub',
                  installDir: './skillhub-managed',
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      const captured: ModelInvocationRequest[] = [];
      const gatewayFactory = fakeSkillHubGatewayFactory({
        'pkg:skillhub-flow': zipPackage([
          { path: 'SKILL.md', content: validSkillHubSkill('skillhub-flow', 'Correlate OSS alarms before escalation.') },
        ]),
      });
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({
            capabilityBindings: [
              { capabilityId: brand<string, 'CapabilityId'>('skillhub-flow'), capabilityType: 'SKILL', providerId: 'hub-a', enabled: true },
            ],
          }),
          credentialResolver: testCredentialResolver(),
          skillHubAccessFactory: gatewayFactory,
          capabilityProviderReferenceValidation: {
            isCredentialReferenceResolvable: () => true,
            resolveLocalDirectoryPath: (path) => join(tempDir, path),
            isUrlResolvable: () => true,
          },
        },
        scriptedSkillModel(captured),
      );

      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'use installed SkillHub skill', idempotencyKey: 'idem-skillhub-app-flow' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app.gateway, body.runId);

      expect(gatewayFactory.searches[0]).toMatchObject({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion,
        agentAssemblyRef: 'default-agent:v1',
      });
      expect(gatewayFactory.downloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            agentVersion,
            agentAssemblyRef: 'default-agent:v1',
            contentRef: 'pkg:skillhub-flow',
            stagingRoot: expect.stringContaining('skillhub-managed'),
          }),
        ]),
      );
      expect(captured[0]?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'Skill', name: 'Skill' })]));
      expect(captured).toHaveLength(2);
      const secondModelInput = JSON.stringify(captured[1]?.messages);
      expect(secondModelInput).toContain('Correlate OSS alarms before escalation.');
      expect(secondModelInput).not.toContain(tempDir);
      expect(secondModelInput).not.toContain('skillhub.example');
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      const result = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
      expect(result).toMatchObject({
        role: 'CAPABILITY_RESULT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-skillhub-1', toolName: 'Skill' },
      });
      expect(result?.content).toContain('skillhub-flow');
      expect(result?.content).toContain('loaded');
      // Skill body is projected as a generated context message (capabilityGeneratedMessages),
      // merged into the next model round by the context engine, not listed as a standalone message.
      // The CAPABILITY_RESULT content carries the structured load status; verify the body does not leak
      // from either the persisted result message or the request message stream.
      expect(result?.content).not.toContain(tempDir);
      expect(result?.content).not.toContain('skillhub.example');
      expect(JSON.stringify(messages.items)).not.toContain(tempDir);
      expect(JSON.stringify(messages.items)).not.toContain('skillhub.example');
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);

  it('registers SkillHub during startup without remote sync, download or managed install side effects', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-startup-register-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const raw = rawSystemConfig(join('data', 'system', 'skillhub-startup-register.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          channel: { ...raw.channel, port: 31_451 },
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'hub-a',
                  type: 'skill-hub',
                  gatewayId: 'skillhub',
                  installDir: './skillhub-managed',
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      const gatewayFactory = fakeSkillHubGatewayFactory({
        'pkg:skillhub-flow': zipPackage([{ path: 'SKILL.md', content: validSkillHubSkill('skillhub-flow', 'Startup registration body.') }]),
      });
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
          identity,
          skillHubAccessFactory: gatewayFactory,
          capabilityProviderReferenceValidation: {
            isCredentialReferenceResolvable: () => true,
            resolveLocalDirectoryPath: (path) => join(tempDir, path),
            isUrlResolvable: () => true,
          },
        },
        captureModel([]),
      );

      await app.start();

      expect(gatewayFactory.searches).toEqual([]);
      expect(gatewayFactory.downloads).toEqual([]);
      await expect(readFile(join(tempDir, 'skillhub-managed', 'remote-skill-content-index.json'), 'utf8')).rejects.toThrow();
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not degrade startup when SkillHub remote would fail because startup does not synchronize', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-startup-degraded-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const raw = rawSystemConfig(join('data', 'system', 'skillhub-startup-degraded.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          channel: { ...raw.channel, port: 31_452 },
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'hub-a',
                  type: 'skill-hub',
                  gatewayId: 'skillhub',
                  installDir: './skillhub-managed',
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
          skillHubAccessFactory: failingSkillHubGatewayFactory(),
          capabilityProviderReferenceValidation: {
            isCredentialReferenceResolvable: () => true,
            resolveLocalDirectoryPath: (path) => join(tempDir, path),
            isUrlResolvable: () => true,
          },
        },
        captureModel([]),
      );

      await expect(app.start()).resolves.toBeUndefined();
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not wait on hanging SkillHub remote during startup because startup does not synchronize', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-startup-timeout-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const raw = rawSystemConfig(join('data', 'system', 'skillhub-startup-timeout.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          channel: { ...raw.channel, port: 31_453 },
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'hub-a',
                  type: 'skill-hub',
                  gatewayId: 'skillhub',
                  installDir: './skillhub-managed',
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
          skillHubAccessFactory: hangingSkillHubGatewayFactory(),
          capabilityProviderReferenceValidation: {
            isCredentialReferenceResolvable: () => true,
            resolveLocalDirectoryPath: (path) => join(tempDir, path),
            isUrlResolvable: () => true,
          },
        },
        captureModel([]),
      );

      await expect(Promise.race([app.start().then(() => 'started'), delay(1_000).then(() => 'timed-out')])).resolves.toBe('started');
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects undeclared custom adapters', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-custom-adapter-'));
    const raw = rawSystemConfig(join('data', 'system', 'capability-source-custom.sqlite'));
    const systemConfig = validateDefaultSystemConfig(
      {
        ...raw,
        nextAgent: {
          system: {
            'capability-providers': [{ id: 'undeclared-custom', type: 'custom', adapter: 'vendor-a', config: { mode: 'test' } }],
          },
        },
      },
      tempDir,
      { credentialResolver: testCredentialResolver() },
    );
    const app = createProviderConfiguredComposedApp({
      systemConfig,
      agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
      credentialResolver: testCredentialResolver(),
      capabilityProviderReferenceValidation: {
        isCredentialReferenceResolvable: () => true,
        resolveLocalDirectoryPath: (path) => path,
        isUrlResolvable: () => true,
      },
    });

    expect(app.capabilityProviders.providers).toEqual([]);
    expect(app.capabilityProviders.diagnostics[0]).toMatchObject({
      providerId: 'undeclared-custom',
      reasonCode: 'CUSTOM_ADAPTER_UNREGISTERED',
    });
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('registers clip_server only with executable discovery and runner wiring backed by sandbox bash', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-clip-source-'));
    try {
      const raw = rawSystemConfig(join('data', 'system', 'capability-source-clip.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'clip-backed',
                  type: 'custom',
                  adapter: 'clip_server',
                  config: { enabled: true, clipPathRef: 'clipc', endpointRef: 'clip-daemon', timeoutMs: 5000, retry: { maxAttempts: 1 } },
                },
              ],
              'capability-disclosure': { 'tool-disclosure-mode': 'tool-search' },
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        exitCode: 0,
        stdout:
          request.args[0] === 'list'
            ? JSON.stringify({
                catalog_status: { status: 'synced', capability_count: 1 },
                items: [
                  {
                    target: 'alarm-check',
                    ref: '/alarm-check',
                    operation: 'query',
                    status: 'enabled',
                    params: [{ name: 'neId', location: 'query', required: true }],
                  },
                ],
              })
            : JSON.stringify({
                status: 'ok',
                data: {
                  structured: {
                    capabilities: [
                      {
                        target_id: 'alarm-check',
                        ref_template: '/alarm-check',
                        operation: 'query',
                        body_required: false,
                        params: [{ name: 'neId', location: 'query', required: true }],
                        responses: [{ status: '200', description: 'Alarm check telecom Tool.', content_types: ['application/json'] }],
                      },
                    ],
                  },
                },
              }),
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 5,
      }));
      const captured: ModelInvocationRequest[] = [];
      const app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({
            capabilityBindings: [
              { capabilityId: brand<string, 'CapabilityId'>('alarm-check'), capabilityType: 'TOOL', providerId: 'clip-backed', enabled: true },
            ],
          }),
          credentialResolver: testCredentialResolver(),
          sandboxGateway: { execute },
        },
        captureModel(captured),
      );
      try {
        expect(app.capabilityProviders.diagnostics).toEqual([]);
        expect(app.capabilityProviders.providers[0]).toMatchObject({ provider: { providerKind: 'CUSTOM', providerType: 'clip_server' } });
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'check clip source', idempotencyKey: 'idem-clip-source' },
        });
        expect(accepted.statusCode).toBe(200);
        const acceptedBody = accepted.json<{ runId: string }>();
        await waitForRunTerminal(app.gateway, acceptedBody.runId);
        expect(captured[0]?.tools.map((tool) => tool.name)).toEqual(explicitBindingToolSearchBuiltinModelToolNames);
        expect(execute).toHaveBeenCalledWith(
          expect.objectContaining({
            executable: 'bash',
            command: 'clipc',
            args: ['list', '--status', 'all', '--limit', '1000', '--json', '--show-id'],
            timeoutMs: 5000,
          }),
          expect.any(AbortSignal),
        );
        expect(execute).toHaveBeenCalledWith(
          expect.objectContaining({
            executable: 'bash',
            command: 'clipc',
            args: ['describe', 'alarm-check', '/alarm-check'],
          }),
          expect.any(AbortSignal),
        );
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('streams CLIP JSONL execution chunks as capability result deltas through app composition', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-clip-stream-'));
    try {
      const raw = rawSystemConfig(join('data', 'system', 'capability-source-clip-stream.sqlite'));
      const systemConfig = validateDefaultSystemConfig(
        {
          ...raw,
          nextAgent: {
            system: {
              'capability-providers': [
                {
                  id: 'clip-backed',
                  type: 'custom',
                  adapter: 'clip_server',
                  config: { enabled: true, clipPathRef: 'clipc', endpointRef: 'clip-daemon', timeoutMs: 5000, retry: { maxAttempts: 1 } },
                },
              ],
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        exitCode: 0,
        stdout:
          request.args[0] === 'list'
            ? JSON.stringify({ items: [{ target: 'alarm-check', ref: '/api/hello/stream', operation: 'subscribe', status: 'enabled' }] })
            : JSON.stringify({
                data: {
                  structured: {
                    capabilities: [
                      {
                        target_id: 'alarm-check',
                        ref_template: '/api/hello/stream',
                        operation: 'subscribe',
                        body_required: false,
                        params: [],
                        responses: [{ status: '200', description: 'Hello stream CLIP Tool.', content_types: ['application/json'] }],
                      },
                    ],
                  },
                },
              }),
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 5,
      }));
      const executeWithStdoutChunks: NonNullable<RestrictedLocalSandboxGatewayPort['executeWithStdoutChunks']> = vi.fn(async (request, options) => {
        const first = '{"event":{"type":"data","data":{"chunk":"H"}}}\n';
        const second = '{"event":{"type":"data","data":{"chunk":"i"}}}\n';
        const done = '{"completion":{"reason":"eof","event_count":2}}\n';
        await options.onStdoutChunk?.(first);
        await options.onStdoutChunk?.(second);
        await options.onStdoutChunk?.(done);
        return {
          executionId: request.executionId,
          exitCode: 0,
          stdout: first + second + done,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          durationMs: 20,
        };
      });
      const captured: ModelInvocationRequest[] = [];
      const app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({
            capabilityBindings: [
              { capabilityId: brand<string, 'CapabilityId'>('alarm-check'), capabilityType: 'TOOL', providerId: 'clip-backed', enabled: true },
            ],
          }),
          credentialResolver: testCredentialResolver(),
          sandboxGateway: { execute, executeWithStdoutChunks },
        },
        scriptedClipToolModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'stream clip hello', idempotencyKey: 'idem-clip-stream' },
        });
        expect(accepted.statusCode).toBe(200);
        const body = accepted.json<{ sessionId: string; runId: string }>();
        const streamPromise = app.server.inject({
          method: 'GET',
          url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
        });
        await waitForRunTerminal(app.gateway, body.runId);
        const stream = await streamPromise;
        expect(stream.body.match(/event: CAPABILITY_RESULT_DELTA/g)).toHaveLength(4);
        expect(stream.body).not.toContain('"chunk":"H"');
        expect(stream.body).not.toContain('"chunk":"i"');
        expect(stream.body).toContain('event: CAPABILITY_COMPLETED');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid default-system config before composition reaches downstream packages', () => {
    const tempDir = process.cwd();
    expect(() =>
      validateDefaultSystemConfig(
        {
          ...rawSystemConfig(),
          modelProfiles: [rawSystemConfig('one.sqlite').modelProfiles[0], rawSystemConfig('two.sqlite').modelProfiles[0]],
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      ),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig({ ...rawSystemConfig(), paths: { workspaceRoot: '' } }, tempDir, { credentialResolver: testCredentialResolver() }),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig({ ...rawSystemConfig(), paths: { workspaceRoot: 'workspaces', logDirectory: '' } }, tempDir, {
        credentialResolver: testCredentialResolver(),
      }),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig({ ...rawSystemConfig(), observability: { logging: { diagnosticDetail: 'verbose' } } }, tempDir, {
        credentialResolver: testCredentialResolver(),
      }),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig(
        {
          ...rawSystemConfig('valid.sqlite'),
          identity: { authMode: 'trusted', localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject' } },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      ),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig(
        { ...rawSystemConfig('valid.sqlite'), modelProfiles: [{ ...rawSystemConfig('valid.sqlite').modelProfiles[0], credentialRef: 'raw-secret' }] },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      ),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig({ ...rawSystemConfig('valid.sqlite'), sandbox: { enabled: 'nope' as never } }, tempDir, {
        credentialResolver: testCredentialResolver(),
      }),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig(
        { ...rawSystemConfig('valid.sqlite'), modelProfiles: [{ ...rawSystemConfig('valid.sqlite').modelProfiles[0], providerKind: 'CUSTOM' }] },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      ),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig(
        {
          ...rawSystemConfig('valid.sqlite'),
          modelProfiles: rawSystemConfig('valid.sqlite').modelProfiles.map((profile) => ({ ...profile, enabled: false })),
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      ),
    ).toThrow('App configuration is blocked before ready.');
    expect(() =>
      validateDefaultSystemConfig({ ...rawSystemConfig('valid.sqlite'), sandbox: { additionalExecutables: { curl: {} } } }, tempDir, {
        credentialResolver: testCredentialResolver(),
      }),
    ).toThrow('App configuration is blocked before ready.');
    for (const rag of [
      { indexes: [] },
      { indexes: ['local', 'remote-a', 'remote-b', 'remote-c', 'remote-d', 'remote-e'] },
      { indexes: [''] },
      { indexes: ['local', '../private'] },
      { indexes: ['local', 'local'] },
    ]) {
      expect(() =>
        validateDefaultSystemConfig({ ...rawSystemConfig('valid.sqlite'), rag }, tempDir, { credentialResolver: testCredentialResolver() }),
      ).toThrow('App configuration is blocked before ready.');
    }
  });

  it('loads fallback candidates and file secret references into frozen startup artifacts', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-fallback-profile-'));
    const raw = rawSystemConfig('valid.sqlite');
    const systemConfig = validateDefaultSystemConfig(
      {
        ...raw,
        modelProfiles: [
          {
            ...raw.modelProfiles[0],
            models: [
              raw.modelProfiles[0]!.models[0]!,
              {
                ...raw.modelProfiles[0]!.models[1]!,
                modelId: 'fallback-openai',
                fallbackEligible: true,
              },
            ],
          },
        ],
      },
      tempDir,
      { credentialResolver: testCredentialResolver() },
    );
    const app = createProviderConfiguredComposedApp({
      systemConfig,
      agentDefinition: createAgentDefinition({
        defaultModelId: 'fallback-openai',
        modelIds: ['unselected-openai', 'fallback-openai'],
        capabilityBindings: [],
      }),
      credentialResolver: testCredentialResolver(),
    });

    const defaultRouteAssembly = await app.assemblyRegistry.active(app.systemConfig.activeAgentId);
    expect(defaultRouteAssembly.defaultModelId).toBe('fallback-openai');
    expect(app.systemConfig.modelProfiles.flatMap((provider) => provider.models).find((model) => model.modelId === 'fallback-openai')).toEqual({
      modelId: 'fallback-openai',
      displayName: 'MiniMax-M2.7',
      contextWindowTokens: 128_000,
      temperature: 0.1,
      maxOutputTokens: 128,
      providerOptions: { parallelToolCalls: false },
      timeoutMs: 45_000,
      fallbackEligible: true,
    });
    const configuredModels = app.systemConfig.modelProfiles.flatMap((provider) => provider.models);
    expect(configuredModels.map((profile) => profile.modelId)).toEqual(['unselected-openai', 'fallback-openai']);
    expect(configuredModels.filter((profile) => profile.fallbackEligible).map((profile) => profile.modelId)).toEqual(['fallback-openai']);
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('excludes an invalid fallback-only profile with operator-visible evidence when a primary remains enabled', () => {
    const raw = rawSystemConfig('valid.sqlite');
    const systemConfig = validateDefaultSystemConfig(
      {
        ...raw,
        modelProfiles: [
          raw.modelProfiles[0],
          {
            providerId: 'model-gateway',
            credentialRef: 'raw-secret',
            models: [{ modelId: 'broken-fallback', fallbackEligible: true }],
          },
        ],
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(systemConfig.modelProfiles.map((profile) => profile.providerId)).toEqual(['openai-compatible']);
    expect(systemConfig.modelProfileValidationEvidence).toEqual([
      {
        modelId: 'broken-fallback',
        code: 'APP_CONFIG_SECRET_REF_INVALID',
        message: 'Model provider credential reference is invalid.',
      },
    ]);
    expect(Object.isFrozen(systemConfig.modelProfileValidationEvidence)).toBe(true);
    expect(Object.isFrozen(systemConfig.modelProfileValidationEvidence[0])).toBe(true);
  });

  it('resolves file-backed credentials at invocation time and fails without leaking missing paths', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-secret-'));
    const secretFile = join(tempDir, 'openai-api-key');
    const emptySecretFile = join(tempDir, 'empty-api-key');
    const missingFile = join(tempDir, 'missing-api-key');
    try {
      await writeFile(secretFile, 'resolved-file-key\n', 'utf8');
      await writeFile(emptySecretFile, '', 'utf8');
      const resolveCredential = createAppCredentialResolver({});

      await expect(resolveCredential(`file:${secretFile}`)).resolves.toBe('resolved-file-key');
      await expect(resolveCredential(`file:${emptySecretFile}`)).rejects.toThrow('Configured credential is unavailable.');
      await expect(resolveCredential(`file:${missingFile}`)).rejects.toThrow('Configured credential is unavailable.');
      await expect(resolveCredential(`file:${missingFile}`)).rejects.not.toThrow(missingFile);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('deep freezes system model profiles and nested model options', () => {
    const systemConfig = validateDefaultSystemConfig(rawSystemConfig('valid.sqlite'), process.cwd(), {
      credentialResolver: testCredentialResolver(),
    });
    const provider = systemConfig.modelProfiles[0];
    const profile = provider?.models[0];

    expect(Object.isFrozen(systemConfig.modelProfiles)).toBe(true);
    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider?.models)).toBe(true);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile?.providerOptions)).toBe(true);
    expect(Object.isFrozen(systemConfig.modelProfileValidationEvidence)).toBe(true);
  });

  it('keeps non-secret fallback profile validation failures fail-fast', () => {
    const raw = rawSystemConfig('valid.sqlite');
    expect(() =>
      validateDefaultSystemConfig(
        {
          ...raw,
          modelProfiles: [
            raw.modelProfiles[0],
            {
              providerId: 'model-gateway',
              baseUrl: 'not-a-url',
              models: [{ modelId: 'broken-fallback', fallbackEligible: true }],
            },
          ],
        },
        process.cwd(),
        { credentialResolver: testCredentialResolver() },
      ),
    ).toThrow('App configuration is blocked before ready.');
  });

  it('rejects non-object model provider options before ready', () => {
    const raw = rawSystemConfig('valid.sqlite');
    for (const providerOptions of [[], 'invalid']) {
      expect(() =>
        validateDefaultSystemConfig(
          {
            ...raw,
            modelProfiles: [
              {
                ...raw.modelProfiles[0],
                models: [{ ...raw.modelProfiles[0]!.models[0]!, providerOptions }, raw.modelProfiles[0]!.models[1]!],
              },
            ],
          },
          process.cwd(),
          { credentialResolver: testCredentialResolver() },
        ),
      ).toThrow('App configuration is blocked before ready.');
    }
  });

  it('freezes startup configuration once before serving downstream composition', () => {
    const result = evaluateDefaultSystemConfig(rawSystemConfig('ready.sqlite'), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(result.status).toBe('READY');
    expect(result.config).toMatchObject({
      deployment: { mode: 'LOCAL' },
      auth: { mode: 'local' },
      hostedAgent: { activeAgentId: 'default-agent' },
      gateway: { gatewayKind: 'sqlite', sqliteFileRef: 'paths.sqliteFile' },
      configEvaluation: { readinessState: 'READY' },
    });
    expect(result.config).not.toHaveProperty('capabilityProviders');
    expect(Object.isFrozen(result.config?.configEvaluation)).toBe(true);
    expect(result.config?.modelProfiles.flatMap((provider) => provider.models.map((model) => model.modelId))).toEqual([
      'unselected-openai',
      'selected-openai',
    ]);
  });

  it('rejects the removed model enabled field instead of creating a second activation policy', () => {
    const raw = rawSystemConfig('disabled.sqlite');
    const result = evaluateDefaultSystemConfig(
      {
        ...raw,
        modelProfiles: [
          {
            ...raw.modelProfiles[0],
            models: [{ ...raw.modelProfiles[0]!.models[0]!, enabled: false }, raw.modelProfiles[0]!.models[1]!],
          },
        ],
        gateway: {
          gateways: [...raw.gateway.gateways, { gatewayId: 'remote-skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' }],
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics.map((entry) => entry.issueCode)).toContain('APP_CONFIG_MODEL_PROFILE_UNKNOWN_FIELD');
  });

  it('blocks startup with safe diagnostics for mandatory, ownership, model viability and active secret failures', () => {
    const raw = rawSystemConfig('blocked.sqlite');
    const cases = [
      { input: { ...raw, paths: undefined }, code: 'APP_CONFIG_SCHEMA_INVALID' },
      { input: { ...raw, frameworkRuntime: { port: 1 } }, code: 'APP_CONFIG_FRAMEWORK_OWNERSHIP_VIOLATION' },
      { input: { ...raw, modelProfiles: [] }, code: 'APP_CONFIG_SCHEMA_INVALID' },
      { input: { ...raw, modelProfiles: [{ ...raw.modelProfiles[0], credentialRef: 'raw-secret' }] }, code: 'APP_CONFIG_SECRET_REF_INVALID' },
      {
        input: { ...raw, modelProfiles: [{ ...raw.modelProfiles[0], credentialRef: 'env:MISSING_KEY' }] },
        code: 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
        credentialResolver: createAppCredentialResolver({}),
      },
    ];

    for (const entry of cases) {
      const result = evaluateDefaultSystemConfig(entry.input, process.cwd(), {
        credentialResolver: entry.credentialResolver ?? testCredentialResolver(),
      });
      expect(result.status).toBe('BLOCKED');
      expect(result.evidenceInput.diagnostics.map((issue) => issue.issueCode)).toContain(entry.code);
      expect(result.evidenceInput.diagnostics.every((issue) => !issue.safeMessage.includes('raw-secret'))).toBe(true);
      expect(result.evidenceInput.diagnostics.every((issue) => !issue.safeMessage.includes(process.cwd()))).toBe(true);
    }
  });

  it('validates active env and file secret references safely without retaining resolved values', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-secret-'));
    const secretFile = join(tempDir, 'provider-secret.txt');
    const unsafeFileRef = `file:${join(tempDir, 'missing-secret.txt')}`;
    const secretValue = 'super-private-provider-value';
    await writeFile(secretFile, secretValue, 'utf8');
    try {
      const resolver = createAppCredentialResolver({ ACTIVE_KEY: secretValue, EMPTY_KEY: '' });
      expect(resolver.validate('env:ACTIVE_KEY')).toEqual({ valid: true, referenceKind: 'env' });
      expect(resolver.validate(`file:${secretFile}`)).toEqual({ valid: true, referenceKind: 'file' });
      expect(resolver.validate('env:EMPTY_KEY')).toMatchObject({
        valid: false,
        referenceKind: 'env',
        issueCode: 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
      });
      expect(resolver.validate(unsafeFileRef)).toMatchObject({
        valid: false,
        referenceKind: 'file',
        issueCode: 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
      });
      expect(resolver.validate(secretValue)).toMatchObject({
        valid: false,
        referenceKind: 'unsupported',
        issueCode: 'APP_CONFIG_SECRET_REF_INVALID',
      });
      await expect(resolver(unsafeFileRef)).rejects.toMatchObject({
        code: 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
        message: 'Configured credential is unavailable.',
      });
      await expect(resolver(unsafeFileRef)).rejects.not.toThrow(unsafeFileRef);

      const raw = rawSystemConfig('secret.sqlite');
      const result = evaluateDefaultSystemConfig(
        { ...raw, modelProfiles: [{ ...raw.modelProfiles[0], credentialRef: `file:${secretFile}` }] },
        tempDir,
        { credentialResolver: resolver },
      );
      expect(result.status).toBe('READY');
      expect(JSON.stringify(result)).not.toContain(secretValue);
      expect(JSON.stringify(result.evidenceInput)).not.toContain(secretFile);
      expect(await resolver(`file:${secretFile}`)).toBe(secretValue);
      expect(JSON.stringify(result)).not.toContain(secretValue);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not validate a credential when the provider intentionally omits credentialRef', () => {
    const raw = rawSystemConfig('inactive-secret.sqlite');
    let validations = 0;
    const credentialResolver = Object.assign(async () => 'test-only', {
      validate: (ref: string) => {
        validations += 1;
        return ref.startsWith('env:')
          ? { valid: true, referenceKind: 'env' as const }
          : { valid: false, referenceKind: 'file' as const, issueCode: 'APP_CONFIG_SECRET_REF_UNAVAILABLE' as const };
      },
    });
    const result = evaluateDefaultSystemConfig({ ...raw, modelProfiles: [{ ...raw.modelProfiles[0], credentialRef: undefined }] }, process.cwd(), {
      credentialResolver,
    });
    expect(result.status).toBe('READY');
    expect(validations).toBe(0);
  });

  it('requires the app-composed resolver for composed app startup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-resolver-'));
    try {
      const systemConfig = createSystemConfig(tempDir);
      expect(() =>
        createComposedApp(
          { systemConfig, agentDefinition: createAgentDefinition(), credentialResolver: (async () => 'test-key') as never },
          captureModel([]),
        ),
      ).toThrow('App credential resolver must support startup validation.');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('drops invalid fallback-only active entries and enters degraded-ready with safe diagnostics', () => {
    const raw = rawSystemConfig('degraded.sqlite');
    const result = evaluateDefaultSystemConfig(
      {
        ...raw,
        modelProfiles: [
          raw.modelProfiles[0],
          {
            providerId: 'model-gateway',
            credentialRef: 'raw-secret',
            models: [{ modelId: 'fallback-openai', fallbackEligible: true }],
          },
        ],
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('DEGRADED_READY');
    expect(result.config?.modelProfiles.map((profile) => profile.providerId)).toEqual(['openai-compatible']);
    const degradations = result.evidenceInput.diagnostics.filter((issue) => !issue.affectsReadiness);
    expect(degradations).toHaveLength(1);
    expect(degradations[0]).toMatchObject({
      issueCode: 'APP_CONFIG_SECRET_REF_INVALID',
      fieldRef: 'modelProfiles.model-gateway.fallback-openai.credentialRef',
      affectsReadiness: false,
    });
    expect(degradations[0]?.safeMessage).not.toContain('raw-secret');
  });

  it('fails closed when default-agent config is missing or contains forbidden system fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-agent-'));
    try {
      expect(() => loadAgentDefinitionFile(join(tempDir, 'missing.yaml'))).toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    const agentFile = join(tmpdir(), `nextagent-agent-${Date.now()}.yaml`);
    await writeFile(agentFile, JSON.stringify({ ...rawAgentDefinition(), sqliteFile: 'data/system/nextagent.sqlite' }), 'utf8');
    try {
      expect(() => loadAgentDefinitionFile(agentFile)).toThrow('AgentDefinition must not contain sqliteFile.');
    } finally {
      await rm(agentFile, { force: true });
    }
  });

  it('defaults omitted source agentType but rejects an explicit empty implementation type', async () => {
    const defaultedFile = join(tmpdir(), `nextagent-agent-default-type-${Date.now()}.yaml`);
    await writeFile(defaultedFile, JSON.stringify(rawAgentDefinition()), 'utf8');
    try {
      expect(loadAgentDefinitionFile(defaultedFile).agentType).toBe('default');
    } finally {
      await rm(defaultedFile, { force: true });
    }

    const emptyFile = join(tmpdir(), `nextagent-agent-empty-type-${Date.now()}.yaml`);
    await writeFile(emptyFile, JSON.stringify({ ...rawAgentDefinition(), agentType: '' }), 'utf8');
    try {
      expect(() => loadAgentDefinitionFile(emptyFile)).toThrow('AgentDefinition.agentType must be a non-empty string.');
    } finally {
      await rm(emptyFile, { force: true });
    }
  });

  it('exposes stateless framework-default builtin capabilities with gateway-backed Task tools', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-config-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const app = createComposedApp(
        {
          systemConfig: createSystemConfig(tempDir),
          agentDefinition: createAgentDefinition({ defaultModelId: 'selected-openai', capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'diagnose default read', idempotencyKey: 'idem-config-default-read' },
        });

        expect(accepted.statusCode).toBe(200);
        const acceptedBody = accepted.json<{ runId: string }>();
        await waitForRunTerminal(app.gateway, acceptedBody.runId);
        expect(captured).toHaveLength(1);
        expect(captured[0]?.tools).toEqual([
          expect.objectContaining({ capabilityId: 'Read', name: 'Read' }),
          expect.objectContaining({ capabilityId: 'Write', name: 'Write' }),
          expect.objectContaining({ capabilityId: 'Glob', name: 'Glob' }),
          expect.objectContaining({ capabilityId: 'Grep', name: 'Grep' }),
          expect.objectContaining({ capabilityId: 'Bash', name: 'Bash' }),
          expect.objectContaining({ capabilityId: 'Python', name: 'Python' }),
          expect.objectContaining({ capabilityId: 'Edit', name: 'Edit' }),
          expect.objectContaining({ capabilityId: 'Rag', name: 'Rag' }),
          expect.objectContaining({ capabilityId: 'Skill', name: 'Skill' }),
          expect.objectContaining({ capabilityId: 'AskUserQuestion', name: 'AskUserQuestion' }),
          expect.objectContaining({ capabilityId: 'Agent', name: 'Agent' }),
          expect.objectContaining({ capabilityId: 'ToolSearch', name: 'ToolSearch' }),
          expect.objectContaining({ capabilityId: 'TodoWrite', name: 'TodoWrite' }),
          expect.objectContaining({ capabilityId: 'Workflow', name: 'Workflow' }),
        ]);
        const askUserQuestion = captured[0]?.tools.find((tool) => tool.name === 'AskUserQuestion')?.description ?? '';
        expect(askUserQuestion).toContain('You MUST call this tool whenever you need to ask the user any ordinary question');
        expect(askUserQuestion).toContain('Omit options for free-text answers');
        expect(askUserQuestion).toContain('generic permission to proceed');
        expect(askUserQuestion).toContain('plan approval');
        expect(askUserQuestion).toContain('protected-operation approval');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses planning-tool-calling-mode to keep TodoWrite out of Task-series mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-config-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const systemConfig = validateDefaultSystemConfig(
        {
          ...rawSystemConfig(join('data', 'system', `config-assembly-${Date.now()}-${Math.random()}.sqlite`)),
          nextAgent: { system: { 'planning-tool-calling-mode': 'task-tools' } },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      const app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ defaultModelId: 'selected-openai', capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'diagnose default task mode', idempotencyKey: 'idem-config-task-mode' },
        });

        expect(systemConfig.planningToolCallingMode).toBe('task-tools');
        expect(accepted.statusCode).toBe(200);
        const acceptedBody = accepted.json<{ runId: string }>();
        await waitForRunTerminal(app.gateway, acceptedBody.runId);
        expect(captured).toHaveLength(1);
        const toolNames = captured[0]?.tools.map((tool) => tool.name) ?? [];
        expect(toolNames).toContain('Read');
        expect(toolNames).toContain('Agent');
        expect(toolNames).not.toContain('TodoWrite');
        const planningToolNames = toolNames.filter((name) => name === 'TodoWrite' || /^Task[A-Z]/u.test(name));
        expect(planningToolNames.every((name) => /^Task[A-Z]/u.test(name))).toBe(true);
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('selects the app-composed memory gateway from the frozen MemoryConfig snapshot', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-config-'));
    let disabledApp: ReturnType<typeof createComposedApp> | undefined;
    let enabledApp: ReturnType<typeof createComposedApp> | undefined;
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const runtimeLogs: Array<Record<string, unknown>> = [];
    try {
      const disabledConfig = validateDefaultSystemConfig(
        {
          ...rawSystemConfig(),
          nextAgent: { memory: { enabled: false } },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      disabledApp = createComposedApp(
        {
          systemConfig: disabledConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
          operationalLogWriter: captureOperationalLogWriter(runtimeLogs),
          observationLogger: captureObservationLogger(structuredLogs),
        },
        captureModel([]),
      );

      expect(disabledApp.systemConfig.memory).toBe(disabledConfig.memory);
      expect(disabledApp.systemConfig.memory.status).toBe('DISABLED');
      await expect(
        disabledApp.gateway.longTermMemoryRetriever.searchLongTermMemory({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          queryText: 'BGP alarm',
          minConfidence: 0.3,
          limit: 20,
          offset: 0,
        }),
      ).resolves.toMatchObject({ code: 'LTM_DISABLED', category: 'UNAVAILABLE' });
      expect(runtimeLogs).toContainEqual(
        expect.objectContaining({
          event: 'memory.invocation.disabled',
          eventType: 'LTM_DISABLED',
          safeReasonCode: 'LTM_DISABLED',
          memoryOperation: 'searchLongTermMemory',
        }),
      );
      await disabledApp.close();
      disabledApp = undefined;

      const enabledConfig = validateDefaultSystemConfig(
        {
          ...rawSystemConfig(),
          nextAgent: { memory: { enabled: true } },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      enabledApp = createComposedApp(
        {
          systemConfig: enabledConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel([]),
      );

      expect(enabledApp.systemConfig.memory).toBe(enabledConfig.memory);
      expect(enabledApp.systemConfig.memory).toMatchObject({
        status: 'VALID',
        search: { defaultLimit: 20, minConfidence: 0.3 },
      });
      await expect(
        enabledApp.gateway.longTermMemoryRetriever.searchLongTermMemory({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          queryText: 'BGP alarm',
          minConfidence: 0.3,
          limit: 20,
          offset: 0,
        }),
      ).resolves.toMatchObject({ items: [] });
    } finally {
      await enabledApp?.close();
      await disabledApp?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('applies frozen MemoryConfig search defaults at the app-composed memory retriever boundary', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-search-config-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const systemConfig = validateDefaultSystemConfig(
        {
          ...rawSystemConfig(),
          nextAgent: {
            memory: {
              enabled: true,
              search: { 'default-limit': 1, 'min-confidence': 0.7 },
            },
          },
        },
        tempDir,
        { credentialResolver: testCredentialResolver() },
      );
      app = createComposedApp(
        {
          systemConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel([]),
      );
      const scope = { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId };
      const saveMemory = async (confidence: number, sourceId: string) => {
        const saved = await app!.gateway.longTermMemoryStore.saveLongTermMemory({
          ...scope,
          memoryType: 'FACTUAL',
          knowledgeSourceType: 'LEARNED',
          confidence,
          briefIndex: `BGP route flap confidence ${confidence}`,
          content: JSON.stringify({ category: 'FACTUAL', subject: 'BGP route flap', claim: `confidence ${confidence}` }),
          source: JSON.stringify({ sessionId: brand<string, 'SessionId'>(`session-${sourceId}`) }),
        });
        if ('code' in saved) {
          throw new Error(saved.code);
        }
      };
      await saveMemory(0.55, 'low');
      await saveMemory(0.75, 'medium');
      await saveMemory(0.95, 'high');

      const defaulted = await app.gateway.longTermMemoryRetriever.searchLongTermMemory({
        ...scope,
        queryText: 'BGP route flap',
        minConfidence: undefined as never,
        limit: undefined as never,
        offset: undefined as never,
      });
      if ('code' in defaulted) {
        throw new Error(defaulted.code);
      }
      expect(defaulted.total).toBe(2);
      expect(defaulted.items).toHaveLength(1);
      expect(defaulted.items[0]?.summary.confidence).toBeGreaterThanOrEqual(0.7);

      const explicit = await app.gateway.longTermMemoryRetriever.searchLongTermMemory({
        ...scope,
        queryText: 'BGP route flap',
        limit: 10,
        minConfidence: 0.5,
        offset: 0,
      });
      if ('code' in explicit) {
        throw new Error(explicit.code);
      }
      expect(explicit.total).toBe(3);
      expect(explicit.items).toHaveLength(3);
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed for injected invalid MemoryConfig snapshots', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-invalid-config-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const systemConfig = createSystemConfig(tempDir);
      const invalidConfig: DefaultSystemConfig = {
        ...systemConfig,
        memory: {
          ...systemConfig.memory,
          enabled: true,
          status: 'INVALID',
          diagnostics: [
            {
              issueCode: 'MEMORY_CONFIG_INVALID',
              status: 'INVALID',
              fieldRef: 'nextAgent.memory.enabled',
              safeMessage: 'Invalid memory configuration.',
              source: 'explicit',
            },
          ],
        },
      };
      app = createComposedApp(
        {
          systemConfig: invalidConfig,
          agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
          credentialResolver: testCredentialResolver(),
        },
        captureModel([]),
      );

      await expect(
        app.gateway.longTermMemoryRetriever.searchLongTermMemory({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          queryText: 'BGP alarm',
          minConfidence: 0.3,
          limit: 20,
          offset: 0,
        }),
      ).resolves.toMatchObject({ code: 'LTM_DISABLED', category: 'UNAVAILABLE' });
    } finally {
      await app?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('emits safe telemetry for invalid memory configuration before app ready', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-config-failure-'));
    const configFile = join(tempDir, 'invalid-memory-config.json');
    const metricsRegistry = createInMemoryMetricsRegistry();
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const runtimeLogs: Array<Record<string, unknown>> = [];
    try {
      await writeFile(
        configFile,
        JSON.stringify({
          nextAgent: {
            memory: {
              enabled: true,
              search: { 'default-limit': 101 },
            },
          },
        }),
        'utf8',
      );

      expect(() =>
        createProviderConfiguredComposedApp({
          configFile,
          credentialResolver: testCredentialResolver(),
          metricsRegistry,
          operationalLogWriter: captureOperationalLogWriter(runtimeLogs),
          observationLogger: captureObservationLogger(structuredLogs),
        }),
      ).toThrow('App configuration is blocked before ready.');

      expect(runtimeLogs).toContainEqual(
        expect.objectContaining({
          event: 'memory.config.failed',
          safeReasonCode: 'MEMORY_CONFIG_INVALID',
          status: 'INVALID',
        }),
      );
      expect(metricsRegistry.snapshot()).toContainEqual(
        expect.objectContaining({
          name: 'configuration_evaluation_total',
          labels: { component: 'memory', outcome: 'failure' },
        }),
      );
      expect(JSON.stringify(structuredLogs)).not.toContain(configFile);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects non-memory Tool description overrides without changing the Tool catalog', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-description-'));
    const captured: ModelInvocationRequest[] = [];
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const nonMemoryDescription = 'Do not apply this non-memory Tool description.';
    const app = createComposedApp(
      {
        systemConfig: createSystemConfig(tempDir),
        agentDefinition: createAgentDefinition({
          capabilityBindings: [
            {
              capabilityId: brand<string, 'CapabilityId'>('Read'),
              capabilityType: 'TOOL',
              providerId: 'builtin-tools',
              enabled: true,
              description: nonMemoryDescription,
            },
          ],
        }),
        credentialResolver: testCredentialResolver(),
        observationLogger: captureObservationLogger(structuredLogs),
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'diagnose memory description override', idempotencyKey: 'idem-memory-description-override' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      const readTool = captured[0]?.tools?.find((tool) => tool.capabilityId === 'Read');
      expect(readTool?.description).toContain('Read a bounded slice');
      expect(readTool?.description).not.toBe(nonMemoryDescription);
      expect(readTool?.inputSchema).toBeDefined();
      expect(readCapturedMetricSamples(app)).toContainEqual(
        expect.objectContaining({
          name: 'configuration_evaluation_total',
          labels: { component: 'capability_description_override', outcome: 'degraded' },
        }),
      );
      // Description-override diagnostics now flow through the observability projector host, not the
      // structured log transport. The metric above already confirms the rejection was recorded.
      expect(JSON.stringify(structuredLogs)).not.toContain(nonMemoryDescription);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records rejected capability description overrides without logging the override body', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-description-rejected-'));
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const rejectedDescription = 'Do not log this rejected override body.';
    const app = createComposedApp(
      {
        systemConfig: createSystemConfig(tempDir),
        agentDefinition: createAgentDefinition({
          capabilityBindings: [
            {
              capabilityId: brand<string, 'CapabilityId'>('network-diagnostics'),
              capabilityType: 'SKILL',
              providerId: 'builtin-skills',
              enabled: true,
              description: rejectedDescription,
            },
          ],
        }),
        credentialResolver: testCredentialResolver(),
        observationLogger: captureObservationLogger(structuredLogs),
      },
      captureModel([]),
    );
    try {
      expect(readCapturedMetricSamples(app)).toContainEqual(
        expect.objectContaining({
          name: 'configuration_evaluation_total',
          labels: { component: 'capability_description_override', outcome: 'degraded' },
        }),
      );
      // Description-override diagnostics now flow through the observability projector host, not the
      // structured log transport. The metric above already confirms the rejection was recorded.
      expect(JSON.stringify(structuredLogs)).not.toContain(rejectedDescription);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed capability binding descriptions before composition', () => {
    expect(() =>
      parseAgentDefinitionForTesting({
        ...rawAgentDefinition(),
        capabilityBindings: [
          {
            capabilityId: 'Read',
            capabilityType: 'TOOL',
            providerId: 'builtin-tools',
            enabled: true,
            description: 123,
          },
        ],
      }),
    ).toThrow('AgentDefinition.capabilityBindings.description must be a non-empty string.');
  });

  it('resolves canonical Agent loop defaults and accepts both configured boundaries', () => {
    expect(parseAgentDefinitionForTesting(rawAgentDefinition()).runtimeSettings).toMatchObject({
      maxTurns: 50,
      maxToolCallsPerTurn: 30,
    });
    expect(
      parseAgentDefinitionForTesting({
        ...rawAgentDefinition(),
        runtimeSettings: { maxTurns: Number.MAX_SAFE_INTEGER, maxToolCallsPerTurn: 100 },
      }).runtimeSettings,
    ).toMatchObject({ maxTurns: Number.MAX_SAFE_INTEGER, maxToolCallsPerTurn: 100 });
    expect(
      parseAgentDefinitionForTesting({
        ...rawAgentDefinition(),
        runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 1 },
      }).runtimeSettings,
    ).toMatchObject({ maxTurns: 1, maxToolCallsPerTurn: 1 });
  });

  it.each([
    { maxTurns: 0 },
    { maxTurns: 1.5 },
    { maxTurns: Number.MAX_SAFE_INTEGER + 1 },
    { maxToolCallsPerTurn: 0 },
    { maxToolCallsPerTurn: 1.5 },
    { maxToolCallsPerTurn: 101 },
    { maxToolCallsPerTurn: Number.MAX_SAFE_INTEGER + 1 },
    { maxToolIterations: 2 },
  ])('rejects invalid or legacy Agent loop settings %#', (runtimeSettings) => {
    expect(() =>
      parseAgentDefinitionForTesting({
        ...rawAgentDefinition(),
        runtimeSettings,
      }),
    ).toThrow();
  });

  it('parses trusted routing regex rules for skill and workflow targets', () => {
    const definition = parseAgentDefinitionForTesting({
      ...rawAgentDefinition(),
      routing: {
        mode: 'policy',
        policy: {
          method: 'policy:intent-recognition',
          rules: [
            { reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } },
            { reg: 'RAN', target: { kind: 'WORKFLOW', name: 'ran-alarm-diagnosis' } },
          ],
        },
      },
    });

    expect(definition.routing).toEqual({
      mode: 'policy',
      policy: {
        method: 'policy:intent-recognition',
        rules: [
          { reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } },
          { reg: 'RAN', target: { kind: 'WORKFLOW', name: 'ran-alarm-diagnosis' } },
        ],
      },
    });
  });

  it('rejects invalid trusted routing regex rules before composition', () => {
    expect(() =>
      parseAgentDefinitionForTesting({
        ...rawAgentDefinition(),
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: '(', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
          },
        },
      }),
    ).toThrow('AgentDefinition.routing.policy.rules.reg must be a valid ECMAScript regex.');
  });

  builtinExecutableIt('executes Bash through app composition and persists traceable tool-use and result messages', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-bash-integration-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        exitCode: 0,
        stdout: 'alarm-active\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 5,
      }));
      const app = createComposedApp(
        {
          systemConfig: createSystemConfig(tempDir),
          agentDefinition: createAgentDefinition({
            capabilityBindings: [],
            runtimeSettings: {
              defaultLanguage: 'zh-CN',

              requestTimeoutMs: 1_800_000,
              maxContextMessages: 1,
            },
          }),
          credentialResolver: testCredentialResolver(),
          riskPolicyEvaluator: requireAuthorizationRiskPolicy(),
          sandboxGateway: { execute },
        },
        scriptedBashModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'check active alarms', idempotencyKey: 'idem-bash-integration' },
        });
        expect(accepted.statusCode).toBe(200);
        const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
        const pendingInputId = await waitForPendingInput(app, body.sessionId, body.runId);
        await app.runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-bash-integration-approve'),
          answer: {
            sessionId: brand<string, 'SessionId'>(body.sessionId),
            pendingInputId,
            answers: [['approve']],
          },
        });
        await waitForRunTerminal(app.gateway, body.runId);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0]?.[0]).toMatchObject({
          requestRunId: body.runId,
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          executable: 'bash',
          command: 'cat',
          args: ['logs/alarm.txt'],
          environment: {},
          timeoutMs: 30_000,
          stdoutLimitBytes: 100_000,
          stderrLimitBytes: 100_000,
        });
        expect(captured).toHaveLength(2);
        expect(captured[1]?.messages.slice(-2)).toEqual([
          {
            role: 'ASSISTANT',
            content: [
              {
                type: 'tool-call',
                toolCall: {
                  toolCallId: 'tool-bash-1',
                  toolName: 'Bash',
                  arguments: {
                    command: 'cat logs/alarm.txt',
                    description: 'Read active alarm log',
                    timeout: 30_000,
                  },
                },
              },
            ],
          },
          {
            role: 'TOOL',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'tool-bash-1',
                toolName: 'Bash',
                output: {
                  stdout: 'alarm-active\n',
                  stderr: '',
                  exitCode: 0,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                },
              },
            ],
          },
        ]);
        expect(JSON.stringify(captured[1]?.messages)).toContain('alarm-active');

        const messages = await app.gateway.messages.listCurrentRequestMessages({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          requestId: brand<string, 'MessageId'>(body.requestId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          includeHidden: true,
          offset: 0,
          limit: 20,
        });
        const toolUse = messages.items.find((message) => message.metadata['kind'] === 'ASSISTANT_TOOL_USE');
        const result = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
        expect(toolUse?.content).toContain('cat logs/alarm.txt');
        expect(toolUse?.metadata['toolCallIds']).toEqual(['tool-bash-1']);
        expect(result).toMatchObject({
          role: 'CAPABILITY_RESULT',
          metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-bash-1', toolName: 'Bash' },
        });
        expect(result?.content).toContain('alarm-active');

        const stream = await app.server.inject({
          method: 'GET',
          url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
        });
        expect(stream.body).toContain('event: CAPABILITY_STARTED');
        expect(stream.body).toContain('event: CAPABILITY_COMPLETED');
        expect(stream.body).toContain('tool-bash-1');

        const defaultHistory = await app.server.inject({
          method: 'GET',
          url: `/api/v1/sessions/${body.sessionId}/conversation?limit=20`,
        });
        expect(defaultHistory.body).not.toContain('alarm-active');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  builtinExecutableIt(
    'executes an authorized clipc command through the default composed sandbox gateway',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-clipc-integration-'));
      const binDir = await mkdtemp(join(tmpdir(), 'nextagent-clipc-bin-'));
      const previousClipHome = process.env['CLIP_HOME'];
      process.env['CLIP_HOME'] = `"${binDir}"`;
      try {
        const clipcPath = join(binDir, process.platform === 'win32' ? 'clipc.exe' : 'clipc');
        await copyFile(process.execPath, clipcPath);
        if (process.platform !== 'win32') {
          await chmod(clipcPath, 0o755);
        }

        const captured: ModelInvocationRequest[] = [];
        const app = createComposedApp(
          {
            systemConfig: createSystemConfig(tempDir),
            agentDefinition: createAgentDefinition({ capabilityBindings: [] }),
            credentialResolver: testCredentialResolver(),
            riskPolicyEvaluator: requireAuthorizationRiskPolicy(),
          },
          scriptedClipcBashModel(captured),
        );
        try {
          const assembly = await app.assemblyRegistry.require(agentId, agentVersion);
          const executionWorkspace = createExecutionWorkspaceResolver().resolve({
            runtimeWorkspaceRoot: app.systemConfig.paths.runtimeWorkspaceRoot,
            sharedDataRoot: app.systemConfig.paths.sharedDataRoot,
            workspacePolicy: assembly.workspacePolicy,
            agentId,
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            runId: brand<string, 'RequestRunId'>('clipc-setup-run'),
            deploymentMode: 'LOCAL',
          });
          await mkdir(executionWorkspace.defaultCwd, { recursive: true });
          await writeFile(join(executionWorkspace.defaultCwd, 'query'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))', 'utf8');
          const accepted = await app.server.inject({
            method: 'POST',
            url: '/api/v1/requests',
            payload: { inputText: 'check CLIP health', idempotencyKey: 'idem-clipc-integration' },
          });
          expect(accepted.statusCode).toBe(200);
          const body = accepted.json<{ sessionId: string; runId: string }>();
          const pendingInputId = await waitForPendingInput(app, body.sessionId, body.runId);
          await app.runtime.answerPendingInput({
            identityContext: identity,
            idempotencyKey: brand<string, 'IdempotencyKey'>('idem-clipc-integration-approve'),
            answer: {
              sessionId: brand<string, 'SessionId'>(body.sessionId),
              pendingInputId,
              answers: [['approve']],
            },
          });
          await waitForRunTerminal(app.gateway, body.runId, 5_000);

          expect(captured).toHaveLength(2);
          expect(captured[1]?.messages.at(-1)).toMatchObject({
            role: 'TOOL',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'tool-clipc-1',
                toolName: 'Bash',
                output: {
                  stdout: '["getHealth","/api/health"]',
                  stderr: '',
                  exitCode: 0,
                },
              },
            ],
          });
        } finally {
          await app.close();
        }
      } finally {
        if (previousClipHome === undefined) {
          delete process.env['CLIP_HOME'];
        } else {
          process.env['CLIP_HOME'] = previousClipHome;
        }
        await rm(tempDir, { recursive: true, force: true });
        await rm(binDir, { recursive: true, force: true });
      }
    },
    15_000,
  );

  builtinExecutableIt('maps sandbox unavailable results through the composed SandboxGatewayPort without host fallback', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-bash-deny-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
        safeError: {
          code: 'SANDBOX_UNCONFIGURED',
          message: 'Sandbox execution is not configured.',
          category: 'UNAVAILABLE',
          retryable: false,
          safeDetails: { reason: 'unconfigured' },
        },
      }));
      const app = createComposedApp(
        {
          systemConfig: createSystemConfig(tempDir),
          agentDefinition: createAgentDefinition({
            capabilityBindings: [],
            runtimeSettings: {
              defaultLanguage: 'zh-CN',

              requestTimeoutMs: 1_800_000,
              maxContextMessages: 1,
            },
          }),
          credentialResolver: testCredentialResolver(),
          riskPolicyEvaluator: requireAuthorizationRiskPolicy(),
          sandboxGateway: { execute },
        },
        scriptedBashModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'check active alarms', idempotencyKey: 'idem-bash-deny' },
        });
        expect(accepted.statusCode).toBe(200);
        const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
        const pendingInputId = await waitForPendingInput(app, body.sessionId, body.runId);
        await app.runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-bash-deny-approve'),
          answer: {
            sessionId: brand<string, 'SessionId'>(body.sessionId),
            pendingInputId,
            answers: [['approve']],
          },
        });
        await waitForRunTerminal(app.gateway, body.runId);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0]?.[0]).toMatchObject({
          requestRunId: body.runId,
          executable: 'bash',
          command: 'cat',
          args: ['logs/alarm.txt'],
        });
        const messages = await app.gateway.messages.listCurrentRequestMessages({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          requestId: brand<string, 'MessageId'>(body.requestId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          includeHidden: true,
          offset: 0,
          limit: 20,
        });
        const result = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
        expect(result).toMatchObject({
          role: 'CAPABILITY_RESULT',
          metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-bash-1', toolName: 'Bash' },
        });
        expect(result?.content).toContain('SANDBOX_UNAVAILABLE');
        expect(result?.content).toContain('SANDBOX_UNCONFIGURED');
        expect(result?.content).not.toContain('cat logs/alarm.txt');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  builtinExecutableIt('maps rejected sandbox commands back to COMMAND_NOT_ALLOWED instead of SANDBOX_UNAVAILABLE', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-bash-rejected-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
        safeError: {
          code: 'BASH_EXECUTION_UNAVAILABLE',
          message: 'Bash execution request was rejected.',
          category: 'UNAVAILABLE',
          retryable: false,
          safeDetails: { reason: 'unsupported-executable' },
        },
      }));
      const app = createComposedApp(
        {
          systemConfig: createSystemConfig(tempDir),
          agentDefinition: createAgentDefinition({
            capabilityBindings: [],
            runtimeSettings: {
              defaultLanguage: 'zh-CN',

              requestTimeoutMs: 1_800_000,
              maxContextMessages: 1,
            },
          }),
          credentialResolver: testCredentialResolver(),
          riskPolicyEvaluator: requireAuthorizationRiskPolicy(),
          sandboxGateway: { execute },
        },
        scriptedBashModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'check active alarms', idempotencyKey: 'idem-bash-rejected-command' },
        });
        expect(accepted.statusCode).toBe(200);
        const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
        const pendingInputId = await waitForPendingInput(app, body.sessionId, body.runId);
        await app.runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-bash-rejected-command-approve'),
          answer: {
            sessionId: brand<string, 'SessionId'>(body.sessionId),
            pendingInputId,
            answers: [['approve']],
          },
        });
        await waitForRunTerminal(app.gateway, body.runId);
        const terminalRun = await app.gateway.requestRuns.loadRun({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          runId: brand<string, 'RequestRunId'>(body.runId),
        });
        expect(terminalRun?.status).toBe('COMPLETED');

        const messages = await app.gateway.messages.listCurrentRequestMessages({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          requestId: brand<string, 'MessageId'>(body.requestId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          includeHidden: true,
          offset: 0,
          limit: 20,
        });
        const result = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
        expect(result?.content).toContain('COMMAND_NOT_ALLOWED');
        expect(result?.content).toContain('"category":"AUTHORIZATION"');
        expect(result?.content).not.toContain('SANDBOX_UNAVAILABLE');
        expect(result?.content).not.toContain('cat logs/alarm.txt');
        expect(captured).toHaveLength(2);
        expect(JSON.stringify(captured[1]?.messages)).toContain('COMMAND_NOT_ALLOWED');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses accepted assembly maxTurns for the Agent loop and starts one finalizing turn', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-config-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const app = createComposedApp(
        {
          systemConfig: createSystemConfig(tempDir),
          agentDefinition: createAgentDefinition({
            runtimeSettings: {
              defaultLanguage: 'zh-CN',

              maxTurns: 1,
              maxToolCallsPerTurn: 30,
              requestTimeoutMs: 1_800_000,
            },
          }),
          credentialResolver: testCredentialResolver(),
        },
        repeatedReadToolModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'trigger assembly tool limit', idempotencyKey: 'idem-config-tool-limit' },
        });

        expect(accepted.statusCode).toBe(200);
        const acceptedBody = accepted.json<{ sessionId: string; runId: string }>();
        await waitForRunTerminal(app.gateway, acceptedBody.runId);
        expect(captured).toHaveLength(2);
        const stream = await app.server.inject({
          method: 'GET',
          url: `/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`,
        });
        expect(stream.body).toContain('TOOL_ROUND_LIMIT_EXCEEDED');
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps compilation structural and rejects cross-resource refs during graph validation', () => {
    const systemConfig = createSystemConfig(process.cwd());
    const compiler = createStartupAgentAssemblyCompiler();
    const resourceInventory = createInventory(systemConfig);

    expect(() =>
      compiler.compile({
        systemConfig,
        resourceReferences: resourceInventory,
        agentDefinition: { ...createAgentDefinition(), agentId: brand<string, 'AgentId'>('../bad') },
      }),
    ).toThrow('Unsafe agentId');
    const missingProfile = compiler.compile({
      systemConfig,
      resourceReferences: resourceInventory,
      agentDefinition: createAgentDefinition({
        modelIds: ['missing-profile'],
        defaultModelId: 'missing-profile',
      }),
    }).assembly;
    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig,
        assemblies: [missingProfile],
        resourceReferences: resourceInventory,
      }),
    ).toThrow('Missing model reference');
    expect(
      compiler.compile({
        systemConfig,
        resourceReferences: resourceInventory,
        agentDefinition: createAgentDefinition({
          capabilityBindings: [
            { capabilityId: brand<string, 'CapabilityId'>('Read'), capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
            {
              capabilityId: brand<string, 'CapabilityId'>('network-diagnostics'),
              capabilityType: 'SKILL',
              providerId: 'builtin-skills',
              enabled: true,
            },
          ],
        }),
      }).assembly.capabilityBindings,
    ).toEqual([
      { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
      { capabilityId: 'network-diagnostics', capabilityType: 'SKILL', providerId: 'builtin-skills', enabled: true },
    ]);
    const missingProvider = compiler.compile({
      systemConfig,
      resourceReferences: resourceInventory,
      agentDefinition: createAgentDefinition({
        capabilityBindings: [
          { capabilityId: brand<string, 'CapabilityId'>('later-skill'), capabilityType: 'SKILL', providerId: 'missing-provider', enabled: false },
        ],
      }),
    }).assembly;
    expect(() =>
      validateStartupAgentAssemblyGraph({
        systemConfig,
        assemblies: [missingProvider],
        resourceReferences: resourceInventory,
      }),
    ).toThrow('Unregistered capability provider');
    expect(() =>
      compiler.compile({
        systemConfig,
        resourceReferences: resourceInventory,
        agentDefinition: createAgentDefinition({ resources: [{ resourceId: 'escape', kind: 'WORKSPACE_FILE', path: '../outside.txt' }] }),
      }),
    ).toThrow('Agent resource path escapes workspace.');
  });

  it('resolves omitted Agent modelIds from frozen system configuration without overriding explicit activation', () => {
    const systemConfig = createSystemConfig(process.cwd());
    const compiler = createStartupAgentAssemblyCompiler();
    const resourceInventory = createInventory(systemConfig);
    const { modelIds: _modelIds, ...definitionWithoutModelIds } = createAgentDefinition();

    const inherited = compiler.compile({
      systemConfig,
      resourceReferences: resourceInventory,
      agentDefinition: definitionWithoutModelIds,
    }).assembly;
    const explicit = compiler.compile({
      systemConfig,
      resourceReferences: resourceInventory,
      agentDefinition: createAgentDefinition({ modelIds: ['selected-openai'] }),
    }).assembly;

    expect(inherited.modelIds).toEqual(['unselected-openai', 'selected-openai']);
    expect(inherited).not.toHaveProperty('defaultModelId');
    expect(explicit.modelIds).toEqual(['selected-openai']);
    expect(() =>
      compiler.compile({
        systemConfig,
        resourceReferences: resourceInventory,
        agentDefinition: createAgentDefinition({ modelIds: [] }),
      }),
    ).toThrow('Agent modelIds must be a non-empty array.');
  });

  it('keeps capability binding metadata out of compiled assembly bindings', () => {
    const systemConfig = createSystemConfig(process.cwd());
    const compiler = createStartupAgentAssemblyCompiler();
    const resourceInventory = createInventory(systemConfig);

    const compiled = compiler.compile({ systemConfig, resourceReferences: resourceInventory, agentDefinition: createAgentDefinition() });

    expect(compiled.assembly.capabilityBindings).toEqual([
      expect.objectContaining({
        capabilityId: 'Read',
        capabilityType: 'TOOL',
        providerId: 'builtin-tools',
      }),
    ]);
    expect(compiled.assembly.capabilityBindings[0]).not.toHaveProperty('replayPolicy');
  });

  it('preserves localized Agent display names in the compiled assembly', () => {
    const systemConfig = createSystemConfig(process.cwd());
    const compiler = createStartupAgentAssemblyCompiler();
    const resourceInventory = createInventory(systemConfig);
    const locales = {
      language: {
        'zh-CN': { displayName: '电信智能体' },
        'en-US': { displayName: 'Telecom agent' },
      },
    };

    const compiled = compiler.compile({
      systemConfig,
      resourceReferences: resourceInventory,
      agentDefinition: createAgentDefinition({ locales } as never),
    });

    expect(compiled.assembly).toMatchObject({ displayName: 'Telecom agent', locales });
  });

  it('compiles trusted workspace file authority into Agent workspace policy', () => {
    const systemConfig = createSystemConfig(process.cwd());
    const compiler = createStartupAgentAssemblyCompiler();
    const resourceInventory = createInventory(systemConfig);
    const compiled = compiler.compile({
      systemConfig,
      resourceReferences: resourceInventory,
      agentDefinition: {
        ...createAgentDefinition(),
        workspaceFiles: {
          readDirectories: ['diagnostics', 'generated-skills/output', 'workspace/temp'],
          writeDirectories: ['.', 'diagnostics\\generated', 'diagnostics/generated/nested'],
          readAllowedExtensions: ['.json'],
          readDeniedExtensions: ['.pem'],
          writeAllowedExtensions: ['.json'],
          writeDeniedExtensions: ['.sh'],
          maxTextBytes: 128_000,
        },
      },
    });

    expect(compiled.assembly.workspacePolicy.files).toEqual({
      readDirectories: ['workspace/diagnostics', 'generated-skills/output', 'workspace/temp'],
      writeDirectories: ['workspace'],
      maxTextBytes: 128_000,
    });
    expect(compiled.assembly).not.toHaveProperty('workspaceFiles');
    expect(compiled.assembly).not.toHaveProperty('writeDirectories');
    expect(compiled.assembly.workspacePolicy.files).not.toHaveProperty('readAllowedExtensions');
    expect(compiled.assembly.workspacePolicy.files).not.toHaveProperty('readDeniedExtensions');
    expect(compiled.assembly.workspacePolicy.files).not.toHaveProperty('writeAllowedExtensions');
    expect(compiled.assembly.workspacePolicy.files).not.toHaveProperty('writeDeniedExtensions');
  });

  it('resolves workspace file authority by runtime Agent scope', async () => {
    const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-agent-workspace-policy-'));
    try {
      const agentA = brand<string, 'AgentId'>('agent-a');
      const agentB = brand<string, 'AgentId'>('agent-b');
      const policyByAgent = new Map<string, { readonly writeDirectories: readonly string[] }>([
        [agentA, { writeDirectories: ['agent-a'] }],
        [agentB, { writeDirectories: ['agent-b'] }],
      ]);
      const workspacePolicy = (id: string) =>
        ({
          schemaVersion: 'nextagent.agent-workspace-policy.v1',
          isolationMode: 'subject',
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
            { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
          ],
          files: {
            writeDirectories: policyByAgent.get(id)?.writeDirectories ?? [],
            maxTextBytes: 256_000,
          },
        }) as const;
      const workspaceFiles = createWorkspaceFilePort({
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          require: async (id) => workspacePolicy(id),
        },
      });
      const context = (id: typeof agentA, runId: string): ToolExecutionContext => ({
        identityContext: identity,
        agentId: id,
        agentVersion,
        sessionId: brand<string, 'SessionId'>(`session-${runId}`),
        requestId: brand<string, 'MessageId'>(`request-${runId}`),
        runId: brand<string, 'RequestRunId'>(runId),
        requestContextId: brand<string, 'RequestContextId'>(`context-${runId}`),
        stepId: 'turn-1',
        toolCallId: `tool-${runId}`,
        timeoutMs: 1000,
      });

      await expect(
        workspaceFiles.writeText({ file_path: 'agent-a/out.txt', content: 'wrong agent' }, context(agentB, 'run-b')),
      ).rejects.toMatchObject({
        code: 'CAPABILITY_PATH_REJECTED',
      });
      await expect(
        workspaceFiles.writeText({ file_path: 'agent-a/out.txt', content: 'right agent' }, context(agentA, 'run-a')),
      ).resolves.toMatchObject({
        file_path: 'workspace/agent-a/out.txt',
      });
    } finally {
      await rm(runtimeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it('parses workspace file authority from Agent configuration with strict runtime validation', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-agent-workspace-files-'));
    try {
      const systemConfig = createSystemConfig(tempDir);
      const agentDirectory = join(systemConfig.paths.agentsRoot, 'default-agent');
      await mkdir(agentDirectory, { recursive: true });
      const valid = {
        ...rawAgentDefinition(),
        workspaceFiles: {
          readDirectories: ['diagnostics'],
          writeDirectories: ['generated'],
          readAllowedExtensions: ['.json'],
          readDeniedExtensions: ['.pem'],
          writeAllowedExtensions: [],
          writeDeniedExtensions: ['.sh'],
          maxTextBytes: 64_000,
        },
      };
      await writeFile(join(agentDirectory, 'agent.yaml'), JSON.stringify(valid), 'utf8');
      expect(loadAgentDefinitionForSystemConfig(systemConfig).workspaceFiles).toEqual(valid.workspaceFiles);

      await writeFile(
        join(agentDirectory, 'agent.yaml'),
        JSON.stringify({
          ...valid,
          workspaceFiles: { ...valid.workspaceFiles, unexpected: true },
        }),
        'utf8',
      );
      expect(() => loadAgentDefinitionForSystemConfig(systemConfig)).toThrow('AgentDefinition.workspaceFiles must not contain unexpected');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe workspace file authority for only the affected assembly compilation', () => {
    const systemConfig = createSystemConfig(process.cwd());
    const compiler = createStartupAgentAssemblyCompiler();
    const resourceInventory = createInventory(systemConfig);

    for (const workspaceFiles of [
      { writeDirectories: [''] },
      { readDirectories: [''] },
      { writeDirectories: ['../outside'] },
      { readDirectories: ['../outside'] },
      { writeDirectories: ['generated/../other'] },
      { readDirectories: ['generated/../other'] },
      { writeDirectories: [process.cwd()] },
      { readDirectories: [process.cwd()] },
      { writeDirectories: ['generated/*'] },
      { readDirectories: ['generated/*'] },
      { writeDirectories: ['generated?'] },
      { readDirectories: ['generated?'] },
      { writeDirectories: ['generated:stream'] },
      { readDirectories: ['generated:stream'] },
      { writeDirectories: ['line\nbreak'] },
      { readDirectories: ['line\nbreak'] },
      { writeDirectories: ['trailing-dot.'] },
      { readDirectories: ['trailing-dot.'] },
      { writeDirectories: ['trailing-space '] },
      { readDirectories: ['trailing-space '] },
      { writeDirectories: ['CON '] },
      { readDirectories: ['CON '] },
      { writeDirectories: ['NUL...'] },
      { readDirectories: ['NUL...'] },
      { maxTextBytes: 256_001 },
      { maxTextBytes: 0 },
      { maxTextBytes: 1.5 },
    ]) {
      expect(() =>
        compiler.compile({
          systemConfig,
          resourceReferences: resourceInventory,
          agentDefinition: { ...createAgentDefinition(), workspaceFiles },
        }),
      ).toThrow();
    }
    expect(
      compiler.compile({ systemConfig, resourceReferences: resourceInventory, agentDefinition: createAgentDefinition() }).assembly.workspacePolicy
        .files,
    ).toEqual({
      writeDirectories: ['workspace'],
      maxTextBytes: 256_000,
    });
    expect(
      compiler.compile({
        systemConfig,
        resourceReferences: resourceInventory,
        agentDefinition: { ...createAgentDefinition(), workspaceFiles: { writeDirectories: [] } },
      }).assembly.workspacePolicy.files?.writeDirectories,
    ).toEqual([]);
    expect(
      compiler.compile({
        systemConfig,
        resourceReferences: resourceInventory,
        agentDefinition: { ...createAgentDefinition(), workspaceFiles: { writeDirectories: ['..diagnostics'] } },
      }).assembly.workspacePolicy.files?.writeDirectories,
    ).toEqual(['workspace/..diagnostics']);
  });

  it('keeps raw config awareness inside agent-app and leaves no implicit default-agent fallback', async () => {
    for (const sourcePath of [
      'packages/agent-runtime/src/lifecycle/submit.ts',
      'packages/agent-core/src/agent/default-agent.ts',
      'packages/agent-context-engine/src/assembly/assemble-context.ts',
      'packages/agent-capability/src/catalog/catalog.ts',
      'packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts',
    ]) {
      const source = await readFile(join(process.cwd(), sourcePath), 'utf8');
      expect(source).not.toContain('agent-app/config');
      expect(source).not.toContain('agent-app/assembly');
      expect(source).not.toContain('process.env');
      expect(source).not.toContain('?? "default-agent"');
    }
    const productComposition = await readFile(join(process.cwd(), 'packages/agent-app/src/composition/create-app.ts'), 'utf8');
    expect(productComposition).not.toContain('createTestGatewayStores');
    expect(productComposition).not.toContain('createDefaultAgentTestAssemblyRegistry');
    expect(productComposition).not.toContain('synthesizeDefaultAgentDefinition');
  });
});

function createSystemConfig(workspaceDir: string): DefaultSystemConfig {
  return validateDefaultSystemConfig(rawSystemConfig(join('data', 'system', `config-assembly-${Date.now()}-${Math.random()}.sqlite`)), workspaceDir, {
    credentialResolver: testCredentialResolver(),
  });
}

async function removeInvalidPromptTempDir(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    if (!isBusyFsError(error)) {
      throw error;
    }
    await rm(join(tempDir, 'agents'), { recursive: true, force: true }).catch(() => undefined);
    await rm(join(tempDir, 'logs'), { recursive: true, force: true }).catch(() => undefined);
  }
}

function isBusyFsError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EBUSY') {
    return true;
  }
  return error instanceof Error && error.message.includes('EBUSY');
}

async function writeAgentSystemPrompt(configRoot: string, manifest: string): Promise<void> {
  const promptRoot = join(configRoot, 'agents', 'default-agent', 'prompts', 'SYSTEM_PROMPT');
  await mkdir(promptRoot, { recursive: true });
  await writeFile(join(promptRoot, 'template.yaml'), manifest, 'utf8');
}

function testCredentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    RAG_INDEXES: 'local,remote-netops',
  });
}

function captureOperationalLogWriter(entries: Array<Record<string, unknown>>): OperationalLogWriter {
  const capture = (entry: object): void => {
    entries.push({ ...entry });
  };
  const logger = { debug: capture, info: capture, warn: capture, error: capture };
  return {
    getLogger: () => logger,
    getObservationLogger: () => logger,
    activeIdentity: () => undefined,
    flush: async () => {},
    close: async () => {},
  };
}

function allowAllRiskPolicy(): RiskPolicyEvaluator {
  return {
    async evaluate() {
      return { outcome: 'ALLOW', reasonCode: 'ALLOWED' };
    },
  };
}

function requireAuthorizationRiskPolicy(): RiskPolicyEvaluator {
  return {
    async evaluate(input) {
      if (input.operation.currentRunAuthorizationMatched === true || input.operation.operationKind === 'SANDBOX_EXECUTION') {
        return { outcome: 'ALLOW', reasonCode: 'ALLOWED' };
      }
      return {
        outcome: 'REQUIRE_AUTHORIZATION',
        reasonCode: 'RISK_POLICY_AUTHORIZATION_REQUIRED',
        authorizationIntent: {
          operationId: input.operation.operationId,
          operationKind: input.operation.operationKind,
          riskLevel: input.operation.riskLevel,
          prompt: 'Approve the requested operation?',
          approveLabel: 'Approve',
          denyLabel: 'Deny',
          ...(input.operation.capabilityId === undefined ? {} : { capabilityId: input.operation.capabilityId }),
          ...(input.operation.toolCallId === undefined ? {} : { toolCallId: input.operation.toolCallId }),
        },
      };
    },
  };
}

function rawSystemConfig(_sqliteFile?: string) {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
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
            modelId: 'unselected-openai',
            displayName: 'Unused model',
            contextWindowTokens: 128_000,
            temperature: 0.9,
            timeoutMs: 30_000,
            fallbackEligible: false,
          },
          {
            modelId: 'selected-openai',
            displayName: 'MiniMax-M2.7',
            contextWindowTokens: 128_000,
            temperature: 0.1,
            maxOutputTokens: 128,
            providerOptions: { parallelToolCalls: false },
            timeoutMs: 45_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    rag: { indexes: ['local'] },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function rawAgentDefinition() {
  return {
    agentId: 'default-agent',
    agentVersion: 'v1',
    displayName: 'Telecom agent',
    description: 'Configuration test agent.',
    workspaceDir: 'default-agent',
    modelIds: ['selected-openai'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 1_800_000,
    },
    resources: [],
  };
}

function createAgentDefinition(overrides: Partial<AgentDefinition> & { defaultModelId?: string } = {}): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    displayName: 'Telecom agent',
    description: 'Configuration test agent.',
    workspaceDir: 'default-agent',
    modelIds: ['unselected-openai', 'selected-openai'],
    capabilityBindings: overrides.capabilityBindings ?? [
      { capabilityId: brand<string, 'CapabilityId'>('Read'), capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true },
    ],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 1_800_000,
    },
    resources: overrides.resources ?? [],
    ...overrides,
  };
}

function createInventory(_systemConfig: DefaultSystemConfig) {
  const providers = startupResourceProviderRegistry();
  return {
    capabilityProviders: providers.capabilityProviders,
    lifecycleHookDefinitions: [],
  };
}

function startupResourceProviderRegistry() {
  return createStartupResourceProviderRegistry([
    builtinToolsProvider,
    builtinSkillsProvider,
    builtinAgentsProvider,
    localAgentsProvider,
    localSubagentsProvider,
    localSkillsSystemProvider,
    localSkillsAgentOwnedProvider,
    memoryToolsProvider,
  ]);
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function repeatedReadToolModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: '', finishReason: 'tool-calls', toolCalls: [] };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield {
        content: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: `tool-${captured.length}`, toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
      };
    }),
  };
}

function scriptedBashModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'alarm diagnosis complete' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-bash-1',
              toolName: 'Bash',
              arguments: { command: 'cat logs/alarm.txt', description: 'Read active alarm log', timeout: 30_000 },
            },
          ],
        };
        return;
      }
      yield { content: 'alarm diagnosis complete', finishReason: 'stop' };
    }),
  };
}

function scriptedClipcBashModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'CLIP health check complete' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-clipc-1',
              toolName: 'Bash',
              arguments: {
                command: 'clipc query getHealth /api/health',
                description: 'Check CLIP health',
              },
            },
          ],
        };
        return;
      }
      yield { content: 'CLIP health check complete', finishReason: 'stop' };
    }),
  };
}

function scriptedClipToolModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'CLIP stream complete' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-clip-stream-1',
              toolName: 'alarm-check',
              arguments: {},
            },
          ],
        };
        return;
      }
      yield { content: 'CLIP stream complete', finishReason: 'stop' };
    }),
  };
}

function scriptedSkillModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'skillhub flow complete' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-skillhub-1',
              toolName: 'Skill',
              arguments: { name: 'skillhub-flow' },
            },
          ],
        };
        return;
      }
      yield { content: 'skillhub flow complete', finishReason: 'stop' };
    }),
  };
}

function fakeSkillHubGatewayFactory(packages: Record<string, Uint8Array>): SkillHubAccessFactory & { searches: unknown[]; downloads: unknown[] } {
  const searches: unknown[] = [];
  const downloads: unknown[] = [];
  const factory: SkillHubAccessFactory = () => ({
    async listCandidates(input) {
      searches.push(input);
      return {
        status: 'ok',
        candidates: [
          {
            skillId: 'skillhub-flow',
            contentRef: 'pkg:skillhub-flow',
            contentVersion: '1.0.0',
            contentHash: 'skillhub-flow-hash',
            agentId,
            agentVersion,
            agentAssemblyRef: 'default-agent:v1',
          },
        ],
      };
    },
    async fetchContent(input) {
      downloads.push(input);
      const packageBytes = packages[input.contentRef];
      if (packageBytes === undefined) {
        return { status: 'failed', reasonCode: 'download-failed', message: 'Package is unavailable.' };
      }
      const stagedFolder = await materializeZipToStagedFolder(input.stagingRoot, input.contentRef, packageBytes);
      return { status: 'ok', stagingRoot: input.stagingRoot, stagedFolder };
    },
  });
  return Object.assign(factory, {
    searches,
    downloads,
  });
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

function hangingSkillHubGatewayFactory(): SkillHubAccessFactory {
  return () => ({
    async listCandidates(_input, signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { status: 'failed', reasonCode: 'timeout', message: 'SkillHub synchronization timed out safely.' };
    },
    async fetchContent() {
      return { status: 'failed', reasonCode: 'download-failed', message: 'Package unavailable.' };
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function materializeZipToStagedFolder(stagingRoot: string, contentRef: string, packageBytes: Uint8Array): Promise<string> {
  const entries = extractZipEntries(packageBytes);
  const stagedFolder = join(stagingRoot, contentRef.replace(/[^A-Za-z0-9._-]/gu, '_'));
  await rm(stagedFolder, { recursive: true, force: true });
  await mkdir(stagedFolder, { recursive: true });
  for (const entry of entries) {
    const target = resolve(stagedFolder, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.content, 'utf8');
  }
  return stagedFolder;
}

function extractZipEntries(bytes: Uint8Array): ReadonlyArray<{ readonly path: string; readonly content: string }> {
  const buffer = Buffer.from(bytes);
  const entries: Array<{ readonly path: string; readonly content: string }> = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    entries.push({
      path: buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      content: buffer.subarray(dataStart, dataEnd).toString('utf8'),
    });
    offset = dataEnd;
  }
  return entries;
}

function zipPackage(entries: ReadonlyArray<{ readonly path: string; readonly content: string }>): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, content);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(content.length, 20);
    header.writeUInt32LE(content.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + content.length;
  }
  const centralOffset = offset;
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, centralBytes, end]);
}

function validSkillHubSkill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Test network SkillHub Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n${body}`;
}

function captureObservationLogger(entries: Array<{ readonly entry: StructuredLogEntry; readonly message: string }>): RuntimeLogger {
  const capture =
    (level: RuntimeLogLevel) =>
    (fields: object): void => {
      const entry = { ...fields, level } as StructuredLogEntry;
      entries.push({ entry, message: entry.event });
    };
  return {
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
  };
}
