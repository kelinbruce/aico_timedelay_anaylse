import { describe, expect, it } from 'vitest';

import { readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-010 SSE and WebSocket terminal consistency', () => {
  it('exposes the same completed run through SSE and WebSocket replay', async () => {
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
          modelAnswer: 'SSE and WebSocket consistent.',
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Run consistency check.',
        });
        const sseBody = await readCandidateStream(harness.baseUrl, accepted);
        expect(sseBody).toContain('event: REQUEST_COMPLETED');

        const websocketMessages = await readWebSocketReplay(harness.baseUrl, accepted.sessionId, accepted.runId);
        expect(websocketMessages.length).toBeGreaterThan(0);
        expect(websocketMessages.join('\n')).toContain('REQUEST_COMPLETED');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-010',
          observations: {
            sseTerminalObserved: true,
            websocketTerminalObserved: true,
            websocketMessageCount: websocketMessages.length,
          },
          canaries: [
            { category: 'prompt', value: 'Run consistency check.' },
            { category: 'model-output', value: 'SSE and WebSocket consistent.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

async function readWebSocketReplay(baseUrl: string, sessionId: string, runId: string): Promise<readonly string[]> {
  const url = new URL(baseUrl);
  const socket = new WebSocket(`ws://${url.host}/api/v1/sessions/${sessionId}/ws?lastSeenSequence=0&runId=${runId}`);
  const messages: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('websocket-terminal-timeout'));
    }, 10_000);
    socket.addEventListener('message', (event) => {
      const message = String(event.data);
      messages.push(message);
      if (message.includes('REQUEST_COMPLETED')) {
        clearTimeout(timer);
        socket.close();
        resolve();
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('websocket-replay-failed'));
    });
  });
  return messages;
}
