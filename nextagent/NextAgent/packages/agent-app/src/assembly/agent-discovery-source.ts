import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBuiltInConfig } from '../config/system-config.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import { compileAgentAssembly, type AgentAssemblyResourceReferences } from './agent-assembly-compiler.js';
import type { AgentDefinition } from './agent-definition.js';
import { parseAgentDefinition } from './agent-definition-parser.js';
import { loadBuiltInAgentPackageDefinitions } from './agent-directory-loader.js';

interface AgentDiscoveryAssembliesInput {
  readonly systemConfig: DefaultSystemConfig;
  readonly resourceReferences: AgentAssemblyResourceReferences;
  readonly activeDefinition: AgentDefinition;
}

export function requireAgentDefinitionForScope(
  input: Pick<AgentDiscoveryAssembliesInput, 'systemConfig' | 'activeDefinition'>,
  agentId: AgentDefinition['agentId'],
  agentVersion: AgentDefinition['agentVersion'],
): AgentDefinition {
  const topLevelLocalDefinitions = loadTopLevelLocalDefinitions(input.systemConfig);
  const definitions = [input.activeDefinition, ...loadBuiltInAgentPackageDefinitions().map((item) => item.definition), ...topLevelLocalDefinitions];
  definitions.push(
    ...topLevelLocalDefinitions.flatMap((definition) => loadParentSubagentDefinitions(input.systemConfig, String(definition.agentId))),
  );
  const definition = definitions.find((candidate) => candidate.agentId === agentId && candidate.agentVersion === agentVersion);
  if (definition === undefined) {
    throw new Error('Agent workspace file extension policy is unavailable.');
  }
  return definition;
}

export function createAgentDiscoveryAssemblies(input: AgentDiscoveryAssembliesInput): readonly AgentAssembly[] {
  const activeAssembly = compileActiveAgentAssembly(input);
  const topLevelAssemblies = uniqueAssemblies([
    activeAssembly,
    ...compileBuiltinAgentAssemblies(input, activeAssembly),
    ...compileTopLevelLocalAgents(input, activeAssembly),
  ]);
  return uniqueAssemblies([
    ...topLevelAssemblies,
    ...topLevelAssemblies.flatMap((assembly) =>
      assembly.sourceKind === 'LOCAL' && assembly.parentAgentScope === undefined ? compileParentSubagents(input, assembly) : [],
    ),
  ]);
}

export function builtinAgentPromptTemplateRegistrations(
  assemblies: readonly AgentAssembly[],
): ReadonlyArray<{ readonly agentId: string; readonly agentVersion: string; readonly path: string }> {
  const builtinPackages = loadBuiltInAgentPackageDefinitions();
  return assemblies
    .filter((assembly) => assembly.sourceKind === 'BUILTIN')
    .flatMap((assembly) => {
      const builtinAgent = builtinPackages.find(
        (item) => item.definition.agentId === assembly.agentId && item.definition.agentVersion === assembly.agentVersion,
      );
      const promptRoot = builtinAgent === undefined ? undefined : join(builtinAgent.packageRoot, 'prompts');
      return promptRoot === undefined || !existsSync(promptRoot) || !statSync(promptRoot).isDirectory()
        ? []
        : [
            {
              agentId: String(assembly.agentId),
              agentVersion: String(assembly.agentVersion),
              path: promptRoot,
            },
          ];
    });
}

function compileActiveAgentAssembly(input: AgentDiscoveryAssembliesInput): AgentAssembly {
  const sourceKind = hasLocalAgentDefinition(input.systemConfig, String(input.activeDefinition.agentId)) ? 'LOCAL' : 'BUILTIN';
  return compileAgentAssembly(
    {
      systemConfig: input.systemConfig,
      agentDefinition: input.activeDefinition,
      resourceReferences: input.resourceReferences,
    },
    {
      requireActiveAgentMatch: false,
      sourceKind,
    },
  );
}

function compileBuiltinAgentAssemblies(input: AgentDiscoveryAssembliesInput, primaryAssembly: AgentAssembly): readonly AgentAssembly[] {
  return loadBuiltInAgentPackageDefinitions()
    .map((item) => item.definition)
    .filter((definition) => !sameAssemblyIdentity(definition, primaryAssembly))
    .map((definition) =>
      compileAgentAssembly(
        {
          systemConfig: input.systemConfig,
          agentDefinition: definition,
          resourceReferences: input.resourceReferences,
        },
        { requireActiveAgentMatch: false, sourceKind: 'BUILTIN' },
      ),
    );
}

