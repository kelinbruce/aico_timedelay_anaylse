import type {
  CapabilityCatalog,
  CapabilityCatalogRequest,
  CapabilityCurrentViewPort,
  CapabilityCurrentViewRequest,
  CapabilityDescriptor,
  CapabilityResolveRequest,
} from '@nextagent/agent-contracts/capability';

import { resolveConflictGroup } from './conflict-resolution.js';

export interface SkillScanFailure {
  readonly skillId?: string;
  readonly outcomeCode: string;
  readonly message: string;
}

export interface SkillScanSourceReport {
  readonly providerId: string;
  readonly scanRoot: string;
  readonly discovered: readonly string[];
  readonly failures: readonly SkillScanFailure[];
}

export interface SkillScanReport {
  readonly sources: readonly SkillScanSourceReport[];
}

import type { CapabilityDiscovery } from '../discovery/discovery.js';
import type { SkillSourceDiscovery } from '../skills/skill-source-discovery.js';
import { builtinSkillsProvider, builtinToolsProvider } from '../builtins/index.js';
import {
  localSkillsAgentOwnedProvider,
  localSkillsRuntimeGeneratedProvider,
  localSkillsSystemProvider,
  type LocalSkillReadinessEvidence,
  type LocalSkillSourceScope,
} from '../local/skill-discovery.js';
import { localRecipeProvider } from '../local/recipe-discovery.js';
import { builtinAgentsProvider, localAgentsProvider, localSubagentsProvider, type LocalAgentReadinessEvidence } from '../agents/agent-discovery.js';
import type { SkillHubReadinessEvidence } from '../skillhub/skillhub-source.js';

export interface CapabilityConflictResolver {
  resolve: (candidates: readonly CapabilityDescriptor[]) => CapabilityDescriptor | undefined;
}

export type SkillHubCatalogSourceAuthorization = (request: {
  readonly providerId: string;
  readonly tenantId: CapabilityCatalogRequest['tenantId'];
  readonly subjectId: CapabilityCatalogRequest['subjectId'];
  readonly agentId: CapabilityCatalogRequest['agentAssembly']['agentId'];
  readonly agentVersion: CapabilityCatalogRequest['agentAssembly']['agentVersion'];
  readonly agentAssemblyRef: string;
}) => boolean;

export class UniqueCapabilityConflictResolver implements CapabilityConflictResolver {
  resolve(candidates: readonly CapabilityDescriptor[]): CapabilityDescriptor | undefined {
    return candidates.length === 1 ? candidates[0] : undefined;
  }
}

export class StaticCapabilityCatalog implements CapabilityCatalog, CapabilityCurrentViewPort {
  private readonly descriptors: CapabilityDescriptor[];
  private readonly eagerDiscoveries: CapabilityDiscovery[];
  private readonly searchDiscoveries: CapabilityDiscovery[];
  private readonly conflictResolver: CapabilityConflictResolver;
  private readonly skillSourceDiscoveries: Array<SkillSourceDiscovery & { readonly provider: { readonly providerId: string } }>;
  private readonly localSkillGovernanceEvidence: LocalSkillReadinessEvidence[] = [];
  private readonly localAgentGovernanceEvidence: LocalAgentReadinessEvidence[] = [];
  private readonly skillHubGovernanceEvidence: SkillHubReadinessEvidence[] = [];
  private readonly skillHubSourceAuthorization?: SkillHubCatalogSourceAuthorization | undefined;

  constructor(
    descriptors: readonly CapabilityDescriptor[] = [],
    options: {
      readonly eagerDiscoveries?: readonly CapabilityDiscovery[];
      readonly searchDiscoveries?: readonly CapabilityDiscovery[];
      readonly conflictResolver?: CapabilityConflictResolver;
      readonly skillSourceDiscoveries?: ReadonlyArray<SkillSourceDiscovery & { readonly provider: { readonly providerId: string } }>;
      readonly skillHubSourceAuthorization?: SkillHubCatalogSourceAuthorization;
    } = {},
  ) {
    this.descriptors = [...descriptors];
    this.eagerDiscoveries = [...(options.eagerDiscoveries ?? [])];
    this.searchDiscoveries = [...(options.searchDiscoveries ?? [])];
    this.conflictResolver = options.conflictResolver ?? new UniqueCapabilityConflictResolver();
    this.skillSourceDiscoveries = [...(options.skillSourceDiscoveries ?? [])];
    this.skillHubSourceAuthorization = options.skillHubSourceAuthorization;
  }

