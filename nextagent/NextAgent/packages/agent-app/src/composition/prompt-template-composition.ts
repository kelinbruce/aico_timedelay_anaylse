import {
  createDefaultPromptTemplateAssembler,
  createDefaultPromptTemplateRegistry,
  createPromptTemplateResolver,
} from '@nextagent/agent-context-engine';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { builtinAgentPromptTemplateRegistrations } from '../assembly/agent-discovery-source.js';
import type { AgentDefinition } from '../assembly/agent-definition.js';
import type { DefaultSystemConfig } from '../config/component-config.js';

export interface ComposePromptTemplateLayerInput {
  readonly systemConfig: DefaultSystemConfig;
  readonly agentDefinition: AgentDefinition;
  readonly agentAssemblies: readonly AgentAssembly[];
}

export function composePromptTemplateLayer(input: ComposePromptTemplateLayerInput) {
  const promptTemplateRegistry = createDefaultPromptTemplateRegistry();
  const promptRoot = trustedAgentPromptRoot(input.systemConfig, input.agentDefinition);
  if (promptRoot !== undefined) {
    promptTemplateRegistry.register({
      agentId: input.agentDefinition.agentId,
      agentVersion: input.agentDefinition.agentVersion,
      path: promptRoot,
    });
  }
  for (const registration of builtinAgentPromptTemplateRegistrations(input.agentAssemblies)) {
    promptTemplateRegistry.register(registration);
  }
  const promptTemplateAssembler = createDefaultPromptTemplateAssembler(promptTemplateRegistry);
  return {
    promptTemplateRegistry,
    promptTemplateAssembler,
    promptTemplateResolver: createPromptTemplateResolver(promptTemplateAssembler),
  };
}

function trustedAgentPromptRoot(systemConfig: DefaultSystemConfig, agentDefinition: AgentDefinition): string | undefined {
  const agentRoot = resolve(systemConfig.paths.agentsRoot, agentDefinition.agentId);
  const promptRoot = resolve(agentRoot, 'prompts');
  const relativePromptRoot = relative(agentRoot, promptRoot);
  if (relativePromptRoot.startsWith('..') || isAbsolute(relativePromptRoot)) {
    throw new Error('Agent prompt root escapes package root.');
  }
  if (!existsSync(promptRoot)) {
    return undefined;
  }
  if (!statSync(promptRoot).isDirectory()) {
    throw new Error('Agent prompt root must be a directory.');
  }
  return promptRoot;
}
