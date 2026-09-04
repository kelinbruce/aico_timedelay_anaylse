import type { AgentId, AgentVersion, CapabilityId, SubjectId, TenantId } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCurrentDiscoveryCriteria, CapabilityDescriptor, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { capabilityDescriptorSchema } from '@nextagent/agent-contracts/capability';
import { Ajv } from 'ajv/dist/ajv.js';

import type { CapabilityDiscovery, CapabilitySearchCriteria } from '../discovery/discovery.js';

export const builtinAgentsProvider: CapabilityProviderIdentity = { providerId: 'builtin-agents', providerKind: 'BUNDLED' };
export const localAgentsProvider: CapabilityProviderIdentity = { providerId: 'local-agents', providerKind: 'LOCAL_DIRECTORY' };
export const localSubagentsProvider: CapabilityProviderIdentity = { providerId: 'local-subagents', providerKind: 'LOCAL_DIRECTORY' };

export interface AgentParentScope {
  readonly tenantId?: TenantId;
  readonly subjectId?: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
}

export interface AgentDiscoverySource {
  listBuiltinAgentAssemblies: (signal: AbortSignal) => Promise<readonly AgentAssembly[]>;
  listTopLevelLocalAgentAssemblies: (signal: AbortSignal) => Promise<readonly AgentAssembly[]>;
  listParentSubagentAssemblies: (parentScope: AgentParentScope, signal: AbortSignal) => Promise<readonly AgentAssembly[]>;
}

export type LocalAgentSourceScope = 'top-level-local' | 'parent-subagent';

export type AgentReadinessOutcomeCode =
  | 'BUILTIN_AGENT_SOURCE_UNAVAILABLE'
  | 'BUILTIN_AGENT_CANDIDATE_INVALID'
  | 'BUILTIN_AGENT_REGISTERED'
  | 'LOCAL_AGENT_SOURCE_UNAVAILABLE'
  | 'LOCAL_AGENT_PARENT_PACKAGE_UNAVAILABLE'
  | 'LOCAL_AGENT_SUBAGENTS_ROOT_MISSING'
  | 'LOCAL_AGENT_CANDIDATE_IGNORED'
  | 'LOCAL_AGENT_DEFINITION_MISSING'
  | 'LOCAL_AGENT_DEFINITION_INVALID'
  | 'LOCAL_AGENT_DUPLICATE_REJECTED'
  | 'LOCAL_AGENT_SHADOWED'
  | 'LOCAL_AGENT_GOVERNANCE_UNAVAILABLE'
  | 'LOCAL_AGENT_REGISTERED';

export interface BuiltinAgentReadinessEvidence {
  readonly providerId: 'builtin-agents';
  readonly providerKind: 'BUNDLED';
  readonly capabilityId?: string;
  readonly outcomeCode: Extract<AgentReadinessOutcomeCode, `BUILTIN_AGENT_${string}`>;
  readonly message: string;
}

export interface LocalAgentReadinessEvidence {
  readonly providerId: 'local-agents' | 'local-subagents';
  readonly providerKind: 'LOCAL_DIRECTORY';
  readonly sourceScope: LocalAgentSourceScope;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly agentAssemblyRef?: string;
  readonly capabilityId?: string;
  readonly version?: string;
  readonly outcomeCode: Extract<AgentReadinessOutcomeCode, `LOCAL_AGENT_${string}`>;
  readonly message: string;
}

export interface BuiltinAgentDiscoveryOptions {
  readonly enabled?: boolean;
  readonly source?: AgentDiscoverySource;
}

export interface LocalAgentDiscoveryOptions {
  readonly enabled?: boolean;
  readonly sourceScope: LocalAgentSourceScope;
  readonly source?: AgentDiscoverySource;
}

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const validateCapabilityDescriptor = new Ajv({ strict: false, allErrors: true }).compile(capabilityDescriptorSchema);

