import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseSseEventTypes, readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-002 canonical SSE sequence', () => {
  it('keeps terminal ordering, replay bytes, and assistant history consistent', async () => {
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
        const conversation = await waitForAssistantConversation(harness.baseUrl, accepted.sessionId);
        const firstStream = await readCandidateStream(harness.baseUrl, accepted);
        const eventTypes = parseSseEventTypes(firstStream);
        expect(eventTypes).toContain('REQUEST_ACCEPTED');
        expect(eventTypes.at(-1)).toBe('REQUEST_COMPLETED');
        expect(eventTypes.indexOf('REQUEST_COMPLETED')).toBeGreaterThan(eventTypes.indexOf('REQUEST_ACCEPTED'));

        const replayedStream = await readCandidateStream(harness.baseUrl, accepted);
        expect(replayedStream).toBe(firstStream);
        expect(parseSseEventTypes(replayedStream).at(-1)).toBe('REQUEST_COMPLETED');

        const assistantContent = conversation.find((item) => item.role === 'ASSISTANT')?.content;
        expect(assistantContent).toBeTruthy();
        expect(firstStream).toContain(assistantContent);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-002',
          observations: {
            canonicalOrderObserved: true,
            terminalWasLast: true,
            byteExactReplayObserved: true,
            historyMatchedStream: true,
            eventSequenceDigest: createHash('sha256').update(eventTypes.join('\0'), 'utf8').digest('hex'),
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

async function waitForAssistantConversation(baseUrl: string, sessionId: string): Promise<Awaited<ReturnType<typeof readCandidateConversation>>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const conversation = await readCandidateConversation(baseUrl, sessionId);
    if (conversation.some((item) => item.role === 'ASSISTANT')) {
      return conversation;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('assistant-conversation-timeout');
}
