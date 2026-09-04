import { describe, expect, it } from 'vitest';
import { createEvaluationReport, normalizeTaskResult } from '../report.mjs';

describe('HarnessBench framework effect scoring', () => {
  it('uses the execute-task count as denominator and excludes unsupported from scoring', () => {
    const tasks = Array.from({ length: 106 }, (_, index) => {
      const taskId = String(index + 1).padStart(3, '0');
      const isUnsupported = index >= 96;
      if (isUnsupported) {
        return {
          taskId,
          supportStatus: 'unsupported',
          terminalStatus: 'unsupported',
          outcomeScore: null,
          processScore: null,
          securityScore: null,
          combinedScore: null,
          taskScore: 0,
          requestCount: 0,
          totalTokens: 0,
          durationMs: null,
          reason: 'missing capability',
          failurePhase: null,
          failureReasonCode: null,
          modelRequestsObserved: false,
          workspaceOutcomeObserved: false,
          evidenceRefs: [],
        };
      }
      return {
        taskId,
        supportStatus: 'execute',
        terminalStatus: 'scored',
        outcomeScore: 1,
        processScore: 0.5,
        securityScore: 1,
        combinedScore: index === 0 ? 1 : 0,
        taskScore: index === 0 ? 1 : 0,
        requestCount: 1,
        totalTokens: 10,
        durationMs: 1,
        reason: null,
        evidenceRefs: [],
      };
    });
    const manifest = baseManifest(106, 10);
    const report = createEvaluationReport(manifest, tasks, { finishedAt: '2026-08-04T01:00:00.000Z' });

    expect(report.schemaVersion).toBe(5);
    expect(report.scoringDenominator).toBe(96);
    expect(report.benchmarkTaskCount).toBe(106);
    expect(report.frameworkEffectScore).toBe(0.0104);
    expect(report.evaluationValidity).toBe('valid');
    expect(report.gradingCoverage).toEqual({
      taskCount: 96,
      rubricScoredCount: 96,
      rubricSkippedCount: 0,
      processScorePresentCount: 96,
      oracleOnlyCount: 0,
    });
    expect(report.tasks[0]).toMatchObject({ outcomeScore: 1, processScore: 0.5, securityScore: 1, combinedScore: 1 });
    expect(report.tasks.every((task: { modelOutputLimitObserved?: boolean }) => typeof task.modelOutputLimitObserved === 'boolean')).toBe(true);
    expect(
      report.tasks.every(
        (task: { modelReasoningOnlyOutputLimitObserved?: boolean }) => typeof task.modelReasoningOnlyOutputLimitObserved === 'boolean',
      ),
    ).toBe(true);
    expect(report.diagnostics.modelOutputLimitObservedCount).toBe(0);
    expect(report.diagnostics.modelReasoningOnlyOutputLimitObservedCount).toBe(0);
  });

  it('excludes unsupported tasks from the scoring denominator', () => {
    const tasks = [
      scoredTask('001'),
      emptyUnsupported('002'),
      { ...scoredTask('003'), taskScore: 0, terminalStatus: 'agent_failed', combinedScore: 0 },
    ];
    const manifest = {
      ...baseManifest(3, 1),
      tasks: [
        { taskId: '001', supportStatus: 'execute' },
        { taskId: '002', supportStatus: 'unsupported' },
        { taskId: '003', supportStatus: 'execute' },
      ],
    };
    const report = createEvaluationReport(manifest, tasks);

    expect(report.scoringDenominator).toBe(2);
    expect(report.benchmarkTaskCount).toBe(3);
    expect(report.frameworkEffectScore).toBe(0.5);
  });

  it('publishes explicit score populations with mutually exclusive quality bands', () => {
    const scores = [1, 0.9, 0.6, 0.4, 0.3];
    const tasks = scores.map((score, index) => ({
      ...scoredTask(String(index + 1).padStart(3, '0')),
      combinedScore: score,
      taskScore: score,
    }));
    tasks.push({
      ...scoredTask('006'),
      terminalStatus: 'agent_failed',
      combinedScore: 0.8,
      taskScore: 0,
    });
    const report = createEvaluationReport(baseManifest(6), tasks);

    expect(report.scoreSummaries).toEqual({
      frameworkEffect: {
        population: 'execute',
        scoreField: 'taskScore',
        taskCount: 6,
        scoreSum: 3.2,
        mean: 0.5333,
        bands: { perfect: 1, excellent: 1, good: 1, qualified: 1, needsImprovement: 2 },
      },
      scoredCombined: {
        population: 'terminalStatus=scored',
        scoreField: 'combinedScore',
        taskCount: 5,
        scoreSum: 3.2,
        mean: 0.64,
        bands: { perfect: 1, excellent: 1, good: 1, qualified: 1, needsImprovement: 1 },
      },
    });
    expect(report.scoreSummaries.frameworkEffect.mean).toBe(report.frameworkEffectScore);
  });

  it('normalizes unsupported and failed tasks to zero without removing them', () => {
    expect(normalizeTaskResult({ taskId: 'a', supportStatus: 'unsupported', reason: 'missing browser' })).toMatchObject({
      terminalStatus: 'unsupported',
      taskScore: 0,
      modelOutputLimitObserved: false,
      modelReasoningOnlyOutputLimitObserved: false,
    });
    expect(normalizeTaskResult({ taskId: 'b', supportStatus: 'execute' }, { terminalStatus: 'agent_failed', combinedScore: 1 })).toMatchObject({
      terminalStatus: 'agent_failed',
      taskScore: 0,
      modelOutputLimitObserved: false,
      modelReasoningOnlyOutputLimitObserved: false,
    });
  });

  it('counts output-limit observations without changing terminal or score semantics', () => {
    const tasks = [
      { ...scoredTask('001'), modelOutputLimitObserved: true },
      { ...scoredTask('002'), terminalStatus: 'agent_failed', taskScore: 0, modelOutputLimitObserved: true },
    ];
    const report = createEvaluationReport(baseManifest(2), tasks);

    expect(report.diagnostics.modelOutputLimitObservedCount).toBe(2);
    expect(report.tasks).toMatchObject([
      { terminalStatus: 'scored', taskScore: 1, modelOutputLimitObserved: true },
      { terminalStatus: 'agent_failed', taskScore: 0, modelOutputLimitObserved: true },
    ]);
  });

  it('counts reasoning-only output-limit observations without changing timeout or score semantics', () => {
    const tasks = [
      { ...scoredTask('001'), modelReasoningOnlyOutputLimitObserved: true },
      {
        ...scoredTask('002'),
        terminalStatus: 'timed_out',
        taskScore: 0,
        failurePhase: 'terminal',
        failureReasonCode: 'TASK_TIMED_OUT',
        modelReasoningOnlyOutputLimitObserved: true,
      },
    ];
    const report = createEvaluationReport(baseManifest(2), tasks);

    expect(report.diagnostics.modelReasoningOnlyOutputLimitObservedCount).toBe(2);
    expect(report.tasks).toMatchObject([
      { terminalStatus: 'scored', taskScore: 1, modelReasoningOnlyOutputLimitObserved: true },
      {
        terminalStatus: 'timed_out',
        taskScore: 0,
        failurePhase: 'terminal',
        failureReasonCode: 'TASK_TIMED_OUT',
        modelReasoningOnlyOutputLimitObserved: true,
      },
    ]);
  });

  it('does not publish a total score while any task is incomplete', () => {
    const tasks = [{ ...scoredTask('001'), terminalStatus: 'not_completed' }];
    const report = createEvaluationReport(baseManifest(1), tasks, { finishedAt: '2026-08-04T01:00:00.000Z', scoreUnavailableReason: 'interrupted' });
    expect(report).not.toHaveProperty('frameworkEffectScore');
    expect(report).not.toHaveProperty('scoreSummaries');
    expect(report.scoreUnavailableReason).toBe('interrupted');
    expect(report.tasks[0]).toMatchObject({ modelReasoningOnlyOutputLimitObserved: false });
  });

  it('publishes frameworkEffectScore with coverageGap when rubric coverage is degraded', () => {
    const task = { ...scoredTask('001'), processScore: null, combinedScore: 0.8, taskScore: 0.8 };
    const report = createEvaluationReport(baseManifest(1), [task]);
    expect(report.evaluationValidity).toBe('degraded');
    expect(report.gradingCoverage).toMatchObject({ rubricScoredCount: 0, rubricSkippedCount: 1, oracleOnlyCount: 1 });
    expect(report.frameworkEffectScore).toBe(0.8);
    expect(report.diagnosticFrameworkEffectScore).toBe(0.8);
    expect(report.coverageGap).toEqual({ rubricSkippedCount: 1, rubricCoverageRate: 0 });
    expect(report).not.toHaveProperty('scoreUnavailableReason');
  });

  it('computes coverageGap rate correctly for multi-task degraded runs', () => {
    const tasks = [
      scoredTask('001'),
      { ...scoredTask('002'), processScore: null },
      { ...scoredTask('003'), processScore: null },
      { ...scoredTask('004'), terminalStatus: 'agent_failed', taskScore: 0, combinedScore: 0, processScore: null },
    ];
    const manifest = {
      ...baseManifest(4),
      tasks: Array.from({ length: 4 }, (_, index) => ({
        taskId: String(index + 1).padStart(3, '0'),
        supportStatus: 'execute',
      })),
    };
    const report = createEvaluationReport(manifest, tasks);
    expect(report.evaluationValidity).toBe('degraded');
    expect(report.frameworkEffectScore).toBe(0.75);
    expect(report.coverageGap).toEqual({ rubricSkippedCount: 3, rubricCoverageRate: 0.25 });
  });

  it('never publishes a score for a non-scoring regression run', () => {
    const report = createEvaluationReport(baseManifest(1), [scoredTask('001')], { nonScoring: true });
    expect(report).toMatchObject({ nonScoring: true, evaluationValidity: 'invalid' });
    expect(report).not.toHaveProperty('frameworkEffectScore');
    expect(report).not.toHaveProperty('diagnosticFrameworkEffectScore');
    expect(report).not.toHaveProperty('scoreSummaries');
  });
});

