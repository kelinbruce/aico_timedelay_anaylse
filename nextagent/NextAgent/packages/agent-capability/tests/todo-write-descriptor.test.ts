import { createCapabilitySubsystem, todoWriteCapabilityId, type TodoStatePort } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { describe, expect, it } from 'vitest';

describe('TodoWrite descriptor', () => {
  it('registers TodoWrite as a bundled idempotent Tool when todoState is injected', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { todoState: fakeTodoState() } });
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: false,
    });
    const descriptor = descriptors.find((entry) => entry.capabilityId === 'TodoWrite');

    expect(descriptor).toMatchObject({
      capabilityId: 'TodoWrite',
      displayName: 'TodoWrite',
      kind: 'TOOL',
      provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
      availabilityStatus: 'AVAILABLE',
      modelInvocable: true,
      replayPolicy: 'IDEMPOTENT',
    });
    expect(descriptor?.inputSchema).toMatchObject({ required: ['todos'], additionalProperties: false });
    expect(descriptor?.description).toContain('full ordered list');
    expect(descriptor?.description).toContain('To add a new item');
  });

  it('marks TodoWrite unavailable without todoState while preserving its canonical name', async () => {
    const subsystem = createCapabilitySubsystem();
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });

    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: 'TodoWrite',
          displayName: 'TodoWrite',
          availabilityStatus: 'UNAVAILABLE',
          availabilityReason: 'TOOL_DEPENDENCY_MISSING',
        }),
      ]),
    );
  });
});

function fakeTodoState(): TodoStatePort {
  return {
    async replaceTodos(input) {
      return { oldTodos: [], newTodos: input.todos };
    },
  };
}

function assembly(): AgentAssembly {
  return {
    agentId: agentId(),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    userInvocable: true,
    agentInvocation: 'BOUND',
    displayName: 'Default Agent',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' }],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-todo');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-todo');
}

function agentId() {
  return brand<string, 'AgentId'>('default-agent');
}
