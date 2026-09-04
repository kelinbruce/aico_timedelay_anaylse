import {
  BuiltinAgentDiscovery,
  GovernedCapabilityInvocationPort,
  LocalAgentDiscovery,
  StaticCapabilityCatalog,
  builtinAgentsProvider,
  createCapabilitySubsystem,
  createStaticCapabilityExecutorFactory,
  localAgentsProvider,
  localSubagentsProvider,
  normalizeCapabilityProviderConfigs,
  type AgentDiscoverySource,
} from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityDescriptor, CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';

describe('BuiltinAgentDiscovery', () => {
  it('maps trusted builtin Agent assemblies to safe AGENT descriptors', async () => {
    const discovery = new BuiltinAgentDiscovery({
      source: source({
        builtin: [
          assembly('network-explorer', {
            displayName: 'Network explorer',
            locales: {
              language: {
                'zh-CN': { displayName: '网络探索智能体' },
                'en-US': { displayName: 'Network explorer' },
              },
            },
            userInvocable: false,
            agentInvocation: 'BOUND',
          }),
        ],
      }),
    });

    const descriptors = await discovery.listAll(new AbortController().signal);

    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'network-explorer',
        kind: 'AGENT',
        provider: builtinAgentsProvider,
        version: 'v1',
        displayName: 'Network explorer',
        locales: {
          language: {
            'zh-CN': { displayName: '网络探索智能体' },
            'en-US': { displayName: 'Network explorer' },
          },
        },
        description: 'network-explorer telecom Agent.',
        availabilityStatus: 'AVAILABLE',
        modelInvocable: true,
      }),
    ]);
    expect(descriptors[0]).not.toHaveProperty('metadata');
    expect(JSON.stringify(descriptors)).not.toContain('prompt');
    expect(discovery.getReadinessEvidence()).toEqual([
      expect.objectContaining({ outcomeCode: 'BUILTIN_AGENT_REGISTERED', capabilityId: 'network-explorer' }),
    ]);
  });

  it('publishes non-invocable builtin Agents as unavailable catalog candidates', async () => {
    const discovery = new BuiltinAgentDiscovery({
      source: source({ builtin: [assembly('platform-service', { userInvocable: true, agentInvocation: 'NONE' })] }),
    });

    await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        capabilityId: 'platform-service',
        provider: builtinAgentsProvider,
        availabilityStatus: 'UNAVAILABLE',
        modelInvocable: false,
      }),
    ]);
  });

  it('is created only through exact trusted builtin Agent provider input', () => {
    const subsystem = createCapabilitySubsystem({ agentDiscoverySource: source({}) });

    expect(subsystem.catalog).toBeDefined();
    expect(() => normalizeCapabilityProviderConfigs([{ provider: builtinAgentsProvider, discoveryMode: 'EAGER', options: {} as never }])).toThrow(
      'BUNDLED capability providers are registered by agent-capability.',
    );
    expect(() =>
      normalizeCapabilityProviderConfigs(
        [{ provider: { providerId: 'builtin-agents', providerKind: 'LOCAL_DIRECTORY' }, discoveryMode: 'EAGER', options: {} as never }],
        { occupiedProviders: [builtinAgentsProvider] },
      ),
    ).toThrow('Duplicate capability provider id.');
  });
});