  async listAvailable(request: CapabilityCatalogRequest): Promise<readonly CapabilityDescriptor[]> {
    return this.listAvailableWithSignal(request, new AbortController().signal);
  }

  async listAvailableWithSignal(request: CapabilityCatalogRequest, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    return this.buildVisibleView(request, request.includeUnavailable, undefined, signal);
  }

  async resolve(request: CapabilityResolveRequest): Promise<CapabilityDescriptor | undefined> {
    return this.resolveWithSignal(request, new AbortController().signal);
  }

  async resolveWithSignal(request: CapabilityResolveRequest, signal: AbortSignal): Promise<CapabilityDescriptor | undefined> {
    const view = await this.buildVisibleView({ ...request, includeUnavailable: false }, false, request.capabilityId, signal);
    return view.find((descriptor) => descriptor.capabilityId === request.capabilityId);
  }

  async listCurrent(request: CapabilityCurrentViewRequest, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    const catalogRequest: CapabilityCatalogRequest = { ...request, includeUnavailable: false };
    const startupDescriptors = await this.listCurrentEagerCandidates(request, signal);
    const bindings = request.agentAssembly.capabilityBindings;
    const disabledKeys = new Set(bindings.filter((binding) => binding.enabled === false).map(bindingKey));
    const enabledBindings = bindings.filter((binding) => binding.enabled !== false);
    const searchCandidates = await this.listCurrentSearchCandidates(request, enabledBindings, signal);
    const defaultCandidates = startupDescriptors.filter(isDefaultEnabledDescriptor);
    const defaultKeys = new Set(defaultCandidates.map(descriptorKey));
    const explicitCandidates = startupDescriptors.filter(
      (descriptor) =>
        !defaultKeys.has(descriptorKey(descriptor)) &&
        enabledBindings.some(
          (binding) =>
            binding.capabilityId === descriptor.capabilityId &&
            binding.capabilityType === descriptor.kind &&
            binding.providerId === descriptor.provider.providerId,
        ),
    );
    const candidates = [...defaultCandidates, ...explicitCandidates, ...searchCandidates].filter(
      (descriptor) => !disabledKeys.has(descriptorKey(descriptor)) && descriptor.availabilityStatus === 'AVAILABLE',
    );
    const byCapabilityId = new Map<string, CapabilityDescriptor[]>();
    for (const candidate of candidates) {
      const group = byCapabilityId.get(candidate.capabilityId) ?? [];
      group.push(candidate);
      byCapabilityId.set(candidate.capabilityId, group);
    }
    return [...byCapabilityId.values()]
      .flatMap((group) => {
        const winner = this.resolveGovernedGroup(group, catalogRequest);
        return winner === undefined ? [] : [winner];
      })
      .sort(compareCapabilityIdentity);
  }

  register(descriptor: CapabilityDescriptor): void {
    this.descriptors.push(descriptor);
  }

  registerDiscovery(discovery: CapabilityDiscovery): void {
    if (discovery.discoveryMode === 'EAGER') {
      this.eagerDiscoveries.push(discovery);
    } else {
      this.searchDiscoveries.push(discovery);
    }
  }

  async resolveForInvocation(capabilityId: string, signal: AbortSignal = new AbortController().signal): Promise<CapabilityDescriptor | undefined> {
    const available = (await this.listStartupDescriptors(signal, capabilityId as CapabilityDescriptor['capabilityId'])).filter(
      (descriptor) => descriptor.capabilityId === capabilityId && descriptor.availabilityStatus === 'AVAILABLE',
    );
    return this.conflictResolver.resolve(available);
  }

  getLocalSkillGovernanceEvidence(): readonly LocalSkillReadinessEvidence[] {
    return this.localSkillGovernanceEvidence;
  }

  getLocalAgentGovernanceEvidence(): readonly LocalAgentReadinessEvidence[] {
    return this.localAgentGovernanceEvidence;
  }

