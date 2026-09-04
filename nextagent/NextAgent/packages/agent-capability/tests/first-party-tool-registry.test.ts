import { createBuiltinToolDefinitions, skillHubAcquireSkillToolDefinition, type ToolDefinition } from '@nextagent/agent-capability';
import { createMemoryToolDefinitions, type LongTermMemoryToolPort } from '@nextagent/agent-memory';
import { describe, expect, it } from 'vitest';

interface FirstPartyToolRegistration {
  readonly toolId: string;
  readonly replayPolicy: 'IDEMPOTENT' | 'NON_IDEMPOTENT';
  readonly modelVisible: boolean;
}

const expectedRegistrations: readonly FirstPartyToolRegistration[] = [
  { toolId: 'Read', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'Write', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Edit', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Glob', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'Grep', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'Bash', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Python', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'AskUserQuestion', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Agent', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Skill', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Rag', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'ToolSearch', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'TodoWrite', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'Workflow', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'Cron', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'search_memory', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'get_memory_detail', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'add_memory', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
  { toolId: 'acquire_skill', replayPolicy: 'IDEMPOTENT', modelVisible: true },
  { toolId: 'ApiCall', replayPolicy: 'NON_IDEMPOTENT', modelVisible: true },
];

describe('first-party Tool production registry', () => {
  it('contains exactly 20 first-party Tools with 20 model-visible and no hidden tools', () => {
    const actual = definitions()
      .map((definition) => ({
        toolId: String(definition.metadata.name),
        replayPolicy: definition.metadata.replayPolicy ?? 'NON_IDEMPOTENT',
        modelVisible: definition.metadata.disclosurePolicy?.mode !== 'HIDDEN',
      }))
      .sort(compareRegistration);

    expect(actual).toEqual([...expectedRegistrations].sort(compareRegistration));
    expect(actual).toHaveLength(20);
    expect(actual.filter((entry) => entry.modelVisible)).toHaveLength(20);
    expect(actual.filter((entry) => !entry.modelVisible).map((entry) => entry.toolId)).toEqual([]);
  });
});

function definitions(): readonly ToolDefinition[] {
  return [...createBuiltinToolDefinitions({}), ...createMemoryToolDefinitions(nonExecutingMemoryPort), skillHubAcquireSkillToolDefinition];
}

const nonExecutingMemoryPort: LongTermMemoryToolPort = {
  async searchLongTermMemory() {
    throw new Error('Registry metadata test must not execute memory tools.');
  },
  async getLongTermMemoryDetail() {
    throw new Error('Registry metadata test must not execute memory tools.');
  },
  async saveLongTermMemory() {
    throw new Error('Registry metadata test must not execute memory tools.');
  },
};

function compareRegistration(left: FirstPartyToolRegistration, right: FirstPartyToolRegistration): number {
  return left.toolId.localeCompare(right.toolId);
}