describe('LocalAgentDiscovery', () => {
  it('maps top-level local Agent assemblies from the app-owned source', async () => {
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'top-level-local',
      source: source({ topLevelLocal: [assembly('planner-agent', { agentInvocation: 'BOUND' })] }),
    });

    await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'planner-agent', kind: 'AGENT', provider: localAgentsProvider }),
    ]);
    expect(discovery.getReadinessEvidence()).toEqual([
      expect.objectContaining({ outcomeCode: 'LOCAL_AGENT_REGISTERED', capabilityId: 'planner-agent', sourceScope: 'top-level-local' }),
    ]);
  });

  it('maps parent-local subagent assemblies by trusted parent scope', async () => {
    const calls: unknown[] = [];
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'parent-subagent',
      source: source({
        parentSubagents: async (parentScope) => {
          calls.push(parentScope);
          return [assembly('alarm-correlation', { userInvocable: false, agentInvocation: 'PARENT' })];
        },
      }),
    });

    await expect(discovery.search(searchCriteria('agent-a'), new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'alarm-correlation', kind: 'AGENT', provider: localSubagentsProvider }),
    ]);
    expect(calls[0]).toMatchObject({ agentId: 'agent-a', agentVersion: 'v1', agentAssemblyRef: 'agent-a:v1' });
    expect(calls[0]).not.toHaveProperty('agentAssembly');
    expect(calls[0]).not.toHaveProperty('capabilityBindings');
  });

  it('passes cancellation signal to the app-owned source', async () => {
    let receivedSignal: AbortSignal | undefined;
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'parent-subagent',
      source: source({
        parentSubagents: async (_scope, signal) => {
          receivedSignal = signal;
          return [assembly('alarm-correlation', { userInvocable: false, agentInvocation: 'PARENT' })];
        },
      }),
    });
    const controller = new AbortController();

    await discovery.search(searchCriteria('agent-a'), controller.signal);

    expect(receivedSignal).toBe(controller.signal);
  });

  it('reads current parent-local subagents from the trusted in-memory assembly source', async () => {
    const calls: unknown[] = [];
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'parent-subagent',
      source: source({
        parentSubagents: async (scope) => {
          calls.push(scope);
          return [assembly('current-subagent', { displayName: 'Current subagent', agentInvocation: 'PARENT' })];
        },
      }),
    });

    await expect(
      discovery.listCurrent?.(
        { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') },
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'current-subagent', displayName: 'Current subagent', provider: localSubagentsProvider }),
    ]);
    expect(calls).toEqual([expect.objectContaining({ agentId: 'agent-a', agentVersion: 'v1', agentAssemblyRef: 'agent-a:v1' })]);
  });

  it('skips one schema-invalid current parent-local subagent and returns valid siblings', async () => {
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'parent-subagent',
      source: source({
        parentSubagents: async () => [
          assembly('valid-current-subagent', { displayName: 'Valid current subagent', agentInvocation: 'PARENT' }),
          assembly('invalid-current-subagent', {
            displayName: 'Invalid current subagent',
            locales: { language: { x: { displayName: 'Invalid locale' } } },
            agentInvocation: 'PARENT',
          }),
        ],
      }),
    });

    await Promise.all([
      expect(
        discovery.listCurrent?.(
          { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') },
          new AbortController().signal,
        ),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'valid-current-subagent', displayName: 'Valid current subagent' })]),
      expect(
        discovery.listCurrent?.(
          { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') },
          new AbortController().signal,
        ),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'valid-current-subagent', displayName: 'Valid current subagent' })]),
    ]);
    expect(discovery.getReadinessEvidence()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcomeCode: 'LOCAL_AGENT_DEFINITION_INVALID',
          capabilityId: 'invalid-current-subagent',
        }),
      ]),
    );
    expect(
      discovery
        .getReadinessEvidence()
        .filter((evidence) => evidence.outcomeCode === 'LOCAL_AGENT_DEFINITION_INVALID' && evidence.capabilityId === 'invalid-current-subagent'),
    ).toHaveLength(1);
  });

  it('rejects cancellation while the current subagent source is pending without replacing completed evidence', async () => {
    let sourceCallCount = 0;
    let markSourceStarted: (() => void) | undefined;
    let releaseSource: (() => void) | undefined;
    const sourceStarted = new Promise<void>((resolve) => {
      markSourceStarted = resolve;
    });
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'parent-subagent',
      source: source({
        parentSubagents: async () => {
          sourceCallCount += 1;
          if (sourceCallCount === 1) {
            return [assembly('completed-current-subagent', { agentInvocation: 'PARENT' })];
          }
          return new Promise((resolve) => {
            releaseSource = () => resolve([assembly('late-current-subagent', { agentInvocation: 'PARENT' })]);
            markSourceStarted?.();
          });
        },
      }),
    });
    const criteria = { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') };
    await discovery.listCurrent?.(criteria, new AbortController().signal);
    const completedEvidence = [...discovery.getReadinessEvidence()];
    const controller = new AbortController();

    const pendingRead = discovery.listCurrent?.(criteria, controller.signal);
    await sourceStarted;
    controller.abort();
    releaseSource?.();

    await expect(pendingRead).rejects.toThrow('Local subagent current view is unavailable.');
    expect(discovery.getReadinessEvidence()).toEqual(completedEvidence);
  });

  it('does not replace top-level EAGER evidence when current-read is not applicable', async () => {
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'top-level-local',
      source: source({ topLevelLocal: [assembly('startup-local-agent', { agentInvocation: 'BOUND' })] }),
    });
    await discovery.listAll(new AbortController().signal);
    const startupEvidence = [...discovery.getReadinessEvidence()];

    await expect(
      discovery.listCurrent?.(
        { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') },
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);

    expect(discovery.getReadinessEvidence()).toEqual(startupEvidence);
  });

  it('keeps configured current subagent source failures explicit', async () => {
    const discovery = new LocalAgentDiscovery({
      sourceScope: 'parent-subagent',
      source: source({
        parentSubagents: async () => {
          throw new Error('private registry failure');
        },
      }),
    });

    await expect(
      discovery.listCurrent?.(
        { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') },
        new AbortController().signal,
      ),
    ).rejects.toThrow('private registry failure');
  });

  it('treats an unconfigured optional current subagent source as a complete empty source', async () => {
    const discovery = new LocalAgentDiscovery({ sourceScope: 'parent-subagent' });

    await expect(
      discovery.listCurrent?.(
        { ...searchCriteria('agent-a'), sessionId: brand<string, 'SessionId'>('session-current-subagent') },
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);
  });

  it('keeps remote AgentRegistry discovery unsupported by this change', () => {
    expect(() =>
      createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: { providerId: 'remote-agents', providerKind: 'AGENT_REGISTRY' },
            discoveryMode: 'SEARCH',
            options: { registryRef: 'registry:test' } as never,
          },
        ],
      }),
    ).toThrow('Unsupported capability provider kind.');
  });

  it('reports LOCAL_DIRECTORY provider ownership with neutral trusted capability wording', () => {
    expect(() =>
      normalizeCapabilityProviderConfigs([
        {
          provider: { providerId: 'user-local', providerKind: 'LOCAL_DIRECTORY' },
          discoveryMode: 'SEARCH',
          options: {} as never,
        },
      ]),
    ).toThrow('LOCAL_DIRECTORY capability providers are registered by trusted local capability sources.');
  });
});

