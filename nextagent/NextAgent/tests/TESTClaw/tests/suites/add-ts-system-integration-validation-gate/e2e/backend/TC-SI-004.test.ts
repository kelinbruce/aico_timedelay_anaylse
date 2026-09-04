import { describe, expect, it } from 'vitest';

import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-004 SafeError security boundary', () => {
  it('rejects invalid request shapes without leaking credentials, paths, or stack data', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: 'unused',
        });
        const missingInput = await fetch(`${harness.baseUrl}/api/v1/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: 'tc-si-004-missing-input' }),
        });
        expect(missingInput.status).toBeGreaterThanOrEqual(400);
        const missingInputBody = await missingInput.text();
        expectSafeErrorBody(missingInputBody);

        const malformedJson = await fetch(`${harness.baseUrl}/api/v1/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not-valid-json',
        });
        expect(malformedJson.status).toBeGreaterThanOrEqual(400);
        const malformedJsonBody = await malformedJson.text();
        expectSafeErrorBody(malformedJsonBody);
        expect(harness.modelInvocationCount()).toBe(0);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-004',
          observations: {
            missingInputRejected: true,
            malformedJsonRejected: true,
            providerNotInvoked: true,
          },
          canaries: [
            { category: 'credential', value: 'testclaw-loopback-key' },
            { category: 'model-output', value: 'unused' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

function expectSafeErrorBody(body: string): void {
  expect(body.length).toBeGreaterThan(0);
  expect(body).not.toContain('OPENAI_API_KEY');
  expect(body).not.toContain('testclaw-loopback-key');
  expect(body).not.toContain('node_modules');
  expect(body).not.toMatch(/\b[A-Za-z]:[\\/]/u);
  expect(body.toLowerCase()).not.toContain('stack');
}
