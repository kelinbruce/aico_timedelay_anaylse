import type {
  CapabilityDiscovery,
  CapabilityDiscoveryMode,
  CapabilitySearchCriteria,
  CapabilityProviderIdentity,
  CapabilityProviderConfig,
} from '@nextagent/agent-contracts/capability';

import { builtinToolDefinitions, builtinSkillsProvider, builtinToolsProvider, createBuiltinToolDefinitions } from '../builtins/index.js';
import {
  ClipToolRegistry,
  createClipBackedToolDiscovery,
  isClipServerProvider,
  type ClipCommandRunner,
  type ClipSafeDiagnostic,
} from '../clip/clip-tool-source.js';
import { BuiltinSkillDiscovery, type BuiltinSkillDiscoveryOptions } from '../builtins/skill-discovery.js';
import {
  LocalSkillDiscovery,
  localSkillsAgentOwnedProvider,
  localSkillsRuntimeGeneratedProvider,
  localSkillsSystemProvider,
  type LocalSkillDiscoveryOptions,
} from '../local/skill-discovery.js';
import { CapabilityConfigurationError } from '../provider-config.js';
import { SkillHubDiscovery, type SkillHubRemoteAccessPort } from '../skillhub/skillhub-source.js';
import { withSkillHubAcquisitionCapability } from '../skillhub/skillhub-acquisition-discovery.js';
import { createToolCatalog, type ToolCatalogConfig } from '../tools/tool-catalog.js';
import type { ToolDependencies } from '../tools/tool-spi.js';
import {
  BuiltinAgentDiscovery,
  LocalAgentDiscovery,
  builtinAgentsProvider,
  localAgentsProvider,
  localSubagentsProvider,
  type AgentDiscoverySource,
  type BuiltinAgentDiscoveryOptions,
  type LocalAgentDiscoveryOptions,
} from '../agents/agent-discovery.js';

export type { CapabilityDiscovery, CapabilitySearchCriteria, SkillScanEvidenceItem } from '@nextagent/agent-contracts/capability';

export interface CapabilityDiscoveryFactoryInput {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: CapabilityDiscoveryMode;
  readonly config?: CapabilityProviderConfig;
  readonly builtinSkillDiscoveryOptions?: BuiltinSkillDiscoveryOptions;
  readonly localSkillDiscoveryOptions?: LocalSkillDiscoveryOptions;
  readonly builtinAgentDiscoveryOptions?: BuiltinAgentDiscoveryOptions;
  readonly agentDiscoverySource?: AgentDiscoverySource;
  readonly toolCatalogConfig?: ToolCatalogConfig;
  readonly toolDependencies?: ToolDependencies;
  readonly clipRegistry?: ClipToolRegistry;
  readonly clipCommandRunner?: ClipCommandRunner;
  readonly clipDiagnostics?: ClipSafeDiagnostic[];
  readonly clipcDisclosureMode?: 'list' | 'tool-search';
  readonly skillHubRemoteAccessFactory?: (config: CapabilityProviderConfig) => SkillHubRemoteAccessPort | undefined;
  readonly backgroundExecutionEnabled?: boolean;
}

export interface CapabilityDiscoveryFactory {
  create: (input: CapabilityDiscoveryFactoryInput) => CapabilityDiscovery;
}

