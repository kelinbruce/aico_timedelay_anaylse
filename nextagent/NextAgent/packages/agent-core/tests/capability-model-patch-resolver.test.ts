import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityContextPatch, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { authorizeCapabilityModelPatch, mergeGovernedCapabilityContextPatch } from '../src/model/capability-model-patch-resolver.js';
import { describe, expect, it } from 'vitest';

describe('capability model patch governance', () => {
  it('accepts all canonical inference fields only from the canonical Skill tool', () => {
    const patch: CapabilityContextPatch = {
      modelId: 'model-b',
      modelOptions: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        topP: 0.9,
        topK: 40,
        presencePenalty: 0.3,
        frequencyPenalty: -0.2,
        thinking: { depth: 'HIGH' },
        toolChoice: 'NONE',
        providerOptions: { serviceTier: 'priority' },
      },
    };
    const authorized = authorizeCapabilityModelPatch(skillTool(), patch, assembly());

    expect(mergeGovernedCapabilityContextPatch(undefined, patch, authorized)).toEqual(patch);
  });

  it('rejects model-shaped injection from non-Skill capabilities', () => {
    for (const patch of [
      { modelId: 'model-b' },
      { modelOptions: { temperature: 0.2 } },
      { modelOptions: { providerOptions: { serviceTier: 'priority' } } },
    ] satisfies readonly CapabilityContextPatch[]) {
      expect(() => authorizeCapabilityModelPatch(readTool(), patch, assembly())).toThrowError(
        expect.objectContaining({ code: 'CAPABILITY_MODEL_PATCH_DENIED' }),
      );
    }
  });

  it('rejects unactivated model ids and malformed runtime option shapes', () => {
    expect(() => authorizeCapabilityModelPatch(skillTool(), { modelId: 'configured-but-not-activated' }, assembly())).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_MODEL_PATCH_DENIED' }),
    );
    expect(() =>
      authorizeCapabilityModelPatch(skillTool(), { modelOptions: { providerOptions: null } } as unknown as CapabilityContextPatch, assembly()),
    ).toThrowError(expect.objectContaining({ code: 'CAPABILITY_MODEL_PATCH_DENIED' }));
    expect(() =>
      authorizeCapabilityModelPatch(skillTool(), { modelOptions: { timeoutMs: 30_000 } } as unknown as CapabilityContextPatch, assembly()),
    ).toThrowError(expect.objectContaining({ code: 'CAPABILITY_MODEL_PATCH_DENIED' }));
  });

  it('rejects lifecycle or metadata mutation that changes the authorized Skill model patch', () => {
    const original: CapabilityContextPatch = {
      modelId: 'model-b',
      modelOptions: { temperature: 0.2 },
    };
    const authorized = authorizeCapabilityModelPatch(skillTool(), original, assembly());

    expect(() =>
      mergeGovernedCapabilityContextPatch(
        undefined,
        {
          ...original,
          modelOptions: { temperature: 0.8 },
        },
        authorized,
      ),
    ).toThrowError(expect.objectContaining({ code: 'CAPABILITY_MODEL_PATCH_DENIED' }));
    expect(() =>
      mergeGovernedCapabilityContextPatch(
        undefined,
        {
          allowedTools: [brand<string, 'CapabilityId'>('Read')],
          modelOptions: { providerOptions: { injected: true } },
        },
        undefined,
      ),
    ).toThrowError(expect.objectContaining({ code: 'CAPABILITY_MODEL_PATCH_DENIED' }));
  });

  it('preserves non-model context patches without creating model defaults', () => {
    const patch: CapabilityContextPatch = {
      allowedTools: [brand<string, 'CapabilityId'>('Read')],
      deniedTools: [brand<string, 'CapabilityId'>('Bash')],
    };
    const authorized = authorizeCapabilityModelPatch(readTool(), patch, assembly());
    const merged = mergeGovernedCapabilityContextPatch(undefined, patch, authorized);

    expect(merged).toEqual(patch);
    expect(merged).not.toHaveProperty('modelId');
    expect(merged).not.toHaveProperty('modelOptions');
  });

  it('merges successive governed Skill options by field without erasing omitted values', () => {
    const current: CapabilityContextPatch = {
      modelId: 'model-a',
      modelOptions: {
        temperature: 0.2,
        providerOptions: {
          nested: { fromFirstSkill: true },
          firstOnly: true,
        },
      },
    };
    const next: CapabilityContextPatch = {
      modelOptions: {
        topP: 0.8,
        providerOptions: {
          nested: { fromSecondSkill: true },
          secondOnly: true,
        },
      },
    };
    const authorized = authorizeCapabilityModelPatch(skillTool(), next, assembly());

    expect(mergeGovernedCapabilityContextPatch(current, next, authorized)).toEqual({
      modelId: 'model-a',
      modelOptions: {
        temperature: 0.2,
        topP: 0.8,
        providerOptions: {
          nested: { fromSecondSkill: true },
          firstOnly: true,
          secondOnly: true,
        },
      },
    });
  });
});

function skillTool(): CapabilityDescriptor {
  return descriptor('Skill', 'builtin-tools');
}

function readTool(): CapabilityDescriptor {
  return descriptor('Read', 'builtin-tools');
}

function descriptor(capabilityId: string, providerId: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider: { providerId, providerKind: 'BUNDLED' },
    displayName: capabilityId,
    description: 'Test capability',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent'),
    agentType: brand<string, 'AgentType'>('LLM'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent:v1',
    displayName: 'Agent',
    description: 'Telecom diagnostics',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [],
    },
    modelIds: ['model-a', 'model-b'],
    defaultModelId: 'model-a',
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: {
      defaultLanguage: 'en',
      maxTurns: 1,
      maxToolCallsPerTurn: 30,
      maxContextMessages: 10,
      requestTimeoutMs: 30_000,
    },
  };
}
