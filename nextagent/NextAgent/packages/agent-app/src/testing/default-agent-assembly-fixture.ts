import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import { loadBuiltInDefaultAgentDefinition } from '../assembly/agent-directory-loader.js';
import { createCompiledAgentAssemblyRegistry } from '../assembly/agent-assembly-registry.js';
import { compileWorkspaceFilePolicy } from '../assembly/agent-assembly-compiler.js';

export function createDefaultAgentTestAssemblyRegistry(modelId: string): AgentAssemblyRegistry {
  const definition = loadBuiltInDefaultAgentDefinition();
  const assembly: AgentAssembly = {
    agentId: definition.agentId,
    agentType: definition.agentType,
    agentVersion: definition.agentVersion,
    agentAssemblyRef: `${definition.agentId}:${definition.agentVersion}`,
    displayName: definition.displayName,
    description: definition.description,
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
      files: compileWorkspaceFilePolicy(definition.workspaceFiles),
    },
    modelIds: [modelId],
    defaultModelId: modelId,
    capabilityBindings: definition.capabilityBindings,
    hooks: [],
    userInvocable: definition.userInvocable ?? true,
    agentInvocation: definition.agentInvocation ?? 'BOUND',
    sourceKind: 'BUILTIN',
    runtimeSettings: definition.runtimeSettings,
    ...(definition.routing === undefined ? {} : { routing: definition.routing }),
  };
  return createCompiledAgentAssemblyRegistry([assembly]);
}
