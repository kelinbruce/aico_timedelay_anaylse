import { describe, expect, it } from 'vitest';
import { writeReleaseCheckResult } from './case-inventory.js';

const reportDir = process.env.NEXTAGENT_RELEASE_CHECK_DIR;
const gateIt = reportDir === undefined ? it.skip : it;

describe('alpha-kernel gate report writer', () => {
  gateIt('writes the machine-readable release check result', () => {
    expect(reportDir).toBeTruthy();
    const result = writeReleaseCheckResult(`${reportDir}\\alpha-kernel-gate.json`);
    expect(result.checkId).toBe('alpha-kernel-gate');
    expect(result.status).toBe('PASSED');
  });
});
