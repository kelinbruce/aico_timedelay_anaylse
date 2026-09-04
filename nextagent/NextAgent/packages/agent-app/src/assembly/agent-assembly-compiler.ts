import { AgentError, brand } from '@nextagent/agent-common';
import type {
  AgentAssembly,
  AgentAssemblyParentScope,
  AgentAssemblyRegistry,
  AgentAssemblySourceKind,
  AgentInvocationPolicy,
  AgentWorkspaceFilePolicy,
  AgentWorkspacePolicy,
} from '@nextagent/agent-contracts/agent-assembly';
import { isAbsolute, relative, resolve } from 'node:path';
import { hasForbiddenPathSyntax, mergeDirectories } from '@nextagent/agent-capability';
import type { CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AgentDefinition } from './agent-definition.js';
import { createCompiledAgentAssemblyRegistry } from './agent-assembly-registry.js';
import type { HookEffect, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import type { LoadedPluginPolicy } from '../plugin/plugin-loader.js';

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const maxHooksPerStage = 8;

export interface StartupAgentAssemblyCompilerInput {
  readonly systemConfig: DefaultSystemConfig;
  readonly agentDefinition: AgentDefinition;
  readonly resourceReferences: AgentAssemblyResourceReferences;
}

export interface StartupAgentAssemblyGraphValidationInput {
  readonly systemConfig: DefaultSystemConfig;
  readonly assemblies: readonly AgentAssembly[];
  readonly resourceReferences: AgentAssemblyResourceReferences;
}

export interface AgentAssemblyResourceReferences {
  readonly capabilityProviders: readonly CapabilityProviderIdentity[];
  readonly lifecycleHookDefinitions: readonly LifecycleHookDefinition[];
  readonly pluginPolicies?: readonly LoadedPluginPolicy[];
}

export interface StartupAgentAssemblyCompilerOutput {
  readonly assembly: AgentAssembly;
  readonly assemblyRegistry: AgentAssemblyRegistry;
}

export interface AgentAssemblyCompilePolicy {
  readonly requireActiveAgentMatch?: boolean;
  readonly userInvocable?: boolean;
  readonly agentInvocation?: AgentInvocationPolicy;
  readonly sourceKind?: AgentAssemblySourceKind;
  readonly parentAgentScope?: AgentAssemblyParentScope;
}

export class StartupAgentAssemblyCompiler {
  compile(input: StartupAgentAssemblyCompilerInput): StartupAgentAssemblyCompilerOutput {
    const assembly = compileAgentAssembly(input, { requireActiveAgentMatch: true });
    return {
      assembly,
      assemblyRegistry: createCompiledAgentAssemblyRegistry([assembly]),
    };
  }
}

export function compileAgentAssembly(input: StartupAgentAssemblyCompilerInput, policy: AgentAssemblyCompilePolicy = {}): AgentAssembly {
  const modelIds = resolveAgentModelIds(input);
  validateDefinition(input, modelIds);
  const workspacePolicy = defaultAgentWorkspacePolicy(input.agentDefinition.workspaceFiles);
  return {
    agentId: input.agentDefinition.agentId,
    agentType: input.agentDefinition.agentType,
    agentVersion: input.agentDefinition.agentVersion,
    agentAssemblyRef: `${input.agentDefinition.agentId}:${input.agentDefinition.agentVersion}`,
    displayName: input.agentDefinition.displayName,
    ...(input.agentDefinition.locales === undefined ? {} : { locales: input.agentDefinition.locales }),
    description: input.agentDefinition.description,
    workspacePolicy,
    modelIds,
    ...(input.agentDefinition.defaultModelId === undefined ? {} : { defaultModelId: input.agentDefinition.defaultModelId }),
    capabilityBindings: input.agentDefinition.capabilityBindings.map((binding) => ({
      capabilityId: binding.capabilityId,
      capabilityType: binding.capabilityType,
      providerId: binding.providerId,
      enabled: binding.enabled,
      ...(binding.description === undefined ? {} : { description: binding.description }),
    })),
    policies: input.agentDefinition.policies ?? [],
    hooks: input.agentDefinition.hooks ?? [],
    userInvocable: policy.userInvocable ?? input.agentDefinition.userInvocable ?? true,
    agentInvocation: policy.agentInvocation ?? input.agentDefinition.agentInvocation ?? 'BOUND',
    ...(policy.sourceKind === undefined ? {} : { sourceKind: policy.sourceKind }),
    ...(policy.parentAgentScope === undefined ? {} : { parentAgentScope: policy.parentAgentScope }),
    runtimeSettings: input.agentDefinition.runtimeSettings,
    ...(input.agentDefinition.routing === undefined ? {} : { routing: input.agentDefinition.routing }),
  };
}

export function validateStartupAgentAssemblyGraph(input: StartupAgentAssemblyGraphValidationInput): void {
  validateActiveAgent(input);
  for (const assembly of input.assemblies) {
    validateAssemblyInvocationScope(assembly, input.assemblies);
    validateAssemblyModelReferences(assembly, input.systemConfig.modelProfiles);
    validateAssemblyCapabilityProviders(assembly, input.resourceReferences.capabilityProviders);
    validatePolicies(assembly.policies ?? [], input.resourceReferences.pluginPolicies ?? []);
    validateHooks(assembly.hooks ?? [], input.resourceReferences.lifecycleHookDefinitions);
  }
}

export function compileWorkspaceFilePolicy(config: AgentDefinition['workspaceFiles']): AgentWorkspaceFilePolicy {
  if (config?.maxTextBytes !== undefined && (!Number.isInteger(config.maxTextBytes) || config.maxTextBytes < 1 || config.maxTextBytes > 256_000)) {
    throw new Error('Agent workspaceFiles maxTextBytes must be an integer from 1 through 256000.');
  }
  const readDirectories = config?.readDirectories === undefined ? undefined : normalizeDirectories(config.readDirectories);
  const writeDirectories = normalizeDirectories(config?.writeDirectories ?? ['.']);
  return {
    ...(readDirectories === undefined ? {} : { readDirectories }),
    writeDirectories,
    maxTextBytes: config?.maxTextBytes ?? 256_000,
  };
}

export function compileWorkspaceFileExtensionPolicy(config: AgentDefinition['workspaceFiles']) {
  return {
    ...(config?.readAllowedExtensions === undefined ? {} : { readAllowedExtensions: normalizeExtensions(config.readAllowedExtensions) }),
    ...(config?.readDeniedExtensions === undefined ? {} : { readDeniedExtensions: normalizeExtensions(config.readDeniedExtensions) }),
    ...(config?.writeAllowedExtensions === undefined ? {} : { writeAllowedExtensions: normalizeExtensions(config.writeAllowedExtensions) }),
    ...(config?.writeDeniedExtensions === undefined ? {} : { writeDeniedExtensions: normalizeExtensions(config.writeDeniedExtensions) }),
  };
}

function normalizeExtensions(extensions: readonly string[]): readonly string[] {
  if (extensions.some((extension) => !/^\.[a-z0-9]+$/u.test(extension))) {
    throw new Error('Agent workspaceFiles extensions must be lowercase and start with a dot.');
  }
  if (new Set(extensions).size !== extensions.length) {
    throw new Error('Agent workspaceFiles extension lists must not contain duplicates.');
  }
  return [...extensions];
}

function normalizeDirectories(directories: readonly string[]): readonly string[] {
  const normalized = directories.map((directory) => normalizeDirectory(directory));
  return mergeDirectories(normalized, []);
}

function normalizeDirectory(directory: string): string {
  if (directory.length === 0 || (directory !== '.' && hasForbiddenPathSyntax(directory))) {
    throw new Error('Agent workspaceFiles directory must be execution-view-relative without glob syntax.');
  }
  if (isAbsolute(directory)) {
    throw new Error('Agent workspaceFiles directory must be execution-view-relative.');
  }
  const resolved = resolve('/', directory.replaceAll('\\', '/'));
  const relativePath = relative('/', resolved).replaceAll('\\', '/') || '.';
  if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) {
    throw new Error('Agent workspaceFiles directory escapes the execution view.');
  }
  if (relativePath === '.') {
    return 'workspace';
  }
  const root = relativePath.split('/', 1)[0];
  if (root === 'workspace' || root === 'temp' || root === '.nextagent' || root === 'generated-skills' || root === 'shared-data') {
    return relativePath;
  }
  return `workspace/${relativePath}`;
}

