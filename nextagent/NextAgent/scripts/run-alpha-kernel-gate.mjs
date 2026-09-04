import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDir =
  process.env.NEXTAGENT_RELEASE_CHECK_DIR === undefined
    ? resolve(root, '.tmp', 'alpha-kernel-gate')
    : resolve(process.env.NEXTAGENT_RELEASE_CHECK_DIR);
mkdirSync(reportDir, { recursive: true });

const caseResultsPath = resolve(reportDir, 'alpha-kernel-gate.cases.json');
rmSync(caseResultsPath, { force: true });
rmSync(resolve(reportDir, 'alpha-kernel-gate.json'), { force: true });

const vitestPath = resolve(root, 'node_modules', 'vitest', 'vitest.mjs');
const env = {
  ...process.env,
  NEXTAGENT_RELEASE_CHECK_DIR: reportDir,
  NEXTAGENT_CASE_RESULTS_FILE: caseResultsPath,
};
const result = spawnSync(
  process.execPath,
  [
    vitestPath,
    'run',
    '--maxWorkers=1',
    'tests/e2e/alpha-kernel-gate/01-main-flow.test.ts',
    'tests/e2e/alpha-kernel-gate/02-sse-sequence.test.ts',
    'tests/e2e/alpha-kernel-gate/03-concurrent-conflict.test.ts',
    'tests/e2e/alpha-kernel-gate/04-safe-error.test.ts',
    'tests/e2e/alpha-kernel-gate/05-idempotent-session.test.ts',
    'tests/e2e/alpha-kernel-gate/06-owner-scope.test.ts',
  ],
  { cwd: root, env, stdio: 'inherit' },
);
const reportResult = spawnSync(process.execPath, [vitestPath, 'run', '--maxWorkers=1', 'tests/e2e/alpha-kernel-gate/write-report.test.ts'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
process.exitCode = result.status === 0 && reportResult.status === 0 ? 0 : (result.status ?? reportResult.status ?? 1);
