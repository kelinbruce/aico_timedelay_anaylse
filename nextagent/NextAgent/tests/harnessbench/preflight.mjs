import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const DEFAULT_HARNESSBENCH_REMOTE = 'https://github.com/Qihoo360/harness-bench.git';
export const DEFAULT_HARNESSBENCH_COMMIT = '1025086a446653702b80cfb48babbeec35db6b2c';
export const HARNESSBENCH_RESULT_COLLECTION_GRACE_SECONDS = 120;

const profileFields = new Set([
  'profileId',
  'upstreamUrl',
  'upstreamCommit',
  'taskSupport',
  'modelId',
  'providerBaseUrlRef',
  'credentialRef',
  'graderModelId',
  'graderProviderBaseUrlRef',
  'graderCredentialRef',
  'taskTimeoutSeconds',
  'terminalTimeoutSeconds',
]);
const diagnosticProfileFields = new Set(['profileId', 'nonScoring', 'taskIds']);

export async function loadProfile(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  assertRecord(value, 'profile');
  for (const field of Object.keys(value)) {
    if (!profileFields.has(field)) throw new Error(`profile contains unknown field: ${field}`);
  }
  if (value.profileId !== 'full-suite') throw new Error('profileId must be full-suite.');
  if (value.upstreamUrl !== DEFAULT_HARNESSBENCH_REMOTE) throw new Error('upstreamUrl must be the official HarnessBench HTTPS remote.');
  if (!/^[0-9a-f]{40}$/u.test(value.upstreamCommit)) throw new Error('upstreamCommit must be a full lowercase Git commit.');
  assertRecord(value.taskSupport, 'taskSupport');
  assertNonEmpty(value.modelId, 'modelId');
  assertEnvRef(value.providerBaseUrlRef, 'providerBaseUrlRef');
  assertEnvRef(value.credentialRef, 'credentialRef');
  assertNonEmpty(value.graderModelId, 'graderModelId');
  assertEnvRef(value.graderProviderBaseUrlRef, 'graderProviderBaseUrlRef');
  assertEnvRef(value.graderCredentialRef, 'graderCredentialRef');
  if (!Number.isInteger(value.taskTimeoutSeconds) || value.taskTimeoutSeconds < 1 || value.taskTimeoutSeconds > 1800) {
    throw new Error('taskTimeoutSeconds must be an integer from 1 through 1800.');
  }
  if (!Number.isInteger(value.terminalTimeoutSeconds) || value.terminalTimeoutSeconds < 1 || value.terminalTimeoutSeconds > 1800) {
    throw new Error('terminalTimeoutSeconds must be an integer from 1 through 1800.');
  }
  if (value.taskTimeoutSeconds - value.terminalTimeoutSeconds !== HARNESSBENCH_RESULT_COLLECTION_GRACE_SECONDS) {
    throw new Error('taskTimeoutSeconds must reserve exactly 120 seconds after terminalTimeoutSeconds.');
  }
  return value;
}

export async function loadDiagnosticProfile(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  assertRecord(value, 'diagnostic profile');
  for (const field of Object.keys(value)) {
    if (!diagnosticProfileFields.has(field)) throw new Error(`diagnostic profile contains unknown field: ${field}`);
  }
  if (!/^[a-z][a-z0-9-]*-regression$/u.test(value.profileId)) throw new Error('diagnostic profileId must end with -regression.');
  if (value.nonScoring !== true) throw new Error('diagnostic profile must set nonScoring to true.');
  if (
    !Array.isArray(value.taskIds) ||
    value.taskIds.length === 0 ||
    value.taskIds.some((taskId) => typeof taskId !== 'string' || taskId.length === 0)
  ) {
    throw new Error('diagnostic profile taskIds must be a non-empty string array.');
  }
  return value;
}

export function selectDiagnosticTasks(profile, catalog) {
  if (new Set(profile.taskIds).size !== profile.taskIds.length) throw new Error('diagnostic profile contains duplicate task ids.');
  const known = new Set(catalog);
  for (const taskId of profile.taskIds) if (!known.has(taskId)) throw new Error(`diagnostic profile contains unknown task: ${taskId}`);
  return [...profile.taskIds];
}

export async function readTaskCatalog(upstreamRoot) {
  const tasksRoot = resolve(upstreamRoot, 'tasks');
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const taskIds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(resolve(tasksRoot, entry.name, 'task.yaml'))) continue;
    taskIds.push(entry.name);
  }
  return taskIds.sort(taskSort);
}

export function validateTaskSupport(taskSupport, catalog) {
  assertRecord(taskSupport, 'taskSupport');
  if (new Set(catalog).size !== catalog.length) throw new Error('catalog contains duplicate task ids.');
  const expected = new Set(catalog);
  const actual = Object.keys(taskSupport);
  for (const taskId of catalog) {
    if (!(taskId in taskSupport)) throw new Error(`taskSupport is missing task: ${taskId}`);
    validateSupportValue(taskSupport[taskId], taskId);
  }
  for (const taskId of actual) {
    if (!expected.has(taskId)) throw new Error(`taskSupport contains extra task: ${taskId}`);
  }
}