export function createStartupAgentAssemblyCompiler(): StartupAgentAssemblyCompiler {
  return new StartupAgentAssemblyCompiler();
}

function resolveAgentModelIds(input: StartupAgentAssemblyCompilerInput): readonly string[] {
  return (
    input.agentDefinition.modelIds ??
    input.systemConfig.modelProfiles.flatMap((providerProfile) => providerProfile.models.map((modelProfile) => modelProfile.modelId))
  );
}

function validateDefinition(input: StartupAgentAssemblyCompilerInput, modelIds: readonly string[]): void {
  const definition = input.agentDefinition;
  assertSafeId(definition.agentId, 'agentId');
  assertSafeId(definition.agentType, 'agentType');
  assertSafeId(definition.agentVersion, 'agentVersion');
  validateLegacyWorkspaceDir(input);
  if (modelIds.length === 0) {
    throw new Error('Agent modelIds must be a non-empty array.');
  }
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error('Agent modelIds must not contain duplicates.');
  }
  for (const id of modelIds) {
    assertSafeId(id, 'resource reference');
  }
  if (definition.defaultModelId !== undefined && !modelIds.includes(definition.defaultModelId)) {
    throw new Error('Agent defaultModelId must belong to modelIds.');
  }
  for (const resource of definition.resources) {
    assertSafeId(resource.resourceId, 'resourceId');
    assertRelativePath(resource.path, 'Agent resource path escapes workspace.');
  }
  for (const binding of definition.capabilityBindings) {
    assertSafeId(binding.capabilityId, 'capabilityId');
    assertSafeId(binding.providerId, 'providerId');
    if (
      binding.capabilityType !== 'TOOL' &&
      binding.capabilityType !== 'SKILL' &&
      binding.capabilityType !== 'AGENT' &&
      binding.capabilityType !== 'WORKFLOW'
    ) {
      throw new Error(`Invalid capability binding: ${binding.capabilityId}.`);
    }
  }
  validateRouting(definition);
  validatePolicyActivationShape(definition.policies ?? []);
  validateHookActivationShape(definition.hooks ?? []);
}

