import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@nextagent/agent-common';
import {
  HOST_EXTERNAL_INVENTORY,
  LATEST_PLUGIN_API_VERSION,
  OPEN_POLICY_INVENTORY,
  ROOT_PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_API_VERSIONS,
  defineAgentRoutingPolicy,
  definePlugin,
  definePluginFactory,
  defineTool,
  defineToolProvider,
  getPluginMetadata,
  type DeveloperDiagnosticArtifactSink,
} from '../src/index.js';
import { createDeveloperHookTracePlugin, createDeveloperHookTracePluginArtifact, developerHookTraceHookId } from '../src/developer-hook-trace.js';

describe('agent-plugin-sdk', () => {
  it('defines Tool providers without registering or activating them', async () => {
    const tool = defineTool({
      name: 'parse-alarm-log' as never,
      description: 'Parses a telecom alarm log.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      requiredDependencies: ['sandbox'],
      async execute(input) {
        return { parsed: input };
      },
    });
    const provider = defineToolProvider({
      providerId: 'telecom-diagnostics.alarm-tools',
      description: 'Telecom alarm Tool provider.',
      tools: [tool],
    });

    expect(provider.identity).toEqual({
      providerId: 'telecom-diagnostics.alarm-tools',
      providerKind: 'CUSTOM',
      providerType: 'nextagent-plugin-tool',
    });
    await expect(provider.discovery.listAll?.(AbortSignal.timeout(100))).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'parse-alarm-log', kind: 'TOOL', displayName: 'parse-alarm-log' }),
    ]);
  });

  it('projects optional stable and localized Plugin Tool names without changing identity or API version', async () => {
    const locales = {
      language: {
        'zh-CN': { displayName: '解析告警日志' },
        'en-US': { displayName: 'Parse alarm log' },
      },
    };
    const tool = defineTool({
      name: 'parse-alarm-log' as never,
      displayName: 'Parse alarm log',
      locales,
      description: 'Parses a telecom alarm log.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      async execute(input: JsonObject) {
        return { parsed: input };
      },
    } as never);
    const provider = defineToolProvider({ providerId: 'telecom-diagnostics.alarm-tools', tools: [tool] });
    const plugin = definePlugin({ pluginId: 'telecom-diagnostics', version: '1.0.0', providers: [provider] });

    await expect(provider.discovery.listAll?.(AbortSignal.timeout(100))).resolves.toEqual([
      expect.objectContaining({
        capabilityId: 'parse-alarm-log',
        displayName: 'Parse alarm log',
        locales,
      }),
    ]);
    expect(plugin.apiVersion).toBe('1.0');
  });

  it.each([
    { displayName: '   ' },
    { displayName: 'bad\u0000name' },
    { displayName: 'Parse alarm log', locales: null },
    { displayName: 'Parse alarm log', locales: { language: {} } },
  ])('rejects invalid Plugin Tool presentation metadata at provider assembly: %j', (presentation) => {
    const tool = defineTool({
      name: 'parse-alarm-log' as never,
      ...presentation,
      description: 'Parses a telecom alarm log.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      async execute(input: JsonObject) {
        return { parsed: input };
      },
    } as never);

    expect(() => defineToolProvider({ providerId: 'telecom-diagnostics.alarm-tools', tools: [tool] })).toThrow(/displayName|locales/u);
  });

  it('exposes versioned inventories and preserves the API 1.0 root default', () => {
    const policy = defineAgentRoutingPolicy({
      policyPointId: 'agentRoutingPolicy',
      policyId: 'route-alarms',
      decide() {
        return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'test' };
      },
    });
    const plugin = definePlugin({
      pluginId: 'telecom-diagnostics',
      version: '1.0.0',
      providers: [],
      policies: [policy],
      hooks: [],
    });

    expect(LATEST_PLUGIN_API_VERSION).toBe('1.2');
    expect(ROOT_PLUGIN_API_VERSION).toBe('1.0');
    expect(SUPPORTED_PLUGIN_API_VERSIONS).toEqual(['1.0', '1.1', '1.2']);
    expect(plugin.apiVersion).toBe('1.0');
    expect(HOST_EXTERNAL_INVENTORY.map((entry) => entry.id)).toEqual(['typebox', 'ajv']);
    expect(OPEN_POLICY_INVENTORY).toHaveLength(5);
    expect(getPluginMetadata(plugin)).toMatchObject({
      apiVersion: '1.0',
      pluginId: 'telecom-diagnostics',
      policyIds: ['route-alarms'],
    });
    expect(typeof definePluginFactory(() => plugin)).toBe('function');
  });

  it('rejects reserved policy helper usage', () => {
    expect(() =>
      defineAgentRoutingPolicy({
        policyPointId: 'restrictedOperationPolicy' as never,
        policyId: 'risk',
        decide() {
          return { kind: 'REJECT', safeReason: 'reserved' };
        },
      }),
    ).toThrow('Only agentRoutingPolicy');
  });

  it('submits exactly one structured artifact per supported developer trace stage', async () => {
    const emit = vi.fn(async () => ({ status: 'ACCEPTED' as const }));
    const plugin = createDeveloperHookTracePlugin({ developerDiagnostics: { emit } });
    const hook = plugin.hooks?.[0]!;

    expect(plugin.apiVersion).toBe('1.1');
    expect(hook).toMatchObject({
      hookId: developerHookTraceHookId,
      effects: ['OBSERVE'],
      failureMode: 'CONTINUE',
    });
    await expect(
      hook.execute({
        hookId: developerHookTraceHookId,
        sessionId: 'session-dev' as never,
        requestId: 'request-dev' as never,
        requestRunId: 'run-dev' as never,
        agentId: 'agent-dev' as never,
        agentVersion: 'v1' as never,
        agentAssemblyRef: 'agent-dev:v1',
        hookInvocationId: 'hook-1',
        stage: 'BEFORE_MODEL_INVOKE',
        boundary: {
          stepId: 'turn-1',
          modelId: 'default-openai',
          toolCount: 1,
          safeModelRequestSummary: 'messages=1,tools=1',
          messages: [{ role: 'USER', content: [{ type: 'text', text: 'raw input' }] }],
          tools: [{ capabilityId: 'Read', name: 'Read', inputSchema: {} }],
          providerOptions: {},
        },
      }),
    ).resolves.toEqual({ outcome: 'PASS' });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({
      artifactType: 'developer-hook-trace',
      sessionId: 'session-dev',
      requestId: 'request-dev',
      runId: 'run-dev',
      agentId: 'agent-dev',
      agentVersion: 'v1',
      agentAssemblyRef: 'agent-dev:v1',
      hookInvocationId: 'hook-1',
      payload: expect.objectContaining({
        event: 'DEVELOPER_HOOK_TRACE',
        stage: 'BEFORE_MODEL_INVOKE',
        stepId: 'turn-1',
        modelId: 'default-openai',
        boundary: expect.objectContaining({ messages: [{ role: 'USER', content: [{ type: 'text', text: 'raw input' }] }] }),
      }),
    });
  });

  it('keeps disabled and failed diagnostic submission observe-only', async () => {
    const disabledEmit = vi.fn(async () => ({ status: 'ACCEPTED' as const }));
    const disabled = createDeveloperHookTracePlugin({
      enabled: false,
      developerDiagnostics: { emit: disabledEmit },
    });
    const failing = createDeveloperHookTracePlugin({
      developerDiagnostics: {
        async emit() {
          throw new Error('diagnostic unavailable');
        },
      },
    });
    const input = {
      hookId: developerHookTraceHookId,
      agentId: 'agent-dev' as never,
      agentVersion: 'v1' as never,
      stage: 'AFTER_MODEL_RESULT' as const,
      boundary: {
        stepId: 'turn-1',
        modelId: 'default-openai',
        toolCallCount: 0,
        safeAssistantOutputSummary: 'visible-text chars=2 toolCalls=0',
        content: 'ok',
      },
    };

    await expect(disabled.hooks?.[0]?.execute(input)).resolves.toEqual({ outcome: 'PASS' });
    await expect(failing.hooks?.[0]?.execute(input)).resolves.toEqual({ outcome: 'PASS' });
    expect(disabledEmit).not.toHaveBeenCalled();
  });

  it('creates an API 1.1 factory artifact with no direct runtime file output', async () => {
    const targetDirectory = join(mkdtempSync(join(tmpdir(), 'nextagent-trace-artifact-')), 'plugin');
    expect(createDeveloperHookTracePluginArtifact({ targetDirectory })).toEqual({
      pluginId: 'developer-hook-trace',
      files: ['plugin.json', 'index.js'],
    });
    expect(JSON.parse(readFileSync(join(targetDirectory, 'plugin.json'), 'utf8'))).toEqual({
      pluginId: 'developer-hook-trace',
      version: '1.0.0',
      apiVersion: '1.1',
      main: './index.js',
      artifactType: 'esm-bundle',
      hostExternals: [],
    });
    const source = readFileSync(join(targetDirectory, 'index.js'), 'utf8');
    expect(source).not.toContain('getBuiltinModule');
    expect(source).not.toContain('logDirectory');
    expect(source).not.toContain('logFile');

    const emit = vi.fn(async () => ({ status: 'ACCEPTED' as const }));
    const mod = (await import(`${pathToFileURL(join(targetDirectory, 'index.js')).href}?t=${Date.now()}`)) as {
      readonly default: (host: {
        readonly developerDiagnostics: DeveloperDiagnosticArtifactSink;
      }) => ReturnType<typeof createDeveloperHookTracePlugin>;
    };
    const plugin = mod.default({ developerDiagnostics: { emit }, externals: {} } as never);
    await plugin.hooks?.[0]?.execute({
      hookId: developerHookTraceHookId,
      agentId: 'agent-dev' as never,
      agentVersion: 'v1' as never,
      stage: 'BEFORE_AGENT_TERMINAL',
      boundary: { safeTerminalSummary: 'done', finalContent: 'raw answer', toolCalls: [] },
    });
    expect(emit).toHaveBeenCalledOnce();
    expect(() => createDeveloperHookTracePluginArtifact({ targetDirectory })).toThrow('artifact file already exists');
  });
});