export function createRunManifest(input) {
  validateTaskSupport(input.profile.taskSupport, input.catalog);
  if (!/^[0-9a-f]{40}$/u.test(input.nextAgentCommit)) throw new Error('nextAgentCommit must be a full Git commit.');
  const manifest = {
    schemaVersion: 2,
    runId: input.runId ?? randomUUID(),
    profileId: input.profile.profileId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    harnessBenchCommit: input.profile.upstreamCommit,
    nextAgentCommit: input.nextAgentCommit,
    nextAgentDirty: input.nextAgentDirty,
    modelId: input.modelId ?? input.profile.modelId,
    graderModelId: input.profile.graderModelId,
    taskTimeoutSeconds: input.profile.taskTimeoutSeconds,
    terminalTimeoutSeconds: input.profile.terminalTimeoutSeconds,
    resultCollectionGraceSeconds: HARNESSBENCH_RESULT_COLLECTION_GRACE_SECONDS,
    benchmarkTaskCount: input.catalog.length,
    tasks: input.catalog.map((taskId) => normalizeManifestTask(taskId, input.profile.taskSupport[taskId])),
  };
  return deepFreeze(manifest);
}

export async function writeExclusiveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export function resolveEnvReference(reference, env = process.env) {
  assertEnvRef(reference, 'environment reference');
  const name = reference.slice(4);
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`required environment reference is unavailable: ${name}`);
  return value;
}

export function ensureHttpsProviderUrl(reference, env = process.env) {
  const value = resolveEnvReference(reference, env);
  const url = new URL(value);
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) throw new Error('provider URL must use HTTPS except for a loopback HarnessBench proxy.');
  return url.toString().replace(/\/$/u, '');
}

export function readGitFact(repoRoot) {
  const commit = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const dirty = runGit(repoRoot, ['status', '--porcelain']).length > 0;
  return { commit, dirty };
}

export function validateCachedUpstream(cacheRoot, expectedRemote, expectedCommit) {
  if (!existsSync(resolve(cacheRoot, '.git'))) throw new Error('HarnessBench cache is not a Git repository.');
  const remote = normalizeRemote(runGit(cacheRoot, ['remote', 'get-url', 'origin']));
  if (remote !== normalizeRemote(expectedRemote)) throw new Error('HarnessBench cache remote does not match the pinned upstream.');
  const head = runGit(cacheRoot, ['rev-parse', 'HEAD']);
  if (head !== expectedCommit) throw new Error('HarnessBench cache HEAD does not match the pinned commit.');
}

export function acquirePinnedUpstream({ cacheRoot, remote, commit }) {
  if (existsSync(cacheRoot)) {
    validateCachedUpstream(cacheRoot, remote, commit);
    return cacheRoot;
  }
  mkdirSyncSafe(dirname(cacheRoot));
  runCommand('git', ['clone', '--filter=blob:none', '--no-checkout', remote, cacheRoot], dirname(cacheRoot));
  runCommand('git', ['fetch', '--depth', '1', 'origin', commit], cacheRoot);
  runCommand('git', ['checkout', '--detach', commit], cacheRoot);
  validateCachedUpstream(cacheRoot, remote, commit);
  return cacheRoot;
}

function normalizeManifestTask(taskId, support) {
  if (support === 'execute') return { taskId, supportStatus: 'execute' };
  return { taskId, supportStatus: 'unsupported', reason: support.reason };
}

function validateSupportValue(value, taskId) {
  if (value === 'execute') return;
  assertRecord(value, `taskSupport.${taskId}`);
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'status' && key !== 'reason')) throw new Error(`taskSupport.${taskId} contains an unknown field.`);
  if (value.status !== 'unsupported') throw new Error(`taskSupport.${taskId} must be execute or unsupported.`);
  assertNonEmpty(value.reason, `taskSupport.${taskId}.reason`);
}

function assertRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
}

function assertEnvRef(value, label) {
  if (typeof value !== 'string' || !/^env:[A-Z][A-Z0-9_]*$/u.test(value)) throw new Error(`${label} must be an env:<NAME> reference.`);
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function taskSort(left, right) {
  const leftNumber = Number.parseInt(left.split('-', 1)[0] ?? '', 10);
  const rightNumber = Number.parseInt(right.split('-', 1)[0] ?? '', 10);
  return leftNumber - rightNumber || left.localeCompare(right);
}

function normalizeRemote(value) {
  return value
    .trim()
    .replace(/\.git$/u, '')
    .replace(/\/$/u, '')
    .toLowerCase();
}

function runGit(cwd, args) {
  return runCommand('git', args, cwd).trim();
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, shell: false });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || 'unknown error').trim()}`);
  return result.stdout;
}

function mkdirSyncSafe(path) {
  mkdirSync(path, { recursive: true });
}

function isLoopbackHttp(url) {
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
}
