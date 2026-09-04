import { describe, expect, it } from 'vitest';

import { readCandidateConversation, readCandidateStream, submitCandidateRequest } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-023 bilingual telecom output', () => {
  it('propagates zh-CN and en-US to the model boundary while preserving telecom terms', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        let zhBoundaryRequests = 0;
        let enBoundaryRequests = 0;
        const zhAnswer = 'LTE KPI 状态健康。';
        const enAnswer = 'LTE KPI status is healthy.';
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: (body) => {
            if (containsString(body, 'zh-CN')) {
              zhBoundaryRequests += 1;
              return zhAnswer;
            }
            if (containsString(body, 'en-US')) {
              enBoundaryRequests += 1;
              return enAnswer;
            }
            return 'Locale propagation missing.';
          },
        });

        const zhRequest = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: '检查 LTE KPI 健康状态。',
          locale: 'zh-CN',
        });
        const zhStream = await readCandidateStream(harness.baseUrl, zhRequest);
        expect(zhStream).toContain(zhAnswer);
        expect(zhStream).toContain('LTE KPI');

        const enRequest = await submitCandidateRequest({
          baseUrl: harness.baseUrl,
          inputText: 'Check LTE KPI health.',
          locale: 'en-US',
        });
        const enStream = await readCandidateStream(harness.baseUrl, enRequest);
        expect(enStream).toContain(enAnswer);
        expect(enStream).toContain('LTE KPI');

        const zhConversation = await readCandidateConversation(harness.baseUrl, zhRequest.sessionId);
        const enConversation = await readCandidateConversation(harness.baseUrl, enRequest.sessionId);
        expect(zhConversation.at(-1)?.content).toBe(zhAnswer);
        expect(enConversation.at(-1)?.content).toBe(enAnswer);
        expect(zhBoundaryRequests).toBeGreaterThan(0);
        expect(enBoundaryRequests).toBeGreaterThan(0);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-023',
          observations: {
            zhLocaleReachedModelBoundary: true,
            enLocaleReachedModelBoundary: true,
            zhOutputPersisted: true,
            enOutputPersisted: true,
            telecomTermPreservedInBoth: true,
          },
          canaries: [
            { category: 'prompt', value: '检查 LTE KPI 健康状态。' },
            { category: 'prompt', value: 'Check LTE KPI health.' },
            { category: 'model-output', value: zhAnswer },
            { category: 'model-output', value: enAnswer },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

function containsString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsString(entry, expected));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => containsString(entry, expected));
  }
  return false;
}
