import { getLogger } from '@nextagent/agent-common';
import type { AgentId, AgentVersion, IdentityContext } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { createExecutionWorkspaceResolver, type LifecycleHookDefinition } from '@nextagent/agent-runtime';
import {
  attachRecipeCapabilitiesToAssemblies,
  createRecipeCapabilityProvider,
  createRecipeDefinitionSourceForAssemblies,
} from '@nextagent/agent-workflow';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compileAgentAssembly,
  validateStartupAgentAssemblyGraph,
  type AgentAssemblyResourceReferences,
} from '../assembly/agent-assembly-compiler.js';
import type { CompiledAgentAssemblyRegistry } from '../assembly/agent-assembly-registry.js';
import { createCompiledAgentAssemblyRegistry } from '../assembly/agent-assembly-registry.js';
import type { AgentDefinition } from '../assembly/agent-definition.js';
import { createAgentDiscoveryAssemblies } from '../assembly/agent-discovery-source.js';
import { loadAgentDefinitionForSystemConfig } from '../assembly/agent-directory-loader.js';
import { createAgentPackageSourceLocator } from '../assembly/agent-package-source-locator.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import { trustedOwnerScope } from './app-composition-helpers.js';
import type { AgentScope } from './composition-contracts.js';

export type HotReloadingAgentAssemblyRegistry = CompiledAgentAssemblyRegistry & {
  readonly updateValidationReferences: (refs: AgentAssemblyResourceReferences) => void;
};

export interface ComposeAgentAssemblyLayerInput {
  readonly systemConfig: DefaultSystemConfig;
  readonly agentDefinition?: AgentDefinition;
  readonly identity: IdentityContext;
  readonly lifecycleHookDefinitions: readonly LifecycleHookDefinition[];
  readonly pluginPolicies?: NonNullable<AgentAssemblyResourceReferences['pluginPolicies']>;
}

export function composeAgentAssemblyLayer(input: ComposeAgentAssemblyLayerInput) {
  const agentDefinition = input.agentDefinition ?? loadAgentDefinitionForSystemConfig(input.systemConfig);
  const resourceReferences: AgentAssemblyResourceReferences = {
    capabilityProviders: [],
    lifecycleHookDefinitions: input.lifecycleHookDefinitions,
    ...(input.pluginPolicies === undefined ? {} : { pluginPolicies: input.pluginPolicies }),
  };
  const discoveredAgentAssemblies = createAgentDiscoveryAssemblies({
    systemConfig: input.systemConfig,
    resourceReferences,
    activeDefinition: agentDefinition,
  });
  const recipeDefinitionSource = createRecipeDefinitionSourceForAssemblies(discoveredAgentAssemblies, input.systemConfig.paths.agentsRoot);
  const agentAssemblies = composeRuntimeFacingAgentAssemblies(
    attachRecipeCapabilitiesToAssemblies(discoveredAgentAssemblies, recipeDefinitionSource),
    input.systemConfig,
  );
  const startupAssemblyRegistry = createCompiledAgentAssemblyRegistry(agentAssemblies);
  const assemblyValidationReferences = {
    capabilityProviders: resourceReferences.capabilityProviders,
    lifecycleHookDefinitions: input.lifecycleHookDefinitions,
  };
  const defaultRouteAssembly = selectStartupRouteAssembly(agentAssemblies, input.systemConfig.activeAgentId);
  const defaultRouteAgentScope = agentScopeFromAssembly(defaultRouteAssembly);
  for (const assembly of agentAssemblies) {
    recipeDefinitionSource.validateTrustedRecipeRoot(assembly.agentId);
  }

  return {
    agentDefinition,
    resourceReferences,
    recipeDefinitionSource,
    recipeCapabilityProvider: createRecipeCapabilityProvider(recipeDefinitionSource),
    agentAssemblies,
    startupAssemblyRegistry,
    assemblyValidationReferences,
    assemblyRegistry: createHotReloadingActiveAssemblyRegistry({
      baseRegistry: startupAssemblyRegistry,
      systemConfig: input.systemConfig,
      initialActiveAssembly: defaultRouteAssembly,
      validationReferences: assemblyValidationReferences,
    }),
    defaultRouteAssembly,
    defaultRouteAgentScope,
    defaultRouteOwnerScope: trustedOwnerScope(input.identity, defaultRouteAgentScope),
    agentScopesByAgentId: indexAgentScopesByAgentId(agentAssemblies),
    agentPackageSourceLocator: createAgentPackageSourceLocator(input.systemConfig),
    executionWorkspaceResolver: createExecutionWorkspaceResolver(),
  };
}

