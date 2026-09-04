import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  readCandidateConversation,
  readAcceptedCandidateResponse,
  readCandidateStream,
  submitCandidateRequest,
} from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-012 same-session serial dispatch', () => {
  it('accepts a second submit on the completed session as a distinct run', async () => {
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
          modelAnswer: 'Serial response.',
        });
        const first = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'First prompt.',
        });
        await readCandidateStream(harness.baseUrl, first);

        const second = await submitOnSession(harness.baseUrl, first.sessionId, 'Second prompt.');
        expect(second.sessionId).toBe(first.sessionId);
        expect(second.requestId).not.toBe(first.requestId);
        expect(second.runId).not.toBe(first.runId);
        const secondStream = await readCandidateStream(harness.baseUrl, second);
        expect(secondStream).toContain('event: REQUEST_COMPLETED');

        const conversation = await readCandidateConversation(harness.baseUrl, first.sessionId);
        expect(conversation.filter((item) => item.role === 'USER')).toHaveLength(2);
        expect(conversation.filter((item) => item.role === 'ASSISTANT')).toHaveLength(2);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-012',
          observations: {
            sameSessionReused: true,
            distinctRequestCreated: true,
            distinctRunCreated: true,
            twoTurnsPersisted: true,
          },
          canaries: [
            { category: 'prompt', value: 'First prompt.' },
            { category: 'prompt', value: 'Second prompt.' },
            { category: 'model-output', value: 'Serial response.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

async function submitOnSession(
  baseUrl: string,
  sessionId: string,
  inputText: string,
): Promise<Awaited<ReturnType<typeof readAcceptedCandidateResponse>>> {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputText,
      idempotencyKey: `tc-si-012-${randomUUID()}`,
    }),
  });
  return await readAcceptedCandidateResponse(response, 'session-submit');
}
