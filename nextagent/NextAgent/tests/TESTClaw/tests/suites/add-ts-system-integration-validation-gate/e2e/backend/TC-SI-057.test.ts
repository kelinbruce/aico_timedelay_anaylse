import type { IncomingHttpHeaders } from 'node:http';

import { describe, expect, it } from 'vitest';

import { readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-057 model invocation scope', () => {
  it('propagates trusted accepted coordinates as provider headers without injecting them into messages', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const modelRequests: Array<{ readonly body: unknown; readonly headers: IncomingHttpHeaders }> = [];
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: 'scope ok',
          inspectModelRequest: (body, headers) => {
            modelRequests.push({ body, headers: { ...headers } });
          },
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check model invocation scope.',
          locale: 'en-US',
        });
        expect(await readCandidateStream(harness.baseUrl, accepted)).toContain('event: REQUEST_COMPLETED');

        const scopedRequest = modelRequests.find((request) => headerValue(request.headers, 'x-nextagent-request-id') === accepted.requestId);
        if (scopedRequest === undefined) {
          throw new Error('scoped-model-request-not-observed');
        }
        expect(headerValue(scopedRequest.headers, 'x-nextagent-agent-id')).toBe('default-agent');
        expect(headerValue(scopedRequest.headers, 'x-nextagent-session-id')).toBe(accepted.sessionId);
        expect(headerValue(scopedRequest.headers, 'x-nextagent-request-id')).toBe(accepted.requestId);
        expect(headerValue(scopedRequest.headers, 'x-nextagent-run-id')).toBe(accepted.runId);
        const serializedBody = JSON.stringify(scopedRequest.body);
        expect(serializedBody).not.toContain(accepted.sessionId);
        expect(serializedBody).not.toContain(accepted.requestId);
        expect(serializedBody).not.toContain(accepted.runId);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-057',
          observations: {
            trustedAgentScopeHeaderObserved: true,
            sessionCoordinateHeaderMatchedAcceptance: true,
            requestCoordinateHeaderMatchedAcceptance: true,
            runCoordinateHeaderMatchedAcceptance: true,
            coordinatesAbsentFromModelMessages: true,
          },
          canaries: [
            { category: 'prompt', value: 'Check model invocation scope.' },
            { category: 'model-output', value: 'scope ok' },
            { category: 'credential', value: 'testclaw-loopback-key' },
            { category: 'sensitive-canary', value: accepted.sessionId },
            { category: 'sensitive-canary', value: accepted.requestId },
            { category: 'sensitive-canary', value: accepted.runId },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}