describe('Agent capability Catalog governance', () => {
  it('requires explicit bindings for builtin and top-level local Agents, and default exposes parent-local subagents', async () => {
    const catalog = catalogWithAgents({
      builtin: [assembly('network-explorer', { userInvocable: false, agentInvocation: 'BOUND' })],
      topLevelLocal: [assembly('planner-agent', { agentInvocation: 'BOUND' })],
      parentSubagents: [assembly('alarm-correlation', { userInvocable: false, agentInvocation: 'PARENT' })],
    });

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly('agent-a'), includeUnavailable: false }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'alarm-correlation', provider: localSubagentsProvider })]);

    await expect(
      catalog.listAvailable({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly('agent-a', {
          capabilityBindings: [
            { capabilityId: 'network-explorer', capabilityType: 'AGENT', providerId: 'builtin-agents', enabled: true },
            { capabilityId: 'planner-agent', capabilityType: 'AGENT', providerId: 'local-agents', enabled: true },
          ],
        }),
        includeUnavailable: false,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'alarm-correlation', provider: localSubagentsProvider }),
      expect.objectContaining({ capabilityId: 'network-explorer', provider: builtinAgentsProvider }),
      expect.objectContaining({ capabilityId: 'planner-agent', provider: localAgentsProvider }),
    ]);
  });

  it('applies explicit AGENT disable facts to default visible parent-local subagents', async () => {
    const catalog = catalogWithAgents({
      parentSubagents: [assembly('alarm-correlation', { userInvocable: false, agentInvocation: 'PARENT' })],
    });

    const parentAssembly = assembly('agent-a', {
      capabilityBindings: [{ capabilityId: 'alarm-correlation', capabilityType: 'AGENT', providerId: 'local-subagents', enabled: false }],
    });

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: parentAssembly, includeUnavailable: false }),
    ).resolves.toEqual([]);
    await expect(
      catalog.resolve({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: parentAssembly,
        capabilityId: brand<string, 'CapabilityId'>('alarm-correlation'),
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves AGENT conflicts before model visibility and keeps parent-local priority over builtin', async () => {
    const catalog = catalogWithAgents({
      builtin: [assembly('alarm-correlation', { userInvocable: false, agentInvocation: 'BOUND' })],
      parentSubagents: [assembly('alarm-correlation', { userInvocable: false, agentInvocation: 'PARENT' })],
    });

    await expect(
      catalog.listAvailable({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly('agent-a', {
          capabilityBindings: [{ capabilityId: 'alarm-correlation', capabilityType: 'AGENT', providerId: 'builtin-agents', enabled: true }],
        }),
        includeUnavailable: false,
      }),
    ).resolves.toEqual([expect.objectContaining({ capabilityId: 'alarm-correlation', provider: localSubagentsProvider })]);
    expect(catalog.getLocalAgentGovernanceEvidence()).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcomeCode: 'LOCAL_AGENT_REGISTERED', capabilityId: 'alarm-correlation' })]),
    );
  });
});

