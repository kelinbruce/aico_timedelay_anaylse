import { AgentError, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { HookInput, HookResult, LifecycleHook, LifecycleHookDefinition, LifecycleHookExecutable } from '@nextagent/agent-contracts/runtime';
import { hookExecutionStrategy, validateLifecycleHookDefinition } from './lifecycle-hook-validation.js';
import type { RuntimeLifecycleHookExecutor } from './lifecycle-hooks.js';
import { Ajv } from 'ajv/dist/ajv.js';

const hookConfigSchemaAjv = new Ajv({ allErrors: true, strict: false });

export interface StartupLifecycleHookRegistry {
  readonly definitions: readonly LifecycleHookDefinition[];
  readonly executablesByHookId: ReadonlyMap<string, LifecycleHookExecutable>;
}

export function freezeLifecycleHookDefinitions(definitions?: readonly LifecycleHookDefinition[]): readonly LifecycleHookDefinition[] | undefined {
  if (definitions === undefined) {
    return undefined;
  }
  return Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        ...definition,
        supportedStages: Object.freeze([...definition.supportedStages]),
        effects: Object.freeze([...definition.effects]),
      }),
    ),
  );
}

export function buildStartupLifecycleHookRegistry(hooks: readonly LifecycleHook[]): StartupLifecycleHookRegistry {
  const definitions: LifecycleHookDefinition[] = [];
  const executablesByHookId = new Map<string, LifecycleHookExecutable>();
  const hookIds = new Set<string>();
  for (const hook of hooks) {
    if (hookIds.has(hook.hookId)) {
      throw new Error(`Duplicate lifecycle hook definition: ${hook.hookId}.`);
    }
    hookIds.add(hook.hookId);
    const definition: LifecycleHookDefinition = {
      hookId: hook.hookId,
      kind: hook.kind,
      supportedStages: hook.supportedStages,
      effects: hook.effects,
      executionStrategy: hookExecutionStrategy(hook.effects),
      failureMode: hook.failureMode,
      ...(hook.order?.priority === undefined ? {} : { order: hook.order.priority }),
      ...(hook.timeoutMs === undefined ? {} : { timeoutMs: hook.timeoutMs }),
    };
    validateLifecycleHookDefinition(definition);
    definitions.push(definition);
    executablesByHookId.set(hook.hookId, configureLifecycleHook(hook, {}));
  }
  return {
    definitions: freezeLifecycleHookDefinitions(definitions) ?? [],
    executablesByHookId,
  };
}

export function buildAssemblyScopedLifecycleHookExecutables(
  assemblies: readonly AgentAssembly[],
  hooks: readonly LifecycleHook[],
): ReadonlyMap<string, LifecycleHookExecutable> {
  const hookById = new Map(hooks.map((hook) => [hook.hookId, hook] as const));
  const executablesByAssemblyAndHookId = new Map<string, LifecycleHookExecutable>();
  for (const assembly of assemblies) {
    for (const activation of assembly.hooks ?? []) {
      const hook = hookById.get(activation.hookId);
      if (hook === undefined || activation.config === undefined) {
        continue;
      }
      validateLifecycleHookConfig(hook, activation.config);
      executablesByAssemblyAndHookId.set(`${assembly.agentAssemblyRef}:${activation.hookId}`, configureLifecycleHook(hook, activation.config));
    }
  }
  return executablesByAssemblyAndHookId;
}

export function createStartupRuntimeLifecycleHookExecutor(
  startupHooks: StartupLifecycleHookRegistry,
  executablesByAssemblyAndHookId: ReadonlyMap<string, LifecycleHookExecutable>,
  delegate?: RuntimeLifecycleHookExecutor,
): RuntimeLifecycleHookExecutor {
  return {
    async invoke(input: HookInput, signal?: AbortSignal): Promise<HookResult> {
      const assemblyExecutable =
        input.agentAssemblyRef === undefined ? undefined : executablesByAssemblyAndHookId.get(`${input.agentAssemblyRef}:${input.hookId}`);
      const executable = assemblyExecutable ?? startupHooks.executablesByHookId.get(input.hookId);
      if (executable !== undefined) {
        return await executable.execute(input, signal);
      }
      if (delegate !== undefined) {
        return delegate.invoke(input, signal);
      }
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_UNAVAILABLE',
        message: `Lifecycle hook "${input.hookId}" is not registered.`,
        category: 'UNAVAILABLE',
        retryable: false,
      });
    },
  };
}

function configureLifecycleHook(hook: LifecycleHook, config: JsonObject): LifecycleHookExecutable {
  const executable = hook.configure?.(freezeJsonObject(config)) ?? hook;
  if (typeof executable.execute !== 'function') {
    throw new Error(`Lifecycle hook executable is invalid: ${hook.hookId}.`);
  }
  return executable;
}

function validateLifecycleHookConfig(hook: LifecycleHook, config: JsonObject): void {
  const schema = hook.configSchema;
  if (schema === undefined) {
    return;
  }
  let valid = false;
  try {
    valid = hookConfigSchemaAjv.validate(schema, config);
  } catch {
    throw new Error(`Lifecycle hook config schema is invalid: ${hook.hookId}.`);
  }
  if (!valid) {
    throw new Error(`Lifecycle hook config is invalid: ${hook.hookId}.`);
  }
}

function freezeJsonObject<T extends JsonObject>(value: T): T {
  return freezeJsonValue({ ...value }) as T;
}

function freezeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeJsonValue(item)));
  }
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = freezeJsonValue(item);
    }
    return Object.freeze(clone);
  }
  return value;
}
