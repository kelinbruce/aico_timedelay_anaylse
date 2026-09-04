import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeReport, renderMarkdown, writeEvaluationReport } from '../report.mjs';

describe('HarnessBench report publication', () => {
  it('atomically writes consistent JSON and Markdown from one safe report', async () => {
    const output = await mkdtemp(join(tmpdir(), 'nextagent-harness-report-'));
    const report = completeReport();
    const paths = await writeEvaluationReport(output, report);
    await writeEvaluationReport(output, report);
    const json = JSON.parse(await readFile(paths.jsonPath, 'utf8'));
    const markdown = await readFile(paths.markdownPath, 'utf8');

    expect(json.frameworkEffectScore).toBe(1);
    expect(markdown).toBe(renderMarkdown(json));
    expect(markdown).toContain('Framework effect score: 1.0000');
    expect(markdown).toContain('| Framework effect | execute | taskScore | 1 | 1.0000 | 1 / 0 / 0 / 0 / 0 |');
    expect(markdown).toContain('| Scored task quality | terminalStatus=scored | combinedScore | 1 | 1.0000 | 1 / 0 / 0 / 0 / 0 |');
    expect(markdown).toContain('Evaluation validity: valid');
    expect(markdown).toContain('Rubric coverage: 1/1');
    expect(markdown).toContain('Model output limit observed: 1 task(s)');
    expect(markdown).toContain('Reasoning-only output limit observed: 1 task(s)');
    expect(markdown).toContain('| 001-file | execute | scored | - | - | yes | yes | yes | 1.0000 | 1.0000 |');
    expect((await readdir(output)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects secrets, prompt/output bodies, task content, and absolute paths', () => {
    expect(() => assertSafeReport({ ...completeReport(), credential: 'secret' })).toThrow(/forbidden field/u);
    expect(() => assertSafeReport({ ...completeReport(), prompt: 'full prompt' })).toThrow(/forbidden field/u);
    expect(() => assertSafeReport({ ...completeReport(), note: 'Authorization: Bearer secret-value' })).toThrow(/sensitive text/u);
    expect(() => assertSafeReport({ ...completeReport(), note: 'api_key=secret-value' })).toThrow(/sensitive text/u);
    expect(() => assertSafeReport({ ...completeReport(), evidenceRefs: ['C:\\private\\trace.json'] })).toThrow(/absolute path/u);
    expect(() => assertSafeReport({ ...completeReport(), evidenceRefs: ['/private/trace.json'] })).toThrow(/absolute path/u);
  });

  it('allows non-sensitive token counts and opaque evidence refs', () => {
    expect(() => assertSafeReport(completeReport())).not.toThrow();
  });
});

function completeReport() {
  return {
    schemaVersion: 5,
    runId: 'run-1',
    profileId: 'full-suite',
    startedAt: '2026-08-04T00:00:00.000Z',
    finishedAt: '2026-08-04T01:00:00.000Z',
    harnessBenchCommit: 'a'.repeat(40),
    nextAgentCommit: 'b'.repeat(40),
    nextAgentDirty: false,
    modelId: 'model',
    graderModelId: 'grader-model',
    benchmarkTaskCount: 1,
    scoringDenominator: 1,
    statusCounts: { scored: 1 },
    gradingCoverage: { taskCount: 1, rubricScoredCount: 1, rubricSkippedCount: 0, processScorePresentCount: 1, oracleOnlyCount: 0 },
    evaluationValidity: 'valid',
    diagnostics: {
      failedWithPositiveUpstreamScoreCount: 0,
      failedWithWorkspaceOutcomeCount: 0,
      modelOutputLimitObservedCount: 1,
      modelReasoningOnlyOutputLimitObservedCount: 1,
      terminalSuccessRate: 1,
      artifactOutcomeObservedRate: 1,
    },
    frameworkEffectScore: 1,
    scoreSummaries: {
      frameworkEffect: {
        population: 'execute',
        scoreField: 'taskScore',
        taskCount: 1,
        scoreSum: 1,
        mean: 1,
        bands: { perfect: 1, excellent: 0, good: 0, qualified: 0, needsImprovement: 0 },
      },
      scoredCombined: {
        population: 'terminalStatus=scored',
        scoreField: 'combinedScore',
        taskCount: 1,
        scoreSum: 1,
        mean: 1,
        bands: { perfect: 1, excellent: 0, good: 0, qualified: 0, needsImprovement: 0 },
      },
    },
    manifest: [{ taskId: '001-file', supportStatus: 'execute' }],
    tasks: [
      {
        taskId: '001-file',
        supportStatus: 'execute',
        terminalStatus: 'scored',
        outcomeScore: 1,
        processScore: 1,
        securityScore: 1,
        combinedScore: 1,
        taskScore: 1,
        requestCount: 1,
        totalTokens: 10,
        durationMs: 5,
        reason: null,
        failurePhase: null,
        failureReasonCode: null,
        modelRequestsObserved: true,
        workspaceOutcomeObserved: true,
        modelOutputLimitObserved: true,
        modelReasoningOnlyOutputLimitObserved: true,
        evidenceRefs: ['evidence/task-001.json'],
      },
    ],
    evidenceRefs: ['evidence/summary.json'],
  };
}
