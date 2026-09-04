import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquirePinnedUpstream,
  createRunManifest,
  ensureHttpsProviderUrl,
  loadDiagnosticProfile,
  loadProfile,
  readGitFact,
  readTaskCatalog,
  resolveEnvReference,
  selectDiagnosticTasks,
  validateCachedUpstream,
  validateTaskSupport,
  writeExclusiveJson,
} from './preflight.mjs';
import {
  classifyUpstreamTaskResult,
  readHarnessTaskResult,
  runHarnessTask,
  runWithBoundedInfrastructureRetry,
  writeHarnessConfig,
} from './harness-runner.mjs';
import { preflightGrader, preflightModel, summarizeReasoningOnlyOutputLimitEvidence } from './model-evidence.mjs';
import { createEvaluationReport, normalizeTaskResult, writeEvaluationReport } from './report.mjs';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleRoot, '..', '..');

export async function runEvaluation(options = {}) {
  const profile = await loadProfile(resolve(moduleRoot, 'profiles', 'full-suite.json'));
  const outputRoot = resolve(repoRoot, 'test-output', 'harnessbench');
  const cacheRoot = options.upstreamRoot ?? resolve(outputRoot, 'cache', profile.upstreamCommit);
  const upstreamRoot =
    options.upstreamRoot === undefined
      ? acquirePinnedUpstream({ cacheRoot, remote: profile.upstreamUrl, commit: profile.upstreamCommit })
      : cacheRoot;
  validateCachedUpstream(upstreamRoot, profile.upstreamUrl, profile.upstreamCommit);
  const catalog = await readTaskCatalog(upstreamRoot);
  validateTaskSupport(profile.taskSupport, catalog);
  await validateCommittedCatalog(catalog);
  const diagnosticProfile =
    options.profileId === undefined ? undefined : await loadDiagnosticProfile(resolve(moduleRoot, 'profiles', `${options.profileId}.json`));
  if (diagnosticProfile !== undefined && diagnosticProfile.profileId !== options.profileId)
    throw new Error('diagnostic profile id does not match its selected file.');
  const diagnosticTaskIds = diagnosticProfile === undefined ? undefined : selectDiagnosticTasks(diagnosticProfile, catalog);

  const git = readGitFact(repoRoot);
  const modelId = process.env.HARNESSBENCH_MODEL_ID?.trim() || profile.modelId;
  const resumeRunRef = process.env.HARNESSBENCH_RESUME_RUN_ROOT?.trim();
  if ((options.smoke === true || diagnosticProfile !== undefined) && resumeRunRef !== undefined && resumeRunRef.length > 0) {
    throw new Error('HarnessBench nonScoring runs cannot resume a full evaluation.');
  }
  const resumeRunRoot = resumeRunRef === undefined || resumeRunRef.length === 0 ? undefined : requireResumeRunRoot(outputRoot, resumeRunRef);
  const manifest =
    resumeRunRoot === undefined
      ? createNewManifest({ profile, catalog, git, modelId, smoke: options.smoke === true, diagnosticProfile, diagnosticTaskIds })
      : await loadResumeManifest(resumeRunRoot, { profile, catalog, git, modelId });
  const runRoot = resumeRunRoot ?? resolve(outputRoot, 'runs', manifest.runId);
  const reportRoot = resolve(runRoot, 'report');
  await mkdir(runRoot, { recursive: true });
  if (resumeRunRoot === undefined) await writeExclusiveJson(resolve(runRoot, 'run-manifest.json'), manifest);

  const providerBaseUrl = ensureHttpsProviderUrl(profile.providerBaseUrlRef);
  const credential = resolveEnvReference(profile.credentialRef);
  const graderBaseUrl = ensureHttpsProviderUrl(profile.graderProviderBaseUrlRef);
  const graderCredential = resolveEnvReference(profile.graderCredentialRef);
  const pythonCommand = process.env.HARNESSBENCH_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3');
  const python = await resolvePythonExecutable(pythonCommand);
  await runModelPreflight({ python, upstreamRoot, providerBaseUrl, credential, modelId });
  const pythonToolchain = await prepareHarnessPythonToolchain({ pythonExecutable: python, runRoot });
  await preflightGrader({ baseUrl: graderBaseUrl, credential: graderCredential, modelId: profile.graderModelId, timeoutMs: 60_000 });

  const candidateTemplate = process.env.HARNESSBENCH_CANDIDATE_TEMPLATE
    ? resolve(process.env.HARNESSBENCH_CANDIDATE_TEMPLATE)
    : await prepareCandidateTemplate(runRoot, manifest.runId);
  if (!existsSync(resolve(candidateTemplate, 'candidate-manifest.json'))) throw new Error('Candidate template is missing candidate-manifest.json.');

  const harnessConfigPath = resolve(runRoot, 'harness.json');
  const appConfigPath = resolve(runRoot, 'app.json');
  await writeHarnessConfig(harnessConfigPath, {
    command: process.execPath,
    cliPath: resolve(moduleRoot, 'nextagent-cli.mjs'),
    modelId,
    taskTimeoutSeconds: profile.taskTimeoutSeconds,
    terminalTimeoutSeconds: profile.terminalTimeoutSeconds,
    candidateTemplate,
    runRoot,
  });
  await writeFile(
    appConfigPath,
    `${JSON.stringify(
      {
        data_dir: resolve(runRoot, 'harness-data'),
        tasks_dir: resolve(upstreamRoot, 'tasks'),
        results_dir: resolve(runRoot, 'upstream-results'),
        work_root: resolve(runRoot, 'upstream-workspaces'),
        default_timeout_sec: profile.taskTimeoutSeconds,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const results = resumeRunRoot === undefined ? [] : await readCompletedPrefix(manifest, resolve(runRoot, 'upstream-results'), runRoot);
  const attemptLedgerPath = resolve(runRoot, 'attempt-ledger.json');
  const attemptLedger = existsSync(attemptLedgerPath) ? JSON.parse(await readFile(attemptLedgerPath, 'utf8')) : {};
  let interrupted = false;
  const abort = new AbortController();
  const interrupt = () => {
    interrupted = true;
    abort.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    for (const task of manifest.tasks.slice(results.length)) {
      if (interrupted) break;
      if (task.supportStatus === 'unsupported') {
        results.push(normalizeTaskResult(task));
      } else {
        let classified;
        try {
          const upstream = await runWithBoundedInfrastructureRetry({
            taskId: task.taskId,
            runAttempt: async () =>
              runHarnessTask({
                python,
                upstreamRoot,
                configPath: harnessConfigPath,
                resultRoot: resolve(runRoot, 'upstream-results'),
                taskId: task.taskId,
                signal: abort.signal,
                env: buildHarnessTaskEnvironment({
                  upstreamRoot,
                  pythonCommandRoot: pythonToolchain?.commandRoot,
                  pythonHome: pythonToolchain?.pythonHome,
                  appConfigPath,
                  providerBaseUrl,
                  credential,
                  modelId,
                  graderBaseUrl,
                  graderCredential,
                  graderModelId: profile.graderModelId,
                }),
              }),
            writeLedger: async (attempts) => {
              attemptLedger[task.taskId] = attempts;
              await writeFile(attemptLedgerPath, `${JSON.stringify(attemptLedger, null, 2)}\n`, 'utf8');
            },
          });
          classified = classifyUpstreamTaskResult(upstream, {
            modelReasoningOnlyOutputLimitObserved: await observeReasoningOnlyOutputLimit(runRoot, upstream),
          });
        } catch (error) {
          classified = {
            taskId: task.taskId,
            terminalStatus: abort.signal.aborted ? 'timed_out' : 'agent_failed',
            taskScore: 0,
            reason: 'task execution failed',
            failurePhase: error?.failurePhase ?? 'harness_process',
            failureReasonCode: error?.failureReasonCode ?? safeErrorType(error),
          };
        }
        results.push(normalizeTaskResult(task, classified));
      }
      if (results.length < manifest.tasks.length) {
        await writePartialReport(manifest, results, reportRoot, options.smoke === true || diagnosticProfile !== undefined);
      }
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }

  const completedTasks = manifest.tasks.map((task, index) => results[index] ?? normalizeTaskResult(task));
  const report = createEvaluationReport(manifest, completedTasks, {
    nonScoring: options.smoke === true || diagnosticProfile !== undefined,
    ...(interrupted ? { scoreUnavailableReason: 'evaluation interrupted' } : {}),
    evidenceRefs: ['run-manifest.json', 'upstream-results'],
  });
  const paths = await writeEvaluationReport(reportRoot, report);
  return { report, paths };
}

async function writePartialReport(manifest, results, reportRoot, nonScoring) {
  const tasks = manifest.tasks.map((task, index) => results[index] ?? normalizeTaskResult(task));
  const report = createEvaluationReport(manifest, tasks, {
    nonScoring,
    scoreUnavailableReason: 'evaluation in progress',
    evidenceRefs: ['run-manifest.json'],
  });
  await writeEvaluationReport(reportRoot, report, { baseName: 'partial-report' });
}

async function prepareCandidateTemplate(runRoot, runId) {
  const candidateId = `harnessbench-${runId}`;
  const stagingRoot = resolve(runRoot, 'candidate-pack-staging');
  const archivePath = resolve(repoRoot, `${candidateId}-${process.platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`);
  await runProcess(
    process.execPath,
    [resolve(repoRoot, 'scripts', 'pack-local-runtime.mjs'), stagingRoot, candidateId, '1.0.0', 'backend-only', 'skip', '--stage-default-agent'],
    { cwd: repoRoot, env: process.env },
  );
  if (!existsSync(archivePath)) throw new Error('NextAgent backend candidate archive was not produced.');
  const templateRoot = resolve(runRoot, 'candidate-template');
  await mkdir(templateRoot, { recursive: true });
  try {
    if (process.platform === 'win32') {
      await runProcess(
        'powershell',
        ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:HARNESSBENCH_ARCHIVE -DestinationPath $env:HARNESSBENCH_TEMPLATE -Force'],
        {
          cwd: repoRoot,
          env: { ...process.env, HARNESSBENCH_ARCHIVE: archivePath, HARNESSBENCH_TEMPLATE: templateRoot },
        },
      );
    } else {
      await runProcess('tar', ['-xzf', archivePath, '-C', templateRoot], { cwd: repoRoot, env: process.env });
    }
  } finally {
    await rm(archivePath, { force: true });
  }
  return templateRoot;
}

async function runModelPreflight({ python, upstreamRoot, providerBaseUrl, credential, modelId }) {
  const child = spawn(python, [resolve(moduleRoot, 'model-preflight.py'), upstreamRoot, providerBaseUrl, modelId], {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitPromise = new Promise((resolveCode, reject) => {
    child.once('error', reject);
    child.once('close', resolveCode);
  });
  let preflightError;
  try {
    const line = await firstOutputLine(child, 30_000);
    const ready = JSON.parse(line);
    await preflightModel({ proxyBaseUrl: ready.proxyBaseUrl, credential, modelId, timeoutMs: 60_000 });
  } catch (error) {
    preflightError = error;
  } finally {
    child.stdin.end('\n');
  }
  const code = await exitPromise;
  if (preflightError !== undefined) throw preflightError;
  if (code !== 0) throw new Error(`HarnessBench model preflight proxy failed: ${sanitizeProcessOutput(stderr)}`);
}

function firstOutputLine(child, timeoutMs) {
  return new Promise((resolveLine, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('HarnessBench model preflight proxy did not become ready.')), timeoutMs);
    const onData = (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolveLine(output.slice(0, newline));
    };
    child.stdout.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (output.indexOf('\n') < 0) {
        clearTimeout(timer);
        reject(new Error(`HarnessBench model preflight proxy exited before readiness (${code}).`));
      }
    });
  });
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
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`process failed (${command}, exit ${code}): ${sanitizeProcessOutput(stderr || stdout)}`));
    });
  });
}

async function validateCommittedCatalog(catalog) {
  const committed = JSON.parse(await readFile(resolve(moduleRoot, 'fixtures', 'task-catalog.json'), 'utf8'));
  if (JSON.stringify(committed) !== JSON.stringify(catalog))
    throw new Error('Pinned HarnessBench catalog differs from the committed 106-task fixture.');
}

function smokeManifest(manifest) {
  const tasks = manifest.tasks.filter((task) => task.taskId === '001-file' || task.taskId === '002-exec');
  return Object.freeze({ ...manifest, runId: `${manifest.runId}-smoke`, benchmarkTaskCount: tasks.length, tasks: Object.freeze(tasks) });
}

function createNewManifest({ profile, catalog, git, modelId, smoke, diagnosticProfile, diagnosticTaskIds }) {
  const manifest = createRunManifest({
    profile,
    catalog,
    nextAgentCommit: git.commit,
    nextAgentDirty: git.dirty,
    modelId,
    runId: createRunId(),
  });
  if (smoke) return smokeManifest(manifest);
  if (diagnosticProfile !== undefined) return subsetManifest(manifest, diagnosticProfile.profileId, diagnosticTaskIds);
  return manifest;
}

function subsetManifest(manifest, profileId, taskIds) {
  const selected = new Set(taskIds);
  const tasks = manifest.tasks.filter((task) => selected.has(task.taskId));
  return Object.freeze({
    ...manifest,
    runId: `${manifest.runId}-${profileId}`,
    profileId,
    benchmarkTaskCount: tasks.length,
    tasks: Object.freeze(tasks),
  });
}

function requireResumeRunRoot(outputRoot, value) {
  const runsRoot = resolve(outputRoot, 'runs');
  const candidate = resolve(value);
  const rel = relative(runsRoot, candidate);
  const outside = rel.length === 0 || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel);
  if (outside) throw new Error('HarnessBench resume run must be an existing child of test-output/harnessbench/runs.');
  return candidate;
}

async function loadResumeManifest(runRoot, expected) {
  const manifest = JSON.parse(await readFile(resolve(runRoot, 'run-manifest.json'), 'utf8'));
  const expectedManifest = createRunManifest({
    profile: expected.profile,
    catalog: expected.catalog,
    nextAgentCommit: expected.git.commit,
    nextAgentDirty: manifest.nextAgentDirty,
    modelId: expected.modelId,
    runId: manifest.runId,
    startedAt: manifest.startedAt,
  });
  if (basename(runRoot) !== manifest.runId || JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
    throw new Error('HarnessBench resume manifest does not match the current fixed evaluation inputs.');
  }
  return manifest;
}

export async function readCompletedPrefix(manifest, resultRoot, runRoot) {
  const results = [];
  for (const task of manifest.tasks) {
    if (task.supportStatus === 'unsupported') {
      results.push(normalizeTaskResult(task));
      continue;
    }
    const raw = await readHarnessTaskResult(resultRoot, task.taskId);
    if (raw === undefined) break;
    results.push(
      normalizeTaskResult(
        task,
        classifyUpstreamTaskResult(
          {
            ...raw,
            ok: raw.adapter_result?.ok === true,
          },
          {
            modelReasoningOnlyOutputLimitObserved: runRoot === undefined ? false : await observeReasoningOnlyOutputLimit(runRoot, raw),
          },
        ),
      ),
    );
  }
  return results;
}

async function observeReasoningOnlyOutputLimit(runRoot, upstream) {
  return summarizeReasoningOnlyOutputLimitEvidence({
    runRoot,
    usageLogFile: upstream?.usage_summary?.log_file,
  });
}

export function buildHarnessTaskEnvironment({
  baseEnvironment = process.env,
  upstreamRoot,
  pythonCommandRoot,
  pythonHome,
  appConfigPath,
  providerBaseUrl,
  credential,
  modelId,
  graderBaseUrl,
  graderCredential,
  graderModelId,
}) {
  const environment =
    pythonCommandRoot === undefined ? { ...baseEnvironment } : withPrependedPath(baseEnvironment, pythonCommandRoot, process.platform);
  return {
    ...environment,
    PYTHONPATH: resolve(upstreamRoot, 'src'),
    ...(pythonHome === undefined ? {} : { PYTHONHOME: pythonHome }),
    HARNESSBENCH_APP_CONFIG: appConfigPath,
    HARNESSBENCH_PROVIDER_BASE_URL: providerBaseUrl,
    HARNESSBENCH_API_KEY: credential,
    HARNESSBENCH_MODEL_ID: modelId,
    HARNESSBENCH_PUBLIC_URL_TEMPLATE: '{local_url}',
    RUBRIC_BASE_URL: graderBaseUrl,
    RUBRIC_API_KEY: graderCredential,
    RUBRIC_MODEL: graderModelId,
  };
}

export async function resolvePythonExecutable(pythonCommand) {
  const result = await runProcess(pythonCommand, ['-c', 'import json, os, sys; print(json.dumps(os.path.realpath(sys.executable)))'], {
    cwd: repoRoot,
    env: process.env,
  });
  let pythonExecutable;
  try {
    pythonExecutable = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error('HarnessBench Python executable identity is invalid.');
  }
  validatePythonExecutable(pythonExecutable, process.platform);
  return pythonExecutable;
}

export async function prepareHarnessPythonToolchain({ pythonExecutable, runRoot, baseEnvironment = process.env, platform = process.platform }) {
  if (platform !== 'win32') return undefined;
  validatePythonExecutable(pythonExecutable, platform);
  const commandRoot = resolve(runRoot, 'harness-toolchain');
  await rm(commandRoot, { recursive: true, force: true });
  await mkdir(commandRoot, { recursive: true });
  const commandPath = resolve(commandRoot, 'python3.exe');
  await rm(commandPath, { force: true });
  await copyFile(pythonExecutable, commandPath);
  const runtimeFiles = await readdir(dirname(pythonExecutable), { withFileTypes: true });
  await Promise.all(
    runtimeFiles
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dll'))
      .map((entry) => copyFile(resolve(dirname(pythonExecutable), entry.name), resolve(commandRoot, entry.name))),
  );

  const identityScript =
    'import json, os, sys; print(json.dumps({"basePrefix": os.path.normcase(os.path.realpath(sys.base_prefix)), "implementation": sys.implementation.name, "prefix": os.path.normcase(os.path.realpath(sys.prefix)), "version": list(sys.version_info[:3])}, sort_keys=True))';
  const expectedIdentity = await runProcess(pythonExecutable, ['-c', identityScript], { cwd: repoRoot, env: baseEnvironment });
  const expected = parsePythonIdentity(expectedIdentity.stdout, 'HarnessBench preflighted Python identity is invalid.');
  const probeEnvironment = {
    ...withPrependedPath(baseEnvironment, commandRoot, platform),
    PYTHONHOME: expected.prefix,
  };
  const probe = await runProcess(
    pythonExecutable,
    [
      '-c',
      `import subprocess; result = subprocess.run(["python3", "-c", ${JSON.stringify(identityScript)}], check=True, capture_output=True, text=True); print(result.stdout.strip())`,
    ],
    { cwd: repoRoot, env: probeEnvironment },
  );
  const actual = parsePythonIdentity(probe.stdout, 'HarnessBench python3 command identity is invalid.');
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('HarnessBench python3 command does not use the preflighted interpreter.');
  }
  return { commandRoot, pythonHome: expected.prefix };
}

function parsePythonIdentity(value, errorMessage) {
  let identity;
  try {
    identity = JSON.parse(value.trim());
  } catch {
    throw new Error(errorMessage);
  }
  if (
    typeof identity !== 'object' ||
    identity === null ||
    typeof identity.basePrefix !== 'string' ||
    typeof identity.implementation !== 'string' ||
    typeof identity.prefix !== 'string' ||
    !Array.isArray(identity.version) ||
    identity.version.length !== 3 ||
    identity.version.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    throw new Error(errorMessage);
  }
  return identity;
}

function validatePythonExecutable(pythonExecutable, platform) {
  if (typeof pythonExecutable !== 'string') {
    throw new Error('HarnessBench Python executable must be an absolute path.');
  }
  const absolute = platform === 'win32' ? win32.isAbsolute(pythonExecutable) : isAbsolute(pythonExecutable);
  if (!absolute) {
    throw new Error('HarnessBench Python executable must be an absolute path.');
  }
  if (/["\r\n]/u.test(pythonExecutable)) throw new Error('HarnessBench Python executable contains unsafe characters.');
}

function withPrependedPath(baseEnvironment, commandRoot, platform) {
  const environment = { ...baseEnvironment };
  const pathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path');
  const pathKey = pathKeys[0] ?? (platform === 'win32' ? 'Path' : 'PATH');
  const currentPath = pathKeys.map((key) => environment[key]).find((value) => typeof value === 'string') ?? '';
  for (const key of pathKeys) delete environment[key];
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  environment[pathKey] = currentPath.length === 0 ? commandRoot : `${commandRoot}${pathDelimiter}${currentPath}`;
  return environment;
}

function createRunId() {
  return `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
}

function safeErrorType(error) {
  return error instanceof Error ? error.name : 'unknown execution error';
}

function sanitizeProcessOutput(value) {
  return String(value)
    .replace(/[A-Za-z]:[\\/][^\r\n]*/gu, '<absolute-path>')
    .slice(0, 500);
}

function help() {
  return [
    'Usage: node tests/harnessbench/run.mjs [--smoke | --profile <name>] [--upstream-root <path>]',
    '',
    'No arguments runs the fixed 106-task full suite and may publish frameworkEffectScore.',
    '--smoke runs only 001-file and 002-exec as nonScoring and never publishes frameworkEffectScore.',
    '--profile runs a committed *-regression profile as nonScoring and never publishes frameworkEffectScore.',
  ].join('\n');
}

function parseArgs(args) {
  const options = { smoke: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--smoke') options.smoke = true;
    else if (args[index] === '--profile') {
      const profileId = args[++index];
      if (profileId === undefined) throw new Error('--profile requires a profile name.');
      options.profileId = profileId;
    } else if (args[index] === '--upstream-root') options.upstreamRoot = resolve(args[++index] ?? '');
    else if (args[index] === '--help' || args[index] === '-h') options.help = true;
    else throw new Error(`unknown argument: ${args[index]}`);
  }
  if (options.smoke === true && options.profileId !== undefined) throw new Error('--smoke and --profile are mutually exclusive.');
  if (options.profileId !== undefined && !/^[a-z][a-z0-9-]*-regression$/u.test(options.profileId)) throw new Error('profile name is invalid.');
  return options;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${help()}\n`);
    else {
      const result = await runEvaluation(options);
      process.stdout.write(
        `${JSON.stringify(
          {
            frameworkEffectScore: result.report.frameworkEffectScore,
            nonScoring: result.report.nonScoring ?? false,
            benchmarkTaskCount: result.report.benchmarkTaskCount,
            report: relative(repoRoot, result.paths.jsonPath).replaceAll('\\', '/'),
          },
          null,
          2,
        )}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