function compileTopLevelLocalAgents(input: AgentDiscoveryAssembliesInput, primaryAssembly: AgentAssembly): readonly AgentAssembly[] {
  return loadTopLevelLocalDefinitions(input.systemConfig)
    .filter((definition) => !sameAssemblyIdentity(definition, primaryAssembly))
    .flatMap((definition) => compileLocalDefinition(input, definition));
}

function compileParentSubagents(input: AgentDiscoveryAssembliesInput, parentAssembly: AgentAssembly): readonly AgentAssembly[] {
  return loadParentSubagentDefinitions(input.systemConfig, String(parentAssembly.agentId)).flatMap((definition) =>
    compileLocalDefinition(input, definition, parentAssembly),
  );
}

function compileLocalDefinition(
  input: AgentDiscoveryAssembliesInput,
  definition: AgentDefinition,
  parentAssembly?: AgentAssembly,
): readonly AgentAssembly[] {
  try {
    return [
      compileAgentAssembly(
        {
          systemConfig: input.systemConfig,
          agentDefinition: definition,
          resourceReferences: input.resourceReferences,
        },
        {
          requireActiveAgentMatch: false,
          sourceKind: 'LOCAL',
          ...(parentAssembly === undefined
            ? {}
            : {
                userInvocable: false,
                agentInvocation: 'PARENT' as const,
                parentAgentScope: {
                  agentId: parentAssembly.agentId,
                  agentVersion: parentAssembly.agentVersion,
                  agentAssemblyRef: parentAssembly.agentAssemblyRef,
                },
              }),
        },
      ),
    ];
  } catch {
    return [];
  }
}

function loadTopLevelLocalDefinitions(systemConfig: DefaultSystemConfig): readonly AgentDefinition[] {
  const root = systemConfig.paths.agentsRoot;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => loadAgentDefinitionIfPresent(join(root, entry.name, 'agent.yaml')));
}

function loadParentSubagentDefinitions(systemConfig: DefaultSystemConfig, parentAgentId: string): readonly AgentDefinition[] {
  const subagentsRoot = resolve(systemConfig.paths.agentsRoot, parentAgentId, 'subagents');
  if (!existsSync(subagentsRoot) || !statSync(subagentsRoot).isDirectory()) {
    return [];
  }
  return readdirSync(subagentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => loadAgentDefinitionIfPresent(join(subagentsRoot, entry.name, 'agent.yaml')));
}

function loadAgentDefinitionIfPresent(path: string): readonly AgentDefinition[] {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return [];
  }
  try {
    return [parseAgentDefinition(parseBuiltInConfig(readFileSync(path, 'utf8')))];
  } catch {
    return [];
  }
}

function hasLocalAgentDefinition(systemConfig: DefaultSystemConfig, agentId: string): boolean {
  const path = resolve(systemConfig.paths.agentsRoot, agentId, 'agent.yaml');
  return existsSync(path) && statSync(path).isFile();
}

function sameAssemblyIdentity(definition: AgentDefinition, assembly: AgentAssembly): boolean {
  return definition.agentId === assembly.agentId && definition.agentVersion === assembly.agentVersion;
}

function uniqueAssemblies(assemblies: readonly AgentAssembly[]): readonly AgentAssembly[] {
  const seen = new Set<string>();
  const identities = new Set<string>();
  const result: AgentAssembly[] = [];
  for (const assembly of assemblies) {
    const identityKey = `${assembly.agentId}:${assembly.agentVersion}`;
    if (identities.has(identityKey)) {
      throw new Error('Agent assembly identity must be globally unique.');
    }
    identities.add(identityKey);
    const key = `${assembly.sourceKind ?? ''}:${assembly.parentAgentScope?.agentAssemblyRef ?? ''}:${assembly.agentId}:${assembly.agentVersion}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(assembly);
  }
  return result.sort((left, right) => assemblySortKey(left).localeCompare(assemblySortKey(right)));
}

function assemblySortKey(assembly: AgentAssembly): string {
  return `${assembly.sourceKind ?? ''}:${assembly.parentAgentScope?.agentAssemblyRef ?? ''}:${assembly.agentId}:${assembly.agentVersion}`;
}
