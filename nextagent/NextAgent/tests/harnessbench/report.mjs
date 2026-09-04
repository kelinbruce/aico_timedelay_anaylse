import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const publishableTerminalStatuses = new Set(['scored', 'unsupported', 'agent_failed', 'model_evidence_missing', 'timed_out', 'grading_failed']);
const zeroScoreStatuses = new Set(['unsupported', 'agent_failed', 'model_evidence_missing', 'timed_out', 'grading_failed']);
const failurePhases = new Set([
  'candidate_prepare',
  'session_create',
  'request_submit',
  'stream_wait',
  'terminal',
  'workspace_export',
  'harness_process',
  'grading',
]);
const forbiddenField =
  /^(?:credential|credentials|authorization|apiKey|accessToken|refreshToken|prompt|modelOutput|taskFileContent|rawProviderError)$/iu;
const forbiddenString =
  /(?:\bbearer\s+\S+|\bauthorization\s*[:=]|\bapi[_-]?key\s*[:=]|\b(?:access|refresh)[_-]?token\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;
const windowsAbsolutePath = /^[A-Za-z]:[\\/]/u;

export function normalizeTaskResult(manifestTask, upstreamResult) {
  if (manifestTask.supportStatus === 'unsupported') {
    return emptyTaskResult(manifestTask, 'unsupported', manifestTask.reason);
  }
  if (upstreamResult === undefined) return emptyTaskResult(manifestTask, 'not_completed', 'task did not complete');
  const terminalStatus = publishableTerminalStatuses.has(upstreamResult.terminalStatus) ? upstreamResult.terminalStatus : 'grading_failed';
  const taskScore = terminalStatus === 'scored' && validScore(upstreamResult.taskScore) !== null ? upstreamResult.taskScore : 0;
  return {
    taskId: manifestTask.taskId,
    supportStatus: 'execute',
    terminalStatus,
    outcomeScore: validScore(upstreamResult.outcomeScore),
    processScore: validScore(upstreamResult.processScore),
    securityScore: validScore(upstreamResult.securityScore),
    combinedScore: validScore(upstreamResult.combinedScore),
    taskScore,
    requestCount: nonNegativeInteger(upstreamResult.requestCount),
    totalTokens: nonNegativeInteger(upstreamResult.totalTokens),
    durationMs: nonNegativeNumber(upstreamResult.durationMs),
    reason: typeof upstreamResult.reason === 'string' ? upstreamResult.reason : null,
    failurePhase: terminalStatus === 'scored' ? null : normalizeFailurePhase(upstreamResult.failurePhase, terminalStatus),
    failureReasonCode: terminalStatus === 'scored' ? null : normalizeReasonCode(upstreamResult.failureReasonCode),
    modelRequestsObserved: upstreamResult.modelRequestsObserved === true || nonNegativeInteger(upstreamResult.requestCount) > 0,
    workspaceOutcomeObserved: upstreamResult.workspaceOutcomeObserved === true,
    modelOutputLimitObserved: upstreamResult.modelOutputLimitObserved === true,
    modelReasoningOnlyOutputLimitObserved: upstreamResult.modelReasoningOnlyOutputLimitObserved === true,
    evidenceRefs: safeRefs(upstreamResult.evidenceRefs),
  };
}

export function createEvaluationReport(manifest, taskResults, options = {}) {
  if (taskResults.length !== manifest.benchmarkTaskCount || manifest.tasks.length !== manifest.benchmarkTaskCount) {
    throw new Error('Task results must match the fixed benchmarkTaskCount.');
  }
  for (let index = 0; index < manifest.tasks.length; index += 1) {
    if (manifest.tasks[index].taskId !== taskResults[index].taskId) throw new Error('Task results must preserve manifest order and ids.');
  }
  const reportTasks = taskResults.map((task) => ({
    ...task,
    modelOutputLimitObserved: task.modelOutputLimitObserved === true,
    modelReasoningOnlyOutputLimitObserved: task.modelReasoningOnlyOutputLimitObserved === true,
  }));
  const statusCounts = {};
  for (const task of reportTasks) statusCounts[task.terminalStatus] = (statusCounts[task.terminalStatus] ?? 0) + 1;
  const complete = reportTasks.every((task) => publishableTerminalStatuses.has(task.terminalStatus));
  const gradingCoverage = summarizeGradingCoverage(reportTasks);
  const evaluationValidity = options.nonScoring === true || !complete ? 'invalid' : gradingCoverage.rubricSkippedCount > 0 ? 'degraded' : 'valid';
  const scoringDenominator = manifest.tasks.filter((task) => task.supportStatus === 'execute').length;
  const calculatedScore = round4(reportTasks.reduce((sum, task) => sum + normalizedScore(task), 0) / scoringDenominator);
  const diagnostics = summarizeDiagnostics(reportTasks);
  const scoreSummaries =
    complete && options.nonScoring !== true
      ? {
          frameworkEffect: summarizeScores(
            reportTasks.filter((task) => task.supportStatus === 'execute').map((task) => normalizedScore(task)),
            'execute',
            'taskScore',
          ),
          scoredCombined: summarizeScores(
            reportTasks
              .filter((task) => task.terminalStatus === 'scored')
              .map((task) => validScore(task.combinedScore))
              .filter((score) => score !== null),
            'terminalStatus=scored',
            'combinedScore',
          ),
        }
      : undefined;
  const report = {
    schemaVersion: 5,
    runId: manifest.runId,
    profileId: manifest.profileId,
    startedAt: manifest.startedAt,
    finishedAt: options.finishedAt ?? new Date().toISOString(),
    harnessBenchCommit: manifest.harnessBenchCommit,
    nextAgentCommit: manifest.nextAgentCommit,
    nextAgentDirty: manifest.nextAgentDirty,
    modelId: manifest.modelId,
    graderModelId: manifest.graderModelId,
    benchmarkTaskCount: manifest.benchmarkTaskCount,
    scoringDenominator,
    statusCounts,
    gradingCoverage,
    evaluationValidity,
    diagnostics,
    ...(scoreSummaries === undefined ? {} : { scoreSummaries }),
    ...(options.nonScoring === true ? { nonScoring: true } : {}),
    ...(evaluationValidity !== 'invalid' ? { frameworkEffectScore: calculatedScore } : {}),
    ...(evaluationValidity === 'degraded'
      ? {
          diagnosticFrameworkEffectScore: calculatedScore,
          coverageGap: {
            rubricSkippedCount: gradingCoverage.rubricSkippedCount,
            rubricCoverageRate: round4(gradingCoverage.rubricScoredCount / gradingCoverage.taskCount),
          },
        }
      : {}),
    ...(evaluationValidity === 'invalid'
      ? { scoreUnavailableReason: options.scoreUnavailableReason ?? validityReason(evaluationValidity, options.nonScoring === true) }
      : {}),
    manifest: manifest.tasks,
    tasks: reportTasks,
    evidenceRefs: safeRefs(options.evidenceRefs),
  };
  assertSafeReport(report);
  return report;
}

export async function writeEvaluationReport(outputDirectory, report, options = {}) {
  assertSafeReport(report);
  await mkdir(outputDirectory, { recursive: true });
  const baseName = options.baseName ?? 'report';
  if (!/^[a-z][a-z0-9-]*$/u.test(baseName)) throw new Error('Report baseName is invalid.');
  const jsonPath = resolve(outputDirectory, `${baseName}.json`);
  const markdownPath = resolve(outputDirectory, `${baseName}.md`);
  const nonce = randomUUID();
  const jsonTemp = resolve(outputDirectory, `${baseName}.${nonce}.json.tmp`);
  const markdownTemp = resolve(outputDirectory, `${baseName}.${nonce}.md.tmp`);
  try {
    await writeFile(jsonTemp, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(markdownTemp, renderMarkdown(report), { encoding: 'utf8', flag: 'wx' });
    await renameWithRetry(jsonTemp, jsonPath);
    await renameWithRetry(markdownTemp, markdownPath);
  } catch (error) {
    await Promise.all([rm(jsonTemp, { force: true }), rm(markdownTemp, { force: true })]);
    throw error;
  }
  return { jsonPath, markdownPath };
}

export function renderMarkdown(report) {
  assertSafeReport(report);
  const scoreLine =
    typeof report.frameworkEffectScore === 'number'
      ? report.evaluationValidity === 'degraded'
        ? `Framework effect score: ${report.frameworkEffectScore.toFixed(4)} (degraded; rubric coverage: ${report.gradingCoverage.rubricScoredCount}/${report.gradingCoverage.taskCount})`
        : `Framework effect score: ${report.frameworkEffectScore.toFixed(4)}`
      : `Framework effect score: unavailable (${report.scoreUnavailableReason})`;
  const statusRows = Object.entries(report.statusCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `| ${status} | ${count} |`);
  const taskRows = report.tasks.map(
    (task) =>
      `| ${task.taskId} | ${task.supportStatus} | ${task.terminalStatus} | ${task.failurePhase ?? '-'} | ${task.failureReasonCode ?? '-'} | ${yesNo(task.modelOutputLimitObserved)} | ${yesNo(task.modelReasoningOnlyOutputLimitObserved)} | ${yesNo(task.workspaceOutcomeObserved)} | ${task.taskScore.toFixed(4)} | ${formatScore(task.combinedScore)} | ${task.requestCount} | ${task.totalTokens} |`,
  );
  const scoreSummaryLines =
    report.scoreSummaries === undefined
      ? []
      : [
          '',
          '## Score summaries',
          '',
          '| Summary | Population | Score field | Tasks | Mean | Bands (perfect / excellent / good / qualified / needs improvement) |',
          '|---|---|---|---:|---:|---|',
          scoreSummaryRow('Framework effect', report.scoreSummaries.frameworkEffect),
          scoreSummaryRow('Scored task quality', report.scoreSummaries.scoredCombined),
        ];
  return [
    '# NextAgent HarnessBench Evaluation',
    '',
    scoreLine,
    `Evaluation validity: ${report.evaluationValidity}`,
    `Rubric coverage: ${report.gradingCoverage.rubricScoredCount}/${report.gradingCoverage.taskCount}`,
    `Model output limit observed: ${report.diagnostics.modelOutputLimitObservedCount} task(s)`,
    `Reasoning-only output limit observed: ${report.diagnostics.modelReasoningOnlyOutputLimitObservedCount} task(s)`,
    '',
    `- Run: ${report.runId}`,
    `- HarnessBench commit: ${report.harnessBenchCommit}`,
    `- NextAgent commit: ${report.nextAgentCommit}${report.nextAgentDirty ? ' (dirty)' : ''}`,
    `- Model: ${report.modelId}`,
    `- Benchmark tasks: ${report.benchmarkTaskCount}`,
    `- Scoring denominator: ${report.scoringDenominator}`,
    ...scoreSummaryLines,
    '',
    '## Status counts',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...statusRows,
    '',
    '## Tasks',
    '',
    '| Task | Support | Terminal status | Failure phase | Reason code | Output limit | Reasoning-only output limit | Workspace outcome | Task score | Upstream combined | Requests | Tokens |',
    '|---|---|---|---|---|---|---|---|---:|---:|---:|---:|',
    ...taskRows,
    '',
  ].join('\n');
}

export function assertSafeReport(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeReport(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenField.test(key)) throw new Error(`Report contains forbidden field at ${path}.${key}.`);
      assertSafeReport(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isHostAbsolutePath(value)) throw new Error(`Report contains a host absolute path at ${path}.`);
  if (typeof value === 'string' && forbiddenString.test(value)) throw new Error(`Report contains forbidden sensitive text at ${path}.`);
}

function emptyTaskResult(manifestTask, terminalStatus, reason) {
  return {
    taskId: manifestTask.taskId,
    supportStatus: manifestTask.supportStatus,
    terminalStatus,
    outcomeScore: null,
    processScore: null,
    securityScore: null,
    combinedScore: null,
    taskScore: 0,
    requestCount: 0,
    totalTokens: 0,
    durationMs: null,
    reason,
    failurePhase: terminalStatus === 'unsupported' ? null : normalizeFailurePhase(undefined, terminalStatus),
    failureReasonCode: terminalStatus === 'unsupported' ? null : normalizeReasonCode(undefined),
    modelRequestsObserved: false,
    workspaceOutcomeObserved: false,
    modelOutputLimitObserved: false,
    modelReasoningOnlyOutputLimitObserved: false,
    evidenceRefs: [],
  };
}

function summarizeGradingCoverage(tasks) {
  const eligible = tasks.filter((task) => task.supportStatus === 'execute' && task.terminalStatus !== 'not_completed');
  const rubricScoredCount = eligible.filter((task) => validScore(task.processScore) !== null).length;
  return {
    taskCount: eligible.length,
    rubricScoredCount,
    rubricSkippedCount: eligible.length - rubricScoredCount,
    processScorePresentCount: rubricScoredCount,
    oracleOnlyCount: eligible.filter((task) => validScore(task.combinedScore) !== null && validScore(task.processScore) === null).length,
  };
}

function summarizeDiagnostics(tasks) {
  const execute = tasks.filter((task) => task.supportStatus === 'execute');
  const failed = execute.filter((task) => task.terminalStatus !== 'scored' && task.terminalStatus !== 'not_completed');
  const completed = execute.filter((task) => task.terminalStatus === 'scored').length;
  const artifactObserved = execute.filter((task) => task.workspaceOutcomeObserved === true).length;
  return {
    failedWithPositiveUpstreamScoreCount: failed.filter((task) => validScore(task.combinedScore) > 0).length,
    failedWithWorkspaceOutcomeCount: failed.filter((task) => task.workspaceOutcomeObserved === true).length,
    modelOutputLimitObservedCount: execute.filter((task) => task.modelOutputLimitObserved === true).length,
    modelReasoningOnlyOutputLimitObservedCount: execute.filter((task) => task.modelReasoningOnlyOutputLimitObserved === true).length,
    terminalSuccessRate: round4(execute.length === 0 ? 0 : completed / execute.length),
    artifactOutcomeObservedRate: round4(execute.length === 0 ? 0 : artifactObserved / execute.length),
  };
}

function summarizeScores(scores, population, scoreField) {
  const scoreSum = scores.reduce((sum, score) => sum + score, 0);
  const bands = { perfect: 0, excellent: 0, good: 0, qualified: 0, needsImprovement: 0 };
  for (const score of scores) {
    if (score >= 1) bands.perfect += 1;
    else if (score >= 0.9) bands.excellent += 1;
    else if (score >= 0.6) bands.good += 1;
    else if (score >= 0.4) bands.qualified += 1;
    else bands.needsImprovement += 1;
  }
  return {
    population,
    scoreField,
    taskCount: scores.length,
    scoreSum: round4(scoreSum),
    mean: round4(scores.length === 0 ? 0 : scoreSum / scores.length),
    bands,
  };
}

function normalizeFailurePhase(value, terminalStatus) {
  if (typeof value === 'string' && failurePhases.has(value)) return value;
  if (terminalStatus === 'grading_failed') return 'grading';
  if (terminalStatus === 'timed_out') return 'stream_wait';
  return 'harness_process';
}

function normalizeReasonCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(value) ? value : 'UNKNOWN';
}

function validityReason(validity, nonScoring) {
  if (nonScoring) return 'nonScoring diagnostic run';
  return 'one or more tasks are not completed';
}

function normalizedScore(task) {
  if (zeroScoreStatuses.has(task.terminalStatus)) return 0;
  return validScore(task.taskScore) ?? 0;
}

function validScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeRefs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || isHostAbsolutePath(item)))
    throw new Error('Evidence refs must be relative strings.');
  return [...value];
}

function isHostAbsolutePath(value) {
  return isAbsolute(value) || windowsAbsolutePath.test(value) || value.startsWith('\\\\');
}

function round4(value) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function yesNo(value) {
  return value === true ? 'yes' : 'no';
}

function formatScore(value) {
  return validScore(value)?.toFixed(4) ?? '-';
}

function scoreSummaryRow(label, summary) {
  const { bands } = summary;
  return `| ${label} | ${summary.population} | ${summary.scoreField} | ${summary.taskCount} | ${summary.mean.toFixed(4)} | ${bands.perfect} / ${bands.excellent} / ${bands.good} / ${bands.qualified} / ${bands.needsImprovement} |`;
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt === 5) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100 * (attempt + 1)));
    }
  }
}

function isTransientRenameError(error) {
  return error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES');
}
