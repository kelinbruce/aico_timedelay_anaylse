import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertPiuClosedRuntimeAssetSet } from '../../../scripts/agent-web-artifact-validation.mjs';

const frontendRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(frontendRoot, 'dist');
const piuRoot = resolve(distRoot, 'piu');
const viteBin = resolve(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const buildArgs = parseBuildArgs(process.argv.slice(2));

runViteBuild('multi-host-page', buildArgs);
promoteImmersiveHtmlToIndex();
runViteBuild('piu', buildArgs);
validateFormalArtifact();

function parseBuildArgs(argv) {
  const args = { base: undefined, apiUrlPrefix: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') {
      args.base = argv[++i];
    } else if (arg === '--apiUrlPrefix') {
      args.apiUrlPrefix = argv[++i];
    }
  }
  if (args.base !== undefined && !/^(?:\/|\/[A-Za-z0-9/_-]*\/)$/.test(args.base)) {
    throw new Error('--base must start and end with "/" and use only safe path chars (A-Z a-z 0-9 / _ -); got: ' + args.base);
  }
  if (args.apiUrlPrefix !== undefined && !/^\/[A-Za-z0-9/_-]*$/.test(args.apiUrlPrefix)) {
    throw new Error('--apiUrlPrefix must start with "/" and use only safe path chars (A-Z a-z 0-9 / _ -); got: ' + args.apiUrlPrefix);
  }
  return args;
}

function runViteBuild(target, args) {
  if (!existsSync(viteBin)) {
    throw new Error('Vite CLI was not found. Run npm install in frontend/agent-web first.');
  }

  const result = spawnSync(process.execPath, [viteBin, 'build', '--mode', target], {
    cwd: frontendRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_BUILD_TARGET: target,
      ...(args?.base ? { VITE_BASE: args.base } : {}),
      ...(args?.apiUrlPrefix ? { VITE_API_URL_PREFIX: args.apiUrlPrefix } : {}),
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`vite build target '${target}' failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function promoteImmersiveHtmlToIndex() {
  const immersiveHtml = resolve(distRoot, 'immersive.html');
  const indexHtml = resolve(distRoot, 'index.html');
  if (!existsSync(immersiveHtml)) {
    throw new Error('multi-host page build did not produce dist/immersive.html.');
  }
  rmSync(indexHtml, { force: true });
  renameSync(immersiveHtml, indexHtml);
}

function validateFormalArtifact() {
  const indexHtml = resolve(distRoot, 'index.html');
  const piuJs = resolve(piuRoot, 'AIAgentPIU.js');
  const piuCss = resolve(piuRoot, 'AIAgentPIU.css');

  for (const required of [indexHtml, piuJs, piuCss]) {
    if (!existsSync(required) || !statSync(required).isFile()) {
      throw new Error(`formal frontend artifact is missing ${required}.`);
    }
  }

  const indexSource = readFileSync(indexHtml, 'utf8');
  if (!indexSource.includes('<script src="/febs/v1/assets/prelude-loader"></script>')) {
    throw new Error('formal dist/index.html must include the fixed Prel loader path.');
  }
  for (const forbidden of ['/src/entries/local.tsx', 'LocalLoginPage', 'nextagent.themePreference', 'nextagent.localePreference']) {
    if (indexSource.includes(forbidden)) {
      throw new Error(`formal dist/index.html contains forbidden local-only marker '${forbidden}'.`);
    }
  }

  for (const forbiddenPath of ['immersive.html', 'collaborative.html', 'febs']) {
    if (existsSync(resolve(distRoot, forbiddenPath))) {
      throw new Error(`formal frontend artifact must not contain ${forbiddenPath}.`);
    }
  }

  mkdirSync(piuRoot, { recursive: true });
  const piuFiles = readdirSync(piuRoot).sort();
  const allowedPiuFiles = ['AIAgentPIU.css', 'AIAgentPIU.js'];
  if (JSON.stringify(piuFiles) !== JSON.stringify(allowedPiuFiles)) {
    throw new Error(`AIAgentPIU runtime assets must be exactly ${allowedPiuFiles.join(', ')}; got ${piuFiles.join(', ')}.`);
  }

  const piuSource = readFileSync(piuJs, 'utf8');
  if (piuSource.includes('/src/entries/piu.tsx')) {
    throw new Error('AIAgentPIU.js must not require source entry loading.');
  }
  assertPiuClosedRuntimeAssetSet({ piuJs, piuCss });
}
