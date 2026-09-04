import { describe, expect, it } from 'vitest';

import { readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-008 session create and conversation read', () => {
  it('auto-creates a session and exposes one completed question-answer conversation', async () => {
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
          modelAnswer: 'LTE KPIs are within healthy range.',
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check LTE KPI health.',
        });
        expect(accepted.sessionId).not.toHaveLength(0);
        expect(accepted.requestId).not.toHaveLength(0);
        expect(accepted.runId).not.toHaveLength(0);
        expect(accepted.attempt).toBe(1);

        const streamBody = await readCandidateStream(harness.baseUrl, accepted);
        expect(streamBody).toContain('event: REQUEST_ACCEPTED');
        expect(streamBody).toContain('event: REQUEST_COMPLETED');
        const conversation = await readCandidateConversation(harness.baseUrl, accepted.sessionId);
        expect(conversation.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
        expect(conversation.at(-1)?.content.length).toBeGreaterThan(0);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-008',
          observations: {
            sessionCreated: true,
            requestAccepted: true,
            terminalStreamObserved: true,
            conversationConsistent: true,
          },
          canaries: [
            { category: 'prompt', value: 'Check LTE KPI health.' },
            { category: 'model-output', value: 'LTE KPIs are within healthy range.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});
