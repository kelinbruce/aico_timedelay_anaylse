import { describe, expect, it } from 'vitest';
import { writeReleaseCheckResult } from './case-inventory.js';

const reportDir = process.env.NEXTAGENT_RELEASE_CHECK_DIR;
const gateIt = reportDir === undefined ? it.skip : it;

describe('p1-p2 scenario gate report writer', () => {
  gateIt('writes the machine-readable release check result', () => {
    expect(reportDir).toBeTruthy();
    const result = writeReleaseCheckResult(`${reportDir}\\p1-p2-scenario-gate.json`);
    expect(result.checkId).toBe('p1-p2-scenario-gate');
    expect(result.status).toBe('PASSED');
  });
});
