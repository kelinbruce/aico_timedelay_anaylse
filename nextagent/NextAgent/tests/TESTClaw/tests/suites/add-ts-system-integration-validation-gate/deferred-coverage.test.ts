import { describe, expect, it } from 'vitest';
import { DEFERRED_COVERAGE, SYSTEM_INTEGRATION_CASES, validateDeferredCoverage } from './case-manifest.js';

describe('deferred system integration coverage', () => {
  it('remains separate from the 122 activated executable cases', () => {
    const deferred = validateDeferredCoverage(DEFERRED_COVERAGE);
    const activatedIds = new Set<string>(SYSTEM_INTEGRATION_CASES.map((entry) => entry.caseId));

    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.every((entry) => entry.stage === 'PLANNED' || entry.stage === 'EXCLUDED')).toBe(true);
    expect(deferred.every((entry) => !activatedIds.has(entry.coverageId))).toBe(true);
    expect(deferred.every((entry) => !/^TC-SI-\d{3}$/.test(entry.coverageId))).toBe(true);
    expect(deferred.every((entry) => !('executionRef' in entry))).toBe(true);
  });

  it('rejects activated-looking deferred identifiers', () => {
    expect(() =>
      validateDeferredCoverage([
        ...DEFERRED_COVERAGE,
        {
          coverageId: 'TC-SI-120',
          stage: 'PLANNED',
          owner: 'testclaw-system-integration',
          safeReason: 'missing executable artifact',
          activationCondition: 'artifact becomes available',
        },
      ]),
    ).toThrow();
  });

  it('keeps the stable performance gate separate from unspecified system scopes', () => {
    expect(DEFERRED_COVERAGE).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coverageId: 'excluded-independent-performance-gate',
          stage: 'EXCLUDED',
          owner: 'testclaw-performance',
        }),
        expect.objectContaining({
          coverageId: 'excluded-cluster-agentlink-capacity',
          stage: 'EXCLUDED',
          owner: 'quality-governance',
        }),
      ]),
    );
  });
});