export class BuiltinAgentDiscovery implements CapabilityDiscovery {
  readonly provider = builtinAgentsProvider;
  readonly discoveryMode = 'EAGER' as const;
  private readonly enabled: boolean;
  private readonly source?: AgentDiscoverySource | undefined;
  private readonly readinessEvidence: BuiltinAgentReadinessEvidence[] = [];

  constructor(options: BuiltinAgentDiscoveryOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.source = options.source;
  }

  async listAll(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    this.readinessEvidence.length = 0;
    if (!this.enabled || this.source === undefined || signal.aborted) {
      this.readinessEvidence.push(this.evidence('BUILTIN_AGENT_SOURCE_UNAVAILABLE', 'Builtin Agent source is unavailable.'));
      return [];
    }
    const assemblies = await this.source.listBuiltinAgentAssemblies(signal);
    if (signal.aborted) {
      this.readinessEvidence.push(this.evidence('BUILTIN_AGENT_SOURCE_UNAVAILABLE', 'Builtin Agent source is unavailable.'));
      return [];
    }
    return assemblies.flatMap((assembly) => {
      const descriptor = mapAssemblyToDescriptor(assembly, builtinAgentsProvider);
      if (descriptor === undefined) {
        this.readinessEvidence.push(
          this.evidence('BUILTIN_AGENT_CANDIDATE_INVALID', 'Builtin Agent candidate is invalid.', String(assembly.agentId)),
        );
        return [];
      }
      this.readinessEvidence.push(this.evidence('BUILTIN_AGENT_REGISTERED', 'Builtin Agent capability is registered.', String(assembly.agentId)));
      return [descriptor];
    });
  }

  getReadinessEvidence(): readonly BuiltinAgentReadinessEvidence[] {
    return this.readinessEvidence;
  }

  private evidence(outcomeCode: BuiltinAgentReadinessEvidence['outcomeCode'], message: string, capabilityId?: string): BuiltinAgentReadinessEvidence {
    return {
      providerId: 'builtin-agents',
      providerKind: 'BUNDLED',
      ...(capabilityId === undefined ? {} : { capabilityId }),
      outcomeCode,
      message,
    };
  }
}

export class LocalAgentDiscovery implements CapabilityDiscovery {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: 'EAGER' | 'SEARCH';
  readonly sourceScope: LocalAgentSourceScope;
  private readonly enabled: boolean;
  private readonly source?: AgentDiscoverySource | undefined;
  private readonly readinessEvidence: LocalAgentReadinessEvidence[] = [];
  private readonly readinessEvidenceByScope = new Map<string, LocalAgentReadinessEvidence[]>();

  constructor(options: LocalAgentDiscoveryOptions) {
    this.enabled = options.enabled ?? true;
    this.sourceScope = options.sourceScope;
    this.discoveryMode = options.sourceScope === 'top-level-local' ? 'EAGER' : 'SEARCH';
    this.provider = options.sourceScope === 'top-level-local' ? localAgentsProvider : localSubagentsProvider;
    this.source = options.source;
  }

  async listAll(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (this.sourceScope !== 'top-level-local') {
      return [];
    }
    this.readinessEvidence.length = 0;
    if (!this.enabled || this.source === undefined || signal.aborted) {
      this.readinessEvidence.push(this.evidence('LOCAL_AGENT_SOURCE_UNAVAILABLE', 'Local Agent source is unavailable.'));
      return [];
    }
    const assemblies = await this.source.listTopLevelLocalAgentAssemblies(signal);
    if (signal.aborted) {
      this.readinessEvidence.push(this.evidence('LOCAL_AGENT_SOURCE_UNAVAILABLE', 'Local Agent source is unavailable.'));
      return [];
    }
    return assemblies.flatMap((assembly) => this.mapLocalAssembly(assembly));
  }

