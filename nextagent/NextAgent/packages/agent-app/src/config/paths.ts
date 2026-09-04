import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

export interface AppRuntimePaths {
  readonly baseDir: string;
  readonly configRoot: string;
  readonly dataDir: string;
  readonly systemDataDir: string;
  readonly workspaceRoot: string;
  readonly runtimeWorkspaceRoot: string;
  readonly sharedDataRoot: string;
  readonly logDirectory: string;
  readonly systemSkillsRoot: string;
  readonly agentsRoot: string;
  readonly workingMemorySqliteFile: string;
  readonly longTermMemorySqliteFile: string;
  readonly sqliteFile: string;
  readonly uploadTempDir: string;
  readonly downloadTempDir: string;
}

export function createRuntimePaths(
  configRoot: string,
  paths: { readonly workspaceRoot: string; readonly logDirectory?: string; readonly skillRoot?: string; readonly agentRoot?: string },
): AppRuntimePaths {
  const root = normalizeNonEmptyPath(configRoot, process.cwd());
  const relativePathBase = basename(root) === 'config' ? dirname(root) : root;
  const workspaceRoot = normalizeNonEmptyPath(paths.workspaceRoot, relativePathBase);
  const logDirectory = normalizeNonEmptyPath(paths.logDirectory ?? 'logs', relativePathBase);
  const systemSkillsRoot = normalizeNonEmptyPath(paths.skillRoot ?? 'skills', relativePathBase);
  const agentsRoot = normalizeNonEmptyPath(paths.agentRoot ?? 'agents', relativePathBase);
  const dataDir = resolve(workspaceRoot, 'data');
  const systemDataDir = resolve(dataDir, 'system');
  const runtimeWorkspaceRoot = resolve(workspaceRoot, 'execution');
  const sharedDataRoot = resolve(workspaceRoot, 'shared-data');
  const workingMemorySqliteFile = normalizeSqliteFile(resolve(systemDataDir, 'working-memory.sqlite'));
  const longTermMemorySqliteFile = normalizeSqliteFile(resolve(systemDataDir, 'long-term-memory.sqlite'));
  const sqliteFile = normalizeSqliteFile(resolve(systemDataDir, 'nextagent.sqlite'));
  const uploadTempDir = resolve(systemDataDir, 'upload-tmp');
  const downloadTempDir = resolve(systemDataDir, 'download-tmp');
  validateExecutionRootPath(workspaceRoot, runtimeWorkspaceRoot, [dataDir, systemDataDir, dirname(sqliteFile), systemSkillsRoot, agentsRoot]);
  validateSharedDataRootPath(workspaceRoot, sharedDataRoot, [
    runtimeWorkspaceRoot,
    dataDir,
    systemDataDir,
    dirname(sqliteFile),
    systemSkillsRoot,
    agentsRoot,
  ]);
  for (const path of [systemSkillsRoot, agentsRoot]) {
    if (
      overlapsPath(path, dataDir) ||
      overlapsPath(path, systemDataDir) ||
      overlapsPath(path, runtimeWorkspaceRoot) ||
      overlapsPath(path, sharedDataRoot)
    ) {
      throw new Error('Trusted app resource roots must not point at a NextAgent runtime directory.');
    }
  }
  for (const path of [dataDir, systemDataDir, dirname(sqliteFile), systemSkillsRoot, agentsRoot, sharedDataRoot]) {
    if (path === runtimeWorkspaceRoot || isPathInside(path, runtimeWorkspaceRoot) || isPathInside(runtimeWorkspaceRoot, path)) {
      throw new Error('Execution workspace root must not overlap runtime data or config roots.');
    }
  }
  return {
    baseDir: root,
    configRoot: root,
    dataDir,
    systemDataDir,
    workspaceRoot,
    runtimeWorkspaceRoot,
    sharedDataRoot,
    logDirectory,
    systemSkillsRoot,
    agentsRoot,
    workingMemorySqliteFile,
    longTermMemorySqliteFile,
    sqliteFile,
    uploadTempDir,
    downloadTempDir,
  };
}

