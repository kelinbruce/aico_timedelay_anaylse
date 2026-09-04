import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readAcceptedCandidateResponse, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-014 retry new run traceability', () => {
  it('creates a distinct retry run while preserving the original run replay', async () => {
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
          modelAnswer: 'Retry path answer.',
        });
        const first = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Test retry.',
        });
        const originalStream = await readCandidateStream(harness.baseUrl, first);
        expect(originalStream).toContain('event: REQUEST_COMPLETED');

        const retryResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${first.sessionId}/retry`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedLatestRequestId: first.requestId,
            idempotencyKey: `tc-si-014-${randomUUID()}`,
          }),
        });
        const retry = await readAcceptedCandidateResponse(retryResponse, 'retry-request');
        expect(retry.sessionId).toBe(first.sessionId);
        expect(retry.runId).not.toBe(first.runId);
        const retryStream = await readCandidateStream(harness.baseUrl, retry);
        expect(retryStream).toContain('event: REQUEST_COMPLETED');

        const originalReplay = await readCandidateStream(harness.baseUrl, first);
        expect(originalReplay).toContain('event: REQUEST_COMPLETED');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-014',
          observations: {
            retryRunCreated: true,
            retryRunDistinct: true,
            originalRunTraceable: true,
            retryTerminalObserved: true,
          },
          canaries: [
            { category: 'prompt', value: 'Test retry.' },
            { category: 'model-output', value: 'Retry path answer.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});
