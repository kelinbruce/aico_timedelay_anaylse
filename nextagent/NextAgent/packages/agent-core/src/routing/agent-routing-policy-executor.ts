import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { AgentRoutingDecision as PublicAgentRoutingDecision, AgentRoutingPolicyResult } from '@nextagent/agent-contracts/core';
import type { AgentPolicyResolution, AgentPolicyResolverPort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { type AgentRoutingDecision, DefaultAgentRoutingPolicy } from './agent-routing-policy.js';

export async function decideAgentRoutingPolicy(input: {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly capabilityCatalog: CapabilityCatalog;
  readonly policyResolver?: AgentPolicyResolverPort;
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly signal: AbortSignal;
}): Promise<AgentRoutingDecision> {
  const defaultPolicy = new DefaultAgentRoutingPolicy(input.assemblyRegistry, input.capabilityCatalog);
  const result = await defaultPolicy.resolveExplicitRouting(input.run, input.context, input.signal);
  if (result.decision !== undefined) {
    return result.decision;
  }
  if (input.policyResolver === undefined) {
    return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'DEFAULT_MODEL_DRIVEN_LOOP', acceptedAssembly: result.acceptedAssembly };
  }

  const resolution = await input.policyResolver.resolve({
    agentId: input.run.agentId,
    agentVersion: input.run.agentVersion,
    agentAssemblyRef: input.run.agentAssemblyRef,
    policyPointId: 'agentRoutingPolicy',
  });
  return resolution === undefined
    ? { kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'DEFAULT_MODEL_DRIVEN_LOOP', acceptedAssembly: result.acceptedAssembly }
    : executeResolvedAgentRoutingPolicy(resolution, input);
}

async function executeResolvedAgentRoutingPolicy(
  resolution: AgentPolicyResolution<'agentRoutingPolicy'>,
  input: {
    readonly run: RequestRun;
    readonly context: RequestContext;
    readonly signal: AbortSignal;
  },
): Promise<AgentRoutingDecision> {
  const { assembly, activation, policy, executable } = resolution;
  try {
    const timeoutMs = activation.timeoutMs ?? policy.timeoutMs ?? 3_000;
    const result = await withTimeout(executable.decide(input.run, input.context, input.signal), timeoutMs);
    if (!isValidPluginRoutingResult(result)) {
      return rejectRouting(assembly, 'PLUGIN_ROUTING_POLICY_INVALID_RESULT');
    }
    return {
      ...result,
      acceptedAssembly: assembly,
    };
  } catch {
    return rejectRouting(assembly, 'PLUGIN_ROUTING_POLICY_FAILED');
  }
}

function rejectRouting(acceptedAssembly: AgentAssembly | undefined, safeReason: string): AgentRoutingDecision {
  return {
    kind: 'REJECT',
    safeReason,
    ...(acceptedAssembly === undefined ? {} : { acceptedAssembly }),
  };
}

async function withTimeout<T>(value: Promise<T> | T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Plugin routing policy timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function isValidPluginRoutingResult(value: AgentRoutingPolicyResult): value is PublicAgentRoutingDecision {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const allowedKinds = new Set(['DETERMINISTIC_FLOW', 'MODEL_DRIVEN_LOOP', 'CLARIFY', 'REJECT', 'HUMAN_HANDOFF']);
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  const optionalString = (field: string): boolean => record[field] === undefined || typeof record[field] === 'string';
  return (
    keys.every((key) => ['kind', 'safeReason', 'evidenceRef', 'skillName', 'recipeName'].includes(key)) &&
    allowedKinds.has((record['kind'] as string | undefined) ?? '') &&
    typeof record['safeReason'] === 'string' &&
    optionalString('evidenceRef') &&
    optionalString('skillName') &&
    optionalString('recipeName')
  );
}
