import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCandidateSession, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-003 same-session active-run policy', () => {
  it('returns a safe conflict or serialized follow-up while independent sessions remain isolated', async () => {
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
          modelAnswer: 'processed',
          modelResponseDelayMs: 1_000,
        });
        const first = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'First request.',
        });
        const conflicting = await fetch(`${harness.baseUrl}/api/v1/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            inputText: 'Second request.',
            sessionId: first.sessionId,
            idempotencyKey: `tc-si-003-conflict-${randomUUID()}`,
          }),
        });
        let conflictRejected = false;
        if (conflicting.status === 409) {
          conflictRejected = true;
          const conflictBody = await conflicting.text();
          expect(conflictBody.length).toBeGreaterThan(0);
          expect(conflictBody).not.toContain('testclaw-loopback-key');
        } else {
          expect(conflicting.status).toBe(200);
          const followUp: unknown = await conflicting.json();
          if (!isObject(followUp) || typeof followUp.sessionId !== 'string' || typeof followUp.runId !== 'string') {
            throw new Error('same-session-follow-up-response-invalid');
          }
          expect(followUp.sessionId).toBe(first.sessionId);
          await readCandidateStream(harness.baseUrl, {
            sessionId: followUp.sessionId,
            runId: followUp.runId,
          });
        }
        await readCandidateStream(harness.baseUrl, first);

        const sessionOne = await createCandidateSession(harness.baseUrl);
        const sessionTwo = await createCandidateSession(harness.baseUrl);
        expect(sessionOne).not.toBe(sessionTwo);
        const independentOne = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Independent one.',
          sessionId: sessionOne,
        });
        const independentTwo = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Independent two.',
          sessionId: sessionTwo,
        });
        expect(independentOne.runId).not.toBe(independentTwo.runId);
        await Promise.all([readCandidateStream(harness.baseUrl, independentOne), readCandidateStream(harness.baseUrl, independentTwo)]);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-003',
          observations: {
            activeSessionPolicyObserved: true,
            conflictRejected,
            serializedFollowUpAccepted: !conflictRejected,
            independentSessionsAccepted: true,
            conflictStatus: conflicting.status,
          },
          canaries: [
            { category: 'prompt', value: 'First request.' },
            { category: 'prompt', value: 'Second request.' },
            { category: 'model-output', value: 'processed' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
