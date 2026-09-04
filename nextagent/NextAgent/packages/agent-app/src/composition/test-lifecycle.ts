import { rm, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { NextAgentApp } from './create-app.js';

const activeApps = new Set<NextAgentApp>();
const cleanupFiles = new Set<string>();
const cleanupDirs = new Set<string>();

export function registerNextAgentTestApp<TApp extends NextAgentApp>(app: TApp, cleanupPath?: string): TApp {
  activeApps.add(app);
  registerCleanupFile(app.systemConfig.paths.workingMemorySqliteFile);
  registerCleanupFile(app.systemConfig.paths.longTermMemorySqliteFile);
  registerCleanupFile(app.systemConfig.paths.sqliteFile);
  cleanupDirs.add(resolve(app.systemConfig.paths.systemDataDir));
  cleanupDirs.add(resolve(app.systemConfig.paths.dataDir));
  cleanupDirs.add(resolve(app.systemConfig.paths.workspaceRoot, 'default-agent'));
  cleanupDirs.add(resolve(app.systemConfig.paths.workspaceRoot));
  if (cleanupPath !== undefined) {
    registerCleanupFile(cleanupPath);
  }
  return app;
}

export async function cleanupNextAgentTestApps(): Promise<void> {
  const apps = [...activeApps].reverse();
  const files = [...cleanupFiles];
  const dirs = [...cleanupDirs].sort((left, right) => right.length - left.length);
  activeApps.clear();
  cleanupFiles.clear();
  cleanupDirs.clear();

  for (const app of apps) {
    await app.close();
  }
  for (const file of files) {
    await removeSqliteFile(file);
    await removeSqliteFile(`${file}-journal`);
    await removeSqliteFile(`${file}-wal`);
    await removeSqliteFile(`${file}-shm`);
  }
  for (const dir of dirs) {
    await rmdir(dir).catch(() => undefined);
  }
}

function registerCleanupFile(path: string): void {
  const file = resolve(path);
  cleanupFiles.add(file);
  cleanupDirs.add(dirname(file));
}

async function removeSqliteFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(file, { force: true });
      return;
    } catch (error) {
      if (!isTransientFileLock(error)) {
        throw error;
      }
      await delay(250);
    }
  }
  try {
    await rm(file, { force: true });
  } catch (error) {
    if (!isTransientFileLock(error)) {
      throw error;
    }
  }
}

function isTransientFileLock(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EBUSY' || error.code === 'EPERM');
}
