import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuildWorkspaceDists } from './pack-local-runtime.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);

export function rebuildRuntimeWorkspaceDists(root = repoRoot, runner) {
  rebuildWorkspaceDists(root, 'with-frontend', runner);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  rebuildRuntimeWorkspaceDists();
}
