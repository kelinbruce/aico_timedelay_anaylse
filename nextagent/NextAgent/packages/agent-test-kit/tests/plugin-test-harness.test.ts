import { describe, expect, it } from 'vitest';
import { defineAgentRoutingPolicy, defineLifecycleHook, definePlugin, defineTool, defineToolProvider } from '@nextagent/agent-plugin-sdk';
import { createPluginTestHarness } from '../src/index.js';

describe('createPluginTestHarness', () => {
  it('invokes Tool, routing policy and hook logic from an imported plugin object', async () => {
    const tool = defineTool({
      name: 'echo' as never,
      description: 'Echo',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      requiredDependencies: ['workspaceFiles'],
      async execute(input, options) {
        return { echo: input.value ?? 'missing', hasWorkspaceFiles: options?.deps?.workspaceFiles !== undefined };
      },
    });
    const plugin = definePlugin({
      pluginId: 'telecom',
      version: '1.0.0',
      providers: [defineToolProvider({ providerId: 'telecom.tools', tools: [tool] })],
      policies: [
        defineAgentRoutingPolicy({
          policyPointId: 'agentRoutingPolicy',
          policyId: 'route',
          decide() {
            return { kind: 'REJECT', safeReason: 'PLUGIN_TEST' };
          },
        }),
      ],
      hooks: [
        defineLifecycleHook({
          hookId: 'telecom.before-terminal',
          kind: 'CUSTOM',
          supportedStages: ['BEFORE_AGENT_TERMINAL'],
          effects: ['OBSERVE'],
          failureMode: 'CONTINUE',
          order: { priority: 10 },
          async execute(input) {
            return { outcome: input.stage === 'BEFORE_AGENT_TERMINAL' ? 'PASS' : 'SKIP' };
          },
        }),
      ],
    });

    const harness = createPluginTestHarness(plugin, { toolDependencies: { workspaceFiles: { read: 'test-double' } } });

    await expect(harness.invokeTool('telecom.tools', 'echo', { value: 'ok' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { echo: 'ok', hasWorkspaceFiles: true },
    });
    await expect(harness.evaluateAgentRoutingPolicy('route', {} as never, {} as never)).resolves.toEqual({
      kind: 'REJECT',
      safeReason: 'PLUGIN_TEST',
    });
    await expect(
      harness.executeHook('telecom.before-terminal', {
        hookId: 'telecom.before-terminal',
        agentId: 'agent' as never,
        agentVersion: '1.0.0' as never,
        stage: 'BEFORE_AGENT_TERMINAL',
        boundary: { finalContent: 'done', toolCalls: [], safeTerminalSummary: 'done' },
      }),
    ).resolves.toEqual({ outcome: 'PASS' });
  });

  it('fails closed for provider mismatch', async () => {
    const harness = createPluginTestHarness(definePlugin({ pluginId: 'empty', version: '1.0.0' }));

    await expect(harness.invokeTool('missing', 'echo', {})).rejects.toMatchObject({ code: 'PLUGIN_PROVIDER_UNAVAILABLE' });
  });

  it('fails closed for Tool id mismatch and missing required dependencies', async () => {
    const tool = defineTool({
      name: 'needs-workspace' as never,
      description: 'Needs workspace files',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      requiredDependencies: ['workspaceFiles'],
      async execute() {
        return { ok: true };
      },
    });
    const harness = createPluginTestHarness(
      definePlugin({
        pluginId: 'telecom',
        version: '1.0.0',
        providers: [defineToolProvider({ providerId: 'telecom.tools', tools: [tool] })],
      }),
    );

    await expect(harness.invokeTool('telecom.tools', 'missing-tool', {})).rejects.toMatchObject({ code: 'PLUGIN_TOOL_UNAVAILABLE' });
    await expect(harness.invokeTool('telecom.tools', 'needs-workspace', {})).rejects.toMatchObject({
      code: 'PLUGIN_TOOL_DEPENDENCY_MISSING',
      safeDetails: { dependency: 'workspaceFiles' },
    });
  });

  it('does not perform app loader, manifest, dynamic import, host external, registry, or assembly work', async () => {
    const plugin = definePlugin({ pluginId: 'telecom', version: '1.0.0' });
    const harness = createPluginTestHarness(plugin);

    expect(harness).not.toHaveProperty('pluginRegistrySnapshot');
    expect(harness).not.toHaveProperty('agentAssembly');
    expect(harness).not.toHaveProperty('createComposedApp');
    await expect(harness.evaluateAgentRoutingPolicy('missing', {} as never, {} as never)).rejects.toMatchObject({
      code: 'PLUGIN_POLICY_UNAVAILABLE',
    });
    await expect(harness.executeHook('missing', {} as never)).rejects.toMatchObject({ code: 'PLUGIN_HOOK_UNAVAILABLE' });
  });
});
