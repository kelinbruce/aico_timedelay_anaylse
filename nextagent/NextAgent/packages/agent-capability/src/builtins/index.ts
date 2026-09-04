import type { CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../tools/tool-spi.js';

import { askUserQuestionToolDefinition } from './ask-user-question/ask-user-question-tool.js';
import { agentToolDefinition } from './agent/agent-tool.js';
import { bashCapabilityId, createBashToolDefinition, type BashToolDefinitionOptions } from './bash/bash-tool.js';
import { cronToolDefinition } from './cron/index.js';
import { editToolDefinition } from './edit/edit-tool.js';
import { globToolDefinition } from './glob/glob-tool.js';
import { grepToolDefinition } from './grep/grep-tool.js';
import { pythonCapabilityId, pythonToolDefinition } from './python/python-tool.js';
import { ragToolDefinition } from './rag/rag-tool.js';
import { readToolDefinition } from './read/read-tool.js';
import { skillToolDefinition } from './skill-tool.js';
import { apiCallToolDefinition } from './api-call-tool.js';
import { todoWriteToolDefinition } from './todo-write/todo-write-tool.js';
import { toolSearchToolDefinition } from './tool-search-tool.js';
import { workflowToolDefinition } from './workflow/workflow-tool.js';
import { writeToolDefinition } from './write/write-tool.js';

export const builtinToolsProvider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' };
export const builtinSkillsProvider: CapabilityProviderIdentity = { providerId: 'builtin-skills', providerKind: 'BUNDLED' };

export const builtinSkillResourceRoot = fileURLToPath(new URL('./skills', import.meta.url));

export interface BuiltinToolDefinitionsOptions extends BashToolDefinitionOptions {}

export function createBuiltinToolDefinitions(options: BuiltinToolDefinitionsOptions = {}): readonly ToolDefinition[] {
  return [
    readToolDefinition,
    writeToolDefinition,
    globToolDefinition,
    grepToolDefinition,
    createBashToolDefinition(
      options.backgroundExecutionEnabled === undefined ? {} : { backgroundExecutionEnabled: options.backgroundExecutionEnabled },
    ),
    pythonToolDefinition,
    editToolDefinition,
    ragToolDefinition,
    skillToolDefinition,
    askUserQuestionToolDefinition,
    agentToolDefinition,
    toolSearchToolDefinition,
    todoWriteToolDefinition,
    workflowToolDefinition,
    apiCallToolDefinition,
    cronToolDefinition,
  ];
}

export const builtinToolDefinitions: readonly ToolDefinition[] = createBuiltinToolDefinitions({});

export function isSandboxExecutionCapabilityId(capabilityId: string): boolean {
  return capabilityId === bashCapabilityId || capabilityId === pythonCapabilityId;
}