  getSkillHubGovernanceEvidence(): readonly SkillHubReadinessEvidence[] {
    return this.skillHubGovernanceEvidence;
  }

  registerSkillSourceDiscovery(discovery: SkillSourceDiscovery & { readonly provider: { readonly providerId: string } }): void {
    this.skillSourceDiscoveries.push(discovery);
  }

  resolveSkillSourceDiscovery(providerId: string): SkillSourceDiscovery | undefined {
    return this.skillSourceDiscoveries.find((source) => source.provider.providerId === providerId);
  }

  private async buildVisibleView(
    request: CapabilityCatalogRequest,
    includeUnavailable: boolean,
    requestedCapabilityId?: CapabilityDescriptor['capabilityId'],
    signal: AbortSignal = new AbortController().signal,
  ): Promise<readonly CapabilityDescriptor[]> {
    this.localSkillGovernanceEvidence.length = 0;
    this.localAgentGovernanceEvidence.length = 0;
    this.skillHubGovernanceEvidence.length = 0;
    const startupDescriptors = await this.listStartupDescriptors(signal, requestedCapabilityId);
    const bindings = request.agentAssembly.capabilityBindings;
    const disabledKeys = new Set(bindings.filter((binding) => binding.enabled === false).map(bindingKey));
    const enabledBindings = bindings.filter((binding) => binding.enabled !== false);
    const searchCandidates = await this.searchBoundProviders(request, enabledBindings, signal, requestedCapabilityId);
    const defaultCandidates = startupDescriptors.filter(isDefaultEnabledDescriptor);
    const defaultKeys = new Set(defaultCandidates.map(descriptorKey));
    const defaultSearchCandidates = await this.searchDefaultEnabledProviders(request, signal, requestedCapabilityId);
    const explicitCandidates = startupDescriptors.filter(
      (descriptor) =>
        !defaultKeys.has(descriptorKey(descriptor)) &&
        enabledBindings.some(
          (binding) =>
            binding.capabilityId === descriptor.capabilityId &&
            binding.capabilityType === descriptor.kind &&
            binding.providerId === descriptor.provider.providerId,
        ),
    );
    const candidates: CapabilityDescriptor[] = [];
    for (const descriptor of [...defaultCandidates, ...defaultSearchCandidates, ...explicitCandidates, ...searchCandidates]) {
      const key = descriptorKey(descriptor);
      if (
        disabledKeys.has(key) ||
        (!includeUnavailable && descriptor.availabilityStatus !== 'AVAILABLE') ||
        !matchesModelInvocable(descriptor, request.modelInvocable)
      ) {
        continue;
      }
      candidates.push(descriptor);
    }
    const byCapabilityId = new Map<string, CapabilityDescriptor[]>();
    for (const candidate of candidates) {
      const current = byCapabilityId.get(candidate.capabilityId) ?? [];
      current.push(candidate);
      byCapabilityId.set(candidate.capabilityId, current);
    }
    return [...byCapabilityId.values()].flatMap((group) => {
      const resolved = this.resolveGovernedGroup(group, request);
      return resolved === undefined ? [] : [resolved];
    });
  }

  private async searchDefaultEnabledProviders(
    request: CapabilityCatalogRequest,
    signal: AbortSignal,
    requestedCapabilityId?: CapabilityDescriptor['capabilityId'],
  ): Promise<readonly CapabilityDescriptor[]> {
    const candidates: CapabilityDescriptor[] = [];
    for (const discovery of this.searchDiscoveries) {
      if (!isDefaultEnabledSearchDiscovery(discovery) || discovery.search === undefined) {
        continue;
      }
      candidates.push(
        ...(await discovery.search(
          {
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
            agentId: request.agentAssembly.agentId,
            agentVersion: request.agentAssembly.agentVersion,
            agentAssemblyRef: request.agentAssembly.agentAssemblyRef,
            ...(requestedCapabilityId === undefined ? {} : { requestedCapabilityId }),
            ...(request.modelInvocable === undefined ? {} : { modelInvocable: request.modelInvocable }),
          },
          signal,
        )),
      );
    }
    return candidates;
  }