function validateActiveAgent(input: StartupAgentAssemblyGraphValidationInput): void {
  const assembly = input.assemblies.find((item) => item.agentId === input.systemConfig.activeAgentId);
  if (assembly === undefined || assembly.userInvocable !== true || assembly.parentAgentScope !== undefined) {
    throwStartupAssemblyValidationError('AGENT_ASSEMBLY_ACTIVE_UNAVAILABLE', 'User-invocable assembly is unavailable.');
  }
}

function validateAssemblyInvocationScope(assembly: AgentAssembly, assemblies: readonly AgentAssembly[]): void {
  if (assembly.parentAgentScope === undefined) {
    if (assembly.agentInvocation === 'PARENT') {
      throwStartupAssemblyValidationError(
        'AGENT_ASSEMBLY_PARENT_SCOPE_MISSING',
        `Parent-scoped Agent assembly is missing parent scope: ${assembly.agentAssemblyRef}.`,
      );
    }
    return;
  }
  if (assembly.agentInvocation !== 'PARENT' || assembly.userInvocable === true) {
    throwStartupAssemblyValidationError(
      'AGENT_ASSEMBLY_INVOCATION_POLICY_INVALID',
      `Parent-scoped Agent assembly has invalid invocation policy: ${assembly.agentAssemblyRef}.`,
    );
  }
  const parent = assemblies.find(
    (item) =>
      item.agentId === assembly.parentAgentScope?.agentId &&
      item.agentVersion === assembly.parentAgentScope.agentVersion &&
      item.agentAssemblyRef === assembly.parentAgentScope.agentAssemblyRef,
  );
  if (parent === undefined || parent.parentAgentScope !== undefined) {
    throwStartupAssemblyValidationError(
      'AGENT_ASSEMBLY_PARENT_UNAVAILABLE',
      `Parent-scoped Agent assembly references an unavailable parent: ${assembly.agentAssemblyRef}.`,
    );
  }
}

