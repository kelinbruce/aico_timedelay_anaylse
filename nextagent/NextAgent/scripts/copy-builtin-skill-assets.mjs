import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRuntimeAssets } from './runtime-assets.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

const tscResult = spawnSync(process.execPath, [tscBin, '-b'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

await copyRuntimeAssets(repoRoot);

if (tscResult.status !== 0) {
  process.exitCode = tscResult.status ?? 1;
}
