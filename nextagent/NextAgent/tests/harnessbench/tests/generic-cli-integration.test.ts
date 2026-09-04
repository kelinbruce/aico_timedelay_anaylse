import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildHarnessConfig,
  classifyUpstreamTaskResult,
  mergeHarnessTaskResult,
  readHarnessTaskResult,
  resolveHarnessTaskProcessResult,
  runWithBoundedInfrastructureRetry,
} from '../harness-runner.mjs';
import { normalizeTaskResult } from '../report.mjs';
import { readCompletedPrefix } from '../run.mjs';

describe('HarnessBench generic_cli integration', () => {
  it('maps the generic CLI placeholders to the NextAgent bridge', () => {
    const config = buildHarnessConfig({
      command: 'node',
      cliPath: 'tests/harnessbench/nextagent-cli.mjs',
      modelId: 'model',
      taskTimeoutSeconds: 1200,
      terminalTimeoutSeconds: 1080,
    });
    expect(config.models.nextagent.adapter).toBe('generic_cli');
    expect(config.models.nextagent.args).toEqual(expect.arrayContaining(['{workspace}', '{prompt_file}', '{session_id}', '--model-id', 'model']));
    expect(config.models.nextagent.args).not.toContain('{model_id}');
    expect(config.models.nextagent.use_usage_proxy).toBe(true);
  });

  it('uses a valid upstream result even when the process summary is invalid or the process exits nonzero', () => {
    const raw = { task_id: '001-file', adapter_result: { ok: true }, scoring: { combined_score: 1 } };
    expect(resolveHarnessTaskProcessResult({ exitCode: 0, stdout: 'not json', stderr: '' }, raw)).toMatchObject(raw);
    expect(resolveHarnessTaskProcessResult({ exitCode: 1, stdout: '', stderr: 'private failure' }, raw)).toMatchObject(raw);
  });

  it.each([
    [{ exitCode: 1, stdout: '', stderr: 'private failure' }, 'PROCESS_NONZERO_EXIT'],
    [{ exitCode: 0, stdout: 'not json', stderr: '' }, 'RESULT_SUMMARY_INVALID'],
    [{ exitCode: 0, stdout: '{"ok":true}', stderr: '' }, 'RESULT_JSON_MISSING'],
    [
      {
        exitCode: 1,
        stdout: '{"ok":false,"failurePhase":"harness_process","failureReasonCode":"PROCESS_TIMEOUT"}',
        stderr: '',
      },
      'PROCESS_TIMEOUT',
    ],
  ])('classifies a process without an upstream result as %s', (processResult, failureReasonCode) => {
    expect(() => resolveHarnessTaskProcessResult(processResult, undefined)).toThrowError(
      expect.objectContaining({ failurePhase: 'harness_process', failureReasonCode }),
    );
  });

  it('does not accept a CLI terminal envelope as an upstream result or expose process output', () => {
    const processResult = {
      exitCode: 0,
      stdout: '{"ok":false,"failurePhase":"terminal","failureReasonCode":"MODEL_TIMEOUT"}',
      stderr: 'D:\\private\\secret failure',
    };

    expect(() => resolveHarnessTaskProcessResult(processResult, undefined)).toThrowError(
      expect.objectContaining({
        failurePhase: 'harness_process',
        failureReasonCode: 'RESULT_JSON_MISSING',
        message: 'HarnessBench result is missing.',
      }),
    );
  });

  it('classifies an invalid upstream result without exposing its content', async () => {
    const resultRoot = await mkdtemp(join(tmpdir(), 'nextagent-harness-invalid-result-'));
    await writeFile(join(resultRoot, '001-file.json'), '{private invalid json', 'utf8');

    await expect(readHarnessTaskResult(resultRoot, '001-file')).rejects.toMatchObject({
      message: 'HarnessBench result JSON is invalid.',
      failurePhase: 'harness_process',
      failureReasonCode: 'RESULT_JSON_INVALID',
    });
  });

  it('keeps missing usage evidence as a zero-score terminal result', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '001-file',
        ok: true,
        usage_summary: { available: false },
        scoring: { combined_score: 1 },
      }),
    ).toMatchObject({ terminalStatus: 'model_evidence_missing', taskScore: 0 });
  });

  it('classifies a bridge timeout as the dedicated zero-score terminal state', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '001-file',
        ok: false,
        adapter_result: { stderr: 'NextAgent request ended with timed_out.' },
        usage_summary: { available: true, request_count: 1, total_tokens: 10 },
        scoring: {},
      }),
    ).toMatchObject({ terminalStatus: 'timed_out', taskScore: 0, reason: 'task timeout' });
  });

  it('preserves structured terminal failure evidence from the adapter result', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '001-file',
        ok: false,
        adapter_result: {
          stdout: '{"ok":false,"failurePhase":"terminal","failureReasonCode":"SANDBOX_UNAVAILABLE","workspaceOutcomeObserved":true}',
        },
        usage_summary: { available: true, request_count: 2, total_tokens: 10 },
        scoring: { combined_score: 0.8 },
      }),
    ).toMatchObject({
      terminalStatus: 'agent_failed',
      failurePhase: 'terminal',
      failureReasonCode: 'SANDBOX_UNAVAILABLE',
      modelRequestsObserved: true,
      workspaceOutcomeObserved: true,
    });
  });

  it('uses the last structured failure across adapter rounds and preserves any workspace observation', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '007-session-memory',
        ok: false,
        adapter_results: [
          { stdout: '{"terminalStatus":"completed","workspaceOutcomeObserved":true}' },
          { stdout: '{"ok":false,"failurePhase":"terminal","failureReasonCode":"MODEL_TIMEOUT","workspaceOutcomeObserved":false}' },
          { stdout: '{"ok":false,"failurePhase":"stream_wait","failureReasonCode":"STREAM_WAIT_FAILED","workspaceOutcomeObserved":false}' },
        ],
        adapter_result: { stdout: '{"rounds":[],"summary":"no structured failure fields"}' },
        usage_summary: { available: true, request_count: 2, total_tokens: 10 },
        scoring: { combined_score: 0.2 },
      }),
    ).toMatchObject({
      terminalStatus: 'agent_failed',
      failurePhase: 'stream_wait',
      failureReasonCode: 'STREAM_WAIT_FAILED',
      workspaceOutcomeObserved: true,
    });
  });

  it('keeps all upstream adapter rounds when merging a fresh HarnessBench task result', () => {
    const adapterResults = [{ stdout: '{"ok":true}' }, { stdout: '{"ok":false}' }];
    expect(
      mergeHarnessTaskResult({ task_id: '007-session-memory' }, { adapter_result: adapterResults[1], adapter_results: adapterResults }),
    ).toMatchObject({ adapter_result: adapterResults[1], adapter_results: adapterResults });
  });

  it('keeps the upstream result authoritative over an optional process summary', () => {
    expect(
      mergeHarnessTaskResult(
        { task_id: 'wrong-task', scoring: { combined_score: 0 } },
        { task_id: '001-file', scoring: { combined_score: 1 }, adapter_result: { ok: true } },
      ),
    ).toMatchObject({ task_id: '001-file', scoring: { combined_score: 1 }, ok: true });
  });

  it('falls back safely when adapter output has no valid structured failure evidence', () => {
    const classified = classifyUpstreamTaskResult({
      task_id: '001-file',
      ok: false,
      adapter_results: [
        { stdout: 'unstructured provider failure details' },
        { stdout: '{"ok":false,"failurePhase":"invalid_phase","failureReasonCode":"unsafe-reason"}' },
      ],
      usage_summary: { available: false },
      scoring: {},
    });
    const normalized = normalizeTaskResult({ taskId: '001-file', supportStatus: 'execute' }, classified);

    expect(normalized).toMatchObject({ failurePhase: 'harness_process', failureReasonCode: 'UNKNOWN' });
    expect(JSON.stringify(normalized)).not.toContain('provider failure details');
  });

  it('records output-limit evidence without overriding failure classification', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '091-financial-close-reconciliation',
        ok: false,
        adapter_results: [{ stdout: '{"ok":false,"failurePhase":"terminal","failureReasonCode":"MODEL_TIMEOUT","workspaceOutcomeObserved":false}' }],
        adapter_result: { stdout: '{"rounds":[{"usage":{"output_tokens":16384}}]}' },
        usage_summary: { available: true, request_count: 1, total_tokens: 16384 },
        scoring: { combined_score: 0.4 },
      }),
    ).toMatchObject({
      terminalStatus: 'agent_failed',
      taskScore: 0,
      failurePhase: 'terminal',
      failureReasonCode: 'MODEL_TIMEOUT',
      modelOutputLimitObserved: true,
    });
  });

  it('keeps successful tasks scored when an earlier model round reaches the output limit', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '001-file',
        ok: true,
        adapter_result: { stdout: '{"rounds":[{"usage":{"output_tokens":16384}},{"usage":{"output_tokens":128}}]}' },
        usage_summary: { available: true, request_count: 2, total_tokens: 16512 },
        scoring: { outcome_score: 1, process_score: 1, security_score: 1, combined_score: 1 },
      }),
    ).toMatchObject({ terminalStatus: 'scored', taskScore: 1, modelOutputLimitObserved: true });
  });

  it('accepts only the sanitized reasoning-only output-limit observation without changing terminal classification', () => {
    expect(
      classifyUpstreamTaskResult(
        {
          task_id: '001-file',
          ok: false,
          adapter_result: { stderr: 'NextAgent request ended with timed_out.' },
          usage_summary: { available: true, request_count: 1, total_tokens: 16_384 },
          scoring: {},
        },
        { modelReasoningOnlyOutputLimitObserved: true },
      ),
    ).toMatchObject({
      terminalStatus: 'timed_out',
      failurePhase: undefined,
      modelReasoningOnlyOutputLimitObserved: true,
      taskScore: 0,
    });
  });

  it('does not infer output-limit evidence from missing or below-limit usage', () => {
    expect(
      classifyUpstreamTaskResult({
        task_id: '001-file',
        ok: false,
        adapter_result: { stdout: '{"rounds":[{"usage":{"output_tokens":16383}},{"usage":{}}]}' },
        usage_summary: { available: true, request_count: 1, total_tokens: 16383 },
        scoring: {},
      }),
    ).toMatchObject({ terminalStatus: 'agent_failed', modelOutputLimitObserved: false });
  });

  it('retries only a retry-safe HarnessBench process start failure once', async () => {
    let attempts = 0;
    const ledgers: unknown[] = [];
    const result = await runWithBoundedInfrastructureRetry({
      taskId: '001-file',
      runAttempt: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('spawn failed'), {
            retrySafe: true,
            failurePhase: 'harness_process',
            failureReasonCode: 'PROCESS_START_FAILED',
          });
        }
        return { ok: true };
      },
      writeLedger: async (ledger: unknown[]) => {
        ledgers.push(ledger);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(ledgers).toHaveLength(2);
  });

  it('does not retry after a model request or terminal evidence exists', async () => {
    let attempts = 0;
    await expect(
      runWithBoundedInfrastructureRetry({
        taskId: '001-file',
        runAttempt: async () => {
          attempts += 1;
          throw Object.assign(new Error('terminal failed'), {
            retrySafe: false,
            failurePhase: 'terminal',
            failureReasonCode: 'UNKNOWN',
            requestCount: 1,
          });
        },
        writeLedger: async () => undefined,
      }),
    ).rejects.toThrow(/terminal failed/u);
    expect(attempts).toBe(1);
  });

  it('recovers only the contiguous completed prefix from fixed upstream results', async () => {
    const runRoot = await mkdtemp(join(tmpdir(), 'nextagent-harness-resume-'));
    const resultRoot = join(runRoot, 'upstream-results');
    const nested = join(resultRoot, 'nextagent', 'model');
    const usageRoot = join(runRoot, 'upstream-workspaces', 'nextagent', 'model', '001-file', 'usage-proxy');
    const responseRoot = join(usageRoot, 'responses');
    await mkdir(nested, { recursive: true });
    await mkdir(responseRoot, { recursive: true });
    const responsePath = join(responseRoot, '0001.json');
    const usageLogPath = join(usageRoot, 'requests.jsonl');
    await writeFile(
      responsePath,
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '', tool_calls: [] } }],
        usage: { completion_tokens: 16_384, completion_tokens_details: { reasoning_tokens: 16_384 } },
      }),
      'utf8',
    );
    await writeFile(usageLogPath, `${JSON.stringify({ status: 200, raw_response_file: responsePath })}\n`, 'utf8');
    await writeFile(
      join(nested, '001-file.json'),
      JSON.stringify({
        task_id: '001-file',
        adapter_result: { ok: true },
        usage_summary: { available: true, request_count: 1, total_tokens: 16_384, log_file: usageLogPath },
        scoring: { outcome_score: 1, process_score: 1, security_score: 1, combined_score: 1 },
        elapsed_sec: 1,
      }),
      'utf8',
    );
    const manifest = {
      benchmarkTaskCount: 3,
      tasks: [
        { taskId: '001-file', supportStatus: 'execute' },
        { taskId: '002-unsupported', supportStatus: 'unsupported', reason: 'missing capability' },
        { taskId: '003-pending', supportStatus: 'execute' },
      ],
    };

    await expect(readCompletedPrefix(manifest, resultRoot, runRoot)).resolves.toMatchObject([
      { taskId: '001-file', terminalStatus: 'scored', taskScore: 1, modelReasoningOnlyOutputLimitObserved: true },
      { taskId: '002-unsupported', terminalStatus: 'unsupported', taskScore: 0 },
    ]);
  });
});
