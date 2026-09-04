import { describe, expect, it } from 'vitest';

import { readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-050 daily single-turn product path', () => {
  it('keeps Web acceptance, cumulative stream, terminal state, and history consistent', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const finalAnswer = 'LTE KPI RRC setup success rate is healthy.';
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: 'unused-daily-answer',
          modelChunks: [{ content: 'LTE KPI' }, { content: ' RRC setup success rate is healthy.' }],
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check daily LTE KPI health.',
          locale: 'en-US',
        });
        const stream = await readCandidateStream(harness.baseUrl, accepted);
        expect(stream).toContain('event: REQUEST_COMPLETED');
        expect(stream).toContain(finalAnswer);

        const conversation = await readCandidateConversation(harness.baseUrl, accepted.sessionId);
        expect(conversation.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
        expect(conversation.at(-1)?.content).toBe(finalAnswer);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-050',
          observations: {
            webAcceptanceObserved: true,
            cumulativeStreamObserved: true,
            completedTerminalObserved: true,
            historyMatchesFinalStream: true,
          },
          canaries: [
            { category: 'prompt', value: 'Check daily LTE KPI health.' },
            { category: 'model-output', value: finalAnswer },
            { category: 'model-output', value: 'unused-daily-answer' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});
