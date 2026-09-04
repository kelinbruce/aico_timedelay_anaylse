import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginSystemConfigEntry } from '../src/config/component-config.js';

export interface PluginFixtureOptions {
  readonly pluginId?: string;
  readonly manifest?: Record<string, unknown>;
  readonly source?: string;
  readonly fileName?: string;
}

export interface PluginFixture {
  readonly root: string;
  readonly pluginDir: string;
  readonly entry: PluginSystemConfigEntry;
}

export function createPluginFixture(options: PluginFixtureOptions = {}): PluginFixture {
  const pluginId = options.pluginId ?? 'telecom';
  const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-app-'));
  const pluginDir = join(root, 'plugins', pluginId);
  mkdirSync(pluginDir, { recursive: true });
  const fileName = options.fileName ?? 'index.js';
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      pluginId,
      version: '1.0.0',
      main: `./${fileName}`,
      artifactType: 'esm-bundle',
      ...(options.manifest ?? {}),
    }),
    'utf8',
  );
  writeFileSync(join(pluginDir, fileName), options.source ?? minimalPluginSource(pluginId), 'utf8');
  return {
    root,
    pluginDir,
    entry: { pluginId, path: `plugins/${pluginId}`, required: true },
  };
}

export function minimalPluginSource(pluginId = 'telecom', apiVersion?: string): string {
  return `export default {${apiVersion === undefined ? '' : ` apiVersion: "${apiVersion}",`} pluginId: "${pluginId}", version: "1.0.0", providers: [] };`;
}

export function pluginWithProvidersSource(pluginId: string, providerIds: readonly string[]): string {
  return `export default {
    pluginId: "${pluginId}",
    version: "1.0.0",
    providers: [
      ${providerIds
        .map(
          (providerId) => `{
        identity: { providerId: "${providerId}", providerKind: "CUSTOM", providerType: "nextagent-plugin-tool" },
        discovery: {
          provider: { providerId: "${providerId}", providerKind: "CUSTOM", providerType: "nextagent-plugin-tool" },
          discoveryMode: "EAGER",
          async listAll() { return []; }
        }
      }`,
        )
        .join(',')}
    ]
  };`;
}

export function pluginWithPolicySource(pluginId: string, policyPointId: string, policyId = 'route-alarms'): string {
  return `export default {
    pluginId: "${pluginId}",
    version: "1.0.0",
    policies: [{
      policyPointId: "${policyPointId}",
      policyId: "${policyId}",
      decide() { return { kind: "MODEL_DRIVEN_LOOP", safeReason: "test" }; }
    }]
  };`;
}
