import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { LifecycleHook } from '@nextagent/agent-contracts/runtime';
import {
  buildAssemblyScopedLifecycleHookExecutables,
  buildStartupLifecycleHookRegistry,
  createStartupRuntimeLifecycleHookExecutor,
  freezeLifecycleHookDefinitions,
  materializeAgentHookSnapshots,
  systemOutputRedactionGuardHook,
  type LifecycleHookDefinition,
  type RuntimeLifecycleHookExecutor,
} from '@nextagent/agent-runtime';
import { userQueryMemoryRecallHookDefinition, userQueryMemoryRecallHookId } from './user-query-memory-recall-hook.js';

export interface ComposeLifecycleHookDefinitionsInput {
  readonly pluginHooks: readonly LifecycleHook[];
  readonly lifecycleHooks?: readonly LifecycleHook[];
  readonly lifecycleHookDefinitions?: readonly LifecycleHookDefinition[] | undefined;
}

export function composeLifecycleHookDefinitions(input: ComposeLifecycleHookDefinitionsInput) {
  const executableHooks = Object.freeze([systemOutputRedactionGuardHook, ...input.pluginHooks, ...(input.lifecycleHooks ?? [])]);
  const startupLifecycleHooks = buildStartupLifecycleHookRegistry(executableHooks);
  if (
    startupLifecycleHooks.definitions.some((definition) => definition.hookId === userQueryMemoryRecallHookId) ||
    input.lifecycleHookDefinitions?.some((definition) => definition.hookId === userQueryMemoryRecallHookId) === true
  ) {
    throw new Error(`Lifecycle hook id is reserved by agent-app: ${userQueryMemoryRecallHookId}.`);
  }
  return {
    executableHooks,
    startupLifecycleHooks,
    lifecycleHookDefinitions: freezeLifecycleHookDefinitions([
      ...startupLifecycleHooks.definitions,
      userQueryMemoryRecallHookDefinition,
      ...(input.lifecycleHookDefinitions ?? []),
    ]),
  };
}

export interface ComposeLifecycleHookMaterializationInput {
  readonly lifecycleHookDefinitions: readonly LifecycleHookDefinition[];
  readonly agentAssemblies: readonly AgentAssembly[];
  readonly startupLifecycleHooks: ReturnType<typeof buildStartupLifecycleHookRegistry>;
  readonly executableHooks: readonly LifecycleHook[];
  readonly lifecycleHook?: RuntimeLifecycleHookExecutor;
}

export function composeLifecycleHookMaterialization(input: ComposeLifecycleHookMaterializationInput) {
  const lifecycleHookSnapshots = materializeAgentHookSnapshots(input.agentAssemblies, input.lifecycleHookDefinitions);
  const executablesByAssemblyAndHookId = buildAssemblyScopedLifecycleHookExecutables(input.agentAssemblies, input.executableHooks);
  return {
    lifecycleHookSnapshots,
    lifecycleHook: createStartupRuntimeLifecycleHookExecutor(input.startupLifecycleHooks, executablesByAssemblyAndHookId, input.lifecycleHook),
  };
}
