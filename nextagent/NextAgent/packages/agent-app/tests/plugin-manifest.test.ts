import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_PLUGIN_API_VERSION, ROOT_PLUGIN_API_VERSION } from '@nextagent/agent-plugin-sdk';
import { loadPluginRegistrySnapshot } from '../src/plugin/plugin-loader.js';
import { createPluginFixture, minimalPluginSource } from './plugin-test-helpers.js';

describe('plugin manifest', () => {
  it('loads a valid flat esm bundle artifact', async () => {
    const fixture = createPluginFixture();

    const snapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
    expect(snapshot.providers).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it('keeps omitted versions on root compatibility and requires an explicit factory manifest for API 1.1', async () => {
    const omitted = createPluginFixture({ source: minimalPluginSource('telecom', ROOT_PLUGIN_API_VERSION) });
    await expect(loadPluginRegistrySnapshot([omitted.entry], omitted.root)).resolves.toMatchObject({
      plugins: [{ pluginId: 'telecom', version: '1.0.0' }],
      diagnostics: [],
    });

    const explicit = createPluginFixture({
      manifest: { apiVersion: '1.1' },
      source: `export default () => ({ apiVersion: "1.1", pluginId: "telecom", version: "1.0.0", providers: [] });`,
    });
    await expect(loadPluginRegistrySnapshot([explicit.entry], explicit.root)).resolves.toMatchObject({
      plugins: [{ pluginId: 'telecom', version: '1.0.0' }],
      diagnostics: [],
    });

    const implicitLatest = createPluginFixture({ source: minimalPluginSource('telecom', LATEST_PLUGIN_API_VERSION) });
    await expect(loadPluginRegistrySnapshot([{ ...implicitLatest.entry, required: false }], implicitLatest.root)).resolves.toMatchObject({
      plugins: [],
      diagnostics: [{ reasonCode: 'PLUGIN_FACTORY_REQUIRED' }],
    });
  });

  it('rejects unsupported plugin API versions', async () => {
    const unsupported = createPluginFixture({ manifest: { apiVersion: '2.0' } });

    await expect(loadPluginRegistrySnapshot([unsupported.entry], unsupported.root)).rejects.toThrow('Required plugin failed');
    await expect(loadPluginRegistrySnapshot([{ ...unsupported.entry, required: false }], unsupported.root)).resolves.toMatchObject({
      plugins: [],
      diagnostics: [{ reasonCode: 'PLUGIN_API_VERSION_UNSUPPORTED' }],
    });
  });

  it('rejects unsupported plugin export API versions', async () => {
    const unsupported = createPluginFixture({
      source: minimalPluginSource('telecom', '2.0'),
    });
    await expect(loadPluginRegistrySnapshot([unsupported.entry], unsupported.root)).rejects.toThrow('Required plugin failed');

    const explicitManifestWithUnsupportedExport = createPluginFixture({
      manifest: { apiVersion: '1.0' },
      source: minimalPluginSource('telecom', '2.0'),
    });
    await expect(
      loadPluginRegistrySnapshot([{ ...explicitManifestWithUnsupportedExport.entry, required: false }], explicitManifestWithUnsupportedExport.root),
    ).resolves.toMatchObject({
      plugins: [],
      diagnostics: [{ reasonCode: 'PLUGIN_API_VERSION_UNSUPPORTED' }],
    });
  });

  it('rejects main paths outside the plugin directory, non-js mains, and missing esm-bundle artifact type', async () => {
    const outside = createPluginFixture({ manifest: { main: '../outside.js' } });
    writeFileSync(join(outside.root, 'plugins', 'outside.js'), minimalPluginSource(), 'utf8');
    await expect(loadPluginRegistrySnapshot([outside.entry], outside.root)).rejects.toThrow('Required plugin failed');

    const nonJs = createPluginFixture({ manifest: { main: './index.mjs' }, fileName: 'index.mjs' });
    await expect(loadPluginRegistrySnapshot([nonJs.entry], nonJs.root)).rejects.toThrow('Required plugin failed');

    const missingArtifactType = createPluginFixture({ manifest: { artifactType: undefined } });
    writeFileSync(
      join(missingArtifactType.pluginDir, 'plugin.json'),
      JSON.stringify({
        pluginId: 'telecom',
        version: '1.0.0',
        main: './index.js',
      }),
      'utf8',
    );
    await expect(loadPluginRegistrySnapshot([missingArtifactType.entry], missingArtifactType.root)).rejects.toThrow('Required plugin failed');
  });

  it('rejects residual relative chunk imports before bundle evaluation', async () => {
    const fixture = createPluginFixture({
      source: `import "./chunk.js"; ${minimalPluginSource()}`,
    });

    await expect(loadPluginRegistrySnapshot([fixture.entry], fixture.root)).rejects.toThrow('Required plugin failed');
  });
});
