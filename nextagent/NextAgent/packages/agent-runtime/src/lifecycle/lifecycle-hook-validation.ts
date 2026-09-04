import type {
  HookEffect,
  HookFailureMode,
  HookKind,
  LifecycleHook,
  LifecycleHookDefinition,
  LifecycleStage,
} from '@nextagent/agent-contracts/runtime';
import type { JsonObject } from '@nextagent/agent-common';
import { runtimeLifecycleStages } from '@nextagent/agent-contracts/runtime';

export function defineLifecycleHook<const TStages extends readonly LifecycleStage[]>(hook: LifecycleHook<TStages>): LifecycleHook<TStages> {
  validateLifecycleHookObject(hook);
  return hook;
}

export function hookExecutionStrategy(effects: readonly HookEffect[]): 'OBSERVE_PARALLEL' | 'SERIAL_IMPACT' {
  return effects.length === 1 && effects[0] === 'OBSERVE' ? 'OBSERVE_PARALLEL' : 'SERIAL_IMPACT';
}

export function validateLifecycleHookDefinition(definition: LifecycleHookDefinition): void {
  assertSafeLifecycleHookId(definition.hookId);
  assertKnownHookKind(definition.kind);
  assertKnownFailureMode(definition.failureMode);
  assertKnownLifecycleHookEffects(definition.effects);
  assertKnownLifecycleHookStages(definition.supportedStages);
  if (definition.executionStrategy !== hookExecutionStrategy(definition.effects)) {
    throw new Error('Lifecycle hook execution strategy must be derived from effects.');
  }
  if (definition.kind === 'SYSTEM' && definition.failureMode !== 'FAIL') {
    throw new Error('SYSTEM lifecycle hooks must use FAIL failure mode.');
  }
  if (definition.kind === 'SYSTEM' && (definition.order === undefined || !Number.isSafeInteger(definition.order))) {
    throw new Error('SYSTEM lifecycle hooks must declare framework order.');
  }
  if (definition.kind === 'CUSTOM' && definition.order !== undefined) {
    throw new Error('CUSTOM lifecycle hook definitions must not declare framework order.');
  }
  if (definition.timeoutMs !== undefined && (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0)) {
    throw new Error('Lifecycle hook timeoutMs must be a positive safe integer.');
  }
}

function validateLifecycleHookObject(hook: LifecycleHook): void {
  assertSafeLifecycleHookId(hook.hookId);
  assertKnownHookKind(hook.kind);
  assertKnownFailureMode(hook.failureMode);
  assertKnownLifecycleHookEffects(hook.effects);
  assertKnownLifecycleHookStages(hook.supportedStages);
  if (typeof hook.execute !== 'function') {
    throw new Error('Lifecycle hook execute must be a function.');
  }
  if (hook.kind === 'SYSTEM' && hook.failureMode !== 'FAIL') {
    throw new Error('SYSTEM lifecycle hooks must use FAIL failure mode.');
  }
  if (hook.kind === 'SYSTEM' && (hook.order?.priority === undefined || !Number.isSafeInteger(hook.order.priority))) {
    throw new Error('SYSTEM lifecycle hooks must declare framework order.');
  }
  if (hook.kind === 'CUSTOM' && hook.order !== undefined) {
    throw new Error('CUSTOM lifecycle hook objects must not declare framework order.');
  }
  if (hook.timeoutMs !== undefined && (!Number.isSafeInteger(hook.timeoutMs) || hook.timeoutMs <= 0)) {
    throw new Error('Lifecycle hook timeoutMs must be a positive safe integer.');
  }
  if (hook.configSchema !== undefined && !isJsonObjectValue(hook.configSchema)) {
    throw new Error('Lifecycle hook configSchema must be a JSON object.');
  }
  if (hook.configure !== undefined && typeof hook.configure !== 'function') {
    throw new Error('Lifecycle hook configure must be a function.');
  }
}

function assertSafeLifecycleHookId(hookId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(hookId)) {
    throw new Error('Lifecycle hook hookId must be a safe stable identifier.');
  }
}

function assertKnownHookKind(kind: HookKind): void {
  if (kind !== 'SYSTEM' && kind !== 'CUSTOM') {
    throw new Error('Lifecycle hook kind is unsupported.');
  }
}

function assertKnownFailureMode(failureMode: HookFailureMode): void {
  if (failureMode !== 'CONTINUE' && failureMode !== 'FAIL') {
    throw new Error('Lifecycle hook failureMode is unsupported.');
  }
}

function assertKnownLifecycleHookEffects(effects: readonly HookEffect[]): void {
  if (effects.length === 0 || new Set(effects).size !== effects.length) {
    throw new Error('Lifecycle hook effects must be non-empty and unique.');
  }
  for (const effect of effects) {
    if (effect !== 'OBSERVE' && effect !== 'TRANSFORM' && effect !== 'CONTROL') {
      throw new Error('Lifecycle hook effect is unsupported.');
    }
  }
}

function assertKnownLifecycleHookStages(stages: readonly LifecycleStage[]): void {
  if (stages.length === 0 || new Set(stages).size !== stages.length) {
    throw new Error('Lifecycle hook supportedStages must be non-empty and unique.');
  }
  for (const stage of stages) {
    if (!runtimeLifecycleStages.includes(stage)) {
      throw new Error('Lifecycle hook stage is unsupported.');
    }
  }
}

function isJsonObjectValue(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
