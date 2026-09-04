import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function resolveContainedPath(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error('Workspace member must be a non-empty relative path.');
  }
  const parent = resolve(root);
  const target = resolve(parent, relativePath);
  const rel = relative(parent, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('Workspace member escapes the trusted root.');
  }
  return target;
}

export async function copyRegularTree(sourceRoot, targetRoot) {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  await mkdir(target, { recursive: true });
  await copyDirectory(source, target, source);
}

export async function replaceRegularTree(sourceRoot, targetRoot) {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  assertSeparateTrees(source, target);
  await validateRegularDirectory(source, source);
  await mkdir(target, { recursive: true });
  await clearDirectoryContents(target);
  await copyDirectory(source, target, source);
}

export function parseTerminalSse(body) {
  const events = body.split(/\r?\n\r?\n/u).map(parseSseBlock);
  const completed = events.find(({ event }) => event === 'REQUEST_COMPLETED' || event === 'RUN_COMPLETED');
  if (completed !== undefined) return { status: 'completed' };
  const failed = events.find(({ event }) => event === 'REQUEST_FAILED' || event === 'RUN_FAILED');
  if (failed !== undefined)
    return { status: 'failed', ...(readSafeReasonCode(failed.data) === undefined ? {} : { reasonCode: readSafeReasonCode(failed.data) }) };
  const canceled = events.find(({ event }) => event === 'REQUEST_CANCELED' || event === 'RUN_CANCELED');
  if (canceled !== undefined) return { status: 'canceled' };
  return undefined;
}

export function latestTimelineSequenceSse(body) {
  let latest;
  for (const { data } of body.split(/\r?\n\r?\n/u).map(parseSseBlock)) {
    try {
      const sequence = JSON.parse(data)?.sequence;
      if (Number.isSafeInteger(sequence) && sequence >= 0) latest = latest === undefined ? sequence : Math.max(latest, sequence);
    } catch {
      continue;
    }
  }
  return latest;
}

function parseSseBlock(block) {
  let event;
  const data = [];
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim());
  }
  return { event, data: data.join('\n') };
}

function readSafeReasonCode(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value);
    const code = parsed?.payload?.code ?? parsed?.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

async function copyDirectory(source, target, sourceRoot) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolveContainedPath(sourceRoot, relative(sourceRoot, resolve(source, entry.name)));
    const targetPath = resolve(target, entry.name);
    const stats = await lstat(sourcePath);
    if (stats.isSymbolicLink()) throw new Error(`Workspace contains a symbolic link or junction: ${entry.name}`);
    if (stats.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyDirectory(sourcePath, targetPath, sourceRoot);
      continue;
    }
    if (!stats.isFile()) throw new Error(`Workspace contains a non-regular member: ${entry.name}`);
    await cp(sourcePath, targetPath, { force: true, preserveTimestamps: true });
  }
}

async function validateRegularDirectory(source, sourceRoot) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolveContainedPath(sourceRoot, relative(sourceRoot, resolve(source, entry.name)));
    const stats = await lstat(sourcePath);
    if (stats.isSymbolicLink()) throw new Error(`Workspace contains a symbolic link or junction: ${entry.name}`);
    if (stats.isDirectory()) await validateRegularDirectory(sourcePath, sourceRoot);
    else if (!stats.isFile()) throw new Error(`Workspace contains a non-regular member: ${entry.name}`);
  }
}

async function clearDirectoryContents(target) {
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const targetPath = resolveContainedPath(target, entry.name);
    await rm(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

function assertSeparateTrees(source, target) {
  const sourceToTarget = relative(source, target);
  const targetToSource = relative(target, source);
  if (source === target || isContainedRelative(sourceToTarget) || isContainedRelative(targetToSource)) {
    throw new Error('Workspace source and target trees must not overlap.');
  }
}

function isContainedRelative(value) {
  return value.length > 0 && value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(value);
}