export function selectStartupRouteAssembly(assemblies: readonly AgentAssembly[], activeAgentId: AgentId): AgentAssembly {
  const activeAssembly = assemblies.find((assembly) => assembly.agentId === activeAgentId && assembly.parentAgentScope === undefined);
  if (activeAssembly !== undefined) {
    return activeAssembly;
  }
  const fallback = assemblies[0];
  if (fallback === undefined) {
    throw new Error('Agent assembly is unavailable.');
  }
  return fallback;
}

export function createHotReloadingActiveAssemblyRegistry(input: {
  readonly baseRegistry: CompiledAgentAssemblyRegistry;
  readonly systemConfig: DefaultSystemConfig;
  readonly initialActiveAssembly: AgentAssembly;
  readonly validationReferences: AgentAssemblyResourceReferences;
}): HotReloadingAgentAssemblyRegistry {
  let activeAssembly = input.initialActiveAssembly;
  let activeDefinitionFingerprint = readActiveAgentDefinitionFingerprint(input.systemConfig);
  let validationReferences = input.validationReferences;
  let baseRegistry = input.baseRegistry;

  const refreshBaseRegistryIfNeeded = (): void => {
    const nextFingerprint = readActiveAgentDefinitionFingerprint(input.systemConfig);
    if (nextFingerprint === activeDefinitionFingerprint) {
      return;
    }
    try {
      const definition = loadAgentDefinitionForSystemConfig(input.systemConfig);
      const discoveredAgentAssemblies = createAgentDiscoveryAssemblies({
        systemConfig: input.systemConfig,
        resourceReferences: validationReferences,
        activeDefinition: definition,
      });
      const agentAssemblies = composeRuntimeFacingAgentAssemblies(
        attachRecipeCapabilitiesToAssemblies(
          discoveredAgentAssemblies,
          createRecipeDefinitionSourceForAssemblies(discoveredAgentAssemblies, input.systemConfig.paths.agentsRoot),
        ),
        input.systemConfig,
      );
      baseRegistry = createCompiledAgentAssemblyRegistry(agentAssemblies);
      const localDefinitionPath = resolve(input.systemConfig.paths.agentsRoot, input.systemConfig.activeAgentId, 'agent.yaml');
      const nextAssembly = compileAgentAssembly(
        {
          systemConfig: input.systemConfig,
          agentDefinition: definition,
          resourceReferences: validationReferences,
        },
        {
          requireActiveAgentMatch: false,
          sourceKind: existsSync(localDefinitionPath) && statSync(localDefinitionPath).isFile() ? 'LOCAL' : 'BUILTIN',
        },
      );
      const preservedAssembly = composeRuntimeFacingAgentAssembly(
        activeAssembly.recipeIds === undefined ? nextAssembly : { ...nextAssembly, recipeIds: activeAssembly.recipeIds },
        input.systemConfig,
      );
      validateStartupAgentAssemblyGraph({
        systemConfig: input.systemConfig,
        assemblies: [preservedAssembly],
        resourceReferences: validationReferences,
      });
      activeAssembly = preservedAssembly;
      activeDefinitionFingerprint = nextFingerprint;
    } catch (error) {
      const logger = getLogger({ component: 'agent-app', source: 'assembly-composition' });
      logger.warn({
        event: 'agent.registry.refresh_failed',
        safeReasonCode: 'REGISTRY_REFRESH_FAILED',
        ...(error instanceof Error ? { message: error.message } : {}),
      });
    }
  };

  return {
    async active(agentId: AgentId): Promise<AgentAssembly> {
      refreshBaseRegistryIfNeeded();
      if (agentId === input.systemConfig.activeAgentId) {
        return activeAssembly;
      }
      return baseRegistry.active(agentId);
    },
    async require(agentId: AgentId, agentVersion: AgentVersion): Promise<AgentAssembly> {
      refreshBaseRegistryIfNeeded();
      if (agentId === input.systemConfig.activeAgentId && agentVersion === activeAssembly.agentVersion) {
        return activeAssembly;
      }
      return baseRegistry.require(agentId, agentVersion);
    },
    listBuiltinAgentAssemblies: (signal: AbortSignal) => baseRegistry.listBuiltinAgentAssemblies(signal),
    listTopLevelLocalAgentAssemblies: (signal: AbortSignal) => baseRegistry.listTopLevelLocalAgentAssemblies(signal),
    listParentSubagentAssemblies: (parentScope, signal) => baseRegistry.listParentSubagentAssemblies(parentScope, signal),
    updateValidationReferences: (refs: AgentAssemblyResourceReferences) => {
      validationReferences = refs;
    },
  };
}

