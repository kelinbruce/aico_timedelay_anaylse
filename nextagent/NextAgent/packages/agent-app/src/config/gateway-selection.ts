import type { GatewayProviderSelectionEntry } from '@nextagent/agent-contracts/gateway';
import type { DefaultSystemConfig } from './component-config.js';

export type CronDeploymentSelection = 'DISABLED' | 'LOCAL' | 'REMOTE';

export function resolveCronDeploymentSelection(systemConfig: DefaultSystemConfig): CronDeploymentSelection {
  const selection = systemConfig.gatewaySelection.entries.find((entry) => entry.adapterKind === 'cron-tasks' && entry.selectionState === 'enabled');
  return selection?.deploymentMode ?? 'DISABLED';
}

export function isGatewayAdapterSelected(systemConfig: DefaultSystemConfig, adapterKind: GatewayProviderSelectionEntry['adapterKind']): boolean {
  return systemConfig.gatewaySelection.entries.some((entry) => entry.adapterKind === adapterKind && entry.selectionState === 'enabled');
}

export function isGatewayAdapterSelectedForDeployment(
  systemConfig: DefaultSystemConfig,
  adapterKind: GatewayProviderSelectionEntry['adapterKind'],
  deploymentMode: GatewayProviderSelectionEntry['deploymentMode'],
): boolean {
  return systemConfig.gatewaySelection.entries.some(
    (entry) => entry.adapterKind === adapterKind && entry.deploymentMode === deploymentMode && entry.selectionState === 'enabled',
  );
}
