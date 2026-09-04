import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYSTEM_CONFIG_PATH, AGENT_CONFIG_PATH, CONFIG_DIR } from './package-root.js';

const BACKUP_DIR = resolve(CONFIG_DIR, '.test-backups');

function ensureBackupDir(): void {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

export function readSystemConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(SYSTEM_CONFIG_PATH, 'utf8'));
}

export function writeSystemConfig(config: Record<string, unknown>): void {
  writeFileSync(SYSTEM_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function readAgentConfig(): string {
  return readFileSync(AGENT_CONFIG_PATH, 'utf8');
}

export function writeAgentConfig(content: string): void {
  writeFileSync(AGENT_CONFIG_PATH, content, 'utf8');
}

export function backupConfig(filename: string): void {
  ensureBackupDir();
  const src = resolve(CONFIG_DIR, filename);
  const dst = resolve(BACKUP_DIR, filename);
  if (existsSync(src)) {
    copyFileSync(src, dst);
  }
}

export function restoreConfig(filename: string): void {
  const src = resolve(BACKUP_DIR, filename);
  const dst = resolve(CONFIG_DIR, filename);
  if (existsSync(src)) {
    copyFileSync(src, dst);
  }
}

export function backupAllConfigs(): void {
  backupConfig('default-system.json');
  backupConfig('default-agent.yaml');
}

export function restoreAllConfigs(): void {
  restoreConfig('default-system.json');
  restoreConfig('default-agent.yaml');
}

export function cleanupBackups(): void {
  if (existsSync(BACKUP_DIR)) {
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }
}

export function deepMergeConfig(base: Record<string, unknown>, ...overrides: Partial<Record<string, unknown>>[]): Record<string, unknown> {
  const result = { ...base };
  for (const override of overrides) {
    for (const key of Object.keys(override)) {
      const baseVal = result[key];
      const overVal = override[key];
      if (
        typeof baseVal === 'object' &&
        baseVal !== null &&
        !Array.isArray(baseVal) &&
        typeof overVal === 'object' &&
        overVal !== null &&
        !Array.isArray(overVal)
      ) {
        result[key] = deepMergeConfig(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
      } else {
        result[key] = overVal;
      }
    }
  }
  return result;
}