function validateAssemblyModelReferences(assembly: AgentAssembly, modelProfiles: DefaultSystemConfig['modelProfiles']): void {
  if (assembly.modelIds.length === 0 || new Set(assembly.modelIds).size !== assembly.modelIds.length) {
    throwStartupAssemblyValidationError('AGENT_ASSEMBLY_MODEL_IDS_INVALID', 'Agent modelIds must be non-empty and unique.');
  }
  const unknown = assembly.modelIds.find(
    (modelId) => !modelProfiles.some((providerProfile) => providerProfile.models.some((modelProfile) => modelProfile.modelId === modelId)),
  );
  if (unknown !== undefined) {
    throwStartupAssemblyValidationError('AGENT_ASSEMBLY_MODEL_UNKNOWN', `Missing model reference: ${unknown}.`);
  }
  if (assembly.defaultModelId !== undefined && !assembly.modelIds.includes(assembly.defaultModelId)) {
    throwStartupAssemblyValidationError('AGENT_ASSEMBLY_DEFAULT_MODEL_INVALID', 'Agent defaultModelId must belong to modelIds.');
  }
}

function validateAssemblyCapabilityProviders(assembly: AgentAssembly, capabilityProviders: readonly CapabilityProviderIdentity[]): void {
  for (const binding of assembly.capabilityBindings) {
    const provider = capabilityProviders.find((item) => item.providerId === binding.providerId);
    if (provider === undefined) {
      throwStartupAssemblyValidationError(
        'AGENT_ASSEMBLY_CAPABILITY_PROVIDER_UNREGISTERED',
        `Unregistered capability provider: ${binding.providerId}.`,
      );
    }
  }
}

function validatePolicies(
  policies: ReadonlyArray<NonNullable<AgentAssembly['policies']>[number]>,
  pluginPolicies: readonly LoadedPluginPolicy[],
): void {
  const available = new Set(pluginPolicies.map((entry) => `${entry.pluginId}\0${entry.policy.policyPointId}\0${entry.policy.policyId}`));
  const enabledPolicyPoints = new Set<string>();
  for (const policy of policies) {
    if (policy.policyPointId !== 'agentRoutingPolicy') {
      throwStartupAssemblyValidationError('AGENT_ASSEMBLY_POLICY_POINT_UNAVAILABLE', `Unavailable policy point: ${policy.policyPointId}.`);
    }
    if (policy.enabled !== false) {
      if (enabledPolicyPoints.has(policy.policyPointId)) {
        throwStartupAssemblyValidationError('AGENT_ASSEMBLY_POLICY_DUPLICATE', `Duplicate enabled policy point: ${policy.policyPointId}.`);
      }
      enabledPolicyPoints.add(policy.policyPointId);
    }
    if (!available.has(`${policy.pluginId}\0${policy.policyPointId}\0${policy.policyId}`)) {
      throwStartupAssemblyValidationError('AGENT_ASSEMBLY_POLICY_UNREGISTERED', `Unregistered plugin policy: ${policy.policyPointId}.`);
    }
  }
}

function validatePolicyActivationShape(policies: ReadonlyArray<NonNullable<AgentDefinition['policies']>[number]>): void {
  for (const policy of policies) {
    assertSafeId(policy.policyPointId, 'policyPointId');
    assertSafeId(policy.pluginId, 'pluginId');
    assertSafeId(policy.policyId, 'policyId');
    if (policy.timeoutMs !== undefined && (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 60_000)) {
      throwStartupAssemblyValidationError('AGENT_ASSEMBLY_POLICY_TIMEOUT_INVALID', `Invalid policy timeout: ${policy.policyPointId}.`);
    }
  }
}

function validateHookActivationShape(hooks: ReadonlyArray<NonNullable<AgentDefinition['hooks']>[number]>): void {
  const activationsById = new Map<string, NonNullable<AgentDefinition['hooks']>[number]>();
  for (const activation of hooks) {
    assertSafeId(activation.hookId, 'hookId');
    if (activationsById.has(activation.hookId)) {
      throw new Error(`Duplicate lifecycle hook activation: ${activation.hookId}.`);
    }
    activationsById.set(activation.hookId, activation);
    if (activation.enabled === false && activation.disabled === true) {
      throw new Error(`Conflicting lifecycle hook activation flags: ${activation.hookId}.`);
    }
  }
}