  private async searchBoundProviders(
    request: CapabilityCatalogRequest,
    enabledBindings: ReadonlyArray<CapabilityCatalogRequest['agentAssembly']['capabilityBindings'][number]>,
    signal: AbortSignal,
    requestedCapabilityId?: CapabilityDescriptor['capabilityId'],
  ): Promise<readonly CapabilityDescriptor[]> {
    const boundProviderIds = new Set(enabledBindings.map((binding) => binding.providerId));
    const candidates: CapabilityDescriptor[] = [];
    for (const discovery of this.searchDiscoveries) {
      if (isDefaultEnabledSearchDiscovery(discovery) || !boundProviderIds.has(discovery.provider.providerId) || discovery.search === undefined) {
        continue;
      }
      if (discovery.provider.providerKind === 'SKILL_HUB' && !this.isSkillHubSourceAuthorized(request, discovery.provider.providerId)) {
        continue;
      }
      const discovered = await discovery.search(
        {
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
          agentId: request.agentAssembly.agentId,
          agentVersion: request.agentAssembly.agentVersion,
          agentAssemblyRef: request.agentAssembly.agentAssemblyRef,
          ...(requestedCapabilityId === undefined ? {} : { requestedCapabilityId }),
          ...(request.modelInvocable === undefined ? {} : { modelInvocable: request.modelInvocable }),
        },
        signal,
      );
      candidates.push(
        ...(discovery.provider.providerKind === 'SKILL_HUB'
          ? discovered
          : discovered.filter((descriptor) =>
              enabledBindings.some(
                (binding) =>
                  binding.capabilityId === descriptor.capabilityId &&
                  binding.capabilityType === descriptor.kind &&
                  binding.providerId === descriptor.provider.providerId,
              ),
            )),
      );
    }
    return candidates;
  }

  private async listCurrentSearchCandidates(
    request: CapabilityCurrentViewRequest,
    enabledBindings: ReadonlyArray<CapabilityCatalogRequest['agentAssembly']['capabilityBindings'][number]>,
    signal: AbortSignal,
  ): Promise<readonly CapabilityDescriptor[]> {
    const boundProviderIds = new Set(enabledBindings.map((binding) => binding.providerId));
    const candidates: CapabilityDescriptor[] = [];
    for (const discovery of this.searchDiscoveries) {
      const defaultEnabled = isDefaultEnabledSearchDiscovery(discovery);
      if (!defaultEnabled && !boundProviderIds.has(discovery.provider.providerId)) {
        continue;
      }
      if (
        discovery.provider.providerKind === 'SKILL_HUB' &&
        !this.isSkillHubSourceAuthorized({ ...request, includeUnavailable: false }, discovery.provider.providerId)
      ) {
        continue;
      }
      if (discovery.listCurrent === undefined) {
        throw new Error('Capability current view is unavailable.');
      }
      let discovered: readonly CapabilityDescriptor[];
      try {
        discovered = await discovery.listCurrent(
          {
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            sessionId: request.sessionId,
            agentId: request.agentAssembly.agentId,
            agentVersion: request.agentAssembly.agentVersion,
            agentAssemblyRef: request.agentAssembly.agentAssemblyRef,
          },
          signal,
        );
      } catch (error) {
        throw new Error('Capability current view is unavailable.', { cause: error });
      }
      candidates.push(
        ...(defaultEnabled
          ? discovered
          : discovered.filter((descriptor) =>
              enabledBindings.some(
                (binding) =>
                  binding.capabilityId === descriptor.capabilityId &&
                  binding.capabilityType === descriptor.kind &&
                  binding.providerId === descriptor.provider.providerId,
              ),
            )),
      );
    }
    return candidates;
  }

  private async listCurrentEagerCandidates(request: CapabilityCurrentViewRequest, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    const candidates = [...this.descriptors];
    for (const discovery of this.eagerDiscoveries) {
      if (discovery.listCurrent === undefined) {
        throw new Error('Capability current view is unavailable.');
      }
      try {
        candidates.push(
          ...(await discovery.listCurrent(
            {
              tenantId: request.tenantId,
              subjectId: request.subjectId,
              sessionId: request.sessionId,
              agentId: request.agentAssembly.agentId,
              agentVersion: request.agentAssembly.agentVersion,
              agentAssemblyRef: request.agentAssembly.agentAssemblyRef,
            },
            signal,
          )),
        );
      } catch (error) {
        throw new Error('Capability current view is unavailable.', { cause: error });
      }
    }
    return candidates;
  }

