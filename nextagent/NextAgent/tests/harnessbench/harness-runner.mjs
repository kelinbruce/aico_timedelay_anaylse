import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HARNESSBENCH_MODEL_MAX_OUTPUT_TOKENS } from './evaluation-config.mjs';
import { summarizeModelEvidence } from './model-evidence.mjs';

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

export function buildHarnessConfig({ command, cliPath, modelId, taskTimeoutSeconds, terminalTimeoutSeconds, candidateTemplate, runRoot }) {
  return {
    models: {
      nextagent: {
        adapter: 'generic_cli',
        command,
        model: modelId,
        session_prefix: 'nextagent-harnessbench',
        timeout_sec: taskTimeoutSeconds,
        use_usage_proxy: true,
        args: [
          cliPath,
          '--workspace',
          '{workspace}',
          '--prompt-file',
          '{prompt_file}',
          '--session-id',
          '{session_id}',
          '--model-id',
          modelId,
          '--candidate-template',
          candidateTemplate ?? 'candidate-template',
          '--run-root',
          runRoot ?? 'run-root',
          '--timeout-ms',
          String(terminalTimeoutSeconds * 1000),
        ],
      },
    },
  };
}

export async function writeHarnessConfig(path, input) {
  await writeFile(path, `${JSON.stringify(buildHarnessConfig(input), null, 2)}\n`, 'utf8');
}

export function classifyUpstreamTaskResult(result, { modelReasoningOnlyOutputLimitObserved = false } = {}) {
  const evidence = summarizeModelEvidence(result?.usage_summary);
  const scoring = result?.scoring ?? {};
  const combined = validScore(scoring.combined_score);
  const adapterEvidence = summarizeAdapterEvidence(result);
  const base = {
    taskId: String(result?.task_id ?? ''),
    outcomeScore: validScore(scoring.outcome_score),
    processScore: validScore(scoring.process_score),
    securityScore: validScore(scoring.security_score),
    combinedScore: combined,
    requestCount: evidence.requestCount,
    totalTokens: evidence.totalTokens,
    durationMs: secondsToMs(result?.elapsed_sec),
    failurePhase: adapterEvidence?.failurePhase,
    failureReasonCode: adapterEvidence?.failureReasonCode,
    modelRequestsObserved: evidence.requestCount > 0,
    workspaceOutcomeObserved: adapterEvidence?.workspaceOutcomeObserved === true,
    modelOutputLimitObserved: adapterEvidence.modelOutputLimitObserved,
    modelReasoningOnlyOutputLimitObserved: modelReasoningOnlyOutputLimitObserved === true,
    evidenceRefs: result?.task_id === undefined ? [] : [`upstream-results/${String(result.task_id)}.json`],
  };
  if (looksTimedOut(result)) return { ...base, terminalStatus: 'timed_out', taskScore: 0, reason: 'task timeout' };
  if (result?.ok !== true) return { ...base, terminalStatus: 'agent_failed', taskScore: 0, reason: safeReason(result) };
  if (evidence.status !== 'verified')
    return { ...base, terminalStatus: 'model_evidence_missing', taskScore: 0, reason: 'real model usage evidence is missing' };
  if (combined === null)
    return { ...base, terminalStatus: 'grading_failed', taskScore: 0, reason: 'HarnessBench combined_score is missing or invalid' };
  return { ...base, terminalStatus: 'scored', taskScore: combined, reason: null };
}

export async function runWithBoundedInfrastructureRetry({ taskId, runAttempt, writeLedger }) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await runAttempt(attempt);
      attempts.push({ attempt, status: 'completed' });
      await writeLedger([...attempts]);
      return result;
    } catch (error) {
      const entry = {
        attempt,
        status: 'failed',
        failurePhase: safeFailureField(error, 'failurePhase', 'harness_process'),
        failureReasonCode: safeFailureField(error, 'failureReasonCode', 'UNKNOWN'),
      };
      attempts.push(entry);
      await writeLedger([...attempts]);
      if (attempt === 2 || error?.retrySafe !== true) throw error;
    }
  }
  throw new Error(`HarnessBench task ${taskId} did not return a result.`);
}

export async function runHarnessTask({ python, upstreamRoot, configPath, resultRoot, taskId, env, signal }) {
  const processResult = await runProcess(
    python,
    [resolve(import.meta.dirname, 'harness-task-wrapper.py'), 'run-task', '--task', taskId, '--harness', 'nextagent', '--mode', 'live'],
    {
      cwd: upstreamRoot,
      env: { ...env, HARNESSBENCH_HARNESS_CONFIG: configPath },
      signal,
    },
  );
  const raw = await readHarnessTaskResult(resultRoot, taskId);
  return resolveHarnessTaskProcessResult(processResult, raw);
}

export function resolveHarnessTaskProcessResult(processResult, raw) {
  if (raw !== undefined) return mergeHarnessTaskResult(parseOptionalSummary(processResult.stdout), raw);
  const summary = parseOptionalSummary(processResult.stdout);
  if (summary?.failurePhase === 'harness_process' && summary?.failureReasonCode === 'PROCESS_TIMEOUT') {
    throw harnessProcessError('HarnessBench task process timed out.', 'PROCESS_TIMEOUT');
  }
  if (processResult.exitCode !== 0) throw harnessProcessError('HarnessBench task process failed.', 'PROCESS_NONZERO_EXIT');
  if (summary === undefined) throw harnessProcessError('HarnessBench result summary is invalid.', 'RESULT_SUMMARY_INVALID');
  throw harnessProcessError('HarnessBench result is missing.', 'RESULT_JSON_MISSING');
}

