import {
  BuiltinToolsExecutor,
  GovernedCapabilityInvocationPort,
  createStaticCapabilityExecutorFactory,
  createCapabilitySubsystem,
  createToolCatalog,
  SkillAcquisitionService,
  skillHubAcquireSkillCapabilityId,
  skillHubAcquireSkillToolDefinition,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityInvocationRuntimeContext,
  CapabilityProviderIdentity,
  RuntimeCapabilityListRequest,
  RuntimeCapabilityResolveRequest,
} from '@nextagent/agent-contracts/capability';
import type { SkillHubRemoteAccessPort } from '../src/skillhub/skillhub-source.js';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const toolProvider: CapabilityProviderIdentity = { providerId: 'hub-local', providerKind: 'SKILL_HUB' };

describe('Skill acquisition', () => {
  it('describes the fixed acquisition tool with safe bounded schemas', async () => {
    const [descriptor] = await createToolCatalog({ provider: toolProvider, tools: [skillHubAcquireSkillToolDefinition] }).listAll(
      new AbortController().signal,
    );

    expect(descriptor).toMatchObject({
      capabilityId: skillHubAcquireSkillCapabilityId,
      kind: 'TOOL',
      provider: toolProvider,
      modelInvocable: true,
      availabilityStatus: 'AVAILABLE',
      replayPolicy: 'IDEMPOTENT',
      inputSchema: expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          requested_capability_id: expect.objectContaining({ maxLength: 128 }),
          query: expect.objectContaining({ maxLength: 256 }),
          provider_id: expect.objectContaining({ maxLength: 128 }),
        }),
      }),
      outputSchema: expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({ outcomeCode: expect.any(Object), requiresReplan: expect.any(Object) }),
      }),
    });
  });

  it('acquires a governed SkillHub Skill and marks it for next-step Skill loading', async () => {
    const result = await invokeAcquireSkill({ requested_capability_id: 'ran-qos-skill', provider_id: 'hub-local' }, [
      skillHubSkill('ran-qos-skill', 'RAN QoS Skill', 'Investigate RAN QoS degradation.'),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
        requiresReplan: true,
        providerKind: 'SKILL_HUB',
        providerId: 'hub-local',
        skillId: 'ran-qos-skill',
      },
      contextPatch: { discoveredSkills: ['ran-qos-skill'] },
    });
    expect(result.generatedMessages[0]?.content).toContain('<available-skills>');
    expect(result.generatedMessages[0]?.content).toContain('capability_id=ran-qos-skill');
    expect(JSON.stringify(result)).not.toContain('https://skillhub.example.test');
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(JSON.stringify(result)).not.toContain('skillhub-managed');
    expect(JSON.stringify(result)).not.toContain('staging');
    expect(JSON.stringify(result)).not.toContain('raw-package');
    expect(JSON.stringify(result)).not.toContain('sourceIdentity');
  });

  it('searches governed SkillHub Skills by safe query when no explicit capability id is provided', async () => {
    const result = await invokeAcquireSkill({ query: 'qos degradation' }, [
      skillHubSkill('ticket-skill', 'Ticket Skill', 'Open a ticket.'),
      skillHubSkill('ran-qos-skill', 'RAN QoS Skill', 'Investigate QoS degradation.', { mode: 'DEFERRED', searchHint: 'RAN QoS degradation' }),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
        skillId: 'ran-qos-skill',
      },
      contextPatch: { discoveredSkills: ['ran-qos-skill'] },
    });
    expect(JSON.stringify(result)).not.toContain('RAN QoS degradation');
  });

  it('rejects non SkillHub Skills and keeps provider-private facts out of the result', async () => {
    const result = await invokeAcquireSkill({ requested_capability_id: 'local-qos' }, [localSkill('local-qos', 'Local QoS', 'Local Skill.')]);

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'REJECTED',
        category: 'VALIDATION',
        retryable: false,
      },
    });
    expect(result.contextPatch).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('local://private-source');
    expect(JSON.stringify(result)).not.toContain('sourceIdentity');
  });

  it('deduplicates repeated acquisition attempts in the same service instance', async () => {
    let resolveCount = 0;
    const service = new SkillAcquisitionService({
      resolver: {
        async resolveCapability(_request: RuntimeCapabilityResolveRequest) {
          resolveCount += 1;
          return skillHubSkill('ran-qos-skill', 'RAN QoS Skill', 'Investigate RAN QoS degradation.');
        },
      },
    });

    await expect(service.acquire({ requestedCapabilityId: 'ran-qos-skill', providerId: 'hub-local' })).resolves.toMatchObject({
      outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
      skillId: 'ran-qos-skill',
    });
    await expect(service.acquire({ requestedCapabilityId: 'ran-qos-skill', providerId: 'hub-local' })).resolves.toMatchObject({
      outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
      skillId: 'ran-qos-skill',
    });
    expect(resolveCount).toBe(1);
  });

  it('acquires through the SkillHub governed install, index and catalog loading path', async () => {
    const root = await makeRoot();
    try {
      const remote = fakeRemote({
        'pkg:ran-qos-skill': skillManifest('ran-qos-skill', 'Investigate RAN QoS degradation.'),
      });
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: toolProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: ({ providerId, agentId }) => providerId === 'hub-local' && agentId === 'default-agent',
      });

      const acquisitionDescriptor = await resolveDescriptor(subsystem, runtimeAssembly(), 'acquire_skill');
      const result = await subsystem.invocationPort.invoke(
        request({ requested_capability_id: 'ran-qos-skill', provider_id: 'hub-local' }, acquisitionDescriptor),
        new AbortController().signal,
        catalogRuntimeContext(subsystem, runtimeAssembly()),
      );

      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        structuredPayload: {
          outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
          providerKind: 'SKILL_HUB',
          providerId: 'hub-local',
          skillId: 'ran-qos-skill',
        },
        contextPatch: { discoveredSkills: ['ran-qos-skill'] },
      });
      expect(remote.searches[0]).toMatchObject({
        tenantId: 'tenant-acquire-skill',
        subjectId: 'subject-acquire-skill',
        agentId: 'default-agent',
        agentVersion: 'v1',
        agentAssemblyRef: 'default-agent:v1',
        requestedCapabilityId: 'ran-qos-skill',
      });
      expect(remote.fetches).toEqual(['pkg:ran-qos-skill']);
      await expect(readFile(join(root, 'remote-skill-content-index.json'), 'utf8')).resolves.toContain('ran-qos-skill');

      const skillResult = await subsystem.invocationPort.invoke(
        requestForCapability('Skill', { name: 'ran-qos-skill' }),
        new AbortController().signal,
        catalogRuntimeContext(subsystem, runtimeAssembly()),
      );
      expect(skillResult).toMatchObject({
        status: 'SUCCEEDED',
        structuredPayload: { name: 'ran-qos-skill', status: 'loaded' },
      });
      expect(skillResult.metadata).toMatchObject({ agenticSkillLoaded: true, skillName: 'ran-qos-skill', providerId: 'hub-local' });
      expect(JSON.stringify(skillResult)).not.toContain(root);
      expect(JSON.stringify(skillResult)).not.toContain('pkg:ran-qos-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['remote unavailable', () => unavailableRemote()],
    ['scope mismatch', () => scopeMismatchRemote()],
    ['manifest invalid', () => fakeRemote({ 'pkg:ran-qos-skill': skillManifest('wrong-name', 'invalid manifest body') })],
    ['install failed', () => outsideStagingRemote()],
  ])('fails %s acquisition safely without publishing raw SkillHub facts', async (_caseName, createRemote) => {
    const root = await makeRoot();
    try {
      const remote = createRemote();
      const subsystem = createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: toolProvider,
            discoveryMode: 'SEARCH',
            options: { gatewayId: 'skillhub-test', managedInstallRef: root },
          },
        ],
        skillHubRemoteAccessFactory: () => remote,
        skillHubSourceAuthorization: () => true,
      });

      const acquisitionDescriptor = await resolveDescriptor(subsystem, runtimeAssembly(), 'acquire_skill');
      const result = await subsystem.invocationPort.invoke(
        request({ requested_capability_id: 'ran-qos-skill', provider_id: 'hub-local' }, acquisitionDescriptor),
        new AbortController().signal,
        catalogRuntimeContext(subsystem, runtimeAssembly()),
      );

      expect(result).toMatchObject({
        status: 'FAILED',
        structuredPayload: {},
        safeError: { code: 'NOT_FOUND', category: 'NOT_FOUND', retryable: false },
      });
      await expect(readFile(join(root, 'remote-skill-content-index.json'), 'utf8')).rejects.toThrow();
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('https://skillhub.example.test');
      expect(serialized).not.toContain('token=secret');
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain('staging');
      expect(serialized).not.toContain('pkg:ran-qos-skill');
      expect(serialized).not.toContain('other-agent');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function invokeAcquireSkill(args: JsonObject, descriptors: readonly CapabilityDescriptor[]) {
  const catalog = createToolCatalog({ provider: toolProvider, tools: [skillHubAcquireSkillToolDefinition] });
  const invocationPort = new GovernedCapabilityInvocationPort(
    {
      async resolveForInvocation(capabilityId, signal) {
        return (await catalog.listAll(signal)).find((descriptor) => descriptor.capabilityId === capabilityId);
      },
    },
    createStaticCapabilityExecutorFactory([{ provider: catalog.provider, executor: new BuiltinToolsExecutor(catalog) }]),
  );
  return invocationPort.invoke(request(args), new AbortController().signal, runtimeContext(descriptors));
}

