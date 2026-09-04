import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { loadPluginRegistrySnapshot } from '../../packages/agent-app/src/plugin/plugin-loader.js';
import { describeRealModelSmoke } from './system-smoke-helpers.js';

describeRealModelSmoke('plugin loader', () => {
  it('loads a declared local plugin directory into a frozen snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));
    const pluginDir = join(root, 'plugins', 'telecom');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      }),
    );
    writeFileSync(
      join(pluginDir, 'index.js'),
      `export default {
      pluginId: "telecom",
      version: "1.0.0",
      providers: [{
        identity: { providerId: "telecom.tools", providerKind: "CUSTOM", providerType: "nextagent-plugin-tool" },
        discovery: { provider: { providerId: "telecom.tools", providerKind: "CUSTOM", providerType: "nextagent-plugin-tool" }, discoveryMode: "EAGER", async listAll() { return []; } }
      }]
    };`,
    );

    const snapshot = await loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/telecom', required: true }], root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
    expect(snapshot.providers.map((provider) => provider.identity.providerId)).toEqual(['telecom.tools']);
  });

  it('rejects residual runtime imports before bundle evaluation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));
    const pluginDir = join(root, 'plugins', 'telecom');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      }),
    );
    writeFileSync(join(pluginDir, 'index.js'), `import { Type } from "@sinclair/typebox"; export default { pluginId: "telecom", version: "1.0.0" };`);

    await expect(loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/telecom', required: true }], root)).rejects.toThrow(
      'Required plugin failed',
    );
  });

  it('rejects commented dynamic imports before bundle evaluation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));
    const pluginDir = join(root, 'plugins', 'telecom');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      }),
    );
    writeFileSync(
      join(pluginDir, 'index.js'),
      `await import /* chunk split */ ("node:fs"); export default { pluginId: "telecom", version: "1.0.0" };`,
    );

    await expect(loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/telecom', required: true }], root)).rejects.toThrow(
      'Required plugin failed',
    );
  });

  it('maps optional plugin load failures to safe diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));

    const snapshot = await loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/missing', required: false }], root);

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'PLUGIN_DIRECTORY_INVALID',
        pluginId: 'telecom',
        outcome: 'rejected',
        summary: 'Plugin directory is outside config root or missing.',
      },
    ]);
    expect(JSON.stringify(snapshot.diagnostics)).not.toContain(root);
  });

  it('injects only declared host externals into plugin factories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));
    const pluginDir = join(root, 'plugins', 'telecom');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [
          { id: 'typebox', versionRange: '*' },
          { id: 'ajv', versionRange: '*' },
        ],
      }),
    );
    writeFileSync(
      join(pluginDir, 'index.js'),
      `export default (host) => {
      if (typeof host.externals.typebox.Type.Object !== "function" || typeof host.externals.ajv.Ajv !== "function") {
        throw new Error("missing host external");
      }
      return { pluginId: "telecom", version: "1.0.0", providers: [] };
    };`,
    );

    const snapshot = await loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/telecom', required: true }], root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
    expect(snapshot.providers).toEqual([]);
  });

  it('rejects incompatible host external versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));
    const pluginDir = join(root, 'plugins', 'telecom');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [{ id: 'typebox', versionRange: '^0.35.0' }],
      }),
    );
    writeFileSync(join(pluginDir, 'index.js'), `export default () => ({ pluginId: "telecom", version: "1.0.0", providers: [] });`);

    const snapshot = await loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/telecom', required: false }], root);

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'PLUGIN_HOST_EXTERNAL_VERSION_INCOMPATIBLE',
        pluginId: 'telecom',
        outcome: 'rejected',
        summary: 'Host external version is incompatible.',
      },
    ]);
  });

  it('fails closed for reserved policy points', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-'));
    const pluginDir = join(root, 'plugins', 'telecom');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      }),
    );
    writeFileSync(
      join(pluginDir, 'index.js'),
      `export default {
      pluginId: "telecom",
      version: "1.0.0",
      policies: [{ policyPointId: "modelSelectionPolicy", policyId: "choose-model", evaluate() { return { kind: "REJECT", safeReason: "test" }; } }]
    };`,
    );

    await expect(loadPluginRegistrySnapshot([{ pluginId: 'telecom', path: 'plugins/telecom', required: true }], root)).rejects.toThrow(
      'Required plugin failed',
    );
  });
});
