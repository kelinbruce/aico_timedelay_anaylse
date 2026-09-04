import { describe, expect, it } from 'vitest';
import type { SystemIntegrationCaseDefinition } from './case-manifest.js';
import { adaptPlaywrightJson, adaptVitestJson } from './helpers/reporter.js';

const backendCase = createCase('TC-SI-001', 'tests/suites/add-ts-system-integration-validation-gate/e2e/backend/TC-SI-001.test.ts#TC-SI-001');
const browserCase = createCase('TC-SI-119', 'tests/suites/add-ts-system-integration-validation-gate/e2e/browser/TC-SI-119.spec.ts#TC-SI-119');

describe('system integration reporter adapters', () => {
  it('normalizes one Vitest result per executionRef', () => {
    const results = adaptVitestJson([backendCase], {
      testResults: [
        {
          name: `D:/consumer/${backendCase.executionRef.split('#')[0]}`,
          assertionResults: [
            {
              fullName: 'TC-SI-001 validates the product boundary',
              status: 'passed',
            },
          ],
        },
      ],
    });

    expect(results).toEqual([
      {
        executionRef: backendCase.executionRef,
        result: 'PASSED',
        failurePhase: null,
        evidenceRefs: ['runner:vitest:passed'],
      },
    ]);
  });

  it.each(['pending', 'todo', 'skipped'] as const)('turns forbidden Vitest %s into a failed result', (status) => {
    const [result] = adaptVitestJson([backendCase], {
      testResults: [
        {
          name: backendCase.executionRef.split('#')[0],
          assertionResults: [{ fullName: backendCase.caseId, status }],
        },
      ],
    });

    expect(result).toMatchObject({
      result: 'FAILED',
      failurePhase: 'execute',
      evidenceRefs: [`runner:vitest:${status}-forbidden`],
    });
  });

  it('normalizes Playwright timeout without exposing reporter error text', () => {
    const results = adaptPlaywrightJson([browserCase], {
      suites: [
        {
          file: browserCase.executionRef.split('#')[0],
          specs: [
            {
              title: `validates ${browserCase.caseId}`,
              tests: [{ results: [{ status: 'timedOut', error: { message: 'SECRET' } }] }],
            },
          ],
        },
      ],
    });

    expect(results).toEqual([
      {
        executionRef: browserCase.executionRef,
        result: 'TIMEOUT',
        failurePhase: 'execute',
        evidenceRefs: ['runner:playwright:timeout'],
      },
    ]);
    expect(JSON.stringify(results)).not.toContain('SECRET');
  });

  it('accepts Playwright file paths relative to the configured testDir', () => {
    const testDirRelativeFile = browserCase.executionRef.split('#')[0].replace('tests/suites/', '');
    const [result] = adaptPlaywrightJson([browserCase], {
      suites: [
        {
          file: testDirRelativeFile,
          specs: [{ title: browserCase.caseId, tests: [{ results: [{ status: 'passed' }] }] }],
        },
      ],
    });

    expect(result).toMatchObject({ result: 'PASSED', evidenceRefs: ['runner:playwright:passed'] });
  });

  it('returns one MISSING result when an expected executionRef has no reporter item', () => {
    expect(adaptVitestJson([backendCase], { testResults: [] })).toEqual([
      {
        executionRef: backendCase.executionRef,
        result: 'MISSING',
        failurePhase: 'execute',
        evidenceRefs: ['runner:vitest:missing'],
      },
    ]);
  });

  it('rejects duplicate and unknown reporter results', () => {
    const duplicate = {
      testResults: [
        {
          name: backendCase.executionRef.split('#')[0],
          assertionResults: [
            { fullName: backendCase.caseId, status: 'passed' },
            { fullName: backendCase.caseId, status: 'passed' },
          ],
        },
      ],
    };
    expect(() => adaptVitestJson([backendCase], duplicate)).toThrow('duplicate executionRef');

    const unknown = {
      testResults: [
        {
          name: 'tests/suites/unknown.test.ts',
          assertionResults: [{ fullName: 'TC-SI-999', status: 'passed' }],
        },
      ],
    };
    expect(() => adaptVitestJson([backendCase], unknown)).toThrow('unknown reporter result');
  });
});

function createCase(caseId: SystemIntegrationCaseDefinition['caseId'], executionRef: string): SystemIntegrationCaseDefinition {
  return {
    caseId,
    title: caseId,
    layer: caseId === 'TC-SI-119' ? 'E2E' : 'E2E',
    originKind: caseId === 'TC-SI-119' ? 'NEW_E2E' : 'FIXED_GATE',
    sourceCaseRef: `source:${caseId}`,
    ownerGate: 'testclaw-system-integration',
    featureRefs: ['F-10.8'],
    functionRefs: ['FN-10.31'],
    requirementRefs: ['requirement'],
    externalDependencyRefs: [],
    executionRef,
    requiredInputRoots: ['candidate'],
  };
}