function request(argumentsValue: JsonObject, resolvedDescriptor?: CapabilityDescriptor): CapabilityInvocationRequest {
  return requestForCapability(skillHubAcquireSkillCapabilityId, argumentsValue, resolvedDescriptor);
}

function requestForCapability(
  capabilityId: string,
  argumentsValue: JsonObject,
  resolvedDescriptor?: CapabilityDescriptor,
): CapabilityInvocationRequest {
  return {
    invocationId: `invoke-${capabilityId}`,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    ...(resolvedDescriptor === undefined ? {} : { resolvedDescriptor }),
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-acquire-skill'),
    requestId: brand<string, 'MessageId'>('request-acquire-skill'),
    runId: brand<string, 'RequestRunId'>('run-acquire-skill'),
    requestContextId: brand<string, 'RequestContextId'>('context-acquire-skill'),
    stepId: 'step-acquire-skill',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-acquire-skill'),
      subjectId: brand<string, 'SubjectId'>('subject-acquire-skill'),
      displayName: 'Skill Acquisition Tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-${capabilityId}`),
  };
}

async function resolveDescriptor(
  subsystem: ReturnType<typeof createCapabilitySubsystem>,
  agentAssembly: AgentAssembly,
  capabilityId: string,
): Promise<CapabilityDescriptor> {
  const descriptor = await subsystem.catalog.resolve({
    tenantId: brand<string, 'TenantId'>('tenant-acquire-skill'),
    subjectId: brand<string, 'SubjectId'>('subject-acquire-skill'),
    sessionId: brand<string, 'SessionId'>('session-acquire-skill'),
    agentAssembly,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
  });
  if (descriptor === undefined) {
    throw new Error(`Missing descriptor for ${capabilityId}`);
  }
  return descriptor;
}

