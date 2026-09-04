import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-069 task channel identity boundary', () => {
  it('rejects task creation without trusted identity headers', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);
    await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
      const harness = await startCandidateHarness({ scope, candidateRoot, modelAnswer: 'should-not-reach-model' });
      const response = await fetch(`${harness.baseUrl}/api/v1/stream-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          taskMessages: [{ text: 'identity canary task' }],
          idempotencyKey: `tc-si-069-${randomUUID()}`,
        }),
      });
      const body: unknown = await response.json();
      const errorCode = readErrorCode(body);
      if (errorCode !== 'IDENTITY_RESOLUTION_FAILED') {
        throw new Error(`unexpected-task-error-code-${errorCode ?? 'missing'}`);
      }
      expect(response.status).toBe(401);
      expect(harness.modelInvocationCount()).toBe(0);
      await writePassingCaseEvidence({
        evidenceRoot: scope.evidenceRoot,
        caseId: 'TC-SI-069',
        observations: { missingIdentityRejected: true, providerNotInvoked: true, userDataNotAccepted: true },
        canaries: [
          { category: 'prompt', value: 'identity canary task' },
          { category: 'model-output', value: 'should-not-reach-model' },
          { category: 'credential', value: 'testclaw-loopback-key' },
        ],
      });
    });
    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

function readErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return undefined;
  }
  const error = value.error;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
