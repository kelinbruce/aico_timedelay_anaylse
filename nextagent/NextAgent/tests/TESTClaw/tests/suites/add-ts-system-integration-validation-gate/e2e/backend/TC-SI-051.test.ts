import { describe, expect, it } from 'vitest';

import { createCandidateSession, readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-051 daily multi-turn state', () => {
  it('carries the first assistant result into the second model invocation and conversation', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const firstPrompt = 'Summarize current alarms.';
        const firstAnswer = 'first alarm summary';
        const secondPrompt = 'Use the previous answer for next action.';
        const secondAnswer = 'second answer uses prior alarm summary';
        let priorStateObserved = false;
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: (body) => {
            if (containsString(body, secondPrompt) && containsString(body, firstAnswer)) {
              priorStateObserved = true;
              return secondAnswer;
            }
            return firstAnswer;
          },
        });
        const sessionId = await createCandidateSession(harness.baseUrl);

        const first = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: firstPrompt,
          sessionId,
        });
        expect(await readCandidateStream(harness.baseUrl, first)).toContain(firstAnswer);

        const second = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: secondPrompt,
          sessionId,
        });
        const secondStream = await readCandidateStream(harness.baseUrl, second);
        expect(secondStream).toContain(secondAnswer);
        expect(priorStateObserved).toBe(true);

        const conversation = await readCandidateConversation(harness.baseUrl, sessionId);
        expect(conversation.map((item) => item.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
        expect(conversation.map((item) => item.content)).toEqual([firstPrompt, firstAnswer, secondPrompt, secondAnswer]);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-051',
          observations: {
            explicitSessionUsed: true,
            firstTurnCompleted: true,
            priorAssistantStateReachedSecondModelCall: true,
            secondTurnCompleted: true,
            fourMessageConversationPersisted: true,
          },
          canaries: [
            { category: 'prompt', value: firstPrompt },
            { category: 'prompt', value: secondPrompt },
            { category: 'model-output', value: firstAnswer },
            { category: 'model-output', value: secondAnswer },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

function containsString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsString(entry, expected));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => containsString(entry, expected));
  }
  return false;
}
