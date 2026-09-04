import { builtinAgentsRoot } from '@nextagent/agent-core';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentDefinition } from './agent-definition.js';
import { parseAgentDefinition } from './agent-definition-parser.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import { parseBuiltInConfig } from '../config/system-config.js';

export interface BuiltInAgentPackageDefinition {
  readonly packageRoot: string;
  readonly definition: AgentDefinition;
}

export function loadAgentDefinitionFile(configFile: string): AgentDefinition {
  const content = readFileSync(configFile, 'utf8');
  return resolveAgentDefinitionEnvRefs(parseAgentDefinition(parseBuiltInConfig(content)));
}

export function loadBuiltInAgentDefinition(agentId: string): AgentDefinition {
  return loadAgentDefinitionFile(resolve(requireBuiltinAgentPackageRoot(agentId), 'agent.yaml'));
}

export function loadBuiltInDefaultAgentDefinition(): AgentDefinition {
  return loadBuiltInAgentDefinition('default-agent');
}

export function loadAgentDefinitionForSystemConfig(systemConfig: DefaultSystemConfig): AgentDefinition {
  const agentDefinitionPath = resolve(systemConfig.paths.agentsRoot, systemConfig.activeAgentId, 'agent.yaml');
  if (existsSync(agentDefinitionPath)) {
    return loadAgentDefinitionFile(agentDefinitionPath);
  }
  const builtinRoot = findBuiltinAgentPackageRoot(systemConfig.activeAgentId);
  if (builtinRoot !== undefined) {
    return loadAgentDefinitionFile(resolve(builtinRoot, 'agent.yaml'));
  }
  throw new Error('Active AgentDefinition is unavailable.');
}

function findBuiltinAgentPackageRoot(agentId: string): string | undefined {
  return loadBuiltInAgentPackageDefinitions().find((item) => item.definition.agentId === agentId)?.packageRoot;
}

function requireBuiltinAgentPackageRoot(agentId: string): string {
  const root = findBuiltinAgentPackageRoot(agentId);
  if (root === undefined) {
    throw new Error('Builtin Agent package is unavailable.');
  }
  return root;
}

export function loadBuiltInAgentPackageDefinitions(): readonly BuiltInAgentPackageDefinition[] {
  const root = builtinAgentsRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => loadBuiltInAgentDefinitionIfPresent(join(root, entry.name)));
}

function loadBuiltInAgentDefinitionIfPresent(packageRoot: string): readonly BuiltInAgentPackageDefinition[] {
  const definitionPath = join(packageRoot, 'agent.yaml');
  if (!existsSync(definitionPath) || !statSync(definitionPath).isFile()) {
    return [];
  }
  return [
    {
      packageRoot,
      definition: resolveAgentDefinitionEnvRefs(parseAgentDefinition(parseBuiltInConfig(readFileSync(definitionPath, 'utf8')))),
    },
  ];
}

function resolveEnvRef(value: string): string {
  if (typeof value !== 'string' || !value.startsWith('env:')) {
    return value;
  }
  const resolved = process.env[value.slice('env:'.length)];
  return resolved !== undefined && resolved.length > 0 ? resolved : value;
}

function resolveAgentDefinitionEnvRefs(definition: AgentDefinition): AgentDefinition {
  return {
    ...definition,
    ...(definition.modelIds !== undefined ? { modelIds: definition.modelIds.map(resolveEnvRef) } : {}),
    ...(definition.defaultModelId !== undefined ? { defaultModelId: resolveEnvRef(definition.defaultModelId) } : {}),
  };
}
