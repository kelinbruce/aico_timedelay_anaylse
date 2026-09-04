import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  builtinAgentPromptTemplateRegistrations,
  createAgentDiscoveryAssemblies,
  createAppCredentialResolver,
  createComposedApp,
  createNextAgentTestApp,
  createStartupAgentAssemblyCompiler,
  createStartupResourceProviderRegistry,
  loadBuiltInDefaultAgentDefinition,
  parseAgentDefinitionForTesting,
  validateDefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import {
  builtinAgentsProvider,
  builtinSkillsProvider,
  builtinToolsProvider,
  localAgentsProvider,
  localSkillsAgentOwnedProvider,
  localSkillsSystemProvider,
  localSubagentsProvider,
} from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { memoryToolsProvider } from '@nextagent/agent-memory';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('invoked Agent discovery app-owned assembly source', () => {
  it('applies omitted model activation inheritance equally to builtin Agents', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfigWithFallbackModel(), root, { credentialResolver });
      const assemblies = createAgentDiscoveryAssemblies({
        systemConfig,
        resourceReferences: resourceInventory(),
        activeDefinition: loadBuiltInDefaultAgentDefinition(),
      });

      expect(
        assemblies.map((assembly) => ({
          agentId: assembly.agentId,
          modelIds: assembly.modelIds,
          defaultModelId: assembly.defaultModelId,
        })),
      ).toEqual([
        { agentId: 'default-agent', modelIds: ['test-model', 'fallback-model'], defaultModelId: undefined },
        { agentId: 'network-explorer', modelIds: ['test-model', 'fallback-model'], defaultModelId: undefined },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers builtin, top-level local, and parent-local subagent assemblies without reading workspaceDir subagents', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfigWithFallbackModel(), root, { credentialResolver });
      await writeAgentYaml(join(root, 'agents', 'default-agent'), 'default-agent', 'v1');
      await writeAgentYaml(join(root, 'agents', 'planner-agent'), 'planner-agent', 'v1', false);
      await writeAgentYaml(join(root, 'agents', 'default-agent', 'subagents', 'alarm-correlation'), 'alarm-correlation', 'v1', false);
      await writeAgentYaml(join(root, 'workspaces', 'default-agent', 'subagents', 'workspace-agent'), 'workspace-agent', 'v1');

      const activeDefinition = parseAgentDefinitionForTesting(agentDefinition('default-agent', 'v1'));
      const inventory = resourceInventory();
      const assemblies = createAgentDiscoveryAssemblies({
        systemConfig,
        resourceReferences: inventory,
        activeDefinition,
      });

      expect(
        assemblies.map(
          (assembly) => `${assembly.sourceKind}:${assembly.parentAgentScope === undefined ? 'top-level' : 'parent'}:${assembly.agentId}`,
        ),
      ).toEqual([
        'BUILTIN:top-level:network-explorer',
        'LOCAL:top-level:default-agent',
        'LOCAL:top-level:planner-agent',
        'LOCAL:parent:alarm-correlation',
      ]);
      expect(assemblies.find((assembly) => assembly.agentId === 'default-agent')?.modelIds).toEqual(['test-model']);
      expect(assemblies.find((assembly) => assembly.agentId === 'network-explorer')?.modelIds).toEqual(['test-model', 'fallback-model']);
      expect(assemblies.find((assembly) => assembly.agentId === 'planner-agent')?.modelIds).toEqual(['test-model', 'fallback-model']);
      expect(assemblies.find((assembly) => assembly.agentId === 'alarm-correlation')?.modelIds).toEqual(['test-model', 'fallback-model']);
      expect(assemblies.find((assembly) => assembly.agentId === 'network-explorer')).toMatchObject({
        agentType: 'default',
        description: expect.stringContaining('telecom network evidence collection'),
        userInvocable: false,
        agentInvocation: 'BOUND',
        sourceKind: 'BUILTIN',
        capabilityBindings: [
          { capabilityId: 'Write', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
          { capabilityId: 'Bash', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
          { capabilityId: 'Python', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
          { capabilityId: 'Skill', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
          { capabilityId: 'AskUserQuestion', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
        ],
      });
      expect(assemblies.find((assembly) => assembly.agentId === 'network-explorer')?.capabilityBindings).not.toContainEqual(
        expect.objectContaining({ capabilityId: 'Read', enabled: true }),
      );
      expect(assemblies.find((assembly) => assembly.agentId === 'network-explorer')?.capabilityBindings).not.toContainEqual(
        expect.objectContaining({ capabilityId: 'Glob', enabled: true }),
      );
      expect(assemblies.find((assembly) => assembly.agentId === 'network-explorer')?.capabilityBindings).not.toContainEqual(
        expect.objectContaining({ capabilityId: 'AskUserQuestion', enabled: true }),
      );
      expect(assemblies.find((assembly) => assembly.agentId === 'network-explorer')?.description).not.toContain('codebase');
      expect(assemblies.find((assembly) => assembly.agentId === 'alarm-correlation')).toMatchObject({
        sourceKind: 'LOCAL',
        parentAgentScope: { agentId: 'default-agent', agentVersion: 'v1', agentAssemblyRef: 'default-agent:v1' },
        userInvocable: false,
        agentInvocation: 'PARENT',
      });
      expect(builtinAgentPromptTemplateRegistrations(assemblies)).toEqual([
        {
          agentId: 'network-explorer',
          agentVersion: 'v1',
          path: expect.stringContaining('network-explorer'),
        },
      ]);
      expect(JSON.stringify(assemblies)).not.toContain('workspace-agent');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not publish invalid local subagent definitions', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      await writeAgentYaml(join(root, 'agents', 'default-agent'), 'default-agent', 'v1');
      await mkdir(join(root, 'agents', 'default-agent', 'subagents', 'missing-definition'), { recursive: true });
      await writeAgentYaml(join(root, 'agents', 'default-agent', 'subagents', 'bad-definition'), '', 'v1');

      const activeDefinition = parseAgentDefinitionForTesting(agentDefinition('default-agent', 'v1'));
      const inventory = resourceInventory();
      const assemblies = createAgentDiscoveryAssemblies({
        systemConfig,
        resourceReferences: inventory,
        activeDefinition,
      });

      expect(assemblies.map((assembly) => String(assembly.agentId))).toEqual(['network-explorer', 'default-agent']);
      expect(JSON.stringify(assemblies)).not.toContain(root);
      expect(JSON.stringify(assemblies)).not.toContain('danger prompt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate Agent identities across builtin and local sources', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      await writeAgentYaml(join(root, 'agents', 'default-agent'), 'default-agent', 'v1');
      await writeAgentYaml(join(root, 'agents', 'network-explorer'), 'network-explorer', 'v1');

      const activeDefinition = parseAgentDefinitionForTesting(agentDefinition('default-agent', 'v1'));
      const inventory = resourceInventory();

      expect(() =>
        createAgentDiscoveryAssemblies({
          systemConfig,
          resourceReferences: inventory,
          activeDefinition,
        }),
      ).toThrow('Agent assembly identity must be globally unique.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('wires local Agent discovery through production app composition', async () => {
    const root = await makeRoot();
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const captured: ModelInvocationRequest[] = [];
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      await writeAgentYaml(join(root, 'agents', 'default-agent'), 'default-agent', 'v1');
      await writeAgentYaml(join(root, 'agents', 'default-agent', 'subagents', 'alarm-correlation'), 'alarm-correlation', 'v1');
      app = createComposedApp(
        {
          systemConfig,
          credentialResolver,
          agentDefinition: parseAgentDefinitionForTesting(agentDefinition('default-agent', 'v1')),
        },
        captureModel(captured),
      );

      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'diagnose alarm', idempotencyKey: 'idem-invoked-agent-discovery' },
      });
      expect(accepted.statusCode).toBe(200);
      const acceptedBody = accepted.json<{ runId: string }>();
      await waitForRunTerminal(app.gateway, acceptedBody.runId);

      expect(JSON.stringify(captured)).toContain('alarm-correlation');
      expect(JSON.stringify(captured)).toContain('### Available agents');
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('wires builtin default Agent to builtin network-explorer through configuration', async () => {
    const root = await makeRoot();
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      const captured: ModelInvocationRequest[] = [];
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      app = createComposedApp(
        {
          systemConfig,
          credentialResolver,
          agentDefinition: loadBuiltInDefaultAgentDefinition(),
        },
        captureModel(captured),
      );

      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'collect evidence', idempotencyKey: 'idem-builtin-agent-subagent-binding' },
      });
      expect(accepted.statusCode).toBe(200);
      const acceptedBody = accepted.json<{ runId: string }>();
      await waitForRunTerminal(app.gateway, acceptedBody.runId);

      const prompt = JSON.stringify(captured);
      expect(prompt).toContain('### Available agents');
      expect(prompt).toContain('network-explorer');
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes builtin network-explorer through production Agent Tool composition', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-network-explorer-1',
              toolName: 'Agent',
              arguments: {
                agentId: 'network-explorer',
                prompt: 'Collect bounded LTE alarm evidence from the network explorer.',
              },
            },
          ],
        },
        { content: 'network explorer terminal evidence' },
        { content: 'parent incorporated network explorer evidence' },
      ],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'delegate network evidence collection', idempotencyKey: 'idem-network-explorer-agent-tool-product' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });

      expect(stream.body).toContain('event: REQUEST_COMPLETED');
      expect(stream.body).toContain('parent incorporated network explorer evidence');
      expect(stream.body).not.toContain('UNKNOWN_AGENT_TYPE');

      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: false,
        offset: 0,
        limit: 20,
      });
      const agentResult = messages.items.find((message) => message.role === 'CAPABILITY_RESULT' && message.content.includes('"toolName":"Agent"'));
      expect(agentResult?.content).toContain('"status":"completed"');
      expect(agentResult?.content).toContain('network explorer terminal evidence');

      const childSessions = await app.gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        agentId: brand<string, 'AgentId'>('network-explorer'),
        offset: 0,
        limit: 10,
      });
      const child = childSessions.entries.find((entry) => entry.parentRunId === body.runId);
      expect(child).toMatchObject({
        agentId: 'network-explorer',
        parentSessionId: body.sessionId,
        parentRunId: body.runId,
        parentRequestId: body.requestId,
        latestRunStatus: 'COMPLETED',
      });
      const childLane = await app.gateway.requestRuns.loadSessionLaneSnapshot({
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        agentId: brand<string, 'AgentId'>('network-explorer'),
        sessionId: child!.sessionId,
      });
      expect(childLane.latestRun).toMatchObject({
        agentId: 'network-explorer',
        parentRunId: body.runId,
        parentRequestId: body.requestId,
        status: 'COMPLETED',
        terminalCommitState: 'COMMITTED',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps network-explorer prompt guidance explicit about using Glob before Read on directories', async () => {
    const toolingPrompt = await readFile(
      join(process.cwd(), 'packages', 'agent-core', 'src', 'builtin-agents', 'network-explorer', 'prompts', 'SYSTEM_PROMPT', 'tooling.md'),
      'utf8',
    );

    expect(toolingPrompt).toContain('Use Read only for concrete file paths');
    expect(toolingPrompt).toContain('never for `.`, `workspace`, or any directory path');
    expect(toolingPrompt).toContain('use Glob first to enumerate candidate files');
  });
});

