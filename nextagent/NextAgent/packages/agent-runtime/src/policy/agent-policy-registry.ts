import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import { type JsonObject } from '@nextagent/agent-common';
import type {
  AgentPolicyContribution,
  AgentPolicyDefinition,
  AgentPolicyExecutableByPoint,
  AgentPolicyPointId,
  AgentPolicyResolution,
  AgentPolicyResolutionRequest,
  AgentPolicyResolverPort,
} from '@nextagent/agent-contracts/runtime';
import { Ajv } from 'ajv/dist/ajv.js';

const policyConfigSchemaAjv = new Ajv({ allErrors: true, strict: false });

export interface StartupAgentPolicyRegistry {
  readonly policiesByKey: ReadonlyMap<string, AgentPolicyDefinition>;
  readonly executablesByKey: ReadonlyMap<string, AgentPolicyExecutableByPoint[AgentPolicyPointId]>;
}

export function buildStartupAgentPolicyRegistry(policyContributions: readonly AgentPolicyContribution[]): StartupAgentPolicyRegistry {
  const policiesByKey = new Map<string, AgentPolicyDefinition>();
  const executablesByKey = new Map<string, AgentPolicyExecutableByPoint[AgentPolicyPointId]>();
  for (const entry of policyContributions) {
    const key = agentPolicyKey(entry.pluginId, entry.policy.policyPointId, entry.policy.policyId);
    validateAgentPolicyExecutable(entry.policy.policyPointId, entry.policy);
    const executable = configureAgentPolicy(entry.policy, {});
    validateAgentPolicyExecutable(entry.policy.policyPointId, executable);
    policiesByKey.set(key, entry.policy);
    executablesByKey.set(key, executable);
  }
  return {
    policiesByKey,
    executablesByKey,
  };
}

export function buildAssemblyScopedAgentPolicyExecutables(
  assemblies: readonly AgentAssembly[],
  startupPolicies: StartupAgentPolicyRegistry,
): ReadonlyMap<string, AgentPolicyExecutableByPoint[AgentPolicyPointId]> {
  const executablesByAssemblyAndPolicy = new Map<string, AgentPolicyExecutableByPoint[AgentPolicyPointId]>();
  for (const assembly of assemblies) {
    for (const activation of assembly.policies ?? []) {
      if (activation.config === undefined) {
        continue;
      }
      const policy = startupPolicies.policiesByKey.get(agentPolicyKey(activation.pluginId, activation.policyPointId, activation.policyId));
      if (policy === undefined) {
        continue;
      }
      validateAgentPolicyConfig(policy, activation.config);
      const executable = configureAgentPolicy(policy, activation.config);
      validateAgentPolicyExecutable(activation.policyPointId, executable);
      executablesByAssemblyAndPolicy.set(
        assemblyAgentPolicyKey(assembly.agentAssemblyRef, activation.policyPointId, activation.pluginId, activation.policyId),
        executable,
      );
    }
  }
  return executablesByAssemblyAndPolicy;
}

export function createAgentPolicyResolver(input: {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly policyContributions: readonly AgentPolicyContribution[];
  readonly assemblies?: readonly AgentAssembly[];
}): AgentPolicyResolverPort {
  const startupPolicies = buildStartupAgentPolicyRegistry(input.policyContributions);
  const assemblyExecutables = buildAssemblyScopedAgentPolicyExecutables(input.assemblies ?? [], startupPolicies);

  return {
    async resolve<TPolicyPointId extends AgentPolicyPointId>(
      request: AgentPolicyResolutionRequest<TPolicyPointId>,
    ): Promise<AgentPolicyResolution<TPolicyPointId> | undefined> {
      const assembly = await input.assemblyRegistry.require(request.agentId, request.agentVersion);
      if (assembly.agentAssemblyRef !== request.agentAssemblyRef) {
        throw new Error(`Agent policy assembly ref mismatch: ${request.agentId}:${request.agentVersion}.`);
      }

      const activations = (assembly.policies ?? []).filter((policy) => policy.enabled !== false && policy.policyPointId === request.policyPointId);
      if (activations.length === 0) {
        return undefined;
      }
      if (activations.length > 1) {
        throw new Error(`Agent policy activation is duplicated: ${request.policyPointId}.`);
      }

      const activation = activations[0]!;
      const key = agentPolicyKey(activation.pluginId, activation.policyPointId, activation.policyId);
      const policy = startupPolicies.policiesByKey.get(key) as AgentPolicyDefinition<TPolicyPointId> | undefined;
      const executable =
        assemblyExecutables.get(
          assemblyAgentPolicyKey(assembly.agentAssemblyRef, activation.policyPointId, activation.pluginId, activation.policyId),
        ) ?? (startupPolicies.executablesByKey.get(key) as AgentPolicyExecutableByPoint[TPolicyPointId] | undefined);
      if (policy === undefined || executable === undefined || !isAgentPolicyExecutable(activation.policyPointId, executable)) {
        throw new Error(`Agent policy implementation is unavailable: ${activation.policyPointId}:${activation.policyId}.`);
      }
      return { assembly, activation, policy, executable };
    },
  };
}

function configureAgentPolicy(policy: AgentPolicyDefinition, config: JsonObject): AgentPolicyExecutableByPoint[AgentPolicyPointId] {
  return policy.configure?.(freezeJsonObject(config)) ?? policy;
}

function validateAgentPolicyConfig(policy: AgentPolicyDefinition, config: JsonObject): void {
  if (policy.configSchema === undefined) {
    return;
  }
  let valid = false;
  try {
    valid = policyConfigSchemaAjv.validate(policy.configSchema, config);
  } catch {
    throw new Error(`Plugin policy config schema is invalid: ${policy.policyPointId}:${policy.policyId}.`);
  }
  if (!valid) {
    throw new Error(`Plugin policy config is invalid: ${policy.policyPointId}:${policy.policyId}.`);
  }
}

function validateAgentPolicyExecutable(policyPointId: string, executable: unknown): void {
  if (!isAgentPolicyExecutable(policyPointId, executable)) {
    throw new Error(`Plugin policy executable is invalid: ${policyPointId}.`);
  }
}

function isAgentPolicyExecutable(policyPointId: string, executable: unknown): boolean {
  if (policyPointId === 'agentRoutingPolicy') {
    return executable !== null && typeof executable === 'object' && typeof (executable as { readonly decide?: unknown }).decide === 'function';
  }
  return false;
}

function freezeJsonObject<T extends JsonObject>(value: T): T {
  return freezeJsonValue({ ...value }) as T;
}

function freezeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeJsonValue(item)));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, freezeJsonValue(item)] as const);
    return Object.freeze(Object.fromEntries(entries));
  }
  return value;
}

function agentPolicyKey(pluginId: string, policyPointId: string, policyId: string): string {
  return `${pluginId}\0${policyPointId}\0${policyId}`;
}

function assemblyAgentPolicyKey(agentAssemblyRef: string, policyPointId: string, pluginId: string, policyId: string): string {
  return `${agentAssemblyRef}\0${policyPointId}\0${pluginId}\0${policyId}`;
}
