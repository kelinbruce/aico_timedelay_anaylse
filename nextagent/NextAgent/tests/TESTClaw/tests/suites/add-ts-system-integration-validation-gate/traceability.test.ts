import { describe, expect, it } from 'vitest';
import { SYSTEM_INTEGRATION_CASES } from './case-manifest.js';
import { buildSystemIntegrationReport, type SystemIntegrationReport } from './helpers/report.js';
import { createTraceabilityIndex } from './helpers/traceability.js';

describe('system integration traceability', () => {
  it('resolves all 122 source and spec chains in both directions', () => {
    const report = passedReport();
    const index = createTraceabilityIndex(SYSTEM_INTEGRATION_CASES, report);

    expect(index.entries).toHaveLength(122);
    for (const definition of SYSTEM_INTEGRATION_CASES) {
      const fromSource = index.findBySourceCaseRef(definition.sourceCaseRef);
      expect(fromSource).toBeDefined();
      expect(index.findByCaseId(definition.caseId)).toBe(fromSource);
      expect(index.findByExecutionRef(definition.executionRef)).toBe(fromSource);
      expect(fromSource).toMatchObject({
        caseId: definition.caseId,
        executionRef: definition.executionRef,
        result: 'PASSED',
        evidenceRefs: [`cases/${definition.caseId}.json`],
      });
      expect(fromSource!.featureRefs).toEqual(definition.featureRefs);
      expect(fromSource!.functionRefs).toEqual(definition.functionRefs);
      expect(fromSource!.requirementRefs).toEqual(definition.requirementRefs);
    }
    expect(index.findBySpecRef('F-10.8')).toHaveLength(122);
    expect(index.findBySpecRef('FN-10.31')).toHaveLength(122);
    expect(new Set(index.entries.flatMap((entry) => entry.evidenceRefs)).size).toBe(122);
  });

  it('rejects a report whose source metadata does not match the manifest', () => {
    const report = JSON.parse(JSON.stringify(passedReport())) as SystemIntegrationReport;
    (report.cases[0] as { sourceCaseRef: string }).sourceCaseRef = 'changed-source';

    expect(() => createTraceabilityIndex(SYSTEM_INTEGRATION_CASES, report)).toThrow('traceability mismatch for TC-SI-001');
  });
});

function passedReport(): SystemIntegrationReport {
  return buildSystemIntegrationReport({
    runId: 'traceability-run',
    definitions: SYSTEM_INTEGRATION_CASES,
    executionResults: SYSTEM_INTEGRATION_CASES.map((definition) => ({
      executionRef: definition.executionRef,
      result: 'PASSED',
      failurePhase: null,
      evidenceRefs: [`cases/${definition.caseId}.json`],
    })),
  });
}