describe('Agent definition invocation policy and AGENT bindings', () => {
  it('parses routing config and preserves it in the runtime-facing assembly', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      const definition = parseAgentDefinitionForTesting({
        ...agentDefinition('default-agent', 'v1'),
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition' },
        },
      });
      const output = createStartupAgentAssemblyCompiler().compile({
        systemConfig,
        agentDefinition: definition,
        resourceReferences: resourceInventory(),
      });

      expect(output.assembly.routing).toEqual({
        mode: 'policy',
        policy: { method: 'policy:intent-recognition' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('defaults invocation policy and preserves explicit AGENT enable/disable facts in runtime-facing assembly', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      const definition = parseAgentDefinitionForTesting({
        ...agentDefinition('default-agent', 'v1'),
        capabilityBindings: [
          { capabilityId: 'alarm-correlation', capabilityType: 'AGENT', providerId: 'local-agents', enabled: false },
          { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true },
        ],
      });
      const output = createStartupAgentAssemblyCompiler().compile({
        systemConfig,
        agentDefinition: definition,
        resourceReferences: resourceInventory(),
      });

      expect(output.assembly).toEqual(
        expect.objectContaining({
          userInvocable: true,
          agentInvocation: 'BOUND',
          capabilityBindings: [
            { capabilityId: 'alarm-correlation', capabilityType: 'AGENT', providerId: 'local-agents', enabled: false },
            { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true },
          ],
        }),
      );
      expect(output.assembly).not.toHaveProperty('subagents');
      expect(output.assembly).not.toHaveProperty('promptTemplateIds');
      expect(output.assembly.runtimeSettings).not.toHaveProperty('defaultPromptTemplateId');
      expect(JSON.stringify(output.assembly)).not.toContain('danger prompt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts workflow capability bindings', () => {
    const parsed = parseAgentDefinitionForTesting({
      ...agentDefinition('default-agent', 'v1'),
      capabilityBindings: [{ capabilityId: 'x', capabilityType: 'WORKFLOW', providerId: 'local-recipes' }],
    });

    expect(parsed.capabilityBindings?.[0]?.capabilityType).toBe('WORKFLOW');
  });

  it('rejects recipe as a runtime capability binding type', () => {
    expect(() =>
      parseAgentDefinitionForTesting({
        ...agentDefinition('default-agent', 'v1'),
        capabilityBindings: [{ capabilityId: 'x', capabilityType: 'RECIPE', providerId: 'local-recipes' }],
      }),
    ).toThrow('AgentDefinition.capabilityType is unsupported.');
  });

  it('continues to reject unsupported routing modes', () => {
    expect(() =>
      parseAgentDefinitionForTesting({
        ...agentDefinition('default-agent', 'v1'),
        routing: { mode: 'manual' },
      }),
    ).toThrow('AgentDefinition.mode is unsupported.');
  });
});

const credentialResolver = createAppCredentialResolver({ OPENAI_API_KEY: 'test-only' });

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nextagent-invoked-agent-config-'));
}

async function writeAgentYaml(root: string, agentId: string, version: string, includeModelIds = true): Promise<void> {
  const definition = agentDefinition(agentId, version);
  const { modelIds: _modelIds, ...definitionWithoutModelIds } = definition;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'agent.yaml'), JSON.stringify(includeModelIds ? definition : definitionWithoutModelIds), 'utf8');
}

function rawSystemConfig() {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject' },
      localAuth: { enabled: false },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [modelProviderProfile()],
    gateway: {
      gateways: [
        { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function rawSystemConfigWithFallbackModel() {
  const config = rawSystemConfig();
  return {
    ...config,
    modelProfiles: config.modelProfiles.map((providerProfile) => ({
      ...providerProfile,
      models: [
        ...providerProfile.models,
        {
          ...modelProfile(),
          modelId: 'fallback-model',
          displayName: 'Fallback model',
          fallbackEligible: true,
        },
      ],
    })),
  };
}

function agentDefinition(agentId: string, version: string) {
  return {
    agentId,
    agentType: 'default',
    agentVersion: version,
    displayName: agentId || 'bad-agent',
    description: 'Telecom parent or subagent.',
    modelIds: ['test-model'],
    capabilityBindings: [],
    runtimeSettings: {},
    resources: [{ resourceId: 'safe-resource', kind: 'WORKSPACE_FILE', path: 'safe-resource.txt' }],
  };
}

function modelProfile() {
  return {
    modelId: 'test-model',
    displayName: 'Test model',
    timeoutMs: 1000,
    contextWindowTokens: 128_000,
    fallbackEligible: false,
  };
}

function modelProviderProfile() {
  return {
    providerId: 'openai-compatible' as const,
    baseUrl: 'https://api.example.test/v1',
    credentialRef: 'env:OPENAI_API_KEY',
    models: [modelProfile()],
  };
}

function resourceInventory() {
  return {
    capabilityProviders: startupResourceProviderRegistry().capabilityProviders,
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
    async complete(request) {
      captured.push(request);
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

async function waitForRunTerminal(gateway: ReturnType<typeof createComposedApp>['gateway'], runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await gateway.requestRuns.loadRun({
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Run did not reach terminal state.');
}
