/**
 * E2E Case: owner scope isolation.
 * Risk: A trusted but different owner may read another owner's task or session truth.
 * Design Rationale: Requires two independent trusted HTTP identities against one real persistence owner.
 * Entry: Task Channel HTTP API.
 * Cross-module path: identity headers -> task channel -> runtime -> owner-scoped gateway.
 * Untestable node: Real network and shared persistence.
 * Source deps: packed candidate task endpoints.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

const ownerA = { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a', 'x-subject-id': 'owner-a' };
const ownerB = { 'content-type': 'application/json', 'x-tenant-id': 'tenant-b', 'x-subject-id': 'owner-b' };

describe('TC-SI-006 owner scope isolation', () => {
  it('TC-SI-006', async () => {
    const candidateRoot = requiredCandidateRoot();
    const hashBefore = await hashDirectoryTree(candidateRoot);
    await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
      const harness = await startCandidateHarness({ scope, candidateRoot, modelAnswer: 'owner isolation completed' });
      const create = await fetch(`${harness.baseUrl}/api/v1/stream-task`, {
        method: 'POST',
        headers: ownerA,
        body: JSON.stringify({
          taskMessages: [{ text: 'owner-isolation-prompt' }],
          idempotencyKey: `tc-si-006-${randomUUID()}`,
        }),
      });
      expect(create.status).toBe(200);
      const coordinates = readCoordinates(await create.text());
      const foreignStream = await fetch(`${harness.baseUrl}/api/v1/stream-task/${coordinates.taskId}/retry`, {
        method: 'POST',
        headers: ownerB,
        body: JSON.stringify({ sessionId: coordinates.sessionId }),
      });
      expect([403, 404]).toContain(foreignStream.status);
      const foreignQuery = await fetch(`${harness.baseUrl}/api/v1/tasks/query`, {
        method: 'POST',
        headers: ownerB,
        body: JSON.stringify({ tasks: [coordinates] }),
      });
      expect(foreignQuery.status).toBe(200);
      const queryText = await foreignQuery.text();
      expect(queryText).toContain('NOT_FOUND');
      expect(queryText).not.toContain('owner-isolation-prompt');
      await writePassingCaseEvidence({
        evidenceRoot: scope.evidenceRoot,
        caseId: 'TC-SI-006',
        observations: { foreignStreamHidden: true, foreignQueryHidden: true, ownerDataNotLeaked: true },
        canaries: [
          { category: 'prompt', value: 'owner-isolation-prompt' },
          { category: 'model-output', value: 'owner isolation completed' },
          { category: 'credential', value: 'testclaw-loopback-key' },
        ],
      });
    });
    expect(await hashDirectoryTree(candidateRoot)).toBe(hashBefore);
  }, 120_000);
});

function readCoordinates(stream: string): { readonly sessionId: string; readonly taskId: string } {
  const data = stream
    .replaceAll('\r\n', '\n')
    .split('\n\n')
    .flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6)),
    )
    .filter((line) => line !== '[DONE]')
    .map((line) => JSON.parse(line) as unknown)
    .find((value) => isObject(value) && value.eventType === 'TASK_ACCEPTED');
  if (!isObject(data) || typeof data.sessionId !== 'string' || typeof data.taskId !== 'string') {
    throw new Error('task-coordinates-invalid');
  }
  return { sessionId: data.sessionId, taskId: data.taskId };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
