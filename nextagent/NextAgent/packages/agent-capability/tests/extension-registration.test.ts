import { brand, type JsonObject } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityDiscovery,
  CapabilityCurrentDiscoveryCriteria,
  CapabilityInvocationRequest,
  CapabilityProviderIdentity,
  CapabilityProvider,
} from '@nextagent/agent-contracts/capability';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapabilitySubsystem } from '../src/subsystem.js';
import { BuiltinToolsExecutor, GovernedCapabilityInvocationPort, createStaticCapabilityExecutorFactory } from '../src/execution/executor.js';
import { createToolCatalog } from '../src/tools/tool-catalog.js';
import type { ToolDefinition } from '../src/tools/tool-spi.js';
import { assembleCapabilityProviders } from '../src/extension-registration.js';
import { CapabilityConfigurationError } from '../src/provider-config.js';

const tenantId = brand<string, 'TenantId'>('tenant-extension');
const subjectId = brand<string, 'SubjectId'>('subject-extension');
const agentId = brand<string, 'AgentId'>('agent-extension');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-extension');
const provider: CapabilityProviderIdentity = { providerId: 'external-tools', providerKind: 'CUSTOM', providerType: 'test' };

describe('extension registration', () => {
  it('assembles provider-owned startup providers without non-executable diagnostic noise', async () => {
    const subsystem = createCapabilitySubsystem({ builtinSkillDiscoveryOptions: { enabled: false } });

    const diagnostics = await subsystem.validateStartupRegistration();

    await expect(
      subsystem.catalog.listAvailable({
        tenantId,
        subjectId,
        agentAssembly: assembly([{ capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' }]),
        includeUnavailable: false,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'Read', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } })]),
    );
    expect(diagnostics).toEqual([]);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(subsystem.capabilityProviders.map((item) => item.providerId)).toEqual(expect.arrayContaining(['builtin-tools']));
    expect(subsystem).not.toHaveProperty('workspaceFiles');
    expect(subsystem).not.toHaveProperty('extensionRegistrationDiagnostics');
  });

  it('blocks duplicate providers and provider/discovery identity mismatch with safe errors', () => {
    const discovery = discoveryOnly(provider, [agentDescriptor('external-agent', provider)]);

    expect(() =>
      assembleCapabilityProviders([
        { identity: provider, discovery },
        { identity: provider, discovery },
      ]),
    ).toThrow(CapabilityConfigurationError);
    expect(() =>
      assembleCapabilityProviders([
        {
          identity: provider,
          discovery: discoveryOnly({ providerId: 'other-provider', providerKind: 'CUSTOM', providerType: 'test' }, []),
        },
      ]),
    ).toThrow(CapabilityConfigurationError);
  });

  it('blocks malformed providers with missing discovery support as a safe configuration error', () => {
    const malformedContribution = { identity: provider } as unknown as CapabilityProvider;

    expect(() => assembleCapabilityProviders([malformedContribution])).toThrow(CapabilityConfigurationError);
    expect(() => assembleCapabilityProviders([malformedContribution])).toThrow('Capability provider discovery support is unavailable.');
  });

  it('registers external EAGER discovery at startup without rebuilding providers per request', async () => {
    let providerCreated = 0;
    let listAllCount = 0;
    const externalProvider = (() => {
      providerCreated += 1;
      return {
        identity: provider,
        discovery: {
          provider,
          discoveryMode: 'EAGER' as const,
          async listAll() {
            listAllCount += 1;
            return [agentDescriptor('external-agent', provider)];
          },
        },
      };
    })();
    const subsystem = createCapabilitySubsystem({ externalProviders: [externalProvider] });
    const request = {
      tenantId,
      subjectId,
      agentAssembly: assembly([{ capabilityId: 'external-agent', capabilityType: 'AGENT', providerId: provider.providerId }]),
      includeUnavailable: false,
    };

    await subsystem.validateStartupRegistration();
    await expect(subsystem.catalog.listAvailable(request)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'external-agent', provider })]),
    );
    await expect(subsystem.catalog.listAvailable(request)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'external-agent', provider })]),
    );
    await subsystem.invocationPort.invoke(invocation('missing-tool'), new AbortController().signal);

    expect(providerCreated).toBe(1);
    expect(listAllCount).toBe(1);
  });

  it('keeps the startup registry snapshot frozen against later runtime input and file-backed discovery changes', async () => {
    const lateProvider: CapabilityProviderIdentity = { providerId: 'late-tools', providerKind: 'CUSTOM', providerType: 'test' };
    const descriptors: CapabilityDescriptor[] = [agentDescriptor('external-agent', provider)];
    const providers: CapabilityProvider[] = [
      {
        identity: provider,
        discovery: discoveryOnly(provider, descriptors),
      },
    ];
    const snapshot = assembleCapabilityProviders(providers);
    const subsystem = createCapabilitySubsystem({ externalProviders: providers });
    await snapshot.validateStartupRegistration(new AbortController().signal);
    await subsystem.validateStartupRegistration();
    providers.push({
      identity: lateProvider,
      discovery: discoveryOnly(lateProvider, [agentDescriptor('late-agent', lateProvider)]),
    });
    descriptors.push(agentDescriptor('file-added-agent', provider));

    expect(Object.isFrozen(snapshot.providers)).toBe(true);
    expect(() => {
      (snapshot.providers as CapabilityProvider[]).push({ identity: lateProvider, discovery: discoveryOnly(lateProvider, []) });
    }).toThrow(TypeError);
    expect(snapshot.providers.map((item) => item.identity.providerId)).toContain(provider.providerId);
    expect(snapshot.providers.map((item) => item.identity.providerId)).not.toContain(lateProvider.providerId);

    await subsystem.invocationPort.invoke(
      invocation('missing-tool', { provider: { providerId: lateProvider.providerId, providerKind: lateProvider.providerKind } }),
      new AbortController().signal,
    );
    const available = await subsystem.catalog.listAvailable({
      tenantId,
      subjectId,
      agentAssembly: assembly([
        { capabilityId: 'external-agent', capabilityType: 'AGENT', providerId: provider.providerId },
        { capabilityId: 'file-added-agent', capabilityType: 'AGENT', providerId: provider.providerId },
        { capabilityId: 'late-agent', capabilityType: 'AGENT', providerId: lateProvider.providerId },
      ]),
      includeUnavailable: false,
    });
    expect(available).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'external-agent', provider })]));
    expect(available).not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'file-added-agent', provider })]));
    expect(available).not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'late-agent', provider: lateProvider })]));
  });

  it('derives the default Tool executor only from ToolExecutableDiscovery', async () => {
    const subsystem = createCapabilitySubsystem({
      externalProviders: [
        {
          identity: provider,
          discovery: createToolCatalog({
            provider,
            tools: [testTool('external-tool', { ok: true })],
          }),
        },
      ],
    });

    await expect(
      subsystem.catalog.listAvailable({
        tenantId,
        subjectId,
        agentAssembly: assembly([{ capabilityId: 'external-tool', capabilityType: 'TOOL', providerId: provider.providerId }]),
        includeUnavailable: false,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'external-tool', provider, availabilityStatus: 'AVAILABLE' })]),
    );
    await expect(subsystem.invocationPort.invoke(invocation('external-tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { ok: true },
    });
  });

  it('marks TOOL descriptors without an executor unavailable and returns a safe invocation failure', async () => {
    const descriptor = toolDescriptor('unhandled-tool', provider);
    const subsystem = createCapabilitySubsystem({
      externalProviders: [{ identity: provider, discovery: discoveryOnly(provider, [descriptor]) }],
    });
    const scopedAssembly = assembly([{ capabilityId: 'unhandled-tool', capabilityType: 'TOOL', providerId: provider.providerId }]);

    const diagnostics = await subsystem.validateStartupRegistration();
    expect(diagnostics).toEqual([
      {
        severity: 'WARNING',
        reasonCode: 'EXECUTOR_UNAVAILABLE',
        providerId: 'external-tools',
        capabilityId: 'unhandled-tool',
        summary: 'Capability executor is unavailable.',
      },
    ]);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    await expect(subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: scopedAssembly, includeUnavailable: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capabilityId: 'unhandled-tool', availabilityStatus: 'UNAVAILABLE', availabilityReason: 'EXECUTOR_UNAVAILABLE' }),
      ]),
    );
    await expect(
      subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: scopedAssembly, includeUnavailable: false }),
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'unhandled-tool' })]));
    await expect(subsystem.invocationPort.invoke(invocation('unhandled-tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_UNAVAILABLE', category: 'UNAVAILABLE' },
    });
    expect(JSON.stringify(diagnostics)).not.toContain('token=');
  });

  it('rejects duplicate capability candidates through the governed catalog outcome', async () => {
    const duplicateProvider: CapabilityProviderIdentity = { providerId: 'duplicate-agent-provider', providerKind: 'CUSTOM', providerType: 'test' };
    const capabilityId = brand<string, 'CapabilityId'>('duplicate-agent');
    const subsystem = createCapabilitySubsystem({
      externalProviders: [
        {
          identity: duplicateProvider,
          discovery: discoveryOnly(duplicateProvider, [
            agentDescriptor(capabilityId, duplicateProvider),
            agentDescriptor(capabilityId, duplicateProvider),
          ]),
        },
      ],
    });
    const scopedAssembly = assembly([{ capabilityId, capabilityType: 'AGENT', providerId: duplicateProvider.providerId }]);

    const diagnostics = await subsystem.validateStartupRegistration();
    const visible = await subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: scopedAssembly, includeUnavailable: true });
    expect(visible.filter((descriptor) => descriptor.capabilityId === capabilityId)).toEqual([]);
    await expect(subsystem.catalog.resolve({ tenantId, subjectId, agentAssembly: scopedAssembly, capabilityId })).resolves.toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('fails descriptor provider mismatch closed with one safe diagnostic', async () => {
    const subsystem = createCapabilitySubsystem({
      externalProviders: [
        {
          identity: provider,
          discovery: discoveryOnly(provider, [
            toolDescriptor('wrong-provider-tool', { providerId: 'wrong-provider', providerKind: 'CUSTOM', providerType: 'test' }),
          ]),
        },
      ],
    });

    const diagnostics = await subsystem.validateStartupRegistration();
    await subsystem.catalog.listAvailable({
      tenantId,
      subjectId,
      agentAssembly: assembly([{ capabilityId: 'wrong-provider-tool', capabilityType: 'TOOL', providerId: provider.providerId }]),
      includeUnavailable: true,
    });
    await subsystem.catalog.listAvailable({
      tenantId,
      subjectId,
      agentAssembly: assembly([{ capabilityId: 'wrong-provider-tool', capabilityType: 'TOOL', providerId: provider.providerId }]),
      includeUnavailable: true,
    });

    expect(diagnostics).toEqual([
      {
        severity: 'ERROR',
        reasonCode: 'DESCRIPTOR_PROVIDER_MISMATCH',
        providerId: 'external-tools',
        capabilityId: 'wrong-provider-tool',
        summary: 'Descriptor provider mismatch.',
      },
    ]);
  });

  it('invokes the Agent-scoped resolved descriptor instead of re-resolving globally', async () => {
    const catalog = createToolCatalog({
      provider,
      tools: [testTool('external-tool', { ok: true })],
    });
    const descriptor = (await catalog.listAll(new AbortController().signal))[0]!;
    const invocationPort = new GovernedCapabilityInvocationPort(
      {
        async resolveForInvocation() {
          return undefined;
        },
      },
      createStaticCapabilityExecutorFactory([{ provider, executor: new BuiltinToolsExecutor(catalog) }]),
    );

    await expect(
      invocationPort.invoke(
        {
          ...invocation('external-tool'),
          resolvedDescriptor: descriptor,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { ok: true },
    });
    await expect(
      invocationPort.invoke(
        {
          ...invocation('other-tool'),
          resolvedDescriptor: descriptor,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
  });
});

describe('ProviderDiscoveryGuard listCurrent boundary', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exposes optional listCurrent and passes the caller AbortSignal through its guard', async () => {
    let receivedSignal: AbortSignal | undefined;
    const currentDescriptor = agentDescriptor('current-agent', provider);
    const discovery = currentDiscovery(async (_criteria, signal) => {
      receivedSignal = signal;
      return [currentDescriptor];
    });
    const [guard] = assembleCapabilityProviders([{ identity: provider, discovery }]).searchDiscoveries;
    const controller = new AbortController();

    await expect(readCurrent(guard!, controller.signal)).resolves.toEqual([expect.objectContaining({ capabilityId: 'current-agent' })]);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).not.toBe(controller.signal);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('keeps method absence observable instead of falling back to search', () => {
    const [guard] = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: {
          provider,
          discoveryMode: 'SEARCH',
          async search() {
            return [agentDescriptor('remote-agent', provider)];
          },
        },
      },
    ]).searchDiscoveries;

    expect((guard as CapabilityDiscovery & { readonly listCurrent?: unknown }).listCurrent).toBeUndefined();
  });

  it('rejects provider failures instead of converting them to an empty successful current view', async () => {
    const providerFailure = new Error('provider-private failure');
    const [guard] = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: currentDiscovery(async () => {
          throw providerFailure;
        }),
      },
    ]).searchDiscoveries;

    await expect(readCurrent(guard!, new AbortController().signal)).rejects.toMatchObject({
      message: 'Capability current discovery failed.',
      cause: providerFailure,
    });
  });

  it('rejects cancellation and aborts the Provider operation', async () => {
    let providerSignal: AbortSignal | undefined;
    const [guard] = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: currentDiscovery(
          async (_criteria, signal) =>
            await new Promise<readonly CapabilityDescriptor[]>((_resolve, reject) => {
              providerSignal = signal;
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }),
        ),
      },
    ]).searchDiscoveries;
    const controller = new AbortController();
    const result = readCurrent(guard!, controller.signal);

    controller.abort();

    await expect(result).rejects.toThrow('Capability current discovery was canceled.');
    expect(providerSignal?.aborted).toBe(true);
  });

  it('rejects timeout instead of returning a partial or empty current view', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const [guard] = assembleCapabilityProviders([
      {
        identity: provider,
        discovery: currentDiscovery(async () => await new Promise<readonly CapabilityDescriptor[]>(() => {})),
      },
    ]).searchDiscoveries;
    const result = readCurrent(guard!, new AbortController().signal);
    const outcome = result.then(
      () => undefined,
      (error: unknown) => error,
    );

    timeoutController.abort();

    expect(await outcome).toEqual(expect.objectContaining({ message: 'Capability current discovery timed out.' }));
  });

  it('rejects an invalid descriptor returned by listCurrent', async () => {
    const invalid = { ...agentDescriptor('invalid-agent', provider), displayName: '' };
    const [guard] = assembleCapabilityProviders([{ identity: provider, discovery: currentDiscovery(async () => [invalid]) }]).searchDiscoveries;

    await expect(readCurrent(guard!, new AbortController().signal)).rejects.toThrow('Capability current discovery returned invalid descriptors.');
  });
});

