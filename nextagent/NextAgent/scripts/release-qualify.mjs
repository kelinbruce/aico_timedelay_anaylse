import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const candidateIndex = args.indexOf('--candidate');
const scopeIndex = args.indexOf('--scope');

if (candidateIndex === -1 || scopeIndex === -1 || args.length !== 4 || candidateIndex + 1 >= args.length || scopeIndex + 1 >= args.length) {
  console.error('Usage: npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>');
  process.exit(2);
}

const distEntrypoint = resolve(root, 'packages', 'agent-app', 'dist', 'release', 'run-release-qualification.js');
const { runReleaseQualification } = await import(pathToFileURL(distEntrypoint).href);
const result = runReleaseQualification({ candidateRoot: args[candidateIndex + 1], scopeFile: args[scopeIndex + 1], cwd: root });
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.qualificationStatus === 'BLOCKED' ? 1 : 0;
