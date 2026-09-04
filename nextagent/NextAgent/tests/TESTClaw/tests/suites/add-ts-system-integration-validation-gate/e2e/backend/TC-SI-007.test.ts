/**
 * E2E Case: same-round parallel tool calls.
 * Risk: Multiple tool calls may be silently serialized or one result may be lost before model continuation.
 * Design Rationale: Requires a real provider stream, two real capability executions and canonical lifecycle ordering.
 * Entry: Web HTTP submit.
 * Cross-module path: model tool_calls -> core scheduler -> workspace tools -> stream -> next model round.
 * Untestable node: Real provider network, filesystem and concurrency.
 * Source deps: packed candidate Web API and built-in workspace tools.
 */
import { describe, expect, it } from 'vitest';

import { parseCandidateSseEvents, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-007 same-round parallel tools', () => {
  it('TC-SI-007', async () => {
    const candidateRoot = requiredCandidateRoot();
    const hashBefore = await hashDirectoryTree(candidateRoot);
    await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
      const harness = await startCandidateHarness({
        scope,
        candidateRoot,
        modelTurns: [
          {
            toolCalls: [
              {
                toolCallId: 'parallel-write',
                toolName: 'Write',
                arguments: { file_path: 'diagnostics/parallel.txt', content: 'parallel-evidence' },
              },
            ],
          },
          {
            toolCalls: [
              { toolCallId: 'parallel-glob', toolName: 'Glob', arguments: { pattern: 'diagnostics/**/*.txt' } },
              {
                toolCallId: 'parallel-read',
                toolName: 'Read',
                arguments: { file_path: 'diagnostics/parallel.txt', offset: 0, limit: 10 },
              },
            ],
          },
          { content: 'parallel tools completed' },
        ],
      });
      const accepted = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: 'parallel-tools-prompt' });
      const stream = await readCandidateStream(harness.baseUrl, accepted);
      expect(stream).toContain('event: REQUEST_COMPLETED');
      const events = parseCandidateSseEvents(stream);
      const startIndexes = ['parallel-glob', 'parallel-read'].map((toolCallId) =>
        events.findIndex((event) => event.eventType === 'CAPABILITY_STARTED' && event.payload.toolCallId === toolCallId),
      );
      const completionIndexes = ['parallel-glob', 'parallel-read'].map((toolCallId) =>
        events.findIndex((event) => event.eventType === 'CAPABILITY_COMPLETED' && event.payload.toolCallId === toolCallId),
      );
      expect(startIndexes.every((index) => index >= 0)).toBe(true);
      expect(completionIndexes.every((index) => index >= 0)).toBe(true);
      expect(Math.max(...startIndexes)).toBeLessThan(Math.min(...completionIndexes));
      expect(harness.modelInvocationCount()).toBe(3);
      await writePassingCaseEvidence({
        evidenceRoot: scope.evidenceRoot,
        caseId: 'TC-SI-007',
        observations: { sameRoundToolCalls: 2, bothStartedBeforeCompletion: true, finalModelRoundObserved: true },
        canaries: [
          { category: 'prompt', value: 'parallel-tools-prompt' },
          { category: 'model-output', value: 'parallel tools completed' },
          { category: 'credential', value: 'testclaw-loopback-key' },
        ],
      });
    });
    expect(await hashDirectoryTree(candidateRoot)).toBe(hashBefore);
  }, 120_000);
});