function discoveryOnly(sourceProvider: CapabilityProviderIdentity, descriptors: readonly CapabilityDescriptor[]): CapabilityDiscovery {
  return {
    provider: sourceProvider,
    discoveryMode: 'EAGER',
    async listAll() {
      return descriptors;
    },
  };
}

function currentDiscovery(
  listCurrent: (criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>,
): CapabilityDiscovery {
  return {
    provider,
    discoveryMode: 'SEARCH',
    async search() {
      return [];
    },
    listCurrent,
  };
}

function readCurrent(discovery: CapabilityDiscovery, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
  const operation = (
    discovery as CapabilityDiscovery & {
      readonly listCurrent?: (criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
    }
  ).listCurrent;
  if (operation === undefined) {
    return Promise.reject(new Error('Capability current discovery is unavailable.'));
  }
  return operation(
    {
      tenantId,
      subjectId,
      agentId,
      agentVersion,
      sessionId,
      agentAssemblyRef: 'agent-extension:v1',
    },
    signal,
  );
}

function testTool(name: string, output: JsonObject): ToolDefinition {
  return {
    metadata: {
      name: brand<string, 'CapabilityId'>(name),
      description: `${name} test tool.`,
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: true },
      replayPolicy: 'IDEMPOTENT',
    },
    tool: {
      async execute() {
        return output;
      },
    },
  };
}

function toolDescriptor(capabilityId: string, sourceProvider: CapabilityProviderIdentity): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider: sourceProvider,
    displayName: capabilityId,
    description: `${capabilityId} descriptor.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function agentDescriptor(capabilityId: string, sourceProvider: CapabilityProviderIdentity): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'AGENT',
    provider: sourceProvider,
    displayName: capabilityId,
    description: `${capabilityId} descriptor.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function invocation(capabilityId: string, args: JsonObject = {}): CapabilityInvocationRequest {
  return {
    invocationId: `invoke-${capabilityId}`,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: args,
    sessionId: brand<string, 'SessionId'>('session-extension'),
    requestId: brand<string, 'MessageId'>('request-extension'),
    runId: brand<string, 'RequestRunId'>('run-extension'),
    requestContextId: brand<string, 'RequestContextId'>('context-extension'),
    stepId: 'turn-1',
    identityContext: { tenantId, subjectId, displayName: 'Extension tester' },
    agentId,
    agentVersion,
    timeoutMs: 30_000,
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings']): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: 'agent-extension:v1',
    displayName: 'Extension test agent',
    description: 'Extension registration test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}
