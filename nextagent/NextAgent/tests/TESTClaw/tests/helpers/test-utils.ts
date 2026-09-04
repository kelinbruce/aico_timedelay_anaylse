import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT, SELFCHECK_SCRIPT } from './package-root.js';

/** Run the self-check script and return its output */
export function runSelfCheck(timeoutMs = 30_000): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execSync(`node "${SELFCHECK_SCRIPT}"`, {
      cwd: PACKAGE_ROOT,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

/** Get installed package version by name */
export function getPackageVersion(pkgName: string): string | undefined {
  try {
    const pkgPath = resolve(PACKAGE_ROOT, 'node_modules', pkgName, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return undefined;
  }
}

/** Read the package.json of the root package */
export function readRootPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
}

/** Measure execution time of a function */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round(performance.now() - start);
  return { result, durationMs };
}

/** Retry a function until it succeeds or times out */
export async function retryUntil<T>(fn: () => Promise<T>, predicate: (result: T) => boolean, timeoutMs = 10_000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastResult: T;
  do {
    lastResult = await fn();
    if (predicate(lastResult)) {
      return lastResult;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  return lastResult;
}