  async search(criteria: CapabilitySearchCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (this.sourceScope !== 'parent-subagent') {
      return [];
    }
    const scopeKey = readinessEvidenceKey(criteria);
    this.readinessEvidence.length = 0;
    this.readinessEvidenceByScope.delete(scopeKey);
    if (!this.enabled || this.source === undefined || signal.aborted) {
      this.pushEvidence(this.evidence('LOCAL_AGENT_SOURCE_UNAVAILABLE', 'Local Agent source is unavailable.', criteria), scopeKey);
      return [];
    }
    const assemblies = await this.source.listParentSubagentAssemblies(
      {
        tenantId: criteria.tenantId,
        subjectId: criteria.subjectId,
        agentId: criteria.agentId,
        agentVersion: criteria.agentVersion,
        agentAssemblyRef: criteria.agentAssemblyRef,
      },
      signal,
    );
    if (signal.aborted) {
      this.pushEvidence(this.evidence('LOCAL_AGENT_SOURCE_UNAVAILABLE', 'Local Agent source is unavailable.', criteria), scopeKey);
      return [];
    }
    const descriptors = assemblies
      .filter((assembly) => criteria.requestedCapabilityId === undefined || String(assembly.agentId) === String(criteria.requestedCapabilityId))
      .flatMap((assembly) => this.mapLocalAssembly(assembly, criteria))
      .filter(
        (descriptor) =>
          criteria.modelInvocable === undefined ||
          (criteria.modelInvocable ? descriptor.modelInvocable === true : descriptor.modelInvocable !== true),
      );
    if (descriptors.length === 0 && assemblies.length === 0) {
      this.pushEvidence(this.evidence('LOCAL_AGENT_SUBAGENTS_ROOT_MISSING', 'Local Agent subagents root is missing.', criteria), scopeKey);
    }
    return descriptors;
  }

  async listCurrent(criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (this.sourceScope !== 'parent-subagent' || !this.enabled) {
      return [];
    }
    const scopeKey = readinessEvidenceKey(criteria);
    if (this.source === undefined) {
      this.replaceReadinessEvidence([], scopeKey);
      return [];
    }
    if (signal.aborted) {
      throw new Error('Local subagent current view is unavailable.');
    }
    const assemblies = await this.source.listParentSubagentAssemblies(
      {
        tenantId: criteria.tenantId,
        subjectId: criteria.subjectId,
        agentId: criteria.agentId,
        agentVersion: criteria.agentVersion,
        agentAssemblyRef: criteria.agentAssemblyRef,
      },
      signal,
    );
    if (signal.aborted) {
      throw new Error('Local subagent current view is unavailable.');
    }
    const nextReadinessEvidence: LocalAgentReadinessEvidence[] = [];
    const descriptors = assemblies.flatMap((assembly) => this.mapLocalAssembly(assembly, criteria, nextReadinessEvidence));
    this.replaceReadinessEvidence(nextReadinessEvidence, scopeKey);
    return descriptors.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  }

  getReadinessEvidence(input?: {
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
    readonly agentAssemblyRef: string;
  }): readonly LocalAgentReadinessEvidence[] {
    if (input === undefined) {
      return this.readinessEvidence;
    }
    return this.readinessEvidenceByScope.get(readinessEvidenceKey(input)) ?? [];
  }

  private mapLocalAssembly(
    assembly: AgentAssembly,
    criteria?: CapabilitySearchCriteria,
    nextReadinessEvidence?: LocalAgentReadinessEvidence[],
  ): readonly CapabilityDescriptor[] {
    const descriptor = mapAssemblyToDescriptor(assembly, this.provider);
    if (descriptor === undefined) {
      const evidence = this.evidence(
        'LOCAL_AGENT_DEFINITION_INVALID',
        'Local Agent definition is invalid.',
        criteria,
        String(assembly.agentId),
        String(assembly.agentVersion),
      );
      if (nextReadinessEvidence !== undefined) {
        nextReadinessEvidence.push(evidence);
      } else if (criteria === undefined) {
        this.readinessEvidence.push(evidence);
      } else {
        this.pushEvidence(evidence, readinessEvidenceKey(criteria));
      }
      return [];
    }
    const evidence = this.evidence(
      'LOCAL_AGENT_REGISTERED',
      'Local Agent capability is registered.',
      criteria,
      String(descriptor.capabilityId),
      descriptor.version,
    );
    if (nextReadinessEvidence !== undefined) {
      nextReadinessEvidence.push(evidence);
    } else if (criteria === undefined) {
      this.readinessEvidence.push(evidence);
    } else {
      this.pushEvidence(evidence, readinessEvidenceKey(criteria));
    }
    return [descriptor];
  }