function catalogRuntimeContext(
  subsystem: ReturnType<typeof createCapabilitySubsystem>,
  agentAssembly: AgentAssembly,
): CapabilityInvocationRuntimeContext {
  return {
    capabilityResolver: {
      async resolveCapability(input) {
        return subsystem.catalog.resolve({
          tenantId: brand<string, 'TenantId'>('tenant-acquire-skill'),
          subjectId: brand<string, 'SubjectId'>('subject-acquire-skill'),
          sessionId: brand<string, 'SessionId'>('session-acquire-skill'),
          agentAssembly,
          capabilityId: input.capabilityId,
        });
      },
      async listCapabilities(input) {
        return (
          await subsystem.catalog.listAvailable({
            tenantId: brand<string, 'TenantId'>('tenant-acquire-skill'),
            subjectId: brand<string, 'SubjectId'>('subject-acquire-skill'),
            sessionId: brand<string, 'SessionId'>('session-acquire-skill'),
            agentAssembly,
            includeUnavailable: false,
            ...(input.modelInvocable === undefined ? {} : { modelInvocable: input.modelInvocable }),
          })
        ).filter(
          (descriptor) =>
            (input.kind === undefined || descriptor.kind === input.kind) &&
            (input.modelInvocable === undefined || descriptor.modelInvocable === input.modelInvocable),
        );
      },
    },
  };
}

function runtimeAssembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Skill acquisition test agent.',
    workspacePolicy: { schemaVersion: 'nextagent.agent-workspace-policy.v1', isolationMode: 'subject', roots: [] },
    modelIds: ['test-model'],
    capabilityBindings: [{ capabilityId: 'acquire_skill', capabilityType: 'TOOL', providerId: 'hub-local', enabled: true }],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 30_000 },
  };
}

function runtimeContext(descriptors: readonly CapabilityDescriptor[]): CapabilityInvocationRuntimeContext {
  return {
    capabilityResolver: {
      async resolveCapability(input: RuntimeCapabilityResolveRequest) {
        return descriptors.find(
          (descriptor) =>
            descriptor.kind === input.kind &&
            descriptor.capabilityId === input.capabilityId &&
            (input.providerId === undefined || descriptor.provider.providerId === input.providerId),
        );
      },
      async listCapabilities(input: RuntimeCapabilityListRequest) {
        return descriptors.filter(
          (descriptor) =>
            (input.kind === undefined || descriptor.kind === input.kind) &&
            (input.modelInvocable === undefined || descriptor.modelInvocable === input.modelInvocable),
        );
      },
    },
  };
}