function readActiveAgentDefinitionFingerprint(systemConfig: DefaultSystemConfig): string | undefined {
  const agentsRoot = systemConfig.paths.agentsRoot;
  try {
    if (!existsSync(agentsRoot) || !statSync(agentsRoot).isDirectory()) {
      return undefined;
    }
    const entries = readdirSync(agentsRoot, { withFileTypes: true });
    const parts: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const agentYamlPath = resolve(agentsRoot, entry.name, 'agent.yaml');
      if (!existsSync(agentYamlPath)) {
        continue;
      }
      const info = statSync(agentYamlPath);
      if (!info.isFile()) {
        continue;
      }
      parts.push(`${entry.name}:${info.size}:${info.mtimeMs}`);
    }
    return parts.length === 0 ? undefined : parts.sort().join('|');
  } catch {
    return undefined;
  }
}

export function agentScopeFromAssembly(assembly: AgentAssembly): AgentScope {
  return {
    agentId: assembly.agentId,
    agentVersion: assembly.agentVersion,
  };
}

export function indexAgentScopesByAgentId(assemblies: readonly AgentAssembly[]): ReadonlyMap<string, AgentScope> {
  const scopes = new Map<string, AgentScope>();
  for (const assembly of assemblies) {
    const key = String(assembly.agentId);
    if (!scopes.has(key)) {
      scopes.set(key, agentScopeFromAssembly(assembly));
    }
  }
  return scopes;
}

export function composeRuntimeFacingAgentAssemblies(
  assemblies: readonly AgentAssembly[],
  systemConfig: DefaultSystemConfig,
): readonly AgentAssembly[] {
  return assemblies.map((assembly) => composeRuntimeFacingAgentAssembly(assembly, systemConfig));
}

function composeRuntimeFacingAgentAssembly(assembly: AgentAssembly, systemConfig: DefaultSystemConfig): AgentAssembly {
  const sharedDataRoot = assembly.workspacePolicy.roots.find((root) => root.kind === 'sharedData');
  if (sharedDataRoot !== undefined) {
    assertSharedDataRootPolicy(sharedDataRoot);
    if (systemConfig.gateway.deploymentMode !== 'LOCAL') {
      throw new Error('Shared data root is only supported in local deployment mode.');
    }
    return assembly;
  }
  if (systemConfig.gateway.deploymentMode !== 'LOCAL') {
    return assembly;
  }
  return {
    ...assembly,
    workspacePolicy: {
      ...assembly.workspacePolicy,
      roots: [...assembly.workspacePolicy.roots, { kind: 'sharedData', logicalPath: 'shared-data', access: 'read' }],
    },
  };
}

function assertSharedDataRootPolicy(root: AgentAssembly['workspacePolicy']['roots'][number]): void {
  if (root.logicalPath !== 'shared-data' || root.access !== 'read') {
    throw new Error('Shared data root policy is invalid.');
  }
}