  private isSkillHubSourceAuthorized(request: CapabilityCatalogRequest, providerId: string): boolean {
    if (this.skillHubSourceAuthorization === undefined) {
      return false;
    }
    return this.skillHubSourceAuthorization({
      providerId,
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentAssembly.agentId,
      agentVersion: request.agentAssembly.agentVersion,
      agentAssemblyRef: request.agentAssembly.agentAssemblyRef,
    });
  }

  private resolveGovernedGroup(group: readonly CapabilityDescriptor[], request: CapabilityCatalogRequest): CapabilityDescriptor | undefined {
    const { winner, evidence } = resolveConflictGroup(group, getGovernedPriority);

    for (const item of evidence) {
      const scope = localSourceScope(item.descriptor);
      if (scope !== undefined) {
        const readiness = item.decision === 'REJECT' ? 'LOCAL_SKILL_DUPLICATE_REJECTED' : 'LOCAL_SKILL_SHADOWED_BY_AGENT';
        this.localSkillGovernanceEvidence.push(localEvidence(item.descriptor, readiness, item.reason, request, scope));
      }
      if (isLocalAgentDescriptor(item.descriptor)) {
        const readiness = item.decision === 'REJECT' ? 'LOCAL_AGENT_DUPLICATE_REJECTED' : 'LOCAL_AGENT_SHADOWED';
        this.localAgentGovernanceEvidence.push(localAgentEvidence(item.descriptor, readiness, item.reason, request));
      }
      if (isSkillHubCandidate(item.descriptor)) {
        this.skillHubGovernanceEvidence.push(
          skillHubEvidence(item.descriptor, 'SKILLHUB_SKILL_SHADOWED', 'SkillHub Skill was shadowed by a higher-priority source.', request),
        );
      }
    }

    if (winner !== undefined) {
      const winnerScope = localSourceScope(winner);
      if (winnerScope !== undefined) {
        this.localSkillGovernanceEvidence.push(localEvidence(winner, 'LOCAL_SKILL_REGISTERED', 'Local Skill is registered.', request, winnerScope));
      }
      if (isLocalAgentDescriptor(winner)) {
        this.localAgentGovernanceEvidence.push(
          localAgentEvidence(winner, 'LOCAL_AGENT_REGISTERED', 'Local Agent capability is registered.', request),
        );
      }
      if (isSkillHubCandidate(winner)) {
        this.skillHubGovernanceEvidence.push(skillHubEvidence(winner, 'SKILLHUB_SKILL_REGISTERED', 'SkillHub Skill is registered.', request));
      }
      return winner;
    }

    const rejected = new Set(evidence.filter((e) => e.decision === 'REJECT').map((e) => e.descriptor));
    const remaining = group.filter((descriptor) => !rejected.has(descriptor));
    return remaining.length > 0 ? this.conflictResolver.resolve(remaining) : undefined;
  }

  private async listStartupDescriptors(
    signal: AbortSignal = new AbortController().signal,
    requestedCapabilityId?: CapabilityDescriptor['capabilityId'],
  ): Promise<readonly CapabilityDescriptor[]> {
    const discovered: CapabilityDescriptor[] = [];
    for (const discovery of this.eagerDiscoveries) {
      if (requestedCapabilityId !== undefined && discovery.resolve !== undefined) {
        const resolved = await discovery.resolve(requestedCapabilityId, signal);
        if (resolved !== undefined) {
          discovered.push(resolved);
        }
        continue;
      }
      if (discovery.listAll !== undefined) {
        discovered.push(...(await discovery.listAll(signal)));
      }
    }
    return [...this.descriptors, ...discovered];
  }

