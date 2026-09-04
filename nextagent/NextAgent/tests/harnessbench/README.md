# NextAgent HarnessBench evaluation

This directory owns an on-demand, black-box HarnessBench evaluation. It does not change `packages/**`, product defaults, public contracts, or release qualification gates.

## What the standard entry does

```powershell
node tests/harnessbench/run.mjs
```

The no-argument command pins HarnessBench to commit `1025086a446653702b80cfb48babbeec35db6b2c`, validates its complete 106-task catalog, builds the current NextAgent backend candidate, and separately preflights the candidate model and the explicitly configured HarnessBench grader before evaluating any task in `profiles/full-suite.json`.

Tasks marked `unsupported` and task-level execution, model-evidence, timeout, or grading failures remain in the `benchmarkTaskCount` (total catalog size) but are excluded from the scoring denominator. Only tasks with status `execute` count toward `scoringDenominator`. A complete run publishes:

```text
frameworkEffectScore = round(sum(taskScore) / scoringDenominator, 4)
```

Reports are written below `test-output/harnessbench/runs/<runId>/report/` as `report.json` and `report.md`. The manifest remains schema version 2. Report schema version 5 retains explicit grader identity, `gradingCoverage`, multi-round safe failure evidence, `modelOutputLimitObserved`, and two score summaries with explicit populations, and adds `modelReasoningOnlyOutputLimitObserved` plus its diagnostics count. The latter is true only when safe run-local usage-proxy evidence proves a length terminal with no visible content or Tool call and positive completion tokens entirely attributed to reasoning. Both observations are diagnostic only: they never override the task terminal status, failure reason, retry eligibility, or score. Every complete scoring run publishes `frameworkEffectScore`; incomplete rubric/process coverage is marked `degraded` and includes `coverageGap`. An interrupted run is `invalid` and writes `partial-report.json` and `partial-report.md` without a score summary or total score.

Failed tasks retain the official zero-score semantics and add safe diagnostics: `failurePhase`, `failureReasonCode`, model-request evidence, workspace-outcome evidence, and run-relative refs. When the runtime closes a non-terminal SSE subscriber after its specified five-minute idle window, the adapter resumes the same accepted run from the highest accepted timeline sequence without resubmitting the request or resetting the terminal deadline. A process-start failure with no task execution evidence may be retried once; terminal, model, workspace, and grading failures are never automatically retried. Attempts are recorded in `attempt-ledger.json`.

If infrastructure interrupts a full run after results have been written, resume the same immutable run instead of starting over:

```powershell
$env:HARNESSBENCH_RESUME_RUN_ROOT = 'test-output/harnessbench/runs/<runId>'
node tests/harnessbench/run.mjs
```

The runner validates the existing manifest against the current pinned commit, catalog, profile, model, and run path, reconstructs only the contiguous completed task prefix from raw upstream results, and continues the remaining tasks. Resume is unavailable for `--smoke`; clear `HARNESSBENCH_RESUME_RUN_ROOT` before starting a new run.

For a multi-round HarnessBench task, every round with the same upstream session id reuses one isolated candidate data root and one persisted NextAgent session. The local runtime still starts and stops for each round; only product persistence and session identity survive between rounds. Different upstream session ids, tasks, and run roots never share this state. The candidate-local session mapping is private runner state and is removed with its owning run root; do not copy it between runs.

## Prerequisites and real model configuration

- The repository's required Node.js LTS version and installed npm dependencies.
- Git.
- Python 3.10 or newer with PyYAML.
- Real OpenAI-compatible candidate and grader providers, model ids, and credentials. They may resolve to the same service, but both configurations are explicit and independently preflighted.
- Local execution dependencies required by the selected tasks, including the configured NextAgent sandbox runtime.

Set secrets only through environment variables. Do not place credentials in the profile, task input, command line, or report.

```powershell
$env:HARNESSBENCH_PROVIDER_BASE_URL = 'https://provider.example/v1'
$env:HARNESSBENCH_API_KEY = '<secret>'
$env:HARNESSBENCH_MODEL_ID = 'provider-model-id'
$env:HARNESSBENCH_GRADER_PROVIDER_BASE_URL = 'https://grader-provider.example/v1'
$env:HARNESSBENCH_GRADER_API_KEY = '<grader-secret>'
node tests/harnessbench/run.mjs
```

`HARNESSBENCH_MODEL_ID` is optional and defaults to the non-sensitive candidate model id in `full-suite.json`. The grader model id is fixed by `graderModelId`; change it by reviewing the profile rather than relying on HarnessBench's implicit default. `HARNESSBENCH_PYTHON` may select a Python executable. `HARNESSBENCH_CANDIDATE_TEMPLATE` may point to an already staged backend-only candidate for repeated local runs; the runner still creates an isolated copy per task.

The full evaluation can take substantial time and incur significant model and rubric cost. This first version deliberately defines no release threshold or pass/fail verdict.

## Non-scoring smoke

```powershell
node tests/harnessbench/run.mjs --smoke
```

Smoke runs only `001-file` and `002-exec` with the real model and real product boundary. Its report is marked `nonScoring` and never contains `frameworkEffectScore`; it cannot be presented as the framework's HarnessBench score.

## Non-scoring regression profiles

Use a committed diagnostic profile to reproduce a focused failure class without running all 106 tasks:

```powershell
node tests/harnessbench/run.mjs --profile grading-regression
node tests/harnessbench/run.mjs --profile terminal-failure-regression
node tests/harnessbench/run.mjs --profile sandbox-regression
node tests/harnessbench/run.mjs --profile infrastructure-regression
node tests/harnessbench/run.mjs --profile failure-recovery-regression
node tests/harnessbench/run.mjs --profile stream-failure-regression
```

Every regression profile is fixed, validates its task ids against the full catalog, and is always `nonScoring`. `failure-recovery-regression` covers the representative multi-round diagnostic, local helper-service, and output-limit cases from the August 12 full run. `stream-failure-regression` fixes the eight tasks that reached the stream-wait failure phase in the August 17 full run so their new safe reason codes can be compared without presenting the result as FES. Regression profiles cannot publish `frameworkEffectScore` or score summaries and cannot be resumed as a full evaluation.

## Updating the pinned suite

1. Review the upstream commit and its scoring/schema changes.
2. Update the pinned commit in `profiles/full-suite.json` and `preflight.mjs`.
3. Regenerate `fixtures/task-catalog.json` from the exact upstream `tasks/*/task.yaml` catalog.
4. Review every task in `taskSupport`. Use `execute` only when the current backend candidate exposes the required real Capability and runtime dependency. Otherwise use `{ "status": "unsupported", "reason": "..." }`.
5. Run `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` and review the profile diff.

The profile and catalog must match exactly. Missing, duplicate, or extra tasks fail before the first model task and produce no total score.
