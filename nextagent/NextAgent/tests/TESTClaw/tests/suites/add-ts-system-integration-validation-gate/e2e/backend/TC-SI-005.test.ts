import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-005 idempotent submit reuse', () => {
  it('returns one session, request, run, user message, and assistant result for a repeated key', async () => {
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
          modelAnswer: 'idempotent answer',
        });
        const idempotencyKey = `tc-si-005-${randomUUID()}`;
        const first = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'same user request',
          idempotencyKey,
        });
        const second = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'same user request',
          idempotencyKey,
        });
        expect(second).toEqual(first);

        const streamBody = await readCandidateStream(harness.baseUrl, first);
        expect(streamBody).toContain('event: REQUEST_COMPLETED');
        const conversation = await readCandidateConversation(harness.baseUrl, first.sessionId);
        expect(conversation.filter((item) => item.role === 'USER' && item.messageId === first.requestId)).toHaveLength(1);
        expect(conversation.filter((item) => item.role === 'ASSISTANT' && item.runId === first.runId)).toHaveLength(1);

        const sessionList = await fetch(`${harness.baseUrl}/api/v1/sessions?offset=0&limit=10`);
        expect(sessionList.status).toBe(200);
        const sessionListBody: unknown = await sessionList.json();
        if (!isObject(sessionListBody) || !Array.isArray(sessionListBody.entries)) {
          throw new Error('session-list-response-invalid');
        }
        expect(sessionListBody.entries.filter((entry) => isObject(entry) && entry.sessionId === first.sessionId)).toHaveLength(1);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-005',
          observations: {
            acceptanceIdentityReused: true,
            oneSessionObserved: true,
            oneUserMessageObserved: true,
            oneAssistantMessageObserved: true,
          },
          canaries: [
            { category: 'prompt', value: 'same user request' },
            { category: 'model-output', value: 'idempotent answer' },
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
