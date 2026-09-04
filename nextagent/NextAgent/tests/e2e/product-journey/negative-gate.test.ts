import { describe, expect, it } from 'vitest';
import { recordCaseResult, clearCaseResults, REQUIRED_CASE_IDS, writeReleaseCheckResult } from './case-inventory.js';

describe('Gate negative: forbidden mock rejected', () => {
  it('rejects mock-transport as valid gate evidence', () => {
    clearCaseResults();
    recordCaseResult('e2e-P0-02', 'FAILED', {
      safeReason: 'forbidden mock: page.route in case',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    const result = writeReleaseCheckResult();
    expect(result.status).toBe('FAILED');
    clearCaseResults();
  });

  it('rejects skipped cases', async () => {
    clearCaseResults();
    const result = writeReleaseCheckResult();
    expect(result.status).not.toBe('PASSED');
    for (const id of REQUIRED_CASE_IDS) {
      expect(result.evidenceRefs.some((ref) => ref.includes(id))).toBe(true);
    }
    clearCaseResults();
  });

  it('reports passing when all required cases pass', () => {
    clearCaseResults();
    for (const id of REQUIRED_CASE_IDS) {
      recordCaseResult(id, 'PASSED', {
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }
    const result = writeReleaseCheckResult();
    expect(result.status).toBe('PASSED');
    expect(result.checkId).toBe('product-journey');
    clearCaseResults();
  });
});

describe('Gate evidence: report safety', () => {
  it('machine-readable report does not contain raw credentials', () => {
    clearCaseResults();
    recordCaseResult('e2e-P0-02', 'PASSED', {
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      evidenceRefs: ['test-evidence'],
    });
    const result = writeReleaseCheckResult();
    const json = JSON.stringify(result);
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('OPENAI_API_KEY');
    expect(json).toContain('test-evidence');
    clearCaseResults();
  });

  it('report contains evidence for each case', async () => {
    clearCaseResults();
    for (const id of REQUIRED_CASE_IDS) {
      recordCaseResult(id, 'PASSED', {
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }
    const result = writeReleaseCheckResult();
    expect(result.evidenceRefs.length).toBe(REQUIRED_CASE_IDS.length);
    clearCaseResults();
  });
});
