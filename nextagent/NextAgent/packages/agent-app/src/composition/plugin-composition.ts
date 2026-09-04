import type { DefaultSystemConfig } from '../config/component-config.js';
import {
  emptyPluginRegistrySnapshot,
  loadPluginRegistrySnapshot,
  loadPluginRegistrySnapshotSync,
  type PluginLoaderHostServices,
  type PluginRegistrySnapshot,
} from '../plugin/plugin-loader.js';

export interface PluginComposition {
  readonly snapshot: PluginRegistrySnapshot;
  readonly lifecycleHooks: PluginRegistrySnapshot['hooks'];
  readonly assemblyAndRequestPolicies: PluginRegistrySnapshot['policies'];
  readonly capabilityProviders: PluginRegistrySnapshot['providers'];
  readonly diagnostics: PluginRegistrySnapshot['diagnostics'];
}

export function preloadPluginCompositionSync(input: {
  readonly systemConfig: Pick<DefaultSystemConfig, 'pluginSystem' | 'paths'>;
  readonly injectedSnapshot?: PluginRegistrySnapshot;
  readonly hostServices?: PluginLoaderHostServices;
}): PluginComposition {
  return projectPluginComposition(input.injectedSnapshot ?? loadPluginSnapshotSync(input.systemConfig, input.hostServices));
}

export async function preloadPluginCompositionAsync(input: {
  readonly systemConfig: Pick<DefaultSystemConfig, 'pluginSystem' | 'paths'>;
  readonly injectedSnapshot?: PluginRegistrySnapshot;
  readonly hostServices?: PluginLoaderHostServices;
}): Promise<PluginComposition> {
  return projectPluginComposition(input.injectedSnapshot ?? (await loadPluginSnapshot(input.systemConfig, input.hostServices)));
}

function loadPluginSnapshotSync(
  systemConfig: Pick<DefaultSystemConfig, 'pluginSystem' | 'paths'>,
  hostServices?: PluginLoaderHostServices,
): PluginRegistrySnapshot {
  return systemConfig.pluginSystem.plugins.length === 0
    ? emptyPluginRegistrySnapshot()
    : loadPluginRegistrySnapshotSync(systemConfig.pluginSystem.plugins, systemConfig.paths.configRoot, hostServices);
}

async function loadPluginSnapshot(
  systemConfig: Pick<DefaultSystemConfig, 'pluginSystem' | 'paths'>,
  hostServices?: PluginLoaderHostServices,
): Promise<PluginRegistrySnapshot> {
  return systemConfig.pluginSystem.plugins.length === 0
    ? emptyPluginRegistrySnapshot()
    : await loadPluginRegistrySnapshot(systemConfig.pluginSystem.plugins, systemConfig.paths.configRoot, hostServices);
}

function projectPluginComposition(snapshot: PluginRegistrySnapshot): PluginComposition {
  return Object.freeze({
    snapshot,
    lifecycleHooks: snapshot.hooks,
    assemblyAndRequestPolicies: snapshot.policies,
    capabilityProviders: snapshot.providers,
    diagnostics: snapshot.diagnostics,
  });
}
