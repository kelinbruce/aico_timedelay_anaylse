import { describe, expect, it } from 'vitest';

import { parseSseEventTypes, readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-011 terminal commit consistency', () => {
  it('keeps terminal stream, persisted history, and replay aligned', async () => {
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
          modelAnswer: 'Terminal check passed.',
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Run terminal check.',
        });
        const liveStream = await readCandidateStream(harness.baseUrl, accepted);
        expect(liveStream).toContain('event: REQUEST_COMPLETED');

        const conversation = await readCandidateConversation(harness.baseUrl, accepted.sessionId);
        expect(conversation.at(-1)?.role).toBe('ASSISTANT');
        expect(conversation.at(-1)?.content).toContain('Terminal check passed.');

        const replay = await readCandidateStream(harness.baseUrl, accepted);
        const replayEvents = parseSseEventTypes(replay);
        expect(replayEvents.indexOf('REQUEST_ACCEPTED')).toBeGreaterThanOrEqual(0);
        expect(replayEvents.indexOf('REQUEST_COMPLETED')).toBeGreaterThan(replayEvents.indexOf('REQUEST_ACCEPTED'));
        expect(replayEvents.at(-1)).toBe('REQUEST_COMPLETED');
        expect(replay).toContain('Terminal check passed.');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-011',
          observations: {
            terminalStreamObserved: true,
            persistedHistoryMatched: true,
            refreshReplayMatched: true,
          },
          canaries: [
            { category: 'prompt', value: 'Run terminal check.' },
            { category: 'model-output', value: 'Terminal check passed.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});
