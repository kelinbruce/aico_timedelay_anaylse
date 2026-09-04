import { describe, expect, it } from 'vitest';
import { SYSTEM_INTEGRATION_CASES, validateSystemIntegrationManifest } from './case-manifest.js';

describe('system integration case manifest', () => {
  it('contains exactly TC-SI-001 through TC-SI-122 with the required layers and origins', () => {
    const validated = validateSystemIntegrationManifest(SYSTEM_INTEGRATION_CASES);

    expect(validated).toHaveLength(122);
    expect(validated.map((entry) => entry.caseId)).toEqual(Array.from({ length: 122 }, (_, index) => `TC-SI-${String(index + 1).padStart(3, '0')}`));
    expect(validated.filter((entry) => entry.layer === 'INTEGRATION')).toHaveLength(3);
    expect(validated.filter((entry) => entry.layer === 'E2E')).toHaveLength(119);
    expect(validated.filter((entry) => entry.originKind === 'FIXED_GATE')).toHaveLength(41);
    expect(validated.filter((entry) => entry.originKind === 'BACKEND_E2E')).toHaveLength(49);
    expect(validated.filter((entry) => entry.originKind === 'NEW_INTEGRATION')).toHaveLength(3);
    expect(validated.filter((entry) => entry.originKind === 'NEW_E2E')).toHaveLength(5);
    expect(validated.filter((entry) => entry.originKind === 'BROWSER_E2E')).toHaveLength(24);
    expect(new Set(validated.map((entry) => entry.executionRef)).size).toBe(122);
    expect(validated.every((entry) => entry.featureRefs.length === 1 && entry.featureRefs[0] === 'F-10.8')).toBe(true);
    expect(validated.every((entry) => entry.functionRefs.length === 1 && entry.functionRefs[0] === 'FN-10.31')).toBe(true);
  });

  it.each([
    ['missing case', SYSTEM_INTEGRATION_CASES.slice(1)],
    ['duplicate case', [...SYSTEM_INTEGRATION_CASES, SYSTEM_INTEGRATION_CASES[0]]],
    [
      'duplicate execution ref',
      SYSTEM_INTEGRATION_CASES.map((entry, index) => (index === 1 ? { ...entry, executionRef: SYSTEM_INTEGRATION_CASES[0]!.executionRef } : entry)),
    ],
  ])('rejects %s', (_label, candidate) => {
    expect(() => validateSystemIntegrationManifest(candidate)).toThrow();
  });

  it('keeps the 114 source cases in a one-to-one mapping', () => {
    const sourceCases = SYSTEM_INTEGRATION_CASES.filter(
      (entry) => entry.originKind === 'FIXED_GATE' || entry.originKind === 'BACKEND_E2E' || entry.originKind === 'BROWSER_E2E',
    );

    expect(sourceCases).toHaveLength(114);
    expect(new Set(sourceCases.map((entry) => entry.sourceCaseRef)).size).toBe(114);
    expect(new Set(sourceCases.map((entry) => entry.caseId)).size).toBe(114);
  });
});
