import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = resolve(repoRoot, 'frontend', 'agent-web');
const viteBin = resolve(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const artifactRoot = resolve(repoRoot, 'dist', 'dev', 'agent-web-test-hosts');
const localDist = resolve(artifactRoot, 'dist', 'local');

if (!existsSync(viteBin)) {
  throw new Error('Vite CLI was not found. Run npm install in frontend/agent-web first.');
}

rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(localDist, { recursive: true });

const build = spawnSync(
  process.execPath,
  [viteBin, 'build', '--mode', 'local-auth', '--base', '/testclaw-local/', '--outDir', localDist, '--emptyOutDir'],
  {
    cwd: frontendRoot,
    env: { ...process.env, VITE_BUILD_TARGET: 'testclaw-local' },
    stdio: 'inherit',
  },
);
if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  throw new Error(`local TestClaw host build failed with exit code ${build.status ?? 'unknown'}.`);
}

const indexHtml = resolve(localDist, 'index.html');
if (!existsSync(indexHtml) || !statSync(indexHtml).isFile()) {
  throw new Error('local TestClaw host artifact is missing dist/local/index.html.');
}
const indexSource = readFileSync(indexHtml, 'utf8');
if (indexSource.includes('/src/entries/local.tsx') || !indexSource.includes('/testclaw-local/assets/')) {
  throw new Error('local TestClaw host artifact is not a closed executable bundle.');
}

writeJson(resolve(artifactRoot, 'package.json'), {
  name: '@nextagent/agent-web-test-hosts',
  version: '1.0.0',
  private: true,
  type: 'module',
  exports: { './hosting': './hosting.js' },
  files: ['dist', 'hosting.js', 'hosting-manifest.json'],
});
writeJson(resolve(artifactRoot, 'hosting-manifest.json'), {
  local: {
    assetRoot: 'dist/local',
    indexHtml: 'dist/local/index.html',
    routeBase: '/testclaw-local/',
    spaFallback: true,
  },
});
writeFileSync(
  resolve(artifactRoot, 'hosting.js'),
  `import { readFileSync } from "node:fs";\nimport { dirname, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst packageRoot = dirname(fileURLToPath(import.meta.url));\n\nexport function resolveTestHostManifest() {\n  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "hosting-manifest.json"), "utf8"));\n  return { packageRoot, ...manifest };\n}\n`,
  'utf8',
);

console.log(`Assembled @nextagent/agent-web-test-hosts artifact at ${artifactRoot}`);

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