  async collectSkillScanReport(): Promise<SkillScanReport> {
    await this.listStartupDescriptors();
    const sources: Array<{ providerId: string; scanRoot: string; discovered: string[]; failures: SkillScanFailure[] }> = [];
    const allDiscoveries = [...this.eagerDiscoveries, ...this.searchDiscoveries];
    for (const discovery of allDiscoveries) {
      const evidence = discovery.getSkillScanEvidence?.() ?? [];
      const root = discovery.getSkillScanRoot?.();
      if (root === undefined && evidence.length === 0) {
        continue;
      }
      const discoveredSkills: string[] = [];
      const failures: SkillScanFailure[] = [];
      for (const item of evidence) {
        if (item.outcomeCode.endsWith('_REGISTERED')) {
          if (item.skillId !== undefined) {
            discoveredSkills.push(item.skillId);
          }
        } else {
          failures.push({
            ...(item.skillId === undefined ? {} : { skillId: item.skillId }),
            outcomeCode: item.outcomeCode,
            message: item.message,
          });
        }
      }
      sources.push({
        providerId: discovery.provider.providerId,
        scanRoot: root ?? '(unknown)',
        discovered: discoveredSkills,
        failures,
      });
    }
    for (const item of this.localSkillGovernanceEvidence) {
      const source = sources.find((candidate) => candidate.providerId === item.providerId);
      if (source !== undefined && item.outcomeCode !== 'LOCAL_SKILL_REGISTERED') {
        source.failures.push({
          ...(item.skillId === undefined ? {} : { skillId: item.skillId }),
          outcomeCode: item.outcomeCode,
          message: item.message,
        });
      }
    }
    return { sources };
  }
}

function isDefaultEnabledDescriptor(descriptor: CapabilityDescriptor): boolean {
  return (
    (descriptor.provider.providerId === builtinToolsProvider.providerId && descriptor.kind === 'TOOL') ||
    (descriptor.provider.providerId === builtinSkillsProvider.providerId && descriptor.kind === 'SKILL') ||
    (descriptor.provider.providerId === localSkillsSystemProvider.providerId && descriptor.kind === 'SKILL')
  );
}

function matchesModelInvocable(descriptor: CapabilityDescriptor, modelInvocable?: boolean): boolean {
  if (modelInvocable === undefined) {
    return true;
  }
  return modelInvocable ? descriptor.modelInvocable === true : descriptor.modelInvocable !== true;
}

function getGovernedPriority(candidate: CapabilityDescriptor): number {
  if (localSourceScope(candidate) === 'agent-owned-local') {
    return 2;
  }
  if (localSourceScope(candidate) === 'runtime-generated-local') {
    return 1;
  }
  if (isLocalAgentDescriptor(candidate)) {
    return 2;
  }
  if (isBuiltinPriorityCandidate(candidate)) {
    return 3;
  }
  if (localSourceScope(candidate) === 'system-local') {
    return 4;
  }
  return 5;
}

function isBuiltinPriorityCandidate(descriptor: CapabilityDescriptor): boolean {
  return (
    descriptor.provider.providerKind === 'BUNDLED' &&
    (descriptor.provider.providerId === builtinToolsProvider.providerId ||
      descriptor.provider.providerId === builtinSkillsProvider.providerId ||
      descriptor.provider.providerId === builtinAgentsProvider.providerId)
  );
}

function isDefaultEnabledSearchDiscovery(discovery: CapabilityDiscovery): boolean {
  return (
    discovery.provider.providerKind === 'LOCAL_DIRECTORY' &&
    (discovery.provider.providerId === localSkillsAgentOwnedProvider.providerId ||
      discovery.provider.providerId === localSkillsRuntimeGeneratedProvider.providerId ||
      discovery.provider.providerId === localSubagentsProvider.providerId ||
      discovery.provider.providerId === localRecipeProvider.providerId)
  );
}

function localSourceScope(descriptor: CapabilityDescriptor): LocalSkillSourceScope | undefined {
  if (descriptor.provider.providerId === localSkillsSystemProvider.providerId && descriptor.provider.providerKind === 'LOCAL_DIRECTORY') {
    return 'system-local';
  }
  if (descriptor.provider.providerId === localSkillsAgentOwnedProvider.providerId && descriptor.provider.providerKind === 'LOCAL_DIRECTORY') {
    return 'agent-owned-local';
  }
  if (descriptor.provider.providerId === localSkillsRuntimeGeneratedProvider.providerId && descriptor.provider.providerKind === 'LOCAL_DIRECTORY') {
    return 'runtime-generated-local';
  }
  return undefined;
}

