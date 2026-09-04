import { describe, expect, it } from 'vitest';

import { parseCandidateSseEvents, readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-042 backend service QA smoke', () => {
  it('starts the packaged HTTP service and completes a chunked telecom QA request', async () => {
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
          modelAnswer: 'unused-smoke-answer',
          modelChunks: [{ content: 'LTE KPI' }, { content: ' RRC setup success rate is healthy.' }],
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check LTE KPI health.',
          locale: 'en-US',
        });
        expect(accepted.attempt).toBe(1);

        const stream = await readCandidateStream(harness.baseUrl, accepted);
        const events = parseCandidateSseEvents(stream);
        const contentSnapshots = events
          .filter((event) => event.eventType === 'LLM_CONTENT_DELTA')
          .map((event) => event.payload.content)
          .filter((content): content is string => typeof content === 'string');
        expect(events.some((event) => event.eventType === 'REQUEST_COMPLETED')).toBe(true);
        expect(contentSnapshots).toContain('LTE KPI');
        expect(contentSnapshots).toContain('LTE KPI RRC setup success rate is healthy.');

        const conversation = await readCandidateConversation(harness.baseUrl, accepted.sessionId);
        expect(conversation.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
        expect(conversation.at(-1)?.content).toContain('RRC setup success rate');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-042',
          observations: {
            packagedHttpServiceStarted: true,
            requestAcceptedOnFirstAttempt: true,
            cumulativeContentSnapshotsObserved: true,
            completedConversationPersisted: true,
          },
          canaries: [
            { category: 'prompt', value: 'Check LTE KPI health.' },
            { category: 'model-output', value: 'LTE KPI RRC setup success rate is healthy.' },
            { category: 'model-output', value: 'unused-smoke-answer' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});
