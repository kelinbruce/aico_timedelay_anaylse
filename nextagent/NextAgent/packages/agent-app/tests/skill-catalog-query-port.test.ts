import { brand, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, SkillMetadata } from '@nextagent/agent-contracts/capability';
import { readSkillMetadata } from '@nextagent/agent-capability';
import { createSkillCatalogQueryPort, type SkillCatalogQueryPortOptions } from '@nextagent/agent-core';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-skill-catalog');
const subjectId = brand<string, 'SubjectId'>('subject-skill-catalog');
const agentId = brand<string, 'AgentId'>('default-agent');

describe('createSkillCatalogQueryPort', () => {
  it('only exposes user-invocable Skills to the UI catalog', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([skillDescriptor('network-diagnostics', true), skillDescriptor('skill-creator', false), toolDescriptor()]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
    });

    expect(result.skills.map((skill) => skill.capabilityId)).toEqual(['network-diagnostics']);
    expect(JSON.stringify(result.skills)).not.toContain('skill-creator');
  });

  it('projects validated source metadata without exposing internal Skill metadata', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([
        skillDescriptor('network-diagnostics', true, {
          sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
          extension: { authoring: { internalTitle: 'not-for-web' } },
          model: 'internal-model',
          allowedTools: ['Read'],
          deniedTools: ['Write'],
        }),
      ]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
    });

    expect(result.skills[0]?.sourceMetadata).toEqual({
      'zh-name': '网络诊断',
      'en-name': 'Network Diagnostics',
    });
    const serialized = JSON.stringify(result.skills[0]);
    expect(serialized).not.toContain('not-for-web');
    expect(serialized).not.toContain('internal-model');
    expect(serialized).not.toContain('allowedTools');
    expect(serialized).not.toContain('deniedTools');
  });

  it('matches a keyword against sourceMetadata localized display names', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([
        skillDescriptor('network-diagnostics', true, {
          sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
        }),
        skillDescriptor('alarm-diagnosis', true, {
          sourceMetadata: { 'zh-name': '告警诊断', 'en-name': 'Alarm Diagnosis' },
        }),
      ]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
      keyword: '网络',
    });

    expect(result.skills.map((skill) => skill.capabilityId)).toEqual(['network-diagnostics']);
    expect(result.total).toBe(1);
  });

  it('matches a keyword against the English localized name only', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([
        skillDescriptor('network-diagnostics', true, {
          sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
        }),
      ]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
      keyword: 'network',
    });

    expect(result.skills.map((skill) => skill.capabilityId)).toEqual(['network-diagnostics']);
  });

  it('falls back to displayName and capabilityId when sourceMetadata is absent', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([
        skillDescriptor('alarm-diagnosis', true),
        skillDescriptor('network-diagnostics', true, {
          sourceMetadata: { 'zh-name': '网络诊断' },
        }),
      ]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
      keyword: 'alarm',
    });

    expect(result.skills.map((skill) => skill.capabilityId)).toEqual(['alarm-diagnosis']);
  });

  it('does not match a keyword against description, extension or governed metadata', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([
        skillDescriptor('network-diagnostics', true, {
          sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
          extension: { authoring: { internalTitle: 'internal-secret' } },
        }),
      ]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
      keyword: 'internal-secret',
    });

    expect(result.total).toBe(0);
    expect(result.skills).toEqual([]);
  });

  it('safely skips non-string sourceMetadata values when matching keywords', async () => {
    const catalog = createSkillCatalogQueryPort(
      context([
        skillDescriptor('network-diagnostics', true, {
          sourceMetadata: { 'zh-name': ['网络诊断', '备用名'], 'en-name': 'Network Diagnostics' },
        }),
      ]),
    );

    const result = await catalog.listSkills({
      identityContext: identityContext(),
      pageNum: 1,
      pageSize: 50,
      keyword: '备用名',
    });

    expect(result.total).toBe(0);
    expect(result.skills).toEqual([]);
  });
});

function context(descriptors: readonly CapabilityDescriptor[]): SkillCatalogQueryPortOptions {
  const assembly = agentAssembly();
  return {
    defaultAgentId: agentId,
    readSkillMetadata,
    catalog: {
      async listAvailable() {
        return descriptors;
      },
      async resolve() {
        return undefined;
      },
    },
    assemblyRegistry: {
      async active() {
        return assembly;
      },
      async require() {
        return assembly;
      },
    },
  };
}

function skillDescriptor(
  capabilityId: string,
  userInvocable: boolean,
  metadataOverrides: Pick<SkillMetadata, 'sourceMetadata' | 'extension' | 'model' | 'allowedTools' | 'deniedTools'> = {},
): CapabilityDescriptor {
  const metadata: SkillMetadata = {
    metadataKind: 'nextagent.skill',
    context: 'inline',
    userInvocable,
    modelInvocable: true,
    ...metadataOverrides,
  };
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'SKILL',
    provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
    displayName: capabilityId,
    description: `${capabilityId} skill`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    metadata,
  };
}

function toolDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Read'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Read',
    description: 'Read files.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function identityContext(): IdentityContext {
  return {
    tenantId,
    subjectId,
    displayName: 'Skill Catalog Tester',
  };
}

function agentAssembly(): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default',
    description: 'Default test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}
