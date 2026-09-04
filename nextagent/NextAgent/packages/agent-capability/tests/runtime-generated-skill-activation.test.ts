import { createCapabilitySubsystem } from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly, AgentWorkspacePolicy } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest, CapabilityInvocationRuntimeContext } from '@nextagent/agent-contracts/capability';
import type { SkillHubRemoteAccessPort } from '../src/skillhub/skillhub-source.js';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('runtime-generated skill activation', () => {
  it('allows same-runtime direct Skill invocation immediately after writing a generated skill manifest', async () => {
    const runtimeWorkspaceRoot = await createRuntimeWorkspace();
    const subsystem = createCapabilitySubsystem({
      read: {
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return workspacePolicy();
          },
        },
        writeDirectories: ['generated-skills'],
      },
    });

    await expect(
      subsystem.invocationPort.invoke(
        request('Write', {
          file_path: 'generated-skills/space-view/SKILL.md',
          content: [
            '---',
            'name: space-view',
            'description: View workspace files and read file contents.',
            'context: inline',
            'allowed-tools: Glob Read',
            '---',
            '',
            '# Space View',
            '',
            'Use Glob and Read within workspace.',
          ].join('\n'),
        }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: expect.objectContaining({
        generated_skill: {
          capability_id: 'space-view',
          ready: true,
          next_skill_call: 'Skill(name="space-view")',
        },
      }),
    });

    await expect(
      subsystem.catalog.resolve({
        tenantId: tenantId(),
        subjectId: subjectId(),
        sessionId: sessionId(),
        agentAssembly: assembly(),
        capabilityId: brand<string, 'CapabilityId'>('space-view'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        capabilityId: 'space-view',
        provider: { providerId: 'local-skills-runtime-generated', providerKind: 'LOCAL_DIRECTORY' },
      }),
    );

    await expect(
      subsystem.invocationPort.invoke(request('Skill', { name: 'space-view' }), new AbortController().signal, runtimeContext(subsystem)),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'space-view', status: 'loaded' },
    });
  });

  it('does not synchronize runtime-generated skills to SkillHub managed source', async () => {
    const runtimeWorkspaceRoot = await createRuntimeWorkspace();
    const skillHubRoot = await createRuntimeWorkspace();
    const remote: SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: unknown[] } = {
      searches: [],
      fetches: [],
      async listCandidates(input) {
        this.searches.push(input);
        return { status: 'ok', candidates: [] };
      },
      async fetchContent(input) {
        this.fetches.push(input);
        return { status: 'failed', reasonCode: 'download-failed' };
      },
    };
    const subsystem = createCapabilitySubsystem({
      read: {
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return workspacePolicy();
          },
        },
        writeDirectories: ['generated-skills'],
      },
      providerConfigs: [
        {
          provider: { providerId: 'hub-local', providerKind: 'SKILL_HUB' },
          discoveryMode: 'SEARCH',
          options: { gatewayId: 'skillhub-test', managedInstallRef: skillHubRoot },
        },
      ],
      skillHubRemoteAccessFactory: () => remote,
      skillHubSourceAuthorization: () => true,
    });

    await expect(
      subsystem.invocationPort.invoke(
        request('Write', {
          file_path: 'generated-skills/local-planner/SKILL.md',
          content: [
            '---',
            'name: local-planner',
            'description: Plan local operations.',
            'context: inline',
            '---',
            '',
            '# Local Planner',
            '',
            'Plan without SkillHub publication.',
          ].join('\n'),
        }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: expect.objectContaining({
        generated_skill: {
          capability_id: 'local-planner',
          ready: true,
          next_skill_call: 'Skill(name="local-planner")',
        },
      }),
    });

    await expect(
      subsystem.invocationPort.invoke(request('Skill', { name: 'local-planner' }), new AbortController().signal, runtimeContext(subsystem)),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'local-planner', status: 'loaded' },
    });
    expect(remote.searches).toEqual([]);
    expect(remote.fetches).toEqual([]);
    await expect(readFile(join(skillHubRoot, 'remote-skill-content-index.json'), 'utf8')).rejects.toThrow();
  });
});

async function createRuntimeWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-generated-skill-'));
  tempDirectories.push(directory);
  return directory;
}

function request(capabilityId: string, argumentsValue: JsonObject): CapabilityInvocationRequest {
  return {
    invocationId: `invoke-${capabilityId}`,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: argumentsValue,
    sessionId: sessionId(),
    requestId: brand<string, 'MessageId'>('request-generated-skill'),
    runId: brand<string, 'RequestRunId'>('run-generated-skill'),
    requestContextId: brand<string, 'RequestContextId'>('context-generated-skill'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Generated Skill Tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-${capabilityId}`),
  };
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Generated skill activation test agent.',
    workspacePolicy: workspacePolicy(),
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function workspacePolicy(): AgentWorkspacePolicy {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1',
    isolationMode: 'subject',
    roots: [
      { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
      { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
      { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      { kind: 'generatedSkills', logicalPath: 'generated-skills', access: 'readWrite' },
    ],
    files: { writeDirectories: ['generated-skills'], maxTextBytes: 256_000 },
  };
}

function runtimeContext(subsystem: ReturnType<typeof createCapabilitySubsystem>): CapabilityInvocationRuntimeContext {
  return {
    capabilityResolver: {
      async resolveCapability(input) {
        return subsystem.catalog.resolve({
          tenantId: tenantId(),
          subjectId: subjectId(),
          sessionId: sessionId(),
          agentAssembly: assembly(),
          capabilityId: input.capabilityId,
          ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
          ...(input.kind === 'TOOL' ? { modelInvocable: true } : {}),
        });
      },
    },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-generated-skill');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-generated-skill');
}

function sessionId() {
  return brand<string, 'SessionId'>('session-generated-skill');
}
