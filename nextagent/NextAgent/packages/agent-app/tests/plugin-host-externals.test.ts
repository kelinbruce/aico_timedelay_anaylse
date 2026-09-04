import { describe, expect, it, vi } from 'vitest';
import { HOST_EXTERNAL_INVENTORY, type PluginRuntimeServices } from '@nextagent/agent-plugin-sdk';
import { loadPluginRegistrySnapshot, loadPluginRegistrySnapshotSync } from '../src/plugin/plugin-loader.js';
import { createPluginFixture, minimalPluginSource } from './plugin-test-helpers.js';

describe('plugin host externals', () => {
  it('keeps the framework-owned host external inventory closed and explicit', () => {
    expect(HOST_EXTERNAL_INVENTORY.map((entry) => [entry.id, entry.packageName, entry.status])).toEqual([
      ['typebox', '@sinclair/typebox', 'OPEN'],
      ['ajv', 'ajv', 'OPEN'],
    ]);
  });

  it('injects only declared host externals into plugin factories', async () => {
    const fixture = createPluginFixture({
      manifest: {
        hostExternals: [
          { id: 'typebox', versionRange: '^0.34.0' },
          { id: 'ajv', versionRange: '^8.17.0' },
        ],
      },
      source: `export default (host) => {
        if (Object.keys(host).join(",") !== "externals") throw new Error("unexpected host field");
        if (!host.externals.typebox?.Type || !host.externals.ajv?.Ajv) throw new Error("missing external");
        return { pluginId: "telecom", version: "1.0.0", providers: [] };
      };`,
    });

    const snapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
  });

  it('keeps the v1.0 host shape and injects a manifest-bound developer diagnostic sink for v1.1', async () => {
    const accepted: unknown[] = [];
    const fixture = createPluginFixture({
      manifest: { apiVersion: '1.1' },
      source: `export default async (host) => {
        const accepted = await host.developerDiagnostics.emit({
          artifactType: "trace",
          payload: { state: "ok" }
        });
        const rejected = await host.developerDiagnostics.emit({
          artifactType: "trace",
          pluginId: "spoofed",
          logFile: "../escape",
          payload: {}
        });
        if (accepted.status !== "ACCEPTED" || rejected.reasonCode !== "INVALID_RECORD") {
          throw new Error("unexpected diagnostic result");
        }
        return { apiVersion: "1.1", pluginId: "telecom", version: "1.0.0", providers: [] };
      };`,
    });

    const snapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root, {
      developerDiagnosticsForPlugin(pluginId) {
        expect(pluginId).toBe('telecom');
        return {
          async emit(input) {
            accepted.push(input);
            return { status: 'ACCEPTED' };
          },
        };
      },
    });
    expect(accepted).toEqual([{ artifactType: 'trace', payload: { state: 'ok' } }]);
    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
  });

  it('keeps a non-throwing unavailable sink when an embedded host omits the writer factory', async () => {
    const fixture = createPluginFixture({
      manifest: { apiVersion: '1.1' },
      source: `export default async (host) => {
        const result = await host.developerDiagnostics.emit({ artifactType: "trace", payload: {} });
        if (result.status !== "DROPPED" || result.reasonCode !== "OUTPUT_UNAVAILABLE") {
          throw new Error("unexpected diagnostic result");
        }
        return { apiVersion: "1.1", pluginId: "telecom", version: "1.0.0", providers: [] };
      };`,
    });

    const snapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root);

    expect(snapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
  });

  it('injects a closed runtime service host for API 1.2 factories', async () => {
    const fixture = createPluginFixture({
      manifest: { apiVersion: '1.2' },
      source: `export default (host) => {
        if (Object.keys(host).join(",") !== "externals,developerDiagnostics,runtime") throw new Error("unexpected host shape");
        const expected = "agentAssemblies,capabilityCatalog,capabilityInvocation,modelSelection,modelInvocation,promptTemplates";
        if (Object.keys(host.runtime).join(",") !== expected) throw new Error("unexpected runtime shape");
        return { apiVersion: "1.2", pluginId: "telecom", version: "1.0.0", providers: [] };
      };`,
    });
    const runtime = {
      agentAssemblies: {},
      capabilityCatalog: {},
      capabilityInvocation: {},
      modelSelection: {},
      modelInvocation: {},
      promptTemplates: {},
    } as PluginRuntimeServices;

    await expect(
      loadPluginRegistrySnapshot([fixture.entry], fixture.root, {
        runtime,
        developerDiagnosticsForPlugin: vi.fn(() => ({
          emit: vi.fn(async () => ({ status: 'DROPPED' as const, reasonCode: 'OUTPUT_UNAVAILABLE' as const })),
        })),
      }),
    ).resolves.toMatchObject({ plugins: [{ pluginId: 'telecom', version: '1.0.0' }] });
  });

  it('fails closed when an API 1.2 factory has no runtime services', async () => {
    const fixture = createPluginFixture({
      manifest: { apiVersion: '1.2' },
      source: `export default () => ({ apiVersion: "1.2", pluginId: "telecom", version: "1.0.0", providers: [] });`,
    });
    const snapshot = await loadPluginRegistrySnapshot([{ ...fixture.entry, required: false }], fixture.root);
    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({ reasonCode: 'PLUGIN_RUNTIME_SERVICES_UNAVAILABLE' });
  });

  it('awaits async plugin factories only on asynchronous startup loading', async () => {
    const fixture = createPluginFixture({
      manifest: { hostExternals: [{ id: 'typebox', versionRange: '^0.34.0' }] },
      source: `export default async (host) => {
        if (!host.externals.typebox?.Type) throw new Error("missing typebox");
        return { pluginId: "telecom", version: "1.0.0", providers: [] };
      };`,
    });

    const asyncSnapshot = await loadPluginRegistrySnapshot([fixture.entry], fixture.root);
    const syncSnapshot = loadPluginRegistrySnapshotSync([{ ...fixture.entry, required: false }], fixture.root);

    expect(asyncSnapshot.plugins).toEqual([{ pluginId: 'telecom', version: '1.0.0' }]);
    expect(syncSnapshot.plugins).toEqual([]);
    expect(syncSnapshot.diagnostics[0]).toMatchObject({
      reasonCode: 'PLUGIN_FACTORY_ASYNC_UNSUPPORTED',
      pluginId: 'telecom',
      outcome: 'rejected',
    });
  });

  it('rejects host external declaration mismatches and incompatible versions', async () => {
    const plainWithExternal = createPluginFixture({
      manifest: { hostExternals: [{ id: 'typebox', versionRange: '^0.34.0' }] },
      source: minimalPluginSource(),
    });
    await expect(loadPluginRegistrySnapshot([plainWithExternal.entry], plainWithExternal.root)).rejects.toThrow('Required plugin failed');

    const factoryWithoutExternal = createPluginFixture({
      source: `export default () => ({ pluginId: "telecom", version: "1.0.0", providers: [] });`,
    });
    await expect(loadPluginRegistrySnapshot([factoryWithoutExternal.entry], factoryWithoutExternal.root)).rejects.toThrow('Required plugin failed');

    const incompatible = createPluginFixture({
      manifest: { hostExternals: [{ id: 'typebox', versionRange: '^99.0.0' }] },
      source: `export default () => ({ pluginId: "telecom", version: "1.0.0", providers: [] });`,
    });
    const snapshot = await loadPluginRegistrySnapshot([{ ...incompatible.entry, required: false }], incompatible.root);
    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({
      reasonCode: 'PLUGIN_HOST_EXTERNAL_VERSION_INCOMPATIBLE',
      pluginId: 'telecom',
    });
  });

  it('rejects factory access to undeclared host externals', async () => {
    const undeclaredAccess = createPluginFixture({
      manifest: { hostExternals: [{ id: 'typebox', versionRange: '^0.34.0' }] },
      source: `export default (host) => {
        if (!host.externals.typebox?.Type) throw new Error("missing typebox");
        void host.externals.ajv?.Ajv;
        return { pluginId: "telecom", version: "1.0.0", providers: [] };
      };`,
    });

    const snapshot = await loadPluginRegistrySnapshot([{ ...undeclaredAccess.entry, required: false }], undeclaredAccess.root);

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({
      reasonCode: 'PLUGIN_HOST_EXTERNAL_NOT_DECLARED',
      pluginId: 'telecom',
      outcome: 'rejected',
    });
  });

  it('rejects residual host package imports before bundle evaluation', async () => {
    const fixture = createPluginFixture({
      source: `import { Type } from "@sinclair/typebox"; ${minimalPluginSource()}`,
    });

    await expect(loadPluginRegistrySnapshot([fixture.entry], fixture.root)).rejects.toThrow('Required plugin failed');
  });
});
