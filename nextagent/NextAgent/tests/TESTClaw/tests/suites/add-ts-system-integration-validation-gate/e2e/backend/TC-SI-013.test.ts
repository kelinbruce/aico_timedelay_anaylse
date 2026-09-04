import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-013 cancel terminal state', () => {
  it('accepts cancellation and exposes one canceled terminal without completion', async () => {
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
          modelAnswer: 'late answer',
          modelResponseDelayMs: 2_000,
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Cancel me.',
        });
        const cancellation = await fetch(`${harness.baseUrl}/api/v1/sessions/${accepted.sessionId}/cancel`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedLatestRequestId: accepted.requestId,
            idempotencyKey: `tc-si-013-${randomUUID()}`,
          }),
        });
        expect(cancellation.status).toBe(200);

        const streamBody = await waitForCanceledStream(harness.baseUrl, accepted);
        expect(streamBody).toContain('event: REQUEST_ACCEPTED');
        expect(streamBody).toContain('event: REQUEST_CANCELED');
        expect(streamBody).not.toContain('event: REQUEST_COMPLETED');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-013',
          observations: {
            cancellationAccepted: true,
            canceledTerminalObserved: true,
            completedTerminalAbsent: true,
          },
          canaries: [
            { category: 'prompt', value: 'Cancel me.' },
            { category: 'model-output', value: 'late answer' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

async function waitForCanceledStream(baseUrl: string, accepted: { readonly sessionId: string; readonly runId: string }): Promise<string> {
  const deadline = Date.now() + 10_000;
  let streamBody = '';
  while (Date.now() < deadline) {
    streamBody = await readCandidateStream(baseUrl, accepted);
    if (streamBody.includes('event: REQUEST_CANCELED')) {
      return streamBody;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  }
  return streamBody;
}
