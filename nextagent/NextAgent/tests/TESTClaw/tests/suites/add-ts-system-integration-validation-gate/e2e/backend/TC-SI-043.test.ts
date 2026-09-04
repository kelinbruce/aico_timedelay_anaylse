import { describe, expect, it } from 'vitest';

import { parseCandidateSseEvents, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-043 cumulative content and thinking snapshots', () => {
  it('projects provider deltas as cumulative public reasoning and content snapshots', async () => {
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
          modelAnswer: 'unused-snapshot-answer',
          modelChunks: [{ reasoning: 'plan' }, { reasoning: ' next' }, { content: 'LTE KPI' }, { content: ' is healthy.' }],
        });
        const accepted = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check LTE KPI health snapshots.',
          locale: 'en-US',
        });
        const stream = await readCandidateStream(harness.baseUrl, accepted);
        const events = parseCandidateSseEvents(stream);
        const reasoningSnapshots = events
          .filter((event) => event.eventType === 'LLM_THINKING_DELTA')
          .map((event) => event.payload.reasoning)
          .filter((reasoning): reasoning is string => typeof reasoning === 'string');
        const contentSnapshots = events
          .filter((event) => event.eventType === 'LLM_CONTENT_DELTA')
          .map((event) => event.payload.content)
          .filter((content): content is string => typeof content === 'string');

        expect(reasoningSnapshots.slice(0, 2)).toEqual(['plan', 'plan next']);
        expect(reasoningSnapshots.at(-1)).toBe('plan next');
        expect(reasoningSnapshots.every((snapshot, index) => index === 0 || snapshot.startsWith(reasoningSnapshots[index - 1] ?? ''))).toBe(true);
        expect(contentSnapshots).toEqual(['LTE KPI', 'LTE KPI is healthy.', 'LTE KPI is healthy.']);
        expect(events.at(-1)?.eventType).toBe('REQUEST_COMPLETED');

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-043',
          observations: {
            cumulativeReasoningSnapshots: reasoningSnapshots.length,
            cumulativeContentSnapshots: contentSnapshots.length,
            completedTerminalObserved: true,
          },
          canaries: [
            { category: 'prompt', value: 'Check LTE KPI health snapshots.' },
            { category: 'model-output', value: 'plan next' },
            { category: 'model-output', value: 'LTE KPI is healthy.' },
            { category: 'model-output', value: 'unused-snapshot-answer' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});
