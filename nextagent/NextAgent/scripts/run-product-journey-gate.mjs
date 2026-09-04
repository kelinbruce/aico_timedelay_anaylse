import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDir =
  process.env.NEXTAGENT_RELEASE_CHECK_DIR === undefined
    ? resolve(root, '.tmp', 'product-journey-gate')
    : resolve(process.env.NEXTAGENT_RELEASE_CHECK_DIR);
mkdirSync(reportDir, { recursive: true });

const caseResultsPath = resolve(reportDir, 'product-journey.cases.json');
rmSync(caseResultsPath, { force: true });
rmSync(resolve(reportDir, 'product-journey.json'), { force: true });

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
    '--config',
    'vitest.config.release.ts',
    '--maxWorkers=1',
    'tests/e2e/product-journey/02-03-session-sse.test.ts',
    'tests/e2e/product-journey/04-11-ssews-attachment.test.ts',
    'tests/e2e/product-journey/06-08-lifecycle.test.ts',
    'tests/e2e/product-journey/09-10-retry-edit.test.ts',
    'tests/e2e/product-journey/13-15-content-tool.test.ts',
    'tests/e2e/product-journey/18-24-config-quality.test.ts',
  ],
  { cwd: root, env, stdio: 'inherit' },
);
const reportResult = spawnSync(
  process.execPath,
  [vitestPath, 'run', '--config', 'vitest.config.release.ts', '--maxWorkers=1', 'tests/e2e/product-journey/write-report.test.ts'],
  { cwd: root, env, stdio: 'inherit' },
);
process.exitCode = result.status === 0 && reportResult.status === 0 ? 0 : (result.status ?? reportResult.status ?? 1);
