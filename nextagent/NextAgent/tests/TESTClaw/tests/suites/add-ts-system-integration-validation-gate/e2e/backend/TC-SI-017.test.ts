import { describe, expect, it } from 'vitest';

import { readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-017 long session multi-turn interaction', () => {
  it('completes five ordered turns in one session and retains the public conversation', async () => {
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
          modelAnswer: 'Long-session answer.',
        });
        const prompts = Array.from({ length: 5 }, (_, index) => `Long-session turn ${index + 1}.`);
        const requestIds = new Set<string>();
        const runIds = new Set<string>();
        let sessionId: string | undefined;

        for (const inputText of prompts) {
          const accepted = await submitCandidateRequest({
            baseUrl: harness.baseUrl,
            inputText,
            sessionId,
          });
          sessionId ??= accepted.sessionId;
          expect(accepted.sessionId).toBe(sessionId);
          requestIds.add(accepted.requestId);
          runIds.add(accepted.runId);

          const stream = await readCandidateStream(harness.baseUrl, accepted);
          expect(stream).toContain('event: REQUEST_COMPLETED');
        }

        if (sessionId === undefined) {
          throw new Error('long-session-not-created');
        }
        expect(requestIds.size).toBe(5);
        expect(runIds.size).toBe(5);

        const conversation = await readCandidateConversation(harness.baseUrl, sessionId);
        const userMessages = conversation.filter((item) => item.role === 'USER');
        const assistantMessages = conversation.filter((item) => item.role === 'ASSISTANT');
        expect(userMessages.map((item) => item.content)).toEqual(prompts);
        expect(assistantMessages).toHaveLength(5);
        expect(conversation).toHaveLength(10);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-017',
          observations: {
            completedTurns: 5,
            distinctRequests: requestIds.size,
            distinctRuns: runIds.size,
            retainedConversationItems: conversation.length,
            singleSessionMaintained: true,
          },
          canaries: [
            ...prompts.map((value) => ({ category: 'prompt' as const, value })),
            { category: 'model-output', value: 'Long-session answer.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});
