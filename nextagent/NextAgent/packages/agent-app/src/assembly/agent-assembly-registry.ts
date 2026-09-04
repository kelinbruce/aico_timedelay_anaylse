import type { AgentId, AgentVersion } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { AgentDiscoverySource, AgentParentScope } from '@nextagent/agent-capability';

export type CompiledAgentAssemblyRegistry = AgentAssemblyRegistry & AgentDiscoverySource;

export function createCompiledAgentAssemblyRegistry(assemblies: readonly AgentAssembly[]): CompiledAgentAssemblyRegistry {
  const allAssemblies = normalizeAssemblies(assemblies);
  return {
    async active(agentId: AgentId): Promise<AgentAssembly> {
      return resolveUserInvocableAgentAssembly(allAssemblies, agentId);
    },
    async require(agentId: AgentId, agentVersion: AgentVersion): Promise<AgentAssembly> {
      const assembly = allAssemblies.find((item) => item.agentId === agentId && item.agentVersion === agentVersion);
      if (assembly === undefined) {
        throw new Error('Required assembly is unavailable.');
      }
      return assembly;
    },
    async listBuiltinAgentAssemblies(signal: AbortSignal): Promise<readonly AgentAssembly[]> {
      return listBySource(allAssemblies, 'BUILTIN', signal).filter(
        (assembly) => assembly.agentInvocation !== 'PARENT' && assembly.parentAgentScope === undefined,
      );
    },
    async listTopLevelLocalAgentAssemblies(signal: AbortSignal): Promise<readonly AgentAssembly[]> {
      return listBySource(allAssemblies, 'LOCAL', signal).filter(
        (assembly) => assembly.agentInvocation !== 'PARENT' && assembly.parentAgentScope === undefined,
      );
    },
    async listParentSubagentAssemblies(parentScope: AgentParentScope, signal: AbortSignal): Promise<readonly AgentAssembly[]> {
      return listBySource(allAssemblies, 'LOCAL', signal)
        .filter((assembly) => assembly.agentInvocation === 'PARENT')
        .filter(
          (assembly) =>
            assembly.parentAgentScope?.agentId === parentScope.agentId &&
            assembly.parentAgentScope.agentVersion === parentScope.agentVersion &&
            assembly.parentAgentScope.agentAssemblyRef === parentScope.agentAssemblyRef,
        );
    },
  };
}

function normalizeAssemblies(assemblies: readonly AgentAssembly[]): readonly AgentAssembly[] {
  const seen = new Set<string>();
  for (const assembly of assemblies) {
    const key = `${assembly.agentId}:${assembly.agentVersion}`;
    if (seen.has(key)) {
      throw new Error('Agent assembly identity must be globally unique.');
    }
    seen.add(key);
  }
  return [...assemblies];
}

export function resolveUserInvocableAgentAssembly(assemblies: readonly AgentAssembly[], agentId: AgentId): AgentAssembly {
  const assembly = assemblies.find((item) => item.agentId === agentId);
  if (assembly === undefined || assembly.userInvocable !== true || assembly.parentAgentScope !== undefined) {
    throw new Error('User-invocable assembly is unavailable.');
  }
  return assembly;
}

function listBySource(
  assemblies: readonly AgentAssembly[],
  sourceKind: NonNullable<AgentAssembly['sourceKind']>,
  signal: AbortSignal,
): readonly AgentAssembly[] {
  if (signal.aborted) {
    return [];
  }
  return assemblies.filter((assembly) => assembly.sourceKind === sourceKind);
}