  private pushEvidence(evidence: LocalAgentReadinessEvidence, scopeKey: string): void {
    this.readinessEvidence.push(evidence);
    const scoped = this.readinessEvidenceByScope.get(scopeKey) ?? [];
    scoped.push(evidence);
    this.readinessEvidenceByScope.set(scopeKey, scoped);
  }

  private replaceReadinessEvidence(next: readonly LocalAgentReadinessEvidence[], scopeKey: string): void {
    this.readinessEvidence.length = 0;
    this.readinessEvidence.push(...next);
    if (next.length === 0) {
      this.readinessEvidenceByScope.delete(scopeKey);
    } else {
      this.readinessEvidenceByScope.set(scopeKey, [...next]);
    }
  }

  private evidence(
    outcomeCode: LocalAgentReadinessEvidence['outcomeCode'],
    message: string,
    criteria?: CapabilitySearchCriteria,
    capabilityId?: string,
    version?: string,
  ): LocalAgentReadinessEvidence {
    return {
      providerId: this.provider.providerId as 'local-agents' | 'local-subagents',
      providerKind: 'LOCAL_DIRECTORY',
      sourceScope: this.sourceScope,
      ...(criteria === undefined
        ? {}
        : {
            agentId: criteria.agentId,
            agentVersion: criteria.agentVersion,
            agentAssemblyRef: criteria.agentAssemblyRef,
          }),
      ...(capabilityId === undefined ? {} : { capabilityId }),
      ...(version === undefined ? {} : { version }),
      outcomeCode,
      message,
    };
  }
}

function mapAssemblyToDescriptor(assembly: AgentAssembly, provider: CapabilityProviderIdentity): CapabilityDescriptor | undefined {
  if (
    !safeId.test(String(assembly.agentId)) ||
    !safeId.test(String(assembly.agentVersion)) ||
    assembly.displayName.length === 0 ||
    assembly.description.length === 0
  ) {
    return undefined;
  }
  const descriptor: CapabilityDescriptor = {
    capabilityId: assembly.agentId as unknown as CapabilityId,
    kind: 'AGENT',
    provider,
    version: String(assembly.agentVersion),
    displayName: assembly.displayName,
    ...(assembly.locales === undefined ? {} : { locales: assembly.locales }),
    description: assembly.description,
    modelInvocable: assembly.agentInvocation !== 'NONE',
    availabilityStatus: assembly.agentInvocation === 'NONE' ? 'UNAVAILABLE' : 'AVAILABLE',
    ...(assembly.agentInvocation === 'NONE' ? { availabilityReason: 'Agent is not available for delegation.' } : {}),
  };
  return validateCapabilityDescriptor(descriptor) === true ? descriptor : undefined;
}

function readinessEvidenceKey(input: { readonly agentId: AgentId; readonly agentVersion: AgentVersion; readonly agentAssemblyRef: string }): string {
  return `${input.agentId}\0${input.agentVersion}\0${input.agentAssemblyRef}`;
}

export function createBuiltinAgentDiscoveryForTesting(options: BuiltinAgentDiscoveryOptions = {}): BuiltinAgentDiscovery {
  return new BuiltinAgentDiscovery(options);
}

export function createLocalAgentDiscoveryForTesting(options: LocalAgentDiscoveryOptions): LocalAgentDiscovery {
  return new LocalAgentDiscovery(options);
}
