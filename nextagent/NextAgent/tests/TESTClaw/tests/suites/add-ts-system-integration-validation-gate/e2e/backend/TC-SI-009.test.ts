import { describe, expect, it } from 'vitest';

import { parseSseEventTypes, readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-009 SSE canonical sequence and terminal state', () => {
  it('orders accepted before terminal and keeps terminal replay consistent', async () => {
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
          modelAnswer: 'Health',
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check health.',
        });
        const liveStream = await readCandidateStream(harness.baseUrl, accepted);
        assertCanonicalTerminal(parseSseEventTypes(liveStream));

        await waitForAssistant(harness.baseUrl, accepted.sessionId);
        const replayedStream = await readCandidateStream(harness.baseUrl, accepted);
        assertCanonicalTerminal(parseSseEventTypes(replayedStream));
        expect(replayedStream).toContain('Health');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-009',
          observations: {
            liveSequenceCanonical: true,
            replaySequenceCanonical: true,
            terminalWasLast: true,
          },
          canaries: [
            { category: 'prompt', value: 'Check health.' },
            { category: 'model-output', value: 'Health' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

function assertCanonicalTerminal(eventTypes: readonly string[]): void {
  const acceptedIndex = eventTypes.indexOf('REQUEST_ACCEPTED');
  const completedIndex = eventTypes.indexOf('REQUEST_COMPLETED');
  expect(acceptedIndex).toBeGreaterThanOrEqual(0);
  expect(completedIndex).toBeGreaterThan(acceptedIndex);
  expect(eventTypes.at(-1)).toBe('REQUEST_COMPLETED');
}

async function waitForAssistant(baseUrl: string, sessionId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const conversation = await readCandidateConversation(baseUrl, sessionId);
    if (conversation.some((item) => item.role === 'ASSISTANT')) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('assistant-conversation-timeout');
}