function validateHooks(hooks: ReadonlyArray<NonNullable<AgentAssembly['hooks']>[number]>, definitions: readonly LifecycleHookDefinition[]): void {
  const definitionsById = new Map<string, LifecycleHookDefinition>();
  for (const hookDefinition of definitions) {
    if (definitionsById.has(hookDefinition.hookId)) {
      throwStartupAssemblyValidationError('LIFECYCLE_HOOK_DEFINITION_DUPLICATE', `Duplicate lifecycle hook definition: ${hookDefinition.hookId}.`);
    }
    definitionsById.set(hookDefinition.hookId, hookDefinition);
  }
  const activationsById = new Map<string, NonNullable<AgentDefinition['hooks']>[number]>();
  for (const activation of hooks) {
    assertSafeId(activation.hookId, 'hookId');
    if (activationsById.has(activation.hookId)) {
      throwStartupAssemblyValidationError('LIFECYCLE_HOOK_ACTIVATION_DUPLICATE', `Duplicate lifecycle hook activation: ${activation.hookId}.`);
    }
    activationsById.set(activation.hookId, activation);
    if (activation.enabled === false && activation.disabled === true) {
      throwStartupAssemblyValidationError(
        'LIFECYCLE_HOOK_ACTIVATION_FLAGS_CONFLICT',
        `Conflicting lifecycle hook activation flags: ${activation.hookId}.`,
      );
    }
    const hookDefinition = definitionsById.get(activation.hookId);
    if (hookDefinition === undefined) {
      throwStartupAssemblyValidationError('LIFECYCLE_HOOK_UNKNOWN', `Unknown lifecycle hook: ${activation.hookId}.`);
    }
    if (hookDefinition.kind === 'SYSTEM' && activation.order !== undefined) {
      throwStartupAssemblyValidationError(
        'LIFECYCLE_HOOK_SYSTEM_ORDER_DENIED',
        `SYSTEM lifecycle hook order is framework-owned: ${activation.hookId}.`,
      );
    }
    const stages = activation.stages ?? hookDefinition.supportedStages;
    if (stages.length === 0) {
      throwStartupAssemblyValidationError('LIFECYCLE_HOOK_STAGES_EMPTY', `Lifecycle hook activation stages must be non-empty: ${activation.hookId}.`);
    }
    for (const stage of stages) {
      if (!hookDefinition.supportedStages.includes(stage)) {
        throwStartupAssemblyValidationError(
          'LIFECYCLE_HOOK_STAGE_UNSUPPORTED',
          `Lifecycle hook activation stage is not supported by definition: ${activation.hookId}.`,
        );
      }
    }
    if (activation.order !== undefined) {
      validateHookOrderTargets(
        activation.hookId,
        activation.order.before,
        hooks,
        definitionsById,
        stages,
        hookDefinition.kind,
        hookDefinition.effects,
      );
      validateHookOrderTargets(
        activation.hookId,
        activation.order.after,
        hooks,
        definitionsById,
        stages,
        hookDefinition.kind,
        hookDefinition.effects,
      );
    }
  }
  for (const stage of lifecycleStages(definitions)) {
    const count = definitions.filter((hookDefinition) => {
      if (!hookDefinition.supportedStages.includes(stage)) {
        return false;
      }
      const activation = activationsById.get(hookDefinition.hookId);
      if (hookDefinition.kind === 'CUSTOM' && activation === undefined) {
        return false;
      }
      if (activation?.enabled === false || activation?.disabled === true) {
        return false;
      }
      return activation?.stages === undefined || activation.stages.includes(stage);
    }).length;
    if (count > maxHooksPerStage) {
      throwStartupAssemblyValidationError('LIFECYCLE_HOOK_STAGE_LIMIT_EXCEEDED', `Lifecycle hook count exceeds maxHooksPerStage for ${stage}.`);
    }
  }
}

function throwStartupAssemblyValidationError(code: string, message: string): never {
  throw new AgentError({ code, message, category: 'VALIDATION', retryable: false });
}

