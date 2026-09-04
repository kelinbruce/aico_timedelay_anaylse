import { describe, expect, it } from 'vitest';

import { submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-029 SSE disconnect and replay', () => {
  it('resumes without sequence regression and reaches the original terminal event', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const modelAnswer = 'Replay recovery completed.';
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer,
          modelResponseDelayMs: 1_500,
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Verify stream resume.',
        });

        const disconnected = await readThenDisconnect(harness.baseUrl, accepted.sessionId, accepted.runId);
        expect(disconnected.envelopes.length).toBeGreaterThan(0);
        expect(disconnected.envelopes.some((event) => event.eventType === 'REQUEST_COMPLETED')).toBe(false);
        const lastSeenSequence = Math.max(...disconnected.envelopes.map((event) => event.sequence));

        const replayResponse = await fetch(
          `${harness.baseUrl}/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=${lastSeenSequence}&runId=${accepted.runId}`,
        );
        expect(replayResponse.status).toBe(200);
        const replayBody = await replayResponse.text();
        const replayed = parseSseEnvelopes(replayBody);
        expect(replayed.length).toBeGreaterThan(0);
        expect(replayed.every((event) => event.sequence >= lastSeenSequence)).toBe(true);
        expect(replayed.some((event) => event.sequence > lastSeenSequence)).toBe(true);
        expect(replayed.at(-1)?.eventType).toBe('REQUEST_COMPLETED');
        expect(replayBody).toContain(modelAnswer);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-029',
          observations: {
            streamDisconnectedBeforeTerminal: true,
            persistedReplayAdvancedBeyondLastSeenSequence: true,
            replaySequenceDidNotRegress: true,
            originalRunCompletedAfterReconnect: true,
          },
          canaries: [
            { category: 'prompt', value: 'Verify stream resume.' },
            { category: 'model-output', value: modelAnswer },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

interface SseEnvelope {
  readonly eventType: string;
  readonly sequence: number;
}

async function readThenDisconnect(baseUrl: string, sessionId: string, runId: string): Promise<{ readonly envelopes: readonly SseEnvelope[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref();
  try {
    const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}`, { signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error('stream-body-unavailable');
    }
    const decoder = new TextDecoder();
    let received = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error('stream-ended-before-disconnect');
      }
      received += decoder.decode(chunk.value, { stream: true });
      const envelopes = parseSseEnvelopes(received);
      if (envelopes.length > 0) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        return { envelopes };
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

function parseSseEnvelopes(body: string): readonly SseEnvelope[] {
  const envelopes: SseEnvelope[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(line.slice('data: '.length));
      if (isObject(value) && typeof value.eventType === 'string' && typeof value.sequence === 'number') {
        envelopes.push({ eventType: value.eventType, sequence: value.sequence });
      }
    } catch {
      // A disconnected final frame is ignored; complete frames remain independently verifiable.
    }
  }
  return envelopes;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
