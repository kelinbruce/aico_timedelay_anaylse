import { describe, expect, it } from 'vitest';
import { clearCaseResults, recordCaseResult, REQUIRED_CASE_IDS, writeReleaseCheckResult } from './case-inventory.js';

describe('p1-p2 scenario gate negative coverage', () => {
  it('rejects a missing required case', () => {
    clearCaseResults();
    recordCaseResult('e2e-P1P2-01', 'PASSED', {
      evidenceRefs: ['evidence://p1-p2/extension-governance/stream'],
    });
    const result = writeReleaseCheckResult();
    expect(result.status).toBe('MISSING');
    for (const id of REQUIRED_CASE_IDS) {
      expect(result.evidenceRefs.some((ref) => ref.includes(id))).toBe(true);
    }
    clearCaseResults();
  });

  it('fails when a case reports forbidden mock-path evidence', () => {
    clearCaseResults();
    recordCaseResult('e2e-P1P2-01', 'FAILED', {
      safeReason: 'forbidden mock transport detected',
      evidenceRefs: ['evidence://p1-p2/extension-governance/mock-transport'],
    });
    recordCaseResult('e2e-P1P2-02', 'PASSED', {
      evidenceRefs: ['evidence://p1-p2/long-term-memory/store'],
    });
    recordCaseResult('e2e-P1P2-03', 'PASSED', {
      evidenceRefs: ['evidence://p1-p2/routing-child-agent/model-request'],
    });
    const result = writeReleaseCheckResult();
    expect(result.status).toBe('FAILED');
    expect(JSON.stringify(result)).not.toContain('sk-');
    expect(JSON.stringify(result)).not.toContain('OPENAI_API_KEY');
    clearCaseResults();
  });

  it('passes when all required cases pass', () => {
    clearCaseResults();
    for (const id of REQUIRED_CASE_IDS) {
      recordCaseResult(id, 'PASSED', {
        evidenceRefs: [`evidence://p1-p2/${id}/passed`],
      });
    }
    const result = writeReleaseCheckResult();
    expect(result.status).toBe('PASSED');
    expect(result.checkId).toBe('p1-p2-scenario-gate');
    clearCaseResults();
  });
});