function validateHookOrderTargets(
  hookId: string,
  rawTargets: string | readonly string[] | undefined,
  activations: ReadonlyArray<NonNullable<AgentAssembly['hooks']>[number]>,
  definitionsById: ReadonlyMap<string, LifecycleHookDefinition>,
  stages: ReadonlyArray<LifecycleHookDefinition['supportedStages'][number]>,
  kind: LifecycleHookDefinition['kind'],
  sourceEffects: readonly HookEffect[],
): void {
  const targets = rawTargets === undefined ? [] : typeof rawTargets === 'string' ? [rawTargets] : [...rawTargets];
  for (const target of targets) {
    const targetActivation = activations.find((activation) => activation.hookId === target);
    const targetDefinition = definitionsById.get(target);
    if (targetActivation === undefined || targetDefinition === undefined) {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_ORDER_TARGET_UNKNOWN',
        message: `Unknown lifecycle hook order target: ${target}.`,
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (targetActivation.enabled === false || targetActivation.disabled === true) {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_ORDER_TARGET_DISABLED',
        message: `Lifecycle hook order target is disabled: ${target}.`,
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (targetDefinition.kind !== kind || kind === 'SYSTEM') {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_ORDER_CROSS_KIND',
        message: `Lifecycle hook order target must be in the same CUSTOM group: ${hookId}.`,
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (isObserveOnlyEffects(sourceEffects) !== isObserveOnlyEffects(targetDefinition.effects)) {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_ORDER_CROSS_EFFECT_GROUP',
        message: `Lifecycle hook order target ${target} is in a different effect group.`,
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const targetStages = targetActivation.stages ?? targetDefinition.supportedStages;
    if (!stages.some((stage) => targetStages.includes(stage))) {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_ORDER_TARGET_UNKNOWN',
        message: `Lifecycle hook order target is not effective in the same stage: ${hookId}.`,
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
}

function isObserveOnlyEffects(effects: readonly HookEffect[]): boolean {
  return effects.length === 1 && effects[0] === 'OBSERVE';
}

function lifecycleStages(definitions: readonly LifecycleHookDefinition[]): ReadonlyArray<LifecycleHookDefinition['supportedStages'][number]> {
  return [...new Set(definitions.flatMap((definition) => definition.supportedStages))];
}

function validateRouting(definition: AgentDefinition): void {
  const routing = definition.routing;
  if (routing === undefined || routing.mode === undefined || routing.mode === 'default') {
    return;
  }
  if (routing.mode !== 'policy') {
    throw new Error('Agent routing mode must be default or policy.');
  }
  if (routing.policy === undefined) {
    throw new Error('Agent routing policy configuration is required when routing mode is policy.');
  }
  if (routing.policy.method !== 'policy:intent-recognition') {
    throw new Error('Agent routing policy method must be policy:intent-recognition.');
  }
}

function assertSafeId(value: string, name: string): void {
  if (!safeId.test(value)) {
    throw new Error(`Unsafe ${name}: ${value}.`);
  }
}

function validateLegacyWorkspaceDir(input: StartupAgentAssemblyCompilerInput): void {
  const value = input.agentDefinition.workspaceDir;
  if (value === undefined) {
    return;
  }
  if (value.trim().length === 0 || isAbsolute(value) || hasForbiddenPathSyntax(value)) {
    throw new Error('Legacy agent workspaceDir must be a safe relative compatibility field.');
  }
  assertRelativePath(value, 'Legacy agent workspaceDir must not imply a physical execution root.');
  const lowered = value.replaceAll('\\', '/').toLowerCase();
  if (
    lowered.startsWith('skills/') ||
    lowered === 'skills' ||
    lowered.startsWith('agents/') ||
    lowered === 'agents' ||
    lowered.startsWith('data/') ||
    lowered === 'data'
  ) {
    throw new Error('Legacy agent workspaceDir must not point at a system or source directory.');
  }
}

function assertRelativePath(candidate: string, message: string): void {
  if (candidate.trim().length === 0 || isAbsolute(candidate) || hasForbiddenPathSyntax(candidate)) {
    throw new Error(message);
  }
  const resolved = resolve('/', candidate.replaceAll('\\', '/'));
  const path = relative('/', resolved).replaceAll('\\', '/');
  if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
    throw new Error(message);
  }
}

function defaultAgentWorkspacePolicy(workspaceFiles: AgentDefinition['workspaceFiles']): AgentWorkspacePolicy {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1',
    isolationMode: 'subject',
    roots: [
      { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
      { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
      { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      { kind: 'generatedSkills', logicalPath: 'generated-skills', access: 'readWrite' },
    ],
    files: compileWorkspaceFilePolicy(workspaceFiles),
  };
}
