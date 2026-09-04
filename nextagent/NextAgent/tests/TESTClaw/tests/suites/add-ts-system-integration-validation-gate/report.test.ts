import { describe, expect, it } from 'vitest';
import { SYSTEM_INTEGRATION_CASES } from './case-manifest.js';
import { buildSystemIntegrationReport, validateSystemIntegrationReport } from './helpers/report.js';
import type { ExecutionResult, NormalizedExecutionResult } from './helpers/reporter.js';

describe('system integration report', () => {
  it('builds the exact 122-case report with 3 integration and 119 E2E results', () => {
    const report = buildSystemIntegrationReport({
      runId: 'run-all-passed',
      definitions: SYSTEM_INTEGRATION_CASES,
      executionResults: SYSTEM_INTEGRATION_CASES.map(passed),
    });

    expect(report.status).toBe('PASSED');
    expect(report.layers).toEqual({ INTEGRATION: 'PASSED', E2E: 'PASSED' });
    expect(report.cases).toHaveLength(122);
    expect(report.cases.filter((entry) => entry.layer === 'INTEGRATION')).toHaveLength(3);
    expect(report.cases.filter((entry) => entry.layer === 'E2E')).toHaveLength(119);
    expect(Object.keys(report).sort()).toEqual(['cases', 'checkId', 'layers', 'runId', 'schemaVersion', 'status']);
    expect(Object.keys(report.cases[0]).sort()).toEqual([
      'caseId',
      'evidenceRefs',
      'failurePhase',
      'layer',
      'originKind',
      'ownerGate',
      'result',
      'sourceCaseRef',
    ]);
    expect(validateSystemIntegrationReport(report)).toBe(report);
  });

  it.each([
    [['MISSING'], 'MISSING'],
    [['UNAVAILABLE', 'MISSING'], 'UNAVAILABLE'],
    [['TIMEOUT', 'UNAVAILABLE', 'MISSING'], 'TIMEOUT'],
    [['FAILED', 'TIMEOUT', 'UNAVAILABLE', 'MISSING'], 'FAILED'],
  ] as const)('uses deterministic status priority for %j', (statuses, expected) => {
    const executionResults = SYSTEM_INTEGRATION_CASES.map(passed);
    statuses.forEach((status, index) => {
      executionResults[index] = failed(SYSTEM_INTEGRATION_CASES[index].executionRef, status);
    });

    const report = buildSystemIntegrationReport({
      runId: `run-priority-${expected.toLowerCase()}`,
      definitions: SYSTEM_INTEGRATION_CASES,
      executionResults,
    });

    expect(report.status).toBe(expected);
  });

  it('fills absent execution results as MISSING', () => {
    const report = buildSystemIntegrationReport({
      runId: 'run-missing',
      definitions: SYSTEM_INTEGRATION_CASES,
      executionResults: [],
    });

    expect(report.status).toBe('MISSING');
    expect(report.cases).toHaveLength(122);
    expect(report.cases.every((entry) => entry.result === 'MISSING')).toBe(true);
    expect(report.cases.every((entry) => entry.evidenceRefs.length === 1)).toBe(true);
  });

  it('rejects unknown, duplicate, unsafe, and semantically invalid results', () => {
    const first = SYSTEM_INTEGRATION_CASES[0];
    expect(() =>
      buildSystemIntegrationReport({
        runId: 'run-unknown',
        definitions: SYSTEM_INTEGRATION_CASES,
        executionResults: [passed({ ...first, executionRef: 'unknown#TC-SI-001' })],
      }),
    ).toThrow('unknown executionRef');

    expect(() =>
      buildSystemIntegrationReport({
        runId: 'run-duplicate',
        definitions: SYSTEM_INTEGRATION_CASES,
        executionResults: [passed(first), passed(first)],
      }),
    ).toThrow('duplicate executionRef');

    expect(() =>
      buildSystemIntegrationReport({
        runId: 'run-unsafe',
        definitions: SYSTEM_INTEGRATION_CASES,
        executionResults: [
          {
            ...passed(first),
            evidenceRefs: ['C:\\restricted\\raw.log'],
          },
        ],
      }),
    ).toThrow('unsafe evidence ref');

    expect(() =>
      buildSystemIntegrationReport({
        runId: 'run-invalid-phase',
        definitions: SYSTEM_INTEGRATION_CASES,
        executionResults: [
          {
            ...passed(first),
            failurePhase: 'execute',
          },
        ],
      }),
    ).toThrow('PASSED result must not have a failure phase');
  });
});

function passed(definition: Pick<(typeof SYSTEM_INTEGRATION_CASES)[number], 'executionRef'>): NormalizedExecutionResult {
  return {
    executionRef: definition.executionRef,
    result: 'PASSED',
    failurePhase: null,
    evidenceRefs: ['evidence:passed'],
  };
}

function failed(executionRef: string, result: Exclude<ExecutionResult, 'PASSED'>): NormalizedExecutionResult {
  return {
    executionRef,
    result,
    failurePhase: 'execute',
    evidenceRefs: [`evidence:${result.toLowerCase()}`],
  };
}