describe('Agent capability invocation remains deferred', () => {
  it('fails safely without an Agent executor and does not call runtime context hooks', async () => {
    const invocationPort = new GovernedCapabilityInvocationPort(
      {
        async resolveForInvocation() {
          return agentDescriptor('alarm-correlation', localSubagentsProvider.providerId, 'LOCAL_DIRECTORY');
        },
      },
      createStaticCapabilityExecutorFactory([]),
    );
    let childRunCreated = false;

    await expect(
      invocationPort.invoke(invocationRequest(), new AbortController().signal, {
        capabilityResolver: {
          async resolveCapability() {
            childRunCreated = true;
            return undefined;
          },
        },
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
    expect(childRunCreated).toBe(false);
  });
});

function catalogWithAgents(input: {
  readonly builtin?: readonly AgentAssembly[];
  readonly topLevelLocal?: readonly AgentAssembly[];
  readonly parentSubagents?: readonly AgentAssembly[];
}): StaticCapabilityCatalog {
  const agentSource = source(input);
  return new StaticCapabilityCatalog([], {
    eagerDiscoveries: [
      new BuiltinAgentDiscovery({ source: agentSource }),
      new LocalAgentDiscovery({ sourceScope: 'top-level-local', source: agentSource }),
    ],
    searchDiscoveries: [new LocalAgentDiscovery({ sourceScope: 'parent-subagent', source: agentSource })],
  });
}

function source(input: {
  readonly builtin?: readonly AgentAssembly[];
  readonly topLevelLocal?: readonly AgentAssembly[];
  readonly parentSubagents?:
    | readonly AgentAssembly[]
    | ((scope: Parameters<AgentDiscoverySource['listParentSubagentAssemblies']>[0], signal: AbortSignal) => Promise<readonly AgentAssembly[]>);
}): AgentDiscoverySource {
  return {
    async listBuiltinAgentAssemblies() {
      return input.builtin ?? [];
    },
    async listTopLevelLocalAgentAssemblies() {
      return input.topLevelLocal ?? [];
    },
    async listParentSubagentAssemblies(scope, signal) {
      return typeof input.parentSubagents === 'function' ? input.parentSubagents(scope, signal) : (input.parentSubagents ?? []);
    },
  };
}

function agentDescriptor(capabilityId: string, providerId: string, providerKind: 'BUNDLED' | 'LOCAL_DIRECTORY'): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'AGENT',
    provider: { providerId, providerKind },
    displayName: capabilityId,
    description: `${capabilityId} telecom Agent.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function assembly(agentId: string, overrides: Partial<AgentAssembly> = {}): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>(agentId),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: `${agentId}:v1`,
    displayName: agentId,
    description: `${agentId} telecom Agent.`,
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' }],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
    ...overrides,
  };
}

function searchCriteria(agentId: string) {
  return {
    tenantId: tenantId(),
    subjectId: subjectId(),
    agentId: brand<string, 'AgentId'>(agentId),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: `${agentId}:v1`,
  };
}

function invocationRequest(): CapabilityInvocationRequest {
  return {
    invocationId: brand<string, 'CapabilityInvocationId'>('invoke-agent'),
    capabilityId: brand<string, 'CapabilityId'>('alarm-correlation'),
    arguments: {},
    sessionId: brand<string, 'SessionId'>('session-agent'),
    requestId: brand<string, 'MessageId'>('request-agent'),
    runId: brand<string, 'RequestRunId'>('run-agent'),
    requestContextId: brand<string, 'RequestContextId'>('context-agent'),
    stepId: 'step-agent',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Telecom Operator' },
    agentId: brand<string, 'AgentId'>('agent-a'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 1000,
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-agent-discovery');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-agent-discovery');
}
