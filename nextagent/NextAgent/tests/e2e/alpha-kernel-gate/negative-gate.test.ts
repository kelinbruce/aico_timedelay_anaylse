import { describe, expect, it } from 'vitest';
import { recordCaseResult, clearCaseResults, REQUIRED_CASE_IDS, writeReleaseCheckResult } from './case-inventory.js';

describe('Gate negative: forbidden mock rejected', () => {
  it('rejects mock-transport as valid gate evidence', () => {
    clearCaseResults();
    recordCaseResult('alpha-01', 'FAILED', {
      safeReason: 'forbidden mock: page.route used in Alpha E2E case',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    expect(writeReleaseCheckResult().status).toBe('FAILED');
    clearCaseResults();
  });

  it('rejects skipped cases', () => {
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
      recordCaseResult(id, 'PASSED', { startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    }
    const result = writeReleaseCheckResult();
    expect(result.status).toBe('PASSED');
    expect(result.checkId).toBe('alpha-kernel-gate');
    clearCaseResults();
  });
});

describe('Gate negative: P0 capability leakage rejected', () => {
  it('rejects a case tagged with P0 capability contamination', () => {
    clearCaseResults();
    recordCaseResult('alpha-02', 'FAILED', {
      safeReason: 'P0 leakage: case used local auth route /api/v1/auth/login',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    expect(writeReleaseCheckResult().status).toBe('FAILED');
    clearCaseResults();
  });

  it('rejects a case tagged with WebSocket dependency', () => {
    clearCaseResults();
    recordCaseResult('alpha-03', 'FAILED', {
      safeReason: 'P0 leakage: case attempted WebSocket upgrade',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    expect(writeReleaseCheckResult().status).toBe('FAILED');
    clearCaseResults();
  });
});

describe('Gate evidence: report safety', () => {
  it('machine-readable report does not contain raw credentials', () => {
    clearCaseResults();
    recordCaseResult('alpha-01', 'PASSED', {
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      evidenceRefs: ['test-evidence-alpha'],
    });
    const json = JSON.stringify(writeReleaseCheckResult());
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('OPENAI_API_KEY');
    expect(json).toContain('test-evidence-alpha');
    clearCaseResults();
  });

  it('report does not contain file paths or stack traces', () => {
    clearCaseResults();
    recordCaseResult('alpha-04', 'PASSED', { startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    const json = JSON.stringify(writeReleaseCheckResult());
    expect(json).not.toContain('D:\\\\code\\\\');
    expect(json).not.toContain('stack trace');
    clearCaseResults();
  });

  it('report contains evidence for all 6 cases when all pass', () => {
    clearCaseResults();
    for (const id of REQUIRED_CASE_IDS) {
      recordCaseResult(id, 'PASSED', { startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    }
    const result = writeReleaseCheckResult();
    expect(result.evidenceRefs.length).toBe(REQUIRED_CASE_IDS.length);
    expect(result.checkId).toBe('alpha-kernel-gate');
    clearCaseResults();
  });
});
