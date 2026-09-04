import { describe, expect, it } from 'vitest';
import { writeReleaseCheckResult } from './case-inventory.js';

const reportDir = process.env.NEXTAGENT_RELEASE_CHECK_DIR;
const gateIt = reportDir === undefined ? it.skip : it;

describe('release-package gate report writer', () => {
  gateIt('writes the machine-readable release check result', () => {
    expect(reportDir).toBeTruthy();
    const result = writeReleaseCheckResult(`${reportDir}\\release-package.json`);
    expect(result.checkId).toBe('release-package');
    expect(result.status).toBe('PASSED');
  });
});