export function mergeHarnessTaskResult(summary, raw) {
  return {
    ...summary,
    ...raw,
    ok: raw?.adapter_result?.ok === true,
    ...(raw?.adapter_result === undefined ? {} : { adapter_result: raw.adapter_result }),
    ...(Array.isArray(raw?.adapter_results) ? { adapter_results: raw.adapter_results } : {}),
  };
}

export function parseLastJsonObject(output) {
  const starts = [];
  for (let index = 0; index < output.length; index += 1) if (output[index] === '{') starts.push(index);
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(output.slice(start));
    } catch {
      // Continue to the previous object boundary.
    }
  }
  throw new Error('HarnessBench did not emit a JSON task result.');
}

function runProcess(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) =>
      reject(Object.assign(error, { retrySafe: true, failurePhase: 'harness_process', failureReasonCode: 'PROCESS_START_FAILED' })),
    );
    child.once('close', (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function parseOptionalSummary(output) {
  try {
    return parseLastJsonObject(output);
  } catch {
    return undefined;
  }
}

function harnessProcessError(message, failureReasonCode) {
  return Object.assign(new Error(message), {
    retrySafe: false,
    failurePhase: 'harness_process',
    failureReasonCode,
  });
}

export async function readHarnessTaskResult(resultRoot, taskId) {
  const entries = await readdir(resultRoot, { recursive: true, withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name === `${taskId}.json`)
    .map((entry) => resolve(entry.parentPath ?? entry.path, entry.name));
  if (matches.length === 0) return undefined;
  const values = (
    await Promise.all(
      matches.map(async (path) => {
        try {
          return { path, value: JSON.parse(await readFile(path, 'utf8')) };
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((value) => value !== undefined);
  if (values.length === 0) throw harnessProcessError('HarnessBench result JSON is invalid.', 'RESULT_JSON_INVALID');
  values.sort((left, right) => Number(left.value?.elapsed_sec ?? 0) - Number(right.value?.elapsed_sec ?? 0));
  return values.at(-1)?.value;
}

function validScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function secondsToMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
}

function looksTimedOut(result) {
  return /timeout|timed out|timed_out/iu.test(`${result?.error_type ?? ''} ${result?.error ?? ''} ${result?.adapter_result?.stderr ?? ''}`);
}

function safeReason() {
  return 'agent execution failed';
}

function summarizeAdapterEvidence(result) {
  const adapterResults = Array.isArray(result?.adapter_results) ? [...result.adapter_results] : [];
  if (result?.adapter_result !== undefined && !adapterResults.includes(result.adapter_result)) adapterResults.push(result.adapter_result);
  const failures = [];
  let workspaceOutcomeObserved = false;
  let modelOutputLimitObserved = false;
  for (const adapterResult of adapterResults) {
    const parsed = parseAdapterJson(adapterResult?.stdout);
    if (parsed === undefined) continue;
    workspaceOutcomeObserved ||= parsed.workspaceOutcomeObserved === true;
    if (isSafeFailureEvidence(parsed)) failures.push(parsed);
    modelOutputLimitObserved ||= hasOutputLimitEvidence(parsed);
  }
  const failure = failures.at(-1);
  return {
    failurePhase: failure?.failurePhase,
    failureReasonCode: failure?.failureReasonCode,
    workspaceOutcomeObserved,
    modelOutputLimitObserved,
  };
}

function parseAdapterJson(value) {
  if (typeof value !== 'string') return undefined;
  const starts = [];
  for (let index = 0; index < value.length; index += 1) if (value[index] === '{') starts.push(index);
  for (const start of starts) {
    try {
      const parsed = JSON.parse(value.slice(start));
      return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    } catch {
      // Continue to the next possible outer object boundary.
    }
  }
  return undefined;
}

function isSafeFailureEvidence(value) {
  return (
    value.ok === false &&
    typeof value.failurePhase === 'string' &&
    failurePhases.has(value.failurePhase) &&
    typeof value.failureReasonCode === 'string' &&
    /^[A-Z][A-Z0-9_]{1,127}$/u.test(value.failureReasonCode)
  );
}

function hasOutputLimitEvidence(value) {
  return (
    Array.isArray(value.rounds) &&
    value.rounds.some((round) => Number.isInteger(round?.usage?.output_tokens) && round.usage.output_tokens >= HARNESSBENCH_MODEL_MAX_OUTPUT_TOKENS)
  );
}

function safeFailureField(error, field, fallback) {
  const value = error instanceof Error && field in error ? error[field] : undefined;
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{1,127}$/u.test(value) ? value : fallback;
}

function safeProcessMessage(value) {
  return String(value)
    .replace(/[A-Za-z]:[\\/][^\r\n]*/gu, '<absolute-path>')
    .slice(0, 500);
}
