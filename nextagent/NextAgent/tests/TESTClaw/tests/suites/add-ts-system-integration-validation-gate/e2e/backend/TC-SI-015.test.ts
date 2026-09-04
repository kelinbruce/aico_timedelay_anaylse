import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  readAcceptedCandidateResponse,
  readCandidateConversation,
  readCandidateStream,
  submitCandidateRequest,
} from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-015 edit-resubmit new mainline', () => {
  it('creates a distinct completed mainline after a revised same-session submit', async () => {
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
          modelAnswer: 'Revised answer.',
        });
        const original = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Original.',
        });
        await readCandidateStream(harness.baseUrl, original);

        const revisedResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${original.sessionId}/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            inputText: 'Edited.',
            idempotencyKey: `tc-si-015-${randomUUID()}`,
          }),
        });
        const revised = await readAcceptedCandidateResponse(revisedResponse, 'edit-resubmit');
        expect(revised.sessionId).toBe(original.sessionId);
        expect(revised.requestId).not.toBe(original.requestId);
        expect(revised.runId).not.toBe(original.runId);
        const revisedStream = await readCandidateStream(harness.baseUrl, revised);
        expect(revisedStream).toContain('event: REQUEST_COMPLETED');

        const conversation = await readCandidateConversation(harness.baseUrl, original.sessionId);
        expect(conversation.filter((item) => item.role === 'USER')).toHaveLength(2);
        expect(conversation.filter((item) => item.role === 'ASSISTANT')).toHaveLength(2);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-015',
          observations: {
            revisedRequestCreated: true,
            revisedRunDistinct: true,
            revisedTerminalObserved: true,
            twoMainlineTurnsPersisted: true,
          },
          canaries: [
            { category: 'prompt', value: 'Original.' },
            { category: 'prompt', value: 'Edited.' },
            { category: 'model-output', value: 'Revised answer.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});
