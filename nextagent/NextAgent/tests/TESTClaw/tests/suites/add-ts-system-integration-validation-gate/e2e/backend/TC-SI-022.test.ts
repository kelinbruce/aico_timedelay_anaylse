import { describe, expect, it } from 'vitest';

import { readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-022 manual session title priority', () => {
  it('keeps a manual title authoritative after later activity', async () => {
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
          modelAnswer: 'Automatic title candidate.',
        });
        const first = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Inspect the access-network KPI trend.',
        });
        await readCandidateStream(harness.baseUrl, first);

        const manualTitle = 'Access Network Review';
        const updateResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${first.sessionId}/title`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: manualTitle }),
        });
        expect(updateResponse.status).toBe(200);
        const updated = await readSessionSummary(updateResponse, 'update-title');
        expect(updated.sessionId).toBe(first.sessionId);
        expect(updated.displayTitle).toBe(manualTitle);

        const second = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Continue with the latest counters.',
          sessionId: first.sessionId,
        });
        await readCandidateStream(harness.baseUrl, second);

        const listResponse = await fetch(`${harness.baseUrl}/api/v1/sessions?limit=10`);
        expect(listResponse.status).toBe(200);
        const entries = await readSessionEntries(listResponse);
        const listed = entries.find((entry) => entry.sessionId === first.sessionId);
        expect(listed?.displayTitle).toBe(manualTitle);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-022',
          observations: {
            manualTitleAccepted: true,
            laterSameSessionTurnCompleted: true,
            manualTitleRetainedInList: true,
          },
          canaries: [
            { category: 'prompt', value: 'Inspect the access-network KPI trend.' },
            { category: 'prompt', value: 'Continue with the latest counters.' },
            { category: 'prompt', value: manualTitle },
            { category: 'model-output', value: 'Automatic title candidate.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

interface SessionSummary {
  readonly sessionId: string;
  readonly displayTitle: string;
}

async function readSessionSummary(response: Response, operation: string): Promise<SessionSummary> {
  const body: unknown = await response.json();
  if (!isSessionSummary(body)) {
    throw new Error(`${operation}-response-invalid`);
  }
  return body;
}

async function readSessionEntries(response: Response): Promise<readonly SessionSummary[]> {
  const body: unknown = await response.json();
  if (!isObject(body) || !Array.isArray(body.entries) || !body.entries.every(isSessionSummary)) {
    throw new Error('list-sessions-response-invalid');
  }
  return body.entries;
}

function isSessionSummary(value: unknown): value is SessionSummary {
  return isObject(value) && typeof value.sessionId === 'string' && typeof value.displayTitle === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