function skillHubSkill(
  capabilityId: string,
  displayName: string,
  description: string,
  disclosurePolicy: CapabilityDescriptor['disclosurePolicy'] = { mode: 'DEFERRED' },
): CapabilityDescriptor {
  return descriptor(capabilityId, displayName, description, { providerId: 'hub-local', providerKind: 'SKILL_HUB' }, disclosurePolicy);
}

function localSkill(capabilityId: string, displayName: string, description: string): CapabilityDescriptor {
  return descriptor(
    capabilityId,
    displayName,
    description,
    { providerId: 'local-skills', providerKind: 'LOCAL_DIRECTORY', providerType: 'local://private-source' },
    { mode: 'DEFERRED' },
  );
}

function descriptor(
  capabilityId: string,
  displayName: string,
  description: string,
  provider: CapabilityProviderIdentity,
  disclosurePolicy: CapabilityDescriptor['disclosurePolicy'],
): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'SKILL',
    provider,
    displayName,
    description,
    availabilityStatus: 'AVAILABLE',
    modelInvocable: true,
    ...(disclosurePolicy === undefined ? {} : { disclosurePolicy }),
    inputSchema: {},
    outputSchema: {},
    metadata: {
      sourceIdentity: 'sourceIdentity-secret',
      rawPackage: 'raw-package-secret',
      endpoint: 'https://skillhub.example.test',
      credential: 'credential-secret',
      managedPath: 'skillhub-managed/installed/secret',
      stagingPath: 'skillhub-managed/staging/secret',
    },
  };
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nextagent-skill-acquisition-'));
}

function fakeRemote(manifests: Record<string, string>): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: string[] } {
  const searches: unknown[] = [];
  const fetches: string[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      return {
        status: 'ok',
        candidates: Object.keys(manifests).map((contentRef) => ({
          skillId: contentRef.replace(/^pkg:/u, ''),
          contentRef,
          contentHash: `${contentRef}-hash`,
          agentId: brand<string, 'AgentId'>('default-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'default-agent:v1',
        })),
      };
    },
    async fetchContent(input) {
      fetches.push(input.contentRef);
      const content = manifests[input.contentRef];
      if (content === undefined) {
        return { status: 'failed', reasonCode: 'download-failed' };
      }
      const stagedFolder = join(input.stagingRoot, input.contentRef.replace(/[^A-Za-z0-9._-]/gu, '_'));
      await rm(stagedFolder, { recursive: true, force: true });
      await mkdir(stagedFolder, { recursive: true });
      await writeFile(join(stagedFolder, 'SKILL.md'), content, 'utf8');
      return { status: 'ok', stagingRoot: input.stagingRoot, stagedFolder, contentHash: `${input.contentRef}-hash` };
    },
  };
}

function unavailableRemote(): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: string[] } {
  const searches: unknown[] = [];
  const fetches: string[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      return { status: 'failed', reasonCode: 'unavailable', message: 'https://skillhub.example.test token=secret' };
    },
    async fetchContent(input) {
      fetches.push(input.contentRef);
      return { status: 'failed', reasonCode: 'download-failed' };
    },
  };
}

function scopeMismatchRemote(): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: string[] } {
  const searches: unknown[] = [];
  const fetches: string[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      return {
        status: 'ok',
        candidates: [
          {
            skillId: 'ran-qos-skill',
            contentRef: 'pkg:ran-qos-skill',
            agentId: brand<string, 'AgentId'>('other-agent'),
            agentVersion: brand<string, 'AgentVersion'>('v9'),
            agentAssemblyRef: 'other-agent:v9',
          },
        ],
      };
    },
    async fetchContent(input) {
      fetches.push(input.contentRef);
      return { status: 'failed', reasonCode: 'download-failed', message: 'https://skillhub.example.test token=secret' };
    },
  };
}

function outsideStagingRemote(): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: string[] } {
  const searches: unknown[] = [];
  const fetches: string[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      return {
        status: 'ok',
        candidates: [
          {
            skillId: 'ran-qos-skill',
            contentRef: 'pkg:ran-qos-skill',
            contentHash: 'ran-qos-skill-hash',
            agentId: brand<string, 'AgentId'>('default-agent'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
            agentAssemblyRef: 'default-agent:v1',
          },
        ],
      };
    },
    async fetchContent(input) {
      fetches.push(input.contentRef);
      const outside = join(input.stagingRoot, '..', 'outside-staging');
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'SKILL.md'), skillManifest('ran-qos-skill', 'outside body'), 'utf8');
      return { status: 'ok', stagingRoot: input.stagingRoot, stagedFolder: outside, contentHash: 'ran-qos-skill-hash' };
    },
  };
}

function skillManifest(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Test SkillHub Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n${body}`;
}
