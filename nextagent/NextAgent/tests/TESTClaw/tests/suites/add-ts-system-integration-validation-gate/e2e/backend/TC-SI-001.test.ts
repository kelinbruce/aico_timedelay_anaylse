import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCandidateSession, readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-001 minimal Q&A main flow', () => {
  it('creates explicit and implicit sessions with terminal SSE and consistent history', async () => {
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

        const explicitSessionId = await createCandidateSession(harness.baseUrl);
        const explicitRequest = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check LTE KPI health.',
          sessionId: explicitSessionId,
        });
        expect(explicitRequest.sessionId).toBe(explicitSessionId);
        expect(explicitRequest.requestId).not.toHaveLength(0);
        expect(explicitRequest.runId).not.toHaveLength(0);
        expect(explicitRequest.attempt).toBe(1);
        await expectTerminalConversation(harness.baseUrl, explicitRequest);

        const implicitRequest = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Hello.',
        });
        expect(implicitRequest.sessionId).not.toHaveLength(0);
        await expectTerminalConversation(harness.baseUrl, implicitRequest);
        expect(harness.modelInvocationCount()).toBeGreaterThanOrEqual(2);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-001',
          observations: {
            explicitSessionObserved: true,
            implicitSessionObserved: true,
            terminalStreamObserved: true,
            historyConsistencyObserved: true,
            modelInvocationCount: harness.modelInvocationCount(),
            observationDigest: createHash('sha256').update(`${explicitRequest.runId}\0${implicitRequest.runId}`, 'utf8').digest('hex'),
          },
          canaries: [
            { category: 'prompt', value: 'Check LTE KPI health.' },
            { category: 'prompt', value: 'Hello.' },
            { category: 'model-output', value: 'LTE KPIs are within healthy range.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

async function expectTerminalConversation(baseUrl: string, request: { readonly sessionId: string; readonly runId: string }): Promise<void> {
  const streamBody = await readCandidateStream(baseUrl, request);
  expect(streamBody).toContain('event: REQUEST_ACCEPTED');
  expect(streamBody).toContain('event: REQUEST_COMPLETED');

  const conversation = await readCandidateConversation(baseUrl, request.sessionId);
  expect(conversation.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
  expect(conversation.at(-1)?.content.length).toBeGreaterThan(0);
}
