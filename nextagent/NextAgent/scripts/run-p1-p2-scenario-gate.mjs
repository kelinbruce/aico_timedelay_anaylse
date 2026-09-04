import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDir =
  process.env.NEXTAGENT_RELEASE_CHECK_DIR === undefined
    ? resolve(root, '.tmp', 'p1-p2-scenario-gate')
    : resolve(process.env.NEXTAGENT_RELEASE_CHECK_DIR);
mkdirSync(reportDir, { recursive: true });

const caseResultsPath = resolve(reportDir, 'p1-p2-scenario-gate.cases.json');
rmSync(caseResultsPath, { force: true });
rmSync(resolve(reportDir, 'p1-p2-scenario-gate.json'), { force: true });

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
    'tests/e2e/p1-p2-scenario-gate/conversation-share.test.ts',
    'tests/e2e/p1-p2-scenario-gate/extension-governance.test.ts',
    'tests/e2e/p1-p2-scenario-gate/human-pending-input.test.ts',
    'tests/e2e/p1-p2-scenario-gate/long-term-memory.test.ts',
    'tests/e2e/p1-p2-scenario-gate/routing-child-agent.test.ts',
    'tests/e2e/p1-p2-scenario-gate/workflow-routing.test.ts',
  ],
  { cwd: root, env, stdio: 'inherit' },
);
const reportResult = spawnSync(
  process.execPath,
  [vitestPath, 'run', '--config', 'vitest.config.release.ts', '--maxWorkers=1', 'tests/e2e/p1-p2-scenario-gate/write-report.test.ts'],
  { cwd: root, env, stdio: 'inherit' },
);
process.exitCode = result.status === 0 && reportResult.status === 0 ? 0 : (result.status ?? reportResult.status ?? 1);
