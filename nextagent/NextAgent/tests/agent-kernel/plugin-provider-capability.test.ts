import { brand, type JsonObject } from '@nextagent/agent-common';
import { defineTool, defineToolProvider } from '@nextagent/agent-plugin-sdk';
import { createCapabilitySubsystem } from '@nextagent/agent-capability';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityDescriptor,
  CapabilityDiscovery,
  CapabilityInvocationRequest,
  CapabilityProvider,
  CapabilityProviderIdentity,
} from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-plugin-provider');
const subjectId = brand<string, 'SubjectId'>('subject-plugin-provider');
const agentId = brand<string, 'AgentId'>('agent-plugin-provider');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const pluginProvider: CapabilityProviderIdentity = { providerId: 'telecom.ops.tools', providerKind: 'CUSTOM', providerType: 'nextagent-plugin-tool' };

describe('plugin provider capability integration', () => {
  it('exposes and invokes an EAGER plugin Tool only for an Agent with exact capability binding', async () => {
    const provider = defineToolProvider({
      providerId: pluginProvider.providerId,
      tools: [
        defineTool({
          name: 'lookup-alarm' as never,
          description: 'Lookup alarm',
          inputSchema: { type: 'object', additionalProperties: false, properties: { alarmId: { type: 'string' } }, required: ['alarmId'] },
          outputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { alarmId: { type: 'string' }, status: { type: 'string' } },
            required: ['alarmId', 'status'],
          },
          async execute(input) {
            return { alarmId: String(input.alarmId), status: 'ACTIVE' };
          },
        }),
      ],
    });
    const subsystem = createCapabilitySubsystem({ externalProviders: [provider], builtinSkillDiscoveryOptions: { enabled: false } });
    await subsystem.validateStartupRegistration();

    await expect(list(subsystem, [])).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'lookup-alarm' })]));
    await expect(list(subsystem, [{ capabilityId: 'lookup-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId }])).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'lookup-alarm', provider: pluginProvider, availabilityStatus: 'AVAILABLE' })]),
    );
    await expect(
      subsystem.invocationPort.invoke(invocation('lookup-alarm', { alarmId: 'ALM-1' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { alarmId: 'ALM-1', status: 'ACTIVE' },
    });
  });

  it('keeps bound but unavailable plugin descriptors out of the available catalog', async () => {
    const provider: CapabilityProvider = {
      identity: pluginProvider,
      discovery: {
        provider: pluginProvider,
        discoveryMode: 'EAGER',
        async listAll() {
          return [
            {
              ...descriptor('missing-executor', pluginProvider),
              metadata: { requiredDependencies: ['workspaceFiles'] },
            },
          ];
        },
      },
      executor: {
        capabilityKinds: ['TOOL'],
        async invoke() {
          return { status: 'SUCCEEDED', structuredPayload: {}, generatedMessages: [], artifactRefs: [] };
        },
      },
    };
    const subsystem = createCapabilitySubsystem({ externalProviders: [provider], builtinSkillDiscoveryOptions: { enabled: false } });

    await expect(subsystem.validateStartupRegistration()).resolves.toEqual([
      expect.objectContaining({ reasonCode: 'TOOL_DEPENDENCY_MISSING', providerId: pluginProvider.providerId, capabilityId: 'missing-executor' }),
    ]);
    await expect(
      list(subsystem, [{ capabilityId: 'missing-executor', capabilityType: 'TOOL', providerId: pluginProvider.providerId }]),
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'missing-executor' })]));
  });

  it('requires search provider authorization before SEARCH plugin descriptors can be discovered', async () => {
    let searchCalls = 0;
    const provider: CapabilityProvider = {
      identity: pluginProvider,
      discovery: {
        provider: pluginProvider,
        discoveryMode: 'SEARCH',
        async search() {
          searchCalls += 1;
          return [descriptor('search-alarm', pluginProvider)];
        },
      },
      executor: {
        capabilityKinds: ['TOOL'],
        async invoke(_descriptor, request) {
          return { status: 'SUCCEEDED', structuredPayload: { invoked: request.capabilityId }, generatedMessages: [], artifactRefs: [] };
        },
      },
    };
    const subsystem = createCapabilitySubsystem({ externalProviders: [provider], builtinSkillDiscoveryOptions: { enabled: false } });
    await subsystem.validateStartupRegistration();

    await expect(list(subsystem, [])).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'search-alarm', provider: pluginProvider })]),
    );
    expect(searchCalls).toBe(0);
    await expect(list(subsystem, [{ capabilityId: 'search-alarm', capabilityType: 'TOOL', providerId: pluginProvider.providerId }])).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'search-alarm', provider: pluginProvider })]),
    );
    expect(searchCalls).toBe(1);
    await expect(
      subsystem.invocationPort.invoke(
        { ...invocation('search-alarm', {}), resolvedDescriptor: descriptor('search-alarm', pluginProvider) },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { invoked: 'search-alarm' },
    });
  });
});

function list(subsystem: ReturnType<typeof createCapabilitySubsystem>, capabilityBindings: AgentAssembly['capabilityBindings']) {
  return subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: assembly(capabilityBindings), includeUnavailable: false });
}

function descriptor(capabilityId: string, provider: CapabilityProviderIdentity): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider,
    displayName: capabilityId,
    description: `${capabilityId} descriptor.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function invocation(capabilityId: string, args: JsonObject): CapabilityInvocationRequest {
  return {
    invocationId: `invoke-${capabilityId}`,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: args,
    sessionId: brand<string, 'SessionId'>('session-plugin-provider'),
    requestId: brand<string, 'MessageId'>('request-plugin-provider'),
    runId: brand<string, 'RequestRunId'>('run-plugin-provider'),
    requestContextId: brand<string, 'RequestContextId'>('context-plugin-provider'),
    stepId: 'turn-1',
    identityContext: { tenantId, subjectId, displayName: 'Plugin provider tester' },
    agentId,
    agentVersion,
    timeoutMs: 30_000,
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings']): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('telecom'),
    agentVersion,
    agentAssemblyRef: 'agent-plugin-provider:v1',
    displayName: 'Plugin provider test agent',
    description: 'Plugin provider test agent.',
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