function isLocalAgentDescriptor(descriptor: CapabilityDescriptor): boolean {
  return (
    (descriptor.provider.providerId === localAgentsProvider.providerId || descriptor.provider.providerId === localSubagentsProvider.providerId) &&
    descriptor.provider.providerKind === 'LOCAL_DIRECTORY' &&
    descriptor.kind === 'AGENT'
  );
}

function isSkillHubCandidate(descriptor: CapabilityDescriptor): boolean {
  return descriptor.provider.providerKind === 'SKILL_HUB';
}

function localEvidence(
  descriptor: CapabilityDescriptor,
  outcomeCode: LocalSkillReadinessEvidence['outcomeCode'],
  message: string,
  request: CapabilityCatalogRequest,
  sourceScope: LocalSkillSourceScope,
): LocalSkillReadinessEvidence {
  return {
    providerId: descriptor.provider.providerId as 'local-skills-system' | 'local-skills-agent-owned' | 'local-skills-runtime-generated',
    providerKind: 'LOCAL_DIRECTORY',
    sourceScope,
    agentId: request.agentAssembly.agentId,
    agentVersion: request.agentAssembly.agentVersion,
    skillId: descriptor.capabilityId,
    outcomeCode,
    message,
  };
}

function localAgentEvidence(
  descriptor: CapabilityDescriptor,
  outcomeCode: LocalAgentReadinessEvidence['outcomeCode'],
  message: string,
  request: CapabilityCatalogRequest,
): LocalAgentReadinessEvidence {
  return {
    providerId: descriptor.provider.providerId as 'local-agents' | 'local-subagents',
    providerKind: 'LOCAL_DIRECTORY',
    sourceScope: 'parent-subagent',
    agentId: request.agentAssembly.agentId,
    agentVersion: request.agentAssembly.agentVersion,
    agentAssemblyRef: request.agentAssembly.agentAssemblyRef,
    capabilityId: descriptor.capabilityId,
    ...(descriptor.version === undefined ? {} : { version: descriptor.version }),
    outcomeCode,
    message,
  };
}

function skillHubEvidence(
  descriptor: CapabilityDescriptor,
  outcomeCode: SkillHubReadinessEvidence['outcomeCode'],
  message: string,
  request: CapabilityCatalogRequest,
): SkillHubReadinessEvidence {
  return {
    providerId: descriptor.provider.providerId,
    providerKind: 'SKILL_HUB',
    agentId: request.agentAssembly.agentId,
    agentVersion: request.agentAssembly.agentVersion,
    skillId: descriptor.capabilityId,
    outcomeCode,
    message,
  };
}

function bindingKey(binding: { readonly providerId: string; readonly capabilityType: string; readonly capabilityId: string }): string {
  return `${binding.providerId}\0${binding.capabilityType}\0${binding.capabilityId}`;
}

function descriptorKey(descriptor: CapabilityDescriptor): string {
  return `${descriptor.provider.providerId}\0${descriptor.kind}\0${descriptor.capabilityId}`;
}

function compareCapabilityIdentity(left: CapabilityDescriptor, right: CapabilityDescriptor): number {
  const kindOrder = left.kind.localeCompare(right.kind);
  return kindOrder === 0 ? left.capabilityId.localeCompare(right.capabilityId) : kindOrder;
}

export function createStaticCapabilityCatalog(
  descriptors?: readonly CapabilityDescriptor[],
  options?: {
    readonly eagerDiscoveries?: readonly CapabilityDiscovery[];
    readonly searchDiscoveries?: readonly CapabilityDiscovery[];
    readonly conflictResolver?: CapabilityConflictResolver;
    readonly skillSourceDiscoveries?: ReadonlyArray<SkillSourceDiscovery & { readonly provider: { readonly providerId: string } }>;
    readonly skillHubSourceAuthorization?: SkillHubCatalogSourceAuthorization;
  },
): StaticCapabilityCatalog {
  return new StaticCapabilityCatalog(descriptors, options);
}
