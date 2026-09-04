import { describe, expect, it } from 'vitest';

import { readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-027 provider failure SafeError boundary', () => {
  it('maps a real provider HTTP failure to a safe terminal event without raw leakage', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const rawProviderCanary = 'provider-raw-canary-C:\\private\\secret-token';
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: 'unused-provider-answer',
          modelFailure: {
            statusCode: 503,
            body: JSON.stringify({ error: { message: rawProviderCanary } }),
          },
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Diagnose the provider outage.',
        });
        const stream = await readCandidateStream(harness.baseUrl, accepted);

        expect(stream).toContain('event: REQUEST_FAILED');
        expect(stream).not.toContain('event: REQUEST_COMPLETED');
        expect(stream).not.toContain(rawProviderCanary);
        expect(stream).not.toContain('secret-token');
        expect(stream).not.toContain('node_modules');
        expect(stream).not.toMatch(/\b[A-Za-z]:[\\/]/u);
        expect(stream.toLowerCase()).not.toContain('stack');
        expect(harness.modelInvocationCount()).toBeGreaterThan(0);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-027',
          observations: {
            providerHttpFailureExercised: true,
            failedTerminalObserved: true,
            completedTerminalAbsent: true,
            rawProviderFailureNotExported: true,
          },
          canaries: [
            { category: 'prompt', value: 'Diagnose the provider outage.' },
            { category: 'model-output', value: 'unused-provider-answer' },
            { category: 'remote-exception', value: rawProviderCanary },
            { category: 'provider-secret', value: 'secret-token' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});
