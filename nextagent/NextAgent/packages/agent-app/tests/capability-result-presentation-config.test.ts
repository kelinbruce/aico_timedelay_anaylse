import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createAppCredentialResolver } from '../src/config/env.js';
import { parseBuiltInConfig } from '../src/config/system-config.js';
import { evaluateDefaultSystemConfig, validateDefaultSystemConfig } from '../src/config/validation.js';

const credentialResolver = createAppCredentialResolver({
  OPENAI_API_KEY: 'test-key',
});

describe('capability result presentation config', () => {
  it('defaults to a frozen SUMMARY policy with the platform baseline', () => {
    const config = validateDefaultSystemConfig(builtInConfig(), temporaryConfigRoot(), { credentialResolver });

    const policy = readPolicy(config);
    expect(policy.defaultLevel).toBe('SUMMARY');
    expect(Object.fromEntries(policy.levelByCapabilityId)).toEqual({
      Rag: 'DETAIL',
      Skill: 'STATUS_ONLY',
      Agent: 'STATUS_ONLY',
      ApiCall: 'STATUS_ONLY',
      search_memory: 'STATUS_ONLY',
      get_memory_detail: 'STATUS_ONLY',
      add_memory: 'STATUS_ONLY',
      acquire_skill: 'STATUS_ONLY',
      AskUserQuestion: 'DETAIL',
      TodoWrite: 'DETAIL',
      Cron: 'DETAIL',
      Read: 'SUMMARY',
      Write: 'SUMMARY',
      Edit: 'SUMMARY',
      Glob: 'SUMMARY',
      Grep: 'SUMMARY',
      Bash: 'DETAIL',
      Python: 'DETAIL',
      ToolSearch: 'SUMMARY',
      Workflow: 'SUMMARY',
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.levelByCapabilityId)).toBe(true);
  });

  it.each(['SUMMARY', 'DETAIL'] as const)('accepts exact %s overrides for memory and skill acquisition without deleting other baselines', (level) => {
    const raw = builtInConfig();
    raw.nextAgent.system = {
      'capability-result-presentation': {
        rules: ['search_memory', 'get_memory_detail', 'add_memory', 'acquire_skill'].map((capabilityId) => ({
          'capability-id': capabilityId,
          level,
        })),
      },
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });

    const policy = readPolicy(config);
    for (const capabilityId of ['search_memory', 'get_memory_detail', 'add_memory', 'acquire_skill']) {
      expect(policy.levelByCapabilityId.get(capabilityId)).toBe(level);
    }
    expect(policy.levelByCapabilityId.get('Skill')).toBe('STATUS_ONLY');
    expect(policy.levelByCapabilityId.get('Read')).toBe('SUMMARY');
    expect(policy.levelByCapabilityId.get('AskUserQuestion')).toBe('DETAIL');
  });

  it('overlays exact case-sensitive rules without deleting the platform baseline', () => {
    const raw = builtInConfig();
    raw.nextAgent.system = {
      'capability-result-presentation': {
        'default-level': 'SUMMARY',
        rules: [
          { 'capability-id': 'Bash', level: 'STATUS_ONLY' },
          { 'capability-id': 'Read', level: 'DETAIL' },
          { 'capability-id': 'VendorNetworkProbe', level: 'DETAIL' },
        ],
      },
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });

    const policy = readPolicy(config);
    expect(policy.defaultLevel).toBe('SUMMARY');
    expect(policy.levelByCapabilityId.get('Bash')).toBe('STATUS_ONLY');
    expect(policy.levelByCapabilityId.get('bash')).toBeUndefined();
    expect(policy.levelByCapabilityId.get('Read')).toBe('DETAIL');
    expect(policy.levelByCapabilityId.get('VendorNetworkProbe')).toBe('DETAIL');
    expect(policy.levelByCapabilityId.get('Skill')).toBe('STATUS_ONLY');
    expect(policy.levelByCapabilityId.get('AskUserQuestion')).toBe('DETAIL');
    expect(policy.levelByCapabilityId.get('Workflow')).toBe('SUMMARY');
  });

  it('counts capability ids by Unicode code point rather than UTF-16 code unit', () => {
    const raw = builtInConfig();
    const capabilityId = '📡'.repeat(128);
    raw.nextAgent.system = {
      'capability-result-presentation': {
        rules: [{ 'capability-id': capabilityId, level: 'DETAIL' }],
      },
    };

    const config = validateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });

    expect(readPolicy(config).levelByCapabilityId.get(capabilityId)).toBe('DETAIL');
  });

  it.each([
    {
      name: 'duplicate capability ids',
      presentation: {
        rules: [
          { 'capability-id': 'Read', level: 'DETAIL' },
          { 'capability-id': 'Read', level: 'SUMMARY' },
        ],
      },
    },
    {
      name: 'unknown level',
      presentation: { 'default-level': 'RAW' },
    },
    {
      name: 'removed hidden level',
      presentation: { 'default-level': 'HIDDEN' },
    },
    {
      name: 'unknown field',
      presentation: { 'show-raw': true },
    },
    {
      name: 'empty capability id',
      presentation: { rules: [{ 'capability-id': '', level: 'DETAIL' }] },
    },
    {
      name: 'more than 256 rules',
      presentation: {
        rules: Array.from({ length: 257 }, (_, index) => ({
          'capability-id': `Capability${index}`,
          level: 'DETAIL',
        })),
      },
    },
    {
      name: 'capability id longer than 128 Unicode code points',
      presentation: {
        rules: [{ 'capability-id': '读'.repeat(129), level: 'DETAIL' }],
      },
    },
  ])('blocks $name before the app becomes ready', ({ presentation }) => {
    const raw = builtInConfig();
    raw.nextAgent.system = {
      'capability-result-presentation': presentation,
    };

    const result = evaluateDefaultSystemConfig(raw, temporaryConfigRoot(), { credentialResolver });

    expect(result.status).toBe('BLOCKED');
    expect(result.config).toBeUndefined();
    expect(result.evidenceInput.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ affectsReadiness: true })]));
  });
});

type PresentationLevel = 'STATUS_ONLY' | 'SUMMARY' | 'DETAIL';

interface PresentationPolicy {
  readonly defaultLevel: PresentationLevel;
  readonly levelByCapabilityId: ReadonlyMap<string, PresentationLevel>;
}

interface MutableConfig extends Record<string, unknown> {
  nextAgent: {
    system: Record<string, unknown>;
    [key: string]: unknown;
  };
}

function readPolicy(config: unknown): PresentationPolicy {
  return (config as { readonly capabilityResultPresentationPolicy: PresentationPolicy }).capabilityResultPresentationPolicy;
}

function builtInConfig(): MutableConfig {
  const config = parseBuiltInConfig(
    readFileSync(join(process.cwd(), 'packages', 'agent-app', 'config', 'default-system.yaml'), 'utf8'),
  ) as MutableConfig;
  const profiles = config.modelProfiles as Array<Record<string, unknown>>;
  const models = profiles[0]?.models as Array<Record<string, unknown>>;
  profiles[0] = {
    ...profiles[0],
    baseUrl: 'https://example.invalid/v1',
    models: [{ ...models[0], modelId: 'test-model' }, ...models.slice(1)],
  };
  config.nextAgent.system ??= {};
  return config;
}

function temporaryConfigRoot(): string {
  return mkdtempSync(join(tmpdir(), 'nextagent-capability-result-presentation-'));
}