export class DefaultCapabilityDiscoveryFactory implements CapabilityDiscoveryFactory {
  create(input: CapabilityDiscoveryFactoryInput): CapabilityDiscovery {
    if (
      input.provider.providerKind === 'BUNDLED' &&
      input.provider.providerId === builtinToolsProvider.providerId &&
      input.discoveryMode === 'EAGER'
    ) {
      const tools =
        input.backgroundExecutionEnabled === true ? createBuiltinToolDefinitions({ backgroundExecutionEnabled: true }) : builtinToolDefinitions;
      return createToolCatalog({
        provider: builtinToolsProvider,
        tools,
        ...(input.toolCatalogConfig === undefined ? {} : { config: input.toolCatalogConfig }),
        ...(input.toolDependencies === undefined ? {} : { dependencies: input.toolDependencies }),
      });
    }
    if (
      input.provider.providerKind === 'BUNDLED' &&
      input.provider.providerId === builtinSkillsProvider.providerId &&
      input.discoveryMode === 'EAGER'
    ) {
      return new BuiltinSkillDiscovery(input.builtinSkillDiscoveryOptions);
    }
    if (
      input.provider.providerKind === 'BUNDLED' &&
      input.provider.providerId === builtinAgentsProvider.providerId &&
      input.discoveryMode === 'EAGER'
    ) {
      const source = input.agentDiscoverySource ?? input.builtinAgentDiscoveryOptions?.source;
      return new BuiltinAgentDiscovery({
        ...(input.builtinAgentDiscoveryOptions ?? {}),
        ...(source === undefined ? {} : { source }),
      });
    }
    if (
      input.provider.providerKind === 'LOCAL_DIRECTORY' &&
      input.provider.providerId === localSkillsSystemProvider.providerId &&
      input.discoveryMode === 'EAGER'
    ) {
      return new LocalSkillDiscovery(
        { provider: localSkillsSystemProvider, discoveryMode: 'EAGER', sourceScope: 'system-local' },
        input.localSkillDiscoveryOptions,
      );
    }
    if (
      input.provider.providerKind === 'LOCAL_DIRECTORY' &&
      input.provider.providerId === localSkillsAgentOwnedProvider.providerId &&
      input.discoveryMode === 'SEARCH'
    ) {
      return new LocalSkillDiscovery(
        { provider: localSkillsAgentOwnedProvider, discoveryMode: 'SEARCH', sourceScope: 'agent-owned-local' },
        input.localSkillDiscoveryOptions,
      );
    }
    if (
      input.provider.providerKind === 'LOCAL_DIRECTORY' &&
      input.provider.providerId === localSkillsRuntimeGeneratedProvider.providerId &&
      input.discoveryMode === 'SEARCH'
    ) {
      return new LocalSkillDiscovery(
        { provider: localSkillsRuntimeGeneratedProvider, discoveryMode: 'SEARCH', sourceScope: 'runtime-generated-local' },
        input.localSkillDiscoveryOptions,
      );
    }
    if (
      input.provider.providerKind === 'LOCAL_DIRECTORY' &&
      input.provider.providerId === localAgentsProvider.providerId &&
      input.discoveryMode === 'EAGER'
    ) {
      return new LocalAgentDiscovery({
        sourceScope: 'top-level-local',
        ...(input.agentDiscoverySource === undefined ? {} : { source: input.agentDiscoverySource }),
      });
    }
    if (
      input.provider.providerKind === 'LOCAL_DIRECTORY' &&
      input.provider.providerId === localSubagentsProvider.providerId &&
      input.discoveryMode === 'SEARCH'
    ) {
      return new LocalAgentDiscovery({
        sourceScope: 'parent-subagent',
        ...(input.agentDiscoverySource === undefined ? {} : { source: input.agentDiscoverySource }),
      });
    }
    if (isClipServerProvider(input.provider) && input.config !== undefined && input.clipRegistry !== undefined) {
      return createClipBackedToolDiscovery({
        provider: input.provider,
        config: input.config,
        registry: input.clipRegistry,
        ...(input.clipCommandRunner === undefined ? {} : { runner: input.clipCommandRunner }),
        ...(input.clipDiagnostics === undefined ? {} : { diagnostics: input.clipDiagnostics }),
        ...(input.clipcDisclosureMode === undefined ? {} : { disclosureMode: input.clipcDisclosureMode }),
      });
    }
    if (input.provider.providerKind === 'SKILL_HUB' && input.discoveryMode === 'SEARCH' && input.config !== undefined) {
      const remoteAccess = input.skillHubRemoteAccessFactory?.(input.config);
      if (remoteAccess === undefined) {
        throw new CapabilityConfigurationError('SkillHub remote access is unavailable.');
      }
      const options = input.config.options as { readonly managedInstallRef?: string };
      if (typeof options.managedInstallRef !== 'string' || options.managedInstallRef.trim().length === 0) {
        throw new CapabilityConfigurationError('SKILL_HUB capability provider requires managedInstallRef.');
      }
      return withSkillHubAcquisitionCapability(
        new SkillHubDiscovery({
          provider: { ...input.provider, providerKind: 'SKILL_HUB' },
          managedInstallRoot: options.managedInstallRef,
          remoteAccess,
        }),
      );
    }
    if (input.provider.providerKind === 'CUSTOM') {
      throw new CapabilityConfigurationError('Unsupported custom capability provider type.');
    }
    throw new CapabilityConfigurationError('Unsupported capability provider kind.');
  }
}

export function createDefaultCapabilityDiscoveryFactory(): CapabilityDiscoveryFactory {
  return new DefaultCapabilityDiscoveryFactory();
}
