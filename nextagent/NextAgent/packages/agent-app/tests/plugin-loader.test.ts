import { describe, expect, it } from 'vitest';
import { loadPluginRegistrySnapshot } from '../src/plugin/plugin-loader.js';
import { createPluginFixture, minimalPluginSource, pluginWithPolicySource, pluginWithProvidersSource } from './plugin-test-helpers.js';

describe('plugin loader', () => {
  it('loads a declared local plugin directory into a frozen registry snapshot', async () => {
    const fixture = createPluginFixture({
      source: pluginWithProvidersSource('telecom', ['telecom.tools']),
    });

    const snapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
    expect(snapshot.providers.map((provider) => provider.identity.providerId)).toEqual(['telecom.tools']);
    expect(Object.isFrozen(snapshot.plugins)).toBe(true);
    expect(Object.isFrozen(snapshot.providers)).toBe(true);
  });

  it('materializes esbuild-style default export lists synchronously', async () => {
    const fixture = createPluginFixture({
      source: `
        var plugin = { pluginId: "telecom", version: "1.0.0", providers: [] };
        export { plugin as default };
      `,
    });

    const snapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it('rejects plugin id mismatch, invalid export shape, and duplicate plugin ids', async () => {
    const idMismatch = createPluginFixture({ manifest: { pluginId: 'different' } });
    await expect(loadPluginRegistrySnapshot([idMismatch.entry], idMismatch.root)).rejects.toThrow('Required plugin failed');

    const invalidExport = createPluginFixture({ source: `export default "not-a-plugin";` });
    await expect(loadPluginRegistrySnapshot([invalidExport.entry], invalidExport.root)).rejects.toThrow('Required plugin failed');

    const unsupportedExport = createPluginFixture({ source: `export const plugin = { pluginId: "telecom", version: "1.0.0", providers: [] };` });
    await expect(loadPluginRegistrySnapshot([unsupportedExport.entry], unsupportedExport.root)).rejects.toThrow('Required plugin failed');

    const duplicate = createPluginFixture();
    await expect(loadPluginRegistrySnapshot([duplicate.entry, duplicate.entry], duplicate.root)).rejects.toThrow('Required plugin failed');
  });

  it('enforces provider identity, uniqueness, reserved ids, and per-plugin provider limit', async () => {
    const four = createPluginFixture({
      source: pluginWithProvidersSource('telecom', ['telecom.a', 'telecom.b', 'telecom.c', 'telecom.d']),
    });
    await expect(loadPluginRegistrySnapshot([four.entry], four.root)).resolves.toMatchObject({ diagnostics: [] });

    const five = createPluginFixture({
      source: pluginWithProvidersSource('telecom', ['telecom.a', 'telecom.b', 'telecom.c', 'telecom.d', 'telecom.e']),
    });
    await expect(loadPluginRegistrySnapshot([five.entry], five.root)).rejects.toThrow('Required plugin failed');

    const duplicateProvider = createPluginFixture({
      source: pluginWithProvidersSource('telecom', ['telecom.tools', 'telecom.tools']),
    });
    await expect(loadPluginRegistrySnapshot([duplicateProvider.entry], duplicateProvider.root)).rejects.toThrow('Required plugin failed');

    const reservedProvider = createPluginFixture({
      source: pluginWithProvidersSource('telecom', ['memory-tools']),
    });
    await expect(loadPluginRegistrySnapshot([reservedProvider.entry], reservedProvider.root)).rejects.toThrow('Required plugin failed');
  });

  it('rejects duplicate policy and hook identities', async () => {
    const duplicatePolicy = createPluginFixture({
      source: `export default {
        pluginId: "telecom",
        version: "1.0.0",
        policies: [
          { policyPointId: "agentRoutingPolicy", policyId: "route", decide() { return { kind: "MODEL_DRIVEN_LOOP", safeReason: "test" }; } },
          { policyPointId: "agentRoutingPolicy", policyId: "route", decide() { return { kind: "MODEL_DRIVEN_LOOP", safeReason: "test" }; } }
        ]
      };`,
    });
    await expect(loadPluginRegistrySnapshot([duplicatePolicy.entry], duplicatePolicy.root)).rejects.toThrow('Required plugin failed');

    const duplicateHook = createPluginFixture({
      source: `export default {
        pluginId: "telecom",
        version: "1.0.0",
        hooks: [
          { hookId: "output-filter", kind: "CUSTOM", supportedStages: ["BEFORE_AGENT_TERMINAL"], effects: ["OUTPUT_FILTER"], failureMode: "FAIL_CLOSED", execute() { return { outcome: "PASS" }; } },
          { hookId: "output-filter", kind: "CUSTOM", supportedStages: ["BEFORE_AGENT_TERMINAL"], effects: ["OUTPUT_FILTER"], failureMode: "FAIL_CLOSED", execute() { return { outcome: "PASS" }; } }
        ]
      };`,
    });
    await expect(loadPluginRegistrySnapshot([duplicateHook.entry], duplicateHook.root)).rejects.toThrow('Required plugin failed');
  });

  it('keeps optional plugin failures out of the registry with safe diagnostics', async () => {
    const fixture = createPluginFixture({
      source: pluginWithPolicySource('telecom', 'redactionPolicy'),
    });

    const snapshot = await loadPluginRegistrySnapshot([{ ...fixture.entry, required: false }], fixture.root);

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.policies).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({
      severity: 'ERROR',
      reasonCode: 'PLUGIN_POLICY_CLOSED',
      pluginId: 'telecom',
    });
    expect(JSON.stringify(snapshot.diagnostics)).not.toContain(fixture.root);
    expect(JSON.stringify(snapshot.diagnostics)).not.toContain('redactionPolicy');
  });

  it('does not scan undeclared plugin directories', async () => {
    const fixture = createPluginFixture({
      source: `throw new Error("undeclared plugin should not be evaluated"); ${minimalPluginSource()}`,
    });

    const snapshot = await loadPluginRegistrySnapshot([], fixture.root);

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });
});
