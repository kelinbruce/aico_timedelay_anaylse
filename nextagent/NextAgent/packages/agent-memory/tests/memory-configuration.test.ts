import { defaultMemoryConfig, validateMemoryConfig } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('memory configuration owner API', () => {
  it('owns default memory config values', () => {
    expect(defaultMemoryConfig()).toMatchObject({
      enabled: true,
      status: 'VALID',
      search: { defaultLimit: 20, minConfidence: 0.3 },
      extraction: {
        enabled: true,
        strategy: 'RULE_FIRST',
        crossSessionSchedule: '0 0 0 * * ?',
        maxCycleTrajectories: 20,
        maxCandidates: 50,
        timeoutMs: 60_000,
        lookbackDays: 7,
      },
      aging: {
        enabled: true,
        schedule: '0 0 0 * * ?',
        decayStaleDays: 30,
        archiveRetentionDays: 90,
        decayFactor: 0.05,
        batchLimit: 1_000,
        timeoutMs: 30_000,
        reviveConfidenceBoost: 0.1,
      },
    });
  });

  it('reports field-specific validation issues for memory lifecycle bounds', () => {
    expect(validateMemoryConfig({ aging: { decayStaleDays: 6 } })).toEqual({
      status: 'invalid',
      issue: {
        issueCode: 'MEMORY_CONFIG_INVALID',
        fieldRef: 'nextAgent.memory.aging.decayStaleDays',
        safeMessage: 'Memory aging decayStaleDays must be in [7, 365].',
      },
    });
  });
});
