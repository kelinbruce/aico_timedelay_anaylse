import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = readJson(resolve(repoRoot, 'package.json'));
const frontendDist = resolve(repoRoot, 'frontend', 'agent-web', 'dist');
const artifactRoot = resolve(repoRoot, 'dist', 'dev', 'agent-web-package');
const artifactDist = resolve(artifactRoot, 'dist');

rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(artifactRoot, { recursive: true });
cpSync(frontendDist, artifactDist, { recursive: true });

writeJson(resolve(artifactRoot, 'package.json'), {
  name: '@nextagent/agent-web',
  version: rootPackage.version,
  type: 'module',
  exports: {
    './hosting': './hosting.js',
  },
  files: ['dist', 'hosting.js', 'hosting-manifest.json'],
});

writeJson(resolve(artifactRoot, 'hosting-manifest.json'), {
  assetRoot: 'dist',
  indexHtml: 'dist/index.html',
  routeBase: '/',
  spaFallback: true,
});

writeFileSync(
  resolve(artifactRoot, 'hosting.js'),
  `import { readFileSync } from "node:fs";\nimport { dirname, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst packageRoot = dirname(fileURLToPath(import.meta.url));\n\nexport function resolveFrontendHostingManifest() {\n  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "hosting-manifest.json"), "utf8"));\n  return { packageRoot, ...manifest };\n}\n`,
  'utf8',
);

console.log(`Assembled @nextagent/agent-web artifact at ${artifactRoot}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