function validateSharedDataRootPath(workspaceRoot: string, sharedDataRoot: string, overlapCandidates: readonly string[]): void {
  const sharedDataStats = existingPathStats(sharedDataRoot);
  if (sharedDataStats !== undefined && (!sharedDataStats.isDirectory() || sharedDataStats.isSymbolicLink())) {
    throw new Error('Shared data root must be a normal directory when it already exists.');
  }
  const trustedWorkspaceRoot = canonicalPathForContainment(workspaceRoot);
  const sharedDataRealPath = canonicalPathForContainment(sharedDataRoot);
  if (sharedDataRealPath !== trustedWorkspaceRoot && !isPathInside(trustedWorkspaceRoot, sharedDataRealPath)) {
    throw new Error('Shared data root must stay inside the configured workspace root.');
  }
  for (const candidate of overlapCandidates) {
    const candidateRealPath = canonicalPathForContainment(candidate);
    if (
      candidateRealPath === sharedDataRealPath ||
      isPathInside(candidateRealPath, sharedDataRealPath) ||
      isPathInside(sharedDataRealPath, candidateRealPath)
    ) {
      throw new Error('Shared data root must not overlap runtime data or config roots.');
    }
  }
}

export function normalizeSqliteFile(file: string): string {
  const normalized = normalizeNonEmptyPath(file, process.cwd());
  if (!normalized.endsWith('.sqlite') && !normalized.endsWith('.sqlite3') && !normalized.endsWith('.db')) {
    throw new Error('Runtime SQLite file must end with .sqlite, .sqlite3, or .db.');
  }
  return normalized;
}

export function sqliteParentDir(paths: AppRuntimePaths): string {
  return dirname(paths.sqliteFile);
}

function normalizeNonEmptyPath(path: string, baseDir: string): string {
  if (path.trim().length === 0) {
    throw new Error('Runtime path must be non-empty.');
  }
  return isAbsolute(path) ? resolve(path) : resolve(baseDir, path);
}

function isPathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path);
}

function overlapsPath(left: string, right: string): boolean {
  return left === right || isPathInside(left, right) || isPathInside(right, left);
}

function validateExecutionRootPath(workspaceRoot: string, runtimeWorkspaceRoot: string, overlapCandidates: readonly string[]): void {
  const workspaceStats = existingPathStats(workspaceRoot);
  if (workspaceStats !== undefined && (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink())) {
    throw new Error('Workspace root must be a normal directory when it already exists.');
  }
  const runtimeStats = existingPathStats(runtimeWorkspaceRoot);
  if (runtimeStats === undefined) {
    return;
  }
  if (!runtimeStats.isDirectory() || runtimeStats.isSymbolicLink()) {
    throw new Error('Execution workspace root must be a normal directory when it already exists.');
  }
  const trustedWorkspaceRoot = canonicalPathForContainment(workspaceRoot);
  const runtimeRealPath = realpathSync(runtimeWorkspaceRoot);
  if (runtimeRealPath !== trustedWorkspaceRoot && !isPathInside(trustedWorkspaceRoot, runtimeRealPath)) {
    throw new Error('Execution workspace root must stay inside the configured workspace root.');
  }
  for (const candidate of overlapCandidates) {
    const candidateRealPath = canonicalPathForContainment(candidate);
    if (
      candidateRealPath === runtimeRealPath ||
      isPathInside(candidateRealPath, runtimeRealPath) ||
      isPathInside(runtimeRealPath, candidateRealPath)
    ) {
      throw new Error('Execution workspace root must not overlap runtime data or config roots.');
    }
  }
}

function existingPathStats(path: string): ReturnType<typeof lstatSync> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return lstatSync(path);
}

function realpathIfExists(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return realpathSync(path);
}

function canonicalPathForContainment(path: string): string {
  const existingRealPath = realpathIfExists(path);
  if (existingRealPath !== undefined) {
    return existingRealPath;
  }
  const parent = dirname(path);
  if (parent === path) {
    return path;
  }
  return resolve(canonicalPathForContainment(parent), basename(path));
}
