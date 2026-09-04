import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCurrentViewPort, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { createCapabilityPresentationResourceQueryPort } from '@nextagent/agent-core';
import { describe, expect, it, vi } from 'vitest';

describe('createCapabilityPresentationResourceQueryPort', () => {
  it('uses the trusted Agent id to read the current assembly and projects only safe presentation fields', async () => {
    const assembly = agentAssembly();
    const active = vi.fn(async () => assembly);
    const listCurrent = vi.fn(async () => [
      descriptor('z-tool', { metadata: { privatePath: '/private/tool' } }),
      descriptor('a-skill', {
        kind: 'SKILL',
        locales: { language: { 'zh-CN': { displayName: '告警分析' }, 'en-US': { displayName: 'Alarm analysis' } } },
      }),
    ]);
    const port = createCapabilityPresentationResourceQueryPort({
      assemblyRegistry: registry(active),
      currentView: { listCurrent } satisfies CapabilityCurrentViewPort,
    });
    const identityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-presentation'),
      subjectId: brand<string, 'SubjectId'>('subject-presentation'),
      displayName: 'Operator',
    };
    const signal = new AbortController().signal;

    await expect(
      port.listResources(
        {
          identityContext,
          sessionId: brand<string, 'SessionId'>('session-presentation'),
          agentId: assembly.agentId,
        },
        signal,
      ),
    ).resolves.toEqual({
      resources: [
        {
          capabilityKind: 'SKILL',
          capabilityId: 'a-skill',
          displayName: 'a-skill',
          locales: { language: { 'zh-CN': { displayName: '告警分析' }, 'en-US': { displayName: 'Alarm analysis' } } },
        },
        { capabilityKind: 'TOOL', capabilityId: 'z-tool', displayName: 'z-tool' },
      ],
    });
    expect(active).toHaveBeenCalledWith(assembly.agentId);
    expect(listCurrent).toHaveBeenCalledWith(
      {
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        sessionId: 'session-presentation',
        agentAssembly: assembly,
      },
      signal,
    );
    expect(
      JSON.stringify(
        (await port.listResources({ identityContext, sessionId: brand<string, 'SessionId'>('s2'), agentId: assembly.agentId }, signal)).resources,
      ),
    ).not.toContain('privatePath');
  });

  it('propagates current-view failure and cancellation instead of returning a partial empty result', async () => {
    const assembly = agentAssembly();
    const expected = new Error('Capability current view is unavailable.');
    const port = createCapabilityPresentationResourceQueryPort({
      assemblyRegistry: registry(async () => assembly),
      currentView: {
        async listCurrent() {
          throw expected;
        },
      },
    });
    const signal = new AbortController().signal;

    await expect(
      port.listResources(
        {
          identityContext: {
            tenantId: brand<string, 'TenantId'>('tenant-presentation'),
            subjectId: brand<string, 'SubjectId'>('subject-presentation'),
            displayName: 'Operator',
          },
          sessionId: brand<string, 'SessionId'>('session-presentation'),
          agentId: assembly.agentId,
        },
        signal,
      ),
    ).rejects.toBe(expected);
  });
});

function registry(active: AgentAssemblyRegistry['active']): AgentAssemblyRegistry {
  return { active, require: active };
}

function agentAssembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent-presentation'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-presentation:v1',
    displayName: 'Presentation Agent',
    description: 'Presentation test Agent.',
    workspacePolicy: { schemaVersion: 'nextagent.agent-workspace-policy.v1', isolationMode: 'subject', roots: [] },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1_000 },
  };
}

function descriptor(capabilityId: string, overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider: { providerId: 'presentation-provider', providerKind: 'CUSTOM' },
    displayName: capabilityId,
    description: `${capabilityId} description`,
    availabilityStatus: 'AVAILABLE',
    ...overrides,
  };
}