function baseManifest(count: number, unsupportedCount = 0) {
  const executeCount = count - unsupportedCount;
  return {
    schemaVersion: 2,
    runId: 'run-1',
    profileId: 'full-suite',
    startedAt: '2026-08-04T00:00:00.000Z',
    harnessBenchCommit: 'a'.repeat(40),
    nextAgentCommit: 'b'.repeat(40),
    nextAgentDirty: false,
    modelId: 'model',
    graderModelId: 'grader-model',
    benchmarkTaskCount: count,
    tasks: Array.from({ length: count }, (_, index) => ({
      taskId: String(index + 1).padStart(3, '0'),
      supportStatus: index < executeCount ? 'execute' : 'unsupported',
    })),
  };
}

function scoredTask(taskId: string) {
  return {
    taskId,
    supportStatus: 'execute',
    terminalStatus: 'scored',
    outcomeScore: 1,
    processScore: 1,
    securityScore: 1,
    combinedScore: 1,
    taskScore: 1,
    requestCount: 1,
    totalTokens: 1,
    durationMs: 1,
    reason: null,
    evidenceRefs: [],
  };
}

function emptyUnsupported(taskId: string) {
  return {
    taskId,
    supportStatus: 'unsupported',
    terminalStatus: 'unsupported',
    outcomeScore: null,
    processScore: null,
    securityScore: null,
    combinedScore: null,
    taskScore: 0,
    requestCount: 0,
    totalTokens: 0,
    durationMs: null,
    reason: 'missing capability',
    failurePhase: null,
    failureReasonCode: null,
    modelRequestsObserved: false,
    workspaceOutcomeObserved: false,
    modelOutputLimitObserved: false,
    evidenceRefs: [],
  };
}
